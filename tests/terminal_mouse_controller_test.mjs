import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalMouseController,
  createTerminalMouseLifecycle,
  encodeTerminalLegacyMouseSequence,
  encodeTerminalMouseSequence,
  terminalMouseButtonFromButtons,
  terminalMouseButtonFromEvent,
  terminalMouseEventFromTouch,
  terminalMouseTrackingState,
} from "../runtime/static/terminal/mouse/index.js";

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
    event.type ||= type;
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener(event);
    }
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.length, 0);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(parent = null) {
    super();
    this.parent = parent;
    this.isTerminalHost = false;
  }

  closest(selector) {
    if (selector === ".terminal-host" && this.isTerminalHost) {
      return this;
    }
    return this.parent?.closest?.(selector) || null;
  }
}

const createPointerEvent = (overrides = {}) => {
  const calls = [];
  return {
    button: 0,
    buttons: 1,
    clientX: 20,
    clientY: 30,
    deltaX: 0,
    deltaY: 0,
    target: null,
    preventDefault: () => calls.push("prevent"),
    stopPropagation: () => calls.push("stop"),
    stopImmediatePropagation: () => calls.push("immediate"),
    calls,
    ...overrides,
  };
};

const createTerm = (modes = []) => {
  const enabledModes = new Set(modes);
  return {
    renderer: {
      getMetrics: () => ({ height: 10 }),
    },
    getMode: (mode) => enabledModes.has(mode),
    hasMouseTracking: () => false,
  };
};

test("mouse model reads Ghostty modes and encodes Legacy and SGR sequences", () => {
  const session = { term: createTerm([1000, 1002, 1006]) };
  assert.deepEqual(terminalMouseTrackingState(session), {
    x10: false,
    normal: true,
    drag: true,
    any: false,
    sgr: true,
  });
  assert.equal(terminalMouseTrackingState({ term: createTerm() }), null);
  assert.equal(terminalMouseButtonFromEvent({ button: 2 }), 2);
  assert.equal(terminalMouseButtonFromEvent({ button: 7 }), -1);
  assert.equal(terminalMouseButtonFromButtons(1), 0);
  assert.equal(terminalMouseButtonFromButtons(4), 1);
  assert.equal(terminalMouseButtonFromButtons(2), 2);
  assert.equal(terminalMouseButtonFromButtons(5, 1), 1);
  assert.deepEqual(
    terminalMouseEventFromTouch({ ctrlKey: true }, { clientX: 9, clientY: 12 }, { deltaY: -1 }),
    { clientX: 9, clientY: 12, shiftKey: false, altKey: false, ctrlKey: true, deltaY: -1 },
  );

  assert.equal(encodeTerminalLegacyMouseSequence(0, 1, 1), "\x1b[M !!");
  assert.equal(encodeTerminalLegacyMouseSequence(0, 96, 1), "");
  const trackingState = terminalMouseTrackingState(session);
  assert.equal(encodeTerminalMouseSequence({
    trackingState,
    cell: { col: 4, row: 2 },
    event: { ctrlKey: true },
    action: "press",
    button: 0,
  }), "\x1b[<16;5;3M");
  assert.equal(encodeTerminalMouseSequence({
    trackingState,
    cell: { col: 4, row: 2 },
    event: {},
    action: "release",
    button: 0,
  }), "\x1b[<0;5;3m");
  assert.equal(encodeTerminalMouseSequence({
    trackingState,
    cell: { col: 4, row: 2 },
    event: { deltaY: 1 },
    action: "wheel",
  }), "\x1b[<65;5;3M");
  assert.equal(encodeTerminalMouseSequence({
    trackingState: { x10: true, normal: false, drag: false, any: false, sgr: false },
    cell: { col: 0, row: 0 },
    event: {},
    action: "release",
    button: 0,
  }), "");
});

