import assert from "node:assert/strict";
import test from "node:test";

import { createMobileShortcutsController } from "../runtime/static/terminal/input/index.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  toggle(value, force) {
    const next = force === undefined ? !this.values.has(value) : Boolean(force);
    if (next) this.values.add(value);
    else this.values.delete(value);
    return next;
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.textContent = "";
    this.scrollLeft = 0;
    this.tabIndex = 0;
    this.blurCount = 0;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, listener, options) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, options });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener, options) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((entry) => (
      entry.listener !== listener || entry.options !== options
    )));
  }

  dispatch(type, init = {}) {
    const eventInit = {
      type,
      currentTarget: this,
      target: this,
      isPrimary: true,
      pointerType: "touch",
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      cancelable: true,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.immediatePropagationStopped = true; },
      ...init,
    };
    const event = type.startsWith("pointer")
      ? Object.assign(new FakePointerEvent(), eventInit)
      : eventInit;
    for (const { listener } of [...(this.listeners.get(type) || [])]) {
      listener(event);
    }
    return event;
  }

  querySelectorAll(selector) {
    const matches = [];
    const actionMatch = selector.match(/^\[data-mobile-action="([^"]+)"\]$/);
    const visit = (node) => {
      for (const child of node.children || []) {
        if (actionMatch && child.dataset?.mobileAction === actionMatch[1]) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  closest(selector) {
    if (selector === ".mobile-shortcut-row" && this.parentElement?.className === "mobile-shortcut-row") {
      return this.parentElement;
    }
    return null;
  }

  blur() {
    this.blurCount += 1;
  }
}

class FakePointerEvent {}

const createWindow = () => {
  let nextID = 1;
  const timers = new Map();
  const intervals = new Map();
  return {
    setTimeout(callback) {
      const id = nextID++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback) {
      const id = nextID++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    runTimeouts() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
    runIntervals() {
      for (const callback of intervals.values()) callback();
    },
    timerCount: () => timers.size + intervals.size,
  };
};

const createHarness = (shortcuts) => {
  const root = new FakeElement("div");
  const top = new FakeElement("div");
  top.className = "mobile-shortcut-row";
  const bottom = new FakeElement("div");
  bottom.className = "mobile-shortcut-row";
  root.appendChild(top);
  root.appendChild(bottom);
  const body = new FakeElement("body");
  const documentObject = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
  };
  const windowObject = createWindow();
  const storage = new Map();
  const sent = [];
  const actions = [];
  const terminalIME = {
    shouldPreserveKeyboardForShortcut: () => false,
    isKeyboardActive: () => false,
    focusFromShortcut: () => actions.push("focus"),
  };
  const controller = createMobileShortcutsController({
    documentObject,
    windowObject,
    storage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    storageKey: "feedback",
    mobileShortcuts: root,
    mobileShortcutRows: [top, bottom],
    getShortcutRows: () => shortcuts,
    getActiveSession: () => ({ id: "pane-1" }),
    getCurrentTab: () => ({ id: "tab-1", activePaneId: "pane-1" }),
    isDesktopShortcutBarLayout: () => false,
    terminalIME,
    sendInput: (_session, data) => sent.push(data),
    resolveShortcutInputData: (shortcut, modifiers) => {
      if (shortcut.inputKey === "x") return modifiers.ctrl ? "\u0008" : "x";
      return shortcut.data || "";
    },
    normalizeShortcutText: (value) => String(value || "").replace(/\n/g, "\r"),
    applyStickyModifierInput: (value, modifiers) => (modifiers.ctrl ? "\u0001" : value),
    canApplyStickyModifierInput: (value) => String(value || "").length === 1,
    updateSelection: () => actions.push("selection-sync"),
    createIcon: () => null,
    onAction: (action) => actions.push(action),
    PointerEventCtor: FakePointerEvent,
    HTMLElementCtor: FakeElement,
    performanceObject: { now: () => 100 },
  });
  return { controller, root, top, bottom, windowObject, sent, actions };
};

test("mobile shortcuts render, resolve sticky input and dispatch actions", () => {
  const harness = createHarness([
    [{ id: "ctrl", label: "Ctrl", action: "sticky_ctrl" }],
    [{ id: "x", label: "X", inputKey: "x", data: "x" }, { id: "new", label: "New", action: "new_tab" }],
  ]);
  assert.equal(harness.controller.render(), true);
  const buttons = harness.bottom.children;
  assert.equal(buttons.length, 2);
  const ctrl = harness.top.children[0];
  const x = buttons[0];
  const create = buttons[1];
  harness.controller.trigger({ action: "sticky_ctrl" });
  assert.equal(harness.controller.hasStickyModifiers(), true);
  harness.controller.trigger({ inputKey: "x", data: "x" }, { id: "pane-1" });
  assert.deepEqual(harness.sent, ["\u0008"]);
  assert.equal(harness.controller.hasStickyModifiers(), false);
  create.dispatch("click");
  assert.ok(harness.actions.includes("new_tab"));
  harness.controller.syncState();
  assert.equal(ctrl.getAttribute?.("aria-pressed") || "", "");
  assert.equal(x.dataset.mobileShortcutInputKey, "x");
});

test("mobile shortcut pointer interaction repeats only repeatable keys and cleans up", () => {
  const harness = createHarness([[{ id: "up", label: "Up", inputKey: "arrow_up", data: "U" }], []]);
  harness.controller.render();
  const button = harness.top.children[0];
  button.dispatch("pointerdown", { pointerId: 7, clientX: 4, clientY: 4 });
  assert.equal(harness.windowObject.timerCount(), 1);
  harness.windowObject.runTimeouts();
  harness.windowObject.runIntervals();
  button.dispatch("pointerup", { pointerId: 7, clientX: 4, clientY: 4 });
  assert.ok(harness.sent.length >= 1);
  assert.equal(harness.windowObject.timerCount(), 0);
  assert.equal(harness.controller.dispose(), true);
  assert.equal(harness.controller.dispose(), false);
  assert.equal(harness.controller.render(), false);
  assert.equal(button.listeners.get("click")?.length || 0, 0);
});

test("mobile shortcut sticky text guards distinguish composition and paste", () => {
  const harness = createHarness([[], []]);
  harness.controller.trigger({ action: "sticky_ctrl" });
  assert.equal(harness.controller.shouldApplyStickyTextInput("a", "insertText"), true);
  assert.equal(harness.controller.shouldApplyStickyTextInput("a", "insertFromPaste"), false);
  assert.equal(harness.controller.shouldApplyStickyCompositionInput("ab"), false);
  assert.equal(harness.controller.shouldApplyStickyCompositionInput("a"), true);
  assert.equal(harness.controller.consumeStickyInput("a"), "\u0001");
  assert.equal(harness.controller.hasStickyModifiers(), false);
});
