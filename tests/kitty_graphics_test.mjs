import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { isKittyGraphicsResponse, installKittyGraphicsSupport } from "../runtime/static/terminal/rendering/index.js";

globalThis.requestAnimationFrame = (callback) => {
  callback();
  return 1;
};
globalThis.ImageData = class {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};
globalThis.createImageBitmap = async (source) => ({
  width: source.width || 1,
  height: source.height || 1,
  source,
});
globalThis.atob ||= (value) => Buffer.from(value, "base64").toString("binary");

class FakeTerminal {
  constructor() {
    this.writes = [];
    this.responses = [];
    this.drawCalls = [];
    this.cols = 111;
    this.rows = 57;
    this.viewportY = 0;
    this.wasmTerm = {
      getCursor: () => ({ x: 2, y: 3 }),
      getScrollbackLength: () => 10,
      write: (data) => this.writes.push(data),
    };
    this.renderer = {
      ctx: { drawImage: (...args) => this.drawCalls.push(args) },
      metrics: { width: 8, height: 16 },
      devicePixelRatio: 2,
      canvas: { width: 1776, height: 1824 },
      render: () => true,
    };
  }

  open() {}

  write(data, callback) {
    this.wasmTerm.write(data);
    callback?.();
  }

  clear() {}

  reset() {}

  dispose() {}

  requestRender() {
    this.renderer.render(null, true, 0);
  }

  input(data) {
    this.responses.push(data);
  }
}

installKittyGraphicsSupport(FakeTerminal);

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("timed out waiting for asynchronous image decode");
};

test("Kitty Graphics protocol replies are recognized as generated terminal input", () => {
  assert.equal(isKittyGraphicsResponse("\x1b_Gi=1;OK\x1b\\"), true);
  assert.equal(isKittyGraphicsResponse("\x1b_Gi=2;EINVAL: only direct transmission is supported\x1b\\"), true);
  assert.equal(isKittyGraphicsResponse("Gi=1;OK"), false);
});

test("Kitty Graphics keeps APC bytes out of the terminal parser and answers queries", () => {
  const terminal = new FakeTerminal();
  terminal.open();

  terminal.write("before\x1b_Ga=q,i=9;\x1b\\after");
  terminal.write("\x1b_Ga=q,f=24,t=t,i=10;\x1b\\");

  assert.equal(terminal.writes.join(""), "beforeafter");
  assert.deepEqual(terminal.responses, [
    "\x1b_Gi=9;OK\x1b\\",
    "\x1b_Gi=10;EINVAL: only direct transmission is supported\x1b\\",
  ]);
});

test("terminal pixel-size queries are consumed and answered across output chunks", () => {
  const terminal = new FakeTerminal();
  terminal.open();

  terminal.write("before\x1b[1");
  terminal.write("4tafter\x1b[14t");

  assert.equal(terminal.writes.join(""), "beforeafter");
  assert.deepEqual(terminal.responses, [
    "\x1b[4;912;888t",
    "\x1b[4;912;888t",
  ]);
});

test("Kitty Graphics resumes the ordinary text fast path after control sequences", () => {
  const terminal = new FakeTerminal();
  terminal.open();

  terminal.write("first");
  terminal.write("\x1b[2J");
  assert.equal(terminal.__kittyGraphics.terminalControlBuffer, "");
  terminal.write("second");

  assert.equal(terminal.writes.join(""), "first\x1b[2Jsecond");
});

test("Kitty Graphics preserves UTF-8 characters split across binary chunks", () => {
  const terminal = new FakeTerminal();
  terminal.open();

  terminal.write(new Uint8Array([0xE4, 0xB8]));
  terminal.write(new Uint8Array([0xAD]));

  assert.equal(terminal.writes.join(""), "中");
});

test("Kitty Graphics retains only incomplete CSI control suffixes", () => {
  const terminal = new FakeTerminal();
  terminal.open();

  terminal.write("before\x1b[");
  assert.equal(terminal.__kittyGraphics.terminalControlBuffer, "\x1b[");
  terminal.write("2Jafter");

  assert.equal(terminal.__kittyGraphics.terminalControlBuffer, "");
  assert.equal(terminal.writes.join(""), "before\x1b[2Jafter");
});

