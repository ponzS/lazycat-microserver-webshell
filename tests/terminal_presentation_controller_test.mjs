import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalPresentationController,
  createTerminalPresentationState,
} from "../runtime/static/terminal/rendering/index.js";

class FakeCanvas {
  constructor(width = 240, height = 120) {
    this.width = width;
    this.height = height;
    this.hidden = true;
    this.style = {};
    this.listeners = new Map();
    this.operations = [];
    this.context = {
      clearRect: (...args) => this.operations.push(["clearRect", ...args]),
      drawImage: (...args) => this.operations.push(["drawImage", ...args]),
      fillRect: (...args) => this.operations.push(["fillRect", ...args]),
      restore: () => this.operations.push(["restore"]),
      save: () => this.operations.push(["save"]),
      setTransform: (...args) => this.operations.push(["setTransform", ...args]),
      fillStyle: "",
    };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }

  getBoundingClientRect() {
    return { width: 120, height: 60 };
  }

  getContext(kind) {
    return kind === "2d" ? this.context : null;
  }
}

const createFakeWindow = () => {
  let nextID = 1;
  const frames = new Map();
  const timers = new Map();
  const windowObject = {
    HTMLCanvasElement: FakeCanvas,
    devicePixelRatio: 2,
    requestAnimationFrame(callback) {
      const id = nextID++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(callback) {
      const id = nextID++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  return {
    windowObject,
    flushFrames() {
      const pending = Array.from(frames.values());
      frames.clear();
      pending.forEach((callback) => callback());
    },
    flushTimers() {
      const pending = Array.from(timers.values());
      timers.clear();
      pending.forEach((callback) => callback());
    },
    frameCount: () => frames.size,
    timerCount: () => timers.size,
  };
};

const createSession = ({ renderResult = true } = {}) => {
  const canvas = new FakeCanvas();
  canvas.hidden = false;
  const hold = new FakeCanvas(1, 1);
  const terminalHost = {
    children: [],
    appendChild(node) {
      if (node.parentElement?.children) {
        node.parentElement.children = node.parentElement.children.filter((child) => child !== node);
      }
      this.children = this.children.filter((child) => child !== node);
      this.children.push(node);
      node.parentElement = this;
      return node;
    },
  };
  terminalHost.appendChild(hold);
  const renderListeners = new Set();
  const term = {
    animationFrameId: undefined,
    canvas,
    cols: 80,
    rows: 24,
    renderFullNextFrame: false,
    renderRetryTimer: undefined,
    renderThrottleTimer: undefined,
    renderNowCalls: 0,
    requestRenderCalls: 0,
    renderer: {
      clearCalls: 0,
      devicePixelRatio: 2,
      clear() {
        this.clearCalls += 1;
      },
      getCanvas: () => canvas,
    },
    getScrollbackLength: () => 4,
    onRender(listener) {
      renderListeners.add(listener);
      return { dispose: () => renderListeners.delete(listener) };
    },
    renderNow() {
      this.renderNowCalls += 1;
      if (renderResult !== false) {
        for (const listener of renderListeners) {
          listener();
        }
      }
      return renderResult;
    },
    requestRender() {
      this.requestRenderCalls += 1;
    },
  };
  return {
    ...createTerminalPresentationState(),
    id: "pane-1",
    tabId: "tab-1",
    name: "target-1",
    closed: false,
    shellEl: { dataset: {} },
    terminalHost,
    terminalFrameHold: hold,
    terminalFrameHeld: false,
    terminalFrameHoldIdentity: null,
    term,
    workspaceGeneration: "workspace-1",
    historyGeneration: "history-1",
    appliedHistoryCursor: 20n,
    presentedHistoryCursor: 0n,
    measuredFitGeneration: 2,
    terminalReplayGeneration: 3,
    appliedResizeEpoch: "7",
    requestedResizeEpoch: "7",
    resizeEpochSupported: true,
    resizeAckPending: false,
    resizeFenceActive: false,
    resizeOutputSettleActive: false,
    activationFitPending: false,
    connectionEpoch: 4,
    socketOpen: true,
    replayCommitted: true,
    canvasMatches: true,
    visible: true,
    measurable: true,
    resizeController: {
      phase: "ready",
      commits: 0,
      commit() {
        this.commits += 1;
        this.phase = "committed";
      },
    },
    cleanups: [],
  };
};

const createHarness = ({ renderResult = true } = {}) => {
  const clock = createFakeWindow();
  const session = createSession({ renderResult });
  const events = [];
  const ready = [];
  const resizeRequests = [];
  const resizeSchedules = [];
  const recoveries = [];
  let now = 100;
  const controller = createTerminalPresentationController({
    windowObject: clock.windowObject,
    getActiveName: () => "target-1",
    getActiveTabId: () => "tab-1",
    getWorkspaceIdentityKey: (identity) => JSON.stringify(identity || null),
    getBackground: () => "#112233",
    isReplayCommitted: (candidate) => candidate.replayCommitted === true,
    isReplayCommitPending: () => false,
    isPaneVisible: (candidate) => candidate.visible === true,
    isPaneMeasurable: (candidate) => candidate.measurable === true,
    canvasMatchesExpectedSize: (candidate) => candidate.canvasMatches === true,
    normalizeResizeEpoch: (value) => String(value || ""),
    scheduleResize: (candidate, options, scheduleOptions) => {
      resizeSchedules.push({ candidate, options, scheduleOptions });
      return true;
    },
    sendResize: (candidate, options) => {
      resizeRequests.push({ candidate, options });
      return true;
    },
    recordEvent: (_candidate, event, details) => events.push({ event, details }),
    onReady: (_candidate, details) => ready.push(details),
    onRenderObserved: (candidate) => {
      candidate.renderObserved = Number(candidate.renderObserved || 0) + 1;
    },
    recoverTransport: (...args) => {
      recoveries.push(args);
      return true;
    },
    isSocketOpen: (candidate) => candidate.socketOpen === true,
    now: () => now,
    registerSessionCleanup: (candidate, cleanup) => candidate.cleanups.push(cleanup),
    activityPollIntervalMs: 10,
    fullRenderValidationMs: 1,
    presentationValidationMaxMs: 4,
    presentationResizeRetryMs: 5,
    presentationStallTimeoutMs: 20,
    presentationStallReconnectLimit: 2,
  });
  return {
    clock,
    controller,
    events,
    ready,
    recoveries,
    resizeRequests,
    resizeSchedules,
    session,
    setNow: (value) => {
      now = value;
    },
  };
};

test("presentation controller holds the last frame until the current full render commits", () => {
  const { clock, controller, events, ready, session } = createHarness();
  session.hasPresentedFrame = true;
  session.renderReady = true;
  controller.installSession(session);
  session.terminalFrameHold.parentElement = null;
  session.terminalHost.children = [];

  assert.equal(controller.beginHold(session), true);
  assert.equal(session.renderReady, false);
  assert.equal(session.resizePresentationHold, true);
  assert.equal(session.terminalFrameHeld, true);
  assert.equal(session.terminalFrameHold.hidden, false);
  assert.equal(session.terminalFrameHold.width, 120);
  assert.equal(session.terminalFrameHold.height, 60);
  assert.equal(session.terminalFrameHold.parentElement, session.terminalHost);
  assert.deepEqual(session.terminalHost.children, [session.terminalFrameHold]);

  assert.equal(controller.ensure(session, { reason: "test_commit", forceHistory: true }), true);
  assert.equal(session.term.renderNowCalls, 1);
  assert.equal(session.hasPresentedFrame, true);
  assert.equal(session.renderReady, true);
  assert.equal(session.resizePresentationHold, false);
  assert.equal(session.presentedFitGeneration, session.measuredFitGeneration);
  assert.equal(session.presentedReplayGeneration, session.terminalReplayGeneration);
  assert.equal(session.presentedContentGeneration, session.terminalContentGeneration);
  assert.equal(session.presentedHistoryCursor, session.appliedHistoryCursor);
  assert.equal(session.resizeController.commits, 1);
  assert.equal(controller.isCurrent(session), true);
  assert.equal(ready.length, 1);
  assert.equal(session.terminalFrameHold.hidden, false);

  clock.flushFrames();
  assert.equal(session.terminalFrameHold.hidden, false);
  clock.flushFrames();
  assert.equal(session.terminalFrameHold.hidden, true);
  assert.equal(session.terminalFrameHeld, false);
  assert.ok(events.some(({ event }) => event === "presentation_commit_complete"));
});

test("presentation controller never renders replay, resize, or invalid geometry intermediate states", () => {
  const {
    controller,
    resizeRequests,
    resizeSchedules,
    session,
    setNow,
  } = createHarness();
  controller.installSession(session);
  session.replayCommitted = false;

  assert.equal(controller.ensure(session, { reason: "replay_pending" }), false);
  assert.equal(session.term.renderNowCalls, 0);
  assert.equal(session.term.requestRenderCalls, 0);

  session.replayCommitted = true;
  session.resizeAckPending = true;
  session.requestedCols = 90;
  session.requestedRows = 30;
  session.lastResizeRequestAt = 0;
  setNow(100);
  assert.equal(controller.ensure(session, { reason: "resize_pending" }), false);
  assert.equal(resizeRequests.length, 1);
  assert.equal(session.term.renderNowCalls, 0);

  session.resizeAckPending = false;
  session.canvasMatches = false;
  assert.equal(controller.ensure(session, { reason: "geometry_pending" }), false);
  assert.equal(resizeSchedules.length, 1);
  assert.equal(session.term.renderNowCalls, 0);

  session.canvasMatches = true;
  assert.equal(controller.ensure(session, { reason: "geometry_ready" }), true);
  assert.equal(session.term.renderNowCalls, 1);
  assert.equal(session.renderReady, true);
});

test("stable presentation validation renders on the live canvas without showing the hold overlay", () => {
  const { clock, controller, session } = createHarness();
  session.hasPresentedFrame = true;
  session.renderReady = true;
  session.presentedFitGeneration = session.measuredFitGeneration;
  session.presentedReplayGeneration = session.terminalReplayGeneration;
  session.presentedContentGeneration = session.terminalContentGeneration;
  session.presentedResizeEpoch = session.appliedResizeEpoch;
  controller.installSession(session);

  assert.equal(controller.ensure(session, { reason: "output_validation" }), true);
  assert.equal(session.hasPresentedFrame, true);
  assert.equal(session.renderReady, true);
  assert.equal(session.resizePresentationHold, false);
  assert.equal(session.terminalFrameHeld, false);
  assert.equal(session.terminalFrameHold.hidden, true);
  assert.equal(session.term.renderNowCalls, 1);

  clock.flushFrames();
  assert.equal(session.terminalFrameHold.hidden, true);
  assert.equal(session.terminalFrameHeld, false);
});

test("same-geometry resize ACK updates presentation metadata without showing the hold overlay", () => {
  const { controller, session } = createHarness();
  session.hasPresentedFrame = true;
  session.renderReady = true;
  session.presentedFitGeneration = session.measuredFitGeneration;
  session.presentedReplayGeneration = session.terminalReplayGeneration;
  session.presentedContentGeneration = session.terminalContentGeneration;
  session.presentedResizeEpoch = session.appliedResizeEpoch;
  controller.installSession(session);

  session.requestedResizeEpoch = "8";
  session.requestedCols = session.term.cols;
  session.requestedRows = session.term.rows;
  session.requestedPixelWidth = 0;
  session.requestedPixelHeight = 0;
  session.resizeAckPending = true;
  assert.equal(controller.ensure(session, { reason: "same_geometry_resize_pending" }), false);
  assert.equal(session.renderReady, true);
  assert.equal(session.resizePresentationHold, false);
  assert.equal(session.terminalFrameHeld, false);
  assert.equal(session.terminalFrameHold.hidden, true);

  session.appliedResizeEpoch = "8";
  session.resizeAckPending = false;
  assert.equal(controller.ensure(session, { reason: "same_geometry_resize_applied" }), true);
  assert.equal(session.renderReady, true);
  assert.equal(session.resizePresentationHold, false);
  assert.equal(session.terminalFrameHeld, false);
  assert.equal(session.terminalFrameHold.hidden, true);
});

test("a real fit generation change still enters a presentation hold", () => {
  const { controller, resizeSchedules, session } = createHarness();
  session.hasPresentedFrame = true;
  session.renderReady = true;
  session.presentedFitGeneration = session.measuredFitGeneration;
  session.presentedReplayGeneration = session.terminalReplayGeneration;
  session.presentedContentGeneration = session.terminalContentGeneration;
  session.presentedResizeEpoch = session.appliedResizeEpoch;
  controller.installSession(session);

  session.measuredFitGeneration += 1;
  session.canvasMatches = false;
  assert.equal(controller.ensure(session, { reason: "geometry_changed" }), false);
  assert.equal(resizeSchedules.length, 1);
  assert.equal(session.renderReady, false);
  assert.equal(session.resizePresentationHold, true);
  assert.equal(session.terminalFrameHeld, true);
  assert.equal(session.terminalFrameHold.hidden, false);
});

test("direct not-ready transitions preserve an existing visible frame", () => {
  const { clock, controller, session } = createHarness();
  session.hasPresentedFrame = true;
  session.renderReady = true;
  controller.installSession(session);
  session.terminalFrameHold.parentElement = null;
  session.terminalHost.children = [];

  assert.equal(controller.setReady(session, false), true);
  assert.equal(session.renderReady, false);
  assert.equal(session.terminalFrameHeld, true);
  assert.equal(session.terminalFrameHold.hidden, false);
  assert.equal(session.terminalFrameHold.parentElement, session.terminalHost);

  assert.equal(controller.ensure(session, { reason: "direct_not_ready_recovery" }), true);
  assert.equal(session.renderReady, true);
  clock.flushFrames();
  assert.equal(session.terminalFrameHold.hidden, false);
  clock.flushFrames();
  assert.equal(session.terminalFrameHold.hidden, true);
  assert.equal(session.terminalFrameHeld, false);
});

test("presentation lifecycle removes Canvas listeners and rejects delayed callbacks after cleanup", () => {
  const { clock, controller, session } = createHarness();
  controller.installSession(session);
  assert.equal(session.cleanups.length, 1);
  assert.equal(session.term.canvas.listeners.get("contextlost")?.size, 1);

  let prevented = false;
  session.renderReady = true;
  session.term.canvas.dispatch("contextlost", {
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(session.renderReady, false);
  assert.equal(clock.timerCount(), 1);

  session.cleanups[0]();
  assert.equal(session.term.canvas.listeners.get("contextlost")?.size, 0);
  assert.equal(session.term.canvas.listeners.get("contextrestored")?.size, 0);
  assert.equal(clock.timerCount(), 0);
  assert.equal(clock.frameCount(), 0);
  clock.flushTimers();
  clock.flushFrames();
  assert.equal(session.term.renderNowCalls, 0);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
});

test("presentation stall recovery resyncs only a committed active pane after bounded retries", () => {
  const { controller, recoveries, session } = createHarness({ renderResult: false });
  controller.installSession(session);
  session.renderReady = false;

  assert.equal(controller.recoverStalled(session, 100), true);
  assert.equal(recoveries.length, 0);
  assert.equal(controller.recoverStalled(session, 125), true);
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0][0], session);
  assert.equal(recoveries[0][1], "presentation stalled after replay commit");
  assert.deepEqual(recoveries[0][2], { immediate: true });

  const blocked = createSession({ renderResult: false });
  blocked.replayCommitted = false;
  assert.equal(controller.recoverStalled(blocked, 200), false);
  assert.equal(recoveries.length, 1);
});
