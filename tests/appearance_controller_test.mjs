import assert from "node:assert/strict";
import test from "node:test";

import { createAppearanceController } from "../runtime/static/appearance/index.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, options });
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const { listener } of [...(this.listeners.get(type) || [])]) {
      listener({ target: this, ...event });
    }
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }

  removeEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((entry) => (
      entry.listener !== listener || entry.options !== options
    )));
  }
}

const createFakeWindow = () => {
  const target = new FakeEventTarget();
  const timers = new Map();
  const frames = new Map();
  let nextID = 1;
  return Object.assign(target, {
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    frames,
    requestAnimationFrame(callback) {
      const id = nextID++;
      frames.set(id, callback);
      return id;
    },
    runFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    setTimeout(callback) {
      const id = nextID++;
      timers.set(id, callback);
      return id;
    },
    timers,
  });
};

const createStorage = (values = {}) => {
  const entries = new Map(Object.entries(values));
  return {
    entries,
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };
};

const catalog = () => [
  {
    id: "alpha",
    name: "Alpha",
    accent: "#445566",
    background: "#010203",
    foreground: "#aabbcc",
    xterm: {
      background: "#010203",
      foreground: "#aabbcc",
      cursor: "#112233",
      selectionBackground: "#223344",
    },
  },
  {
    id: "beta",
    name: "Beta",
    accent: "#778899",
    background: "#101112",
    foreground: "#ddeeff",
    xterm: {
      background: "#101112",
      foreground: "#ddeeff",
      cursor: "#334455",
      selectionBackground: "#445566",
    },
  },
];

const createFakeView = () => {
  const elements = {
    pickerBackdrop: new FakeEventTarget(),
    pickerClose: new FakeEventTarget(),
    pickerList: new FakeEventTarget(),
    pickerScrollbarSensor: new FakeEventTarget(),
    pickerScrollbarThumb: new FakeEventTarget(),
    pickerScrollbarTrack: new FakeEventTarget(),
    settingsThemeList: new FakeEventTarget(),
    settingsThemePanel: new FakeEventTarget(),
  };
  const state = {
    activeDocuments: [],
    disposed: 0,
    dragging: [],
    focused: 0,
    hovering: [],
    pickerOpen: false,
    pickerRenders: [],
    scrollPositions: [],
    scrollbarSyncs: [],
    settingsRenders: [],
    settingsScrolling: [],
  };
  return {
    state,
    view: {
      elements,
      applyDocumentTheme(theme) {
        state.activeDocuments.push(theme.id);
      },
      closePicker() {
        state.pickerOpen = false;
      },
      dispose() {
        state.disposed += 1;
        state.pickerOpen = false;
      },
      focusSelectedThemeOption() {
        state.focused += 1;
      },
      getPickerScrollbarMetrics() {
        return { hasScroll: true, maxScrollTop: 200, maxThumbTop: 80, thumbHeight: 20, thumbTop: 10 };
      },
      isPickerBackdropTarget(target) {
        return target === elements.pickerBackdrop;
      },
      isPickerOpen() {
        return state.pickerOpen;
      },
      isPickerThumbTarget(target) {
        return target === elements.pickerScrollbarThumb;
      },
      measureCardWidth() {
        return 320;
      },
      openPicker() {
        state.pickerOpen = true;
      },
      pickerScrollbarThumbRect() {
        return { top: 20 };
      },
      pickerScrollbarTrackRect() {
        return { top: 10 };
      },
      redrawOptions() {},
      renderPicker(options) {
        state.pickerRenders.push({ active: options.activeTheme.id, ids: options.themes.map((theme) => theme.id) });
      },
      renderSettingsThemes(options) {
        state.settingsRenders.push({ active: options.activeTheme.id, ids: options.themes.map((theme) => theme.id) });
      },
      scrollPickerFromThumbTop(value) {
        state.scrollPositions.push(value);
        return true;
      },
      setPickerDragging(value) {
        state.dragging.push(value);
      },
      setPickerScrollbarHovering(hovering, dragging) {
        state.hovering.push({ dragging, hovering });
      },
      setSettingsScrolling(value) {
        state.settingsScrolling.push(value);
      },
      syncPickerScrollbar(options) {
        state.scrollbarSyncs.push({ ...options });
      },
      themeIDFromEvent(event) {
        return String(event?.themeID || "");
      },
    },
  };
};

const noLifecycle = () => ({ dispose() {}, start() {} });

