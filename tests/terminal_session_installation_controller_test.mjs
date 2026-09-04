import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalSessionInstallationController,
  createTerminalSessionInstallationLifecycle,
} from "../runtime/static/terminal/session/index.js";

class EventTargetStub {
  constructor() {
    this.listeners = new Map();
    this.parentElement = null;
  }

  addEventListener(type, listener, options) {
    const bucket = this.listeners.get(type) || [];
    bucket.push({ listener, options });
    this.listeners.set(type, bucket);
  }

  removeEventListener(type, listener) {
    const bucket = this.listeners.get(type) || [];
    this.listeners.set(type, bucket.filter((entry) => entry.listener !== listener));
  }

  dispatch(type, event = {}) {
    for (const { listener } of [...(this.listeners.get(type) || [])]) {
      listener({ target: this, preventDefault() {}, ...event });
    }
  }

  count(type) {
    return (this.listeners.get(type) || []).length;
  }
}

const makeSession = (id = "pane-1") => {
  const shellEl = new EventTargetStub();
  const terminalHost = new EventTargetStub();
  const titleListeners = [];
  const term = {
    onTitleChange(listener) {
      titleListeners.push(listener);
      return () => {
        const index = titleListeners.indexOf(listener);
        if (index >= 0) titleListeners.splice(index, 1);
      };
    },
    emitTitle(title) {
      for (const listener of [...titleListeners]) listener(title);
    },
  };
  return {
    id,
    tabId: "tab-1",
    name: "instance-a",
    closed: false,
    title: "",
    shellEl,
    terminalHost,
    term,
  };
};

test("session installation preserves feature order and wires explicit DOM commands", () => {
  const events = [];
  const cleanups = new Map();
  const session = makeSession();
  const tab = { id: "tab-1", panes: new Map() };
  const sessionController = {
    create() {
      return session;
    },
    addCleanup(target, cleanup) {
      const bucket = cleanups.get(target) || [];
      bucket.push(cleanup);
      cleanups.set(target, bucket);
    },
  };
  const feature = (name, methods = {}) => Object.fromEntries([
    ["installSession", () => events.push(`${name}:install`)],
    ...Object.entries(methods),
  ]);
  const resize = feature("resize", {
    reassertSizeForMouse: () => events.push("resize:pointer"),
    reassertSize: () => events.push("resize:paste"),
  });
  const controller = createTerminalSessionInstallationController({
    sessionController,
    appendStartupTrace: (name) => events.push(`startup:${name}`),
    presentation: feature("presentation", { clearCanvas: () => events.push("presentation:clear") }),
    output: feature("output"),
    clearRuntimeBuffer: () => events.push("runtime:clear"),
    ime: feature("ime"),
    renderer: feature("renderer"),
    selection: feature("selection", { observeSession: () => events.push("selection:observe") }),
    tuiAdapterInstaller: {
      installClaudeTouch: () => events.push("tui:claude"),
      installOpencodeTouch: () => events.push("tui:opencode"),
      installHerdrTouch: () => events.push("tui:herdr"),
      installPiTouch: () => events.push("tui:pi"),
      installClaudeContextMenu: () => events.push("tui:context"),
      installClaudeDesktopSelection: () => events.push("tui:selection"),
    },
    mouse: feature("mouse"),
    clipboard: {
      bindDesktopSession: () => {
        events.push("clipboard:bind");
        return () => events.push("clipboard:cleanup");
      },
    },
    paste: {
      handleNativePaste: (_session, event) => {
        events.push(`paste:${event.clipboardData?.getData?.("text/plain") || ""}`);
        event.preventDefault?.();
        return { handled: true };
      },
    },
    resize,
    input: feature("input"),
    interaction: {
      bindPane: () => {
        events.push("interaction:bind");
        return () => events.push("interaction:cleanup");
      },
    },
    links: { findAtPosition: () => ({ url: "https://example.test" }) },
    getTabById: () => tab,
    setActivePane: (_tab, id, options) => events.push(`activate:${id}:${options.userInteraction === true}`),
    refreshTabAutoLabel: () => events.push("label:refresh"),
    markSessionTitleNotification: () => events.push("title:notify"),
    transportRuntime: {
      registerSession: () => events.push("transport:register"),
      connectPendingSession: () => events.push("transport:connect"),
    },
    isClientTarget: () => true,
  });

  const created = controller.createPaneSession(tab, "instance-a");
  assert.equal(created, session);
  assert.equal(tab.panes.get("pane-1"), session);
  assert.deepEqual(events.filter((entry) => !entry.startsWith("startup:" )).slice(0, 7), [
    "presentation:install",
    "output:install",
    "runtime:clear",
    "presentation:clear",
    "ime:install",
    "renderer:install",
    "selection:install",
  ]);
  assert.ok(events.indexOf("tui:context") < events.indexOf("mouse:install"));
  assert.ok(events.indexOf("mouse:install") < events.indexOf("clipboard:bind"));
  assert.equal(session.shellEl.count("pointerdown"), 1);
  assert.equal(session.shellEl.count("focusin"), 1);
  assert.equal(session.terminalHost.count("paste"), 1);

  controller.handlePresentationReady(session);
  assert.equal(events.includes("startup:真实终端 Canvas 已显示"), false);
  session.hasPresentedFrame = true;
  controller.handlePresentationReady(session);
  assert.equal(events.includes("startup:真实终端 Canvas 已显示"), true);

  session.shellEl.dispatch("pointerdown");
  session.shellEl.dispatch("focusin");
  session.terminalHost.dispatch("paste", {
    clipboardData: { getData: () => "hello" },
  });
  session.term.emitTitle("shell");
  // Current-device claim is handled by the IME capture listener.  The
  // session installation listener must not run a second resize pass.
  assert.equal(events.includes("resize:pointer"), false);
  assert.ok(events.includes("paste:hello"));
  assert.ok(events.includes("activate:pane-1:true"));
  assert.ok(events.includes("activate:pane-1:false"));
  assert.ok(events.includes("label:refresh"));

  for (const cleanup of cleanups.get(session) || []) cleanup();
  assert.equal(session.shellEl.count("pointerdown"), 0);
  assert.equal(session.shellEl.count("focusin"), 0);
  assert.equal(session.terminalHost.count("paste"), 0);
  assert.ok(events.includes("clipboard:cleanup"));
  session.shellEl.dispatch("pointerdown");
  assert.equal(events.filter((entry) => entry === "resize:pointer").length, 0);
});

