import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalQueueTaskQueue,
  createTerminalQueueStartupLatch,
  createTerminalQueueConnection,
  decodeTerminalQueueBinaryFrame,
  terminalQueueGateAllowsCreation,
  terminalQueueProtocolVersion,
} from "./runtime/static/terminal_queue_connection.js";
import { TerminalReplayController } from "./runtime/static/terminal_replay_controller.js";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.bufferedAmount = 0;
    this.sent = [];
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data) {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("socket is not open");
    }
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    if (this.readyState >= FakeWebSocket.CLOSING) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSING;
    this.emit("close", { code, reason, wasClean: true });
    this.readyState = FakeWebSocket.CLOSED;
  }

  emit(type, event = {}) {
    if (type === "open") {
      this.readyState = FakeWebSocket.OPEN;
    }
    for (const listener of this.listeners.get(type) || []) {
      listener({ type, target: this, ...event });
    }
  }
}

class SlowCloseWebSocket extends FakeWebSocket {
  close(code = 1000, reason = "") {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = FakeWebSocket.CLOSING;
  }
}

const subscription = (paneID, generation = 1) => ({
  pane_id: paneID,
  stream_id: `stream-${paneID}-${generation}`,
  channel_generation: generation,
  cols: 80,
  rows: 24,
});

const encodeBinaryFrame = (header, payload) => {
  const headerData = new TextEncoder().encode(JSON.stringify(header));
  const frame = new Uint8Array(8 + headerData.byteLength + payload.byteLength);
  frame.set(new TextEncoder().encode("LCQ1"), 0);
  new DataView(frame.buffer).setUint32(4, headerData.byteLength, false);
  frame.set(headerData, 8);
  frame.set(payload, 8 + headerData.byteLength);
  return frame.buffer;
};

const crc32 = (data) => {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
};

test.beforeEach(() => {
  FakeWebSocket.instances = [];
});

test("queue creation is gated by the single physical Fast channel", () => {
  assert.equal(terminalQueueGateAllowsCreation({
    fastReadyStates: ["ready"],
    queueCandidateCount: 10,
  }), false);
  assert.equal(terminalQueueGateAllowsCreation({
    fastReadyStates: ["starting"],
    queueCandidateCount: 10,
  }), false);
  assert.equal(terminalQueueGateAllowsCreation({
    fastReadyStates: ["ready"],
    queueCandidateCount: 10,
  }), false);
  assert.equal(terminalQueueGateAllowsCreation({
    fastReadyStates: ["open"],
    queueCandidateCount: 0,
  }), false);
  assert.equal(terminalQueueGateAllowsCreation({
    fastReadyStates: ["open"],
    queueCandidateCount: 10,
    queueClosing: true,
  }), false);
  assert.equal(terminalQueueGateAllowsCreation({
    fastReadyStates: ["open"],
    queueCandidateCount: 10,
  }), true);
});

test("queue cache tasks run in FIFO order without concurrent local reads", async () => {
  const queue = createTerminalQueueTaskQueue();
  const started = [];
  let active = 0;
  let peakActive = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = queue.enqueue(async () => {
    started.push("first");
    active += 1;
    peakActive = Math.max(peakActive, active);
    await firstGate;
    active -= 1;
    return "first";
  });
  const second = queue.enqueue(async () => {
    started.push("second");
    active += 1;
    peakActive = Math.max(peakActive, active);
    active -= 1;
    return "second";
  });

  await Promise.resolve();
  assert.deepEqual(started, ["first"]);
  assert.equal(queue.snapshot().pending, 2);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(started, ["first", "second"]);
  assert.equal(peakActive, 1);
  assert.equal(queue.snapshot().pending, 0);
});

test("a failed queue cache task releases the next FIFO task", async () => {
  const queue = createTerminalQueueTaskQueue();
  const started = [];

  const failed = queue.enqueue(async () => {
    started.push("failed");
    throw new Error("cache read failed");
  });
  const next = queue.enqueue(async () => {
    started.push("next");
    return "ready";
  });

  await assert.rejects(failed, /cache read failed/);
  assert.equal(await next, "ready");
  assert.deepEqual(started, ["failed", "next"]);
  assert.equal(queue.snapshot().pending, 0);
});

