package sshserver

import (
	"encoding/json"
	"errors"
	"lcmd-webshell/core"
	"os"
	"path/filepath"
	"time"
)

type retainedReplay struct {
	History []byte
	Base    uint64
}
type retainedRecord struct {
	ID       string
	Revision uint64
	Options  core.ShellOptions
}
type retainedState struct {
	Binding  Binding
	Revision uint64
	Enabled  bool
	Verifier string
	Sessions []retainedRecord
}

func (s *Server) saveRetainedIndexLocked() error {
	if s.stateDir == "" {
		return nil
	}
	state := retainedState{Binding: s.binding, Revision: s.config.Revision, Enabled: s.config.Enabled, Verifier: s.config.PasswordHash}
	for _, r := range s.retained {
		state.Sessions = append(state.Sessions, retainedRecord{r.id, r.revision, r.options})
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return writePrivateState(filepath.Join(s.stateDir, "retained.json"), raw)
}
func writePrivateState(path string, raw []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".ssh-state-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	f.Chmod(0600)
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
func (s *Server) restoreRetained() error {
	raw, err := os.ReadFile(filepath.Join(s.stateDir, "retained.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var state retainedState
	if json.Unmarshal(raw, &state) != nil || state.Binding != s.binding {
		return errors.New("invalid SSH recovery scope")
	}
	if state.Enabled {
		if err = validatePasswordHash(state.Verifier); err != nil {
			return err
		}
	}
	s.config = Config{Revision: state.Revision, Enabled: state.Enabled, PasswordHash: state.Verifier}
	for _, saved := range state.Sessions {
		terminal, err := s.shells.OpenWithOptions(s.workCtx, saved.Options)
		if err != nil {
			return err
		}
		replayRaw, err := terminal.LoadExecutionReplay()
		if err != nil {
			return err
		}
		var replay retainedReplay
		if len(replayRaw) > 0 && json.Unmarshal(replayRaw, &replay) != nil {
			return errors.New("invalid SSH replay checkpoint")
		}
		r := &retainedShell{id: saved.ID, revision: saved.Revision, options: saved.Options, owner: s, terminal: terminal, changed: make(chan struct{}), history: replay.History, base: replay.Base}
		s.retained[r.id] = r
		go r.readOutput()
	}
	return nil
}

// Detach preserves native interactive shells while closing service transports.
// Explicit SSH disable, password/port changes and scope revocation still Close.
func (s *Server) Detach() error {
	s.update.Lock()
	defer s.update.Unlock()
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	if err := s.saveRetainedIndexLocked(); err != nil {
		s.mu.Unlock()
		return err
	}
	s.detached = true
	s.closed = true
	for _, r := range s.retained {
		r.mu.Lock()
		r.detaching = true
		r.mu.Unlock()
	}
	items := s.connectionListLocked()
	s.mu.Unlock()
	s.shells.Detach()
	s.workCancel()
	for _, c := range items {
		c.cancel()
		c.raw.Close()
	}
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-time.After(10 * time.Second):
		return errors.New("SSH detach incomplete")
	}
}
