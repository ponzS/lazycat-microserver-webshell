import assert from "node:assert/strict";
import test from "node:test";
import {
  TerminalResizeController,
  createTerminalResizeController,
  createTerminalResizeLifecycle,
} from "../runtime/static/terminal/resize/index.js";

const request = () => {
  const controller = new TerminalResizeController();
  controller.request({ requestID: "resize-1", connectionEpoch: 3, resizeEpoch: 8, dimensions: { cols: 100, rows: 30 } });
  return controller;
};

test("ResizeController accepts ACK, settle, and commit in order", () => {
  const controller = request();
  assert.equal(controller.acknowledge({ requestID: "resize-1", connectionEpoch: 3, resizeEpoch: 8, dimensions: { cols: 100, rows: 30 } }).phase, "applied");
  const token = controller.beginSettle();
  assert.equal(controller.finishSettle(token + 1), false);
  assert.equal(controller.finishSettle(token), true);
  assert.equal(controller.commit().phase, "committed");
});

test("ResizeController rejects stale ACKs, errors, and callbacks", () => {
  const controller = request();
  assert.throws(() => controller.acknowledge({ requestID: "resize-1", connectionEpoch: 3, resizeEpoch: 7, dimensions: { cols: 100, rows: 30 } }), /stale/);
  assert.throws(() => controller.acknowledge({ requestID: "resize-old", connectionEpoch: 3, resizeEpoch: 8, dimensions: { cols: 100, rows: 30 } }), /mismatch/);
  assert.throws(() => controller.fail({ requestID: "resize-1", connectionEpoch: 2, resizeEpoch: 8 }), /mismatch/);
  assert.throws(() => controller.request({ requestID: "bad", connectionEpoch: 1, resizeEpoch: 1, dimensions: { cols: 0, rows: 30 } }), /invalid/);
});

test("ResizeController prevents settle or commit before a valid ACK", () => {
  const controller = request();
  assert.throws(() => controller.beginSettle(), /not ready/);
  assert.throws(() => controller.commit(), /not ready/);
  controller.fail({ requestID: "resize-1", connectionEpoch: 3, resizeEpoch: 8 });
  assert.throws(() => controller.commit(), /not ready/);
});

