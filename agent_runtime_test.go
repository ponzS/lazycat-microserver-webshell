package main

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFastIntegrityForwarderWritesEncodedPayload(t *testing.T) {
	data, err := os.ReadFile("agent.go")
	if err != nil {
		t.Fatalf("ReadFile(agent.go) error = %v", err)
	}
	source := string(data)
	start := strings.Index(source, "func (d *agentDaemon) handleAttach(")
	end := strings.Index(source[start:], "func runAgentRequestClient(")
	if start < 0 || end < 0 {
		t.Fatal("handleAgentAttach source block not found")
	}
	block := source[start : start+end]
	if !strings.Contains(block, "frame, encodeErr := encodeFastBinaryFrame") {
		t.Fatal("Fast integrity frame encoding is missing")
	}
	if !strings.Contains(block, "writeAgentFrame(conn, frameType, payload)") {
		t.Fatal("Fast forwarder must write the encoded payload")
	}
	if strings.Contains(block, "writeAgentFrame(conn, frameType, outbound.payload)") {
		t.Fatal("Fast forwarder must not write the raw payload after encoding")
	}
}

func TestContainerUnavailableErrorStopsAgentEnsure(t *testing.T) {
	for _, err := range []error{
		errors.New(`runc state failed: container does not exist`),
		fmt.Errorf("wrapped: %w", errors.New("container does not exist")),
	} {
		if !isContainerUnavailableError(err) {
			t.Fatalf("isContainerUnavailableError(%v) = false, want true", err)
		}
	}
	if isContainerUnavailableError(errors.New("agent daemon temporarily unavailable")) {
		t.Fatal("ordinary agent failure must remain retryable")
	}
}

func TestEnsurePersistentAgentStopsBeforeInstallForMissingContainer(t *testing.T) {
	data, err := os.ReadFile("agent_runtime.go")
	if err != nil {
		t.Fatalf("ReadFile(agent_runtime.go) error = %v", err)
	}
	source := string(data)
	start := strings.Index(source, "func ensurePersistentAgentOnce(")
	end := strings.Index(source[start:], "func cachedInstanceUsername(")
	if start < 0 || end < 0 {
		t.Fatal("ensurePersistentAgentOnce source block not found")
	}
	block := source[start : start+end]
	stop := strings.Index(block, "if isContainerUnavailableError(preInstallPingErr) {")
	install := strings.Index(block, "ensureAgentBinaryInstalled(ctx, scope, trace)")
	if stop < 0 || install < 0 || stop > install {
		t.Fatal("missing-container guard must return before agent installation")
	}
	if !strings.Contains(block[stop:install], "return \"\", trace.errorf(") {
		t.Fatal("missing-container guard must terminate the current ensure")
	}
}

func TestAgentConnectionErrorPayloadIsRetryable(t *testing.T) {
	payload := agentConnectionErrorPayload(errors.New("agent unavailable"))
	if payload["type"] != "connection-error" {
		t.Fatalf("type = %v, want connection-error", payload["type"])
	}
	if payload["retryable"] != true {
		t.Fatalf("retryable = %v, want true", payload["retryable"])
	}
	if payload["message"] != "agent unavailable" {
		t.Fatalf("message = %v, want agent unavailable", payload["message"])
	}
}

func TestRunAgentRequestClientRejectsEmptyResponse(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("net.Listen() error = %v", err)
	}
	defer listener.Close()

	serverDone := make(chan error, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			serverDone <- acceptErr
			return
		}
		defer conn.Close()
		buffer := make([]byte, 256)
		_, readErr := conn.Read(buffer)
		serverDone <- readErr
	}()

	request := base64.StdEncoding.EncodeToString([]byte(`{"type":"ping"}`))
	err = runAgentRequestClient(socketPath, request)
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("runAgentRequestClient() error = %v, want io.ErrUnexpectedEOF", err)
	}
	if err := <-serverDone; err != nil {
		t.Fatalf("fake agent server error = %v", err)
	}
}

func TestParsePersistentAgentResponseRejectsEmptyOutput(t *testing.T) {
	if _, err := parsePersistentAgentResponse([]byte(" \n\t")); err == nil || !strings.Contains(err.Error(), "empty response") {
		t.Fatalf("parsePersistentAgentResponse(empty) error = %v, want empty response error", err)
	}
}

