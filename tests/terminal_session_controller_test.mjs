import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalSessionController } from "../runtime/static/terminal/session/index.js";

const createResources = (events = []) => ({ id, ...options }) => ({
  compositionPreview: { id: `${id}-composition` },
  fitAddon: { id: `${id}-fit` },
  shellEl: {
    id: `${id}-shell`,
    remove() {
      events.push(`${id}:shell-remove`);
    },
  },
  term: {
    id: `${id}-term`,
    dispose() {
      events.push(`${id}:term-dispose`);
    },
  },
  terminalFrameHold: { id: `${id}-hold` },
  terminalHost: { id: `${id}-host` },
  terminalPreview: { id: `${id}-preview` },
  resourceOptions: options,
});

test("terminal session controller owns pane IDs and creates isolated flat state", () => {
  const resourceCalls = [];
  const workspaceIdentity = { selector: "instance-a", workspace: "workspace-a" };
  const controller = createTerminalSessionController({
    createResources(options) {
      resourceCalls.push(options);
      return createResources()(options);
    },
  });

  const first = controller.create({
    id: "pane-7",
    tabId: "tab-a",
    name: "instance-a",
    connect: false,
    cols: 80.9,
    rows: 24.8,
    cacheV2WorkspaceIdentity: workspaceIdentity,
    cacheV2Epoch: 4,
    baseTheme: { name: "default" },
  });
  const second = controller.create({
    tabId: "tab-b",
    name: "instance-a",
    connect: true,
    cols: 1,
    rows: 0,
  });

  assert.equal(first.id, "pane-7");
  assert.equal(second.id, "pane-8");
  assert.deepEqual(resourceCalls[0].initialTerminalOptions, { cols: 80, rows: 24 });
  assert.deepEqual(resourceCalls[1].initialTerminalOptions, {});
  assert.equal(first.initialCols, 80);
  assert.equal(first.initialRows, 24);
  assert.equal(first.pendingConnect, false);
  assert.equal(second.pendingConnect, true);
  assert.equal(first.cacheV2Epoch, 4);
  assert.deepEqual(first.cacheV2WorkspaceIdentity, workspaceIdentity);
  assert.notEqual(first.cacheV2WorkspaceIdentity, workspaceIdentity);

  first.pendingInput.push("input");
  first.inputQueue.push("queued");
  first.outputQueue.push("output");
  first.historyCacheWriteQueue.push("history");
  first.cacheV2NetworkQueue.push("cache");
  first.cacheV2WorkspaceIdentity.workspace = "mutated";

  assert.deepEqual(second.pendingInput, []);
  assert.deepEqual(second.inputQueue, []);
  assert.deepEqual(second.outputQueue, []);
  assert.deepEqual(second.historyCacheWriteQueue, []);
  assert.deepEqual(second.cacheV2NetworkQueue, []);
  assert.equal(workspaceIdentity.workspace, "workspace-a");
  assert.notEqual(first.replayController, second.replayController);
  assert.notEqual(first.resizeController, second.resizeController);
  assert.notEqual(first.renderSnapshot, second.renderSnapshot);
  assert.equal(Object.hasOwn(first, "cleanupCallbacks"), false);
});

