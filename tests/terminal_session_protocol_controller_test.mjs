import assert from "node:assert/strict";
import test from "node:test";

import { TerminalReplayController } from "../runtime/static/terminal/history/index.js";
import { createTerminalSessionProtocolController } from "../runtime/static/terminal/transport/index.js";

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances = [];

  constructor(url) {
    this.url = String(url);
    this.readyState = FakeSocket.CONNECTING;
    this.binaryType = "";
    this.bufferedAmount = 0;
    this.sent = [];
    this.closed = [];
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  emit(type, payload = {}) {
    for (const callback of this.listeners.get(type) || []) {
      callback({ type, target: this, ...payload });
    }
  }

  send(value) {
    this.sent.push(value);
  }

  close(code = 1000, reason = "") {
    this.closed.push({ code, reason });
    this.readyState = FakeSocket.CLOSED;
  }
}

const createReplay = ({ range = null, events = [] } = {}) => ({
  controller: new TerminalReplayController(),
  isRetryPaused: () => false,
  isCommitted: () => false,
  rangeForConnect: () => {
    events.push("range");
    return range;
  },
  setAuthorization(session, value) {
    session.replayAuthorization = value;
    session.replayVerified = value === "identified";
    return value;
  },
  parseCursor: (value) => (/^\d+$/.test(String(value ?? "").trim()) ? BigInt(value) : null),
  hasIdentifiedAuthorization: (session) => session.replayAuthorization === "identified",
  isAuthorized: (session) => Boolean(session.replayAuthorization),
  noteFailure: () => false,
  finishIfReady: () => {
    events.push("finish");
    return false;
  },
});

const createClientHistory = (events = []) => ({
  prepareSession: async () => events.push("prepare"),
  flushSession: async () => events.push("flush-history"),
  deleteSession: () => events.push("delete-history"),
  disableSession: () => events.push("disable-history"),
  resetSession: () => events.push("reset-history"),
});

const createSession = ({
  channel = "fast",
  leaseID = 7,
  channelGeneration = 0,
  name = "target-1",
} = {}) => ({
  id: "pane-1",
  name,
  tabId: "tab-1",
  workspaceGeneration: "workspace-1",
  closed: false,
  pendingConnect: true,
  connectionEpoch: 0,
  connectionChannel: channel,
  connectionChannelGeneration: channelGeneration,
  connectionLeaseID: leaseID,
  connectionLeaseClosing: false,
  unifiedStreamID: channel === "unified" ? "stream-1" : "",
  replayController: new TerminalReplayController(),
  replayAuthorization: false,
  replayVerified: false,
  replayComplete: false,
  replayCompletionPending: false,
  historyProtocolActive: false,
  historyStateReady: false,
  historyCacheSnapshot: null,
  resetOnNextReplay: false,
  measuredFitGeneration: 1,
  terminalReplayGeneration: 0,
  shellEl: { dataset: {} },
  term: { cols: 100, rows: 30, focus() {} },
});

