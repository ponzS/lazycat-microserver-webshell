import assert from "node:assert/strict";
import test from "node:test";

import { createDevicesController } from "../runtime/static/devices/index.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

const settle = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener({ target: this, ...event });
    }
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }
}

const createStorage = (values = {}) => {
  const entries = new Map(Object.entries(values));
  return {
    entries,
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };
};

const createFakeWindow = ({ navigatorObject = {} } = {}) => {
  const intervals = new Map();
  const timeouts = new Map();
  let nextTimerID = 1;
  return {
    clearInterval(id) {
      intervals.delete(id);
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    intervals,
    location: { href: "https://webshell.example.test/app/" },
    navigator: navigatorObject,
    runIntervals() {
      for (const { callback } of [...intervals.values()]) {
        callback();
      }
    },
    runTimeouts() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      for (const { callback } of pending) {
        callback();
      }
    },
    setInterval(callback, delay) {
      const id = nextTimerID++;
      intervals.set(id, { callback, delay });
      return id;
    },
    setTimeout(callback, delay) {
      const id = nextTimerID++;
      timeouts.set(id, { callback, delay });
      return id;
    },
    timeouts,
  };
};

const createFakeView = ({ elements = {} } = {}) => {
  const state = {
    controls: [],
    disposed: 0,
    feedback: [],
    focusPanel: [],
    heartbeatChecked: false,
    open: false,
    renders: [],
  };
  return {
    state,
    view: {
      elements,
      closePanel() {
        state.open = false;
      },
      dispose() {
        state.disposed += 1;
        state.open = false;
      },
      focusPanel(options) {
        state.focusPanel.push(options);
      },
      heartbeatEnabled() {
        return state.heartbeatChecked;
      },
      isAvailable: () => true,
      isPanelOpen: () => state.open,
      openPanel() {
        state.open = true;
      },
      renderList(options) {
        state.renders.push({
          ...options,
          devices: options.devices.map((device) => ({ ...device })),
        });
      },
      setFeedback(message, tone = "info") {
        state.feedback.push({ message, tone });
      },
      syncControls(options) {
        state.controls.push({ ...options });
        state.heartbeatChecked = options.heartbeatEnabled;
      },
    },
  };
};

const noLifecycle = () => ({ dispose() {}, start() {} });

test("devices heartbeat is single-flight and debug shutdown aborts all active work", async () => {
  const firstHeartbeat = deferred();
  const secondHeartbeat = deferred();
  const heartbeatSignals = [];
  let heartbeatCalls = 0;
  let offlineCalls = 0;
  const api = {
    heartbeat(_device, { signal }) {
      heartbeatSignals.push(signal);
      heartbeatCalls += 1;
      const pending = heartbeatCalls === 1 ? firstHeartbeat : secondHeartbeat;
      signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        pending.reject(error);
      }, { once: true });
      return pending.promise;
    },
    list: async () => [],
    sendOfflineBeacon() {
      offlineCalls += 1;
      return true;
    },
  };
  const navigatorObject = { onLine: true };
  const fakeWindow = createFakeWindow({ navigatorObject });
  const storage = createStorage({ "webshell.deviceHeartbeat": "true" });
  const { state, view } = createFakeView();
  const errors = [];
  const controller = createDevicesController({
    api,
    view,
    lifecycleFactory: noLifecycle,
    windowObject: fakeWindow,
    navigatorObject,
    storage,
    clientID: "client-a",
    initialDebugMode: true,
    appendError: (...args) => errors.push(args),
  });

  controller.start();
  assert.equal(heartbeatCalls, 1);
  assert.equal(fakeWindow.intervals.size, 1);
  controller.handleResume();
  assert.equal(heartbeatCalls, 1, "resume must reuse the in-flight heartbeat");

  firstHeartbeat.resolve();
  await settle();
  fakeWindow.runIntervals();
  assert.equal(heartbeatCalls, 2);
  assert.equal(controller.snapshot().heartbeat.inFlight, true);

  controller.setDebugMode(false);
  await settle();
  assert.equal(offlineCalls, 1);
  assert.equal(heartbeatSignals[1].aborted, true);
  assert.equal(fakeWindow.intervals.size, 0);
  assert.deepEqual(controller.snapshot().heartbeat, {
    active: false,
    enabled: true,
    inFlight: false,
  });
  assert.equal(state.controls.at(-1).debugMode, false);
  assert.deepEqual(errors, []);

  controller.dispose();
  assert.equal(state.disposed, 1);
});

