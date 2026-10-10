package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"

	"errors"
	"fmt"
	"golang.org/x/crypto/ssh"
	"golang.org/x/sys/unix"
	"lcmd-webshell/core"
	"lcmd-webshell/execution"
	"lcmd-webshell/localserver"
	"lcmd-webshell/physical"
	"lcmd-webshell/sshserver"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type service struct {
	cancel  context.CancelFunc
	pending map[string]*actorStart
	scopes  map[execution.Scope]string
	ctx     context.Context
	mu      sync.Mutex
	actors  map[string]*actor
}
type actor struct {
	backend    *execution.Backend
	server     *localserver.Server
	validUntil atomic.Int64
	record     physical.AccessRecord
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "version" {
		fmt.Println(core.AgentProtocolVersion)
		return
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	path := physical.ServiceSocket()
	dir := filepath.Dir(path)
	if !filepath.IsAbs(path) {
		return errors.New("physical socket must be absolute")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if err := os.Chmod(dir, 0700); err != nil {
		return err
	}
	lock, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return errors.New("physical service already running")
	}
	os.Remove(path)
	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(path)
	if err = os.Chmod(path, 0600); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	s := &service{ctx: ctx, cancel: cancel, actors: map[string]*actor{}, pending: map[string]*actorStart{}, scopes: map[execution.Scope]string{}}
	server := &http.Server{Handler: s, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second}
	go func() { <-ctx.Done(); server.Close() }()
	err = server.Serve(listener)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.actors {
		a.server.Close()
		a.backend.Close()
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
func (s *service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/health" {
		w.Header().Set("X-Physical-Agent-Protocol", core.AgentProtocolVersion)
		w.WriteHeader(204)
		return
	}
	if r.URL.Path == "/shutdown" && r.Method == "POST" {
		w.WriteHeader(204)
		go s.cancel()
		return
	}
	if r.URL.Path == "/revoke" && r.Method == "POST" {
		var q struct {
			Owner    string `json:"owner"`
			Instance string `json:"instance"`
			Epoch    string `json:"execution_epoch"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&q) != nil || q.Owner == "" || q.Instance == "" || q.Epoch == "" {
			http.Error(w, "invalid execution revocation", 400)
			return
		}
		s.mu.Lock()
		key := q.Owner + "\x00" + q.Instance + "\x00" + q.Epoch
		actor := s.actors[key]
		if actor != nil {
			delete(s.actors, key)
			delete(s.scopes, actor.record.Access.Scope)
		}
		s.mu.Unlock()
		if actor != nil {
			actor.validUntil.Store(0)
			actor.backend.Revoke()
			actor.server.Revoke()
		}
		w.WriteHeader(204)
		return
	}
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/targets/"), "/", 2)
	owner := r.Header.Get(physical.OwnerHeader)
	if !strings.HasPrefix(r.URL.Path, "/targets/") || len(parts) != 2 || parts[0] == "" || owner == "" {
		http.Error(w, "invalid physical scope", 403)
		return
	}
	id := parts[0]
	epoch, epochErr := requestEpoch(r)
	if epochErr != nil {
		http.Error(w, "invalid execution epoch", 403)
		return
	}
	a, err := s.actor(r.Context(), owner, id, epoch)
	if err != nil {
		code := 503
		var denied physical.AccessError
		if errors.As(err, &denied) {
			code = denied.Status
		}
		http.Error(w, err.Error(), code)
		return
	}
	prefix := "s/" + execution.ServiceName + "/"
	if !strings.HasPrefix(parts[1], prefix) {
		http.NotFound(w, r)
		return
	}
	r.URL.Path = "/" + strings.TrimPrefix(parts[1], prefix)
	// Only trusted service IPC can set these headers. Browser admission still
	// verifies the signed account/instance/device/epoch ticket inside the handler.
	r.Header.Set(localserver.CredentialHeader, a.record.Secret)
	r.Header.Set(localserver.BoxHeader, a.record.Access.Scope.BoxID)
	a.server.ServeHTTP(w, r)
}

type actorStart struct {
	done  chan struct{}
	actor *actor
	err   error
}

func (s *service) actor(ctx context.Context, owner, id, epoch string) (*actor, error) {
	key := owner + "\x00" + id + "\x00" + epoch
	s.mu.Lock()
	if actor := s.actors[key]; actor != nil {
		s.mu.Unlock()
		return actor, nil
	}
	if pending := s.pending[key]; pending != nil {
		s.mu.Unlock()
		select {
		case <-pending.done:
			return pending.actor, pending.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	pending := &actorStart{done: make(chan struct{})}
	s.pending[key] = pending
	s.mu.Unlock()
	actor, err := s.startActor(ctx, owner, id, epoch, key)
	s.mu.Lock()
	if err == nil {
		s.actors[key] = actor
	}
	pending.actor, pending.err = actor, err
	delete(s.pending, key)
	close(pending.done)
	s.mu.Unlock()
	if err == nil {
		go s.monitor(actor, owner, id)
	}
	return actor, err
}
func (s *service) startActor(ctx context.Context, owner, id, epoch, key string) (result *actor, initErr error) {
	record, preflightErr := physical.Access(ctx, physical.AccessRequest{Owner: owner, Instance: id, Controller: "bootstrap", Epoch: epoch})
	if preflightErr != nil {
		return nil, preflightErr
	}
	s.mu.Lock()
	scopeKey := record.Access.Scope
	if existing := s.scopes[scopeKey]; existing != "" && existing != key {
		s.mu.Unlock()
		return nil, errors.New("execution scope already belongs to another instance")
	}
	s.scopes[scopeKey] = key
	s.mu.Unlock()
	defer func() {
		if initErr != nil {
			s.mu.Lock()
			if s.scopes[scopeKey] == key {
				delete(s.scopes, scopeKey)
			}
			s.mu.Unlock()
		}
	}()
	source := func(ctx context.Context, controller string) (execution.Access, error) {
		epoch := ""
		if record.Access.Scope.Epoch != "" {
			epoch = record.Access.Scope.Epoch
		}
		next, err := physical.Access(ctx, physical.AccessRequest{Owner: owner, Instance: id, Epoch: epoch, Controller: controller})
		if err != nil {
			return execution.Access{}, err
		}
		record = next
		return next.Access, nil
	}
	scope := record.Access.Scope
	hash := sha256.Sum256([]byte(scope.BoxID + "\x00" + scope.AccountID + "\x00" + scope.DeviceID + "\x00" + scope.Epoch))
	dir := filepath.Join(physical.StateDir(), hex.EncodeToString(hash[:]))
	backend, err := execution.New(context.Background(), dir, source)
	if err != nil {
		return nil, err
	}
	a := &actor{backend: backend, record: record}
	a.validUntil.Store(record.ValidUntil.UnixNano())
	p := platform{Platform: execution.Platform{Backend: backend}, backend: backend}
	config := localserver.Config{InstanceID: id, AccountID: owner, BoxID: scope.BoxID, DeviceID: scope.DeviceID, Epoch: scope.Epoch, Secret: record.Secret, Credential: record.Secret, AdmissionAllowed: func() bool { return time.Now().UnixNano() < a.validUntil.Load() && backend.AdmissionAllowed() }}
	sshService := sshserver.NewManagedService(context.Background(), config, filepath.Join(dir, "ssh"), p)
	server, err := localserver.StartWithServices(context.Background(), config, p, localserver.Services{SSH: sshService, Metrics: p, Files: execution.FileHandler{Backend: backend}, Network: backend, NoListener: true, PreserveOnShutdown: true})
	if err != nil {
		sshService.Close()
		backend.Close()
		return nil, err
	}
	a.server = server
	return a, nil
}
func (s *service) monitor(a *actor, owner, id string) {
	timer := time.NewTicker(15 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-timer.C:
			ctx, cancel := context.WithTimeout(s.ctx, 20*time.Second)
			next, err := physical.Access(ctx, physical.AccessRequest{Owner: owner, Instance: id, Epoch: a.record.Access.Scope.Epoch, Controller: "lease-check", LeaseOnly: true})
			cancel()
			if err == nil {
				a.validUntil.Store(next.ValidUntil.UnixNano())
				continue
			}
			var denied physical.AccessError
			if errors.As(err, &denied) && (denied.Status == 403 || denied.Status == 426) {
				a.validUntil.Store(0)
				a.backend.Revoke()
				a.server.Revoke()
				s.mu.Lock()
				key := owner + "\x00" + id + "\x00" + a.record.Access.Scope.Epoch
				if s.actors[key] == a {
					delete(s.actors, key)
					delete(s.scopes, a.record.Access.Scope)
				}
				s.mu.Unlock()
				return
			}
		}
	}
}

type platform struct {
	execution.Platform
	backend *execution.Backend
}

func (p platform) HostSigner() (ssh.Signer, error) { return newHostSigner(p.backend) }

var _ core.Platform = platform{}

func requestEpoch(r *http.Request) (string, error) {
	token := r.URL.Query().Get("ticket")
	index := 5
	if value := r.Header.Get("X-Lightos-SSH-Ticket"); value != "" {
		token = value
		index = 6
	} else if value := r.Header.Get("X-Lightos-Client-Publish-Ticket"); value != "" {
		token = value
	}
	body, _, ok := strings.Cut(token, ".")
	if !ok {
		return "", errors.New("missing execution ticket")
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return "", err
	}
	fields := strings.Split(string(raw), "\n")
	if len(fields) <= index || fields[index] == "" {
		return "", errors.New("missing execution epoch")
	}
	return fields[index], nil
}