const createController = ({ session, unified = false, client = false, historyRange = null } = {}) => {
  const events = [];
  const replay = createReplay({ range: historyRange, events });
  const clientHistory = createClientHistory(events);
  const socketTimers = [];
  const opens = [];
  const closes = [];
  const connection = {
    open(payload) {
      opens.push(payload);
      const socket = new FakeSocket("unified://target-1");
      socket.readyState = FakeSocket.OPEN;
      return socket;
    },
    getConnection() {
      return this;
    },
    ensure() {
      return this;
    },
    matchesTarget: () => true,
    isClosedConnection: () => false,
  };
  const runtime = {
    hasKnownSize: () => true,
    currentLease: () => ({ leaseID: 7 }),
    notifyDirectOpen: (...args) => opens.push({ directOpen: args }),
    notifyDirectClosed: (...args) => closes.push({ directClosed: args }),
    notifyDirectFailure: (...args) => closes.push({ directFailure: args }),
    releaseDirectSession: (...args) => closes.push({ release: args }),
    scheduleUnifiedPaneRetry: (...args) => closes.push({ retry: args }),
    recycleUnifiedSession: (...args) => closes.push({ recycle: args }),
  };
  const terminalSessionConnection = {
    clearReconnectTimer() {},
    startSocketConnectTimer: (...args) => socketTimers.push(["connect", args]),
    clearSocketConnectTimer() {},
    startSocketHealthMonitor() {},
    startAttachReadyTimer() {},
    markSocketHealth() {},
    closeSocketForReconnect: (...args) => closes.push({ reconnect: args }),
  };
  const terminalResize = {
    size: () => ({ cols: 100, rows: 30, pixelWidth: 800, pixelHeight: 480 }),
    resizePane() {},
    handleOwnerReleased() {},
    handleApplied() {},
    handleError() {},
    handleReplayStart() {},
  };
  const terminalOutput = {
    flush() {},
    discard() {},
    write() {},
    resetQueueTurn() {},
    noteQueueTurnFrame() {},
    completeQueueTurn: () => ({ status: "accepted" }),
  };
  const terminalInput = {
    setSessionLocked() {},
    discardSession() {},
    clearGeneratedSuppression() {},
    pausePendingExpiry() {},
  };
  const terminalPresentation = {
    invalidate() {},
    beginHold() {},
    markSyncPending() {},
    ensure() {},
  };
  const controller = createTerminalSessionProtocolController({
    documentObject: { hidden: false },
    navigatorObject: { onLine: true },
    WebSocketCtor: FakeSocket,
    getActiveName: () => "target-1",
    getActiveTabId: () => "tab-1",
    getCurrentTab: () => ({ activePaneId: "pane-1" }),
    getTerminalTransportRuntime: () => runtime,
    terminalSessionConnection,
    terminalUnifiedTransport: connection,
    terminalReplay: replay,
    clientHistory,
    terminalOutput,
    terminalPresentation,
    terminalResize,
    terminalInput,
    TerminalReplayController,
    ClientTerminalReplayAdapter: class {},
    terminalCheckpointCapabilitiesForTerminal: () => [],
    maxQueuedTerminalOutputBytes: 1024 * 1024,
    serverRevisionClientID: "client-1",
    webSocketURL: () => new URL("ws://example.test/ws"),
    terminalThemePayload: () => ({ foreground: "#fff", background: "#000", cursor: "#fff" }),
    sendTerminalTheme: () => {},
    syncTerminalNetworkMonitorSockets: () => {},
    isClientInstanceName: (name) => client && String(name).startsWith("client:"),
    isCurrentInstanceSession: () => true,
    terminalLocationDescription: () => "target-1/pane-1",
    isRetryableTerminalTransportError: () => false,
    invalidateSessionStartupError: () => {},
    showSessionStartupError: () => {},
    resetTerminalForHistoryReplay: () => { events.push("reset-terminal"); return true; },
    beginTerminalRenderSuppression: () => { events.push("suppress-render"); return true; },
    endTerminalRenderSuppression: () => true,
    sessionConnectingState: () => "connecting",
    refreshWorkspaceWithRetry: async () => {},
    showToast: () => {},
    appendStartupTrace: () => {},
    appendDebugLog: () => {},
    appendDebugWarning: () => {},
    appendDebugError: () => {},
    recordTerminalSessionEvent: () => {},
  });
  return { controller, session, opens, closes, socketTimers, unified, events };
};

test("direct protocol controller builds a scoped socket and keeps timer ownership injected", async () => {
  FakeSocket.instances.length = 0;
  const session = createSession({ channel: "fast", leaseID: 7 });
  const harness = createController({ session });

  assert.equal(await harness.controller.connectSession(session, { channel: "fast", leaseID: 7 }), true);
  assert.equal(FakeSocket.instances.length, 1);
  const socket = FakeSocket.instances[0];
  const url = new URL(socket.url);
  assert.equal(url.searchParams.get("name"), "target-1");
  assert.equal(url.searchParams.get("pane"), "pane-1");
  assert.equal(url.searchParams.get("cols"), "100");
  assert.equal(url.searchParams.get("rows"), "30");
  assert.equal(url.searchParams.get("client_id"), "client-1");
  assert.equal(url.searchParams.has("local_base_cursor"), false);
  assert.equal(url.searchParams.has("local_end_cursor"), false);
  assert.equal(harness.events.includes("prepare"), false);
  assert.equal(harness.events.includes("range"), false);
  assert.equal(socket.binaryType, "arraybuffer");
  assert.equal(harness.socketTimers.length, 1);
  assert.equal(session.socket, socket);
});