test("session disposal marks closed before logical detach and preserves sibling sessions", () => {
  const events = [];
  const adapter = (name) => (session, options) => {
    events.push(`${session.id}:${name}${options?.resetAttempts ? ":reset" : ""}`);
  };
  const controller = createTerminalSessionController({
    createResources: createResources(events),
    lifecycleAdapters: {
      cancelFrameRelease: adapter("cancel-frame-release"),
      cancelScheduledResize: adapter("cancel-resize"),
      clearCanvasPixels: adapter("clear-canvas"),
      clearConnectionTimers: adapter("clear-connection-timers"),
      clearFullRenderValidation: adapter("clear-render-validation"),
      clearHistoryCacheWriteSchedule: adapter("clear-cache-write-schedule"),
      clearInputFlushTimer: adapter("clear-input-flush"),
      clearInputPumpTimer: adapter("clear-input-pump"),
      clearOverviewPreview: adapter("clear-overview-preview"),
      clearPendingInputExpiry: adapter("clear-pending-input"),
      clearPreparedPreview: adapter("clear-prepared-preview"),
      clearPresentationRetry: adapter("clear-presentation-retry"),
      clearReconnectTimer: adapter("clear-reconnect"),
      clearUnifiedRetry: adapter("clear-unified-retry"),
      detachLogicalStream(session, reason) {
        events.push(`${session.id}:detach:${reason}:closed=${session.closed}`);
      },
      disposeHistoryCache: adapter("dispose-history-cache"),
      disposeOutput: adapter("dispose-output"),
      flushHistoryCacheWrites: adapter("flush-history"),
      hideTerminalPreview: adapter("hide-preview"),
      releaseTerminalFrame: adapter("release-frame"),
      unregisterConnection(session, reason) {
        events.push(`${session.id}:unregister:${reason}`);
      },
    },
    windowObject: {
      cancelAnimationFrame(id) {
        events.push(`cancel-frame:${id}`);
      },
      cancelIdleCallback(id) {
        events.push(`cancel-idle:${id}`);
      },
      clearTimeout(id) {
        events.push(`clear-timeout:${id}`);
      },
    },
  });

  const first = controller.create({ id: "pane-1", tabId: "tab-a", name: "instance-a" });
  const sibling = controller.create({ id: "pane-2", tabId: "tab-a", name: "instance-a" });
  const siblingSocket = { readyState: "OPEN" };
  sibling.socket = siblingSocket;
  first.pendingInput = ["input"];
  first.pendingInputSize = 5;
  first.inputQueue = ["queued"];
  first.inputQueueSize = 6;
  first.cacheV2NetworkQueue = ["network"];
  first.cacheV2NetworkQueueBytes = 7;
  first.cursorBlinkHoldTimer = 11;
  first.connectionPriorityTimer = 12;
  first.connectionMeasurementFrame = 13;
  first.cacheV2PreviewCaptureTimer = 14;
  first.cacheV2PreviewCaptureIdle = 15;
  first.replayController.reset = () => events.push("pane-1:replay-reset");

  controller.addCleanup(first, () => events.push("pane-1:cleanup-a"));
  controller.addCleanup(first, () => {
    events.push("pane-1:cleanup-error");
    throw new Error("cleanup failure");
  });
  controller.addCleanup(first, () => events.push("pane-1:cleanup-b"));

  assert.equal(controller.dispose(first), true);
  assert.equal(controller.dispose(first), false);
  assert.equal(controller.isDisposed(first), true);
  assert.equal(first.closed, true);
  assert.equal(sibling.closed, false);
  assert.equal(sibling.socket, siblingSocket);
  assert.equal(sibling.term.id, "pane-2-term");
  assert.deepEqual(first.pendingInput, []);
  assert.deepEqual(first.inputQueue, []);
  assert.deepEqual(first.cacheV2NetworkQueue, []);
  assert.equal(first.cacheV2NetworkQueueBytes, 0);

  const flushIndex = events.indexOf("pane-1:flush-history");
  const resetIndex = events.indexOf("pane-1:replay-reset");
  const detachIndex = events.indexOf("pane-1:detach:session_closed:closed=true");
  const unregisterIndex = events.indexOf("pane-1:unregister:session_closed");
  const cleanupIndex = events.indexOf("pane-1:cleanup-a");
  const canvasIndex = events.indexOf("pane-1:clear-canvas");
  const termIndex = events.indexOf("pane-1:term-dispose");
  const shellIndex = events.indexOf("pane-1:shell-remove");
  assert.ok(flushIndex >= 0 && flushIndex < resetIndex);
  assert.ok(resetIndex < detachIndex && detachIndex < unregisterIndex);
  assert.ok(unregisterIndex < cleanupIndex && cleanupIndex < canvasIndex);
  assert.ok(events.includes("pane-1:dispose-history-cache"));
  assert.ok(canvasIndex < termIndex && termIndex < shellIndex);
  assert.equal(events.filter((entry) => entry.includes("pane-1:detach:")).length, 1);
  assert.equal(events.some((entry) => entry.startsWith("pane-2:")), false);
  assert.ok(events.indexOf("pane-1:cleanup-error") < events.indexOf("pane-1:cleanup-b"));
});

test("cleanup registered after close runs immediately and cannot leak into a later lifecycle", () => {
  const events = [];
  const controller = createTerminalSessionController({
    createResources: createResources(events),
  });
  const session = controller.create({ id: "pane-1" });

  assert.equal(controller.dispose(session), true);
  controller.addCleanup(session, () => events.push("late-cleanup"));
  assert.equal(events.at(-1), "late-cleanup");
  assert.equal(controller.dispose(session), false);
  assert.equal(events.filter((entry) => entry === "late-cleanup").length, 1);
});

test("session controller disposes all sessions through the shared lifecycle", () => {
  const events = [];
  const controller = createTerminalSessionController({
    createResources: createResources(events),
    lifecycleAdapters: {
      flushHistoryCacheWrites: (session) => events.push(`${session.id}:flush`),
      detachLogicalStream: (session, reason) => events.push(`${session.id}:detach:${reason}`),
      unregisterConnection: (session, reason) => events.push(`${session.id}:unregister:${reason}`),
    },
  });
  const first = controller.create({ id: "pane-1" });
  const second = controller.create({ id: "pane-2" });

  assert.equal(controller.disposeAll([first, second]), true);
  assert.equal(first.closed, true);
  assert.equal(second.closed, true);
  assert.equal(controller.disposeAll([first, second]), false);
  assert.deepEqual(events.filter((entry) => entry.endsWith(":flush")), ["pane-1:flush", "pane-2:flush"]);
  assert.deepEqual(
    events.filter((entry) => entry.includes(":detach:")),
    ["pane-1:detach:session_closed", "pane-2:detach:session_closed"],
  );
  assert.equal(events.filter((entry) => entry === "pane-1:term-dispose").length, 1);
  assert.equal(events.filter((entry) => entry === "pane-2:term-dispose").length, 1);
});
