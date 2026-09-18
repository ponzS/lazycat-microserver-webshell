// Package localserver exposes the shared terminal runtime to a managed desktop
// process. It contains no discovery, container commands or public listener.
package localserver

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"lcmd-webshell/core"
)

const CredentialHeader = "X-Lightos-Client-Terminal"
const BoxHeader = "X-Lightos-Terminal-Box"

type Config struct {
	InstanceID string `json:"instance_id"`
	AccountID  string `json:"account_id"`
	BoxID      string `json:"box_id"`
	DeviceID   string `json:"device_id"`
	Epoch      string `json:"epoch"`
	Secret     string `json:"secret"`
	Credential string `json:"credential"`
}

type Server struct {
	config     Config
	local      *core.Local
	http       *http.Server
	listener   net.Listener
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.Mutex
	closed     bool
	sockets    map[*websocket.Conn]struct{}
	scrollback atomic.Int64
}

func Start(parent context.Context, config Config, platform core.Platform) (*Server, error) {
	for _, value := range []string{config.InstanceID, config.AccountID, config.BoxID, config.DeviceID, config.Epoch} {
		if strings.TrimSpace(value) == "" || strings.ContainsAny(value, "\r\n") {
			return nil, errors.New("terminal binding is incomplete")
		}
	}
	if len(config.Secret) < 32 || len(config.Credential) < 32 {
		return nil, errors.New("terminal credentials are required")
	}
	local, err := core.NewLocal(platform, "client:"+config.InstanceID, config.AccountID)
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		local.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	s := &Server{config: config, local: local, listener: listener, ctx: ctx, cancel: cancel, sockets: make(map[*websocket.Conn]struct{})}
	s.scrollback.Store(5000)
	s.http = &http.Server{Handler: s, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second,
		BaseContext: func(net.Listener) context.Context { return ctx }}
	go func() { _ = s.http.Serve(listener); s.Close() }()
	go func() { <-ctx.Done(); s.Close() }()
	return s, nil
}

func (s *Server) Address() string { return "http://" + s.listener.Addr().String() }
func (s *Server) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.cancel()
	for ws := range s.sockets {
		_ = ws.Close()
	}
	s.mu.Unlock()
	_ = s.http.Close()
	s.local.Close()
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet && r.URL.Path == "/__terminal_identity" {
		s.identity(w, r)
		return
	}
	if s.ctx.Err() != nil || !s.authorize(r) {
		http.Error(w, "terminal access denied", http.StatusUnauthorized)
		return
	}
	// The gateway strips its service prefix, with or without the leading slash.
	r.URL.Path = "/" + strings.TrimLeft(r.URL.Path, "/")
	switch r.URL.Path {
	case "/workspace", "/activity":
		s.workspace(w, r)
	case "/ws":
		s.queue(w, r)
	case "/attachments", "/attachments/files", "/attachments/stat", "/attachments/open":
		s.files(w, r)
	default:
		http.NotFound(w, r)
	}
}

func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *Server) workspace(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	req := core.AgentRequest{Cols: core.ParsePositiveInt(q.Get("cols")), Rows: core.ParsePositiveInt(q.Get("rows")), TerminalScrollback: core.ParsePositiveInt(q.Get("terminal_scrollback"))}
	s.setScrollback(req.TerminalScrollback)
	req.TerminalScrollback = int(s.scrollback.Load())
	var value any
	var err error
	switch {
	case r.URL.Path == "/activity" && r.Method == http.MethodGet:
		value, err = s.local.Activity(r.Context(), req)
	case r.URL.Path == "/workspace" && r.Method == http.MethodGet:
		value, err = s.local.State(r.Context(), req)
	case r.URL.Path == "/workspace" && r.Method == http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, core.WorkspaceRecoveryMaxBytes)
		req.Action = &core.WorkspaceActionRequest{}
		err = json.NewDecoder(r.Body).Decode(req.Action)
		if err == nil {
			value, err = s.local.Action(r.Context(), req)
		}
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err != nil {
		reply(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	reply(w, http.StatusOK, value)
}

func (s *Server) setScrollback(value int) {
	if value >= 100 && value <= 100000 {
		s.scrollback.Store(int64(value))
	}
}