test("a finite Queue startup timeout settles once and releases the next FIFO item", async () => {
  const queue = createTerminalQueueTaskQueue();
  let runTimeout;
  let clearedTimer = false;
  const first = queue.enqueue(async () => {
    const latch = createTerminalQueueStartupLatch({
      timeoutMs: 40_000,
      setTimer: (callback) => {
        runTimeout = callback;
        return 1;
      },
      clearTimer: () => { clearedTimer = true; },
    });
    runTimeout();
    assert.equal(await latch.promise, "timed_out");
    assert.equal(latch.settle("ready"), false);
    return "timed_out";
  });
  const second = queue.enqueue(async () => "next-pane");
  assert.deepEqual(await Promise.all([first, second]), ["timed_out", "next-pane"]);
  assert.equal(clearedTimer, true);
  assert.equal(queue.snapshot().pending, 0);
});

test("logical streams share one physical websocket and replace subscriptions", async () => {
  const connection = createTerminalQueueConnection({ url: "ws://example/ws?mode=queue", WebSocketImpl: FakeWebSocket });
  const first = connection.open(subscription("pane-1"));
  const second = connection.open(subscription("pane-2"));
  assert.equal(FakeWebSocket.instances.length, 1);
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();
  assert.equal(first.readyState, FakeWebSocket.OPEN);
  assert.equal(second.readyState, FakeWebSocket.OPEN);
  const replace = JSON.parse(physical.sent[0]);
  assert.equal(replace.type, "replace-subscriptions");
  assert.equal(replace.protocol_version, terminalQueueProtocolVersion);
  assert.deepEqual(replace.subscriptions.map((item) => item.pane_id), ["pane-1", "pane-2"]);
});

test("pane controls and binary cursor frames route only to the matching logical stream", async () => {
  const connection = createTerminalQueueConnection({ url: "ws://example/ws?mode=queue", WebSocketImpl: FakeWebSocket });
  const first = connection.open(subscription("pane-1"));
  const second = connection.open(subscription("pane-2"));
  const firstMessages = [];
  const secondMessages = [];
  first.addEventListener("message", (event) => firstMessages.push(event));
  second.addEventListener("message", (event) => secondMessages.push(event));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();

  physical.emit("message", { data: JSON.stringify({
    type: "pane-control",
    protocol_version: 1,
    pane_id: "pane-2",
    stream_id: "stream-pane-2-1",
    channel_generation: 1,
    payload: { type: "history-replay-start", delta_from_cursor: "10" },
  }) });
  const binary = encodeBinaryFrame({
    protocol_version: 1,
    pane_id: "pane-2",
    stream_id: "stream-pane-2-1",
    channel_generation: 1,
    start_cursor: "10",
    end_cursor: "13",
  }, new Uint8Array([1, 2, 3]));
  physical.emit("message", { data: binary });
  assert.equal(firstMessages.length, 0);
  assert.equal(secondMessages.length, 2);
  assert.deepEqual(Array.from(new Uint8Array(secondMessages[1].data)), [1, 2, 3]);
  assert.deepEqual(secondMessages[1].queueMetadata, {
    paneID: "pane-2",
    streamID: "stream-pane-2-1",
    channelGeneration: 1,
    startCursor: 10n,
    endCursor: 13n,
  });
});

