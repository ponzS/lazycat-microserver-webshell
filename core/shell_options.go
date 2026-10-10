package core

import (
	"context"
	"errors"
	"strings"
)

type ShellOptions struct {
	ExecutionKey string
	Term         string
	Size         ShellSize
	Command      string
	Execute      bool
	Env          []string
	Modes        map[uint8]uint32
}

func ShellEnvironment(base, extra []string) []string {
	result := append([]string(nil), base...)
	for _, item := range extra {
		key, _, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		filtered := result[:0]
		for _, old := range result {
			k, _, _ := strings.Cut(old, "=")
			if !strings.EqualFold(k, key) {
				filtered = append(filtered, old)
			}
		}
		result = append(filtered, item)
	}
	return result
}

func (s *ShellSessions) OpenWithOptions(ctx context.Context, options ShellOptions) (*ShellSession, error) {
	return s.open(ctx, options)
}

func (s *ShellSession) ExitSignal() string {
	<-s.done
	if s.execution != nil {
		return s.result.Signal
	}
	if p, ok := s.owner.platform.(SSHPlatform); ok {
		return p.ExitSSHSignal(s.cmd)
	}
	return ""
}

func (s *ShellSession) Signal(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("terminal session closed")
	}
	if s.execution != nil {
		return s.execution.Signal(name)
	}
	p, ok := s.owner.platform.(SSHPlatform)
	if !ok {
		return errors.New("terminal signals unavailable")
	}
	return p.SignalSSHCommand(s.cmd, s.stream, name)
}

func (s *ShellSession) LoadExecutionReplay() ([]byte, error) {
	if p, ok := s.execution.(interface{ LoadReplay() ([]byte, error) }); ok {
		return p.LoadReplay()
	}
	return nil, nil
}
func (s *ShellSession) SaveExecutionReplay(raw []byte) error {
	if p, ok := s.execution.(interface{ SaveReplay([]byte) error }); ok {
		return p.SaveReplay(raw)
	}
	return nil
}
func (s *ShellSession) Detach() {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		if s.stop != nil {
			s.stop()
		}
		s.mu.Unlock()
		if s.execution != nil {
			s.execution.Detach()
		} else {
			s.stream.Close()
			s.owner.platform.KillCommand(s.cmd)
		}
	})
}
