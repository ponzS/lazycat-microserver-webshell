import assert from "node:assert/strict";
import test from "node:test";

import {
  compareTerminalSelectionCells,
  createTerminalSelectionController,
  createTerminalSelectionLifecycle,
  createTerminalSelectionView,
  nextTerminalSelectionCell,
  normalizeTerminalSelectionCells,
  previousTerminalSelectionCell,
  terminalSelectionContainsCell,
  terminalSelectionText,
} from "../runtime/static/terminal/selection/index.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener));
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener(event);
    }
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName = "div") {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.hidden = false;
    this.parentNode = null;
    this.removed = false;
    this.style = {
      removeProperty: (name) => { delete this.style[name]; },
    };
    this.classList = {
      values: new Set(),
      toggle: (name, active) => active ? this.classList.values.add(name) : this.classList.values.delete(name),
    };
    this.rect = { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 };
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    if (selector === ".terminal-host" && this.isTerminalHost) {
      return this;
    }
    if (selector === ".mobile-selection-handle" && String(this.className || "").includes("mobile-selection-handle")) {
      return this;
    }
    return this.parentNode?.closest?.(selector) || null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  querySelectorAll() {
    return [];
  }

  remove() {
    this.removed = true;
  }

  setAttribute(name, value) {
    this[name] = value;
  }
}

const cell = (character, extra = {}) => ({
  codepoint: character ? character.codePointAt(0) : 0,
  grapheme_len: 0,
  width: 1,
  ...extra,
});

test("selection model normalizes cells, traverses rows, and preserves Ghostty graphemes", () => {
  assert.equal(compareTerminalSelectionCells({ col: 1, absoluteRow: 2 }, { col: 0, absoluteRow: 3 }) < 0, true);
  assert.deepEqual(
    normalizeTerminalSelectionCells({ col: 4, absoluteRow: 2 }, { col: 1, absoluteRow: 1 }),
    { start: { col: 1, absoluteRow: 1 }, end: { col: 4, absoluteRow: 2 } },
  );
  assert.deepEqual(previousTerminalSelectionCell(5, { col: 0, absoluteRow: 3 }), { col: 4, absoluteRow: 2 });
  assert.deepEqual(nextTerminalSelectionCell(5, { col: 4, absoluteRow: 3 }), { col: 0, absoluteRow: 4 });
  const range = { start: { col: 2, absoluteRow: 1 }, end: { col: 1, absoluteRow: 3 } };
  assert.equal(terminalSelectionContainsCell(range, { col: 4, absoluteRow: 2 }), true);
  assert.equal(terminalSelectionContainsCell(range, { col: 1, absoluteRow: 1 }), false);

  const scrollbackLine = [cell("a"), cell("b"), cell("c"), cell(""), cell("")];
  const activeLine = [cell("d"), cell("e", { grapheme_len: 1 }), cell(""), cell("")];
  const manager = {
    selectionStart: { col: 1, absoluteRow: 0 },
    selectionEnd: { col: 2, absoluteRow: 1 },
    wasmTerm: {
      getScrollbackLength: () => 1,
      getScrollbackLine: () => scrollbackLine,
      getLine: () => activeLine,
      getGraphemeString: () => "e\u0301",
    },
  };
  assert.equal(terminalSelectionText(manager), "bc\nde\u0301");
});

const createLifecycleHarness = () => {
  const globalListeners = [];
  const sessionCleanups = new Map();
  const addSessionCleanup = (session, cleanup) => {
    const cleanups = sessionCleanups.get(session) || [];
    cleanups.push(cleanup);
    sessionCleanups.set(session, cleanups);
  };
  const lifecycle = {
    addSessionCleanup,
    clearSessionInterval() {},
    clearSessionTimeout() {},
    dispose() {
      for (const session of [...sessionCleanups.keys()]) {
        lifecycle.disposeSession(session);
      }
      globalListeners.length = 0;
    },
    disposeSession(session) {
      for (const cleanup of sessionCleanups.get(session) || []) {
        cleanup();
      }
      sessionCleanups.delete(session);
    },
    listenGlobal(target, type, listener) {
      globalListeners.push({ target, type, listener });
    },
    listenSession(session, target, type, listener) {
      target?.addEventListener?.(type, listener);
      addSessionCleanup(session, () => target?.removeEventListener?.(type, listener));
    },
    setSessionInterval() { return 1; },
    setSessionTimeout(_session, callback) { callback(); return 1; },
    start() {},
  };
  return { lifecycle, globalListeners };
};