const createWindowHarness = () => {
  let nextHandle = 1;
  const timers = new Map();
  const frames = new Map();
  const windowObject = {
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
  };
  return {
    windowObject,
    timers,
    frames,
    runTimers() {
      const callbacks = Array.from(timers.values());
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
    runFrames() {
      const callbacks = Array.from(frames.values());
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
  };
};

const createRuntimeHarness = () => {
  const clock = { value: 1000 };
  const windowHarness = createWindowHarness();
  const sent = [];
  const events = [];
  const ensures = [];
  const effects = {
    captureViewport: 0,
    resetHostViewport: 0,
    positionInput: 0,
    syncViewportPan: 0,
    updateSelectionHandles: 0,
    beginHold: 0,
    holdFrame: 0,
    setReady: 0,
    renderFullNow: 0,
    requestFullRender: 0,
    commitNow: 0,
    termResize: 0,
    flushOutputCalls: [],
    queueEntriesAtTermResize: [],
  };
  const presentation = {
    beginHold(session) {
      effects.beginHold += 1;
      session.resizePresentationHold = true;
      session.terminalFrameHeld = true;
      session.renderReady = false;
      return true;
    },
    holdFrame(session) {
      effects.holdFrame += 1;
      session.terminalFrameHeld = true;
      return true;
    },
    setReady(session, ready) {
      effects.setReady += 1;
      session.renderReady = ready;
      return true;
    },
    ensure(session, options) {
      ensures.push({ session, options });
      return true;
    },
    cancelHold(session) {
      session.resizePresentationHold = false;
      return true;
    },
    requestFullRender() { effects.requestFullRender += 1; },
    commitNow() { effects.commitNow += 1; },
    renderFullNow() { effects.renderFullNow += 1; },
    renderLiveGeometryNow() { effects.renderFullNow += 1; return true; },
    scheduleValidation() {},
    stateIsCurrent: () => false,
    isCurrent: () => false,
    scheduleFrame() {},
  };
  const lifecycleFactory = ({ applyResize }) => ({
    schedule(session, options) {
      applyResize(session, options, { settled: true });
      return true;
    },
    flush: () => false,
    cancel() {},
    observeHost() {},
    bindTerminalResize() {},
    scheduleSessionFrame(_session, _key, callback) {
      callback();
      return true;
    },
    scheduleTabFrame(_tab, callback) {
      callback();
      return true;
    },
    cancelTab() {},
    disposeSession() {},
    dispose() {},
  });
  const controller = createTerminalResizeController({
    windowObject: windowHarness.windowObject,
    getActiveName: () => "demo",
    getActiveTabId: () => "tab-1",
    getCurrentTab: () => null,
    getPresentation: () => presentation,
    getPixelSize: (term) => ({ width: term.cols * 10, height: term.rows * 20 }),
    captureViewport: () => {
      effects.captureViewport += 1;
      return { atBottom: true, viewportY: 0, targetViewportY: 0 };
    },
    isHostElement: () => true,
    isCanvasElement: () => true,
    isSocketOpen: (session) => session.socketOpen === true,
    sendControl: (_session, payload) => {
      sent.push(payload);
      return true;
    },
    isReplayCommitted: () => true,
    now: () => clock.value,
    epochNow: () => 10,
    random: () => 0,
    recordEvent: (_session, event, details) => events.push({ event, details }),
    beginRenderSuppression: (session) => {
      session.renderSuppressed = true;
    },
    endRenderSuppression: (session) => {
      session.renderSuppressed = false;
    },
    flushOutput: (session, options = {}) => {
      effects.flushOutputCalls.push({ ...options, queuedEntries: session.outputQueue.length });
      const maxEntries = Math.max(0, Math.floor(Number(options.maxEntries) || 0));
      const removeCount = maxEntries > 0
        ? Math.min(maxEntries, session.outputQueue.length)
        : session.outputQueue.length;
      const removed = session.outputQueue.splice(0, removeCount);
      session.outputQueueSize = Math.max(
        0,
        session.outputQueueSize - removed.reduce((total, entry) => total + Number(entry.byteLength || 0), 0),
      );
      return session.outputQueue.length === 0;
    },
    scheduleOutputFlush() {},
    getOutputQueueEntryCount: (session) => session.outputQueue.length,
    getOutputQueuedBytes: (session) => session.outputQueueSize,
    resetHostViewport() { effects.resetHostViewport += 1; },
    positionInput() { effects.positionInput += 1; },
    syncViewportPan() { effects.syncViewportPan += 1; },
    updateSelectionHandles() { effects.updateSelectionHandles += 1; },
    resetAfterInitialFit() {},
    syncTabMobilePixelScroll() {},
    connectPendingSession() {},
    registerSessionCleanup() {},
    consoleObject: { warn() {} },
    lifecycleFactory,
  });
  const canvas = { width: 800, height: 480, style: { width: "800px", height: "480px" } };
  const term = {
    cols: 80,
    rows: 24,
    canvas,
    renderer: {
      canvasSize(cols, rows) {
        return {
          pixelWidth: cols * 10,
          pixelHeight: rows * 20,
          cssWidth: cols * 10,
          cssHeight: rows * 20,
        };
      },
    },
    resize(cols, rows) {
      effects.termResize += 1;
      effects.queueEntriesAtTermResize.push(session.outputQueue.length);
      this.cols = cols;
      this.rows = rows;
      canvas.width = cols * 10;
      canvas.height = rows * 20;
      canvas.style.width = `${cols * 10}px`;
      canvas.style.height = `${rows * 20}px`;
    },
    getScrollbackLength: () => 0,
  };
  const session = {
    id: "pane-1",
    tabId: "tab-1",
    name: "demo",
    closed: false,
    socketOpen: true,
    connectionEpoch: 4,
    resizeEpochSupported: true,
    resizeAckPending: false,
    resizeController: new TerminalResizeController(),
    resizeFenceActive: false,
    resizeFenceTarget: null,
    resizeFenceApplying: false,
    resizeFenceDrainTimer: 0,
    resizeFenceDrainRemainingEntries: null,
    resizeOutputSettleActive: false,
    resizeOutputSettleTimer: 0,
    resizeOutputSettleToken: 0,
    resizeOutputSettleDrainRemainingEntries: null,
    outputQueue: [],
    outputQueueSize: 0,
    measuredFitGeneration: 1,
    hasPresentedFrame: true,
    resizePresentationHold: false,
    terminalFrameHeld: false,
    renderReady: true,
    fullRenderPending: false,
    initialRuntimeResetDone: true,
    fitAddon: { proposeDimensions: () => ({ cols: 100, rows: 30 }) },
    terminalHost: {
      isConnected: true,
      clientWidth: 1000,
      clientHeight: 600,
      getBoundingClientRect: () => ({ width: 1000, height: 600 }),
    },
    term,
  };
  return { controller, session, sent, events, ensures, effects, clock, windowHarness };
};

test("runtime resize controller keeps the local grid on the old epoch until ACK", () => {
  const harness = createRuntimeHarness();
  const result = harness.controller.resizePane(harness.session, { forceSizeSync: true });

  assert.equal(result.pending, true);
  assert.equal(harness.session.term.cols, 80);
  assert.equal(harness.session.term.rows, 24);
  assert.equal(harness.session.resizeFenceActive, true);
  assert.equal(harness.session.resizeAckPending, true);
  assert.equal(harness.sent.length, 1);
  assert.deepEqual(
    { cols: harness.sent[0].cols, rows: harness.sent[0].rows },
    { cols: 100, rows: 30 },
  );

  harness.controller.handleApplied(harness.session, {
    type: "resize-applied",
    resize_epoch: harness.sent[0].resize_epoch,
    cols: 100,
    rows: 30,
    pixel_width: 1000,
    pixel_height: 600,
  });

  assert.equal(harness.session.term.cols, 100);
  assert.equal(harness.session.term.rows, 30);
  assert.equal(harness.session.resizeAckPending, false);
  assert.equal(harness.session.resizeFenceActive, false);
  assert.equal(harness.session.resizeOutputSettleActive, true);
  assert.equal(harness.sent.length, 1);

  harness.windowHarness.runTimers();
  assert.equal(harness.session.resizeOutputSettleActive, false);
  assert.ok(harness.ensures.some(({ options }) => options.reason === "resize_output_quiet"));
});

test("matching resize ACK drains every pre-ACK output entry before changing the local grid", () => {
  const harness = createRuntimeHarness();
  const result = harness.controller.resizePane(harness.session, { forceSizeSync: true });
  assert.equal(result.pending, true);
  assert.equal(harness.session.resizeFenceDrainRemainingEntries, 0);

  harness.session.outputQueue.push(
    { byteLength: 11, marker: "old-grid-1" },
    { byteLength: 13, marker: "old-grid-2" },
  );
  harness.session.outputQueueSize = 24;

  harness.controller.handleApplied(harness.session, {
    type: "resize-applied",
    resize_epoch: harness.sent[0].resize_epoch,
    cols: 100,
    rows: 30,
    pixel_width: 1000,
    pixel_height: 600,
  });

  assert.deepEqual(harness.effects.queueEntriesAtTermResize, [0]);
  assert.equal(harness.session.outputQueue.length, 0);
  assert.equal(harness.session.outputQueueSize, 0);
  assert.ok(harness.effects.flushOutputCalls.some((call) => (
    call.queuedEntries === 2 && call.maxEntries === 2
  )));
  assert.equal(harness.session.term.cols, 100);
  assert.equal(harness.session.term.rows, 30);
});

test("a newer remote resize epoch is observed without applying an intermediate remote grid", () => {
  const harness = createRuntimeHarness();
  assert.equal(harness.controller.sendSize(harness.session, { force: true }), true);
  const requestedEpoch = BigInt(harness.sent[0].resize_epoch);

  harness.controller.handleApplied(harness.session, {
    type: "resize-applied",
    resize_epoch: String(requestedEpoch + 1n),
    cols: 120,
    rows: 40,
    pixel_width: 1200,
    pixel_height: 800,
  });

  assert.equal(harness.sent.length, 1);
  assert.equal(harness.session.term.cols, 80);
  assert.equal(harness.session.term.rows, 24);
  assert.equal(harness.session.sizeClaimRequired, true);
  assert.equal(harness.controller.isCurrentDeviceClaimRequired(harness.session), true);
  assert.equal(harness.session.resizeAckPending, false);
  assert.equal(harness.session.resizePresentationHold, true);
});

test("passive geometry correction waits for an explicit current-device claim after a remote owner is observed", () => {
  const harness = createRuntimeHarness();
  harness.session.sizeClaimRequired = true;

  const result = harness.controller.resizePane(harness.session, { forceSizeSync: true });

  assert.equal(result.ok, false);
  assert.equal(result.measurable, true);
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.session.term.cols, 80);
  assert.equal(harness.session.term.rows, 24);
  assert.ok(harness.events.some(({ event, details }) => (
    event === "resize_wait_current_device_claim"
      && details.reason === "remote_owner_observed"
  )));

  assert.equal(harness.controller.claimForCurrentDevice(harness.session), true);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].claim, true);
});

