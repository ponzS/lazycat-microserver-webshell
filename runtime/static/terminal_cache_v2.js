const cacheSchemaVersion = 2;
const defaultCacheName = "lcmd-webshell-terminal-v2";
const defaultBaseURL = "https://webshell.invalid/";
const cachePathPrefix = "__terminal_cache__/v2";
const defaultMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
const defaultMaxManifests = 64;
const defaultReadConcurrency = 32;

//  https://webshell.invalid/ 是内部兜底用的虚拟 URL，不是真实服务器域名，也不会发起网络请求。

//   它用于给 Cache API 构造绝对 URL 形式的缓存键：

//   - 正常浏览器中使用当前页面的 location.href。
//   - 只有 Node 测试或没有 location 的环境才回退到 webshell.invalid。
//   - .invalid 是专门保留的无效顶级域名，保证不会解析到真实网站。
//   - 这些 URL 仅用于 cache.put()、cache.match() 和 cache.delete()，表示终端缓存记录的 key。

const cursorValue = (value) => {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw new Error("Invalid terminal cache cursor.");
  }
  return BigInt(text);
};

const cursorText = (value) => cursorValue(value).toString();

const requiredText = (value, label) => {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
};

const identityValue = (identity, camel, snake) => identity?.[camel] ?? identity?.[snake];

const normalizeIdentity = (identity, { requireHistory = false } = {}) => {
  const normalized = {
    cacheProtocolVersion: Number(identityValue(identity, "cacheProtocolVersion", "cache_protocol_version")),
    cacheScopeID: requiredText(identityValue(identity, "cacheScopeID", "cache_scope_id"), "Terminal cache scope"),
    selector: requiredText(identity?.selector, "Terminal cache selector"),
    workspaceGeneration: requiredText(identityValue(identity, "workspaceGeneration", "workspace_generation"), "Terminal workspace generation"),
    tabID: requiredText(identityValue(identity, "tabID", "tab_id"), "Terminal cache tab"),
    paneID: requiredText(identityValue(identity, "paneID", "pane_id"), "Terminal cache pane"),
    historyGeneration: String(identityValue(identity, "historyGeneration", "history_generation") || "").trim(),
  };
  if (normalized.cacheProtocolVersion !== cacheSchemaVersion) {
    throw new Error("Unsupported terminal cache protocol.");
  }
  if (requireHistory && !normalized.historyGeneration) {
    throw new Error("Terminal history generation is required.");
  }
  return normalized;
};

const identityMatches = (left, right, { requireHistory = false } = {}) => {
  const first = normalizeIdentity(left, { requireHistory });
  const second = normalizeIdentity(right, { requireHistory });
  return first.cacheProtocolVersion === second.cacheProtocolVersion
    && first.cacheScopeID === second.cacheScopeID
    && first.selector === second.selector
    && first.workspaceGeneration === second.workspaceGeneration
    && first.tabID === second.tabID
    && first.paneID === second.paneID
    && (!requireHistory || first.historyGeneration === second.historyGeneration);
};

const pathSegment = (value) => encodeURIComponent(requiredText(value, "Terminal cache key segment"));

const workspacePath = (identity) => [
  cachePathPrefix,
  pathSegment(identity.cacheScopeID),
  pathSegment(identity.selector),
  pathSegment(identity.workspaceGeneration),
  pathSegment(identity.tabID),
  pathSegment(identity.paneID),
].join("/");

const responseJSON = (value) => new Response(JSON.stringify(value), {
  headers: {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  },
});

const normalizedChunk = (chunk) => {
  const startCursor = cursorValue(chunk?.startCursor);
  const endCursor = cursorValue(chunk?.endCursor);
  const source = chunk?.data instanceof Uint8Array
    ? chunk.data
    : chunk?.data instanceof ArrayBuffer
      ? new Uint8Array(chunk.data)
      : null;
  if (!source || endCursor <= startCursor || endCursor - startCursor !== BigInt(source.byteLength)) {
    throw new Error("Invalid terminal cache chunk.");
  }
  return { startCursor, endCursor, data: new Uint8Array(source) };
};

