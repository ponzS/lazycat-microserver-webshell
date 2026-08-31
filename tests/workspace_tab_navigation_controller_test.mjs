import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceTabNavigationController } from "../runtime/static/workspace/index.js";

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

const createButton = (tabId, rect) => ({
  dataset: { tabId },
  getBoundingClientRect: () => rect,
});

const createTabsElement = (buttons) => ({
  scrollLeft: 0,
  querySelectorAll: (selector) => selector === ".tab" ? buttons : [],
  contains: (button) => buttons.includes(button),
  getBoundingClientRect: () => ({ left: 0, right: 100 }),
});

test("tab navigation follows DOM order and exposes offset, index, and scroll commands", () => {
  const tabs = new Map([
    ["tab-a", { id: "tab-a" }],
    ["tab-b", { id: "tab-b" }],
    ["tab-c", { id: "tab-c" }],
  ]);
  const buttonC = createButton("tab-c", { left: 10, right: 50 });
  const buttonA = createButton("tab-a", { left: 120, right: 160 });
  const tabsElement = createTabsElement([buttonC, buttonA]);
  let activeTabId = "tab-a";
  const activations = [];
  const controller = createWorkspaceTabNavigationController({
    tabsElement,
    getTabs: () => tabs,
    getActiveTabId: () => activeTabId,
    activateTab: (tabId) => {
      activations.push(tabId);
      activeTabId = tabId;
    },
  });

  assert.deepEqual(controller.getOrderedTabs().map((tab) => tab.id), ["tab-c", "tab-a", "tab-b"]);
  assert.equal(controller.activateByOffset(1), true);
  assert.equal(activeTabId, "tab-b");
  assert.equal(controller.activateByOffset(1), true);
  assert.equal(activeTabId, "tab-c");
  assert.equal(controller.activateByIndex(1), true);
  assert.deepEqual(activations, ["tab-b", "tab-c", "tab-a"]);

  assert.equal(controller.scrollButtonIntoView(buttonA), true);
  assert.equal(tabsElement.scrollLeft, 60);
  assert.equal(controller.scrollButtonIntoView(createButton("missing", { left: 0, right: 10 })), false);
});

test("tab navigation owns recent-tab persistence, swapping, pruning, and disposal", () => {
  const storage = new FakeStorage();
  const tabs = new Map([
    ["tab-a", { id: "tab-a" }],
    ["tab-b", { id: "tab-b" }],
    ["tab-c", { id: "tab-c" }],
  ]);
  let activeName = "instance-a";
  let activeTabId = "tab-a";
  const activations = [];
  const toasts = [];
  const controller = createWorkspaceTabNavigationController({
    storage,
    storagePrefix: "test",
    getTabs: () => tabs,
    getActiveName: () => activeName,
    getActiveTabId: () => activeTabId,
    activateTab: (tabId) => {
      activations.push(tabId);
      activeTabId = tabId;
    },
    showToast: (message) => toasts.push(message),
  });

  assert.deepEqual(controller.rememberRecentTab("tab-a", "tab-b"), ["tab-a", "tab-b"]);
  assert.equal(storage.getItem("test.recentTabs.instance-a"), '["tab-a","tab-b"]');
  assert.deepEqual(controller.rememberRecentTab("tab-c", "tab-a"), ["tab-c", "tab-a"]);
  activeTabId = "tab-c";
  assert.equal(controller.swapRecentTabs(), true);
  assert.deepEqual(activations, ["tab-a"]);

  storage.setItem("test.recentTabs.instance-b", '["missing","tab-b","tab-b","tab-c"]');
  activeName = "instance-b";
  assert.deepEqual(controller.loadStoredRecentTabIds(), ["tab-b", "tab-c"]);
  assert.deepEqual(controller.applyRecentTabIds(["tab-b", "missing", "tab-c", "tab-a"]), ["tab-b", "tab-c"]);
  tabs.delete("tab-c");
  assert.deepEqual(controller.pruneRecentTabIds(), ["tab-b"]);

  controller.clear();
  assert.deepEqual(controller.getRecentTabIds(), []);
  assert.equal(controller.swapRecentTabs(), false);
  assert.deepEqual(toasts, ["没有可切换的最近终端。"]);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  assert.equal(controller.activateByOffset(1), false);
  assert.deepEqual(controller.applyRecentTabIds(["tab-a"]), []);
});
