//go:build linux

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
	case "legacy-daemon", "opaque-daemon":
		if len(os.Args) < 4 {
			os.Exit(2)
		}
		opaqueProtocol := os.Getenv("LCMD_AGENT_RECONCILE_HELPER") == "opaque-daemon"
		if err := runLegacyAgentReconcileHelper(os.Args[3:], opaqueProtocol); err != nil {
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

	count, err := reconcileAgentDaemons(socketPath, selector, accountID, false)
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

func TestReconcileAgentDaemonsPreservesCompatibleOwnerDuringReplacementRace(t *testing.T) {
	root := t.TempDir()
	socketPath := filepath.Join(root, "agent.sock")
	readyFile := filepath.Join(root, "agent.ready")
	const selector = "demo@owner"
	const accountID = "account-a"

	active := startAgentReconcileHelper(t, "daemon", socketPath, readyFile, selector, accountID)
	waitForAgentReadyFile(t, readyFile)

	count, err := reconcileAgentDaemons(socketPath, selector, accountID, true)
	if err != nil {
		t.Fatalf("compatible replacement-race reconcile error = %v", err)
	}
	if count != 0 {
		t.Fatalf("compatible replacement-race count = %d, want 0", count)
	}
	if err := syscall.Kill(active.Process.Pid, 0); err != nil {
		t.Fatalf("compatible socket owner was terminated: %v", err)
	}
	assertAgentPing(t, socketPath, selector, accountID)
}

func TestReconcileAgentDaemonsRequiresExplicitForceForOpaqueProtocol(t *testing.T) {
	root := t.TempDir()
	socketPath := filepath.Join(root, "agent.sock")
	readyFile := filepath.Join(root, "agent.ready")
	const selector = "demo@owner"
	const accountID = "account-a"

	active := startAgentReconcileHelper(t, "opaque-daemon", socketPath, readyFile, selector, accountID)
	waitForAgentReadyFile(t, readyFile)
	if _, err := reconcileAgentDaemons(socketPath, selector, accountID, true); err == nil {
		t.Fatal("ordinary replacement accepted an undecodable active protocol")
	}
	if err := syscall.Kill(active.Process.Pid, 0); err != nil {
		t.Fatalf("ordinary replacement terminated opaque daemon: %v", err)
	}
	count, err := reconcileAgentDaemonsWithOptions(socketPath, selector, accountID, true, true)
	if err != nil {
		t.Fatalf("confirmed forced replacement error = %v", err)
	}
	if count != 1 {
		t.Fatalf("confirmed forced replacement count = %d, want 1", count)
	}
	waitForProcessExit(t, active)
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

	count, err := reconcileAgentDaemons(socketPath, selector, accountID, false)
	if err != nil {
		t.Fatalf("reconcileAgentDaemons() error = %v", err)
	}
	if count != 2 {
		t.Fatalf("reconciled orphan count = %d, want 2", count)
	}
	waitForProcessExit(t, orphanOne)
	waitForProcessExit(t, orphanTwo)
}

func TestReconcileAgentDaemonsAcceptsRefusedStaleSocket(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "stale.sock")
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("listen stale socket failed: %v", err)
	}
	unixListener, ok := listener.(*net.UnixListener)
	if !ok {
		_ = listener.Close()
		t.Fatal("unix listener has unexpected type")
	}
	unixListener.SetUnlinkOnClose(false)
	if err := listener.Close(); err != nil {
		t.Fatalf("close stale socket listener failed: %v", err)
	}

	count, err := reconcileAgentDaemons(socketPath, "demo@owner", "account-a", false)
	if err != nil {
		t.Fatalf("reconcile refused stale socket failed: %v", err)
	}
	if count != 0 {
		t.Fatalf("reconciled daemon count = %d, want 0", count)
	}
	if err := removeStaleAgentSocket(socketPath); err != nil {
		t.Fatalf("daemon startup could not remove reconciled stale socket: %v", err)
	}
}

