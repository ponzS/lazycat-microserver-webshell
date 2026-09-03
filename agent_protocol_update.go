package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type agentProtocolUpdateRequest struct {
	CurrentProtocolVersion string `json:"current_protocol_version"`
}

type agentProtocolUpdateResponse struct {
	Status                   string `json:"status"`
	CurrentProtocolVersion   string `json:"current_protocol_version"`
	PreferredProtocolVersion string `json:"preferred_protocol_version"`
}

type staleAgentProtocolVersionError struct {
	expected string
	actual   string
}

func (e *staleAgentProtocolVersionError) Error() string {
	return fmt.Sprintf("agent protocol changed from %q to %q", e.expected, e.actual)
}

var persistentAgentProtocolUpdateMu sync.Mutex

func updatePersistentAgentProtocol(ctx context.Context, scope agentScope, expectedVersion string) (agentProtocolUpdateResponse, error) {
	persistentAgentProtocolUpdateMu.Lock()
	defer persistentAgentProtocolUpdateMu.Unlock()

	scope = normalizeAgentScope(scope.Selector, scope.AccountID)
	if err := validateInstanceSelector(scope.Selector); err != nil {
		return agentProtocolUpdateResponse{}, err
	}
	if scope.AccountID == "" {
		return agentProtocolUpdateResponse{}, errors.New("account id is required")
	}

	currentVersion := ""
	response, probeErr := pingPersistentAgentResponse(ctx, scope)
	if probeErr == nil {
		currentVersion = strings.TrimSpace(response.Version)
	} else if version := unsupportedAgentProtocolVersion(probeErr); version != "" {
		currentVersion = version
	}
	if currentVersion == agentProtocolVersion {
		return agentProtocolUpdateResponse{
			Status:                   "current",
			CurrentProtocolVersion:   agentProtocolVersion,
			PreferredProtocolVersion: agentProtocolVersion,
		}, nil
	}
	if expected := strings.TrimSpace(expectedVersion); expected != "" && currentVersion != expected {
		return agentProtocolUpdateResponse{}, &staleAgentProtocolVersionError{expected: expected, actual: currentVersion}
	}

	trace := newPersistentAgentStartupTrace(scope)
	trace.add("explicit protocol update started: current=%s preferred=%s", currentVersion, agentProtocolVersion)
	username, err := cachedInstanceUsername(ctx, scope.Selector)
	if err != nil {
		return agentProtocolUpdateResponse{}, trace.errorf("resolve username for agent protocol update failed: %v", err)
	}
	if _, err := ensureAgentBinaryInstalled(ctx, scope, trace); err != nil {
		return agentProtocolUpdateResponse{}, trace.errorf("install agent protocol update failed: %v", err)
	}
	if err := reconcilePersistentAgentDaemons(ctx, scope, true, trace); err != nil {
		return agentProtocolUpdateResponse{}, trace.errorf("stop previous agent protocol failed: %v", err)
	}
	markPersistentAgentNotRunning(scope)
	if err := startPersistentAgent(ctx, scope, username, trace); err != nil {
		return agentProtocolUpdateResponse{}, trace.errorf("start updated agent protocol failed: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		response, err := pingPersistentAgentResponse(ctx, scope)
		if err == nil && strings.TrimSpace(response.Version) == agentProtocolVersion {
			markPersistentAgentRunning(scope)
			clearPersistentAgentStartupError(scope)
			return agentProtocolUpdateResponse{
				Status:                   "updated",
				CurrentProtocolVersion:   agentProtocolVersion,
				PreferredProtocolVersion: agentProtocolVersion,
			}, nil
		}
		select {
		case <-ctx.Done():
			return agentProtocolUpdateResponse{}, trace.errorf("agent protocol update verification canceled: %v", ctx.Err())
		case <-time.After(120 * time.Millisecond):
		}
	}
	return agentProtocolUpdateResponse{}, trace.errorf("updated agent protocol did not become ready")
}

func (s *pluginServer) handleAgentProtocolUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	selector := strings.TrimSpace(r.URL.Query().Get("name"))
	if selector == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if isClientTarget(selector) {
		http.Error(w, "client targets do not use the local terminal agent", http.StatusBadRequest)
		return
	}
	accountID := currentRequestAccountID(r)
	if accountID == "" {
		http.Error(w, "account id is required", http.StatusUnauthorized)
		return
	}
	if err := s.authorizeInstanceSelector(r.Context(), selector); err != nil {
		writeAuthorizationError(w, err)
		return
	}

	var request agentProtocolUpdateRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "invalid protocol update request", http.StatusBadRequest)
		return
	}
	result, err := updatePersistentAgentProtocol(
		r.Context(),
		normalizeAgentScope(selector, accountID),
		request.CurrentProtocolVersion,
	)
	if err != nil {
		var stale *staleAgentProtocolVersionError
		if errors.As(err, &stale) {
			http.Error(w, "终端服务协议状态已变化，请重新加载后再试。", http.StatusConflict)
			return
		}
		http.Error(w, "终端服务协议更新失败。", http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}
