// Package sshserver adapts authenticated SSH shell sessions to shared Core PTYs.
// It never opens a listening socket and never installs a system SSH service.
package sshserver

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"lcmd-webshell/core"
)

type Binding struct{ BoxID, AccountID, DeviceID, Epoch string }
type Access struct {
	Binding  Binding
	Revision uint64
}
type Config struct {
	Revision     uint64
	Enabled      bool
	PasswordHash string `json:"-"`
}
type Status struct {
	Enabled            bool
	Revision           uint64
	HostKeyFingerprint string
	Connections        int
}
type connection struct {
	raw    net.Conn
	cancel context.CancelFunc
}

type Server struct {
	lifetime    context.Context
	mu          sync.Mutex
	update      sync.Mutex
	wg          sync.WaitGroup
	binding     Binding
	key         ssh.Signer
	shells      *core.ShellSessions
	config      Config
	closed      bool
	connections map[*connection]struct{}
	authWindow  time.Time
	authChecks  int
}

func New(ctx context.Context, binding Binding, stateDir string, platform core.Platform) (*Server, error) {
	for _, v := range []string{binding.BoxID, binding.AccountID, binding.DeviceID, binding.Epoch} {
		if strings.TrimSpace(v) == "" || strings.ContainsAny(v, "\r\n\x00") {
			return nil, errors.New("SSH binding is incomplete")
		}
	}
	if ctx.Err() != nil || platform == nil {
		return nil, errors.New("SSH runtime is unavailable")
	}
	key, err := loadHostKey(stateDir)
	if err != nil {
		return nil, err
	}
	s := &Server{lifetime: ctx, binding: binding, key: key, shells: core.NewShellSessions(ctx, platform), connections: make(map[*connection]struct{})}
	context.AfterFunc(ctx, func() { _ = s.Close() })
	return s, nil
}

func (s *Server) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Status{Enabled: s.config.Enabled && !s.closed && s.lifetime.Err() == nil, Revision: s.config.Revision, HostKeyFingerprint: ssh.FingerprintSHA256(s.key.PublicKey()), Connections: len(s.connections)}
}

// Apply is called only by an authenticated, purpose-scoped management adapter.
// A newer version first revokes every old SSH connection, but no browser pane.
func (s *Server) Apply(next Config) error {
	if next.Revision == 0 {
		return errors.New("SSH config revision is required")
	}
	if next.Enabled {
		if err := validatePasswordHash(next.PasswordHash); err != nil {
			return err
		}
	}
	s.update.Lock()
	defer s.update.Unlock()
	s.mu.Lock()
	if s.closed || s.lifetime.Err() != nil {
		s.mu.Unlock()
		return errors.New("SSH server closed")
	}
	if next.Revision < s.config.Revision {
		s.mu.Unlock()
		return errors.New("stale SSH config")
	}
	if next.Revision == s.config.Revision {
		same := next == s.config
		s.mu.Unlock()
		if same {
			return nil
		}
		return errors.New("conflicting SSH config revision")
	}
	s.config = next
	s.config.Enabled = false
	items := s.connectionListLocked()
	s.mu.Unlock()
	if err := s.closeConnections(items); err != nil {
		return err
	}
	s.mu.Lock()
	if s.lifetime.Err() != nil {
		s.mu.Unlock()
		return errors.New("SSH authorization expired")
	}
	s.config = next
	s.mu.Unlock()
	return nil
}

func (s *Server) connectionListLocked() []*connection {
	items := make([]*connection, 0, len(s.connections))
	for c := range s.connections {
		items = append(items, c)
	}
	return items
}
func (s *Server) closeConnections(items []*connection) error {
	for _, c := range items {
		c.cancel()
		_ = c.raw.Close()
	}
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	select {
	case <-done:
		return s.shells.CleanupError()
	case <-timer.C:
		return errors.New("SSH cleanup incomplete; access remains disabled")
	}
}
func (s *Server) Close() error {
	s.update.Lock()
	defer s.update.Unlock()
	s.mu.Lock()
	s.closed = true
	s.config.Enabled = false
	items := s.connectionListLocked()
	s.mu.Unlock()
	err := s.closeConnections(items)
	s.shells.Close()
	return err
}
func (s *Server) currentLocked(access Access) bool {
	return !s.closed && s.lifetime.Err() == nil && s.config.Enabled && access.Binding == s.binding && access.Revision == s.config.Revision
}
