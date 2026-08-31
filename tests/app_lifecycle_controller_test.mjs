import assert from "node:assert/strict";
import test from "node:test";

import { createAppLifecycle } from "../runtime/static/app/index.js";

class EventTargetStub {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, options });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener, options) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((entry) => entry.listener !== listener || entry.options !== options));
  }

  dispatch(type, event = {}) {
    let result;
    for (const entry of [...(this.listeners.get(type) || [])]) {
      result = entry.listener(event);
      if (entry.options?.once) {
        this.removeEventListener(type, entry.listener, entry.options);
      }
    }
    return result;
  }

  count(type) {
    return (this.listeners.get(type) || []).length;
  }
}

const createWindow = () => {
  const target = new EventTargetStub();
  let nextTimer = 1;
  const intervals = new Map();
  return {
    ...target,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatch: target.dispatch.bind(target),
    count: target.count.bind(target),
    visualViewport: new EventTargetStub(),
    setInterval(callback, delay) {
      const id = nextTimer++;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    runIntervals() {
      for (const timer of intervals.values()) {
        timer.callback();
      }
    },
    intervalCount: () => intervals.size,
  };
};

test("app lifecycle registers global listeners once and releases them on dispose", async () => {
  const windowObject = createWindow();
  const documentObject = new EventTargetStub();
  const visualViewport = windowObject.visualViewport;
  let resolveFonts;
  const fonts = { ready: new Promise((resolve) => { resolveFonts = resolve; }) };
  const calls = [];
  const lifecycle = createAppLifecycle({
    windowObject,
    documentObject,
    visualViewport,
    fonts,
    heartbeatIntervalMs: 10,
    handlers: {
      onOnline: () => calls.push("online"),
      onVisibilityChange: () => calls.push("visibility"),
      onFontsReady: () => calls.push("fonts"),
      onHeartbeat: () => calls.push("heartbeat"),
    },
  });

  assert.equal(lifecycle.start(), true);
  assert.equal(lifecycle.start(), false);
  assert.equal(windowObject.count("online"), 1);
  assert.equal(documentObject.count("visibilitychange"), 1);
  assert.equal(windowObject.intervalCount(), 1);
  windowObject.dispatch("online");
  windowObject.runIntervals();
  assert.deepEqual(calls, ["online", "heartbeat"]);

  assert.equal(lifecycle.dispose(), true);
  assert.equal(lifecycle.dispose(), false);
  assert.equal(windowObject.count("online"), 0);
  assert.equal(documentObject.count("visibilitychange"), 0);
  assert.equal(windowObject.intervalCount(), 0);
  windowObject.dispatch("online");
  windowObject.runIntervals();
  resolveFonts();
  await Promise.resolve();
  assert.deepEqual(calls, ["online", "heartbeat"]);
});

test("beforeunload handler return value remains available through the lifecycle", () => {
  const windowObject = createWindow();
  const documentObject = new EventTargetStub();
  const lifecycle = createAppLifecycle({
    windowObject,
    documentObject,
    heartbeatIntervalMs: 0,
    handlers: { onBeforeUnload: () => "" },
  });
  lifecycle.start();
  assert.equal(windowObject.dispatch("beforeunload", {}), "");
  lifecycle.dispose();
});
