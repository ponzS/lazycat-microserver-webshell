import assert from "node:assert/strict";
import test from "node:test";

import { createMobileSelectController } from "../runtime/static/app/index.js";

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

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.style = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.options = [];
    this.selectedIndex = 0;
    this.textContent = "";
    this.rect = { left: 10, top: 20, right: 110, bottom: 50, width: 100 };
    this.focusCount = 0;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || "";
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    this.listeners.set(type, callbacks.filter((entry) => entry !== callback));
  }

  dispatch(type, payload = {}) {
    for (const callback of this.listeners.get(type) || []) {
      callback({ type, currentTarget: this, target: this, preventDefault() {}, stopPropagation() {}, ...payload });
    }
  }

  dispatchEvent(event) {
    this.dispatch(event.type, { event });
    return true;
  }

  querySelector(selector) {
    if (selector === ".mobile-custom-select-panel") {
      return this.children.find((child) => child.className === selector.slice(1)) || null;
    }
    if (selector === ".mobile-custom-select-options") {
      return this.children.flatMap((child) => child.children || [])
        .find((child) => child.className === selector.slice(1)) || null;
    }
    if (selector === ".mobile-custom-select-option.is-selected") {
      return this.children.find((child) => child.classList?.contains("is-selected")) || null;
    }
    return null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  closest() {
    return null;
  }

  contains(element) {
    if (element === this) {
      return true;
    }
    return this.children.some((child) => child.contains?.(element));
  }

  focus() {
    this.focusCount += 1;
  }

  remove() {
    this.parentElement?.children?.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
}

class FakeSelect extends FakeElement {
  constructor(options) {
    super("select");
    this.options = options;
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

const createHarness = () => {
  const body = new FakeElement("body");
  const selects = [];
  const documentObject = {
    body,
    documentElement: { clientWidth: 390, clientHeight: 844 },
    querySelectorAll: () => selects,
    createElement: (tagName) => new FakeElement(tagName),
  };
  let nextFrame = 1;
  const windowObject = {
    innerWidth: 390,
    innerHeight: 844,
    visualViewport: { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 },
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    requestAnimationFrame(callback) {
      callback();
      return nextFrame++;
    },
    cancelAnimationFrame() {},
  };
  return { body, documentObject, selects, windowObject };
};

test("mobile select controller renders options and dispatches selection events", () => {
  const harness = createHarness();
  const select = new FakeSelect([
    { textContent: "One", label: "One", value: "1", disabled: false },
    { textContent: "Two", label: "Two", value: "2", disabled: false },
  ]);
  select.selectedIndex = 0;
  harness.selects.push(select);
  harness.body.appendChild(select);
  const events = [];
  select.addEventListener("input", () => events.push("input"));
  select.addEventListener("change", () => events.push("change"));
  const controller = createMobileSelectController({
    ...harness,
    isEnabled: () => true,
    HTMLSelectElementCtor: FakeSelect,
    HTMLElementCtor: FakeElement,
    EventCtor: FakeEvent,
  });

  assert.equal(controller.install(), true);
  select.dispatch("pointerdown");
  assert.equal(controller.isOpen(), true);
  const popover = harness.body.children.find((child) => child.id === "mobileCustomSelectPopover");
  const list = popover.children[1].children[0];
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].classList.contains("is-selected"), true);
  list.children[1].dispatch("click");
  assert.equal(select.selectedIndex, 1);
  assert.deepEqual(events, ["input", "change"]);
  assert.equal(controller.isOpen(), false);
  assert.equal(select.focusCount, 1);
});

test("mobile select controller closes on layout change and removes listeners on dispose", () => {
  const harness = createHarness();
  const select = new FakeSelect([{ textContent: "One", value: "1", disabled: false }]);
  harness.selects.push(select);
  harness.body.appendChild(select);
  let enabled = true;
  const controller = createMobileSelectController({
    ...harness,
    isEnabled: () => enabled,
    HTMLSelectElementCtor: FakeSelect,
    HTMLElementCtor: FakeElement,
    EventCtor: FakeEvent,
  });
  controller.install();
  select.dispatch("click");
  assert.equal(controller.isOpen(), true);
  enabled = false;
  controller.syncPosition();
  assert.equal(controller.isOpen(), false);
  controller.dispose();
  assert.equal(controller.dispose(), false);
  enabled = true;
  select.dispatch("click");
  assert.equal(controller.isOpen(), false);
});
