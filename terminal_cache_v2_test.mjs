import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./runtime/static/terminal_cache_v2.js", import.meta.url), "utf8");
const terminalCacheModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const { createTerminalCacheV2 } = terminalCacheModule;

class MemoryCache {
  entries = new Map();
  matchHook = null;

  async match(request) {
    const key = String(request);
    await this.matchHook?.(key);
    const response = this.entries.get(key);
    return response ? response.clone() : undefined;
  }

  async put(request, response) {
    this.entries.set(String(request), response.clone());
  }

  async delete(request) {
    return this.entries.delete(String(request));
  }

  async keys() {
    return [...this.entries.keys()];
  }
}

class MemoryCacheStorage {
  caches = new Map();

  async open(name) {
    if (!this.caches.has(name)) {
      this.caches.set(name, new MemoryCache());
    }
    return this.caches.get(name);
  }
}

const identity = (overrides = {}) => ({
  cacheProtocolVersion: 2,
  cacheScopeID: "scope-a",
  selector: "demo@owner",
  workspaceGeneration: "workspace-a",
  tabID: "tab-1",
  paneID: "pane-1",
  ...overrides,
});

test("cache-v2 binds a manifest to its configured history window", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  await cache.reset(identity(), "history-a", 0n, { historyWindowLines: 5000 });
  await cache.append(identity(), "history-a", [{
    startCursor: 0n,
    endCursor: 1n,
    data: new Uint8Array([1]),
  }], { historyWindowLines: 5000, limitBytes: 1024 });

  const manifest = await cache.loadManifest(identity());
  assert.equal(manifest.historyWindowLines, 5000);
  assert.equal(cache.historyWindowMatches(manifest, 5000), true);
  assert.equal(cache.historyWindowMatches(manifest, 1000), false);
});

test("cache-v2 treats a legacy manifest without a history window as incompatible", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  await cache.reset(identity(), "history-a", 0n);

  const manifest = await cache.loadManifest(identity());
  assert.equal(manifest.historyWindowLines, null);
  assert.equal(cache.historyWindowMatches(manifest, 5000), false);
});
test("cache-v2 commits continuous bytes and preview at the exact cursor", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/webshell/" });
  await cache.reset(identity(), "history-a", 0n);
  await cache.append(identity(), "history-a", [
    { startCursor: 0n, endCursor: 3n, data: new Uint8Array([1, 2, 3]) },
    { startCursor: 3n, endCursor: 5n, data: new Uint8Array([4, 5]) },
  ]);

  const manifest = await cache.loadManifest(identity());
  assert.equal(manifest.historyGeneration, "history-a");
  assert.equal(manifest.baseCursor, 0n);
  assert.equal(manifest.endCursor, 5n);
  assert.equal(manifest.chunks.length, 1);

  const replayed = [];
  await cache.readChunks(manifest, ({ data }) => replayed.push(...data));
  assert.deepEqual(replayed, [1, 2, 3, 4, 5]);

  await cache.savePreview(identity(), "history-a", 5n, new Blob([new Uint8Array([9])], { type: "image/png" }), {
    width: 1200,
    height: 800,
    cols: 120,
    rows: 32,
    devicePixelRatio: 2,
    themeFingerprint: "theme-a",
  });
  const withPreview = await cache.loadManifest(identity());
  const preview = await cache.loadPreview(withPreview);
  assert.equal(preview.metadata.checkpointCursor, 5n);
  assert.equal(preview.blob.type, "image/png");
});

test("cache-v2 keeps the last-known-good preview while output advances", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  await cache.reset(identity(), "history-a", 0n);
  await cache.append(identity(), "history-a", [{
    startCursor: 0n,
    endCursor: 1n,
    data: new Uint8Array([1]),
  }]);
  await cache.savePreview(identity(), "history-a", 1n, new Blob([new Uint8Array([9])], { type: "image/png" }), {
    width: 100,
    height: 50,
    cols: 10,
    rows: 5,
    devicePixelRatio: 1,
  });

  await cache.append(identity(), "history-a", [{
    startCursor: 1n,
    endCursor: 2n,
    data: new Uint8Array([2]),
  }]);
  const advancing = await cache.loadManifest(identity());
  assert.equal(advancing.endCursor, 2n);
  assert.equal(advancing.preview.checkpointCursor, 1n);
  const stalePreview = await cache.loadPreview(advancing);
  assert.equal(stalePreview.metadata.checkpointCursor, 1n);
  assert.deepEqual([...new Uint8Array(await stalePreview.blob.arrayBuffer())], [9]);

  await cache.savePreview(identity(), "history-a", 2n, new Blob([new Uint8Array([8])], { type: "image/png" }), {
    width: 100,
    height: 50,
    cols: 10,
    rows: 5,
    devicePixelRatio: 1,
  });
  const current = await cache.loadManifest(identity());
  const currentPreview = await cache.loadPreview(current);
  assert.equal(currentPreview.metadata.checkpointCursor, 2n);
  assert.deepEqual([...new Uint8Array(await currentPreview.blob.arrayBuffer())], [8]);
});

