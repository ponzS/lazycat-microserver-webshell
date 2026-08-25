import assert from "node:assert/strict";
import test from "node:test";

import { TerminalOverviewPreviewController } from "./runtime/static/terminal_overview_preview.js";

const identity = (historyGeneration = "history-a") => ({
  cacheProtocolVersion: 2,
  cacheScopeID: "scope-a",
  selector: "demo@owner",
  workspaceGeneration: "workspace-a",
  tabID: "tab-1",
  paneID: "pane-1",
  historyGeneration,
});

const identityMatches = (left, right, { requireHistory = false } = {}) => (
  left.cacheProtocolVersion === right.cacheProtocolVersion
  && left.cacheScopeID === right.cacheScopeID
  && left.selector === right.selector
  && left.workspaceGeneration === right.workspaceGeneration
  && left.tabID === right.tabID
  && left.paneID === right.paneID
  && (!requireHistory || left.historyGeneration === right.historyGeneration)
);

const createPane = () => ({
  id: "pane-1",
  name: "demo@owner",
  historyGeneration: "",
  closed: false,
  cacheV2OverviewPreview: null,
  cacheV2OverviewPreviewPromise: null,
  cacheV2OverviewPreviewSeq: 0,
});

test("overview preview restores a cold hidden pane without a known history generation", async () => {
  const pane = createPane();
  const snapshot = {
    ...identity(),
    endCursor: 12n,
    preview: { checkpointCursor: 10n },
  };
  const image = { width: 320, height: 200, close() {} };
  let ready = 0;
  const controller = new TerminalOverviewPreviewController({
    cache: {
      identityMatches,
      loadPreview: async () => ({ blob: new Blob(["preview"]), metadata: { checkpointCursor: 10n } }),
    },
    canUse: () => true,
    identityFor: (_pane, generation) => identity(generation),
    loadManifest: async () => snapshot,
    decodePreviewBlob: async () => image,
    onReady: () => { ready += 1; },
  });

  const prepared = await controller.prepare(pane);

  assert.equal(prepared.image, image);
  assert.equal(prepared.historyGeneration, "history-a");
  assert.equal(pane.cacheV2OverviewPreview, prepared);
  assert.equal(ready, 1);
  assert.equal(controller.matches(pane, prepared), true);
});

test("overview preview rejects a stale load after pane identity becomes known", async () => {
  const pane = createPane();
  const snapshot = {
    ...identity("history-a"),
    endCursor: 12n,
    preview: { checkpointCursor: 10n },
  };
  let release;
  let closed = 0;
  const controller = new TerminalOverviewPreviewController({
    cache: {
      identityMatches,
      loadPreview: async () => new Promise((resolve) => { release = resolve; }),
    },
    canUse: () => true,
    identityFor: (_pane, generation) => identity(generation),
    loadManifest: async () => snapshot,
    decodePreviewBlob: async () => ({ width: 320, height: 200, close() { closed += 1; } }),
  });

  const pending = controller.prepare(pane);
  await Promise.resolve();
  pane.historyGeneration = "history-b";
  release({ blob: new Blob(["preview"]), metadata: { checkpointCursor: 10n } });

  assert.equal(await pending, null);
  assert.equal(pane.cacheV2OverviewPreview, null);
  assert.equal(closed, 1);
});

test("overview preview clear invalidates pending work and closes the prepared image", () => {
  const pane = createPane();
  let closed = 0;
  pane.cacheV2OverviewPreview = { image: { close() { closed += 1; } } };
  const controller = new TerminalOverviewPreviewController({
    cache: { identityMatches },
    canUse: () => true,
    identityFor: () => identity(),
    loadManifest: async () => null,
  });

  controller.clear(pane);

  assert.equal(pane.cacheV2OverviewPreview, null);
  assert.equal(pane.cacheV2OverviewPreviewSeq, 1);
  assert.equal(closed, 1);
});
