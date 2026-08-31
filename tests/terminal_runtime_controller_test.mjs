import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalRuntimeController } from "../runtime/static/terminal/rendering/index.js";

const createHarness = ({ resetError = null, clearError = null } = {}) => {
  const calls = [];
  const term = {
    wasmTerm: { write: (value) => calls.push(["write", value]) },
    viewportY: 8,
    targetViewportY: 9,
    linkDetector: { invalidateCache: () => calls.push("links") },
    requestRender: (options) => calls.push(["render", options]),
    reset() {
      calls.push("reset");
      if (resetError) throw resetError;
    },
    clear() {
      calls.push("clear");
      if (clearError) throw clearError;
    },
    beginRenderSuppression: () => calls.push("suppress-begin"),
    endRenderSuppression: (options) => calls.push(["suppress-end", options]),
  };
  const session = {
    id: "pane-1",
    name: "demo",
    measuredFitGeneration: 1,
    initialRuntimeResetDone: false,
    term,
  };
  const controller = createTerminalRuntimeController({
    advanceContentGeneration: () => calls.push("generation"),
    isRenderAllowed: () => true,
    clearCanvas: () => calls.push("canvas"),
    syncSelectionRuntime: () => calls.push("selection"),
    syncRendererRuntime: () => calls.push("renderer"),
    appendDebugWarning: (...args) => calls.push(["warning", ...args]),
    appendDebugError: (...args) => calls.push(["error", ...args]),
  });
  return { calls, controller, session, term };
};

test("terminal runtime reset synchronizes references and clears without exposing intermediate replay frames", () => {
  const harness = createHarness();
  assert.equal(harness.controller.reset(harness.session), true);
  assert.deepEqual(harness.calls, [
    "reset",
    "selection",
    "links",
    "renderer",
    ["write", "\x1b[2J\x1b[3J\x1b[H"],
    "generation",
    "links",
    ["render", { full: true }],
    "canvas",
  ]);
  assert.equal(harness.term.viewportY, 0);
  assert.equal(harness.term.targetViewportY, 0);
  assert.equal(harness.controller.resetAfterInitialFit(harness.session), true);
  assert.equal(harness.session.initialRuntimeResetDone, true);
  assert.equal(harness.controller.resetAfterInitialFit(harness.session), false);
});

test("terminal runtime reset keeps the existing terminal alive through fallback clear", () => {
  const harness = createHarness({ resetError: new Error("reset failed") });
  assert.equal(harness.controller.reset(harness.session), true);
  assert.ok(harness.calls.some((value) => Array.isArray(value) && value[0] === "warning"));
  assert.ok(harness.calls.includes("clear"));
  assert.ok(harness.calls.includes("canvas"));

  const failed = createHarness({
    resetError: new Error("reset failed"),
    clearError: new Error("clear failed"),
  });
  assert.equal(failed.controller.reset(failed.session), false);
  assert.ok(failed.calls.some((value) => Array.isArray(value) && value[0] === "error"));
});

test("terminal runtime suppression keeps one scope per reason and rejects unknown releases", () => {
  const harness = createHarness();
  assert.equal(harness.controller.beginRenderSuppression(harness.session, "replay"), true);
  assert.equal(harness.controller.beginRenderSuppression(harness.session, "resize"), true);
  assert.equal(harness.controller.beginRenderSuppression(harness.session, "replay"), true);
  assert.equal(harness.calls.filter((value) => value === "suppress-begin").length, 1);
  assert.equal(harness.controller.endRenderSuppression(harness.session, { reason: "resize" }), true);
  assert.equal(harness.calls.filter((value) => Array.isArray(value) && value[0] === "suppress-end").length, 0);
  assert.equal(harness.controller.endRenderSuppression(harness.session, { reason: "replay", render: false }), true);
  assert.equal(harness.calls.filter((value) => Array.isArray(value) && value[0] === "suppress-end").length, 1);
  assert.deepEqual(harness.calls.at(-1), ["suppress-end", { render: false, full: true }]);
  assert.equal(harness.controller.endRenderSuppression(harness.session, { reason: "replay" }), false);
  assert.equal(harness.controller.dispose(), true);
  assert.equal(harness.controller.dispose(), false);
  assert.equal(harness.controller.clearBuffer(harness.session), false);
});