test("appearance owns catalog, stored selection, immutable snapshots, and terminal color contracts", async () => {
  const storage = createStorage({ "webshell.theme": "beta" });
  const fakeWindow = createFakeWindow();
  const { state, view } = createFakeView();
  const changes = [];
  const controller = createAppearanceController({
    windowObject: fakeWindow,
    storage,
    view,
    lifecycleFactory: noLifecycle,
    catalogLoader: { load: async () => catalog() },
    onThemeChange: (theme, previousTheme) => changes.push({ theme, previousTheme }),
  });

  controller.start();
  await controller.load();
  assert.equal(controller.getActiveTheme().id, "beta");
  assert.equal(state.activeDocuments.at(-1), "beta");
  assert.deepEqual(state.settingsRenders.at(-1), { active: "beta", ids: ["alpha", "beta"] });

  const active = controller.getActiveTheme();
  active.id = "mutated";
  active.xterm.foreground = "#000000";
  assert.equal(controller.getActiveTheme().id, "beta");
  assert.equal(controller.getActiveTheme().xterm.foreground, "#ddeeff");

  assert.deepEqual(controller.getTerminalTheme(), {
    background: "#101112",
    foreground: "#ddeeff",
    cursor: "#ddeeff",
    selectionBackground: "#445566",
  });
  assert.deepEqual(controller.getTerminalThemePayload(), {
    background: "#101112",
    cursor: "#334455",
    foreground: "#DDEEFF",
  });

  assert.equal(controller.applyTheme("alpha"), true);
  assert.equal(storage.entries.get("webshell.theme"), "alpha");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].theme.id, "alpha");
  assert.equal(changes[0].previousTheme.id, "beta");
  changes[0].theme.id = "outside-mutation";
  assert.equal(controller.getActiveTheme().id, "alpha");
  assert.equal(controller.applyTheme("missing"), false);

  controller.dispose();
  assert.equal(state.disposed, 1);
});

test("appearance catalog loading is single-flight and rejects late results after dispose", async () => {
  const gate = deferred();
  let calls = 0;
  let requestSignal = null;
  const { state, view } = createFakeView();
  const controller = createAppearanceController({
    windowObject: createFakeWindow(),
    view,
    lifecycleFactory: noLifecycle,
    catalogLoader: {
      load({ signal }) {
        calls += 1;
        requestSignal = signal;
        return gate.promise;
      },
    },
  });

  const first = controller.load();
  const second = controller.load();
  assert.equal(calls, 1);
  controller.dispose();
  assert.equal(requestSignal.aborted, true);
  gate.resolve(catalog());
  await assert.rejects(first, { name: "AbortError" });
  await assert.rejects(second, { name: "AbortError" });
  assert.equal(state.disposed, 1);
  assert.equal(controller.applyTheme("alpha"), false);
});

test("appearance lifecycle owns picker, scroll, touch, pointer, timer, and listener cleanup", async () => {
  const fakeWindow = createFakeWindow();
  const { state, view } = createFakeView();
  let prepared = 0;
  const backdropPoints = [];
  const changes = [];
  const controller = createAppearanceController({
    windowObject: fakeWindow,
    view,
    catalogLoader: { load: async () => catalog() },
    isMobileLayout: () => true,
    preparePickerOpen: () => {
      prepared += 1;
    },
    onPickerBackdropClose: (point) => backdropPoints.push(point),
    onThemeChange: (theme) => changes.push(theme.id),
  });

  await controller.load();
  controller.start();
  assert.equal(view.elements.pickerClose.listenerCount("click"), 1);
  assert.equal(view.elements.pickerList.listenerCount("click"), 1);
  assert.equal(view.elements.settingsThemeList.listenerCount("click"), 1);
  assert.equal(fakeWindow.listenerCount("pointermove"), 1);

  controller.openPicker();
  assert.equal(prepared, 1);
  assert.equal(state.pickerOpen, true);
  fakeWindow.runTimers();
  assert.equal(state.focused, 1);

  view.elements.pickerList.emit("click", { themeID: "beta" });
  assert.equal(controller.getActiveTheme().id, "beta");
  assert.deepEqual(changes, ["beta"]);

  view.elements.settingsThemePanel.emit("scroll");
  assert.equal(state.settingsScrolling.at(-1), true);
  fakeWindow.runTimers();
  assert.equal(state.settingsScrolling.at(-1), false);

  controller.openPicker();
  fakeWindow.runTimers();
  let prevented = false;
  view.elements.pickerBackdrop.emit("touchstart", { touches: [{ clientX: 2, clientY: 20 }] });
  view.elements.pickerBackdrop.emit("touchmove", {
    preventDefault() {
      prevented = true;
    },
    touches: [{ clientX: 70, clientY: 22 }],
  });
  assert.equal(prevented, true);
  assert.equal(state.pickerOpen, false);

  view.elements.pickerScrollbarThumb.emit("pointerdown", {
    button: 0,
    clientY: 28,
    pointerId: 7,
    preventDefault() {},
    stopPropagation() {},
  });
  fakeWindow.emit("pointermove", {
    clientY: 60,
    pointerId: 7,
    preventDefault() {},
  });
  assert.equal(state.scrollPositions.at(-1), 42);
  fakeWindow.emit("pointerup", { pointerId: 7 });
  assert.equal(state.dragging.at(-1), false);

  controller.openPicker();
  view.elements.pickerBackdrop.emit("click", { clientX: 11, clientY: 22 });
  assert.equal(state.pickerOpen, false);
  assert.deepEqual(backdropPoints, [{ clientX: 11, clientY: 22 }]);

  controller.dispose();
  assert.equal(view.elements.pickerClose.listenerCount("click"), 0);
  assert.equal(view.elements.pickerList.listenerCount("click"), 0);
  assert.equal(view.elements.settingsThemeList.listenerCount("click"), 0);
  assert.equal(fakeWindow.listenerCount("pointermove"), 0);
  assert.equal(fakeWindow.timers.size, 0);
  assert.equal(fakeWindow.frames.size, 0);
});
