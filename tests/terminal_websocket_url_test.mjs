import assert from "node:assert/strict";
import test from "node:test";

import {
  terminalUnifiedWebSocketURL,
  terminalWebSocketURL,
} from "../runtime/static/terminal/transport/index.js";

test("terminal WebSocket URL converts page HTTP schemes and preserves path/query", () => {
  const http = terminalWebSocketURL("./ws?mode=direct", {
    windowObject: { location: { href: "http://webshell.test/app/index.html" } },
  });
  assert.equal(http.toString(), "ws://webshell.test/app/ws?mode=direct");
  const https = terminalWebSocketURL("/ws", {
    windowObject: { location: { href: "https://webshell.test/app" } },
  });
  assert.equal(https.protocol, "wss:");
});

test("terminal WebSocket URL rejects unsupported or missing bases", () => {
  assert.throws(
    () => terminalWebSocketURL("./ws", { baseURL: "file:///tmp/index.html" }),
    /Unsupported WebSocket protocol: file:/,
  );
  assert.throws(
    () => terminalWebSocketURL("./ws", { windowObject: {} }),
    /page URL is required/,
  );
});

test("Unified WebSocket URL owns transport query fields and encodes identity", () => {
  const url = terminalUnifiedWebSocketURL("instance/a", {
    windowObject: { location: { href: "https://webshell.test/app/index.html" } },
    clientID: "client id/1",
  });

  assert.equal(url.protocol, "wss:");
  assert.equal(url.pathname, "/app/ws");
  assert.equal(url.searchParams.get("mode"), "unified");
  assert.equal(url.searchParams.get("transport_role"), "unified");
  assert.equal(url.searchParams.get("protocol_version"), "1");
  assert.equal(url.searchParams.get("name"), "instance/a");
  assert.equal(url.searchParams.get("client_id"), "client id/1");
});
