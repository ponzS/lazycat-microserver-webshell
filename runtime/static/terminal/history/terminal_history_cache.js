const defaultDatabaseName = "lcmd-webshell-terminal-history";
const defaultMaxBytes = 35 * 1024 * 1024;
const defaultOrphanTTL = 30 * 1000;

const requestResult = (request) => new Promise((resolve, reject) => {
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error || new Error("IndexedDB request failed.")), { once: true });
});

const transactionComplete = (transaction) => new Promise((resolve, reject) => {
  transaction.addEventListener("complete", () => resolve(), { once: true });
  transaction.addEventListener("abort", () => reject(transaction.error || new Error("IndexedDB transaction aborted.")), { once: true });
  transaction.addEventListener("error", () => reject(transaction.error || new Error("IndexedDB transaction failed.")), { once: true });
});

const cursorValue = (value) => {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw new Error("Invalid terminal history cursor.");
  }
  return BigInt(text);
};

const cursorText = (value) => cursorValue(value).toString();

const scopeKeyFor = (selector, paneId) => JSON.stringify([
  String(selector || "").trim(),
  String(paneId || "").trim(),
]);

const chunkIDFor = (scopeKey, startCursor) => `${scopeKey}:${cursorText(startCursor)}`;

const normalizeChunk = (chunk) => {
  const startCursor = cursorValue(chunk?.startCursor);
  const endCursor = cursorValue(chunk?.endCursor);
  const source = chunk?.data instanceof Uint8Array
    ? chunk.data
    : chunk?.data instanceof ArrayBuffer
      ? new Uint8Array(chunk.data)
      : null;
  if (!source || endCursor < startCursor || endCursor - startCursor !== BigInt(source.byteLength)) {
    throw new Error("Invalid terminal history chunk.");
  }
  return {
    startCursor,
    endCursor,
    data: new Uint8Array(source),
  };
};

const normalizeChunks = (chunks) => {
  const output = (Array.isArray(chunks) ? chunks : []).map(normalizeChunk);
  for (let index = 1; index < output.length; index += 1) {
    if (output[index - 1].endCursor !== output[index].startCursor) {
      throw new Error("Terminal history chunks are not continuous.");
    }
  }
  return output;
};

const openDatabase = (name) => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) {
    reject(new Error("IndexedDB is unavailable."));
    return;
  }
  const request = globalThis.indexedDB.open(name, 1);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("streams")) {
      database.createObjectStore("streams", { keyPath: "scopeKey" });
    }
    if (!database.objectStoreNames.contains("chunks")) {
      const store = database.createObjectStore("chunks", { keyPath: "id" });
      store.createIndex("scopeKey", "scopeKey", { unique: false });
    }
  });
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error || new Error("Failed to open terminal history cache.")), { once: true });
  request.addEventListener("blocked", () => reject(new Error("Terminal history cache upgrade is blocked.")), { once: true });
});

