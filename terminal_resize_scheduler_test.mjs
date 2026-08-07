import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalResizeScheduler } from "./runtime/static/terminal_resize_scheduler.js";

const createHarness = () => {
  let clock = 0;
  let nextHandle = 1;
  const frames = new Map();
  const timers = new Map();
  const calls = [];
  const scheduler = createTerminalResizeScheduler({
    apply: (target, options, context) => calls.push({ target, options, context, at: clock }),
    throttleMs: 80,
    settleMs: 120,
    now: () => clock,
    requestFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => frames.delete(handle),
    setTimer: (callback, delay) => {
      const handle = nextHandle++;
      timers.set(handle, { callback, at: clock + delay });
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
  });

  const runFrames = () => {
    const callbacks = Array.from(frames.values());
    frames.clear();
    callbacks.forEach((callback) => callback(clock));
  };
  const advance = (milliseconds) => {
    clock += milliseconds;
    const due = Array.from(timers.entries()).filter(([, timer]) => timer.at <= clock);
    for (const [handle, timer] of due) {
      timers.delete(handle);
      timer.callback();
    }
  };

  return { scheduler, calls, frames, timers, runFrames, advance };
};

test("rapid resize requests coalesce and preserve the trailing final resize", () => {
  const harness = createHarness();
  const pane = {};

  harness.scheduler.schedule(pane, { forceFullRender: false });
  harness.scheduler.schedule(pane, { hideUntilRender: true });
  assert.equal(harness.frames.size, 1);
  harness.runFrames();

  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0].context, { settled: false });
  assert.deepEqual(harness.calls[0].options, {
    visibleOnly: true,
    forceFullRender: false,
    hideUntilRender: true,
    forceSizeSync: false,
  });

  harness.advance(20);
  harness.scheduler.schedule(pane, { forceFullRender: true });
  harness.advance(40);
  harness.scheduler.schedule(pane, { forceSizeSync: true });
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.frames.size, 0);

  harness.advance(120);
  assert.equal(harness.calls.length, 2);
  assert.deepEqual(harness.calls[1].context, { settled: true });
  assert.deepEqual(harness.calls[1].options, {
    visibleOnly: true,
    forceFullRender: true,
    hideUntilRender: true,
    forceSizeSync: true,
  });
});

test("immediate resize cancels stale scheduled work and applies the latest options once", () => {
  const harness = createHarness();
  const pane = {};

  harness.scheduler.schedule(pane, { forceFullRender: true });
  harness.scheduler.schedule(pane, { visibleOnly: false, hideUntilRender: true }, { immediate: true });

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.deepEqual(harness.calls[0].context, { settled: true });
  assert.deepEqual(harness.calls[0].options, {
    visibleOnly: false,
    forceFullRender: true,
    hideUntilRender: true,
    forceSizeSync: false,
  });

  harness.runFrames();
  harness.advance(500);
  assert.equal(harness.calls.length, 1);
});

test("a lone resize still receives a settled trailing commit", () => {
  const harness = createHarness();
  const pane = {};

  harness.scheduler.schedule(pane, { forceFullRender: true });
  harness.runFrames();
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0].context, { settled: false });

  harness.advance(120);
  assert.equal(harness.calls.length, 2);
  assert.deepEqual(harness.calls[1].context, { settled: true });
  assert.deepEqual(harness.calls[1].options, harness.calls[0].options);
});

test("cancel drops pending resize work", () => {
  const harness = createHarness();
  const pane = {};

  harness.scheduler.schedule(pane, { forceFullRender: true });
  harness.scheduler.cancel(pane);
  harness.runFrames();
  harness.advance(500);

  assert.equal(harness.calls.length, 0);
});