func TestReconcileAgentDaemonsReplacesActiveOwnerAfterProtocolMismatch(t *testing.T) {
	root := t.TempDir()
	socketPath := filepath.Join(root, "agent.sock")
	readyFile := filepath.Join(root, "agent.ready")
	const selector = "demo@owner"
	const accountID = "account-a"

	active := startAgentReconcileHelper(t, "legacy-daemon", socketPath, readyFile, selector, accountID)
	waitForAgentReadyFile(t, readyFile)
	orphan := startAgentReconcileHelper(t, "orphan", socketPath, "", selector, accountID)
	waitForAgentDaemonMatch(t, orphan.Process.Pid, socketPath, selector, accountID)

	count, err := reconcileAgentDaemons(socketPath, selector, accountID, false)
	if err != nil {
		t.Fatalf("pre-replacement reconcile error = %v", err)
	}
	if count != 1 {
		t.Fatalf("pre-replacement orphan count = %d, want 1", count)
	}
	waitForProcessExit(t, orphan)

	count, err = reconcileAgentDaemons(socketPath, selector, accountID, true)
	if err != nil {
		t.Fatalf("replace active reconcile error = %v", err)
	}
	if count != 1 {
		t.Fatalf("replaced active daemon count = %d, want 1", count)
	}
	waitForProcessExit(t, active)
	if pid, err := activeAgentSocketPID(socketPath); err != nil || pid != 0 {
		t.Fatalf("active socket owner after replacement = %d, err=%v", pid, err)
	}
}

func TestReconcileAgentDaemonsRejectsReplacingDifferentScopeOwner(t *testing.T) {
	root := t.TempDir()
	socketPath := filepath.Join(root, "agent.sock")
	readyFile := filepath.Join(root, "agent.ready")
	const selector = "demo@owner"

	active := startAgentReconcileHelper(t, "daemon", socketPath, readyFile, selector, "account-a")
	waitForAgentReadyFile(t, readyFile)

	if _, err := reconcileAgentDaemons(socketPath, selector, "account-b", true); err == nil || !strings.Contains(err.Error(), "does not match selector/account scope") {
		t.Fatalf("cross-scope replacement error = %v", err)
	}
	if err := syscall.Kill(active.Process.Pid, 0); err != nil {
		t.Fatalf("different-scope socket owner was terminated: %v", err)
	}
	assertAgentPing(t, socketPath, selector, "account-a")
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
	futureArgs := append(append([]string{}, args...), "--future-capability", "mux-v20")
	if !agentDaemonArgsMatch(futureArgs, "/tmp/agent.sock", "demo@owner", "account-a") {
		t.Fatal("future daemon arguments must not hide an otherwise exact stable scope")
	}
	equalsArgs := []string{
		"/usr/local/bin/lcmd-webshell-agent", "agent", "daemon",
		"--future-capability=mux-v20",
		"--socket=/tmp/agent.sock",
		"--selector=demo@owner",
		"--account=account-a",
	}
	if !agentDaemonArgsMatch(equalsArgs, "/tmp/agent.sock", "demo@owner", "account-a") {
		t.Fatal("equals-style stable daemon arguments did not match")
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

func runLegacyAgentReconcileHelper(args []string, opaqueProtocol bool) error {
	fs := flag.NewFlagSet("legacy agent daemon", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	socketPath := fs.String("socket", "", "")
	readyFile := fs.String("ready-file", "", "")
	selector := fs.String("selector", "", "")
	accountID := fs.String("account", "", "")
	_ = fs.String("username", "", "")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*socketPath) == "" {
		return errors.New("legacy helper socket is required")
	}
	listener, err := net.Listen("unix", *socketPath)
	if err != nil {
		return err
	}
	defer listener.Close()
	if err := writeAgentReadyFile(*readyFile); err != nil {
		return err
	}
	for {
		conn, err := listener.Accept()
		if err != nil {
			return err
		}
		go func() {
			defer conn.Close()
			var request agentRequest
			if err := json.NewDecoder(conn).Decode(&request); err != nil {
				return
			}
			if opaqueProtocol {
				_, _ = io.WriteString(conn, "future-wire-protocol\n")
				return
			}
			response := agentResponse{OK: true, Version: "lcmd-webshell-agent-v6"}
			if request.Selector != strings.TrimSpace(*selector) || request.AccountID != strings.TrimSpace(*accountID) {
				response.OK = false
				response.Error = "agent scope mismatch"
			}
			_ = json.NewEncoder(conn).Encode(response)
		}()
	}
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