export const createTerminalHistoryCache = ({
  databaseName = defaultDatabaseName,
  maxBytes = defaultMaxBytes,
  orphanTTL = defaultOrphanTTL,
} = {}) => {
  let databasePromise = null;
  const database = () => {
    databasePromise ||= openDatabase(databaseName);
    return databasePromise;
  };

  const deleteScopeInTransaction = async (chunkStore, scopeKey) => {
    const index = chunkStore.index("scopeKey");
    const keys = await requestResult(index.getAllKeys(IDBKeyRange.only(scopeKey)));
    for (const key of keys) {
      chunkStore.delete(key);
    }
  };

  const deletePane = async (selector, paneId) => {
    const db = await database();
    const scopeKey = scopeKeyFor(selector, paneId);
    const transaction = db.transaction(["streams", "chunks"], "readwrite");
    transaction.objectStore("streams").delete(scopeKey);
    await deleteScopeInTransaction(transaction.objectStore("chunks"), scopeKey);
    await transactionComplete(transaction);
  };

  const load = async (selector, paneId) => {
    const db = await database();
    const scopeKey = scopeKeyFor(selector, paneId);
    const transaction = db.transaction(["streams", "chunks"], "readonly");
    const stream = await requestResult(transaction.objectStore("streams").get(scopeKey));
    if (!stream) {
      await transactionComplete(transaction);
      return null;
    }
    const rows = await requestResult(transaction.objectStore("chunks").index("scopeKey").getAll(IDBKeyRange.only(scopeKey)));
    await transactionComplete(transaction);
    if (Date.now() - Number(stream.updatedAt || 0) > orphanTTL) {
      await deletePane(selector, paneId);
      return null;
    }
    const baseCursor = cursorValue(stream.baseCursor);
    const endCursor = cursorValue(stream.endCursor);
    const chunks = rows.map((row) => normalizeChunk({
      startCursor: row.startCursor,
      endCursor: row.endCursor,
      data: row.data,
    })).sort((left, right) => left.startCursor < right.startCursor ? -1 : left.startCursor > right.startCursor ? 1 : 0);
    let expected = baseCursor;
    let byteLength = 0;
    for (const chunk of chunks) {
      if (chunk.startCursor !== expected) {
        throw new Error("Cached terminal history is not continuous.");
      }
      expected = chunk.endCursor;
      byteLength += chunk.data.byteLength;
    }
    if (expected !== endCursor || baseCursor > endCursor || byteLength !== Number(stream.byteLength || 0) || (!stream.generation && baseCursor !== endCursor)) {
      throw new Error("Cached terminal history range is invalid.");
    }
    return {
      selector: String(stream.selector || ""),
      paneId: String(stream.paneId || ""),
      generation: String(stream.generation || ""),
      baseCursor,
      endCursor,
      updatedAt: Number(stream.updatedAt || 0),
      byteLength,
      chunks,
    };
  };

  const append = async (selector, paneId, generation, chunks, { limitBytes = maxBytes } = {}) => {
    const normalizedGeneration = String(generation || "").trim();
    const normalizedChunks = normalizeChunks(chunks);
    if (!normalizedGeneration || normalizedChunks.length === 0) {
      return null;
    }
    const db = await database();
    const scopeKey = scopeKeyFor(selector, paneId);
    const transaction = db.transaction(["streams", "chunks"], "readwrite");
    const streamStore = transaction.objectStore("streams");
    const chunkStore = transaction.objectStore("chunks");
    let stream = await requestResult(streamStore.get(scopeKey));
    const first = normalizedChunks[0];
    if (stream && (stream.generation !== normalizedGeneration || cursorValue(stream.endCursor) !== first.startCursor)) {
      transaction.abort();
      throw new Error("Terminal history append range does not match cached stream.");
    }
    if (!stream) {
      stream = {
        scopeKey,
        selector: String(selector || "").trim(),
        paneId: String(paneId || "").trim(),
        generation: normalizedGeneration,
        baseCursor: first.startCursor.toString(),
        endCursor: first.startCursor.toString(),
        byteLength: 0,
        updatedAt: Date.now(),
      };
    }
    stream.byteLength = Number(stream.byteLength || 0);
    for (const chunk of normalizedChunks) {
      chunkStore.put({
        id: chunkIDFor(scopeKey, chunk.startCursor),
        scopeKey,
        startCursor: chunk.startCursor.toString(),
        endCursor: chunk.endCursor.toString(),
        data: chunk.data.buffer.slice(chunk.data.byteOffset, chunk.data.byteOffset + chunk.data.byteLength),
      });
      stream.endCursor = chunk.endCursor.toString();
      stream.byteLength += chunk.data.byteLength;
    }
    const normalizedLimitBytes = Math.max(1, Math.floor(Number(limitBytes) || maxBytes));
    let baseCursor = cursorValue(stream.baseCursor);
    let retainedBytes = stream.byteLength;
    const endCursor = cursorValue(stream.endCursor);
    while (retainedBytes > normalizedLimitBytes && baseCursor < endCursor) {
      const oldestID = chunkIDFor(scopeKey, baseCursor);
      const oldest = await requestResult(chunkStore.get(oldestID));
      if (!oldest) {
        transaction.abort();
        throw new Error("Terminal history cache base chunk is missing.");
      }
      const oldestEnd = cursorValue(oldest.endCursor);
      if (oldestEnd >= endCursor) {
        break;
      }
      chunkStore.delete(oldestID);
      retainedBytes -= oldest.data?.byteLength || 0;
      baseCursor = oldestEnd;
    }
    stream.baseCursor = baseCursor.toString();
    stream.byteLength = retainedBytes;
    stream.updatedAt = Date.now();
    streamStore.put(stream);
    await transactionComplete(transaction);
    return {
      generation: stream.generation,
      baseCursor: cursorValue(stream.baseCursor),
      endCursor: cursorValue(stream.endCursor),
      byteLength: stream.byteLength,
      updatedAt: stream.updatedAt,
    };
  };

  const reset = async (selector, paneId, generation, cursor) => {
    const normalizedGeneration = String(generation || "").trim();
    const normalizedCursor = cursorText(cursor);
    if (!normalizedGeneration) {
      throw new Error("Terminal history generation is required.");
    }
    const db = await database();
    const scopeKey = scopeKeyFor(selector, paneId);
    const transaction = db.transaction(["streams", "chunks"], "readwrite");
    await deleteScopeInTransaction(transaction.objectStore("chunks"), scopeKey);
    transaction.objectStore("streams").put({
      scopeKey,
      selector: String(selector || "").trim(),
      paneId: String(paneId || "").trim(),
      generation: normalizedGeneration,
      baseCursor: normalizedCursor,
      endCursor: normalizedCursor,
      byteLength: 0,
      updatedAt: Date.now(),
    });
    await transactionComplete(transaction);
    return {
      generation: normalizedGeneration,
      baseCursor: cursorValue(normalizedCursor),
      endCursor: cursorValue(normalizedCursor),
      byteLength: 0,
    };
  };

  const touch = async (selector, paneId) => {
    const db = await database();
    const scopeKey = scopeKeyFor(selector, paneId);
    const transaction = db.transaction("streams", "readwrite");
    const store = transaction.objectStore("streams");
    const stream = await requestResult(store.get(scopeKey));
    if (stream) {
      stream.updatedAt = Date.now();
      store.put(stream);
    }
    await transactionComplete(transaction);
  };

  const cleanupExpired = async ({ now = Date.now() } = {}) => {
    const db = await database();
    const transaction = db.transaction("streams", "readonly");
    const streams = await requestResult(transaction.objectStore("streams").getAll());
    await transactionComplete(transaction);
    const expired = streams.filter((stream) => now - Number(stream.updatedAt || 0) > orphanTTL);
    await Promise.all(expired.map((stream) => deletePane(stream.selector, stream.paneId)));
    return expired.length;
  };

  return {
    append,
    cleanupExpired,
    deletePane,
    load,
    reset,
    touch,
  };
};
