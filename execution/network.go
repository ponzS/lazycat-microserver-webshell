package execution

import (
	"context"
	"errors"
	"io"
	"net"
	"sync"
	"time"
)

type Connection struct {
	backend                     *Backend
	id                          string
	local, remote               net.Addr
	ctx                         context.Context
	cancel                      context.CancelFunc
	once                        sync.Once
	readMu, writeMu             sync.Mutex
	deadlineMu                  sync.Mutex
	readDeadline, writeDeadline time.Time
	pending                     []byte
	eof                         bool
}

func (b *Backend) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	r, err := b.call(ctx, Request{Op: "net_dial", Network: network, Address: address}, false)
	if err != nil {
		return nil, err
	}
	return newConnection(b, r.Session, network, r.Address, address), nil
}
func newConnection(b *Backend, id, network, local, remote string) *Connection {
	ctx, cancel := context.WithCancel(b.ctx)
	return &Connection{backend: b, id: id, ctx: ctx, cancel: cancel, local: parseAddress(network, local), remote: parseAddress(network, remote)}
}
func parseAddress(network, address string) net.Addr {
	if network == "unix" || network == "agent" {
		return &net.UnixAddr{Name: address, Net: "unix"}
	}
	a, err := net.ResolveTCPAddr("tcp", address)
	if err != nil {
		return &net.TCPAddr{}
	}
	return a
}
func (c *Connection) requestContext(bool) (context.Context, context.CancelFunc) {
	return context.WithCancel(c.ctx)
}
func (c *Connection) Read(b []byte) (int, error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()
	if len(b) == 0 {
		return 0, nil
	}
	if len(c.pending) > 0 {
		n := copy(b, c.pending)
		c.pending = c.pending[n:]
		return n, nil
	}
	if c.eof {
		return 0, io.EOF
	}
	ctx, cancel := c.requestContext(true)
	defer cancel()
	length := len(b)
	if length > 32<<10 {
		length = 32 << 10
	}
	r, err := c.backend.call(ctx, Request{Op: "net_read", Session: c.id, Length: length}, false)
	n := copy(b, r.Data)
	if r.Exit != nil {
		c.eof = true
		if n == 0 {
			return 0, io.EOF
		}
	}
	return n, err
}
func (c *Connection) Write(b []byte) (int, error) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	written := 0
	ctx, cancel := c.requestContext(false)
	defer cancel()
	for len(b) > 0 {
		chunk := b
		if len(chunk) > 32<<10 {
			chunk = chunk[:32<<10]
		}
		r, err := c.backend.call(ctx, Request{Op: "net_write", Session: c.id, Data: chunk}, false)
		n := int(r.Offset)
		written += n
		b = b[n:]
		if err != nil {
			return written, err
		}
		if n == 0 {
			return written, io.ErrShortWrite
		}
	}
	return written, nil
}
func (c *Connection) CloseWrite() error {
	ctx, cancel := c.requestContext(false)
	defer cancel()
	_, err := c.backend.call(ctx, Request{Op: "net_close_write", Session: c.id}, false)
	return err
}
func (c *Connection) Close() error {
	c.once.Do(func() {
		c.cancel()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		c.backend.call(ctx, Request{Op: "net_close", Session: c.id}, false)
	})
	return nil
}
func (c *Connection) LocalAddr() net.Addr  { return c.local }
func (c *Connection) RemoteAddr() net.Addr { return c.remote }
func (c *Connection) setDeadline(t time.Time, kind string) error {
	value := int64(0)
	if !t.IsZero() {
		value = t.UnixNano()
	}
	_, err := c.backend.call(c.ctx, Request{Op: "net_deadline", Session: c.id, Position: value, Signal: kind}, false)
	return err
}
func (c *Connection) SetDeadline(t time.Time) error      { return c.setDeadline(t, "") }
func (c *Connection) SetReadDeadline(t time.Time) error  { return c.setDeadline(t, "read") }
func (c *Connection) SetWriteDeadline(t time.Time) error { return c.setDeadline(t, "write") }

type Listener struct {
	backend     *Backend
	id, network string
	address     net.Addr
	ctx         context.Context
	cancel      context.CancelFunc
	once        sync.Once
}

func (b *Backend) Listen(ctx context.Context, network, address string) (net.Listener, error) {
	r, err := b.call(ctx, Request{Op: "net_listen", Network: network, Address: address}, false)
	if err != nil {
		return nil, err
	}
	lctx, cancel := context.WithCancel(b.ctx)
	return &Listener{backend: b, id: r.Session, network: network, address: parseAddress(network, r.Address), ctx: lctx, cancel: cancel}, nil
}
func (l *Listener) Accept() (net.Conn, error) {
	r, err := l.backend.call(l.ctx, Request{Op: "net_accept", Session: l.id}, false)
	if err != nil {
		return nil, err
	}
	if r.Session == "" {
		return nil, errors.New("missing accepted connection")
	}
	return newConnection(l.backend, r.Session, l.network, l.address.String(), r.Address), nil
}
func (l *Listener) Close() error {
	l.once.Do(func() {
		l.cancel()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		l.backend.call(ctx, Request{Op: "net_close", Session: l.id}, false)
	})
	return nil
}
func (l *Listener) Addr() net.Addr { return l.address }
