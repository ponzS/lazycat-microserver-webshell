import assert from "node:assert/strict";
import test from "node:test";
import { RenderSnapshot } from "./runtime/static/terminal_render_snapshot.js";

test("RenderSnapshot freezes identity, cursor, geometry, and render state", () => {
  const snapshot = RenderSnapshot.fromSession({
    terminalContentGeneration: 4,
    historyGeneration: "hg-2",
    appliedHistoryCursor: 42n,
    appliedResizeEpoch: "8",
    term: { cols: 100, rows: 30 },
    serverPixelWidth: 800,
    serverPixelHeight: 480,
    measuredFitGeneration: 5,
    terminalReplayGeneration: 6,
    renderGeneration: 7,
    hasPresentedFrame: true,
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.geometry), true);
  assert.equal(snapshot.appliedCursor, "42");
  assert.equal(snapshot.geometry.cols, 100);
  assert.equal(snapshot.resizeEpoch, "8");
});

test("RenderSnapshot equality detects stale content, cursor, resize, and geometry", () => {
  const source = {
    terminalContentGeneration: 1,
    historyGeneration: "hg",
    appliedHistoryCursor: 3n,
    appliedResizeEpoch: "2",
    term: { cols: 80, rows: 24 },
    measuredFitGeneration: 1,
    terminalReplayGeneration: 1,
    renderGeneration: 1,
  };
  const snapshot = RenderSnapshot.fromSession(source);
  assert.equal(snapshot.equals(RenderSnapshot.fromSession(source)), true);
  assert.equal(snapshot.equals(RenderSnapshot.fromSession({ ...source, appliedHistoryCursor: 4n })), false);
  assert.equal(snapshot.equals(RenderSnapshot.fromSession({ ...source, appliedResizeEpoch: "3" })), false);
  assert.equal(snapshot.equals(RenderSnapshot.fromSession({ ...source, term: { cols: 81, rows: 24 } })), false);
});
