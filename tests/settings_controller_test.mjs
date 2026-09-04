import assert from "node:assert/strict";
import test from "node:test";

import { createSettingsController } from "../runtime/static/settings/index.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

const settle = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

const baseServerState = (overrides = {}) => ({
  terminal_font_id: "",
  terminal_symbol_font: null,
  terminal_line_height_percent: 100,
  terminal_scrollback: 2000,
  desktop_mouse_clipboard_enabled: true,
  desktop_shortcuts_bar_enabled: false,
  mobile_pixel_scroll_enabled: true,
  mobile_double_tap_reminder_enabled: true,
  mobile_shortcuts: [[], []],
  desktop_shortcuts: [],
  fonts: [],
  ...overrides,
});

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
};

const createFakeWindow = () => {
  const timers = new Map();
  let nextID = 1;
  return {
    clearTimeout(id) {
      timers.delete(id);
    },
    location: { href: "https://webshell.example.test/app/" },
    runTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
    setTimeout(callback) {
      const id = nextID++;
      timers.set(id, callback);
      return id;
    },
    timers,
  };
};

const createViewHarness = () => {
  const state = {
    desktopDraft: null,
    feedback: [],
    lineHeight: 100,
    mobileDraft: null,
    mobileEditTarget: null,
    open: false,
    renders: [],
    saving: [],
    scrollback: 2000,
    toggles: {
      desktopMouseClipboard: true,
      desktopShortcutsBar: false,
      forcePCMode: false,
      mobileDoubleTapReminder: true,
      mobilePixelScroll: true,
      mobileRemoteDesktop: false,
    },
  };
  const elements = { tabs: [] };
  const view = {
    elements,
    activeTabID: () => "terminal",
    close() {
      state.open = false;
    },
    closeDesktopShortcutEditor() {},
    closeMobileShortcutEditor() {},
    consumeFontFiles: () => [],
    desktopShortcutIndexFromEvent: () => null,
    focusActiveTab() {},
    focusMobileNavItem() {},
    fontIDFromEvent: () => null,
    isBackdropTarget: () => false,
    isDesktopShortcutEditorOpen: () => false,
    isMobileShortcutEditorOpen: () => false,
    isOpen: () => state.open,
    mobileNavTabFromEvent: () => "",
    mobileShortcutEditTarget: () => state.mobileEditTarget,
    open() {
      state.open = true;
    },
    openDesktopShortcutEditor() {},
    openMobileShortcutEditor() {},
    readDesktopShortcutDraft: () => state.desktopDraft,
    readLineHeight: () => state.lineHeight,
    readMobileShortcutDraft: () => state.mobileDraft,
    readScrollback: () => state.scrollback,
    renderDesktopShortcuts(shortcuts) {
      state.renders.push({ desktop: shortcuts.map((item) => ({ ...item })) });
    },
    renderFonts() {},
    renderMobileNav() {},
    renderMobileShortcuts(rows) {
      state.renders.push({ mobile: rows.map((row) => row.map((item) => ({ ...item }))) });
    },
    setActiveTab: (tabID) => tabID,
    setClientSettingsVisible() {},
    setDesktopShortcutsScrolling() {},
    setFeedback(message, tone) {
      state.feedback.push({ message, tone });
    },
    setLineHeight(value) {
      state.lineHeight = value;
    },
    setMobileShortcutsScrolling() {},
    setSaving(kind, saving) {
      state.saving.push({ kind, saving });
    },
    setScrollback(value) {
      state.scrollback = value;
    },
    syncDesktopShortcutCapture() {},
    syncMobileNavigation() {},
    syncMobileShortcutEditorFields() {},
    syncToggles(snapshot) {
      state.toggles.desktopMouseClipboard = snapshot.desktopMouseClipboardEnabled;
      state.toggles.desktopShortcutsBar = snapshot.desktopShortcutsBarEnabled;
      state.toggles.mobilePixelScroll = snapshot.mobilePixelScrollEnabled;
      state.toggles.mobileDoubleTapReminder = snapshot.mobileDoubleTapReminderEnabled;
      state.toggles.mobileRemoteDesktop = snapshot.mobileRemoteDesktopEnabled;
      state.toggles.forcePCMode = snapshot.forcePCModeEnabled;
    },
    toggleValue(name) {
      return state.toggles[name] === true;
    },
  };
  return { state, view };
};

