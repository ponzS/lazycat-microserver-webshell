export function createServerRevisionLifecycle({
  windowObject = globalThis.window,
} = {}) {
  let disposed = false;
  let initialCheckScheduled = false;
  let initialCheckTimer = 0;

  return Object.freeze({
    dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      if (initialCheckTimer) {
        windowObject?.clearTimeout?.(initialCheckTimer);
        initialCheckTimer = 0;
      }
      return true;
    },
    scheduleInitialCheck(callback, delayMs = 1000) {
      if (disposed || initialCheckScheduled || typeof callback !== "function") {
        return false;
      }
      initialCheckScheduled = true;
      initialCheckTimer = windowObject?.setTimeout?.(() => {
        initialCheckTimer = 0;
        if (!disposed) {
          callback();
        }
      }, delayMs) || 0;
      return true;
    },
  });
}
