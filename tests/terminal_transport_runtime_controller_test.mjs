import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalTransportRuntimeController,
  createTerminalTransportRuntimeLifecycle,
} from "../runtime/static/terminal/transport/index.js";

const createClock = () => {
  let nextID = 1;
  const timeouts = new Map();
  const frames = new Map();
  const microtasks = [];
  return {
    windowObject: {
      setTimeout(callback, delay) {
        const id = nextID++;
        timeouts.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        timeouts.delete(id);
      },
      requestAnimationFrame(callback) {
        const id = nextID++;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
    },
    queueMicrotask(callback) {
      microtasks.push(callback);
    },
    runFrames() {
      for (const [id, callback] of Array.from(frames)) {
        frames.delete(id);
        callback();
      }
    },
    runMicrotasks() {
      while (microtasks.length > 0) {
        microtasks.shift()();
      }
    },
    runTimeouts() {
      for (const [id, timer] of Array.from(timeouts)) {
        timeouts.delete(id);
        timer.callback();
      }
    },
    frameCount: () => frames.size,
    timeoutCount: () => timeouts.size,
  };
};

const createPane = (id, tabId, name = "target-a") => ({
  closed: false,
  connectionChannel: "",
  connectionChannelGeneration: 0,
  connectionEpoch: 0,
  id,
  initialCols: 80,
  initialRows: 24,
  measuredFitGeneration: 1,
  name,
  pendingConnect: true,
  shellEl: {
    dataset: {},
    getBoundingClientRect: () => ({
      left: id.endsWith("2") ? 200 : 0,
      top: tabId === "tab-b" ? 200 : 0,
      width: 180,
      height: 120,
    }),
  },
  socket: null,
  tabId,
  term: { cols: 80, rows: 24 },
});

const createTab = (id, panes, activePaneId = panes[0]?.id || "") => ({
  activePaneId,
  id,
  layout: panes.length === 1
    ? { type: "leaf", paneId: panes[0].id }
    : { type: "split", children: panes.map((pane) => ({ type: "leaf", paneId: pane.id })) },
  panes: new Map(panes.map((pane) => [pane.id, pane])),
});

test("runtime reconciles all container panes over one physical transport", async () => {
  const clock = createClock();
  const first = createPane("pane-1", "tab-a");
  const second = createPane("pane-2", "tab-a");
  const background = createPane("pane-3", "tab-b");
  const tabs = [createTab("tab-a", [first, second], first.id), createTab("tab-b", [background], background.id)];
  const logicalSockets = [];
  const priorities = [];
  const physicalConnection = {};
  let currentPhysicalConnection = null;
  let physicalEnsureCalls = 0;
  const lifecycle = createTerminalTransportRuntimeLifecycle({
    windowObject: clock.windowObject,
    queueMicrotaskImpl: (callback) => clock.queueMicrotask(callback),
  });
  const controller = createTerminalTransportRuntimeController({
    windowObject: clock.windowObject,
    lifecycle,
    getActiveName: () => "target-a",
    getActiveTabID: () => "tab-a",
    getTabs: () => tabs,
    isCurrentSession: () => true,
    getUnifiedTransport: () => ({
      ensure() {
        physicalEnsureCalls += 1;
        currentPhysicalConnection = physicalConnection;
        return physicalConnection;
      },
      close() {
        currentPhysicalConnection = null;
      },
      getClosingPromise: () => null,
      getConnection: () => currentPhysicalConnection,
      setPriority: (paneID, priority) => priorities.push({ paneID, priority }),
    }),
    connectSession(session, options) {
      const socket = {
        closeCalls: [],
        close(code, reason) {
          this.closeCalls.push({ code, reason });
        },
      };
      session.socket = socket;
      logicalSockets.push({ session, socket, options });
      return true;
    },
    randomUUID: () => `stream-${logicalSockets.length + 1}`,
  });

  assert.equal(controller.refreshMembership({ reason: "initial" }), true);
  clock.runMicrotasks();
  await Promise.resolve();

  assert.equal(logicalSockets.length, 3);
  assert.equal(physicalEnsureCalls, 3);
  assert.equal(new Set(logicalSockets.map(({ session }) => session.connectionChannel)).size, 1);
  assert.deepEqual(controller.snapshot().membership.paneIDs, ["pane-1", "pane-2", "pane-3"]);
  assert.deepEqual(controller.snapshot().membership.priorities, {
    "pane-1": 0,
    "pane-2": 1,
    "pane-3": 3,
  });
  assert.ok(priorities.some((entry) => entry.paneID === "pane-1" && entry.priority === 0));

  assert.equal(controller.recycleUnifiedSession(first, "logical failure", { immediate: true }), true);
  assert.deepEqual(logicalSockets[0].socket.closeCalls, [{ code: 4001, reason: "unified_retry" }]);
  assert.deepEqual(logicalSockets[1].socket.closeCalls, []);
  assert.deepEqual(logicalSockets[2].socket.closeCalls, []);
  assert.equal(clock.timeoutCount(), 1);
});

test("workspace application defers membership and unmeasured panes use lifecycle RAF", () => {
  const clock = createClock();
  const pane = createPane("pane-1", "tab-a");
  pane.measuredFitGeneration = 0;
  const tab = createTab("tab-a", [pane]);
  let applying = true;
  const resizeRequests = [];
  const lifecycle = createTerminalTransportRuntimeLifecycle({
    windowObject: clock.windowObject,
    queueMicrotaskImpl: (callback) => clock.queueMicrotask(callback),
  });
  const controller = createTerminalTransportRuntimeController({
    windowObject: clock.windowObject,
    lifecycle,
    getActiveName: () => "target-a",
    getActiveTabID: () => "tab-a",
    getTabs: () => [tab],
    isApplyingWorkspaceState: () => applying,
    isCurrentSession: () => true,
    getUnifiedTransport: () => ({ getConnection: () => null }),
    scheduleSessionResize: (...args) => resizeRequests.push(args),
  });

  assert.equal(controller.refreshMembership(), false);
  assert.equal(controller.snapshot().membershipRefreshPending, true);
  applying = false;
  assert.equal(controller.flushPendingMembershipRefresh(), true);
  assert.equal(clock.frameCount(), 1);
  clock.runFrames();
  assert.equal(resizeRequests.length, 1);
  assert.equal(resizeRequests[0][0], pane);

  controller.resetMeasurementAttempts(pane);
  controller.refreshMembership({ reason: "retry_measurement" });
  assert.equal(clock.frameCount(), 1);
  controller.unregisterSession(pane);
  assert.equal(clock.frameCount(), 0);
});

test("client runtime grants at most three direct leases and parks background tabs", async () => {
  const clock = createClock();
  const panes = [1, 2, 3, 4].map((index) => createPane(`pane-${index}`, "tab-a", "client:desktop"));
  const background = createPane("pane-5", "tab-b", "client:desktop");
  const tabs = [createTab("tab-a", panes, panes[0].id), createTab("tab-b", [background], background.id)];
  const connects = [];
  const lifecycle = createTerminalTransportRuntimeLifecycle({
    windowObject: clock.windowObject,
    queueMicrotaskImpl: (callback) => clock.queueMicrotask(callback),
  });
  const controller = createTerminalTransportRuntimeController({
    windowObject: clock.windowObject,
    lifecycle,
    getActiveName: () => "client:desktop",
    getActiveTabID: () => "tab-a",
    getTabs: () => tabs,
    isClientTarget: (name) => name.startsWith("client:"),
    isCurrentSession: () => true,
    connectSession(session, options) {
      connects.push({ session, options });
      session.socket = { readyState: 1, close() {} };
      return true;
    },
    random: () => 0.5,
    clientCapacity: 3,
  });
  for (const pane of [...panes, background]) {
    assert.equal(controller.registerSession(pane), true);
  }

  assert.equal(controller.syncConnectionDemands({ reason: "initial" }), true);
  await Promise.resolve();
  assert.equal(connects.length, 3);
  assert.ok(connects.every(({ session }) => session.tabId === "tab-a"));
  assert.equal(controller.currentLease(background), null);
  assert.equal(controller.snapshot().scheduler.activeCount, 3);
  assert.equal(controller.snapshot().scheduler.capacityInvariantViolations, 0);
});

test("transport lifecycle cancels pane timers, RAF, and queued sync after dispose", () => {
  const clock = createClock();
  const session = {};
  const calls = [];
  const lifecycle = createTerminalTransportRuntimeLifecycle({
    windowObject: clock.windowObject,
    queueMicrotaskImpl: (callback) => clock.queueMicrotask(callback),
  });

  lifecycle.schedulePriorityDecay(session, () => calls.push("priority"), 10);
  lifecycle.incrementUnifiedRetryAttempt(session);
  lifecycle.scheduleUnifiedRetry(session, () => calls.push("retry"), 10);
  lifecycle.scheduleMeasurement(session, () => calls.push("measurement"));
  lifecycle.scheduleSync(() => calls.push("sync"));
  assert.equal(clock.timeoutCount(), 2);
  assert.equal(clock.frameCount(), 1);

  lifecycle.dispose([session]);
  assert.equal(clock.timeoutCount(), 0);
  assert.equal(clock.frameCount(), 0);
  clock.runTimeouts();
  clock.runFrames();
  clock.runMicrotasks();
  assert.deepEqual(calls, []);
});
