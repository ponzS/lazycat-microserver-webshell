import test from "node:test";
import assert from "node:assert/strict";

if (!globalThis.window) {
  globalThis.window = {
    devicePixelRatio: 2,
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    setTimeout,
  };
}

const {
  captureTerminalGeometry,
  terminalGeometryMatches,
  planTerminalScreenshotParts,
  snapshotTerminalRows,
  drawTerminalRows,
} = await import("../runtime/static/terminal/screenshot/index.js");

const makeSession = () => {
  const manager = {
    cols: 4,
    rows: 2,
    scrollbackGeneration: 7,
    getScrollbackLength: () => 3,
    getScrollbackGeneration() { return this.scrollbackGeneration; },
    getScrollbackLine: (row) => Array.from({ length: 4 }, (_, col) => ({ codepoint: 65 + row, text: String.fromCharCode(65 + row), width: 1, fg_r: 1, fg_g: 2, fg_b: 3, bg_r: 0, bg_g: 0, bg_b: 0, flags: 0, grapheme_len: 0, col })),
    getLine: (row) => Array.from({ length: 4 }, () => ({ codepoint: 88 + row, text: String.fromCharCode(88 + row), width: 1, fg_r: 4, fg_g: 5, fg_b: 6, bg_r: 0, bg_g: 0, bg_b: 0, flags: 0, grapheme_len: 0 })),
  };
  const renderer = {
    fontSize: 14,
    fontFamily: "monospace",
    theme: { background: "#000000", foreground: "#ffffff" },
    getMetrics: () => ({ width: 8, height: 18, baseline: 14 }),
    rgbToCSS: (r, g, b) => `rgb(${r}, ${g}, ${b})`,
  };
  const session = {
    term: { wasmTerm: manager, cols: 4, rows: 2, viewportY: 2, getViewportY: () => 2 },
    terminalContentGeneration: 9,
    terminalReplayGeneration: 3,
    measuredFitGeneration: 4,
    appliedResizeEpoch: "12",
    fontMetricsGeneration: 5,
  };
  return { manager, renderer, session };
};

test("screenshot geometry starts at the current viewport and detects layout changes", () => {
  const { manager, renderer, session } = makeSession();
  const geometry = captureTerminalGeometry(session, renderer);
  assert.equal(geometry.startRow, 1);
  assert.equal(geometry.endRow, 5);
  assert.equal(geometry.totalRows, 4);
  assert.equal(terminalGeometryMatches(geometry, session, renderer), true);

  session.term.cols = 5;
  assert.equal(terminalGeometryMatches(geometry, session, renderer), false);
  session.term.cols = 4;
  renderer.fontSize = 15;
  assert.equal(terminalGeometryMatches(geometry, session, renderer), false);
  renderer.fontSize = 14;
  manager.scrollbackGeneration++;
  assert.equal(terminalGeometryMatches(geometry, session, renderer), false);
});

test("screenshot part planning enforces aggregate mobile budgets", () => {
  const plan = planTerminalScreenshotParts({ totalRows: 500, rowHeight: 18, cssWidth: 320, headerHeight: 44, footerHeight: 76, devicePixelRatio: 2 });
  assert.ok(plan.partCount >= 1 && plan.partCount <= 4);
  assert.ok(plan.estimatedPixels <= 48 * 1024 * 1024);

  assert.throws(() => planTerminalScreenshotParts({ totalRows: 100000, rowHeight: 18, cssWidth: 390, headerHeight: 44, footerHeight: 76, devicePixelRatio: 3 }), (error) => error?.code === "SCREENSHOT_RANGE_TOO_LARGE");
});

test("screenshot rows cover scrollback through active screen", () => {
  const { renderer, session } = makeSession();
  const geometry = captureTerminalGeometry(session, renderer);
  const rows = snapshotTerminalRows(geometry, geometry.startRow, geometry.endRow);
  assert.equal(rows.length, 4);
  assert.equal(rows[0][0].text, "B");
  assert.equal(rows[2][0].text, "X");
  assert.equal(rows[3][0].text, "Y");
});

test("terminal screenshot draws all backgrounds before text in each line", () => {
  const calls = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    font: "",
    lineWidth: 1,
    fillRect: (...args) => calls.push(["fillRect", ...args]),
    fillText: (...args) => calls.push(["fillText", ...args]),
    beginPath: () => calls.push(["beginPath"]),
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => calls.push(["stroke"]),
  };
  const renderer = { rgbToCSS: (r, g, b) => `rgb(${r}, ${g}, ${b})` };
  const rows = [[
    { text: "A", width: 1, fg: "255,255,255", bg: "20,20,20", flags: 0 },
    { text: "B", width: 1, fg: "255,255,255", bg: "30,30,30", flags: 0 },
  ]];
  drawTerminalRows(context, rows, { width: 20, cellWidth: 10, height: 18, baseline: 14, fontSize: 14, fontFamily: "monospace" }, { background: "#000000", foreground: "#ffffff" }, renderer);
  const textIndex = calls.findIndex(([name]) => name === "fillText");
  const cellBackgroundIndexes = calls.map(([name], index) => name === "fillRect" ? index : -1).filter((index) => index >= 0);
  assert.ok(textIndex > Math.max(...cellBackgroundIndexes));
});
