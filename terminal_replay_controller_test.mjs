import test from "node:test";
import assert from "node:assert/strict";
import { TerminalReplayController } from "./runtime/static/terminal_replay_controller.js";
import { ClientTerminalReplayAdapter } from "./runtime/static/client_terminal_replay.js";

const identity = { selector: "demo@owner", paneID: "pane-1", historyGeneration: "h1" };
const base = () => {
  const controller = new TerminalReplayController();
  controller.begin({ requestID: "replay-1", connectionEpoch: 4, identity, startCursor: 10, targetCursor: 15 });
  return controller;
};

test("client raw replay adapter supplies strict ordered cursors and commits", () => {
  const controller = new TerminalReplayController();
  const adapter = new ClientTerminalReplayAdapter(controller);
  const identity = { selector: "client:one", paneID: "pane-1", historyGeneration: "h1" };
  adapter.begin({ requestID: "replay-1", connectionEpoch: 4, identity, startCursor: 10, targetCursor: 15 });
  adapter.acceptBinary({ data: new Uint8Array([1, 2, 3]), requestID: "replay-1", connectionEpoch: 4, identity });
  adapter.acceptBinary({ data: new Uint8Array([4, 5]), requestID: "replay-1", connectionEpoch: 4, identity });
  assert.equal(adapter.complete({ cursor: 15, requestID: "replay-1", connectionEpoch: 4, identity }).phase, "awaiting_commit");
  assert.equal(controller.commit().phase, "committed");
});

test("client raw replay adapter validates cursor before advancing its sequence", () => {
  const controller = new TerminalReplayController();
  const adapter = new ClientTerminalReplayAdapter(controller);
  const identity = { selector: "client:one", paneID: "pane-1", historyGeneration: "h1" };
  adapter.begin({ requestID: "replay-1", connectionEpoch: 4, identity, startCursor: 10, targetCursor: 12 });
  assert.throws(() => adapter.complete({ cursor: 11, requestID: "replay-1", connectionEpoch: 4, identity }), /cursor mismatch/);
  assert.equal(adapter.snapshot().clientSequence, 1n);
  adapter.acceptBinary({ data: new Uint8Array([1, 2]), requestID: "replay-1", connectionEpoch: 4, identity });
  assert.equal(adapter.complete({ cursor: 12, requestID: "replay-1", connectionEpoch: 4, identity }).phase, "awaiting_commit");
});
test("client raw current replay commits without a binary chunk", () => {
  const controller = new TerminalReplayController();
  const adapter = new ClientTerminalReplayAdapter(controller);
  const identity = { selector: "client:one", paneID: "pane-1", historyGeneration: "h1" };
  adapter.begin({ requestID: "replay-1", connectionEpoch: 4, identity, startCursor: 12, targetCursor: 12 });
  assert.equal(adapter.complete({ cursor: 12, requestID: "replay-1", connectionEpoch: 4, identity }).phase, "awaiting_commit");
  assert.equal(controller.commit().phase, "committed");
});

test("client raw replay rejects stale identity without advancing its cursor", () => {
  const controller = new TerminalReplayController();
  const adapter = new ClientTerminalReplayAdapter(controller);
  const identity = { selector: "client:one", paneID: "pane-1", historyGeneration: "h1" };
  adapter.begin({ requestID: "replay-1", connectionEpoch: 4, identity, startCursor: 10, targetCursor: 12 });
  assert.throws(() => adapter.acceptBinary({
    data: new Uint8Array([1]),
    requestID: "replay-1",
    connectionEpoch: 4,
    identity: { ...identity, paneID: "pane-2" },
  }), /identity|epoch/);
  assert.deepEqual(adapter.snapshot(), { clientSequence: 1n, clientCursor: 10n });
});

test("ReplayController accepts a continuous replay and commits after completion", () => {
  const controller = base();
  controller.acceptBinary({ sequence: 1, startCursor: 10, endCursor: 13, length: 3, requestID: "replay-1", connectionEpoch: 4, identity });
  controller.acceptBinary({ sequence: 2, startCursor: 13, endCursor: 15, length: 2, requestID: "replay-1", connectionEpoch: 4, identity });
  assert.equal(controller.complete({ cursor: 15, requestID: "replay-1", connectionEpoch: 4, identity }).phase, "awaiting_commit");
  assert.equal(controller.commit().phase, "committed");
});

test("legacy replay controller uses identity lifecycle without claiming frame integrity", () => {
  const controller = new TerminalReplayController();
  const legacyIdentity = { selector: "target-1", paneID: "pane-1" };
  controller.beginLegacy({ requestID: "7", connectionEpoch: 3, identity: legacyIdentity });
  assert.equal(controller.snapshot().legacy, true);
  assert.throws(() => controller.completeLegacy({ requestID: "old", connectionEpoch: 3, identity: legacyIdentity }), /mismatch/);
  assert.equal(controller.completeLegacy({ requestID: "7", connectionEpoch: 3, identity: legacyIdentity }).phase, "awaiting_commit");
  assert.equal(controller.commit().phase, "committed");
});
test("ReplayController rejects reordered, gapped, and malformed frames", () => {
  const controller = base();
  assert.throws(() => controller.acceptBinary({ sequence: 2, startCursor: 10, endCursor: 11, length: 1, requestID: "replay-1", connectionEpoch: 4, identity }), /discontinuity/);
  assert.throws(() => controller.acceptBinary({ sequence: 1, startCursor: 11, endCursor: 12, length: 1, requestID: "replay-1", connectionEpoch: 4, identity }), /discontinuity/);
  assert.throws(() => controller.acceptBinary({ sequence: 1, startCursor: 10, endCursor: 12, length: 1, requestID: "replay-1", connectionEpoch: 4, identity }), /discontinuity/);
});

test("ReplayController rejects stale identity, epoch, and request callbacks", () => {
  const controller = base();
  for (const options of [
    { requestID: "replay-old", connectionEpoch: 4, identity },
    { requestID: "replay-1", connectionEpoch: 3, identity },
    { requestID: "replay-1", connectionEpoch: 4, identity: { ...identity, paneID: "pane-2" } },
    { requestID: "replay-1", connectionEpoch: 4, identity: { ...identity, historyGeneration: "h2" } },
  ]) {
    assert.throws(() => controller.acceptBinary({ ...options, sequence: 1, startCursor: 10, endCursor: 11, length: 1 }), /identity|epoch/);
  }
});

test("ReplayController requires the exact completion cursor and commit barrier", () => {
  const controller = base();
  controller.acceptBinary({ sequence: 1, startCursor: 10, endCursor: 15, length: 5, requestID: "replay-1", connectionEpoch: 4, identity });
  assert.throws(() => controller.complete({ cursor: 14, requestID: "replay-1", connectionEpoch: 4, identity }), /cursor mismatch/);
  assert.throws(() => controller.commit(), /not pending/);
  controller.complete({ cursor: 15, requestID: "replay-1", connectionEpoch: 4, identity });
  assert.throws(() => controller.acceptBinary({ sequence: 2, startCursor: 15, endCursor: 16, length: 1, requestID: "replay-1", connectionEpoch: 4, identity }), /outside replay/);
});
