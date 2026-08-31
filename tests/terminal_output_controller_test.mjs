import assert from "node:assert/strict";
import test from "node:test";

import {
  coalesceTerminalOutputBatch,
  createTerminalOutputController,
  splitTerminalOutputText,
  terminalOutputByteChunkEnd,
  terminalOutputByteLength,
} from "../runtime/static/terminal/output/index.js";

const createWindowHarness = () => {
  let nextHandle = 1;
  const frames = new Map();
  const timers = new Map();
  const windowObject = {
    requestAnimationFrame(callback) {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle);
    },
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
    frames,
    timers,
    runFrame() {
      const entry = frames.entries().next().value;
      if (!entry) {
        return false;
      }
      const [handle, callback] = entry;
      frames.delete(handle);
      callback();
      return true;
    },
  };
};

const createSession = ({ replayCommitted = true } = {}) => {
  const writes = [];
  const replayWrites = [];
  const session = {
    id: "pane-1",
    tabId: "tab-1",
    name: "target-1",
    closed: false,
    replayCommitted,
    replayOutputDepth: 0,
    allowGeneratedInputDuringReplay: false,
    historyProtocolActive: true,
    historyGeneration: "history-1",
    receivedHistoryCursor: 0n,
    appliedHistoryCursor: 0n,
    connectionEpoch: 3,
    connectionChannel: "unified",
    connectionChannelGeneration: 7,
    outputQueue: [],
    outputQueueSize: 0,
    outputQueueGeneration: 0,
    outputOverloadPending: false,
    outputFlushFrame: 0,
    outputFlushTimer: 0,
    queueTurnReceivedCursor: null,
    queueTurnReceivedSequence: null,
    pendingQueueTurnAck: null,
    term: {
      write(data) {
        writes.push(data);
      },
      writeReplay(data) {
        replayWrites.push(data);
      },
      requestRenderCalls: 0,
      requestRender() {
        this.requestRenderCalls += 1;
      },
    },
  };
  session.socket = {
    sent: [],
    send(payload) {
      this.sent.push(payload);
    },
  };
  return { session, writes, replayWrites };
};

const createHarness = ({ sessionOptions, controllerOptions } = {}) => {
  const clock = createWindowHarness();
  const runtime = createSession(sessionOptions);
  const historyWrites = [];
  const events = [];
  const metrics = [];
  const maxMetrics = [];
  const acknowledgements = [];
  const recoveries = [];
  let replayRequests = 0;
  let finishCalls = 0;
  let holds = 0;
  let now = 100;
  const controller = createTerminalOutputController({
    windowObject: clock.windowObject,
    getActiveName: () => "target-1",
    isReplayCommitted: (session) => session.replayCommitted === true,
    getResizeTransition: (session) => session.resizeTransition || {},
    noteResizeOutput: (session) => { session.resizeOutputNoted = true; },
    requestHistoryReplay: () => { replayRequests += 1; },
    finishHistoryReplayIfReady: () => { finishCalls += 1; return false; },
    queueHistoryCacheWrite: (_session, data, startCursor, endCursor) => {
      historyWrites.push({ data, startCursor, endCursor });
    },
    scheduleReplayPresentationCheckpoint: (session) => { session.checkpointScheduled = true; },
    beginPresentationHold: () => { holds += 1; },
    isRenderAllowed: () => true,
    advanceContentGeneration: (session) => { session.contentGeneration = Number(session.contentGeneration || 0) + 1; },
    deferHiddenRender: () => false,
    cancelPendingRender: () => {},
    schedulePresentationValidation: (session) => { session.validationScheduled = true; },
    armReplayGeneratedSuppression: (session) => { session.replaySuppressionArmed = true; },
    drainGeneratedResponses: (session) => { session.generatedResponsesDrained = true; },
    resetHostViewport: (session) => { session.hostReset = true; },
    positionInput: (session) => { session.inputPositioned = true; },
    sendQueueTurnAck: (_session, _pending, payload) => {
      acknowledgements.push(payload);
      return true;
    },
    recoverQueueTurnAck: (...args) => recoveries.push(args),
    recordMetric: (name, value) => metrics.push([name, value]),
    recordMaxMetric: (name, value) => maxMetrics.push([name, value]),
    recordEvent: (_session, event, details) => events.push([event, details]),
    measureTask: (_name, task) => task(),
    recordPerformanceTask: (name, duration) => metrics.push([name, duration]),
    now: () => now++,
    onDiscard: (session) => { session.discardBoundaryCalled = true; },
    ...controllerOptions,
  });
  controller.installSession(runtime.session);
  return {
    ...runtime,
    acknowledgements,
    clock,
    controller,
    events,
    finishCalls: () => finishCalls,
    historyWrites,
    holds: () => holds,
    maxMetrics,
    metrics,
    recoveries,
    replayRequests: () => replayRequests,
  };
};