const mergeChunks = (chunks) => {
  const normalized = (Array.isArray(chunks) ? chunks : []).map(normalizedChunk);
  if (normalized.length === 0) {
    return null;
  }
  let byteLength = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    if (index > 0 && normalized[index - 1].endCursor !== normalized[index].startCursor) {
      throw new Error("Terminal cache chunks are not continuous.");
    }
    byteLength += normalized[index].data.byteLength;
  }
  const data = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of normalized) {
    data.set(chunk.data, offset);
    offset += chunk.data.byteLength;
  }
  return {
    startCursor: normalized[0].startCursor,
    endCursor: normalized[normalized.length - 1].endCursor,
    data,
  };
};

const normalizeManifest = (source, expectedIdentity) => {
  if (!source || Number(source.schemaVersion) !== cacheSchemaVersion) {
    throw new Error("Unsupported terminal cache manifest.");
  }
  const identity = normalizeIdentity({
    cacheProtocolVersion: source.cacheProtocolVersion,
    cacheScopeID: source.cacheScopeID,
    selector: source.selector,
    workspaceGeneration: source.workspaceGeneration,
    tabID: source.tabID,
    paneID: source.paneID,
    historyGeneration: source.historyGeneration,
  }, { requireHistory: true });
  if (expectedIdentity && !identityMatches(identity, {
    ...expectedIdentity,
    historyGeneration: identity.historyGeneration,
  })) {
    throw new Error("Terminal cache manifest identity does not match.");
  }
  const baseCursor = cursorValue(source.baseCursor);
  const endCursor = cursorValue(source.endCursor);
  if (baseCursor > endCursor) {
    throw new Error("Terminal cache manifest range is invalid.");
  }
  const chunks = (Array.isArray(source.chunks) ? source.chunks : []).map((chunk) => {
    const startCursor = cursorValue(chunk?.startCursor);
    const chunkEndCursor = cursorValue(chunk?.endCursor);
    const byteLength = Number(chunk?.byteLength);
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || chunkEndCursor - startCursor !== BigInt(byteLength)) {
      throw new Error("Terminal cache manifest chunk is invalid.");
    }
    return { startCursor, endCursor: chunkEndCursor, byteLength };
  });
  let expected = baseCursor;
  for (const chunk of chunks) {
    if (chunk.startCursor !== expected) {
      throw new Error("Terminal cache manifest chunks are not continuous.");
    }
    expected = chunk.endCursor;
  }
  if (expected !== endCursor || (chunks.length === 0 && baseCursor !== endCursor)) {
    throw new Error("Terminal cache manifest end cursor is invalid.");
  }
  let preview = null;
  if (source.preview) {
    const checkpointCursor = cursorValue(source.preview.checkpointCursor);
    const width = Number(source.preview.width);
    const height = Number(source.preview.height);
    const cols = Number(source.preview.cols);
    const rows = Number(source.preview.rows);
    const devicePixelRatio = Number(source.preview.devicePixelRatio);
    if (
      checkpointCursor !== endCursor
      || !Number.isFinite(width) || width <= 0
      || !Number.isFinite(height) || height <= 0
      || !Number.isFinite(cols) || cols <= 0
      || !Number.isFinite(rows) || rows <= 0
      || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0
    ) {
      throw new Error("Terminal cache preview metadata is invalid.");
    }
    preview = {
      checkpointCursor,
      width,
      height,
      cols,
      rows,
      devicePixelRatio,
      themeFingerprint: String(source.preview.themeFingerprint || ""),
    };
  }
  return {
    schemaVersion: cacheSchemaVersion,
    ...identity,
    baseCursor,
    endCursor,
    chunks,
    preview,
    updatedAt: Number(source.updatedAt || 0),
  };
};

const serializedManifest = (manifest) => ({
  schemaVersion: cacheSchemaVersion,
  cacheProtocolVersion: cacheSchemaVersion,
  cacheScopeID: manifest.cacheScopeID,
  selector: manifest.selector,
  workspaceGeneration: manifest.workspaceGeneration,
  tabID: manifest.tabID,
  paneID: manifest.paneID,
  historyGeneration: manifest.historyGeneration,
  baseCursor: cursorText(manifest.baseCursor),
  endCursor: cursorText(manifest.endCursor),
  chunks: manifest.chunks.map((chunk) => ({
    startCursor: cursorText(chunk.startCursor),
    endCursor: cursorText(chunk.endCursor),
    byteLength: chunk.byteLength,
  })),
  preview: manifest.preview ? {
    checkpointCursor: cursorText(manifest.preview.checkpointCursor),
    width: manifest.preview.width,
    height: manifest.preview.height,
    cols: manifest.preview.cols,
    rows: manifest.preview.rows,
    devicePixelRatio: manifest.preview.devicePixelRatio,
    themeFingerprint: manifest.preview.themeFingerprint || "",
  } : null,
  updatedAt: Number(manifest.updatedAt || Date.now()),
});

