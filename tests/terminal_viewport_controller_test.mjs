import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalMobileViewportController,
  createTerminalViewportLifecycle,
  currentMobileViewportOrientation,
  isKeyboardLikeViewportHeightChange,
  measureMobileViewportBottomInset,
  terminalViewportPanY,
} from "../runtime/static/terminal/viewport/index.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, callback, options) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ callback, options });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, callback) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((entry) => entry.callback !== callback));
  }

  emit(type, init = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...init,
    };
    for (const { callback } of [...(this.listeners.get(type) || [])]) {
      callback(event);
    }
    return event;
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.length, 0);
  }
}

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.values.get(name) || "";
  }
}

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

  toggle(name, force) {
    if (force === true) {
      this.values.add(name);
      return true;
    }
    if (force === false) {
      this.values.delete(name);
      return false;
    }
    if (this.values.has(name)) {
      this.values.delete(name);
      return false;
    }
    this.values.add(name);
    return true;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement extends FakeEventTarget {
  constructor() {
    super();
    this.style = new FakeStyle();
    this.classList = new FakeClassList();
    this.clientHeight = 0;
  }
}

const createClock = () => {
  let nextHandle = 1;
  const timers = new Map();
  const frames = new Map();
  const clock = { value: 1000 };
  const run = (entries) => {
    const callbacks = [...entries.values()];
    entries.clear();
    callbacks.forEach((callback) => callback(clock.value));
    return callbacks.length;
  };
  return {
    clock,
    timers,
    frames,
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
    runTimers: () => run(timers),
    runFrames: () => run(frames),
  };
};

const createHarness = ({ ios = true, android = false, initialViewportHeight = 844 } = {}) => {
  const clock = createClock();
  const visualViewport = new FakeEventTarget();
  visualViewport.width = 390;
  visualViewport.height = initialViewportHeight;
  visualViewport.offsetTop = 0;
  const orientation = new FakeEventTarget();
  orientation.type = "portrait-primary";
  orientation.angle = 0;
  const windowObject = new FakeEventTarget();
  Object.assign(windowObject, {
    HTMLElement: FakeElement,
    innerWidth: 390,
    innerHeight: 844,
    visualViewport,
    screen: { width: 390, height: 844, orientation },
    performance: { now: () => clock.clock.value },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
  });
  const documentObject = new FakeEventTarget();
  documentObject.documentElement = new FakeElement();
  documentObject.documentElement.clientWidth = 390;
  documentObject.documentElement.clientHeight = 844;
  documentObject.body = new FakeElement();
  documentObject.activeElement = documentObject.body;
  const mobileShortcuts = new FakeElement();
  const canvas = new FakeElement();
  const textarea = new FakeElement();
  const compositionPreview = new FakeElement();
  const terminalHost = new FakeElement();
  terminalHost.clientHeight = 400;
  const session = {
    id: "pane-1",
    closed: false,
    terminalHost,
    compositionPreview,
    terminalInputAnchor: null,
    inputViewportLock: null,
    term: {
      rows: 30,
      canvas,
      textarea,
      renderer: {
        getCanvas: () => canvas,
        getMetrics: () => ({ height: 20 }),
      },
      wasmTerm: {
        getCursor: () => ({ x: 2, y: 25 }),
      },
    },
  };
  const calls = [];
  const controller = createTerminalMobileViewportController({
    windowObject,
    documentObject,
    navigatorObject: {},
    mobileShortcuts,
    isIOSPlatform: () => ios,
    isAndroidPlatform: () => android,
    isForcePCModeActive: () => false,
    isMobileLayout: () => true,
    isTouchShortcutLayout: () => true,
    getActiveSession: () => session,
    getSessions: () => [session],
    hasActivePanes: () => true,
    resizeActiveTabForCurrentDevice: (options) => calls.push(["resize", options || null]),
    resetHostViewport: () => calls.push(["reset-host"]),
    positionInput: () => calls.push(["position-input"]),
    updateSelectionHandles: () => calls.push(["selection-handles"]),
    updateSelection: () => calls.push(["selection"]),
    isMobileMenuOpen: () => false,
    scheduleOverviewRender: () => calls.push(["overview"]),
    updateActiveTabTitle: () => calls.push(["title"]),
  });
  return {
    calls,
    clock,
    controller,
    documentObject,
    mobileShortcuts,
    orientation,
    session,
    visualViewport,
    windowObject,
  };
};

test("viewport model owns orientation, inset, keyboard change, and cursor pan calculations", () => {
  const windowObject = {
    innerHeight: 844,
    visualViewport: { width: 390, height: 544, offsetTop: 0 },
    screen: { width: 390, height: 844, orientation: { type: "portrait-primary", angle: 0 } },
  };
  const documentObject = { documentElement: { clientWidth: 390, clientHeight: 844 } };
  assert.equal(currentMobileViewportOrientation({ windowObject, documentObject }), "portrait");
  assert.equal(measureMobileViewportBottomInset({ windowObject, documentObject }), 300);
  assert.equal(isKeyboardLikeViewportHeightChange(844, 544, { touchLayout: true }), true);
  assert.equal(isKeyboardLikeViewportHeightChange(844, 544, { touchLayout: true, orientationChanged: true }), false);
  const session = {
    terminalHost: { clientHeight: 400 },
    term: {
      rows: 30,
      renderer: { getMetrics: () => ({ height: 20 }) },
      wasmTerm: { getCursor: () => ({ y: 25 }) },
    },
  };
  assert.equal(terminalViewportPanY(session, {
    resizeSuppressed: true,
    viewportReferenceHeight: 844,
    viewportHeight: 544,
  }), 140);
});

test("viewport lifecycle installs global listeners once and cancels timer and RAF work", () => {
  const clock = createClock();
  const windowObject = new FakeEventTarget();
  const documentObject = new FakeEventTarget();
  windowObject.visualViewport = new FakeEventTarget();
  windowObject.screen = { orientation: new FakeEventTarget() };
  Object.assign(windowObject, {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
  });
  const calls = [];
  const lifecycle = createTerminalViewportLifecycle({ windowObject, documentObject });
  assert.equal(lifecycle.start({
    onPreventZoom: () => calls.push("zoom"),
    onWindowResize: () => calls.push("resize"),
    onVisualViewport: () => calls.push("viewport"),
    onOrientationChange: () => calls.push("orientation"),
  }, { listenVisualViewport: true }), true);
  assert.equal(lifecycle.start({}, { listenVisualViewport: true }), false);
  lifecycle.timeout("timer", () => calls.push("timer"), 10);
  lifecycle.frame("frame", () => calls.push("frame"));
  windowObject.emit("resize");
  windowObject.visualViewport.emit("scroll");
  assert.deepEqual(calls, ["resize", "viewport"]);
  assert.equal(lifecycle.dispose(), true);
  assert.equal(windowObject.listenerCount(), 0);
  assert.equal(documentObject.listenerCount(), 0);
  assert.equal(windowObject.visualViewport.listenerCount(), 0);
  assert.equal(clock.runTimers(), 0);
  assert.equal(clock.runFrames(), 0);
  assert.equal(lifecycle.dispose(), false);
});

test("iOS keyboard viewport rebases the IME lock, pans the cursor, and restores after dismiss", () => {
  const harness = createHarness({ ios: true });
  assert.equal(harness.controller.start(), true);
  assert.equal(harness.controller.start(), false);
  harness.documentObject.activeElement = harness.session.term.textarea;
  assert.equal(harness.controller.captureInputLock(harness.session), true);
  harness.visualViewport.height = 544;
  harness.visualViewport.emit("resize");

  const openSnapshot = harness.controller.snapshot();
  assert.equal(openSnapshot.keyboardActive, true);
  assert.equal(openSnapshot.keyboardInsetBottom, 300);
  assert.equal(harness.session.inputViewportLock.viewportHeight, 544);
  assert.equal(harness.mobileShortcuts.style.transform, "translate3d(0, -300px, 0)");
  assert.equal(harness.controller.syncPan(harness.session), 140);
  assert.equal(harness.session.term.canvas.style.transform, "translate3d(0, -140px, 0)");

  harness.documentObject.activeElement = harness.documentObject.body;
  harness.controller.releaseInputLock(harness.session, { resync: false });
  harness.visualViewport.height = 844;
  harness.visualViewport.emit("resize");
  assert.equal(harness.controller.snapshot().keyboardActive, false);
  assert.equal(harness.mobileShortcuts.style.transform, "");
  harness.clock.clock.value += 500;
  harness.clock.runTimers();
  assert.ok(harness.calls.some(([name, options]) => (
    name === "resize" && options?.forceFullRender === true && options?.hideUntilRender === true
  )));
  assert.equal(harness.session.term.canvas.style.transform, "");
});

test("Android keeps the shortcut dock above a small client safe offset without treating it as keyboard inset", () => {
  const harness = createHarness({ ios: false, android: true, initialViewportHeight: 810 });
  assert.equal(harness.controller.start(), true);
  const snapshot = harness.controller.snapshot();
  assert.equal(snapshot.keyboardInsetBottom, 0);
  assert.equal(snapshot.clientBottomSafeOffset, 34);
  assert.equal(snapshot.keyboardActive, false);
  assert.equal(harness.mobileShortcuts.style.transform, "translate3d(0, -34px, 0)");
  assert.equal(
    harness.documentObject.documentElement.style.getPropertyValue("--mobile-client-bottom-safe-offset"),
    "34px",
  );
});

test("orientation recovery uses current terminal state and dispose rejects delayed work", () => {
  const harness = createHarness({ ios: true });
  harness.controller.start();
  const zoomEvent = harness.documentObject.emit("touchmove", { touches: [{}, {}] });
  assert.equal(zoomEvent.defaultPrevented, true);

  harness.orientation.type = "landscape-primary";
  harness.orientation.angle = 90;
  harness.windowObject.screen.width = 844;
  harness.windowObject.screen.height = 390;
  harness.visualViewport.width = 844;
  harness.visualViewport.height = 390;
  harness.windowObject.emit("orientationchange");
  assert.ok(harness.clock.timers.size > 0);
  harness.clock.runTimers();
  assert.ok(harness.calls.some(([name]) => name === "resize"));

  harness.controller.scheduleKeyboardDismissRecovery();
  const callsBeforeDispose = harness.calls.length;
  assert.equal(harness.controller.dispose(), true);
  assert.equal(harness.windowObject.listenerCount(), 0);
  assert.equal(harness.documentObject.listenerCount(), 0);
  assert.equal(harness.visualViewport.listenerCount(), 0);
  assert.equal(harness.session.inputViewportLock, null);
  harness.clock.runTimers();
  harness.clock.runFrames();
  assert.equal(harness.calls.length, callsBeforeDispose);
  assert.equal(harness.controller.dispose(), false);
});
