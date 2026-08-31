import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceActivityController } from "../runtime/static/workspace/index.js";

const createWindow = () => {
  let nextID = 1;
  const intervals = new Map();
  const timeouts = new Map();
  return {
    clearInterval: (id) => intervals.delete(id),
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (callback) => { const id = nextID++; intervals.set(id, callback); return id; },
    setTimeout: (callback) => { const id = nextID++; timeouts.set(id, callback); return id; },
    runIntervals: () => [...intervals.values()].forEach((callback) => callback()),
    runTimeouts: () => [...timeouts.values()].forEach((callback) => callback()),
    intervalCount: () => intervals.size,
    timeoutCount: () => timeouts.size,
  };
};

test("activity refresh updates pane state and ignores stale generations", async () => {
  const windowObject = createWindow();
  const pane = { id: "pane-a", busy: false, shellEl: { dataset: {} } };
  const tab = { id: "tab-a", activePaneId: "pane-a", panes: new Map([[pane.id, pane]]) };
  const calls = [];
  const controller = createWorkspaceActivityController({
    windowObject,
    documentObject: { hidden: false },
    navigatorObject: { onLine: true },
    getTabs: () => [tab],
    getCurrentTab: () => tab,
    getActiveTabId: () => tab.id,
    getActiveName: () => "demo@owner",
    getInstanceGeneration: () => 3,
    getActivityURL: (name) => `/activity?name=${name}`,
    fetchFunction: async () => ({
      ok: true,
      json: async () => ({ selector: "demo@owner", panes: [{ id: pane.id, busy: true, command: "top", cwd: "/tmp" }] }),
    }),
    isCurrentInstanceRequest: () => true,
    ensureResponseSelector: () => calls.push("selector"),
    observeServerGeometry: () => calls.push("geometry"),
    recoverSessions: () => calls.push("recover"),
    refreshTabAutoLabel: () => calls.push("label"),
    updateMobileActiveTabTitle: () => calls.push("mobile-title"),
    updateDocumentTitle: () => calls.push("document-title"),
    markSessionActivityNotification: () => calls.push("activity-notification"),
    markSessionIdleNotification: () => calls.push("idle-notification"),
  });

  const result = await controller.refreshActivity();
  assert.equal(result.length, 1);
  assert.equal(pane.busy, true);
  assert.equal(pane.shellEl.dataset.busy, "true");
  assert.ok(calls.includes("selector"));
  assert.ok(calls.includes("document-title"));
});

test("activity timers are latest-only and disposed together", () => {
  const windowObject = createWindow();
  const controller = createWorkspaceActivityController({
    windowObject,
    documentObject: { hidden: false },
    navigatorObject: { onLine: true },
    getActiveName: () => "demo@owner",
    getActivityURL: () => "/activity",
    fetchFunction: async () => ({ ok: true, json: async () => ({ panes: [] }) }),
  });
  assert.equal(controller.startActivityRefresh(), true);
  assert.equal(windowObject.intervalCount(), 1);
  assert.equal(controller.scheduleActivityRefresh(10), true);
  assert.equal(windowObject.timeoutCount(), 1);
  assert.equal(controller.dispose(), true);
  assert.equal(windowObject.intervalCount(), 0);
  assert.equal(windowObject.timeoutCount(), 0);
  assert.equal(controller.dispose(), false);
});