test("cursor discontinuity becomes a retryable logical connection error", async () => {
  const protocolErrors = [];
  const connection = createTerminalQueueConnection({
    url: "ws://example/ws?mode=queue",
    WebSocketImpl: FakeWebSocket,
    onProtocolError: (error) => protocolErrors.push(error.message),
  });
  const logical = connection.open(subscription("pane-1"));
  const messages = [];
  logical.addEventListener("message", (event) => messages.push(event.data));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();
  physical.emit("message", { data: JSON.stringify({
    type: "pane-control",
    protocol_version: 1,
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    payload: { type: "history-replay-start", delta_from_cursor: "10" },
  }) });
  physical.emit("message", { data: encodeBinaryFrame({
    protocol_version: 1,
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    start_cursor: "11",
    end_cursor: "12",
  }, new Uint8Array([1])) });
  assert.equal(protocolErrors.length, 1);
  assert.match(messages.at(-1), /connection-error/);
});

test("history replay start, binary data, and completion preserve one continuous cursor", async () => {
  const protocolErrors = [];
  const connection = createTerminalQueueConnection({
    url: "ws://example/ws?mode=queue",
    WebSocketImpl: FakeWebSocket,
    onProtocolError: (error) => protocolErrors.push(error.message),
  });
  const logical = connection.open(subscription("pane-1"));
  const messages = [];
  logical.addEventListener("message", (event) => messages.push(event.data));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();

  physical.emit("message", { data: JSON.stringify({
    type: "pane-control",
    protocol_version: 1,
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    payload: { type: "history-replay-start", delta_from_cursor: "10" },
  }) });
  physical.emit("message", { data: encodeBinaryFrame({
    protocol_version: 1,
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    start_cursor: "10",
    end_cursor: "13",
  }, new Uint8Array([1, 2, 3])) });
  physical.emit("message", { data: JSON.stringify({
    type: "pane-control",
    protocol_version: 1,
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    payload: { type: "history-replay-complete", history_cursor: "13" },
  }) });

  assert.equal(protocolErrors.length, 0);
  assert.equal(messages.length, 3);
  assert.deepEqual(Array.from(new Uint8Array(messages[1])), [1, 2, 3]);
  assert.equal(JSON.parse(messages[2]).type, "history-replay-complete");
});

test("Queue metadata drives ReplayController through replay and commit", async () => {
  const connection = createTerminalQueueConnection({ url: "ws://example/ws?mode=queue", WebSocketImpl: FakeWebSocket });
  const logical = connection.open({ ...subscription("pane-1"), history_generation: "hg-1" });
  const controller = new TerminalReplayController();
  const identity = { selector: "target-1", paneID: "pane-1", historyGeneration: "hg-1" };
  const physical = FakeWebSocket.instances[0];
  logical.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      const message = JSON.parse(event.data);
      if (message.type === "history-replay-start") {
        controller.begin({ requestID: "4", connectionEpoch: 2, identity, startCursor: message.delta_from_cursor, targetCursor: message.delta_to_cursor });
      } else if (message.type === "history-replay-complete") {
        controller.complete({ cursor: message.history_cursor, requestID: "4", connectionEpoch: 2, identity });
      }
      return;
    }
    controller.acceptBinary({
      sequence: event.queueMetadata.sequence,
      startCursor: event.queueMetadata.startCursor,
      endCursor: event.queueMetadata.endCursor,
      length: event.data.byteLength,
      requestID: "4",
      connectionEpoch: 2,
      identity,
    });
  });
  physical.emit("open");
  await Promise.resolve();

  physical.emit("message", { data: JSON.stringify({
    type: "pane-control",
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    payload: { type: "history-replay-start", delta_from_cursor: "10", delta_to_cursor: "13" },
  }) });
  const payload = new Uint8Array([1, 2, 3]);
  physical.emit("message", { data: encodeBinaryFrame({
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    history_generation: "hg-1",
    sequence: 1,
    start_cursor: "10",
    end_cursor: "13",
    checksum: crc32(payload).toString(16).padStart(8, "0"),
  }, payload) });
  physical.emit("message", { data: JSON.stringify({
    type: "pane-control",
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    payload: { type: "history-replay-complete", history_cursor: "13" },
  }) });

  assert.equal(controller.snapshot().phase, "awaiting_commit");
  assert.equal(controller.snapshot().expectedCursor, 13n);
  assert.equal(controller.commit().phase, "committed");
});

