import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppearanceThemeColorMap,
  createAppearanceRuntimeController,
} from "../runtime/static/appearance/index.js";

const theme = (foreground, background) => ({
  xterm: {
    foreground,
    background,
    black: "#000000",
    red: "#ff0000",
  },
});
test("appearance runtime builds an xterm color map without mutating themes", () => {
  const from = theme("#010203", "invalid");
  const to = theme("#aabbcc", "#112233");
  const map = buildAppearanceThemeColorMap(from, to);

  assert.equal(map.get("1,2,3"), "rgb(170, 187, 204)");
  assert.equal(map.has("0,0,0"), true);
  assert.equal(map.has("255,0,0"), true);
  assert.deepEqual(from.xterm.foreground, "#010203");
});

test("appearance runtime updates every live terminal without hold or resize", () => {
  const events = [];
  const sessions = [
    {
      id: "one",
      term: {
        options: { cursorBlink: true },
        renderer: { setTheme: (value) => events.push(["set-theme", "one", value]) },
        requestRender: (options) => events.push(["render", "one", options]),
        isOpen: true,
      },
    },
    {
      id: "two",
      term: {
        options: {},
        renderer: { setTheme: (value) => events.push(["set-theme", "two", value]) },
        requestRender: (options) => events.push(["render", "two", options]),
        isOpen: true,
      },
    },
  ];
  const controller = createAppearanceRuntimeController({
    getTerminalTheme: () => ({ background: "#fff" }),
    getSessions: () => sessions,
    isRenderAllowed: () => true,
    installThemeMapper: (session) => events.push(["mapper", session.id]),
    installCellSeam: (session) => events.push(["seam", session.id]),
    scheduleOverviewRender: () => events.push(["overview"]),
    sendTerminalTheme: (session) => events.push(["send", session.id]),
  });

  assert.equal(controller.applyWorkspaceTheme(theme("#010203", "#040506")), true);
  assert.deepEqual(events.slice(0, 4).map(([kind]) => kind), ["mapper", "seam", "set-theme", "render"]);
  assert.equal(events.some(([kind]) => kind === "hold" || kind === "metrics" || kind === "resize"), false);
  assert.equal(sessions[0].term.renderer.webshellColorMap.get("1,2,3"), "rgb(1, 2, 3)");
  assert.ok(events.some(([kind]) => kind === "overview"));
  assert.equal(controller.dispose(), true);
});

test("appearance runtime rejects late cursor callbacks after dispose", () => {
  const timers = new Map();
  const events = [];
  let nextTimer = 1;
  const windowObject = {
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const session = {
    term: {
      options: { cursorBlink: true },
      renderer: { cursorVisible: false },
      isOpen: true,
      requestRender: () => events.push("render"),
    },
  };
  const controller = createAppearanceRuntimeController({
    windowObject,
    isRenderAllowed: () => true,
    syncCursorBlinkState: () => events.push("sync"),
  });

  assert.equal(controller.holdCursorVisible(session), true);
  const timerID = session.cursorBlinkHoldTimer;
  assert.equal(timers.has(timerID), true);
  assert.equal(controller.dispose(), true);
  assert.equal(session.cursorBlinkHoldTimer, 0);
  assert.equal(timers.has(timerID), false);
  assert.deepEqual(events, ["render"]);
});
