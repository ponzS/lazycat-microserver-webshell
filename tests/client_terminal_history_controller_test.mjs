import assert from "node:assert/strict";
import test from "node:test";

import { createClientTerminalHistoryController } from "../runtime/static/terminal/history/client_history_controller.js";

const createSession = (name = "client:device-a") => ({
  name,
  id: "pane-1",
  closed: false,
  historyGeneration: "generation-1",
  historyCacheLoaded: false,
  historyCacheDisabled: false,
  historyCacheLoadPromise: null,
  historyCacheLoadSeq: 0,
  historyCacheSnapshot: null,
  historyCacheResetPromise: Promise.resolve(),
  historyCacheWriteQueue: [],
  historyCacheWriteBytes: 0,
  historyCacheWriteFrame: 0,
  historyCacheWriteTimer: 0,
  historyCacheWritePromise: Promise.resolve(),
  historyCacheDestroyPromise: null,
  historyCacheReplayCommitPending: false,
  historyCacheReplayCommitSeq: 0,
  localBaseCursor: 0n,
  persistedHistoryCursor: 0n,
  appliedHistoryCursor: 0n,
  historyStateReady: false,
  resetOnNextReplay: false,
});

test("ordinary container sessions never access the client IndexedDB store", async () => {
  const calls = [];
  const session = createSession("container@owner");
  const controller = createClientTerminalHistoryController({
    historyStore: new Proxy({}, { get: (_, key) => (...args) => calls.push([key, ...args]) }),
    isClientTarget: (name) => name.startsWith("client:"),
  });

  assert.equal(await controller.prepareSession(session), null);
  assert.equal(controller.queueWrite(session, new Uint8Array([1]), 0n, 1n), false);
  assert.equal(controller.resetSession(session, "generation-2", 0n), false);
  assert.equal(await controller.deleteSession(session), false);
  assert.deepEqual(calls, []);
  assert.equal(session.historyCacheDisabled, true);
});

test("client sessions retain the IndexedDB load, append, and reset path", async () => {
  const calls = [];
  const session = createSession();
  const historyStore = {
    async load(name, pane) {
      calls.push(["load", name, pane]);
      return { generation: "generation-1", baseCursor: 2n, endCursor: 4n, chunks: [] };
    },
    async append(name, pane, generation, chunks) {
      calls.push(["append", name, pane, generation, chunks.length]);
      return { baseCursor: 2n, endCursor: 6n };
    },
    async reset(name, pane, generation, cursor) {
      calls.push(["reset", name, pane, generation, cursor]);
      return { baseCursor: cursor, endCursor: cursor };
    },
    async deletePane() {},
    async touch() {},
    async cleanupExpired() {},
  };
  const controller = createClientTerminalHistoryController({
    historyStore,
    isClientTarget: (name) => name.startsWith("client:"),
    flushBytes: 1,
  });

  const snapshot = await controller.prepareSession(session);
  assert.equal(snapshot.endCursor, 4n);
  assert.equal(controller.queueWrite(session, new Uint8Array([5, 6]), 4n, 6n), true);
  await controller.flushSession(session);
  assert.equal(session.persistedHistoryCursor, 6n);

  session.historyGeneration = "generation-2";
  assert.equal(controller.resetSession(session, "generation-2", 9n), true);
  await session.historyCacheResetPromise;
  assert.equal(session.persistedHistoryCursor, 9n);
  assert.deepEqual(calls, [
    ["load", "client:device-a", "pane-1"],
    ["append", "client:device-a", "pane-1", "generation-1", 1],
    ["reset", "client:device-a", "pane-1", "generation-2", 9n],
  ]);
});
