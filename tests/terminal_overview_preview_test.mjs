import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalOverviewPreviewController,
  createTerminalOverviewPreviewStore,
} from "../runtime/static/terminal/overview/index.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, once: options?.once === true });
    this.listeners.set(type, listeners);
  }

  emit(type) {
    const listeners = [...(this.listeners.get(type) || [])];
    for (const entry of listeners) {
      entry.listener({ type, target: this });
      if (entry.once) {
        const current = this.listeners.get(type) || [];
        this.listeners.set(type, current.filter((candidate) => candidate !== entry));
      }
    }
  }
}

const createFakeIndexedDB = () => {
  const databases = new Map();

  const databaseState = (name) => {
    let state = databases.get(name);
    if (!state) {
      state = { stores: new Map() };
      databases.set(name, state);
    }
    return state;
  };

  const createDatabase = (state) => ({
    close() {},
    createObjectStore(name) {
      state.stores.set(name, new Map());
    },
    get objectStoreNames() {
      return { contains: (name) => state.stores.has(name) };
    },
    transaction(storeName) {
      const transaction = new FakeEventTarget();
      const records = state.stores.get(storeName);
      if (!records) {
        throw new Error(`Unknown object store: ${storeName}`);
      }
      let pending = 0;
      let completionQueued = false;
      const queueCompletion = () => {
        if (pending > 0 || completionQueued) {
          return;
        }
        completionQueued = true;
        queueMicrotask(() => transaction.emit("complete"));
      };
      const request = (operation) => {
        const result = new FakeEventTarget();
        result.result = undefined;
        result.error = null;
        pending += 1;
        queueMicrotask(() => {
          try {
            result.result = operation();
            result.emit("success");
          } catch (error) {
            result.error = error;
            transaction.error = error;
            result.emit("error");
            transaction.emit("error");
          } finally {
            pending -= 1;
            queueCompletion();
          }
        });
        return result;
      };
      transaction.objectStore = () => ({
        delete: (key) => request(() => records.delete(key)),
        get: (key) => request(() => records.get(key)),
        getAll: () => request(() => [...records.values()]),
        put: (record) => request(() => {
          records.set(record.key, record);
          return record.key;
        }),
      });
      return transaction;
    },
  });

  return {
    open(name) {
      const request = new FakeEventTarget();
      const state = databaseState(name);
      request.result = createDatabase(state);
      request.error = null;
      queueMicrotask(() => {
        if (state.stores.size === 0) {
          request.emit("upgradeneeded");
        }
        request.emit("success");
      });
      return request;
    },
  };
};

const waitFor = async (predicate, message = "condition") => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`Timed out waiting for ${message}`);
};

const paneIdentity = (overrides = {}) => ({
  id: "pane-1",
  tabId: "tab-1",
  name: "debug@cloud.lazycat.lightos.entry",
  workspaceGeneration: "workspace-1",
  historyGeneration: "history-1",
  renderGeneration: 1,
  renderReady: true,
  hasPresentedFrame: true,
  closed: false,
  term: { canvas: { width: 1000, height: 500 } },
  ...overrides,
});

const createCanvasDocument = ({ encodedCallbacks = null } = {}) => ({
  createElement(type) {
    assert.equal(type, "canvas");
    return {
      width: 0,
      height: 0,
      getContext(contextType) {
        assert.equal(contextType, "2d");
        return { drawImage() {} };
      },
      toBlob(callback) {
        if (encodedCallbacks) {
          encodedCallbacks.push(callback);
          return;
        }
        queueMicrotask(() => callback(new Blob(["preview"], { type: "image/webp" })));
      },
    };
  },
});

test("overview preview store persists only bounded identity-scoped image records", async () => {
  const indexedDB = createFakeIndexedDB();
  let currentTime = 1000;
  const store = createTerminalOverviewPreviewStore({
    indexedDBObject: indexedDB,
    databaseName: "preview-store-test",
    maxEntries: 2,
    maxAgeMs: 100,
    now: () => currentTime,
  });
  const blob = new Blob(["preview"], { type: "image/webp" });
  const first = paneIdentity({ id: "pane-1" });
  const second = paneIdentity({ id: "pane-2" });
  const third = paneIdentity({ id: "pane-3" });

  await store.save(first, blob, { width: 100, height: 50, historyGeneration: "history-1" });
  currentTime += 10;
  await store.save(second, blob, { width: 100, height: 50, historyGeneration: "history-2" });
  currentTime += 10;
  await store.save(third, blob, { width: 100, height: 50, historyGeneration: "history-3" });

  assert.equal(await store.load(first), null);
  assert.equal((await store.load(second))?.historyGeneration, "history-2");
  assert.equal((await store.load(third))?.historyGeneration, "history-3");
  assert.equal(await store.load(paneIdentity({ id: "pane-2", tabId: "tab-other" })), null);

  currentTime += 200;
  assert.equal(await store.cleanup(), 2);
  assert.equal(await store.load(second), null);
  store.dispose();
});

