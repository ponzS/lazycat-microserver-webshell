import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalCacheReplayController } from "../runtime/static/terminal/history/index.js";

const immediateProgressTimeout = (operation) => operation(() => {});

const createWarmSession = () => ({
  appliedHistoryCursor: 0n,
  cacheV2NetworkQueue: [],
  cacheV2NetworkQueueBytes: 0,
  cacheV2WarmReplayActive: false,
  cacheV2WarmReplayPromise: null,
  cacheV2WarmReplayReady: false,
  cacheV2WarmReplaySeq: 0,
  closed: false,
  connectionChannel: "unified",
  hasPresentedFrame: false,
  measuredFitGeneration: 4,
  resetOnNextReplay: false,
  terminalFrameHeld: false,
  terminalReplayGeneration: 3,
});

test("warm cache replay parses every chunk without committing an intermediate presentation", async () => {
  const events = [];
  const presentationEvents = [];
  const snapshot = {
    baseCursor: 0n,
    chunks: [{}, {}],
    endCursor: 4n,
    historyGeneration: "history-1",
  };
  const chunks = [
    { data: new Uint8Array([1, 2]), startCursor: 0n, endCursor: 2n },
    { data: new Uint8Array([3, 4]), startCursor: 2n, endCursor: 4n },
  ];
  const session = createWarmSession();
  const controller = createTerminalCacheReplayController({
    cacheV2: {
      async readChunks(currentSnapshot, onChunk) {
        assert.equal(currentSnapshot, snapshot);
        for (const chunk of chunks) {
          onChunk(chunk);
        }
      },
    },
    usesV2: () => true,
    withProgressTimeout: immediateProgressTimeout,
    resetTerminalForHistoryReplay() {
      events.push("reset-terminal");
      return true;
    },
    writeOutput(currentSession, data, options) {
      events.push(`write:${data.byteLength}`);
      assert.equal(options.historySource, "cache-v2");
      currentSession.receivedHistoryCursor = options.endCursor;
      currentSession.appliedHistoryCursor = options.endCursor;
    },
    flushOutput() {
      events.push("flush-output");
    },
    beginPresentationHold() {
      presentationEvents.push("begin-hold");
    },
    holdPresentationFrame() {
      presentationEvents.push("hold-frame");
    },
    markPresentationSyncPending() {
      presentationEvents.push("sync-pending");
    },
    isSocketOpen: () => false,
  });

  assert.equal(controller.startWarmReplay(session, snapshot), true);
  const pending = session.cacheV2WarmReplayPromise;
  assert.ok(pending);
  await pending;

  assert.equal(session.cacheV2WarmReplayActive, false);
  assert.equal(session.cacheV2WarmReplayReady, true);
  assert.equal(session.appliedHistoryCursor, 4n);
  assert.deepEqual(events.filter((event) => event.startsWith("write:")), ["write:2", "write:2"]);
  assert.deepEqual(presentationEvents, []);
});

test("server snapshot replacement resets and replays only after the complete snapshot is queued", () => {
  const events = [];
  const socket = {};
  const session = {
    cacheV2NetworkQueue: [new Uint8Array([1, 2]), new Uint8Array([3, 4])],
    cacheV2NetworkQueueBytes: 4,
    cacheV2ServerSnapshotPending: false,
    cacheV2ServerSnapshotStartCursor: 5n,
    cacheV2WarmReplaySeq: 1,
    hasPresentedFrame: true,
    historyGeneration: "history-2",
    historyReplayTargetCursor: 9n,
    socket,
    terminalFrameHeld: false,
    terminalReplayGeneration: 7,
  };
  const controller = createTerminalCacheReplayController({
    cacheV2: {},
    usesV2: () => true,
    withProgressTimeout: immediateProgressTimeout,
    holdPresentationFrame() {
      events.push("hold-frame");
    },
    resetTerminalForHistoryReplay() {
      events.push("reset-terminal");
      return true;
    },
    setReplayAuthorization(currentSession, authorization) {
      events.push(`authorize:${authorization}`);
      currentSession.replayAuthorization = authorization;
    },
    resetSession(_currentSession, generation, cursor) {
      events.push(`reset-cache:${generation}:${cursor}`);
    },
    writeOutput(currentSession, data) {
      events.push(`write:${data.byteLength}`);
      currentSession.receivedHistoryCursor += BigInt(data.byteLength);
      currentSession.appliedHistoryCursor = currentSession.receivedHistoryCursor;
    },
    flushOutput() {
      events.push("flush-output");
    },
  });

  assert.equal(controller.applyServerSnapshot(session, socket, assert.fail), false);
  assert.deepEqual(events, []);

  session.cacheV2ServerSnapshotPending = true;
  assert.equal(controller.applyServerSnapshot(session, socket, assert.fail), true);
  assert.deepEqual(events, [
    "hold-frame",
    "reset-terminal",
    "authorize:identified",
    "reset-cache:history-2:5",
    "write:2",
    "write:2",
    "flush-output",
  ]);
  assert.equal(session.cacheV2WarmReplayReady, true);
  assert.equal(session.receivedHistoryCursor, 9n);
});

