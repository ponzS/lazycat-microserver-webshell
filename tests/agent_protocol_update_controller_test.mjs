import assert from "node:assert/strict";
import test from "node:test";

import {
  agentProtocolUpdateConfirmationMessage,
  createAgentProtocolUpdateAPI,
  createAgentProtocolUpdateController,
} from "../runtime/static/app/agent_protocol_update/index.js";

const createView = () => {
  const renders = [];
  let onClick = null;
  return {
    renders,
    disposeCalls: 0,
    install(callback) { onClick = callback; },
    render(state) { renders.push({ ...state }); },
    dispose() { this.disposeCalls += 1; },
    click() { return onClick?.(); },
  };
};

const updateState = {
  targetName: "demo@owner",
  agentProtocolVersion: "lcmd-webshell-agent-v8",
  preferredAgentProtocolVersion: "lcmd-webshell-agent-v9",
  agentProtocolUpdateAvailable: true,
  agentProtocolUpdateRequired: false,
};

test("protocol update notice stays visible when confirmation is canceled", async () => {
  const view = createView();
  let updates = 0;
  const controller = createAgentProtocolUpdateController({
    view,
    api: { async update() { updates += 1; } },
    getActiveName: () => "demo@owner",
    openDialog: async (options) => {
      assert.equal(options.title, "更新终端服务协议");
      assert.equal(options.message, agentProtocolUpdateConfirmationMessage);
      assert.equal(options.okText, "确认更新");
      assert.equal(options.cancelText, "取消");
      assert.equal(options.danger, true);
      assert.equal(options.initialFocus, "cancel");
      return false;
    },
  });

  assert.equal(controller.observe(updateState), true);
  assert.deepEqual(view.renders.at(-1), { visible: true, updating: false });
  assert.equal(await controller.showUpdateDialog(), false);
  assert.equal(updates, 0);
  assert.deepEqual(view.renders.at(-1), { visible: true, updating: false });
});

test("confirmed protocol update locks input, updates once, and reloads", async () => {
  const view = createView();
  const requests = [];
  const locks = [];
  let discarded = 0;
  let reloads = 0;
  let navigationSuppressed = 0;
  const reloadTimers = [];
  const controller = createAgentProtocolUpdateController({
    view,
    api: {
      async update(request) {
        requests.push(request);
        return {
          status: "updated",
          current_protocol_version: "lcmd-webshell-agent-v9",
          preferred_protocol_version: "lcmd-webshell-agent-v9",
        };
      },
    },
    getActiveName: () => "demo@owner",
    getTerminalInput: () => ({
      setAllLocked(value) { locks.push(value); },
      discardAll() { discarded += 1; },
    }),
    openDialog: async () => true,
    suppressBeforeUnloadForNavigation: () => { navigationSuppressed += 1; },
    reload: () => { reloads += 1; },
    setTimeoutImpl: (callback, delayMs) => {
      reloadTimers.push({ callback, delayMs });
      return reloadTimers.length;
    },
  });

  controller.observe(updateState);
  assert.equal(await controller.showUpdateDialog(), true);
  assert.deepEqual(requests, [{
    name: "demo@owner",
    currentProtocolVersion: "lcmd-webshell-agent-v8",
  }]);
  assert.deepEqual(locks, [true]);
  assert.equal(discarded, 1);
  assert.equal(navigationSuppressed, 0);
  assert.equal(reloads, 0);
  assert.equal(reloadTimers.length, 1);
  assert.equal(reloadTimers[0].delayMs, 1000);
  assert.equal(controller.snapshot().reloadPending, true);
  assert.equal(controller.snapshot().updateAvailable, false);
  assert.deepEqual(view.renders.at(-1), { visible: false, updating: true });

  reloadTimers[0].callback();
  assert.equal(navigationSuppressed, 1);
  assert.equal(reloads, 1);
});

test("failed protocol update unlocks input and keeps the notice", async () => {
  const view = createView();
  const locks = [];
  const feedback = [];
  const controller = createAgentProtocolUpdateController({
    view,
    api: { async update() { throw new Error("update failed"); } },
    getActiveName: () => "demo@owner",
    getTerminalInput: () => ({
      setAllLocked(value) { locks.push(value); },
      discardAll() {},
    }),
    openDialog: async () => true,
    showToast: (message) => feedback.push(message),
  });

  controller.observe(updateState);
  assert.equal(await controller.showUpdateDialog(), false);
  assert.deepEqual(locks, [true, false]);
  assert.deepEqual(feedback, ["update failed"]);
  assert.equal(controller.snapshot().updateAvailable, true);
  assert.deepEqual(view.renders.at(-1), { visible: true, updating: false });
});

test("protocol update state from a stale target is ignored", () => {
  const view = createView();
  const controller = createAgentProtocolUpdateController({
    view,
    api: { async update() {} },
    getActiveName: () => "current@owner",
  });

  assert.equal(controller.observe(updateState), false);
  assert.equal(controller.snapshot().updateAvailable, false);
  controller.beginTarget("current@owner");
  assert.deepEqual(view.renders.at(-1), { visible: false, updating: false });
});

test("protocol update API sends one scoped POST request", async () => {
  const requests = [];
  const api = createAgentProtocolUpdateAPI({
    windowObject: { location: { href: "https://example.test/app/" } },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        async json() { return { status: "updated" }; },
      };
    },
  });

  assert.deepEqual(await api.update({
    name: "demo@owner",
    currentProtocolVersion: "lcmd-webshell-agent-v8",
  }), { status: "updated" });
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, "/app/api/agent/protocol-update");
  assert.equal(new URL(requests[0].url).searchParams.get("name"), "demo@owner");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    current_protocol_version: "lcmd-webshell-agent-v8",
  });
});