test("Kitty Graphics decodes chunked PNG data and draws at the cursor cell", async () => {
  const terminal = new FakeTerminal();
  terminal.open();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const split = Math.floor(png.length / 2);

  terminal.write(`\x1b_Ga=T,f=100,t=d,i=1,c=20,r=10,X=3,Y=4,m=1;${png.slice(0, split)}\x1b\\`);
  terminal.write(`\x1b_Gm=0;${png.slice(split)}\x1b\\`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  terminal.renderer.render(null, true, 0);

  assert.equal(terminal.writes.join(""), "\x1bD".repeat(10) + "\x1b[24G");
  assert.ok(terminal.drawCalls.length > 0);
  const latest = terminal.drawCalls.at(-1);
  assert.deepEqual(latest.slice(1), [19, 52, 160, 160]);
});

test("Kitty Graphics treats lowercase placement fields as a source crop", async () => {
  const terminal = new FakeTerminal();
  terminal.open();
  const rgb = Buffer.from([255, 0, 0, 0, 255, 0]);
  const payload = deflateSync(rgb).toString("base64");

  terminal.write(`\x1b_Ga=T,f=24,o=z,s=2,v=1,x=1,y=0,w=1,h=1,c=2,r=1,X=2,Y=3;${payload}\x1b\\`);
  await waitFor(() => terminal.drawCalls.length > 0);

  const latest = terminal.drawCalls.at(-1);
  assert.deepEqual(latest.slice(1), [1, 0, 1, 1, 18, 51, 16, 16]);
});

test("kitty icat carriage return places a full-width image at the left edge", async () => {
  const terminal = new FakeTerminal();
  terminal.open();
  let cursor = { x: 12, y: 3 };
  terminal.wasmTerm.getCursor = () => ({ ...cursor });
  terminal.wasmTerm.write = (data) => {
    terminal.writes.push(data);
    if (data.endsWith("\r")) cursor = { ...cursor, x: 0 };
  };
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  terminal.write(`\r\x1b_Ga=T,f=100,t=d,i=11,c=111,r=1,C=1;${png}\x1b\\`);
  await waitFor(() => terminal.__kittyGraphics.getPlacements().length === 1);
  terminal.renderer.render(null, true, 0);

  assert.equal(terminal.writes.join(""), "\r");
  assert.deepEqual(terminal.drawCalls.at(-1).slice(1), [0, 48, 888, 16]);
});

test("Kitty Graphics default cursor movement reserves image rows before following text", async () => {
  const terminal = new FakeTerminal();
  terminal.open();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  terminal.write(`\x1b_Ga=T,f=100,t=d,i=7,c=2,r=2;${png}\x1b\\\r\nprompt`);

  assert.equal(terminal.writes.join(""), "\x1bD\x1bD\x1b[6G\r\nprompt");
  await waitFor(() => terminal.__kittyGraphics.getPlacements().length === 1);
});

test("Kitty Graphics C=1 keeps the terminal cursor in place", async () => {
  const terminal = new FakeTerminal();
  terminal.open();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  terminal.write(`\x1b_Ga=T,f=100,t=d,i=8,c=2,r=2,C=1;${png}\x1b\\after`);

  assert.equal(terminal.writes.join(""), "after");
  await waitFor(() => terminal.__kittyGraphics.getPlacements().length === 1);
});

test("Kitty Graphics placements follow the terminal scroll viewport", async () => {
  const terminal = new FakeTerminal();
  terminal.open();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  terminal.write(`\x1b_Ga=T,f=100,t=d,i=6,c=2,r=2;${png}\x1b\\`);
  await waitFor(() => terminal.__kittyGraphics.getPlacements().length === 1);
  terminal.renderer.render(null, true, 0);
  const atBottom = terminal.drawCalls.at(-1);
  assert.deepEqual(atBottom.slice(1), [16, 48, 16, 32]);

  terminal.viewportY = 2;
  terminal.renderer.render(null, false, terminal.viewportY);
  const afterScroll = terminal.drawCalls.at(-1);
  assert.deepEqual(afterScroll.slice(1), [16, 80, 16, 32]);
});

test("Kitty Graphics decodes the compressed RGB stream emitted by kitty icat", async () => {
  const terminal = new FakeTerminal();
  terminal.open();
  const rgb = Buffer.from([255, 0, 0, 0, 255, 0]);
  const payload = deflateSync(rgb).toString("base64");
  const split = Math.floor(payload.length / 2);

  terminal.write(`\x1b_Ga=T,f=24,o=z,s=2,v=1,m=1;${payload.slice(0, split)}\x1b\\`);
  terminal.write(`\x1b_Ga=T,m=0;${payload.slice(split)}\x1b\\`);
  await waitFor(() => terminal.drawCalls.length > 0 || terminal.responses.length > 0);

  assert.deepEqual(terminal.responses, []);
  assert.ok(terminal.drawCalls.length > 0);
  const bitmap = terminal.drawCalls.at(-1)[0];
  assert.equal(bitmap.width, 2);
  assert.equal(bitmap.height, 1);
  assert.deepEqual([...bitmap.source.data], [
    255, 0, 0, 255,
    0, 255, 0, 255,
  ]);
});

test("full-screen terminal erase clears Kitty placements across output chunks", async () => {
  const terminal = new FakeTerminal();
  terminal.open();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  terminal.write(`\x1b_Ga=T,f=100,t=d,i=4,c=1,r=1;${png}\x1b\\`);
  await waitFor(() => terminal.__kittyGraphics.getPlacements().length === 1);
  terminal.writes = [];

  terminal.write("\x1b[H\x1b[");
  terminal.write("2Jprompt");

  assert.equal(terminal.__kittyGraphics.getPlacements().length, 0);
  assert.equal(terminal.writes.join(""), "\x1b[H\x1b[2Jprompt");
});

test("partial terminal erase keeps Kitty placements", async () => {
  const terminal = new FakeTerminal();
  terminal.open();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  terminal.write(`\x1b_Ga=T,f=100,t=d,i=5,c=1,r=1;${png}\x1b\\`);
  await waitFor(() => terminal.__kittyGraphics.getPlacements().length === 1);

  terminal.write("\x1b[J");

  assert.equal(terminal.__kittyGraphics.getPlacements().length, 1);
});
