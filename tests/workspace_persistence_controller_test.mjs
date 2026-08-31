import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspacePersistenceController,
  restoreInitialWorkspaceLocation,
} from "../runtime/static/workspace/index.js";

class FakeStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const createWindow = (href = "https://webshell.test/app/?view=overview") => {
  const localStorage = new FakeStorage();
  const sessionStorage = new FakeStorage();
  const replacements = [];
  return {
    location: { href, origin: new URL(href).origin },
    localStorage,
    sessionStorage,
    history: {
      state: { key: "state" },
      replaceState: (state, title, url) => replacements.push({ state, title, url: String(url) }),
    },
    replacements,
  };
};

test("workspace persistence restores the initial selector and tab without a TTL", () => {
  const windowObject = createWindow();
  windowObject.localStorage.setItem("webshell.workspaceRestore", JSON.stringify({
    version: 1,
    name: "demo@owner",
    tabId: "tab-7",
    url: "/app/?name=demo%40owner&tab=tab-7",
    updatedAt: 1,
  }));
  const params = new URLSearchParams("view=overview");
  assert.equal(restoreInitialWorkspaceLocation({ windowObject, searchParams: params }), true);
  assert.equal(params.get("name"), "demo@owner");
  assert.equal(params.get("tab"), "tab-7");
  assert.equal(params.has("view"), false);
  assert.match(windowObject.replacements[0].url, /name=demo%40owner/);

  const disabledWindow = createWindow("https://webshell.test/app/?last=false");
  disabledWindow.localStorage.setItem("webshell.workspaceRestore", JSON.stringify({
    name: "demo",
    tabId: "tab-1",
    url: "/app/?last=false&name=demo",
  }));
  assert.equal(restoreInitialWorkspaceLocation({
    windowObject: disabledWindow,
    searchParams: new URLSearchParams("last=false"),
  }), false);
  assert.equal(disabledWindow.localStorage.getItem("webshell.workspaceRestore"), null);
});

test("workspace persistence owns restore, last-tab, reload-tab, and URL suppression", () => {
  const windowObject = createWindow("https://webshell.test/app/?embed=1");
  let activeName = "demo@owner";
  let activeTabId = "tab-1";
  const updates = [];
  const controller = createWorkspacePersistenceController({
    windowObject,
    storagePrefix: "test",
    getActiveName: () => activeName,
    getActiveTabId: () => activeTabId,
    hasTab: () => true,
    updateWorkspaceLocation: (state) => updates.push(state),
  });

  assert.equal(controller.rememberActiveTab(), true);
  assert.equal(windowObject.localStorage.getItem("test.lastTab.demo@owner"), "tab-1");
  const restoreState = JSON.parse(windowObject.localStorage.getItem("test.workspaceRestore"));
  assert.equal(restoreState.name, activeName);
  assert.equal(restoreState.tabId, activeTabId);
  assert.doesNotMatch(restoreState.url, /embed=/);
  assert.equal(updates.length, 1);

  controller.withLocationUpdateSuppressed(() => {
    activeTabId = "tab-2";
    controller.rememberActiveTab();
  });
  assert.equal(updates.length, 1);
  assert.equal(controller.readLastActiveTab(activeName), "tab-2");

  assert.equal(controller.rememberRestartTabForReload(activeName, activeTabId), true);
  assert.equal(controller.readRestartTabForName(activeName), "tab-2");
  assert.equal(updates.length, 2);
  assert.equal(controller.clearRestartTabForReload(), true);
  assert.equal(controller.readRestartTabForName(activeName), "");

  controller.commitHomeNavigation();
  assert.equal(windowObject.localStorage.getItem("test.workspaceRestore"), null);
  assert.equal(controller.rememberWorkspaceRestoreState(), false);
  controller.rollbackHomeNavigation();
  assert.ok(windowObject.localStorage.getItem("test.workspaceRestore"));
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  assert.equal(controller.rememberActiveTab(), false);
});

test("active-tab persistence is serialized and skips stale queued tabs", async () => {
  const windowObject = createWindow();
  let activeName = "demo";
  let activeTabId = "tab-a";
  let generation = 3;
  const tabs = new Set(["tab-a", "tab-b"]);
  const calls = [];
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  const controller = createWorkspacePersistenceController({
    windowObject,
    getActiveName: () => activeName,
    getActiveTabId: () => activeTabId,
    getActiveGeneration: () => generation,
    hasTab: (tabId) => tabs.has(tabId),
    isCurrentRequest: (name, requestGeneration) => name === activeName && requestGeneration === generation,
    getRecentTabIds: () => [activeTabId, activeTabId === "tab-a" ? "tab-b" : "tab-a"],
    postWorkspaceAction: (...args) => {
      calls.push(args);
      return calls.length === 1 ? firstPending : Promise.resolve(true);
    },
  });

  const first = controller.persistActiveWorkspaceTab("tab-a");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  activeTabId = "tab-b";
  const second = controller.persistActiveWorkspaceTab("tab-b");
  releaseFirst(true);
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], [
    "activate_tab",
    { tab_id: "tab-a", recent_tab_ids: ["tab-a", "tab-b"] },
    { focus: false, preferStateActiveTab: false, applyResponse: false },
  ]);
  assert.equal(calls[1][1].tab_id, "tab-b");

  activeTabId = "tab-a";
  const stale = controller.persistActiveWorkspaceTab("tab-a");
  activeTabId = "tab-b";
  assert.equal(await stale, false);
  assert.equal(calls.length, 2);

  activeName = "other";
  generation += 1;
  assert.equal(controller.dispose(), true);
  assert.equal(await controller.persistActiveWorkspaceTab("tab-b"), false);
});
