import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalCacheController } from "../runtime/static/terminal/history/index.js";

class FakeCanvas {
  constructor() {
    this.width = 800;
    this.height = 480;
  }

  toBlob(callback) {
    callback(new Blob(["preview"], { type: "image/png" }));
  }
}

const createClock = () => {
  let nextHandle = 1;
  const timers = new Map();
  const frames = new Map();
  const idle = new Map();
  const windowObject = {
    devicePixelRatio: 2,
    setTimeout(callback) {
      const handle = nextHandle++;
      timers.set(handle, callback);
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    requestAnimationFrame(callback) {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle);
    },
    requestIdleCallback(callback) {
      const handle = nextHandle++;
      idle.set(handle, callback);
      return handle;
    },
    cancelIdleCallback(handle) {
      idle.delete(handle);
    },
  };
  const runTimers = () => {
    const callbacks = Array.from(timers.values());
    timers.clear();
    callbacks.forEach((callback) => callback());
  };
  return { frames, idle, runTimers, timers, windowObject };
};

const workspaceIdentity = {
  cacheProtocolVersion: 2,
  cacheScopeID: "scope-1",
  selector: "target-1",
  workspaceGeneration: "workspace-1",
};

const createSession = (overrides = {}) => ({
  appliedHistoryCursor: 0n,
  cacheV2Epoch: 1,
  cacheV2PreviewCaptureAllowRecentOutput: false,
  cacheV2PreviewCaptureIdle: 0,
  cacheV2PreviewCaptureIdleKind: "",
  cacheV2PreviewCapturePending: false,
  cacheV2PreviewCaptureRunning: false,
  cacheV2PreviewCaptureSeq: 0,
  cacheV2PreviewCaptureTimer: 0,
  cacheV2WarmReplayActive: false,
  cacheV2WorkspaceIdentity: { ...workspaceIdentity },
  closed: false,
  historyCacheDisabled: false,
  historyCacheLoadPromise: null,
  historyCacheLoadSeq: 0,
  historyCacheLoaded: false,
  historyCacheResetPromise: Promise.resolve(),
  historyCacheSnapshot: null,
  historyCacheWriteBytes: 0,
  historyCacheWriteFrame: 0,
  historyCacheWritePromise: Promise.resolve(),
  historyCacheWriteQueue: [],
  historyCacheWriteTimer: 0,
  historyGeneration: "history-1",
  historyStateReady: true,
  id: "pane-1",
  localBaseCursor: 0n,
  name: "target-1",
  persistedHistoryCursor: 0n,
  renderSnapshot: {},
  resizeAckPending: false,
  resizePresentationHold: false,
  shellEl: { dataset: {} },
  tabId: "tab-1",
  terminalPreview: {
    hidden: true,
    removeAttribute() {},
  },
  ...overrides,
});

const createHarness = ({ clock = createClock(), sessionOptions = {} } = {}) => {
  const calls = {
    append: [],
    compact: [],
    deletePane: [],
    loadManifest: [],
    reset: [],
    savePreview: [],
    touch: [],
  };
  const cacheV2 = {
    available: true,
    append(...args) {
      calls.append.push(args);
      return Promise.resolve({ baseCursor: 0n, endCursor: args[2].at(-1).endCursor });
    },
    compact(...args) {
      calls.compact.push(args);
      return Promise.resolve(null);
    },
    deletePane(identity) {
      calls.deletePane.push(identity);
      return Promise.resolve(true);
    },
    historyWindowMatches() {
      return true;
    },
    loadManifest(identity) {
      calls.loadManifest.push(identity);
      return Promise.resolve({
        ...identity,
        baseCursor: 0n,
        chunks: [],
        endCursor: 5n,
        historyGeneration: "history-1",
      });
    },
    reset(...args) {
      calls.reset.push(args);
      return Promise.resolve({ baseCursor: args[2], endCursor: args[2] });
    },
    savePreview(...args) {
      calls.savePreview.push(args);
      return Promise.resolve(true);
    },
    touch(identity) {
      calls.touch.push(identity);
      return Promise.resolve(true);
    },
  };
  const legacyCache = {
    cleanupExpired: () => Promise.resolve(),
    deletePane: () => Promise.resolve(),
    load: () => Promise.resolve(null),
    touch: () => Promise.resolve(),
  };
  const controller = createTerminalCacheController({
    windowObject: clock.windowObject,
    cacheV2,
    legacyCache,
    getActiveName: () => "target-1",
    session: {
      HTMLCanvasElementCtor: FakeCanvas,
      getHistoryWindowLines: () => 1000,
      getPreviewFingerprint: () => "theme-1",
      getTerminalSize: () => ({ cols: 100, rows: 30 }),
      canvasMatchesExpectedSize: () => true,
      isReplayCommitted: () => true,
      isPresentationCurrent: () => true,
      hasQueuedOutput: () => false,
      cacheV2FlushBytes: 1,
      ...sessionOptions,
    },
  });
  controller.setWorkspaceIdentity(workspaceIdentity);
  return { cacheV2, calls, clock, controller };
};

