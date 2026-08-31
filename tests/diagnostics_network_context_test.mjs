import assert from "node:assert/strict";
import test from "node:test";

import { createDiagnosticsNetworkContext } from "../runtime/static/diagnostics/index.js";

const createTabs = () => {
  const fastSocket = { id: "fast-current" };
  const staleSocket = { id: "fast-stale" };
  const unifiedSocket = { id: "unified-current" };
  const tabs = new Map([
    ["tab-1", {
      panes: new Map([
        ["pane-current", {
          name: "client:debug123",
          connectionChannel: "fast",
          connectionRetrying: true,
          socket: fastSocket,
        }],
        ["pane-stale", {
          name: "client:other",
          connectionChannel: "fast",
          connectionRetrying: true,
          socket: staleSocket,
        }],
        ["pane-closed", {
          name: "client:debug123",
          connectionChannel: "fast",
          connectionRetrying: true,
          closed: true,
          socket: { id: "closed" },
        }],
      ]),
    }],
  ]);
  return { fastSocket, staleSocket, unifiedSocket, tabs };
};

test("network context returns only current direct sockets", () => {
  const { fastSocket, staleSocket, tabs } = createTabs();
  const getNetworkContext = createDiagnosticsNetworkContext({
    getActiveName: () => "client:debug123",
    isClientInstanceName: (name) => name.startsWith("client:"),
    getTabs: () => tabs.values(),
    getUnifiedTransport: () => ({
      getTargetName: () => "client:debug123",
      getPhysicalSocket: () => ({ id: "should-not-be-used" }),
    }),
    isOnline: () => true,
  });

  const snapshot = getNetworkContext();
  assert.deepEqual(snapshot, {
    layout: "direct",
    online: true,
    retrying: true,
    sockets: [{ socket: fastSocket, kind: "fast" }],
  });
  assert.notEqual(snapshot.sockets, getNetworkContext().sockets);
  assert.equal(snapshot.sockets.some(({ socket }) => socket === staleSocket), false);
});

test("network context returns the matching unified physical socket", () => {
  const { unifiedSocket, tabs } = createTabs();
  const getNetworkContext = createDiagnosticsNetworkContext({
    getActiveName: () => "demo",
    isClientInstanceName: () => false,
    getTabs: () => tabs.values(),
    getUnifiedTransport: () => ({
      getTargetName: () => "demo",
      getPhysicalSocket: () => unifiedSocket,
    }),
    isOnline: () => false,
  });

  assert.deepEqual(getNetworkContext(), {
    layout: "unified",
    online: false,
    retrying: false,
    sockets: [{ socket: unifiedSocket, kind: "unified" }],
  });
});

test("network context does not expose a unified socket for another target", () => {
  const { tabs } = createTabs();
  const getNetworkContext = createDiagnosticsNetworkContext({
    getActiveName: () => "demo",
    isClientInstanceName: () => false,
    getTabs: () => tabs.values(),
    getUnifiedTransport: () => ({
      getTargetName: () => "other",
      getPhysicalSocket: () => ({ id: "other" }),
    }),
  });

  assert.deepEqual(getNetworkContext().sockets, []);
});
