import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTerminalInputQueueItems,
  createTerminalInputController,
  isGeneratedTerminalResponse,
  isGeneratedTerminalResponseTail,
  splitTerminalInputChunks,
} from "../runtime/static/terminal/input/index.js";

const createWindowHarness = () => {
  let nextHandle = 1;
  const timers = new Map();
  const windowObject = {
    setTimeout(callback) {
      const handle = nextHandle++;
      timers.set(handle, callback);
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
  };
  return {
    windowObject,
    timers,
    runNextTimer() {
      const entry = timers.entries().next().value;
      if (!entry) {
        return false;
      }
      const [handle, callback] = entry;
      timers.delete(handle);
      callback();
      return true;
    },
    runTimers(limit = 100) {
      let count = 0;
      while (count < limit && this.runNextTimer()) {
        count += 1;
      }
      return count;
    },
  };
};

const createSession = ({ id = "pane-1", replayCommitted = true } = {}) => {
  let dataCallback = null;
  let dataDisposed = false;
  const session = {
    id,
    tabId: "tab-1",
    name: "demo",
    closed: false,
    exitExpected: false,
    replayCommitted,
    replayOutputDepth: 0,
    allowGeneratedInputDuringReplay: false,
    suppressGeneratedTerminalInputUntil: 0,
    processingGeneratedTerminalResponses: false,
    resizeAckPending: false,
    appliedResizeEpoch: "42",
    connectionChannel: "unified",
    connectionChannelGeneration: 7,
    connectionLeaseID: 0,
    connectionLeaseClosing: false,
    shellEl: { dataset: {} },
    socketOpen: true,
    bufferedAmount: 0,
    pendingInput: [],
    pendingInputSize: 0,
    pendingInputExpiryTimer: 0,
    pendingInputQueuedAt: 0,
    pendingInputExpiryToken: 0,
    pendingInputExpiryLeaseID: 0,
    pendingInputExpiryGeneration: 0,
    pendingInputExpiryPaused: false,
    inputBuffer: "",
    inputBufferSize: 0,
    inputFlushTimer: 0,
    inputQueue: [],
    inputQueueSize: 0,
    inputPumpTimer: 0,
    inputPumpActive: false,
    term: {
      onData(callback) {
        dataCallback = callback;
        return { dispose: () => { dataDisposed = true; } };
      },
    },
  };
  return {
    session,
    emit(data) {
      dataCallback?.(data);
    },
    dataDisposed: () => dataDisposed,
  };
};

const createHarness = (options = {}) => {
  const windowHarness = createWindowHarness();
  const sent = [];
  const healthChecks = [];
  const activityDelays = [];
  const marks = [];
  const cleanups = [];
  const clock = { value: 1000 };
  const sessions = options.sessions || [];
  const controller = createTerminalInputController({
    windowObject: windowHarness.windowObject,
    getSessions: () => sessions,
    isKittyGraphicsResponse: (data) => data === "kitty-response",
    isReplayCommitted: (session) => session.replayCommitted === true,
    isSocketOpen: (session) => session.socketOpen === true,
    getCurrentLease: (session) => session.currentLease || null,
    isClientTarget: (name) => String(name).startsWith("client:"),
    getResizeSize: () => ({ cols: 100, rows: 30, pixelWidth: 1000, pixelHeight: 600 }),
    normalizeResizeEpoch: (value) => String(value || ""),
    getThemePayload: () => ({ foreground: "#fff", background: "#000", cursor: "#fff" }),
    sendPayload: (_session, payload) => {
      sent.push(payload);
      return true;
    },
    getBufferedAmount: (session) => session.bufferedAmount,
    checkConnectionHealth: (_session, checkOptions) => {
      healthChecks.push(checkOptions);
      return true;
    },
    requestConnection: (_session, requestOptions) => marks.push(["request", requestOptions.reason]),
    markUserInput: () => marks.push(["user"]),
    scrollToBottom: () => marks.push(["bottom"]),
    scheduleActivityRefresh: (delay) => activityDelays.push(delay),
    holdCursorVisible: () => marks.push(["cursor"]),
    reassertSize: () => marks.push(["resize"]),
    registerSessionCleanup: (_session, cleanup) => cleanups.push(cleanup),
    now: () => clock.value,
    ...options.controllerOptions,
  });
  return {
    controller,
    sent,
    healthChecks,
    activityDelays,
    marks,
    cleanups,
    clock,
    windowHarness,
  };
};

test("input model classifies generated responses and chunks Unicode without splitting surrogates", () => {
  assert.equal(isGeneratedTerminalResponse("\x1b[12;34R"), true);
  assert.equal(isGeneratedTerminalResponse("kitty", { isKittyGraphicsResponse: (data) => data === "kitty" }), true);
  assert.equal(isGeneratedTerminalResponse("normal input"), false);
  assert.equal(isGeneratedTerminalResponseTail("12;34R"), true);
  assert.deepEqual(splitTerminalInputChunks("a😀b", 2), ["a", "😀", "b"]);

  const accepted = buildTerminalInputQueueItems("a😀b", { chunkChars: 2, maxBytes: 6 });
  assert.equal(accepted.exceeded, false);
  assert.equal(accepted.byteLength, 6);
  assert.deepEqual(accepted.items.map((item) => item.data), ["a", "😀", "b"]);
  assert.equal(buildTerminalInputQueueItems("a😀b", { maxBytes: 5 }).exceeded, true);
});

test("controller marks generated payloads and suppresses replay callbacks", () => {
  const runtime = createSession();
  const harness = createHarness({ sessions: [runtime.session] });
  harness.controller.installSession(runtime.session);

  runtime.emit("x");
  assert.equal(harness.sent.length, 1);
  assert.deepEqual(harness.sent[0], {
    type: "input",
    data: "x",
    foreground: "#fff",
    background: "#000",
    cursor: "#fff",
    cols: 100,
    rows: 30,
    pixel_width: 1000,
    pixel_height: 600,
    resize_epoch: "42",
  });
  assert.ok(harness.marks.some(([name]) => name === "cursor"));
  assert.ok(harness.marks.some(([name]) => name === "resize"));
  assert.ok(harness.marks.some(([name]) => name === "request"));

  runtime.emit("\x1b[12;34R");
  assert.equal(harness.sent.length, 2);
  assert.equal(harness.sent[1].generated, true);
  assert.equal("cols" in harness.sent[1], false);

  runtime.session.replayOutputDepth = 1;
  runtime.emit("\x1b[1;2R");
  assert.equal(harness.sent.length, 2);

});

test("steady input does not reassert an already presented terminal size", () => {
  const runtime = createSession();
  runtime.session.renderReady = true;
  runtime.session.sizeClaimRequired = false;
  runtime.session.resizeAckPending = false;
  runtime.session.activationFitPending = false;
  const harness = createHarness({ sessions: [runtime.session] });
  harness.controller.installSession(runtime.session);

  runtime.emit("steady input");
  assert.equal(harness.marks.some(([name]) => name === "resize"), false);
});

test("controller applies bounded backpressure and preserves pending input across replay readiness", () => {
  const runtime = createSession();
  const harness = createHarness({
    sessions: [runtime.session],
    controllerOptions: {
      chunkChars: 4,
      pumpChunkBudget: 1,
      backpressureBytes: 10,
      backpressureDelayMs: 1,
      pendingMaxWaitMs: 1,
    },
  });

  runtime.session.bufferedAmount = 20;
  assert.equal(harness.controller.sendOrQueue(runtime.session, "abcdef"), true);
  assert.equal(runtime.session.inputQueue.length, 2);
  harness.windowHarness.runNextTimer();
  assert.equal(harness.sent.length, 0);
  assert.equal(runtime.session.inputQueue.length, 2);

  runtime.session.bufferedAmount = 0;
  harness.windowHarness.runTimers();
  assert.deepEqual(harness.sent.map((payload) => payload.data), ["abcd", "ef"]);
  assert.equal(runtime.session.inputQueue.length, 0);
  assert.equal(runtime.session.inputQueueSize, 0);

  runtime.session.replayCommitted = false;
  assert.equal(harness.controller.sendOrQueue(runtime.session, "later"), false);
  assert.deepEqual(runtime.session.pendingInput, ["later"]);
  assert.ok(runtime.session.pendingInputExpiryTimer);
  harness.windowHarness.runNextTimer();
  assert.deepEqual(runtime.session.pendingInput, ["later"]);
  assert.equal(harness.healthChecks.at(-1).force, true);
  assert.ok(runtime.session.pendingInputExpiryTimer);

  runtime.session.replayCommitted = true;
  assert.equal(harness.controller.flushPending(runtime.session), true);
  harness.windowHarness.runTimers();
  assert.equal(harness.sent.slice(-2).map((payload) => payload.data).join(""), "later");
  assert.deepEqual(runtime.session.pendingInput, []);
  assert.equal(runtime.session.pendingInputExpiryTimer, 0);
});

test("input lifecycle clears queues, timers, and Ghostty data listeners", () => {
  const first = createSession({ id: "pane-1" });
  const second = createSession({ id: "pane-2" });
  const harness = createHarness({ sessions: [first.session, second.session] });
  harness.controller.installSession(first.session);
  harness.controller.installSession(second.session);

  first.session.pendingInput = ["pending"];
  first.session.pendingInputSize = 7;
  first.session.inputQueue = [{ data: "queue", byteLength: 5, generated: false }];
  first.session.inputQueueSize = 5;
  first.session.inputPumpTimer = harness.windowHarness.windowObject.setTimeout(() => {}, 10);
  harness.controller.disposeSession(first.session);

  assert.deepEqual(first.session.pendingInput, []);
  assert.deepEqual(first.session.inputQueue, []);
  assert.equal(first.session.inputPumpTimer, 0);
  assert.equal(first.dataDisposed(), true);
  const sentBeforeLateData = harness.sent.length;
  first.emit("late");
  assert.equal(harness.sent.length, sentBeforeLateData);

  harness.controller.dispose();
  assert.equal(second.dataDisposed(), true);
  assert.equal(harness.controller.sendOrQueue(second.session, "late"), false);
});