export const createTerminalCacheV2 = ({
  cacheStorage = globalThis.caches,
  cacheName = defaultCacheName,
  baseURL = globalThis.location?.href || defaultBaseURL,
  maxAgeMs = defaultMaxAgeMs,
  maxManifests = defaultMaxManifests,
  readConcurrency = defaultReadConcurrency,
} = {}) => {
  const available = Boolean(cacheStorage && typeof cacheStorage.open === "function" && globalThis.Response);
  let mutationChain = Promise.resolve();
  const cache = async () => {
    if (!available) {
      throw new Error("Cache API is unavailable.");
    }
    return cacheStorage.open(cacheName);
  };
  const requestURL = (path) => new URL(path, baseURL).toString();
  const cacheRootURL = requestURL(`${cachePathPrefix}/`);
  const manifestURL = (identity) => requestURL(`${workspacePath(identity)}/manifest`);
  const chunkURL = (identity, startCursor, endCursor) => requestURL(`${workspacePath(identity)}/${pathSegment(identity.historyGeneration)}/${cursorText(startCursor)}-${cursorText(endCursor)}.bin`);
  const previewURL = (identity, cursor) => requestURL(`${workspacePath(identity)}/${pathSegment(identity.historyGeneration)}/${cursorText(cursor)}.preview`);
  const runMutation = (operation) => {
    const next = mutationChain.catch(() => {}).then(operation);
    mutationChain = next;
    return next;
  };

  const loadManifest = async (sourceIdentity) => {
    const identity = normalizeIdentity(sourceIdentity);
    const store = await cache();
    const response = await store.match(manifestURL(identity));
    if (!response) {
      return null;
    }
    return normalizeManifest(await response.json(), identity);
  };

  const putManifest = async (store, manifest) => {
    const identity = normalizeIdentity(manifest, { requireHistory: true });
    await store.put(manifestURL(identity), responseJSON(serializedManifest(manifest)));
  };

  const deleteManifestEntries = async (store, manifest, { keepManifest = false } = {}) => {
    const identity = normalizeIdentity(manifest, { requireHistory: true });
    await Promise.all(manifest.chunks.map((chunk) => store.delete(chunkURL(identity, chunk.startCursor, chunk.endCursor))));
    if (manifest.preview) {
      await store.delete(previewURL(identity, manifest.preview.checkpointCursor));
    }
    if (!keepManifest) {
      await store.delete(manifestURL(identity));
    }
  };

  const reset = (sourceIdentity, generation, cursor) => runMutation(async () => {
    const identity = normalizeIdentity({ ...sourceIdentity, historyGeneration: generation }, { requireHistory: true });
    const store = await cache();
    const previous = await loadManifest(identity).catch(() => null);
    const normalizedCursor = cursorValue(cursor);
    const manifest = {
      ...identity,
      baseCursor: normalizedCursor,
      endCursor: normalizedCursor,
      chunks: [],
      preview: null,
      updatedAt: Date.now(),
    };
    await putManifest(store, manifest);
    if (previous) {
      await deleteManifestEntries(store, previous, { keepManifest: true });
    }
    return manifest;
  });

  const append = async (sourceIdentity, generation, chunks, { limitBytes } = {}) => {
    const identity = normalizeIdentity({ ...sourceIdentity, historyGeneration: generation }, { requireHistory: true });
    const merged = mergeChunks(chunks);
    if (!merged) {
      return loadManifest(identity);
    }
    return runMutation(async () => {
      const store = await cache();
      const previous = await loadManifest(identity);
      if (!previous || previous.historyGeneration !== identity.historyGeneration || previous.endCursor !== merged.startCursor) {
        throw new Error("Terminal cache append range does not match manifest.");
      }
      const response = new Response(merged.data, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/octet-stream",
          "X-Terminal-Start-Cursor": cursorText(merged.startCursor),
          "X-Terminal-End-Cursor": cursorText(merged.endCursor),
        },
      });
      await store.put(chunkURL(identity, merged.startCursor, merged.endCursor), response);
      const nextChunks = [...previous.chunks, {
        startCursor: merged.startCursor,
        endCursor: merged.endCursor,
        byteLength: merged.data.byteLength,
      }];
      const removed = [];
      const normalizedLimit = Math.max(1, Math.floor(Number(limitBytes) || Number.MAX_SAFE_INTEGER));
      let retainedBytes = nextChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      while (nextChunks.length > 1 && retainedBytes > normalizedLimit) {
        const chunk = nextChunks.shift();
        removed.push(chunk);
        retainedBytes -= chunk.byteLength;
      }
      const previousPreview = previous.preview;
      const manifest = {
        ...identity,
        baseCursor: nextChunks.length > 0 ? nextChunks[0].startCursor : merged.endCursor,
        endCursor: merged.endCursor,
        chunks: nextChunks,
        preview: null,
        updatedAt: Date.now(),
      };
      await putManifest(store, manifest);
      await Promise.all(removed.map((chunk) => store.delete(chunkURL(identity, chunk.startCursor, chunk.endCursor))));
      if (previousPreview) {
        await store.delete(previewURL(identity, previousPreview.checkpointCursor));
      }
      return manifest;
    });
  };

  const readChunks = async (manifest, onChunk) => {
    const normalized = normalizeManifest(serializedManifest(manifest), manifest);
    const identity = normalizeIdentity(normalized, { requireHistory: true });
    const store = await cache();
    const concurrency = Math.max(1, Math.floor(Number(readConcurrency) || defaultReadConcurrency));
    let cursor = normalized.baseCursor;
    for (let offset = 0; offset < normalized.chunks.length; offset += concurrency) {
      const batch = normalized.chunks.slice(offset, offset + concurrency);
      const loaded = await Promise.all(batch.map(async (chunk) => {
        const response = await store.match(chunkURL(identity, chunk.startCursor, chunk.endCursor));
        if (!response) {
          throw new Error("Terminal cache chunk is missing.");
        }
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength !== chunk.byteLength || chunk.endCursor - chunk.startCursor !== BigInt(data.byteLength)) {
          throw new Error("Terminal cache chunk data is invalid.");
        }
        return { chunk, data };
      }));
      for (let batchIndex = 0; batchIndex < loaded.length; batchIndex += 1) {
        const { chunk, data } = loaded[batchIndex];
        if (chunk.startCursor !== cursor) {
          throw new Error("Terminal cache chunk data is invalid.");
        }
        await onChunk?.({
          startCursor: chunk.startCursor,
          endCursor: chunk.endCursor,
          data,
          chunkIndex: offset + batchIndex,
          chunkCount: normalized.chunks.length,
          batchEnd: batchIndex === loaded.length - 1,
        });
        cursor = chunk.endCursor;
      }
    }
    if (cursor !== normalized.endCursor) {
      throw new Error("Terminal cache replay did not reach the manifest cursor.");
    }
    return cursor;
  };

  const savePreview = async (sourceIdentity, generation, cursor, blob, metadata = {}) => {
    if (!(blob instanceof Blob) || blob.size <= 0) {
      throw new Error("Terminal cache preview Blob is invalid.");
    }
    const identity = normalizeIdentity({ ...sourceIdentity, historyGeneration: generation }, { requireHistory: true });
    const checkpointCursor = cursorValue(cursor);
    return runMutation(async () => {
      const store = await cache();
      const previous = await loadManifest(identity);
      if (!previous || previous.historyGeneration !== identity.historyGeneration || previous.endCursor !== checkpointCursor) {
        throw new Error("Terminal cache preview cursor does not match manifest.");
      }
      const preview = {
        checkpointCursor,
        width: Number(metadata.width),
        height: Number(metadata.height),
        cols: Number(metadata.cols),
        rows: Number(metadata.rows),
        devicePixelRatio: Number(metadata.devicePixelRatio),
        themeFingerprint: String(metadata.themeFingerprint || ""),
      };
      normalizeManifest(serializedManifest({ ...previous, preview }), identity);
      await store.put(previewURL(identity, checkpointCursor), new Response(blob, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": blob.type || "image/png",
        },
      }));
      await putManifest(store, { ...previous, preview, updatedAt: Date.now() });
      if (previous.preview && previous.preview.checkpointCursor !== checkpointCursor) {
        await store.delete(previewURL(identity, previous.preview.checkpointCursor));
      }
      return preview;
    });
  };

  const loadPreview = async (manifest) => {
    const normalized = normalizeManifest(serializedManifest(manifest), manifest);
    if (!normalized.preview || normalized.preview.checkpointCursor !== normalized.endCursor) {
      return null;
    }
    const identity = normalizeIdentity(normalized, { requireHistory: true });
    const store = await cache();
    const response = await store.match(previewURL(identity, normalized.preview.checkpointCursor));
    if (!response) {
      return null;
    }
    const blob = await response.blob();
    if (blob.size <= 0 || !String(blob.type || "").startsWith("image/")) {
      throw new Error("Terminal cache preview response is invalid.");
    }
    return { blob, metadata: normalized.preview };
  };

  const deletePane = (sourceIdentity) => runMutation(async () => {
    const identity = normalizeIdentity(sourceIdentity);
    const store = await cache();
    const manifest = await loadManifest(identity).catch(() => null);
    if (manifest) {
      if (identity.historyGeneration && manifest.historyGeneration !== identity.historyGeneration) {
        return false;
      }
      await deleteManifestEntries(store, manifest);
      return true;
    }
    return store.delete(manifestURL(identity));
  });

  const touch = (sourceIdentity) => runMutation(async () => {
    const manifest = await loadManifest(sourceIdentity);
    if (!manifest) {
      return null;
    }
    const store = await cache();
    manifest.updatedAt = Date.now();
    await putManifest(store, manifest);
    return manifest;
  });

  const cleanup = ({
    now = Date.now(),
    protectedIdentities = [],
    maxAge = maxAgeMs,
    manifestLimit = maxManifests,
  } = {}) => runMutation(async () => {
    const store = await cache();
    if (typeof store.keys !== "function") {
      return { removedEntries: 0, retainedManifests: 0 };
    }
    const keys = await store.keys();
    const entryURLs = keys
      .map((request) => String(request?.url || request || ""))
      .filter((url) => url.startsWith(cacheRootURL));
    const manifests = [];
    for (const url of entryURLs.filter((entryURL) => entryURL.endsWith("/manifest"))) {
      try {
        const response = await store.match(url);
        if (!response) {
          continue;
        }
        manifests.push({ url, manifest: normalizeManifest(await response.json()) });
      } catch (error) {
      }
    }
    const protectedURLs = new Set();
    for (const sourceIdentity of Array.isArray(protectedIdentities) ? protectedIdentities : []) {
      try {
        protectedURLs.add(manifestURL(normalizeIdentity(sourceIdentity)));
      } catch (error) {
      }
    }
    manifests.sort((left, right) => right.manifest.updatedAt - left.manifest.updatedAt);
    const retained = [];
    let retainedUnprotected = 0;
    const safeMaxAge = Math.max(0, Number(maxAge) || 0);
    const safeManifestLimit = Math.max(1, Math.floor(Number(manifestLimit) || defaultMaxManifests));
    for (const entry of manifests) {
      const protectedEntry = protectedURLs.has(entry.url);
      const expired = safeMaxAge > 0 && now - entry.manifest.updatedAt > safeMaxAge;
      if (!protectedEntry && (expired || retainedUnprotected >= safeManifestLimit)) {
        continue;
      }
      retained.push(entry.manifest);
      if (!protectedEntry) {
        retainedUnprotected += 1;
      }
    }
    const referencedURLs = new Set();
    for (const manifest of retained) {
      const identity = normalizeIdentity(manifest, { requireHistory: true });
      referencedURLs.add(manifestURL(identity));
      for (const chunk of manifest.chunks) {
        referencedURLs.add(chunkURL(identity, chunk.startCursor, chunk.endCursor));
      }
      if (manifest.preview) {
        referencedURLs.add(previewURL(identity, manifest.preview.checkpointCursor));
      }
    }
    let removedEntries = 0;
    for (const url of entryURLs) {
      if (!referencedURLs.has(url) && await store.delete(url)) {
        removedEntries += 1;
      }
    }
    return { removedEntries, retainedManifests: retained.length };
  });

  return {
    available,
    append,
    cleanup,
    deletePane,
    identityMatches,
    loadManifest,
    loadPreview,
    readChunks,
    reset,
    savePreview,
    touch,
  };
};

export { cacheSchemaVersion as terminalCacheSchemaVersion };
