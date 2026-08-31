import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceTabLabelController } from "../runtime/static/workspace/index.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = "";
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.style = {};
    this.attributes = new Map();
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.isConnected = false;
    this.focusCount = 0;
    this.selectCount = 0;
    this.rect = { left: 0, right: 160, top: 0, bottom: 36, width: 160, height: 36 };
  }

  appendChild(child) {
    child.parentElement = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    this.parentElement = null;
    this.isConnected = false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push(listener);
    this.listeners.set(type, entries);
    options.signal?.addEventListener?.("abort", () => {
      this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener));
    }, { once: true });
  }

  dispatch(type, init = {}) {
    const event = {
      type,
      target: this,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...init,
    };
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener(event);
    }
    return event;
  }

  querySelector(selector) {
    if (selector !== ".tab-label") return null;
    return this.children.find((child) => child.className === "tab-label") || null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  focus() {
    this.focusCount += 1;
  }

  select() {
    this.selectCount += 1;
  }
}

const createWindow = () => {
  let nextFrame = 1;
  const frames = new Map();
  const listeners = new Map();
  return {
    addEventListener(type, listener, options = {}) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
      options.signal?.addEventListener?.("abort", () => {
        listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== listener));
      }, { once: true });
    },
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    flushFrames() {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback();
      }
    },
    frameCount: () => frames.size,
  };
};

const createTab = (id = "tab-1", labelText = "Shell") => {
  const button = new FakeElement("button");
  button.isConnected = true;
  const label = new FakeElement("span");
  label.className = "tab-label";
  button.appendChild(label);
  return { id, label: labelText, customLabel: false, button };
};

test("tab label controller renders active labels and commits inline rename", async () => {
  const windowObject = createWindow();
  const body = new FakeElement("body");
  body.isConnected = true;
  const tabsElement = new FakeElement("nav");
  tabsElement.isConnected = true;
  tabsElement.rect = { left: 0, right: 320, top: 0, bottom: 44, width: 320, height: 44 };
  const tab = createTab();
  tab.button.rect = { left: 20, right: 180, top: 4, bottom: 40, width: 160, height: 36 };
  const tabs = new Map([[tab.id, tab]]);
  const actions = [];
  let titleUpdates = 0;
  let overviewUpdates = 0;
  const controller = createWorkspaceTabLabelController({
    documentObject: { body, createElement: (tagName) => new FakeElement(tagName) },
    windowObject,
    tabsElement,
    getTabs: () => tabs,
    getActiveTabId: () => tab.id,
    activateTab: () => {},
    postWorkspaceAction: (...args) => { actions.push(args); return Promise.resolve(); },
    updateDocumentTitle: () => { titleUpdates += 1; },
    scheduleOverviewRender: () => { overviewUpdates += 1; },
  });

  assert.equal(controller.renderTabLabel(tab), true);
  assert.equal(tab.button.querySelector(".tab-label").textContent, "Shell");
  assert.equal(titleUpdates, 1);
  assert.equal(overviewUpdates, 1);

  assert.equal(controller.beginInlineTabRename(tab.id), true);
  const input = body.children.at(-1);
  assert.equal(input.className, "tab-rename-input");
  assert.equal(tab.button.classList.contains("renaming"), true);
  input.value = "Renamed";
  input.dispatch("input");
  input.dispatch("keydown", { key: "Enter", keyCode: 13, isComposing: false });
  await Promise.resolve();

  assert.equal(tab.label, "Renamed");
  assert.equal(tab.customLabel, true);
  assert.equal(tab.button.querySelector(".tab-label").textContent, "Renamed");
  assert.equal(tab.button.classList.contains("renaming"), false);
  assert.equal(input.isConnected, false);
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0], [
    "rename_tab",
    { tab_id: tab.id, label: "Renamed" },
    { focus: false, preferStateActiveTab: false },
  ]);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
});

test("tab label controller rolls back optimistic failure and cancels late focus on dispose", async () => {
  const windowObject = createWindow();
  const body = new FakeElement("body");
  body.isConnected = true;
  const tabsElement = new FakeElement("nav");
  tabsElement.isConnected = true;
  tabsElement.rect = { left: 0, right: 320, top: 0, bottom: 44, width: 320, height: 44 };
  const tab = createTab("tab-2", "Before");
  tab.button.rect = { left: 20, right: 180, top: 4, bottom: 40, width: 160, height: 36 };
  const tabs = new Map([[tab.id, tab]]);
  const controller = createWorkspaceTabLabelController({
    documentObject: { body, createElement: (tagName) => new FakeElement(tagName) },
    windowObject,
    tabsElement,
    getTabs: () => tabs,
    postWorkspaceAction: () => Promise.reject(new Error("rename failed")),
  });

  await assert.rejects(
    controller.commitTabRename(tab.id, "After", { optimistic: true }),
    /rename failed/,
  );
  assert.equal(tab.label, "Before");
  assert.equal(tab.customLabel, false);

  assert.equal(controller.beginInlineTabRename(tab.id), true);
  const input = body.children.at(-1);
  assert.equal(windowObject.frameCount(), 1);
  assert.equal(controller.dispose(), true);
  windowObject.flushFrames();
  assert.equal(input.focusCount, 0);
  assert.equal(input.isConnected, false);
  assert.equal(tab.button.classList.contains("renaming"), false);
  assert.equal(controller.beginInlineTabRename(tab.id), false);
});
