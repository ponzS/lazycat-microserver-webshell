import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalSessionConnectionController,
  createTerminalSessionConnectionLifecycle,
} from "../runtime/static/terminal/transport/index.js";

const createClock = () => {
  let nextID = 1;
  let now = 1000;
  const timeouts = new Map();
  const intervals = new Map();
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
      setInterval(callback, delay) {
        const id = nextID++;
        intervals.set(id, { callback, delay });
        return id;
      },
      clearInterval(id) {
        intervals.delete(id);
      },
    },
    now: () => now,
    advance(value) {
      now += value;
    },
    runTimeouts() {
      for (const [id, timer] of Array.from(timeouts)) {
        timeouts.delete(id);
        timer.callback();
      }
    },
    runIntervals() {
      for (const timer of Array.from(intervals.values())) {
        timer.callback();
      }
    },
    timeoutCount: () => timeouts.size,
    intervalCount: () => intervals.size,
  };
};

const createSocket = (readyState = 1) => ({
  readyState,
  sent: [],
  closed: 0,
  send(value) {
    this.sent.push(value);
  },
  close() {
    this.closed += 1;
    this.readyState = 3;
  },
});

test("session connection lifecycle rejects stale connect and resume timer callbacks", () => {
  const clock = createClock();
  const closes = [];
  const first = createSocket(0);
  const second = createSocket(0);
  const session = { closed: false, id: "pane-1", name: "target-1", socket: first };
  const lifecycle = createTerminalSessionConnectionLifecycle({
    windowObject: clock.windowObject,
    getActiveName: () => "target-1",
    now: clock.now,
    isSocketOpen: (socket) => socket?.readyState === 1,
    isSocketConnecting: (socket) => socket?.readyState === 0,
    closeSocketForReconnect: (...args) => closes.push(args),
    connectTimeoutMs: 10,
    resumeProbeTimeoutMs: 10,
  });

  lifecycle.startSocketConnectTimer(session, first);
  session.socket = second;
  clock.runTimeouts();
  assert.deepEqual(closes, []);

  lifecycle.startSocketConnectTimer(session, second);
  clock.runTimeouts();
  assert.equal(closes.length, 1);
  assert.equal(closes[0][1], second);

  second.readyState = 1;
  lifecycle.probeOpenSocket(session);
  session.socket = createSocket(1);
  clock.runTimeouts();
  assert.equal(closes.length, 1);
});

test("attach readiness timeout is owned only by replay completion", () => {
  const clock = createClock();
  const closes = [];
  const socket = createSocket(1);
  const session = {
    closed: false,
    connectionChannel: "unified",
    id: "pane-1",
    name: "target-1",
    socket,
  };
  const lifecycle = createTerminalSessionConnectionLifecycle({
    windowObject: clock.windowObject,
    now: clock.now,
    isReplayCommitted: () => false,
    closeSocketForReconnect: (...args) => closes.push(args),
    attachReadyTimeoutMs: 20,
  });

  lifecycle.startAttachReadyTimer(session, socket);
  clock.runTimeouts();
  assert.equal(closes.length, 1);
  assert.match(closes[0][2], /attach timed out/);
});

test("socket health monitor closes only the current pane after a real timeout", () => {
  const clock = createClock();
  const closes = [];
  const socket = createSocket(1);
  const sibling = { socket: createSocket(1), lastSocketHealthAt: 1000 };
  const session = {
    agentPreparing: false,
    connectionChannel: "unified",
    id: "pane-1",
    name: "target-1",
    socket,
  };
  const lifecycle = createTerminalSessionConnectionLifecycle({
    windowObject: clock.windowObject,
    now: clock.now,
    closeSocketForReconnect: (...args) => closes.push(args),
    healthTimeoutMs: 25,
    pingIntervalMs: 10,
  });

  lifecycle.startSocketHealthMonitor(session, socket);
  clock.advance(26);
  clock.runIntervals();
  assert.equal(closes.length, 1);
  assert.equal(closes[0][0], session);
  assert.equal(sibling.socket.closed, 0);
});

test("reconnect policy keeps unified failures logical and scheduler-owns direct failures", () => {
  const recycled = [];
  const notified = [];
  const requested = [];
  const controller = createTerminalSessionConnectionController({
    getActiveName: () => "target-1",
    isCurrentSession: () => true,
    isOnline: () => true,
    recycleUnifiedSession: (...args) => recycled.push(args),
    getCurrentLease: (session) => session.lease || null,
    notifyConnectionFailure: (...args) => {
      notified.push(args);
      return true;
    },
    requestConnection: (...args) => requested.push(args),
  });
  const unified = {
    closed: false,
    connectionChannel: "unified",
    id: "pane-1",
    name: "target-1",
    shellEl: { dataset: {} },
    socket: createSocket(1),
  };
  assert.equal(controller.closeSocketForReconnect(unified, unified.socket, "logical failure"), true);
  assert.equal(recycled.length, 1);
  assert.equal(unified.socket.closed, 0);

  const direct = {
    closed: false,
    connectionChannel: "fast",
    connectionLeaseID: 7,
    id: "pane-2",
    lease: { leaseID: 7 },
    name: "target-1",
    shellEl: { dataset: {} },
    socket: createSocket(1),
  };
  assert.equal(controller.scheduleReconnect(direct, { immediate: true }), true);
  assert.equal(notified.length, 1);
  assert.equal(requested.length, 0);
  assert.equal(direct.shellEl.dataset.connection, "reconnecting");
});

test("connection health routes offline, unified, and direct recovery through explicit commands", () => {
  let online = false;
  const banners = [];
  const unifiedSync = [];
  const requests = [];
  const controller = createTerminalSessionConnectionController({
    getActiveName: () => "target-1",
    isCurrentSession: () => true,
    isOnline: () => online,
    setNetworkBanner: (visible) => banners.push(visible),
    scheduleUnifiedSync: (options) => unifiedSync.push(options),
    requestConnection: (...args) => requests.push(args),
    isActivePane: (session) => session.id === "active",
  });
  const session = {
    closed: false,
    connectionChannel: "unified",
    id: "active",
    name: "target-1",
    shellEl: { dataset: {} },
    socket: null,
  };

  assert.equal(controller.checkHealth(session), false);
  assert.deepEqual(banners, [true]);
  assert.equal(session.shellEl.dataset.connection, "offline");

  online = true;
  assert.equal(controller.checkHealth(session), false);
  assert.deepEqual(unifiedSync, [{ reason: "connection_health" }]);

  session.connectionChannel = "fast";
  assert.equal(controller.checkHealth(session, { force: true, allowHidden: true }), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][1].userInteraction, true);
});

test("disposing a session connection controller clears all timer resources", () => {
  const clock = createClock();
  const socket = createSocket(1);
  const session = { closed: false, id: "pane-1", name: "target-1", socket };
  const controller = createTerminalSessionConnectionController({
    windowObject: clock.windowObject,
    getActiveName: () => "target-1",
    isCurrentSession: () => true,
    isOnline: () => true,
  });
  controller.startSocketHealthMonitor(session, socket);
  controller.startAttachReadyTimer(session, socket);
  assert.equal(clock.intervalCount(), 1);
  assert.equal(clock.timeoutCount(), 1);
  assert.equal(controller.disposeSession(session), true);
  assert.equal(clock.intervalCount(), 0);
  assert.equal(clock.timeoutCount(), 0);
  assert.equal(controller.dispose(), true);
});
