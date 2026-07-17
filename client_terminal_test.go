package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestReadWebSocketDialFailureClassifiesBadGateway(t *testing.T) {
	response := &http.Response{
		StatusCode: http.StatusBadGateway,
		Header:     http.Header{"Content-Type": []string{"text/plain"}},
		Body:       io.NopCloser(strings.NewReader("upstream unavailable")),
	}

	failure := readWebSocketDialFailure(errors.New("websocket: bad handshake"), response)

	if failure.code != "client_terminal_service_unavailable" {
		t.Fatalf("code = %q, want client_terminal_service_unavailable", failure.code)
	}
	if !strings.Contains(failure.userMessage, "target_status=502") || !strings.Contains(failure.userMessage, "upstream unavailable") {
		t.Fatalf("unexpected user message: %q", failure.userMessage)
	}
	if !strings.Contains(failure.message, "target_status=502") || !strings.Contains(failure.message, "target_body=upstream unavailable") {
		t.Fatalf("unexpected technical message: %q", failure.message)
	}
}

func TestReadWebSocketDialFailureMapsForbidden(t *testing.T) {
	response := &http.Response{
		StatusCode: http.StatusForbidden,
		Header:     http.Header{"Content-Type": []string{"text/plain"}},
		Body:       io.NopCloser(strings.NewReader("forbidden")),
	}

	failure := readWebSocketDialFailure(errors.New("websocket: bad handshake"), response)

	if failure.code != "client_terminal_forbidden" {
		t.Fatalf("code = %q, want client_terminal_forbidden", failure.code)
	}
	if failure.userMessage != errInstanceForbidden.Error() {
		t.Fatalf("userMessage = %q, want account access error", failure.userMessage)
	}
}

func TestWriteClientTerminalErrorPreservesNonAuthStatusFailure(t *testing.T) {
	recorder := httptest.NewRecorder()

	writeClientTerminalError(recorder, clientTerminalStatusError{label: "client terminal", status: http.StatusBadGateway, body: "agent unavailable"})

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "client terminal returned 502") || !strings.Contains(body, "agent unavailable") {
		t.Fatalf("body = %q, want terminal status details", body)
	}
	if strings.Contains(body, "instance is not accessible by current account") {
		t.Fatalf("body = %q, should not be mapped to account access error", body)
	}
}

func TestWriteClientTerminalErrorMapsAuthStatusFailure(t *testing.T) {
	recorder := httptest.NewRecorder()

	writeClientTerminalError(recorder, clientTerminalStatusError{label: "client terminal ticket", status: http.StatusForbidden, body: "forbidden"})

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "instance is not accessible by current account") {
		t.Fatalf("body = %q, want account access error", recorder.Body.String())
	}
}

func TestClientTerminalWorkspaceRequestsForwardScrollback(t *testing.T) {
	oldHTTPClient := newClientTerminalHTTPClient
	oldAuthToken := resolveClientDeviceAPIAuthToken
	t.Cleanup(func() {
		newClientTerminalHTTPClient = oldHTTPClient
		resolveClientDeviceAPIAuthToken = oldAuthToken
	})
	resolveClientDeviceAPIAuthToken = func(context.Context, string) (string, error) {
		return "device-auth-token", nil
	}

	type observedRequest struct {
		method string
		path   string
		query  url.Values
	}
	var observed []observedRequest
	newClientTerminalHTTPClient = func() *http.Client {
		return &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			observed = append(observed, observedRequest{
				method: request.Method,
				path:   request.URL.Path,
				query:  request.URL.Query(),
			})
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(`{}`)),
				Request:    request,
			}, nil
		})}
	}
	server := &pluginServer{
		adminInfoResolver: func(context.Context) (adminInfo, error) {
			return adminInfo{BaseURL: "http://lightos-admin.local"}, nil
		},
		publishHTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(`{"client_instance_id":"client-a","device_api_url":"https://device.example.com","terminal_service_name":"cloud.lazycat.lightos.client-terminal.client-a","ticket":"ticket"}`)),
				Request:    request,
			}, nil
		})},
	}

	if _, err := server.clientWorkspaceState(context.Background(), nil, "client:client-a", 120, 32, 22000); err != nil {
		t.Fatalf("clientWorkspaceState() error = %v", err)
	}
	if _, err := server.clientWorkspaceAction(context.Background(), nil, "client:client-a", 120, 32, 22000, workspaceActionRequest{Action: "new_tab"}); err != nil {
		t.Fatalf("clientWorkspaceAction() error = %v", err)
	}
	if _, err := server.clientWorkspaceActivity(context.Background(), nil, "client:client-a", 120, 32, 22000); err != nil {
		t.Fatalf("clientWorkspaceActivity() error = %v", err)
	}

	want := []observedRequest{
		{method: http.MethodGet, path: "/s/cloud.lazycat.lightos.client-terminal.client-a/workspace"},
		{method: http.MethodPost, path: "/s/cloud.lazycat.lightos.client-terminal.client-a/workspace"},
		{method: http.MethodGet, path: "/s/cloud.lazycat.lightos.client-terminal.client-a/activity"},
	}
	if len(observed) != len(want) {
		t.Fatalf("observed requests = %+v, want %d", observed, len(want))
	}
	for index, request := range observed {
		if request.method != want[index].method || request.path != want[index].path {
			t.Fatalf("request[%d] = %s %s, want %s %s", index, request.method, request.path, want[index].method, want[index].path)
		}
		for key, value := range map[string]string{
			"cols":                "120",
			"rows":                "32",
			"terminal_scrollback": "22000",
			"ticket":              "ticket",
		} {
			if got := request.query.Get(key); got != value {
				t.Fatalf("request[%d] query %s = %q, want %q; query=%v", index, key, got, value, request.query)
			}
		}
	}
}

func TestClientTerminalAttachURLForwardsScrollbackAndHistoryRange(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/ws?fg=%23ffffff&bg=%23000000&cursor=%23ff5000&history_generation=generation-one&local_base_cursor=4&local_end_cursor=9&history_replay_mode=snapshot", nil)
	ticket := clientTerminalTicket{
		DeviceAPIURL:        "https://device.example.com/root/",
		TerminalServiceName: "cloud.lazycat.lightos.client-terminal.client-a",
		Ticket:              "ticket",
	}

	target, err := clientTerminalAttachURL(ticket, request, "pane-1", 120, 32, 22000)
	if err != nil {
		t.Fatalf("clientTerminalAttachURL() error = %v", err)
	}
	if got, want := target.Path, "/root/s/cloud.lazycat.lightos.client-terminal.client-a/ws"; got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}
	for key, value := range map[string]string{
		"pane":                "pane-1",
		"cols":                "120",
		"rows":                "32",
		"terminal_scrollback": "22000",
		"ticket":              "ticket",
		"fg":                  "#ffffff",
		"bg":                  "#000000",
		"cursor":              "#ff5000",
		"history_generation":  "generation-one",
		"local_base_cursor":   "4",
		"local_end_cursor":    "9",
		"history_replay_mode": "snapshot",
	} {
		if got := target.Query().Get(key); got != value {
			t.Fatalf("query %s = %q, want %q; query=%v", key, got, value, target.Query())
		}
	}
}
