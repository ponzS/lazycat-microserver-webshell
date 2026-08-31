import assert from "node:assert/strict";
import test from "node:test";

import { createAppRuntimeRecoveryController } from "../runtime/static/app/index.js";

const createHarness = () => {
  const calls = [];
  const banner = {};
  const pane = { id: "pane-1", name: "demo", shellEl: { dataset: {} } };
  const other = { id: "pane-2", name: "other", shellEl: { dataset: {} } };
  const tab = { id: "tab-1", panes: new Map([[pane.id, pane], [other.id, other]]) };
  let online = true;
  let now = 2000;
  let resolveClosures = null;
  const controller = createAppRuntimeRecoveryController({
    networkBanner: banner,
    getTabs: () => [tab],
    getCurrentTab: () => tab,
    getActiveName: () => "demo",
    getActiveSession: () => pane,
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
    resizeActiveTab: (options) => calls.push(["resize", options]),
    claimActiveSize: (session) => calls.push(`claim:${session.id}`),
    resumeWorkspaceRetry: () => calls.push("resume-workspace"),
    refreshWorkspaceActivity: (options) => calls.push(["activity", options]),
    updateSelection: () => calls.push("selection"),
    renderNetworkMonitor: () => calls.push("network-monitor"),
    showToast: (message) => calls.push(`toast:${message}`),
    appendDebugLog: (...args) => calls.push(["log", ...args]),
    lifecycleOptions: {
      now: () => now,
      userRecoveryThrottleMs: 1500,
    },
  });
  return {
    banner,
    calls,
    controller,
    pane,
    resolveClosures: () => resolveClosures?.(),
    setNow: (value) => { now = value; },
    setOnline: (value) => { online = value; },
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
  assert.equal(harness.controller.handleOnline(), true);
  harness.setOnline(false);
  assert.equal(harness.controller.handleOffline(), true);
  harness.resolveClosures();
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
    ["resize", { forceFullRender: true, hideUntilRender: true }],
    "claim:pane-1",
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