func TestParsePersistentAgentResponseSupportsPreviousProtocol(t *testing.T) {
	response, err := parsePersistentAgentResponse([]byte(`{"ok":true,"version":"lcmd-webshell-agent-v8"}`))
	if err != nil || response.Version != agentProtocolV8 {
		t.Fatalf("previous protocol response = %+v, err = %v", response, err)
	}

	_, err = parsePersistentAgentResponse([]byte(`{"ok":true,"version":"lcmd-webshell-agent-v6"}`))
	if !isUnsupportedAgentProtocolError(err) {
		t.Fatalf("protocol mismatch error = %v, want typed unsupported protocol error", err)
	}
	if isUnsupportedAgentProtocolError(errors.New("agent request timed out")) {
		t.Fatal("ordinary agent failure must not authorize active daemon replacement")
	}
}

func TestAgentAttachInfrastructureFailuresDoNotMasqueradeAsPaneExit(t *testing.T) {
	data, err := os.ReadFile("agent_runtime.go")
	if err != nil {
		t.Fatalf("ReadFile(agent_runtime.go) error = %v", err)
	}
	source := string(data)
	start := strings.Index(source, "func (s *pluginServer) attachAgentPane(")
	end := strings.Index(source[start:], "func writeWebSocketJSONLocked(")
	if start < 0 || end < 0 {
		t.Fatal("attachAgentPane source block not found")
	}
	block := source[start : start+end]
	for _, want := range []string{
		"agentConnectionErrorPayload(err)",
		"agentConnectionErrorPayload(ensureErr)",
		"agentConnectionErrorPayload(errors.New(text))",
		`"type":     "workspace-refresh-required"`,
	} {
		if !strings.Contains(block, want) {
			t.Fatalf("attach infrastructure recovery guard missing %q", want)
		}
	}
	if strings.Contains(block, `[]byte("\r\n[webshell error]`) {
		t.Fatal("agent startup failure must use a retryable control frame instead of mutating terminal history")
	}
}

func TestCachedAgentRuntimeArchiveReusesSuccessfulBuild(t *testing.T) {
	agentRuntimeArchiveCache.Lock()
	previousReady := agentRuntimeArchiveCache.ready
	previousPayload := agentRuntimeArchiveCache.payload
	previousManifest := agentRuntimeArchiveCache.manifest
	agentRuntimeArchiveCache.ready = false
	agentRuntimeArchiveCache.payload = nil
	agentRuntimeArchiveCache.manifest = ""
	agentRuntimeArchiveCache.Unlock()
	t.Cleanup(func() {
		agentRuntimeArchiveCache.Lock()
		agentRuntimeArchiveCache.ready = previousReady
		agentRuntimeArchiveCache.payload = previousPayload
		agentRuntimeArchiveCache.manifest = previousManifest
		agentRuntimeArchiveCache.Unlock()
	})

	firstPayload, firstManifest, err := cachedAgentRuntimeArchive()
	if err != nil {
		t.Fatalf("first cachedAgentRuntimeArchive() returned error: %v", err)
	}
	secondPayload, secondManifest, err := cachedAgentRuntimeArchive()
	if err != nil {
		t.Fatalf("second cachedAgentRuntimeArchive() returned error: %v", err)
	}

	if firstManifest == "" {
		t.Fatal("expected non-empty manifest")
	}
	if firstManifest != secondManifest {
		t.Fatalf("expected cached manifest %q, got %q", firstManifest, secondManifest)
	}
	if len(firstPayload) == 0 {
		t.Fatal("expected non-empty payload")
	}
	if len(firstPayload) != len(secondPayload) || &firstPayload[0] != &secondPayload[0] {
		t.Fatal("expected second call to reuse cached payload")
	}
}

func TestEnsurePersistentAgentReportsScopeOnReadyTimeout(t *testing.T) {
	scope := normalizeAgentScope("openclaw-86253ff1acf29126@cloud.lazycat.totoro", "c")
	err := fmt.Errorf("persistent webshell agent did not become ready: selector=%s account=%s socket=%s log=%s", scope.Selector, scope.AccountID, scopedAgentSocketPath(scope), scopedAgentLogPath(scope))
	if !strings.Contains(err.Error(), scope.Selector) || !strings.Contains(err.Error(), "socket=/tmp/lcmd-webshell-agent-") {
		t.Fatalf("expected scope details in error, got %v", err)
	}
}

