import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalSessionResourceFactory } from "../runtime/static/terminal/session/index.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.className = "";
    this.hidden = false;
    this.draggable = true;
    this.options = null;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class FakeTerminal {
  static instances = [];

  constructor(options) {
    this.options = { ...options };
    this.loadedAddon = null;
    this.openedOn = null;
    FakeTerminal.instances.push(this);
  }

  loadAddon(addon) {
    this.loadedAddon = addon;
  }

  open(host) {
    this.openedOn = host;
  }
}

class FakeFitAddon {}

const createDocument = () => ({
  createElement: (tagName) => new FakeElement(tagName),
});

test("resource factory creates isolated pane DOM and Ghostty resources", () => {
  FakeTerminal.instances.length = 0;
  const optionsCalls = [];
  const factory = createTerminalSessionResourceFactory({
    documentObject: createDocument(),
    TerminalCtor: FakeTerminal,
    FitAddonCtor: FakeFitAddon,
    getTerminalOptions: (options) => {
      optionsCalls.push(options);
      return { theme: "dark", ...options };
    },
    getMobilePixelScroll: () => true,
  });

  const first = factory.create({
    id: "pane-1",
    connect: false,
    initialTerminalOptions: { cols: 80, rows: 24 },
  });
  const second = factory.create({ id: "pane-2", connect: true });

  assert.equal(first.shellEl.tagName, "section");
  assert.equal(first.shellEl.className, "pane-shell");
  assert.equal(first.shellEl.dataset.paneId, "pane-1");
  assert.equal(first.shellEl.dataset.connection, "idle");
  assert.equal(first.shellEl.dataset.renderReady, "false");
  assert.equal(first.shellEl.dataset.hasPresentedFrame, "false");
  assert.equal(first.shellEl.dataset.previewReady, "false");
  assert.equal(first.shellEl.attributes.get("tabindex"), "-1");
  assert.equal(first.terminalHost.children.length, 3);
  assert.equal(first.terminalPreview.className, "terminal-cache-preview");
  assert.equal(first.terminalPreview.hidden, true);
  assert.equal(first.terminalPreview.draggable, false);
  assert.equal(first.terminalFrameHold.className, "terminal-frame-hold");
  assert.equal(first.terminalFrameHold.hidden, true);
  assert.equal(first.compositionPreview.className, "terminal-composition-preview");
  assert.equal(first.compositionPreview.hidden, true);
  assert.deepEqual(optionsCalls, [{ cols: 80, rows: 24 }, {}]);
  assert.deepEqual(FakeTerminal.instances[0].options, {
    theme: "dark",
    cols: 80,
    rows: 24,
    mobilePixelScroll: true,
  });
  assert.equal(FakeTerminal.instances[0].loadedAddon instanceof FakeFitAddon, true);
  assert.equal(FakeTerminal.instances[0].openedOn, first.terminalHost);
  assert.notEqual(first.shellEl, second.shellEl);
  assert.notEqual(first.term, second.term);
  assert.equal(factory.create, factory.create);
});

test("resource factory validates required constructors and pane identity", () => {
  assert.throws(
    () => createTerminalSessionResourceFactory({ documentObject: createDocument() }),
    /requires Ghostty constructors/,
  );
  const factory = createTerminalSessionResourceFactory({
    documentObject: createDocument(),
    TerminalCtor: FakeTerminal,
    FitAddonCtor: FakeFitAddon,
  });
  assert.throws(() => factory.create({ id: "" }), /requires a pane id/);
});
