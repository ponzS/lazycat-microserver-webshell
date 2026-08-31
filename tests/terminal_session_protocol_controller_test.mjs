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

const createReplay = () => ({
  controller: new TerminalReplayController(),
  isRetryPaused: () => false,
  isCommitted: () => false,
  rangeForConnect: () => null,
  setAuthorization(session, value) {
    session.replayAuthorization = value;
    session.replayVerified = value === "identified";
    return value;
  },
  parseCursor: (value) => (/^\d+$/.test(String(value ?? "").trim()) ? BigInt(value) : null),
  hasIdentifiedAuthorization: () => false,
  noteFailure: () => false,
  finishIfReady: () => false,
});

const createCache = () => ({
  startRecoveryMetrics() {},
  prepareSession: async () => {},
  markRecoveryMetric() {},
  flushSession: async () => {},
  usesV2: () => false,
  withTimeout: (promise) => promise,
  disableSession() {},
  protocolIdentity: () => null,
  startWarmReplay: () => false,
  hidePreview() {},
  showLocalPreview: async () => {},
  validateMessageIdentity: () => true,
  validateReplayIdentity: () => true,
  warmReplayMatchesSnapshot: () => false,
  hasProtocol: () => false,
  deleteSession() {},
  resetSession() {},
  beginReplay() {},
  applyServerSnapshot() {},
});

const createSession = ({ channel = "fast", leaseID = 7, channelGeneration = 0 } = {}) => ({
  id: "pane-1",
  name: "target-1",
  tabId: "tab-1",
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

const createController = ({ session, unified = false } = {}) => {
  const replay = createReplay();
  const cache = createCache();
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
    terminalCache: cache,
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
    isClientInstanceName: () => false,
    isCurrentInstanceSession: () => true,
    terminalLocationDescription: () => "target-1/pane-1",
    isRetryableTerminalTransportError: () => false,
    invalidateSessionStartupError: () => {},
    showSessionStartupError: () => {},
    resetTerminalForHistoryReplay: () => true,
    beginTerminalRenderSuppression: () => true,
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
  return { controller, session, opens, closes, socketTimers, unified };
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
  assert.equal(session.socket?.readyState, FakeSocket.OPEN);
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