test("cache-v2 never resolves a manifest across account or workspace identity", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  await cache.reset(identity(), "history-a", 0n);

  assert.equal(await cache.loadManifest(identity({ cacheScopeID: "scope-b" })), null);
  assert.equal(await cache.loadManifest(identity({ workspaceGeneration: "workspace-b" })), null);
  assert.equal(await cache.loadManifest(identity({ tabID: "tab-2" })), null);
  assert.equal(await cache.loadManifest(identity({ paneID: "pane-2" })), null);
});

test("cache-v2 rejects a manifest from a different history generation", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  await cache.reset(identity(), "history-a", 0n);
  await cache.append(identity(), "history-a", [{
    startCursor: 0n,
    endCursor: 1n,
    data: new Uint8Array([1]),
  }]);

  await assert.rejects(
    cache.loadManifest(identity({ historyGeneration: "history-b" })),
    /identity does not match/,
  );
  const matching = await cache.loadManifest(identity({ historyGeneration: "history-a" }));
  assert.equal(matching.historyGeneration, "history-a");
});

test("cache-v2 rejects cursor gaps and preview checkpoints that are not persisted", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  await cache.reset(identity(), "history-a", 0n);

  await assert.rejects(
    cache.append(identity(), "history-a", [{ startCursor: 1n, endCursor: 2n, data: new Uint8Array([1]) }]),
    /append range/,
  );
  await assert.rejects(
    cache.savePreview(identity(), "history-a", 1n, new Blob([new Uint8Array([1])], { type: "image/png" }), {
      width: 100,
      height: 100,
      cols: 10,
      rows: 10,
      devicePixelRatio: 1,
    }),
    /preview cursor/,
  );
});

test("cache-v2 detects a missing immutable byte block during replay", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  await cache.reset(identity(), "history-a", 0n);
  await cache.append(identity(), "history-a", [
    { startCursor: 0n, endCursor: 2n, data: new Uint8Array([1, 2]) },
  ]);
  const store = await cacheStorage.open("lcmd-webshell-terminal-v2");
  const chunkKey = [...store.entries.keys()].find((key) => key.endsWith(".bin"));
  assert.ok(chunkKey);
  await store.delete(chunkKey);

  const manifest = await cache.loadManifest(identity());
  await assert.rejects(cache.readChunks(manifest, () => {}), /chunk is missing/);
});

test("cache-v2 rejects an altered immutable block when its checksum is present", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  await cache.reset(identity(), "history-a", 0n);
  await cache.append(identity(), "history-a", [{
    startCursor: 0n,
    endCursor: 2n,
    data: new Uint8Array([1, 2]),
  }]);
  const store = await cacheStorage.open("lcmd-webshell-terminal-v2");
  const chunkKey = [...store.entries.keys()].find((key) => key.endsWith(".bin"));
  assert.ok(chunkKey);
  await store.put(chunkKey, new Response(new Uint8Array([9, 2]), {
    headers: { "Content-Type": "application/octet-stream" },
  }));
  const manifest = await cache.loadManifest(identity());
  await assert.rejects(cache.readChunks(manifest, () => {}), /checksum is invalid/);
});

