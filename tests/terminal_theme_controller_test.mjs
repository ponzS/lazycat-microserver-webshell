import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalThemeController } from "../runtime/static/terminal/transport/index.js";

test("terminal theme controller sends only to an open socket", () => {
  const sent = [];
  const controller = createTerminalThemeController({
    getThemePayload: () => ({ foreground: "#fff", background: "#000" }),
    socketOpen: 1,
  });
  const session = {
    socket: {
      readyState: 1,
      send: (payload) => sent.push(JSON.parse(payload)),
    },
  };
  assert.equal(controller.send(session), true);
  assert.deepEqual(sent, [{
    type: "theme",
    foreground: "#fff",
    background: "#000",
  }]);
  assert.equal(controller.send({ socket: { readyState: 0, send() {} } }), false);
});

test("theme controller dispose fences later sends and is idempotent", () => {
  const session = { socket: { readyState: 1, send() {} } };
  const controller = createTerminalThemeController({ socketOpen: 1 });
  assert.equal(controller.dispose(), true);
  assert.equal(controller.send(session), false);
  assert.equal(controller.generation(), 1);
  assert.equal(controller.dispose(), false);
});