test("output model measures and splits Unicode while preserving byte order", () => {
  assert.equal(terminalOutputByteLength("a😀b"), 6);
  assert.deepEqual(splitTerminalOutputText("a😀b", 4), ["a", "😀", "b"]);

  const encoded = new TextEncoder().encode("éx");
  assert.equal(terminalOutputByteChunkEnd(encoded, 0, 2), 2);
  assert.deepEqual(
    Array.from(coalesceTerminalOutputBatch([encoded.subarray(0, 2), encoded.subarray(2)], "bytes", 3)),
    Array.from(encoded),
  );
  assert.equal(coalesceTerminalOutputBatch(["ab", "cd"], "text", 4), "abcd");
});

test("controller drains ordered output, commits history cursors, and rejects stale generations", () => {
  const harness = createHarness();
  const data = new Uint8Array([65, 66, 67, 68]);
  assert.equal(harness.controller.write(harness.session, data, { startCursor: 0n, endCursor: 4n }), true);
  assert.equal(harness.controller.getQueuedBytes(harness.session), 4);
  assert.equal(harness.clock.frames.size, 1);
  assert.equal(harness.clock.timers.size, 1);

  harness.clock.runFrame();
  assert.equal(harness.controller.hasQueued(harness.session), false);
  assert.equal(harness.session.appliedHistoryCursor, 4n);
  assert.deepEqual(Array.from(harness.writes[0]), Array.from(data));
  assert.equal(harness.historyWrites.length, 1);
  assert.equal(harness.session.term.requestRenderCalls, 1);
  assert.equal(harness.clock.timers.size, 0);

  harness.controller.write(harness.session, new Uint8Array([69]), { startCursor: 4n, endCursor: 5n });
  harness.session.connectionEpoch += 1;
  harness.controller.flush(harness.session);
  assert.equal(harness.controller.hasQueued(harness.session), false);
  assert.equal(harness.session.resetOnNextReplay, true);
  assert.equal(harness.holds(), 1);
  assert.ok(harness.metrics.some(([name]) => name === "staleOutputQueueDrops"));
});

test("controller uses bounded drain and sends Queue turn ACK only after bytes are parsed", () => {
  const harness = createHarness({
    controllerOptions: {
      flushBudgetBytes: 4,
      flushMaxEntries: 1,
      flushTimeBudgetMs: 100,
      replayWriteBatchBytes: 4,
      queueSoftLimitBytes: 1024,
    },
  });
  const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  harness.controller.noteQueueTurnFrame(harness.session, { endCursor: 8n, sequence: 2 });
  harness.controller.write(harness.session, data, { startCursor: 0n, endCursor: 8n, deferRender: true });

  const result = harness.controller.completeQueueTurn(harness.session, {
    appliedCursor: "8",
    appliedSequence: "2",
    socket: harness.session.socket,
    connectionEpoch: 3,
    channelGeneration: 7,
  });
  assert.equal(result.status, "accepted");
  assert.equal(harness.controller.getQueueEntryCount(harness.session), 1);
  assert.equal(harness.session.appliedHistoryCursor, 4n);
  assert.equal(harness.acknowledgements.length, 0);

  harness.controller.flush(harness.session, { maxBytes: 4, maxEntries: 1, scheduleRemainder: false });
  assert.equal(harness.session.appliedHistoryCursor, 8n);
  assert.equal(harness.acknowledgements.length, 1);
  assert.deepEqual(harness.acknowledgements[0], { type: "queue-turn-ack", data: "8:2" });
  assert.ok(harness.events.some(([event]) => event === "queue_turn_ack_pending"));
  assert.ok(harness.events.some(([event]) => event === "queue_turn_ack_sent"));

  const invalid = harness.controller.completeQueueTurn(harness.session, {
    appliedCursor: "9",
    appliedSequence: "2",
    socket: harness.session.socket,
    connectionEpoch: 3,
    channelGeneration: 7,
  });
  assert.equal(invalid.status, "invalid");
});