test("cache-v2 rolls its read-ahead window while replaying chunks in cursor order", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({
    cacheStorage,
    baseURL: "https://example.test/",
    readConcurrency: 2,
    writeBlockBytes: 1,
  });
  await cache.reset(identity(), "history-a", 0n);
  for (let cursor = 0n; cursor < 4n; cursor += 1n) {
    await cache.append(identity(), "history-a", [{
      startCursor: cursor,
      endCursor: cursor + 1n,
      data: new Uint8Array([Number(cursor) + 1]),
    }]);
  }
  const store = await cacheStorage.open("lcmd-webshell-terminal-v2");
  let activeMatches = 0;
  let maxActiveMatches = 0;
  let resolveFirstCallback;
  let releaseFirstCallback;
  let resolveThirdRead;
  const firstCallbackStarted = new Promise((resolve) => {
    resolveFirstCallback = resolve;
  });
  const firstCallbackGate = new Promise((resolve) => {
    releaseFirstCallback = resolve;
  });
  const thirdReadStarted = new Promise((resolve) => {
    resolveThirdRead = resolve;
  });
  store.matchHook = async (key) => {
    if (!key.endsWith(".bin")) {
      return;
    }
    if (key.includes("/2-3.bin")) {
      resolveThirdRead();
    }
    activeMatches += 1;
    maxActiveMatches = Math.max(maxActiveMatches, activeMatches);
    await new Promise((resolve) => setTimeout(resolve, key.includes("/0-1.bin") ? 10 : 1));
    activeMatches -= 1;
  };

  const manifest = await cache.loadManifest(identity());
  const replayed = [];
  const batches = [];
  const replayPromise = cache.readChunks(manifest, async ({ data, chunkIndex, chunkCount, batchEnd }) => {
    replayed.push(...data);
    batches.push({ chunkIndex, chunkCount, batchEnd });
    if (chunkIndex === 0) {
      resolveFirstCallback();
      await firstCallbackGate;
    }
  });
  await firstCallbackStarted;
  try {
    await Promise.race([
      thirdReadStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error("rolling read-ahead did not refill")), 100)),
    ]);
  } finally {
    releaseFirstCallback();
  }
  await replayPromise;

  assert.equal(maxActiveMatches, 2);
  assert.deepEqual(replayed, [1, 2, 3, 4]);
  assert.deepEqual(batches, [
    { chunkIndex: 0, chunkCount: 4, batchEnd: false },
    { chunkIndex: 1, chunkCount: 4, batchEnd: false },
    { chunkIndex: 2, chunkCount: 4, batchEnd: false },
    { chunkIndex: 3, chunkCount: 4, batchEnd: true },
  ]);
});

test("cache-v2 coalesces small appends into bounded byte blocks", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({
    cacheStorage,
    baseURL: "https://example.test/",
    writeBlockBytes: 4,
  });
  await cache.reset(identity(), "history-a", 0n);
  for (let cursor = 0n; cursor < 6n; cursor += 1n) {
    await cache.append(identity(), "history-a", [{
      startCursor: cursor,
      endCursor: cursor + 1n,
      data: new Uint8Array([Number(cursor) + 1]),
    }]);
  }

  const manifest = await cache.loadManifest(identity());
  assert.deepEqual(manifest.chunks.map((chunk) => chunk.byteLength), [4, 2]);
  const replayed = [];
  await cache.readChunks(manifest, ({ data }) => replayed.push(...data));
  assert.deepEqual(replayed, [1, 2, 3, 4, 5, 6]);
});

test("cache-v2 defaults to one MiB byte blocks", async () => {
  assert.match(source, /const defaultReadConcurrency = 8;/);
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({
    cacheStorage,
    baseURL: "https://example.test/",
  });
  const first = new Uint8Array(600 * 1024).fill(1);
  const second = new Uint8Array(424 * 1024).fill(2);
  const third = new Uint8Array([3]);
  await cache.reset(identity(), "history-a", 0n);
  await cache.append(identity(), "history-a", [{
    startCursor: 0n,
    endCursor: BigInt(first.byteLength),
    data: first,
  }]);
  await cache.append(identity(), "history-a", [{
    startCursor: BigInt(first.byteLength),
    endCursor: BigInt(first.byteLength + second.byteLength),
    data: second,
  }]);
  await cache.append(identity(), "history-a", [{
    startCursor: BigInt(first.byteLength + second.byteLength),
    endCursor: BigInt(first.byteLength + second.byteLength + third.byteLength),
    data: third,
  }]);

  const manifest = await cache.loadManifest(identity());
  assert.deepEqual(manifest.chunks.map((chunk) => chunk.byteLength), [1024 * 1024, 1]);
});

