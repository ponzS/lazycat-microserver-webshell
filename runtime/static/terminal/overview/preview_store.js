const defaultDatabaseName = "lcmd-webshell-overview-previews-v1";
const defaultMaxEntries = 64;
const defaultMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

const requestResult = (request) => new Promise((resolve, reject) => {
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error || new Error("IndexedDB request failed.")), { once: true });
});

const transactionComplete = (transaction) => new Promise((resolve, reject) => {
  transaction.addEventListener("complete", () => resolve(), { once: true });
  transaction.addEventListener("abort", () => reject(transaction.error || new Error("IndexedDB transaction aborted.")), { once: true });
  transaction.addEventListener("error", () => reject(transaction.error || new Error("IndexedDB transaction failed.")), { once: true });
});

const normalizePart = (value) => String(value || "").trim();

export const terminalOverviewPreviewIdentity = (source = {}) => {
  const identity = Object.freeze({
    selector: normalizePart(source.selector ?? source.name),
    workspaceGeneration: normalizePart(source.workspaceGeneration),
    tabID: normalizePart(source.tabID ?? source.tabId),
    paneID: normalizePart(source.paneID ?? source.paneId ?? source.id),
  });
  return identity.selector && identity.tabID && identity.paneID ? identity : null;
};

export const terminalOverviewPreviewKey = (source) => {
  const identity = terminalOverviewPreviewIdentity(source);
  return identity ? JSON.stringify([
    1,
    identity.selector,
    identity.workspaceGeneration,
    identity.tabID,
    identity.paneID,
  ]) : "";
};

const openDatabase = ({ indexedDBObject, databaseName }) => new Promise((resolve, reject) => {
  if (!indexedDBObject || typeof indexedDBObject.open !== "function") {
    resolve(null);
    return;
  }
  const request = indexedDBObject.open(databaseName, 1);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("previews")) {
      database.createObjectStore("previews", { keyPath: "key" });
    }
  });
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error || new Error("Failed to open terminal overview preview storage.")), { once: true });
  request.addEventListener("blocked", () => reject(new Error("Terminal overview preview storage upgrade is blocked.")), { once: true });
});

const imageBlobIsValid = (blob) => Boolean(
  blob
  && Number(blob.size || 0) > 0
  && String(blob.type || "").toLowerCase().startsWith("image/")
);

export function createTerminalOverviewPreviewStore({
  indexedDBObject = globalThis.indexedDB,
  databaseName = defaultDatabaseName,
  maxEntries = defaultMaxEntries,
  maxAgeMs = defaultMaxAgeMs,
  now = () => Date.now(),
} = {}) {
  let disposed = false;
  let databasePromise = null;

  const database = () => {
    if (disposed) {
      return Promise.resolve(null);
    }
    databasePromise ||= openDatabase({ indexedDBObject, databaseName });
    return databasePromise;
  };

  const deleteKey = async (key) => {
    const db = await database();
    if (!db || !key || disposed) {
      return false;
    }
    const transaction = db.transaction("previews", "readwrite");
    const complete = transactionComplete(transaction);
    transaction.objectStore("previews").delete(key);
    await complete;
    return true;
  };

  const cleanup = async () => {
    const db = await database();
    if (!db || disposed) {
      return 0;
    }
    const transaction = db.transaction("previews", "readonly");
    const [records] = await Promise.all([
      requestResult(transaction.objectStore("previews").getAll()),
      transactionComplete(transaction),
    ]);
    const cutoff = now() - Math.max(0, Number(maxAgeMs) || defaultMaxAgeMs);
    const ordered = Array.from(records || []).sort((left, right) => (
      Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0)
    ));
    const remove = ordered.filter((record, index) => (
      Number(record?.updatedAt || 0) < cutoff
      || index >= Math.max(1, Math.floor(Number(maxEntries) || defaultMaxEntries))
    ));
    await Promise.all(remove.map((record) => deleteKey(String(record?.key || ""))));
    return remove.length;
  };

  const load = async (source) => {
    const identity = terminalOverviewPreviewIdentity(source);
    const key = terminalOverviewPreviewKey(identity);
    const db = await database();
    if (!db || !identity || !key || disposed) {
      return null;
    }
    const transaction = db.transaction("previews", "readonly");
    const [record] = await Promise.all([
      requestResult(transaction.objectStore("previews").get(key)),
      transactionComplete(transaction),
    ]);
    if (!record) {
      return null;
    }
    const expired = now() - Number(record.updatedAt || 0) > Math.max(0, Number(maxAgeMs) || defaultMaxAgeMs);
    if (
      expired
      || terminalOverviewPreviewKey(record) !== key
      || !imageBlobIsValid(record.blob)
      || Number(record.width || 0) <= 0
      || Number(record.height || 0) <= 0
    ) {
      await deleteKey(key);
      return null;
    }
    return record;
  };

  const save = async (source, blob, metadata = {}) => {
    const identity = terminalOverviewPreviewIdentity(source);
    const key = terminalOverviewPreviewKey(identity);
    const width = Math.max(0, Math.floor(Number(metadata.width) || 0));
    const height = Math.max(0, Math.floor(Number(metadata.height) || 0));
    const db = await database();
    if (!db || !identity || !key || !imageBlobIsValid(blob) || width <= 0 || height <= 0 || disposed) {
      return null;
    }
    const record = {
      key,
      ...identity,
      historyGeneration: normalizePart(metadata.historyGeneration),
      width,
      height,
      sourceWidth: Math.max(0, Math.floor(Number(metadata.sourceWidth) || 0)),
      sourceHeight: Math.max(0, Math.floor(Number(metadata.sourceHeight) || 0)),
      renderGeneration: Math.max(0, Math.floor(Number(metadata.renderGeneration) || 0)),
      blob,
      updatedAt: now(),
    };
    const transaction = db.transaction("previews", "readwrite");
    const complete = transactionComplete(transaction);
    transaction.objectStore("previews").put(record);
    await complete;
    await cleanup();
    return record;
  };

  return Object.freeze({
    cleanup,
    delete: (source) => deleteKey(terminalOverviewPreviewKey(source)),
    dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      databasePromise?.then((db) => db?.close?.()).catch(() => {});
      return true;
    },
    load,
    save,
  });
}