test("devices report a real heartbeat timeout but ignore lifecycle aborts", async () => {
  const errors = [];
  const navigatorObject = { onLine: true };
  const fakeWindow = createFakeWindow({ navigatorObject });
  const controller = createDevicesController({
    api: {
      heartbeat(_device, { signal }) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      },
      list: async () => [],
      sendOfflineBeacon: () => false,
    },
    view: createFakeView().view,
    lifecycleFactory: noLifecycle,
    windowObject: fakeWindow,
    navigatorObject,
    storage: createStorage({ "webshell.deviceHeartbeat": "true" }),
    initialDebugMode: true,
    heartbeatTimeoutMs: 25,
    appendError: (...args) => errors.push(args),
  });

  controller.start();
  assert.equal(fakeWindow.timeouts.size, 1);
  fakeWindow.runTimeouts();
  await settle();
  assert.deepEqual(errors, [["设备心跳失败", "设备心跳超时 (25ms)"]]);
  assert.equal(controller.snapshot().heartbeat.inFlight, false);

  controller.dispose();
  assert.equal(errors.length, 1);
});

test("devices list rejects responses from a closed or reopened panel generation", async () => {
  const staleList = deferred();
  const listSignals = [];
  let listCalls = 0;
  const api = {
    heartbeat: async () => {},
    list({ signal }) {
      listSignals.push(signal);
      listCalls += 1;
      if (listCalls === 1) {
        return staleList.promise;
      }
      return Promise.resolve([{
        client_id: "beta",
        device_name: "Linux Chrome",
        platform: "Linux",
        account_id: "account-b",
        joined_at: "2026-08-30T10:00:00Z",
      }]);
    },
    sendOfflineBeacon: () => false,
  };
  const navigatorObject = { onLine: true };
  const fakeWindow = createFakeWindow({ navigatorObject });
  const { state, view } = createFakeView();
  const controller = createDevicesController({
    api,
    view,
    lifecycleFactory: noLifecycle,
    windowObject: fakeWindow,
    navigatorObject,
    storage: createStorage(),
    initialDebugMode: true,
  });

  controller.start();
  assert.equal(controller.openPanel(), true);
  assert.equal(listCalls, 1);
  controller.closePanel({ focus: false });
  assert.equal(listSignals[0].aborted, true);
  assert.equal(fakeWindow.intervals.size, 0);

  assert.equal(controller.openPanel(), true);
  await settle();
  assert.equal(listCalls, 2);
  assert.deepEqual(controller.snapshot().list.entries.map((device) => device.client_id), ["beta"]);

  staleList.resolve([{
    client_id: "stale",
    device_name: "Stale Browser",
    platform: "Unknown",
    account_id: "account-a",
  }]);
  await settle();
  assert.deepEqual(controller.snapshot().list.entries.map((device) => device.client_id), ["beta"]);
  assert.equal(state.open, true);

  controller.setDebugMode(false);
  assert.equal(controller.isPanelOpen(), false);
  assert.equal(fakeWindow.intervals.size, 0);
  controller.dispose();
});