test("selection controller owns full-buffer state, manager patches, toolbar actions, and cleanup", async () => {
  const sheet = new FakeElement();
  const viewCalls = [];
  const view = {
    cellFromPoint: () => ({ col: 1, row: 0, absoluteRow: 0 }),
    createSessionOverlay: () => ({ startHandle: new FakeElement("button"), endHandle: new FakeElement("button") }),
    dispose: () => viewCalls.push("dispose-view"),
    getSelectionSheet: () => sheet,
    hideSheet: () => viewCalls.push("hide-sheet"),
    isSheetOpen: () => false,
    positionSheet: () => true,
    removeSession: () => viewCalls.push("remove-session"),
    syncMobileMenuSelectionState: (active) => viewCalls.push(`menu:${active}`),
    updateHandles: () => true,
  };
  const { lifecycle, globalListeners } = createLifecycleHarness();
  const manager = {
    selectionStart: { col: 0, absoluteRow: 0 },
    selectionEnd: { col: 1, absoluteRow: 0 },
    wasmTerm: {
      getScrollbackLength: () => 0,
      getLine: () => [cell("o"), cell("k"), cell("")],
    },
    copyToClipboard: async () => "original-copy",
    clearSelection() {
      this.selectionStart = null;
      this.selectionEnd = null;
    },
    getSelection: () => "original-selection",
    hasSelection() { return Boolean(this.selectionStart && this.selectionEnd); },
    markCurrentSelectionDirty() {},
    selectionChangedEmitter: { fire() {} },
  };
  let selectionChange = null;
  let renderCount = 0;
  const session = {
    id: "pane-1",
    closed: false,
    shellEl: new FakeElement(),
    term: {
      canvas: new FakeElement("canvas"),
      cols: 4,
      rows: 2,
      renderer: {},
      selectionManager: manager,
      wasmTerm: manager.wasmTerm,
      clearSelection: () => manager.clearSelection(),
      getSelection: () => manager.getSelection(),
      hasSelection: () => manager.hasSelection(),
      onScroll: () => ({ dispose() {} }),
      onSelectionChange(callback) { selectionChange = callback; return { dispose() { selectionChange = null; } }; },
      requestRender: () => { renderCount += 1; },
      selectLines: () => {
        manager.selectionStart = { col: 0, absoluteRow: 0 };
        manager.selectionEnd = { col: 3, absoluteRow: 1 };
      },
    },
  };
  const actions = [];
  const sessionCleanups = [];
  const controller = createTerminalSelectionController({
    view,
    lifecycleFactory: () => lifecycle,
    getActiveSession: () => session,
    getFullBufferText: () => "full buffer",
    isRenderAllowed: () => true,
    copySession: () => actions.push("copy"),
    pasteSession: () => actions.push("paste"),
    openSearchFromSelection: () => actions.push("search"),
    showToast: (message) => actions.push(message),
    blurInput: () => actions.push("blur"),
    registerSessionCleanup: (_session, cleanup) => sessionCleanups.push(cleanup),
  });
  controller.start();
  controller.prepareManager(session);
  controller.observeSession(session);

  assert.equal(manager.getSelection(), "ok");
  assert.equal(await manager.copyToClipboard(), undefined);
  assert.equal(controller.selectAll(session), true);
  assert.equal(controller.getSelectedText(session), "full buffer");
  assert.equal(Object.hasOwn(session, "selectAllBufferActive"), false);
  assert.equal(controller.isFullBufferSelection(session), true);
  controller.clearFullBufferSelection(session);
  assert.equal(controller.getSelectedText(session), "ok\nok");

  assert.equal(controller.apply(session, { col: 2, absoluteRow: 0 }, { col: 2, absoluteRow: 0 }), true);
  assert.deepEqual(manager.selectionEnd, { col: 3, absoluteRow: 0 });
  assert.equal(renderCount, 1);
  assert.equal(actions.includes("blur"), true);

  const sheetListener = globalListeners.find((entry) => entry.target === sheet && entry.type === "click")?.listener;
  for (const action of ["copy", "paste", "search"]) {
    sheetListener({ target: { closest: () => ({ dataset: { selectionAction: action } }) } });
  }
  await Promise.resolve();
  assert.deepEqual(actions.filter((action) => ["copy", "paste", "search"].includes(action)), ["copy", "paste", "search"]);

  controller.selectAll(session);
  manager.clearSelection();
  selectionChange();
  assert.equal(controller.isFullBufferSelection(session), false);

  sessionCleanups[0]();
  assert.equal(manager.getSelection(), "original-selection");
  assert.equal(await manager.copyToClipboard(), "original-copy");
  assert.equal(viewCalls.includes("remove-session"), true);

  controller.dispose();
  controller.dispose();
  assert.equal(controller.selectAll(session), false);
  assert.equal(controller.getSelectedText(session), "");
});