test("forced passive size sync cannot reassert an identical geometry owned by another device", () => {
  const harness = createRuntimeHarness();
  harness.session.fitAddon.proposeDimensions = () => ({ cols: 80, rows: 24 });
  harness.session.presentedFitGeneration = harness.session.measuredFitGeneration;
  harness.session.sizeClaimRequired = true;

  const result = harness.controller.resizePane(harness.session, { forceSizeSync: true });

  assert.equal(result.ok, false);
  assert.equal(result.measurable, true);
  assert.equal(harness.sent.length, 0);
  assert.ok(harness.events.some(({ event, details }) => (
    event === "resize_wait_current_device_claim"
      && details.reason === "remote_owner_observed"
  )));
});

test("default resize control serializer sends JSON through the session socket", () => {
  const sent = [];
  const socket = { send(payload) { sent.push(payload); } };
  const controller = createTerminalResizeController({
    isSocketOpen: (session) => session?.socket === socket,
    getPixelSize: () => ({ width: 800, height: 480 }),
    epochNow: () => 10,
    random: () => 0,
  });
  const session = {
    socket,
    term: { cols: 80, rows: 24 },
    resizeEpochSupported: false,
  };

  assert.equal(controller.sendSize(session, {
    force: true,
    dimensions: { cols: 100, rows: 30, pixelWidth: 1000, pixelHeight: 600 },
  }), true);
  assert.deepEqual(JSON.parse(sent[0]), {
    type: "resize",
    cols: 100,
    rows: 30,
    pixel_width: 1000,
    pixel_height: 600,
  });
});

