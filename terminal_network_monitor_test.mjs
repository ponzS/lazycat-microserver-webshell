import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalNetworkMonitor,
  terminalNetworkMegabytes,
  terminalNetworkPayloadBytes,
} from "./runtime/static/terminal_network_monitor.js";

class FakeWebSocket {
  constructor(readyState = 0) {
    this.readyState = readyState;
    this.listeners = new Map();
    this.sent = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 2;
  }

  dispatch(type, event = {}) {
    for (const listener of Array.from(this.listeners.get(type) || [])) {
      listener({ type, target: this, ...event });
    }
  }
}

test("network monitor counts UTF-8 and binary WebSocket payload bytes in decimal MB", () => {
  assert.equal(terminalNetworkPayloadBytes("终端"), 6);
  assert.equal(terminalNetworkPayloadBytes(new Uint8Array([1, 2, 3])), 3);
  assert.equal(terminalNetworkPayloadBytes(new ArrayBuffer(4)), 4);
  assert.equal(terminalNetworkMegabytes(1_500_000), 1.5);
});

test("network monitor exposes two direct channels and one physical queue channel", () => {
  let now = 0;
  const monitor = createTerminalNetworkMonitor({ now: () => now });
  const fastOne = new FakeWebSocket(0);
  const fastTwo = new FakeWebSocket(1);
  const queue = new FakeWebSocket(1);

  monitor.attachSocket(fastOne, { kind: "fast" });
  monitor.attachSocket(fastTwo, { kind: "fast" });
  monitor.attachSocket(queue, { kind: "queue" });
  fastOne.readyState = 1;
  fastOne.dispatch("open");

  fastOne.send("abc");
  fastOne.dispatch("message", { data: new Uint8Array([1, 2, 3, 4]).buffer });
  queue.send("终端");
  queue.dispatch("message", { data: new Uint8Array(1_000_000).buffer });
  now = 1000;
  const state = monitor.sample();

  assert.deepEqual(state.channels.map((channel) => channel.label), ["直连通道 1", "直连通道 2", "队列通道"]);
  assert.deepEqual(state.channels.map((channel) => channel.state), ["open", "open", "open"]);
  assert.deepEqual(state.channels.map((channel) => channel.totalBytes), [7, 0, 1_000_006]);
  assert.deepEqual(state.channels.map((channel) => channel.bytesPerSecond), [7, 0, 1_000_006]);
  assert.equal(state.channels[0].receivedBytesPerSecond, 4);
  assert.equal(state.channels[0].sentBytesPerSecond, 3);
  assert.equal(state.channels[2].receivedBytesPerSecond, 1_000_000);
  assert.equal(state.channels[2].sentBytesPerSecond, 6);
  assert.equal(state.sentBytes, 9);
  assert.equal(state.receivedBytes, 1_000_004);
  assert.equal(state.bytesPerSecond, 1_000_013);
});

test("disposing the monitor removes listeners and restores WebSocket methods without further counting", () => {
  let now = 0;
  const socket = new FakeWebSocket(1);
  const originalSend = socket.send;
  const originalClose = socket.close;
  const monitor = createTerminalNetworkMonitor({ now: () => now });
  monitor.attachSocket(socket, { kind: "fast" });
  socket.send("before");
  socket.dispatch("message", { data: "before" });
  socket.close();
  assert.equal(monitor.snapshot().channels[0].state, "closing");
  monitor.dispose();

  assert.equal(socket.send, originalSend);
  assert.equal(socket.close, originalClose);
  socket.send("after");
  socket.dispatch("message", { data: "after" });
  now = 1000;
  const state = monitor.sample();
  assert.equal(state.totalBytes, 12);
});

test("direct targets expose three direct channels instead of a queue slot", () => {
  const monitor = createTerminalNetworkMonitor({ layout: "direct", now: () => 0 });
  const sockets = [new FakeWebSocket(1), new FakeWebSocket(1), new FakeWebSocket(1)];
  for (const socket of sockets) {
    assert.ok(monitor.attachSocket(socket, { kind: "fast" }));
  }
  assert.equal(monitor.attachSocket(new FakeWebSocket(1), { kind: "fast" }), null);
  assert.deepEqual(monitor.snapshot().channels.map((channel) => channel.label), [
    "直连通道 1",
    "直连通道 2",
    "直连通道 3",
  ]);
});

test("multiplexed Fast sockets can bind to stable controller slots", () => {
  const monitor = createTerminalNetworkMonitor({ now: () => 0 });
  const fastTwo = new FakeWebSocket(1);
  const fastOne = new FakeWebSocket(1);
  assert.equal(monitor.attachSocket(fastTwo, { kind: "fast", slot: 1 }).index, 1);
  assert.equal(monitor.attachSocket(fastOne, { kind: "fast", slot: 0 }).index, 0);
  const state = monitor.snapshot();
  assert.equal(state.channels[0].label, "直连通道 1");
  assert.equal(state.channels[1].label, "直连通道 2");
});
