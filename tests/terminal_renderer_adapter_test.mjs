import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalRendererAdapter } from "../runtime/static/terminal/rendering/index.js";

const createCanvasContext = () => {
  const calls = [];
  return {
    calls,
    fillStyle: "",
    font: "",
    globalAlpha: 1,
    textBaseline: "",
    beginPath: () => calls.push(["beginPath"]),
    clip: () => calls.push(["clip"]),
    closePath: () => calls.push(["closePath"]),
    ellipse: (...args) => calls.push(["ellipse", ...args]),
    fill: () => calls.push(["fill"]),
    fillRect: (...args) => calls.push(["fillRect", ...args]),
    lineTo: (...args) => calls.push(["lineTo", ...args]),
    measureText: (text) => text === "M"
      ? { width: 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }
      : { width: 80, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 },
    moveTo: (...args) => calls.push(["moveTo", ...args]),
    rect: (...args) => calls.push(["rect", ...args]),
    restore: () => calls.push(["restore"]),
    save: () => calls.push(["save"]),
  };
};

const createAdapter = (context, overrides = {}) => createTerminalRendererAdapter({
  documentObject: {
    createElement: () => ({ getContext: () => context }),
  },
  windowObject: { devicePixelRatio: 1 },
  getLineHeightPercent: () => 125,
  normalizeLineHeightPercent: (value) => Math.max(100, Math.min(160, Number(value) || 100)),
  defaultLineHeightPercent: 100,
  getFontSize: () => 16,
  initialFontSize: 15,
  getFontFamily: () => "Test Mono",
  ...overrides,
});

test("renderer adapter owns estimated metrics and baseline installation", () => {
  const context = createCanvasContext();
  const adapter = createAdapter(context);
  assert.deepEqual(adapter.estimatedFontMetrics(), { width: 8, height: 18, baseline: 12 });

  const renderer = {
    fontFamily: "Test Mono",
    fontSize: 16,
    measureFont: () => ({ width: 8, height: 12, baseline: 9 }),
  };
  const session = { term: { renderer } };
  assert.equal(adapter.installBaseline(session), true);
  assert.deepEqual(renderer.metrics, { width: 8, height: 18, baseline: 12 });
  assert.equal(adapter.installBaseline(session), false);

  adapter.dispose();
  assert.equal(adapter.estimatedFontMetrics(), null);
  assert.equal(adapter.installBaseline({ term: { renderer: { measureFont: () => ({}) } } }), false);
});