test("stale replay generation and socket callbacks cannot write or reject the current session", async () => {
  let deliverChunk;
  let rejectRead;
  const writes = [];
  const rejections = [];
  const socket = {};
  const session = {
    cacheV2NetworkQueue: [],
    cacheV2NetworkQueueBytes: 0,
    cacheV2ReplayPromise: null,
    receivedHistoryCursor: 0n,
    socket,
    terminalReplayGeneration: 2,
  };
  const controller = createTerminalCacheReplayController({
    cacheV2: {
      readChunks(_snapshot, onChunk) {
        return new Promise((_resolve, reject) => {
          rejectRead = reject;
          deliverChunk = (chunk) => {
            try {
              onChunk(chunk);
            } catch (error) {
              reject(error);
            }
          };
        });
      },
    },
    usesV2: () => true,
    withProgressTimeout: immediateProgressTimeout,
    writeOutput(_currentSession, data) {
      writes.push(data);
    },
    flushOutput() {},
  });

  controller.beginReplay(session, { chunks: [{}] }, 1n, socket, (reason) => rejections.push(reason));
  const pending = session.cacheV2ReplayPromise;
  session.terminalReplayGeneration += 1;
  session.socket = {};
  deliverChunk({ data: new Uint8Array([1]), startCursor: 0n, endCursor: 1n });
  await pending;

  assert.deepEqual(writes, []);
  assert.deepEqual(rejections, []);
  rejectRead?.(new Error("already settled"));
});

test("a unified pane warm replay failure is contained by the logical replay failure handler", async () => {
  let physicalCloseCount = 0;
  let reconnectCount = 0;
  let logicalFailureCount = 0;
  let disabledCount = 0;
  const sibling = { cacheV2WarmReplayActive: true, closed: false };
  const session = {
    ...createWarmSession(),
    connectionChannel: "unified",
    hasPresentedFrame: true,
    socket: {},
  };
  const controller = createTerminalCacheReplayController({
    cacheV2: {
      readChunks: () => Promise.reject(new Error("broken cache chunk")),
    },
    usesV2: () => true,
    withProgressTimeout: immediateProgressTimeout,
    resetTerminalForHistoryReplay: () => true,
    beginPresentationHold() {},
    markPresentationSyncPending() {},
    disableSession() {
      disabledCount += 1;
    },
    noteReplayFailure() {
      logicalFailureCount += 1;
      return true;
    },
    closeSocketForReconnect() {
      physicalCloseCount += 1;
    },
    scheduleReconnect() {
      reconnectCount += 1;
    },
  });

  assert.equal(controller.startWarmReplay(session, {
    baseCursor: 0n,
    chunks: [{}],
    endCursor: 1n,
    historyGeneration: "history-3",
  }), true);
  const pending = session.cacheV2WarmReplayPromise;
  await pending;

  assert.equal(logicalFailureCount, 1);
  assert.equal(disabledCount, 1);
  assert.equal(physicalCloseCount, 0);
  assert.equal(reconnectCount, 0);
  assert.deepEqual(sibling, { cacheV2WarmReplayActive: true, closed: false });
});