func TestEnsurePersistentAgentPingsBeforeInstalling(t *testing.T) {
	data, err := os.ReadFile("agent_runtime.go")
	if err != nil {
		t.Fatalf("ReadFile(agent_runtime.go) error = %v", err)
	}
	source := string(data)
	start := strings.Index(source, "func ensurePersistentAgent(ctx context.Context, scope agentScope) (string, error) {")
	end := strings.Index(source, "func cachedInstanceUsername(ctx context.Context, selector string) (string, error) {")
	if start < 0 || end < 0 || end <= start {
		t.Fatal("ensurePersistentAgent source block not found")
	}
	block := source[start:end]
	pingIndex := strings.Index(block, "pingPersistentAgentError(ctx, scope)")
	installIndex := strings.Index(block, "ensureAgentBinaryInstalled(ctx, scope, trace)")
	if pingIndex < 0 || installIndex < 0 {
		t.Fatalf("expected ensurePersistentAgent to contain pre-install ping and install call")
	}
	if pingIndex > installIndex {
		t.Fatal("ensurePersistentAgent should ping an existing agent before installing a new binary")
	}
	for _, want := range []string{
		"if persistentAgentRunningCached(scope) {",
		`trace.add("pre-install ping succeeded")`,
		`trace.add("pre-install ping failed: %v", preInstallPingErr)`,
		"rememberIncompatiblePersistentAgentNotice(scope, preInstallPingErr)",
		"if isUnsupportedAgentProtocolError(preStartPingErr) {",
		`trace.add("active daemon requires an explicit protocol update")`,
		"return username, preStartPingErr",
	} {
		if !strings.Contains(block, want) {
			t.Fatalf("ensurePersistentAgent reuse guard missing %q", want)
		}
	}
	if strings.Contains(block, "reconcilePersistentAgentDaemons(ctx, scope, true, trace)") {
		t.Fatal("initialization must not replace an active agent without explicit confirmation")
	}
	pingSuccessBlock := sourceBetween(t, block,
		"if preInstallRunning {",
		"persistentAgentCache.Lock()")
	if strings.Contains(pingSuccessBlock, "return username, nil") {
		t.Fatal("a compatible daemon must not skip binary SHA verification and legacy daemon reconciliation")
	}
}

func TestEnsureAgentBinaryInstalledVerifiesCacheHit(t *testing.T) {
	data, err := os.ReadFile("agent_runtime.go")
	if err != nil {
		t.Fatalf("ReadFile(agent_runtime.go) error = %v", err)
	}
	source := string(data)
	start := strings.Index(source, "func ensureAgentBinaryInstalled(ctx context.Context, scope agentScope, trace *persistentAgentStartupTrace) (string, error) {")
	end := strings.Index(source, "func cachedAgentRuntimeArchive() ([]byte, string, error) {")
	if start < 0 || end < 0 || end <= start {
		t.Fatal("ensureAgentBinaryInstalled source block not found")
	}
	block := source[start:end]
	for _, want := range []string{
		"cacheHit := persistentAgentCache.installed[cacheKey] == manifest",
		`trace.add("install cache hit, verifying installed binary")`,
		`trace.addCommandResult("install check", output, err)`,
		`trace.add("install cache stale, reinstalling")`,
		`expected_hash=`,
		`sha256sum \"$agent\"`,
	} {
		if !strings.Contains(block, want) {
			t.Fatalf("ensureAgentBinaryInstalled cache verification missing %q", want)
		}
	}
	staleReturn := strings.Join([]string{
		"if persistentAgentCache.installed[cacheKey] == manifest {",
		"\t\tpersistentAgentCache.Unlock()",
		"\t\ttrace.add(\"install cache hit\")",
		"\t\treturn manifest, nil",
		"\t}",
	}, "\n")
	if strings.Contains(block, staleReturn) {
		t.Fatal("ensureAgentBinaryInstalled must not return before verifying cached installs")
	}
	if !strings.Contains(block, "buildAgentInstallScript(manifest, agentInstallPath, agentManifestPath)") {
		t.Fatal("ensureAgentBinaryInstalled must stage and atomically replace an existing agent")
	}
	if strings.Contains(block, "tar -xpf - -C /") {
		t.Fatal("ensureAgentBinaryInstalled must not extract directly over a running agent binary")
	}
}

