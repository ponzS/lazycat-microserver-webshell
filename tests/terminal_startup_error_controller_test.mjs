import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalStartupErrorAPI,
  createTerminalStartupErrorController,
  isRetryableTerminalStartupError,
} from "../runtime/static/terminal/session/index.js";

const createSession = (overrides = {}) => ({
  id: "pane-1",
  tabId: "tab-1",
  name: "demo",
  closed: false,
  startupErrorRequestID: 0,
  startupErrorShown: true,
  connectionRetrying: false,
  hasPresentedFrame: false,
  shellEl: { dataset: {} },
  ...overrides,
});

test("startup error API scopes the request by target and disables caching", async () => {
  const calls = [];
  const api = createTerminalStartupErrorAPI({
    windowObject: { location: { href: "https://example.test/app/" } },
    fetchImpl: async (url, options) => {
      calls.push([url.toString(), options]);
      return { ok: true, json: async () => ({ error: " agent failed " }) };
    },
  });
  assert.equal(await api.read("demo@owner"), "agent failed");
  assert.equal(calls[0][0], "https://example.test/app/api/agent/startup-error?name=demo%40owner");
  assert.deepEqual(calls[0][1], { cache: "no-store" });
  assert.equal(await api.read(""), "");
});

test("startup errors preserve retry and last-known-good frame behavior", async () => {
  const calls = [];
  let apiMessage = "network failure";
  const session = createSession();
  const controller = createTerminalStartupErrorController({
    navigatorObject: { onLine: true },
    apiFactory: () => ({ read: async () => apiMessage }),
    getActiveTabId: () => session.tabId,
    getTabById: () => ({ activePaneId: session.id }),
    isCurrentSession: (candidate) => candidate === session,
    showStartupErrorPanel: (message) => calls.push(["panel", message]),
    hideStartupErrorPanel: () => calls.push("hide"),
    writeImmediate: (_candidate, message) => calls.push(["write", message]),
    appendDebugWarning: (...args) => calls.push(["warning", ...args]),
    consoleObject: { warn: (...args) => calls.push(["console", ...args]) },
  });

  assert.equal(await controller.show(session), true);
  assert.equal(session.connectionRetrying, true);
  assert.equal(session.shellEl.dataset.connection, "reconnecting");
  assert.equal(calls.some((value) => Array.isArray(value) && value[0] === "write"), false);

  session.connectionRetrying = false;
  session.hasPresentedFrame = true;
  apiMessage = "agent unavailable";
  assert.equal(await controller.show(session), true);
  assert.ok(calls.some((value) => Array.isArray(value) && value[0] === "panel" && value[1] === apiMessage));
  assert.equal(calls.some((value) => Array.isArray(value) && value[0] === "write"), false);

  session.hasPresentedFrame = false;
  assert.equal(await controller.show(session), true);
  assert.ok(calls.some((value) => Array.isArray(value) && value[0] === "write" && value[1].includes("agent unavailable")));
  assert.equal(isRetryableTerminalStartupError("connection timed out"), true);
});

test("startup error lifecycle rejects stale requests and invalidates the active panel", async () => {
  const calls = [];
  const pending = [];
  const session = createSession();
  const controller = createTerminalStartupErrorController({
    apiFactory: () => ({
      read: () => new Promise((resolve) => pending.push(resolve)),
    }),
    getActiveTabId: () => session.tabId,
    getTabById: () => ({ activePaneId: session.id }),
    isCurrentSession: (candidate) => candidate === session,
    showStartupErrorPanel: (message) => calls.push(["panel", message]),
    hideStartupErrorPanel: () => calls.push("hide"),
    writeImmediate: (_candidate, message) => calls.push(["write", message]),
  });

  const first = controller.show(session, "first");
  assert.equal(controller.invalidate(session, { hidePanel: true }), true);
  assert.equal(session.startupErrorShown, false);
  assert.ok(calls.includes("hide"));
  pending[0]("stale error");
  assert.equal(await first, false);
  assert.equal(calls.some((value) => Array.isArray(value)), false);

  const second = controller.show(session, "second");
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  pending[1]("late error");
  assert.equal(await second, false);
  assert.equal(await controller.show(session), false);
});

test("generic websocket fallbacks stay out of terminal output", async () => {
  const writes = [];
  const session = createSession();
  const controller = createTerminalStartupErrorController({
    apiFactory: () => ({ read: async () => "" }),
    isCurrentSession: () => true,
    writeImmediate: (_candidate, message) => writes.push(message),
  });
  assert.equal(await controller.show(session, "WebSocket connection failed."), false);
  assert.deepEqual(writes, []);
});
