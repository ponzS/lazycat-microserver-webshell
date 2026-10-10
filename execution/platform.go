package execution

import (
	"context"
	"encoding/json"
	"errors"
	"lcmd-webshell/core"
	"net"
	"os/exec"
)

// Platform supplies only metadata and remote adapters. Native process methods
// fail closed; a physical target must never execute on the service host.
type Platform struct{ Backend *Backend }

func (p Platform) ExecutionBackend() core.ExecutionBackend { return p.Backend }
func (p Platform) TargetFiles() core.TargetFiles           { return &Files{backend: p.Backend} }
func (p Platform) TargetNetwork() core.TargetNetwork       { return p.Backend }
func (p Platform) LoadWorkspace() ([]byte, error)          { return p.Backend.LoadWorkspace() }
func (p Platform) SaveWorkspace(raw []byte) error          { return p.Backend.SaveWorkspace(raw) }
func (p Platform) DefaultWorkingDirectory() string         { return p.Backend.Descriptor().Home }
func (Platform) Command(core.Launch) *exec.Cmd {
	panic("native command execution on service host is forbidden")
}
func (Platform) StartPTY(*exec.Cmd) (core.PTY, error) {
	return nil, errors.New("remote execution backend required")
}
func (Platform) WaitCommand(*exec.Cmd) error { return errors.New("remote execution backend required") }
func (Platform) ResizePTY(core.PTY, int, int, int, int) error {
	return errors.New("remote execution backend required")
}
func (Platform) KillCommand(*exec.Cmd) error { return errors.New("remote execution backend required") }
func (p Platform) ScanActivities(ctx context.Context, sessions []string) (map[string]core.PaneActivity, error) {
	r, err := p.Backend.call(ctx, Request{Op: "activity", Sessions: sessions}, false)
	if err != nil {
		return nil, err
	}
	var values map[string]core.PaneActivity
	err = json.Unmarshal(r.Value, &values)
	return values, err
}
func (Platform) ValidTTY(string) bool            { return false }
func (Platform) ResetAgentSignals() error        { return nil }
func (Platform) RaiseAgentOpenFilesLimit() error { return nil }
func (Platform) DefaultAgentSocketPath() string  { return "" }
func (Platform) ListenAgent(string) (net.Listener, func(), error) {
	return nil, nil, errors.New("remote execution backend required")
}
func (Platform) DialAgent(string) (net.Conn, error) {
	return nil, errors.New("remote execution backend required")
}
func (Platform) ReconcileAgents(string, string, string, bool, bool) (int, error) {
	return 0, errors.New("remote execution backend required")
}
func (p Platform) Snapshot(ctx context.Context) (core.HostMetrics, error) {
	r, err := p.Backend.call(ctx, Request{Op: "metrics"}, false)
	if err != nil {
		return core.HostMetrics{}, err
	}
	var m core.HostMetrics
	err = unmarshalMetrics(r.Value, &m)
	return m, err
}
