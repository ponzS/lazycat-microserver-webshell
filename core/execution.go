package core

import (
	"context"
	"fmt"
	"io"
)

// ExecutionBackend is optional and only installed for native remote targets.
// Existing container platforms continue using their original exec.Cmd path.
type ExecutionBackend interface {
	OpenPTY(context.Context, string, Launch, ShellOptions) (ProcessHandle, error)
	OpenCommand(context.Context, string, string, []string) (CommandHandle, error)
}
type ExecutionBackendProvider interface{ ExecutionBackend() ExecutionBackend }
type ProcessResult struct {
	Code            int
	Signal, Message string
}

func (r ProcessResult) Err() error {
	if r.Code == 0 && r.Signal == "" {
		return nil
	}
	return processResultError{r}
}

type processResultError struct{ result ProcessResult }

func (e processResultError) Error() string {
	return fmt.Sprintf("process exited: code=%d signal=%s %s", e.result.Code, e.result.Signal, e.result.Message)
}
func (e processResultError) ExitCode() int { return e.result.Code }

type ProcessHandle interface {
	PTY
	Resize(ShellSize) error
	Signal(string) error
	Wait() ProcessResult
	Detach() error
	Terminate() error
}
type CommandHandle interface {
	Input() io.WriteCloser
	Output() io.ReadCloser
	Errors() io.ReadCloser
	Wait() ProcessResult
	Signal(string) error
	Terminate() error
}

// OrderedExecutionEvents preserves output/geometry/exit order. Its durable
// adapter distinguishes network detachment from authoritative process exit.
type ExecutionEvent struct {
	Sequence uint64
	Kind     string
	Data     []byte
	Size     ShellSize
	Exit     ProcessResult
}
type OrderedExecutionEvents interface {
	Next(context.Context) (ExecutionEvent, error)
	Commit(uint64, []byte) error
	LoadCheckpoint() ([]byte, error)
	WriteGenerated([]byte, string) error
}

// WorkspaceStore is provided only by the physical actor's private storage.
type WorkspaceStore interface {
	LoadWorkspace() ([]byte, error)
	SaveWorkspace([]byte) error
}

type ExecutionWorkspaceIdentity interface{ InitialWorkspaceGeneration() (string, error) }