test("devices use only provider routes and preserve the browser identity payload", async () => {
  const requests = [];
  const beacons = [];
  const navigatorObject = {
    maxTouchPoints: 5,
    onLine: true,
    platform: "MacIntel",
    sendBeacon(url, body) {
      beacons.push({ body, url: String(url) });
      return true;
    },
    userAgent: "Mozilla/5.0 CriOS/130.0 Mobile Safari/604.1",
  };
  const fetchImpl = async (url, options = {}) => {
    requests.push({
      body: options.body || "",
      cache: options.cache,
      method: options.method || "GET",
      url: String(url),
    });
    if (String(url).endsWith("/api/devices/heartbeat")) {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify([{
      client_id: "client-route",
      device_name: "iOS Chrome",
      platform: "iOS",
      account_id: "account-a",
      joined_at: "2026-08-30T10:00:00Z",
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const fakeWindow = createFakeWindow({ navigatorObject });
  const { view } = createFakeView();
  const controller = createDevicesController({
    fetchImpl,
    view,
    lifecycleFactory: noLifecycle,
    windowObject: fakeWindow,
    navigatorObject,
    storage: createStorage({ "webshell.deviceHeartbeat": "true" }),
    clientID: "client-route",
    initialDebugMode: true,
  });

  controller.start();
  await settle();
  controller.openPanel();
  await settle();
  controller.handlePageHide();

  const heartbeatRequest = requests.find((request) => request.url.endsWith("/api/devices/heartbeat"));
  const listRequest = requests.find((request) => request.url.endsWith("/api/devices"));
  assert.equal(heartbeatRequest.url, "https://webshell.example.test/app/api/devices/heartbeat");
  assert.equal(heartbeatRequest.method, "POST");
  assert.deepEqual(JSON.parse(heartbeatRequest.body), {
    client_id: "client-route",
    device_name: "iOS Chrome",
    platform: "iOS",
  });
  assert.equal(listRequest.url, "https://webshell.example.test/app/api/devices");
  assert.equal(listRequest.method, "GET");
  assert.equal(listRequest.cache, "no-store");
  assert.deepEqual(new Set(requests.map((request) => new URL(request.url).pathname)), new Set([
    "/app/api/devices",
    "/app/api/devices/heartbeat",
  ]));
  assert.equal(beacons[0].url, "https://webshell.example.test/app/api/devices/offline");
  assert.deepEqual(JSON.parse(await beacons[0].body.text()), { client_id: "client-route" });

  controller.dispose();
});

test("devices lifecycle registration and disposal are idempotent", () => {
  const elements = {
    back: new FakeEventTarget(),
    backdrop: new FakeEventTarget(),
    close: new FakeEventTarget(),
    heartbeatToggle: new FakeEventTarget(),
    onlineDevicesButton: new FakeEventTarget(),
  };
  const navigatorObject = { onLine: true };
  const fakeWindow = createFakeWindow({ navigatorObject });
  const { state, view } = createFakeView({ elements });
  const controller = createDevicesController({
    api: {
      heartbeat: async () => {},
      list: async () => [],
      sendOfflineBeacon: () => false,
    },
    view,
    windowObject: fakeWindow,
    navigatorObject,
    storage: createStorage(),
    initialDebugMode: true,
  });

  controller.start();
  controller.start();
  for (const [element, type] of [
    [elements.heartbeatToggle, "change"],
    [elements.onlineDevicesButton, "click"],
    [elements.close, "click"],
    [elements.back, "click"],
    [elements.backdrop, "click"],
  ]) {
    assert.equal(element.listenerCount(type), 1);
  }

  elements.onlineDevicesButton.emit("click");
  assert.equal(controller.isPanelOpen(), true);
  elements.close.emit("click");
  assert.equal(controller.isPanelOpen(), false);

  controller.dispose();
  controller.dispose();
  for (const [element, type] of [
    [elements.heartbeatToggle, "change"],
    [elements.onlineDevicesButton, "click"],
    [elements.close, "click"],
    [elements.back, "click"],
    [elements.backdrop, "click"],
  ]) {
    assert.equal(element.listenerCount(type), 0);
  }
  assert.equal(state.disposed, 1);
});