func TestAgentInstallScriptReplacesExistingBinary(t *testing.T) {
	root := t.TempDir()
	installPath := filepath.Join(root, "usr", "local", "bin", "lcmd-webshell-agent")
	manifestPath := filepath.Join(root, "usr", "local", "bin", ".lcmd-webshell-agent.manifest")
	if err := os.MkdirAll(filepath.Dir(installPath), 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(installPath, []byte("old-agent"), 0o755); err != nil {
		t.Fatalf("WriteFile(old agent) error = %v", err)
	}
	if err := os.WriteFile(manifestPath, []byte("old-manifest"), 0o644); err != nil {
		t.Fatalf("WriteFile(old manifest) error = %v", err)
	}

	newAgent := []byte("new-agent")
	manifest := fmt.Sprintf("%s\t%x", agentProtocolVersion, sha256.Sum256(newAgent))
	var payload bytes.Buffer
	writer := tar.NewWriter(&payload)
	if err := writeAgentTarFile(writer, strings.TrimPrefix(installPath, "/"), newAgent, 0o755); err != nil {
		t.Fatalf("writeAgentTarFile(agent) error = %v", err)
	}
	if err := writeAgentTarFile(writer, strings.TrimPrefix(manifestPath, "/"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("writeAgentTarFile(manifest) error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("tar.Close() error = %v", err)
	}

	command := exec.Command("/bin/sh", "-lc", buildAgentInstallScript(manifest, installPath, manifestPath))
	command.Stdin = bytes.NewReader(payload.Bytes())
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("agent install script failed: %v\n%s", err, output)
	}
	if got := strings.TrimSpace(string(output)); got != agentReadyMarker {
		t.Fatalf("install output = %q, want %q", got, agentReadyMarker)
	}
	if data, err := os.ReadFile(installPath); err != nil || string(data) != "new-agent" {
		t.Fatalf("installed agent = %q, %v; want new-agent", data, err)
	}
	if data, err := os.ReadFile(manifestPath); err != nil || string(data) != manifest {
		t.Fatalf("installed manifest = %q, %v; want %q", data, err, manifest)
	}
	info, err := os.Stat(installPath)
	if err != nil || info.Mode().Perm() != 0o755 {
		t.Fatalf("installed agent mode = %v, %v; want 0755", info, err)
	}
	stagingDirs, err := filepath.Glob(filepath.Join(filepath.Dir(installPath), ".lcmd-webshell-agent.install.*"))
	if err != nil {
		t.Fatalf("Glob(staging dirs) error = %v", err)
	}
	if len(stagingDirs) != 0 {
		t.Fatalf("staging directories were not cleaned up: %v", stagingDirs)
	}
}

func TestAgentInstallScriptRejectsPayloadHashMismatch(t *testing.T) {
	root := t.TempDir()
	installPath := filepath.Join(root, "usr", "local", "bin", "lcmd-webshell-agent")
	manifestPath := filepath.Join(root, "usr", "local", "bin", ".lcmd-webshell-agent.manifest")
	if err := os.MkdirAll(filepath.Dir(installPath), 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(installPath, []byte("original-agent"), 0o755); err != nil {
		t.Fatalf("WriteFile(original agent) error = %v", err)
	}

	wantedAgent := []byte("wanted-agent")
	manifest := fmt.Sprintf("%s\t%x", agentProtocolVersion, sha256.Sum256(wantedAgent))
	var payload bytes.Buffer
	writer := tar.NewWriter(&payload)
	if err := writeAgentTarFile(writer, strings.TrimPrefix(installPath, "/"), []byte("tampered-agent"), 0o755); err != nil {
		t.Fatalf("writeAgentTarFile(agent) error = %v", err)
	}
	if err := writeAgentTarFile(writer, strings.TrimPrefix(manifestPath, "/"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("writeAgentTarFile(manifest) error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("tar.Close() error = %v", err)
	}

	command := exec.Command("/bin/sh", "-lc", buildAgentInstallScript(manifest, installPath, manifestPath))
	command.Stdin = bytes.NewReader(payload.Bytes())
	output, err := command.CombinedOutput()
	if err == nil || !strings.Contains(string(output), "sha256 mismatch") {
		t.Fatalf("agent install script error = %v, output = %q; want sha256 mismatch", err, output)
	}
	data, readErr := os.ReadFile(installPath)
	if readErr != nil || string(data) != "original-agent" {
		t.Fatalf("installed agent after rejected payload = %q, %v; want original-agent", data, readErr)
	}
}

func TestStartPersistentAgentChecksExecutableBeforeReadyMarker(t *testing.T) {
	data, err := os.ReadFile("agent_runtime.go")
	if err != nil {
		t.Fatalf("ReadFile(agent_runtime.go) error = %v", err)
	}
	source := string(data)
	start := strings.Index(source, "func startPersistentAgent(ctx context.Context, scope agentScope, username string, trace *persistentAgentStartupTrace) error {")
	end := strings.Index(source, "func persistentAgentStartupTimeoutError(ctx context.Context, scope agentScope, trace *persistentAgentStartupTrace) error {")
	if start < 0 || end < 0 || end <= start {
		t.Fatal("startPersistentAgent source block not found")
	}
	block := source[start:end]
	checkIndex := strings.Index(block, `[ ! -x "$agent" ]`)
	setsidIndex := strings.Index(block, `setsid "$agent" agent daemon`)
	readyIndex := strings.Index(block, `printf '%%s\n'`)
	if checkIndex < 0 {
		t.Fatal("startPersistentAgent should check agent executable before starting")
	}
	if setsidIndex < 0 || checkIndex > setsidIndex {
		t.Fatal("startPersistentAgent should check agent executable before setsid")
	}
	if readyIndex < 0 || checkIndex > readyIndex {
		t.Fatal("startPersistentAgent should check agent executable before printing ready marker")
	}
	for _, want := range []string{
		`--ready-file "$ready"`,
		`expected_ready=`,
		`if [ "$(cat "$ready" 2>/dev/null || true)" = "$expected_ready" ] && kill -0 "$pid"`,
		`agent daemon exited before readiness`,
	} {
		if !strings.Contains(block, want) {
			t.Fatalf("startPersistentAgent readiness guard missing %q", want)
		}
	}
	if strings.Contains(block, `rm -f "$socket"`) {
		t.Fatal("starter must not unlink a socket owned by a running daemon")
	}
}

func TestCommandOutputSnippetIncludesInvalidAgentResponse(t *testing.T) {
	output := []byte("time=\"2026-06-15\" level=error msg=\"missing agent\"\n")
	got := commandOutputSnippet(output)
	if !strings.Contains(got, "missing agent") {
		t.Fatalf("commandOutputSnippet() = %q, want output details", got)
	}

	empty := commandOutputSnippet([]byte(" \n\t"))
	if empty != "<empty>" {
		t.Fatalf("commandOutputSnippet(empty) = %q, want <empty>", empty)
	}
}

func TestPersistentAgentNoticeIsConsumedOnce(t *testing.T) {
	scope := normalizeAgentScope("demo@owner", "account-a")
	key := scope.cacheKey()
	persistentAgentCache.Lock()
	previous, hadPrevious := persistentAgentCache.notices[key]
	delete(persistentAgentCache.notices, key)
	persistentAgentCache.Unlock()
	t.Cleanup(func() {
		persistentAgentCache.Lock()
		if hadPrevious {
			persistentAgentCache.notices[key] = previous
		} else {
			delete(persistentAgentCache.notices, key)
		}
		persistentAgentCache.Unlock()
	})

	rememberIncompatiblePersistentAgentNotice(scope, &unsupportedAgentProtocolError{version: "old"})

	if got := consumePersistentAgentNotice(scope); !strings.Contains(got, "待更新") {
		t.Fatalf("consumePersistentAgentNotice() = %q, want protocol update notice", got)
	}
	if got := consumePersistentAgentNotice(scope); got != "" {
		t.Fatalf("second consumePersistentAgentNotice() = %q, want empty", got)
	}
}

func TestPersistentAgentAttachCommandArgsIncludeHistoryRange(t *testing.T) {
	scope := normalizeAgentScope("demo@owner", "account-a")
	args := persistentAgentAttachCommandArgs(scope, "pane-2", 132, 43, 22000, historySyncRequest{
		workspaceGeneration: "workspace-one",
		generation:          "generation-one",
		localBase:           12,
		localEnd:            34,
		hasRange:            true,
		forceSnapshot:       true,
	})
	joined := strings.Join(args, "\x00")
	for _, want := range []string{
		"--workspace-generation\x00workspace-one",
		"--history-generation\x00generation-one",
		"--local-base-cursor\x0012",
		"--local-end-cursor\x0034",
		"--history-replay-mode\x00snapshot",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("attach command args missing %q: %v", want, args)
		}
	}
}