const createLifecycleHarness = () => {
  let handlers = null;
  let starts = 0;
  let disposes = 0;
  const transientRemovers = [];
  return {
    factory(options) {
      handlers = options.handlers;
      return {
        dispose() {
          disposes += 1;
          transientRemovers.splice(0).forEach((remove) => remove());
        },
        listenTransient() {
          let active = true;
          const remove = () => {
            active = false;
          };
          transientRemovers.push(remove);
          return remove;
        },
        start() {
          starts += 1;
        },
      };
    },
    get disposes() {
      return disposes;
    },
    get handlers() {
      return handlers;
    },
    get starts() {
      return starts;
    },
  };
};

test("settings owns immutable snapshots and preserves explicit empty shortcut configurations", async () => {
  const { state: viewState, view } = createViewHarness();
  const lifecycle = createLifecycleHarness();
  const mobileText = "  printf 'hello'\nnext  ";
  const controller = createSettingsController({
    api: {
      load: async () => baseServerState({
        terminal_scrollback: 3200,
        terminal_line_height_percent: 125,
        mobile_shortcuts: [[{ id: "text", label: "Run", text: mobileText }], []],
        desktop_shortcuts: [],
      }),
      patch: async () => baseServerState(),
    },
    fontRegistry: { dispose() {}, registerAll: async () => ({ fontFailures: [], symbolFailed: false }) },
    lifecycleFactory: lifecycle.factory,
    storage: createStorage(),
    view,
    windowObject: createFakeWindow(),
  });

  controller.start();
  await controller.load();

  const first = controller.getSnapshot();
  assert.equal(first.mobileShortcuts[0][0].text, mobileText);
  assert.deepEqual(first.desktopShortcuts, []);
  first.mobileShortcuts[0][0].text = "mutated";
  first.desktopShortcuts.push({ id: "bad" });
  const second = controller.getSnapshot();
  assert.equal(second.mobileShortcuts[0][0].text, mobileText);
  assert.deepEqual(second.desktopShortcuts, []);
  assert.equal(second.terminalScrollback, 3200);
  assert.equal(second.terminalLineHeightPercent, 125);
  assert.ok(viewState.renders.some((entry) => entry.mobile?.[0]?.[0]?.text === mobileText));
  assert.equal(lifecycle.starts, 1);
});

test("settings sends field-only PATCH payloads and overlays a newer pending field over an older response", async () => {
  const { state: viewState, view } = createViewHarness();
  const lifecycle = createLifecycleHarness();
  const firstPatch = deferred();
  const secondPatch = deferred();
  const patches = [];
  const controller = createSettingsController({
    api: {
      load: async () => baseServerState(),
      patch(patch) {
        patches.push(patch);
        return patches.length === 1 ? firstPatch.promise : secondPatch.promise;
      },
    },
    fontRegistry: { dispose() {}, registerAll: async () => ({ fontFailures: [], symbolFailed: false }) },
    lifecycleFactory: lifecycle.factory,
    storage: createStorage(),
    view,
    windowObject: createFakeWindow(),
  });
  controller.start();
  await controller.load();

  viewState.toggles.desktopMouseClipboard = false;
  const firstSave = lifecycle.handlers.onDesktopMouseClipboardChange();
  viewState.toggles.desktopShortcutsBar = true;
  const secondSave = lifecycle.handlers.onDesktopShortcutsBarChange();
  await settle();
  assert.deepEqual(patches, [{ desktop_mouse_clipboard_enabled: false }]);

  firstPatch.resolve(baseServerState({ desktop_mouse_clipboard_enabled: false, desktop_shortcuts_bar_enabled: false }));
  await firstSave;
  assert.equal(controller.getDesktopShortcutsBarEnabled(), true);
  assert.deepEqual(patches, [
    { desktop_mouse_clipboard_enabled: false },
    { desktop_shortcuts_bar_enabled: true },
  ]);

  secondPatch.resolve(baseServerState({ desktop_mouse_clipboard_enabled: false, desktop_shortcuts_bar_enabled: true }));
  await secondSave;
  assert.equal(controller.getDesktopMouseClipboardEnabled(), false);
  assert.equal(controller.getDesktopShortcutsBarEnabled(), true);
});

