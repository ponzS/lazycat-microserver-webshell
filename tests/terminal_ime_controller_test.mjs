import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalIMEController,
  createTerminalIMELifecycle,
  isAndroidPlatform,
  isBackwardDeleteInputType,
  isForwardDeleteInputType,
  isIOSPlatform,
  isTerminalASCIICompositionCommit,
  normalizeTerminalCompositionTextCandidates,
  stripTerminalInputSentinel,
  terminalInputDeleteBuffer,
  terminalInputDeleteBufferLength,
  terminalInputSentinel,
} from "../runtime/static/terminal/input/index.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, options });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((entry) => entry.listener !== listener));
  }

  emit(type, init = {}) {
    const event = {
      type,
      target: this,
      cancelable: true,
      defaultPrevented: false,
      immediatePropagationStopped: false,
      propagationStopped: false,
      preventDefault() {
        if (this.cancelable) {
          this.defaultPrevented = true;
        }
      },
      stopImmediatePropagation() {
        this.immediatePropagationStopped = true;
        this.propagationStopped = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
      ...init,
    };
    for (const { listener } of [...(this.listeners.get(type) || [])]) {
      listener(event);
      if (event.immediatePropagationStopped) {
        break;
      }
    }
    return event;
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.length, 0);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(documentObject, className = "") {
    super();
    this.ownerDocument = documentObject;
    this.className = className;
    this.childNodes = [];
    this.parentElement = null;
    this.parentNode = null;
    this.nodeType = 1;
    this.style = {};
    this.attributes = new Map();
    this.value = "";
    this.hidden = false;
    this.textContent = "";
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.removed = false;
    this.onFocus = null;
  }

  appendChild(child) {
    if (child.parentElement) {
      child.remove();
    }
    child.parentElement = this;
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  contains(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) {
        return true;
      }
    }
    return false;
  }

  closest(selector) {
    if (selector === ".terminal-host" && this.className.split(/\s+/).includes("terminal-host")) {
      return this;
    }
    return this.parentElement?.closest?.(selector) || null;
  }

  focus() {
    this.onFocus?.();
    if (this.ownerDocument.activeElement !== this) {
      this.ownerDocument.activeElement = this;
      this.emit("focus", { target: this, cancelable: false });
    }
  }

  blur() {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
      this.emit("blur", { target: this, cancelable: false });
    }
  }

  remove() {
    this.removed = true;
    if (!this.parentElement) {
      return;
    }
    this.parentElement.childNodes = this.parentElement.childNodes.filter((node) => node !== this);
    this.parentElement = null;
    this.parentNode = null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement(this, "body");
    this.activeElement = this.body;
  }
}

const createClock = () => {
  let nextHandle = 1;
  const timers = new Map();
  const frames = new Map();
  const clock = { value: 1000 };
  const windowObject = {
    Element: FakeElement,
    HTMLElement: FakeElement,
    performance: { now: () => clock.value },
    setTimeout(callback) {
      const handle = nextHandle++;
      timers.set(handle, callback);
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    requestAnimationFrame(callback) {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle);
    },
  };
  const runMap = (map) => {
    const entries = [...map.entries()];
    map.clear();
    for (const [, callback] of entries) {
      callback(clock.value);
    }
    return entries.length;
  };
  return {
    clock,
    frames,
    timers,
    windowObject,
    runFrames: () => runMap(frames),
    runTimers: () => runMap(timers),
  };
};

