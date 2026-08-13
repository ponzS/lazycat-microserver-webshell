package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestOpencodeAndHerdrFullscreenTouchAdapters(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required for fullscreen TUI touch behavior tests")
	}
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd() error = %v", err)
	}
	gesturePath := filepath.Join(workingDirectory, "runtime", "static", "fullscreen_tui_touch.js")
	adapterPath := filepath.Join(workingDirectory, "runtime", "static", "fullscreen_tui_touch_adapter.js")
	opencodePath := filepath.Join(workingDirectory, "runtime", "static", "opencode_fullscreen_touch.js")
	opencodeAdapterPath := filepath.Join(workingDirectory, "runtime", "static", "opencode_fullscreen_touch_adapter.js")
	herdrPath := filepath.Join(workingDirectory, "runtime", "static", "herdr_fullscreen_touch.js")
	herdrAdapterPath := filepath.Join(workingDirectory, "runtime", "static", "herdr_fullscreen_touch_adapter.js")
	runnerPath := filepath.Join(t.TempDir(), "fullscreen_tui_touch_test.mjs")
	runner := `
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [gesturePath, adapterPath, opencodePath, opencodeAdapterPath, herdrPath, herdrAdapterPath] = process.argv.slice(2);
const gestureModule = await import(pathToFileURL(gesturePath).href);
const adapterModule = await import(pathToFileURL(adapterPath).href);
const opencodeModule = await import(pathToFileURL(opencodePath).href);
const opencodeAdapterModule = await import(pathToFileURL(opencodeAdapterPath).href);
const herdrModule = await import(pathToFileURL(herdrPath).href);
const herdrAdapterModule = await import(pathToFileURL(herdrAdapterPath).href);

assert.equal(opencodeModule.isOpencodeTerminalIdentity({ command: "/usr/local/bin/opencode" }), true);
assert.equal(opencodeModule.isOpencodeTerminalIdentity({ processCommandLine: "node /opt/opencode/cli.js" }), true);
assert.equal(opencodeModule.isOpencodeTerminalIdentity({ title: "OpenCode" }), true);
assert.equal(opencodeModule.isOpencodeTerminalIdentity({ command: "herdr" }), false);
assert.equal(herdrModule.isHerdrTerminalIdentity({ command: "/usr/local/bin/herdr" }), true);
assert.equal(herdrModule.isHerdrTerminalIdentity({ title: "herdr" }), true);
assert.equal(herdrModule.isHerdrTerminalIdentity({ command: "opencode" }), false);
assert.equal(opencodeModule.isOpencodeFullscreenTouchCandidate({ command: "opencode" }, { mouseTracking: true }), true);
assert.equal(herdrModule.isHerdrFullscreenTouchCandidate({ command: "herdr" }, { mouseTracking: true }), true);
assert.equal(opencodeModule.isOpencodeFullscreenTouchCandidate({ command: "opencode" }, { mouseTracking: false }), false);

const gesture = gestureModule.createFullscreenTuiTouchGesture({ moveThresholdPx: 8 });
gesture.start({ identifier: 1, clientX: 20, clientY: 100 });
gesture.move({ identifier: 1, clientX: 20, clientY: 70 });
assert.equal(gesture.snapshot().phase, "scrolling");
assert.equal(gesture.takeWheelSteps(10), 3);
assert.equal(gesture.finish(1), "scrolling");

globalThis.window = globalThis;
class FakeShell {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  emit(type, event) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
}
const touch = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });
const event = (type, values = {}) => ({ type, touches: [], changedTouches: [], cancelable: true, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...values });
const runAdapter = (installer) => {
  const shell = new FakeShell();
  const state = { wheel: [], clicks: 0 };
  const cleanups = [];
  installer({
    shell,
    shouldStart: () => true,
    cellFromPoint: (x, y) => ({ col: Math.floor(x / 10), row: Math.floor(y / 10), absoluteRow: Math.floor(y / 10) }),
    activatePane: () => {}, markContextMenuCandidate: () => {}, blurInput: () => {}, suppressTouchScroll: () => {},
    applySelection: () => {}, updateSelectionHandles: () => {}, updateSelectionAutoScroll: () => {}, stopSelectionAutoScroll: () => {},
    clearSelectionIfTapOutside: () => false, hasSelection: () => false, consumeKeyboardClaim: () => false,
    prepareMouseInput: () => {}, rowHeight: () => 10, sendWheel: (steps) => state.wheel.push(steps), sendClick: () => { state.clicks += 1; },
    registerCleanup: (cleanup) => cleanups.push(cleanup), moveThresholdPx: 8, longPressDelayMs: 1000,
  });
  const point = touch(1, 20, 100);
  shell.emit("touchstart", event("touchstart", { touches: [point] }));
  shell.emit("touchmove", event("touchmove", { touches: [touch(1, 20, 70)] }));
  shell.emit("touchend", event("touchend", { changedTouches: [touch(1, 20, 70)] }));
  cleanups.forEach((cleanup) => cleanup());
  return state;
};
assert.deepEqual(runAdapter(adapterModule.installFullscreenTuiTouchAdapter).wheel, [3]);
assert.deepEqual(runAdapter(opencodeAdapterModule.installOpencodeFullscreenTouchAdapter).wheel, [3]);
assert.deepEqual(runAdapter(herdrAdapterModule.installHerdrFullscreenTouchAdapter).wheel, [3]);
`
	if err := os.WriteFile(runnerPath, []byte(runner), 0o600); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", runnerPath, err)
	}
	command := exec.Command(nodePath, runnerPath, gesturePath, adapterPath, opencodePath, opencodeAdapterPath, herdrPath, herdrAdapterPath)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("opencode/herdr fullscreen touch behavior failed: %v\n%s", err, output)
	}
}
