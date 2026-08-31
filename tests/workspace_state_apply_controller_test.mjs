import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspaceStateApplyController,
  createWorkspaceStateApplyLifecycle,
} from "../runtime/static/workspace/index.js";

const createFrameWindow = () => {
  let nextID = 1;
  const frames = new Map();
  return {
    requestAnimationFrame: (callback) => {
      const id = nextID++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    flush: () => {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback();
      }
    },
    size: () => frames.size,
  };
};

test("workspace state apply reconciles authoritative tabs and panes in applying mode", async () => {
  const windowObject = createFrameWindow();
  const oldPane = { id: "pane-old", name: "demo" };
  const retainedPane = { id: "pane-1", name: "demo", workspaceExitPending: true, exitExpected: true, pendingConnect: false };
  const retainedTab = {
    id: "tab-1",
    label: "Old",
    panes: new Map([[oldPane.id, oldPane], [retainedPane.id, retainedPane]]),
    activePaneId: oldPane.id,
    layout: null,
    button: { remove: () => {} },
  };
  const stalePane = { id: "pane-stale", name: "demo" };
  const staleTab = { id: "tab-stale", panes: new Map([[stalePane.id, stalePane]]) };
  const tabs = new Map([[retainedTab.id, retainedTab], [staleTab.id, staleTab]]);
  const calls = [];
  let recent = [];
  let controller;

  const closeTab = (tabId) => {
    assert.equal(controller.isApplying(), true);
    calls.push(["close-tab", tabId]);
    tabs.delete(tabId);
  };
  const createTab = (options) => {
    assert.equal(controller.isApplying(), true);
    const tab = {
      id: options.id,
      label: options.label,
      panes: new Map(),
      activePaneId: null,
      layout: null,
      button: null,
    };
    tabs.set(tab.id, tab);
    calls.push(["create-tab", tab.id]);
    return tab;
  };
  controller = createWorkspaceStateApplyController({
    getTabs: () => tabs,
    getActiveName: () => "demo",
    getActiveGeneration: () => 4,
    isCurrentRequest: (name, generation) => name === "demo" && generation === 4,
    ensureResponseSelector: () => calls.push(["selector"]),
    responseSelector: (state) => state.selector,
    showToast: (message) => calls.push(["toast", message]),
    readRestartTabForName: () => "",
    clearRestartTabForReload: () => calls.push(["clear-restart"]),
    readRequestedTab: () => "tab-1",
    setWorkspaceGenerationFromState: () => false,
    destroyLocalHistory: (pane) => { calls.push(["destroy-history", pane.id]); return Promise.resolve(); },
    closeTab,
    createTab,
    recreateTabButton: (tab) => calls.push(["button", tab.id]),
    createPaneSession: (tab, name, options) => {
      const pane = { id: options.id, name, socket: null };
      tab.panes.set(pane.id, pane);
      calls.push(["create-pane", pane.id]);
      return pane;
    },
    disposePane: (pane) => calls.push(["dispose-pane", pane.id]),
    updatePaneActivity: (paneState) => calls.push(["activity", paneState.id]),
    renderTabLabel: (tab) => calls.push(["label", tab.id]),
    renderTabLayout: (tab) => calls.push(["layout", tab.id]),
    clearTabButtons: () => calls.push(["clear-buttons"]),
    applyRecentTabIds: (ids) => { recent = ids.slice(0, 2); calls.push(["recent", ...recent]); return recent; },
    loadStoredRecentTabIds: () => [],
    getRecentTabIds: () => recent.slice(),
    readLastActiveTab: () => "",
    setActiveTab: (tabId, options) => calls.push(["active", tabId, options.focus]),
    clearActiveTab: () => calls.push(["clear-active"]),
    updateEmptyState: () => calls.push(["empty"]),
    scheduleOverviewRender: () => calls.push(["overview"]),
    resizeActiveTabForCurrentDevice: () => calls.push(["resize"]),
    connectPendingSessionsForTab: (tab, options) => calls.push(["connect", tab?.id || "", options.allowHidden]),
    flushPendingMembershipRefresh: (reason) => {
      assert.equal(controller.isApplying(), false);
      calls.push(["flush", reason]);
    },
    measureTask: (name, task) => { calls.push(["measure", name]); return task(); },
    lifecycleOptions: { windowObject },
  });

  const state = {
    selector: "demo",
    agent_notice: "agent ready",
    active_tab_id: "tab-1",
    recent_tab_ids: ["tab-1"],
    tabs: [{
      id: "tab-1",
      label: "Authoritative",
      custom_label: true,
      active_pane_id: "pane-1",
      layout: { type: "split" },
      panes: [
        { id: "pane-1", cols: 80, rows: 24 },
        { id: "pane-2", cols: 80, rows: 24 },
      ],
    }],
  };
  assert.equal(controller.apply(state, { focus: true }), true);
  assert.equal(controller.isApplying(), false);
  assert.equal(tabs.has("tab-stale"), false);
  assert.equal(retainedTab.panes.has("pane-old"), false);
  assert.equal(retainedTab.panes.has("pane-2"), true);
  assert.equal(retainedPane.workspaceExitPending, false);
  assert.equal(retainedPane.exitExpected, false);
  assert.equal(retainedPane.pendingConnect, true);
  assert.ok(calls.some(([name, id]) => name === "destroy-history" && id === "pane-stale"));
  assert.ok(calls.some(([name, id]) => name === "dispose-pane" && id === "pane-old"));
  assert.ok(calls.some(([name, id]) => name === "active" && id === "tab-1"));
  assert.deepEqual(calls.at(-1), ["flush", "workspace_restored"]);
  assert.equal(windowObject.size(), 1);
  windowObject.flush();
  assert.ok(calls.some(([name]) => name === "resize"));
  assert.ok(calls.some(([name, id]) => name === "connect" && id === "tab-1"));
});

test("workspace state apply rejects stale state and runApplying always restores the flag", () => {
  const controller = createWorkspaceStateApplyController({
    getActiveName: () => "current",
    getActiveGeneration: () => 2,
    isCurrentRequest: () => false,
    responseSelector: () => "stale",
    lifecycleOptions: { windowObject: createFrameWindow() },
  });
  assert.equal(controller.apply({ selector: "stale", tabs: [] }), false);
  assert.throws(() => controller.runApplying(() => {
    assert.equal(controller.isApplying(), true);
    throw new Error("stop");
  }), /stop/);
  assert.equal(controller.isApplying(), false);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.runApplying(() => true), false);
});

test("workspace state apply lifecycle cancels late frames on dispose", () => {
  const windowObject = createFrameWindow();
  let calls = 0;
  const lifecycle = createWorkspaceStateApplyLifecycle({ windowObject });
  lifecycle.scheduleFrame(() => { calls += 1; });
  assert.equal(windowObject.size(), 1);
  assert.equal(lifecycle.dispose(), true);
  windowObject.flush();
  assert.equal(calls, 0);
  assert.equal(lifecycle.dispose(), false);
});
