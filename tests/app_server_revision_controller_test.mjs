import assert from "node:assert/strict";
import test from "node:test";

import {
  createServerRevisionAPI,
  createServerRevisionController,
} from "../runtime/static/app/server_revision/index.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

test("server revision controller owns stable client identity without terminal lock state", async () => {
  const events = [];
  const controller = createServerRevisionController({
    storage: createStorage({ "webshell.clientID": "client-stable" }),
    api: {
      read: async () => ({ server_revision: "rev-a" }),
    },
    getActiveName: () => "instance-a",
    getActiveGeneration: () => 3,
    isCurrentRequest: () => true,
    getActiveTabId: () => "tab-a",
    openDialog: async () => false,
    cryptoObject: { randomUUID: () => "unused" },
  });

  assert.equal(controller.getClientID(), "client-stable");
  assert.equal(controller.observe({ server_revision: "rev-a" }), false);
  assert.equal(controller.observe({ server_revision: "rev-b" }), true);
  await flush();
  assert.equal(controller.isDialogOpen(), false);
  assert.deepEqual(events, []);
});

test("confirmed mobile restart preserves target tab and reloads without terminal lock state", async () => {
  const events = [];
  const windowObject = {
    location: {
      href: "https://example.test/webshell/",
      reload: () => events.push("reload"),
    },
    setTimeout,
    clearTimeout,
  };
  const controller = createServerRevisionController({
    windowObject,
    storage: createStorage(),
    api: {
      read: async () => ({}),
    },
    getActiveName: () => "instance-a",
    getActiveTabId: () => "tab-a",
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
  assert.equal(controller.isDialogOpen(), false);
  assert.ok(events.includes("layout:vertical-ok-first"));
  assert.ok(events.includes("remember:instance-a:tab-a"));
  assert.ok(events.includes("beforeunload:suppress"));
  assert.equal(events.at(-1), "reload");
  assert.equal(events.some((entry) => entry.startsWith("server:")), false);
  assert.equal(events.some((entry) => entry.startsWith("locked:")), false);
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

test("server revision API never emits the retired terminal input lock parameter", () => {
  const api = createServerRevisionAPI({
    windowObject: { location: { href: "https://example.test/webshell/" } },
    fetchImpl: async () => ({ ok: true, async json() { return {}; } }),
  });
  const url = api.url({ name: "instance-a", clientID: "client-a", inputBlocked: true });
  assert.equal(url.searchParams.get("name"), "instance-a");
  assert.equal(url.searchParams.get("client_id"), "client-a");
  assert.equal(url.searchParams.has("terminal_input_blocked"), false);
});
