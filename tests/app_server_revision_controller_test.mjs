import assert from "node:assert/strict";
import test from "node:test";

import { createServerRevisionController } from "../runtime/static/app/server_revision/index.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

test("server revision controller owns stable client identity and cancel unlocks input", async () => {
  const events = [];
  const input = {
    armAllGeneratedSuppression: (delay) => events.push(`suppress:${delay}`),
    setAllLocked: (locked) => events.push(`locked:${locked}`),
    discardAll: () => events.push("discard"),
  };
  const controller = createServerRevisionController({
    storage: createStorage({ "webshell.clientID": "client-stable" }),
    api: {
      read: async () => ({ server_revision: "rev-a" }),
      setInputBlocked: async ({ inputBlocked }) => events.push(`server:${inputBlocked}`),
    },
    getActiveName: () => "instance-a",
    getActiveGeneration: () => 3,
    isCurrentRequest: () => true,
    getActiveTabId: () => "tab-a",
    getTerminalInput: () => input,
    openDialog: async () => false,
    cryptoObject: { randomUUID: () => "unused" },
  });

  assert.equal(controller.getClientID(), "client-stable");
  assert.equal(controller.observe({ server_revision: "rev-a" }), false);
  assert.equal(controller.observe({ server_revision: "rev-b" }), true);
  await flush();
  assert.equal(controller.isDialogOpen(), false);
  assert.deepEqual(events, [
    "suppress:2000",
    "locked:true",
    "server:true",
    "discard",
    "server:false",
    "locked:false",
  ]);
});

test("confirmed mobile restart preserves target tab and keeps input blocked until reload", async () => {
  const events = [];
  const windowObject = {
    location: {
      href: "https://example.test/webshell/",
      reload: () => events.push("reload"),
    },
    setTimeout,
    clearTimeout,
  };
  const input = {
    armAllGeneratedSuppression: () => events.push("suppress"),
    setAllLocked: (locked) => events.push(`locked:${locked}`),
    discardAll: () => events.push("discard"),
  };
  const controller = createServerRevisionController({
    windowObject,
    storage: createStorage(),
    api: {
      read: async () => ({}),
      setInputBlocked: async ({ inputBlocked }) => events.push(`server:${inputBlocked}`),
    },
    getActiveName: () => "instance-a",
    getActiveTabId: () => "tab-a",
    getTerminalInput: () => input,
    isMobileLayout: () => true,
    confirmMobileSheet: async (options) => {
      events.push(`layout:${options.actionsLayout}`);
      return true;
    },
    rememberRestartTabForReload: (name, tabId) => events.push(`remember:${name}:${tabId}`),
    suppressBeforeUnloadForNavigation: () => events.push("beforeunload:suppress"),
    cryptoObject: { randomUUID: () => "client-new" },
  });

  assert.equal(await controller.showRestartDialog(), true);
  assert.equal(controller.isDialogOpen(), true);
  assert.ok(events.includes("layout:vertical-ok-first"));
  assert.ok(events.includes("remember:instance-a:tab-a"));
  assert.ok(events.includes("beforeunload:suppress"));
  assert.equal(events.at(-1), "reload");
  assert.equal(events.includes("server:false"), false);
  assert.equal(events.includes("locked:false"), false);
});

test("initial check is single-shot and dispose rejects timer and late refresh results", async () => {
  const timers = new Map();
  let nextTimer = 1;
  let resolveRead;
  let observedDialogs = 0;
  const windowObject = {
    location: { href: "https://example.test/webshell/", reload() {} },
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const controller = createServerRevisionController({
    windowObject,
    navigatorObject: { onLine: true },
    storage: createStorage(),
    api: {
      read: () => new Promise((resolve) => { resolveRead = resolve; }),
      setInputBlocked: async () => true,
    },
    getActiveName: () => "instance-a",
    getActiveGeneration: () => 1,
    isCurrentRequest: () => true,
    openDialog: async () => {
      observedDialogs += 1;
      return false;
    },
    cryptoObject: { randomUUID: () => "client-new" },
  });

  assert.equal(controller.scheduleInitialCheck(), true);
  assert.equal(controller.scheduleInitialCheck(), false);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  await flush();
  assert.equal(typeof resolveRead, "function");
  controller.dispose();
  resolveRead({ server_revision: "rev-b", reload_required: true });
  await flush();
  assert.equal(observedDialogs, 0);
  assert.equal(controller.dispose(), false);
});
