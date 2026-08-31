import assert from "node:assert/strict";
import test from "node:test";

import { createAppRuntimeRecoveryController } from "../runtime/static/app/index.js";

const createHarness = () => {
  const calls = [];
  const runtimeEvents = [];
  const metrics = new Map();
  const timers = new Map();
  let nextTimerID = 1;
  const banner = {};
  const pane = { id: "pane-1", name: "demo", shellEl: { dataset: {} } };
  const other = { id: "pane-2", name: "other", shellEl: { dataset: {} } };
  const tab = { id: "tab-1", panes: new Map([[pane.id, pane], [other.id, other]]) };
  let online = true;
  let recoveryReady = false;
  let now = 2000;
  let resolveClosures = null;
  const controller = createAppRuntimeRecoveryController({
    windowObject: {
      setTimeout(callback, delay) {
        const id = nextTimerID++;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    networkBanner: banner,
    getTabs: () => [tab],
    getCurrentTab: () => tab,
    getActiveName: () => "demo",
    isOnline: () => online,
    clearUnifiedRetry: (session) => calls.push(`clear-retry:${session.id}`),
    isReplayRetryPaused: () => true,
    resumeReplayRetry: (session, reason) => calls.push(["resume-replay", session.id, reason]),
    checkSessionHealth: (session, options) => { calls.push(["health", session.id, options]); return true; },
    probeOpenSocket: (session, options) => calls.push(["probe-socket", session.id, options]),
    setTransportOnline: (value) => calls.push(`online:${value}`),
    probeUnifiedTransport: (reason) => { calls.push(`probe-unified:${reason}`); return false; },
    retryUnifiedTransport: (reason) => { calls.push(`retry-unified:${reason}`); return true; },
    waitForUnifiedClosures: () => new Promise((resolve) => { resolveClosures = resolve; }),
    clearExpectedCloseReason: () => calls.push("clear-close-reason"),
    refreshMembership: (options) => calls.push(["membership", options]),
    syncConnectionDemands: (options) => calls.push(["sync", options]),
    closeUnifiedTransport: (reason) => calls.push(`close:${reason}`),
    rememberWorkspaceRestoreState: () => calls.push("remember"),
    resumeDevices: () => calls.push("devices"),
    claimActiveTabSize: (options) => calls.push(["claim-tab", options]),
    resumeWorkspaceRetry: () => calls.push("resume-workspace"),
    refreshWorkspaceActivity: (options) => calls.push(["activity", options]),
    updateSelection: () => calls.push("selection"),
    renderNetworkMonitor: () => calls.push("network-monitor"),
    showToast: (message) => calls.push(`toast:${message}`),
    appendDebugLog: (...args) => calls.push(["log", ...args]),
    recordRuntimeEvent: (event, details) => runtimeEvents.push({ event, ...details }),
    recordMetric: (name, value = 1) => metrics.set(name, (metrics.get(name) || 0) + value),
    isRecoveryReady: () => recoveryReady,
    onResumeDeadline: (details) => calls.push(["resume-deadline", details]),
    resumeDeadlineMs: 2000,
    lifecycleOptions: {
      now: () => now,
      userRecoveryThrottleMs: 1500,
    },
  });
  return {
    banner,
    calls,
    controller,
    metrics,
    pane,
    resolveClosures: () => resolveClosures?.(),
    runtimeEvents,
    setNow: (value) => { now = value; },
    setOnline: (value) => { online = value; },
    setRecoveryReady: (value) => { recoveryReady = value; },
    runTimers: () => {
      for (const [id, timer] of Array.from(timers)) {
        timers.delete(id);
        timer.callback();
      }
    },
  };
};

test("runtime recovery reconnects only current target sessions and probes paused replay", () => {
  const harness = createHarness();
  assert.equal(harness.controller.reconnectVisibleSessions({ allowHidden: true, probe: true }), true);
  assert.deepEqual(harness.calls.filter((value) => Array.isArray(value)), [
    ["resume-replay", "pane-1", "user_recovery"],
    ["health", "pane-1", { connect: true, force: true, allowHidden: true }],
    ["probe-socket", "pane-1", { allowHidden: true }],
  ]);
});

test("runtime recovery fences a late online close wait after going offline", async () => {
  const harness = createHarness();
  harness.setNow(2300);
  assert.equal(harness.controller.handleOnline(), true);
  harness.setOnline(false);
  assert.equal(harness.controller.handleOffline(), true);
  harness.resolveClosures();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.calls.includes("clear-close-reason"), false);
  assert.equal(harness.pane.shellEl.dataset.connection, "offline");
  assert.equal(harness.banner.hidden, false);
  assert.ok(harness.calls.includes("close:network_offline"));
});

test("runtime recovery preserves resume ordering and throttles gesture probes", () => {
  const harness = createHarness();
  assert.equal(harness.controller.handleVisibilityChange({ hidden: true }), false);
  assert.equal(harness.controller.handleVisibilityChange({ hidden: false }), true);
  assert.deepEqual(harness.calls.slice(0, 4), [
    "remember",
    "devices",
    ["claim-tab", { forceFullRender: true, hideUntilRender: true }],
    "probe-unified:visibility_resume",
  ]);
  harness.calls.length = 0;
  assert.equal(harness.controller.recoverVisibleSessionsFromUserGesture(), true);
  assert.equal(harness.controller.recoverVisibleSessionsFromUserGesture(), false);
  harness.setNow(4000);
  assert.equal(harness.controller.recoverVisibleSessionsFromUserGesture(), true);
  assert.equal(harness.controller.dispose(), true);
  assert.equal(harness.controller.dispose(), false);
  assert.equal(harness.controller.handleFocus(), false);
});

test("focus and pageshow each use one current-device tab claim transaction", () => {
  const harness = createHarness();
  assert.equal(harness.controller.handleFocus(), true);
  assert.deepEqual(
    harness.calls.filter((entry) => Array.isArray(entry) && entry[0] === "claim-tab"),
    [["claim-tab", { forceFullRender: true }]],
  );

  harness.calls.length = 0;
  harness.setNow(2100);
  assert.equal(harness.controller.handlePageShow(), true);
  assert.deepEqual(
    harness.calls.filter((entry) => Array.isArray(entry) && entry[0] === "claim-tab"),
    [["claim-tab", { forceFullRender: true, hideUntilRender: true }]],
  );
});

test("runtime recovery emits bounded resume trace generations", async () => {
  const harness = createHarness();
  assert.equal(harness.controller.handleVisibilityChange({ hidden: false }), true);
  harness.setNow(2100);
  assert.equal(harness.controller.handleFocus(), true);
  harness.setNow(2200);
  assert.equal(harness.controller.handlePageShow(), true);

  const starts = harness.runtimeEvents.filter((entry) => entry.event === "resume_dispatch_start");
  const completes = harness.runtimeEvents.filter((entry) => entry.event === "resume_dispatch_complete");
  assert.deepEqual(starts.map((entry) => [entry.source, entry.resumeGeneration]), [
    ["visibilitychange", 1],
    ["focus", 2],
    ["pageshow", 3],
  ]);
  assert.deepEqual(completes.map((entry) => [entry.source, entry.status]), [
    ["visibilitychange", "completed"],
    ["focus", "completed"],
    ["pageshow", "completed"],
  ]);
  assert.equal(harness.metrics.get("resumeSignals"), 3);
  assert.equal(harness.metrics.get("resumeTransactionsStarted"), 3);
  assert.equal(harness.metrics.get("resumeTransactionsCompleted"), 3);

  harness.setNow(2300);
  assert.equal(harness.controller.handleOnline(), true);
  harness.setOnline(false);
  assert.equal(harness.controller.handleOffline(), true);
  harness.resolveClosures();
  await Promise.resolve();
  assert.equal(harness.runtimeEvents.some((entry) => entry.event === "resume_callback_stale"), true);
  assert.equal(harness.metrics.get("staleRecoveryCallbacks"), 1);
});

test("foreground recovery coalesces lifecycle signals in the same window", () => {
  const harness = createHarness();
  assert.equal(harness.controller.handleVisibilityChange({ hidden: false }), true);
  assert.equal(harness.controller.handleFocus(), true);
  assert.equal(harness.controller.handlePageShow(), true);

  assert.equal(
    harness.runtimeEvents.filter((entry) => entry.event === "resume_dispatch_start").length,
    1,
  );
  assert.equal(
    harness.runtimeEvents.filter((entry) => entry.event === "resume_signal_coalesced").length,
    2,
  );
  assert.equal(
    harness.calls.filter((entry) => Array.isArray(entry) && entry[0] === "claim-tab").length,
    1,
  );
});

test("resume deadline records a gray pending timeout without reporting a network fault", () => {
  const harness = createHarness();
  assert.equal(harness.controller.handleVisibilityChange({ hidden: false }), true);
  harness.runTimers();
  assert.equal(harness.metrics.get("resumeDeadlineExceeded"), 1);
  assert.equal(
    harness.runtimeEvents.some((entry) => entry.event === "resume_deadline_exceeded"),
    true,
  );
  assert.equal(harness.calls.some((entry) => entry[0] === "resume-deadline"), true);
  assert.equal(harness.banner.hidden, undefined);
});

test("resume deadline is classified as met when presentation is already current", () => {
  const harness = createHarness();
  harness.setRecoveryReady(true);
  assert.equal(harness.controller.handleFocus(), true);
  harness.runTimers();
  assert.equal(harness.metrics.get("resumeDeadlineMet"), 1);
  assert.equal(harness.metrics.get("resumeDeadlineExceeded") || 0, 0);
  assert.equal(harness.calls.some((entry) => entry[0] === "resume-deadline"), false);
});

test("a superseded resume deadline is cancelled before the current recovery deadline", () => {
  const harness = createHarness();
  assert.equal(harness.controller.handleVisibilityChange({ hidden: false }), true);
  harness.setNow(2200);
  assert.equal(harness.controller.handleFocus(), true);
  harness.runTimers();
  assert.equal(harness.calls.some((entry) => entry[0] === "resume-deadline"), true);
  assert.equal(harness.runtimeEvents.some((entry) => entry.event === "resume_deadline_stale"), false);
});