test("renderer adapter owns theme, bottom viewport, seam, cursor, and powerline patches", () => {
  const context = createCanvasContext();
  const adapter = createAdapter(context);
  const originalCalls = [];
  const cells = [
    { width: 1, flags: 0, bg_r: 10, bg_g: 20, bg_b: 30, fg_r: 200, fg_g: 210, fg_b: 220, codepoint: 65 },
    { width: 1, flags: 0, bg_r: 10, bg_g: 20, bg_b: 30, fg_r: 200, fg_g: 210, fg_b: 220, codepoint: 0xE0B0 },
    { width: 1, flags: 0, bg_r: 10, bg_g: 20, bg_b: 30, fg_r: 200, fg_g: 210, fg_b: 220, codepoint: 66 },
  ];
  const renderer = {
    canvas: { width: 30 },
    ctx: context,
    cursorStyle: "block",
    devicePixelRatio: 1,
    fontFamily: "Test Mono",
    fontSize: 16,
    metrics: { width: 10, height: 20, baseline: 15 },
    theme: {
      background: "rgb(0,0,0)",
      cursor: "rgb(255,255,255)",
      selectionBackground: "rgb(1,1,1)",
      selectionForeground: "rgb(2,2,2)",
    },
    currentBuffer: {
      getLine: () => cells,
      getGraphemeString: () => "",
    },
    isInSelection: () => false,
    measureFont: () => ({ width: 10, height: 20, baseline: 15 }),
    renderCellBackground: (...args) => originalCalls.push(["background", ...args]),
    renderCellText: (...args) => originalCalls.push(["text", ...args]),
    renderCursor: (...args) => originalCalls.push(["cursor", ...args]),
    renderLine: (...args) => originalCalls.push(["line", ...args]),
    rgbToCSS: (red, green, blue) => `rgb(${red},${green},${blue})`,
  };
  let showScrollbarCalls = 0;
  let scrollToBottomCalls = 0;
  let writeCalls = 0;
  const term = {
    renderer,
    viewportY: 0.5,
    targetViewportY: 0.25,
    showScrollbar: () => { showScrollbarCalls += 1; },
    scrollToBottom: () => { scrollToBottomCalls += 1; },
    write: () => { writeCalls += 1; },
  };
  const session = { term };

  assert.deepEqual(adapter.captureViewport(term), {
    atBottom: true,
    viewportY: 0.5,
    targetViewportY: 0.25,
  });
  assert.equal(adapter.normalizeBottomViewport(term), true);
  assert.equal(term.viewportY, 0);
  assert.equal(term.targetViewportY, 0);

  assert.equal(adapter.installSession(session), true);
  assert.equal(renderer.webshellBaselinePatchInstalled, true);
  assert.equal(renderer.webshellThemeMapperInstalled, true);
  assert.equal(renderer.webshellCellSeamPatchInstalled, true);
  assert.equal(term.webshellBottomScrollbarPatchInstalled, true);

  renderer.webshellColorMap = new Map([["10,20,30", "mapped"]]);
  assert.equal(renderer.rgbToCSS(10, 20, 30), "mapped");
  assert.equal(renderer.rgbToCSS(1, 2, 3), "rgb(1,2,3)");

  term.webshellSuppressBottomScrollbar = true;
  term.showScrollbar();
  assert.equal(showScrollbarCalls, 0);
  assert.equal(term.viewportY, 0);
  assert.equal(term.targetViewportY, 0);
  term.viewportY = 4;
  term.targetViewportY = 4;
  term.scrollToBottom();
  assert.equal(scrollToBottomCalls, 1);
  term.viewportY = 0.5;
  term.targetViewportY = 0.5;
  term.write("data");
  assert.equal(writeCalls, 1);
  assert.equal(term.viewportY, 0);
  assert.equal(term.webshellSuppressBottomScrollbar, true);

  context.calls.length = 0;
  renderer.renderCellBackground(cells[1], 1, 0, 0);
  assert.equal(originalCalls.some(([type]) => type === "background"), true);
  assert.equal(context.calls.some(([type, x, , width]) => type === "fillRect" && x < 10 && width > 10), true);

  context.calls.length = 0;
  renderer.renderCursor(1, 0);
  assert.equal(context.calls.some(([type, x, , width]) => type === "fillRect" && x < 10 && width > 10), true);

  context.calls.length = 0;
  renderer.renderCellText(cells[1], 1, 0, 0);
  assert.equal(context.calls.some(([type]) => type === "lineTo"), true);
  assert.equal(originalCalls.filter(([type]) => type === "text").length, 0);

  context.calls.length = 0;
  renderer.renderLine(cells, 0, cells.length, 0.25);
  assert.equal(originalCalls.some(([type, , , , offsetY]) => type === "line" && offsetY === 0.25), true);
  assert.equal(adapter.installCellSeam(session), false);
});

test("renderer adapter keeps application state outside the rendering domain", () => {
  const context = createCanvasContext();
  const adapter = createAdapter(context);
  assert.deepEqual(Object.keys(adapter).sort(), [
    "adjustFontMetrics",
    "captureViewport",
    "dispose",
    "estimatedFontMetrics",
    "installBaseline",
    "installBottomScrollbar",
    "installCellSeam",
    "installSession",
    "installThemeMapper",
    "normalizeBottomViewport",
    "syncRuntime",
  ]);
  assert.equal("connect" in adapter, false);
  assert.equal("replay" in adapter, false);
  assert.equal("resize" in adapter, false);
});