test("selection lifecycle clears listeners, timeouts, and intervals per session", () => {
  const target = new FakeEventTarget();
  const clearedTimeouts = [];
  const clearedIntervals = [];
  let nextTimer = 1;
  const lifecycle = createTerminalSelectionLifecycle({
    windowObject: {
      setTimeout: () => nextTimer++,
      clearTimeout: (id) => clearedTimeouts.push(id),
      setInterval: () => nextTimer++,
      clearInterval: (id) => clearedIntervals.push(id),
    },
  });
  const session = {};
  let calls = 0;
  lifecycle.start();
  lifecycle.listenSession(session, target, "touchstart", () => { calls += 1; });
  const timeoutID = lifecycle.setSessionTimeout(session, () => {}, 10);
  const intervalID = lifecycle.setSessionInterval(session, () => {}, 10);
  target.emit("touchstart");
  assert.equal(calls, 1);
  lifecycle.disposeSession(session);
  target.emit("touchstart");
  assert.equal(calls, 1);
  assert.deepEqual(clearedTimeouts, [timeoutID]);
  assert.deepEqual(clearedIntervals, [intervalID]);
  lifecycle.dispose();
  lifecycle.dispose();
});

test("selection view owns sheet, overlay geometry, and point-to-cell mapping", () => {
  const sheet = new FakeElement();
  sheet.hidden = true;
  sheet.rect = { left: 0, top: 0, right: 60, bottom: 24, width: 60, height: 24 };
  const menuButton = new FakeElement("button");
  const mobileShortcuts = new FakeElement();
  mobileShortcuts.querySelectorAll = () => [menuButton];
  const documentObject = {
    documentElement: { clientWidth: 320, clientHeight: 240 },
    getElementById(id) {
      if (id === "selectionSheet") return sheet;
      if (id === "mobileShortcuts") return mobileShortcuts;
      return null;
    },
    createElement: (tagName) => new FakeElement(tagName),
  };
  const shell = new FakeElement();
  shell.rect = { left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100 };
  const canvas = new FakeElement("canvas");
  canvas.rect = { left: 20, top: 30, right: 120, bottom: 70, width: 100, height: 40 };
  const session = {
    shellEl: shell,
    term: {
      canvas,
      cols: 10,
      rows: 2,
      viewportY: 1,
      getViewportY: () => 1,
      getSelectionPosition: () => ({ start: { x: 1, y: 0 }, end: { x: 3, y: 1 } }),
      hasSelection: () => true,
      renderer: { getMetrics: () => ({ width: 10, height: 20 }) },
      wasmTerm: { getScrollbackLength: () => 4 },
    },
  };
  const view = createTerminalSelectionView({
    documentObject,
    windowObject: { innerWidth: 320, innerHeight: 240 },
  });
  const overlay = view.createSessionOverlay(session);
  assert.equal(shell.children.includes(overlay.overlay), true);
  assert.deepEqual(view.cellFromPoint(session, 35, 55), { col: 1, row: 1, absoluteRow: 4 });
  assert.equal(view.updateHandles(session, true), true);
  assert.equal(overlay.overlay.hidden, false);
  assert.equal(overlay.startHandle.style.left, "20px");
  assert.equal(view.positionSheet(session), true);
  assert.equal(sheet.hidden, false);
  view.syncMobileMenuSelectionState(true);
  assert.equal(menuButton.classList.values.has("has-selection"), true);
  view.removeSession(session);
  assert.equal(overlay.overlay.removed, true);
  view.dispose();
});
