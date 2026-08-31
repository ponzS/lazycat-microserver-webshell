import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalUnifiedTransportController } from "../runtime/static/terminal/transport/index.js";

const createDeferred = () => {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const createHarness = () => {
  const connections = [];
  const healthWatchdogs = [];
  const queuedMicrotasks = [];
  const timers = new Map();
  const logicalSyncs = [];
  const membershipRefreshes = [];
  const reconnects = [];
  const sessions = [{
    closed: false,
    connectionChannel: "unified",
    name: "target-a",
    shellEl: { dataset: {} },
  }];
  let activeName = "target-a";
  let online = true;

  const createConnection = (options) => {
    const closed = createDeferred();
    const connection = {
      closeCalls: [],
      closed: closed.promise,
      connectCalls: 0,
      options,
      physicalReadyState: 0,
      resolveClosed: closed.resolve,
      priorities: [],
      close(code, reason) {
        this.closeCalls.push({ code, reason });
      },
      connect() {
        this.connectCalls += 1;
      },
      getPhysicalSocket() {
        return { id: connections.indexOf(this) + 1 };
      },
      setPriority(paneID, priority) {
        this.priorities.push({ paneID, priority });
        return true;
      },
      snapshot() {
        return { physicalReadyState: this.physicalReadyState };
      },
    };
    connections.push(connection);
    return connection;
  };

  const createHealthWatchdog = (options) => {
    const watchdog = {
      connection: null,
      options,
      probes: [],
      starts: 0,
      stops: 0,
      probe(reason) {
        this.probes.push(reason);
        return { action: "ping" };
      },
      setConnection(connection) {
        this.connection = connection;
      },
      start() {
        this.starts += 1;
      },
      stop() {
        this.stops += 1;
        this.connection = null;
      },
    };
    healthWatchdogs.push(watchdog);
    return watchdog;
  };

  const controller = createTerminalUnifiedTransportController({
    windowObject: {
      setTimeout(callback) {
        const id = timers.size + 1;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    createConnection,
    createHealthWatchdog,
    buildConnectionURL: (targetName) => `wss://example.test/ws?name=${targetName}`,
    getActiveName: () => activeName,
    getMembershipPaneIDs: () => ["pane-1"],
    getSessions: () => sessions,
    isClientTarget: (name) => name.startsWith("client:"),
    isOnline: () => online,
    queueMicrotaskImpl: (callback) => queuedMicrotasks.push(callback),
    refreshMembership: (options) => membershipRefreshes.push(options),
    reconnectWorkspaceSessions: (options) => reconnects.push(options),
    scheduleLogicalSync: (options) => logicalSyncs.push(options),
  });

  return {
    controller,
    connections,
    healthWatchdogs,
    logicalSyncs,
    membershipRefreshes,
    queuedMicrotasks,
    reconnects,
    sessions,
    timers,
    setActiveName(value) {
      activeName = value;
    },
    setOnline(value) {
      online = value;
    },
  };
};

test("unified transport creates and reuses one physical connection for a target", () => {
  const harness = createHarness();
  const first = harness.controller.ensure("target-a");

  assert.equal(harness.connections.length, 1);
  assert.equal(first.connectCalls, 1);
  assert.equal(harness.controller.ensure("target-a"), first);
  assert.equal(harness.connections.length, 1);
  assert.equal(harness.healthWatchdogs.length, 1);

  first.physicalReadyState = 1;
  first.options.onStateChange({ physicalReadyState: 1 });
  first.options.onStateChange({ physicalReadyState: 1 });
  assert.deepEqual(harness.logicalSyncs, [{ reason: "unified_open" }]);
  assert.deepEqual(harness.healthWatchdogs[0].probes, ["transport_open"]);

  assert.equal(harness.controller.setPriority("pane-1", 9), true);
  assert.deepEqual(first.priorities, [{ paneID: "pane-1", priority: 9 }]);
  assert.equal(harness.controller.getPhysicalSocket().id, 1);
});

test("target replacement waits for the prior physical close fence", async () => {
  const harness = createHarness();
  const first = harness.controller.ensure("target-a");

  assert.equal(harness.controller.ensure("target-b"), null);
  assert.deepEqual(first.closeCalls, [{ code: 4001, reason: "unified_target_changed" }]);
  assert.equal(harness.controller.ensure("target-b"), null);
  assert.equal(harness.connections.length, 1);

  first.resolveClosed();
  await harness.controller.waitForClosures();
  assert.equal(harness.controller.snapshot().expectedCloseReason, "");
  const second = harness.controller.ensure("target-b");
  assert.ok(second);
  assert.equal(harness.connections.length, 2);
  assert.equal(harness.controller.getTargetName(), "target-b");
});

test("unexpected disconnect keeps its close fence until the old socket really closes", async () => {
  const harness = createHarness();
  const first = harness.controller.ensure("target-a");

  first.options.onPhysicalError({ message: "broken", connection: first });
  assert.equal(harness.controller.getConnection(), null);
  assert.equal(first.closeCalls.length, 1);
  assert.ok(harness.controller.getClosingPromise());
  assert.equal(harness.queuedMicrotasks.length, 1);

  const recovery = harness.queuedMicrotasks.shift()();
  await Promise.resolve();
  assert.ok(harness.controller.getClosingPromise());
  assert.equal(harness.controller.ensure("target-a"), null);
  assert.equal(harness.connections.length, 1);
  assert.deepEqual(harness.membershipRefreshes, []);
  assert.deepEqual(harness.reconnects, []);

  first.resolveClosed();
  await recovery;
  assert.equal(harness.controller.getClosingPromise(), null);
  assert.deepEqual(harness.membershipRefreshes, [{ reason: "transport_recovery" }]);
  assert.deepEqual(harness.reconnects, [{ allowHidden: true }]);

  assert.ok(harness.controller.ensure("target-a"));
  assert.equal(harness.connections.length, 2);
});

test("physical disconnect releases logical streams and recovers after the short close fence", async () => {
  const harness = createHarness();
  const logicalSocket = {
    readyState: 1,
    closeCalls: [],
    close(code, reason) {
      this.readyState = 3;
      this.closeCalls.push({ code, reason });
    },
  };
  harness.sessions[0].socket = logicalSocket;
  const first = harness.controller.ensure("target-a");

  first.options.onPhysicalError({ message: "broken", connection: first });
  assert.deepEqual(logicalSocket.closeCalls, [{ code: 4001, reason: "unified_retry" }]);
  assert.equal(harness.timers.size, 1);

  const recovery = harness.queuedMicrotasks.shift()();
  const closeFenceCallback = harness.timers.values().next().value;
  closeFenceCallback();
  await recovery;

  assert.equal(harness.controller.getClosingPromise(), null);
  assert.deepEqual(harness.membershipRefreshes, [{ reason: "transport_recovery" }]);
  assert.deepEqual(harness.reconnects, [{ allowHidden: true }]);
});

test("physical disconnect marking is owner-scoped and deduplicated", () => {
  const harness = createHarness();
  harness.sessions.push({
    closed: false,
    connectionChannel: "unified",
    name: "target-a",
    shellEl: { dataset: {} },
  });
  const connection = harness.controller.ensure("target-a");

  assert.equal(harness.controller.handlePhysicalDisconnect(connection, "physical_failure"), true);
  assert.equal(harness.sessions[0].shellEl.dataset.connection, "network-error");
  assert.equal(harness.sessions[1].shellEl.dataset.connection, "network-error");
  assert.equal(connection.closeCalls.length, 0);
  assert.equal(harness.controller.handlePhysicalDisconnect(connection, "duplicate"), false);
});

test("logical unified disconnect keeps the gray indicator while physical network stays online", () => {
  const harness = createHarness();
  const connection = harness.controller.ensure("target-a");
  assert.equal(harness.controller.handlePhysicalDisconnect(connection, "logical_attach_failed"), true);
  assert.equal(harness.sessions[0].shellEl.dataset.connection, "reconnecting");
});

test("offline and client targets do not schedule physical recovery", () => {
  const harness = createHarness();
  assert.equal(harness.controller.close("no_connection"), false);
  assert.equal(harness.controller.snapshot().expectedCloseReason, "");

  harness.setOnline(false);
  assert.equal(harness.controller.scheduleRecovery("offline"), false);
  harness.setOnline(true);
  harness.setActiveName("client:desktop");
  assert.equal(harness.controller.scheduleRecovery("client"), false);
  assert.deepEqual(harness.queuedMicrotasks, []);
});
