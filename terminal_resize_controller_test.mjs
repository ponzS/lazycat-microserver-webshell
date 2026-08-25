import assert from "node:assert/strict";
import test from "node:test";
import { TerminalResizeController } from "./runtime/static/terminal_resize_controller.js";

const request = () => {
  const controller = new TerminalResizeController();
  controller.request({ requestID: "resize-1", connectionEpoch: 3, resizeEpoch: 8, dimensions: { cols: 100, rows: 30 } });
  return controller;
};

test("ResizeController accepts ACK, settle, and commit in order", () => {
  const controller = request();
  assert.equal(controller.acknowledge({ requestID: "resize-1", connectionEpoch: 3, resizeEpoch: 8, dimensions: { cols: 100, rows: 30 } }).phase, "applied");
  const token = controller.beginSettle();
  assert.equal(controller.finishSettle(token + 1), false);
  assert.equal(controller.finishSettle(token), true);
  assert.equal(controller.commit().phase, "committed");
});

test("ResizeController rejects stale ACKs, errors, and callbacks", () => {
  const controller = request();
  assert.throws(() => controller.acknowledge({ requestID: "resize-1", connectionEpoch: 3, resizeEpoch: 7, dimensions: { cols: 100, rows: 30 } }), /stale/);
  assert.throws(() => controller.acknowledge({ requestID: "resize-old", connectionEpoch: 3, resizeEpoch: 8, dimensions: { cols: 100, rows: 30 } }), /mismatch/);
  assert.throws(() => controller.fail({ requestID: "resize-1", connectionEpoch: 2, resizeEpoch: 8 }), /mismatch/);
  assert.throws(() => controller.request({ requestID: "bad", connectionEpoch: 1, resizeEpoch: 1, dimensions: { cols: 0, rows: 30 } }), /invalid/);
});

test("ResizeController prevents settle or commit before a valid ACK", () => {
  const controller = request();
  assert.throws(() => controller.beginSettle(), /not ready/);
  assert.throws(() => controller.commit(), /not ready/);
  controller.fail({ requestID: "resize-1", connectionEpoch: 3, resizeEpoch: 8 });
  assert.throws(() => controller.commit(), /not ready/);
});
