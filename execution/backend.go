package execution

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gorilla/websocket"
	"io"
	"lcmd-webshell/core"
	"lcmd-webshell/localtools"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Access comes only from trusted discovery and a scoped server-side issuer.
type Access struct {
	URL, Token, Grant string
	Scope             Scope
}
type AccessSource func(context.Context, string) (Access, error)
type Backend struct {
	active     atomic.Pointer[Client]
	ctx        context.Context
	cancel     context.CancelFunc
	source     AccessSource
	controller string
	dir        string
	mu         sync.Mutex
	client     *Client
	descriptor Descriptor
	handles    map[string]*Process
}

func New(ctx context.Context, dir string, source AccessSource) (*Backend, error) {
	if !filepath.IsAbs(dir) {
		return nil, errors.New("private recovery directory must be absolute")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0700); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(ctx)
	b := &Backend{ctx: ctx, cancel: cancel, source: source, dir: dir, controller: "", handles: map[string]*Process{}}
	generation, err := b.nextController()
	if err != nil {
		cancel()
		return nil, err
	}
	b.controller = generation
	if _, err := b.connection(ctx); err != nil {
		cancel()
		return nil, err
	}
	return b, nil
}
func (b *Backend) Close() error {
	b.cancel()
	b.active.Store(nil)
	b.mu.Lock()
	client := b.client
	handles := make([]*Process, 0, len(b.handles))
	for _, p := range b.handles {
		handles = append(handles, p)
	}
	b.mu.Unlock()
	if client != nil {
		client.Close()
	}
	for _, p := range handles {
		p.Detach()
	}
	return nil
}
func (b *Backend) Descriptor() Descriptor { b.mu.Lock(); defer b.mu.Unlock(); return b.descriptor }
func (b *Backend) connection(ctx context.Context) (*Client, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ctx.Err() != nil {
		return nil, b.ctx.Err()
	}
	if b.client != nil {
		select {
		case <-b.client.done:
			b.client = nil
			b.active.Store(nil)
		default:
			return b.client, nil
		}
	}
	access, err := b.source(ctx, b.controller)
	if err != nil {
		return nil, err
	}
	u, err := url.Parse(access.URL)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" {
		return nil, errors.New("verified HTTPS execution endpoint required")
	}
	u.Scheme = "wss"
	u.Path = "/s/" + ServiceName + "/stream"
	u.RawQuery = ""
	u.Fragment = ""
	headers := http.Header{}
	headers.Set("lzc_dapi_auth_token", access.Token)
	headers.Set("X-PTY-Grant", access.Grant)
	// Default TLS verification is intentional. Discovery cannot authorize an
	// invalid certificate or an arbitrary URL supplied by a physical client.
	conn, _, err := (&websocket.Dialer{HandshakeTimeout: 10 * time.Second}).DialContext(ctx, u.String(), headers)
	if err != nil {
		return nil, errors.New("execution device connection unavailable")
	}
	client := NewClient(conn)
	reply, err := client.Call(ctx, Request{Op: "claim", Epoch: access.Scope.Epoch, Controller: b.controller})
	if err != nil {
		client.Close()
		return nil, err
	}
	if reply.Info == nil || reply.Info.Scope != access.Scope || reply.Info.Protocol != ProtocolVersion {
		client.Close()
		return nil, errors.New("execution identity mismatch")
	}
	b.descriptor = *reply.Info
	b.client = client
	b.active.Store(client)
	return client, nil
}
func (b *Backend) call(ctx context.Context, q Request, retry bool) (Response, error) {
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(b.ctx, cancel)
	defer stop()
	defer cancel()
	if q.ID == "" {
		q.ID = randomID()
	}
	q.Controller = b.controller
	for {
		c, err := b.connection(ctx)
		if err == nil {
			q.Epoch = b.Descriptor().Scope.Epoch
			var r Response
			r, err = c.Call(ctx, q)
			if err == nil {
				return r, nil
			}
			var remote remoteError
			if errors.As(err, &remote) && remote.code == "retry_later" {
				timer := time.NewTimer(20 * time.Millisecond)
				select {
				case <-ctx.Done():
					timer.Stop()
					return r, ctx.Err()
				case <-timer.C:
				}
				continue
			}
			select {
			case <-c.done:
			default:
				return r, err
			}
		}
		if !retry {
			return Response{}, err
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return Response{}, ctx.Err()
		case <-b.ctx.Done():
			timer.Stop()
			return Response{}, b.ctx.Err()
		case <-timer.C:
		}
	}
}
func (b *Backend) OpenPTY(ctx context.Context, key string, launch core.Launch, options core.ShellOptions) (core.ProcessHandle, error) {
	command := ""
	if options.Execute {
		command = options.Command
	}
	q := Request{Op: "open_pty", ConnectionBound: options.Execute && options.ExecutionKey == "", Execute: options.Execute, Key: key, CWD: launch.InitialCWD, Command: command, Term: options.Term, Size: Size{Cols: options.Size.Cols, Rows: options.Size.Rows, X: options.Size.PixelWidth, Y: options.Size.PixelHeight}, Modes: options.Modes, Environment: environment(options.Env)}
	return b.open(ctx, key, q)
}
func environment(env []string) map[string]string {
	out := map[string]string{}
	for _, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			out[key] = value
		}
	}
	return out
}
func (b *Backend) open(ctx context.Context, key string, q Request) (*Process, error) {
	if q.Op == "open_command" || q.ConnectionBound {
		return b.openTransient(ctx, key, q)
	}
	dir := filepath.Join(b.dir, hashKey(key))
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	// Persist the immutable create intent before asking the executor to create it.
	intentPath := filepath.Join(dir, "intent.json")
	raw, err := os.ReadFile(intentPath)
	if err == nil {
		var intent Request
		if json.Unmarshal(raw, &intent) != nil {
			return nil, errors.New("corrupt execution create intent")
		}
		q = intent
	} else if os.IsNotExist(err) {
		if q.ID == "" {
			q.ID = randomID()
		}
		raw, _ = json.Marshal(q)
		if err = atomicPrivateFile(intentPath, raw); err != nil {
			return nil, err
		}
	} else {
		return nil, err
	}
	stopCanceledCreate := context.AfterFunc(ctx, func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		b.call(cleanupCtx, Request{Op: "close_intent", Key: key}, false)
	})
	defer func() {
		if ctx.Err() == nil {
			stopCanceledCreate()
		}
	}()
	sessionPath := filepath.Join(dir, "session")
	var sessionID string
	mapped, mapErr := os.ReadFile(sessionPath)
	if mapErr == nil {
		sessionID = string(mapped)
	} else if os.IsNotExist(mapErr) {
		listing, listErr := b.call(ctx, Request{Op: "resolve", Key: key}, true)
		if listErr != nil {
			return nil, listErr
		}
		for _, info := range listing.Sessions {
			if info.Key == key {
				sessionID = info.ID
				break
			}
		}
		if sessionID == "" {
			reply, openErr := b.call(ctx, q, true)
			if openErr != nil {
				return nil, openErr
			}
			sessionID = reply.Session
		}
		if sessionID == "" {
			return nil, errors.New("executor did not return a session")
		}
		if err = atomicPrivateFile(sessionPath, []byte(sessionID)); err != nil {
			return nil, err
		}
	} else {
		return nil, mapErr
	}
	p := &Process{backend: b, id: sessionID, key: key, dir: dir, next: 1, done: make(chan struct{}), closed: make(chan struct{})}
	if q.Op == "open_pty" {
		p.decoder = &localtools.TextDecoder{}
	}
	p.ctx, p.cancel = context.WithCancel(b.ctx)
	result, err := b.call(ctx, Request{Op: "query", Session: p.id}, true)
	if err != nil {
		return nil, err
	}
	p.input = result.Offset
	if err = p.loadJournal(); err != nil {
		p.cancel()
		return nil, err
	}
	b.mu.Lock()
	b.handles[p.id] = p
	b.mu.Unlock()
	return p, nil
}
func (b *Backend) OpenCommand(ctx context.Context, key, command string, env []string) (core.CommandHandle, error) {
	q := Request{Op: "open_command", Execute: true, Key: key, Command: command, Environment: environment(env)}
	p, err := b.open(ctx, key, q)
	if err != nil {
		return nil, err
	}
	return b.command(ctx, p), nil
}
func (b *Backend) command(ctx context.Context, p *Process) *Command {
	outR, outW := io.Pipe()
	errR, errW := io.Pipe()
	c := &Command{process: p, out: outR, stderr: errR}
	go func() {
		defer outW.Close()
		defer errW.Close()
		for {
			ev, err := p.Next(ctx)
			if err != nil {
				outW.CloseWithError(err)
				errW.CloseWithError(err)
				return
			}
			switch ev.Kind {
			case "output":
				_, err = outW.Write(ev.Data)
			case "stderr":
				_, err = errW.Write(ev.Data)
			case "exit":
				p.Commit(ev.Sequence, nil)
				return
			}
			if err != nil {
				return
			}
			if err = p.Commit(ev.Sequence, nil); err != nil {
				return
			}
		}
	}()
	return c
}