test("mouse controller owns desktop tracking, claimed events, adapter commands, and cleanup", () => {
  const documentObject = new FakeEventTarget();
  const shell = new FakeElement();
  const host = new FakeElement();
  host.isTerminalHost = true;
  const outside = new FakeElement();
  const session = {
    id: "pane-1",
    shellEl: shell,
    terminalHost: host,
    term: createTerm([1000, 1002, 1006]),
  };
  const sent = [];
  const cleanups = [];
  let activations = 0;
  let reassertions = 0;
  const controller = createTerminalMouseController({
    documentObject,
    cellFromPoint: (_session, clientX, clientY) => ({ col: Math.floor(clientX / 10), row: Math.floor(clientY / 10) }),
    activateSession: () => { activations += 1; },
    sendInput: (_session, data) => sent.push(data),
    reassertSize: () => { reassertions += 1; },
    registerSessionCleanup: (_session, cleanup) => cleanups.push(cleanup),
  });

  controller.installSession(session);
  const down = createPointerEvent({ target: host, clientX: 15, clientY: 25 });
  shell.emit("mousedown", down);
  assert.equal(sent[0], "\x1b[<0;2;3M");
  assert.equal(activations, 1);
  assert.deepEqual(down.calls, ["prevent", "stop", "immediate"]);

  const move = createPointerEvent({ target: outside, buttons: 1, clientX: 35, clientY: 45 });
  documentObject.emit("mousemove", move);
  assert.equal(sent[1], "\x1b[<32;4;5M");
  documentObject.emit("mousemove", createPointerEvent({ target: outside, buttons: 1, clientX: 35, clientY: 45 }));
  assert.equal(sent.length, 2);

  documentObject.emit("mouseup", createPointerEvent({ target: outside, button: 0, buttons: 0, clientX: 35, clientY: 45 }));
  assert.equal(sent[2], "\x1b[<0;4;5m");
  shell.emit("wheel", createPointerEvent({ target: host, clientX: 15, clientY: 25, deltaY: 1 }));
  assert.equal(sent[3], "\x1b[<65;2;3M");
  assert.equal(reassertions, 4);

  assert.equal(controller.sendWheel(session, -2, {}, { clientX: 15, clientY: 25 }), true);
  assert.equal(sent[4], "\x1b[<64;2;3M\x1b[<64;2;3M");
  assert.equal(controller.sendClick(session, createPointerEvent({ clientX: 15, clientY: 25 })), true);
  assert.equal(sent[5], "\x1b[<0;2;3M\x1b[<0;2;3m");

  const claimed = createPointerEvent({ target: host });
  assert.equal(controller.claimEvent(claimed), true);
  shell.emit("mousedown", claimed);
  assert.equal(sent.length, 6);

  assert.equal(cleanups.length, 1);
  cleanups[0]();
  assert.equal(shell.listenerCount(), 0);
  assert.equal(documentObject.listenerCount(), 0);
  controller.dispose();
  assert.equal(controller.sendClick(session, createPointerEvent()), false);
});

test("touch tracking preserves deferred wheel, click, and synchronous double-tap keyboard behavior", () => {
  const documentObject = new FakeEventTarget();
  const shell = new FakeElement();
  const host = new FakeElement();
  host.isTerminalHost = true;
  const session = {
    id: "pane-touch",
    shellEl: shell,
    terminalHost: host,
    term: createTerm([1000, 1006]),
  };
  const sent = [];
  const allowances = [];
  let currentTime = 0;
  let keyboardRequests = 0;
  let blurCount = 0;
  let selectionClears = 0;
  const controller = createTerminalMouseController({
    documentObject,
    cellFromPoint: () => ({ col: 1, row: 1 }),
    clearSelection: () => { selectionClears += 1; },
    sendInput: (_session, data) => sent.push(data),
    isTouchLayout: () => true,
    requiresTouchKeyboardDoubleTap: () => true,
    isDeferredTouchClickSession: () => true,
    blurInput: () => { blurCount += 1; },
    requestTouchKeyboard: () => { keyboardRequests += 1; },
    setTouchKeyboardFocusAllowance: (_session, until) => allowances.push(until),
    now: () => currentTime,
  });
  controller.installSession(session);

  const touch = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });
  const start = (point) => createPointerEvent({ target: host, touches: [point], changedTouches: [point] });
  const move = (point) => createPointerEvent({ target: host, touches: [point], changedTouches: [point] });
  const end = (point) => createPointerEvent({ target: host, touches: [], changedTouches: [point] });

  currentTime = 100;
  shell.emit("touchstart", start(touch(1, 20, 40)));
  shell.emit("touchmove", move(touch(1, 20, 20)));
  assert.deepEqual(sent, ["\x1b[<65;2;2M", "\x1b[<65;2;2M"]);
  currentTime = 150;
  shell.emit("touchend", end(touch(1, 20, 20)));
  assert.equal(keyboardRequests, 0);

  currentTime = 1000;
  shell.emit("touchstart", start(touch(2, 24, 30)));
  currentTime = 1050;
  shell.emit("touchend", end(touch(2, 24, 30)));
  assert.equal(keyboardRequests, 0);
  currentTime = 1200;
  shell.emit("touchstart", start(touch(3, 25, 31)));
  currentTime = 1250;
  shell.emit("touchend", end(touch(3, 25, 31)));
  assert.equal(keyboardRequests, 1);
  assert.equal(allowances.at(-1), 1850);
  assert.equal(sent.slice(-4).join(""), "\x1b[<0;2;2M\x1b[<0;2;2m\x1b[<0;2;2M\x1b[<0;2;2m");
  assert.equal(blurCount, 3);
  assert.equal(selectionClears, 3);
});

test("mouse lifecycle removes session listeners idempotently", () => {
  const lifecycle = createTerminalMouseLifecycle();
  const target = new FakeEventTarget();
  const session = {};
  let calls = 0;
  lifecycle.start();
  lifecycle.listenSession(session, target, "move", () => { calls += 1; });
  target.emit("move");
  assert.equal(calls, 1);
  lifecycle.disposeSession(session);
  lifecycle.disposeSession(session);
  target.emit("move");
  assert.equal(calls, 1);
  assert.equal(target.listenerCount(), 0);
  lifecycle.dispose();
});
