import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspaceTabController,
  createWorkspaceTabLifecycle,
  createWorkspaceTabRegistry,
  createWorkspaceTabView,
} from "../runtime/static/workspace/index.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(name) { this.values.add(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.className = "";
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this._textContent = "";
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, reference) {
    child.remove();
    child.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    this.parentElement = null;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, target) {
    const event = {
      target,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }
  set textContent(value) {
    this._textContent = String(value);
    if (value === "") {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
    }
  }
  get textContent() { return this._textContent; }
}

const createFrameWindow = () => {
  let nextID = 1;
  const frames = new Map();
  return {
    requestAnimationFrame(callback) { const id = nextID++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    flush() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    size: () => frames.size,
  };
};

test("tab view owns tab DOM, events, context cleanup, ordering, and late rename RAF", () => {
  const documentObject = { createElement: (tagName) => new FakeElement(tagName) };
  const windowObject = createFrameWindow();
  const tabsElement = new FakeElement("nav");
  const terminalArea = new FakeElement("main");
  const calls = [];
  let contextTarget = null;
  let cleanups = 0;
  const view = createWorkspaceTabView({
    documentObject,
    windowObject,
    tabsElement,
    terminalArea,
    isRenaming: () => true,
    positionInlineRename: () => calls.push("position"),
    closeTab: (tabId) => calls.push(`close:${tabId}`),
    activateTab: (tabId) => calls.push(`active:${tabId}`),
    beginInlineRename: (tabId) => calls.push(`rename:${tabId}`),
    bindContextMenu: (button, options) => {
      contextTarget = options.getTarget;
      return () => { cleanups += 1; };
    },
    renderTabLabel: (tab) => calls.push(`label:${tab.id}`),
  });
  const elements = view.createTabElements("tab-1");
  const tab = { id: "tab-1", activePaneId: "pane-1", ...elements, button: null, contextMenuCleanup: null };
  const button = view.createTabButton(tab);
  assert.equal(terminalArea.children[0], elements.paneElement);
  assert.equal(tabsElement.children[0], button);
  assert.equal(windowObject.size(), 1);
  const closeTarget = { closest: (selector) => selector === ".tab-close" ? {} : null };
  const normalTarget = { closest: () => null };
  button.dispatch("click", closeTarget);
  button.dispatch("click", normalTarget);
  button.dispatch("dblclick", normalTarget);
  assert.deepEqual(calls.slice(-3), ["close:tab-1", "active:tab-1", "rename:tab-1"]);
  assert.deepEqual(contextTarget(), { type: "tab", tabId: "tab-1", paneId: "pane-1" });

  const tab2Elements = view.createTabElements("tab-2");
  const tab2 = { id: "tab-2", activePaneId: "pane-2", ...tab2Elements, button: null, contextMenuCleanup: null };
  view.createTabButton(tab2);
  assert.equal(view.setActiveTabVisuals([tab, tab2], tab2.id), true);
  assert.equal(tab2.button.classList.contains("active"), true);
  assert.equal(tab.button.classList.contains("active"), false);
  assert.equal(tab2.button.attributes.get("aria-selected"), "true");
  assert.equal(view.moveTabButton(tab2, "first", [tab, tab2]), true);
  assert.equal(tabsElement.children[0], tab2.button);
  view.recreateTabButton(tab);
  assert.equal(cleanups, 1);
  assert.equal(view.dispose(), true);
  windowObject.flush();
  assert.equal(calls.includes("position"), false);
  assert.equal(cleanups, 3);
});

test("tab controller creates registry entries and applies local split, move, and close commands", () => {
  const registry = createWorkspaceTabRegistry();
  const calls = [];
  let applying = true;
  let activeTabId = "";
  const tabView = {
    createTabElements: (id) => ({ paneElement: new FakeElement("article"), layoutHost: new FakeElement("div") }),
    createTabButton: (tab) => { tab.button = new FakeElement("button"); },
    recreateTabButton: () => true,
    moveTabButton: () => true,
    disposeTab: (tab) => calls.push(["dispose-tab", tab.id]),
    dispose: () => true,
  };
  const controller = createWorkspaceTabController({
    tabRegistry: registry,
    tabView,
    getActiveName: () => "demo",
    getActiveTabId: () => activeTabId,
    isApplyingWorkspaceState: () => applying,
    createPaneSession: (tab, name, options = {}) => {
      const pane = { id: options.id || `pane-${tab.panes.size + 1}`, name, shellEl: new FakeElement("div") };
      tab.panes.set(pane.id, pane);
      return pane;
    },
    disposePaneSession: (pane) => calls.push(["dispose-pane", pane.id]),
    renderTabLayout: (tab) => calls.push(["layout", tab.id]),
    splitLayout: () => null,
    removePaneFromLayout: (layout, paneId) => layout?.paneId === paneId ? null : layout,
    collectPaneIds: (layout) => layout?.paneId ? [layout.paneId] : [],
    activateTab: (tabId) => { activeTabId = tabId; calls.push(["active", tabId]); },
    clearActiveTab: () => { activeTabId = ""; },
    cancelTabActivation: () => calls.push(["cancel-activation"]),
    getOrderedTabs: () => [...registry.tabs.values()],
    updateEmptyState: () => calls.push(["empty"]),
    scheduleOverviewRender: () => calls.push(["overview"]),
    cancelTabResize: (tab) => calls.push(["cancel-resize", tab.id]),
    handleTabRemoved: (tabId) => calls.push(["removed", tabId]),
    clearRecentTabs: () => calls.push(["clear-recent"]),
  });

  const first = controller.createTab({ focus: false });
  const second = controller.createTab({ focus: false });
  assert.equal(first.id, "tab-1");
  assert.equal(second.id, "tab-2");
  assert.equal(first.label, "Shell 1");
  activeTabId = first.id;
  assert.equal(controller.splitPane(first.id, first.activePaneId, "vertical"), true);
  assert.equal(first.panes.size, 2);
  assert.equal(first.layout.type, "split");
  assert.equal(controller.moveTab(second.id, "first"), true);
  assert.equal(controller.closeTab(first.id), true);
  assert.equal(registry.has(first.id), false);
  assert.ok(calls.some(([name, id]) => name === "dispose-pane" && id === "pane-1"));
  assert.equal(controller.resetForInstance(), undefined);
  assert.equal(registry.size(), 0);
  assert.ok(calls.some(([name]) => name === "clear-recent"));
});

test("tab controller keeps user CRUD remote until authoritative workspace apply", async () => {
  const registry = createWorkspaceTabRegistry();
  const actions = [];
  const destroyed = [];
  const tabView = {
    createTabElements: () => ({ paneElement: new FakeElement("article"), layoutHost: new FakeElement("div") }),
    createTabButton: (tab) => { tab.button = new FakeElement("button"); },
    recreateTabButton: () => true,
    moveTabButton: () => true,
    disposeTab: () => true,
    dispose: () => true,
  };
  const controller = createWorkspaceTabController({
    tabRegistry: registry,
    tabView,
    getActiveName: () => "demo",
    isApplyingWorkspaceState: () => false,
    createPaneSession: (tab) => {
      const pane = { id: "pane-1" };
      tab.panes.set(pane.id, pane);
      return pane;
    },
    refreshAndConfirmClose: async () => true,
    postWorkspaceAction: async (action, payload) => { actions.push([action, payload]); return true; },
    destroyCachedSession: async (pane) => { destroyed.push(pane.id); },
  });
  const tab = controller.createTab({ activate: false });
  assert.equal(controller.splitPane(tab.id, tab.activePaneId, "horizontal"), true);
  assert.equal(controller.closePane(tab.id, tab.activePaneId), true);
  assert.equal(controller.closeTab(tab.id), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(actions.map(([action]) => action), ["split_pane", "close_pane", "close_tab"]);
  assert.ok(destroyed.includes("pane-1"));
  assert.equal(registry.has(tab.id), true);
});

test("tab lifecycle cancels rename frames and context resources", () => {
  const windowObject = createFrameWindow();
  let frameCalls = 0;
  let cleanups = 0;
  const lifecycle = createWorkspaceTabLifecycle({ windowObject });
  const tab = { button: new FakeElement("button"), paneEl: new FakeElement("article"), contextMenuCleanup: null };
  lifecycle.registerTab(tab);
  lifecycle.replaceContextCleanup(tab, () => { cleanups += 1; });
  lifecycle.scheduleFrame(() => { frameCalls += 1; });
  assert.equal(lifecycle.dispose(), true);
  windowObject.flush();
  assert.equal(frameCalls, 0);
  assert.equal(cleanups, 1);
  assert.equal(lifecycle.dispose(), false);
});
