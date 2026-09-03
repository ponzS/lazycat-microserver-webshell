package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestAgentProtocolMismatchResponsePreservesUpgradeOrDowngradeVersion(t *testing.T) {
	for _, version := range []string{"lcmd-webshell-agent-v1", "lcmd-webshell-agent-v20"} {
		recorder := httptest.NewRecorder()
		if !writeAgentProtocolMismatch(recorder, &unsupportedAgentProtocolError{version: version}) {
			t.Fatalf("writeAgentProtocolMismatch(%s) = false", version)
		}
		if recorder.Code != http.StatusConflict {
			t.Fatalf("writeAgentProtocolMismatch(%s) status = %d, want %d", version, recorder.Code, http.StatusConflict)
		}
		var payload agentProtocolMismatchResponse
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("Unmarshal(%s) error = %v", version, err)
		}
		if payload.CurrentProtocolVersion != version || payload.PreferredProtocolVersion != agentProtocolVersion {
			t.Fatalf("mismatch payload = %+v", payload)
		}
		if !payload.UpdateAvailable || !payload.UpdateRequired {
			t.Fatalf("mismatch payload flags = %+v", payload)
		}
	}
}

func TestAgentProtocolMismatchStopsBeforeInstallingPackagedBinary(t *testing.T) {
	source, err := os.ReadFile("agent_runtime.go")
	if err != nil {
		t.Fatalf("ReadFile(agent_runtime.go) error = %v", err)
	}
	ensureStart := strings.Index(string(source), "func ensurePersistentAgentOnce(ctx context.Context, scope agentScope)")
	ensureEnd := strings.Index(string(source), "func cachedInstanceUsername(ctx context.Context, selector string)")
	if ensureStart < 0 || ensureEnd <= ensureStart {
		t.Fatal("ensurePersistentAgentOnce source block not found")
	}
	block := string(source)[ensureStart:ensureEnd]
	mismatchGuard := strings.Index(block, "if isUnsupportedAgentProtocolError(preInstallPingErr)")
	install := strings.Index(block, "ensureAgentBinaryInstalled(ctx, scope, trace)")
	if mismatchGuard < 0 || install < 0 || mismatchGuard > install {
		t.Fatal("protocol mismatch must stop before the packaged agent binary is installed")
	}
}

func TestAgentProtocolUpdateHandlerRejectsInvalidRequests(t *testing.T) {
	server := &pluginServer{}

	methodRecorder := httptest.NewRecorder()
	server.handleAgentProtocolUpdate(methodRecorder, httptest.NewRequest(http.MethodGet, "/api/agent/protocol-update?name=demo@owner", nil))
	if methodRecorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d, want %d", methodRecorder.Code, http.StatusMethodNotAllowed)
	}

	missingRecorder := httptest.NewRecorder()
	server.handleAgentProtocolUpdate(missingRecorder, httptest.NewRequest(http.MethodPost, "/api/agent/protocol-update", strings.NewReader(`{}`)))
	if missingRecorder.Code != http.StatusBadRequest {
		t.Fatalf("missing target status = %d, want %d", missingRecorder.Code, http.StatusBadRequest)
	}

	clientRecorder := httptest.NewRecorder()
	server.handleAgentProtocolUpdate(clientRecorder, httptest.NewRequest(http.MethodPost, "/api/agent/protocol-update?name=client:test", strings.NewReader(`{}`)))
	if clientRecorder.Code != http.StatusBadRequest {
		t.Fatalf("client target status = %d, want %d", clientRecorder.Code, http.StatusBadRequest)
	}
}

func TestAgentProtocolUpdateIsTheOnlyActiveReplacementPath(t *testing.T) {
	runtimeSource, err := os.ReadFile("agent_runtime.go")
	if err != nil {
		t.Fatalf("ReadFile(agent_runtime.go) error = %v", err)
	}
	ensureStart := strings.Index(string(runtimeSource), "func ensurePersistentAgent(ctx context.Context, scope agentScope)")
	ensureEnd := strings.Index(string(runtimeSource), "func cachedInstanceUsername(ctx context.Context, selector string)")
	if ensureStart < 0 || ensureEnd <= ensureStart {
		t.Fatal("ensurePersistentAgent source block not found")
	}
	ensureBlock := string(runtimeSource)[ensureStart:ensureEnd]
	if strings.Contains(ensureBlock, "reconcilePersistentAgentDaemons(ctx, scope, true, trace)") {
		t.Fatal("initialization must not replace the active agent")
	}

	updateSource, err := os.ReadFile("agent_protocol_update.go")
	if err != nil {
		t.Fatalf("ReadFile(agent_protocol_update.go) error = %v", err)
	}
	if !strings.Contains(string(updateSource), "reconcilePersistentAgentDaemons(ctx, scope, true, trace)") {
		t.Fatal("explicit protocol update must replace the active agent")
	}
}

func TestTerminalQueueReadyAdvertisesAgentProtocolUpdate(t *testing.T) {
	payload, err := json.Marshal(terminalQueueServerMessage{
		Type:                          "queue-ready",
		ProtocolVersion:               terminalQueueProtocolVersion,
		AgentProtocolVersion:          "lcmd-webshell-agent-v20",
		PreferredAgentProtocolVersion: agentProtocolVersion,
		AgentProtocolUpdateAvailable:  true,
		AgentProtocolUpdateRequired:   true,
	})
	if err != nil {
		t.Fatalf("Marshal(queue-ready) error = %v", err)
	}
	text := string(payload)
	for _, want := range []string{
		`"agent_protocol_version":"lcmd-webshell-agent-v20"`,
		`"preferred_agent_protocol_version":"lcmd-webshell-agent-v9"`,
		`"agent_protocol_update_available":true`,
		`"agent_protocol_update_required":true`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("queue-ready payload %s missing %s", text, want)
		}
	}
}