test("replay completion cursor mismatch requests logical resynchronization", async () => {
  const connection = createTerminalQueueConnection({ url: "ws://example/ws?mode=queue", WebSocketImpl: FakeWebSocket });
  const logical = connection.open(subscription("pane-1"));
  const messages = [];
  logical.addEventListener("message", (event) => messages.push(event.data));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();

  physical.emit("message", { data: JSON.stringify({
    type: "pane-control",
    protocol_version: 1,
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    payload: { type: "history-replay-start", delta_from_cursor: "10" },
  }) });
  physical.emit("message", { data: JSON.stringify({
    type: "pane-control",
    protocol_version: 1,
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    payload: { type: "history-replay-complete", history_cursor: "11" },
  }) });

  const error = JSON.parse(messages.at(-1));
  assert.equal(error.type, "connection-error");
  assert.equal(error.resync_required, true);
});

test("sequence and checksum validation rejects an altered or reordered frame", async () => {
  const protocolErrors = [];
  const connection = createTerminalQueueConnection({
    url: "ws://example/ws?mode=queue",
    WebSocketImpl: FakeWebSocket,
    onProtocolError: (error) => protocolErrors.push(error.message),
  });
  const logical = connection.open(subscription("pane-1"));
  const messages = [];
  logical.addEventListener("message", (event) => messages.push(event.data));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();
  const first = new Uint8Array([1, 2, 3]);
  physical.emit("message", { data: JSON.stringify({
    type: "pane-control",
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    payload: { type: "history-replay-start", delta_from_cursor: "10" },
  }) });
  physical.emit("message", { data: encodeBinaryFrame({
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    start_cursor: "10",
    end_cursor: "13",
    sequence: "1",
    checksum: crc32(first).toString(16),
  }, first) });
  assert.deepEqual(Array.from(new Uint8Array(messages.at(-1))), [1, 2, 3]);
  physical.emit("message", { data: encodeBinaryFrame({
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    start_cursor: "13",
    end_cursor: "14",
    sequence: "3",
    checksum: "00",
  }, new Uint8Array([4])) });
  assert.equal(protocolErrors.length, 1);
  assert.match(messages.at(-1), /connection-error/);
});


test("an invalid first sequence is rejected instead of becoming legacy metadata", async () => {
  const protocolErrors = [];
  const connection = createTerminalQueueConnection({
    url: "ws://example/ws?mode=queue",
    WebSocketImpl: FakeWebSocket,
    onProtocolError: (error) => protocolErrors.push(error.message),
  });
  const logical = connection.open(subscription("pane-1"));
  const messages = [];
  logical.addEventListener("message", (event) => messages.push(event.data));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();
  physical.emit("message", { data: encodeBinaryFrame({
    pane_id: "pane-1",
    stream_id: "stream-pane-1-1",
    channel_generation: 1,
    start_cursor: "10",
    end_cursor: "11",
    sequence: "not-a-sequence",
  }, new Uint8Array([1])) });
  assert.equal(protocolErrors.length, 1);
  assert.equal(messages.length, 1);
});

test("a physical queue error is reported once instead of retrying every logical pane", async () => {
  const connection = createTerminalQueueConnection({ url: "ws://example/ws?mode=queue", WebSocketImpl: FakeWebSocket });
  const first = connection.open(subscription("pane-1"));
  const second = connection.open(subscription("pane-2"));
  const errors = [];
  first.addEventListener("error", (event) => errors.push(["pane-1", event.message]));
  second.addEventListener("error", (event) => errors.push(["pane-2", event.message]));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();

  physical.emit("message", { data: JSON.stringify({
    type: "queue-error",
    protocol_version: 1,
    message: "agent unavailable",
    payload: { type: "connection-error", retryable: true, message: "agent unavailable" },
  }) });
  physical.emit("error");

  assert.deepEqual(errors, [["pane-1", "agent unavailable"]]);
});

