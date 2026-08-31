export function createTerminalCacheLifecycle({
  windowObject = globalThis.window,
} = {}) {
  let scheduled = null;
  let disposed = false;

  const cancel = () => {
    if (!scheduled) {
      return false;
    }
    const { handle, kind } = scheduled;
    scheduled = null;
    if (kind === "idle") {
      windowObject?.cancelIdleCallback?.(handle);
    } else {
      windowObject?.clearTimeout?.(handle);
    }
    return true;
  };

  const schedule = (callback, { timeout = 2000 } = {}) => {
    if (disposed || scheduled || typeof callback !== "function") {
      return false;
    }
    const run = () => {
      scheduled = null;
      if (!disposed) {
        callback();
      }
    };
    if (typeof windowObject?.requestIdleCallback === "function") {
      scheduled = {
        handle: windowObject.requestIdleCallback(run, { timeout }),
        kind: "idle",
      };
    } else {
      scheduled = {
        handle: windowObject?.setTimeout?.(run, 0),
        kind: "timeout",
      };
    }
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    cancel();
    return true;
  };

  return Object.freeze({ cancel, dispose, schedule });
}
