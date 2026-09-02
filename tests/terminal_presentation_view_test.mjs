import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalPresentationView } from "../runtime/static/terminal/rendering/presentation_view.js";

class FakeCanvas {
  constructor(width, height, rect) {
    this.width = width;
    this.height = height;
    this.rect = rect;
    this.hidden = true;
    this.style = {};
    this.operations = [];
    this.context = {
      clearRect: (...args) => this.operations.push(["clearRect", ...args]),
      drawImage: (...args) => this.operations.push(["drawImage", ...args]),
      restore: (...args) => this.operations.push(["restore", ...args]),
      save: (...args) => this.operations.push(["save", ...args]),
      setTransform: (...args) => this.operations.push(["setTransform", ...args]),
    };
  }

  getBoundingClientRect() {
    return this.rect;
  }

  getContext(kind) {
    return kind === "2d" ? this.context : null;
  }
}

test("presentation hold captures the host viewport at the top-left", () => {
  const source = new FakeCanvas(1600, 1000, { left: 0, top: 0, width: 1600, height: 1000 });
  source.style.width = "1600px";
  source.style.height = "1000px";
  const hold = new FakeCanvas(1, 1, { left: 0, top: 0, width: 0, height: 0 });
  const host = {
    clientWidth: 1200,
    clientHeight: 760,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 760 }),
    appendChild(node) { node.parentElement = this; },
  };
  const session = {
    term: { canvas: source, renderer: { devicePixelRatio: 1 } },
    terminalFrameHold: hold,
    terminalHost: host,
  };
  const view = createTerminalPresentationView({
    windowObject: { HTMLCanvasElement: FakeCanvas, devicePixelRatio: 1 },
  });

  assert.equal(view.holdFrame(session), true);
  assert.equal(hold.width, 1200);
  assert.equal(hold.height, 760);
  assert.equal(hold.style.objectPosition, "left top");
  assert.equal(hold.hidden, false);
  assert.deepEqual(hold.operations.at(-2), ["drawImage", source, 0, 0, 1600, 1000]);
});

test("presentation hold uses the renderer DPR for its backing store", () => {
  const source = new FakeCanvas(1600, 1000, { left: 0, top: 0, width: 1600, height: 1000 });
  source.style.width = "1600px";
  source.style.height = "1000px";
  const hold = new FakeCanvas(1, 1, { left: 0, top: 0, width: 0, height: 0 });
  const host = {
    clientWidth: 1200,
    clientHeight: 760,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 760 }),
    appendChild(node) { node.parentElement = this; },
  };
  const session = {
    term: { canvas: source, renderer: { devicePixelRatio: 2 } },
    terminalFrameHold: hold,
    terminalHost: host,
  };
  const view = createTerminalPresentationView({
    windowObject: { HTMLCanvasElement: FakeCanvas, devicePixelRatio: 2 },
  });

  assert.equal(view.holdFrame(session), true);
  assert.equal(hold.width, 2400);
  assert.equal(hold.height, 1520);
  assert.deepEqual(hold.operations, [
    ["save"],
    ["setTransform", 2, 0, 0, 2, 0, 0],
    ["clearRect", 0, 0, 1200, 760],
    ["drawImage", source, 0, 0, 1600, 1000],
    ["restore"],
  ]);
});