test("Unified protocol controller opens one logical stream with generation and identity metadata", async () => {
  const session = createSession({ channel: "unified", leaseID: 0, channelGeneration: 3 });
  const harness = createController({ session, unified: true });

  assert.equal(await harness.controller.connectSession(session, { channel: "unified", channelGeneration: 3 }), true);
  assert.equal(harness.opens.length, 1);
  assert.equal(harness.opens[0].pane_id, "pane-1");
  assert.equal(harness.opens[0].stream_id, "stream-1");
  assert.equal(harness.opens[0].channel_generation, 3);
  assert.equal(harness.opens[0].cols, 100);
  assert.equal(harness.opens[0].workspace_generation, "workspace-1");
  assert.equal(Object.hasOwn(harness.opens[0], "history_generation"), false);
  assert.equal(Object.hasOwn(harness.opens[0], "local_base_cursor"), false);
  assert.equal(Object.hasOwn(harness.opens[0], "local_end_cursor"), false);
  assert.equal(harness.events.includes("prepare"), false);
  assert.equal(harness.events.includes("range"), false);
  assert.equal(session.socket?.readyState, FakeSocket.OPEN);
});

test("client direct transport keeps the IndexedDB history range compatibility path", async () => {
  FakeSocket.instances.length = 0;
  const session = createSession({ channel: "fast", leaseID: 7, name: "client:pc-1" });
  const historyRange = {
    generation: "history-1",
    baseCursor: 10n,
    endCursor: 20n,
    source: "cache",
  };
  const harness = createController({ session, client: true, historyRange });

  assert.equal(await harness.controller.connectSession(session, { channel: "fast", leaseID: 7 }), true);
  const url = new URL(FakeSocket.instances[0].url);
  assert.equal(url.searchParams.get("history_generation"), "history-1");
  assert.equal(url.searchParams.get("local_base_cursor"), "10");
  assert.equal(url.searchParams.get("local_end_cursor"), "20");
  assert.ok(harness.events.indexOf("prepare") < harness.events.indexOf("range"));
  assert.ok(harness.events.includes("flush-history"));
});

test("container snapshot resets under render suppression and commits only after replay complete", async () => {
  const session = createSession({ channel: "unified", leaseID: 0, channelGeneration: 3 });
  const harness = createController({ session, unified: true });
  assert.equal(await harness.controller.connectSession(session, { channel: "unified", channelGeneration: 3 }), true);
  const socket = session.socket;
  const queueMetadata = { paneID: "pane-1", streamID: "stream-1", channelGeneration: 3 };
  socket.emit("message", {
    queueMetadata,
    data: JSON.stringify({
      type: "history-replay-start",
      selector: "target-1",
      tab_id: "tab-1",
      pane_id: "pane-1",
      workspace_generation: "workspace-1",
      history_generation: "history-1",
      sync_mode: "snapshot",
      server_base_cursor: "0",
      server_end_cursor: "0",
      delta_from_cursor: "0",
      delta_to_cursor: "0",
    }),
  });
  assert.ok(harness.events.indexOf("suppress-render") < harness.events.indexOf("reset-terminal"));
  assert.equal(harness.events.includes("finish"), false);
  assert.equal(harness.events.includes("reset-history"), false);

  socket.emit("message", {
    queueMetadata,
    data: JSON.stringify({
      type: "history-replay-complete",
      selector: "target-1",
      tab_id: "tab-1",
      pane_id: "pane-1",
      workspace_generation: "workspace-1",
      history_generation: "history-1",
      history_cursor: "0",
    }),
  });
  assert.equal(harness.events.filter((event) => event === "finish").length, 1);
  assert.equal(session.replayCompletionPending, true);
});

test("stale transport callbacks are ignored after the session epoch changes", async () => {
  FakeSocket.instances.length = 0;
  const session = createSession({ channel: "fast", leaseID: 7 });
  const harness = createController({ session });
  assert.equal(await harness.controller.connectSession(session, { channel: "fast", leaseID: 7 }), true);
  const socket = FakeSocket.instances[0];
  session.connectionEpoch += 1;
  socket.readyState = FakeSocket.OPEN;
  socket.emit("open");
  assert.equal(harness.opens.filter((entry) => entry?.directOpen).length, 0);
  assert.deepEqual(harness.closes, []);
});
