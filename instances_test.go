package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHandleInstancesRetriesTransientDependenciesAndReusesAdminInfo(t *testing.T) {
	adminInfoCalls := 0
	webshellCalls := 0
	clientCalls := 0
	server := &pluginServer{
		instanceRetryDelays: []time.Duration{0},
		adminInfoResolver: func(context.Context) (adminInfo, error) {
			adminInfoCalls++
			return adminInfo{BaseURL: "http://lightos-admin.local"}, nil
		},
		publishHTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			status := http.StatusOK
			body := `[{"name":"alpha","owner_deploy_id":"deploy-a","status":"running"}]`
			switch request.URL.Path {
			case "/api/webshell/instances":
				webshellCalls++
				if webshellCalls == 1 {
					status = http.StatusBadGateway
					body = "webshell route is starting"
				}
			case "/api/client-instances":
				clientCalls++
				body = `[{"id":"client-a","name":"Alice PC","status":"running"}]`
				if clientCalls == 1 {
					status = http.StatusServiceUnavailable
					body = "client route is starting"
				}
			default:
				t.Fatalf("unexpected upstream path %q", request.URL.Path)
			}
			return &http.Response{
				StatusCode: status,
				Status:     http.StatusText(status),
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
				Request:    request,
			}, nil
		})},
	}
	request := httptest.NewRequest(http.MethodGet, "/api/instances", nil)
	request.Header.Set(lightOSUserIDHeader, "login-user-a")
	recorder := httptest.NewRecorder()

	server.handleInstances(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("handleInstances status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var items []instanceSummary
	if err := json.NewDecoder(recorder.Body).Decode(&items); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("instances = %+v, want webshell and client instances", items)
	}
	if adminInfoCalls != 1 {
		t.Fatalf("admin-info calls = %d, want one successful resolution shared by both endpoints", adminInfoCalls)
	}
	if webshellCalls != 2 || clientCalls != 2 {
		t.Fatalf("upstream calls webshell=%d client=%d, want one retry each", webshellCalls, clientCalls)
	}
}

func TestHandleInstancesRetriesAdminInfoStartupFailure(t *testing.T) {
	adminInfoCalls := 0
	server := &pluginServer{
		instanceRetryDelays: []time.Duration{0},
		adminInfoResolver: func(context.Context) (adminInfo, error) {
			adminInfoCalls++
			if adminInfoCalls == 1 {
				return adminInfo{}, errors.New("lightosctl is starting")
			}
			return adminInfo{BaseURL: "http://lightos-admin.local"}, nil
		},
		publishHTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			body := "[]"
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
				Request:    request,
			}, nil
		})},
	}
	request := httptest.NewRequest(http.MethodGet, "/api/instances", nil)
	request.Header.Set(lightOSUserIDHeader, "login-user-a")
	recorder := httptest.NewRecorder()

	server.handleInstances(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("handleInstances status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if adminInfoCalls != 2 {
		t.Fatalf("admin-info calls = %d, want retry after startup failure", adminInfoCalls)
	}
}

func TestHandleInstancesRetriesTransportFailure(t *testing.T) {
	webshellCalls := 0
	server := &pluginServer{
		instanceRetryDelays: []time.Duration{0},
		adminInfoResolver: func(context.Context) (adminInfo, error) {
			return adminInfo{BaseURL: "http://lightos-admin.local"}, nil
		},
		publishHTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.URL.Path == "/api/webshell/instances" {
				webshellCalls++
				if webshellCalls == 1 {
					return nil, errors.New("connection refused")
				}
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader("[]")),
				Request:    request,
			}, nil
		})},
	}
	request := httptest.NewRequest(http.MethodGet, "/api/instances", nil)
	request.Header.Set(lightOSUserIDHeader, "login-user-a")
	recorder := httptest.NewRecorder()

	server.handleInstances(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("handleInstances status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if webshellCalls != 2 {
		t.Fatalf("webshell calls = %d, want transport retry", webshellCalls)
	}
}

func TestHandleInstancesPreservesAuthorizationFailureWithoutRetry(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			webshellCalls := 0
			server := &pluginServer{
				instanceRetryDelays: []time.Duration{0, 0},
				adminInfoResolver: func(context.Context) (adminInfo, error) {
					return adminInfo{BaseURL: "http://lightos-admin.local"}, nil
				},
				publishHTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
					webshellCalls++
					return &http.Response{
						StatusCode: status,
						Status:     http.StatusText(status),
						Header:     make(http.Header),
						Body:       io.NopCloser(strings.NewReader("account cannot access instances")),
						Request:    request,
					}, nil
				})},
			}
			request := httptest.NewRequest(http.MethodGet, "/api/instances", nil)
			request.Header.Set(lightOSUserIDHeader, "login-user-a")
			recorder := httptest.NewRecorder()

			server.handleInstances(recorder, request)

			if recorder.Code != status {
				t.Fatalf("handleInstances status = %d, body = %s, want %d", recorder.Code, recorder.Body.String(), status)
			}
			if webshellCalls != 1 {
				t.Fatalf("webshell calls = %d, want no retry for %d", webshellCalls, status)
			}
			if !strings.Contains(recorder.Body.String(), "webshell-instances upstream") {
				t.Fatalf("response body = %q, want failure stage", recorder.Body.String())
			}
		})
	}
}

func TestHandleInstancesReportsDecodeStageWithoutRetry(t *testing.T) {
	webshellCalls := 0
	server := &pluginServer{
		instanceRetryDelays: []time.Duration{0, 0},
		adminInfoResolver: func(context.Context) (adminInfo, error) {
			return adminInfo{BaseURL: "http://lightos-admin.local"}, nil
		},
		publishHTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			webshellCalls++
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader("not-json")),
				Request:    request,
			}, nil
		})},
	}
	request := httptest.NewRequest(http.MethodGet, "/api/instances", nil)
	request.Header.Set(lightOSUserIDHeader, "login-user-a")
	recorder := httptest.NewRecorder()

	server.handleInstances(recorder, request)

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("handleInstances status = %d, body = %s, want 502", recorder.Code, recorder.Body.String())
	}
	if webshellCalls != 1 {
		t.Fatalf("webshell calls = %d, want decode failure not retried", webshellCalls)
	}
	if !strings.Contains(recorder.Body.String(), "webshell-instances decode") {
		t.Fatalf("response body = %q, want decode stage", recorder.Body.String())
	}
}