type Command struct {
	process     *Process
	out, stderr *io.PipeReader
}

func (c *Command) Input() io.WriteCloser    { return &commandInput{c.process} }
func (c *Command) Output() io.ReadCloser    { return c.out }
func (c *Command) Errors() io.ReadCloser    { return c.stderr }
func (c *Command) Wait() core.ProcessResult { return c.process.Wait() }
func (c *Command) Signal(name string) error { return c.process.Signal(name) }
func (c *Command) Terminate() error         { c.out.Close(); c.stderr.Close(); return c.process.Terminate() }

type commandInput struct{ p *Process }

func (c *commandInput) Write(b []byte) (int, error) { return c.p.Write(b) }
func (c *commandInput) Close() error {
	_, err := c.p.backend.call(context.Background(), Request{Op: "close_stdin", Session: c.p.id}, false)
	return err
}

func (b *Backend) HostPublicKey(ctx context.Context) ([]byte, error) {
	r, err := b.call(ctx, Request{Op: "host_public_key"}, false)
	return r.Data, err
}
func (b *Backend) SignHost(ctx context.Context, data []byte) ([]byte, error) {
	r, err := b.call(ctx, Request{Op: "host_sign", Key: randomID(), Data: data}, false)
	return r.Data, err
}
func (b *Backend) Revoke() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	reply, err := b.call(ctx, Request{Op: "close_group"}, false)
	b.mu.Lock()
	for _, info := range reply.Sessions {
		if info.Exit != nil {
			if p := b.handles[info.ID]; p != nil {
				p.finish(core.ProcessResult{Code: info.Exit.Code, Signal: info.Exit.Signal, Message: info.Exit.Error})
			}
		} else if err == nil {
			err = errors.New("owned process cleanup unconfirmed")
		}
	}
	b.mu.Unlock()
	b.Close()
	return err
}
func (b *Backend) nextController() (string, error) {
	path := filepath.Join(b.dir, "controller")
	var generation uint64
	raw, err := os.ReadFile(path)
	if err == nil {
		generation, err = strconv.ParseUint(string(raw), 10, 64)
		if err != nil {
			return "", errors.New("corrupt controller generation")
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	if generation == ^uint64(0) {
		return "", errors.New("controller generation exhausted")
	}
	generation++
	value := fmt.Sprintf("%020d", generation)
	if err = atomicPrivateFile(path, []byte(value)); err != nil {
		return "", err
	}
	return value, nil
}

func (b *Backend) AdmissionAllowed() bool {
	if b.ctx.Err() != nil {
		return false
	}
	client := b.active.Load()
	if client == nil {
		return false
	}
	select {
	case <-client.done:
		return false
	default:
		return true
	}
}

// Connection-bound commands have no restart replay. Only their bounded native
// transport window buffers output; it never becomes an unbounded disk history.
func (b *Backend) openTransient(ctx context.Context, key string, q Request) (*Process, error) {
	stop := context.AfterFunc(ctx, func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		b.call(cleanup, Request{Op: "close_intent", Key: key}, false)
	})
	defer func() {
		if ctx.Err() == nil {
			stop()
		}
	}()
	reply, err := b.call(ctx, q, false)
	if err != nil {
		return nil, err
	}
	p := &Process{backend: b, id: reply.Session, key: key, next: 1, ephemeral: true, done: make(chan struct{}), closed: make(chan struct{})}
	if q.Op == "open_pty" {
		p.decoder = &localtools.TextDecoder{}
	}
	p.ctx, p.cancel = context.WithCancel(b.ctx)
	info, err := b.call(ctx, Request{Op: "query", Session: p.id}, false)
	if err != nil {
		p.cancel()
		return nil, err
	}
	p.input = info.Offset
	b.mu.Lock()
	b.handles[p.id] = p
	b.mu.Unlock()
	return p, nil
}