test("cache-v2 compacts legacy small blocks after committing replacement blocks", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({
    cacheStorage,
    baseURL: "https://example.test/",
    writeBlockBytes: 1,
  });
  await cache.reset(identity(), "history-a", 0n);
  for (let cursor = 0n; cursor < 10n; cursor += 1n) {
    await cache.append(identity(), "history-a", [{
      startCursor: cursor,
      endCursor: cursor + 1n,
      data: new Uint8Array([Number(cursor) + 1]),
    }]);
  }
  await cache.savePreview(identity(), "history-a", 10n, new Blob([new Uint8Array([9])], { type: "image/png" }), {
    width: 100,
    height: 100,
    cols: 10,
    rows: 10,
    devicePixelRatio: 1,
  });
  const before = await cache.loadManifest(identity());
  assert.equal(before.chunks.length, 10);

  const compacted = await cache.compact({ ...identity(), historyGeneration: "history-a" }, {
    targetBytes: 4,
    minChunks: 2,
  });
  assert.equal(compacted.compactedFromChunks, 10);
  assert.deepEqual(compacted.chunks.map((chunk) => chunk.byteLength), [4, 4, 2]);
  assert.equal(compacted.preview.checkpointCursor, 10n);
  const replayed = [];
  await cache.readChunks(compacted, ({ data }) => replayed.push(...data));
  assert.deepEqual(replayed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const store = await cacheStorage.open("lcmd-webshell-terminal-v2");
  assert.equal([...store.entries.keys()].filter((key) => key.endsWith(".bin")).length, 3);
});

test("cache-v2 serializes manifest mutations so stale preview or touch writes cannot roll back bytes", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  await cache.reset(identity(), "history-a", 0n);

  const append = cache.append(identity(), "history-a", [
    { startCursor: 0n, endCursor: 1n, data: new Uint8Array([1]) },
  ]);
  const preview = cache.savePreview(identity(), "history-a", 0n, new Blob([new Uint8Array([9])], { type: "image/png" }), {
    width: 100,
    height: 100,
    cols: 10,
    rows: 10,
    devicePixelRatio: 1,
  });
  const touch = cache.touch(identity());
  const [, previewResult] = await Promise.allSettled([append, preview, touch]);

  assert.equal(previewResult.status, "rejected");
  const manifest = await cache.loadManifest(identity());
  assert.equal(manifest.endCursor, 1n);
  assert.equal(manifest.preview, null);
  const replayed = [];
  await cache.readChunks(manifest, ({ data }) => replayed.push(...data));
  assert.deepEqual(replayed, [1]);
});

test("cache-v2 cleanup retains protected manifests and removes expired or orphaned entries", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/webshell/" });
  const protectedIdentity = identity({ paneID: "pane-protected" });
  const expiredIdentity = identity({ paneID: "pane-expired" });
  await cache.reset(protectedIdentity, "history-protected", 0n);
  await cache.reset(expiredIdentity, "history-expired", 0n);
  const store = await cacheStorage.open("lcmd-webshell-terminal-v2");
  const orphanURL = "https://example.test/webshell/__terminal_cache__/v2/orphan.bin";
  await store.put(orphanURL, new Response(new Uint8Array([1])));

  const result = await cache.cleanup({
    now: Date.now() + 1000,
    maxAge: 1,
    protectedIdentities: [protectedIdentity],
  });

  assert.equal(await cache.loadManifest(protectedIdentity) !== null, true);
  assert.equal(await cache.loadManifest(expiredIdentity), null);
  assert.equal(await store.match(orphanURL), undefined);
  assert.equal(result.retainedManifests, 1);
  assert.ok(result.removedEntries >= 2);
});

test("cache-v2 removes only stale overview previews for panes absent from the live workspace", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  const live = identity({ paneID: "pane-live" });
  const stale = identity({ paneID: "pane-stale" });
  for (const item of [live, stale]) {
    await cache.reset(item, "history-a", 0n);
    await cache.append(item, "history-a", [{
      startCursor: 0n,
      endCursor: 1n,
      data: new Uint8Array([1]),
    }]);
    await cache.savePreview(item, "history-a", 1n, new Blob([new Uint8Array([9])], { type: "image/png" }), {
      width: 100,
      height: 50,
      cols: 10,
      rows: 5,
      devicePixelRatio: 1,
    });
  }

  const result = await cache.cleanupOrphanedPreviews({
    workspaceIdentity: identity(),
    paneIdentities: [live],
  });
  assert.equal(result.removedPreviews, 1);
  assert.ok(await cache.loadPreview(await cache.loadManifest(live)));
  assert.equal(await cache.loadPreview(await cache.loadManifest(stale)), null);
  assert.ok(await cache.readChunks(await cache.loadManifest(stale), () => {}));
});

test("cache-v2 stale pane deletion cannot remove a replacement history generation", async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cache = createTerminalCacheV2({ cacheStorage, baseURL: "https://example.test/" });
  await cache.reset(identity(), "history-old", 0n);
  await cache.reset(identity(), "history-new", 0n);

  assert.equal(await cache.deletePane({ ...identity(), historyGeneration: "history-old" }), false);
  const manifest = await cache.loadManifest(identity());
  assert.equal(manifest.historyGeneration, "history-new");
});
