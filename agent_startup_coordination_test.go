package main

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func TestPersistentAgentEnsureCoordinatorSharesConcurrentColdStart(t *testing.T) {
	var coordinator persistentAgentEnsureCoordinator
	var calls atomic.Int32
	start := make(chan struct{})
	release := make(chan struct{})
	var startedOnce sync.Once
	started := make(chan struct{})

	const callers = 32
	results := make(chan error, callers)
	for range callers {
		go func() {
			<-start
			username, err := coordinator.do(context.Background(), "scope-a", func(context.Context) (string, error) {
				calls.Add(1)
				startedOnce.Do(func() { close(started) })
				<-release
				return "lightos", nil
			})
			if err == nil && username != "lightos" {
				err = errors.New("unexpected shared username")
			}
			results <- err
		}()
	}
	close(start)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("shared ensure did not start")
	}
	waitForEnsureWaiters(t, &coordinator, "scope-a", callers)
	close(release)

	for range callers {
		if err := <-results; err != nil {
			t.Fatalf("coordinated ensure failed: %v", err)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("cold-start executions = %d, want 1", got)
	}
}

func TestPersistentAgentEnsureCoordinatorCallerCancellationDoesNotCancelSharedStart(t *testing.T) {
	var coordinator persistentAgentEnsureCoordinator
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})

	callerCtx, cancelCaller := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	go func() {
		_, err := coordinator.do(callerCtx, "scope-a", func(ctx context.Context) (string, error) {
			calls.Add(1)
			close(started)
			select {
			case <-release:
				return "lightos", nil
			case <-ctx.Done():
				return "", ctx.Err()
			}
		})
		firstDone <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("shared ensure did not start")
	}
	cancelCaller()
	if err := <-firstDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled caller error = %v, want context.Canceled", err)
	}

	secondDone := make(chan error, 1)
	go func() {
		username, err := coordinator.do(context.Background(), "scope-a", func(context.Context) (string, error) {
			calls.Add(1)
			return "unexpected", nil
		})
		if err == nil && username != "lightos" {
			err = errors.New("second caller did not receive shared result")
		}
		secondDone <- err
	}()
	waitForEnsureWaiters(t, &coordinator, "scope-a", 2)
	close(release)
	if err := <-secondDone; err != nil {
		t.Fatalf("second caller failed: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("shared executions after caller cancellation = %d, want 1", got)
	}
}

func waitForEnsureWaiters(t *testing.T, coordinator *persistentAgentEnsureCoordinator, key string, wanted int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		coordinator.Lock()
		flight := coordinator.flights[key]
		waiters := 0
		if flight != nil {
			waiters = flight.waiters
		}
		coordinator.Unlock()
		if waiters == wanted {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("shared ensure waiters = %d, want %d", waiters, wanted)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestAgentDaemonLockAllowsOnlyOneOwner(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")
	first, err := acquireAgentDaemonLock(socketPath)
	if err != nil {
		t.Fatalf("first acquireAgentDaemonLock() error = %v", err)
	}
	defer first.Close()

	if second, err := acquireAgentDaemonLock(socketPath); err == nil {
		second.Close()
		t.Fatal("second acquireAgentDaemonLock() succeeded")
	}
	if err := syscall.Flock(int(first.Fd()), syscall.LOCK_UN); err != nil {
		t.Fatalf("unlock first daemon lock error = %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close first daemon lock error = %v", err)
	}

	third, err := acquireAgentDaemonLock(socketPath)
	if err != nil {
		t.Fatalf("acquire after release error = %v", err)
	}
	_ = syscall.Flock(int(third.Fd()), syscall.LOCK_UN)
	_ = third.Close()
}

func TestAgentDaemonSocketCleanupPreservesReplacementOwner(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")
	first, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("first net.Listen() error = %v", err)
	}
	defer first.Close()
	firstInfo, err := os.Lstat(socketPath)
	if err != nil {
		t.Fatalf("Lstat(first socket) error = %v", err)
	}
	if err := os.Remove(socketPath); err != nil {
		t.Fatalf("Remove(first socket path) error = %v", err)
	}

	second, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("second net.Listen() error = %v", err)
	}
	defer second.Close()
	secondInfo, err := os.Lstat(socketPath)
	if err != nil {
		t.Fatalf("Lstat(second socket) error = %v", err)
	}

	removeAgentSocketIfOwned(socketPath, firstInfo)
	if _, err := os.Lstat(socketPath); err != nil {
		t.Fatalf("old daemon cleanup removed replacement socket: %v", err)
	}
	removeAgentSocketIfOwned(socketPath, secondInfo)
	if _, err := os.Lstat(socketPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("owned socket cleanup error = %v, want not exist", err)
	}
}

func TestRemoveStaleAgentSocketRejectsActiveListener(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("net.Listen() error = %v", err)
	}
	defer listener.Close()

	if err := removeStaleAgentSocket(socketPath); err == nil || !strings.Contains(err.Error(), "already accepting") {
		t.Fatalf("removeStaleAgentSocket(active) error = %v, want active socket error", err)
	}
	if _, err := os.Lstat(socketPath); err != nil {
		t.Fatalf("active socket path was removed: %v", err)
	}
}

func TestRemoveStaleAgentSocketRemovesClosedListener(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("net.Listen() error = %v", err)
	}
	unixListener, ok := listener.(*net.UnixListener)
	if !ok {
		listener.Close()
		t.Fatal("unix listener has unexpected type")
	}
	unixListener.SetUnlinkOnClose(false)
	if err := listener.Close(); err != nil {
		t.Fatalf("listener.Close() error = %v", err)
	}
	if _, err := os.Lstat(socketPath); err != nil {
		t.Fatalf("stale socket is unavailable before cleanup: %v", err)
	}

	if err := removeStaleAgentSocket(socketPath); err != nil {
		t.Fatalf("removeStaleAgentSocket(stale) error = %v", err)
	}
	if _, err := os.Lstat(socketPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale socket cleanup error = %v, want not exist", err)
	}
}

func TestWriteAgentReadyFileIsAtomicAndExact(t *testing.T) {
	readyFile := filepath.Join(t.TempDir(), "agent.ready")
	if err := writeAgentReadyFile(readyFile); err != nil {
		t.Fatalf("writeAgentReadyFile() error = %v", err)
	}
	data, err := os.ReadFile(readyFile)
	if err != nil {
		t.Fatalf("ReadFile(ready) error = %v", err)
	}
	if got := strings.TrimSpace(string(data)); got != agentReadyMarker {
		t.Fatalf("ready marker = %q, want %q", got, agentReadyMarker)
	}
}
