import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspaceAPI,
  ensureWorkspaceResponseSelector,
  workspaceResponseSelector,
} from "../runtime/static/workspace/index.js";

const jsonResponse = (state, { ok = true, status = 200, text = "" } = {}) => ({
  ok,
  status,
  json: async () => state,
  text: async () => text,
});

test("workspace API builds sized URLs and applies current action responses", async () => {
  const requests = [];
  const revisions = [];
  const applied = [];
  let activeName = "demo@owner";
  let generation = 4;
  const api = createWorkspaceAPI({
    windowObject: { location: { href: "https://webshell.test/app/?embed=1" } },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return jsonResponse({ selector: activeName, server_revision: "rev-2", tabs: [] });
    },
    getActiveName: () => activeName,
    getActiveGeneration: () => generation,
    getTerminalSize: () => ({ cols: 88, rows: 31 }),
    isCurrentRequest: (name, requestGeneration) => name === activeName && requestGeneration === generation,
    observeServerRevision: (state) => revisions.push(state.server_revision),
    applyWorkspaceState: (state, options) => applied.push({ state, options }),
  });

  assert.equal(api.workspaceURL().pathname, "/app/api/workspace");
  assert.equal(api.workspaceURL().searchParams.get("cols"), "88");
  assert.equal(api.activityURL().pathname, "/app/api/workspace/activity");
  assert.equal((await api.fetchState()).selector, activeName);

  await api.postAction("split_pane", { tab_id: "tab-1" }, {
    focus: false,
    preferStateActiveTab: false,
  });
  const actionRequest = requests.at(-1);
  assert.equal(actionRequest.options.method, "POST");
  assert.deepEqual(JSON.parse(actionRequest.options.body), {
    action: "split_pane",
    cols: 88,
    rows: 31,
    tab_id: "tab-1",
  });
  assert.deepEqual(revisions, ["rev-2"]);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0].options, {
    focus: false,
    instanceName: activeName,
    generation: 4,
    preferStateActiveTab: false,
  });
  assert.equal(api.dispose(), true);
  assert.equal(api.dispose(), false);
  await assert.rejects(api.fetchState(), /disposed/);
});

test("workspace API rejects current selector mismatches and ignores stale responses", async () => {
  let activeName = "one@owner";
  let generation = 1;
  let responseState = { selector: "other@owner" };
  let applied = 0;
  const api = createWorkspaceAPI({
    windowObject: { location: { href: "https://webshell.test/app/" } },
    fetchImpl: async () => jsonResponse(responseState),
    getActiveName: () => activeName,
    getActiveGeneration: () => generation,
    isCurrentRequest: (name, requestGeneration) => name === activeName && requestGeneration === generation,
    applyWorkspaceState: () => { applied += 1; },
  });

  await assert.rejects(api.postAction("activate_tab"), /selector mismatch/);
  responseState = { selector: "stale@owner" };
  const staleAction = api.postAction("activate_tab");
  generation = 2;
  assert.equal((await staleAction).selector, "stale@owner");
  assert.equal(applied, 0);

  assert.equal(workspaceResponseSelector({ selector: " demo " }), "demo");
  assert.doesNotThrow(() => ensureWorkspaceResponseSelector({}, "demo"));
  assert.throws(() => ensureWorkspaceResponseSelector({ selector: "other" }, "demo", "Activity"), /Activity selector mismatch/);
});

test("workspace API surfaces protocol mismatch before terminal Queue startup", async () => {
  const observed = [];
  const payload = {
    error: "终端服务协议版本不一致，需要确认更新。",
    current_protocol_version: "lcmd-webshell-agent-v20",
    preferred_protocol_version: "lcmd-webshell-agent-v10",
    agent_protocol_update_available: true,
    agent_protocol_update_required: true,
  };
  const api = createWorkspaceAPI({
    windowObject: { location: { href: "https://webshell.test/app/" } },
    fetchImpl: async () => jsonResponse(null, {
      ok: false,
      status: 409,
      text: JSON.stringify(payload),
    }),
    getActiveName: () => "demo@owner",
    observeAgentProtocolUpdate: (state) => observed.push(state),
  });

  await assert.rejects(
    api.fetchState(),
    (error) => error.agentProtocolUpdateRequired === true && /需要确认更新/.test(error.message),
  );
  assert.deepEqual(observed, [{
    targetName: "demo@owner",
    agentProtocolVersion: "lcmd-webshell-agent-v20",
    preferredAgentProtocolVersion: "lcmd-webshell-agent-v10",
    agentProtocolUpdateAvailable: true,
    agentProtocolUpdateRequired: true,
  }]);
});

test("workspace API reports Provider response errors", async () => {
  const api = createWorkspaceAPI({
    windowObject: { location: { href: "https://webshell.test/app/" } },
    fetchImpl: async () => jsonResponse(null, { ok: false, status: 503, text: "agent unavailable" }),
    getActiveName: () => "demo",
  });
  await assert.rejects(api.fetchState(), /agent unavailable/);
  await assert.rejects(api.postAction("create_tab"), /agent unavailable/);
});
