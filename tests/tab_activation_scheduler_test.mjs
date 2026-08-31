import assert from "node:assert/strict";
import test from "node:test";

import { createTabActivationScheduler } from "../runtime/static/workspace/index.js";

const createHarness = () => {
  let nextHandle = 1;
  const frames = new Map();
  const timers = new Map();
  const calls = [];
  const scheduler = createTabActivationScheduler({
    requestFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => frames.delete(handle),
    setTimer: (callback) => {
      const handle = nextHandle++;
      timers.set(handle, callback);
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
  });

  const runFrames = () => {
    const callbacks = Array.from(frames.values());
    frames.clear();
    callbacks.forEach((callback) => callback());
  };
  const runTimers = () => {
    const callbacks = Array.from(timers.values());
    timers.clear();
    callbacks.forEach((callback) => callback());
  };

  return { scheduler, calls, frames, timers, runFrames, runTimers };
};

test("tab activation work starts only after a frame and a task boundary", () => {
  const harness = createHarness();
  harness.scheduler.schedule("tab-a", [() => harness.calls.push("state")]);

  assert.deepEqual(harness.calls, []);
  harness.runFrames();
  assert.deepEqual(harness.calls, []);
  harness.runTimers();
  assert.deepEqual(harness.calls, ["state"]);
});

test("a newer tab invalidates work queued for an older tab", () => {
  const harness = createHarness();
  harness.scheduler.schedule("tab-a", [() => harness.calls.push("a")]);
  harness.scheduler.schedule("tab-b", [() => harness.calls.push("b")]);

  assert.equal(harness.frames.size, 1);
  harness.runFrames();
  harness.runTimers();
  assert.deepEqual(harness.calls, ["b"]);
});

test("activation stages yield through a new frame before each next stage", () => {
  const harness = createHarness();
  harness.scheduler.schedule("tab-a", [
    () => harness.calls.push("state"),
    () => harness.calls.push("resize"),
    () => harness.calls.push("topology"),
  ]);

  harness.runFrames();
  harness.runTimers();
  assert.deepEqual(harness.calls, ["state"]);
  assert.equal(harness.frames.size, 1);

  harness.runFrames();
  harness.runTimers();
  assert.deepEqual(harness.calls, ["state", "resize"]);

  harness.runFrames();
  harness.runTimers();
  assert.deepEqual(harness.calls, ["state", "resize", "topology"]);
  assert.equal(harness.scheduler.snapshot().pending, false);
});

test("cancel drops the remaining activation stages", () => {
  const harness = createHarness();
  harness.scheduler.schedule("tab-a", [
    () => harness.calls.push("state"),
    () => harness.calls.push("resize"),
  ]);
  harness.runFrames();
  harness.runTimers();
  harness.scheduler.cancel();
  harness.runFrames();
  harness.runTimers();

  assert.deepEqual(harness.calls, ["state"]);
  assert.equal(harness.scheduler.snapshot().activeTabID, "");
});