const createSession = (documentObject) => {
  const shellEl = new FakeElement(documentObject, "pane-shell");
  const terminalHost = new FakeElement(documentObject, "terminal-host");
  terminalHost.clientWidth = 640;
  terminalHost.clientHeight = 384;
  shellEl.appendChild(terminalHost);
  const canvas = new FakeElement(documentObject, "terminal-canvas");
  const textarea = new FakeElement(documentObject, "terminal-textarea");
  const terminalFrameHold = new FakeElement(documentObject, "terminal-frame-hold");
  const compositionPreview = new FakeElement(documentObject, "terminal-composition-preview");
  terminalHost.appendChild(canvas);
  terminalHost.appendChild(textarea);
  terminalHost.appendChild(terminalFrameHold);
  terminalHost.appendChild(compositionPreview);

  const compositionListeners = {
    compositionStartListener: () => {},
    compositionUpdateListener: () => {},
    compositionEndListener: () => {},
  };
  terminalHost.addEventListener("compositionstart", compositionListeners.compositionStartListener);
  terminalHost.addEventListener("compositionupdate", compositionListeners.compositionUpdateListener);
  terminalHost.addEventListener("compositionend", compositionListeners.compositionEndListener);
  let customKeyHandler = null;
  const term = {
    canvas,
    textarea,
    cols: 80,
    rows: 24,
    renderer: {
      getCanvas: () => canvas,
      getMetrics: () => ({ width: 8, height: 16 }),
    },
    wasmTerm: {
      getCursor: () => ({ x: 2, y: 1 }),
    },
    inputHandler: {
      ...compositionListeners,
      isComposing: false,
      webshellCompositionDetached: false,
    },
    attachCustomKeyEventHandler(handler) {
      customKeyHandler = handler;
    },
  };
  return {
    id: "pane-1",
    closed: false,
    shellEl,
    terminalHost,
    terminalFrameHold,
    compositionPreview,
    term,
    allowMobileKeyboardFocusUntil: 0,
    composingIME: false,
    compositionPreviousText: "",
    compositionText: "",
    compositionTextHistory: [],
    pendingCompositionInput: null,
    lastPasteAt: 0,
    lastPasteText: "",
    lastTextInput: null,
    nativeDeleteInputPending: false,
    nativeDeleteResetTimer: 0,
    terminalInputAnchor: null,
    inputViewportLock: null,
    customKeyHandler: () => customKeyHandler,
  };
};

const createHarness = ({ android = false, touch = true } = {}) => {
  const documentObject = new FakeDocument();
  const timerHarness = createClock();
  const session = createSession(documentObject);
  const sent = [];
  const pasted = [];
  const cleanups = [];
  const calls = [];
  let keyboardShows = 0;
  const navigatorObject = {
    platform: android ? "Linux armv8l" : "MacIntel",
    userAgent: android ? "Mozilla/5.0 (Linux; Android 16)" : "Mozilla/5.0",
    maxTouchPoints: touch ? 5 : 0,
    virtualKeyboard: {
      show() {
        keyboardShows += 1;
        return Promise.resolve();
      },
    },
  };
  const controller = createTerminalIMEController({
    windowObject: timerHarness.windowObject,
    documentObject,
    navigatorObject,
    getActiveSession: () => session,
    getTerminalFontSize: () => 15,
    getTerminalFontFamily: () => "monospace",
    getTheme: () => ({ foreground: "#eee", background: "#111" }),
    isTouchShortcutLayout: () => touch,
    requiresTouchKeyboardDoubleTap: () => touch,
    isKeyboardViewportActive: () => false,
    updateActiveTabTitle: () => calls.push("title"),
    captureInputViewportLock: (target) => {
      target.inputViewportLock = { captured: true };
      calls.push("capture-lock");
    },
    releaseInputViewportLock: (target) => {
      target.inputViewportLock = null;
      calls.push("release-lock");
    },
    scheduleKeyboardDismissRecovery: () => calls.push("dismiss-recovery"),
    reassertSize: (_target, options) => calls.push(["reassert", options?.force === true]),
    claimCurrentDeviceSize: () => calls.push("claim-size"),
    scrollToBottom: () => calls.push("bottom"),
    sendInput: (_target, data) => sent.push(data),
    pasteText: async (_target, text) => {
      pasted.push(text);
      return true;
    },
    handleNativePaste: (_target, event) => {
      const text = event.clipboardData?.getData("text/plain") || "";
      if (!text) return { handled: false };
      event.preventDefault();
      event.stopImmediatePropagation();
      pasted.push(text);
      return { handled: true, kind: "text", text, completion: Promise.resolve(true) };
    },
    shouldApplyStickyTextInput: (value) => value === "a",
    shouldApplyStickyCompositionInput: (value) => value === "a",
    consumeStickyInput: (value) => `^${value}`,
    installKeyOverrides: () => calls.push("install-keys"),
    registerSessionCleanup: (_target, cleanup) => cleanups.push(cleanup),
  });
  return {
    ...timerHarness,
    calls,
    cleanups,
    controller,
    documentObject,
    keyboardShows: () => keyboardShows,
    navigatorObject,
    pasted,
    sent,
    session,
  };
};

