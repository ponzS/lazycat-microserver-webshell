import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalSessionRecoveryController } from "../runtime/static/terminal/session/index.js";

const makeSession = (overrides = {}) => ({
  id: "pane-1",
  name: "demo",
  socket: { id: "socket-1" },
  shellEl: { dataset: {} },
  term: { viewportY: 4, targetViewportY: 5 },
  replayController: { reset: () => {} },
  ...overrides,
});
test("session recovery detaches only the current socket and resets replay state", () => {
  const events = [];
  const session = makeSession({ replayComplete: true });
  const socket = session.socket;
  const controller = createTerminalSessionRecoveryController({
    clearOutputSettle: () => events.push("clear-resize"),
    resetReplayController: () => events.push("reset-replay"),
    setReplayAuthorization: (_session, value) => events.push(["auth", value]),
    clearConnectionTimers: () => events.push("clear-timers"),
    endRenderSuppression: (_session, options) => events.push(["end", options.reason]),
  });

  assert.equal(controller.detachSessionSocket(session, socket, { connection: "reconnecting" }), true);
  assert.equal(session.socket, null);
  assert.equal(session.replayComplete, false);
  assert.deepEqual(session.shellEl.dataset, { connection: "reconnecting" });
  assert.ok(events.indexOf("clear-resize") < events.indexOf("reset-replay"));
  assert.equal(controller.detachSessionSocket(session, socket), false);
});

test("history reset requires the active target and a known size, then holds presentation", () => {
  const events = [];
  const session = makeSession({ measuredFitGeneration: 7 });
  let hasSize = false;
  const controller = createTerminalSessionRecoveryController({
    getActiveName: () => "demo",
    hasKnownSize: () => hasSize,
    beginRenderSuppression: () => events.push("hold"),
    discardOutput: () => events.push("discard"),
    markPresentationSyncPending: () => events.push("sync-pending"),
    resetRuntimeState: () => { events.push("runtime-reset"); return true; },
    cancelPendingRender: () => events.push("cancel-render"),
    clearSelection: () => events.push("clear-selection"),
    setReplayAuthorization: (_session, value) => events.push(["auth", value]),
    resetHostViewport: () => events.push("reset-host"),
    positionInput: () => events.push("position-input"),
    measureTask: (_name, task) => task(),
  });

  assert.equal(controller.resetTerminalForHistoryReplay(session), false);
  assert.equal(session.lastHistoryResetFailureReason, "terminal_size_unavailable");
  hasSize = true;
  assert.equal(controller.resetTerminalForHistoryReplay(session), true);
  assert.equal(session.lastHistoryResetFailureReason, "");
  assert.equal(session.term.viewportY, 0);
  assert.ok(events.indexOf("hold") < events.indexOf("discard"));
  assert.ok(events.indexOf("discard") < events.indexOf("runtime-reset"));
  assert.ok(events.includes("reset-host"));
});

test("history resync uses Unified recycle or direct socket reconnect and is fenced by dispose", () => {
  const events = [];
  const unified = makeSession({ connectionChannel: "unified" });
  const direct = makeSession({ connectionChannel: "fast" });
  const controller = createTerminalSessionRecoveryController({
    getActiveName: () => "demo",
    resetReplayController: () => events.push("reset"),
    discardOutput: () => events.push("discard"),
    recycleUnifiedSession: (_session, reason, options) => events.push(["recycle", reason, options]),
    closeSocketForReconnect: (_session, socket, reason) => events.push(["close", socket, reason]),
    requestConnection: (_session, options) => events.push(["request", options]),
    setReplayAuthorization: (_session, value) => events.push(["auth", value]),
  });

  assert.equal(controller.requestSessionHistoryReplay(unified), true);
  assert.equal(events.some(([kind]) => kind === "recycle"), true);
  assert.equal(controller.requestSessionHistoryReplay(direct), true);
  assert.equal(events.some(([kind]) => kind === "close"), true);
  assert.equal(events.some(([kind]) => kind === "request"), true);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.requestSessionHistoryReplay(makeSession()), false);
});
