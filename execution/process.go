package execution

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"lcmd-webshell/core"
	"lcmd-webshell/localtools"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Process struct {
	ephemeral           bool
	waitOnce            sync.Once
	ctx                 context.Context
	cancel              context.CancelFunc
	resultMu            sync.Mutex
	backend             *Backend
	id, key, dir        string
	inputMu             sync.Mutex
	input               uint64
	readMu              sync.Mutex
	next                uint64
	replay              []Event
	checkpoint          []byte
	journal             *os.File
	pending             []byte
	decoder             *localtools.TextDecoder
	readEnded           bool
	done                chan struct{}
	closed              chan struct{}
	closeOnce, exitOnce sync.Once
	result              core.ProcessResult
}

func (p *Process) Next(ctx context.Context) (core.ExecutionEvent, error) {
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(p.ctx, cancel)
	defer stop()
	defer cancel()
	p.readMu.Lock()
	defer p.readMu.Unlock()
	select {
	case <-p.closed:
		return core.ExecutionEvent{}, errors.New("execution detached")
	default:
	}
	var ev Event
	if len(p.replay) > 0 {
		ev = p.replay[0]
		p.replay = p.replay[1:]
	} else {
		r, err := p.backend.call(ctx, Request{Op: "read", Session: p.id, Sequence: p.next}, !p.ephemeral)
		if err != nil {
			if p.ephemeral {
				p.cancel()
			}
			return core.ExecutionEvent{}, err
		}
		if r.Event == nil {
			return core.ExecutionEvent{}, errors.New("missing authoritative execution event")
		}
		ev = *r.Event
		if ev.Sequence != p.next {
			return core.ExecutionEvent{}, errors.New("execution output sequence mismatch")
		}
		if !p.ephemeral {
			if err = p.journalEvent(ev); err != nil {
				return core.ExecutionEvent{}, err
			}
		}
	}
	p.next = ev.Sequence + 1
	result := core.ExecutionEvent{Sequence: ev.Sequence, Kind: ev.Kind, Data: ev.Data, Size: core.ShellSize{Cols: ev.Size.Cols, Rows: ev.Size.Rows, PixelWidth: ev.Size.X, PixelHeight: ev.Size.Y}}
	if p.decoder != nil && (ev.Kind == "output" || ev.Kind == "exit") {
		result.Data = p.decoder.Decode(ev.Data, ev.Kind == "exit")
	}
	if ev.Exit != nil {
		result.Exit = core.ProcessResult{Code: ev.Exit.Code, Signal: ev.Exit.Signal, Message: ev.Exit.Error}
		p.finish(result.Exit)
	}
	return result, nil
}
func (p *Process) Commit(sequence uint64, checkpoint []byte) error {
	p.readMu.Lock()
	defer p.readMu.Unlock()
	if len(checkpoint) > 0 && !p.ephemeral {
		saved := savedCheckpoint{Sequence: sequence, Data: checkpoint, Digest: hashKey(string(checkpoint))}
		if p.decoder != nil {
			saved.TextPending = p.decoder.Pending
			saved.TextDigest = hashKey(string(saved.TextPending))
		}
		raw, _ := json.Marshal(saved)
		if err := atomicPrivateFile(filepath.Join(p.dir, "checkpoint.json"), raw); err != nil {
			return err
		}
		// A recovered journal can still contain events ahead of the checkpoint.
		// Preserve that tail atomically; an in-place truncate would lose it on a
		// second crash during replay, even though the executor already ACKed it.
		var tail []byte
		for _, event := range p.replay {
			if event.Sequence > sequence {
				line, _ := json.Marshal(event)
				tail = append(tail, line...)
				tail = append(tail, '\n')
			}
		}
		path := filepath.Join(p.dir, "events.jsonl")
		if err := atomicPrivateFile(path, tail); err != nil {
			return err
		}
		p.journal.Close()
		var err error
		p.journal, err = os.OpenFile(path, os.O_RDWR|os.O_APPEND, 0600)
		if err != nil {
			return err
		}

	}
	q := Request{Op: "ack", Session: p.id, Sequence: sequence}
	if len(checkpoint) > 0 {
		q.Checkpoint = &sequence
	}
	_, err := p.backend.call(p.ctx, q, true)
	return err
}
func (p *Process) LoadCheckpoint() ([]byte, error) { return p.checkpoint, nil }
func (p *Process) Read(dst []byte) (int, error) {
	if len(dst) == 0 {
		return 0, nil
	}
	for len(p.pending) == 0 {
		if p.readEnded {
			return 0, io.EOF
		}
		event, err := p.Next(context.Background())
		if err != nil {
			return 0, err
		}
		if event.Kind == "output" || event.Kind == "exit" {
			p.pending = event.Data
		}
		p.readEnded = event.Kind == "exit"
		if err = p.Commit(event.Sequence, nil); err != nil {
			return 0, err
		}
	}
	n := copy(dst, p.pending)
	p.pending = p.pending[n:]
	return n, nil
}
func (p *Process) Write(data []byte) (int, error) {
	p.inputMu.Lock()
	defer p.inputMu.Unlock()
	written := 0
	for len(data) > 0 {
		chunk := data
		if len(chunk) > 256<<10 {
			chunk = chunk[:256<<10]
		}
		r, err := p.backend.call(p.ctx, Request{Op: "input", Session: p.id, Offset: p.input, Data: chunk}, true)
		if err != nil && r.ID == "" {
			return written, err
		}
		n := int(r.Offset - p.input)
		if n < 0 || n > len(chunk) {
			return written, errors.New("invalid executor input acknowledgement")
		}
		p.input = r.Offset
		written += n
		data = data[n:]
		if err != nil {
			return written, err
		}
		if n == 0 {
			return written, io.ErrShortWrite
		}
	}
	return written, nil
}
func (p *Process) WriteGenerated(data []byte, key string) error {
	p.inputMu.Lock()
	defer p.inputMu.Unlock()
	r, err := p.backend.call(p.ctx, Request{Op: "generated_input", Session: p.id, Key: key, Data: data}, true)
	if r.Offset > p.input {
		p.input = r.Offset
	}
	return err
}
func (p *Process) Resize(size core.ShellSize) error {
	_, err := p.backend.call(p.ctx, Request{Op: "resize", Session: p.id, Size: Size{Cols: size.Cols, Rows: size.Rows, X: size.PixelWidth, Y: size.PixelHeight}}, true)
	return err
}
func (p *Process) Signal(name string) error {
	_, err := p.backend.call(p.ctx, Request{Op: "signal", Session: p.id, Signal: name}, true)
	return err
}
func (p *Process) Wait() core.ProcessResult {
	p.waitOnce.Do(func() {
		go func() {
			reply, err := p.backend.call(p.ctx, Request{Op: "wait", Session: p.id}, true)
			if err == nil && reply.Exit != nil {
				p.finish(core.ProcessResult{Code: reply.Exit.Code, Signal: reply.Exit.Signal, Message: reply.Exit.Error})
			}
		}()
	})
	select {
	case <-p.done:
		p.resultMu.Lock()
		defer p.resultMu.Unlock()
		return p.result
	case <-p.ctx.Done():
		return core.ProcessResult{Code: -1, Message: "execution attachment closed"}
	}
}
func (p *Process) Detach() error {
	p.closeOnce.Do(func() {
		p.cancel()
		close(p.closed)
		p.readMu.Lock()
		defer p.readMu.Unlock()
		if p.journal != nil {
			p.journal.Close()
		}
	})
	return nil
}
func (p *Process) Terminate() error {
	if p.ephemeral && !p.backend.AdmissionAllowed() {
		p.Detach()
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := p.backend.call(ctx, Request{Op: "terminate", Session: p.id}, false)
	if err != nil {
		return err
	}
	for {
		reply, queryErr := p.backend.call(ctx, Request{Op: "query", Session: p.id}, false)
		if queryErr != nil {
			return queryErr
		}
		if reply.Exit != nil {
			p.finish(core.ProcessResult{Code: reply.Exit.Code, Signal: reply.Exit.Signal, Message: reply.Exit.Error})
			p.Detach()
			return nil
		}
		timer := time.NewTimer(20 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
func (p *Process) Close() error                    { return p.Terminate() }
func (p *Process) InitialWorkingDirectory() string { return p.backend.Descriptor().Home }
func (p *Process) SupportsCWDReports() bool        { return p.backend.Descriptor().OS == "windows" }

func (p *Process) LoadReplay() ([]byte, error) { return p.checkpoint, nil }
func (p *Process) SaveReplay(raw []byte) error { return p.Commit(p.next-1, raw) }

func (p *Process) TTYName() string { return p.id }

func (p *Process) finish(result core.ProcessResult) {
	p.exitOnce.Do(func() { p.resultMu.Lock(); p.result = result; p.resultMu.Unlock(); close(p.done) })
}