test("IME model owns sentinel, delete, composition, and platform classification", () => {
  assert.equal(terminalInputDeleteBufferLength, 256);
  assert.equal(terminalInputDeleteBuffer, terminalInputSentinel.repeat(256));
  assert.equal(stripTerminalInputSentinel(`${terminalInputSentinel}a${terminalInputSentinel}`), "a");
  assert.equal(isBackwardDeleteInputType("deleteContentBackward"), true);
  assert.equal(isBackwardDeleteInputType("deleteContentForward"), false);
  assert.equal(isForwardDeleteInputType("deleteWordForward"), true);
  assert.deepEqual(normalizeTerminalCompositionTextCandidates(["ni", "n"], "ni", "你"), ["ni", "n", "你"]);
  assert.equal(isTerminalASCIICompositionCommit("a"), true);
  assert.equal(isTerminalASCIICompositionCommit(" "), false);
  assert.equal(isTerminalASCIICompositionCommit("你"), false);
  assert.equal(isIOSPlatform({ platform: "iPhone", userAgent: "", maxTouchPoints: 1 }), true);
  assert.equal(isIOSPlatform({ platform: "MacIntel", userAgent: "", maxTouchPoints: 5 }), true);
  assert.equal(isAndroidPlatform({ platform: "Linux", userAgent: "Android 16" }), true);
  assert.equal(isAndroidPlatform({ platform: "Linux", userAgent: "Firefox" }), false);
});

test("IME lifecycle cancels listeners, timers, frames, and late callbacks", () => {
  const timerHarness = createClock();
  const lifecycle = createTerminalIMELifecycle({ windowObject: timerHarness.windowObject });
  const session = { closed: false };
  const target = new FakeEventTarget();
  const calls = [];
  assert.equal(lifecycle.bind(session), true);
  lifecycle.listen(session, target, "input", () => calls.push("listener"));
  lifecycle.timeout(session, () => calls.push("timer"), 0);
  lifecycle.frame(session, () => calls.push("frame"));
  assert.equal(lifecycle.disposeSession(session), true);
  target.emit("input");
  timerHarness.runTimers();
  timerHarness.runFrames();
  assert.deepEqual(calls, []);
  assert.equal(lifecycle.disposeSession(session), false);
  assert.equal(lifecycle.dispose(), true);
  assert.equal(lifecycle.dispose(), false);
  assert.equal(lifecycle.bind({ closed: false }), false);
});

test("IME install is idempotent and owns textarea geometry and host cleanup", () => {
  const harness = createHarness({ touch: false });
  const extra = new FakeElement(harness.documentObject, "unexpected");
  harness.session.terminalHost.appendChild(extra);
  const listenersBefore = harness.session.terminalHost.listenerCount() + harness.session.shellEl.listenerCount();
  assert.equal(harness.controller.installSession(harness.session), true);
  const listenersAfterFirst = harness.session.terminalHost.listenerCount() + harness.session.shellEl.listenerCount();
  assert.equal(harness.controller.installSession(harness.session), true);
  assert.equal(harness.session.terminalHost.listenerCount() + harness.session.shellEl.listenerCount(), listenersAfterFirst);
  assert.ok(listenersAfterFirst > listenersBefore);
  assert.equal(harness.cleanups.length, 1);
  assert.equal(harness.calls.filter((call) => call === "install-keys").length, 1);
  assert.equal(extra.removed, true);
  assert.equal(harness.session.terminalHost.childNodes.includes(harness.session.terminalFrameHold), true);
  assert.equal(harness.session.terminalHost.childNodes.includes(harness.session.compositionPreview), true);
  assert.equal(harness.session.term.textarea.attributes.get("rows"), "1");
  assert.equal(harness.session.term.textarea.attributes.get("wrap"), "off");
  assert.equal(harness.session.term.textarea.style.width, "640px");
  assert.equal(harness.session.term.textarea.style.height, "16px");
  assert.equal(harness.session.term.textarea.style.textIndent, "16px");
  assert.equal(harness.session.term.textarea.style.zIndex, "3");
  assert.equal(harness.session.term.inputHandler.webshellCompositionDetached, true);
  assert.equal(harness.session.term.inputHandler.compositionStartListener, null);
});

