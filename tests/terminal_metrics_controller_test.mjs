import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalMetricsController } from "../runtime/static/terminal/metrics/index.js";

const makeWindow = () => {
  let nextID = 0;
  const callbacks = new Map();
  return {
    callbacks,
    getComputedStyle: () => ({ getPropertyValue: (name) => ({
      "padding-left": "4",
      "padding-right": "6",
      "padding-top": "2",
      "padding-bottom": "8",
    }[name] || "0") }),
    requestAnimationFrame(callback) {
      const id = ++nextID;
      callbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    setTimeout(callback) {
      const id = ++nextID;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) { callbacks.delete(id); },
    runAll() {
      for (const callback of [...callbacks.values()]) callback();
      callbacks.clear();
    },
  };
};

test("metrics controller applies scrollback and refreshes font metrics with hold", () => {
  const windowObject = makeWindow();
  const session = {
    term: {
      options: {},
      renderer: { measureFont: () => ({ width: 8, height: 16 }) },
    },
  };
  const tab = { panes: new Map([["pane", session]]) };
  const events = [];
  const cleanups = [];
  const controller = createTerminalMetricsController({
    windowObject,
    getTabs: () => [tab],
    getRenderer: () => ({ installBaseline: () => events.push("baseline"), estimatedFontMetrics: () => ({ width: 10, height: 20 }) }),
    getPresentation: () => ({ beginHold: () => events.push("hold"), cancelPendingRender: () => events.push("cancel") }),
    getResize: () => ({ resizePane: (_session, options) => events.push(["resize", options]) }),
    registerSessionCleanup: (_session, cleanup) => cleanups.push(cleanup),
  });
  assert.equal(controller.applyScrollback(5000), true);
  assert.equal(session.term.options.scrollback, 5000);
  assert.equal(controller.refresh(session, { deferFitRetry: true, claimSize: true }), true);
  assert.deepEqual(events.slice(0, 4), ["hold", "baseline", "cancel", ["resize", {
    settlePresentation: true,
    forceFullRender: true,
    hideUntilRender: true,
    forceSizeSync: false,
    claimSize: true,
  }]]);
  windowObject.runAll();
  assert.equal(cleanups.length, 1);
  cleanups[0]();
  assert.equal(windowObject.callbacks.size, 0);
});

test("metrics size query uses measured padding and stable fallback", () => {
  const windowObject = makeWindow();
  const area = { clientWidth: 106, clientHeight: 70 };
  const pane = { term: { cols: 80, rows: 24 } };
  const tab = { activePaneId: "pane", panes: new Map([["pane", pane]]) };
  const controller = createTerminalMetricsController({
    windowObject,
    getCurrentTab: () => tab,
    getTerminalArea: () => area,
    getRenderer: () => ({ estimatedFontMetrics: () => ({ width: 10, height: 20 }) }),
  });
  assert.deepEqual(controller.sizeQuery(), { cols: 80, rows: 24 });
  pane.term.cols = 0;
  pane.term.rows = 0;
  assert.deepEqual(controller.sizeQuery(), { cols: 9, rows: 3 });
  assert.equal(controller.dispose(), true);
  assert.equal(controller.sizeQuery(), null);
});

test("metrics controller owns live terminal option adaptation", () => {
  const windowObject = makeWindow();
  const first = { term: { options: {} } };
  const second = { term: { options: {} } };
  const tab = { panes: new Map([["first", first], ["second", second]]) };
  const events = [];
  let base = { family: "default", size: 14, scrollback: 1000 };
  const controller = createTerminalMetricsController({
    windowObject,
    getTabs: () => [tab],
    getScrollback: () => base.scrollback,
    getDefaultFontFamily: () => "default",
    setFontFamily: (value) => { base.family = value; },
    setFontSize: (value) => { base.size = value; },
    setScrollback: (value) => { base.scrollback = value; },
    onScrollbackChange: (previous, next) => events.push(["history", previous, next]),
    isMobileLayout: () => true,
    resizeActiveTabForCurrentDevice: () => events.push("resize-active"),
    getPresentation: () => ({ beginHold: (session) => events.push(["hold", session]) }),
    getRenderer: () => ({ installBaseline() {} }),
    getResize: () => ({ resizePane: () => events.push("resize-pane") }),
  });

  assert.equal(controller.applyFontFamily("Fira Code"), true);
  assert.equal(base.family, "Fira Code");
  assert.equal(first.term.options.fontFamily, "Fira Code");
  assert.equal(second.term.options.fontFamily, "Fira Code");
  assert.equal(controller.applyFontSize(18), true);
  assert.equal(base.size, 18);
  assert.equal(first.term.options.fontSize, 18);
  assert.equal(controller.applyScrollbackChange(1000, 2000), true);
  assert.equal(base.scrollback, 2000);
  assert.equal(first.term.options.scrollback, 2000);
  assert.deepEqual(events.find((event) => Array.isArray(event) && event[0] === "history"), ["history", 1000, 2000]);
  assert.equal(controller.applyMobilePixelScroll(true), true);
  assert.equal(first.term.options.mobilePixelScroll, true);
  assert.equal(events.at(-1), "resize-active");

  controller.dispose();
  assert.equal(controller.applyFontSize(22), false);
  assert.equal(first.term.options.fontSize, 18);
});

test("font option setters capture the presentation frame before Ghostty rebuilds the canvas", () => {
  const windowObject = makeWindow();
  const events = [];
  const options = new Proxy({}, {
    set(target, property, value) {
      events.push(`set:${String(property)}`);
      target[property] = value;
      return true;
    },
  });
  const session = { term: { options } };
  const tab = { panes: new Map([["pane", session]]) };
  const controller = createTerminalMetricsController({
    windowObject,
    getTabs: () => [tab],
    getPresentation: () => ({ beginHold: () => events.push("hold") }),
    getRenderer: () => ({ installBaseline() {} }),
    getResize: () => ({ resizePane: () => events.push("resize") }),
  });

  assert.equal(controller.applyFontSize(19), true);
  assert.ok(events.indexOf("hold") >= 0);
  assert.ok(events.indexOf("hold") < events.indexOf("set:fontSize"));

  events.length = 0;
  assert.equal(controller.applyFontFamily("Fira Code"), true);
  assert.ok(events.indexOf("hold") >= 0);
  assert.ok(events.indexOf("hold") < events.indexOf("set:fontFamily"));
});