test("default Queue turn ACK serializer validates the current unified identity", () => {
  const harness = createHarness({
    controllerOptions: {
      sendQueueTurnAck: undefined,
    },
  });
  harness.controller.noteQueueTurnFrame(harness.session, { endCursor: 4n, sequence: 1 });
  harness.controller.write(harness.session, new Uint8Array([1, 2, 3, 4]), {
    startCursor: 0n,
    endCursor: 4n,
    deferRender: true,
  });
  assert.equal(harness.controller.completeQueueTurn(harness.session, {
    appliedCursor: "4",
    appliedSequence: "1",
    socket: harness.session.socket,
    connectionEpoch: 3,
    channelGeneration: 7,
  }).status, "accepted");
  harness.controller.flush(harness.session, { force: true, scheduleRemainder: false });
  assert.deepEqual(JSON.parse(harness.session.socket.sent.at(-1)), {
    type: "queue-turn-ack",
    data: "4:1",
  });

  harness.session.connectionChannelGeneration = 8;
  harness.controller.noteQueueTurnFrame(harness.session, { endCursor: 8n, sequence: 2 });
  harness.controller.write(harness.session, new Uint8Array([5, 6, 7, 8]), {
    startCursor: 4n,
    endCursor: 8n,
    deferRender: true,
  });
  harness.controller.completeQueueTurn(harness.session, {
    appliedCursor: "8",
    appliedSequence: "2",
    socket: harness.session.socket,
    connectionEpoch: 3,
    channelGeneration: 7,
  });
  harness.controller.flush(harness.session, { force: true, scheduleRemainder: false });
  assert.equal(harness.session.socket.sent.length, 1);
});

test("controller requests resync on overload and clears lifecycle resources on dispose", () => {
  const harness = createHarness({
    controllerOptions: {
      flushBudgetBytes: 4,
      replayWriteBatchBytes: 4,
      queueSoftLimitBytes: 1024,
      maxQueuedBytes: 6,
    },
  });
  assert.equal(harness.controller.write(harness.session, new Uint8Array(8)), false);
  assert.equal(harness.replayRequests(), 1);
  assert.equal(harness.session.outputOverloadPending, true);
  assert.equal(harness.controller.getQueuedBytes(harness.session), 4);
  assert.equal(harness.controller.scheduleFlush(harness.session), true);
  assert.equal(harness.clock.frames.size, 1);
  assert.equal(harness.clock.timers.size, 1);

  const lateFrame = harness.clock.frames.values().next().value;
  assert.equal(harness.controller.disposeSession(harness.session), true);
  assert.equal(harness.controller.getQueuedBytes(harness.session), 0);
  assert.equal(harness.clock.frames.size, 0);
  assert.equal(harness.clock.timers.size, 0);
  assert.equal(harness.session.discardBoundaryCalled, true);
  lateFrame?.();
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.controller.write(harness.session, new Uint8Array([1])), false);
  assert.equal(harness.controller.dispose(), true);
  assert.equal(harness.controller.dispose(), false);
});