test("IME composition commits once, suppresses duplicate ASCII separator, and applies sticky input", () => {
  const harness = createHarness();
  harness.controller.installSession(harness.session);
  const textarea = harness.session.term.textarea;

  textarea.emit("compositionstart", { data: "" });
  textarea.emit("compositionupdate", { data: "ni" });
  assert.equal(harness.session.composingIME, true);
  assert.equal(harness.session.compositionPreview.hidden, false);
  assert.equal(harness.session.compositionPreview.textContent, "ni");
  textarea.emit("compositionend", { data: "你" });
  assert.deepEqual(harness.sent, ["你"]);
  textarea.value = "你";
  textarea.emit("input", { inputType: "insertText" });
  assert.deepEqual(harness.sent, ["你"]);

  harness.clock.value += 100;
  textarea.emit("compositionstart", { data: "" });
  textarea.emit("compositionupdate", { data: "a" });
  textarea.emit("compositionend", { data: "a" });
  assert.deepEqual(harness.sent, ["你", "^a"]);
  const separator = textarea.emit("beforeinput", { inputType: "insertText", data: " " });
  assert.equal(separator.defaultPrevented, true);
  assert.deepEqual(harness.sent, ["你", "^a"]);
  assert.equal(harness.session.inputViewportLock?.captured, true);
});

test("IME native delete preserves browser mutation and paste is routed once", async () => {
  const harness = createHarness({ android: true });
  harness.controller.installSession(harness.session);
  const textarea = harness.session.term.textarea;

  const firstDelete = textarea.emit("beforeinput", { inputType: "deleteContentBackward" });
  const secondDelete = textarea.emit("beforeinput", { inputType: "deleteContentBackward" });
  assert.equal(firstDelete.defaultPrevented, false);
  assert.equal(secondDelete.defaultPrevented, false);
  assert.deepEqual(harness.sent, ["\x7f", "\x7f"]);
  assert.equal(harness.session.nativeDeleteInputPending, true);
  harness.runTimers();
  assert.equal(harness.session.nativeDeleteInputPending, false);
  assert.equal(textarea.value, terminalInputDeleteBuffer);

  const pasteEvent = textarea.emit("paste", {
    clipboardData: { getData: () => "paste-value" },
  });
  assert.equal(pasteEvent.defaultPrevented, true);
  await Promise.resolve();
  assert.deepEqual(harness.pasted, ["paste-value"]);
  textarea.emit("beforeinput", {
    inputType: "insertFromPaste",
    data: "paste-value",
    dataTransfer: { getData: () => "paste-value" },
  });
  await Promise.resolve();
  assert.deepEqual(harness.pasted, ["paste-value"]);
});

test("IME system focus does not steal touch focus and double tap focuses synchronously", () => {
  const harness = createHarness({ android: true });
  harness.controller.installSession(harness.session);
  const { shellEl, terminalHost, term } = harness.session;
  assert.equal(term.focus(), false);
  assert.equal(harness.documentObject.activeElement, harness.documentObject.body);

  const order = [];
  term.textarea.onFocus = () => order.push("focus");
  const touch = { clientX: 20, clientY: 30 };
  shellEl.emit("touchstart", { target: terminalHost, touches: [touch] });
  shellEl.emit("touchend", { target: terminalHost, touches: [], changedTouches: [touch] });
  assert.equal(harness.documentObject.activeElement, harness.documentObject.body);

  harness.clock.value += 100;
  shellEl.emit("touchstart", { target: terminalHost, touches: [touch] });
  const secondEnd = shellEl.emit("touchend", {
    target: terminalHost,
    touches: [],
    changedTouches: [touch],
    preventDefault() {
      this.defaultPrevented = true;
      order.push("prevent");
    },
  });
  assert.deepEqual(order.slice(-2), ["focus", "prevent"]);
  assert.equal(secondEnd.defaultPrevented, true);
  assert.equal(harness.documentObject.activeElement, term.textarea);
  assert.equal(harness.keyboardShows(), 1);
  assert.equal(harness.controller.consumeKeyboardClaim(secondEnd), true);
  assert.equal(harness.controller.consumeKeyboardClaim(secondEnd), false);
});

test("IME dispose rejects late callbacks and further input", () => {
  const harness = createHarness();
  harness.controller.installSession(harness.session);
  const textarea = harness.session.term.textarea;
  textarea.emit("compositionstart", { data: "" });
  textarea.emit("compositionend", { data: "done" });
  const sentBeforeDispose = harness.sent.length;
  textarea.value = "late";
  assert.equal(harness.controller.disposeSession(harness.session), true);
  harness.runTimers();
  harness.runFrames();
  textarea.emit("beforeinput", { inputType: "insertText", data: "late" });
  assert.equal(harness.sent.length, sentBeforeDispose);
  assert.equal(harness.session.pendingCompositionInput, null);
  assert.equal(harness.session.inputViewportLock, null);
  assert.equal(harness.controller.disposeSession(harness.session), false);
  assert.equal(harness.controller.dispose(), true);
  assert.equal(harness.controller.installSession(harness.session), false);
});