test("logical send wraps pane identity and closing the last stream closes the physical socket", async () => {
  const connection = createTerminalQueueConnection({ url: "ws://example/ws?mode=queue", WebSocketImpl: FakeWebSocket });
  const logical = connection.open(subscription("pane-1"));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();
  logical.send(JSON.stringify({ type: "ping" }));
  const control = JSON.parse(physical.sent.at(-1));
  assert.equal(control.type, "pane-control");
  assert.equal(control.pane_id, "pane-1");
  assert.deepEqual(control.control, { type: "ping" });
  logical.close(4001, "promote to fast");
  assert.ok(physical.readyState >= FakeWebSocket.CLOSING);
});

test("keepAliveWhenEmpty preserves an opened physical Queue transport across logical handoff", async () => {
  const connection = createTerminalQueueConnection({
    url: "ws://example/ws?mode=queue",
    WebSocketImpl: FakeWebSocket,
    keepAliveWhenEmpty: true,
  });
  connection.connect();
  assert.equal(FakeWebSocket.instances.length, 1);
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  const logical = connection.open(subscription("pane-1"));
  await Promise.resolve();
  logical.close(4001, "promote to fast");
  await Promise.resolve();
  assert.equal(connection.snapshot().logicalCount, 0);
  assert.equal(connection.snapshot().physicalReadyState, FakeWebSocket.OPEN);
  assert.equal(physical.readyState, FakeWebSocket.OPEN);
  connection.close(4001, "context changed");
  assert.ok(physical.readyState >= FakeWebSocket.CLOSING);
});

test("disposing waits for the physical close event before resolving the closing slot", async () => {
  const connection = createTerminalQueueConnection({ url: "ws://example/ws?mode=queue", WebSocketImpl: SlowCloseWebSocket });
  connection.open(subscription("pane-1"));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();
  let closed = false;
  connection.closed.then(() => { closed = true; });
  connection.close(4001, "gate closed");
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(connection.snapshot().physicalReadyState, FakeWebSocket.CLOSING);
  physical.emit("close", { code: 4001, reason: "gate closed", wasClean: true });
  physical.readyState = FakeWebSocket.CLOSED;
  await Promise.resolve();
  assert.equal(closed, true);
});

test("closing the final logical stream keeps the queue slot occupied until physical close", async () => {
  const connection = createTerminalQueueConnection({ url: "ws://example/ws?mode=queue", WebSocketImpl: SlowCloseWebSocket });
  const logical = connection.open(subscription("pane-1"));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  await Promise.resolve();
  let closed = false;
  connection.closed.then(() => { closed = true; });

  logical.close(4001, "promote to fast");
  await Promise.resolve();
  assert.equal(physical.readyState, FakeWebSocket.CLOSING);
  assert.equal(closed, false);
  assert.throws(() => connection.open(subscription("pane-2")), /closed/);

  physical.emit("close", { code: 1000, reason: "terminal queue has no subscriptions", wasClean: true });
  physical.readyState = FakeWebSocket.CLOSED;
  await Promise.resolve();
  assert.equal(closed, true);
});

test("physical close emits the final closed transport state", async () => {
  const states = [];
  const connection = createTerminalQueueConnection({
    url: "ws://example/ws?mode=queue",
    WebSocketImpl: SlowCloseWebSocket,
    onStateChange: (state) => states.push(state),
  });
  connection.open(subscription("pane-1"));
  const physical = FakeWebSocket.instances[0];
  physical.emit("open");
  physical.emit("close", { code: 1006, reason: "network failure", wasClean: false });
  physical.readyState = FakeWebSocket.CLOSED;
  await Promise.resolve();
  assert.equal(states.at(-1).physicalReadyState, FakeWebSocket.CLOSED);
  assert.equal(connection.snapshot().logicalCount, 0);
});

test("binary decoder rejects truncated frames", () => {
  assert.throws(() => decodeTerminalQueueBinaryFrame(new Uint8Array([1, 2, 3])), /truncated/);
});
