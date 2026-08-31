import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspaceTabActivationController,
  createWorkspaceTabRegistry,
} from "../runtime/static/workspace/index.js";

const createClassList = () => {
  const values = new Set();
  return {
    contains: (value) => values.has(value),
    toggle(value, enabled) {
      if (enabled) values.add(value);
      else values.delete(value);
    },
  };
};

const createTab = (id, paneId, pane = {}) => ({
  id,
  activePaneId: paneId,
  panes: new Map([[paneId, {
    id: paneId,
    measuredFitGeneration: 0,
    hasPresentedFrame: true,
    terminalFrameHeld: false,
    ...pane,
  }]]),
  paneEl: { classList: createClassList() },
  button: {
    classList: createClassList(),
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
  },
});

const createHarness = () => {
  const registry = createWorkspaceTabRegistry();
  const first = createTab("tab-1", "pane-1", { measuredFitGeneration: 1 });
  const second = createTab("tab-2", "pane-2");
  registry.set(first.id, first);
  registry.set(second.id, second);
  registry.setActiveTabId(first.id);
  const calls = [];
  let scheduled = null;
  let instanceGeneration = 4;
  const scheduler = {
    schedule(tabId, steps) { scheduled = { tabId, steps }; calls.push(`schedule:${tabId}`); },
    cancel() { calls.push("cancel"); scheduled = null; },
    dispose() { calls.push("dispose-scheduler"); scheduled = null; },
  };
  const tabView = {
    setActiveTabVisuals(items, activeTabId) {
      calls.push(`visual:${activeTabId}`);
      for (const tab of new Set(items)) {
        if (!tab) continue;
        const active = tab.id === activeTabId;
        tab.paneEl.classList.toggle("active", active);
        tab.button.classList.toggle("active", active);
      }
    },
  };
  const controller = createWorkspaceTabActivationController({
    tabRegistry: registry,
    tabView,
    getInstanceGeneration: () => instanceGeneration,
    measureTask: (name, task) => { calls.push(`measure:${name}`); return task(); },
    presentationStateIsCurrent: (pane) => pane.id === "pane-1",
    holdPresentationFrame: (pane) => { calls.push(`hold:${pane.id}`); pane.terminalFrameHeld = true; },
    schedulePresentationFrameRelease: (pane) => calls.push(`release:${pane.id}`),
    beginPresentationHold: (pane) => calls.push(`begin:${pane.id}`),
    setPresentationReady: (pane, ready) => calls.push(`ready:${pane.id}:${ready}`),
    resetMeasurementAttempts: (pane) => calls.push(`measure-reset:${pane.id}`),
    resetSessionUserInput: (pane) => calls.push(`input-reset:${pane.id}`),
    clearTabNotification: (tab) => calls.push(`clear-notification:${tab.id}`),
    rememberRecentTab: (tabId, previousTabId) => calls.push(`recent:${tabId}:${previousTabId}`),
    setActivePane: (tab, paneId, options) => calls.push(["active-pane", tab.id, paneId, options]),
    rememberActiveTab: () => calls.push("remember-active"),
    refreshUploadPanels: () => calls.push("uploads"),
    scrollTabButtonIntoView: () => calls.push("scroll"),
    scheduleOverviewRender: () => calls.push("overview"),
    scheduleVisibleTabResize: (tab, options) => calls.push(["resize", tab.id, options]),
    syncConnectionDemands: (options) => calls.push(["membership", options]),
    persistActiveTab: async (tabId) => calls.push(`persist:${tabId}`),
    now: () => 123,
    schedulerFactory: () => scheduler,
  });
  return {
    calls,
    controller,
    first,
    getScheduled: () => scheduled,
    registry,
    second,
    setInstanceGeneration: (value) => { instanceGeneration = value; },
  };
};

test("tab activation preserves frames before visual commit and defers runtime stages", async () => {
  const harness = createHarness();
  assert.equal(harness.controller.activate("tab-2"), true);
  assert.equal(harness.registry.getActiveTabId(), "tab-2");
  assert.equal(harness.second.panes.get("pane-2").lastUserInteractionAt, 123);
  assert.equal(harness.second.panes.get("pane-2").activationFitPending, true);
  assert.ok(harness.calls.indexOf("hold:pane-1") < harness.calls.indexOf("visual:tab-2"));
  assert.ok(harness.calls.indexOf("hold:pane-2") < harness.calls.indexOf("visual:tab-2"));
  assert.deepEqual(harness.calls.filter((value) => Array.isArray(value)), []);

  const { steps } = harness.getScheduled();
  steps[0]();
  steps[1]();
  steps[2]();
  await Promise.resolve();
  assert.deepEqual(harness.calls.filter((value) => Array.isArray(value)), [
    ["active-pane", "tab-2", "pane-2", { focus: true, resize: false, syncConnection: false }],
    ["resize", "tab-2", { immediate: false }],
    ["membership", { reason: "active_tab_changed", interactionSession: null }],
  ]);
  assert.ok(harness.calls.includes("persist:tab-2"));
});

test("tab activation rejects stale instance work and exposes idempotent cleanup", () => {
  const harness = createHarness();
  harness.controller.activate("tab-2");
  const { steps } = harness.getScheduled();
  harness.setInstanceGeneration(5);
  steps.forEach((step) => step());
  assert.equal(harness.calls.some((value) => Array.isArray(value)), false);
  harness.controller.clear();
  assert.equal(harness.registry.getActiveTabId(), null);
  assert.equal(harness.controller.dispose(), true);
  assert.equal(harness.controller.dispose(), false);
  assert.equal(harness.controller.activate("tab-1"), false);
  assert.ok(harness.calls.includes("dispose-scheduler"));
});

test("tab activation arms release for an already-current frame held while hidden", () => {
  const harness = createHarness();
  const firstPane = harness.first.panes.get("pane-1");
  firstPane.terminalFrameHeld = true;

  harness.controller.activate("tab-2");
  const firstSteps = harness.getScheduled().steps;
  firstSteps.forEach((step) => step());
  harness.controller.activate("tab-1");

  assert.ok(harness.calls.includes("release:pane-1"));
});
