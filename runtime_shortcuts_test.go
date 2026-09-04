package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestNodeBehaviorTestsLiveUnderTestsDirectory(t *testing.T) {
	t.Helper()
	rootTests, err := filepath.Glob("*_test.mjs")
	if err != nil {
		t.Fatalf("Glob(root Node tests) error = %v", err)
	}
	if len(rootTests) != 0 {
		t.Fatalf("Node behavior tests must live under tests/: %v", rootTests)
	}
	testFiles, err := filepath.Glob(filepath.Join("tests", "*_test.mjs"))
	if err != nil {
		t.Fatalf("Glob(tests Node tests) error = %v", err)
	}
	if len(testFiles) == 0 {
		t.Fatal("tests/ must contain the Node behavior tests")
	}
}

// readRuntimeSource keeps source-based guards focused on the actual runtime
// implementation after the bootstrap entry moved into global-runtime.js.
// The alias copy keeps older source-composition guards useful while the real
// path remains available for boundary checks.
func readRuntimeSource(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(path, "runtime/static/global-runtime.js") {
		source := string(data)
		aliasLines := make([]string, 0)
		for _, line := range strings.Split(source, "\n") {
			if strings.Contains(line, `from "../`) {
				aliasLines = append(aliasLines, strings.ReplaceAll(line, `from "../`, `from "./`))
			}
		}
		return []byte(source + "\n" + strings.Join(aliasLines, "\n")), nil
	}
	return data, nil
}

func readRuntimeSources(t *testing.T, paths ...string) string {
	t.Helper()
	parts := make([]string, 0, len(paths))
	for _, path := range paths {
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		parts = append(parts, string(data))
	}
	return strings.Join(parts, "\n")
}

func readRuntimeTerminalConfig(t *testing.T) string {
	t.Helper()
	data, err := readRuntimeSource("runtime/static/terminal/config/terminal_config.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/config/terminal_config.js) error = %v", err)
	}
	return string(data)
}

func readRuntimeBootstrapSource(t *testing.T) string {
	t.Helper()
	return readRuntimeSources(t,
		"runtime/static/app/bootstrap/index.js",
		"runtime/static/app/bootstrap/bootstrap_controller.js",
		"runtime/static/app/bootstrap/bootstrap_lifecycle.js",
		"runtime/static/app/bootstrap/legacy_storage_cleanup_controller.js",
	)
}

func readRuntimeMainWithSessionState(t *testing.T) string {
	t.Helper()
	return readRuntimeSources(t,
		"runtime/static/global-runtime.js",
		"runtime/static/terminal/session/session_state.js",
		"runtime/static/terminal/rendering/presentation_controller.js",
		"runtime/static/terminal/rendering/presentation_lifecycle.js",
		"runtime/static/terminal/rendering/presentation_state.js",
		"runtime/static/terminal/rendering/presentation_view.js",
	)
}

func readRuntimeResizeSource(t *testing.T) string {
	t.Helper()
	return readRuntimeSources(t,
		"runtime/static/terminal/resize/resize_controller.js",
		"runtime/static/terminal/resize/resize_lifecycle.js",
		"runtime/static/terminal/resize/geometry_state.js",
		"runtime/static/terminal/resize/viewport_controller.js",
		"runtime/static/terminal/resize/terminal_resize_controller.js",
		"runtime/static/terminal/resize/terminal_resize_scheduler.js",
		"runtime/static/terminal/resize/terminal_size_sync.js",
	)
}

func readRuntimeInputSource(t *testing.T) string {
	t.Helper()
	return readRuntimeSources(t,
		"runtime/static/terminal/input/input_controller.js",
		"runtime/static/terminal/input/input_lifecycle.js",
		"runtime/static/terminal/input/input_model.js",
	)
}

func readRuntimeIMESource(t *testing.T) string {
	t.Helper()
	return readRuntimeSources(t,
		"runtime/static/terminal/input/ime/ime_controller.js",
		"runtime/static/terminal/input/ime/ime_lifecycle.js",
		"runtime/static/terminal/input/ime/ime_model.js",
	)
}

func readRuntimeMobileShortcutsSource(t *testing.T) string {
	t.Helper()
	return readRuntimeSources(t,
		"runtime/static/terminal/input/mobile_shortcuts/mobile_shortcuts_controller.js",
		"runtime/static/terminal/input/mobile_shortcuts/mobile_shortcuts_lifecycle.js",
	)
}

func readRuntimeViewportSource(t *testing.T) string {
	t.Helper()
	return readRuntimeSources(t,
		"runtime/static/terminal/viewport/viewport_controller.js",
		"runtime/static/terminal/viewport/viewport_lifecycle.js",
		"runtime/static/terminal/viewport/viewport_model.js",
	)
}

func readRuntimeOutputSource(t *testing.T) string {
	t.Helper()
	return readRuntimeSources(t,
		"runtime/static/terminal/output/output_controller.js",
		"runtime/static/terminal/output/output_lifecycle.js",
		"runtime/static/terminal/output/output_model.js",
	)
}

func readRuntimeProtocolSource(t *testing.T) string {
	t.Helper()
	return readRuntimeSources(t, "runtime/static/terminal/transport/session_protocol_controller.js")
}

func TestClientTerminalHistoryControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/client_terminal_history_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("client terminal history controller tests failed: %v\n%s", err, output)
	}
}

func TestLegacyWebShellStorageCleanupControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/legacy_storage_cleanup_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("legacy storage cleanup controller tests failed: %v\n%s", err, output)
	}
}

func TestLegacyServiceWorkerRetirementBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/legacy_service_worker_retirement_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("legacy service worker retirement tests failed: %v\n%s", err, output)
	}
}

func TestTerminalSessionReplayControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_session_replay_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal session replay controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalSessionConnectionControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_session_connection_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal session connection controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalSessionProtocolControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_session_protocol_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal session protocol controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalUnifiedTransportControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_unified_transport_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal unified transport controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalTransportRuntimeControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_transport_runtime_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal transport runtime controller tests failed: %v\n%s", err, output)
	}
}

func TestAppLifecycleBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/app_lifecycle_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("app lifecycle tests failed: %v\n%s", err, output)
	}
}

func TestTerminalReplayControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_replay_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal replay controller tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeClientTerminalRawReplayGuard(t *testing.T) {
	readSource := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}
	mainSource := readSource("runtime/static/global-runtime.js")
	protocolSource := readRuntimeProtocolSource(t)
	runtimeSource := mainSource + "\n" + protocolSource
	adapterSource := readSource("runtime/static/terminal/history/client_terminal_replay.js")

	for _, want := range []string{
		`from "./terminal/history/index.js";`,
		`const isClientDirectTransport = channel === "fast" && isClientInstanceName(session.name);`,
		`const clientReplayAdapter = isClientDirectTransport`,
		`? new ClientTerminalReplayAdapter(replayController)`,
		`clientReplayAdapter.begin({`,
		`clientReplayAdapter.acceptBinary({`,
		`clientReplayAdapter.complete({`,
		`isClientDirectTransport && session.historyProtocolActive`,
		`channel === "fast" && !isClientInstanceName(session.name) && session.fastIntegrityEnabled === true`,
		`usesMultiplexedTransport && session.queueReplayControllerActive`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("client raw replay runtime guard missing %q", want)
		}
	}
	for _, want := range []string{
		"export class ClientTerminalReplayAdapter",
		"this.controller.acceptBinary({",
		"this.controller.complete({",
		"endCursor = startCursor + BigInt(payload.byteLength)",
	} {
		if !strings.Contains(adapterSource, want) {
			t.Fatalf("client raw replay adapter guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"decodeFastBinaryFrame",
		"LCF1",
		"usesMultiplexedTransport",
		"terminalCacheV2",
	} {
		if strings.Contains(adapterSource, forbidden) {
			t.Fatalf("client raw replay adapter must remain transport-isolated, found %q", forbidden)
		}
	}
}

func TestRuntimeTerminalHistoryModuleBoundary(t *testing.T) {
	mainSource := string(mustReadRuntimeSource(t, "runtime/static/global-runtime.js"))
	protocolSource := string(mustReadRuntimeSource(t, "runtime/static/terminal/transport/session_protocol_controller.js"))
	indexSource := string(mustReadRuntimeSource(t, "runtime/static/terminal/history/index.js"))
	clientHistorySource := string(mustReadRuntimeSource(t, "runtime/static/terminal/history/client_history_controller.js"))
	for _, want := range []string{
		`createClientTerminalHistoryController,`,
		`const clientHistory = createClientTerminalHistoryController({`,
		`historyStore: createTerminalHistoryCache({ orphanTTL: terminalHistoryCacheOrphanTTL })`,
		`clientHistory.queueWrite(session, data, startCursor, endCursor)`,
		`workspace_generation: isClientInstanceName(session.name) ? "" : session.workspaceGeneration`,
	} {
		if !strings.Contains(mainSource+"\n"+protocolSource, want) {
			t.Fatalf("terminal history integration missing %q", want)
		}
	}
	for _, want := range []string{
		`export * from "./client_history_controller.js";`,
		`export * from "./client_terminal_replay.js";`,
		`export * from "./session_replay_controller.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal history public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createClientTerminalHistoryController({`,
		`const uses = (session) => Boolean(!disposed && session && !session.closed && isClientTarget(session.name));`,
		`historyStore.load(session.name, session.id)`,
		`historyStore.append(session.name, session.id, generation, chunks`,
	} {
		if !strings.Contains(clientHistorySource, want) {
			t.Fatalf("client terminal history controller missing %q", want)
		}
	}
	for _, forbidden := range []string{"cacheV2", "terminalCacheV2", "CacheStorage", "caches.open", "startWarmReplay", "schedulePreviewCapture"} {
		if strings.Contains(mainSource+"\n"+protocolSource+"\n"+clientHistorySource, forbidden) {
			t.Fatalf("removed container cache logic returned: %q", forbidden)
		}
	}
}

func TestTerminalRenderSnapshotBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_render_snapshot_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal render snapshot tests failed: %v\n%s", err, output)
	}
}

func TestTerminalResizeControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_resize_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal resize controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalInputControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_input_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal input controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalKeyOverridesControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_key_overrides_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal key overrides controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalPolicyControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_policy_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal policy controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalMetricsControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_metrics_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal metrics controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalWebSocketURLBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_websocket_url_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal WebSocket URL tests failed: %v\n%s", err, output)
	}
}

func TestTerminalThemeControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_theme_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal theme controller tests failed: %v\n%s", err, output)
	}
}

func TestUIIconsBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/ui_icons_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("UI icon tests failed: %v\n%s", err, output)
	}
}

func TestAppLayoutControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/app_layout_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("app layout controller tests failed: %v\n%s", err, output)
	}
}

func TestAppFeedbackControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/app_feedback_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("app feedback controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalMobileShortcutsControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_mobile_shortcuts_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal mobile shortcuts controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalOutputControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_output_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal output controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalViewportControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_viewport_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal viewport controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalResizeSchedulerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_resize_scheduler_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal resize scheduler tests failed: %v\n%s", err, output)
	}
}

func TestTerminalFrameReleaseSchedulerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_frame_release_scheduler_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal frame release scheduler tests failed: %v\n%s", err, output)
	}
}

func TestTerminalSessionControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_session_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal session controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalSessionRecoveryControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_session_recovery_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal session recovery controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalStartupErrorControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_startup_error_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal startup error controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalSessionResourceFactoryBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_session_resource_factory_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal session resource factory tests failed: %v\n%s", err, output)
	}
}

func TestTerminalTUIAdapterInstallationControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_tui_adapter_installation_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal TUI adapter installation tests failed: %v\n%s", err, output)
	}
}

func TestTerminalRendererAdapterBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_renderer_adapter_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal renderer adapter tests failed: %v\n%s", err, output)
	}
}

func TestTerminalPresentationControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_presentation_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal presentation controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalOverviewControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(
		node,
		"--test",
		"tests/terminal_overview_controller_test.mjs",
		"tests/terminal_overview_preview_test.mjs",
	)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal overview controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalContextMenuControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_context_menu_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal context menu controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalSearchControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_search_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal search controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalClipboardControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_clipboard_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal clipboard controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalLinkControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_link_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal link controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalMouseControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_mouse_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal mouse controller tests failed: %v\n%s", err, output)
	}
}

func TestTabActivationSchedulerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/tab_activation_scheduler_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("tab activation scheduler tests failed: %v\n%s", err, output)
	}
}

func TestAppearanceControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/appearance_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("appearance controller tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeResizeEpochAckGuard(t *testing.T) {
	mainSource := readRuntimeSources(t, "runtime/static/global-runtime.js")
	protocolSource := readRuntimeProtocolSource(t)
	resizeSource := readRuntimeResizeSource(t)
	outputSource := readRuntimeOutputSource(t)
	runtimeSource := strings.Join([]string{
		mainSource,
		readRuntimeTerminalConfig(t),
		protocolSource,
		readRuntimeMainWithSessionState(t),
		readRuntimeSources(t,
			"runtime/static/terminal/history/session_replay_controller.js",
			"runtime/static/terminal/history/session_replay_lifecycle.js",
		),
		resizeSource,
		outputSource,
	}, "\n")
	for _, want := range []string{
		"TerminalResizeController",
		"resizeController.request({",
		"resizeController.acknowledge({",
		"resizeController.fail({",
		"commitResize(session);",
		"createRenderSnapshot(session, { presented: true })",
		"session.renderSnapshot.equals(current)",
		"const resizeEpochSupported = session.resizeEpochSupported !== false;",
		"resize_epoch: resizeEpoch",
		"session.resizeAckPending = resizeEpochSupported;",
		"case \"resize-applied\":",
		"case \"resize-error\":",
		"const ackDimensions = {",
		"resize_ack_stale",
		"session.appliedResizeEpoch = epoch;",
		"const pendingResizeTarget = session.pendingResizeTarget;",
		"const metricsLiveGeometrySessions = new Set();",
		"const beginMetricsLiveGeometry = (session) => (",
		"const updateMetricsLiveGeometry = (session, options = {}) => {",
		"const endMetricsLiveGeometry = (session) => endLiveGeometryForSource(",
		"const renderAllowed = (session) => {",
		"const liveGeometry = isLiveGeometryActive(session);",
		"(liveGeometry || !session.resizeAckPending)",
		"replay_presentation_checkpoint_skipped",
		"recordEvent(session, \"render_blocked\"",
		"reason: isPaneVisible(session) ? \"presentation_validation\" : \"presentation_wait_measure\",",
		"const resizeRequestInFlight = Boolean(",
		"reusedPendingRequest: true,",
		"queuedBehindRequest: session.requestedResizeEpoch,",
		"const isAlternateScreen = (term) => Boolean(",
		"term?.buffer?.active?.type === \"alternate\"",
		"terminalResizeOutputQuietMs: 120,",
		"terminalResizeOutputMaxHoldMs: 800,",
		"session.resizeFenceActive = true;",
		"session.resizeFenceTarget = {",
		"sendSize(session, {",
		"dimensions: targetDimensions,",
		"const applyFence = (session) => {",
		"outputFlushBudgetBytes",
		"session.resizeFenceDrainRemainingEntries = getOutputQueueEntryCount(session);",
		"maxBytes: outputFlushBudgetBytes,",
		"maxEntries: session.resizeFenceDrainRemainingEntries,",
		"scheduleRemainder: false,",
		"session.term.resize(target.cols, target.rows);",
		"beginRenderSuppression(session, \"resize\");",
		"endRenderSuppression(session, { render: false, reason: \"resize\" });",
		"const finishOutputSettle = (session, reason = \"quiet\") => {",
		"session.resizeOutputSettleActive = true;",
		"resize_output_settle_start",
		"resize_output_settle_complete",
		"const outputSettleActive = session?.resizeOutputSettleActive === true;",
		"active: outputSettleActive || session?.resizeFenceActive === true,",
		"const suppressRender = (deferRender || resizeTransition.active) && !replayOutput;",
		"replayOutput ? \"write_replay\" : \"write_suppressed\"",
		"reason: \"legacy_resize\"",
		"session.term.writeReplay(data);",
		"session.resizeAckPending",
		"const commitIfReady = (session) => {",
		"const markRendered = (session) => {",
		"const scheduleRetry = (session, {",
		"presentationRetryPending: false,",
		"recordEvent(session, \"presentation_render_failed\")",
		"recordEvent(session, \"presentation_commit_complete\"",
		"const resizeProtocol = String(message?.resize_protocol || \"\").trim();",
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime resize epoch ACK guard missing %q", want)
		}
	}
	resizeBlock := sourceBetween(t, resizeSource,
		"const resizePane = (session, {",
		"lifecycle = lifecycleFactory({")
	if !strings.Contains(resizeBlock, "shouldCommitAfterHold && !session.resizeAckPending") {
		t.Fatal("resize presentation must not commit before resize ACK")
	}
	if !strings.Contains(resizeBlock, "!shouldCommitAfterHold && !session.resizeAckPending") {
		t.Fatal("resize presentation must not settle before resize ACK")
	}
	if !strings.Contains(resizeBlock, "const resizeOutputSettlePending = session.resizeOutputSettleActive === true;") ||
		!strings.Contains(resizeBlock, "!resizeOutputSettlePending") {
		t.Fatal("resize presentation must remain hidden while post-ACK PTY output settles")
	}
	applyIndex := strings.Index(resizeSource, "const applyFence = (session) => {")
	settleIndex := strings.Index(resizeSource, "scheduleOutputSettle(session)")
	if applyIndex < 0 || settleIndex < 0 || applyIndex > settleIndex {
		t.Fatal("resize ACK must enter the bounded output settle barrier before the final render")
	}
	writeIndex := strings.Index(outputSource, "const suppressRender = (deferRender || resizeTransition.active) && !replayOutput;")
	if writeIndex < 0 || writeIndex < strings.Index(outputSource, "const write = (session, data, {") {
		t.Fatal("resize output must be render-suppressed while the settle barrier is active")
	}
	for _, forbidden := range []string{
		"const sendTerminalSize =",
		"const applyTerminalResizeFence =",
		"const resizePane =",
		"const schedulePaneResize =",
		"const installTerminalResizeObserver =",
		"new TerminalResizeController(",
		"session.requestedResizeEpoch =",
		"session.appliedResizeEpoch =",
		"session.resizeAckPending =",
		"session.resizeFenceActive =",
		"session.resizeFenceTarget =",
		"session.resizeOutputSettleActive =",
		"session.serverCols =",
		"session.serverRows =",
		"session.sizeClaimRequired =",
		`sendControl: (session, payload) => {`,
		`socket.send(JSON.stringify(payload));`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain resize implementation or state ownership %q", forbidden)
		}
	}
	if !strings.Contains(resizeSource, `sendControl = (session, payload) => {`) {
		t.Fatal("terminal resize controller must own the default control serializer")
	}
}

func TestRuntimeCrossClientResizeDoesNotAutoReclaim(t *testing.T) {
	mainSource := readRuntimeSources(t, "runtime/static/global-runtime.js")
	protocolSource := readRuntimeProtocolSource(t)
	resizeSource := readRuntimeResizeSource(t)
	activitySource := readRuntimeSources(t, "runtime/static/workspace/activity_controller.js")
	runtimeSource := mainSource + "\n" + protocolSource + "\n" + resizeSource + "\n" + activitySource
	presentationData, err := readRuntimeSource("runtime/static/terminal/rendering/presentation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(presentation_controller.js) error = %v", err)
	}
	presentationSource := string(presentationData)
	for _, want := range []string{
		`const sendSize = (session, { force = false, dimensions = null, claim = false } = {}) => {`,
		`...(claim ? { claim: true } : {}),`,
		`const applyObservedResize = (session, message) => {`,
		`const remoteEpoch = Boolean(requestedEpoch && BigInt(epoch) > BigInt(requestedEpoch));`,
		`applyObservedResize(session, message);`,
		`claimSize: true,`,
		`suppressTerminalResizeSend`,
	} {
		if !strings.Contains(resizeSource, want) {
			t.Fatalf("cross-client resize ownership guard missing %q", want)
		}
	}
	ackBlock := sourceBetween(t, resizeSource,
		`const handleApplied = (session, message) => {`,
		`const handleError = (session, message) => {`,
	)
	remoteIndex := strings.Index(ackBlock, `const remoteEpoch = Boolean(`)
	applyIndex := strings.Index(ackBlock, `applyObservedResize(session, message);`)
	if !strings.Contains(ackBlock, "applyObservedResize(session, message);") {
		t.Fatal("same-epoch normalized resize ACK must be applied locally")
	}
	if remoteIndex < 0 || applyIndex < 0 {
		t.Fatal("resize ACK handling must include remote epoch adoption")
	}
	guardStart, guardEnd := remoteIndex, applyIndex
	if guardStart > guardEnd {
		guardStart, guardEnd = guardEnd, guardStart
	}
	if strings.Contains(ackBlock[guardStart:guardEnd], `claimSize(session`) ||
		strings.Contains(ackBlock[guardStart:guardEnd], `claimForCurrentDevice(session`) {
		t.Fatal("remote resize ACK must not automatically reclaim the local device size")
	}
	workspaceData, err := readRuntimeSource("workspace.go")
	if err != nil {
		t.Fatalf("ReadFile(workspace.go) error = %v", err)
	}
	workspaceSource := string(workspaceData)
	for _, want := range []string{
		`resize_owner_active`,
		`!message.Claim`,
		`resizeOwner                *paneClient`,
		`ownerActive && !message.Claim && epoch != currentEpoch && source != owner`,
		`ownerReleased := p.resizeOwner == client`,
		`p.resizeOwner = nil`,
		`"type":         "resize-owner-released"`,
	} {
		if !strings.Contains(workspaceSource, want) {
			t.Fatalf("server resize owner lifecycle guard missing %q", want)
		}
	}
	agentData, err := readRuntimeSource("agent.go")
	if err != nil {
		t.Fatalf("ReadFile(agent.go) error = %v", err)
	}
	attachBlock := sourceBetween(t, string(agentData),
		"func (d *agentDaemon) handleAttach(",
		"func runAgentRequestClient(")
	if strings.Contains(attachBlock, "pane.resize(request.Cols, request.Rows)") {
		t.Fatal("attaching a device must not resize the shared PTY outside resize owner arbitration")
	}
	for _, want := range []string{
		`const handleOwnerReleased = (session, message) => {`,
		`case "resize-owner-released":`,
		`terminalResize.handleOwnerReleased(session, message);`,
		`forceSizeSync: true,`,
		`recoverSessions(getCurrentTab()?.panes?.values?.() || []);`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("cross-device resize/presentation recovery guard missing %q", want)
		}
	}
	for _, want := range []string{
		`const recoverStalled = (session, now = Date.now()) => {`,
		`presentationStallTimeoutMs = 12 * 1000,`,
		`presentationStallReconnectLimit = 2,`,
		`recoverTransport(session, "presentation stalled after replay commit", { immediate: true });`,
	} {
		if !strings.Contains(presentationSource, want) {
			t.Fatalf("presentation stall recovery guard missing %q", want)
		}
	}
}

func TestRuntimeTabActivationPresentationRecoveryGuard(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	mainSource := string(data)
	protocolSource := readRuntimeProtocolSource(t)
	source := mainSource
	presentationData, err := readRuntimeSource("runtime/static/terminal/rendering/presentation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(presentation_controller.js) error = %v", err)
	}
	presentationSource := string(presentationData)
	resizeSource := readRuntimeResizeSource(t)
	outputSource := readRuntimeOutputSource(t)
	replaySource := readRuntimeSources(t,
		"runtime/static/terminal/history/session_replay_controller.js",
		"runtime/static/terminal/history/session_replay_lifecycle.js",
		"runtime/static/terminal/history/session_replay_state.js",
	)
	runtimeSource := source + "\n" + protocolSource + "\n" + replaySource + "\n" + resizeSource + "\n" + outputSource
	for _, want := range []string{
		"reason: \"history_replay_complete\"",
		"presentation()?.scheduleFrame(session, \"tab_activated\")",
		"reason: \"resize_applied\"",
		"reason: \"resize_error\"",
		"schedulePresentationCheckpoint: lifecycle.scheduleCheckpoint,",
		"session.replayPresentationCheckpointPending",
		"replay_presentation_checkpoint_skipped",
		"session.replayPresentationCheckpointTimer",
		`flow_control: "turn-ack-v1"`,
		`case "queue-turn-complete":`,
		`type: "queue-turn-ack"`,
		"data: `${pending.cursor.toString()}:${pending.sequence}`",
		`state.queueTurnReceivedCursor = null`,
		`state.queueTurnReceivedSequence = null`,
		`state.pendingQueueTurnAck = null`,
		`queue turn acknowledgement boundary does not match received output`} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime tab presentation recovery guard missing %q", want)
		}
	}
	for _, want := range []string{
		`const defer = (session, reason = "hidden") => {`,
		`const retryPendingResize = (session, reason) => {`,
		`const ensure = (session, {`,
		`session.resizeFenceActive || session.resizeAckPending || session.resizeOutputSettleActive`,
		`presentationResizeRetryMs = 1200,`,
		`lastResizeRequestAt`,
		`presentationValidationAttempts`,
		`const scheduleFrame = (session, reason = "presentation_frame", {`,
		`presentationValidationMaxMs = 250,`,
		`fullRenderValidationMs = 32,`,
		`scheduleFrame(session, "render_callback");`,
	} {
		if !strings.Contains(presentationSource, want) {
			t.Fatalf("terminal presentation recovery guard missing %q", want)
		}
	}

	ensureBlock := sourceBetween(t, presentationSource,
		"const ensure = (session, {",
		"const scheduleFrame = (session, reason = \"presentation_frame\", {")
	if !strings.Contains(ensureBlock, "!isPaneVisible(session) || !isPaneMeasurable(session)") ||
		!strings.Contains(ensureBlock, "defer(session") {
		t.Fatal("hidden replay completion must defer presentation until the pane is visible and measurable")
	}
	if !strings.Contains(ensureBlock, "retryPendingResize(session, reason);") ||
		!strings.Contains(ensureBlock, "scheduleResize(session, {") {
		t.Fatal("visible presentation recovery must wait for resize ACKs and re-enter the resize scheduler")
	}
	if strings.Contains(ensureBlock, "session.term.resize(") || strings.Contains(ensureBlock, "claim: true") {
		t.Fatal("presentation recovery must not bypass the resize fence or automatically claim another device's size")
	}
	retryBlock := sourceBetween(t, presentationSource,
		"const retryPendingResize = (session, reason) => {",
		"const ensure = (session, {")
	if strings.Contains(retryBlock, "claim:") {
		t.Fatal("a presentation timeout must retry resize passively and never replay a stale explicit claim")
	}
	if strings.Contains(presentationSource, "presentationValidationMaxMs = 1000") {
		t.Fatal("tab presentation validation must not retain the one-second fallback delay")
	}

	if !strings.Contains(replaySource, "ensurePresentation(session, {") ||
		!strings.Contains(replaySource, "reason: \"history_replay_complete\"") ||
		strings.Contains(replaySource, "renderFullNow(session)") {
		t.Fatal("history replay completion must use the visibility-aware presentation gate")
	}

	queueTurnBlock := sourceBetween(t, protocolSource,
		`case "queue-turn-complete":`,
		`case "agent-preparing":`)
	if !strings.Contains(queueTurnBlock, "completeQueueTurn") || strings.Contains(queueTurnBlock, "terminalPresentation.ensure(session, {") {
		t.Fatal("Queue turn completion must not directly start a presentation render")
	}
	for _, forbidden := range []string{
		"const deferPanePresentation =",
		"const retryPendingPaneResize =",
		"const ensurePanePresentation =",
		"const schedulePanePresentationFrame =",
		"const recoverStalledPanePresentation =",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("main.js must not retain presentation implementation %q", forbidden)
		}
	}
}

func TestRuntimeReplayRetryBudgetPreservesPresentation(t *testing.T) {
	source := readRuntimeSources(t,
		"runtime/static/global-runtime.js",
		"runtime/static/terminal/config/terminal_config.js",
		"runtime/static/app/runtime_recovery_controller.js",
		"runtime/static/terminal/history/session_replay_controller.js",
		"runtime/static/terminal/history/session_replay_state.js",
		"runtime/static/terminal/transport/session_protocol_controller.js",
	)
	for _, want := range []string{
		`terminalReplayFailureLimit: 3,`,
		`const noteFailure = (session, reason = "replay_failed") => {`,
		`session.replayRetryPaused = true;`,
		`beginPresentationHold(session);`,
		`const resumeRetry = (session, reason = "user_recovery") => {`,
		`resumeReplayRetry(pane, "user_recovery");`,
		`resumeReplayRetry(pane, "network_online");`,
		`if (probe && isReplayRetryPaused(pane)) {`,
		`const nextConnectionState = terminalReplay.isRetryPaused(session)`,
		`terminalReplay.isRetryPaused(session)`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime replay retry budget guard missing %q", want)
		}
	}
	pauseBlock := sourceBetween(t, source,
		`const noteFailure = (session, reason = "replay_failed") => {`,
		`const resumeRetry = (session, reason = "user_recovery") => {`)
	for _, forbidden := range []string{
		`replayController.commit`,
		`historyStateReady = true`,
		`flushPendingInput`,
		`savePreview`,
		`putManifest`,
	} {
		if strings.Contains(pauseBlock, forbidden) {
			t.Fatalf("partial replay failure pause must remain presentation-only: found %q", forbidden)
		}
	}
}

func TestRuntimeTerminalMultiplexedIdentityGate(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	source := string(data)
	source += "\n" + readRuntimeProtocolSource(t)
	for _, want := range []string{
		"const validateTerminalChannelMessageIdentity = (event, messageType = \"\", isBinary = false) => {",
		"const metadata = event?.queueMetadata;",
		"const expectedStreamID = String(session.unifiedStreamID).trim();",
		"return !isBinary && messageType === \"agent-preparing\";",
		"const rejectMismatchedChannelMessage = (event, messageType) => {",
		"session.resetOnNextReplay = true;",
		"terminalPresentation.beginHold(session);",
		"return (!selector || selector === session.name)",
		"every identity field that",
		"Terminal multiplexed message identity validation failed.",
		"if (!validateTerminalChannelMessageIdentity(event, message.type, false)) {",
		"if (!validateTerminalChannelMessageIdentity(event, \"\", true)) {",
		"rejectMismatchedChannelMessage(event, message.type);",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime multiplexed terminal identity guard missing %q", want)
		}
	}
	messageBlock := sourceBetween(t, source,
		"currentSocket.addEventListener(\"message\", (event) => {",
		"currentSocket.addEventListener(\"close\", (event) => {")
	controlIndex := strings.Index(messageBlock, "validateTerminalChannelMessageIdentity(event, message.type, false)")
	binaryIndex := strings.Index(messageBlock, "validateTerminalChannelMessageIdentity(event, \"\", true)")
	switchIndex := strings.Index(messageBlock, "switch (message.type)")
	binaryReplayIndex := strings.Index(messageBlock, "if (!terminalReplay.isAuthorized(session) && !terminalReplay.isCommitted(session)) {")
	if controlIndex < 0 || binaryIndex < 0 || switchIndex < 0 || binaryReplayIndex < 0 {
		t.Fatal("multiplexed terminal identity gate must cover control and binary messages")
	}
	if controlIndex > switchIndex || binaryIndex > binaryReplayIndex {
		t.Fatal("multiplexed terminal identity must be checked before control dispatch or binary replay handling")
	}
}

func TestRuntimeTerminalDiagnosticTimelineGuard(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	timelineData, err := readRuntimeSource("runtime/static/diagnostics/terminal_timeline.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/terminal_timeline.js) error = %v", err)
	}
	presentationData, err := readRuntimeSource("runtime/static/terminal/rendering/presentation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(presentation_controller.js) error = %v", err)
	}
	mainSource := string(mainData)
	protocolSource := readRuntimeProtocolSource(t)
	timelineSource := string(timelineData)
	presentationSource := string(presentationData)
	resizeSource := readRuntimeResizeSource(t)
	runtimeSource := mainSource + "\n" + protocolSource + "\n" + resizeSource
	for _, want := range []string{
		"const timelines = new WeakMap();",
		"const record = (session, type, details = {}) => {",
		"channelGeneration: Number(session.connectionChannelGeneration || 0),",
		"attachGeneration: Number(session.terminalReplayGeneration || 0),",
		"receivedCursor: session.receivedHistoryCursor?.toString?.() || \"\",",
		"if (timeline.length > limit) {",
	} {
		if !strings.Contains(timelineSource, want) {
			t.Fatalf("diagnostics terminal timeline module missing %q", want)
		}
	}
	for _, want := range []string{
		"recordTerminalSessionEvent,",
		"recordEvent: (session, event, details) => recordTerminalSessionEvent(session, event, details),",
		"recordEvent(session, \"resize_request\",",
		"recordEvent(session, \"resize_applied\",",
		"recordTerminalSessionEvent(session, \"history_replay_start\",",
		"recordTerminalSessionEvent(session, \"history_replay_complete\",",
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime terminal diagnostic timeline missing %q", want)
		}
	}
	if !strings.Contains(mainSource, `recordEvent: (session, event, details) => recordTerminalSessionEvent(session, event, details),`) ||
		!strings.Contains(presentationSource, `recordEvent(session, "full_render_complete", canvasDetails(session));`) {
		t.Fatal("terminal presentation completion must remain routed into the diagnostics timeline")
	}
	if strings.Contains(mainSource, "terminalEventTimeline:") {
		t.Fatal("terminal diagnostic timeline state must remain owned by diagnostics instead of the business session object")
	}
}

func TestTerminalNetworkMonitorBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_network_monitor_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal network monitor tests failed: %v\n%s", err, output)
	}
}

func TestDiagnosticsControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/diagnostics_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("diagnostics controller tests failed: %v\n%s", err, output)
	}
}

func TestDiagnosticsNetworkContextBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/diagnostics_network_context_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("diagnostics network context tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeDiagnosticsModuleBoundary(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	indexData, err := readRuntimeSource("runtime/static/diagnostics/index.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/index.js) error = %v", err)
	}
	readmeData, err := readRuntimeSource("runtime/static/diagnostics/README.md")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/README.md) error = %v", err)
	}
	networkContextData, err := readRuntimeSource("runtime/static/diagnostics/network_context.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/network_context.js) error = %v", err)
	}

	mainSource := string(mainData)
	indexSource := string(indexData)
	readmeSource := string(readmeData)
	networkContextSource := string(networkContextData)

	if !strings.Contains(mainSource, `from "./diagnostics/index.js";`) {
		t.Fatal("main.js must consume diagnostics through its public entry")
	}
	for _, forbidden := range []string{
		`from "./diagnostics/diagnostics_controller.js"`,
		`from "./diagnostics/debug_log.js"`,
		`from "./diagnostics/network_monitor.js"`,
		`from "./diagnostics/performance_tasks.js"`,
		"if (terminalNetworkMonitor)",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not deep import diagnostics internals %q", forbidden)
		}
	}
	for _, want := range []string{
		`export { createDiagnosticsController } from "./diagnostics_controller.js";`,
		`export { createDiagnosticsNetworkContext } from "./network_context.js";`,
		`export { createStartupDiagnostics } from "./startup_trace.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("diagnostics public entry missing %q", want)
		}
	}
	for _, want := range []string{
		"export function createDiagnosticsNetworkContext",
		"return function getNetworkContext()",
		"layout: direct ? \"direct\" : \"unified\"",
	} {
		if !strings.Contains(networkContextSource, want) {
			t.Fatalf("diagnostics network context implementation missing %q", want)
		}
	}
	for _, want := range []string{
		"createDiagnosticsNetworkContext({",
		"getNetworkContext: getDiagnosticsNetworkContext,",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("global runtime diagnostics wiring missing %q", want)
		}
	}
	for _, want := range []string{
		"for (const tab of getTabs() || [])",
		"sockets.push({ socket, kind: \"unified\" })",
	} {
		if !strings.Contains(networkContextSource, want) {
			t.Fatalf("diagnostics network snapshot owner missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"getNetworkContext: () => {",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("global runtime must not inline diagnostics network snapshot logic %q", forbidden)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口",
		"## 状态所有权",
		"## 生命周期",
		"## 文件清单",
		"## 依赖方向",
		"## 测试与回归",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("diagnostics README missing %q", want)
		}
	}

	for _, legacyPath := range []string{
		"runtime/static/performance_tasks.js",
		"runtime/static/terminal_network_monitor.js",
	} {
		if _, err := os.Stat(legacyPath); !os.IsNotExist(err) {
			t.Fatalf("legacy diagnostics module path must be removed: %s", legacyPath)
		}
	}
}

func TestTerminalConfigBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_config_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal config tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeTerminalConfigModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/terminal/config/index.js")
	configSource := read("runtime/static/terminal/config/terminal_config.js")
	readmeSource := read("runtime/static/terminal/config/README.md")

	if !strings.Contains(mainSource, `from "./terminal/config/index.js";`) {
		t.Fatal("global runtime must consume terminal config through its public entry")
	}
	for _, forbidden := range []string{
		"const touchShortcutMoveThresholdPx =",
		"const terminalWebSocketPingIntervalMs =",
		"const terminalCacheV2CommitTimeoutMs =",
		"const activityPollIntervalMs =",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("global runtime must not redeclare terminal config %q", forbidden)
		}
	}
	for _, want := range []string{
		`export {`,
		`TERMINAL_RUNTIME_CONFIG,`,
		`TERMINAL_STORAGE_PREFIX,`,
		`from "./terminal_config.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal config public entry missing %q", want)
		}
	}
	for _, want := range []string{
		"export const TERMINAL_STORAGE_PREFIX",
		"export const TERMINAL_RUNTIME_CONFIG = Object.freeze({",
		"terminalClientDirectWebSocketCapacity: 3",
	} {
		if !strings.Contains(configSource, want) {
			t.Fatalf("terminal config implementation missing %q", want)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口",
		"## 文件清单",
		"## 状态与生命周期",
		"## 依赖方向与验证",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal config README missing %q", want)
		}
	}

}

func TestRuntimeAppLifecycleModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/app/index.js")
	lifecycleSource := read("runtime/static/app/app_lifecycle.js")
	mobileSelectSource := read("runtime/static/app/mobile_select_controller.js")
	readmeSource := read("runtime/static/app/README.md")

	for _, want := range []string{
		`createAppLifecycle,`,
		`createMobileSelectController,`,
		`from "./app/index.js";`,
		`mobileSelect = createMobileSelectController({`,
		`mobileSelect?.dispose();`,
		`appLifecycle = createAppLifecycle({`,
		`appLifecycle.start();`,
		`appLifecycle?.dispose();`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main app lifecycle integration missing %q", want)
		}
	}
	for _, want := range []string{
		`export { createMobileSelectController } from "./mobile_select_controller.js";`,
		`export function createMobileSelectController({`,
		`const openFromEvent = (event) => {`,
		`const install = () => {`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(indexSource+"\n"+mobileSelectSource, want) {
			t.Fatalf("mobile select module guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"mobileCustomSelectState",
		"const ensureMobileCustomSelectPopover =",
		"const handleMobileCustomSelectOpenEvent =",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("app controller must not retain mobile select implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`export { createAppLifecycle } from "./app_lifecycle.js";`,
		`export function createAppLifecycle({`,
		`listen(windowObject, "online", handlers.onOnline);`,
		`listen(windowObject, "offline", handlers.onOffline);`,
		`listen(documentObject, "visibilitychange", handlers.onVisibilityChange);`,
		`listen(windowObject, "beforeunload", handlers.onBeforeUnload);`,
		`heartbeatTimer = windowObject.setInterval`,
		`generation += 1;`,
		`handlers.onDispose?.();`,
	} {
		if !strings.Contains(indexSource+"\n"+lifecycleSource, want) {
			t.Fatalf("app lifecycle module guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`new WebSocket`,
		`history_replay`,
		`renderFullNow`,
		`terminalPresentation`,
	} {
		if strings.Contains(lifecycleSource, forbidden) {
			t.Fatalf("app lifecycle must not own terminal implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		"应用启动入口",
		"start()",
		"dispose()",
		"generation",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("app README missing %q", want)
		}
	}
}

func TestAppRuntimeRecoveryControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/app_runtime_recovery_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("app runtime recovery tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeAppRecoveryModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/app/index.js")
	controllerSource := read("runtime/static/app/runtime_recovery_controller.js")
	lifecycleSource := read("runtime/static/app/runtime_recovery_lifecycle.js")
	readmeSource := read("runtime/static/app/README.md")

	for _, want := range []string{
		`createAppRuntimeRecoveryController,`,
		`from "./app/index.js";`,
		`runtimeRecovery = createAppRuntimeRecoveryController({`,
		`onOnline: () => runtimeRecovery?.handleOnline(),`,
		`onOffline: () => runtimeRecovery?.handleOffline(),`,
		`onVisibilityChange: () => runtimeRecovery?.handleVisibilityChange({ hidden: document.hidden }),`,
		`runtimeRecovery?.dispose();`,
		`export { createAppRuntimeRecoveryController } from "./runtime_recovery_controller.js";`,
		`export { createAppRuntimeRecoveryLifecycle } from "./runtime_recovery_lifecycle.js";`,
	} {
		if !strings.Contains(appSource+"\n"+indexSource, want) {
			t.Fatalf("app runtime recovery public wiring missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createAppRuntimeRecoveryController({`,
		`const reconnectVisibleSessions = ({ allowHidden = false, probe = false } = {}) => {`,
		`const reconnectWorkspaceSessions = ({ allowHidden = true } = {}) => {`,
		`const handleOnline = () => {`,
		`Promise.resolve(waitForUnifiedClosures()).then(() => {`,
		`if (!lifecycle.isCurrent(generation) || !isOnline()) {`,
		`const handleOffline = () => {`,
		`const handleVisibilityChange = ({ hidden = false } = {}) => {`,
		`export function createAppRuntimeRecoveryLifecycle({`,
		`const shouldRecoverFromUserGesture = () => {`,
		`disposed = true;`,
	} {
		if !strings.Contains(controllerSource+"\n"+lifecycleSource, want) {
			t.Fatalf("app runtime recovery module missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"writeReplay",
		"term.write",
		"canvas.getContext",
	} {
		if strings.Contains(controllerSource, forbidden) || strings.Contains(lifecycleSource, forbidden) {
			t.Fatalf("app runtime recovery crosses terminal implementation boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		`let lastNetworkBannerState =`,
		`let terminalUserRecoveryLastAt =`,
		`const markWorkspaceSessionsOffline =`,
		`terminalUnifiedTransport.waitForClosures().then(`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain runtime recovery implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		"runtime_recovery_controller.js",
		"runtime_recovery_lifecycle.js",
		"Unified close fence",
		"迟到 close-wait 回调",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("app README recovery boundary missing %q", want)
		}
	}

}

func TestAppDOMRegistryBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/app_dom_registry_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("app DOM registry tests failed: %v\n%s", err, output)
	}
}

func TestAppServerRevisionControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/app_server_revision_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("app server revision tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeAppServerRevisionModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/app/index.js")
	controllerSource := read("runtime/static/app/server_revision/server_revision_controller.js")
	apiSource := read("runtime/static/app/server_revision/server_revision_api.js")
	lifecycleSource := read("runtime/static/app/server_revision/server_revision_lifecycle.js")
	readmeSource := read("runtime/static/app/server_revision/README.md")

	for _, want := range []string{
		`createServerRevisionController,`,
		`from "./app/index.js";`,
		`serverRevision = createServerRevisionController({`,
		`clientID: serverRevision.getClientID(),`,
		`observeServerRevision: (state) => serverRevision.observe(state),`,
		`isInputBlocked: () => serverRevision.isDialogOpen(),`,
		`serverRevision.clearStartupInputLock()`,
		`serverRevision?.dispose();`,
		`serverRevision.scheduleInitialCheck();`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("app server revision integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"function loadStableClientID()",
		"currentServerRevision",
		"serverRevisionReloadPrompted",
		"serverRevisionInitialCheckTimer",
		"const serverRevisionURL =",
		"const showDeployRestartDialog =",
		"terminal_input_blocked",
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain server revision implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`createServerRevisionAPI,`,
		`createServerRevisionController,`,
		`createServerRevisionLifecycle,`,
		`export function createServerRevisionController({`,
		`const clientID = createStableClientID({`,
		`let currentRevision = "";`,
		`let reloadPrompted = false;`,
		`let dialogOpen = false;`,
		`const revisionChanged = Boolean(currentRevision && currentRevision !== nextRevision);`,
		`dialogGeneration !== generation`,
		`lifecycle.scheduleInitialCheck`,
	} {
		if !strings.Contains(indexSource+"\n"+controllerSource, want) {
			t.Fatalf("server revision controller boundary missing %q", want)
		}
	}
	for _, want := range []string{
		`new URL("./api/server-revision", windowObject.location.href);`,
		`requestURL.searchParams.set("client_id"`,
		`requestURL.searchParams.set("terminal_input_blocked"`,
		`fetchImpl(url(options), { cache: "no-store" })`,
	} {
		if !strings.Contains(apiSource, want) {
			t.Fatalf("server revision API boundary missing %q", want)
		}
	}
	for _, want := range []string{
		"let initialCheckTimer = 0;",
		"initialCheckScheduled",
		"windowObject?.clearTimeout?.(initialCheckTimer);",
		"scheduleInitialCheck(callback, delayMs = 1000)",
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("server revision lifecycle boundary missing %q", want)
		}
	}
	for _, forbidden := range []string{"new WebSocket", "writeReplay", "history_generation", "renderFullNow"} {
		if strings.Contains(controllerSource+"\n"+apiSource+"\n"+lifecycleSource, forbidden) {
			t.Fatalf("server revision module crosses terminal boundary %q", forbidden)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口与状态所有权",
		"## 生命周期",
		"## 文件清单",
		"不得触发、清空或展示终端历史回放过程",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("server revision README missing %q", want)
		}
	}

}

func TestRuntimeAppDOMRegistryModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/app/index.js")
	registrySource := read("runtime/static/app/dom_registry.js")
	readmeSource := read("runtime/static/app/README.md")

	for _, want := range []string{
		`createAppDOMRegistry,`,
		`from "./app/index.js";`,
		`const domRegistry = createAppDOMRegistry({ documentObject: document });`,
		`workspace: {`,
		`startup: {`,
		`dialog: {`,
		`mobile: {`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("app DOM registry integration guard missing %q", want)
		}
	}
	if strings.Contains(appSource, `document.getElementById("tabs")`) {
		t.Fatal("app controller must not resolve page DOM directly")
	}
	for _, want := range []string{
		`export { createAppDOMRegistry } from "./dom_registry.js";`,
		`export function createAppDOMRegistry({`,
		`const get = (id) => documentObject.getElementById(id);`,
		`if (!workspace.tabs || !workspace.terminalArea)`,
		`Object.freeze({`,
	} {
		if !strings.Contains(indexSource+"\n"+registrySource, want) {
			t.Fatalf("app DOM registry module guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"addEventListener",
		"new WebSocket",
		"history_replay",
		"fetch(",
	} {
		if strings.Contains(registrySource, forbidden) {
			t.Fatalf("app DOM registry must not own runtime behavior %q", forbidden)
		}
	}

	for _, want := range []string{"DOM", "workspace", "只读", "不注册事件"} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("app README missing DOM registry contract %q", want)
		}
	}
}

func TestDialogControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/app_dialog_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("dialog controller tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeDialogModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/app/index.js")
	dialogSource := read("runtime/static/app/dialog_controller.js")
	readmeSource := read("runtime/static/app/README.md")

	for _, want := range []string{
		`createDialogController,`,
		`from "./app/index.js";`,
		`dialogController = createDialogController({`,
		`dialogController.install();`,
		`dialogController.handleEscape(event);`,
		`dialogController?.dispose();`,
		`dialogController?.isDialogOpen() === true`,
		`dialogController?.isMobileConfirmOpen() === true`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("dialog integration guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"let dialogResolve = null",
		"let mobileCloseConfirmResolve = null",
		`dialogPanel?.addEventListener("submit"`,
		`mobileCloseConfirmOK?.addEventListener`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("dialog implementation must stay in dialog module: %q", forbidden)
		}
	}
	for _, want := range []string{
		`export { createDialogController } from "./dialog_controller.js";`,
		`export function createDialogController({`,
		`const confirmDialog = async`,
		`const confirmMobileSheet = (`,
		`const handleEscape = (event) =>`,
		`const install = () =>`,
		`const dispose = () =>`,
		`isDialogOpen: () => Boolean(dialogResolve)`,
		`isMobileConfirmOpen: () => Boolean(mobileResolve)`,
	} {
		if !strings.Contains(indexSource+"\n"+dialogSource, want) {
			t.Fatalf("dialog module guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history_replay",
		"terminalPresentation",
		"tabs",
	} {
		if strings.Contains(dialogSource, forbidden) {
			t.Fatalf("dialog module must not own application state %q", forbidden)
		}
	}
	for _, want := range []string{
		"对话框",
		"confirmMobileSheet",
		"dispose()",
		"焦点",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("app README missing dialog contract %q", want)
		}
	}

}

func TestAppShortcutControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/app_shortcut_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("app shortcut controller tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeAppShortcutModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/app/index.js")
	shortcutSource := read("runtime/static/app/shortcuts/shortcut_controller.js")
	lifecycleSource := read("runtime/static/app/shortcuts/shortcut_lifecycle.js")
	readmeSource := read("runtime/static/app/shortcuts/README.md")

	for _, want := range []string{
		`createAppShortcutController,`,
		`from "./app/index.js";`,
		`shortcutController = createAppShortcutController({`,
		`shortcutController?.handleKeydown(event);`,
		`shortcutController?.dispose();`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("app shortcut integration guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const runShortcutAction =`,
		`const handleGlobalShortcutKeydown =`,
		`const isInteractiveShortcutTarget =`,
		`const isFullscreenActive =`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain shortcut implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`createAppShortcutController,`,
		`createAppShortcutLifecycle,`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("app shortcut public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createAppShortcutController({`,
		`const runAction = async (action) => {`,
		`const handleKeydown = (event) => {`,
		`if (isShiftInsertPaste(event)) {`,
		`if (configuredAction === "paste_terminal") {`,
		`lifecycleFactory = createAppShortcutLifecycle`,
	} {
		if !strings.Contains(shortcutSource, want) {
			t.Fatalf("app shortcut controller guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createAppShortcutLifecycle()`,
		`let generation = 0;`,
		`generation += 1;`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("app shortcut lifecycle guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"TerminalReplayController",
		"history_replay",
		"canvas.getContext",
	} {
		if strings.Contains(shortcutSource, forbidden) {
			t.Fatalf("app shortcut module crosses terminal ownership boundary %q", forbidden)
		}
	}

	for _, want := range []string{"快捷键", "handleKeydown", "dispose()"} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("app shortcut README missing %q", want)
		}
	}
}

func TestAppCommandControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/app_command_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("app command controller tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeAppCommandModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/app/index.js")
	controllerSource := read("runtime/static/app/commands/command_controller.js")
	lifecycleSource := read("runtime/static/app/commands/command_lifecycle.js")
	readmeSource := read("runtime/static/app/commands/README.md")

	for _, want := range []string{
		`createAppCommandController,`,
		`from "./app/index.js";`,
		`appCommands = createAppCommandController({`,
		`onAction: (action, session) => appCommands?.runAction(action, session),`,
		`appCommands.install({`,
		`appCommands?.dispose();`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("app command integration guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`async function createUserTab()`,
		`newTabButton?.addEventListener`,
		`emptyStateAction?.addEventListener`,
		`tabsEl.addEventListener("wheel"`,
		`case "tab_overview":`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain command implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`createAppCommandController,`,
		`createAppCommandLifecycle,`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("app command public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createAppCommandController({`,
		`const createUserTab = async () => {`,
		`const runAction = async (action, session = null) => {`,
		`const install = (targets = bindTargets) => {`,
		`commandLifecycle.markInstalled()`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("app command controller guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createAppCommandLifecycle()`,
		`const listeners = [];`,
		`generation += 1;`,
		`target.removeEventListener?.(type, listener, options);`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("app command lifecycle guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history_replay",
		"canvas.getContext",
		"replay",
		"snapshot",
	} {
		if strings.Contains(controllerSource+"\n"+lifecycleSource, forbidden) {
			t.Fatalf("app command module crosses terminal ownership boundary %q", forbidden)
		}
	}

	for _, want := range []string{"应用命令", "runAction", "createUserTab", "dispose"} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("app command README missing %q", want)
		}
	}
}

func TestServiceForwardingControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/service_forwarding_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("service forwarding controller tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeServiceForwardingModuleBoundary(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	indexData, err := readRuntimeSource("runtime/static/service_forwarding/index.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/service_forwarding/index.js) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/service_forwarding/service_forwarding_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/service_forwarding/service_forwarding_controller.js) error = %v", err)
	}
	apiData, err := readRuntimeSource("runtime/static/service_forwarding/service_forwarding_api.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/service_forwarding/service_forwarding_api.js) error = %v", err)
	}
	lifecycleData, err := readRuntimeSource("runtime/static/service_forwarding/service_forwarding_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/service_forwarding/service_forwarding_lifecycle.js) error = %v", err)
	}
	readmeData, err := readRuntimeSource("runtime/static/service_forwarding/README.md")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/service_forwarding/README.md) error = %v", err)
	}

	mainSource := string(mainData) + "\n" + readRuntimeBootstrapSource(t)
	indexSource := string(indexData)
	controllerSource := string(controllerData)
	apiSource := string(apiData)
	lifecycleSource := string(lifecycleData)
	readmeSource := string(readmeData)

	for _, want := range []string{
		`from "./service_forwarding/index.js";`,
		"const serviceForwarding = createServiceForwardingController({",
		"setServiceForwardingSelected: (selected) => serviceForwarding.setSelected(selected),",
		"serviceForwarding.handleTargetChange();",
		"serviceForwarding.isEditorOpen()",
		"serviceForwarding.handleEscape(event)",
		"serviceForwarding,",
		"serviceForwarding.dispose();",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main.js service forwarding integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`from "./service_forwarding/service_forwarding_controller.js"`,
		"serviceForwardEntries",
		"serviceForwardRequestSeq",
		"serviceForwardEditingID",
		"serviceForwardBusy",
		"serviceForwardAddButton",
		"renderServiceForwardSettings",
		"refreshServiceForwards",
		"requestPublishListApi",
		`/api/publish/list`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain service forwarding implementation %q", forbidden)
		}
	}
	if !strings.Contains(indexSource, `export { createServiceForwardingController } from "./service_forwarding_controller.js";`) {
		t.Fatal("service forwarding public entry must export its controller")
	}
	for _, want := range []string{
		"let refreshGeneration = 0;",
		"let operationGeneration = 0;",
		"const operationIsCurrent = (generation, selector) => (",
		"handleTargetChange() {",
		"refreshGeneration += 1;",
		"operationGeneration += 1;",
		"lifecycle.dispose();",
		"view.resetEditor();",
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("service forwarding controller ownership guard missing %q", want)
		}
	}
	for _, want := range []string{
		`"/api/publish/list"`,
		`"/api/publish/status"`,
		`"/api/publish/http/create"`,
		`"/api/publish/http/update"`,
		`"/api/publish/http/delete"`,
		`"/api/publish/http/install-shell-lpk"`,
		`credentials: "include"`,
	} {
		if !strings.Contains(apiSource, want) {
			t.Fatalf("service forwarding provider API guard missing %q", want)
		}
	}
	for _, want := range []string{
		`listen(elements.addButton, "click", handlers.onAdd);`,
		`listen(elements.form, "submit", (event) => {`,
		`listen(elements.list, "click", handlers.onListAction);`,
		"target.removeEventListener?.(type, listener);",
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("service forwarding lifecycle guard missing %q", want)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口",
		"## 状态所有权",
		"## 生命周期",
		"## 文件清单",
		"## 依赖方向",
		"## 测试与回归",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("service forwarding README missing %q", want)
		}
	}

}

func TestRuntimeBootstrapFailureWaitsForGhostty(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/app/bootstrap/bootstrap_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/app/bootstrap/bootstrap_controller.js) error = %v", err)
	}
	source := string(data)
	block := sourceBetween(t, source,
		"const handleFailure = async (error) => {",
		"  return Object.freeze({")
	for _, want := range []string{
		"showStartupErrorPanel(message);",
		"await ghosttyReady;",
		"if (lifecycle.isDisposed() || isAppDisposed()) {",
		`createErrorTab({ label: "Error", focus: true, connect: false });`,
		"writeErrorTerminal(pane,",
		`"WebShell 错误终端创建失败"`,
	} {
		if !strings.Contains(block, want) {
			t.Fatalf("runtime bootstrap failure guard missing %q", want)
		}
	}
	waitIndex := strings.Index(block, "await ghosttyReady;")
	createIndex := strings.Index(block, `createErrorTab({ label: "Error", focus: true, connect: false });`)
	if waitIndex < 0 || createIndex <= waitIndex {
		t.Fatal("bootstrap failure must await Ghostty before creating the error terminal")
	}
	appSource := string(mustReadRuntimeSource(t, "runtime/static/global-runtime.js"))
	if !strings.Contains(appSource, "appBootstrap.start().catch((error) => appBootstrap.handleFailure(error));") {
		t.Fatal("app controller must delegate bootstrap failures to the bootstrap controller")
	}
}

func TestInstancesLoaderBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/instances_loader_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("instances loader tests failed: %v\n%s", err, output)
	}
}

func TestInstancesControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/instances_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("instances controller tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeInstancesModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js") + "\n" + readRuntimeBootstrapSource(t)
	indexSource := read("runtime/static/instances/index.js")
	controllerSource := read("runtime/static/instances/instances_controller.js")
	loaderSource := read("runtime/static/instances/instances_loader.js")
	modelSource := read("runtime/static/instances/instances_model.js")
	viewSource := read("runtime/static/instances/instances_view.js")
	lifecycleSource := read("runtime/static/instances/instances_lifecycle.js")
	navigationSource := read("runtime/static/instances/instances_navigation.js")
	readmeSource := read("runtime/static/instances/README.md")

	for _, want := range []string{
		`from "./instances/index.js";`,
		"const instances = createInstancesController({",
		"onSwitchTarget: (name, options) => switchInstance(name, options),",
		"consumePopState: () => terminalOverview?.consumeHistoryBack() === true,",
		"instances.handleActiveTargetChange();",
		"instances.getActiveDisplayName()",
		"instances.isSwitcherOpen()",
		"instances.openSwitcher()",
		"instances,",
		"loadInstances: () => instances.load(),",
		"instances.dispose();",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main.js instances integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`from "./instances_loader.js"`,
		`from "./instances/instances_controller.js"`,
		`getElementById("instanceSwitcher")`,
		`getElementById("homeMenuButton")`,
		"let currentInstances =",
		"let lightOSHomeURL =",
		"const renderInstanceSwitcher =",
		"const openInstanceSwitcher =",
		"const closeInstanceSwitcher =",
		"const loadInstances =",
		`fetch("./api/instances"`,
		`fetch("./api/lightos-admin-info"`,
		`window.addEventListener("popstate"`,
		`instanceSwitcherButton?.addEventListener`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain instances implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		`export { createInstancesController } from "./instances_controller.js";`,
		`export { createInstancesLoader } from "./instances_loader.js";`,
		"instanceDisplayName,",
		"isClientInstanceName,",
		"readInstanceTargetName,",
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("instances public entry missing %q", want)
		}
	}
	for _, want := range []string{
		"let instances = [];",
		"let switcherGeneration = 0;",
		"const instancesLoader = loader || loaderFactory({",
		"const instancesNavigation = navigation || navigationFactory({",
		"const task = onSwitchTarget?.(normalized, { updateURL, replaceURL });",
		"consumePopState?.() === true",
		"instancesLoader.dispose?.();",
		"instancesNavigation.dispose?.();",
		"lifecycle.dispose?.();",
		"view.dispose?.();",
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("instances controller guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"refreshWorkspace",
		"resetTabsForInstance",
		"WebSocket",
		"terminalCache",
		"historyGeneration",
		"resizeActiveTab",
	} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("instances controller must not own workspace or terminal logic %q", forbidden)
		}
	}

	for _, want := range []string{
		"const defaultRetryDelays = [250, 750, 1500, 3000];",
		`fetchImpl("./api/instances", {`,
		"response.status === 502 || response.status === 503 || response.status === 504",
		"if (inflight) {",
		"inflight?.controller?.abort();",
	} {
		if !strings.Contains(loaderSource, want) {
			t.Fatalf("instances loader guard missing %q", want)
		}
	}
	for _, want := range []string{
		"export const instanceSelector",
		"export const isClientInstanceName",
		"export const readInstanceTargetName",
		"export const firstRunningInstanceSelector",
	} {
		if !strings.Contains(modelSource, want) {
			t.Fatalf("instances model guard missing %q", want)
		}
	}
	for _, forbidden := range []string{"document.", "fetch(", "addEventListener"} {
		if strings.Contains(modelSource, forbidden) {
			t.Fatalf("instances model must remain pure, found %q", forbidden)
		}
	}

	for _, want := range []string{
		`root: byID("instanceSwitcher")`,
		`button: byID("instanceSwitcherButton")`,
		`list: byID("instanceSwitcherList")`,
		`homeButton: byID("homeMenuButton")`,
		"renderList({ instances = [], activeName = \"\" } = {})",
	} {
		if !strings.Contains(viewSource, want) {
			t.Fatalf("instances view guard missing %q", want)
		}
	}
	for _, want := range []string{
		`listen(elements.button, "click", handlers.onToggleSwitcher);`,
		`listen(elements.list, "click", handlers.onSelectInstance);`,
		`listen(elements.homeButton, "click", handlers.onNavigateHome);`,
		`listen(documentObject, "pointerdown", handlers.onDocumentPointerDown);`,
		`listen(documentObject, "keydown", handlers.onDocumentKeyDown, true);`,
		`listen(windowObject, "popstate", handlers.onPopState);`,
		"target.removeEventListener?.(type, listener, options);",
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("instances lifecycle guard missing %q", want)
		}
	}
	for _, want := range []string{
		`fetchImpl("./api/lightos-admin-info", {`,
		"let homeURL = \"\";",
		"let inflight = null;",
		"homeURL = normalizeLightOSHomeURL(info?.home_url, baseURL);",
		`targetURL.searchParams.set("mobile_remote_desktop", enabled ? "1" : "0");`,
		"inflight?.controller?.abort?.();",
	} {
		if !strings.Contains(navigationSource, want) {
			t.Fatalf("instances navigation guard missing %q", want)
		}
	}

	for _, want := range []string{
		"## 职责",
		"## 公开入口与契约",
		"## 状态所有权",
		"## 生命周期与清理",
		"## 文件清单",
		"onSwitchTarget(nextName, options)",
		"不得直接访问 Admin",
		"不得触发或展示终端历史回放过程",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("instances README missing %q", want)
		}
	}

	if _, err := os.Stat("runtime/static/instances_loader.js"); !os.IsNotExist(err) {
		t.Fatalf("legacy root instances loader must be removed, stat error = %v", err)
	}
}

func TestRuntimeAppearanceModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js") + "\n" + readRuntimeBootstrapSource(t)
	indexSource := read("runtime/static/appearance/index.js")
	controllerSource := read("runtime/static/appearance/appearance_controller.js")
	lifecycleSource := read("runtime/static/appearance/appearance_lifecycle.js")
	viewSource := read("runtime/static/appearance/appearance_view.js")
	catalogSource := read("runtime/static/appearance/theme_catalog.js")
	modelSource := read("runtime/static/appearance/theme_model.js")
	previewSource := read("runtime/static/appearance/theme_preview.js")
	runtimeSource := read("runtime/static/appearance/runtime_controller.js")
	readmeSource := read("runtime/static/appearance/README.md")

	for _, want := range []string{
		`from "./appearance/index.js";`,
		"const appearance = createAppearanceController({",
		"theme: appearance.getTerminalTheme(),",
		"onThemeChange: (theme, previousTheme) => applyAppearanceThemeToWorkspace(theme, previousTheme),",
		"appearance.getActiveTheme()",
		"appearance.getTerminalThemePayload()",
		"renderThemeSettings: () => appearance.renderSettingsThemes(),",
		"openThemePicker: () => appearance.openPicker(),",
		"appearance.closePicker();",
		"appearance.isPickerOpen()",
		"appearance.handleResize();",
		"appearance,",
		"loadTheme: () => appearance.load(),",
		"appearance.dispose();",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main.js appearance integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`from "./appearance/appearance_controller.js"`,
		`getElementById("themePickerBackdrop")`,
		`getElementById("settingsThemeList")`,
		"let activeTheme =",
		"let themes = [",
		`fetch(runtimeAssetURL("./themes.json"))`,
		"const applyTheme = (themeID) =>",
		"const themePreviewPromptText =",
		"const handleThemePickerTouchStart =",
		"themePickerClose?.addEventListener",
		"settingsThemePanel?.addEventListener",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain appearance implementation %q", forbidden)
		}
	}

	if !strings.Contains(indexSource, `export { createAppearanceController } from "./appearance_controller.js";`) {
		t.Fatal("appearance public entry must export its controller")
	}
	for _, want := range []string{
		"let themes = fallbackThemeCatalog();",
		"let activeTheme = selectTheme(themes, readStoredThemeID(storage, storageKey));",
		"let catalogGeneration = 0;",
		"let catalogAbortController = null;",
		"let pickerScrollbarDragging = false;",
		"let pickerEdgeSwipe = null;",
		"let settingsScrollbarHideTimer = 0;",
		"onThemeChange(cloneTheme(activeTheme), previousTheme);",
		"catalogAbortController?.abort?.();",
		"lifecycle?.dispose?.();",
		"view.dispose?.();",
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("appearance controller guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"WebSocket",
		"TerminalReplay",
		"beginTerminalPresentationHold",
		"resizeActiveTab",
		"session.",
		"tabs.values",
	} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("appearance controller must not own terminal/workspace logic %q", forbidden)
		}
	}

	for _, want := range []string{
		`new URL("./themes.json", import.meta.url).toString()`,
		"fallbackThemeCatalog",
		"fetchImpl(catalogURL, { signal })",
		"normalizeThemeCatalog(await response.json())",
	} {
		if !strings.Contains(catalogSource, want) {
			t.Fatalf("appearance catalog guard missing %q", want)
		}
	}
	for _, want := range []string{
		"export const cloneTheme =",
		"export const normalizeThemeCatalog =",
		"export const terminalThemeOptions =",
		"export const terminalThemePayload =",
	} {
		if !strings.Contains(modelSource, want) {
			t.Fatalf("appearance model guard missing %q", want)
		}
	}
	for _, forbidden := range []string{"document.", "fetch(", "addEventListener"} {
		if strings.Contains(modelSource, forbidden) {
			t.Fatalf("appearance model must remain pure, found %q", forbidden)
		}
	}

	for _, want := range []string{
		`pickerBackdrop: byID("themePickerBackdrop")`,
		`settingsThemeList: byID("settingsThemeList")`,
		`setCSS("--terminal-bg", theme.background);`,
		`const meta = documentObject?.querySelector?.('meta[name="theme-color"]');`,
		"renderPicker(options)",
		"renderSettingsThemes(options)",
	} {
		if !strings.Contains(viewSource, want) {
			t.Fatalf("appearance view guard missing %q", want)
		}
	}
	for _, want := range []string{
		`listen(elements.pickerClose, "click", handlers.onClosePicker);`,
		`listen(elements.pickerBackdrop, "touchmove", handlers.onTouchMove, { passive: false });`,
		`listen(elements.settingsThemeList, "click", handlers.onSelectTheme);`,
		`listen(windowObject, "pointermove", handlers.onScrollbarPointerMove, { passive: false });`,
		"target.removeEventListener?.(type, listener, options);",
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("appearance lifecycle guard missing %q", want)
		}
	}
	for _, want := range []string{
		"measureThemeCardWidth",
		"drawThemePreviewCard",
		"context.setTransform",
		"themeBrightness(background) > 0.5",
	} {
		if !strings.Contains(previewSource, want) {
			t.Fatalf("appearance preview guard missing %q", want)
		}
	}

	for _, want := range []string{
		"## 职责",
		"## 公开入口与契约",
		"## 状态所有权",
		"## 生命周期与清理",
		"## 文件清单",
		"onThemeChange(theme, previousTheme)",
		"不得触发历史 replay",
		"不得显示历史回放过程",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("appearance README missing %q", want)
		}
	}

	applyBlock := sourceBetween(t, runtimeSource,
		"const applyThemeToSession = (session, theme = getActiveTheme()) => {",
		"const applyWorkspaceTheme = (theme = getActiveTheme()) => {")
	holdIndex := strings.Index(applyBlock, "terminalPresentation.beginHold(session);")
	updateIndex := strings.Index(applyBlock, "session.term.options.theme = nextTheme;")
	if holdIndex < 0 {
		holdIndex = strings.Index(applyBlock, "beginPresentationHold(session);")
	}
	if holdIndex < 0 || updateIndex < 0 || holdIndex > updateIndex {
		t.Fatal("appearance terminal adapter must hold the current frame before changing renderer theme")
	}
	for _, forbidden := range []string{"replay", "history", "resetTerminal"} {
		if strings.Contains(applyBlock, forbidden) {
			t.Fatalf("appearance terminal adapter must not enter history replay logic %q", forbidden)
		}
	}
	for _, want := range []string{
		"export const buildAppearanceThemeColorMap =",
		"const holdCursorVisible = (session) => {",
		"const applyWorkspaceTheme = (theme = getActiveTheme()) => {",
		"const heldSessions = new Set();",
		"clearCursorBlinkTimer(session);",
		"heldSessions.clear();",
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("appearance runtime controller guard missing %q", want)
		}
	}
}

func TestAppearanceRuntimeControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/appearance_runtime_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("appearance runtime controller tests failed: %v\n%s", err, output)
	}
}

func TestKittyGraphicsBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/kitty_graphics_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("Kitty Graphics tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeSnapshotOnlyAndPWARemovalContract(t *testing.T) {
	mainSource := string(mustReadRuntimeSource(t, "runtime/static/global-runtime.js"))
	protocolSource := string(mustReadRuntimeSource(t, "runtime/static/terminal/transport/session_protocol_controller.js"))
	indexSource := string(mustReadRuntimeSource(t, "runtime/static/index.html"))
	cleanupSource := string(mustReadRuntimeSource(t, "runtime/static/app/bootstrap/legacy_storage_cleanup_controller.js"))
	retirementSource := string(mustReadRuntimeSource(t, "runtime/static/app/bootstrap/legacy_service_worker_retirement.js"))
	retirementBrowserTestSource := string(mustReadRuntimeSource(t, "tests-auto/11-service-worker-retirement/test.mjs"))
	providerSource := string(mustReadRuntimeSource(t, "main.go"))
	for _, want := range []string{
		`const historyConnectRange = isClientInstanceName(session.name)`,
		`? terminalReplay.rangeForConnect(session)`,
		`workspace_generation: isClientInstanceName(session.name) ? "" : session.workspaceGeneration`,
		`if (syncMode === "snapshot") {`,
		`if (!resetTerminalForHistoryReplay(session)) {`,
		`clientHistory.resetSession(session, historyGeneration, deltaFromCursor);`,
		`session.replayCompletionPending = true;`,
	} {
		if !strings.Contains(protocolSource, want) {
			t.Fatalf("snapshot-only transport guard missing %q", want)
		}
	}
	for _, forbidden := range []string{"cache_protocol_version", "cacheV2", "warmReplay", "showLocalPreview", "applyServerSnapshot", "local_base_cursor: historyConnectRange", "local_end_cursor: historyConnectRange", "history_generation: historyConnectRange"} {
		if strings.Contains(protocolSource, forbidden) {
			t.Fatalf("container transport still contains removed cache path %q", forbidden)
		}
	}
	if strings.Contains(indexSource, `rel="manifest"`) || strings.Contains(indexSource, `apple-touch-icon`) {
		t.Fatal("runtime index must not advertise PWA assets")
	}
	updateIndex := strings.Index(indexSource, `data-legacy-service-worker-update`)
	assetIndex := strings.Index(indexSource, assetBasePlaceholder)
	if updateIndex < 0 || assetIndex < 0 || updateIndex > assetIndex {
		t.Fatal("legacy worker update trigger must run before versioned assets")
	}
	for _, want := range []string{
		`if (!serviceWorker || !serviceWorker.controller) return;`,
		`serviceWorker.getRegistration("./")`,
		`registration?.update()`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("legacy worker update trigger missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`serviceWorker.register(`,
		`location.reload(`,
		`caches.open(`,
	} {
		if strings.Contains(indexSource, forbidden) {
			t.Fatalf("legacy worker update trigger must not restore PWA or reload clean clients: %q", forbidden)
		}
	}
	for _, want := range []string{
		`legacyTerminalCacheName = "lcmd-webshell-terminal-v2"`,
		`legacyAppShellCachePrefix = "lcmd-webshell-app-shell-"`,
		`return url.href === expectedScriptURL.href;`,
		`registration.unregister()`,
		`cacheStorage.delete(name)`,
	} {
		if !strings.Contains(cleanupSource, want) {
			t.Fatalf("legacy PWA cleanup guard missing %q", want)
		}
	}
	for _, forbidden := range []string{"createAppServiceWorkerController", "serviceWorkerController.register", "createTerminalCacheV2"} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("removed PWA/Cache API runtime returned: %q", forbidden)
		}
	}
	for _, want := range []string{
		`mux.HandleFunc("/service-worker.js", s.handleLegacyServiceWorkerRetirement)`,
		`w.Header().Set("Cache-Control", "no-store")`,
		`legacyServiceWorkerRetirementPath`,
	} {
		if !strings.Contains(providerSource, want) {
			t.Fatalf("legacy service worker retirement endpoint missing %q", want)
		}
	}
	for _, want := range []string{
		`self.addEventListener("install"`,
		`self.skipWaiting()`,
		`self.addEventListener("activate"`,
		`self.clients.matchAll({ type: "window" })`,
		`self.registration.unregister()`,
		`client.navigate(client.url)`,
		`legacyAppShellCachePrefix`,
		`legacyTerminalCacheName`,
	} {
		if !strings.Contains(retirementSource, want) {
			t.Fatalf("legacy service worker retirement guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`addEventListener("fetch"`,
		`caches.open(`,
		`clients.claim(`,
		`includeUncontrolled`,
		`manifest.webmanifest`,
	} {
		if strings.Contains(retirementSource, forbidden) {
			t.Fatalf("retirement worker must not restore PWA behavior %q", forbidden)
		}
	}
	if strings.Contains(retirementBrowserTestSource, `registration.update(`) {
		t.Fatal("real-browser retirement test must use the production HTML trigger instead of updating the registration directly")
	}
	for _, want := range []string{
		`runtime/static/index.html`,
		`legacyWorkerUpdateSource`,
		"desktop.page.goto(`${fixture.url}?retire=1`",
		`retirementNavigations = mainFrameNavigations - 1`,
	} {
		if !strings.Contains(retirementBrowserTestSource, want) {
			t.Fatalf("real-browser retirement trigger guard missing %q", want)
		}
	}
}

func TestRuntimeSettingsModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js") + "\n" + readRuntimeBootstrapSource(t)
	indexSource := read("runtime/static/settings/index.js")
	controllerSource := read("runtime/static/settings/settings_controller.js")
	apiSource := read("runtime/static/settings/settings_api.js")
	modelSource := read("runtime/static/settings/settings_model.js")
	viewSource := read("runtime/static/settings/settings_view.js")
	lifecycleSource := read("runtime/static/settings/settings_lifecycle.js")
	fontRegistrySource := read("runtime/static/settings/font_registry.js")
	shortcutEditorSource := read("runtime/static/settings/shortcut_editor.js")
	metricsSource := read("runtime/static/terminal/metrics/metrics_controller.js")
	readmeSource := read("runtime/static/settings/README.md")

	for _, want := range []string{
		`from "./settings/index.js";`,
		"settings = createSettingsController({",
		"onTerminalFontFamilyChange: (fontFamily) => terminalMetrics?.applyFontFamily(fontFamily),",
		"onTerminalFontSizeChange: (fontSize) => terminalMetrics?.applyFontSize(fontSize),",
		"terminalMetrics?.applyScrollbackChange(previousScrollback, nextScrollback)",
		"onMobilePixelScrollChange: (enabled) => terminalMetrics?.applyMobilePixelScroll(enabled),",
		"onTerminalLineHeightChange: (value, previousValue) => terminalMetrics?.applyLineHeight(value, previousValue),",
		"onDesktopShortcutsBarChange: () => terminalResize?.resizeActiveTabForCurrentDevice(),",
		"onMobileShortcutsChange: () => mobileShortcutsController?.render(),",
		"onForcePCModeChange: () => syncForcePCModeState(),",
		"settings,",
		"loadSettings: () => settings.load({ deferFontLoad: true }),",
		"settings?.flushPending();",
		"settings?.dispose();",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main.js settings integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`from "./settings/settings_controller.js"`,
		`from "./settings/settings_model.js"`,
		`from "./settings/settings_view.js"`,
		`getElementById("settings`,
		`querySelectorAll("[data-settings`,
		`fetch("./api/settings`,
		`fetch("api/settings`,
		"mobileShortcutEditorState",
		"desktopShortcutEditorState",
		"lineHeightSaveTimer",
		"scrollbackSaveTimer",
		"selectedFontDeleteIDs",
		"new FontFace(",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain settings implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		`createSettingsController,`,
		`} from "./settings_controller.js";`,
		`DEFAULT_TERMINAL_FONT_FAMILY,`,
		`normalizeTerminalLineHeightPercent,`,
		`} from "./settings_model.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("settings public entry missing %q", want)
		}
	}

	for _, want := range []string{
		`import { createFontRegistry } from "./font_registry.js";`,
		`import { createSettingsAPI } from "./settings_api.js";`,
		`import { createSettingsLifecycle } from "./settings_lifecycle.js";`,
		`import { createSettingsView } from "./settings_view.js";`,
		`from "./shortcut_editor.js";`,
		"let controllerGeneration = 0;",
		"let loadGeneration = 0;",
		"let mobileShortcutEditorState = null;",
		"let desktopShortcutEditorState = null;",
		"let persistChain = Promise.resolve();",
		"const pendingFields = new Map();",
		"const requestControllers = new Set();",
		"const overlayPendingFields = (next) => {",
		"api.patch(patch, { keepalive, signal })",
		"lifecycle?.dispose?.();",
		"fontRegistry.dispose?.();",
		"refreshFonts: false,",
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("settings controller boundary missing %q", want)
		}
	}

	for _, want := range []string{
		`request("./api/settings", { cache: "no-store", signal }, "设置加载失败")`,
		`request("./api/settings", {`,
		`method: "PUT"`,
		`body: JSON.stringify(patch)`,
		"`./api/settings/fonts/${encodeURIComponent(String(fontID || \"\"))}`",
		`request("./api/settings/fonts", {`,
	} {
		if !strings.Contains(apiSource, want) {
			t.Fatalf("settings API boundary missing %q", want)
		}
	}
	if strings.Contains(apiSource, "lightos-admin") || strings.Contains(apiSource, "Device API") {
		t.Fatal("settings API must only use Provider-relative routes")
	}

	for _, want := range []string{
		"export function cloneSettingsSnapshot(snapshot) {",
		"export function normalizeServerSettings(raw, { defaults = createDefaultDesktopShortcuts() } = {}) {",
		"mobileShortcuts: normalizeMobileShortcutRows(raw?.mobile_shortcuts),",
		"desktopShortcuts: normalizeDesktopShortcuts(Array.isArray(raw?.desktop_shortcuts) ? raw.desktop_shortcuts : defaults, defaults),",
		`export const normalizeMobileShortcutTextData = (text) => String(text || "")`,
	} {
		if !strings.Contains(modelSource, want) {
			t.Fatalf("settings model boundary missing %q", want)
		}
	}
	for _, want := range []string{
		"export function createSettingsView({",
		"const byID = (id) => documentObject?.getElementById?.(id) || null;",
		`mobileShortcutEditor: byID("mobileShortcutEditor"),`,
		`desktopShortcutEditor: byID("desktopShortcutEditor"),`,
		`tabs: Array.from(documentObject?.querySelectorAll?.("[data-settings-tab]") || []),`,
	} {
		if !strings.Contains(viewSource, want) {
			t.Fatalf("settings view boundary missing %q", want)
		}
	}
	for _, want := range []string{
		"const listeners = [];",
		"target.addEventListener(type, listener, options);",
		"target.removeEventListener?.(type, listener, options);",
		`listen(windowObject, "pagehide", handlers.onPageHide);`,
		`listen(documentObject, "keydown", handlers.onDocumentKeydown, true);`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("settings lifecycle boundary missing %q", want)
		}
	}
	for _, want := range []string{
		"let generation = 0;",
		"const face = new FontFaceCtor(",
		"expectedGeneration !== generation",
		"documentObject?.fonts?.delete?.(face);",
	} {
		if !strings.Contains(fontRegistrySource, want) {
			t.Fatalf("settings font registry boundary missing %q", want)
		}
	}
	for _, want := range []string{
		"export function buildMobileShortcut(",
		"export function applyMobileShortcutEdit(",
		"export function buildDesktopShortcut(",
		"export function applyDesktopShortcutEdit(",
	} {
		if !strings.Contains(shortcutEditorSource, want) {
			t.Fatalf("settings shortcut editor boundary missing %q", want)
		}
	}

	for _, want := range []string{
		"## 职责",
		"## 公开入口",
		"## 状态所有权",
		"## PATCH 契约",
		"## 生命周期",
		"## 文件清单",
		"设置变化不得触发、管理或展示历史回放过程",
		"每次保存只发送被修改的字段",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("settings README missing %q", want)
		}
	}

	fontFamilyAdapter := sourceBetween(t, metricsSource,
		`  const applyFontFamily = (value) => {`,
		`  const applyFontSize = (value) => {`)
	fontSizeAdapter := sourceBetween(t, metricsSource,
		`  const applyFontSize = (value) => {`,
		`  const applyScrollbackChange = (previousValue, nextValue) => {`)
	lineHeightAdapter := sourceBetween(t, mainSource,
		`    onTerminalLineHeightChange: (value, previousValue) => terminalMetrics?.applyLineHeight(value, previousValue),`,
		`    onDesktopShortcutsBarChange: () => terminalResize?.resizeActiveTabForCurrentDevice(),`)
	for name, adapter := range map[string]string{
		"font family": fontFamilyAdapter,
		"font size":   fontSizeAdapter,
		"line height": lineHeightAdapter,
	} {
		for _, forbidden := range []string{"writeReplay", "requestSessionHistoryReplay", "resetTerminalForHistoryReplay"} {
			if strings.Contains(adapter, forbidden) {
				t.Fatalf("settings %s adapter must not enter history replay via %q", name, forbidden)
			}
		}
	}
}

func TestRuntimeTerminalSessionModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/terminal/session/index.js")
	resourceFactorySource := read("runtime/static/terminal/session/resource_factory.js")
	controllerSource := read("runtime/static/terminal/session/session_controller.js")
	installationSource := read("runtime/static/terminal/session/session_installation_controller.js")
	installationLifecycleSource := read("runtime/static/terminal/session/session_installation_lifecycle.js")
	recoverySource := read("runtime/static/terminal/session/session_recovery_controller.js")
	startupErrorAPISource := read("runtime/static/terminal/session/startup_error_api.js")
	startupErrorControllerSource := read("runtime/static/terminal/session/startup_error_controller.js")
	startupErrorLifecycleSource := read("runtime/static/terminal/session/startup_error_lifecycle.js")
	stateSource := read("runtime/static/terminal/session/session_state.js")
	lifecycleSource := read("runtime/static/terminal/session/session_lifecycle.js")
	tabControllerSource := read("runtime/static/workspace/tab_controller.js")
	readmeSource := read("runtime/static/terminal/session/README.md")
	terminalReadmeSource := read("runtime/static/terminal/README.md")

	for _, want := range []string{
		`createTerminalSessionController,`,
		`from "./terminal/session/index.js";`,
		"let terminalSessionController = null;",
		`createTerminalSessionResourceFactory,`,
		`createTerminalSessionInstallationController,`,
		`createTerminalSessionRecoveryController,`,
		`createTerminalStartupErrorController,`,
		"const terminalSessionResources = createTerminalSessionResourceFactory({",
		"terminalSessionController = createTerminalSessionController({",
		"createResources: terminalSessionResources.create,",
		"detachLogicalStream: (session, reason) => terminalTransportRuntime?.detachUnifiedSession(session, reason),",
		"disposeHistoryCache: (session) => clientHistory.disposeSession(session),",
		"unregisterConnection: (session, reason) => terminalTransportRuntime?.unregisterSession(session, reason),",
		"terminalSessionInstallation = createTerminalSessionInstallationController({",
		"onReady: (session, details) => terminalSessionInstallation?.handlePresentationReady(session, details),",
		"terminalStartupError = createTerminalStartupErrorController({",
		`const invalidateSessionStartupError = (session, options) => terminalStartupError?.invalidate(session, options) === true;`,
		`const showSessionStartupError = (session, fallback) => terminalStartupError?.show(session, fallback) || Promise.resolve(false);`,
		`terminalStartupError?.dispose();`,
		"const createPaneSession = (tab, instanceName, options) => (",
		"terminalSessionInstallation.createPaneSession(tab, instanceName, options)",
		"disposePaneSession: (pane) => {",
		"terminalOverview?.deletePreview(pane);",
		"terminalSessionController.dispose(pane);",
		"sessionRecovery = createTerminalSessionRecoveryController({",
		"const detachSessionSocket = (session, currentSocket, options) => (",
		"const resetTerminalForHistoryReplay = (session) => (",
		"const requestSessionHistoryReplay = (session) => (",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main terminal session integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`from "./terminal/session/session_controller.js"`,
		`from "./terminal/session/session_state.js"`,
		`from "./terminal/session/session_lifecycle.js"`,
		"let nextPaneSeq",
		"const normalizeTerminalInitialSize",
		"cleanupCallbacks",
		"terminalPresentation.installSession(session);",
		"const readAgentStartupError =",
		"const writeSessionWebShellError =",
		"const genericWebSocketStartupFallbacks =",
		"terminalCache.hidePreview(session);",
		"terminalCache.clearPreparedPreview(session);",
		"terminalCache.schedulePreviewCapture(session);",
		"terminalCache.reportRecoveryMetrics(session);",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal session ownership %q", forbidden)
		}
	}

	createBlock := sourceBetween(t, mainSource,
		`  const createPaneSession = (tab, instanceName, options) => (`,
		"  workspaceTabView = createWorkspaceTabView({")
	for _, forbidden := range []string{
		"replayController: new TerminalReplayController()",
		"resizeController: new TerminalResizeController()",
		"renderSnapshot: new RenderSnapshot()",
		"historyCacheWriteQueue: []",
		"cacheV2NetworkQueue: []",
		"pendingInput: []",
		"outputQueue: []",
	} {
		if strings.Contains(createBlock, forbidden) {
			t.Fatalf("createPaneSession must not rebuild session state via %q", forbidden)
		}
	}
	if !strings.Contains(mainSource, "disposePaneSession: (pane) => {") ||
		!strings.Contains(mainSource, "terminalSessionController.dispose(pane);") {
		t.Fatal("disposePane must delegate to terminal session lifecycle")
	}
	for _, want := range []string{
		`export function createTerminalSessionInstallationController({`,
		"installFeatureControllers",
		"installTitleListener",
		"interaction?.bindPane",
		"sessionController.create({",
		"transportRuntime?.registerSession",
		"transportRuntime?.connectPendingSession",
		"const handlePresentationReady = (session, { becameReady = false } = {}) => {",
		"clearUnifiedRetry(session, { resetAttempts: true });",
	} {
		if !strings.Contains(installationSource, want) {
			t.Fatalf("terminal session installation boundary missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"writeReplay",
		"historyGeneration",
		"requestedResizeEpoch",
		"createTerminalCacheV2",
	} {
		if strings.Contains(installationSource, forbidden) {
			t.Fatalf("terminal session installation must not own domain algorithm %q", forbidden)
		}
	}
	for _, want := range []string{
		"const installedSessions = new Set();",
		"const disposedSessions = new WeakSet();",
		"const guardedListener = (...args) => {",
		"if (disposed || disposedSessions.has(session) || session?.closed)",
		"target.addEventListener(type, guardedListener, options);",
		"target.removeEventListener?.(type, guardedListener, options)",
	} {
		if !strings.Contains(installationLifecycleSource, want) {
			t.Fatalf("terminal session installation lifecycle guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"pane.closed = true",
		"detachTerminalUnifiedSession",
		"terminalConnectionScheduler?.unregister",
		"clearTerminalCanvasPixels",
		"pane.term.dispose",
	} {
		if strings.Contains(tabControllerSource, forbidden) {
			t.Fatalf("disposePane must not retain lifecycle orchestration %q", forbidden)
		}
	}

	if !strings.Contains(indexSource, `export { createTerminalSessionController } from "./session_controller.js";`) {
		t.Fatal("terminal session public entry must export the controller")
	}
	if !strings.Contains(indexSource, `export { createTerminalSessionResourceFactory } from "./resource_factory.js";`) {
		t.Fatal("terminal session public entry must export the resource factory")
	}
	if !strings.Contains(indexSource, `export { createTerminalSessionRecoveryController } from "./session_recovery_controller.js";`) {
		t.Fatal("terminal session public entry must export the recovery controller")
	}
	for _, want := range []string{
		"export function createTerminalSessionRecoveryController({",
		"const detachSessionSocket = (session, currentSocket, { connection = \"\" } = {}) => {",
		"const resetTerminalForHistoryReplay = (session) => {",
		"const requestSessionHistoryReplay = (session) => {",
		"if (session.connectionChannel === \"unified\") {",
		"session.lastHistoryResetFailureReason = \"terminal_size_unavailable\";",
		"return Object.freeze({",
	} {
		if !strings.Contains(recoverySource, want) {
			t.Fatalf("terminal session recovery module missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"writeReplay",
		"requestAnimationFrame",
		"renderHistory",
	} {
		if strings.Contains(recoverySource, forbidden) {
			t.Fatalf("terminal session recovery must not own transport/render implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`export { createTerminalStartupErrorAPI } from "./startup_error_api.js";`,
		`export { createTerminalStartupErrorLifecycle } from "./startup_error_lifecycle.js";`,
		`createTerminalStartupErrorController,`,
		`isRetryableTerminalStartupError,`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal session public entry missing startup error export %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalStartupErrorAPI({`,
		`const response = await fetchImpl(startupErrorURL(requestName), { cache: "no-store" });`,
		`export function createTerminalStartupErrorLifecycle() {`,
		`const requestIDs = new WeakMap();`,
		`const isCurrent = (session, requestID) => (`,
		`export const isRetryableTerminalStartupError = (message) => {`,
		`export function createTerminalStartupErrorController({`,
		`if (session.hasPresentedFrame) {`,
		`showStartupErrorPanel(message);`,
		`return writeError(session, fallback);`,
	} {
		if !strings.Contains(startupErrorAPISource+"\n"+startupErrorControllerSource+"\n"+startupErrorLifecycleSource, want) {
			t.Fatalf("terminal startup error module missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"writeReplay",
		"historyGeneration",
		"requestedResizeEpoch",
		"term.resize(",
	} {
		if strings.Contains(startupErrorAPISource, forbidden) || strings.Contains(startupErrorControllerSource, forbidden) || strings.Contains(startupErrorLifecycleSource, forbidden) {
			t.Fatalf("terminal startup error module crosses transport/history/resize boundary %q", forbidden)
		}
	}
	for _, want := range []string{
		"export function createTerminalSessionResourceFactory({",
		"TerminalCtor",
		"FitAddonCtor",
		"shellEl.dataset.renderReady = \"false\";",
		"term.open(terminalHost);",
		"terminalFrameHold.className = \"terminal-frame-hold\";",
		"compositionPreview.className = \"terminal-composition-preview\";",
		"return Object.freeze({ create });",
	} {
		if !strings.Contains(resourceFactorySource, want) {
			t.Fatalf("terminal session resource factory boundary missing %q", want)
		}
	}
	for _, want := range []string{
		`import { createTerminalSessionLifecycle } from "./session_lifecycle.js";`,
		`import { createTerminalSessionState } from "./session_state.js";`,
		"let nextPaneSequence = 1;",
		"const allocatePaneID = (requestedID) => {",
		"const initialCols = normalizeInitialSize(cols, 2);",
		"const initialRows = normalizeInitialSize(rows, 1);",
		"const resources = createResources({",
		"return stateFactory({",
		"addCleanup: lifecycle.addCleanup,",
		"dispose: lifecycle.dispose,",
		"disposeAll: lifecycle.disposeAll,",
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal session controller boundary missing %q", want)
		}
	}
	for _, want := range []string{
		`import { TerminalReplayController } from "../history/index.js";`,
		`import { createTerminalPresentationState } from "../rendering/index.js";`,
		`import { TerminalResizeController } from "../resize/index.js";`,
		"export function createTerminalSessionState({",
		"pendingConnect: Boolean(connect),",
		"replayController: new TerminalReplayController(),",
		"historyCacheWriteQueue: [],",
		"pendingInput: [],",
		"outputQueue: [],",
		"...createTerminalPresentationState(),",
		"resizeController: new TerminalResizeController(),",
		"closed: false,",
	} {
		if !strings.Contains(stateSource, want) {
			t.Fatalf("terminal session state boundary missing %q", want)
		}
	}
	if strings.Contains(stateSource, "cleanupCallbacks") {
		t.Fatal("terminal session state must not expose lifecycle cleanup storage")
	}

	for _, want := range []string{
		"const cleanups = new WeakMap();",
		"const disposedSessions = new WeakSet();",
		"if (disposedSessions.has(session) || session.closed) {",
		"invoke(adapters.flushHistoryCacheWrites, session);",
		"session.closed = true;",
		`invoke(adapters.detachLogicalStream, session, "session_closed");`,
		`invoke(adapters.unregisterConnection, session, "session_closed");`,
		"invoke(adapters.cancelFrameRelease, session);",
		"invoke(adapters.disposeHistoryCache, session);",
		"runCleanups(session);",
		"invoke(adapters.clearCanvasPixels, session);",
		"invoke(session.term?.dispose?.bind(session.term));",
		"const disposeAll = (sessions = []) => {",
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("terminal session lifecycle boundary missing %q", want)
		}
	}
	flushIndex := strings.Index(lifecycleSource, "invoke(adapters.flushHistoryCacheWrites, session);")
	closedIndex := strings.Index(lifecycleSource, "session.closed = true;")
	detachIndex := strings.Index(lifecycleSource, `invoke(adapters.detachLogicalStream, session, "session_closed");`)
	if flushIndex < 0 || closedIndex < 0 || detachIndex < 0 || !(flushIndex < closedIndex && closedIndex < detachIndex) {
		t.Fatal("terminal session lifecycle must flush, mark closed, then detach the logical stream")
	}
	if !strings.Contains(controllerSource, "disposeAll: lifecycle.disposeAll,") {
		t.Fatal("terminal session controller must expose the shared batch disposal entry")
	}
	if strings.Contains(mainSource, "pane.closed = true") ||
		strings.Contains(mainSource, "pane.replayController?.reset()") ||
		strings.Contains(mainSource, "pane.queueReplayControllerActive = false") ||
		strings.Contains(mainSource, "terminalSessionConnection.clearReconnectTimer(pane)") {
		t.Fatal("global runtime must not directly mutate pane lifecycle fields during page disposal")
	}
	if !strings.Contains(mainSource, "terminalSessionController?.disposeAll(getAllSessions());") {
		t.Fatal("global runtime must delegate batch pane disposal to terminal session controller")
	}
	for _, forbidden := range []string{
		"closeTerminalUnifiedConnection",
		"terminalUnifiedConnection.close",
		"session.socket.close",
		"writeReplay",
		"resetTerminalForHistoryReplay",
		"cacheV2PreviewCaptureTimer",
		"cacheV2CompactionHandle",
	} {
		if strings.Contains(lifecycleSource, forbidden) {
			t.Fatalf("terminal session lifecycle must not own transport/history algorithms %q", forbidden)
		}
	}

	for _, want := range []string{
		"## 职责",
		"## 公开入口",
		"## 状态所有权",
		"## 生命周期",
		"## 文件清单",
		"closed` 必须早于 logical detach",
		"单 pane 销毁不得关闭 Unified 物理连接",
		"中间 replay 过程不可见",
		"last-known-good frame",
		"startup_error_controller.js",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal session README missing %q", want)
		}
	}
	for _, want := range []string{
		"普通容器页面只能有一条 Unified 物理 WebSocket",
		"replay、snapshot、原子 resize 和重连的中间过程不得显示",
		"字号/行高 live geometry 可乐观重排当前真实 Canvas",
		"session/",
	} {
		if !strings.Contains(terminalReadmeSource, want) {
			t.Fatalf("terminal README missing %q", want)
		}
	}

}

func TestRuntimeStaticModulesAreGroupedByResponsibility(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js")

	indexHTML := read("runtime/static/index.html")

	for _, path := range []string{
		"runtime/static/workspace/README.md",
		"runtime/static/terminal/history/README.md",
		"runtime/static/terminal/transport/README.md",
		"runtime/static/terminal/rendering/README.md",
		"runtime/static/terminal/resize/README.md",
		"runtime/static/terminal/viewport/README.md",
		"runtime/static/terminal/overview/README.md",
		"runtime/static/terminal/screenshot/README.md",
		"runtime/static/terminal/input/README.md",
		"runtime/static/terminal/input/ime/README.md",
		"runtime/static/terminal/tui_adapters/README.md",
		"runtime/static/terminal/tui_adapters/common/README.md",
		"runtime/static/terminal/tui_adapters/claude/README.md",
		"runtime/static/terminal/tui_adapters/opencode/README.md",
		"runtime/static/terminal/tui_adapters/herdr/README.md",
		"runtime/static/terminal/tui_adapters/pi/README.md",
	} {
		if strings.TrimSpace(read(path)) == "" {
			t.Fatalf("static module README must not be empty: %s", path)
		}
	}

	for _, path := range []string{
		"runtime/static/workspace/index.js",
		"runtime/static/terminal/history/index.js",
		"runtime/static/terminal/transport/index.js",
		"runtime/static/terminal/rendering/index.js",
		"runtime/static/terminal/resize/index.js",
		"runtime/static/terminal/viewport/index.js",
		"runtime/static/terminal/input/index.js",
		"runtime/static/terminal/overview/index.js",
		"runtime/static/terminal/screenshot/index.js",
		"runtime/static/terminal/tui_adapters/index.js",
		"runtime/static/terminal/tui_adapters/common/index.js",
		"runtime/static/terminal/tui_adapters/claude/index.js",
		"runtime/static/terminal/tui_adapters/opencode/index.js",
		"runtime/static/terminal/tui_adapters/herdr/index.js",
		"runtime/static/terminal/tui_adapters/pi/index.js",
	} {
		if !strings.Contains(read(path), "export ") {
			t.Fatalf("static module public entry must export an API: %s", path)
		}
	}

	for _, path := range []string{
		"runtime/static/terminal_cache_v2.js",
		"runtime/static/terminal_checkpoint.js",
		"runtime/static/terminal_history_cache.js",
		"runtime/static/terminal_replay_controller.js",
		"runtime/static/client_terminal_replay.js",
		"runtime/static/terminal_connection_scheduler.js",
		"runtime/static/terminal_fast_integrity.js",
		"runtime/static/terminal_queue_connection.js",
		"runtime/static/terminal_unified_connection.js",
		"runtime/static/terminal_unified_health.js",
		"runtime/static/terminal_unified_membership.js",
		"runtime/static/terminal_render_snapshot.js",
		"runtime/static/terminal_frame_release_scheduler.js",
		"runtime/static/kitty_graphics.js",
		"runtime/static/terminal_resize_controller.js",
		"runtime/static/terminal_resize_scheduler.js",
		"runtime/static/terminal_size_sync.js",
		"runtime/static/terminal_overview_preview.js",
		"runtime/static/terminal_long_screenshot.js",
		"runtime/static/ios_terminal_host.js",
		"runtime/static/tab_activation_scheduler.js",
		"runtime/static/fullscreen_tui_touch.js",
		"runtime/static/claude_fullscreen_touch.js",
		"runtime/static/opencode_fullscreen_touch.js",
		"runtime/static/herdr_fullscreen_touch.js",
		"runtime/static/pi_fullscreen_touch.js",
		"runtime/static/themes.json",
	} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("static root must not retain grouped module file %s", path)
		}
	}

	for _, want := range []string{
		`from "./terminal/history/index.js";`,
		`from "./terminal/overview/index.js";`,
		`from "./terminal/rendering/index.js";`,
		`from "./terminal/resize/index.js";`,
		`from "./terminal/viewport/index.js";`,
		`from "./terminal/input/index.js";`,
		`from "./terminal/screenshot/index.js";`,
		`from "./terminal/transport/index.js";`,
		`from "./terminal/tui_adapters/index.js";`,
		`from "./workspace/index.js";`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main.js must use grouped public entry %q", want)
		}
	}
	for _, forbidden := range []string{
		`from "./terminal/history/terminal_`,
		`from "./terminal/transport/terminal_`,
		`from "./terminal/rendering/terminal_`,
		`from "./terminal/resize/terminal_`,
		`from "./terminal/viewport/viewport_`,
		`from "./terminal/input/input_`,
		`from "./terminal/tui_adapters/claude/`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not deep-import grouped module internals %q", forbidden)
		}
	}

	if !strings.Contains(indexHTML, `__LCMD_ASSET_BASE__terminal/input/ime/ios_terminal_host.js`) {
		t.Fatal("runtime HTML must load the grouped iOS terminal host path")
	}
}

func TestRuntimeTerminalInputModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js")
	protocolSource := readRuntimeProtocolSource(t)
	installationSource := read("runtime/static/terminal/session/session_installation_controller.js")
	runtimeSource := mainSource + "\n" + protocolSource + "\n" + installationSource
	indexSource := read("runtime/static/terminal/input/index.js")
	controllerSource := read("runtime/static/terminal/input/input_controller.js")
	lifecycleSource := read("runtime/static/terminal/input/input_lifecycle.js")
	modelSource := read("runtime/static/terminal/input/input_model.js")
	keyOverridesSource := read("runtime/static/terminal/input/key_overrides/key_overrides_controller.js")
	keyOverridesIndexSource := read("runtime/static/terminal/input/key_overrides/index.js")
	readmeSource := read("runtime/static/terminal/input/README.md")

	for _, want := range []string{
		`createTerminalInputController,`,
		`createTerminalIMEController,`,
		`createTerminalKeyOverridesController,`,
		`from "./terminal/input/index.js";`,
		`terminalInput = createTerminalInputController({`,
		`isReplayCommitted: (session) => terminalReplay.isCommitted(session),`,
		`isInputBlocked: () => serverRevision.isDialogOpen(),`,
		`getCurrentLease: (session) => terminalTransportRuntime?.currentLease(session) || null,`,
		`getResizeSize: (session) => terminalResize.size(session),`,
		`checkConnectionHealth: (session, options) => terminalSessionConnection.checkHealth(session, options),`,
		`registerSessionCleanup: (session, cleanup) => terminalSessionController?.addCleanup(session, cleanup),`,
		`input?.installSession?.(session);`,
		`input?.flushPending?.(session);`,
		`terminalInput?.pausePendingExpiry(session);`,
		`resumePendingInputExpiry: (session) => terminalInput?.resumePendingExpiry(session),`,
		`clearInputFlushTimer: (session) => terminalInput?.clearInputFlushTimer(session),`,
		`clearInputPumpTimer: (session) => terminalInput?.clearInputPumpTimer(session),`,
		`clearPendingInputExpiry: (session) => terminalInput?.clearPendingInputExpiry(session),`,
		`terminalInput?.dispose();`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("main.js terminal input integration missing %q", want)
		}
	}

	for _, forbidden := range []string{
		`from "./terminal/input/input_`,
		`const generatedTerminalResponsePattern =`,
		`const isSessionInputReady =`,
		`const splitTerminalInputChunks =`,
		`const buildTerminalInputQueueItems =`,
		`const sendSessionInputChunk =`,
		`const schedulePendingInputExpiry =`,
		`const sendOrQueueInput =`,
		`term.onData((data) => {`,
		`session.inputQueue.push(`,
		`session.pendingInput.push(`,
		`session.suppressGeneratedTerminalInputUntil =`,
		`sendPayload: (session, payload) => {`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal input implementation %q", forbidden)
		}
	}
	if !strings.Contains(controllerSource, `sendPayload = (session, payload) => {`) {
		t.Fatal("terminal input controller must own the default payload serializer")
	}

	for _, want := range []string{
		`export * from "./input_controller.js";`,
		`export * from "./input_lifecycle.js";`,
		`export * from "./input_model.js";`,
		`export * from "./ime/index.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal input public entry missing %q", want)
		}
	}

	for _, want := range []string{
		`export function createTerminalKeyOverridesController({`,
		`const boundSessions = new WeakSet();`,
		`const disposedSessions = new WeakSet();`,
		`term.attachCustomKeyEventHandler(handler);`,
		`registerSessionCleanup(session, () => disposeSession(session));`,
		`terminalAltMetaInputFromEvent(event, { KeyboardEventCtor });`,
	} {
		if !strings.Contains(keyOverridesSource, want) {
			t.Fatalf("terminal key overrides module missing %q", want)
		}
	}
	for _, want := range []string{
		`export {`,
		`terminalAltMetaInputFromEvent,`,
	} {
		if !strings.Contains(keyOverridesIndexSource, want) {
			t.Fatalf("terminal key overrides public entry missing %q", want)
		}
	}

	for _, want := range []string{
		`export function createTerminalInputController({`,
		`const isReady = (session) => Boolean(`,
		`&& !session.resizeAckPending`,
		`getCurrentLease(session)?.leaseID === session.connectionLeaseID`,
		`const sendInputChunk = (session, data, { generated = false } = {}) => {`,
		`payload.generated = true;`,
		`payload.resize_epoch = resizeEpoch;`,
		`getBufferedAmount(session) > backpressureBytes`,
		`const schedulePendingInputExpiry = (session) => {`,
		`const leaseStillCurrent = currentLeaseID === expectedLeaseID`,
		`checkConnectionHealth(session, {`,
		`const handleData = (session, data) => {`,
		`installSession(session) {`,
		`disposeSession(session) {`,
		`dispose() {`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal input controller missing %q", want)
		}
	}

	for _, forbidden := range []string{
		`new WebSocket(`,
		`.close(`,
		`writeReplay(`,
		`requestRender(`,
		`terminalPresentation`,
		`terminalResize`,
	} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("terminal input controller crosses an ownership boundary with %q", forbidden)
		}
	}

	for _, want := range []string{
		`export function createTerminalInputLifecycle({`,
		`const boundSessions = new Set();`,
		`boundSessions.has(session)`,
		`clearTimer(session, "inputFlushTimer")`,
		`clearTimer(session, "inputPumpTimer")`,
		`clearTimer(session, "pendingInputExpiryTimer")`,
		`disposable?.dispose?.();`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("terminal input lifecycle missing %q", want)
		}
	}

	for _, want := range []string{
		`export function isGeneratedTerminalResponse(`,
		`export function isGeneratedTerminalResponseTail(`,
		`export function splitTerminalInputChunks(`,
		`export function buildTerminalInputQueueItems(`,
	} {
		if !strings.Contains(modelSource, want) {
			t.Fatalf("terminal input model missing %q", want)
		}
	}

	for _, want := range []string{
		"## 职责",
		"## 公开入口与契约",
		"## 状态所有权",
		"## 生命周期",
		"## 文件清单",
		"不依赖 Canvas `renderReady`",
		"单 pane 输入失败",
		"历史回放中间过程不可见",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal input README missing %q", want)
		}
	}

}

func TestRuntimeTerminalMobileShortcutsModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/terminal/input/mobile_shortcuts/index.js")
	controllerSource := read("runtime/static/terminal/input/mobile_shortcuts/mobile_shortcuts_controller.js")
	lifecycleSource := read("runtime/static/terminal/input/mobile_shortcuts/mobile_shortcuts_lifecycle.js")
	readmeSource := read("runtime/static/terminal/input/mobile_shortcuts/README.md")

	for _, want := range []string{
		`createMobileShortcutsController,`,
		`from "./terminal/input/index.js";`,
		`mobileShortcutsController = createMobileShortcutsController({`,
		`mobileShortcutsController?.render();`,
		`mobileShortcutsController?.dispose();`,
		`shouldApplyStickyTextInput: (value, inputType) => mobileShortcutsController?.shouldApplyStickyTextInput(value, inputType) === true,`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("mobile shortcuts app integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const bindMobileShortcutButton =`,
		`const renderMobileShortcuts =`,
		`const shouldApplyMobileStickyTextInput =`,
		`const mobileShortcutFeedbackEnabled =`,
		`mobileShortcuts.addEventListener("click"`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("mobile shortcuts implementation must stay in its module: %q", forbidden)
		}
	}
	for _, want := range []string{
		`export * from "./mobile_shortcuts_controller.js";`,
		`export * from "./mobile_shortcuts_lifecycle.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("mobile shortcuts public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createMobileShortcutsController({`,
		`const sticky = { ctrl: false, alt: false, shift: false };`,
		`const rememberShortcutSession = (state, shortcut) => {`,
		`const bindButton = (button, shortcut) => {`,
		`const render = () => {`,
		`const dispose = () => {`,
		`lifecycle.resetBindings();`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("mobile shortcuts controller missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`new WebSocket(`,
		`history_replay`,
		`writeReplay(`,
		`terminalPresentation`,
		`terminalResize`,
	} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("mobile shortcuts controller crosses ownership boundary with %q", forbidden)
		}
	}
	for _, want := range []string{
		`export function createMobileShortcutsLifecycle({`,
		`const listeners = [];`,
		`const timers = new Set();`,
		`const intervals = new Set();`,
		`resetBindings`,
		`dispose`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("mobile shortcuts lifecycle missing %q", want)
		}
	}
	for _, forbidden := range []string{`new WebSocket(`, `history_replay`, `document.querySelector(".terminal`} {
		if strings.Contains(lifecycleSource, forbidden) {
			t.Fatalf("mobile shortcuts lifecycle crosses ownership boundary with %q", forbidden)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口",
		"## 状态与生命周期",
		"## 文件清单",
		"dispose()",
		"历史回放",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("mobile shortcuts README missing %q", want)
		}
	}

}

func TestRuntimeTerminalOutputModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js")
	installationSource := read("runtime/static/terminal/session/session_installation_controller.js")
	runtimeControllerSource := read("runtime/static/terminal/rendering/runtime_controller.js")
	outputControllerSource := read("runtime/static/terminal/output/output_controller.js")
	integrationSource := mainSource + "\n" + installationSource + "\n" + runtimeControllerSource + "\n" + outputControllerSource
	indexSource := read("runtime/static/terminal/output/index.js")
	controllerSource := read("runtime/static/terminal/output/output_controller.js")
	lifecycleSource := read("runtime/static/terminal/output/output_lifecycle.js")
	modelSource := read("runtime/static/terminal/output/output_model.js")
	readmeSource := read("runtime/static/terminal/output/README.md")
	resizeSource := read("runtime/static/terminal/resize/resize_controller.js")
	sessionLifecycleSource := read("runtime/static/terminal/session/session_lifecycle.js")

	for _, want := range []string{
		`createTerminalOutputController,`,
		`from "./terminal/output/index.js";`,
		`let terminalOutput = null;`,
		`terminalOutput = createTerminalOutputController({`,
		`getResizeTransition: (session) => terminalResize?.transitionState(session) || {},`,
		`sendQueueTurnAck = (session, pending, payload) => {`,
		`output?.installSession?.(session);`,
		`disposeOutput: (session) => terminalOutput?.disposeSession(session),`,
		`terminalOutput?.dispose();`,
	} {
		if !strings.Contains(integrationSource, want) {
			t.Fatalf("main.js terminal output integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`from "./terminal/output/output_`,
		`const terminalOutputKind =`,
		`const terminalOutputByteLength =`,
		`const writeTerminalOutputBatch =`,
		`const flushSessionOutput =`,
		`const scheduleSessionOutputFlush =`,
		`const handleTerminalOutputOverload =`,
		`const trySendPendingQueueTurnAck =`,
		`session.outputQueue.push(`,
		`session.outputQueueGeneration =`,
		`session.pendingQueueTurnAck =`,
		`sendQueueTurnAck: (session, pending, payload) => {`,
		`socket.send(JSON.stringify(payload));`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal output implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		`from "./output_controller.js";`,
		`export { createTerminalOutputLifecycle } from "./output_lifecycle.js";`,
		`from "./output_model.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal output public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalOutputController({`,
		`const handleOverload = (session, reason) => {`,
		`const writeBatch = (session, data, replayOutput, allowGeneratedInput, suppressRender = false) => {`,
		`const trySendPendingQueueTurnAck = (session) => {`,
		`const flush = (session, {`,
		`const scheduleFlush = (session) => {`,
		`const write = (session, data, {`,
		`const completeQueueTurn = (session, {`,
		`installSession(session) {`,
		`disposeSession(session) {`,
		`dispose() {`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal output controller missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`new WebSocket(`,
		`.close(`,
		`terminalResize`,
		`terminalPresentation`,
		`terminalCacheV2`,
	} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("terminal output controller crosses an ownership boundary with %q", forbidden)
		}
	}

	for _, want := range []string{
		`export function createTerminalOutputLifecycle({`,
		`windowObject?.cancelAnimationFrame?.(session.outputFlushFrame);`,
		`windowObject?.clearTimeout?.(session.outputFlushTimer);`,
		`disposeSession(session) {`,
		`dispose() {`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("terminal output lifecycle missing %q", want)
		}
	}
	for _, want := range []string{
		`export const terminalOutputKind = (data) => {`,
		`export const terminalOutputByteLength = (data) => {`,
		`export const terminalOutputByteChunkEnd = (data, start, maxBytes) => {`,
		`export const splitTerminalOutputText = (data, maxBytes) => {`,
		`export const coalesceTerminalOutputBatch = (chunks, kind, byteLength) => {`,
	} {
		if !strings.Contains(modelSource, want) {
			t.Fatalf("terminal output model missing %q", want)
		}
	}

	if !strings.Contains(sessionLifecycleSource, `invoke(adapters.disposeOutput, session);`) {
		t.Fatal("terminal session lifecycle must dispose output through its public adapter")
	}
	for _, forbidden := range []string{"session.outputQueue", "session.outputQueueSize"} {
		if strings.Contains(resizeSource, forbidden) {
			t.Fatalf("resize must not access terminal output state directly: %q", forbidden)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口与契约",
		"## 状态所有权",
		"## 生命周期",
		"## 文件清单",
		"ACK 不等待 Canvas 绘制",
		"任何 history replay、snapshot、resize 或重连中间过程都不得",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal output README missing %q", want)
		}
	}

}

func TestRuntimeTerminalViewportModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js") + "\n" + readRuntimeBootstrapSource(t) + "\n" + read("runtime/static/app/layout/layout_controller.js")
	indexSource := read("runtime/static/terminal/viewport/index.js")
	controllerSource := read("runtime/static/terminal/viewport/viewport_controller.js")
	lifecycleSource := read("runtime/static/terminal/viewport/viewport_lifecycle.js")
	modelSource := read("runtime/static/terminal/viewport/viewport_model.js")
	readmeSource := read("runtime/static/terminal/viewport/README.md")

	for _, want := range []string{
		`import { createTerminalMobileViewportController } from "./terminal/viewport/index.js";`,
		`let terminalViewport = null;`,
		`terminalViewport = createTerminalMobileViewportController({`,
		`getActiveSession: () => activeSession(),`,
		`claimActiveTabForCurrentDevice: (options) => terminalResize?.claimActiveTabForCurrentDevice(options),`,
		`isViewportGeometryClaimPending: () => terminalViewport?.isGeometryClaimPending() === true,`,
		`resetHostViewport: (session, options) => terminalIME?.resetHostViewport(session, options),`,
		`updateSelectionHandles: (session) => terminalSelection?.updateHandles(session),`,
		`onRenderObserved: (session) => {`,
		`terminalViewport?.syncPan(session);`,
		`isMobileKeyboardResizeSuppressed: () => terminalViewport?.isResizeSuppressed() === true,`,
		`captureInputViewportLock: (session) => terminalViewport?.captureInputLock(session),`,
		`releaseInputViewportLock: (session, options) => terminalViewport?.releaseInputLock(session, options),`,
		`scheduleKeyboardDismissRecovery: () => terminalViewport?.scheduleKeyboardDismissRecovery(),`,
		`handleViewportLayoutChange: () => terminalViewport?.handleLayoutChange(),`,
		`terminalViewport,`,
		`terminalViewport?.dispose();`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main.js terminal viewport integration missing %q", want)
		}
	}

	for _, forbidden := range []string{
		`from "./terminal/viewport/viewport_`,
		`let mobileViewportResizeFrame`,
		`let mobileOrientationRecoverySeq`,
		`let mobileViewportHeight`,
		`let mobileKeyboardInsetBottom`,
		`let mobileKeyboardViewportActive`,
		`let terminalInputViewportLockSession`,
		`const syncMobileVisualViewport =`,
		`const terminalViewportPanY =`,
		`const preventMobileViewportZoom =`,
		`const scheduleMobileKeyboardDismissRecovery =`,
		`window.addEventListener("orientationchange", handleMobileOrientationChange)`,
		`window.visualViewport?.addEventListener("resize", syncMobileVisualViewport)`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal viewport implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		`export { createTerminalMobileViewportController } from "./viewport_controller.js";`,
		`export { createTerminalViewportLifecycle } from "./viewport_lifecycle.js";`,
		`export * from "./viewport_model.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal viewport public entry missing %q", want)
		}
	}

	for _, want := range []string{
		`export function createTerminalMobileViewportController({`,
		`const usesMobileViewportInsets = () => (`,
		`const isMobileKeyboardResizeSuppressed = () => (`,
		`const syncTerminalViewportPan = (session) => {`,
		`const captureTerminalInputViewportLock = (session) => {`,
		`const releaseTerminalInputViewportLock = (session, { resync = true } = {}) => {`,
		`const scheduleMobileKeyboardDismissRecovery = () => {`,
		`const scheduleViewportGeometryClaim = (reason, { force = false } = {}) => {`,
		`const scheduleViewportGeometryValidation = (generation) => {`,
		`const isGeometryClaimPending = () => {`,
		`const syncMobileVisualViewport = ({`,
		`inputLock.session.inputViewportLock = {`,
		`keyboardActive: true,`,
		`scheduleViewportGeometryClaim("mobile_keyboard_dismiss", { force: true });`,
		`start() {`,
		`dispose() {`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal viewport controller missing %q", want)
		}
	}

	for _, forbidden := range []string{
		`new WebSocket(`,
		`history-replay-start`,
		`writeReplay(`,
		`terminalCacheV2`,
		`terminalUnifiedConnection`,
	} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("terminal viewport controller crosses an ownership boundary with %q", forbidden)
		}
	}

	for _, want := range []string{
		`export function createTerminalViewportLifecycle({`,
		`for (const type of ["touchstart", "touchmove", "gesturestart", "gesturechange", "gestureend"]) {`,
		`listen(windowObject?.visualViewport, "resize", handlers.onVisualViewport || noop);`,
		`listen(windowObject, "orientationchange", handlers.onOrientationChange || noop);`,
		`target.removeEventListener(type, callback, options);`,
		`windowObject.clearTimeout(handle);`,
		`windowObject.cancelAnimationFrame(handle);`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("terminal viewport lifecycle missing %q", want)
		}
	}

	for _, want := range []string{
		`export function currentMobileViewportOrientation({`,
		`export function measureMobileViewportBottomInset({`,
		`export function isKeyboardLikeViewportHeightChange(previousHeight, nextHeight, {`,
		`export function terminalViewportPanY(session, {`,
	} {
		if !strings.Contains(modelSource, want) {
			t.Fatalf("terminal viewport model missing %q", want)
		}
	}

	for _, want := range []string{
		"## 职责",
		"## 公开入口与契约",
		"## 状态所有权",
		"## 生命周期",
		"## 文件清单",
		"禁止重新回放历史",
		"迟到回调",
		"1 条 Unified 物理 WebSocket",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal viewport README missing %q", want)
		}
	}

}

func TestRuntimeTerminalOverviewModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js") + "\n" + readRuntimeBootstrapSource(t)
	protocolSource := readRuntimeProtocolSource(t)
	runtimeSource := mainSource + "\n" + protocolSource
	indexSource := read("runtime/static/terminal/overview/index.js")
	controllerSource := read("runtime/static/terminal/overview/overview_controller.js")
	lifecycleSource := read("runtime/static/terminal/overview/overview_lifecycle.js")
	previewControllerSource := read("runtime/static/terminal/overview/preview_controller.js")
	previewStoreSource := read("runtime/static/terminal/overview/preview_store.js")
	viewSource := read("runtime/static/terminal/overview/overview_view.js")
	readmeSource := read("runtime/static/terminal/overview/README.md")

	for _, want := range []string{
		`import { createTerminalOverviewController } from "./terminal/overview/index.js";`,
		`terminalOverview = createTerminalOverviewController({`,
		`getOrderedTabs,`,
		`getActiveTabId,`,
		`isFrameHoldCurrent: (session) => terminalPresentation.frameHoldIsCurrent(session),`,
		`canPersistPreview: (session) => Boolean(`,
		`terminalOverview?.capturePreview(session);`,
		`terminalOverview?.captureAllPreviews(getAllSessions(), { immediate: true });`,
		`terminalOverview?.deletePreview(pane);`,
		`moveTab: (tabId, position) => moveTab(tabId, position),`,
		`terminalOverview,`,
		`terminalOverview?.dispose();`,
		`scheduleOverviewRender: () => terminalOverview?.scheduleRender(),`,
		`openOverview: () => terminalOverview?.open(),`,
		`terminalOverview?.close();`,
		`terminalOverview?.isOpen() === true`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("main.js terminal overview integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`from "./terminal/overview/overview_`,
		`getElementById("tabOverview`,
		`let tabOverviewDragState`,
		`let mobileOverviewEdgeSwipe`,
		`const renderTabOverview =`,
		`const openTabOverview =`,
		`const closeTabOverview =`,
		`const handleMobileOverviewEdgeSwipeStart =`,
		`tabOverviewToggle?.addEventListener`,
		`document.addEventListener("touchstart", handleMobileOverviewEdgeSwipeStart`,
		`new TerminalOverviewPreviewController`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal overview implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		`export { createTerminalOverviewController } from "./overview_controller.js";`,
		`export { createTerminalOverviewLifecycle } from "./overview_lifecycle.js";`,
		`export { createTerminalOverviewView } from "./overview_view.js";`,
		`export { createTerminalOverviewPreviewController } from "./preview_controller.js";`,
		`createTerminalOverviewPreviewStore,`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal overview public entry missing %q", want)
		}
	}

	for _, want := range []string{
		`let tabOverviewDragState = null;`,
		`let mobileOverviewEdgeSwipe = null;`,
		`const renderTabOverview = () => measureTask("tab overview render", () => {`,
		`const paneOverviewSource = (pane) => {`,
		`const liveFrame = pane?.renderReady && pane?.hasPresentedFrame ? liveCanvas : null;`,
		`const heldFrame = isFrameHoldCurrent(pane) ? pane.terminalFrameHold : null;`,
		`const persistedFrame = overviewPreview.get(pane);`,
		`overviewPreview.prepare(pane);`,
		`return liveFrame || heldFrame || persistedFrame;`,
		`const moveTabToOverviewIndex = async`,
		`const animateTabOverviewReorder = (beforeRects) => {`,
		`const updateTabOverviewDragAutoScroll = (state) => {`,
		`const ensureMobileOverviewHistoryGuard = () => {`,
		`const openTabOverviewFromHistoryBack = () => {`,
		`const handleMobileOverviewEdgeSwipeStart = (event) => {`,
		`const handleMobileOverviewEdgeSwipeMove = (event) => {`,
		`lifecycle.dispose?.();`,
		`overviewPreview.dispose();`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal overview controller guard missing %q", want)
		}
	}
	for _, want := range []string{
		`createTerminalOverviewPreviewStore({`,
		`canCapturePane = () => false,`,
		`state.captureSeq += 1;`,
		`state.loadSeq += 1;`,
		`terminalOverviewPreviewKey(identityForPane(pane)) !== identityKey`,
		`String(pane.historyGeneration || "").trim() !== historyGeneration`,
		`store.save(identity, blob, {`,
		`store.delete(identityForPane(pane))`,
	} {
		if !strings.Contains(previewControllerSource, want) {
			t.Fatalf("terminal overview preview controller guard missing %q", want)
		}
	}
	for _, want := range []string{
		`const defaultDatabaseName = "lcmd-webshell-overview-previews-v1";`,
		`const defaultMaxEntries = 64;`,
		`const defaultMaxAgeMs = 30 * 24 * 60 * 60 * 1000;`,
		`database.createObjectStore("previews", { keyPath: "key" });`,
		`identity.workspaceGeneration,`,
		`historyGeneration: normalizePart(metadata.historyGeneration),`,
		`blob,`,
	} {
		if !strings.Contains(previewStoreSource, want) {
			t.Fatalf("terminal overview preview store guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"outputQueue",
		"receivedHistoryCursor",
		"localBaseCursor",
		"writeReplay",
		"new WebSocket",
	} {
		if strings.Contains(previewControllerSource+previewStoreSource, forbidden) {
			t.Fatalf("terminal overview preview persistence must not own PTY/history/transport state %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"writeReplay",
		"history-replay-start",
		"TerminalResizeController",
		"terminalUnifiedConnection",
	} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("terminal overview controller must not own transport/replay/resize implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		`listen(elements.toggle, "click", handlers.onToggle);`,
		`listen(elements.root, "pointerdown", handlers.onCardPointerDown);`,
		`listen(documentObject, "touchstart", handlers.onEdgeSwipeStart, { capture: true, passive: true });`,
		`listen(documentObject, "touchmove", handlers.onEdgeSwipeMove, { capture: true, passive: false });`,
		`listen(windowObject, "resize", handlers.onResize);`,
		`target.removeEventListener?.(type, listener, options);`,
		`listenTransient: listen,`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("terminal overview lifecycle guard missing %q", want)
		}
	}
	for _, want := range []string{
		`getElementById?.("tabOverviewToggle")`,
		`getElementById?.("tabOverview")`,
		`getElementById?.("tabOverviewGrid")`,
		`const renderTabs = ({ orderedTabs, activeTabId, mobileLayout }) => {`,
		`drawLayout(ctx, tab, tab.layout, 0, 0, size.width, size.height, colors, sourceForPane);`,
	} {
		if !strings.Contains(viewSource, want) {
			t.Fatalf("terminal overview view guard missing %q", want)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口与契约",
		"## 状态所有权",
		"## 生命周期与清理",
		"## 文件清单",
		"只观察工作区 tab/pane",
		"不得显示历史 replay",
		"总览 preview 只能作为总览缩略图",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal overview README missing %q", want)
		}
	}

}

func sourceBetween(t *testing.T, source, start, end string) string {
	t.Helper()
	startIndex := strings.Index(source, start)
	if startIndex < 0 {
		t.Fatalf("source missing start marker %q", start)
	}
	bodyStart := startIndex + len(start)
	endIndex := strings.Index(source[bodyStart:], end)
	if endIndex < 0 {
		t.Fatalf("source missing end marker %q after %q", end, start)
	}
	return source[bodyStart : bodyStart+endIndex]
}

func TestRuntimeFontURLsStayRelativeToProviderEntry(t *testing.T) {
	modelData, err := readRuntimeSource("runtime/static/settings/settings_model.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_model.js) error = %v", err)
	}
	registryData, err := readRuntimeSource("runtime/static/settings/font_registry.js")
	if err != nil {
		t.Fatalf("ReadFile(font_registry.js) error = %v", err)
	}
	source := string(modelData) + "\n" + string(registryData)

	wantSnippets := []string{
		"url: String(font?.url || `api/settings/fonts/${encodeURIComponent(id)}/file`).trim(),",
		"const sourceFor = (font) => new URL(",
		"font?.url || `api/settings/fonts/${encodeURIComponent(font?.id || \"\")}/file`,",
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime font URL guard missing %q", want)
		}
	}
	if strings.Contains(source, "`/api/settings/fonts/") || strings.Contains(source, `"/api/settings/fonts/`) {
		t.Fatalf("runtime font URLs must stay relative to provider entry, got source: %s", source)
	}
}

func TestRuntimeHomeNavigationUsesResolvedAdminURL(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/instances/instances_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/instances/instances_controller.js) error = %v", err)
	}
	navigationData, err := readRuntimeSource("runtime/static/instances/instances_navigation.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/instances/instances_navigation.js) error = %v", err)
	}
	mainSource := string(mainData)
	controllerSource := string(controllerData)
	navigationSource := string(navigationData)
	source := mainSource + "\n" + controllerSource + "\n" + navigationSource

	wantSnippets := []string{
		"let inflight = null;",
		"let homeURL = \"\";",
		"export const normalizeLightOSHomeURL = (value, baseURL) => {",
		`const targetURL = new URL(homeURL, baseURL);`,
		`fetchImpl("./api/lightos-admin-info", {`,
		"homeURL = normalizeLightOSHomeURL(info?.home_url, baseURL);",
		"export const withMobileRemoteDesktopPreference = (value, enabled, baseURL) => {",
		`targetURL.searchParams.set("mobile_remote_desktop", enabled ? "1" : "0");`,
		"const homeURL = await instancesNavigation.loadHomeURL();",
		"getMobileRemoteDesktopEnabled: () => settings?.getMobileRemoteDesktopEnabled() === true,",
		"windowObject?.location?.assign?.(targetURL);",
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime home navigation guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"buildCurrentOriginHomeURL",
		`new URL("/", window.location.origin)`,
		"buildExplicitHomeURL",
		"resolveReferrerHomeURL",
		"document.referrer",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("runtime home navigation must not use %q", forbidden)
		}
	}
}

func TestRuntimeShowsClientSettingsOnlyInIndependentClient(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	settingsControllerData, err := readRuntimeSource("runtime/static/settings/settings_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_controller.js) error = %v", err)
	}
	settingsViewData, err := readRuntimeSource("runtime/static/settings/settings_view.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_view.js) error = %v", err)
	}
	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}

	bridgeData, err := readRuntimeSource("runtime/static/vendor/lzc-mobile-bridge-0.0.2.js")
	if err != nil {
		t.Fatalf("ReadFile(lzc-mobile-bridge) error = %v", err)
	}

	indexSource := string(indexData)
	for _, want := range []string{
		`id="settingsMenuButton"`,
		`id="clientSettingsMenuButton" type="button" hidden`,
		`<span class="instance-switcher-item-name">客户端设置</span>`,
		`<span class="instance-switcher-item-meta">打开客户端设置</span>`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("runtime client settings entry missing %q", want)
		}
	}
	if strings.Index(indexSource, `id="clientSettingsMenuButton"`) < strings.Index(indexSource, `id="settingsMenuButton"`) {
		t.Fatal("client settings entry must stay directly below WebShell settings")
	}

	mainSource := string(mainData)
	settingsSource := string(settingsControllerData) + "\n" + string(settingsViewData)
	for _, want := range []string{
		`from "./vendor/lzc-mobile-bridge-0.0.2.js";`,
		`return openConfigurationPage();`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime client settings behavior missing %q", want)
		}
	}
	for _, want := range []string{
		`const independent = await isIndependentClient();`,
		`view.setClientSettingsVisible?.(independent === true);`,
		`elements.clientMenuButton.hidden = !visible;`,
	} {
		if !strings.Contains(settingsSource, want) {
			t.Fatalf("settings client entry behavior missing %q", want)
		}
	}
	if !strings.Contains(string(styleData), `.instance-switcher-action[hidden]`) {
		t.Fatal("hidden client settings entry must stay out of the switcher layout")
	}

	if !strings.Contains(string(bridgeData), `isIndependentClient: "IsIndependentClient"`) ||
		!strings.Contains(string(bridgeData), `openConfigurationPage: "OpenConfigurationPage"`) {
		t.Fatal("vendored lzc-mobile-bridge must expose client configuration methods")
	}

	packageData, err := readRuntimeSource("package.yml")
	if err != nil {
		t.Fatalf("ReadFile(package.yml) error = %v", err)
	}
	assetVersion := packageVersion(packageData)
	handler := versionedStaticFileServer("runtime/static", func() string { return assetVersion })
	recorder := httptest.NewRecorder()
	requestPath := "/assets/" + assetVersion + "/vendor/lzc-mobile-bridge-0.0.2.js"
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, requestPath, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("versioned mobile bridge status = %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
		t.Fatalf("versioned mobile bridge Content-Type = %q", got)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("versioned mobile bridge Cache-Control = %q", got)
	}
}

func TestRuntimeIOSHostAlwaysHidesCloseButton(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	index := string(indexData)
	hostScript := `<script src="__LCMD_ASSET_BASE__terminal/input/ime/ios_terminal_host.js"></script>`
	if !strings.Contains(index, hostScript) {
		t.Fatalf("runtime index missing iOS terminal host script")
	}
	if strings.Index(index, hostScript) > strings.Index(index, `<script type="module" src="__LCMD_ASSET_BASE__main.js"></script>`) {
		t.Fatalf("iOS terminal host script must load before the terminal module")
	}

	scriptData, err := readRuntimeSource("runtime/static/terminal/input/ime/ios_terminal_host.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/input/ime/ios_terminal_host.js) error = %v", err)
	}
	source := string(scriptData)
	for _, want := range []string{
		`const lazycatIOSUserAgent = "Lazycat_103";`,
		`const closeButtonBridgeName = "SetCloseBtnShowStatus";`,
		`bridge.postMessage({ params: [false] });`,
		`document.addEventListener("DOMContentLoaded", reinforceHiddenCloseButton, { once: true });`,
		`window.addEventListener("pageshow", reinforceHiddenCloseButton);`,
		`window.addEventListener("focus", reinforceHiddenCloseButton);`,
		`document.addEventListener("visibilitychange", () => {`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("iOS terminal host guard missing %q", want)
		}
	}
	if strings.Contains(source, "params: [true]") {
		t.Fatalf("terminal page must never show the iOS host close button")
	}
}

func TestRuntimeDeviceManagementStaticGuards(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	index := string(indexData)
	for _, want := range []string{
		`id="settingsDebugModeToggle"`,
		`id="settingsDebugOptions" hidden`,
		`id="settingsOnlineDevicesButton"`,
		`id="settingsDeviceHeartbeatToggle"`,
		"设备心跳",
		"定期上报当前设备在线状态，默认关闭",
		`class="settings-debug-action"`,
		"在线设备",
		"查看当前正在连接的设备",
		`id="deviceBackdrop"`,
		`id="deviceBack"`,
		`class="settings-back"`,
		`id="deviceList"`,
	} {
		if !strings.Contains(index, want) {
			t.Fatalf("runtime device management index guard missing %q", want)
		}
	}
	if strings.Contains(index, `id="deviceMenuButton"`) {
		t.Fatalf("runtime device management must not expose online devices in the top-right menu")
	}
	if strings.Contains(index, `id="settingsOnlineDevicesToggle"`) {
		t.Fatalf("runtime device management must not render online devices as a checkbox toggle")
	}
	onlineDevicesButton := strings.Index(index, `id="settingsOnlineDevicesButton"`)
	deviceHeartbeatToggle := strings.Index(index, `id="settingsDeviceHeartbeatToggle"`)
	performanceMeterToggle := strings.Index(index, `id="settingsPerformanceMeterToggle"`)
	if onlineDevicesButton < 0 || deviceHeartbeatToggle < onlineDevicesButton || performanceMeterToggle < deviceHeartbeatToggle {
		t.Fatal("device heartbeat toggle must appear directly after online devices in debug options")
	}
	if strings.Contains(sourceBetween(t, index, `id="settingsDeviceHeartbeatToggle"`, `id="settingsPerformanceMeterToggle"`), " checked") {
		t.Fatal("device heartbeat toggle must default to disabled")
	}

	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	moduleIndexData, err := readRuntimeSource("runtime/static/devices/index.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/devices/index.js) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/devices/devices_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/devices/devices_controller.js) error = %v", err)
	}
	apiData, err := readRuntimeSource("runtime/static/devices/devices_api.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/devices/devices_api.js) error = %v", err)
	}
	modelData, err := readRuntimeSource("runtime/static/devices/devices_model.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/devices/devices_model.js) error = %v", err)
	}
	viewData, err := readRuntimeSource("runtime/static/devices/devices_view.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/devices/devices_view.js) error = %v", err)
	}
	lifecycleData, err := readRuntimeSource("runtime/static/devices/devices_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/devices/devices_lifecycle.js) error = %v", err)
	}
	readmeData, err := readRuntimeSource("runtime/static/devices/README.md")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/devices/README.md) error = %v", err)
	}

	mainSource := string(mainData) + "\n" + readRuntimeBootstrapSource(t)
	for _, want := range []string{
		`from "./devices/index.js";`,
		"const devices = createDevicesController({",
		"clientID: serverRevision.getClientID(),",
		"devices.syncControls();",
		"onDebugModeDependents: (enabled) => devices.setDebugMode(enabled),",
		"devices.closePanel({ focus: false });",
		"devices.isPanelOpen()",
		"devices.handleEscape(event)",
		"devices.handleResize();",
		"resumeDevices: () => devices.handleResume(),",
		"devices.handlePageHide();",
		"devices,",
		"devices.dispose();",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main.js devices public integration missing %q", want)
		}
	}
	if strings.Contains(mainSource, "deviceMenuButton") {
		t.Fatalf("runtime device management must not keep deviceMenuButton wiring")
	}
	for _, forbidden := range []string{
		`document.getElementById("deviceBackdrop")`,
		`document.getElementById("settingsOnlineDevicesButton")`,
		`document.getElementById("settingsDeviceHeartbeatToggle")`,
		"deviceHeartbeatStorageKey",
		"deviceHeartbeatInFlight",
		"deviceListRequestSeq",
		"const currentDeviceInfo =",
		"const startDeviceHeartbeat =",
		"const refreshDeviceList =",
		"const openDevicePanel =",
		"const closeDevicePanel =",
		`./api/devices/heartbeat`,
		`./api/devices/offline`,
		"settingsOnlineDevicesToggle",
		"onlineDevicesDebugEnabled",
		"syncSettingsOnlineDevicesToggle",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain devices implementation %q", forbidden)
		}
	}

	if !strings.Contains(string(moduleIndexData), `export { createDevicesController } from "./devices_controller.js";`) {
		t.Fatal("devices public entry must export the controller")
	}
	controllerSource := string(controllerData)
	for _, want := range []string{
		"heartbeatIntervalMs = 1500,",
		"listRefreshIntervalMs = 500,",
		"heartbeatTimeoutMs = 5000,",
		"let heartbeatInFlight = null;",
		"let listRequestGeneration = 0;",
		"const listRequestIsCurrent = (generation) => (",
		"heartbeatAbortController?.abort?.();",
		"listAbortController?.abort?.();",
		"generation === listRequestGeneration",
		"if (!debugMode) {",
		"sendOfflineBeacon();",
		"closePanel({ focus: false });",
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("devices controller boundary missing %q", want)
		}
	}
	for _, want := range []string{
		`"./api/devices"`,
		`"./api/devices/heartbeat"`,
		`"./api/devices/offline"`,
		`cache: "no-store"`,
		"navigatorObject.sendBeacon(",
	} {
		if !strings.Contains(string(apiData), want) {
			t.Fatalf("devices API whitelist missing %q", want)
		}
	}
	for _, want := range []string{
		"export function normalizeDevicePlatform",
		"export function normalizeDeviceBrowser",
		"export function currentDeviceInfo",
		"export const deviceListContentSignature",
		"account_id: cleanText(device?.account_id),",
	} {
		if !strings.Contains(string(modelData), want) {
			t.Fatalf("devices model boundary missing %q", want)
		}
	}
	for _, want := range []string{
		`heartbeatToggle: byID("settingsDeviceHeartbeatToggle")`,
		`onlineDevicesButton: byID("settingsOnlineDevicesButton")`,
		"elements.heartbeatToggle.disabled = !debugMode;",
		"暂无正在连接的设备",
	} {
		if !strings.Contains(string(viewData), want) {
			t.Fatalf("devices view boundary missing %q", want)
		}
	}
	for _, want := range []string{
		"target.removeEventListener?.(type, listener, options);",
		`listen(elements.heartbeatToggle, "change", handlers.onHeartbeatChange);`,
		`listen(elements.onlineDevicesButton, "click", handlers.onOpenPanel);`,
	} {
		if !strings.Contains(string(lifecycleData), want) {
			t.Fatalf("devices lifecycle cleanup missing %q", want)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口",
		"## 状态所有权",
		"## 生命周期",
		"## 文件清单",
		"## 依赖方向",
		"## 测试与回归",
	} {
		if !strings.Contains(string(readmeData), want) {
			t.Fatalf("devices README missing %q", want)
		}
	}

	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}
	command := exec.Command(node, "--test", "tests/devices_controller_test.mjs")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("devices controller tests failed: %v\n%s", err, output)
	}

	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	style := string(styleData)
	for _, want := range []string{
		".device-panel",
		".device-list",
		"border: 1px dashed var(--panel-border);",
		"background: var(--panel-subtle-bg);",
		".device-item",
		"background: var(--panel-bg);",
		".settings-debug-options",
		".settings-debug-action",
	} {
		if !strings.Contains(style, want) {
			t.Fatalf("runtime device management style guard missing %q", want)
		}
	}
	deviceStyle := sourceBetween(t, style, ".device-panel", ".settings-section-head")
	for _, forbidden := range []string{"gradient", "animation:"} {
		if strings.Contains(deviceStyle, forbidden) {
			t.Fatalf("runtime device management style must not contain %q", forbidden)
		}
	}
}

func TestRuntimeInstanceSwitcherListScrollsWhenManyInstances(t *testing.T) {
	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	style := string(styleData)
	listStyle := sourceBetween(t, style, ".instance-switcher-list {", ".instance-switcher-list::-webkit-scrollbar")
	for _, want := range []string{
		"max-height: clamp(160px, calc(100dvh - 220px), 340px);",
		"overflow-y: auto;",
		"overscroll-behavior: contain;",
		"scrollbar-width: thin;",
		"-webkit-overflow-scrolling: touch;",
	} {
		if !strings.Contains(listStyle, want) {
			t.Fatalf("runtime instance switcher list scroll guard missing %q", want)
		}
	}
}

func TestRuntimeDebugModeControlsDebugTools(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	index := string(indexData)
	for _, want := range []string{
		`id="settingsMobileRemoteDesktopToggle"`,
		"允许移动端启用远程桌面",
		"允许在 LightOS 移动端首页显示远程桌面入口，默认关闭",
	} {
		if !strings.Contains(index, want) {
			t.Fatalf("runtime mobile remote desktop debug option missing %q", want)
		}
	}
	debugStart := strings.Index(index, `id="settingsDebugOptions" hidden`)
	remoteDesktopToggle := strings.Index(index, `id="settingsMobileRemoteDesktopToggle"`)
	debugEnd := -1
	if debugStart >= 0 {
		debugEnd = strings.Index(index[debugStart:], `id="settingsPanelTheme"`)
	}
	if debugStart < 0 || debugEnd < 0 || remoteDesktopToggle < debugStart || remoteDesktopToggle > debugStart+debugEnd {
		t.Fatal("mobile remote desktop toggle must remain inside the debug options panel")
	}

	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/diagnostics/diagnostics_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/diagnostics_controller.js) error = %v", err)
	}
	lifecycleData, err := readRuntimeSource("runtime/static/diagnostics/diagnostics_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/diagnostics_lifecycle.js) error = %v", err)
	}
	viewData, err := readRuntimeSource("runtime/static/diagnostics/diagnostics_view.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/diagnostics_view.js) error = %v", err)
	}
	settingsControllerData, err := readRuntimeSource("runtime/static/settings/settings_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_controller.js) error = %v", err)
	}
	settingsViewData, err := readRuntimeSource("runtime/static/settings/settings_view.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_view.js) error = %v", err)
	}
	mainSource := string(mainData) + "\n" + readRuntimeBootstrapSource(t)
	diagnosticsSource := strings.Join([]string{string(controllerData), string(lifecycleData), string(viewData)}, "\n")
	settingsSource := string(settingsControllerData) + "\n" + string(settingsViewData)

	for _, want := range []string{
		"debugMode: `${storagePrefix}.debugMode`,",
		"debugMode: readStoredFlag(storageKeys.debugMode),",
		`settingsDebugOptions: byID("settingsDebugOptions")`,
		"elements.settingsDebugOptions.hidden = !debugMode;",
		"performanceMeter.setActive(runtimeActive && state.performanceMeter);",
		"performanceTaskMonitor.setEnabled(runtimeActive && state.performanceTasks);",
		"networkMonitorLifecycle.setActive(runtimeActive && state.networkMonitor);",
		"debugLog.setState({ capture: debugLogActive, show: debugLogActive });",
		`listen(elements.settingsDebugModeToggle, "change", handlers.onDebugModeChange);`,
		"networkMonitorLifecycle.dispose();",
		"performanceMeter.dispose();",
		"debugLog.dispose();",
	} {
		if !strings.Contains(diagnosticsSource, want) {
			t.Fatalf("diagnostics module debug mode guard missing %q", want)
		}
	}
	for _, want := range []string{
		"const diagnostics = createDiagnosticsController({",
		"diagnostics,",
		"diagnostics.dispose();",
		"onDebugModeChange: () => settings?.syncDebugModeDependents(),",
		"onDebugModeDependents: (enabled) => devices.setDebugMode(enabled),",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime diagnostics integration guard missing %q", want)
		}
	}
	for _, want := range []string{
		`const mobileRemoteDesktopStorageKey = "lightos-mobile-remote-desktop-enabled";`,
		`mobileRemoteDesktopEnabled: readStoredBoolean(storage, mobileRemoteDesktopStorageKey, false),`,
		`onMobileRemoteDesktopChange: () => {`,
		`persistLocal(mobileRemoteDesktopStorageKey, value ? "true" : "false");`,
	} {
		if !strings.Contains(settingsSource, want) {
			t.Fatalf("settings debug-dependent preference guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"performanceMeterEnabled = false;",
		"performanceTasksEnabled = false;",
		"mobileRemoteDesktopEnabled = false;",
		"window.localStorage.removeItem(mobileRemoteDesktopStorageKey)",
	} {
		if strings.Contains(mainSource+"\n"+diagnosticsSource+"\n"+settingsSource, forbidden) {
			t.Fatalf("runtime debug mode must not erase persisted feature state with %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		"debugModeStorageKey",
		"debugLogEntries",
		"terminalNetworkMonitorSampleTimer",
		`settingsDebugModeToggle?.addEventListener("change"`,
		`import("./network_monitor.js")`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain diagnostics implementation %q", forbidden)
		}
	}
}
func TestRuntimeForcePCModeOverridesTopLevelLayoutChecks(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	index := string(indexData)
	for _, want := range []string{
		`id="settingsMobileRemoteDesktopToggle"`,
		"允许移动端启用远程桌面",
		`id="settingsForcePCModeToggle"`,
		"强制 PC 模式",
	} {
		if !strings.Contains(index, want) {
			t.Fatalf("runtime force PC option missing %q", want)
		}
	}

	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	settingsControllerData, err := readRuntimeSource("runtime/static/settings/settings_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_controller.js) error = %v", err)
	}
	settingsLifecycleData, err := readRuntimeSource("runtime/static/settings/settings_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_lifecycle.js) error = %v", err)
	}
	mainSource := strings.Join([]string{
		string(mainData),
		string(settingsControllerData),
		string(settingsLifecycleData),
		readRuntimeViewportSource(t),
		string(mustReadRuntimeSource(t, "runtime/static/app/layout/layout_controller.js")),
	}, "\n")
	for _, want := range []string{
		"const forcePCModeStorageKey = `${storagePrefix}.forcePCMode`;",
		`forcePCModeEnabled: readStoredBoolean(storage, forcePCModeStorageKey, false),`,
		"const isForcePCModeActive = () => Boolean(",
		"const isMobileLayout = () => !isForcePCModeActive() && Boolean(mobileLayoutQuery?.matches);",
		"const isTouchShortcutLayout = () => !isForcePCModeActive() && Boolean(touchShortcutLayoutQuery?.matches);",
		"const usesMobileViewportInsets = () => (",
		"&& (isIOSPlatform(navigatorObject) || isAndroidPlatform(navigatorObject))",
		`listen(elements.forcePCModeToggle, "change", handlers.onForcePCModeChange);`,
		`onForcePCModeChange: () => {`,
		"onForcePCModeChange: () => syncForcePCModeState(),",
		"handleViewportLayoutChange: () => terminalViewport?.handleLayoutChange(),",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime force PC top-level guard missing %q", want)
		}
	}

	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	styleSource := string(styleData)
	for _, want := range []string{
		"body.force-pc-mode .tabs {",
		"body.force-pc-mode .settings-modal {",
		"body.force-pc-mode .mobile-shortcuts,",
		"body.force-pc-mode .app-shell,",
	} {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime force PC style guard missing %q", want)
		}
	}
}

func TestRuntimePerformanceMeterIsLazilyMounted(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	indexSource := string(indexData)
	for _, forbidden := range []string{
		`id="performanceMeter"`,
		`id="performanceMeterFps"`,
		`id="performanceMeterRefresh"`,
		"-- FPS",
	} {
		if strings.Contains(indexSource, forbidden) {
			t.Fatalf("runtime FPS meter must not be mounted in initial HTML with %q", forbidden)
		}
	}

	meterData, err := readRuntimeSource("runtime/static/diagnostics/performance_meter.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/performance_meter.js) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/diagnostics/diagnostics_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/diagnostics_controller.js) error = %v", err)
	}
	meterSource := string(meterData)
	controllerSource := string(controllerData)
	for _, want := range []string{
		"let meter = null;",
		"const mount = () => {",
		"if (meter?.isConnected || !container || !documentObject) {",
		`meter.id = "performanceMeter";`,
		`fps.id = "performanceMeterFps";`,
		`refresh.id = "performanceMeterRefresh";`,
		"container.appendChild(meter);",
		"const unmount = () => {",
		"meter?.remove();",
		"meter = null;",
		"fps = null;",
		"refresh = null;",
		"setActive(nextActive) {",
		"mount();",
		"stop();",
		"unmount();",
	} {
		if !strings.Contains(meterSource, want) {
			t.Fatalf("runtime lazy FPS meter guard missing %q", want)
		}
	}
	for _, want := range []string{
		"performanceMeter.setActive(runtimeActive && state.performanceMeter);",
		"performanceMeter.dispose();",
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("diagnostics FPS meter lifecycle guard missing %q", want)
		}
	}
}

func TestRuntimeShortcutDefaultsGuardMacAndAltMappings(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/settings/settings_model.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_model.js) error = %v", err)
	}
	source := string(data)

	wantSnippets := []string{
		"export function isMacPlatform(navigatorObject = globalThis.navigator) {",
		"navigatorObject?.userAgentData?.platform",
		"const macShortcut = (mac, fallback) => isMacPlatform(navigatorObject) ? mac : fallback;",
		`command: "super",`,
		`cmd: "super",`,
		`option: "alt",`,
		"export function shortcutKeyFromEventCode(event) {",
		"if (isMacPlatform(navigatorObject) && event?.altKey) {",
		"key = shortcutKeyFromEventCode(event) || key;",
		`copy_terminal: macShortcut("Command + c", "Ctrl + Shift + c"),`,
		`paste_terminal: macShortcut("Command + v", "Ctrl + Shift + v"),`,
		`close_other_tabs: "Ctrl + Shift + q",`,
		`rename_tab: "Ctrl + Shift + r",`,
		`attachment_clipboard: "Ctrl + Shift + a",`,
		`attachment_file: macShortcut("Command + Shift + e", "Ctrl + Shift + e"),`,
		`last_tab: macShortcut("Option + 0", "Alt + 0"),`,
		`select_up: macShortcut("Option + k", "Alt + k"),`,
		`select_down: macShortcut("Option + j", "Alt + j"),`,
		`select_left: macShortcut("Option + h", "Alt + h"),`,
		`select_right: macShortcut("Option + l", "Alt + l"),`,
		`close_pane: macShortcut("Ctrl + Option + q", "Ctrl + Alt + q"),`,
		"definitions[`tab_${index}`] = macShortcut(`Option + ${index}`, `Alt + ${index}`);",
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime shortcut guard missing %q", want)
		}
	}
}

func TestRuntimeDesktopAltPrintableKeysSendMetaEscapePrefix(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/terminal/input/key_overrides/key_overrides_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(key_overrides_controller.js) error = %v", err)
	}
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	source := string(data)
	integrationSource := string(mainData)

	wantSnippets := []string{
		"export function isPrintableAsciiCharacter(value) {",
		"export function terminalAltMetaInputFromEvent(",
		"if (!isKeyboardEvent(event, KeyboardEventCtor) || !event.altKey || event.ctrlKey || event.metaKey) {",
		`event.getModifierState?.("AltGraph")`,
		"key = shortcutKeyFromEventCodeFn(event);",
		"key = applyStickyShiftInputFn(key) || key;",
		"return `\\x1b${key}`;",
		"const altMetaInput = terminalAltMetaInputFromEvent(event, { KeyboardEventCtor });",
		"term.input(altMetaInput, true);",
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime desktop alt meta guard missing %q", want)
		}
	}
	for _, want := range []string{
		"installKeyOverrides: (session) => terminalKeyOverrides?.installSession(session),",
	} {
		if !strings.Contains(integrationSource, want) {
			t.Fatalf("runtime desktop alt meta integration guard missing %q", want)
		}
	}
}

func TestRuntimePasteShortcutUsesNativePasteEvent(t *testing.T) {
	mainSource := readRuntimeSources(t, "runtime/static/global-runtime.js")
	installationSource := readRuntimeSources(t, "runtime/static/terminal/session/session_installation_controller.js")
	shortcutSource := readRuntimeSources(t, "runtime/static/app/shortcuts/shortcut_controller.js")
	imeSource := readRuntimeIMESource(t)
	modelSource := readRuntimeSources(t, "runtime/static/settings/settings_model.js")
	clipboardSource := readRuntimeSources(t, "runtime/static/terminal/interaction/clipboard_adapter.js")
	source := strings.Join([]string{mainSource, installationSource, shortcutSource, imeSource, modelSource, clipboardSource}, "\n")

	for _, want := range []string{
		`export function isShiftInsertPasteShortcutEvent(event) {`,
		`export function isNativePasteShortcutEvent(event, navigatorObject = globalThis.navigator) {`,
		`focusForNativePaste(session = getActiveSession()) {`,
		`return focusInput(session, { requestMobileKeyboard: true });`,
		`case "paste_terminal":`,
		`focusForNativePaste();`,
		`if (configuredAction === "paste_terminal") {`,
		`throw new Error("当前页面策略禁止主动读取剪贴板，请使用系统粘贴快捷键。");`,
		`lifecycle.listen(session, textarea, "paste", (event) => {`,
		`Promise.resolve(pasteText(session, text)).catch((error) => showToast(error.message));`,
		`pasteText: (session, text) => terminalClipboard?.pasteSession(session, text),`,
		`onPaste: (event) => {`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime native paste shortcut guard missing %q", want)
		}
	}

	ghosttySource := readRuntimeSources(t, "runtime/static/ghostty-web.js")
	for _, want := range []string{
		`A.shiftKey && !A.ctrlKey && !A.altKey && !A.metaKey && (A.code === "Insert" || A.key === "Insert" || A.keyCode === 45)`,
		`A.metaKey && A.code === "KeyC")`,
	} {
		if !strings.Contains(ghosttySource, want) {
			t.Fatalf("ghostty native paste shortcut passthrough missing %q", want)
		}
	}

	earlyNativePasteBranch := sourceBetween(t, shortcutSource,
		`if (isNativePaste(event)) {`,
		`    if (invoke(handleTerminalFontSizeShortcut, event)) {`,
	)
	for _, want := range []string{
		`focusForNativePaste();`,
		`closeContextMenu();`,
		`event.stopPropagation?.();`,
		`event.stopImmediatePropagation?.();`,
		`return true;`,
	} {
		if !strings.Contains(earlyNativePasteBranch, want) {
			t.Fatalf("runtime early native paste branch missing %q", want)
		}
	}
	for _, forbidden := range []string{`pasteIntoSession(`, `readClipboardText(`, `event.preventDefault();`, `runShortcutAction(`} {
		if strings.Contains(earlyNativePasteBranch, forbidden) {
			t.Fatalf("runtime early native paste branch must not contain %q", forbidden)
		}
	}

	shiftInsertPasteBranch := sourceBetween(t, shortcutSource,
		`if (isShiftInsertPaste(event)) {`,
		`    if (isNativePaste(event)) {`,
	)
	for _, want := range []string{
		`event.preventDefault?.();`,
		`event.stopPropagation?.();`,
		`event.stopImmediatePropagation?.();`,
		`focusForNativePaste();`,
		`Promise.resolve(pasteTerminal()).catch((error) => showToast(error?.message || String(error)));`,
		`return true;`,
	} {
		if !strings.Contains(shiftInsertPasteBranch, want) {
			t.Fatalf("runtime Shift+Insert paste branch missing %q", want)
		}
	}

	nativePasteBranch := sourceBetween(t, shortcutSource,
		`if (configuredAction === "paste_terminal") {`,
		`    event.preventDefault?.();`,
	)
	for _, want := range []string{`focusForNativePaste();`, `closeContextMenu();`, `return true;`} {
		if !strings.Contains(nativePasteBranch, want) {
			t.Fatalf("runtime native paste shortcut branch missing %q", want)
		}
	}
	for _, forbidden := range []string{`pasteIntoSession(`, `readClipboardText(`, `event.preventDefault();`} {
		if strings.Contains(nativePasteBranch, forbidden) {
			t.Fatalf("runtime native paste shortcut branch must not contain %q", forbidden)
		}
	}

	pasteShortcutActionBranch := sourceBetween(t, shortcutSource,
		`case "paste_terminal":`,
		`      case "search_terminal":`,
	)
	if !strings.Contains(pasteShortcutActionBranch, `focusForNativePaste();`) {
		t.Fatal("runtime paste shortcut action should focus terminal for native paste")
	}
}

func TestRuntimeDesktopDoubleClickInlineRenamesTab(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	tabViewData, err := readRuntimeSource("runtime/static/workspace/tab_view.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/workspace/tab_view.js) error = %v", err)
	}
	tabControllerData, err := readRuntimeSource("runtime/static/workspace/tab_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/workspace/tab_controller.js) error = %v", err)
	}
	shortcutData, err := readRuntimeSource("runtime/static/app/shortcuts/shortcut_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/app/shortcuts/shortcut_controller.js) error = %v", err)
	}
	source := strings.Join([]string{string(mainData), string(tabViewData), string(tabControllerData), string(shortcutData)}, "\n")
	controllerData, err := readRuntimeSource("runtime/static/workspace/tab_label_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/workspace/tab_label_controller.js) error = %v", err)
	}
	controllerSource := string(controllerData)
	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	styleSource := string(styleData)

	wantControllerSnippets := []string{
		"let inlineRenameState = null;",
		"const beginInlineTabRename = (tabID) => {",
		"if (disposed || isMobileLayout()) {",
		`input.className = "tab-rename-input";`,
		`input.addEventListener("blur", () => {`,
		`finishInlineTabRename({ commit: true }).catch((error) => showToast(error?.message || String(error)));`,
		"return commitTabRename(state.tabId, nextLabel, { optimistic: true });",
		`"rename_tab",`,
		`{ tab_id: tabID, label: normalized },`,
	}
	for _, want := range wantControllerSnippets {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("workspace tab label controller guard missing %q", want)
		}
	}

	wantMainSnippets := []string{
		`workspaceTabLabels = createWorkspaceTabLabelController({`,
		`button.addEventListener("dblclick", (event) => {`,
		"beginInlineRename(tab.id);",
		`await commitTabRename(tabId, normalized, { force: true });`,
		`isInstance(target, HTMLInputElementCtor)`,
	}
	for _, want := range wantMainSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime inline tab rename guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"let inlineTabRenameState = null;",
		"const beginInlineTabRename =",
		`input.className = "tab-rename-input";`,
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("app controller must not retain inline tab rename implementation %q", forbidden)
		}
	}

	wantStyleSnippets := []string{
		".tab.renaming .tab-label",
		".tab-rename-input",
		"position: fixed;",
		"border: 1px solid var(--input-focus-border);",
	}
	for _, want := range wantStyleSnippets {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime inline tab rename style missing %q", want)
		}
	}
}

func TestRuntimeShortcutSettingsGuardDesktopShortcutEditor(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(index.html) error = %v", err)
	}
	indexSource := string(indexData)
	for _, want := range []string{
		`data-settings-tab="desktop-shortcuts">PC快捷键设置`,
		`id="settingsDesktopShortcutAddButton"`,
		`id="settingsDesktopShortcutResetButton"`,
		`id="settingsDesktopShortcutList"`,
		`id="desktopShortcutEditor"`,
		`id="desktopShortcutCaptureInput"`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("index desktop shortcut guard missing %q", want)
		}
	}

	paths := []string{
		"runtime/static/settings/settings_model.js",
		"runtime/static/settings/settings_controller.js",
		"runtime/static/settings/settings_view.js",
		"runtime/static/settings/settings_lifecycle.js",
		"runtime/static/settings/shortcut_editor.js",
	}
	var settingsParts []string
	for _, path := range paths {
		data, readErr := readRuntimeSource(path)
		if readErr != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, readErr)
		}
		settingsParts = append(settingsParts, string(data))
	}
	settingsSource := strings.Join(settingsParts, "\n")
	for _, want := range []string{
		"export function createDefaultDesktopShortcuts",
		`["close_other_tabs", "关闭其他标签"]`,
		`["rename_tab", "重命名标签"]`,
		`["attachment_clipboard", "从剪贴板导入附件"]`,
		`["attachment_file", "上传附件文件"]`,
		`patch: { desktop_shortcuts: reset ? null : serializeDesktopShortcuts(shortcuts) }`,
		`listen(elements.desktopShortcutAddButton, "click", handlers.onDesktopShortcutAdd);`,
		`const shortcut = buildDesktopShortcut({`,
		`view.openDesktopShortcutEditor?.(existing);`,
	} {
		if !strings.Contains(settingsSource, want) {
			t.Fatalf("settings desktop shortcut guard missing %q", want)
		}
	}

	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(main.js) error = %v", err)
	}
	mainSource := string(mainData)
	shortcutData, err := readRuntimeSource("runtime/static/app/shortcuts/shortcut_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/app/shortcuts/shortcut_controller.js) error = %v", err)
	}
	shortcutSource := string(shortcutData)
	runtimeSource := mainSource + "\n" + shortcutSource
	for _, want := range []string{
		`case "close_other_tabs":`,
		`case "rename_tab":`,
		`case "attachment_clipboard":`,
		`case "attachment_file":`,
		`settings?.resolveDesktopShortcutAction(shortcut)`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("main desktop shortcut execution guard missing %q", want)
		}
	}
}

func TestRuntimeAttachmentsModuleBoundary(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	indexData, err := readRuntimeSource("runtime/static/attachments/index.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/attachments/index.js) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/attachments/attachments_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/attachments/attachments_controller.js) error = %v", err)
	}
	apiData, err := readRuntimeSource("runtime/static/attachments/attachments_api.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/attachments/attachments_api.js) error = %v", err)
	}
	lifecycleData, err := readRuntimeSource("runtime/static/attachments/attachments_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/attachments/attachments_lifecycle.js) error = %v", err)
	}
	readmeData, err := readRuntimeSource("runtime/static/attachments/README.md")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/attachments/README.md) error = %v", err)
	}

	mainSource := string(mainData) + "\n" + readRuntimeBootstrapSource(t)
	for _, want := range []string{
		`from "./attachments/index.js";`,
		`const attachments = createAttachmentsController({`,
		`attachments.handleTargetChange();`,
		`handleTabRemoved: (tabId) => attachments.handleTabRemoved(tabId),`,
		`refreshUploadPanels: () => attachments.refreshUploadPanels(),`,
		`attachments.handleEscape(event)`,
		`attachments,`,
		`attachments.dispose();`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main.js attachments public integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`document.getElementById("attachmentBackdrop")`,
		`document.getElementById("attachmentBrowserBackdrop")`,
		`let attachmentBrowserRequestSeq`,
		`let attachmentUploads`,
		`pendingAttachmentFileClipboard`,
		`const uploadAttachments =`,
		`const openAttachmentBrowser =`,
		`const readClipboardFiles =`,
		`./api/attachments/files`,
		`./api/attachments/download`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain attachments implementation %q", forbidden)
		}
	}

	if !strings.Contains(string(indexData), `export { createAttachmentsController } from "./attachments_controller.js";`) {
		t.Fatal("attachments public entry must export the controller")
	}
	controllerSource := string(controllerData)
	for _, want := range []string{
		`const uploads = new Map();`,
		`let browserRequestGeneration = 0;`,
		`let clipboardReadGeneration = 0;`,
		`browserCurrentPath = context.isClient ? "/" : context.cwd || "/";`,
		`browserRequestIsCurrent(generation, targetName)`,
		`uploads.delete(id);`,
		`xhr.abort?.();`,
		`handleTargetChange`,
		`handleTabRemoved`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("attachments controller boundary missing %q", want)
		}
	}
	apiSource := string(apiData)
	for _, want := range []string{
		`"./api/attachments"`,
		`"./api/attachments/files"`,
		`"./api/attachments/download"`,
	} {
		if !strings.Contains(apiSource, want) {
			t.Fatalf("attachments API whitelist missing %q", want)
		}
	}
	for _, want := range []string{
		`target.removeEventListener?.(type, listener, options);`,
		`listen(elements.browserBackdrop, "touchmove", handlers.onTouchMove, { passive: false });`,
		`listen(elements.fileInput, "cancel", handlers.onFileInputCancel);`,
	} {
		if !strings.Contains(string(lifecycleData), want) {
			t.Fatalf("attachments lifecycle cleanup missing %q", want)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口",
		"## 状态所有权",
		"## 生命周期",
		"## 文件清单",
		"## 依赖方向",
		"## 测试与回归",
	} {
		if !strings.Contains(string(readmeData), want) {
			t.Fatalf("attachments README missing %q", want)
		}
	}

	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}
	command := exec.Command(node, "--test", "tests/attachments_controller_test.mjs")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("attachments controller tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeTerminalSettingsPhysicalMachineInfo(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	source := string(data)
	clientTitle := strings.Index(source, `id="settingsPhysicalMachineTitle"`)
	multiScreenTitle := strings.Index(source, `id="settingsMultiScreenOutputTitle"`)
	if clientTitle < 0 || multiScreenTitle < 0 || clientTitle >= multiScreenTitle {
		t.Fatal("physical machine information must appear above multi-screen output information")
	}
	const want = "在懒猫微服 PC 客户端中启用「接入 LightOS」后，这台物理机将作为客户端实例接入 LightOS，并允许你从 LightOS 访问其终端和相关资源。"
	if !strings.Contains(source, want) {
		t.Fatalf("physical machine information text missing %q", want)
	}
}

func TestRuntimeMobileSettingsUsesListNavigation(t *testing.T) {
	checks := map[string][]string{
		"runtime/static/index.html": {
			`id="settingsMobileNav"`,
			`role="list" aria-label="设置分类" hidden`,
		},
		"runtime/static/settings/settings_view.js": {
			`mobileNav: byID("settingsMobileNav")`,
			`button.dataset.settingsMobileNavTab = tabID;`,
			`renderMobileNav() {`,
			`syncMobileNavigation({ isMobile, mobileView }) {`,
		},
		"runtime/static/settings/settings_controller.js": {
			`let mobileView = "detail";`,
			`mobileView = isMobileLayout() ? "index" : "detail";`,
			`const openMobileDetail = (tabID, { focus = true } = {}) => {`,
			`openMobileIndex();`,
		},
		"runtime/static/settings/settings_lifecycle.js": {
			`listen(elements.mobileNav, "click", handlers.onMobileNavClick);`,
		},
		"runtime/static/style.css": {
			`.settings-mobile-nav`,
			`.settings-tabs {` + "\n" + `    display: none;`,
			`.settings-panel[data-mobile-settings-view="index"] .settings-body`,
		},
	}
	for path, snippets := range checks {
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		for _, want := range snippets {
			if !strings.Contains(string(data), want) {
				t.Fatalf("mobile settings navigation guard missing %q in %s", want, path)
			}
		}
	}
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(main.js) error = %v", err)
	}
	if strings.Contains(string(mainData), `getElementById("settingsMobileNav")`) {
		t.Fatal("main.js must not retain settings navigation DOM ownership")
	}
}

func TestRuntimeMobileDoubleTapReminderSetting(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(index.html) error = %v", err)
	}
	for _, want := range []string{
		`id="settingsMobileDoubleTapReminderToggle"`,
		"双击屏幕提醒",
		"熟悉手机双击进入编辑的操作后,可以关闭这个选项",
	} {
		if !strings.Contains(string(indexData), want) {
			t.Fatalf("mobile reminder index guard missing %q", want)
		}
	}

	settingsData, err := readRuntimeSource("runtime/static/settings/settings_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_controller.js) error = %v", err)
	}
	modelData, err := readRuntimeSource("runtime/static/settings/settings_model.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_model.js) error = %v", err)
	}
	lifecycleData, err := readRuntimeSource("runtime/static/settings/settings_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_lifecycle.js) error = %v", err)
	}
	settingsSource := string(settingsData) + "\n" + string(modelData) + "\n" + string(lifecycleData)
	for _, want := range []string{
		`mobileDoubleTapReminderEnabled: true,`,
		`mobileDoubleTapReminderEnabled: raw?.mobile_double_tap_reminder_enabled !== false,`,
		`patch: { [patchKey]: value }`,
		`"mobileDoubleTapReminderEnabled", "mobile_double_tap_reminder_enabled"`,
		`listen(elements.mobileDoubleTapReminderToggle, "change", handlers.onMobileDoubleTapReminderChange);`,
	} {
		if !strings.Contains(settingsSource, want) {
			t.Fatalf("settings mobile reminder guard missing %q", want)
		}
	}

	presentationData, err := readRuntimeSource("runtime/static/workspace/presentation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(presentation_controller.js) error = %v", err)
	}
	presentationSource := string(presentationData)
	for _, want := range []string{
		`if (!getMobileDoubleTapReminderEnabled() || !requiresTouchKeyboardDoubleTap()) {`,
		`const activePaneDirectoryLabel = () => workspacePathBasenameLabel(activeSession()?.cwd);`,
		`: activePaneDirectoryLabel() || String(tab?.label || "终端").trim() || "终端";`,
	} {
		if !strings.Contains(presentationSource, want) {
			t.Fatalf("workspace presentation mobile reminder guard missing %q", want)
		}
	}

	appData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(global-runtime.js) error = %v", err)
	}
	for _, forbidden := range []string{
		`const activePaneDirectoryLabel =`,
		`const shouldShowMobileKeyboardFocusPrompt =`,
	} {
		if strings.Contains(string(appData), forbidden) {
			t.Fatalf("app controller must not retain workspace presentation implementation %q", forbidden)
		}
	}
}

func TestRuntimeDesktopShortcutsBarSetting(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	indexSource := string(indexData)
	mouseSection := sourceBetween(t, indexSource, `<section class="settings-section" aria-labelledby="settingsMouseTitle">`, `<section class="settings-section" aria-labelledby="settingsDesktopShortcutsBarTitle">`)
	if strings.Contains(mouseSection, `settingsDesktopShortcutsBarToggle`) {
		t.Fatal("desktop shortcuts bar option must not be nested in the mouse settings section")
	}
	shortcutsSection := sourceBetween(t, indexSource, `<section class="settings-section" aria-labelledby="settingsDesktopShortcutsBarTitle">`, `<section class="settings-section" aria-labelledby="settingsMultiScreenOutputTitle">`)
	for _, want := range []string{
		`<h3 id="settingsDesktopShortcutsBarTitle">快捷键栏</h3>`,
		`id="settingsDesktopShortcutsBarToggle"`,
		`在PC中开启底部快捷键栏`,
		`type="checkbox" />`,
	} {
		if !strings.Contains(shortcutsSection, want) {
			t.Fatalf("desktop shortcuts bar option missing %q from its settings section", want)
		}
	}
	if strings.Contains(shortcutsSection, `id="settingsDesktopShortcutsBarToggle" type="checkbox" checked`) {
		t.Fatal("desktop shortcuts bar must default to disabled")
	}

	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	settingsControllerData, err := readRuntimeSource("runtime/static/settings/settings_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_controller.js) error = %v", err)
	}
	settingsViewData, err := readRuntimeSource("runtime/static/settings/settings_view.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_view.js) error = %v", err)
	}
	settingsLifecycleData, err := readRuntimeSource("runtime/static/settings/settings_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_lifecycle.js) error = %v", err)
	}
	settingsModelData, err := readRuntimeSource("runtime/static/settings/settings_model.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_model.js) error = %v", err)
	}
	mainSource := strings.Join([]string{
		string(mainData),
		string(settingsControllerData),
		string(settingsViewData),
		string(settingsLifecycleData),
		string(settingsModelData),
	}, "\n")
	for _, want := range []string{
		`desktopShortcutsBarEnabled: false,`,
		`desktopShortcutsBarEnabled: raw?.desktop_shortcuts_bar_enabled === true,`,
		`documentObject?.body?.classList.toggle("desktop-shortcuts-bar-enabled", snapshot.desktopShortcutsBarEnabled);`,
		`"desktopShortcutsBarEnabled", "desktop_shortcuts_bar_enabled"`,
		`onDesktopShortcutsBarChange: () => terminalResize?.resizeActiveTabForCurrentDevice(),`,
		`listen(elements.desktopShortcutsBarToggle, "change", handlers.onDesktopShortcutsBarChange);`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("desktop shortcuts bar runtime guard missing %q", want)
		}
	}

	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	styleSource := string(styleData)
	for _, want := range []string{
		`@media (hover: hover) and (pointer: fine) {`,
		`body.desktop-shortcuts-bar-enabled .mobile-shortcuts {`,
		`body.desktop-shortcuts-bar-enabled .app-shell {`,
		`inset: 0 0 var(--mobile-shortcuts-total-height) 0;`,
		`body.desktop-shortcuts-bar-enabled .selection-sheet {`,
		`body.desktop-shortcuts-bar-enabled .network-banner {`,
	} {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("desktop shortcuts bar CSS guard missing %q", want)
		}
	}
}

func TestRuntimeDesktopShortcutsDoNotRetainButtonFocus(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	source := string(data)
	layoutData, err := readRuntimeSource("runtime/static/app/layout/layout_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(layout_controller.js) error = %v", err)
	}
	layoutSource := string(layoutData)
	shortcutData, err := readRuntimeSource("runtime/static/terminal/input/mobile_shortcuts/mobile_shortcuts_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(mobile_shortcuts_controller.js) error = %v", err)
	}
	bindBody := sourceBetween(t, string(shortcutData), `  const bindButton = (button, shortcut) => {`, `  const render = () => {`)
	for _, want := range []string{
		`lifecycle.listen(button, "mousedown", (event) => {`,
		`if (!isDesktopShortcutBarLayout()) {`,
		`event.preventDefault?.();`,
		`rememberShortcutSession(state, shortcut);`,
		`button.blur?.();`,
	} {
		if !strings.Contains(bindBody, want) {
			t.Fatalf("desktop shortcut focus isolation guard missing %q", want)
		}
	}
	if !strings.Contains(source, `const isDesktopShortcutBarLayout = () => layoutController?.isDesktopShortcutBarLayout() === true;`) &&
		!strings.Contains(layoutSource, `const isDesktopShortcutBarLayout = () => getDesktopShortcutsBarEnabled() === true && !isTouchShortcutLayout();`) {
		t.Fatal("desktop shortcut layout guard is missing")
	}
	for _, forbidden := range []string{
		`const desktopShortcutPendingModifiers =`,
		`const activeShortcutModifiers =`,
		`event.pointerType === "mouse" && isDesktopShortcutBarLayout()`,
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("desktop shortcut focus fix must not replace mobile sticky state, found %q", forbidden)
		}
	}
}

func TestRuntimeTouchKeyboardRequiresDoubleTapOnWideTouchScreens(t *testing.T) {
	mainSource := readRuntimeSources(t, "runtime/static/global-runtime.js")
	imeSource := readRuntimeIMESource(t)
	layoutSource := readRuntimeSources(t, "runtime/static/app/layout/layout_controller.js")
	source := mainSource + "\n" + layoutSource + "\n" + imeSource

	for _, want := range []string{
		`const requiresTouchKeyboardDoubleTap = () => isTouchShortcutLayout();`,
		`requiresTouchKeyboardDoubleTap: () => requiresTouchKeyboardDoubleTap(),`,
		`if (requiresTouchKeyboardDoubleTap() && now() > Number(session?.allowMobileKeyboardFocusUntil || 0)) {`,
		`targetSession.allowMobileKeyboardFocusUntil = now() + focusAllowWindowMs;`,
		`if (!requiresTouchKeyboardDoubleTap() || event.touches.length !== 1 || !isTerminalTouchTarget(event.target)) {`,
		`if (!requiresTouchKeyboardDoubleTap() || !mobileTapTouchState) {`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime wide touch keyboard double-tap guard missing %q", want)
		}
	}
}
func TestRuntimeTouchKeyboardFocusPrecedesTouchConsumers(t *testing.T) {
	installationSource := readRuntimeSources(t, "runtime/static/terminal/session/session_installation_controller.js")
	imeSource := readRuntimeIMESource(t)
	inputFocus := sourceBetween(t, imeSource, `  const installInputFocus = (session) => {`, `  const installHostViewportGuard = (session) => {`)

	for _, want := range []string{
		`const shell = session?.shellEl;`,
		`const isTerminalTouchTarget = (target) => isElement(target) && target.closest(".terminal-host") === host;`,
		`lifecycle.listen(session, shell, "touchstart", startMobileTap, { capture: true, passive: true });`,
		`lifecycle.listen(session, shell, "touchmove", moveMobileTap, { capture: true, passive: true });`,
		`lifecycle.listen(session, shell, "touchend", finishMobileTap, { capture: true, passive: false });`,
		`lifecycle.listen(session, shell, "touchend", settleMobileTap);`,
		`lifecycle.listen(session, shell, "touchcancel", cancelMobileTap, { capture: true, passive: true });`,
		`if (finishState?.event === event && !finishState.isDoubleTap) {`,
		`blurInput(session);`,
	} {
		if !strings.Contains(inputFocus, want) {
			t.Fatalf("runtime touch keyboard focus must observe gestures before terminal consumers, missing %q", want)
		}
	}
	for _, forbidden := range []string{`lifecycle.listen(session, host, "touchstart"`, `primaryTouch(`} {
		if strings.Contains(inputFocus, forbidden) {
			t.Fatalf("runtime touch keyboard focus must not depend on host bubbling, found %q", forbidden)
		}
	}

	finishMobileTap := sourceBetween(t, inputFocus, `    const finishMobileTap = (event) => {`, `    const settleMobileTap = (event) => {`)
	for _, want := range []string{
		`const touch = event.changedTouches?.[0] || event.touches?.[0] || null;`,
		`forceMobileFocusTransition: true,`,
	} {
		if !strings.Contains(finishMobileTap, want) {
			t.Fatalf("runtime touch keyboard focus missing %q", want)
		}
	}
	for _, forbidden := range []string{"requestAnimationFrame", "setTimeout", "Promise"} {
		if strings.Contains(finishMobileTap, forbidden) {
			t.Fatalf("runtime touch keyboard focus must stay synchronous with touchend, found %q", forbidden)
		}
	}

	installInputFocus := strings.Index(installationSource, `ime?.installSession?.(session);`)
	installSelection := strings.Index(installationSource, `selection?.installSession?.(session);`)
	installMouseTracking := strings.Index(installationSource, `mouse?.installSession?.(session);`)
	if installInputFocus < 0 || installSelection < 0 || installMouseTracking < 0 || !(installInputFocus < installSelection && installSelection < installMouseTracking) {
		t.Fatal("runtime touch keyboard capture listener must be installed before selection and mouse tracking")
	}
	focusPosition := strings.Index(finishMobileTap, `focusInput(session, {`)
	preventPosition := strings.Index(finishMobileTap, `event.preventDefault();`)
	if focusPosition < 0 || preventPosition < 0 || focusPosition > preventPosition {
		t.Fatal("runtime touch keyboard focus must run before cancelling the Android touchend default action")
	}
}
func TestRuntimeAndroidKeyboardFocusStaysAboveTerminalLayers(t *testing.T) {
	imeSource := readRuntimeIMESource(t)
	styleSource := readRuntimeSources(t, "runtime/static/style.css")
	rendererSource := readRuntimeSources(t, "runtime/static/ghostty-web.js")

	if !strings.Contains(imeSource, `textarea.style.zIndex = "3";`) {
		t.Fatal("terminal helper textarea must stay above terminal presentation layers")
	}
	for _, want := range []string{
		`.terminal-host textarea {`,
		`position: absolute;`,
		`z-index: 3;`,
		`.terminal-frame-hold {`,
		`z-index: 1;`,
		`.terminal-composition-preview {`,
		`z-index: 2;`,
	} {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime Android keyboard layer guard missing %q", want)
		}
	}
	if !strings.Contains(rendererSource, `this.canvas = document.createElement("canvas")`) ||
		!strings.Contains(rendererSource, `this.textarea = document.createElement("textarea")`) {
		t.Fatal("Ghostty terminal must keep canvas and helper textarea creation visible to the layer guard")
	}
	if strings.Index(rendererSource, `this.canvas = document.createElement("canvas")`) > strings.Index(rendererSource, `this.textarea = document.createElement("textarea")`) {
		t.Fatal("Ghostty helper textarea must remain associated with the canvas layer")
	}

	inputFocus := sourceBetween(t, imeSource, `  const requestAndroidSoftKeyboard = (textarea) => {`, `  const setComposing = (session, composing) => {`)
	for _, want := range []string{
		`const keyboard = navigatorObject.virtualKeyboard;`,
		`forceMobileFocusTransition = false,`,
		`const activateAndroidKeyboard = requestMobileKeyboard && isAndroidPlatform(navigatorObject);`,
		`&& forceMobileFocusTransition`,
		`&& documentObject.activeElement === textarea`,
		`textarea.blur();`,
		`textarea.style.pointerEvents = "auto";`,
		`textarea.focus({ preventScroll: true });`,
		`requestAndroidSoftKeyboard(textarea);`,
	} {
		if !strings.Contains(inputFocus, want) {
			t.Fatalf("runtime Android keyboard activation guard missing %q", want)
		}
	}
}
func TestRuntimeMobileKeyboardPanTracksRenderedTerminal(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(main.js) error = %v", err)
	}
	mainSource := string(data)
	viewportSource := readRuntimeViewportSource(t)
	source := mainSource + "\n" + viewportSource
	presentationData, err := readRuntimeSource("runtime/static/terminal/rendering/presentation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(presentation_controller.js) error = %v", err)
	}
	renderListener := sourceBetween(t, string(presentationData),
		`    onRender: () => {`,
		`  });`,
	)
	markPosition := strings.Index(renderListener, `const completed = markRendered(session);`)
	panPosition := strings.Index(renderListener, `onRenderObserved(session);`)
	if markPosition < 0 || panPosition < 0 || panPosition < markPosition {
		t.Fatal("terminal render completion must refresh the mobile keyboard pan after committing the rendered cursor")
	}
	if !strings.Contains(mainSource, `onRenderObserved: (session) => {`) ||
		!strings.Contains(mainSource, `terminalViewport?.syncPan(session);`) {
		t.Fatal("main presentation adapter must route render observation to mobile viewport pan sync")
	}
	lockBranch := sourceBetween(t, viewportSource,
		`  const captureTerminalInputViewportLock = (session) => {`,
		`  const isKeyboardLikeViewportHeightChange = (previousHeight, nextHeight, { orientationChanged = false } = {}) => (`,
	)
	if strings.Contains(lockBranch, `panY:`) {
		t.Fatal("IME viewport lock must not freeze the cursor-driven terminal pan")
	}
	for _, want := range []string{
		`const keyboardOpenedAfterLock = Boolean(`,
		`inputLock.session.inputViewportLock = {`,
		`keyboardActive: true,`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("IME viewport lock must rebase after a delayed keyboard open, missing %q", want)
		}
	}
}

func TestRuntimeInitializationFocusCannotOverrideMobileKeyboard(t *testing.T) {
	protocolSource := readRuntimeProtocolSource(t)
	imeSource := readRuntimeIMESource(t)
	inputFocus := sourceBetween(t, imeSource,
		`  const focusInput = (session, {`,
		`  const setComposing = (session, composing) => {`,
	)
	for _, want := range []string{
		`focusSource = "user",`,
		`focusSource === "system"`,
		`if (documentObject.activeElement !== textarea) {`,
		`return false;`,
		`positionInput(session);`,
	} {
		if !strings.Contains(inputFocus, want) {
			t.Fatalf("mobile system focus isolation missing %q", want)
		}
	}
	systemBranch := sourceBetween(t, inputFocus,
		`if (requiresTouchKeyboardDoubleTap() && focusSource === "system") {`,
		`    if (requiresTouchKeyboardDoubleTap() && now() > Number(session?.allowMobileKeyboardFocusUntil || 0)) {`,
	)
	if strings.Contains(systemBranch, `blurInput(session);`) {
		t.Fatal("mobile system focus path must not blur the active user input")
	}
	if !strings.Contains(imeSource, `term.focus = () => focusInput(session, { focusSource: "system" });`) {
		t.Fatal("terminal system focus calls must use the non-stealing focus source")
	}
	openBranch := sourceBetween(t, protocolSource,
		`currentSocket.addEventListener("open", () => {`,
		`currentSocket.addEventListener("message", (event) => {`,
	)
	if !strings.Contains(openBranch, `session.term.focus();`) {
		t.Fatal("socket open should retain desktop focus behavior through the guarded terminal focus wrapper")
	}
}
func TestRuntimeDefaultMobileShortcutOrder(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/settings/settings_model.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_model.js) error = %v", err)
	}
	source := string(data)
	tabSnippet := `{ id: "tab", label: "Tab", ariaLabel: "Tab", data: "\t", inputKey: "tab" },`
	continueSnippet := `{ id: "continue", label: "Continue", ariaLabel: "Continue", text: "continue", data: "continue", kind: "primary" },`
	returnSnippet := `{ id: "return", label: "Return", ariaLabel: "Return", data: "\r", inputKey: "enter", kind: "primary" },`
	tabIndex := strings.Index(source, tabSnippet)
	continueIndex := strings.Index(source, continueSnippet)
	returnIndex := strings.Index(source, returnSnippet)
	if tabIndex < 0 || continueIndex < 0 || returnIndex < 0 || tabIndex > continueIndex || continueIndex > returnIndex {
		t.Fatalf("default mobile shortcut order should place Tab before Continue before Return")
	}
}

func TestRuntimeMobileShortcutTextButtons(t *testing.T) {
	checks := map[string][]string{
		"runtime/static/index.html": {
			`value="text"`,
			`id="mobileShortcutTextField"`,
			`id="mobileShortcutTextInput"`,
		},
		"runtime/static/settings/settings_view.js": {
			`mobileShortcutTextInput: byID("mobileShortcutTextInput")`,
			`text: String(elements.mobileShortcutTextInput?.value ?? ""),`,
		},
		"runtime/static/settings/settings_model.js": {
			`text: typeof shortcut?.text === "string" ? shortcut.text : "",`,
			`item.text = text;`,
		},
		"runtime/static/settings/shortcut_editor.js": {
			`const text = typeof draft?.text === "string" ? draft.text : "";`,
			`shortcut.text = text;`,
		},
		"runtime/static/terminal/input/mobile_shortcuts/mobile_shortcuts_controller.js": {
			`if (typeof shortcut.text === "string" && shortcut.text !== "") {`,
			`const text = normalizeShortcutText(shortcut.text);`,
			`sendInput(session, text);`,
		},
	}
	for path, snippets := range checks {
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		for _, want := range snippets {
			if !strings.Contains(string(data), want) {
				t.Fatalf("mobile shortcut text guard missing %q in %s", want, path)
			}
		}
	}
	modelData, err := readRuntimeSource("runtime/static/settings/settings_model.js")
	if err != nil {
		t.Fatalf("ReadFile(settings_model.js) error = %v", err)
	}
	if strings.Contains(string(modelData), "text.trim()") {
		t.Fatal("mobile shortcut text must preserve leading/trailing spaces and newlines")
	}
}

func TestRuntimeMobileReturnShortcutRepeats(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/terminal/input/mobile_shortcuts/mobile_shortcuts_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	source := string(data)

	wantSnippets := []string{
		`repeatInitialDelayMs = 320,`,
		`repeatIntervalMs = 80,`,
		`const isRepeatable = (shortcut) => REPEATABLE_INPUT_KEYS.has(String(shortcut?.inputKey || ""));`,
		`state.repeatTimer = lifecycle.setInterval(() => {`,
		`trigger(shortcut, state.shortcutSession || getActiveSession(), { feedback: false });`,
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime mobile return repeat guard missing %q", want)
		}
	}
}

func TestRuntimeTerminalRendererCellSeamPatch(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/terminal/rendering/renderer_adapter.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/rendering/renderer_adapter.js) error = %v", err)
	}
	source := string(data)

	wantSnippets := []string{
		`const installCellSeam = (session) => {`,
		`renderer.webshellOriginalRenderCellBackground = renderer.renderCellBackground.bind(renderer);`,
		`renderer.renderCellBackground = (cell, column, row, offsetY = 0) => {`,
		`renderer.webshellOriginalRenderCellBackground(cell, column, row, offsetY);`,
		`const bleed = terminalCellBleedPx(renderer);`,
		`const terminalCanvasPixelPx = (renderer) => {`,
		`const terminalAlignToCanvasPixel = (renderer, value, mode = "round") => {`,
		`return Math.floor(scaled) * pixel;`,
		`return Math.ceil(scaled) * pixel;`,
		`const terminalCellFlagInverse = 16;`,
		`const terminalCellFlagInvisible = 32;`,
		`const terminalCellFlagFaint = 128;`,
		`const terminalCellBackgroundRGB = (cell) => {`,
		`const terminalSameRGB = (left, right) =>`,
		`const terminalLineCellAt = (renderer, row, column) => {`,
		`const renderTerminalMergedLineBackgrounds = (renderer, line, row, columns, offsetY = 0) => {`,
		`const rawY = row * height + offsetY;`,
		`const y = terminalAlignToCanvasPixel(renderer, rawY, "floor");`,
		`const bottom = terminalAlignToCanvasPixel(renderer, rawY + height, "ceil");`,
		`const fillHeight = Math.max(terminalCanvasPixelPx(renderer), bottom - y);`,
		`renderer.ctx.fillRect(segmentStart * width, y, (segmentEnd - segmentStart) * width, fillHeight);`,
		`const leftCell = terminalLineCellAt(renderer, row, column - 1);`,
		`const bleedLeft = terminalSameRGB(rgb, terminalCellBackgroundRGB(leftCell)) ? bleed : 0;`,
		`renderer.ctx.fillRect(x, y, width * cellWidth + bleedLeft + bleedRight, height);`,
		`renderer.renderCursor = (column, row) => {`,
		`if (renderer.cursorStyle !== "block") {`,
		`renderer.ctx.fillRect(column * width - bleed, row * height, width + bleed * 2, height);`,
		`const terminalPowerlineShape = (renderer, cell, column, row) => {`,
		`if (text === "\uE0B6") {`,
		`if (text === "\uE0B4") {`,
		`if (text === "\uE0B0") {`,
		`const rawTop = row * height + offsetY;`,
		`const y = terminalAlignToCanvasPixel(renderer, rawTop, "ceil");`,
		`height: Math.max(terminalCanvasPixelPx(renderer), bottom - y),`,
		`const drawTerminalPowerlineRoundCap = (renderer, direction, cell, column, row, offsetY = 0) => {`,
		`renderer.ctx.rect(box.x - bleed, box.y, box.width + bleed * 2, box.height);`,
		`renderer.ctx.ellipse(`,
		`const drawTerminalPowerlineArrow = (renderer, direction, cell, column, row, offsetY = 0) => {`,
		`const pixel = terminalCanvasPixelPx(renderer);`,
		`const baseBleed = Math.max(bleed, pixel);`,
		`const baseOuter = direction === "right" ? box.x - baseBleed : box.x + box.width + baseBleed;`,
		`const clipLeft = Math.min(baseOuter, tip) - pixel;`,
		`renderer.ctx.clip();`,
		`renderer.ctx.moveTo(baseOuter, box.y);`,
		`renderer.ctx.lineTo(tip, box.y + box.height / 2);`,
		`const drawTerminalPowerlineShape = (renderer, shape, cell, column, row, offsetY = 0) => {`,
		`renderer.renderCellText = (cell, column, row, offsetY = 0) => {`,
		`drawTerminalPowerlineShape(renderer, shape, cell, column, row, offsetY)`,
		`renderer.renderLine = (line, row, columns, offsetY = 0) => {`,
		`renderTerminalMergedLineBackgrounds(renderer, line, row, columns, offsetY)`,
		`installCellSeam(session);`,
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime terminal renderer cell seam patch missing %q", want)
		}
	}
}

func TestRuntimeTerminalSelectionCopySkipsWideCellPlaceholders(t *testing.T) {
	modelData, err := readRuntimeSource("runtime/static/terminal/selection/selection_model.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/selection/selection_model.js) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/terminal/selection/selection_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/selection/selection_controller.js) error = %v", err)
	}
	source := strings.Join([]string{string(modelData), string(controllerData)}, "\n")

	wantSnippets := []string{
		`export const terminalSelectionText = (manager) => {`,
		`const terminalSelectionCellText = (manager, cell, absoluteRow, column, scrollback) => {`,
		`if (Number(cell?.width ?? 1) === 0) {`,
		`return { text: "", content: false };`,
		`manager.wasmTerm?.getScrollbackGraphemeString?.(absoluteRow, column)`,
		`manager.wasmTerm?.getGraphemeString?.(absoluteRow - scrollback, column)`,
		`lineText += cellText.text;`,
		`if (cellText.content) {`,
		`lineText = lastContentLength >= 0 ? lineText.substring(0, lastContentLength) : "";`,
		`manager.webshellOriginalGetSelection = manager.getSelection;`,
		`const patchedGetSelection = function (...args) {`,
		`return terminalSelectionText(this);`,
		`manager.getSelection = patchedGetSelection;`,
		`installSelectionManagerCopyPatch(session);`,
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime terminal selection copy guard missing %q", want)
		}
	}
}

func TestRuntimeTerminalRendererBaselinePatch(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/terminal/rendering/renderer_adapter.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/rendering/renderer_adapter.js) error = %v", err)
	}
	source := string(data)

	wantSnippets := []string{
		`const terminalBaselineSampleText = "\uF303\uF017Hg|pqyj\u00C5\u00C9()[]{}0123456789";`,
		`const terminalAdjustedFontMetrics = (renderer, metrics) => {`,
		`const measured = context.measureText(terminalBaselineSampleText);`,
		`const nextBaseline = Math.round((nextHeight + ascent - descent) / 2);`,
		`const installBaseline = (session) => {`,
		`renderer.webshellOriginalMeasureFont = renderer.measureFont.bind(renderer);`,
		`renderer.measureFont = () => terminalAdjustedFontMetrics(renderer, renderer.webshellOriginalMeasureFont());`,
		`renderer.metrics = renderer.measureFont();`,
		`installBaseline(session);`,
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime terminal renderer baseline patch missing %q", want)
		}
	}
}

func TestRuntimeTerminalRendererAdapterModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js") + "\n" +
		read("runtime/static/terminal/transport/session_protocol_controller.js") + "\n" +
		read("runtime/static/terminal/session/session_installation_controller.js")
	indexSource := read("runtime/static/terminal/rendering/index.js")
	adapterSource := read("runtime/static/terminal/rendering/renderer_adapter.js")
	readmeSource := read("runtime/static/terminal/rendering/README.md")

	for _, want := range []string{
		`export { createTerminalRendererAdapter } from "./renderer_adapter.js";`,
		`export function createTerminalRendererAdapter({`,
		`installSession(session) {`,
	} {
		if !strings.Contains(indexSource+adapterSource, want) {
			t.Fatalf("terminal renderer adapter boundary missing %q", want)
		}
	}
	for _, want := range []string{
		`terminalRenderer = createTerminalRendererAdapter({`,
		`captureViewport: (term) => terminalRenderer?.captureViewport(term),`,
		`normalizeBottomViewport: (term) => terminalRenderer?.normalizeBottomViewport(term),`,
		`renderer?.installSession?.(session);`,
		`syncRendererRuntime: (session) => terminalRenderer?.syncRuntime(session),`,
		`terminalRenderer?.dispose();`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main renderer adapter wiring missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const terminalBaselineSampleText =`,
		`const terminalCellBleedPx =`,
		`const terminalCanvasPixelPx =`,
		`const terminalPowerlineShape =`,
		`const renderTerminalMergedLineBackgrounds =`,
		`const installRendererBaselinePatch =`,
		`const installRendererCellSeamPatch =`,
		`renderer.webshellOriginalRenderCellBackground =`,
		`renderer.webshellOriginalMeasureFont =`,
		`isTerminalViewportAtBottom(`,
		`normalizeTerminalBottomViewport(`,
		`terminalViewportValue(`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain renderer adapter implementation %q", forbidden)
		}
	}
	for _, forbidden := range []string{"WebSocket", "history", "replay", "resize", "presentation"} {
		if strings.Contains(adapterSource, forbidden) {
			t.Fatalf("renderer adapter must not own %s state", forbidden)
		}
	}
	for _, want := range []string{
		"renderer_adapter.js",
		"字体/行高度量",
		"不建立 WebSocket",
		"显示 history replay、snapshot",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal rendering README missing %q", want)
		}
	}

}

func TestTerminalRuntimeControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_runtime_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal runtime controller tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeTerminalRuntimeModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/terminal/rendering/index.js")
	controllerSource := read("runtime/static/terminal/rendering/runtime_controller.js")
	readmeSource := read("runtime/static/terminal/rendering/README.md")

	for _, want := range []string{
		`export { createTerminalRuntimeController } from "./runtime_controller.js";`,
		`createTerminalRuntimeController,`,
		`terminalRuntime = createTerminalRuntimeController({`,
		`const clearTerminalRuntimeBuffer = (session) => terminalRuntime?.clearBuffer(session) === true;`,
		`const resetTerminalRuntimeState = (session) => terminalRuntime?.reset(session) === true;`,
		`const beginTerminalRenderSuppression = (session, reason) => terminalRuntime?.beginRenderSuppression(session, reason) === true;`,
		`terminalRuntime?.dispose();`,
	} {
		if !strings.Contains(indexSource+"\n"+appSource, want) {
			t.Fatalf("terminal runtime public wiring missing %q", want)
		}
	}
	for _, want := range []string{
		`const terminalRuntimeClearSequence = "\x1b[2J\x1b[3J\x1b[H";`,
		`export function createTerminalRuntimeController({`,
		`const clearBuffer = (session) => {`,
		`term.wasmTerm.write(terminalRuntimeClearSequence);`,
		`const syncReferences = (session) => {`,
		`const reset = (session) => {`,
		`const resetAfterInitialFit = (session) => {`,
		`const beginRenderSuppression = (session, reason = "generic") => {`,
		`const endRenderSuppression = (session, {`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal runtime controller missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"socket.send",
		"history-replay-start",
		"appliedHistoryCursor",
		"term.resize(",
		"fetch(",
	} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("terminal runtime controller crosses transport/history/resize boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		`const terminalRuntimeClearSequence =`,
		`term.wasmTerm.write(terminalRuntimeClearSequence);`,
		`session.terminalRenderSuppressionReasons = new Set();`,
		`const syncTerminalRuntimeReferences =`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain terminal runtime implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		"runtime_controller.js",
		"runtime reset",
		"render suppression",
		"不决定 history replay 时机",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal rendering README runtime boundary missing %q", want)
		}
	}

}

func TestRuntimeTerminalPresentationModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js") + "\n" +
		read("runtime/static/terminal/transport/session_protocol_controller.js") + "\n" +
		read("runtime/static/terminal/session/session_installation_controller.js")
	indexSource := read("runtime/static/terminal/rendering/index.js")
	controllerSource := read("runtime/static/terminal/rendering/presentation_controller.js")
	lifecycleSource := read("runtime/static/terminal/rendering/presentation_lifecycle.js")
	stateSource := read("runtime/static/terminal/rendering/presentation_state.js")
	viewSource := read("runtime/static/terminal/rendering/presentation_view.js")
	readmeSource := read("runtime/static/terminal/rendering/README.md")
	sessionStateSource := read("runtime/static/terminal/session/session_state.js")

	for _, want := range []string{
		`export { createTerminalPresentationController } from "./presentation_controller.js";`,
		`export { createTerminalPresentationState } from "./presentation_state.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal presentation public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`createTerminalPresentationController,`,
		`} from "./terminal/rendering/index.js";`,
		`terminalPresentation = createTerminalPresentationController({`,
		`isReplayCommitted: (session) => terminalReplay.isCommitted(session),`,
		`isPaneMeasurable: (session) => terminalResize?.isMeasurable(session) === true,`,
		`isLiveGeometryActive: (session) => terminalResize?.isLiveGeometryActive(session) === true,`,
		`isCurrentDeviceClaimRequired: (session) => terminalResize?.isCurrentDeviceClaimRequired(session) === true,`,
		`isViewportGeometryClaimPending: () => terminalViewport?.isGeometryClaimPending() === true,`,
		`scheduleResize: (session, options, scheduleOptions) => terminalResize?.schedulePresentationResize(session, options, scheduleOptions) === true,`,
		`retryResize: (session) => terminalResize?.resendPendingSize(session) === true,`,
		`recoverTransport: (session, reason, options) => terminalTransportRuntime?.recycleUnifiedSession(session, reason, options),`,
		`presentation?.installSession?.(session);`,
		`ensurePresentation: (session, options) => terminalPresentation?.ensure(session, options),`,
		`terminalPresentation?.dispose();`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("main terminal presentation wiring missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const clearTerminalCanvasPixels =`,
		`const advanceTerminalContentGeneration =`,
		`const setPaneRenderReady =`,
		`const markPaneSyncPending =`,
		`const invalidatePanePresentation =`,
		`const holdSessionTerminalFrame =`,
		`const releaseSessionTerminalFrame =`,
		`const beginTerminalPresentationHold =`,
		`const commitTerminalPresentationIfReady =`,
		`const schedulePanePresentationRetry =`,
		`const panePresentationIsCurrent =`,
		`const cancelPendingTerminalRender =`,
		`const renderPaneFullNow =`,
		`const schedulePaneFullRenderValidation =`,
		`const installTerminalCanvasRecovery =`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal presentation implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		`export function createTerminalPresentationController({`,
		`const renderAllowed = (session) => {`,
		`const liveGeometry = isLiveGeometryActive(session);`,
		`(liveGeometry || !session.resizeAckPending)`,
		`const commitIfReady = (session) => {`,
		`const renderLiveGeometryNow = (session) => {`,
		`const ensure = (session, {`,
		`if (isCurrentDeviceClaimRequired(session) || isViewportGeometryClaimPending(session)) {`,
		`presentation_wait_current_device_claim`,
		`const scheduleValidation = (session, { forceHistory = false } = {}) => {`,
		`const recoverStalled = (session, now = Date.now()) => {`,
		`installSession,`,
		`dispose,`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal presentation controller guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalPresentationLifecycle({`,
		`const schedulePresentationFrame = (session, reason, callback) => {`,
		`const scheduleTimeoutField = (session, field, delay, callback) => {`,
		`canvas.addEventListener("contextlost", handleContextLost);`,
		`canvas.removeEventListener("contextrestored", handleContextRestored);`,
		`renderDisposable?.dispose?.();`,
		`frameReleaseScheduler.dispose();`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("terminal presentation lifecycle guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export const createTerminalPresentationState = () => ({`,
		`presentationRetryPending: false,`,
		`presentationCommitPending: false,`,
		`resizePresentationHold: false,`,
		`import { createTerminalPresentationState } from "../rendering/index.js";`,
		`...createTerminalPresentationState(),`,
	} {
		if !strings.Contains(stateSource+sessionStateSource, want) {
			t.Fatalf("terminal presentation state guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalPresentationView({`,
		`const clearCanvas = (session) => {`,
		`ctx.fillStyle = getBackground(session) || "#000000";`,
		`ctx.drawImage(`,
		`sourceCssWidth,`,
		`sourceCssHeight,`,
		`session.shellEl.dataset.renderReady = session.renderReady ? "true" : "false";`,
	} {
		if !strings.Contains(viewSource, want) {
			t.Fatalf("terminal presentation view guard missing %q", want)
		}
	}

	presentationSource := strings.Join([]string{controllerSource, lifecycleSource, stateSource, viewSource}, "\n")
	for _, forbidden := range []string{
		"new WebSocket",
		"socket.send",
		"writeReplay",
		"term.resize(",
		"fetch(",
		`"/api/`,
	} {
		if strings.Contains(presentationSource, forbidden) {
			t.Fatalf("terminal presentation module must not own transport/history/resize implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		"presentation controller",
		"presentation session 字段的唯一初始化定义",
		"不建立 WebSocket",
		"禁止显示历史回放中间过程",
		"session 销毁或模块 dispose 时统一取消",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal rendering README presentation boundary missing %q", want)
		}
	}

}

func TestRuntimeTerminalLineHeightSetting(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(index.html) error = %v", err)
	}
	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(style.css) error = %v", err)
	}
	for _, want := range []string{
		`id="settingsLineHeightInput"`,
		`id="settingsLineHeightResetButton"`,
		`min="100" max="160"`,
		`class="settings-number-stepper"`,
		`data-number-step="up" data-number-target="settingsLineHeightInput"`,
		`data-number-step="down" data-number-target="settingsScrollbackInput"`,
	} {
		if !strings.Contains(string(indexData), want) {
			t.Fatalf("line height index guard missing %q", want)
		}
	}

	settingsPaths := []string{
		"runtime/static/settings/settings_model.js",
		"runtime/static/settings/settings_controller.js",
		"runtime/static/settings/settings_view.js",
		"runtime/static/settings/settings_lifecycle.js",
	}
	var settingsParts []string
	for _, path := range settingsPaths {
		data, readErr := readRuntimeSource(path)
		if readErr != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, readErr)
		}
		settingsParts = append(settingsParts, string(data))
	}
	settingsSource := strings.Join(settingsParts, "\n")
	for _, want := range []string{
		`export const DEFAULT_TERMINAL_LINE_HEIGHT_PERCENT = 100;`,
		`export const MAX_TERMINAL_LINE_HEIGHT_PERCENT = 160;`,
		`export function normalizeTerminalLineHeightPercent(value) {`,
		`terminalLineHeightPercent: normalizeTerminalLineHeightPercent(raw?.terminal_line_height_percent),`,
		`patch: { terminal_line_height_percent: value },`,
		`listen(elements.lineHeightInput, "input", handlers.onLineHeightInput);`,
		`lineHeightInput: byID("settingsLineHeightInput")`,
		`input.stepUp();`,
		`listen(elements.panel, "click", handlers.onPanelClick);`,
	} {
		if !strings.Contains(settingsSource, want) {
			t.Fatalf("settings line height guard missing %q", want)
		}
	}

	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(main.js) error = %v", err)
	}
	mainSource := string(mainData)
	metricsSource := readRuntimeSources(t, "runtime/static/terminal/metrics/metrics_controller.js")
	stateApplyData, err := readRuntimeSource("runtime/static/workspace/state_apply_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(state_apply_controller.js) error = %v", err)
	}
	installationSource := readRuntimeSources(t, "runtime/static/terminal/session/session_installation_controller.js")
	runtimeSource := mainSource + "\n" + metricsSource + "\n" + string(stateApplyData) + "\n" + installationSource
	rendererData, err := readRuntimeSource("runtime/static/terminal/rendering/renderer_adapter.js")
	if err != nil {
		t.Fatalf("ReadFile(renderer_adapter.js) error = %v", err)
	}
	rendererSource := string(rendererData)
	for _, want := range []string{
		`normalizeLineHeightPercent(getLineHeightPercent()) / defaultLineHeightPercent`,
		`const applyTerminalLineHeightToMetrics = (metrics) => {`,
		`const terminalAdjustedFontMetrics = (renderer, metrics) => {`,
		`const terminalEstimatedFontMetrics = () => {`,
	} {
		if !strings.Contains(rendererSource, want) {
			t.Fatalf("renderer line height adapter guard missing %q", want)
		}
	}
	for _, want := range []string{
		`terminalRenderer = createTerminalRendererAdapter({`,
		`getLineHeightPercent: () => settings?.getTerminalLineHeightPercent(),`,
		`normalizeLineHeightPercent: (value) => normalizeTerminalLineHeightPercent(value),`,
		`defaultLineHeightPercent: defaultTerminalLineHeightPercent,`,
		`const terminalEstimatedSizeForElement = (element) => (`,
		`terminalMetrics?.estimatedSizeForElement(element)`,
		`const terminalOptions = (overrides = {}) =>`,
		`const createPaneSession = (tab, instanceName, options) => (`,
		`const session = sessionController.create({`,
		`terminalTransportRuntime = createTerminalTransportRuntimeController({`,
		`connectPendingSession: (session, options) => terminalTransportRuntime?.connectPendingSession(session, options),`,
		`createPaneSession(tab, targetName, {`,
		`cols: paneState.cols,`,
		`rows: paneState.rows,`,
		`onTerminalLineHeightChange: (value, previousValue) => terminalMetrics?.applyLineHeight(value, previousValue),`,
		`const applyLineHeight = (value, previousValue) => {`,
		`resize?.beginMetricsLiveGeometry?.(session)`,
		`resize?.updateMetricsLiveGeometry?.(session, { force: forceSizeSync })`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("main line height adapter guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const applyTerminalLineHeightToMetrics =`,
		`const terminalAdjustedFontMetrics =`,
		`const terminalEstimatedFontMetrics =`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain renderer line height implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`.settings-number-stepper`,
		`appearance: textfield;`,
		`.settings-number-input::-webkit-inner-spin-button`,
		`.settings-number-stepper-button.up::before`,
		`.settings-number-stepper-button.down::before`,
	} {
		if !strings.Contains(string(styleData), want) {
			t.Fatalf("line height style guard missing %q", want)
		}
	}
}

func TestRuntimeTerminalScrollbackSettingPersistence(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(index.html) error = %v", err)
	}
	for _, want := range []string{
		`id="settingsScrollbackInput"`,
		`id="settingsScrollbackResetButton"`,
		`id="settingsFeedback" aria-live="polite"`,
	} {
		if !strings.Contains(string(indexData), want) {
			t.Fatalf("scrollback index guard missing %q", want)
		}
	}

	settingsPaths := []string{
		"runtime/static/settings/settings_model.js",
		"runtime/static/settings/settings_controller.js",
		"runtime/static/settings/settings_view.js",
		"runtime/static/settings/settings_lifecycle.js",
	}
	var settingsParts []string
	for _, path := range settingsPaths {
		data, readErr := readRuntimeSource(path)
		if readErr != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, readErr)
		}
		settingsParts = append(settingsParts, string(data))
	}
	settingsSource := strings.Join(settingsParts, "\n")
	for _, want := range []string{
		`export const DEFAULT_TERMINAL_SCROLLBACK = 2000;`,
		`patch: { terminal_scrollback: value },`,
		`api.patch({ terminal_scrollback: value }, { keepalive: true, signal })`,
		`view.setFeedback?.(error.message || "滚动历史设置无效。", "error");`,
		`view.setFeedback?.("滚动历史设置已保存，刷新或新建终端后生效。", "success");`,
		`view.setFeedback?.(error.message || "滚动历史设置保存失败。", "error");`,
		`view.setFeedback?.("滚动历史已恢复默认，刷新或新建终端后生效。", "success");`,
		`flushPending() {`,
		`onPageHide: () => controller.flushPending(),`,
		`listen(windowObject, "pagehide", handlers.onPageHide);`,
	} {
		if !strings.Contains(settingsSource, want) {
			t.Fatalf("settings scrollback persistence guard missing %q", want)
		}
	}

	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(main.js) error = %v", err)
	}
	mainSource := string(mainData)
	appLifecycleSource := readRuntimeSources(t, "runtime/static/app/app_lifecycle.js")
	metricsSource := readRuntimeSources(t, "runtime/static/terminal/metrics/metrics_controller.js")
	for _, want := range []string{
		`const applyScrollback = (value = getScrollback()) => {`,
		`session.term.options.scrollback = scrollback;`,
		`const applyScrollbackChange = (previousValue, nextValue) => {`,
		`terminalMetrics?.applyScrollbackChange(previousScrollback, nextScrollback)`,
		`listen(windowObject, "pagehide", handlers.onPageHide);`,
		`listen(windowObject, "beforeunload", handlers.onBeforeUnload);`,
	} {
		if !strings.Contains(mainSource+"\n"+appLifecycleSource+"\n"+metricsSource, want) {
			t.Fatalf("main scrollback adapter guard missing %q", want)
		}
	}
	beforeUnload := sourceBetween(t, mainSource, `onBeforeUnload: (event) => {`, `onHeartbeat:`)
	if !strings.Contains(beforeUnload, `settings?.flushPending();`) {
		t.Fatal("beforeunload must flush pending scrollback before any early return")
	}
	if strings.Index(beforeUnload, `settings?.flushPending();`) > strings.Index(beforeUnload, `hasCachedBusyPane()`) {
		t.Fatal("beforeunload scrollback flush must run before the busy-pane confirmation branch")
	}
}

func TestRuntimeMobileStickyModifiersApplyToTextInput(t *testing.T) {
	mainSource := readRuntimeSources(t, "runtime/static/global-runtime.js")
	imeSource := readRuntimeIMESource(t)
	shortcutSource := readRuntimeMobileShortcutsSource(t)
	keyOverrideSource := readRuntimeSources(t, "runtime/static/terminal/input/key_overrides/key_overrides_controller.js")
	source := mainSource + "\n" + imeSource + "\n" + shortcutSource + "\n" + keyOverrideSource

	for _, want := range []string{
		`const shouldApplyStickyTextInput = (value, inputType = "") => {`,
		`type === "insertFromPaste" || type.includes("Composition")`,
		`return canApplyStickyModifierInput(value);`,
		`const consumeStickyInput = (value) => {`,
		`const encoded = applyStickyModifierInput(value, {`,
		`const clearSticky = () => {`,
		`const shouldApplyStickyCompositionInput = (value) => {`,
		`codePoint >= 0x20 && codePoint <= 0x7e;`,
		`focusFromShortcut(session = getActiveSession()) {`,
		`targetSession.allowMobileKeyboardFocusUntil = now() + focusAllowWindowMs;`,
		`return focusInput(targetSession, { requestMobileKeyboard: true });`,
		`const inputData = applySticky ? consumeStickyInput(rawData) : rawData;`,
		`last?.data === rawData || last?.rawData === rawData`,
		`applySticky: shouldApplyStickyTextInput(data, type),`,
		`applySticky: shouldApplyStickyTextInput(value, type),`,
		`applySticky: shouldApplyStickyCompositionInput(data),`,
		`applySticky: shouldApplyStickyCompositionInput(compositionValue),`,
		`applySticky: shouldApplyStickyCompositionInput(committedText),`,
		`terminalIME?.focusFromShortcut?.(session);`,
		`shouldApplyStickyTextInput: (value, inputType) => mobileShortcutsController?.shouldApplyStickyTextInput(value, inputType) === true,`,
		`consumeStickyInput: (value) => mobileShortcutsController?.consumeStickyInput(value) || String(value || ""),`,
		`const input = consumeStickyInput(event.key);`,
		`sendInput(session, input);`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime mobile sticky modifier guard missing %q", want)
		}
	}
}
func TestRuntimeMobileIMECompositionPreviewVisible(t *testing.T) {
	mainSource := readRuntimeSources(t, "runtime/static/global-runtime.js")
	installationSource := readRuntimeSources(t, "runtime/static/terminal/session/session_installation_controller.js")
	imeSource := readRuntimeIMESource(t)
	sessionSource := readRuntimeSources(t, "runtime/static/terminal/session/session_state.js")
	resourceSource := readRuntimeSources(t, "runtime/static/terminal/session/resource_factory.js")
	source := strings.Join([]string{mainSource, installationSource, imeSource, sessionSource, resourceSource}, "\n")

	for _, want := range []string{
		`const resetHostViewport = (session, { clean = false } = {}) => {`,
		`const keep = new Set([`,
		`session.term?.canvas,`,
		`session.term?.textarea,`,
		`session.terminalFrameHold,`,
		`session.compositionPreview,`,
		`const scheduleHostViewportReset = (session, options = {}) => {`,
		`const textareaCompositionText = (session) => {`,
		`const setTextareaCompositionText = (session, text) => {`,
		`const syncCompositionPreview = (session, {`,
		`const text = session.composingIME ? textareaCompositionText(session) : "";`,
		`preview.textContent = text;`,
		"preview.style.left = `${x}px`;",
		"preview.style.maxWidth = `${Math.max(maxWidth, width, 2)}px`;",
		`const theme = getTheme();`,
		`const hostWidth = Math.max(width, Number(session.terminalHost?.clientWidth) || (Number(term.cols) || 1) * width);`,
		`const preserveAnchor = documentObject.activeElement === textarea;`,
		`session.terminalInputAnchor = { top: anchorTop, indent: anchorIndent };`,
		`textarea.setAttribute("rows", "1");`,
		`textarea.setAttribute("wrap", "off");`,
		"textarea.style.width = `${Math.max(hostWidth, 2)}px`;",
		`textarea.style.opacity = "0.01";`,
		`textarea.style.overflowY = "hidden";`,
		`textarea.style.overflowWrap = "normal";`,
		`textarea.style.wordBreak = "normal";`,
		`const detachHostCompositionListeners = (session) => {`,
		`handler.webshellCompositionDetached = true;`,
		`const installHostInputIsolation = (session) => {`,
		`host.removeAttribute("contenteditable");`,
		`const blockedHostInputEvents = ["beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"];`,
		`if (composing && !session.inputViewportLock) {`,
		`captureInputViewportLock(session);`,
		`const clearPostCompositionInput = (session) => {`,
		`const armPostCompositionInput = (session, {`,
		`const resolvePostCompositionInput = (session, value) => {`,
		`pending.suppressSeparator && rawValue === " "`,
		`suppressSeparator: isTerminalASCIICompositionCommit(committedText),`,
		`lifecycle.listen(session, textarea, "compositionstart", (event) => {`,
		`lifecycle.listen(session, textarea, "compositionupdate", (event) => {`,
		`lifecycle.listen(session, textarea, "compositionend", (event) => {`,
		`const committedText = typeof event.data === "string" ? stripTerminalInputSentinel(event.data) : "";`,
		`sendTextInput(session, committedText, {`,
		`terminalIME = createTerminalIMEController({`,
		`captureInputViewportLock: (session) => terminalViewport?.captureInputLock(session),`,
		`releaseInputViewportLock: (session, options) => terminalViewport?.releaseInputLock(session, options),`,
		`ime?.installSession?.(session);`,
		`const compositionPreview = documentObject.createElement("span");`,
		`compositionPreview.className = "terminal-composition-preview";`,
		`compositionPreviousText: "",`,
		`compositionText: "",`,
		`compositionTextHistory: [],`,
		`pendingCompositionInput: null,`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime mobile IME composition preview guard missing %q", want)
		}
	}

	for _, forbidden := range []string{
		`textarea.value = event.data;`,
		`const inputWidth = Math.max(width, hostWidth - left);`,
		"textarea.style.width = `${Math.max(inputWidth, 2)}px`;",
		"textarea.style.width = `${Math.max(width, 2)}px`;",
	} {
		if strings.Contains(imeSource, forbidden) {
			t.Fatalf("runtime mobile IME helper must not contain %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		`const textareaCompositionText =`,
		`const installHostInputIsolation =`,
		`const handleBeforeInput =`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain IME implementation %q", forbidden)
		}
	}

	setComposingBranch := sourceBetween(t, imeSource,
		`  const setComposing = (session, composing) => {`,
		`  const clearPostCompositionInput = (session) => {`,
	)
	if strings.Contains(setComposingBranch, `releaseInputViewportLock(session);`) {
		t.Fatal("runtime mobile IME viewport lock must survive compositionend until keyboard focus ends")
	}
	compositionBeforeInputBranch := sourceBetween(t, imeSource,
		`if (type === "insertCompositionText" || type === "deleteCompositionText" || event.isComposing) {`,
		`    positionInput(session);`,
	)
	for _, forbidden := range []string{`event.preventDefault();`, `textarea.value = "";`, `textarea.value = event.data;`} {
		if strings.Contains(compositionBeforeInputBranch, forbidden) {
			t.Fatalf("runtime mobile IME beforeinput composition branch must not contain %q", forbidden)
		}
	}
	compositionUpdateBranch := sourceBetween(t, imeSource,
		`lifecycle.listen(session, textarea, "compositionupdate", (event) => {`,
		`    }, { capture: true });`,
	)
	for _, forbidden := range []string{`event.preventDefault();`, `textarea.value = "";`, `textarea.value = event.data;`} {
		if strings.Contains(compositionUpdateBranch, forbidden) {
			t.Fatalf("runtime mobile IME compositionupdate handler must not contain %q", forbidden)
		}
	}

	styleSource := readRuntimeSources(t, "runtime/static/style.css")
	for _, want := range []string{
		`.terminal-composition-preview {`,
		`overflow-wrap: normal;`,
		`pointer-events: none;`,
		`word-break: normal;`,
		`.terminal-composition-preview[hidden]`,
	} {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime mobile IME preview CSS guard missing %q", want)
		}
	}
}
func TestRuntimeTouchShortcutLayoutKeepsDesktopPCHidden(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	mainSource := string(mainData)
	layoutData, err := readRuntimeSource("runtime/static/app/layout/layout_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(layout_controller.js) error = %v", err)
	}
	layoutSource := string(layoutData)
	interactionData, err := readRuntimeSource("runtime/static/terminal/interaction/context_menu_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/interaction/context_menu_controller.js) error = %v", err)
	}
	interactionSource := string(interactionData)
	mainWantSnippets := []string{
		`mobileLayoutQuery = windowObject?.matchMedia?.("(max-width: 640px)")`,
		`touchShortcutLayoutQuery = windowObject?.matchMedia?.("(hover: none), (pointer: coarse)")`,
		`const isMobileLayout = () => layoutController?.isMobileLayout() === true;`,
		`const isTouchShortcutLayout = () => layoutController?.isTouchShortcutLayout() === true;`,
	}
	for _, want := range mainWantSnippets {
		if !strings.Contains(mainSource, want) && !strings.Contains(layoutSource, want) {
			t.Fatalf("runtime touch shortcut guard missing %q", want)
		}
	}
	for _, want := range []string{
		`if (disposed || !menuView.canOpenMobile() || !isTouchShortcutLayout()) {`,
		`if (!isTouchShortcutLayout()) {`,
	} {
		if !strings.Contains(interactionSource, want) {
			t.Fatalf("runtime touch shortcut interaction guard missing %q", want)
		}
	}

	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	styleSource := string(styleData)
	styleWantSnippets := []string{
		`@media (hover: none), (pointer: coarse) {`,
		`  .mobile-shortcuts {`,
		`    display: flex;`,
		`@media (hover: none) and (min-width: 641px), (pointer: coarse) and (min-width: 641px) {`,
		`  .mobile-shortcut-row {`,
		`    justify-content: flex-start;`,
		`    justify-content: safe center;`,
		`    scroll-padding-inline: 8px;`,
		`.mobile-shortcut-row[data-mobile-shortcut-row="bottom"] button[data-kind="menu"] {`,
		`    margin-left: 8px;`,
		`@media (hover: hover) and (pointer: fine) {`,
		`  .mobile-shortcuts {`,
		`    display: none;`,
	}
	for _, want := range styleWantSnippets {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime touch shortcut CSS guard missing %q", want)
		}
	}
}

func TestRuntimeTouchSelectionUsesTouchLayout(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	mainSource := string(mainData)
	layoutSource := readRuntimeSources(t, "runtime/static/app/layout/layout_controller.js")
	sessionInstallationSource := readRuntimeSources(t, "runtime/static/terminal/session/session_installation_controller.js")
	integrationSource := mainSource + "\n" + layoutSource + "\n" + sessionInstallationSource
	selectionData, err := readRuntimeSource("runtime/static/terminal/selection/selection_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/selection/selection_controller.js) error = %v", err)
	}
	selectionSource := string(selectionData)
	interactionData, err := readRuntimeSource("runtime/static/terminal/interaction/context_menu_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/interaction/context_menu_controller.js) error = %v", err)
	}
	interactionSource := string(interactionData)
	for _, want := range []string{
		`const isTouchSelectionLayout = () => layoutController?.isTouchSelectionLayout() === true;`,
		`const markTerminalTouchContextMenuCandidate = (touch) => terminalInteraction?.markTouchCandidate(touch);`,
		`const shouldSuppressTerminalContextMenu = (event) => terminalInteraction?.shouldSuppressContextMenu(event) === true;`,
		`markContextMenuCandidate: (touch) => markTerminalTouchContextMenuCandidate(touch),`,
		`selection?.installSession?.(session);`,
		`interaction?.bindPane?.(session.shellEl, {`,
	} {
		if !strings.Contains(integrationSource, want) {
			t.Fatalf("runtime touch selection guard missing %q", want)
		}
	}
	for _, want := range []string{
		`let lastTerminalTouchContextMenuCandidate = null;`,
		`const markTerminalTouchContextMenuCandidate = (touch) => {`,
		`const isRecentTerminalTouchContextMenu = (event) => {`,
		`const shouldSuppressTerminalContextMenu = (event) => (`,
		`isMobileLayout() || (isTouchSelectionLayout() && isRecentTerminalTouchContextMenu(event))`,
		`if (!shouldSuppressTerminalContextMenu(event)) {`,
		`if (shouldSuppressTerminalContextMenu(event)) {`,
	} {
		if !strings.Contains(interactionSource, want) {
			t.Fatalf("runtime touch context menu module guard missing %q", want)
		}
	}

	selectionBody := sourceBetween(t, selectionSource, `  const autoScrollIntent = (session, clientY) => {`, `  const reportActionError = (error) =>`)
	for _, want := range []string{
		`if (session?.closed || !isTouchSelectionLayout()) {`,
		`if (!isTouchSelectionLayout() || event.touches.length !== 1) {`,
		`if (!state || touchState !== state || state.selecting || !isTouchSelectionLayout() || session.closed) {`,
		`!isTouchSelectionLayout()`,
	} {
		if !strings.Contains(selectionBody, want) {
			t.Fatalf("runtime touch selection body missing %q", want)
		}
	}
	if strings.Contains(selectionBody, `!isMobileLayout()`) {
		t.Fatal("runtime touch selection body must not restrict long-press selection to narrow mobile layout")
	}

	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	styleSource := string(styleData)
	touchStyle := sourceBetween(t, styleSource, "@media (hover: none), (pointer: coarse) {\n  .attachment-browser-backdrop {", `@media (hover: none) and (min-width: 641px), (pointer: coarse) and (min-width: 641px) {`)
	for _, want := range []string{
		`.mobile-selection-overlay {` + "\n" + `    position: absolute;`,
		`.mobile-selection-handle {` + "\n" + `    position: absolute;`,
		`.mobile-selection-handle-knob {`,
	} {
		if !strings.Contains(touchStyle, want) {
			t.Fatalf("runtime touch CSS must expose mobile selection handles on tablets, missing %q", want)
		}
	}
}

func TestRuntimeSmallDesktopWindowKeepsTabBar(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	source := string(data)
	want := `@media (max-width: 640px) and (hover: none) and (pointer: coarse) {`
	if !strings.Contains(source, want) {
		t.Fatalf("runtime small-window tab bar guard missing %q", want)
	}
	guardedHeaderCSS := sourceBetween(t, source, want, `@media (max-width: 640px) {`)
	for _, want := range []string{
		`.tabs {` + "\n" + `    display: none;`,
		`.mobile-active-tab-title {` + "\n" + `    display: block;`,
	} {
		if !strings.Contains(guardedHeaderCSS, want) {
			t.Fatalf("runtime small-window tab bar guard block missing %q", want)
		}
	}
	narrowCSS := sourceBetween(t, source, `@media (max-width: 640px) {`, `@media (hover: none), (pointer: coarse) {`)
	for _, forbidden := range []string{
		`.tabs {` + "\n" + `    display: none;`,
		`.mobile-active-tab-title {` + "\n" + `    display: block;`,
	} {
		if strings.Contains(narrowCSS, forbidden) {
			t.Fatalf("runtime desktop small-window CSS must not force mobile tab header with %q", forbidden)
		}
	}
}

func TestRuntimeMobileViewportZoomDisabled(t *testing.T) {
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	indexSource := string(indexData)
	for _, want := range []string{
		`maximum-scale=1`,
		`minimum-scale=1`,
		`user-scalable=no`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("runtime viewport zoom guard missing %q", want)
		}
	}

	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	if !strings.Contains(string(styleData), `touch-action: pan-x pan-y;`) {
		t.Fatal("runtime touch layout should disable browser pinch zoom while preserving panning")
	}
	if !strings.Contains(string(styleData), `.instance-switcher-panel {`) ||
		!strings.Contains(string(styleData), `touch-action: pan-y;`) {
		t.Fatal("runtime instance switcher panel should preserve scroll without allowing pinch zoom")
	}

	mainSource := readRuntimeViewportSource(t)
	for _, want := range []string{
		`const shouldPreventMobileViewportZoom = () => (`,
		`isMobileLayout() || isTouchShortcutLayout() || usesMobileViewportInsets()`,
		`const preventMobileViewportZoom = (event) => {`,
		`if (!shouldPreventMobileViewportZoom()) {`,
		`String(event?.type || "").startsWith("gesture") || touchCount > 1`,
		`for (const type of ["touchstart", "touchmove", "gesturestart", "gesturechange", "gestureend"]) {`,
		`listen(windowObject, type, handlers.onPreventZoom || noop, zoomOptions);`,
		`listen(documentObject, type, handlers.onPreventZoom || noop, zoomOptions);`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime mobile viewport zoom JS guard missing %q", want)
		}
	}
}

func TestRuntimeMobileBottomSafeAreaKeepsShortcutsAboveControls(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	mainSource := string(mainData)
	imeSource := readRuntimeIMESource(t)
	viewportSource := readRuntimeViewportSource(t)
	runtimeSource := mainSource + "\n" + imeSource + "\n" + viewportSource
	for _, want := range []string{
		`export const isAndroidPlatform = (navigatorObject = globalThis.navigator) => {`,
		`const usesMobileViewportInsets = () => (`,
		`&& (isIOSPlatform(navigatorObject) || isAndroidPlatform(navigatorObject))`,
		`const supportsViewportInsets = usesMobileViewportInsets();`,
		`const useKeyboardInset = isIOSPlatform(navigatorObject);`,
		`const measuredBottomInset = measureMobileViewportBottomInset();`,
		`mobileKeyboardDismissRecoveryDelays = [0, 80, 180, 360, 720, 1200],`,
		`const shouldTrustReferenceInset = isTouchShortcutLayout() && (`,
		`const measuredInset = Math.max(`,
		`export function measureMobileViewportBottomInset({`,
		`const measureMobileViewportBottomInset = () => readMobileViewportBottomInset({`,
		`const scheduleMobileKeyboardDismissRecovery = () => {`,
		`lifecycle.listen(session, textarea, "blur", () => {`,
		`syncMobileVisualViewport({ detectOrientation: false });`,
		`applyMobileViewportInsets(0, nextSafeOffset, { keyboardActive: false });`,
		`scheduleKeyboardDismissRecovery: () => terminalViewport?.scheduleKeyboardDismissRecovery(),`,
		`scheduleKeyboardDismissRecovery();`,
		`const nextKeyboardActive = measuredInset > mobileKeyboardInsetThresholdPx`,
		`const nextInset = useKeyboardInset && nextKeyboardActive ? measuredInset : 0;`,
		`const applyMobileViewportInsets = (nextInset, nextSafeOffset, {`,
		`const isMobileKeyboardResizeSuppressed = () => (`,
		`syncActiveTerminalViewportForKeyboard();`,
		`const cursor = term?.wasmTerm?.getCursor?.();`,
		`const cursorBottom = Math.ceil((cursorRow + 1) * cellHeight);`,
		`const overflowPastViewport = Math.max(0, cursorBottom + cellHeight - visibleHeight);`,
		"documentObject?.documentElement?.style?.setProperty(\"--mobile-client-bottom-safe-offset\", `${safeOffset}px`);",
		`const syncMobileKeyboardDockTransform = (inset, safeOffset) => {`,
		`mobileShortcuts.style.transform = ` + "`translate3d(0, -${inset}px, 0)`" + `;`,
		`documentObject.body.classList.add("mobile-keyboard-dock-moving");`,
		`listen(windowObject?.visualViewport, "resize", handlers.onVisualViewport || noop);`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime mobile keyboard inset guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const lzcNavigationBarSchemeStatusBarOnly = "statusBarOnly";`,
		`const syncLzcIOSShellLayout = () => {`,
		`callLzcBridge("SetFullScreen");`,
		`callLzcBridge("SetCloseBtnShowStatus", false);`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("runtime should not force Lazycat shell top layout, found %q", forbidden)
		}
	}

	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	indexSource := string(indexData)
	if !strings.Contains(indexSource, `viewport-fit=cover`) {
		t.Fatal("runtime viewport must opt into safe-area cover rendering")
	}
	if !strings.Contains(indexSource, `name="lzcapp-navigation-bar-scheme" content="hidden"`) {
		t.Fatal("runtime Lazycat shell navigation bar should stay hidden to avoid top safe-area gap")
	}

	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	styleSource := string(styleData)
	wantSnippets := []string{
		`--lzc-safe-area-inset-bottom: var(--lzc-safe-area-bottom, env(safe-area-inset-bottom, 0px));`,
		`--mobile-client-bottom-safe-offset: 0px;`,
		`--mobile-device-bottom-safe-offset: max(var(--lzc-safe-area-inset-bottom), var(--mobile-client-bottom-safe-offset));`,
		`--mobile-shortcuts-total-height: var(--mobile-shortcuts-content-height);`,
		`--mobile-shortcuts-bottom-padding: 8px;`,
		`--mobile-bottom-dock-offset: var(--mobile-device-bottom-safe-offset);`,
		`--mobile-bottom-overlay-offset: calc(var(--mobile-shortcuts-total-height) + 12px + var(--mobile-bottom-dock-offset));`,
		`body.mobile-keyboard-visible {`,
		`  --mobile-bottom-dock-offset: var(--mobile-keyboard-inset-bottom);`,
		`bottom: 0;`,
		`transform: translate3d(0, calc(0px - var(--mobile-bottom-dock-offset)), 0);`,
		`transition: transform 0.18s ease-out;`,
		`body.mobile-keyboard-dock-moving .mobile-shortcuts {`,
		`  will-change: transform;`,
		`padding: 8px max(5px, var(--lzc-safe-area-inset-right)) var(--mobile-shortcuts-bottom-padding) max(5px, var(--lzc-safe-area-inset-left));`,
		`background: var(--terminal-bg);`,
		`bottom: var(--mobile-bottom-overlay-offset);`,
	}
	for _, want := range wantSnippets {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime mobile bottom safe-area CSS guard missing %q", want)
		}
	}

	forbiddenSnippets := []string{
		`76px + var(--lzc-safe-area-inset-bottom)`,
		`88px + var(--lzc-safe-area-inset-bottom)`,
		`bottom: var(--mobile-keyboard-inset-bottom);`,
		`--mobile-shortcuts-bottom-padding: calc(8px + var(--lzc-safe-area-inset-bottom))`,
		`--mobile-shortcuts-bottom-padding: calc(8px + var(--mobile-bottom-safe-area))`,
	}
	for _, forbidden := range forbiddenSnippets {
		if strings.Contains(styleSource, forbidden) {
			t.Fatalf("runtime mobile bottom safe-area CSS should use semantic variables, found %q", forbidden)
		}
	}
}

func TestRuntimePersistsWorkspaceForLightOSHomeReload(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	mainSource := string(mainData)
	appLifecycleSource := readRuntimeSources(t, "runtime/static/app/app_lifecycle.js")
	persistenceSource := readRuntimeSources(t, "runtime/static/workspace/persistence_controller.js")
	runtimeSource := mainSource + "\n" + appLifecycleSource + "\n" + persistenceSource
	for _, want := range []string{
		"const restoreStorageKey = `${storagePrefix}.workspaceRestore`;",
		`normalizeText(searchParams?.get("last")).toLowerCase() === "false"`,
		`workspaceRestoreDisabled(new URL(restoreURL, windowObject.location.origin).searchParams)`,
		`restoreInitialWorkspaceLocation({ windowObject: window, searchParams: params });`,
		`searchParams.delete("view");`,
		`const rememberWorkspaceRestoreState = () => {`,
		`return persistWorkspaceRestoreState(getActiveName(), getActiveTabId());`,
		`workspaceRestoreDisabled(targetURL.searchParams)`,
		`targetURL.searchParams.delete("embed");`,
		`targetURL.searchParams.delete("last");`,
		`version: 1,`,
		"url: `${targetURL.pathname}${targetURL.search}${targetURL.hash}`",
		`updatedAt: Date.now(),`,
		`suppressWorkspaceRestore = true;`,
		`clearWorkspaceRestoreState();`,
		`onHeartbeat: () => {`,
		`heartbeatTimer = windowObject.setInterval`,
		`clientHistory.touchAll();`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime Lazycat shell reload guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const workspaceRestoreTTL =`,
		`expiresAt: Date.now() + workspaceRestoreTTL`,
		`const expiresAt = Number(state?.expiresAt || 0);`,
	} {
		if strings.Contains(runtimeSource, forbidden) {
			t.Fatalf("runtime workspace restore state must remain persistent, found %q", forbidden)
		}
	}
}

func TestRuntimeMobileShortcutsPreserveKeyboardExceptMenu(t *testing.T) {
	mainSource := readRuntimeSources(t, "runtime/static/global-runtime.js")
	imeSource := readRuntimeIMESource(t)
	shortcutSource := readRuntimeMobileShortcutsSource(t)

	for _, want := range []string{
		`shouldPreserveKeyboardForShortcut(shortcut) {`,
		`return String(shortcut?.action || "") !== "open_mobile_menu";`,
		`isKeyboardActive(session = getActiveSession()) {`,
		`documentObject.activeElement === textarea || isKeyboardViewportActive()`,
	} {
		if !strings.Contains(imeSource, want) {
			t.Fatalf("runtime mobile shortcut IME guard missing %q", want)
		}
	}

	bindBody := sourceBetween(t, shortcutSource, `  const bindButton = (button, shortcut) => {`, `  const render = () => {`)
	if !strings.Contains(shortcutSource, `terminalIME.setFocusAllowance?.(state.shortcutSession, now() + keyboardFocusAllowWindowMs);`) {
		t.Fatal("runtime mobile shortcut controller must grant a bounded keyboard focus allowance")
	}
	for _, want := range []string{
		`!terminalIME?.shouldPreserveKeyboardForShortcut?.(shortcut)`,
		`terminalIME?.isKeyboardActive?.(state.shortcutSession)`,
		`if (event.cancelable) {`,
		`event.preventDefault?.();`,
		`lifecycle.listen(button, "touchstart", (event) => {`,
	} {
		if !strings.Contains(bindBody, want) {
			t.Fatalf("runtime mobile shortcut bind should preserve keyboard, missing %q", want)
		}
	}
	for _, forbidden := range []string{`restoreMobileKeyboardAfterShortcut`, `button.addEventListener("focus"`} {
		if strings.Contains(bindBody, forbidden) {
			t.Fatalf("runtime mobile shortcut bind should not restore keyboard after blur, found %q", forbidden)
		}
	}

	interactionAdapter := sourceBetween(t, mainSource,
		`  terminalInteraction = createTerminalContextMenuController({`,
		`  appendStartupTrace(`,
	)
	if !strings.Contains(interactionAdapter, `prepareMobileOpen: () => {`) ||
		!strings.Contains(interactionAdapter, `terminalIME?.blurMobileKeyboard();`) {
		t.Fatal("runtime mobile Menu shortcut should still hide the keyboard before opening the action sheet")
	}
}
func TestRuntimeWebSocketURLUsesWebSocketProtocols(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	urlSource := readRuntimeSources(t, "runtime/static/terminal/transport/websocket_url.js")
	source := string(data) + "\n" + readRuntimeProtocolSource(t) + "\n" + urlSource

	wantSnippets := []string{
		`export function terminalWebSocketURL(path, { windowObject = globalThis.window, baseURL = "" } = {}) {`,
		`url.protocol = "wss:";`,
		`url.protocol = "ws:";`,
		`url.protocol !== "ws:" && url.protocol !== "wss:"`,
		`terminalUnifiedWebSocketURL(targetName, {`,
		`webSocketURL: (path) => terminalWebSocketURL(path, { windowObject: window }),`,
		`const socketUrl = webSocketURL("./ws");`,
		`currentSocket = new WebSocket(socketUrl.toString());`,
		`currentSocket = multiplexedConnection.open({`,
		`url.searchParams.set("mode", "unified");`,
		`socketUrl.searchParams.set("transport_role", "unified");`,
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime websocket URL guard missing %q", want)
		}
	}
	if strings.Contains(string(data), "const webSocketURL = (path) => {") {
		t.Fatal("app controller must not retain WebSocket URL implementation")
	}
	for _, forbidden := range []string{
		`socketURL.searchParams.set("mode", "unified")`,
		`socketURL.searchParams.set("transport_role", "unified")`,
		`socketURL.searchParams.set("protocol_version", "1")`,
	} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("global runtime must not construct Unified transport query fields %q", forbidden)
		}
	}
}

func TestRuntimeTerminalOutputBatchingGuard(t *testing.T) {
	mainSource := readRuntimeSources(t, "runtime/static/global-runtime.js")
	installationSource := readRuntimeSources(t, "runtime/static/terminal/session/session_installation_controller.js")
	protocolSource := readRuntimeProtocolSource(t)
	outputSource := readRuntimeOutputSource(t)
	sessionSource := readRuntimeSources(t, "runtime/static/terminal/session/session_state.js")
	resizeSource := readRuntimeResizeSource(t)
	runtimeSource := strings.Join([]string{mainSource, installationSource, protocolSource, outputSource, sessionSource, resizeSource,
		readRuntimeSources(t, "runtime/static/terminal/session/startup_error_controller.js"),
		readRuntimeSources(t, "runtime/static/terminal/transport/transport_runtime_controller.js")}, "\n")

	for _, want := range []string{
		"export const TERMINAL_OUTPUT_FLUSH_FALLBACK_MS = 32;",
		"export const TERMINAL_OUTPUT_FLUSH_BUDGET_BYTES = 128 * 1024;",
		"export const TERMINAL_OUTPUT_FLUSH_MAX_ENTRIES = 8;",
		"export const TERMINAL_OUTPUT_FLUSH_TIME_BUDGET_MS = 12;",
		"export const TERMINAL_REPLAY_WRITE_BATCH_BYTES = 512 * 1024;",
		"export const TERMINAL_OUTPUT_QUEUE_SOFT_LIMIT_BYTES = 1 * 1024 * 1024;",
		"export const MAX_QUEUED_TERMINAL_OUTPUT_BYTES = 4 * 1024 * 1024;",
		"export function createTerminalOutputController({",
		"const outputQueueGenerationMismatch = queue.some((entry) => entry.queueGeneration !== state.outputQueueGeneration);",
		"const outputIdentityMismatch = outputQueueGenerationMismatch || queue.some((entry) => (",
		"recordMetric(\"staleOutputQueueDrops\");",
		"state.outputQueueGeneration = Number(state.outputQueueGeneration || 0) + 1;",
		"state.outputQueue.push({",
		"queueGeneration: state.outputQueueGeneration,",
		"outputData.byteLength > outputChunkBytes",
		"const replayWriter = (replayOutput || suppressRender) && typeof session.term.writeReplay === \"function\";",
		"session.term.writeReplay(data);",
		"maxBytes = 0,",
		"maxEntries = 0,",
		"maxTimeMs = 0,",
		"recordMetric(\"forceFlushBytes\", flushedBytes);",
		"recordMaxMetric(\"forceFlushPeakBytes\", flushedBytes);",
		"const completeQueueTurn = (session, {",
		"queue_turn_ack_pending",
		"queue_turn_ack_sent",
		"requestHistoryReplay(state);",
		"export function createTerminalOutputLifecycle({",
		"windowObject?.cancelAnimationFrame?.(session.outputFlushFrame);",
		"windowObject?.clearTimeout?.(session.outputFlushTimer);",
		"export const terminalOutputByteChunkEnd = (data, start, maxBytes) => {",
		"textEncoder.encodeInto(data.slice(offset, end), measureBuffer)",
		"const byteLength = utf8ByteLengthForCodePoint(codepoint);",
	} {
		if !strings.Contains(outputSource, want) {
			t.Fatalf("terminal output module guard missing %q", want)
		}
	}

	for _, want := range []string{
		`createTerminalOutputController,`,
		`from "./terminal/output/index.js";`,
		`terminalOutput = createTerminalOutputController({`,
		`requestHistoryReplay: (session) => requestSessionHistoryReplay(session),`,
		`finishHistoryReplayIfReady: (session) => terminalReplay.finishIfReady(session),`,
		`output?.installSession?.(session);`,
		`disposeOutput: (session) => terminalOutput?.disposeSession(session),`,
		`terminalOutput?.dispose();`,
		`terminalOutput?.completeQueueTurn(session, {`,
		`terminalOutput?.noteQueueTurnFrame(session, metadata);`,
		`const genericWebSocketStartupFallbacks = new Set([`,
		`const isGenericFallback = (message) => (`,
		`if (isGenericFallback(fallback)) {`,
		`retrySessionAfterFailure(session, error, { allowHidden: true });`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("main.js terminal output integration missing %q", want)
		}
	}

	for _, want := range []string{
		"outputQueue: []",
		"outputQueueSize: 0",
		"outputQueueGeneration: 0",
		"queueTurnReceivedCursor: null",
		"pendingQueueTurnAck: null",
	} {
		if !strings.Contains(sessionSource, want) {
			t.Fatalf("terminal session output initial state missing %q", want)
		}
	}

	for _, want := range []string{
		"getOutputQueueEntryCount = () => 0,",
		"getOutputQueuedBytes = () => 0,",
		"session.resizeFenceDrainRemainingEntries = getOutputQueueEntryCount(session);",
		"if (getOutputQueuedBytes(session) > 0) {",
	} {
		if !strings.Contains(resizeSource, want) {
			t.Fatalf("resize/output public boundary missing %q", want)
		}
	}
	for _, forbidden := range []string{"session.outputQueue", "session.outputQueueSize"} {
		if strings.Contains(resizeSource, forbidden) {
			t.Fatalf("resize must not read output private state %q", forbidden)
		}
	}

	queueTurnBlock := sourceBetween(t, runtimeSource,
		`case "queue-turn-complete":`,
		`case "agent-preparing":`)
	if !strings.Contains(queueTurnBlock, "terminalOutput?.completeQueueTurn(session, {") {
		t.Fatal("Queue turn completion must delegate to the output controller")
	}
	if strings.Contains(queueTurnBlock, "force: true") {
		t.Fatal("Queue turn completion must not use an unbounded force flush")
	}
	for _, forbidden := range []string{
		"const terminalOutputKind =",
		"const terminalOutputByteLength =",
		"const flushSessionOutput =",
		"const writeSessionOutput =",
		"const discardSessionOutputBuffers =",
		"session.outputQueue.push(",
		"session.pendingQueueTurnAck =",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal output implementation %q", forbidden)
		}
	}
	if strings.Contains(runtimeSource, "message exceeds maxTerminalOutputMessageBytes") || strings.Contains(runtimeSource, "const maxTerminalOutputMessageBytes") {
		t.Fatal("a legal large output message must be split instead of rejected by message size")
	}
	if strings.Contains(mainSource, "writeSessionWebShellError(session, message || fallback);") {
		t.Fatal("generic websocket startup fallbacks should not be written as terminal errors")
	}
}

func TestRuntimeClientTerminalHistoryRangeSyncAndIndexedDB(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	protocolData, err := readRuntimeSource("runtime/static/terminal/transport/session_protocol_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(session_protocol_controller.js) error = %v", err)
	}
	cacheData, err := readRuntimeSource("runtime/static/terminal/history/terminal_history_cache.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/history/terminal_history_cache.js) error = %v", err)
	}
	metricsData, err := readRuntimeSource("runtime/static/diagnostics/terminal_timeline.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/terminal_timeline.js) error = %v", err)
	}
	sessionStateData, err := readRuntimeSource("runtime/static/terminal/session/session_state.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/session/session_state.js) error = %v", err)
	}
	mainSource := string(mainData) + "\n" + string(protocolData) + "\n" + string(sessionStateData) + "\n" + readRuntimeOutputSource(t)
	mainSource += "\n" + readRuntimeTerminalConfig(t)
	mainSource += "\n" + readRuntimeSources(t, "runtime/static/terminal/history/client_history_controller.js")
	mainSource += "\n" + readRuntimeSources(t, "runtime/static/workspace/tab_controller.js")
	cacheSource := string(cacheData)
	metricsSource := string(metricsData)

	mainSnippets := []string{
		`from "./terminal/history/index.js";`,
		`terminalHistoryCacheFlushBytes: 256 * 1024,`,
		`terminalHistoryCacheFlushDelayMs: 50,`,
		`historyGeneration: "",`,
		`localBaseCursor: 0n,`,
		`receivedHistoryCursor: 0n,`,
		`appliedHistoryCursor: 0n,`,
		`persistedHistoryCursor: 0n,`,
		`socketUrl.searchParams.set("history_generation", historyConnectRange.generation);`,
		`socketUrl.searchParams.set("local_base_cursor", historyConnectRange.baseCursor.toString());`,
		`socketUrl.searchParams.set("local_end_cursor", historyConnectRange.endCursor.toString());`,
		`const modernHistoryProtocol = Boolean(historyGeneration && syncMode);`,
		`const historyConnectRange = isClientInstanceName(session.name)`,
		`? terminalReplay.rangeForConnect(session)`,
		`const trackHistory = kind === "bytes" && state.historyProtocolActive;`,
		`clientHistory.disableSession(session);`,
		`["snapshot", "delta", "current"].includes(syncMode)`,
		`historyConnectRange.source === "memory"`,
		`historyConnectRange.source === "cache"`,
		`queueHistoryCacheWrite(state, data, batch.historyStartCursor, batch.historyEndCursor);`,
		`postWorkspaceAction("close_pane"`,
		`.then(() => destroyCachedSession(pane))`,
		`destroyCachedSession: (pane) => clientHistory.destroySession(pane),`,
		`clientHistory.flushAll();`,
	}
	for _, want := range mainSnippets {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime terminal history sync guard missing %q", want)
		}
	}
	for _, want := range []string{
		"export const recordTerminalRuntimeMetric = (name, value = 1) => {",
		"export const recordTerminalRuntimeMaxMetric = (name, value = 0) => {",
		"globalThis.__webshellTerminalPerformance",
	} {
		if !strings.Contains(metricsSource, want) {
			t.Fatalf("diagnostics terminal performance adapter missing %q", want)
		}
	}
	for _, want := range []string{
		"outputOverloads",
		"terminalOutputBatches",
		"terminalOutputBytes",
		"outputQueuedBytes",
		"outputQueuePeakBytes",
		"recordMaxMetric(\"outputQueuePeakBytes\", state.outputQueueSize);",
		"state.outputQueueSize + byteLength > maxQueuedBytes",
		"session.historyCacheWriteQueue.push({ startCursor, endCursor, data });",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime terminal performance guard missing %q", want)
		}
	}
	if strings.Contains(mainSource, "const copy = new Uint8Array(data);") {
		t.Fatal("terminal history cache queue must not copy already-owned output views")
	}

	cacheSnippets := []string{
		`database.createObjectStore("streams", { keyPath: "scopeKey" });`,
		`database.createObjectStore("chunks", { keyPath: "id" });`,
		`const scopeKeyFor = (selector, paneId) => JSON.stringify([`,
		`if (output[index - 1].endCursor !== output[index].startCursor)`,
		`const transaction = db.transaction(["streams", "chunks"], "readwrite");`,
		`stream.endCursor = chunk.endCursor.toString();`,
		`streamStore.put(stream);`,
		`const reset = async (selector, paneId, generation, cursor) => {`,
		`const cleanupExpired = async ({ now = Date.now() } = {}) => {`,
	}
	for _, want := range cacheSnippets {
		if !strings.Contains(cacheSource, want) {
			t.Fatalf("runtime terminal history cache guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`history_generation: historyConnectRange`,
		`local_base_cursor: historyConnectRange`,
		`local_end_cursor: historyConnectRange`,
	} {
		if strings.Contains(string(protocolData), forbidden) {
			t.Fatalf("ordinary Unified open must not contain a local browser history range: %q", forbidden)
		}
	}
}

func TestRuntimeTerminalCanvasResidueGuard(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	rendererData, err := readRuntimeSource("runtime/static/ghostty-web.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/ghostty-web.js) error = %v", err)
	}
	wasmData, err := readRuntimeSource("runtime/static/ghostty-vt.wasm")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/ghostty-vt.wasm) error = %v", err)
	}
	kittyData, err := readRuntimeSource("runtime/static/terminal/rendering/kitty_graphics.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/rendering/kitty_graphics.js) error = %v", err)
	}
	themeCatalogData, err := readRuntimeSource("runtime/static/appearance/theme_catalog.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/appearance/theme_catalog.js) error = %v", err)
	}
	serverRevisionData, err := readRuntimeSource("runtime/static/app/server_revision/server_revision_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(server_revision_controller.js) error = %v", err)
	}
	sessionStateData, err := readRuntimeSource("runtime/static/terminal/session/session_state.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/session/session_state.js) error = %v", err)
	}
	sessionLifecycleData, err := readRuntimeSource("runtime/static/terminal/session/session_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/session/session_lifecycle.js) error = %v", err)
	}
	resourceFactoryData, err := readRuntimeSource("runtime/static/terminal/session/resource_factory.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/session/resource_factory.js) error = %v", err)
	}
	recoveryData, err := readRuntimeSource("runtime/static/terminal/session/session_recovery_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/session/session_recovery_controller.js) error = %v", err)
	}
	presentationControllerData, err := readRuntimeSource("runtime/static/terminal/rendering/presentation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(presentation_controller.js) error = %v", err)
	}
	presentationLifecycleData, err := readRuntimeSource("runtime/static/terminal/rendering/presentation_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(presentation_lifecycle.js) error = %v", err)
	}
	presentationStateData, err := readRuntimeSource("runtime/static/terminal/rendering/presentation_state.js")
	if err != nil {
		t.Fatalf("ReadFile(presentation_state.js) error = %v", err)
	}
	presentationViewData, err := readRuntimeSource("runtime/static/terminal/rendering/presentation_view.js")
	if err != nil {
		t.Fatalf("ReadFile(presentation_view.js) error = %v", err)
	}
	resizeSource := readRuntimeResizeSource(t)
	configSource := readRuntimeTerminalConfig(t)
	imeSource := readRuntimeIMESource(t)
	viewportSource := readRuntimeViewportSource(t)
	outputSource := readRuntimeOutputSource(t)
	protocolSource := readRuntimeProtocolSource(t)
	replaySource := readRuntimeSources(t,
		"runtime/static/terminal/history/session_replay_controller.js",
		"runtime/static/terminal/history/session_replay_lifecycle.js",
		"runtime/static/terminal/history/session_replay_state.js",
	)
	mainSource := string(mainData)
	tabActivationSource := readRuntimeSources(t, "runtime/static/workspace/tab_activation_controller.js")
	runtimeSource := strings.Join([]string{
		mainSource,
		configSource,
		tabActivationSource,
		readRuntimeSources(t, "runtime/static/workspace/tab_controller.js"),
		protocolSource,
		replaySource,
		string(sessionStateData),
		string(sessionLifecycleData),
		string(resourceFactoryData),
		string(recoveryData),
		readRuntimeSources(t, "runtime/static/terminal/session/session_installation_controller.js"),
		string(presentationControllerData),
		string(presentationLifecycleData),
		string(presentationStateData),
		string(presentationViewData),
		readRuntimeSources(t, "runtime/static/terminal/rendering/runtime_controller.js"),
		resizeSource,
		imeSource,
		viewportSource,
		outputSource,
		readRuntimeSources(t, "runtime/static/terminal/transport/transport_runtime_controller.js"),
	}, "\n")
	styleSource := string(styleData)
	rendererSource := string(rendererData)
	kittySource := string(kittyData)
	themeCatalogSource := string(themeCatalogData)

	for _, want := range []string{
		"getScrollbarWidth() {",
		"return 3 + 5 * this.scrollbarHoverProgress;",
		"SCROLLBAR_HOVER_SENSOR_SIZE = 24",
		"SCROLLBAR_HOVER_ANIMATION_MS = 160",
		"setScrollbarHoverProgress",
		"updateScrollbarHover(g.clientX)",
		"scrollbarHoverAnimationFrame && (cancelAnimationFrame",
		"this.scrollbarHoverActive ? this.showScrollbar() : this.hideScrollbar();",
		"g.touch ? 18 : 8",
		"i = this.getScrollbarWidth()",
		"if (I < N || I > i)",
	} {
		if !strings.Contains(rendererSource, want) && !strings.Contains(mainSource, want) {
			t.Fatalf("runtime scrollbar hover expansion guard missing %q", want)
		}
	}

	runtimeSnippets := []string{
		"const terminalRuntimeClearSequence = \"\\x1b[2J\\x1b[3J\\x1b[H\";",
		"const clearCanvas = (session) => {",
		"const canvasForSession = (session) => session?.term?.canvas || session?.term?.renderer?.getCanvas?.();",
		"ctx.fillStyle = getBackground(session) || \"#000000\";",
		"ctx.fillRect(0, 0, canvas.width / ratio, canvas.height / ratio);",
		"const advanceContentGeneration = (session) => {",
		"session.terminalContentGeneration = Number(session.terminalContentGeneration || 0) + 1;",
		"const clearBuffer = (session) => {",
		"term.wasmTerm.write(terminalRuntimeClearSequence);",
		"term.viewportY = 0;",
		"term.targetViewportY = 0;",
		"const resetAfterInitialFit = (session) => {",
		"return reset(session);",
		"const syncReferences = (session) => {",
		"syncSelectionRuntime(session);",
		"term.linkDetector?.invalidateCache?.();",
		"const reset = (session) => {",
		"term.reset();",
		"syncReferences(session);",
		"clearBuffer(session);",
		"clearCanvas(session);",
		"const setReady = (session, ready, { preserveFrame = true, reason = \"presentation_state\" } = {}) => {",
		"session.shellEl.dataset.renderReady = session.renderReady ? \"true\" : \"false\";",
		"const markSyncPending = (session) => {",
		"session.fullRenderPending = false;",
		"const invalidate = (session) => {",
		"session.term?.renderer?.clear?.();",
		"view.clearCanvas(session);",
		"const holdFrame = (session) => {",
		"const releaseHold = (session) => {",
		"const beginHold = (session, { capture = true, recapture = false } = {}) => {",
		"presentationCommitPending: false,",
		"session.shellEl.dataset.hasPresentedFrame = session.hasPresentedFrame ? \"true\" : \"false\";",
		"const markRendered = (session) => {",
		"const commitIfReady = (session) => {",
		"!session.fullRenderPending",
		"const scheduleRetry = (session, {",
		"presentationRetryPending: false,",
		"recordEvent(session, \"presentation_render_failed\");",
		"recordEvent(session, \"presentation_commit_complete\", {",
		"|| session.activationFitPending",
		"!isReplayCommitted(session)",
		"session.pendingRenderFitGeneration !== session.measuredFitGeneration",
		"session.pendingRenderReplayGeneration !== session.terminalReplayGeneration",
		"session.pendingRenderContentGeneration !== session.terminalContentGeneration",
		"session.presentedContentGeneration === session.terminalContentGeneration",
		"canvasMatchesExpectedSize(session)",
		"session.hasPresentedFrame = true;",
		"!session.renderReady && !session.resizePresentationHold",
		"setReady(session, true, { reason: \"render_commit\" });",
		"const stateIsCurrent = (session) => {",
		"session.renderSnapshot.equals(current)",
		"const cancelPendingRender = (term) => {",
		"if (term.renderRetryTimer !== undefined) {",
		"windowObject.clearTimeout(term.renderRetryTimer);",
		"const renderFullNow = (session) => {",
		"session.pendingRenderFitGeneration = session.measuredFitGeneration;",
		"session.pendingRenderReplayGeneration = session.terminalReplayGeneration;",
		"session.pendingRenderContentGeneration = session.terminalContentGeneration;",
		"const fullRenderRequested = term.renderFullNextFrame === true;",
		"term.renderFullNextFrame = fullRenderRequested;",
		"const rendered = term.renderNow(true) !== false;",
		"recordEvent(session, \"full_render_failed\");",
		"return rendered;",
		"const scheduleValidation = (session, { forceHistory = false } = {}) => {",
		"const scrollbackLength = Math.max(0, Number(session.term?.getScrollbackLength?.() || 0));",
		"if (forceHistory && scrollbackLength > 0 && !blockedByResize && isPaneVisible(session)) {",
		"ensure(session, {",
		"!isCurrent(session)",
		"const installSession = (session, {",
		"canvas.addEventListener(\"contextlost\", handleContextLost);",
		"canvas.addEventListener(\"contextrestored\", handleContextRestored);",
		"session.shellEl.dataset.connection = \"open\";",
		"setPresentationReady(pane, false);",
		"shellEl.dataset.renderReady = \"false\";",
		"initialRuntimeResetDone: false,",
		"measuredFitGeneration: 0,",
		"terminalReplayGeneration: 0,",
		"terminalContentGeneration: 0,",
		"pendingRenderContentGeneration: 0,",
		"presentedContentGeneration: 0,",
		"presentedFitGeneration: 0,",
		"presentedReplayGeneration: 0,",
		"fullRenderPending: false,",
		"fullRenderValidationTimer: 0,",
		"hasPresentedFrame: false,",
		"workspaceExitPending: false,",
		"activationFitPending: false,",
		"resizePresentationHold: false,",
		"from \"./terminal/resize/index.js\";",
		"terminalResizeThrottleMs: 80,",
		`from "./terminal/rendering/index.js";`,
		"installKittyGraphicsSupport(Terminal);",
		"const scheduler = createTerminalResizeScheduler({",
		"const schedulePane = (session, options = {}, scheduleOptions = {}) => {",
		"if (isMobileKeyboardResizeSuppressed()) {",
		"terminalPresentation.deferHiddenRender(session)",
		"presentation()?.commitNow(session);",
		"holdPresentationFrame(pane);",
		"const ratio = Math.max(",
		"ctx.drawImage(",
		"sourceCssWidth,",
		"sourceCssHeight,",
		"const dimensionsWillChange = !dimensionsEqual(session, fittedDimensions) || canvasNeedsResize;",
		"settlePresentation,",
		"const shouldSettlePresentation = settlePresentation === true",
		"if (!shouldSettlePresentation && session.resizePresentationHold) {",
		"applyResize: (session, options, { settled = true } = {}) => {",
		"if (!settled) {",
		"settlePresentation: true,",
		"settlePresentation: !session.resizePresentationHold",
		"const shouldCommitAfterHold = session.resizePresentationHold && session.hasPresentedFrame;",
		"presentation()?.requestFullRender(session);",
		"presentation()?.renderFullNow(session);",
		"lifecycle.cancel(session);",
		"presentation?.installSession?.(session);",
		"lifecycle.observeHost(session, () => {",
		"clearRuntimeBuffer(session);",
		`const renderDisposable = typeof session.term?.onRender === "function"`,
		"const completed = markRendered(session);",
		"terminalViewport?.syncPan(session)",
		"const resetTerminalForHistoryReplay = (session) => {",
		"beginRenderSuppression(session, \"replay\");",
		"session.resetOnNextReplay = false;",
		"if (!resetRuntimeState(session)) {",
		"const disposePane = (pane) => disposePaneSession(pane);",
		"invoke(adapters.clearCanvasPixels, session);",
		"const replayWriter = (replayOutput || suppressRender) && typeof session.term.writeReplay === \"function\";",
		"((replayOutput || suppressRender) && !replayWriter)",
		"|| (!replayOutput && !suppressRender && deferHiddenRender(session))",
		"cancelPendingRender(session.term);",
		"schedulePresentationValidation(state);",
		"reason: isPaneVisible(session) ? \"presentation_validation\" : \"presentation_wait_measure\",",
	}
	for _, want := range runtimeSnippets {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime terminal canvas residue guard missing runtime snippet %q", want)
		}
	}
	for _, want := range []string{
		`if (syncMode === "snapshot") {`,
		`if (!resetTerminalForHistoryReplay(session)) {`,
		`if (historyConnectRange.source === "memory") {`,
		`if (!session.historyStateReady || session.appliedHistoryCursor !== deltaFromCursor) {`,
	} {
		if !strings.Contains(protocolSource, want) {
			t.Fatalf("runtime terminal replay mode guard missing %q", want)
		}
	}
	resetReplayBlock := sourceBetween(t, string(mustReadRuntimeSource(t,
		"runtime/static/terminal/session/session_recovery_controller.js")),
		"  const resetTerminalForHistoryReplay = (session) => {",
		"  const requestSessionHistoryReplay = (session) => {")
	for _, want := range []string{
		"hasKnownSize(session)",
		`session.lastHistoryResetFailureReason = "terminal_size_unavailable";`,
		`session.lastHistoryResetFailureReason = "runtime_reset_failed";`,
	} {
		if !strings.Contains(resetReplayBlock, want) {
			t.Fatalf("hidden terminal history replay guard missing %q", want)
		}
	}
	if strings.Contains(resetReplayBlock, "measuredFitGeneration || 0) <= 0") {
		t.Fatal("hidden pane history replay must not require a visible DOM fit generation")
	}
	for _, forbidden := range []string{
		"initialFitResetDone",
		"scheduleTerminalFullRenderWatchdog",
		"terminalFullRenderWatchdogIntervalMs",
		"installTerminalFullRenderGuard",
		"if (session.initialCols > 0 && session.initialRows > 0)",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("runtime terminal replay regression detected: found %q", forbidden)
		}
	}

	styleSnippets := []string{
		`.pane-shell[data-render-ready="false"][data-has-presented-frame="false"] .terminal-host > canvas:not(.terminal-frame-hold) {`,
		"visibility: hidden;",
		".terminal-frame-hold",
		"object-fit: none;",
		"object-position: left top;",
	}
	for _, want := range styleSnippets {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime terminal canvas residue guard missing style snippet %q", want)
		}
	}

	rendererSnippets := []string{
		"const GHOSTTY_WASM_WRITE_CHUNK_BYTES = 128 * 1024;",
		"const GHOSTTY_WASM_WRITE_STRING_CHARS = 32 * 1024;",
		"const GHOSTTY_OUTPUT_RENDER_INTERVAL_MS = 33;",
		"const GHOSTTY_TEXT_ENCODER = new TextEncoder();",
		"Failed to allocate terminal input buffer",
		"this.inputBufferPtr = 0",
		"ensureInputBuffer(A)",
		"this.exports.ghostty_terminal_write(this.handle, this.inputBufferPtr, E.byteLength)",
		"this.exports.ghostty_wasm_free_u8_array(this.inputBufferPtr, this.inputBufferSize)",
		"this.writeBytes(A);",
		"writeReplay(A)",
		"this.renderSuppressionDepth += 1",
		"this.renderSuppressionDepth === 0 && A && this.isOpen && !this.isDisposed",
		"this.renderSuppressionDepth > 0",
		"this.renderFullNextFrame = !0",
		"this.renderThrottleTimer = void 0",
		"this.lastRenderAt = performance.now()",
		"async function oA(A)",
		"R || (R = await q.load(A))",
		"Incompatible Ghostty WASM: missing ghostty_terminal_get_scrollback_generation",
		"this.scrollbackByteCapacity = this.estimateScrollbackBytes(g, E)",
		"this.exports.ghostty_terminal_set_scrollback_limit(this.handle, g)",
		"this.ensureScrollbackCapacity(A, B)",
		"ghostty_terminal_get_scrollback_generation",
		"getScrollbackGeneration()",
		"this.renderStateCurrent = !1",
		"ensureRenderStateCurrent()",
		"this.renderDirtyState = O.FULL",
		"this.renderDirtyState = A",
		"this.renderDirtyState = O.NONE",
		"N = s - C >>> 0",
		"this.requestRender({ full: !0 })",
		"normalizeViewportBounds(A = this.viewportY)",
		"g = Math.max(0, Math.min(i, Number.isFinite(requestedViewportY) ? requestedViewportY : 0));",
		"this.ctx.fillRect(0, 0, this.canvas.width / this.devicePixelRatio, this.canvas.height / this.devicePixelRatio)",
		"this.ctx.fillRect(0, C, this.canvas.width / this.devicePixelRatio, this.metrics.height)",
		"i.text = D.grapheme_len > 0 && typeof A.getGraphemeString == \"function\" ? A.getGraphemeString(Math.floor(I / B.cols), I % B.cols) : String.fromCodePoint(D.codepoint || 32)",
		"text: I[w + 14] > 0 && typeof this.getScrollbackGraphemeString == \"function\" ? this.getScrollbackGraphemeString(A, i) : String.fromCodePoint(D.getUint32(w, !0) || 32)",
		"const text = typeof A.text == \"string\" ? A.text",
		"materializeViewportLines(A, B, g, E, C)",
		"const W = this.materializeViewportLines(A, D, g, i, E);",
		"this.renderer.render(this.wasmTerm, A, this.normalizeViewportBounds(this.viewportY), this, this.scrollbarOpacity)",
		"this.scheduleRenderRetry()",
		"this.renderRetryDelayMs = Math.min(250, A * 2)",
		"this.renderRetryTimer = window.setTimeout",
		"this.cancelRenderLoop(), this.isResizing = !0;",
		"if (this.isResizing)",
		"this.writeQueue || (this.writeQueue = []), this.writeQueue.push(A)",
		"this.flushWriteQueue();",
		"this.writeQueue && (this.writeQueue.length = 0)",
		"this.writeInternal(A);",
		"Terminal resize failed:",
		"this.graphemeBuffer = null",
		"const recordTerminalPerformance = (name, value = 1) => {",
		"max(counter, value = 0) {",
		"const recordTerminalTiming = (name, duration) => {",
		"wasmInputBytes",
		"wasmWriteCalls",
		"wasmWrite",
		"renderFrames",
		"fullRenderFrames",
		"incrementalRenderFrames",
		"canvasRender",
		"this.lastRenderFont = \"\"",
		"this.fontSize = A, this.lastRenderFont = \"\", this.metrics = this.measureFont();",
		"this.fontFamily = A, this.lastRenderFont = \"\", this.metrics = this.measureFont();",
		"this.rgbCache = new Map()",
		"this.rgbCache.size >= 512",
		"text === \" \" && !(A.flags & (e.UNDERLINE | e.STRIKETHROUGH)) && A.hyperlink_id !== this.hoveredHyperlinkId",
	}
	for _, want := range []string{
		"function installKittyGraphicsSupport",
		"var KITTY_TEXT_DECODE_CHUNK_BYTES = 128 * 1024;",
		"this.decoder = new TextDecoder();",
		"this.decoder.decode(data.subarray(offset, end), { stream: true })",
		"createImageBitmap",
		`type: "image/png"`,
		"graphics.consume(",
		"graphics.getPlacements()",
		"ctx.drawImage(",
		"terminal.requestRender({ full: true })",
		"terminal.input(response, true)",
		"const prefixLength = this.terminalControlBuffer.length;",
		"this.terminalControlBuffer = this.incompleteTerminalControlSuffix(combined);",
		"incompleteTerminalControlSuffix(data)",
		"this.decoder.decode()",
	} {
		if !strings.Contains(kittySource, want) {
			t.Fatalf("runtime Kitty Graphics guard missing %q", want)
		}
	}
	for _, want := range rendererSnippets {
		if !strings.Contains(rendererSource, want) {
			t.Fatalf("runtime terminal canvas residue guard missing renderer snippet %q", want)
		}
	}
	wasmWriteBlock := sourceBetween(t, rendererSource,
		"  writeBytes(A) {",
		"  resize(A, B) {")
	if strings.Contains(wasmWriteBlock, "ghostty_wasm_alloc_u8_array") || strings.Contains(wasmWriteBlock, "ghostty_wasm_free_u8_array") {
		t.Fatal("runtime Ghostty write hot path must reuse its instance input buffer")
	}
	if strings.Contains(rendererSource, "C !== void 0 && s !== void 0 ? s - C >>> 0") {
		t.Fatal("runtime must not silently fall back to scrollback length when generation ABI is missing")
	}
	queuedOutputBlock := sourceBetween(t, outputSource,
		"const writeBatch = (session, data, replayOutput, allowGeneratedInput, suppressRender = false) => {",
		"const trySendPendingQueueTurnAck = (session) => {")
	for _, want := range []string{
		`const replayWriter = (replayOutput || suppressRender) && typeof session.term.writeReplay === "function";`,
		`session.term.writeReplay(data);`,
		`session.term.write(data);`,
		`if (!replayWriter && isRenderAllowed(session)) {`,
		`session.term.requestRender?.({ throttle: true });`,
		`((replayOutput || suppressRender) && !replayWriter)`,
		`|| (!replayOutput && !suppressRender && deferHiddenRender(session))`,
	} {
		if !strings.Contains(queuedOutputBlock, want) {
			t.Fatalf("runtime queued PTY replay/render guard missing %q", want)
		}
	}
	writeReplayIndex := strings.Index(queuedOutputBlock, `session.term.writeReplay(data);`)
	normalWriteIndex := strings.Index(queuedOutputBlock, `session.term.write(data);`)
	renderIndex := strings.Index(queuedOutputBlock, `session.term.requestRender?.({ throttle: true });`)
	contentGenerationIndex := strings.Index(queuedOutputBlock, `advanceContentGeneration(session);`)
	if writeReplayIndex < 0 || normalWriteIndex < 0 || renderIndex <= normalWriteIndex || contentGenerationIndex <= renderIndex {
		t.Fatal("runtime queued PTY output must split replay writes from rendered live writes")
	}
	assertOutputRender := func(label, startMarker, endMarker string) {
		t.Helper()
		start := strings.Index(outputSource, startMarker)
		if start < 0 {
			t.Fatalf("runtime %s output guard missing start marker %q", label, startMarker)
		}
		endOffset := strings.Index(outputSource[start:], endMarker)
		if endOffset < 0 {
			t.Fatalf("runtime %s output guard missing end marker %q", label, endMarker)
		}
		body := outputSource[start : start+endOffset]
		writeIndex := strings.Index(body, `measureTask("terminal render", () => state.term.write(data));`)
		renderIndex := strings.Index(body, `state.term.requestRender?.({ throttle: true });`)
		contentGenerationIndex := strings.Index(body, `advanceContentGeneration(state);`)
		if writeIndex < 0 || renderIndex <= writeIndex || contentGenerationIndex <= renderIndex {
			t.Fatalf("runtime %s output must write, request a throttled render, then advance content generation", label)
		}
	}
	assertOutputRender(
		"immediate PTY",
		"const writeImmediate = (session, data) => {",
		"const discard = (session) => {",
	)
	presentationBlock := sourceBetween(t, string(presentationControllerData),
		"const beginHold = (session, { capture = true, recapture = false } = {}) => {",
		"const cancelHold = (session, { restoreReady = false, releaseFrame = false } = {}) => {")
	if strings.Contains(presentationBlock, "scheduleTerminalPresentationCommit") || strings.Contains(presentationBlock, "terminalPresentationQuietMs") {
		t.Fatal("presentation hold must not wait for an output quiet window")
	}
	viewportResetBlock := sourceBetween(t, imeSource,
		"const resetHostViewport = (session, { clean = false } = {}) => {",
		"const scheduleHostViewportReset = (session, options = {}) => {")
	for _, want := range []string{
		"session.terminalFrameHold,",
	} {
		if !strings.Contains(viewportResetBlock, want) {
			t.Fatalf("terminal host cleanup must preserve presentation overlays: missing %q", want)
		}
	}
	if !strings.Contains(string(presentationViewData), "hold.parentElement !== session.terminalHost") ||
		!strings.Contains(string(presentationViewData), "session.terminalHost.appendChild(hold);") {
		t.Fatal("presentation hold must restore its owned canvas before capturing the last-known-good frame")
	}
	resizeBlock := sourceBetween(t, resizeSource,
		"const resizePane = (session, {",
		"lifecycle = lifecycleFactory({")
	holdIndex := strings.Index(resizeBlock, "if (shouldHoldFrame) {")
	beginIndex := strings.Index(resizeBlock, "if (presentation()?.beginHold(session) !== true) {")
	dimensionsIndex := strings.Index(resizeBlock, "const dimensionsWillChange = !dimensionsEqual(session, fittedDimensions) || canvasNeedsResize;")
	commitIndex := strings.Index(resizeBlock, "presentation()?.commitNow(session);")
	if dimensionsIndex < 0 || holdIndex <= dimensionsIndex || beginIndex <= holdIndex || commitIndex <= beginIndex {
		t.Fatal("resize must enter a presentation hold only after confirming a geometry change, then commit its full render directly")
	}
	scheduleResizeBlock := sourceBetween(t, resizeSource,
		"const schedulePane = (session, options = {}, scheduleOptions = {}) => {",
		"const cancelPane = (session) => {")
	if strings.Contains(scheduleResizeBlock, "beginHold") {
		t.Fatal("scheduling a resize must not freeze a current terminal before its geometry is measured")
	}
	resizeOutputBlock := sourceBetween(t, outputSource,
		"const writeBatch = (session, data, replayOutput, allowGeneratedInput, suppressRender = false) => {",
		"const trySendPendingQueueTurnAck = (session) => {")
	if strings.Contains(resizeOutputBlock, "deferPaneRenderDuringResize") {
		t.Fatal("normal PTY output must continue rendering while a presentation frame is held")
	}
	tabSwitchBlock := sourceBetween(t, tabActivationSource,
		"const activate = (tabId, {",
		"const clear = () => {")
	preserveIndex := strings.Index(tabSwitchBlock, "preserveTabFrames(previousTab);")
	preserveTargetIndex := strings.Index(tabSwitchBlock, "preserveTabFrames(tab, { onlyIfStale: true });")
	activateIndex := strings.Index(tabSwitchBlock, "tabRegistry.setActiveTabId(tab.id);")
	visualIndex := strings.Index(tabSwitchBlock, "tabView.setActiveTabVisuals([previousTab, tab], tab.id);")
	deferredIndex := strings.Index(tabSwitchBlock, "scheduler.schedule(tab.id, [")
	if preserveIndex < 0 || preserveTargetIndex < 0 || activateIndex < 0 || visualIndex < 0 || deferredIndex < 0 ||
		preserveIndex > preserveTargetIndex || preserveTargetIndex > activateIndex || activateIndex > visualIndex || visualIndex > deferredIndex ||
		!strings.Contains(tabSwitchBlock, "pane.terminalFrameHeld") {
		t.Fatal("tab switching must preserve both outgoing and incoming frames before visual selection, then defer terminal activation")
	}
	if !strings.Contains(tabSwitchBlock, "const presentationCurrent = presentationStateIsCurrent(pane);") {
		t.Fatal("tab activation must use hidden-safe presentation state instead of measurable visibility")
	}
	if !strings.Contains(tabSwitchBlock, "pane.activationFitPending = !presentationCurrent;") {
		t.Fatal("tab activation must preserve current panes without forcing a full render")
	}
	if strings.Contains(tabSwitchBlock, "pane.activationFitPending = !wasActive || !presentationStateIsCurrent(pane);") {
		t.Fatal("tab activation must not unconditionally invalidate a target pane")
	}
	if !strings.Contains(tabSwitchBlock, "const presentationCurrent = presentationStateIsCurrent(pane);") {
		t.Fatal("tab activation must use hidden-safe presentation state instead of measurable visibility")
	}
	if !strings.Contains(tabSwitchBlock, "pane.activationFitPending = !presentationCurrent;") {
		t.Fatal("tab activation must preserve current panes without forcing a full render")
	}
	if !strings.Contains(tabSwitchBlock, "if (!presentationCurrent) {") {
		t.Fatal("tab activation must only clear readiness for stale panes")
	}
	if !strings.Contains(tabSwitchBlock, "if (!wasActive && pane.terminalFrameHeld)") {
		t.Fatal("stale tab activation must retain the held frame while entering presentation recovery")
	}
	if strings.Contains(tabSwitchBlock, "pane.terminalFrameHeld);\n          pane.resizePresentationHold") {
		t.Fatal("tab activation must not clear readiness merely because a held frame is already protecting the pane")
	}
	visibleResizeBlock := sourceBetween(t, resizeSource,
		"const scheduleVisibleTab = (tab, { immediate = false } = {}) => {",
		"const scheduleActiveTabWindowResize = () => scheduleTab(getCurrentTab(), {")
	if !strings.Contains(visibleResizeBlock, "if (presentation()?.stateIsCurrent(session) && !session.activationFitPending) {") {
		t.Fatal("tab activation resize must skip a pane whose hidden-safe presentation state is current")
	}
	for _, forbidden := range []string{
		"scheduleVisibleTabResize(tab, { immediate: true });",
		"syncConnectionDemands(",
	} {
		visualPrefix := tabSwitchBlock[:deferredIndex]
		if strings.Contains(visualPrefix, forbidden) {
			t.Fatalf("tab visual selection must not synchronously run terminal initialization %q", forbidden)
		}
	}
	holdBlock := sourceBetween(t, string(presentationControllerData),
		"const frameIdentity = (session) => ({",
		"const beginHold = (session, { capture = true, recapture = false } = {}) => {")
	for _, want := range []string{
		`selector: String(session?.name || "").trim()`,
		`tabID: String(session?.tabId || "").trim()`,
		`paneID: String(session?.id || "").trim()`,
		`workspaceGeneration: String(session?.workspaceGeneration || "").trim()`,
		`historyGeneration: String(session?.historyGeneration || "").trim()`,
		`session.terminalFrameHoldIdentity = frameIdentity(session);`,
		`session.terminalFrameHoldIdentity = null;`,
	} {
		if !strings.Contains(holdBlock, want) {
			t.Fatalf("held terminal overview frame identity guard missing %q", want)
		}
	}
	for _, want := range []string{
		"const stateIsCurrent = (session) => {",
		"function isCurrent(session) {",
		"&& isPaneMeasurable(session)",
		"canvasMatchesExpectedSize(session)",
	} {
		if !strings.Contains(string(presentationControllerData), want) {
			t.Fatalf("presentation current checks must separate hidden state from measurable geometry: missing %q", want)
		}
	}
	frameReleaseBlock := sourceBetween(t, string(presentationControllerData),
		"const scheduleFrameRelease = (session) => {",
		"const setReady = (session, ready, { preserveFrame = true, reason = \"presentation_state\" } = {}) => {")
	for _, want := range []string{
		"lifecycle.scheduleFrameRelease(session, {",
		"session.tabId === getActiveTabId()",
		"Number(session.renderGeneration || 0) === renderGeneration",
		"holdIdentityCurrent: frameHoldIsCurrent(session)",
		"release: () => releaseHold(session)",
	} {
		if !strings.Contains(frameReleaseBlock, want) {
			t.Fatalf("terminal frame release must wait for a current composited presentation: missing %q", want)
		}
	}
	setReadyBlock := sourceBetween(t, string(presentationControllerData),
		"const setReady = (session, ready, { preserveFrame = true, reason = \"presentation_state\" } = {}) => {",
		"const beginHold = (session, { capture = true, recapture = false } = {}) => {")
	if strings.Contains(setReadyBlock, "releaseHold(session);") {
		t.Fatal("render completion must not synchronously remove the last-known-good frame")
	}
	for _, want := range []string{
		"lifecycle.cancelFrameRelease(session);",
		"if (preserveFrame && session.hasPresentedFrame && !hasVisibleHeldFrame(session)) {",
		"holdFrame(session);",
		"scheduleFrameRelease(session);",
	} {
		if !strings.Contains(setReadyBlock, want) {
			t.Fatalf("render readiness must coordinate delayed held-frame release: missing %q", want)
		}
	}
	if strings.Contains(rendererSource, "this.requestRender({ full: s })") {
		t.Fatal("terminal writes must not depend on scrollback generation alone for full redraws")
	}
	renderBlock := sourceBetween(t, rendererSource,
		"render(A, B = !1, g = 0, E, C = 1) {",
		"renderLine(A, B, g, E = 0) {")
	materializeIndex := strings.Index(renderBlock, "const W = this.materializeViewportLines(A, D, g, i, E);")
	canvasClearIndex := strings.Index(renderBlock, "B && (this.ctx.fillStyle = this.theme.background")
	if materializeIndex < 0 || canvasClearIndex < 0 || materializeIndex >= canvasClearIndex {
		t.Fatal("runtime renderer must materialize every visible row before clearing or committing the canvas")
	}
	if strings.Contains(renderBlock, "c = E.getScrollbackLine(F)") || strings.Contains(renderBlock, "c = A.getLine(F)") {
		t.Fatal("runtime renderer must not re-read terminal rows while committing a materialized frame")
	}
	if !strings.Contains(string(wasmData), "ghostty_terminal_get_scrollback_generation") {
		t.Fatal("vendored Ghostty WASM must export scrollback generation")
	}
	if !strings.Contains(mainSource, `const ghosttyInitPromise = initGhostty(runtimeAssetURL("./ghostty-vt.wasm"))`) {
		t.Fatal("runtime must explicitly initialize ghostty-web with the vendored WASM resource")
	}
	if !strings.Contains(string(serverRevisionData), `const revisionChanged = Boolean(currentRevision && currentRevision !== nextRevision);`) {
		t.Fatal("runtime must detect an asset revision change even when the target cannot persist reload state")
	}
	if !strings.Contains(themeCatalogSource, `new URL("./themes.json", import.meta.url).toString()`) {
		t.Fatal("runtime theme catalog must inherit the LPK-versioned asset path")
	}
	markSyncBlock := sourceBetween(t, string(presentationControllerData),
		"const markSyncPending = (session) => {",
		"const invalidate = (session) => {")
	for _, forbidden := range []string{"renderer?.clear", "view.clearCanvas", "resetTerminalRuntimeState"} {
		if strings.Contains(markSyncBlock, forbidden) {
			t.Fatalf("transient terminal sync must preserve the last frame; found %q", forbidden)
		}
	}
}

func TestRuntimeOfflineFrameAndWorkspaceRetryGuard(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	mainSource := string(mainData)
	startupErrorSource := readRuntimeSources(t, "runtime/static/terminal/session/startup_error_controller.js")
	protocolSource := readRuntimeProtocolSource(t)
	runtimeSource := mainSource + "\n" + startupErrorSource + "\n" + protocolSource + "\n" + readRuntimeSources(t,
		"runtime/static/app/runtime_recovery_controller.js",
		"runtime/static/workspace/refresh_controller.js",
		"runtime/static/workspace/refresh_lifecycle.js",
		"runtime/static/terminal/transport/session_connection_controller.js",
		"runtime/static/terminal/transport/session_connection_lifecycle.js",
		"runtime/static/terminal/history/session_replay_controller.js",
	)
	for _, want := range []string{
		"baseDelayMs = 500,",
		"maxDelayMs = 15 * 1000,",
		"const schedule = ({",
		"const refreshWithRetry = async (options = {}) => {",
		"retryAttempts = Math.min(maxAttempts, retryAttempts + 1);",
		"schedule(context);",
		"case \"connection-error\":",
		"scheduleReconnect(session, { immediate: true, allowHidden });",
		"session.workspaceExitPending = true;",
		"refreshWorkspaceWithRetry({ focus: shouldFocusAfterExit })",
		"terminalPresentation.beginHold(session);",
		"reconnectWorkspaceSessions({ allowHidden: true });",
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("offline terminal recovery guard missing %q", want)
		}
	}
	exitBlock := sourceBetween(t, protocolSource,
		`case "process-exit":`,
		"        } catch (error) {")
	for _, forbidden := range []string{"terminalCache.destroySession(session);", "disposePane(session);"} {
		if strings.Contains(exitBlock, forbidden) {
			t.Fatalf("process exit must wait for authoritative workspace refresh before %q", forbidden)
		}
	}
	connectionErrorBlock := sourceBetween(t, protocolSource,
		`case "connection-error":`,
		`case "pong":`)
	for _, forbidden := range []string{"resetTerminalForHistoryReplay", "terminalPresentation.invalidate", "terminalPresentation.clearCanvas", "resetOnNextReplay"} {
		if strings.Contains(connectionErrorBlock, forbidden) {
			t.Fatalf("retryable connection errors must preserve the last frame; found %q", forbidden)
		}
	}
	startupErrorBlock := sourceBetween(t, startupErrorSource,
		"const show = async (session, fallback = \"\") => {",
		"return Object.freeze({")
	warmFrameBlock := sourceBetween(t, startupErrorBlock,
		"if (session.hasPresentedFrame) {",
		"return writeError(session, message);")
	if !strings.Contains(warmFrameBlock, "showStartupErrorPanel(message);") {
		t.Fatal("warm-frame startup failures must remain visible in the startup error panel")
	}
	if strings.Contains(warmFrameBlock, "writeImmediate(") {
		t.Fatal("warm-frame startup failures must not overwrite the preserved terminal frame")
	}
}

func TestRuntimeWebSocketReconnectHealthGuard(t *testing.T) {
	source := readRuntimeSources(t,
		"runtime/static/global-runtime.js",
		"runtime/static/terminal/config/terminal_config.js",
		"runtime/static/app/runtime_recovery_controller.js",
		"runtime/static/app/runtime_recovery_lifecycle.js",
		"runtime/static/workspace/refresh_lifecycle.js",
		"runtime/static/terminal/transport/session_protocol_controller.js",
		"runtime/static/terminal/transport/session_connection_controller.js",
		"runtime/static/terminal/transport/session_connection_lifecycle.js",
		"runtime/static/terminal/history/session_replay_controller.js",
		"runtime/static/terminal/input/input_controller.js",
		"runtime/static/app/app_lifecycle.js",
	)

	wantSnippets := []string{
		"terminalWebSocketPingIntervalMs: 10 * 1000,",
		"terminalWebSocketHealthTimeoutMs: 25 * 1000,",
		"terminalResumeProbeTimeoutMs: 1500,",
		"terminalUserRecoveryThrottleMs: 1500,",
		"terminalAttachReadyTimeoutMs: 8 * 1000,",
		"terminalAgentPrepareTimeoutMs: 45 * 1000,",
		"terminalReconnectBaseDelayMs: 500,",
		"baseDelayMs = 500,",
		"maxDelayMs = 15 * 1000,",
		"const healthTimeout = session.agentPreparing ? agentPrepareTimeoutMs : healthTimeoutMs;",
		"const attachTimeout = Number(session.attachReadyTimeoutMs || 0) || attachReadyTimeoutMs;",
		"const isReady = (session) => Boolean(",
		"const checkHealth = (session, { connect = true, force = false, allowHidden = false } = {}) => {",
		"const probeOpenSocket = (session, { allowHidden = false } = {}) => {",
		"sendPing = (socket) => socket?.send?.(JSON.stringify({ type: \"ping\" }))",
		"Terminal WebSocket resume probe timed out",
		"const recoverVisibleSessionsFromUserGesture = () => {",
		"reconnectVisibleSessions({ allowHidden: true, probe: true });",
		"flushPendingInput(session);",
		"if (session.resumeProbeTimer && force) {",
		"startSocketHealthMonitor(session, currentSocket);",
		"startAttachReadyTimer(session, currentSocket);",
		"case \"agent-preparing\":",
		"session.agentPreparing = true;",
		"startAttachReadyTimer(session, currentSocket, terminalAgentPrepareTimeoutMs);",
		"clearAttachReadyTimer(session);",
		"clearSocketResumeProbeTimer(session);",
		"session.shellEl.dataset.connection = \"open\";",
		"message.retryable === true",
		"case \"connection-error\":",
		"const reconnectWorkspaceSessions = ({ allowHidden = true } = {}) => {",
		"listen(windowObject, \"pageshow\", handlers.onPageShow);",
		"checkSessionHealth(pane, { connect: true, force: true, allowHidden });",
		"listen(documentObject, \"pointerdown\", handlers.onRecoverUserGesture, {",
		"listen(documentObject, \"touchstart\", handlers.onRecoverUserGesture, {",
		"checkConnectionHealth(session, { connect: true, force: userInput, allowHidden: userInput })",
		"document.hidden",
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime websocket reconnect health guard missing %q", want)
		}
	}
}

func TestRuntimeConnectionStateDiagnosticsAndOneShotRevisionGuard(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/diagnostics/diagnostics_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/diagnostics_controller.js) error = %v", err)
	}
	debugLogData, err := readRuntimeSource("runtime/static/diagnostics/debug_log.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/debug_log.js) error = %v", err)
	}
	lifecycleData, err := readRuntimeSource("runtime/static/diagnostics/diagnostics_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/diagnostics_lifecycle.js) error = %v", err)
	}
	viewData, err := readRuntimeSource("runtime/static/diagnostics/diagnostics_view.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/diagnostics_view.js) error = %v", err)
	}
	sessionStateData, err := readRuntimeSource("runtime/static/terminal/session/session_state.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/session/session_state.js) error = %v", err)
	}
	sessionConnectionControllerData, err := readRuntimeSource("runtime/static/terminal/transport/session_connection_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(session_connection_controller.js) error = %v", err)
	}
	sessionConnectionLifecycleData, err := readRuntimeSource("runtime/static/terminal/transport/session_connection_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(session_connection_lifecycle.js) error = %v", err)
	}
	protocolData, err := readRuntimeSource("runtime/static/terminal/transport/session_protocol_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(session_protocol_controller.js) error = %v", err)
	}
	transportRuntimeData, err := readRuntimeSource("runtime/static/terminal/transport/transport_runtime_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(transport_runtime_controller.js) error = %v", err)
	}
	configData, err := readRuntimeSource("runtime/static/terminal/config/terminal_config.js")
	if err != nil {
		t.Fatalf("ReadFile(terminal_config.js) error = %v", err)
	}
	revisionControllerData, err := readRuntimeSource("runtime/static/app/server_revision/server_revision_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(server_revision_controller.js) error = %v", err)
	}
	revisionLifecycleData, err := readRuntimeSource("runtime/static/app/server_revision/server_revision_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(server_revision_lifecycle.js) error = %v", err)
	}
	mainSource := strings.Join([]string{
		string(mainData),
		string(configData),
		string(revisionControllerData),
		string(revisionLifecycleData),
		string(protocolData),
		string(sessionStateData),
		readRuntimeOutputSource(t),
		string(sessionConnectionControllerData),
		string(sessionConnectionLifecycleData),
		string(transportRuntimeData),
	}, "\n")
	styleSource := string(styleData)
	indexSource := string(indexData)
	diagnosticsSource := strings.Join([]string{
		string(controllerData),
		string(debugLogData),
		string(lifecycleData),
		string(viewData),
	}, "\n")

	for _, want := range []string{
		"terminalWebSocketConnectTimeoutMs: 12 * 1000,",
		"const startSocketConnectTimer = (session, currentSocket) => {",
		"`Terminal WebSocket connect timed out: ${session.name}/${session.id}`",
		"const retryAfterFailure = (session, error, { allowHidden = true } = {}) => {",
		"connectPendingSession(session, { allowHidden: allowHidden || force });",
		"const started = await connectSession(session, {",
		"scheduler = createScheduler({",
		"const sessionConnectingState = (session) => (\n    session?.connectionRetrying === true ? \"reconnecting\" : \"connecting\"",
		"connectionRetrying: false,",
		"session.connectionRetrying = true;",
		"session.connectionRetrying = false;",
		"session.shellEl.dataset.connection = \"offline\";",
		"session.shellEl.dataset.connection = \"reconnecting\";",
		"session.connectionCloseReason = \"\";",
		"session.connectionRetrying = false;",
		"session.reconnectPending = false;",
		"\"终端连接将在重试\"",
		"appendDebugError(\"终端连接建立失败\"",
		"session.startupTraceActive = true;",
		"if (state.startupTraceActive) {",
		"scheduleInitialCheck(callback, delayMs = 1000) {",
		"initialCheckTimer = windowObject?.setTimeout?.(() => {",
		"serverRevision.scheduleInitialCheck();",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime connection diagnostics guard missing %q", want)
		}
	}
	for _, want := range []string{
		"debugLog: `${storagePrefix}.debugLog`,",
		"maxEntries = 200,",
		"dedupeWindowMs = 5000,",
		"const lastSeen = new Map();",
		"const append = (level, message, details = \"\", { dedupeKey = \"\", retainWhenDisabled = false } = {}) => {",
		"const appendStartupTrace = (event, details = \"\", { dedupeKey = event, diagnosticDetails = {} } = {}) => {",
		"entry.count = Number(entry.count || 1) + 1;",
		"count.textContent = `x${entry.count}`;",
		"lastSeen.clear();",
		"const dedupeKey = `console:${level}:",
		"elements.debugLogPanel.hidden = !visible;",
		"const removed = entries.length - safeMaxEntries;",
		"entries.splice(0, removed);",
		"clipboardText() {",
		"listen(elements.debugLogCopy, \"click\", handlers.onDebugLogCopy);",
		"showToast(\"暂无可复制的调试日志。\");",
		"showToast(\"调试日志已复制。\");",
		"showToast(\"复制调试日志失败。\");",
		"consoleObject[method] = capture;",
		"windowObject?.addEventListener?.(\"error\", handleWindowError, true);",
		"windowObject?.addEventListener?.(\"unhandledrejection\", handleUnhandledRejection);",
		"windowObject?.removeEventListener?.(\"error\", handleWindowError, true);",
		"windowObject?.removeEventListener?.(\"unhandledrejection\", handleUnhandledRejection);",
	} {
		if !strings.Contains(diagnosticsSource, want) {
			t.Fatalf("diagnostics log module guard missing %q", want)
		}
	}
	if strings.Contains(mainSource, "serverRevisionRefreshTimer") {
		t.Fatal("server revision must not keep a refresh loop timer")
	}
	if strings.Count(string(revisionControllerData), "refresh().catch(") != 1 {
		t.Fatal("initial server revision check must perform exactly one delayed request")
	}
	for _, want := range []string{
		`.pane-shell[data-connection="connecting"]::after`,
		`.pane-shell[data-connection="reconnecting"][data-connection-retrying="true"]::after`,
		`animation: pane-connection-breathe 1.35s ease-in-out infinite;`,
		`@keyframes pane-connection-breathe`,
		`.pane-shell[data-connection="offline"]::after`,
		`.pane-shell[data-connection="network-error"]::after`,
		`.pane-shell[data-connection="closed"]::after`,
	} {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime connection indicator style guard missing %q", want)
		}
	}
	grayIndicator := strings.Index(styleSource, `.pane-shell[data-connection="connecting"]::after`)
	redIndicator := strings.Index(styleSource, `.pane-shell[data-connection="offline"]::after,
.pane-shell[data-connection="network-error"]::after {
  background: #ef4444;
}`)
	if grayIndicator < 0 || redIndicator < 0 || redIndicator < grayIndicator {
		t.Fatal("explicit network indicator must override gray render-pending indicator")
	}
	for _, want := range []string{
		`id="settingsDebugLogToggle"`,
		`id="debugLogPanel"`,
		`id="debugLogList"`,
		`id="debugLogCopy"`,
		`id="debugLogClear"`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("runtime debug log index guard missing %q", want)
		}
	}
	for _, want := range []string{
		".debug-log-panel {",
		"max-height: min(46vh, 360px);",
		".debug-log-panel-actions {",
		".debug-log-copy,",
		".debug-log-list {",
		"overflow: auto;",
	} {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime debug log style guard missing %q", want)
		}
	}
}

func TestRuntimeTerminalConnectionSchedulerGuard(t *testing.T) {
	readSource := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}
	mainSource := readSource("runtime/static/global-runtime.js")
	integrationSource := strings.Join([]string{
		mainSource,
		readSource("runtime/static/app/runtime_recovery_controller.js"),
		readSource("runtime/static/terminal/session/session_installation_controller.js"),
		readSource("runtime/static/terminal/transport/session_protocol_controller.js"),
		readSource("runtime/static/terminal/transport/transport_runtime_controller.js"),
	}, "\n")
	transportIndexSource := readSource("runtime/static/terminal/transport/index.js")
	webSocketURLSource := readSource("runtime/static/terminal/transport/websocket_url.js")
	themeSource := readSource("runtime/static/terminal/transport/theme_controller.js")
	schedulerSource := readSource("runtime/static/terminal/transport/terminal_connection_scheduler.js")
	sessionConnectionControllerSource := readSource("runtime/static/terminal/transport/session_connection_controller.js")
	sessionConnectionLifecycleSource := readSource("runtime/static/terminal/transport/session_connection_lifecycle.js")
	transportRuntimeControllerSource := readSource("runtime/static/terminal/transport/transport_runtime_controller.js")
	transportRuntimeLifecycleSource := readSource("runtime/static/terminal/transport/transport_runtime_lifecycle.js")
	unifiedTransportSource := readSource("runtime/static/terminal/transport/unified_transport_controller.js")
	unifiedSource := readSource("runtime/static/terminal/transport/terminal_unified_connection.js")
	healthSource := readSource("runtime/static/terminal/transport/terminal_unified_health.js")
	membershipSource := readSource("runtime/static/terminal/transport/terminal_unified_membership.js")
	queueSource := readSource("runtime/static/terminal/transport/terminal_queue_connection.js")
	transportReadmeSource := readSource("runtime/static/terminal/transport/README.md")

	for _, want := range []string{
		`from "./terminal/transport/index.js";`,
		"createTerminalSessionConnectionController,",
		"terminalSessionConnection = createTerminalSessionConnectionController({",
		"terminalSessionConnection.checkHealth(session, options)",
		"terminalSessionConnection.clearConnectionTimers(session)",
		"terminalSessionConnection.dispose();",
		"createTerminalUnifiedTransportController,",
		"terminalUnifiedTransport = createTerminalUnifiedTransportController({",
		"terminalUnifiedTransport.ensure(session.name)",
		"closeUnifiedTransport(\"network_offline\")",
		"terminalUnifiedTransport.dispose(\"page_disposed\")",
		"createTerminalTransportRuntimeController,",
		"terminalTransportRuntime = createTerminalTransportRuntimeController({",
		"getUnifiedTransport: () => terminalUnifiedTransport,",
		"connectSession: (session, options) => connectSession(session, options),",
		"syncConnectionDemands({ reason: \"network_online\" });",
		"refreshMembership({ reason: \"network_online\" });",
		"terminalTransportRuntime?.dispose(\"page_disposed\");",
		"if (isClientTarget(instanceName)) {",
		"transportRuntime?.registerSession?.(session);",
		`terminalUnifiedWebSocketURL(targetName, {`,
		`webSocketURL: (path) => terminalWebSocketURL(path, { windowObject: window }),`,
		`createTerminalThemeController,`,
		`terminalTheme = createTerminalThemeController({`,
		`terminalTheme?.dispose();`,
	} {
		if !strings.Contains(integrationSource, want) {
			t.Fatalf("unified runtime guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"const clearReconnectTimer =",
		"const clearSocketHealthTimer =",
		"const clearSocketConnectTimer =",
		"const clearAttachReadyTimer =",
		"const clearSocketResumeProbeTimer =",
		"const clearSessionConnectionTimers =",
		"const markSessionSocketHealth =",
		"const scheduleReconnect =",
		"const retrySessionConnectionAfterFailure =",
		"const closeSessionSocketForReconnect =",
		"const probeOpenSessionSocket =",
		"const startSocketHealthMonitor =",
		"const startSocketConnectTimer =",
		"const startAttachReadyTimer =",
		"const checkSessionConnectionHealth =",
		"const waitForTerminalPhysicalClosures =",
		"const scheduleTerminalTransportRecovery =",
		"const startTerminalUnifiedHealthWatchdog =",
		"const probeTerminalUnifiedHealth =",
		"const terminalPhysicalTransportNeedsRecovery =",
		"const closeTerminalUnifiedConnection =",
		"const handleTerminalUnifiedPhysicalDisconnect =",
		"const retryUnavailableTerminalUnifiedTransport =",
		"const ensureTerminalUnifiedConnection =",
		"terminalUnifiedClosingPromise",
		"terminalUnifiedExpectedCloseReason",
		"terminalUnifiedClosedConnections",
		"terminalUnifiedHealthWatchdog",
		"const terminalConnectionPriority =",
		"const terminalUnifiedPanesForWorkspace =",
		"const terminalLayoutPaneOrder =",
		"const terminalUnifiedVisualOrder =",
		"const terminalUnifiedGlobalOrder =",
		"const scheduleTerminalUnifiedMeasurementPass =",
		"const refreshTerminalUnifiedMembership =",
		"const scheduleSessionConnectionPriorityDecay =",
		"const requestSessionConnection =",
		"const syncClientTerminalConnectionDemands =",
		"const syncTerminalConnectionDemands =",
		"const connectPendingSession =",
		"const terminalUnifiedStreamID =",
		"const clearTerminalUnifiedPaneRetry =",
		"const scheduleTerminalUnifiedPaneRetry =",
		"const detachTerminalUnifiedSession =",
		"const connectTerminalUnifiedSession =",
		"const reconcileTerminalUnifiedMembership =",
		"const ensureClientTerminalConnectionScheduler =",
		"terminalConnectionScheduler",
		"terminalConnectionDemandGeneration",
		"terminalUnifiedChannelGeneration",
		"terminalUnifiedRefreshPending",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal transport owner %q", forbidden)
		}
	}
	for _, want := range []string{
		`export { createTerminalSessionConnectionController } from "./session_connection_controller.js";`,
		`export { createTerminalSessionConnectionLifecycle } from "./session_connection_lifecycle.js";`,
		`export { createTerminalTransportRuntimeController } from "./transport_runtime_controller.js";`,
		`export { createTerminalTransportRuntimeLifecycle } from "./transport_runtime_lifecycle.js";`,
		`export { createTerminalUnifiedTransportController } from "./unified_transport_controller.js";`,
		`terminalWebSocketURL,`,
		`terminalUnifiedWebSocketURL,`,
	} {
		if !strings.Contains(transportIndexSource, want) {
			t.Fatalf("terminal transport public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export function terminalWebSocketURL(path, { windowObject = globalThis.window, baseURL = "" } = {}) {`,
		`url.protocol = "wss:";`,
		`url.protocol = "ws:";`,
		`url.protocol !== "ws:" && url.protocol !== "wss:"`,
		`export function terminalUnifiedWebSocketURL(`,
		`url.searchParams.set("transport_role", "unified");`,
	} {
		if !strings.Contains(webSocketURLSource, want) {
			t.Fatalf("terminal websocket URL module missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalThemeController({`,
		`const send = (session) => {`,
		`type: "theme",`,
		`session.socket.send(JSON.stringify`,
		`generation += 1;`,
	} {
		if !strings.Contains(themeSource, want) {
			t.Fatalf("terminal theme controller module missing %q", want)
		}
	}
	for _, forbidden := range []string{"new WebSocket", "history_replay", "writeReplay", "canvas.getContext"} {
		if strings.Contains(themeSource, forbidden) {
			t.Fatalf("terminal theme controller crosses ownership boundary %q", forbidden)
		}
	}
	if !strings.Contains(transportReadmeSource, "theme_controller.js") {
		t.Fatal("terminal transport README must document theme controller")
	}

	for _, want := range []string{
		"export function createTerminalTransportRuntimeController({",
		"const membership = createMembership();",
		"const refreshMembership = ({",
		"const scheduleUnifiedPaneRetry = (session, reason, { immediate = false } = {}) => {",
		"const connectUnifiedSession = (session) => {",
		"const reconcileUnifiedMembership = () => {",
		"const ensureDirectScheduler = () => {",
		"scheduler = createScheduler({",
		"function syncConnectionDemands(options = {}) {",
		"if (isClientTarget(getActiveName())) {",
		"return syncClientConnectionDemands(options);",
		"return refreshMembership(options);",
		"const connectPendingSession = (session, { allowHidden = false } = {}) => {",
		"const recycleUnifiedSession = (session, reason, { immediate = false } = {}) => {",
		"membership.clear();",
	} {
		if !strings.Contains(transportRuntimeControllerSource, want) {
			t.Fatalf("terminal transport runtime controller missing %q", want)
		}
	}
	for _, want := range []string{
		"export function createTerminalTransportRuntimeLifecycle({",
		"const priorityTimers = new WeakMap();",
		"const retryTimers = new WeakMap();",
		"const measurementFrames = new WeakMap();",
		"const scheduleUnifiedRetry = (session, callback = noop, delay = 0) => {",
		"const scheduleMeasurement = (session, callback = noop, { maxAttempts = 4 } = {}) => {",
		"const scheduleSync = (callback = noop) => {",
		"const disposeSession = (session) => {",
	} {
		if !strings.Contains(transportRuntimeLifecycleSource, want) {
			t.Fatalf("terminal transport runtime lifecycle missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"TerminalReplayController",
		"writeReplay",
		"resetTerminalForHistoryReplay",
		"terminalPresentation",
		"terminalCacheV2",
	} {
		if strings.Contains(transportRuntimeControllerSource, forbidden) || strings.Contains(transportRuntimeLifecycleSource, forbidden) {
			t.Fatalf("terminal transport runtime crosses an ownership boundary with %q", forbidden)
		}
	}
	for _, want := range []string{
		"export function createTerminalUnifiedTransportController({",
		"let connection = null;",
		"let closingPromise = null;",
		"const waitForClosures = async () => {",
		"const scheduleRecovery = (reason = \"transport_failure\") => {",
		"const handlePhysicalDisconnect = (\n    observedConnection,\n    reason = \"unified_transport_closed\",\n    { closeConnection = false } = {},\n  ) => {",
		"const startHealthWatchdog = (current) => {",
		"const retryUnavailable = (reason = \"lifecycle_resume\") => {",
		"const ensure = (requestedTargetName) => {",
		"const current = connection;",
		"if (!current) {\n      return false;\n    }",
		"await waitForClosures();",
		"scheduleLogicalSync({ reason: \"unified_open\" });",
	} {
		if !strings.Contains(unifiedTransportSource, want) {
			t.Fatalf("terminal unified transport controller missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"TerminalReplayController",
		"writeReplay",
		"resetTerminalForHistoryReplay",
		"terminalPresentation",
		"terminalCacheV2",
		"ResizeObserver",
	} {
		if strings.Contains(unifiedTransportSource, forbidden) {
			t.Fatalf("terminal unified transport crosses an ownership boundary with %q", forbidden)
		}
	}
	for _, want := range []string{
		"export function createTerminalSessionConnectionController({",
		"const scheduleReconnect = (session, { immediate = false, allowHidden = true } = {}) => {",
		"const closeSocketForReconnect = (session, currentSocket, reason, { allowHidden = false } = {}) => {",
		"const checkHealth = (session, { connect = true, force = false, allowHidden = false } = {}) => {",
		`if (session.connectionChannel === "unified") {`,
		"notifyConnectionFailure(",
	} {
		if !strings.Contains(sessionConnectionControllerSource, want) {
			t.Fatalf("terminal session connection controller missing %q", want)
		}
	}
	for _, want := range []string{
		"export function createTerminalSessionConnectionLifecycle({",
		"const clearConnectionTimers = (session) => {",
		"const markSocketHealth = (session, currentSocket) => {",
		"const probeOpenSocket = (session, { allowHidden = false } = {}) => {",
		"const startSocketHealthMonitor = (session, currentSocket) => {",
		"const startAttachReadyTimer = (session, currentSocket, timeoutMs = attachReadyTimeoutMs) => {",
		"session.socket !== currentSocket",
	} {
		if !strings.Contains(sessionConnectionLifecycleSource, want) {
			t.Fatalf("terminal session connection lifecycle missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"TerminalReplayController",
		"writeReplay",
		"requestRender",
		"terminalPresentation",
		"terminalCacheV2",
	} {
		if strings.Contains(sessionConnectionControllerSource, forbidden) || strings.Contains(sessionConnectionLifecycleSource, forbidden) {
			t.Fatalf("terminal session connection module crosses an ownership boundary with %q", forbidden)
		}
	}
	clientBranch := strings.Index(transportRuntimeControllerSource, "if (isClientTarget(getActiveName())) {")
	clientSync := strings.Index(transportRuntimeControllerSource, "return syncClientConnectionDemands(options);")
	unifiedSync := strings.Index(transportRuntimeControllerSource, "return refreshMembership(options);")
	if clientBranch < 0 || clientSync < clientBranch || unifiedSync < clientSync {
		t.Fatal("terminal demand routing must keep client scheduler behind its target guard before Unified membership refresh")
	}
	for _, forbidden := range []string{
		"terminal_topology_controller.js",
		"createTerminalTopologyController",
		"terminalTopologyController",
		"terminalFastConnections",
		"terminalQueueConnection",
		"start-queue-transport",
		"sync-queue-candidates",
		"promote_to_fast",
		`connectionChannel === "queue"`,
		`channel: "queue"`,
		"createTerminalQueueStartupLatch",
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("ordinary container runtime retains obsolete Fast/Queue topology %q", forbidden)
		}
	}
	if count := strings.Count(transportRuntimeControllerSource, "connectSession(session,"); count != 2 {
		t.Fatalf("connectSession must only be called by unified membership and client direct scheduler, count=%d", count)
	}
	if count := strings.Count(mainSource, "connectSession: (session, options) => connectSession(session, options)"); count != 1 {
		t.Fatalf("main.js must only inject connectSession into transport runtime once, count=%d", count)
	}
	for _, want := range []string{
		"export const createTerminalUnifiedMembership = () => {",
		"const membershipChanged = targetChanged || added.length > 0 || removed.length > 0;",
		"if (membershipChanged) {",
		"priorities.push({ pane, priority });",
	} {
		if !strings.Contains(membershipSource, want) {
			t.Fatalf("unified membership module guard missing %q", want)
		}
	}
	for _, want := range []string{
		"export const createTerminalUnifiedConnection = ({",
		"keepAliveWhenEmpty: true,",
		`physicalRole: "unified"`,
	} {
		if !strings.Contains(unifiedSource, want) {
			t.Fatalf("unified connection guard missing %q", want)
		}
	}
	for _, want := range []string{
		"export const createTerminalUnifiedHealthWatchdog = ({",
		"current.ping?.()",
		"unified_pong_timeout",
		"state === socketClosed",
	} {
		if !strings.Contains(healthSource, want) {
			t.Fatalf("unified health guard missing %q", want)
		}
	}
	for _, want := range []string{
		"const normalizeCapacity = (value) => Math.max(1",
		`requestDisconnect(victim, "scheduler_preempt");`,
		"record.status = \"backoff\";",
	} {
		if !strings.Contains(schedulerSource, want) {
			t.Fatalf("client direct scheduler guard missing %q", want)
		}
	}
	if strings.Contains(queueSource, "physicalLastPongAt = Date.now();\n          emitState();") {
		t.Fatal("queue-pong must update physical health without emitting a transport state change")
	}
	if strings.Contains(unifiedTransportSource, "if (state.physicalReadyState === socketOpen) {\n          healthWatchdog?.probe(\"transport_open\");") {
		t.Fatal("Unified owner must not probe on every OPEN snapshot")
	}

	for _, want := range []string{
		"Unified 物理连接、target、close fence、恢复任务和 watchdog 的 owner",
		"异常断线建立的 close fence 在旧 socket 真正关闭或 fence 超时前不得清除",
		"`unified_transport_controller.js`",
		"`terminal_unified_transport_controller_test.mjs`",
	} {
		if !strings.Contains(transportReadmeSource, want) {
			t.Fatalf("terminal transport README missing %q", want)
		}
	}
}

func TestRuntimeTerminalNetworkMonitorIsOptIn(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	monitorData, err := readRuntimeSource("runtime/static/diagnostics/network_monitor.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/network_monitor.js) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/diagnostics/diagnostics_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/diagnostics_controller.js) error = %v", err)
	}
	lifecycleData, err := readRuntimeSource("runtime/static/diagnostics/diagnostics_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/diagnostics_lifecycle.js) error = %v", err)
	}
	viewData, err := readRuntimeSource("runtime/static/diagnostics/diagnostics_view.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/diagnostics_view.js) error = %v", err)
	}
	networkContextData, err := readRuntimeSource("runtime/static/diagnostics/network_context.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/diagnostics/network_context.js) error = %v", err)
	}
	queueData, err := readRuntimeSource("runtime/static/terminal/transport/terminal_queue_connection.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/transport/terminal_queue_connection.js) error = %v", err)
	}
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}

	mainSource := string(mainData)
	monitorSource := string(monitorData)
	queueSource := string(queueData)
	indexSource := string(indexData)
	styleSource := string(styleData)

	diagnosticsSource := strings.Join([]string{string(controllerData), string(lifecycleData), string(viewData)}, "\n")
	networkContextSource := string(networkContextData)

	for _, want := range []string{
		`id="settingsNetworkMonitorToggle"`,
		`id="terminalNetworkMonitor"`,
		`id="terminalNetworkMonitorStatus"`,
		`aria-label="未启用"`,
		`id="terminalNetworkMonitorUsage"`,
		`网络监视器`,
		`0.000 MB/s`,
		`0.000 MB`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("runtime terminal network monitor index guard missing %q", want)
		}
	}
	for _, want := range []string{
		"networkMonitor: `${storagePrefix}.networkMonitor`,",
		"networkMonitor: readStoredFlag(storageKeys.networkMonitor),",
		"let status = online === false ? \"error\" : String(snapshot.status || \"idle\");",
		"if (status === \"idle\" && retrying) {",
		"elements.terminalNetworkMonitorChannels.hidden = channels.length === 0;",
		"networkMonitorLifecycle.setActive(runtimeActive && state.networkMonitor);",
		`const defaultModuleLoader = () => import("./network_monitor.js");`,
		"monitor.setLayout(snapshot.layout);",
		"monitor.attachSocket(attachment.socket, {",
		"monitor?.dispose?.();",
		"windowObject?.clearInterval?.(sampleTimer);",
		"sampleTimer = windowObject?.setInterval?.(() => {",
		`listen(elements.settingsNetworkMonitorToggle, "change", handlers.onNetworkMonitorChange);`,
		"writeStoredFlag(storageKeys[key], state[key]);",
	} {
		if !strings.Contains(diagnosticsSource, want) {
			t.Fatalf("diagnostics terminal network monitor guard missing %q", want)
		}
	}
	for _, want := range []string{
		"createDiagnosticsNetworkContext({",
		"getNetworkContext: getDiagnosticsNetworkContext,",
		"refreshNetworkView: renderTerminalNetworkMonitor,",
		"syncNetworkSockets: syncTerminalNetworkMonitorSockets,",
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime terminal network diagnostics integration missing %q", want)
		}
	}
	for _, want := range []string{
		"sockets.push({ socket, kind: \"unified\" });",
		"return function getNetworkContext()",
	} {
		if !strings.Contains(networkContextSource, want) {
			t.Fatalf("diagnostics network context owner missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`from "./diagnostics/network_monitor.js"`,
		`from "./diagnostics/diagnostics_controller.js"`,
		`import("./network_monitor.js")`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must only use the diagnostics public entry and must not deep import %q", forbidden)
		}
	}

	for _, want := range []string{
		"export const terminalNetworkPayloadBytes = (payload) => {",
		"const renderedChannels = () => currentLayout === \"direct\" ? channels : [];",
		"const monitorStatus = () => {",
		"status: monitorStatus(),",
		"const totals = () => channels.reduce((result, channel) => ({",
		"const wrappedClose = function closeWithNetworkMeasurement(...args) {",
		"socket.addEventListener(type, listener);",
		"socket.removeEventListener(type, listener);",
		"delete socket.send;",
		"delete socket.close;",
		"detachAll({ emitChange: false });",
		"receivedBytesPerSecond",
		"sentBytesPerSecond",
		"totalBytes: channel.receivedBytes + channel.sentBytes",
		"bytesPerSecond: channel.receivedBytesPerSecond + channel.sentBytesPerSecond",
		"status: monitorStatus(),",
	} {
		if !strings.Contains(monitorSource, want) {
			t.Fatalf("terminal network monitor module guard missing %q", want)
		}
	}
	if !strings.Contains(queueSource, "getPhysicalSocket() {") {
		t.Fatal("terminal queue connection must expose its physical socket only for opt-in instrumentation")
	}
	if strings.Contains(styleSource, ".terminal-pane {\n  position: absolute;\n  inset: 0;\n  display: none;") {
		t.Fatal("tab switching must not tear down terminal pane layout with display:none")
	}
	for _, want := range []string{
		".terminal-pane {",
		"visibility: hidden;",
		"pointer-events: none;",
		".terminal-pane.active {",
		"visibility: visible;",
		"pointer-events: auto;",
		".terminal-network-monitor-title {",
		".terminal-network-monitor-status-dot {",
		".terminal-network-monitor-status-dot[data-state=\"open\"] {",
		".terminal-network-monitor-status-dot[data-state=\"error\"] {",
		".terminal-network-monitor-channel-metric-value {",
		".terminal-network-monitor-channel-detail {",
		".terminal-network-monitor-summary {",
		"font-variant-numeric: tabular-nums;",
		".debug-log-panel {",
		"border: 1px solid color-mix(in srgb, var(--terminal-fg) 28%, transparent);",
		"background: color-mix(in srgb, var(--terminal-bg) 86%, transparent);",
		"color: var(--terminal-fg);",
		".debug-log-entry-level-error {",
		".debug-log-entry-message {",
	} {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime terminal network monitor style guard missing %q", want)
		}
	}
	networkThemeBlock := sourceBetween(t, styleSource,
		".terminal-network-monitor {",
		".debug-log-panel {")
	debugThemeBlock := sourceBetween(t, styleSource,
		".debug-log-panel {",
		".terminal-composition-preview {")
	for _, block := range []struct {
		name   string
		source string
	}{
		{name: "network monitor", source: networkThemeBlock},
		{name: "debug log", source: debugThemeBlock},
	} {
		for _, want := range []string{
			"border: 1px solid color-mix(in srgb, var(--terminal-fg) 28%, transparent);",
			"background: color-mix(in srgb, var(--terminal-bg) 86%, transparent);",
			"color: var(--terminal-fg);",
		} {
			if !strings.Contains(block.source, want) {
				t.Fatalf("%s must follow the active terminal theme: missing %q", block.name, want)
			}
		}
		for _, forbidden := range []string{"#22d3ee", "#062c33", "#cffafe", "#fde68a"} {
			if strings.Contains(block.source, forbidden) {
				t.Fatalf("%s must not retain the fixed cyan palette %q", block.name, forbidden)
			}
		}
	}
	if strings.Contains(styleSource, "background: color-mix(in srgb, #450a0a 88%, var(--terminal-bg));") {
		t.Fatal("debug log panel must use the network monitor palette instead of an all-red background")
	}
	for _, want := range []string{
		`if (entry.level === "error") {`,
		`const level = documentObject.createElement("span");`,
		`level.textContent = "错误";`,
		`row.append(time);`,
	} {
		if !strings.Contains(string(viewData), want) {
			t.Fatalf("runtime debug log error-label guard missing %q", want)
		}
	}
}

func TestRuntimeTerminalMouseTrackingSequences(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js")
	installationSource := read("runtime/static/terminal/session/session_installation_controller.js")
	integrationSource := mainSource + "\n" + installationSource
	indexSource := read("runtime/static/terminal/mouse/index.js")
	controllerSource := read("runtime/static/terminal/mouse/mouse_controller.js")
	modelSource := read("runtime/static/terminal/mouse/mouse_model.js")
	lifecycleSource := read("runtime/static/terminal/mouse/mouse_lifecycle.js")
	readmeSource := read("runtime/static/terminal/mouse/README.md")

	for _, want := range []string{
		`import { createTerminalMouseController } from "./terminal/mouse/index.js";`,
		`let terminalMouse = null;`,
		`terminalMouse = createTerminalMouseController({`,
		`isDeferredTouchClickSession: (session) => isGrokTerminalSession(session),`,
		`hasMouseTracking: (session) => terminalMouse?.hasTracking(session) === true,`,
		`mouse?.installSession?.(session);`,
		`terminalMouse?.dispose();`,
	} {
		if !strings.Contains(integrationSource, want) {
			t.Fatalf("runtime terminal mouse integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const terminalMouseModeEnabled =`,
		`const terminalMouseTrackingState =`,
		`const encodeTerminalMouseSequence =`,
		`const installTerminalMouseTracking =`,
		`terminalLocalMouseClaimedEvents`,
		`terminalMouseEventFromTouch`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal mouse implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		`export { createTerminalMouseController } from "./mouse_controller.js";`,
		`export { createTerminalMouseLifecycle } from "./mouse_lifecycle.js";`,
		`encodeTerminalMouseSequence,`,
		`terminalMouseTrackingState,`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal mouse public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`const terminalMouseLegacyCoordinateLimit = 95;`,
		`export const terminalMouseModeEnabled = (term, mode) => {`,
		`term.getMode(mode, false) === true`,
		`export const terminalMouseTrackingState = (session) => {`,
		`const normal = terminalMouseModeEnabled(term, 1000);`,
		`const drag = terminalMouseModeEnabled(term, 1002);`,
		`const any = terminalMouseModeEnabled(term, 1003);`,
		`sgr: terminalMouseModeEnabled(term, 1006),`,
		`tracking = tracking || term.hasMouseTracking?.() === true;`,
		`export const encodeTerminalMouseSequence = ({`,
		`return ` + "`\\x1b[<${buttonCode};${x};${y}${suffix}`" + `;`,
		`return encodeTerminalLegacyMouseSequence(buttonCode, x, y);`,
	} {
		if !strings.Contains(modelSource, want) {
			t.Fatalf("terminal mouse model missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalMouseController({`,
		`const claimedEvents = new WeakSet();`,
		`const sendMouseSequence = (event, action, button = -1) => {`,
		`const handleTouchStart = (event) => {`,
		`sendMouseSequence(mouseEventFromTouch(event, touch), "press", 0);`,
		`sendMouseSequence(mouseEventFromTouch(event, touch), "move", 0);`,
		`sendMouseSequence(mouseEventFromTouch(event, touch), "release", 0);`,
		`lifecycle.listenSession(session, shell, "mousedown", handleMouseDown, listenerOptions);`,
		`lifecycle.listenSession(session, shell, "touchstart", handleTouchStart, listenerOptions);`,
		`lifecycle.listenSession(session, documentObject, "mouseup", handleMouseUp, listenerOptions);`,
		`finishDeferredTouchKeyboardTap(event, touch);`,
		`requestTouchKeyboard(session);`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal mouse controller missing %q", want)
		}
	}
	for _, tool := range []string{"claude", "opencode", "herdr", "grok"} {
		if strings.Contains(strings.ToLower(controllerSource), tool) {
			t.Fatalf("generic terminal mouse controller must not contain %s-specific branches", tool)
		}
	}
	for _, piBranch := range []string{"isPi", "PiFullscreen", `"pi"`, `'pi'`} {
		if strings.Contains(controllerSource, piBranch) {
			t.Fatalf("generic terminal mouse controller must not contain Pi-specific branch %q", piBranch)
		}
	}
	for _, want := range []string{
		`export function createTerminalMouseLifecycle() {`,
		`const sessionCleanups = new Map();`,
		`listenSession(session, target, type, listener, options)`,
		`disposeSession(session)`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("terminal mouse lifecycle missing %q", want)
		}
	}
	for _, want := range []string{
		"状态所有权",
		"生命周期与事件顺序",
		"Legacy/SGR",
		"不得清空终端、触发或显示 history replay、snapshot、resize 或重连中间过程",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal mouse README missing %q", want)
		}
	}

}

func TestRuntimeClaudeFullscreenTouchAdapterIsolation(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	adapterData, err := readRuntimeSource("runtime/static/terminal/tui_adapters/claude/claude_fullscreen_touch_adapter.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/tui_adapters/claude/claude_fullscreen_touch_adapter.js) error = %v", err)
	}
	mainSource := string(mainData)
	policyData, err := readRuntimeSource("runtime/static/terminal/policy/policy_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/policy/policy_controller.js) error = %v", err)
	}
	policySource := string(policyData)
	installationData, err := readRuntimeSource("runtime/static/terminal/tui_adapters/installation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/tui_adapters/installation_controller.js) error = %v", err)
	}
	sessionInstallationData, err := readRuntimeSource("runtime/static/terminal/session/session_installation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(session_installation_controller.js) error = %v", err)
	}
	imeSource := readRuntimeIMESource(t)
	runtimeSource := mainSource + "\n" + policySource + "\n" + string(installationData) + "\n" + string(sessionInstallationData) + "\n" + imeSource
	adapterSource := string(adapterData)
	selectionData, err := readRuntimeSource("runtime/static/terminal/selection/selection_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/selection/selection_controller.js) error = %v", err)
	}
	selectionSource := string(selectionData)
	mouseData, err := readRuntimeSource("runtime/static/terminal/mouse/mouse_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(mouse_controller.js) error = %v", err)
	}
	mouseSource := string(mouseData)

	for _, want := range []string{
		`from "./terminal/tui_adapters/index.js";`,
		`installClaudeFullscreenTouchAdapter,`,
		`const claimedTouchEnds = new WeakSet();`,
		`claimedTouchEnds.add(event);`,
		`claudeTouchCandidate: isClaudeFullscreenTouchCandidate,`,
		`const isClaudeFullscreenTouchSession = (session) => claudeTouchCandidate(session, {`,
		`mouseTracking: hasMouseTracking(session) === true,`,
		`const installClaudeTouch = (session) => {`,
		`consumeKeyboardClaim: (event) => getTerminalIME()?.consumeKeyboardClaim(event) === true,`,
		`moveThresholdPx: touchShortcutMoveThresholdPx,`,
		`longPressDelayMs: touchSelectionLongPressDelayMs,`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime Claude fullscreen adapter guard missing %q", want)
		}
	}
	claudeTouchSession := sourceBetween(
		t,
		policySource,
		`  const isClaudeFullscreenTouchSession = (session) =>`,
		`  const isClaudeFullscreenContextMenuEvent = (session, event) =>`,
	)
	if strings.Contains(claudeTouchSession, "AlternateScreen") || strings.Contains(claudeTouchSession, "alternateScreen") {
		t.Fatal("Claude fullscreen touch ownership must not depend on replayed alternate-screen state")
	}

	sessionInstallationSource := string(sessionInstallationData)
	installInputFocus := strings.Index(sessionInstallationSource, `ime?.installSession?.(session);`)
	installMobileSelection := strings.Index(sessionInstallationSource, `selection?.installSession?.(session);`)
	installClaudeAdapter := strings.Index(sessionInstallationSource, `tuiAdapterInstaller?.installClaudeTouch?.(session);`)
	installMouseTracking := strings.Index(sessionInstallationSource, `mouse?.installSession?.(session);`)
	if installInputFocus < 0 || installMobileSelection < 0 || installClaudeAdapter < 0 || installMouseTracking < 0 {
		t.Fatal("runtime terminal touch installation order is incomplete")
	}
	if !(installInputFocus < installMobileSelection && installMobileSelection < installClaudeAdapter && installClaudeAdapter < installMouseTracking) {
		t.Fatal("runtime terminal touch order must be input focus, default selection, Claude adapter, generic mouse tracking")
	}

	genericMouseTracking := sourceBetween(
		t,
		mouseSource,
		`export function createTerminalMouseController({`,
		`  function disposeSession(session) {`,
	)
	if strings.Contains(strings.ToLower(genericMouseTracking), "claude") {
		t.Fatal("generic terminal mouse tracking must not contain Claude-specific branches")
	}
	defaultSelection := sourceBetween(
		t,
		selectionSource,
		`  const installSession = (session) => {`,
		`  function disposeSession(session) {`,
	)
	if !strings.Contains(defaultSelection, `|| hasMouseTracking(session)`) {
		t.Fatal("default mobile selection must preserve its existing mouse-tracking guard")
	}

	for _, want := range []string{
		`stopEvent(event, { preventDefault: false });`,
		`const keyboardClaimed = consumeKeyboardClaim(event);`,
		`stopEvent(event, { preventDefault: !keyboardClaimed });`,
		`if (outcome === "keyboard" || outcome === "scrolling") {`,
		`const steps = gesture.takeWheelSteps(rowHeight(), 10);`,
		`if (clearSelectionIfTapOutside(touch) || hasSelection()) {`,
	} {
		if !strings.Contains(adapterSource, want) {
			t.Fatalf("Claude fullscreen touch adapter isolation missing %q", want)
		}
	}
}

func TestRuntimeOpencodeHerdrFullscreenTouchAdapterIsolation(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	source := string(data)
	policyData, err := readRuntimeSource("runtime/static/terminal/policy/policy_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/policy/policy_controller.js) error = %v", err)
	}
	policySource := string(policyData)
	installationData, err := readRuntimeSource("runtime/static/terminal/tui_adapters/installation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/tui_adapters/installation_controller.js) error = %v", err)
	}
	sessionInstallationSource := readRuntimeSources(t, "runtime/static/terminal/session/session_installation_controller.js")
	runtimeSource := source + "\n" + policySource + "\n" + string(installationData) + "\n" + sessionInstallationSource
	for _, want := range []string{
		`from "./terminal/tui_adapters/index.js";`,
		`installOpencodeFullscreenTouchAdapter,`,
		`isHerdrFullscreenTouchCandidate,`,
		`installHerdrFullscreenTouchAdapter,`,
		`const installOpencodeTouch = (session) => installFullscreenTouch(`,
		`const installHerdrTouch = (session) => installFullscreenTouch(`,
		`tuiAdapterInstaller?.installOpencodeTouch?.(session);`,
		`tuiAdapterInstaller?.installHerdrTouch?.(session);`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime opencode/herdr adapter guard missing %q", want)
		}
	}
	claudeSource := sourceBetween(t, string(installationData), `  const installClaudeTouch = (session) => {`, `  const installOpencodeTouch = (session) => installFullscreenTouch(`)
	if strings.Contains(claudeSource, "Opencode") || strings.Contains(claudeSource, "Herdr") {
		t.Fatal("Claude touch adapter must not contain opencode/herdr branches")
	}
	mouseData, err := readRuntimeSource("runtime/static/terminal/mouse/mouse_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(mouse_controller.js) error = %v", err)
	}
	genericSource := string(mouseData)
	if strings.Contains(strings.ToLower(genericSource), "opencode") || strings.Contains(strings.ToLower(genericSource), "herdr") {
		t.Fatal("generic mouse tracking must not contain opencode/herdr-specific branches")
	}
	installSelection := strings.Index(sessionInstallationSource, `selection?.installSession?.(session);`)
	installClaude := strings.Index(sessionInstallationSource, `tuiAdapterInstaller?.installClaudeTouch?.(session);`)
	installOpencode := strings.Index(sessionInstallationSource, `tuiAdapterInstaller?.installOpencodeTouch?.(session);`)
	installHerdr := strings.Index(sessionInstallationSource, `tuiAdapterInstaller?.installHerdrTouch?.(session);`)
	installPi := strings.Index(sessionInstallationSource, `tuiAdapterInstaller?.installPiTouch?.(session);`)
	installMouse := strings.Index(sessionInstallationSource, `mouse?.installSession?.(session);`)
	if installSelection < 0 || installClaude < 0 || installOpencode < 0 || installHerdr < 0 || installPi < 0 || installMouse < 0 {
		t.Fatal("fullscreen TUI touch installation order is incomplete")
	}
	if !(installSelection < installClaude && installClaude < installOpencode && installOpencode < installHerdr && installHerdr < installPi && installPi < installMouse) {
		t.Fatal("tool-specific fullscreen TUI adapters must precede generic mouse tracking")
	}
}

func TestRuntimeClaudeFullscreenContextMenuIsolation(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	source := string(data)
	policyData, err := readRuntimeSource("runtime/static/terminal/policy/policy_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/policy/policy_controller.js) error = %v", err)
	}
	policySource := string(policyData)
	sessionInstallationSource := readRuntimeSources(t, "runtime/static/terminal/session/session_installation_controller.js")
	installationData, err := readRuntimeSource("runtime/static/terminal/tui_adapters/installation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/tui_adapters/installation_controller.js) error = %v", err)
	}
	runtimeSource := source + "\n" + policySource + "\n" + string(installationData) + "\n" + sessionInstallationSource

	for _, want := range []string{
		`from "./terminal/tui_adapters/index.js";`,
		`const isClaudeFullscreenContextMenuEvent = (session, event) => claudeContextMenuCandidate(session, {`,
		`claudeContextMenuCandidate: isClaudeFullscreenContextMenuCandidate,`,
		`contextMenuSuppressed: shouldSuppressContextMenu(event),`,
		`const installClaudeContextMenu = (session) => {`,
		`claimEvent: (event) => getTerminalMouse()?.claimEvent(event),`,
		`tuiAdapterInstaller?.installClaudeContextMenu?.(session);`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime Claude fullscreen context menu isolation missing %q", want)
		}
	}

	installClaudeTouch := strings.Index(sessionInstallationSource, `tuiAdapterInstaller?.installClaudeTouch?.(session);`)
	installClaudeContextMenu := strings.Index(sessionInstallationSource, `tuiAdapterInstaller?.installClaudeContextMenu?.(session);`)
	installMouseTracking := strings.Index(sessionInstallationSource, `mouse?.installSession?.(session);`)
	if installClaudeTouch < 0 || installClaudeContextMenu < 0 || installMouseTracking < 0 {
		t.Fatal("runtime Claude context menu installation order is incomplete")
	}
	if !(installClaudeTouch < installClaudeContextMenu && installClaudeContextMenu < installMouseTracking) {
		t.Fatal("Claude context menu ownership must be installed before generic mouse tracking")
	}

	mouseData, err := readRuntimeSource("runtime/static/terminal/mouse/mouse_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(mouse_controller.js) error = %v", err)
	}
	genericMouseTracking := string(mouseData)
	if strings.Contains(strings.ToLower(genericMouseTracking), "claude") {
		t.Fatal("generic terminal mouse tracking must not contain Claude-specific context menu branches")
	}
}

func TestRuntimeClaudeFullscreenDesktopSelectionIsolation(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	source := string(data)
	policyData, err := readRuntimeSource("runtime/static/terminal/policy/policy_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/policy/policy_controller.js) error = %v", err)
	}
	policySource := string(policyData)
	sessionInstallationSource := readRuntimeSources(t, "runtime/static/terminal/session/session_installation_controller.js")
	installationData, err := readRuntimeSource("runtime/static/terminal/tui_adapters/installation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/tui_adapters/installation_controller.js) error = %v", err)
	}
	runtimeSource := source + "\n" + policySource + "\n" + string(installationData) + "\n" + sessionInstallationSource

	for _, want := range []string{
		`from "./terminal/tui_adapters/index.js";`,
		`const isClaudeFullscreenDesktopSelectionEvent = (session, event) => claudeDesktopSelectionCandidate(session, {`,
		`claudeDesktopSelectionCandidate: isClaudeFullscreenDesktopSelectionCandidate,`,
		`touchSelectionLayout: isTouchSelectionLayout(),`,
		`applicationModifier: Boolean(event?.ctrlKey || event?.altKey || event?.metaKey),`,
		`const installClaudeDesktopSelection = (session) => {`,
		`claimEvent: (event) => getTerminalMouse()?.claimEvent(event),`,
		`sendClick: (event) => getTerminalMouse()?.sendClick(session, event) === true,`,
		`moveThresholdPx: desktopSelectionMoveThresholdPx,`,
		`tuiAdapterInstaller?.installClaudeDesktopSelection?.(session);`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime Claude fullscreen desktop selection isolation missing %q", want)
		}
	}

	installContextMenu := strings.Index(sessionInstallationSource, `tuiAdapterInstaller?.installClaudeContextMenu?.(session);`)
	installDesktopSelection := strings.Index(sessionInstallationSource, `tuiAdapterInstaller?.installClaudeDesktopSelection?.(session);`)
	installMouseTracking := strings.Index(sessionInstallationSource, `mouse?.installSession?.(session);`)
	installDesktopClipboard := strings.Index(sessionInstallationSource, `const clipboardCleanup = clipboard?.bindDesktopSession?.(session);`)
	if installContextMenu < 0 || installDesktopSelection < 0 || installMouseTracking < 0 || installDesktopClipboard < 0 {
		t.Fatal("runtime Claude desktop selection installation order is incomplete")
	}
	if !(installContextMenu < installDesktopSelection && installDesktopSelection < installMouseTracking && installMouseTracking < installDesktopClipboard) {
		t.Fatal("Claude desktop selection ownership must precede generic mouse tracking and desktop clipboard handling")
	}

	mouseData, err := readRuntimeSource("runtime/static/terminal/mouse/mouse_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(mouse_controller.js) error = %v", err)
	}
	genericMouseTracking := string(mouseData)
	if strings.Contains(strings.ToLower(genericMouseTracking), "claude") {
		t.Fatal("generic terminal mouse tracking must not contain Claude-specific desktop selection branches")
	}
	if strings.Count(genericMouseTracking, `claimedEvents.has(event)`) < 4 {
		t.Fatal("generic terminal mouse tracking must honor local ownership for down, move, up, and click-like events")
	}
}

func TestRuntimeTerminalSizeClaimSurvivesCrossClientResize(t *testing.T) {
	mainSource := readRuntimeSources(t, "runtime/static/global-runtime.js")
	appLifecycleSource := readRuntimeSources(t, "runtime/static/app/app_lifecycle.js")
	protocolSource := readRuntimeProtocolSource(t)
	resizeSource := readRuntimeResizeSource(t)
	imeSource := readRuntimeIMESource(t)
	installationSource := readRuntimeSources(t, "runtime/static/terminal/tui_adapters/installation_controller.js")
	recoverySource := readRuntimeSources(t, "runtime/static/app/runtime_recovery_controller.js")
	runtimeSource := strings.Join([]string{mainSource, recoverySource, protocolSource, resizeSource, imeSource, appLifecycleSource, installationSource}, "\n")

	for _, want := range []string{
		`from "./terminal/resize/index.js";`,
		`const sendSize = (session, { force = false, dimensions = null, claim = false } = {}) => {`,
		`shouldSendTerminalSize({`,
		`const claimSize = (session, { force = false } = {}) => {`,
		`const claimForCurrentDevice = (session, options = {}) => {`,
		`const claimSizeForTransaction = shouldClaimSize`,
		`session.sizeClaimRequired === true`,
		`recordEvent(session, "resize_wait_current_device_claim"`,
		`reason: "remote_owner_observed"`,
		`forceSizeSync: true,`,
		`settlePresentation: true,`,
		`sendSize(session, { force: true, claim: true });`,
		`session.serverCols = Math.max(0, Math.floor(Number(paneState?.cols) || 0));`,
		`session.serverRows = Math.max(0, Math.floor(Number(paneState?.rows) || 0));`,
		`session.serverPixelWidth = Math.max(0, Math.floor(Number(paneState?.pixel_width) || 0));`,
		`session.serverPixelHeight = Math.max(0, Math.floor(Number(paneState?.pixel_height) || 0));`,
		`session.sizeClaimRequired = terminalSizeDiffersFromServer({`,
		`terminalResize.resizePane(session, { forceSizeSync: true });`,
		`if (typeof resize?.claimForCurrentDevice === "function")`,
		`return resize?.claimSize?.(session, { force: true });`,
		`const claimCurrentDeviceTerminalSize = (event) => {`,
		`claimCurrentDeviceSize: (session) => terminalResize?.claimForCurrentDevice(session),`,
		`claimCurrentDeviceSize(session);`,
		`lifecycle.listen(session, shell, "pointerdown", claimCurrentDeviceTerminalSize, { capture: true, passive: true });`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime cross-client terminal size claim missing %q", want)
		}
	}
	claimBlock := sourceBetween(t, resizeSource,
		`const claimForCurrentDevice = (session, options = {}) => {`,
		`const resizeTabForCurrentDevice = (tab, options = {}) => {`)
	if strings.Contains(claimBlock, `presentation()?.beginHold(session)`) {
		t.Fatal("a size claim without a geometry change must not freeze terminal rendering")
	}

	startMobileTap := sourceBetween(
		t,
		imeSource,
		`    const startMobileTap = (event) => {`,
		`    const moveMobileTap = (event) => {`,
	)
	claimIndex := strings.Index(startMobileTap, `claimCurrentDeviceSize(session);`)
	blurIndex := strings.Index(startMobileTap, `blurInput(session);`)
	if claimIndex < 0 || blurIndex < 0 || claimIndex > blurIndex {
		t.Fatal("mobile touchstart must fit and reclaim terminal size before keyboard and touch consumers")
	}

	for _, boundary := range [][2]string{
		{`const handleVisibilityChange = ({ hidden = false } = {}) => {`, `const handleFocus = () => {`},
		{`const handleFocus = () => {`, `const handlePageShow = () => {`},
		{`const handlePageShow = () => {`, `return Object.freeze({`},
	} {
		body := sourceBetween(t, recoverySource, boundary[0], boundary[1])
		if !strings.Contains(body, `claimActiveTabSize({ forceFullRender: true`) {
			t.Fatalf("runtime lifecycle size claim missing after %q", boundary[0])
		}
	}
}

func TestRuntimeGrokMouseTrackingPreservesMobileDoubleTapKeyboard(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}
	mainSource := read("runtime/static/global-runtime.js")
	policySource := read("runtime/static/terminal/policy/policy_controller.js")
	controllerSource := read("runtime/static/terminal/mouse/mouse_controller.js")

	detectionStart := strings.Index(policySource, "export const grokExecutableNamePattern =")
	detectionEnd := strings.Index(policySource, "export const terminalLocationDescription =")
	if detectionStart < 0 || detectionEnd <= detectionStart {
		t.Fatal("runtime Grok terminal detection guard is missing")
	}
	detection := policySource[detectionStart:detectionEnd]
	for _, want := range []string{
		`export const grokExecutableNamePattern = /^grok(?:-\d+(?:\.\d+){1,3})?$/i;`,
		`export const isGrokTerminalSession = (session) => {`,
		`isGrokExecutableToken(session?.command)`,
		`isOfficialGrokEntrypoint(commandTokens[0])`,
		`["node", "nodejs", "bun", "deno"].includes(launcher)`,
		`String(session?.title || "").trim().toLowerCase() === "grok"`,
	} {
		if !strings.Contains(detection, want) {
			t.Fatalf("runtime Grok terminal detection missing %q", want)
		}
	}
	if strings.Contains(detection, `.includes("grok")`) {
		t.Fatal("runtime Grok terminal detection must not use a broad substring match")
	}

	focusStart := strings.Index(controllerSource, "const finishDeferredTouchKeyboardTap =")
	if focusStart < 0 {
		t.Fatal("terminal mouse deferred touch keyboard focus guard is missing")
	}
	focusEnd := strings.Index(controllerSource[focusStart:], "const handleMouseDown =")
	if focusEnd < 0 {
		t.Fatal("terminal mouse deferred touch keyboard focus guard has no bounded end")
	}
	focusBranch := controllerSource[focusStart : focusStart+focusEnd]
	for _, want := range []string{
		`event.type === "touchend"`,
		`Math.abs(touch.clientX - touchKeyboardState.startX) < moveThresholdPx`,
		`Math.abs(touch.clientY - touchKeyboardState.startY) < moveThresholdPx`,
		`currentTime - touchKeyboardState.startedAt <= doubleTapDelayMs`,
		`currentTime - previousTapAt <= doubleTapDelayMs`,
		`Math.hypot(dx, dy) < moveThresholdPx * 2`,
		`isDeferredTouchClickSession(session)`,
		`trackingState(session)`,
		`sendMouseSequence(mouseEvent, "press", 0);`,
		`sendMouseSequence(mouseEvent, "release", 0);`,
		`resetTouchKeyboardState(true);`,
		`setTouchKeyboardFocusAllowance(session, currentTime + focusAllowWindowMs);`,
		`requestTouchKeyboard(session);`,
	} {
		if !strings.Contains(focusBranch, want) {
			t.Fatalf("terminal mouse deferred touch keyboard focus missing %q", want)
		}
	}
	if strings.Contains(focusBranch, "requestAnimationFrame") {
		t.Fatal("terminal mouse deferred touch keyboard focus must stay synchronous with touchend")
	}
	for _, want := range []string{
		`touchMouseState.deferredClick = requiresTouchKeyboardDoubleTap() && isDeferredTouchClickSession(session);`,
		`if (touchMouseState.deferredClick) {`,
		`setTouchKeyboardFocusAllowance(session, 0);`,
		`blurInput(session);`,
		`const flushDeferredTouchWheel = (event, touch) => {`,
		`touchKeyboardState.wheelRemainderY += previousY - touch.clientY;`,
		`sendMouseSequence(wheelEvent, "wheel");`,
		`flushDeferredTouchWheel(event, touch);`,
		`finishDeferredTouchKeyboardTap(event, touch);`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal mouse deferred touch compatibility missing %q", want)
		}
	}
	for _, want := range []string{
		`terminalPolicy = createTerminalPolicyController({`,
		`claudeTouchCandidate: isClaudeFullscreenTouchCandidate,`,
		`isDeferredTouchClickSession: (session) => isGrokTerminalSession(session),`,
		`requestTouchKeyboard: (session) => terminalIME?.focusInput(session, {`,
		`requestMobileKeyboard: true,`,
		`forceMobileFocusTransition: true,`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime Grok mouse policy wiring missing %q", want)
		}
	}
}

func TestRuntimeTerminalInputChunksLargePaste(t *testing.T) {
	clipboardData, err := readRuntimeSource("runtime/static/terminal/interaction/clipboard_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(clipboard_controller.js) error = %v", err)
	}
	source := readRuntimeMainWithSessionState(t) + "\n" + readRuntimeInputSource(t) + "\n" + readRuntimeIMESource(t) + "\n" + string(clipboardData)

	wantSnippets := []string{
		"chunkChars = 16 * 1024,",
		"pumpChunkBudget = 4,",
		"backpressureBytes = 512 * 1024,",
		"maxBufferedBytes = 64 * 1024,",
		"maxQueuedBytes = 16 * 1024 * 1024,",
		"export function splitTerminalInputChunks(data, chunkChars = 16 * 1024) {",
		"export function buildTerminalInputQueueItems(data, {",
		"const sendInputChunk = (session, data, { generated = false } = {}) => {",
		"const enqueueSessionInput = (session, data, { generated = false, front = false } = {}) => {",
		"pumpQueuedInput = (session) => {",
		"getBufferedAmount(session) > backpressureBytes",
		"sendInputChunk(session, item.data, { generated: item.generated })",
		"enqueueSessionInput(session, data);",
		"if (session.inputBuffer) {",
		"scheduleQueuedInputPump(session);",
		"scheduleQueuedInputPump(session, backpressureDelayMs);",
		"sendInput(session, bracketed ? `\\x1b[200~${value}\\x1b[201~` : value);",
		`lifecycle.listen(session, textarea, "paste", (event) => {`,
		"event.stopImmediatePropagation();",
		"inputQueue: [],",
		"inputPumpTimer: 0,",
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime terminal large paste guard missing %q", want)
		}
	}
	if strings.Contains(source, "session.term.paste(value);") {
		t.Fatal("runtime paste path should not send large clipboard content through terminal paste directly")
	}
}

func TestRuntimeTerminalConfirmedIMEDeleteUsesNativeMutation(t *testing.T) {
	source := readRuntimeIMESource(t)
	deleteBranchStart := strings.Index(source, "if (\n      isBackwardDeleteInputType(type)")
	compositionBranchStart := strings.Index(source, `if (type === "insertCompositionText" || type === "deleteCompositionText" || event.isComposing) {`)
	if deleteBranchStart < 0 || compositionBranchStart < 0 || deleteBranchStart >= compositionBranchStart {
		t.Fatal("confirmed IME native-delete branch must run before the generic composition branch")
	}
	deleteBranch := sourceBetween(t, source,
		"if (\n      isBackwardDeleteInputType(type)",
		`if (session?.nativeDeleteInputPending) {`,
	)
	for _, want := range []string{
		`clearPostCompositionInput(session);`,
		`export const terminalInputDeleteBufferLength = 256;`,
		`export const terminalInputDeleteBuffer = terminalInputSentinel.repeat(terminalInputDeleteBufferLength);`,
		`nativeDeleteIdleResetMs = 900,`,
		`armNativeDeleteInput(session);`,
		`sendTextInput(session, "\x7f");`,
		`event.stopImmediatePropagation();`,
		`const interceptTextareaBeforeInput = (event) => {`,
		`handleBeforeInput(session, event);`,
		`lifecycle.listen(session, host, "beforeinput", interceptTextareaBeforeInput, { capture: true });`,
		`pending.suppressSeparator && rawValue === " "`,
		`suppressSeparator: isTerminalASCIICompositionCommit(committedText),`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime confirmed IME delete guard missing %q", want)
		}
	}
	if strings.Contains(deleteBranch, "event.preventDefault()") {
		t.Fatal("confirmed IME backspace must allow native textarea deletion")
	}
	if strings.Contains(deleteBranch, "textarea.value =") {
		t.Fatal("confirmed IME backspace must not rewrite the textarea during auto-repeat")
	}
}

func TestRuntimeBeforeInputPasteUsesPastePath(t *testing.T) {
	source := readRuntimeIMESource(t)
	branch := sourceBetween(t, source,
		`} else if (type === "insertFromPaste") {`,
		`    } else if (event.data) {`,
	)
	for _, want := range []string{
		`const text = event.dataTransfer?.getData("text/plain") || event.data || "";`,
		`event.preventDefault();`,
		`Promise.resolve(pasteText(session, text)).catch((error) => showToast(error.message));`,
		`return;`,
	} {
		if !strings.Contains(branch, want) {
			t.Fatalf("runtime beforeinput paste branch missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`data = event.dataTransfer?.getData("text/plain") || event.data || "";`,
		`sendTextInput(session, text`,
	} {
		if strings.Contains(branch, forbidden) {
			t.Fatalf("runtime beforeinput paste branch must not contain %q", forbidden)
		}
	}
}

func TestRuntimeUserInputHoldsCursorVisible(t *testing.T) {
	mainSource := readRuntimeMainWithSessionState(t)
	configSource := readRuntimeTerminalConfig(t)
	inputSource := readRuntimeInputSource(t)
	appearanceRuntimeSource := readRuntimeSources(t, "runtime/static/appearance/runtime_controller.js")
	source := mainSource + "\n" + configSource + "\n" + inputSource + "\n" + appearanceRuntimeSource
	lifecycleData, err := readRuntimeSource("runtime/static/terminal/session/session_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/session/session_lifecycle.js) error = %v", err)
	}
	source += "\n" + string(lifecycleData)

	for _, want := range []string{
		`terminalCursorBlinkHoldMs: 700,`,
		`const holdCursorVisible = (session) => {`,
		`windowObject?.clearTimeout?.(session.cursorBlinkHoldTimer);`,
		`renderer.cursorVisible = true;`,
		`term.options.cursorBlink = false;`,
		`if (isRenderAllowed(session)) {`,
		`term.requestRender?.();`,
		`syncCursorBlinkState();`,
		`}, cursorBlinkHoldMs) || 0;`,
		`cursorBlinkHoldTimer: 0,`,
		`holdCursorVisible,`,
		`clearTimeoutField(session, "cursorBlinkHoldTimer");`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime cursor blink hold guard missing %q", want)
		}
	}

	inputBranch := sourceBetween(t, inputSource,
		`const handleData = (session, data) => {`,
		`  const setSessionLocked = (session, blocked) => {`,
	)
	if !strings.Contains(inputBranch, `holdCursorVisible(session);`) ||
		!strings.Contains(inputBranch, `return sendOrQueue(session, data`) {
		t.Fatal("runtime user input branch should hold cursor visible before sending input")
	}
}

func TestRuntimeGeneratedTerminalResponsesAreMarked(t *testing.T) {
	source := readRuntimeSources(t,
		"runtime/static/global-runtime.js",
		"runtime/static/terminal/transport/session_protocol_controller.js",
		"runtime/static/terminal/input/input_controller.js",
		"runtime/static/terminal/input/input_model.js",
		"runtime/static/terminal/session/session_installation_controller.js",
	)

	wantSnippets := []string{
		"const generatedTerminalResponseTailPattern =",
		`[\d{1,4};\d{1,4}R|\[\d{1,4}R`,
		`|\dR)+$/`,
		"export function isGeneratedTerminalResponseTail(data) {",
		"generatedTerminalResponseTailPattern.test(data)",
		"const armGeneratedSuppression = (session, durationMs = 1000) => {",
		"armAllGeneratedSuppression(durationMs = 1000) {",
		"const responseTail = generatedResponseTail(data);",
		"return response || responseTail;",
		"if (!generated && shouldSuppressGenerated(session, data)) {",
		"if (shouldSuppressGenerated(session, data)) {",
		"session.processingGeneratedTerminalResponses = true;",
		"session.processingGeneratedTerminalResponses = false;",
		"const payload = { type: \"input\", data, ...getThemePayload() };",
		"payload.generated = true;",
		"payload.cols = cols;",
		"payload.rows = rows;",
		"payload.pixel_width = pixelWidth;",
		"payload.pixel_height = pixelHeight;",
		"if (isKittyGraphicsResponse(data)) {",
		"sendPayload(session, payload)",
		"socketUrl.searchParams.set(\"fg\", themePayload.foreground);",
		"socketUrl.searchParams.set(\"bg\", themePayload.background);",
		"socketUrl.searchParams.set(\"cursor\", themePayload.cursor);",
		"sendTerminalTheme(session);",
		"input?.installSession?.(session);",
		"const response = generatedResponse(data);",
		"if (response || responseTail) {",
		"return send(session, data, { immediate: true, generated: true });",
		"if (session.processingGeneratedTerminalResponses || response) {",
		"if (responseTail) {",
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime generated terminal response guard missing %q", want)
		}
	}
}

func TestRuntimeTabResizeDoesNotTemporarilyActivateAllTabs(t *testing.T) {
	mainSource := readRuntimeSources(t, "runtime/static/global-runtime.js")
	tabActivationSource := readRuntimeSources(t, "runtime/static/workspace/tab_activation_controller.js")
	paneActivationSource := readRuntimeSources(t, "runtime/static/workspace/pane_activation_controller.js")
	workspaceAPISource := readRuntimeSources(t, "runtime/static/workspace/workspace_api.js")
	workspacePersistenceSource := readRuntimeSources(t, "runtime/static/workspace/persistence_controller.js")
	protocolSource := readRuntimeProtocolSource(t)
	resizeSource := readRuntimeResizeSource(t)
	viewportSource := readRuntimeViewportSource(t)
	transportRuntimeSource := readRuntimeSources(t, "runtime/static/terminal/transport/transport_runtime_controller.js")
	runtimeSource := mainSource + "\n" + tabActivationSource + "\n" + paneActivationSource + "\n" + workspaceAPISource + "\n" + workspacePersistenceSource + "\n" + protocolSource + "\n" + transportRuntimeSource + "\n" + resizeSource + "\n" + viewportSource

	wantSnippets := []string{
		"const resizeTabForCurrentDevice = (tab, options = {}) => {",
		"const resizeActiveTabForCurrentDevice = (options = {}) => resizeTabForCurrentDevice(getCurrentTab(), options);",
		"syncTabMobilePixelScroll(tab);",
		"const claimActiveTabForCurrentDevice = (options = {}) => (",
		"claimActiveTabForCurrentDevice: (options) => terminalResize?.claimActiveTabForCurrentDevice(options),",
		"const isVisible = (session) => session?.tabId === getActiveTabId() && isMeasurable(session);",
		"const resizePane = (session, {",
		"visibleOnly = true,",
		"forceSizeSync = false,",
		"export const failedTerminalFit = (measurable = false) => ({",
		"ok: false,",
		"session.fitAddon?.proposeDimensions?.();",
		"const capturedViewport = viewport.capture(session.term);",
		"const canvasNeedsResize = !canvasMatchesExpectedSize(session, fittedDimensions);",
		"const claimSizeForTransaction = shouldClaimSize",
		"recordEvent(session, \"resize_wait_current_device_claim\"",
		"reason: \"remote_owner_observed\"",
		"if (dimensionsWillChange) {",
		"session.term.resize(fittedDimensions.cols, fittedDimensions.rows);",
		"viewport.restore(session.term, capturedViewport);",
		"session.measuredFitGeneration = Number(session.measuredFitGeneration || 0) + 1;",
		"session.activationFitPending = false;",
		"ok: true,",
		"lifecycle.observeHost(session, () => {",
		"const observer = new ResizeObserverCtor((...args) => {",
		"observer.observe(session.terminalHost);",
		"schedulePane(session, {",
		"const scheduleTab = (tab, options = {}, scheduleOptions = {}) => {",
		"const scheduler = createTerminalResizeScheduler({",
		"if (allowHidden && Number(session.measuredFitGeneration || 0) > 0) {",
		"|| !sessionHasKnownSize(session)",
		"const scheduleVisibleTab = (tab, { immediate = false } = {}) => {",
		"return scheduleTab(tab, options, { immediate: true });",
		"return lifecycle.scheduleTabFrame(tab, () => {",
		"const scheduleActiveTabWindowResize = () => scheduleTab(getCurrentTab(), {",
		"const shouldResizeTerminal = supportsViewportInsets && isTouchShortcutLayout();",
		"if (shouldResizeTerminal && (heightChanged || insetChanged || safeOffsetChanged)) {",
	}
	for _, want := range wantSnippets {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("runtime tab resize guard missing %q", want)
		}
	}
	if strings.Contains(runtimeSource, "activeTabResizeTimer") {
		t.Fatal("window resize must not maintain a second terminal settle timer")
	}

	resizeBlock := sourceBetween(t, resizeSource,
		"const resizePane = (session, {",
		"lifecycle = lifecycleFactory({")
	visibilityIndex := strings.Index(resizeBlock, "if (visibleOnly && !isVisible(session))")
	resetIndex := strings.Index(resizeBlock, "resetHostViewport(session, { clean: true });")
	if visibilityIndex < 0 || resetIndex < 0 || visibilityIndex > resetIndex {
		t.Fatalf("runtime hidden pane resize guard is not before terminal viewport reset")
	}

	activeTabBlock := sourceBetween(t, tabActivationSource,
		"const activate = (tabId, {",
		"const clear = () => {")
	for _, want := range []string{
		`from "./workspace/index.js";`,
		`createWorkspaceTabActivationController`,
		`measureTask("tab switch visual"`,
		"tabView.setActiveTabVisuals([previousTab, tab], tab.id);",
		"scheduler.schedule(tab.id, [",
		`measureTask("tab activation state"`,
		`measureTask("tab activation resize"`,
		`scheduleVisibleTabResize(tab, { immediate: false });`,
		`measureTask("tab activation membership"`,
		"getInstanceGeneration() === instanceGeneration",
		"tabRegistry.getActiveTabId() === tab.id",
		"getActiveTabId() !== tab.id",
		"tab.activePaneId !== activePane?.id",
		"const persistActiveWorkspaceTab = (tabId) => {",
		"const activeTabPersistenceChains = new Map();",
		"normalizeText(getActiveTabId()) !== targetTabId",
		"applyResponse: false",
		"if (applyResponse) {",
		"workspaceTabActivation?.dispose();",
	} {
		if !strings.Contains(runtimeSource, want) && !strings.Contains(activeTabBlock, want) {
			t.Fatalf("runtime asynchronous tab activation guard missing %q", want)
		}
	}
	if strings.Contains(activeTabBlock, "scheduleVisibleTabResize(tab, { immediate: true });") {
		t.Fatal("tab activation must not synchronously resize terminal panes before the visual selection frame")
	}

	forbiddenSnippets := []string{
		"const resizeAllTabsForCurrentDevice = () => {",
		"paneEl.classList.add(\"active\");",
		"classList.toggle(\"active\", tab.id === visibleTabId)",
		"visibleTabId = activeTabId",
		"needsVisibleResize",
	}
	for _, forbidden := range forbiddenSnippets {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("runtime tab resize regression detected: found %q", forbidden)
		}
	}
}

func TestRuntimeMobileOrientationKeepsTerminalStateAfterViewportSettle(t *testing.T) {
	source := readRuntimeSources(t,
		"runtime/static/global-runtime.js",
		"runtime/static/terminal/viewport/viewport_controller.js",
		"runtime/static/terminal/viewport/viewport_lifecycle.js",
	)

	wantSnippets := []string{
		"viewportGeometryFinalSettleMs = 180,",
		"viewportGeometryStableFrameCount = 2,",
		"const currentMobileViewportOrientation = () => readMobileViewportOrientation({",
		"const rememberMobileViewportOrientationChange = () => {",
		"const scheduleViewportGeometryClaim = (reason, { force = false } = {}) => {",
		"const scheduleViewportGeometryValidation = (generation) => {",
		"const isGeometryClaimPending = () => {",
		"terminalViewportGeometryRequiresClaim(previous, current, {",
		"claimActiveTabForCurrentDevice({",
		"pendingViewportGeometry = measureTerminalViewportGeometry({ windowObject, documentObject });",
		`listen(windowObject, "orientationchange", handlers.onOrientationChange || noop);`,
		`listen(windowObject?.screen?.orientation, "change", handlers.onOrientationChange || noop);`,
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime mobile orientation state-preservation guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"replayActiveTabFromServerAfterViewportChange",
		"mobileOrientationHistoryReplayDelayMs",
		"socket.close(4000, \"viewport changed\")",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("orientation recovery must not trigger history replay, found %q", forbidden)
		}
	}
}

func TestRuntimeTabOverviewRerendersAndFallsBackToWorkspaceTabs(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/terminal/overview/overview_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/overview/overview_controller.js) error = %v", err)
	}
	navigationData, err := readRuntimeSource("runtime/static/workspace/tab_navigation_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/workspace/tab_navigation_controller.js) error = %v", err)
	}
	source := string(data) + "\n" + string(controllerData) + "\n" + string(navigationData)

	wantSnippets := []string{
		"const getOrderedTabs = () => {",
		"const orderedIDs = new Set(ordered.map((tab) => tab.id));",
		"for (const tab of tabs?.values?.() || []) {",
		"if (!orderedIDs.has(tab.id)) {",
		"scheduleRender: scheduleTabOverviewRender,",
		"renderTabOverview();",
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime tab overview guard missing %q", want)
		}
	}

	openTabOverviewIndex := strings.Index(source, "const openTabOverview = () => {")
	if openTabOverviewIndex < 0 {
		t.Fatal("openTabOverview definition not found")
	}
	renderIndex := strings.Index(source[openTabOverviewIndex:], "renderTabOverview();")
	scheduleIndex := strings.Index(source[openTabOverviewIndex:], "scheduleTabOverviewRender();")
	if renderIndex < 0 || scheduleIndex < 0 || renderIndex > scheduleIndex {
		t.Fatalf("openTabOverview should schedule a follow-up overview render after the initial render")
	}

	clickBranch := sourceBetween(t, source,
		`const handleTabOverviewClick = (event) => {`,
		`const currentHistoryStateObject = () => {`,
	)
	for _, want := range []string{
		`const cardButton = view.closestCardButton?.(target);`,
		`selectTabFromOverview(cardButton.dataset?.tabId);`,
		`const card = view.closestCard?.(target);`,
		`selectTabFromOverview(card.dataset?.tabId);`,
	} {
		if !strings.Contains(clickBranch, want) {
			t.Fatalf("runtime tab overview click guard missing %q", want)
		}
	}
}

func TestRuntimeMobileDeployRestartUsesBottomSheet(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	mainSource := string(mainData) + "\n" + readRuntimeBootstrapSource(t)
	indexSource := string(indexData)
	styleSource := string(styleData)
	dialogData, err := readRuntimeSource("runtime/static/app/dialog_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/app/dialog_controller.js) error = %v", err)
	}
	dialogSource := string(dialogData)
	revisionData, err := readRuntimeSource("runtime/static/app/server_revision/server_revision_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(server_revision_controller.js) error = %v", err)
	}
	revisionSource := string(revisionData)

	wantMainSnippets := []string{
		`mobileCloseConfirmActions,`,
		`const requestBootstrapWorkspace = () => {`,
		`clearStartupInputLock: () => serverRevision.clearStartupInputLock(),`,
		`ghosttyInitPromise,`,
		`applyWorkspace: (result, options) => applyWorkspaceRefresh(result, options),`,
	}
	for _, want := range wantMainSnippets {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime mobile deploy restart guard missing %q", want)
		}
	}
	for _, want := range []string{
		`input?.armAllGeneratedSuppression?.(2000);`,
		`const restart = isMobileLayout()`,
		`? await confirmMobileSheet({ ...options, actionsLayout: "vertical-ok-first" })`,
		`: await openDialog(options);`,
		`input?.discardAll?.();`,
		`async clearStartupInputLock() {`,
	} {
		if !strings.Contains(revisionSource, want) {
			t.Fatalf("server revision mobile deploy guard missing %q", want)
		}
	}
	for _, want := range []string{
		`const confirmMobileSheet = (`,
		`mobileSheet.actions.dataset.layout = actionsLayout === "vertical-ok-first"`,
		`closeMobileActionSheet();`,
		`const confirmCloseRunningCommand = (message, options = {}) => {`,
		`actionsLayout: "vertical-ok-first",`,
	} {
		if !strings.Contains(dialogSource, want) {
			t.Fatalf("runtime mobile dialog guard missing %q", want)
		}
	}
	if strings.Contains(mainSource, `ensureInitialInteractiveTab`) {
		t.Fatal("startup must not create a disposable terminal before authoritative workspace identity arrives")
	}
	if strings.Contains(revisionSource, `getTerminalInput()?.setAllLocked?.(false);
		dialogOpen = false;
		suppressBeforeUnloadForNavigation();`) {
		t.Fatal("restart reload path should keep local input blocked until navigation")
	}
	if strings.Contains(revisionSource, `await setInputBlocked(false).catch(() => {});
		getTerminalInput()?.setAllLocked?.(false);
		input?.discardAll?.();
		suppressBeforeUnloadForNavigation();
		windowObject.location.reload();`) {
		t.Fatal("restart reload path should keep server input blocked until websocket disconnect")
	}
	if !strings.Contains(indexSource, `class="mobile-close-confirm-actions" id="mobileCloseConfirmActions"`) {
		t.Fatal("mobile close confirm actions container should have a stable id")
	}
	for _, want := range []string{
		`.mobile-close-confirm-actions[data-layout="vertical-ok-first"]`,
		`.mobile-close-confirm-actions[data-layout="vertical-ok-first"] .mobile-close-confirm-ok`,
		`order: -1;`,
	} {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime mobile deploy restart CSS guard missing %q", want)
		}
	}
}

func TestRuntimeMobileRunningCommandConfirmUsesVerticalButtons(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/app/dialog_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/app/dialog_controller.js) error = %v", err)
	}
	source := string(data)
	start := strings.Index(source, "const confirmCloseRunningCommand = (message, options = {}) => {")
	if start < 0 {
		t.Fatal("confirmCloseRunningCommand definition not found")
	}
	end := strings.Index(source[start:], "return confirmDialog(message, options);")
	if end < 0 {
		t.Fatal("confirmCloseRunningCommand desktop fallback not found")
	}
	block := source[start : start+end]
	for _, want := range []string{
		`title: "检测到后台进程",`,
		`actionsLayout: "vertical-ok-first",`,
	} {
		if !strings.Contains(block, want) {
			t.Fatalf("mobile running command confirm guard missing %q", want)
		}
	}
}

func TestRuntimeMobileEdgeSwipeOpensTabOverview(t *testing.T) {
	data, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	controllerData, err := readRuntimeSource("runtime/static/instances/instances_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/instances/instances_controller.js) error = %v", err)
	}
	lifecycleData, err := readRuntimeSource("runtime/static/instances/instances_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/instances/instances_lifecycle.js) error = %v", err)
	}
	overviewControllerData, err := readRuntimeSource("runtime/static/terminal/overview/overview_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/overview/overview_controller.js) error = %v", err)
	}
	overviewLifecycleData, err := readRuntimeSource("runtime/static/terminal/overview/overview_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/overview/overview_lifecycle.js) error = %v", err)
	}
	source := strings.Join([]string{
		string(data),
		string(controllerData),
		string(lifecycleData),
		string(overviewControllerData),
		string(overviewLifecycleData),
	}, "\n")
	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	styleSource := string(styleData)

	wantSnippets := []string{
		"let mobileOverviewEdgeSwipe = null;",
		"const mobileOverviewSwipeEdgeWidth = 24;",
		"const mobileOverviewSwipeAxisThreshold = 12;",
		"const mobileOverviewSwipeNativeBackBlockDistance = 4;",
		"const mobileOverviewSwipeOpenDistance = 56;",
		"const mobileOverviewSwipeMaxVerticalTravel = 40;",
		`const mobileOverviewHistoryGuardStateKey = "webshellMobileOverviewGuard";`,
		"const ensureMobileOverviewHistoryGuard = () => {",
		"windowObject?.history?.pushState?.(withMobileOverviewHistoryGuard(state), \"\", windowObject?.location?.href);",
		"const refreshMobileOverviewHistoryGuardForUserGesture = () => {",
		"windowObject?.history?.replaceState?.(withMobileOverviewHistoryGuard(state), \"\", windowObject?.location?.href);",
		"const openTabOverviewFromHistoryBack = () => {",
		"consumePopState: () => terminalOverview?.consumeHistoryBack() === true,",
		"if (disposed || consumePopState?.() === true) {",
		`listen(windowObject, "popstate", handlers.onPopState);`,
		"const hasBlockingOverviewGestureOverlayOpen = () => Boolean(",
		"const handleMobileOverviewEdgeSwipeStart = (event) => {",
		"refreshMobileOverviewHistoryGuardForUserGesture();",
		`edge = "left";`,
		`edge = "right";`,
		`const directedDeltaX = mobileOverviewEdgeSwipe.edge === "left" ? deltaX : -deltaX;`,
		"directedDeltaX >= mobileOverviewSwipeNativeBackBlockDistance && absX > absY",
		"openTabOverview();",
		`listen(documentObject, "touchstart", handlers.onEdgeSwipeStart, { capture: true, passive: true });`,
		`listen(documentObject, "touchmove", handlers.onEdgeSwipeMove, { capture: true, passive: false });`,
	}
	for _, want := range wantSnippets {
		if !strings.Contains(source, want) {
			t.Fatalf("runtime mobile overview edge swipe guard missing %q", want)
		}
	}
	if !strings.Contains(styleSource, "overscroll-behavior-x: none;") {
		t.Fatal("runtime mobile overview edge swipe should disable native horizontal overscroll navigation")
	}
}

func TestRuntimeMobileOverviewDragAndSelectionToolbar(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	overviewControllerData, err := readRuntimeSource("runtime/static/terminal/overview/overview_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/overview/overview_controller.js) error = %v", err)
	}
	overviewLifecycleData, err := readRuntimeSource("runtime/static/terminal/overview/overview_lifecycle.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/overview/overview_lifecycle.js) error = %v", err)
	}
	searchControllerData, err := readRuntimeSource("runtime/static/terminal/interaction/search_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/interaction/search_controller.js) error = %v", err)
	}
	selectionViewData, err := readRuntimeSource("runtime/static/terminal/selection/selection_view.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/selection/selection_view.js) error = %v", err)
	}
	mobileSelectData, err := readRuntimeSource("runtime/static/app/mobile_select_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/app/mobile_select_controller.js) error = %v", err)
	}
	commandData, err := readRuntimeSource("runtime/static/app/commands/command_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/app/commands/command_controller.js) error = %v", err)
	}
	mainSource := strings.Join([]string{string(mainData), string(commandData), string(overviewControllerData), string(overviewLifecycleData), string(searchControllerData), string(selectionViewData), string(mobileSelectData)}, "\n")
	styleData, err := readRuntimeSource("runtime/static/style.css")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/style.css) error = %v", err)
	}
	styleSource := string(styleData)
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}
	indexSource := string(indexData)

	for _, want := range []string{
		"let tabOverviewDragState = null;",
		"const tabOverviewDragHoldDelayMs = 320;",
		"const animateTabOverviewReorder = (beforeRects) => {",
		"const updateTabOverviewDragAutoScroll = (state) => {",
		`if (state.pointerType !== "mouse" && !state.dragReady) {`,
		"finishTabOverviewDrag({ cancel: true });",
		`"touchmove",`,
		`handleTabOverviewDragTouchMove,`,
		"const moveTabToOverviewIndex = async",
		`moveTab: (tabId, position) => moveTab(tabId, position),`,
		`onCardPointerDown: handleTabOverviewCardPointerDown,`,
		`listen(elements.root, "pointerdown", handlers.onCardPointerDown);`,
		`case "new_tab":`,
		`case "close_tab":`,
		`case "rename_tab":`,
		`case "next_tab":`,
		`case "previous_tab":`,
		`case "vertical_split":`,
		`case "horizontal_split":`,
		`case "tab_overview":`,
		`case "search_terminal":`,
		`case "attachment":`,
		"openFromSelection(session = getActiveSession()) {",
		"positionSheet(session) {",
		"const open = (select) => {",
		`select.addEventListener("touchstart", openFromEvent, { capture: true, passive: false });`,
		`select.addEventListener("pointerdown", openFromEvent, { capture: true, passive: false });`,
		`event.preventDefault();`,
		`event.stopPropagation?.();`,
	} {
		if !strings.Contains(mainSource, want) {
			t.Fatalf("runtime mobile overview/selection guard missing %q", want)
		}
	}
	for _, want := range []string{
		`data-selection-action="copy">复制`,
		`data-selection-action="paste">粘贴`,
		`data-selection-action="search">搜索`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("runtime mobile selection toolbar markup missing %q", want)
		}
	}
	for _, want := range []string{
		".tab-overview-card-placeholder",
		"body.is-tab-overview-dragging",
		".tab-overview-card.is-reordering",
		"touch-action: pan-y;",
		"touch-action: none;",
		".selection-sheet button:not(:last-child)::after",
		"background: rgba(24, 24, 24, 0.96);",
		".mobile-custom-select-popover",
		".mobile-custom-select-option.is-selected",
		"appearance: none;",
	} {
		if !strings.Contains(styleSource, want) {
			t.Fatalf("runtime mobile overview/selection CSS guard missing %q", want)
		}
	}
}

func TestRuntimeTerminalLongScreenshotContract(t *testing.T) {
	mainData, err := readRuntimeSource("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	moduleData, err := readRuntimeSource("runtime/static/terminal/screenshot/terminal_long_screenshot.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/screenshot/terminal_long_screenshot.js) error = %v", err)
	}
	interactionData, err := readRuntimeSource("runtime/static/terminal/interaction/context_menu_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/interaction/context_menu_controller.js) error = %v", err)
	}
	shortcutData, err := readRuntimeSource("runtime/static/terminal/input/mobile_shortcuts/mobile_shortcuts_controller.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/terminal/input/mobile_shortcuts/mobile_shortcuts_controller.js) error = %v", err)
	}
	indexData, err := readRuntimeSource("runtime/static/index.html")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/index.html) error = %v", err)
	}

	mainSource := string(mainData)
	moduleSource := string(moduleData)
	interactionSource := string(interactionData)
	shortcutSource := string(shortcutData)
	indexSource := string(indexData)

	contractSource := mainSource + "\n" + moduleSource + "\n" + interactionSource + "\n" + shortcutSource
	if strings.Contains(indexSource, `class="mobile-shortcuts-brand"`) {
		t.Fatal("brand text must be screenshot-only, not live footer DOM")
	}

	for _, want := range []string{
		`data-action="capture-long-screenshot">截取长图`,
		`from "./terminal/screenshot/index.js";`,
		`!(action === "capture-long-screenshot" && !isTouchShortcutLayout())`,
		`button.dataset.kind = shortcut.kind;`,
		`const { runLongScreenshot } = createTerminalLongScreenshot({`,
		`captureLongScreenshot: (session) => runLongScreenshot(session),`,
		`export const captureTerminalGeometry =`,
		`export const terminalGeometryMatches =`,
		`export const planTerminalScreenshotParts =`,
		`export const snapshotTerminalRows =`,
		`export const drawTerminalRows =`,
		`const DEFAULT_MAX_PARTS = 4;`,
		`SCREENSHOT_RANGE_TOO_LARGE`,
		`current.resizeEpoch === snapshot.resizeEpoch`,
		`current.fontMetricsGeneration === snapshot.fontMetricsGeneration`,
		`current.themeFingerprint === snapshot.themeFingerprint`,
		`Match Ghostty's two-pass line renderer`,
		`let captureActive = false;`,
		`Powered by LazyCat MicroServer LightOS`,
		`files.length === 1`,
		`return "saved";`,
	} {
		if !strings.Contains(contractSource, want) && !strings.Contains(indexSource, want) {
			t.Fatalf("runtime terminal long screenshot guard missing %q", want)
		}
	}

	captureBlock := moduleSource
	for _, forbidden := range []string{
		"scrollToTop(",
		"scrollToBottom(",
		"requestSessionHistoryReplay(",
		"resetTerminalForHistoryReplay(",
		"foreignObject",
		"roundRect(",
	} {
		if strings.Contains(captureBlock, forbidden) {
			t.Fatalf("long screenshot must not mutate the live terminal or use unsafe rasterization, found %q", forbidden)
		}
	}
}

func TestRuntimeTerminalInteractionModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js") + "\n" + readRuntimeBootstrapSource(t)
	tabViewSource := read("runtime/static/workspace/tab_view.js")
	tabLifecycleSource := read("runtime/static/workspace/tab_lifecycle.js")
	installationSource := read("runtime/static/terminal/session/session_installation_controller.js")
	runtimeSource := mainSource + "\n" + tabViewSource + "\n" + tabLifecycleSource + "\n" + installationSource
	indexSource := read("runtime/static/terminal/interaction/index.js")
	controllerSource := read("runtime/static/terminal/interaction/context_menu_controller.js")
	viewSource := read("runtime/static/terminal/interaction/context_menu_view.js")
	lifecycleSource := read("runtime/static/terminal/interaction/interaction_lifecycle.js")
	clipboardAdapterSource := read("runtime/static/terminal/interaction/clipboard_adapter.js")
	clipboardControllerSource := read("runtime/static/terminal/interaction/clipboard_controller.js")
	clipboardLifecycleSource := read("runtime/static/terminal/interaction/clipboard_lifecycle.js")
	searchControllerSource := read("runtime/static/terminal/interaction/search_controller.js")
	searchLifecycleSource := read("runtime/static/terminal/interaction/search_lifecycle.js")
	searchModelSource := read("runtime/static/terminal/interaction/search_model.js")
	searchViewSource := read("runtime/static/terminal/interaction/search_view.js")
	textModelSource := read("runtime/static/terminal/interaction/terminal_text_model.js")
	linkControllerSource := read("runtime/static/terminal/interaction/link_controller.js")
	linkModelSource := read("runtime/static/terminal/interaction/link_model.js")
	readmeSource := read("runtime/static/terminal/interaction/README.md")

	for _, want := range []string{
		`buildTerminalLogicalLines as buildLogicalLines,`,
		`createTerminalClipboardController,`,
		`createTerminalContextMenuController,`,
		`createTerminalLinkController,`,
		`createTerminalSearchController,`,
		`let terminalInteraction = null;`,
		`let terminalSearch = null;`,
		`let terminalClipboard = null;`,
		`let terminalLinks = null;`,
		`terminalLinks = createTerminalLinkController({`,
		`copyText: (value) => terminalClipboard?.copyText(value) || Promise.resolve(false),`,
		`terminalClipboard = createTerminalClipboardController({`,
		`sendInput: (session, data) => terminalInput?.sendOrQueue(session, data),`,
		`prepareSelectionManager: (session) => terminalSelection?.prepareManager(session),`,
		`terminalInteraction = createTerminalContextMenuController({`,
		`findFirstURLInText: (text) => terminalLinks.findFirst(text),`,
		`openLink: (url) => terminalLinks.open(url),`,
		`copyLink: (url) => terminalLinks.copy(url),`,
		`terminalSearch = createTerminalSearchController({`,
		`getSearchSeed: (session) => terminalClipboard.getSelectedText(session),`,
		`searchOpen: terminalSearch?.isOpen() === true,`,
		`getTabById: (tabId) => tabs.get(tabId) || null,`,
		`prepareMobileOpen: () => {`,
		`copySession: (session) => terminalClipboard.copySession(session),`,
		`pasteSession: (session) => terminalClipboard.pasteSession(session),`,
		`captureLongScreenshot: (session) => runLongScreenshot(session),`,
		`const clipboardCleanup = clipboard?.bindDesktopSession?.(session);`,
		`addCleanup(session, clipboardCleanup);`,
		`const contextMenuCleanup = interaction?.bindPane?.(session.shellEl, {`,
		`const link = links?.findAtPosition?.(session, event?.clientX, event?.clientY);`,
		`addCleanup(session, contextMenuCleanup);`,
		`bindContextMenu: (button, options) => terminalInteraction.bindTab(button, options),`,
		`tab.contextMenuCleanup?.();`,
		`terminalInteraction,`,
		`terminalClipboard,`,
		`terminalLinks,`,
		`terminalSearch,`,
		`openSearchFromSelection: () => terminalSearch?.openFromSelection(),`,
		`terminalInteraction?.dispose();`,
		`terminalClipboard?.dispose();`,
		`terminalLinks?.dispose();`,
		`terminalSearch?.dispose();`,
		`terminalInteraction?.isMobileOpen() === true`,
		`terminalInteraction?.isDesktopOpen() === true`,
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("main terminal interaction integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`getElementById("contextMenu")`,
		`getElementById("mobileActionSheet")`,
		`getElementById("mobileActionSheetScrim")`,
		`getElementById("mobileActionSheetHandle")`,
		`getElementById("mobileActionGrid")`,
		`const contextPaneActions =`,
		`const contextTabActions =`,
		`const contextLinkActions =`,
		`let contextTarget =`,
		`let mobileActionSheetIgnoreClicksUntil =`,
		`const getContextActionDefinitions =`,
		`const buildMobileContextTarget =`,
		`const isContextActionEnabled =`,
		`function renderMobileActionSheet(`,
		`const runMobileContextAction =`,
		`const updateContextMenuGroups =`,
		`const showContextMenu =`,
		`const runContextAction =`,
		`contextMenu?.addEventListener(`,
		`mobileActionGrid?.addEventListener(`,
		`shellEl.addEventListener("contextmenu"`,
		`button.addEventListener("contextmenu"`,
		`getElementById("searchPanel")`,
		`getElementById("searchInput")`,
		`getElementById("searchCount")`,
		`const searchState =`,
		`const updateSearchCount =`,
		`const rebuildSearchMatches =`,
		`const openSearch =`,
		`const closeSearch =`,
		`searchInput?.addEventListener(`,
		`searchPrevious?.addEventListener(`,
		`searchNext?.addEventListener(`,
		`searchClose?.addEventListener(`,
		`const copyText = async`,
		`const readClipboardText = async`,
		`const selectedTextFromSession =`,
		`const copyFromSession = async`,
		`const pasteIntoSession = async`,
		`const copyCurrentMouseSelection = async`,
		`const installDesktopMouseClipboard =`,
		`const urlPattern =`,
		`const trailingURLPunctuation =`,
		`const findURLAtPosition =`,
		`const findFirstURLInText =`,
		`const openURL =`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal interaction implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		`export { createTerminalContextMenuController } from "./context_menu_controller.js";`,
		`export { createBrowserClipboardAdapter } from "./clipboard_adapter.js";`,
		`export { createTerminalClipboardController } from "./clipboard_controller.js";`,
		`export { createTerminalClipboardLifecycle } from "./clipboard_lifecycle.js";`,
		`export { createTerminalInteractionLifecycle } from "./interaction_lifecycle.js";`,
		`export { createTerminalContextMenuView } from "./context_menu_view.js";`,
		`export { createTerminalLinkController } from "./link_controller.js";`,
		`export { findFirstTerminalURL, findTerminalURLAtPosition } from "./link_model.js";`,
		`export { createTerminalSearchController } from "./search_controller.js";`,
		`export { createTerminalSearchLifecycle } from "./search_lifecycle.js";`,
		`export { findTerminalSearchMatches, scrollTerminalToAbsoluteRow } from "./search_model.js";`,
		`buildTerminalLogicalLines,`,
		`terminalFullBufferText,`,
		`terminalLogicalLineAt,`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal interaction public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalLinkController({`,
		`windowObject?.open?.(value, "_blank", "noopener,noreferrer");`,
		`const copied = await copyText(value);`,
		`if (disposed || generation !== operationGeneration) {`,
		`showToast(copied ? "链接已复制。" : "复制失败。");`,
		`findAtPosition(session, clientX, clientY) {`,
		`findFirst(text) {`,
		`operationGeneration += 1;`,
	} {
		if !strings.Contains(linkControllerSource, want) {
			t.Fatalf("terminal link controller guard missing %q", want)
		}
	}
	for _, want := range []string{
		`const terminalURLSource = String.raw`,
		`const trailingURLPunctuation =`,
		`export const findFirstTerminalURL =`,
		`export const findTerminalURLAtPosition =`,
		`const logical = terminalLogicalLineAt(term, absoluteRow);`,
		`return { url, start: startPosition, end: endPosition };`,
	} {
		if !strings.Contains(linkModelSource, want) {
			t.Fatalf("terminal link model guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"writeReplay",
		"history-replay-start",
		"TerminalResizeController",
		"createTerminalCacheV2",
	} {
		if strings.Contains(linkControllerSource, forbidden) || strings.Contains(linkModelSource, forbidden) {
			t.Fatalf("terminal link module must not own transport/replay/resize state %q", forbidden)
		}
	}
	for _, want := range []string{
		`export function createBrowserClipboardAdapter({`,
		`await navigatorObject.clipboard.writeText(value);`,
		`textarea.setAttribute("readonly", "");`,
		`throw new Error("当前页面策略禁止主动读取剪贴板，请使用系统粘贴快捷键。");`,
	} {
		if !strings.Contains(clipboardAdapterSource, want) {
			t.Fatalf("terminal clipboard adapter guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalClipboardController({`,
		`const getSelectedText = (session = getActiveSession()) => {`,
		`return getSelectionText(session);`,
		`clearSelectionState(session);`,
		`const copySession = async (session = getActiveSession()) => {`,
		`const pasteSession = async (session = getActiveSession(), text = null) => {`,
		`if (disposed || session.closed || !value) {`,
		`sendInput(session, bracketed ?`,
		`bindDesktopSession(session) {`,
		`const onAuxClick = async (event) => {`,
		`lifecycle.dispose();`,
	} {
		if !strings.Contains(clipboardControllerSource, want) {
			t.Fatalf("terminal clipboard controller guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"writeReplay",
		"history-replay-start",
		"TerminalResizeController",
		"createTerminalCacheV2",
	} {
		if strings.Contains(clipboardControllerSource, forbidden) {
			t.Fatalf("terminal clipboard controller must not own transport/replay/resize state %q", forbidden)
		}
	}
	for _, want := range []string{
		`listen(shell, "mousedown", handlers.onMouseDown, { capture: true })`,
		`listen(shell, "auxclick", handlers.onAuxClick)`,
		`listen(documentObject, "mousemove", handlers.onMouseMove)`,
		`listen(documentObject, "mouseup", handlers.onMouseUp)`,
	} {
		if !strings.Contains(clipboardLifecycleSource, want) {
			t.Fatalf("terminal clipboard lifecycle guard missing %q", want)
		}
	}

	for _, want := range []string{
		`const contextPaneActions = new Set([`,
		`const contextTabActions = new Set([`,
		`const contextLinkActions = new Set(["open-link", "copy-link"]);`,
		`let contextTarget = null;`,
		`let lastTerminalTouchContextMenuCandidate = null;`,
		`let mobileActionSheetIgnoreClicksUntil = 0;`,
		`const isContextActionEnabled = (action, target) => {`,
		`const performContextAction = (action, target) => {`,
		`const shouldSuppressTerminalContextMenu = (event) => (`,
		`const selectedText = isFullBufferSelection(session) ? "" : getSelectionText(session);`,
		`bindPane(target, {`,
		`contextTarget = typeof getTarget === "function"`,
		`bindTab(target, { getTarget = () => null, activate = () => {} } = {}) {`,
		`lifecycle.dispose();`,
		`menuView.dispose();`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal interaction controller guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalSearchController({`,
		`const state = {`,
		`const rebuildMatches = () => {`,
		`state.matches = findMatches(session.term, state.query);`,
		`const open = () => {`,
		`openFromSelection(session = getActiveSession()) {`,
		`lifecycle.focusInput(() => searchView.focusAndSelect());`,
		`lifecycle.dispose();`,
		`searchView.dispose();`,
	} {
		if !strings.Contains(searchControllerSource, want) {
			t.Fatalf("terminal search controller guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"writeReplay",
		"history-replay-start",
		"TerminalResizeController",
		"createTerminalCacheV2",
	} {
		if strings.Contains(searchControllerSource, forbidden) {
			t.Fatalf("terminal search controller must not own transport/replay/resize state %q", forbidden)
		}
	}
	for _, want := range []string{
		`getElementById?.("searchPanel")`,
		`getElementById?.("searchInput")`,
		`getElementById?.("searchCount")`,
		`setCount(current, total) {`,
		`focusAndSelect() {`,
	} {
		if !strings.Contains(searchViewSource, want) {
			t.Fatalf("terminal search view guard missing %q", want)
		}
	}
	for _, want := range []string{
		`listen(elements.input, "input", handlers.onInput);`,
		`listen(elements.input, "keydown", handlers.onInputKeydown);`,
		`listen(elements.previous, "click", handlers.onPrevious);`,
		`listen(elements.next, "click", handlers.onNext);`,
		`listen(elements.close, "click", handlers.onClose);`,
		`clearFocusTimer();`,
	} {
		if !strings.Contains(searchLifecycleSource, want) {
			t.Fatalf("terminal search lifecycle guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export const findTerminalSearchMatches = (term, query) => {`,
		`for (const logical of buildTerminalLogicalLines(term)) {`,
		`export const scrollTerminalToAbsoluteRow =`,
	} {
		if !strings.Contains(searchModelSource, want) {
			t.Fatalf("terminal search model guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export const buildTerminalLogicalLines = (term) => {`,
		`current.positions.push({ row, col: map[index] ?? index });`,
		`export const terminalFullBufferText =`,
		`export const terminalLogicalLineAt =`,
	} {
		if !strings.Contains(textModelSource, want) {
			t.Fatalf("terminal text model guard missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"writeReplay",
		"history-replay-start",
		"TerminalResizeController",
		"terminalUnifiedConnection",
		"createTerminalCacheV2",
	} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("terminal interaction controller must not own transport/replay/resize state %q", forbidden)
		}
	}

	for _, want := range []string{
		`const mobileActionIconNames = Object.freeze({`,
		`getElementById?.("contextMenu")`,
		`getElementById?.("mobileActionSheet")`,
		`getElementById?.("mobileActionGrid")`,
		`const updateDesktopGroups = () => {`,
		`renderDesktop({ x, y, target, isActionVisible }) {`,
		`renderMobile({ isActionEnabled, createIcon }) {`,
	} {
		if !strings.Contains(viewSource, want) {
			t.Fatalf("terminal interaction view guard missing %q", want)
		}
	}
	for _, want := range []string{
		`listen(target, "contextmenu", paneHandlers.onCapture, { capture: true })`,
		`listen(target, "contextmenu", paneHandlers.onContextMenu)`,
		`listen(elements.mobileGrid, "click", handlers.onMobileAction);`,
		`listen(elements.desktopMenu, "click", handlers.onDesktopAction);`,
		`listen(documentObject, "pointerdown", handlers.onDocumentPointerDown);`,
		`listen(documentObject, "keydown", handlers.onDocumentKeydown, { capture: true });`,
		`listen(windowObject, "resize", handlers.onResize);`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("terminal interaction lifecycle guard missing %q", want)
		}
	}

	for _, want := range []string{
		"## 职责",
		"## 公开入口与契约",
		"## 状态所有权",
		"## 生命周期与清理",
		"## 文件清单",
		"## 依赖、guard 与最小回归",
		"菜单和动作不得清空终端、触发历史 replay/reset、改变 resize owner",
		"搜索 `start()` 幂等安装 input、keydown 和三个按钮 listener",
		"`search_controller.js` 是 query、match 列表、当前 match index",
		"`clipboard_controller.js` 是复制、粘贴和桌面剪贴板交互的唯一 owner",
		"`link_controller.js` 是链接打开、复制反馈和迟到复制结果 guard 的唯一 owner",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal interaction README missing %q", want)
		}
	}

}

func TestRuntimeTerminalSelectionModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}

	mainSource := read("runtime/static/global-runtime.js") + "\n" + readRuntimeBootstrapSource(t)
	installationSource := read("runtime/static/terminal/session/session_installation_controller.js")
	integrationSource := mainSource + "\n" + installationSource
	indexSource := read("runtime/static/terminal/selection/index.js")
	controllerSource := read("runtime/static/terminal/selection/selection_controller.js")
	modelSource := read("runtime/static/terminal/selection/selection_model.js")
	viewSource := read("runtime/static/terminal/selection/selection_view.js")
	lifecycleSource := read("runtime/static/terminal/selection/selection_lifecycle.js")
	readmeSource := read("runtime/static/terminal/selection/README.md")
	sessionStateSource := read("runtime/static/terminal/session/session_state.js")
	clipboardSource := read("runtime/static/terminal/interaction/clipboard_controller.js")
	contextMenuSource := read("runtime/static/terminal/interaction/context_menu_controller.js")

	for _, want := range []string{
		`import { createTerminalSelectionController } from "./terminal/selection/index.js";`,
		`let terminalSelection = null;`,
		`terminalSelection = createTerminalSelectionController({`,
		`getSelectionText: (session) => terminalSelection?.getSelectedText(session) || "",`,
		`clearSelectionState: (session) => terminalSelection?.clearFullBufferSelection(session),`,
		`isFullBufferSelection: (session) => terminalSelection?.isFullBufferSelection(session) === true,`,
		`hasSelection: (session) => terminalSelection?.hasSelection(session) === true,`,
		`selectAllSession: (session) => terminalSelection?.selectAll(session),`,
		`syncSelectionRuntime: (session) => terminalSelection?.syncRuntimeReferences(session),`,
		`cellFromPoint: (session, clientX, clientY) => terminalSelection?.cellFromPoint(session, clientX, clientY),`,
		`selection?.installSession?.(session);`,
		`selection?.observeSession?.(session);`,
		`clearSelection: (session, options) => terminalSelection?.clear(session, options),`,
		`terminalSelection,`,
		`terminalSelection?.dispose();`,
	} {
		if !strings.Contains(integrationSource, want) {
			t.Fatalf("main terminal selection integration missing %q", want)
		}
	}

	for _, forbidden := range []string{
		`getElementById("selectionSheet")`,
		`const terminalSelectionRange =`,
		`const terminalSelectionText =`,
		`const compareSelectionCells =`,
		`const applyTerminalSelection =`,
		`const installMobileTouchSelection =`,
		`const stopMobileSelectionAutoScroll =`,
		`const updateMobileSelectionHandles =`,
		`selectionSheet?.addEventListener(`,
		`mobileSelectionOverlay`,
		`selectAllBufferActive`,
		`syncMobileMenuSelectionState(`,
	} {
		if strings.Contains(mainSource, forbidden) {
			t.Fatalf("main.js must not retain terminal selection implementation %q", forbidden)
		}
	}
	if strings.Contains(sessionStateSource, "selectAllBufferActive") || strings.Contains(clipboardSource, "selectAllBufferActive") || strings.Contains(contextMenuSource, "selectAllBufferActive") {
		t.Fatal("full-buffer selection state must remain private to terminal selection controller")
	}

	for _, want := range []string{
		`export { createTerminalSelectionController } from "./selection_controller.js";`,
		`export { createTerminalSelectionLifecycle } from "./selection_lifecycle.js";`,
		`compareTerminalSelectionCells,`,
		`terminalSelectionText,`,
		`export { createTerminalSelectionView } from "./selection_view.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal selection public entry missing %q", want)
		}
	}

	for _, want := range []string{
		`export function createTerminalSelectionController({`,
		`const fullBufferSelections = new WeakSet();`,
		`const applySelection = (session, start, end) => {`,
		`manager.webshellSelectionCopyPatched = true;`,
		`manager.webshellStringDoubleClickPatched = true;`,
		`manager.webshellAutoCopyDisabled = true;`,
		`const autoScrollIntent = (session, clientY) => {`,
		`const installSession = (session) => {`,
		`lifecycle.listenSession(session, session.shellEl, "touchstart"`,
		`|| hasMouseTracking(session)`,
		`registerSessionCleanup(session, () => disposeSession(session));`,
		`getSelectedText(session = getActiveSession()) {`,
		`? getFullBufferText(session.term)`,
		`isFullBufferSelection(session) {`,
		`selectionView.removeSession(session);`,
		`lifecycle.dispose();`,
		`selectionView.dispose();`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal selection controller guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export const compareTerminalSelectionCells =`,
		`export const normalizeTerminalSelectionCells =`,
		`export const previousTerminalSelectionCell =`,
		`export const nextTerminalSelectionCell =`,
		`export const terminalSelectionText =`,
		`export const terminalSelectionContainsCell =`,
	} {
		if !strings.Contains(modelSource, want) {
			t.Fatalf("terminal selection model guard missing %q", want)
		}
	}
	for _, want := range []string{
		`getElementById?.("selectionSheet")`,
		`getElementById?.("mobileShortcuts")`,
		`const overlays = new Map();`,
		`cellFromPoint(session, clientX, clientY) {`,
		`createSessionOverlay(session) {`,
		`positionSheet(session) {`,
		`updateHandles(session, touchLayout) {`,
	} {
		if !strings.Contains(viewSource, want) {
			t.Fatalf("terminal selection view guard missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalSelectionLifecycle({`,
		`listenSession(session, target, type, listener, options) {`,
		`setSessionTimeout(session, callback, delay) {`,
		`setSessionInterval(session, callback, delay) {`,
		`disposeSession(session) {`,
	} {
		if !strings.Contains(lifecycleSource, want) {
			t.Fatalf("terminal selection lifecycle guard missing %q", want)
		}
	}

	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"writeReplay",
		"TerminalResizeController",
		"createTerminalCacheV2",
		"terminalUnifiedConnection",
	} {
		if strings.Contains(controllerSource, forbidden) || strings.Contains(modelSource, forbidden) || strings.Contains(viewSource, forbidden) || strings.Contains(lifecycleSource, forbidden) {
			t.Fatalf("terminal selection module must not own transport/replay/resize state %q", forbidden)
		}
	}

	for _, want := range []string{
		"## 职责",
		"## 公开入口与契约",
		"## 状态所有权",
		"## 生命周期与清理",
		"## 文件清单",
		"## 依赖、guard 与最小回归",
		"完整缓冲区选择使用模块私有 `WeakSet`",
		"input focus -> 默认选择 -> TUI adapter -> 通用 mouse tracking",
		"不得清空终端、触发或显示 history replay、snapshot、resize 或重连中间过程",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal selection README missing %q", want)
		}
	}

}

func TestTerminalSelectionControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_selection_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal selection controller tests failed: %v\n%s", err, output)
	}
}

func TestTerminalLongScreenshotBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/terminal_long_screenshot_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("terminal long screenshot tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeMainIsOnlyBootstrapEntry(t *testing.T) {
	data, err := os.ReadFile("runtime/static/main.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/main.js) error = %v", err)
	}
	source := strings.TrimSpace(string(data))
	if lines := strings.Count(source, "\n") + 1; lines > 6 {
		t.Fatalf("main.js must stay a tiny bootstrap entry, got %d lines", lines)
	}
	for _, want := range []string{
		`import { startGlobalRuntime } from "./global-runtime.js";`,
		"startGlobalRuntime();",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("main.js bootstrap entry missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"document.addEventListener",
		"createTab(",
		"fetch(",
		"setInterval(",
		"history_replay",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("main.js must not retain runtime implementation %q", forbidden)
		}
	}
}

func TestRuntimeGlobalRuntimeOwnsApplicationLifecycle(t *testing.T) {
	mainData, err := os.ReadFile("runtime/static/main.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/main.js) error = %v", err)
	}
	runtimeData, err := os.ReadFile("runtime/static/global-runtime.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/global-runtime.js) error = %v", err)
	}
	appIndexData, err := os.ReadFile("runtime/static/app/index.js")
	if err != nil {
		t.Fatalf("ReadFile(runtime/static/app/index.js) error = %v", err)
	}
	mainSource := string(mainData)
	runtimeSource := string(runtimeData)
	appIndexSource := string(appIndexData)

	if !strings.Contains(runtimeSource, "Global runtime boundary.") {
		t.Fatal("global-runtime.js must document its application-wide ownership")
	}
	for _, want := range []string{
		"export function startGlobalRuntime()",
		"let disposed = false",
		"appLifecycle = createAppLifecycle({",
		"appBootstrap = createAppBootstrapController({",
		"onBeforeUnload: (event) => {",
		"appLifecycle?.dispose();",
	} {
		if !strings.Contains(runtimeSource, want) {
			t.Fatalf("global runtime ownership missing %q", want)
		}
	}
	for _, line := range strings.Split(runtimeSource, "\n") {
		if strings.Contains(line, `from "./app/`) && !strings.Contains(line, `from "./app/index.js";`) {
			t.Fatalf("global-runtime.js must use the app public entry instead of deep app imports: %s", line)
		}
	}
	if strings.Contains(appIndexSource, "../global-runtime.js") || strings.Contains(appIndexSource, "startGlobalRuntime") {
		t.Fatal("app/index.js must not re-export the global runtime and create a dependency cycle")
	}
	if _, err := os.Stat("runtime/static/app/app_controller.js"); !os.IsNotExist(err) {
		t.Fatal("legacy app_controller.js must not remain after global runtime migration")
	}
	if !strings.Contains(mainSource, `import { startGlobalRuntime } from "./global-runtime.js";`) {
		t.Fatal("main.js must point directly at global-runtime.js")
	}
}

func TestRuntimeUIIconsModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}
	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/ui/icons/index.js")
	controllerSource := read("runtime/static/ui/icons/icon_controller.js")
	readmeSource := read("runtime/static/ui/icons/README.md")

	for _, want := range []string{
		`import { createSVGIconFactory } from "./ui/icons/index.js";`,
		`const createSVGIcon = createSVGIconFactory({ documentObject: document });`,
		`createIcon: (name) => createSVGIcon(name),`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("UI icon app integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const mobileIconDefinitions =`,
		`const svgNamespace =`,
		`document.createElementNS(svgNamespace`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain icon implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`export {`,
		`MOBILE_ICON_DEFINITIONS,`,
		`createSVGIconFactory,`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("UI icon public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export const MOBILE_ICON_DEFINITIONS`,
		`export function createSVGIcon(`,
		`documentObject.createElementNS(SVG_NAMESPACE, "svg")`,
		`definition = definitions[name] || definitions.default`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("UI icon controller missing %q", want)
		}
	}
	for _, forbidden := range []string{`new WebSocket`, `writeReplay`, `requestRender`, `history_replay`} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("UI icon controller crosses runtime boundary with %q", forbidden)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 文件清单",
		"## 边界与验证",
		"history replay",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("UI icon README missing %q", want)
		}
	}

}

func TestRuntimeAppLayoutModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}
	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/app/layout/index.js")
	controllerSource := read("runtime/static/app/layout/layout_controller.js")
	readmeSource := read("runtime/static/app/layout/README.md")

	for _, want := range []string{
		`createAppLayoutController,`,
		`from "./app/index.js";`,
		`layoutController = createAppLayoutController({`,
		`const isMobileLayout = () => layoutController?.isMobileLayout() === true;`,
		`const syncTabMobilePixelScroll = (tab) => layoutController?.syncTabMobilePixelScroll(tab) === true;`,
		`layoutController?.dispose();`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("app layout integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const mobileLayoutQuery =`,
		`const touchShortcutLayoutQuery =`,
		`document.documentElement.dataset.forcePcMode =`,
		`session.term.options.mobilePixelScroll =`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain layout implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`export { createAppLayoutController } from "./layout_controller.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("app layout public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createAppLayoutController({`,
		`const isForcePCModeActive = () => Boolean(`,
		`const syncForcePCModeState = () => {`,
		`documentObject.documentElement.dataset.forcePcMode`,
		`const syncTerminalMobilePixelScroll = (session) => {`,
		`let disposed = false;`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("app layout controller missing %q", want)
		}
	}
	for _, forbidden := range []string{`new WebSocket`, `writeReplay`, `requestRender`, `history_replay`} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("app layout controller crosses boundary with %q", forbidden)
		}
	}
	for _, want := range []string{"## 职责", "## 文件清单", "## 边界与验证", "history replay"} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("app layout README missing %q", want)
		}
	}

}

func TestRuntimeTerminalPolicyModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}
	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/terminal/policy/index.js")
	controllerSource := read("runtime/static/terminal/policy/policy_controller.js")
	readmeSource := read("runtime/static/terminal/policy/README.md")

	for _, want := range []string{
		`import { createTerminalPolicyController } from "./terminal/policy/index.js";`,
		`terminalPolicy = createTerminalPolicyController({`,
		`terminalLocationDescription,`,
		`terminalPolicy?.dispose();`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("terminal policy app integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const grokExecutableNamePattern =`,
		`const isGrokTerminalSession = (session) => {`,
		"会话=${String(session?.name || \"unknown\")}",
		`const stripTerminalCommandTokenQuotes =`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain terminal policy implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`createTerminalPolicyController,`,
		`isGrokTerminalSession,`,
		`terminalLocationDescription,`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal policy public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export const terminalCommandLineTokens`,
		`export const isGrokTerminalSession`,
		`const isClaudeFullscreenContextMenuEvent = (session, event) =>`,
		`const scrollTerminalToBottomForUserInput = (session) =>`,
		`if (disposed || !session || session.closed || session.exitExpected || isDialogOpen())`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal policy controller missing %q", want)
		}
	}
	for _, forbidden := range []string{"new WebSocket", "history-replay", "history_replay", "writeReplay", "requestRender"} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("terminal policy controller crosses runtime boundary with %q", forbidden)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口",
		"## 状态所有权",
		"## 生命周期",
		"## 文件清单",
		"## 依赖方向",
		"## 测试与回归",
		"history replay",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal policy README missing %q", want)
		}
	}

}

func TestRuntimeTerminalMetricsModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}
	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/terminal/metrics/index.js")
	controllerSource := read("runtime/static/terminal/metrics/metrics_controller.js")
	readmeSource := read("runtime/static/terminal/metrics/README.md")

	for _, want := range []string{
		`import { createTerminalMetricsController } from "./terminal/metrics/index.js";`,
		`terminalMetrics = createTerminalMetricsController({`,
		`terminalMetrics?.applyFontFamily(fontFamily)`,
		`terminalMetrics?.applyFontSize(fontSize)`,
		`terminalMetrics?.applyLineHeight(value, previousValue)`,
		`terminalMetrics?.applyScrollbackChange(previousScrollback, nextScrollback)`,
		`terminalMetrics?.applyMobilePixelScroll(enabled)`,
		`terminalMetrics?.sizeQuery()`,
		`terminalMetrics?.refresh(session, options)`,
		`terminalMetrics?.dispose();`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("terminal metrics app integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`const applyTerminalScrollback =`,
		`pane.term.options.scrollback = terminalOptionsBase.scrollback;`,
		`for (const tab of tabs.values())`,
		`const metricsGeneration = Number(session.fontMetricsGeneration || 0) + 1;`,
		`const terminalEstimatedFontMetrics =`,
		`const terminalEstimatedSizeForElement = (element) => {`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain terminal metrics implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`export { createTerminalMetricsController } from "./metrics_controller.js";`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("terminal metrics public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createTerminalMetricsController({`,
		`const applyFontFamily = (value) => {`,
		`const applyFontSize = (value) => {`,
		`const applyLineHeight = (value, previousValue) => {`,
		`const applyMobilePixelScroll = (enabled) => {`,
		`const applyScrollback = (value = getScrollback()) => {`,
		`const applyScrollbackChange = (previousValue, nextValue) => {`,
		`const refresh = (session, {`,
		`resize?.beginMetricsLiveGeometry?.(session)`,
		`resize?.updateMetricsLiveGeometry?.(session, { force: forceSizeSync })`,
		`resize?.endMetricsLiveGeometry?.(session);`,
		`const estimatedSizeForElement = (element) => {`,
		`const sizeQuery = () => {`,
		`clearSessionTimers(session);`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("terminal metrics controller missing %q", want)
		}
	}
	for _, forbidden := range []string{"new WebSocket", "history-replay", "history_replay", "writeReplay", "requestRender"} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("terminal metrics controller crosses runtime boundary with %q", forbidden)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口",
		"## 状态所有权与生命周期",
		"## 文件清单",
		"## 依赖、边界与验证",
		"history replay",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("terminal metrics README missing %q", want)
		}
	}

}

func TestRuntimeAppFeedbackModuleBoundary(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		data, err := readRuntimeSource(path)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", path, err)
		}
		return string(data)
	}
	appSource := read("runtime/static/global-runtime.js")
	indexSource := read("runtime/static/app/feedback/index.js")
	controllerSource := read("runtime/static/app/feedback/feedback_controller.js")
	readmeSource := read("runtime/static/app/feedback/README.md")

	for _, want := range []string{
		`createAppFeedbackController,`,
		`from "./app/index.js";`,
		`feedback = createAppFeedbackController({`,
		`const showToast = (message) => feedback?.showToast(message) === true;`,
		`const showStartupErrorPanel = (message) => feedback?.showStartupError(message) === true;`,
		`const hideStartupErrorPanel = () => feedback?.hideStartupError() === true;`,
		`feedback?.dispose();`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("app feedback integration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		`let toastTimer = 0;`,
		`toast.textContent = message;`,
		`startupErrorText.textContent = text;`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain feedback implementation %q", forbidden)
		}
	}
	if !strings.Contains(indexSource, `export { createAppFeedbackController } from "./feedback_controller.js";`) {
		t.Fatal("app feedback public entry missing controller export")
	}
	for _, want := range []string{
		`export function createAppFeedbackController({`,
		`const showToast = (message) => {`,
		`const showStartupError = (message) => {`,
		`const hideStartupError = () => {`,
		`windowObject?.clearTimeout?.(toastTimer);`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(controllerSource, want) {
			t.Fatalf("app feedback controller missing %q", want)
		}
	}
	for _, forbidden := range []string{"new WebSocket", "history-replay", "history_replay", "writeReplay", "requestRender"} {
		if strings.Contains(controllerSource, forbidden) {
			t.Fatalf("app feedback controller crosses runtime boundary with %q", forbidden)
		}
	}
	for _, want := range []string{
		"## 职责",
		"## 公开入口与状态所有权",
		"## 生命周期",
		"## 文件清单",
		"## 依赖、边界与验证",
		"history replay",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("app feedback README missing %q", want)
		}
	}

}

func TestWorkspaceLayoutControllerBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	command := exec.Command(node, "--test", "tests/workspace_layout_controller_test.mjs", "tests/workspace_layout_view_controller_test.mjs", "tests/workspace_tab_registry_test.mjs", "tests/workspace_activity_controller_test.mjs", "tests/workspace_tab_label_controller_test.mjs", "tests/workspace_tab_navigation_controller_test.mjs", "tests/workspace_presentation_controller_test.mjs", "tests/workspace_pane_activation_controller_test.mjs", "tests/workspace_api_controller_test.mjs", "tests/workspace_persistence_controller_test.mjs", "tests/workspace_refresh_controller_test.mjs", "tests/workspace_state_apply_controller_test.mjs", "tests/workspace_tab_controller_test.mjs", "tests/workspace_tab_activation_controller_test.mjs", "tests/workspace_target_controller_test.mjs")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("workspace layout tests failed: %v\n%s", err, output)
	}
}

func TestRuntimeWorkspaceModuleBoundary(t *testing.T) {
	mainSource := string(mustReadRuntimeSource(t, "runtime/static/main.js"))
	appSource := string(mustReadRuntimeSource(t, "runtime/static/global-runtime.js"))
	indexSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/index.js"))
	layoutSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/layout_controller.js"))
	viewSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/layout_view_controller.js"))
	registrySource := string(mustReadRuntimeSource(t, "runtime/static/workspace/tab_registry.js"))
	activitySource := string(mustReadRuntimeSource(t, "runtime/static/workspace/activity_controller.js"))
	presentationSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/presentation_controller.js"))
	paneActivationSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/pane_activation_controller.js"))
	paneActivationLifecycleSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/pane_activation_lifecycle.js"))
	tabLabelSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/tab_label_controller.js"))
	tabLabelLifecycleSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/tab_label_lifecycle.js"))
	tabNavigationSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/tab_navigation_controller.js"))
	tabControllerSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/tab_controller.js"))
	tabViewSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/tab_view.js"))
	tabLifecycleSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/tab_lifecycle.js"))
	tabActivationSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/tab_activation_controller.js"))
	workspaceAPISource := string(mustReadRuntimeSource(t, "runtime/static/workspace/workspace_api.js"))
	persistenceSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/persistence_controller.js"))
	refreshSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/refresh_controller.js"))
	refreshLifecycleSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/refresh_lifecycle.js"))
	stateApplySource := string(mustReadRuntimeSource(t, "runtime/static/workspace/state_apply_controller.js"))
	stateApplyLifecycleSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/state_apply_lifecycle.js"))
	targetControllerSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/target_controller.js"))
	targetLifecycleSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/target_lifecycle.js"))
	readmeSource := string(mustReadRuntimeSource(t, "runtime/static/workspace/README.md"))

	if strings.Contains(mainSource, "workspaceLayout") || strings.Contains(mainSource, "createWorkspace") {
		t.Fatal("main.js must not own or wire workspace implementation directly")
	}
	for _, want := range []string{
		`createWorkspaceLayoutController`,
		`createWorkspaceLayoutViewController`,
		`createWorkspacePresentationController`,
		`createWorkspacePaneActivationController`,
		`createWorkspaceTabLabelController`,
		`createWorkspaceTabNavigationController`,
		`createWorkspaceAPI`,
		`createWorkspacePersistenceController`,
		`createWorkspaceRefreshController`,
		`createWorkspaceStateApplyController`,
		`createWorkspaceTabController`,
		`createWorkspaceTabView`,
		`createWorkspaceTabActivationController`,
		`workspaceLayoutView = createWorkspaceLayoutViewController({`,
		`workspacePresentation = createWorkspacePresentationController({`,
		`workspacePaneActivation = createWorkspacePaneActivationController({`,
		`workspaceTabLabels = createWorkspaceTabLabelController({`,
		`workspaceTabNavigation = createWorkspaceTabNavigationController({`,
		`renderTabLayout: (tab) => workspaceLayoutView.renderTabLayout(tab),`,
		`workspaceTabLabels?.renderTabLabel(tab)`,
		`workspaceTabLabels?.dispose();`,
		`workspaceTabNavigation?.dispose();`,
		`workspacePresentation = null;`,
		`workspacePaneActivation?.dispose();`,
		`workspacePersistence.dispose();`,
		`workspaceAPI?.dispose();`,
		`workspaceRefresh.dispose();`,
		`resumeWorkspaceRetry: () => workspaceRefresh?.resumeRetry(),`,
		`workspaceStateApply = createWorkspaceStateApplyController({`,
		`workspaceStateApply?.dispose();`,
		`workspaceTabView = createWorkspaceTabView({`,
		`workspaceTabController = createWorkspaceTabController({`,
		`workspaceTabActivation = createWorkspaceTabActivationController({`,
		`beginTabInteractiveResize: (tab) => terminalResize?.beginTabInteractiveResize(tab),`,
		`updateTabInteractiveResize: (tab) => terminalResize?.updateTabInteractiveResize(tab),`,
		`endTabInteractiveResize: (tab) => terminalResize?.endTabInteractiveResize(tab),`,
		`const setActiveTab = (tabId, options) => workspaceTabActivation.activate(tabId, options);`,
		`workspaceTabActivation?.dispose();`,
		`workspaceTabController?.dispose();`,
		`workspaceTargetController = createWorkspaceTargetController({`,
		`const setActiveInstanceName = (name) => workspaceTargetController?.setActiveName(name)`,
		`const switchInstance = (name, options) => (`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("app controller workspace integration missing %q", want)
		}
	}
	for _, want := range []string{
		"refreshActivity",
		"refreshAndConfirmClose",
		"hasCachedBusyPane",
		"startActivityRefresh",
		"stopActivityRefresh",
		"activityRefreshTimer",
	} {
		if !strings.Contains(activitySource, want) {
			t.Fatalf("workspace activity controller missing %q", want)
		}
	}
	for _, forbidden := range []string{"new WebSocket", "history-replay-start", "createTerminalCacheV2"} {
		if strings.Contains(activitySource, forbidden) {
			t.Fatalf("workspace activity controller crosses terminal ownership boundary %q", forbidden)
		}
	}
	for _, want := range []string{
		"const tabs = new Map();",
		"allocateTabId",
		"getNextTabSeq",
		"getActiveTabId",
		"dispose",
	} {
		if !strings.Contains(registrySource, want) {
			t.Fatalf("workspace tab registry missing %q", want)
		}
	}
	for _, want := range []string{
		`export { createWorkspaceLayoutViewController } from "./layout_view_controller.js";`,
		`createWorkspacePresentationController,`,
		`workspacePathBasenameLabel,`,
		`export { createWorkspacePaneActivationController } from "./pane_activation_controller.js";`,
		`export { createWorkspacePaneActivationLifecycle } from "./pane_activation_lifecycle.js";`,
		`export { createWorkspaceTabLabelController } from "./tab_label_controller.js";`,
		`export { createWorkspaceTabLabelLifecycle } from "./tab_label_lifecycle.js";`,
		`export { createWorkspaceTabNavigationController } from "./tab_navigation_controller.js";`,
		`export { createWorkspaceTabController } from "./tab_controller.js";`,
		`export { createWorkspaceTabLifecycle } from "./tab_lifecycle.js";`,
		`export { createWorkspaceTabView } from "./tab_view.js";`,
		`export { createWorkspaceTabActivationController } from "./tab_activation_controller.js";`,
		`createWorkspaceAPI,`,
		`createWorkspacePersistenceController,`,
		`export { createWorkspaceRefreshController } from "./refresh_controller.js";`,
		`export { createWorkspaceRefreshLifecycle } from "./refresh_lifecycle.js";`,
		`export { createWorkspaceStateApplyController } from "./state_apply_controller.js";`,
		`export { createWorkspaceStateApplyLifecycle } from "./state_apply_lifecycle.js";`,
		`export {`,
	} {
		if !strings.Contains(indexSource, want) {
			t.Fatalf("workspace public entry missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createWorkspacePresentationController({`,
		`const updateMobileActiveTabTitle = () => {`,
		`const refreshTabAutoLabel = (tab) => {`,
		`const syncCursorBlinkState = () => {`,
		`const updateEmptyState = () => {`,
	} {
		if !strings.Contains(presentationSource, want) {
			t.Fatalf("workspace presentation controller missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createWorkspacePaneActivationController({`,
		`const activate = (tab, paneId, {`,
		`pane.shellEl.classList.toggle("active", pane.id === paneId);`,
		`reason: userInteraction ? "pane_pointer" : "active_pane_changed",`,
		`postWorkspaceAction("activate_pane", {`,
		`const focusAtPoint = (clientX, clientY) => {`,
		`export function createWorkspacePaneActivationLifecycle({`,
		`const frames = new Set();`,
		`windowObject.cancelAnimationFrame(frame);`,
	} {
		if !strings.Contains(paneActivationSource+"\n"+paneActivationLifecycleSource, want) {
			t.Fatalf("workspace pane activation module missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"TerminalReplayController",
		"term.write",
		"canvas.getContext",
	} {
		if strings.Contains(paneActivationSource, forbidden) || strings.Contains(paneActivationLifecycleSource, forbidden) {
			t.Fatalf("workspace pane activation crosses terminal implementation boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		`tab.activePaneId = paneId;`,
		`pane.shellEl.classList.toggle("active", pane.id === paneId);`,
		`document.elementFromPoint(clientX, clientY)`,
		`postWorkspaceAction("activate_pane", {`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain pane activation implementation %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"TerminalReplayController",
		"term.write",
		"canvas.getContext",
	} {
		if strings.Contains(presentationSource, forbidden) {
			t.Fatalf("workspace presentation crosses terminal implementation boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		`const activePaneDirectoryLabel =`,
		`const resolvePaneAutoLabel =`,
		`const markTabNotification =`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain workspace presentation implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		"splitLayout",
		"removePaneFromLayout",
		"collectPaneIds",
		"selectPaneInDirection",
	} {
		if !strings.Contains(layoutSource, want) {
			t.Fatalf("workspace layout algorithm missing %q", want)
		}
	}
	for _, want := range []string{
		"renderTabLayout",
		"installSplitResizeHandle",
		"beginTabInteractiveResize",
		"updateTabInteractiveResize",
		"endTabInteractiveResize",
		"update_layout",
		"isApplyingWorkspaceState",
		"dispose",
	} {
		if !strings.Contains(viewSource, want) {
			t.Fatalf("workspace layout view missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"createTerminalCacheV2",
		"TerminalReplayController",
	} {
		if strings.Contains(viewSource, forbidden) {
			t.Fatalf("workspace layout view crosses terminal ownership boundary %q", forbidden)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceTargetController({`,
		`const setActiveName = (name) => {`,
		`const isCurrentRequest = (name, generation) => (`,
		`const isCurrentSession = (session) => {`,
		`const switchTo = async (nextName, { updateURL = true, replaceURL = false } = {}) => {`,
		`clearRefreshRetry();`,
		`resetWorkspace();`,
		`refreshWorkspaceWithRetry({`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(targetControllerSource, want) {
			t.Fatalf("workspace target controller missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceTargetLifecycle({`,
		`let activeName = String(initialName || "").trim();`,
		`let generation = 0;`,
		`const isCurrent = (name, expectedGeneration) => (`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(targetLifecycleSource, want) {
			t.Fatalf("workspace target lifecycle missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"createTerminalCacheV2",
		"TerminalReplayController",
		"term.write",
		"canvas.getContext",
	} {
		if strings.Contains(targetControllerSource, forbidden) || strings.Contains(targetLifecycleSource, forbidden) {
			t.Fatalf("workspace target module crosses terminal implementation boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		`let activeName =`,
		`let activeInstanceGeneration`,
		`const setActiveInstanceName = (name) => {`,
		`const resetTabsForInstance =`,
		`const switchInstance = async`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain target state/transaction implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceStateApplyController({`,
		`let applying = false;`,
		`const runApplying = (task) => {`,
		`const apply = (state, {`,
		`const nextTabIDs = new Set((state?.tabs || []).map((tab) => tab.id));`,
		`const wantedPaneIDs = new Set((tabState.panes || []).map((pane) => pane.id));`,
		`lifecycle.scheduleFrame(() => {`,
		`flushPendingMembershipRefresh("workspace_restored");`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(stateApplySource, want) {
			t.Fatalf("workspace state apply controller missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceStateApplyLifecycle({`,
		`const frames = new Set();`,
		`const scheduleFrame = (callback) => {`,
		`windowObject.cancelAnimationFrame(frame);`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(stateApplyLifecycleSource, want) {
			t.Fatalf("workspace state apply lifecycle missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"TerminalReplayController",
		"term.write",
		"canvas.getContext",
	} {
		if strings.Contains(stateApplySource, forbidden) || strings.Contains(stateApplyLifecycleSource, forbidden) {
			t.Fatalf("workspace state apply crosses terminal implementation boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		"let applyingWorkspaceState",
		"const nextTabIDs = new Set((state?.tabs || []).map((tab) => tab.id));",
		"const wantedPaneIDs = new Set((tabState.panes || []).map((pane) => pane.id));",
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain workspace state apply implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceRefreshController({`,
		`let latestRecoveryMetrics = null;`,
		`const request = async ({`,
		`const apply = ({ state, requestName, generation }, { focus = false } = {}) => {`,
		`const refreshWithRetry = async (options = {}) => {`,
		`lifecycle.schedule(options);`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(refreshSource, want) {
			t.Fatalf("workspace refresh controller missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceRefreshLifecycle({`,
		`let retryTimer = 0;`,
		`let retryAttempts = 0;`,
		`let retryInFlight = false;`,
		`let retryContext = null;`,
		`const schedule = ({`,
		`const resume = () => {`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(refreshLifecycleSource, want) {
			t.Fatalf("workspace refresh lifecycle missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"createTerminalCacheV2",
		"terminalPresentation",
		"terminalResize",
	} {
		if strings.Contains(refreshSource, forbidden) || strings.Contains(refreshLifecycleSource, forbidden) {
			t.Fatalf("workspace refresh module crosses terminal ownership boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		"workspaceRefreshRetryTimer",
		"workspaceRefreshRetryAttempts",
		"workspaceRefreshRetryInFlight",
		"workspaceRefreshRetryContext",
		"latestWorkspaceRecoveryMetrics",
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain workspace refresh lifecycle state %q", forbidden)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceAPI({`,
		`const workspaceURL = (name = getActiveName(), size = normalizedSize()) => {`,
		`const activityURL = (name = getActiveName(), size = normalizedSize()) => {`,
		`const fetchState = async (name = getActiveName()) => {`,
		`const postAction = async (action, payload = {}, {`,
		`ensureWorkspaceResponseSelector(state, requestName);`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(workspaceAPISource, want) {
			t.Fatalf("workspace API missing %q", want)
		}
	}
	for _, want := range []string{
		`export function restoreInitialWorkspaceLocation({`,
		`export function createWorkspacePersistenceController({`,
		`const activeTabPersistenceChains = new Map();`,
		`const rememberActiveTab = () => {`,
		`const rememberRestartTabForReload = (name, tabId) => {`,
		`const persistActiveWorkspaceTab = (tabId) => {`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(persistenceSource, want) {
			t.Fatalf("workspace persistence controller missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"createTerminalCacheV2",
		"terminalPresentation",
		"terminalResize",
	} {
		if strings.Contains(workspaceAPISource, forbidden) || strings.Contains(persistenceSource, forbidden) {
			t.Fatalf("workspace API/persistence crosses terminal ownership boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		"activeTabPersistenceChains",
		"lastTabStorageKey",
		"restartTabStorageKey",
		"workspaceRestoreStorageKey",
		"suppressWorkspaceRestoreOnce",
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain workspace API/persistence state %q", forbidden)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceTabNavigationController({`,
		`let recentTabIds = [];`,
		`const getOrderedTabs = () => {`,
		`const rememberRecentTab = (tabID, previousTabID = "") => {`,
		`const swapRecentTabs = () => {`,
		`const activateByOffset = (offset) => {`,
		`const scrollButtonIntoView = (button) => {`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(tabNavigationSource, want) {
			t.Fatalf("workspace tab navigation controller missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"createTerminalCacheV2",
		"terminalPresentation",
		"terminalResize",
	} {
		if strings.Contains(tabNavigationSource, forbidden) {
			t.Fatalf("workspace tab navigation crosses terminal ownership boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		"let recentTabIds",
		"recentTabsStorageKey",
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain tab navigation state %q", forbidden)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceTabLabelController({`,
		`let inlineRenameState = null;`,
		`const renderTabLabel = (tab) => {`,
		`const commitTabRename = async (tabID, label, { optimistic = false, force = false } = {}) => {`,
		`const beginInlineTabRename = (tabID) => {`,
		`const finishInlineTabRename = ({ commit = true, restoreFocus = false } = {}) => {`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(tabLabelSource, want) {
			t.Fatalf("workspace tab label controller missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceTabLabelLifecycle({`,
		`const controllers = new Set();`,
		`const frames = new Set();`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(tabLabelLifecycleSource, want) {
			t.Fatalf("workspace tab label lifecycle missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"createTerminalCacheV2",
		"terminalPresentation",
		"terminalResize",
	} {
		if strings.Contains(tabLabelSource, forbidden) || strings.Contains(tabLabelLifecycleSource, forbidden) {
			t.Fatalf("workspace tab label module crosses terminal ownership boundary %q", forbidden)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceTabController({`,
		`const createTab = ({`,
		`const splitPane = (tabId, paneId, direction) => {`,
		`const closePane = (tabId, paneId) => {`,
		`const closeTab = (tabId, { allowLast = true, remember = true } = {}) => {`,
		`const closeOtherTabs = (tabId) => {`,
		`const renameTab = async (tabId) => {`,
		`const movePaneToNewTab = (tabId, paneId) => {`,
		`const moveTab = (tabId, position) => {`,
		`const resetForInstance = () => runApplying(() => {`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(tabControllerSource, want) {
			t.Fatalf("workspace tab controller missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceTabView({`,
		`const createTabElements = (tabId) => {`,
		`const createTabButton = (tab) => {`,
		`const recreateTabButton = (tab) => {`,
		`const moveTabButton = (tab, position, orderedTabs) => {`,
		`const setActiveTabVisuals = (items, activeTabId) => {`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(tabViewSource, want) {
			t.Fatalf("workspace tab view missing %q", want)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceTabLifecycle({`,
		`const frames = new Set();`,
		`const replaceContextCleanup = (tab, cleanup) => {`,
		`windowObject.cancelAnimationFrame(frame);`,
		`const disposeTab = (tab) => {`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(tabLifecycleSource, want) {
			t.Fatalf("workspace tab lifecycle missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"createTerminalCacheV2",
		"TerminalReplayController",
		"term.write",
		"canvas.getContext",
	} {
		if strings.Contains(tabControllerSource, forbidden) || strings.Contains(tabViewSource, forbidden) || strings.Contains(tabLifecycleSource, forbidden) {
			t.Fatalf("workspace tab CRUD crosses terminal implementation boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		`const createTabButton = (tab) => {`,
		`postWorkspaceAction("split_pane"`,
		`postWorkspaceAction("close_pane"`,
		`postWorkspaceAction("close_tab"`,
		`postWorkspaceAction("close_other_tabs"`,
		`postWorkspaceAction("move_pane_to_tab"`,
		`postWorkspaceAction("move_tab"`,
		`paneElement.className = "terminal-pane"`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain workspace tab CRUD implementation %q", forbidden)
		}
	}
	for _, want := range []string{
		`export function createWorkspaceTabActivationController({`,
		`const preserveTabFrames = (tab, { onlyIfStale = false } = {}) => {`,
		`tabRegistry.setActiveTabId(tab.id);`,
		`tabView.setActiveTabVisuals([previousTab, tab], tab.id);`,
		`pane.activationFitPending = !presentationCurrent;`,
		`scheduler.schedule(tab.id, [`,
		`measureTask("tab activation state"`,
		`measureTask("tab activation resize"`,
		`scheduleVisibleTabResize(tab, { immediate: false });`,
		`measureTask("tab activation membership"`,
		`const clear = () => {`,
		`const dispose = () => {`,
	} {
		if !strings.Contains(tabActivationSource, want) {
			t.Fatalf("workspace tab activation controller missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"new WebSocket",
		"history-replay-start",
		"createTerminalCacheV2",
		"TerminalReplayController",
		"term.write",
		"canvas.getContext",
	} {
		if strings.Contains(tabActivationSource, forbidden) {
			t.Fatalf("workspace tab activation crosses terminal implementation boundary %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		`let activeTabId`,
		`const preserveTabTerminalFrames = (tab`,
		`pane.activationFitPending = !presentationCurrent;`,
		`scheduler.schedule(tab.id, [`,
		`tabActivationScheduler`,
		`item.button?.classList.toggle("active", isActive);`,
	} {
		if strings.Contains(appSource, forbidden) {
			t.Fatalf("app controller must not retain tab activation implementation %q", forbidden)
		}
	}

	for _, want := range []string{
		"布局 DOM",
		"inline rename",
		"最近两个 tab",
		"tab/pane CRUD",
		"tab DOM",
		"tab 激活编排",
		"pane 激活",
		"workspace API",
		"活动 tab 持久化",
		"refresh/retry",
		"权威 state apply",
		"文件",
		"dispose",
		"历史回放中间过程不可见",
	} {
		if !strings.Contains(readmeSource, want) {
			t.Fatalf("workspace README missing %q", want)
		}
	}
}

func mustReadRuntimeSource(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", path, err)
	}
	return data
}