test("line-height save does not reload an unchanged font family", async () => {
  const { state: viewState, view } = createViewHarness();
  const lifecycle = createLifecycleHarness();
  let fontRegistrations = 0;
  let fontRefreshes = 0;
  const lineHeightChanges = [];
  const controller = createSettingsController({
    api: {
      load: async () => baseServerState(),
      patch: async (patch) => baseServerState({
        terminal_line_height_percent: patch.terminal_line_height_percent,
      }),
    },
    fontRegistry: {
      dispose() {},
      async registerAll() {
        fontRegistrations += 1;
        return { fontFailures: [], symbolFailed: false };
      },
    },
    lifecycleFactory: lifecycle.factory,
    onTerminalFontFamilyChange: () => { fontRefreshes += 1; },
    onTerminalLineHeightChange: (next, previous) => lineHeightChanges.push([next, previous]),
    storage: createStorage(),
    view,
    windowObject: createFakeWindow(),
  });
  controller.start();
  await controller.load();
  assert.equal(fontRegistrations, 1);
  const fontRefreshesAtLoad = fontRefreshes;
  assert.ok(fontRefreshesAtLoad >= 1);

  viewState.lineHeight = 120;
  lifecycle.handlers.onLineHeightChange();
  await settle();

  assert.equal(controller.getTerminalLineHeightPercent(), 120);
  assert.equal(fontRegistrations, 1);
  assert.equal(fontRefreshes, fontRefreshesAtLoad);
  assert.ok(lineHeightChanges.some(([next, previous]) => next === 120 && previous === 100));
});

test("mobile shortcut text PATCH keeps leading spaces and newlines while reset uses null", async () => {
  const { state: viewState, view } = createViewHarness();
  const lifecycle = createLifecycleHarness();
  const patches = [];
  let serverState = baseServerState({
    mobile_shortcuts: [[{ id: "text", label: "Run", text: "old" }], []],
  });
  const controller = createSettingsController({
    api: {
      load: async () => serverState,
      async patch(patch) {
        patches.push(patch);
        if (patch.mobile_shortcuts === null) {
          serverState = baseServerState();
        } else if (patch.mobile_shortcuts) {
          serverState = baseServerState({ mobile_shortcuts: patch.mobile_shortcuts });
        }
        return serverState;
      },
    },
    confirmAction: async () => true,
    fontRegistry: { dispose() {}, registerAll: async () => ({ fontFailures: [], symbolFailed: false }) },
    lifecycleFactory: lifecycle.factory,
    storage: createStorage(),
    view,
    windowObject: createFakeWindow(),
  });
  controller.start();
  await controller.load();

  viewState.mobileEditTarget = { rowIndex: 0, index: 0 };
  lifecycle.handlers.onMobileShortcutListClick({});
  viewState.mobileDraft = {
    type: "text",
    label: "Run",
    text: "  echo one\necho two  ",
  };
  lifecycle.handlers.onMobileShortcutSubmit({ preventDefault() {} });
  await settle();
  assert.equal(patches[0].mobile_shortcuts[0][0].text, "  echo one\necho two  ");
  assert.deepEqual(Object.keys(patches[0]), ["mobile_shortcuts"]);

  await lifecycle.handlers.onMobileShortcutReset();
  await settle();
  assert.deepEqual(patches.at(-1), { mobile_shortcuts: null });
});

test("dispose aborts lifecycle ownership and ignores a late settings load", async () => {
  const load = deferred();
  const { view } = createViewHarness();
  const lifecycle = createLifecycleHarness();
  let fontDisposes = 0;
  const controller = createSettingsController({
    api: { load: () => load.promise, patch: async () => baseServerState() },
    fontRegistry: {
      dispose() {
        fontDisposes += 1;
      },
      registerAll: async () => ({ fontFailures: [], symbolFailed: false }),
    },
    lifecycleFactory: lifecycle.factory,
    storage: createStorage(),
    view,
    windowObject: createFakeWindow(),
  });
  controller.start();
  const pending = controller.load();
  controller.dispose();
  load.resolve(baseServerState({ terminal_scrollback: 9999 }));
  await pending;
  assert.equal(controller.getTerminalScrollback(), 2000);
  assert.equal(lifecycle.disposes, 1);
  assert.equal(fontDisposes, 1);
});