test("same terminal geometry takes a presentation-neutral fast path", () => {
  const harness = createRuntimeHarness();
  harness.session.fitAddon.proposeDimensions = () => ({ cols: 80, rows: 24 });
  harness.session.presentedFitGeneration = harness.session.measuredFitGeneration;

  const result = harness.controller.resizePane(harness.session);

  assert.equal(result.ok, true);
  assert.equal(result.sizeChanged, false);
  assert.equal(result.canvasChanged, false);
  assert.equal(harness.effects.captureViewport, 0);
  assert.equal(harness.effects.termResize, 0);
  assert.equal(harness.effects.resetHostViewport, 0);
  assert.equal(harness.effects.positionInput, 0);
  assert.equal(harness.effects.syncViewportPan, 0);
  assert.equal(harness.effects.updateSelectionHandles, 0);
  assert.equal(harness.effects.beginHold, 0);
  assert.equal(harness.effects.renderFullNow, 0);
  assert.equal(harness.sent.length, 0);
});

test("forced refresh on stable geometry renders live without entering a hold", () => {
  const harness = createRuntimeHarness();
  harness.session.fitAddon.proposeDimensions = () => ({ cols: 80, rows: 24 });
  harness.session.presentedFitGeneration = harness.session.measuredFitGeneration;

  const result = harness.controller.resizePane(harness.session, {
    forceFullRender: true,
    hideUntilRender: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.pending, false);
  assert.equal(harness.effects.beginHold, 0);
  assert.equal(harness.effects.setReady, 0);
  assert.equal(harness.effects.captureViewport, 0);
  assert.equal(harness.effects.renderFullNow, 1);
  assert.equal(harness.sent.length, 0);
});

test("interactive tab resize renders live geometry and commits only the final server target", () => {
  const harness = createRuntimeHarness();
  const tab = { panes: new Map([[harness.session.id, harness.session]]) };

  assert.equal(harness.controller.beginTabInteractiveResize(tab), true);
  assert.equal(harness.effects.beginHold, 0);
  assert.equal(harness.controller.isLiveGeometryActive(harness.session), true);
  assert.equal(harness.controller.beginTabInteractiveResize(tab), false);
  assert.equal(harness.controller.updateTabInteractiveResize(tab), true);
  assert.equal(harness.effects.termResize, 1);
  assert.equal(harness.effects.renderFullNow, 1);
  assert.equal(harness.session.renderReady, true);
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.controller.schedulePane(harness.session, {
    forceFullRender: true,
    hideUntilRender: true,
  }, { immediate: true }), false);
  assert.equal(harness.sent.length, 0);

  assert.equal(harness.controller.endTabInteractiveResize(tab), true);
  assert.equal(harness.controller.endTabInteractiveResize(tab), false);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].claim, true);
  assert.equal(harness.controller.isLiveGeometryActive(harness.session), true);
  harness.controller.handleApplied(harness.session, {
    type: "resize-applied",
    resize_epoch: harness.sent[0].resize_epoch,
    cols: 100,
    rows: 30,
    pixel_width: 1000,
    pixel_height: 600,
  });
  assert.equal(harness.controller.isLiveGeometryActive(harness.session), false);
});