test("overview preview survives controller recreation and rejects a changed history identity", async () => {
  const indexedDB = createFakeIndexedDB();
  const databaseName = "preview-controller-reload-test";
  const pane = paneIdentity();
  const first = createTerminalOverviewPreviewController({
    documentObject: createCanvasDocument(),
    windowObject: { indexedDB },
    store: createTerminalOverviewPreviewStore({ indexedDBObject: indexedDB, databaseName }),
    canCapturePane: () => true,
  });

  assert.equal(first.capture(pane, { immediate: true }), true);
  await waitFor(async () => {
    const reader = createTerminalOverviewPreviewStore({ indexedDBObject: indexedDB, databaseName });
    const record = await reader.load(pane);
    reader.dispose();
    return Boolean(record);
  }, "persisted preview");
  first.dispose();

  const ready = [];
  const second = createTerminalOverviewPreviewController({
    windowObject: { indexedDB },
    store: createTerminalOverviewPreviewStore({ indexedDBObject: indexedDB, databaseName }),
    canCapturePane: () => false,
    decodePreviewBlob: async () => ({ width: 640, height: 320, close() {} }),
    onReady: (currentPane) => ready.push(currentPane.id),
  });
  const restored = await second.prepare(pane);
  assert.equal(restored?.width, 640);
  assert.deepEqual(ready, ["pane-1"]);
  assert.equal(second.get(pane), restored);

  pane.historyGeneration = "history-2";
  assert.equal(second.get(pane), null);
  const reader = createTerminalOverviewPreviewStore({ indexedDBObject: indexedDB, databaseName });
  assert.equal((await reader.load(paneIdentity()))?.historyGeneration, "history-1");
  reader.dispose();
  second.dispose();
});

test("overview preview capture and decode use latest-only lifecycle guards", async () => {
  const encodedCallbacks = [];
  const saved = [];
  const pane = paneIdentity();
  const store = {
    cleanup: async () => 0,
    delete: async () => true,
    dispose() {},
    load: async () => null,
    save: async (_identity, _blob, metadata) => saved.push(metadata.renderGeneration),
  };
  const controller = createTerminalOverviewPreviewController({
    documentObject: createCanvasDocument({ encodedCallbacks }),
    windowObject: {},
    store,
    canCapturePane: () => true,
  });

  controller.capture(pane, { immediate: true });
  pane.renderGeneration = 2;
  controller.capture(pane, { immediate: true });
  assert.equal(encodedCallbacks.length, 2);
  encodedCallbacks[0](new Blob(["old"], { type: "image/webp" }));
  encodedCallbacks[1](new Blob(["new"], { type: "image/webp" }));
  await waitFor(() => saved.length === 1, "latest capture");
  assert.deepEqual(saved, [2]);
  controller.dispose();

  const timers = new Map();
  let nextTimer = 1;
  const throttledSaved = [];
  const throttledPane = paneIdentity();
  const throttledController = createTerminalOverviewPreviewController({
    documentObject: createCanvasDocument(),
    windowObject: {
      clearTimeout(handle) { timers.delete(handle); },
      setTimeout(callback) {
        const handle = nextTimer++;
        timers.set(handle, callback);
        return handle;
      },
    },
    store: {
      cleanup: async () => 0,
      delete: async () => true,
      dispose() {},
      load: async () => null,
      save: async (_identity, _blob, metadata) => throttledSaved.push(metadata.renderGeneration),
    },
    canCapturePane: () => true,
  });
  throttledController.capture(throttledPane);
  throttledPane.renderGeneration = 2;
  throttledController.capture(throttledPane);
  throttledPane.renderGeneration = 3;
  throttledController.capture(throttledPane);
  assert.equal(timers.size, 1);
  const [runThrottledCapture] = timers.values();
  timers.clear();
  runThrottledCapture();
  await waitFor(() => throttledSaved.length === 1, "throttled latest capture");
  assert.deepEqual(throttledSaved, [3]);
  throttledController.dispose();

  let resolveDecode = null;
  let closed = 0;
  let ready = 0;
  const latePane = paneIdentity({ historyGeneration: "" });
  const lateController = createTerminalOverviewPreviewController({
    windowObject: {},
    store: {
      cleanup: async () => 0,
      delete: async () => true,
      dispose() {},
      load: async () => ({
        key: JSON.stringify([1, latePane.name, latePane.workspaceGeneration, latePane.tabId, latePane.id]),
        selector: latePane.name,
        workspaceGeneration: latePane.workspaceGeneration,
        tabID: latePane.tabId,
        paneID: latePane.id,
        historyGeneration: "history-1",
        blob: new Blob(["preview"], { type: "image/webp" }),
      }),
      save: async () => null,
    },
    decodePreviewBlob: () => new Promise((resolve) => { resolveDecode = resolve; }),
    onReady: () => { ready += 1; },
  });
  const pending = lateController.prepare(latePane);
  await waitFor(() => typeof resolveDecode === "function", "pending decode");
  lateController.dispose();
  resolveDecode({ width: 100, height: 50, close() { closed += 1; } });
  assert.equal(await pending, null);
  assert.equal(closed, 1);
  assert.equal(ready, 0);
});
