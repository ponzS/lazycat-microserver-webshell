package execution

import (
	"context"
	"errors"
	"github.com/gorilla/websocket"
	"os"
	"sync"
	"time"
)

// Client multiplexes control and bounded stream reads on one transport.
// It never retries mutations automatically; callers retain the request ID.
type Client struct {
	conn      *websocket.Conn
	writeMu   sync.Mutex
	mu        sync.Mutex
	pending   map[string]chan Response
	done      chan struct{}
	closeOnce sync.Once
}

func NewClient(conn *websocket.Conn) *Client {
	c := &Client{conn: conn, pending: map[string]chan Response{}, done: make(chan struct{})}
	conn.SetReadLimit(MaxFrame)
	conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	go c.read()
	go c.keepAlive()
	return c
}
func (c *Client) read() {
	defer c.Close()
	for {
		var r Response
		if c.conn.ReadJSON(&r) != nil {
			return
		}
		c.mu.Lock()
		ch := c.pending[r.ID]
		delete(c.pending, r.ID)
		c.mu.Unlock()
		if ch != nil {
			ch <- r
		}
	}
}
func (c *Client) Close() error { c.closeOnce.Do(func() { close(c.done); c.conn.Close() }); return nil }
func (c *Client) Call(ctx context.Context, q Request) (Response, error) {
	if q.ID == "" {
		q.ID = randomID()
	}
	ch := make(chan Response, 1)
	c.mu.Lock()
	if _, ok := c.pending[q.ID]; ok {
		c.mu.Unlock()
		return Response{}, errors.New("duplicate in-flight request")
	}
	c.pending[q.ID] = ch
	c.mu.Unlock()
	defer func() { c.mu.Lock(); delete(c.pending, q.ID); c.mu.Unlock() }()
	c.writeMu.Lock()
	c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	err := c.conn.WriteJSON(q)
	c.writeMu.Unlock()
	if err != nil {
		return Response{}, err
	}
	select {
	case r := <-ch:
		if r.Error != "" {
			cause := remoteError{r.Error, r.ErrorCode}
			if r.ErrorCode == "not_found" || r.ErrorCode == "exists" || r.ErrorCode == "permission" {
				return r, &os.PathError{Op: "remote", Err: cause.Unwrap()}
			}
			return r, cause
		}
		return r, nil
	case <-ctx.Done():
		go func() {
			c.writeMu.Lock()
			defer c.writeMu.Unlock()
			c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			c.conn.WriteJSON(Request{Op: "cancel", Session: q.ID, Epoch: q.Epoch, Controller: q.Controller})
		}()
		return Response{}, ctx.Err()
	case <-c.done:
		return Response{}, errors.New("execution transport closed")
	}
}

type remoteError struct{ message, code string }

func (e remoteError) Error() string { return e.message }
func (e remoteError) Unwrap() error {
	switch e.code {
	case "not_found":
		return os.ErrNotExist
	case "exists":
		return os.ErrExist
	case "permission":
		return os.ErrPermission
	case "timeout":
		return os.ErrDeadlineExceeded
	}
	return nil
}

func (e remoteError) Timeout() bool   { return e.code == "timeout" }
func (e remoteError) Temporary() bool { return e.code == "timeout" }

func (c *Client) keepAlive() {
	timer := time.NewTicker(15 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-timer.C:
			if err := c.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				c.Close()
				return
			}
		}
	}
}
