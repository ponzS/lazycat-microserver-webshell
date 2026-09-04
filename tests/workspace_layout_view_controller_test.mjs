import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceLayoutViewController } from "../runtime/static/workspace/index.js";

class ElementStub {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach((name) => this.classList.values.add(name)),
      remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
      toggle: (name, force) => {
        const next = force === undefined ? !this.classList.values.has(name) : force;
        if (next) this.classList.values.add(name); else this.classList.values.delete(name);
        return next;
      },
    };
    this.rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeEventListener(type, listener) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((item) => item !== listener));
  }

  addEventListener(type, listener) {
    const entries = this.listeners.get(type) || [];
    entries.push(listener);
    this.listeners.set(type, entries);
  }

  dispatch(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getBoundingClientRect() {
    return this.rect;
  }

  set textContent(value) {
    this.children = [];
    this._textContent = String(value || "");
  }

  get textContent() {
    return this._textContent || "";
  }

  setPointerCapture() {}
}

const documentObject = {
  body: new ElementStub("body"),
  createElement: (tagName) => new ElementStub(tagName),
};

test("layout view renders a split and persists divider movement", () => {
  globalThis.HTMLElement = ElementStub;
  let nextFrame = 1;
  const frames = new Map();
  const windowObject = {
    requestAnimationFrame(callback) {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle);
    },
  };
  const runFrames = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback());
  };
  const actions = [];
  const activeCalls = [];
  const resizeCalls = [];
  const dragLifecycle = [];
  const dragUpdates = [];
  const firstShell = new ElementStub("section");
  const secondShell = new ElementStub("section");
  firstShell.rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  secondShell.rect = { left: 110, top: 0, right: 210, bottom: 100, width: 100, height: 100 };
  const tab = {
    activePaneId: "pane-a",
    panes: new Map([
      ["pane-a", { id: "pane-a", shellEl: firstShell }],
      ["pane-b", { id: "pane-b", shellEl: secondShell }],
    ]),
    layout: {
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", paneId: "pane-a", size: 50 },
        { type: "leaf", paneId: "pane-b", size: 50 },
      ],
    },
    layoutHost: new ElementStub("div"),
  };
  const controller = createWorkspaceLayoutViewController({
    documentObject,
    windowObject,
    setActivePane: (...args) => activeCalls.push(args),
    resizeTab: (value) => resizeCalls.push(value),
    beginTabInteractiveResize: (value) => dragLifecycle.push(["begin", value]),
    updateTabInteractiveResize: (value) => dragUpdates.push(value),
    endTabInteractiveResize: (value) => dragLifecycle.push(["end", value]),
    postWorkspaceAction: (...args) => { actions.push(args); return Promise.resolve(); },
  });

  assert.equal(controller.renderTabLayout(tab), true);
  assert.equal(tab.layoutHost.children[0].className, "split-node vertical");
  assert.equal(tab.layoutHost.children[0].children.length, 3);
  assert.equal(activeCalls.length, 1);
  assert.equal(resizeCalls.length, 0);
  runFrames();
  assert.equal(resizeCalls.length, 1);

  const divider = tab.layoutHost.children[0].children[1];
  const container = tab.layoutHost.children[0];
  container.rect = { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 };
  divider.dispatch("pointerdown", { clientX: 100, clientY: 50, pointerId: 1, preventDefault() {} });
  assert.deepEqual(dragLifecycle, [["begin", tab]]);
  assert.equal(documentObject.body.classList.values.has("split-resize-active"), true);
  divider.dispatch("pointermove", { clientX: 110, clientY: 50, pointerId: 1 });
  divider.dispatch("pointermove", { clientX: 120, clientY: 50 });
  assert.equal(frames.size, 1);
  assert.equal(tab.layout.children[0].size, 50);
  runFrames();
  assert.ok(tab.layout.children[0].size > 50);
  assert.equal(resizeCalls.length, 1);
  assert.deepEqual(dragUpdates, [tab]);
  divider.dispatch("pointermove", { clientX: 125, clientY: 50, pointerId: 1 });
  divider.dispatch("pointermove", { clientX: 130, clientY: 50, pointerId: 1 });
  assert.equal(frames.size, 1);
  divider.dispatch("pointerup", { pointerId: 1 });
  assert.equal(frames.size, 0);
  assert.equal(tab.layout.children[0].size, 65);
  assert.deepEqual(dragLifecycle, [["begin", tab], ["end", tab]]);
  assert.equal(resizeCalls.length, 1);
  assert.deepEqual(dragUpdates, [tab, tab]);
  assert.equal(documentObject.body.classList.values.has("split-resize-active"), false);
  assert.equal(actions[0][0], "update_layout");

  divider.dispatch("pointerdown", { clientX: 100, clientY: 50, pointerId: 2, preventDefault() {} });
  divider.dispatch("pointermove", { clientX: 115, clientY: 50, pointerId: 2 });
  assert.equal(controller.dispose(), true);
  assert.equal(frames.size, 0);
  assert.deepEqual(dragLifecycle.at(-1), ["end", tab]);
  assert.equal(documentObject.body.classList.values.has("split-resize-active"), false);
  assert.equal(controller.renderTabLayout(tab), false);
});
