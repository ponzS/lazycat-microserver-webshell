import assert from "node:assert/strict";
import test from "node:test";

import { createAppLayoutController } from "../runtime/static/app/layout/index.js";

const makeWindow = (mobile, touch) => ({
  matchMedia(query) {
    return { matches: query.includes("640px") ? mobile : touch };
  },
});

test("layout policy honors force-PC and media queries", () => {
  const documentObject = { documentElement: { dataset: {} }, body: { classList: { calls: [], toggle(...args) { this.calls.push(args); } } } };
  let debug = true;
  let forcePC = false;
  const calls = [];
  const controller = createAppLayoutController({
    windowObject: makeWindow(true, true),
    documentObject,
    isDebugModeEnabled: () => debug,
    getForcePCModeEnabled: () => forcePC,
    closeMobileActionSheet: () => calls.push("menu"),
    closeMobileCloseConfirm: (value) => calls.push(["confirm", value]),
    closeMobileCustomSelect: () => calls.push("select"),
    hideSelection: () => calls.push("selection"),
    handleViewportLayoutChange: () => calls.push("viewport"),
    resizeActiveTabForCurrentDevice: () => calls.push("resize"),
    handleHostLayoutChange: () => calls.push("host"),
    updateMobileActiveTabTitle: () => calls.push("title"),
    updateSelection: () => calls.push("update-selection"),
  });
  assert.equal(controller.isMobileLayout(), true);
  assert.equal(controller.isTouchShortcutLayout(), true);
  forcePC = true;
  assert.equal(controller.isForcePCModeActive(), true);
  assert.equal(controller.isMobileLayout(), false);
  assert.equal(controller.syncForcePCModeState(), true);
  assert.equal(documentObject.documentElement.dataset.forcePcMode, "true");
  assert.deepEqual(calls.slice(0, 4), ["menu", ["confirm", false], "select", "selection"]);
  debug = false;
  assert.equal(controller.isForcePCModeActive(), false);
});

test("layout controller synchronizes mobile pixel scroll and fences dispose", () => {
  const session = { term: { options: {} } };
  const tab = { panes: new Map([["pane", session]]) };
  const controller = createAppLayoutController({
    windowObject: makeWindow(true, false),
    getMobilePixelScrollEnabled: () => true,
  });
  assert.equal(controller.syncTerminalMobilePixelScroll(session), true);
  assert.equal(session.term.options.mobilePixelScroll, true);
  assert.equal(controller.syncTabMobilePixelScroll(tab), true);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.syncTerminalMobilePixelScroll(session), false);
  assert.equal(controller.syncTabMobilePixelScroll(tab), false);
});
