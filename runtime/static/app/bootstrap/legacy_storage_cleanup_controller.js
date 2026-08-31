const legacyAppShellCachePrefix = "lcmd-webshell-app-shell-";
const legacyTerminalCacheName = "lcmd-webshell-terminal-v2";

const workerScriptURL = (registration) => (
  registration?.active?.scriptURL
  || registration?.waiting?.scriptURL
  || registration?.installing?.scriptURL
  || ""
);

export function createLegacyWebShellStorageCleanupController({
  windowObject = globalThis.window,
  navigatorObject = globalThis.navigator,
  cacheStorage = globalThis.caches,
  consoleObject = globalThis.console,
} = {}) {
  let disposed = false;
  let cleanupPromise = null;

  const cleanup = () => {
    if (disposed) {
      return Promise.resolve(false);
    }
    if (cleanupPromise) {
      return cleanupPromise;
    }
    const expectedScriptURL = new URL("./service-worker.js", windowObject?.location?.href || "http://localhost/");
    expectedScriptURL.search = "";
    expectedScriptURL.hash = "";
    const unregister = Promise.resolve(navigatorObject?.serviceWorker?.getRegistrations?.() || [])
      .then((registrations) => Promise.allSettled(
        registrations
          .filter((registration) => {
            const script = workerScriptURL(registration);
            if (!script) {
              return false;
            }
            const url = new URL(script, expectedScriptURL);
            url.search = "";
            url.hash = "";
            return url.href === expectedScriptURL.href;
          })
          .map((registration) => registration.unregister()),
      ));
    const removeCaches = Promise.resolve(cacheStorage?.keys?.() || [])
      .then((names) => Promise.allSettled(
        names
          .filter((name) => name === legacyTerminalCacheName || name.startsWith(legacyAppShellCachePrefix))
          .map((name) => cacheStorage.delete(name)),
      ));
    cleanupPromise = Promise.allSettled([unregister, removeCaches])
      .then(() => true)
      .catch((error) => {
        consoleObject?.warn?.("[webshell-bootstrap] legacy PWA cleanup failed", {
          error: error?.message || String(error),
        });
        return false;
      });
    return cleanupPromise;
  };

  return Object.freeze({
    cleanup,
    dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      return true;
    },
  });
}
