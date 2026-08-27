package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestPiFullscreenTouchAdapter(t *testing.T) {
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
	piPath := filepath.Join(workingDirectory, "runtime", "static", "pi_fullscreen_touch.js")
	piAdapterPath := filepath.Join(workingDirectory, "runtime", "static", "pi_fullscreen_touch_adapter.js")
	runnerPath := filepath.Join(t.TempDir(), "pi_fullscreen_touch_test.mjs")
	runner := `
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [gesturePath, adapterPath, piPath, piAdapterPath] = process.argv.slice(2);
const gestureModule = await import(pathToFileURL(gesturePath).href);
const adapterModule = await import(pathToFileURL(adapterPath).href);
const piModule = await import(pathToFileURL(piPath).href);
const piAdapterModule = await import(pathToFileURL(piAdapterPath).href);
globalThis.window = globalThis;

assert.equal(piModule.isPiTerminalIdentity({ command: "/usr/local/bin/pi" }), true);
assert.equal(piModule.isPiTerminalIdentity({ processCommandLine: "node /opt/pi/cli.js" }), true);
assert.equal(piModule.isPiTerminalIdentity({ title: "pi" }), true);
assert.equal(piModule.isPiTerminalIdentity({ command: "opencode" }), false);
assert.equal(piModule.isPiFullscreenTouchCandidate({ command: "pi" }, { mouseTracking: true }), true);
assert.equal(piModule.isPiFullscreenTouchCandidate({ command: "pi" }, { mouseTracking: false }), false);

const gesture = gestureModule.createFullscreenTuiTouchGesture({ moveThresholdPx: 8 });
gesture.start({ identifier: 1, clientX: 20, clientY: 100 });
gesture.move({ identifier: 1, clientX: 20, clientY: 70 });
assert.equal(gesture.snapshot().phase, "scrolling");
assert.equal(gesture.takeWheelSteps(10), 3);

class FakeShell {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  emit(type, event) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
}
const touch = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });
const event = (values = {}) => ({ touches: [], changedTouches: [], cancelable: true, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...values });
const runAdapter = (installer) => {
  const shell = new FakeShell();
  const state = { wheel: [] };
  const cleanups = [];
  installer({
    shell, shouldStart: () => true,
    cellFromPoint: (x, y) => ({ col: Math.floor(x / 10), row: Math.floor(y / 10), absoluteRow: Math.floor(y / 10) }),
    activatePane: () => {}, markContextMenuCandidate: () => {}, blurInput: () => {}, suppressTouchScroll: () => {},
    applySelection: () => {}, updateSelectionHandles: () => {}, updateSelectionAutoScroll: () => {}, stopSelectionAutoScroll: () => {},
    clearSelectionIfTapOutside: () => false, hasSelection: () => false, consumeKeyboardClaim: () => false,
    prepareMouseInput: () => {}, rowHeight: () => 10, sendWheel: (steps) => state.wheel.push(steps), sendClick: () => {},
    registerCleanup: (cleanup) => cleanups.push(cleanup), moveThresholdPx: 8, longPressDelayMs: 1000,
  });
  shell.emit("touchstart", event({ touches: [touch(1, 20, 100)] }));
  shell.emit("touchmove", event({ touches: [touch(1, 20, 70)] }));
  shell.emit("touchend", event({ changedTouches: [touch(1, 20, 70)] }));
  cleanups.forEach((cleanup) => cleanup());
  return state;
};
assert.deepEqual(runAdapter(adapterModule.installFullscreenTuiTouchAdapter).wheel, [3]);
assert.deepEqual(runAdapter(piAdapterModule.installPiFullscreenTouchAdapter).wheel, [3]);
`
	if err := os.WriteFile(runnerPath, []byte(runner), 0o600); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", runnerPath, err)
	}
	command := exec.Command(nodePath, runnerPath, gesturePath, adapterPath, piPath, piAdapterPath)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("pi fullscreen touch behavior failed: %v\n%s", err, output)
	}
}
