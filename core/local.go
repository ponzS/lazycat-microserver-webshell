package core

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"sync"
)

// Local owns exactly one account-bound workspace. It never launches an agent
// subprocess: viewers use the same framed attach and queue algorithms in-process.
type Local struct {
	mu            sync.RWMutex
	persistenceMu sync.Mutex
	store         WorkspaceStore
	closed        bool
	daemon        *agentDaemon
	ctx           context.Context
	cancel        context.CancelFunc
	scope         AgentScope
}

func NewLocal(platform Platform, selector, account string) (*Local, error) {
	if selector == "" || account == "" {
		return nil, errors.New("local scope is required")
	}
	ctx, cancel := context.WithCancel(context.Background())
	original := platform
	platform = &localPlatform{Platform: platform, ctx: ctx}
	rt := NewRuntime(platform, nil)
	if p, ok := original.(ExecutionBackendProvider); ok {
		rt.execution = p.ExecutionBackend()
	}
	local := &Local{ctx: ctx, cancel: cancel, scope: NormalizeAgentScope(selector, account), daemon: &agentDaemon{
		runtime: rt, selector: selector, accountID: account,
	}}
	if store, ok := original.(WorkspaceStore); ok {
		local.store = store
		if err := local.restoreWorkspace(); err != nil {
			cancel()
			return nil, err
		}
	}
	return local, nil
}

func (l *Local) request(request AgentRequest) AgentRequest {
	request.Selector = l.scope.Selector
	request.AccountID = l.scope.AccountID
	request.Username = "" // A remote caller cannot select a local OS user.
	return request
}

func (l *Local) State(ctx context.Context, request AgentRequest) (WorkspaceState, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.closed {
		return WorkspaceState{}, errors.New("terminal access disabled")
	}
	l.persistenceMu.Lock()
	defer l.persistenceMu.Unlock()
	state, err := l.daemon.WorkspaceState(ctx, l.request(request))
	if err == nil && l.store != nil {
		err = l.persistWorkspace(state, nil)
	}
	state.AgentCapabilities = []string{"tab_reorder_anchor", "workspace_restart_restore", "unified_terminal"}
	return state, err
}

func (l *Local) Action(ctx context.Context, request AgentRequest) (WorkspaceState, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.closed {
		return WorkspaceState{}, errors.New("terminal access disabled")
	}
	l.persistenceMu.Lock()
	defer l.persistenceMu.Unlock()
	if l.store != nil {
		state, err := l.daemon.WorkspaceState(ctx, l.request(request))
		if err != nil {
			return WorkspaceState{}, err
		}
		if err = l.persistWorkspace(state, &request); err != nil {
			return WorkspaceState{}, err
		}
	}
	state, err := l.daemon.applyWorkspaceAction(ctx, l.request(request))
	if err == nil && l.store != nil {
		err = l.persistWorkspace(state, nil)
	}
	state.AgentCapabilities = []string{"tab_reorder_anchor", "workspace_restart_restore", "unified_terminal"}
	return state, err
}

func (l *Local) Activity(ctx context.Context, request AgentRequest) (*WorkspaceActivityState, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.closed {
		return nil, errors.New("terminal access disabled")
	}
	return l.daemon.workspaceActivity(ctx, l.request(request))
}

func (l *Local) Close() {
	l.cancel()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	l.closed = true
	l.daemon.mu.Lock()
	defer l.daemon.mu.Unlock()
	l.daemon.closed = true
	if l.daemon.workspace != nil {
		l.daemon.workspace.closeAllPanes()
	}
}

func (l *Local) Open(ctx context.Context, scope AgentScope, pane string, cols, rows, scrollback int, syncRequest HistorySyncRequest, _ io.Writer) (QueueConnection, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.closed || scope.Selector != l.scope.Selector || scope.AccountID != l.scope.AccountID {
		return QueueConnection{}, errors.New("terminal scope is no longer active")
	}
	client, server := net.Pipe()
	input := newLocalAttachInput(client)
	done := make(chan struct{})
	stopContext := context.AfterFunc(ctx, func() { _ = input.Close(); _ = server.Close() })
	stopLocal := context.AfterFunc(l.ctx, func() { _ = input.Close(); _ = server.Close() })
	go func() {
		defer close(done)
		defer stopContext()
		defer stopLocal()
		l.daemon.handleConn(server)
	}()
	request := l.request(AgentRequest{Type: "attach", PaneID: pane, Cols: cols, Rows: rows,
		TerminalScrollback: scrollback, WorkspaceGeneration: syncRequest.WorkspaceGeneration,
		CheckpointProtocol: syncRequest.CheckpointProtocol})
	if err := json.NewEncoder(input).Encode(request); err != nil {
		_ = input.Close()
		_ = server.Close()
		return QueueConnection{}, err
	}
	return QueueConnection{Input: input, Output: client, Wait: func() error { <-done; return nil }, Kill: input.Close}, nil
}

type discardQueueLog struct{}

func (discardQueueLog) Write(b []byte) (int, error) { return len(b), nil }
func (discardQueueLog) Flush()                      {}
func (l *Local) Log(string) QueueLog                { return discardQueueLog{} }

var _ QueueBackend = (*Local)(nil)

type storedExecutionWorkspace struct {
	Document   WorkspaceRecoveryDocument
	Pending    *AgentRequest
	Scrollback int
}

func (l *Local) persistWorkspace(state WorkspaceState, pending *AgentRequest) error {
	saved := storedExecutionWorkspace{Document: WorkspaceRecoveryDocumentFromState("execution", state), Pending: pending, Scrollback: 5000}
	if w := l.daemon.workspace; w != nil {
		saved.Scrollback = w.historyLimitBytes / averageHistoryBytesPerLine
	}
	raw, err := json.Marshal(saved)
	if err != nil {
		return err
	}
	return l.store.SaveWorkspace(raw)
}
func (l *Local) restoreWorkspace() error {
	raw, err := l.store.LoadWorkspace()
	if err != nil {
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	var saved storedExecutionWorkspace
	if err = json.Unmarshal(raw, &saved); err != nil {
		return errors.New("invalid private workspace recovery")
	}
	workspace, err := newRecoveredTerminalWorkspace(l.daemon.runtime, saved.Document, l.scope.Selector, "", historyLimitBytesForTerminalScrollback(saved.Scrollback), 120, 32)
	if err != nil {
		return err
	}
	l.daemon.workspace = workspace
	if saved.Pending != nil {
		state, err := l.daemon.applyWorkspaceAction(l.ctx, l.request(*saved.Pending))
		if err != nil {
			return err
		}
		return l.persistWorkspace(state, nil)
	}
	return nil
}

// Detach is service shutdown, distinct from explicit scope revocation.
func (l *Local) Detach() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	l.closed = true
	l.daemon.mu.Lock()
	defer l.daemon.mu.Unlock()
	l.daemon.closed = true
	if w := l.daemon.workspace; w != nil {
		w.detachExecutionPanes()
	}
	l.cancel()
}