test("installation lifecycle rejects late callbacks after session and app disposal", () => {
  const session = makeSession();
  const lifecycle = createTerminalSessionInstallationLifecycle();
  let calls = 0;
  lifecycle.start?.();
  lifecycle.install(session, {
    onPointerDown: () => { calls += 1; },
  });
  session.shellEl.dispatch("pointerdown");
  assert.equal(calls, 1);
  lifecycle.disposeSession(session);
  session.shellEl.dispatch("pointerdown");
  assert.equal(calls, 1);
  assert.equal(lifecycle.dispose(), true);
  assert.equal(lifecycle.dispose(), false);
});

test("session installation owns presentation-ready cross-feature side effects", () => {
  const events = [];
  const session = makeSession();
  session.connectionChannel = "unified";
  session.terminalReplayGeneration = 3;
  session.hasPresentedFrame = true;
  const controller = createTerminalSessionInstallationController({
    sessionController: {
      create: () => session,
      addCleanup: () => {},
    },
    isReplayCommitted: () => true,
    appendStartupTrace: (title) => events.push(`trace:${title}`),
    clearUnifiedRetry: () => events.push("transport:retry-reset"),
    input: { flushPending: () => events.push("input:flush") },
  });

  assert.equal(controller.handlePresentationReady(session, { becameReady: true }), true);
  assert.deepEqual(events, [
    "input:flush",
    "trace:终端输入已就绪",
    "trace:真实终端 Canvas 已显示",
    "transport:retry-reset",
  ]);
  assert.equal(session.startupTraceActive, false);

  session.closed = true;
  assert.equal(controller.handlePresentationReady(session, { becameReady: true }), false);
  session.closed = false;
  assert.equal(controller.dispose(), true);
  assert.equal(controller.handlePresentationReady(session, { becameReady: true }), false);
});
