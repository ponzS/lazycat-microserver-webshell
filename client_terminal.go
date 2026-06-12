package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	lzcsdk "gitee.com/linakesi/lzc-sdk/lang/go"
	"github.com/gorilla/websocket"
)

type clientTerminalTicketRequest struct {
	ID string `json:"id"`
}

type clientTerminalTicket struct {
	ClientInstanceID    string `json:"client_instance_id"`
	DeviceAPIURL        string `json:"device_api_url"`
	TerminalServiceName string `json:"terminal_service_name"`
	Ticket              string `json:"ticket"`
	ExpiresAt           string `json:"expires_at"`
}

var newClientTerminalHTTPClient = func() *http.Client {
	return &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}, Timeout: 30 * time.Second}
}

var resolveClientDeviceAPIAuthToken = clientDeviceAPIAuthToken

func (s *pluginServer) handleClientWorkspace(w http.ResponseWriter, r *http.Request, accountID, selector string, cols, rows int) {
	if err := s.authorizeClientTarget(r.Context(), r.Header, accountID, selector); err != nil {
		writeAuthorizationError(w, err)
		return
	}
	switch r.Method {
	case http.MethodGet:
		state, err := s.clientWorkspaceState(r.Context(), r.Header, selector, cols, rows)
		if err != nil {
			writeAuthorizationError(w, err)
			return
		}
		state.ServerRevision = s.serverRevision
		writeJSON(w, state)
	case http.MethodPost:
		var request workspaceActionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		state, err := s.clientWorkspaceAction(r.Context(), r.Header, selector, cols, rows, request)
		if err != nil {
			writeAuthorizationError(w, err)
			return
		}
		state.ServerRevision = s.serverRevision
		writeJSON(w, state)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *pluginServer) handleClientWorkspaceActivity(w http.ResponseWriter, r *http.Request, accountID, selector string, cols, rows int) {
	if err := s.authorizeClientTarget(r.Context(), r.Header, accountID, selector); err != nil {
		writeAuthorizationError(w, err)
		return
	}
	state, err := s.clientWorkspaceActivity(r.Context(), r.Header, selector, cols, rows)
	if err != nil {
		writeAuthorizationError(w, err)
		return
	}
	state.ServerRevision = s.serverRevision
	writeJSON(w, state)
}

func (s *pluginServer) attachClientPane(w http.ResponseWriter, r *http.Request, accountID, selector, paneID string, cols, rows int) error {
	if err := s.authorizeClientTarget(r.Context(), r.Header, accountID, selector); err != nil {
		writeAuthorizationError(w, err)
		return nil
	}
	ticket, authToken, err := s.clientTerminalDialInfo(r.Context(), r.Header, selector)
	if err != nil {
		writeAuthorizationError(w, err)
		return nil
	}
	targetURL, err := clientTerminalURL(ticket, "/ws")
	if err != nil {
		writeAuthorizationError(w, err)
		return nil
	}
	query := targetURL.Query()
	query.Set("pane", paneID)
	if cols > 0 {
		query.Set("cols", fmt.Sprintf("%d", cols))
	}
	if rows > 0 {
		query.Set("rows", fmt.Sprintf("%d", rows))
	}
	query.Set("ticket", ticket.Ticket)
	targetURL.RawQuery = query.Encode()

	source, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return err
	}
	defer source.Close()

	headers := http.Header{}
	headers.Set("lzc_dapi_auth_token", authToken)
	dialer := websocket.Dialer{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	target, _, err := dialer.DialContext(r.Context(), websocketHTTPToWS(targetURL.String()), headers)
	if err != nil {
		_ = writeWebSocketJSON(source, map[string]any{"type": "process-exit", "exit_code": -1, "message": err.Error()})
		return nil
	}
	defer target.Close()

	errCh := make(chan error, 2)
	go proxyWebSocketMessages(source, target, errCh)
	go proxyWebSocketMessages(target, source, errCh)
	<-errCh
	return nil
}

func (s *pluginServer) clientWorkspaceState(ctx context.Context, header http.Header, selector string, cols, rows int) (workspaceState, error) {
	var state workspaceState
	err := s.clientTerminalJSON(ctx, header, selector, http.MethodGet, "/workspace", map[string]string{"cols": fmt.Sprintf("%d", cols), "rows": fmt.Sprintf("%d", rows)}, nil, &state)
	return state, err
}

func (s *pluginServer) clientWorkspaceActivity(ctx context.Context, header http.Header, selector string, cols, rows int) (workspaceActivityState, error) {
	var state workspaceActivityState
	err := s.clientTerminalJSON(ctx, header, selector, http.MethodGet, "/activity", map[string]string{"cols": fmt.Sprintf("%d", cols), "rows": fmt.Sprintf("%d", rows)}, nil, &state)
	return state, err
}

func (s *pluginServer) clientWorkspaceAction(ctx context.Context, header http.Header, selector string, cols, rows int, request workspaceActionRequest) (workspaceState, error) {
	var state workspaceState
	err := s.clientTerminalJSON(ctx, header, selector, http.MethodPost, "/workspace", map[string]string{"cols": fmt.Sprintf("%d", cols), "rows": fmt.Sprintf("%d", rows)}, request, &state)
	return state, err
}

func (s *pluginServer) clientTerminalJSON(ctx context.Context, header http.Header, selector, method, path string, query map[string]string, body any, out any) error {
	ticket, authToken, err := s.clientTerminalDialInfo(ctx, header, selector)
	if err != nil {
		return err
	}
	targetURL, err := clientTerminalURL(ticket, path)
	if err != nil {
		return err
	}
	values := targetURL.Query()
	for key, value := range query {
		if value != "" && value != "0" {
			values.Set(key, value)
		}
	}
	values.Set("ticket", ticket.Ticket)
	targetURL.RawQuery = values.Encode()

	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, targetURL.String(), reader)
	if err != nil {
		return err
	}
	req.Header.Set("lzc_dapi_auth_token", authToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := newClientTerminalHTTPClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("client terminal returned %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 10<<20)).Decode(out)
}

func (s *pluginServer) clientTerminalDialInfo(ctx context.Context, header http.Header, selector string) (clientTerminalTicket, string, error) {
	clientID, err := parseClientTargetID(selector)
	if err != nil {
		return clientTerminalTicket{}, "", err
	}
	info, err := s.resolveLightOSAdminInfo(ctx)
	if err != nil {
		return clientTerminalTicket{}, "", err
	}
	data, err := json.Marshal(clientTerminalTicketRequest{ID: clientID})
	if err != nil {
		return clientTerminalTicket{}, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(info.BaseURL, "/")+"/api/client-instances/terminal-ticket", bytes.NewReader(data))
	if err != nil {
		return clientTerminalTicket{}, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	copyClientTerminalAuthHeaders(req.Header, header)
	resp, err := s.publishHTTPClientOrDefault().Do(req)
	if err != nil {
		return clientTerminalTicket{}, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return clientTerminalTicket{}, "", fmt.Errorf("client terminal ticket failed: %d %s", resp.StatusCode, strings.TrimSpace(string(payload)))
	}
	var ticket clientTerminalTicket
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&ticket); err != nil {
		return clientTerminalTicket{}, "", err
	}
	authToken, err := resolveClientDeviceAPIAuthToken(ctx, ticket.DeviceAPIURL)
	if err != nil {
		return clientTerminalTicket{}, "", err
	}
	return ticket, authToken, nil
}

func (s *pluginServer) publishHTTPClientOrDefault() *http.Client {
	if s != nil && s.publishHTTPClient != nil {
		return s.publishHTTPClient
	}
	return http.DefaultClient
}

func copyClientTerminalAuthHeaders(dst, src http.Header) {
	for _, key := range []string{"Cookie", "Lzc-Auth-Token", "Lzc-Api-Auth-Token", "X-HC-User-ID", "X-HC-User-Role", "X-HC-Device-ID", "X-HC-Login-Time"} {
		for _, value := range src.Values(key) {
			dst.Add(key, value)
		}
	}
}

func clientDeviceAPIAuthToken(ctx context.Context, deviceAPIURL string) (string, error) {
	gateway, err := lzcsdk.NewAPIGateway(ctx)
	if err != nil {
		return "", err
	}
	defer gateway.Close()
	device, err := gateway.NewDeviceProxy(deviceAPIURL)
	if err != nil {
		return "", err
	}
	defer device.Close()
	token, err := device.GetAuthToken(ctx)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(token.Token), nil
}

func clientTerminalURL(ticket clientTerminalTicket, path string) (*url.URL, error) {
	base, err := url.Parse(strings.TrimRight(ticket.DeviceAPIURL, "/"))
	if err != nil {
		return nil, err
	}
	if base.Scheme == "" || base.Host == "" || ticket.TerminalServiceName == "" {
		return nil, errors.New("invalid client terminal dial info")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/s/" + strings.Trim(ticket.TerminalServiceName, "/") + path
	return base, nil
}

func websocketHTTPToWS(value string) string {
	if strings.HasPrefix(value, "https://") {
		return "wss://" + strings.TrimPrefix(value, "https://")
	}
	if strings.HasPrefix(value, "http://") {
		return "ws://" + strings.TrimPrefix(value, "http://")
	}
	return value
}

func proxyWebSocketMessages(src, dst *websocket.Conn, errCh chan<- error) {
	for {
		messageType, data, err := src.ReadMessage()
		if err != nil {
			errCh <- err
			return
		}
		if err := dst.WriteMessage(messageType, data); err != nil {
			errCh <- err
			return
		}
	}
}
