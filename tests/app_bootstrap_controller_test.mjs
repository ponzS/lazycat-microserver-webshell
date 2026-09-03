import assert from "node:assert/strict";
import test from "node:test";

import { createAppBootstrapController } from "../runtime/static/app/bootstrap/index.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

test("app bootstrap starts modules, prepares prerequisites and applies the current workspace", async () => {
  const calls = [];
  const controller = createAppBootstrapController({
    startControllers: [
      { start: () => calls.push("start:one") },
      { start: () => calls.push("start:two") },
    ],
    ghosttyReady: Promise.resolve(),
    loadTheme: async () => calls.push("load:theme"),
    loadSettings: async () => calls.push("load:settings"),
    loadInstances: async () => calls.push("load:instances"),
    clearStartupInputLock: async () => calls.push("unlock"),
    getActiveName: () => "demo",
    getActiveGeneration: () => 4,
    isCurrentRequest: (name, generation) => name === "demo" && generation === 4,
    requestWorkspace: async (context) => { calls.push(["request", context]); return { tabs: [] }; },
    applyWorkspace: (state, options) => calls.push(["apply", state, options]),
    startWorkspaceActivity: () => calls.push("activity:start"),
    refreshWorkspaceActivity: async (options) => calls.push(["activity:refresh", options]),
    getTabCount: () => 2,
    markStartupMetric: (name) => calls.push(`metric:${name}`),
    appendStartupTrace: (name) => calls.push(`trace:${name}`),
  });

  assert.equal(await controller.start(), true);
  assert.equal(await controller.start(), false);
  assert.deepEqual(calls.slice(0, 5), [
    "start:one",
    "start:two",
    "load:theme",
    "load:settings",
    "load:instances",
  ]);
  assert.ok(calls.some((value) => Array.isArray(value) && value[0] === "apply"));
  assert.ok(calls.includes("activity:start"));
});

test("protocol mismatch pauses bootstrap retries and activity until explicit update", async () => {
  const calls = [];
  const mismatch = new Error("终端服务协议版本不一致，需要确认更新。");
  mismatch.agentProtocolUpdateRequired = true;
  const controller = createAppBootstrapController({
    ghosttyReady: Promise.resolve(),
    getActiveName: () => "demo@owner",
    getActiveGeneration: () => 3,
    isCurrentRequest: () => true,
    requestWorkspace: async () => { throw mismatch; },
    scheduleWorkspaceRetry: () => calls.push("retry"),
    startWorkspaceActivity: () => calls.push("activity:start"),
    refreshWorkspaceActivity: async () => calls.push("activity:refresh"),
    showToast: (message) => calls.push(["toast", message]),
  });

  assert.equal(await controller.start(), true);
  assert.equal(calls.includes("retry"), false);
  assert.equal(calls.includes("activity:start"), false);
  assert.equal(calls.includes("activity:refresh"), false);
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "toast"));
});

test("app bootstrap rejects stale workspace apply and ignores prerequisites after dispose", async () => {
  const calls = [];
  const ghostty = deferred();
  const controller = createAppBootstrapController({
    ghosttyReady: ghostty.promise,
    getActiveName: () => "demo",
    getActiveGeneration: () => 1,
    isCurrentRequest: () => false,
    requestWorkspace: async () => ({ tabs: [] }),
    refreshWorkspaceWithRetry: async (options) => calls.push(["refresh", options]),
    applyWorkspace: () => calls.push("apply"),
  });
  const startPromise = controller.start();
  assert.equal(controller.dispose(), true);
  ghostty.resolve();
  assert.equal(await startPromise, false);
  assert.equal(calls.includes("apply"), false);
  assert.equal(calls.some((value) => Array.isArray(value) && value[0] === "refresh"), false);
});

test("bootstrap failure waits for Ghostty before creating an error terminal", async () => {
  const calls = [];
  const ghostty = deferred();
  const pane = {};
  const tab = { activePaneId: "pane-1", panes: new Map([["pane-1", pane]]) };
  const controller = createAppBootstrapController({
    ghosttyReady: ghostty.promise,
    appendDebugError: (...args) => calls.push(["debug", ...args]),
    showToast: (message) => calls.push(["toast", message]),
    showStartupErrorPanel: (message) => calls.push(["panel", message]),
    clearActiveTarget: () => calls.push("clear-target"),
    createErrorTab: (options) => calls.push(["create-tab", options]),
    getCurrentTab: () => tab,
    writeErrorTerminal: (target, message) => calls.push(["write", target, message]),
  });
  const failure = controller.handleFailure(new Error("startup failed"));
  await Promise.resolve();
  assert.equal(calls.some((value) => Array.isArray(value) && value[0] === "create-tab"), false);
  ghostty.resolve();
  assert.equal(await failure, false);
  assert.ok(calls.some((value) => Array.isArray(value) && value[0] === "create-tab"));
  assert.ok(calls.some((value) => Array.isArray(value) && value[0] === "write" && value[1] === pane));
});