test("throttled live geometry schedules a trailing local reflow", () => {
  const harness = createRuntimeHarness();
  const tab = { panes: new Map([[harness.session.id, harness.session]]) };

  harness.controller.beginTabInteractiveResize(tab);
  harness.controller.updateTabInteractiveResize(tab);
  assert.equal(harness.effects.termResize, 1);

  harness.session.fitAddon.proposeDimensions = () => ({ cols: 120, rows: 30 });
  harness.controller.updateTabInteractiveResize(tab);
  assert.equal(harness.effects.termResize, 1);
  assert.equal(harness.windowHarness.timers.size, 1);

  harness.windowHarness.runTimers();
  assert.equal(harness.effects.termResize, 2);
  assert.equal(harness.session.term.cols, 120);
  assert.equal(harness.windowHarness.timers.size, 0);

  harness.controller.endTabInteractiveResize(tab);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].cols, 120);
});

test("font metrics and divider resize share live geometry without ending each other", () => {
  const harness = createRuntimeHarness();
  const tab = { panes: new Map([[harness.session.id, harness.session]]) };

  assert.equal(harness.controller.beginTabInteractiveResize(tab), true);
  assert.equal(harness.controller.beginMetricsLiveGeometry(harness.session), true);
  harness.session.fitAddon.proposeDimensions = () => ({ cols: 110, rows: 30 });
  assert.equal(harness.controller.updateMetricsLiveGeometry(harness.session, { force: true }).ok, true);
  assert.equal(harness.controller.endMetricsLiveGeometry(harness.session), true);
  assert.equal(harness.controller.isLiveGeometryActive(harness.session), true);
  assert.equal(harness.sent.length, 0);

  assert.equal(harness.controller.endTabInteractiveResize(tab), true);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].claim, true);
  assert.equal(harness.sent[0].cols, 110);
});

test("stable structural viewport claims through one live geometry transaction", () => {
  const harness = createRuntimeHarness();
  const tab = { panes: new Map([[harness.session.id, harness.session]]) };

  assert.equal(harness.controller.beginTabStructuralLiveGeometry(tab), true);
  assert.equal(harness.controller.updateTabStructuralLiveGeometry(tab), true);
  assert.equal(harness.controller.endTabStructuralLiveGeometry(tab), true);
  assert.equal(harness.effects.beginHold, 0);
  assert.equal(harness.effects.termResize, 1);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].claim, true);
  assert.equal(harness.controller.isLiveGeometryActive(harness.session), true);
});

test("desktop window resize uses live geometry and one trailing server commit", () => {
  const harness = createRuntimeHarness();
  const tab = { panes: new Map([[harness.session.id, harness.session]]) };

  assert.equal(harness.controller.scheduleTabLiveGeometry(tab), true);
  assert.equal(harness.controller.isLiveGeometryActive(harness.session), true);
  assert.equal(harness.effects.termResize, 1);
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.controller.scheduleTabLiveGeometry(tab), true);
  // One timer guarantees a trailing local Canvas reflow; the other commits the
  // stable terminal size to the server after the window stops moving.
  assert.equal(harness.windowHarness.timers.size, 2);

  harness.windowHarness.runTimers();
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].claim, true);
});