test("cache persistence loads the current identity and serializes committed writes", async () => {
  const { calls, controller } = createHarness();
  const session = createSession();
  const snapshot = await controller.prepareSession(session);
  assert.equal(snapshot.endCursor, 5n);
  assert.equal(session.persistedHistoryCursor, 5n);
  assert.equal(calls.loadManifest.length, 1);

  const data = new Uint8Array([1, 2, 3]);
  assert.equal(controller.queueWrite(session, data, 5n, 8n), true);
  await session.historyCacheWritePromise;
  assert.equal(calls.append.length, 1);
  assert.equal(calls.append[0][0].historyGeneration, "history-1");
  assert.equal(session.persistedHistoryCursor, 8n);
});

test("cache session lifecycle cancels write, preview and compaction resources", () => {
  const clock = createClock();
  const { controller } = createHarness({
    clock,
    sessionOptions: { cacheV2FlushBytes: 1024 },
  });
  const session = createSession();
  controller.queueWrite(session, new Uint8Array([1]), 0n, 1n);
  controller.schedulePreviewCapture(session);
  controller.scheduleCompaction(session);
  assert.ok(clock.timers.size > 0);
  assert.ok(clock.idle.size > 0);
  assert.equal(controller.disposeSession(session), true);
  assert.equal(clock.timers.size, 0);
  assert.equal(clock.frames.size, 0);
  assert.equal(clock.idle.size, 0);
  assert.equal(session.cacheV2CompactionScheduled, false);
});

test("history window changes invalidate cache state through the persistence owner", () => {
  const session = createSession({
    appliedHistoryCursor: 9n,
    historyCacheLoaded: true,
    historyCacheSnapshot: { endCursor: 9n },
    localBaseCursor: 2n,
    persistedHistoryCursor: 9n,
  });
  const replays = [];
  const { controller } = createHarness({
    sessionOptions: {
      getActiveName: () => "target-1",
      getSessions: () => [session],
      requestHistoryReplay: (value) => replays.push(value),
    },
  });
  assert.equal(controller.handleHistoryWindowChange(1000, 2000), true);
  assert.equal(session.historyGeneration, "");
  assert.equal(session.historyCacheLoaded, false);
  assert.equal(session.appliedHistoryCursor, 0n);
  assert.equal(session.resetOnNextReplay, true);
  assert.deepEqual(replays, [session]);
});

test("preview capture persists only a current committed frame", async () => {
  const clock = createClock();
  const { calls, controller } = createHarness({ clock });
  const canvas = new FakeCanvas();
  const session = createSession({
    appliedHistoryCursor: 5n,
    connectionChannel: "unified",
    hasPresentedFrame: true,
    historyGeneration: "history-1",
    measuredFitGeneration: 2,
    persistedHistoryCursor: 5n,
    presentedContentGeneration: 3,
    presentedFitGeneration: 2,
    presentedHistoryCursor: 5n,
    presentedReplayGeneration: 4,
    renderGeneration: 7,
    term: { canvas },
    terminalContentGeneration: 3,
    terminalReplayGeneration: 4,
  });
  assert.equal(controller.canCapturePreview(session), true);
  assert.equal(controller.schedulePreviewCapture(session, { immediate: true }), true);
  clock.runTimers();
  clock.runTimers();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.savePreview.length, 1);
  assert.equal(calls.savePreview[0][2], 5n);
  assert.equal(calls.savePreview[0][4].themeFingerprint, "theme-1");
});
