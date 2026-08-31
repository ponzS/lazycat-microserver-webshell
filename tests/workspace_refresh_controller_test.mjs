import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspaceRefreshController,
  createWorkspaceRefreshLifecycle,
} from "../runtime/static/workspace/index.js";

const createTimerWindow = () => {
  let nextID = 1;
  const timers = new Map();
  return {
    clearTimeout: (id) => timers.delete(id),
    setTimeout: (callback, delay) => {
      const id = nextID++;
      timers.set(id, { callback, delay });
      return id;
    },
    delays: () => [...timers.values()].map((entry) => entry.delay),
    size: () => timers.size,
    runNext: async () => {
      const next = timers.entries().next().value;
      if (!next) return false;
      const [id, entry] = next;
      timers.delete(id);
      await entry.callback();
      return true;
    },
  };
};

test("workspace refresh lifecycle owns retry context, backoff, resume, and cleanup", async () => {
  const windowObject = createTimerWindow();
  const navigatorObject = { onLine: true };
  const logs = [];
  let runs = 0;
  const lifecycle = createWorkspaceRefreshLifecycle({
    windowObject,
    navigatorObject,
    random: () => 0.5,
    getActiveName: () => "demo",
    getActiveGeneration: () => 2,
    isCurrentRequest: (name, generation) => name === "demo" && generation === 2,
    runRefresh: async (context) => {
      runs += 1;
      assert.equal(context.focus, true);
      if (runs === 1) throw new Error("temporary");
      return true;
    },
    logInfo: (...args) => logs.push(["info", ...args]),
    logWarning: (...args) => logs.push(["warn", ...args]),
  });

  assert.equal(lifecycle.schedule({ focus: false }), true);
  assert.equal(lifecycle.schedule({ focus: true }), true);
  assert.deepEqual(lifecycle.getContext(), { focus: true, instanceName: "demo", generation: 2 });
  assert.deepEqual(windowObject.delays(), [500]);
  await windowObject.runNext();
  assert.equal(lifecycle.getAttempts(), 1);
  assert.deepEqual(windowObject.delays(), [1000]);
  await windowObject.runNext();
  assert.equal(runs, 2);
  assert.equal(lifecycle.getContext(), null);
  assert.equal(lifecycle.getAttempts(), 0);
  assert.equal(logs.filter(([level]) => level === "warn").length, 1);
  assert.equal(logs.filter(([level]) => level === "info").length, 1);

  navigatorObject.onLine = false;
  assert.equal(lifecycle.schedule({ focus: true }), true);
  assert.equal(windowObject.size(), 0);
  navigatorObject.onLine = true;
  assert.equal(lifecycle.resume(), true);
  assert.deepEqual(windowObject.delays(), [0]);
  assert.equal(lifecycle.dispose(), true);
  assert.equal(windowObject.size(), 0);
  assert.equal(lifecycle.dispose(), false);
  assert.equal(lifecycle.schedule(), false);
});

test("workspace refresh controller separates request metrics from current-state apply", async () => {
  let activeName = "demo@owner";
  let generation = 7;
  let now = 10;
  const metrics = [];
  const traces = [];
  const applied = [];
  const controller = createWorkspaceRefreshController({
    getActiveName: () => activeName,
    getActiveGeneration: () => generation,
    isCurrentRequest: (name, requestGeneration) => name === activeName && requestGeneration === generation,
    fetchWorkspaceState: async () => {
      now = 25;
      return { selector: activeName, tabs: [{ id: "tab-1" }] };
    },
    ensureResponseSelector: (state, name) => assert.equal(state.selector, name),
    observeServerRevision: () => metrics.push("revision"),
    applyWorkspaceState: (state, options) => applied.push({ state, options }),
    markStartupMetric: (name) => metrics.push(name),
    appendStartupTrace: (...args) => traces.push(args),
    performanceNow: () => now,
    measureTask: (name, task) => {
      metrics.push(name);
      return task();
    },
    getTabCount: () => 1,
    lifecycleOptions: {
      windowObject: createTimerWindow(),
      navigatorObject: { onLine: true },
      random: () => 0.5,
    },
  });

  const requested = await controller.request();
  assert.equal(requested.requestName, activeName);
  assert.deepEqual(controller.getLatestRecoveryMetrics(), {
    selector: activeName,
    generation: 7,
    startedAt: 10,
    readyAt: 25,
  });
  controller.apply(requested, { focus: true });
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0].options, { focus: true, instanceName: activeName, generation: 7 });
  assert.ok(metrics.includes("workspaceRequestStartedAt"));
  assert.ok(metrics.includes("workspaceReadyAt"));
  assert.ok(metrics.includes("workspaceAppliedAt"));
  assert.ok(traces.some(([event]) => event === "workspace 应用完成"));

  const stale = await controller.request();
  generation = 8;
  controller.apply(stale, { focus: false });
  assert.equal(applied.length, 1);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  await assert.rejects(controller.request(), /disposed/);
});

test("workspace refresh controller schedules retry after a failed direct refresh", async () => {
  const windowObject = createTimerWindow();
  const controller = createWorkspaceRefreshController({
    getActiveName: () => "demo",
    getActiveGeneration: () => 1,
    isCurrentRequest: () => true,
    fetchWorkspaceState: async () => { throw new Error("offline"); },
    lifecycleOptions: {
      windowObject,
      navigatorObject: { onLine: true },
      random: () => 0.5,
    },
  });
  await assert.rejects(controller.refreshWithRetry({ focus: true }), /offline/);
  assert.deepEqual(controller.getRetryContext(), { focus: true, instanceName: "demo", generation: 1 });
  assert.deepEqual(windowObject.delays(), [500]);
  controller.clearRetry();
  assert.equal(windowObject.size(), 0);
});