test("a newer resize target waits behind the current epoch and retry reuses that epoch", () => {
  const harness = createRuntimeHarness();
  const tab = { panes: new Map([[harness.session.id, harness.session]]) };
  const first = { cols: 100, rows: 30, pixelWidth: 1000, pixelHeight: 600 };

  assert.equal(harness.controller.sendSize(harness.session, { force: true, dimensions: first }), true);
  const firstEpoch = harness.sent[0].resize_epoch;
  assert.equal(harness.controller.beginTabInteractiveResize(tab), true);
  harness.session.fitAddon.proposeDimensions = () => ({ cols: 120, rows: 40 });
  assert.equal(harness.controller.updateTabInteractiveResize(tab), true);
  assert.equal(harness.controller.endTabInteractiveResize(tab), true);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.session.requestedResizeEpoch, firstEpoch);
  assert.deepEqual(
    {
      cols: harness.session.pendingResizeTarget.cols,
      rows: harness.session.pendingResizeTarget.rows,
      claim: harness.session.pendingResizeTarget.claim,
    },
    { cols: 120, rows: 40, claim: true },
  );

  assert.equal(harness.controller.resendPendingSize(harness.session), true);
  assert.equal(harness.sent.length, 2);
  assert.equal(harness.sent[1].resize_epoch, firstEpoch);

  harness.controller.handleApplied(harness.session, {
    type: "resize-applied",
    resize_epoch: firstEpoch,
    cols: 100,
    rows: 30,
    pixel_width: 1000,
    pixel_height: 600,
  });
  assert.equal(harness.sent.length, 3);
  assert.equal(harness.sent[2].cols, 120);
  assert.equal(harness.sent[2].rows, 40);
  assert.equal(harness.sent[2].claim, true);
  assert.notEqual(harness.sent[2].resize_epoch, firstEpoch);
});

test("force size sync does not resend an already applied target", () => {
  const harness = createRuntimeHarness();
  const dimensions = { cols: 100, rows: 30, pixelWidth: 1000, pixelHeight: 600 };
  assert.equal(harness.controller.sendSize(harness.session, { force: true, dimensions }), true);
  const epoch = harness.sent[0].resize_epoch;
  harness.controller.handleApplied(harness.session, {
    type: "resize-applied",
    resize_epoch: epoch,
    cols: dimensions.cols,
    rows: dimensions.rows,
    pixel_width: dimensions.pixelWidth,
    pixel_height: dimensions.pixelHeight,
  });
  assert.equal(harness.controller.sendSize(harness.session, { force: true, dimensions }), false);
  assert.equal(harness.sent.length, 1);
});

test("current-device claim is sent once and repeated pending claims are deduplicated", () => {
  const harness = createRuntimeHarness();
  harness.session.fitAddon.proposeDimensions = () => ({ cols: 80, rows: 24 });
  harness.session.presentedFitGeneration = harness.session.measuredFitGeneration;
  harness.session.sizeClaimRequired = true;

  assert.equal(harness.controller.claimForCurrentDevice(harness.session), true);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.session.resizeAckPending, true);
  assert.equal(harness.controller.claimForCurrentDevice(harness.session), false);
  assert.equal(harness.sent.length, 1);

  harness.controller.handleApplied(harness.session, {
    type: "resize-applied",
    resize_epoch: harness.sent[0].resize_epoch,
    cols: 80,
    rows: 24,
    pixel_width: 800,
    pixel_height: 480,
  });
  assert.equal(harness.session.sizeClaimRequired, false);
  assert.equal(harness.controller.claimForCurrentDevice(harness.session), false);
  assert.equal(harness.sent.length, 1);
});

test("a current-device claim upgrades an in-flight passive resize after its ACK", () => {
  const harness = createRuntimeHarness();
  assert.equal(harness.controller.resizePane(harness.session, { forceSizeSync: true }).pending, true);
  assert.equal(harness.sent[0].claim, undefined);

  assert.equal(harness.controller.claimForCurrentDevice(harness.session), true);
  assert.equal(harness.session.pendingSizeClaim, true);
  assert.equal(harness.sent.length, 1);

  harness.controller.handleApplied(harness.session, {
    type: "resize-applied",
    resize_epoch: harness.sent[0].resize_epoch,
    cols: 100,
    rows: 30,
    pixel_width: 1000,
    pixel_height: 600,
  });

  assert.equal(harness.sent.length, 2);
  assert.equal(harness.sent[1].claim, true);
  assert.equal(harness.session.pendingSizeClaim, false);
});

