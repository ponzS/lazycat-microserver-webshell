package execution

import (
	"context"
	"errors"
	"lcmd-webshell/core"
)

// Launch policy lives on the service; the target resolves its account shell
// and supplies only locale metadata, never its private environment.
func (b *Backend) prepareShell(ctx context.Context, q Request) (Request, error) {
	if q.Op != "open_pty" && q.Op != "open_command" {
		return q, nil
	}
	r, err := b.call(ctx, Request{Op: "shell_info"}, q.Op == "open_pty" && !q.ConnectionBound)
	if err != nil {
		return q, err
	}
	if r.Shell == nil || r.Shell.Program == "" {
		return q, errors.New("target shell metadata unavailable")
	}
	q.Program = r.Shell.Program
	if q.Environment == nil {
		q.Environment = map[string]string{}
	}
	if q.Term != "" {
		q.Environment["TERM"] = q.Term
	}
	execute := q.Execute || q.Command != "" || q.Op == "open_command"
	targetOS := b.Descriptor().OS
	q.Arguments = core.ShellArguments(q.Program, targetOS, q.Command, execute, q.Op == "open_command")
	if targetOS != "windows" {
		for key, value := range core.ShellLocale(targetOS, func(key string) string { return r.Shell.Environment[key] }) {
			if _, supplied := q.Environment[key]; !supplied {
				q.Environment[key] = value
			}
		}
	}
	return q, nil
}
