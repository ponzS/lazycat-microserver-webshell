export function createAppServiceWorkerController({
  windowObject = globalThis.window,
  navigatorObject = globalThis.navigator,
  consoleObject = globalThis.console,
  scriptURL = "./service-worker.js",
  scope = "./",
} = {}) {
  let disposed = false;
  let registrationPromise = null;

  const register = () => {
    if (
      disposed
      || registrationPromise
      || !windowObject?.isSecureContext
      || !navigatorObject?.serviceWorker
    ) {
      return registrationPromise || Promise.resolve(false);
    }
    registrationPromise = Promise.resolve(
      navigatorObject.serviceWorker.register(scriptURL, { scope }),
    ).then(() => true).catch((error) => {
      consoleObject?.warn?.("[webshell-pwa] service worker registration failed", {
        error: error?.message || String(error),
      });
      return false;
    });
    return registrationPromise;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    return true;
  };

  return Object.freeze({ dispose, register });
}
