package sshserver

import (
	"context"
	"io"
	"net"
	"time"

	"golang.org/x/crypto/ssh"
	"lcmd-webshell/core"
)

type ptyRequest struct {
	Term                                string
	Cols, Rows, PixelWidth, PixelHeight uint32
	Modes                               string
}
type windowRequest struct{ Cols, Rows, PixelWidth, PixelHeight uint32 }

func shellSize(cols, rows, width, height uint32) core.ShellSize {
	return core.ShellSize{Cols: int(cols), Rows: int(rows), PixelWidth: int(width), PixelHeight: int(height)}
}
func validModes(modes string) bool {
	if len(modes) > 1024 {
		return false
	}
	for len(modes) > 0 {
		if modes[0] == 0 {
			return len(modes) == 1
		}
		if len(modes) < 5 {
			return false
		}
		modes = modes[5:]
	}
	return false
}

func (s *Server) handleSession(ctx context.Context, raw net.Conn, channel ssh.Channel, requests <-chan *ssh.Request, access Access) {
	defer channel.Close()
	var pty *core.ShellSession
	defer func() {
		if pty != nil {
			_ = pty.Close()
		}
	}()
	var requested ptyRequest
	hasPTY := false
	var exited <-chan struct{}
	var outputDone <-chan struct{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-exited:
			// Drain bounded final output before sending the exit status.
			timer := time.NewTimer(time.Second)
			select {
			case <-outputDone:
			case <-timer.C:
			case <-ctx.Done():
			}
			timer.Stop()
			_, _ = channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{pty.ExitCode()}))
			return
		case request, ok := <-requests:
			if !ok {
				return
			}
			accepted := false
			switch request.Type {
			case "pty-req":
				if !hasPTY && pty == nil && len(request.Payload) <= 2048 && ssh.Unmarshal(request.Payload, &requested) == nil && validModes(requested.Modes) {
					if requested.Cols == 0 {
						requested.Cols = 120
					}
					if requested.Rows == 0 {
						requested.Rows = 32
					}
					accepted = shellSize(requested.Cols, requested.Rows, requested.PixelWidth, requested.PixelHeight).Validate() == nil && len(requested.Term) > 0 && len(requested.Term) <= 64
					hasPTY = accepted
				}
			case "window-change":
				var change windowRequest
				if hasPTY && ssh.Unmarshal(request.Payload, &change) == nil {
					size := shellSize(change.Cols, change.Rows, change.PixelWidth, change.PixelHeight)
					accepted = size.Validate() == nil
					if accepted && pty != nil {
						accepted = pty.Resize(size) == nil
					}
					if accepted {
						requested.Cols, requested.Rows, requested.PixelWidth, requested.PixelHeight = change.Cols, change.Rows, change.PixelWidth, change.PixelHeight
					}
				}
			case "shell":
				if hasPTY && pty == nil && len(request.Payload) == 0 {
					s.mu.Lock()
					valid := s.currentLocked(access)
					s.mu.Unlock()
					if valid {
						var err error
						pty, err = s.shells.Open(ctx, requested.Term, shellSize(requested.Cols, requested.Rows, requested.PixelWidth, requested.PixelHeight))
						if err == nil {
							_ = raw.SetDeadline(time.Time{})
							accepted = true
							exited = pty.Done()
							done := make(chan struct{})
							outputDone = done
							go func(p *core.ShellSession) { defer close(done); _, _ = io.Copy(channel, p) }(pty)
							go func(p *core.ShellSession) { _, _ = io.Copy(p, channel); _ = p.Close() }(pty)
						}
					}
				}
				// exec, subsystem, env, signals and all forwarding are intentionally
				// unsupported. Interactive control keys travel as ordinary PTY input.
			}
			if request.WantReply {
				_ = request.Reply(accepted, nil)
			}
		}
	}
}
