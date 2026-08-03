//go:build linux

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	switch os.Getenv("LCMD_AGENT_RECONCILE_HELPER") {
	case "daemon":
		if len(os.Args) < 3 {
			os.Exit(2)
		}
		if err := runAgentCommand(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	case "orphan":
		for {
			time.Sleep(time.Hour)
		}
	default:
		os.Exit(m.Run())
	}
}

func TestReconcileAgentDaemonsPreservesSocketOwnerAndStopsDuplicates(t *testing.T) {
	root := t.TempDir()
	socketPath := filepath.Join(root, "agent.sock")
	readyFile := filepath.Join(root, "agent.ready")
	const selector = "demo@owner"
	const accountID = "account-a"

	active := startAgentReconcileHelper(t, "daemon", socketPath, readyFile, selector, accountID)
	waitForAgentReadyFile(t, readyFile)
	orphanOne := startAgentReconcileHelper(t, "orphan", socketPath, "", selector, accountID)
	orphanTwo := startAgentReconcileHelper(t, "orphan", socketPath, "", selector, accountID)
	waitForAgentDaemonMatch(t, orphanOne.Process.Pid, socketPath, selector, accountID)
	waitForAgentDaemonMatch(t, orphanTwo.Process.Pid, socketPath, selector, accountID)

	count, err := reconcileAgentDaemons(socketPath, selector, accountID)
	if err != nil {
		t.Fatalf("reconcileAgentDaemons() error = %v", err)
	}
	if count != 2 {
		t.Fatalf("reconciled daemon count = %d, want 2", count)
	}
	if err := syscall.Kill(active.Process.Pid, 0); err != nil {
		t.Fatalf("active socket owner was terminated: %v", err)
	}
	assertAgentPing(t, socketPath, selector, accountID)
	waitForProcessExit(t, orphanOne)
	waitForProcessExit(t, orphanTwo)
}

func TestReconcileAgentDaemonsStopsAllOrphansWhenSocketIsMissing(t *testing.T) {
	root := t.TempDir()
	socketPath := filepath.Join(root, "missing.sock")
	const selector = "demo@owner"
	const accountID = "account-a"

	orphanOne := startAgentReconcileHelper(t, "orphan", socketPath, "", selector, accountID)
	orphanTwo := startAgentReconcileHelper(t, "orphan", socketPath, "", selector, accountID)
	waitForAgentDaemonMatch(t, orphanOne.Process.Pid, socketPath, selector, accountID)
	waitForAgentDaemonMatch(t, orphanTwo.Process.Pid, socketPath, selector, accountID)

	count, err := reconcileAgentDaemons(socketPath, selector, accountID)
	if err != nil {
		t.Fatalf("reconcileAgentDaemons() error = %v", err)
	}
	if count != 2 {
		t.Fatalf("reconciled orphan count = %d, want 2", count)
	}
	waitForProcessExit(t, orphanOne)
	waitForProcessExit(t, orphanTwo)
}

func TestAgentDaemonArgsMatchRequiresExactScope(t *testing.T) {
	args := []string{
		"/usr/local/bin/lcmd-webshell-agent",
		"agent",
		"daemon",
		"--socket",
		"/tmp/agent.sock",
		"--selector",
		"demo@owner",
		"--account",
		"account-a",
		"--username",
		"lightos",
	}
	if !agentDaemonArgsMatch(args, "/tmp/agent.sock", "demo@owner", "account-a") {
		t.Fatal("exact daemon scope did not match")
	}
	if agentDaemonArgsMatch(args, "/tmp/other.sock", "demo@owner", "account-a") {
		t.Fatal("different socket matched")
	}
	if agentDaemonArgsMatch(args, "/tmp/agent.sock", "other@owner", "account-a") {
		t.Fatal("different selector matched")
	}
	if agentDaemonArgsMatch(args, "/tmp/agent.sock", "demo@owner", "account-b") {
		t.Fatal("different account matched")
	}
}

func startAgentReconcileHelper(t *testing.T, mode, socketPath, readyFile, selector, accountID string) *exec.Cmd {
	t.Helper()
	args := []string{
		"/usr/local/bin/lcmd-webshell-agent",
		"agent",
		"daemon",
		"--socket",
		socketPath,
		"--selector",
		selector,
		"--account",
		accountID,
		"--username",
		"lightos",
	}
	if readyFile != "" {
		args = append(args, "--ready-file", readyFile)
	}
	command := exec.Command(os.Args[0])
	command.Args = args
	command.Env = append(os.Environ(), "LCMD_AGENT_RECONCILE_HELPER="+mode)
	command.Stdout = io.Discard
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		t.Fatalf("start %s helper error = %v", mode, err)
	}
	t.Cleanup(func() {
		if command.ProcessState == nil || !command.ProcessState.Exited() {
			_ = command.Process.Kill()
			_, _ = command.Process.Wait()
		}
	})
	return command
}

func waitForAgentReadyFile(t *testing.T, readyFile string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		data, err := os.ReadFile(readyFile)
		if err == nil && string(data) == agentReadyMarker+"\n" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("agent ready file was not written: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func waitForAgentDaemonMatch(t *testing.T, pid int, socketPath, selector, accountID string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		if agentDaemonPIDMatches(pid, socketPath, selector, accountID) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("helper pid %d did not expose the expected daemon command line", pid)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func waitForProcessExit(t *testing.T, command *exec.Cmd) {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		done <- command.Wait()
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("helper pid %d did not exit", command.Process.Pid)
	}
}

func assertAgentPing(t *testing.T, socketPath, selector, accountID string) {
	t.Helper()
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("dial active agent error = %v", err)
	}
	defer conn.Close()
	if err := json.NewEncoder(conn).Encode(agentRequest{Type: "ping", Selector: selector, AccountID: accountID}); err != nil {
		t.Fatalf("write ping error = %v", err)
	}
	var response agentResponse
	if err := json.NewDecoder(conn).Decode(&response); err != nil {
		t.Fatalf("decode ping response error = %v", err)
	}
	if !response.OK || response.Version != agentProtocolVersion {
		t.Fatalf("ping response = %+v", response)
	}
}
