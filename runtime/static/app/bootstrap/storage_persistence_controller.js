export function createBrowserStoragePersistenceController({
  navigatorObject = globalThis.navigator,
  consoleObject = globalThis.console,
} = {}) {
  let requested = false;
  let disposed = false;

  const request = async () => {
    if (disposed || requested || !navigatorObject?.storage) {
      return false;
    }
    requested = true;
    let persisted = false;
    try {
      persisted = typeof navigatorObject.storage.persisted === "function"
        ? await navigatorObject.storage.persisted()
        : false;
      if (!persisted && typeof navigatorObject.storage.persist === "function") {
        persisted = await navigatorObject.storage.persist();
      }
      const estimate = typeof navigatorObject.storage.estimate === "function"
        ? await navigatorObject.storage.estimate()
        : null;
      consoleObject?.info?.("[terminal-cache-v2] browser storage", {
        persisted,
        usage: Number(estimate?.usage || 0),
        quota: Number(estimate?.quota || 0),
      });
    } catch (error) {
      consoleObject?.warn?.("[terminal-cache-v2] persistent storage request failed", {
        error: error?.message || String(error),
      });
    }
    return persisted;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    return true;
  };

  return Object.freeze({
    dispose,
    isRequested: () => requested,
    request,
  });
}