test("presentation geometry correction preserves current-device ownership", () => {
  const harness = createRuntimeHarness();
  harness.session.fitAddon.proposeDimensions = () => ({ cols: 80, rows: 24 });
  harness.session.sizeClaimRequired = true;
  assert.equal(harness.controller.claimForCurrentDevice(harness.session), true);
  harness.controller.handleApplied(harness.session, {
    type: "resize-applied",
    resize_epoch: harness.sent[0].resize_epoch,
    cols: 80,
    rows: 24,
    pixel_width: 800,
    pixel_height: 480,
  });

  harness.session.fitAddon.proposeDimensions = () => ({ cols: 90, rows: 25 });
  assert.equal(harness.controller.schedulePresentationResize(harness.session, {
    forceFullRender: true,
    hideUntilRender: true,
  }, { immediate: true }), true);
  assert.equal(harness.sent.length, 2);
  assert.equal(harness.sent[1].claim, true);
});

test("owner rejection keeps the last frame and retries the queued explicit claim", () => {
  const harness = createRuntimeHarness();
  harness.controller.resizePane(harness.session, { forceSizeSync: true });
  harness.controller.claimForCurrentDevice(harness.session);
  const passiveEpoch = harness.sent[0].resize_epoch;

  harness.controller.handleError(harness.session, {
    type: "resize-error",
    resize_epoch: passiveEpoch,
    applied_epoch: String(BigInt(passiveEpoch) + 1n),
    reason: "resize_owner_active",
    cols: 120,
    rows: 40,
    pixel_width: 1200,
    pixel_height: 800,
  });

  assert.equal(harness.session.term.cols, 80);
  assert.equal(harness.session.term.rows, 24);
  assert.equal(harness.session.terminalFrameHeld, true);
  assert.equal(harness.sent.length, 2);
  assert.equal(harness.sent[1].claim, true);
  assert.deepEqual(
    { cols: harness.sent[1].cols, rows: harness.sent[1].rows },
    { cols: 100, rows: 30 },
  );
});

test("a rejected final live resize releases live geometry state without hiding the canvas", () => {
  const harness = createRuntimeHarness();
  const tab = { panes: new Map([[harness.session.id, harness.session]]) };

  harness.controller.beginTabInteractiveResize(tab);
  harness.controller.updateTabInteractiveResize(tab);
  harness.controller.endTabInteractiveResize(tab);
  const epoch = harness.sent[0].resize_epoch;

  harness.controller.handleError(harness.session, {
    type: "resize-error",
    resize_epoch: epoch,
    reason: "resize_failed",
  });

  assert.equal(harness.controller.isLiveGeometryActive(harness.session), false);
  assert.equal(harness.session.renderReady, true);
  assert.equal(harness.session.resizePresentationHold, false);
  assert.ok(harness.ensures.some(({ options }) => options.reason === "resize_error"));
});

test("resize lifecycle disconnects observers, terminal callbacks, timers, and RAF work", () => {
  const windowHarness = createWindowHarness();
  let observerCallback = null;
  let observerDisconnected = false;
  let terminalCallback = null;
  let terminalDisposed = false;
  let applied = 0;
  class FakeResizeObserver {
    constructor(callback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {
      observerDisconnected = true;
    }
  }
  const cleanups = [];
  const lifecycle = createTerminalResizeLifecycle({
    windowObject: windowHarness.windowObject,
    ResizeObserverCtor: FakeResizeObserver,
    applyResize: () => {
      applied += 1;
    },
    registerSessionCleanup: (_session, cleanup) => cleanups.push(cleanup),
    throttleMs: 0,
    settleMs: 0,
  });
  const session = {
    closed: false,
    terminalHost: {},
    term: {
      onResize(callback) {
        terminalCallback = callback;
        return { dispose: () => { terminalDisposed = true; } };
      },
    },
  };
  const tab = {};

  lifecycle.observeHost(session, () => { applied += 10; });
  lifecycle.bindTerminalResize(session, () => { applied += 100; });
  lifecycle.schedule(session, {}, { immediate: true });
  lifecycle.scheduleSessionFrame(session, "owner", () => { applied += 1000; });
  lifecycle.scheduleTabFrame(tab, () => { applied += 10000; });
  assert.equal(applied, 1);

  lifecycle.disposeSession(session);
  lifecycle.cancelTab(tab);
  observerCallback?.();
  terminalCallback?.();
  windowHarness.runFrames();
  windowHarness.runTimers();

  assert.equal(observerDisconnected, true);
  assert.equal(terminalDisposed, true);
  assert.equal(applied, 1);
  cleanups.forEach((cleanup) => cleanup());
});
