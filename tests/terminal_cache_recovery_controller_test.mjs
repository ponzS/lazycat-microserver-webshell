import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalCacheRecoveryController } from "../runtime/static/terminal/history/index.js";

const expectedIdentity = {
  cacheProtocolVersion: 2,
  cacheScopeID: "scope-1",
  selector: "target-1",
  workspaceGeneration: "workspace-1",
  tabID: "tab-1",
  paneID: "pane-1",
  historyGeneration: "history-1",
};

const replayMessage = {
  cache_protocol_version: 2,
  cache_scope_id: "scope-1",
  selector: "target-1",
  workspace_generation: "workspace-1",
  tab_id: "tab-1",
  pane_id: "pane-1",
  history_generation: "history-1",
};

const identityMatches = (expected, actual) => Object.entries(expected).every(
  ([key, value]) => actual?.[key] === value,
);

const createPreviewView = () => {
  const revoked = [];
  return {
    revoked,
    clearPrepared(session) {
      session.cacheV2PreviewPrepareSeq = Number(session.cacheV2PreviewPrepareSeq || 0) + 1;
      session.cacheV2PreviewAuthorizedSnapshot = null;
      session.cacheV2PreparedPreview = null;
      session.cacheV2PreviewPreparePromise = null;
    },
    createObjectURL() {
      return "blob:preview";
    },
    decode: () => Promise.resolve(),
    hide(session) {
      session.terminalPreview.hidden = true;
      session.shellEl.dataset.previewReady = "false";
    },
    isCanvas: () => true,
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
};

const createSession = (snapshot) => ({
  cacheV2PreviewPrepareSeq: 0,
  cacheV2PreparedPreview: null,
  cacheV2PreviewPreparePromise: null,
  cacheV2PreviewAuthorizedSnapshot: null,
  cacheV2RecoveryMetrics: {
    previewHit: false,
    previewLayoutMatch: null,
    previewMissReason: "",
    previewPreparedAt: 0,
    previewVisibleAt: 0,
  },
  closed: false,
  historyCacheSnapshot: snapshot,
  id: "pane-1",
  name: "target-1",
  renderReady: false,
  shellEl: { dataset: {} },
  socket: {},
  term: { canvas: { width: 800, height: 480 } },
  terminalPreview: { hidden: true, src: "" },
  terminalReplayGeneration: 3,
});

const createController = ({ cacheV2 = {}, previewView = createPreviewView(), overrides = {} } = {}) => {
  let now = 10;
  const controller = createTerminalCacheRecoveryController({
    cacheV2: {
      identityMatches,
      loadPreview: () => Promise.resolve({
        blob: new Blob(["preview"]),
        metadata: {
          cols: 100,
          rows: 30,
          themeFingerprint: "theme-1",
          devicePixelRatio: 2,
          width: 800,
          height: 480,
        },
      }),
      ...cacheV2,
    },
    usesV2: () => true,
    hasProtocol: () => true,
    identity: () => ({ ...expectedIdentity }),
    protocolIdentity: () => ({ ...expectedIdentity }),
    withTimeout: (promise) => promise,
    previewView,
    markRecoveryMetric(session, key) {
      session.cacheV2RecoveryMetrics[key] ||= ++now;
    },
    getPreviewFingerprint: () => "theme-1",
    getActiveName: () => "target-1",
    getTerminalSize: () => ({ cols: 100, rows: 30 }),
    isReplayCommitted: () => false,
    hasIdentifiedAuthorization: () => true,
    getDevicePixelRatio: () => 2,
    ...overrides,
  });
  return { controller, previewView };
};

test("cache recovery validates complete replay and preview identities", () => {
  const snapshot = { ...expectedIdentity, endCursor: 9n, preview: {} };
  const { controller } = createController();
  assert.equal(controller.validateMessageIdentity({}, replayMessage, "history-1"), true);
  assert.equal(controller.validateReplayIdentity({}, replayMessage, snapshot, 9n), true);
  assert.equal(controller.validatePreviewIdentity({}, replayMessage, snapshot, "snapshot", 0n, 9n), true);
  assert.equal(controller.validatePreviewIdentity({}, replayMessage, snapshot, "delta", 9n, 10n), true);
  assert.equal(controller.validateReplayIdentity({}, { ...replayMessage, pane_id: "pane-2" }, snapshot, 9n), false);
});

test("cache recovery prepares and shows only an authorized current preview", async () => {
  const snapshot = { ...expectedIdentity, endCursor: 9n, preview: {} };
  const session = createSession(snapshot);
  const { controller } = createController();
  const prepared = await controller.preparePreview(session, snapshot);
  assert.equal(prepared.objectURL, "blob:preview");
  assert.equal(session.cacheV2RecoveryMetrics.previewPreparedAt > 0, true);
  session.cacheV2PreviewAuthorizedSnapshot = snapshot;
  assert.equal(await controller.showPreview(session, snapshot, session.socket, 3), true);
  assert.equal(session.terminalPreview.hidden, false);
  assert.equal(session.shellEl.dataset.previewReady, "true");
  assert.equal(session.cacheV2RecoveryMetrics.previewHit, true);
  assert.equal(session.cacheV2RecoveryMetrics.previewLayoutMatch, true);
});

test("cache recovery rejects a prepared preview that becomes stale while decoding", async () => {
  let resolvePreview;
  const loadPreview = new Promise((resolve) => {
    resolvePreview = resolve;
  });
  const snapshot = { ...expectedIdentity, endCursor: 9n, preview: {} };
  const session = createSession(snapshot);
  const previewView = createPreviewView();
  const { controller } = createController({
    cacheV2: { loadPreview: () => loadPreview },
    previewView,
  });
  const pending = controller.preparePreview(session, snapshot);
  session.cacheV2PreviewPrepareSeq += 1;
  resolvePreview({ blob: new Blob(["preview"]), metadata: {} });
  assert.equal(await pending, null);
  assert.deepEqual(previewView.revoked, ["blob:preview"]);
  assert.equal(session.cacheV2PreparedPreview, null);
});
