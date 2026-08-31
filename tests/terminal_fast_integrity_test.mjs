import test from "node:test";
import assert from "node:assert/strict";
import { decodeFastBinaryFrame, encodeFastBinaryFrame } from "../runtime/static/terminal/transport/index.js";

test("Fast LCF1 envelope round-trips identity, range, sequence, and checksum", () => {
  const frame = encodeFastBinaryFrame({
    selector: "demo@owner",
    paneID: "pane-1",
    historyGeneration: "history-1",
    sequence: 7,
    startCursor: 42n,
    payload: new TextEncoder().encode("hello"),
  });
  const decoded = decodeFastBinaryFrame(frame, {
    selector: "demo@owner",
    paneID: "pane-1",
    historyGeneration: "history-1",
  });
  assert.equal(decoded.sequence, 7n);
  assert.equal(decoded.startCursor, 42n);
  assert.equal(decoded.endCursor, 47n);
  assert.equal(new TextDecoder().decode(decoded.payload), "hello");
});

test("Fast LCF1 envelope rejects identity, sequence metadata, length, and checksum corruption", () => {
  const frame = encodeFastBinaryFrame({ selector: "demo@owner", paneID: "pane-1", historyGeneration: "h1", sequence: 1, startCursor: 0n, payload: new Uint8Array([1, 2, 3]) });
  assert.throws(() => decodeFastBinaryFrame(frame, { selector: "other@owner", paneID: "pane-1", historyGeneration: "h1" }), /identity/);
  const headerLength = new DataView(frame.buffer).getUint32(4, false);
  const reordered = frame.slice();
  const header = JSON.parse(new TextDecoder().decode(reordered.subarray(8, 8 + headerLength)));
  header.sequence = "2";
  reordered.set(new TextEncoder().encode(JSON.stringify(header)), 8);
  assert.throws(() => decodeFastBinaryFrame(reordered, { expectedSequence: 1 }), /sequence/);
  const altered = frame.slice();
  altered[altered.length - 1] ^= 0xff;
  assert.throws(() => decodeFastBinaryFrame(altered), /checksum/);
});

test("Fast LCF1 envelope rejects truncated and malformed frames", () => {
  assert.throws(() => decodeFastBinaryFrame(new Uint8Array([0x4c, 0x43, 0x46, 0x31])), /magic|header/);
  const frame = encodeFastBinaryFrame({ selector: "s", paneID: "p", sequence: 1, startCursor: 0n, payload: new Uint8Array([1]) });
  const headerLength = new DataView(frame.buffer).getUint32(4, false);
  const malformed = frame.slice();
  malformed.set(new TextEncoder().encode("{}"), 8);
  assert.throws(() => decodeFastBinaryFrame(malformed), /JSON|identity|range/);
  assert.ok(headerLength > 0);
});
