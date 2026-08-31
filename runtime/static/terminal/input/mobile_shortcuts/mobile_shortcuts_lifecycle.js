/**
 * Tracks listeners and repeat timers owned by the mobile shortcut bar.
 * Re-rendering the bar resets only button resources; dispose permanently
 * invalidates all future callbacks.
 */
export function createMobileShortcutsLifecycle({
  windowObject = globalThis.window,
} = {}) {
  let disposed = false;
  const listeners = [];
  const timers = new Set();
  const intervals = new Set();

  const listen = (target, type, listener, options) => {
    if (disposed || !target?.addEventListener || typeof listener !== "function") {
      return false;
    }
    target.addEventListener(type, listener, options);
    listeners.push([target, type, listener, options]);
    return true;
  };

  const setTimeoutTracked = (callback, delay = 0) => {
    if (disposed || typeof windowObject?.setTimeout !== "function") {
      return 0;
    }
    let timerID = 0;
    timerID = windowObject.setTimeout(() => {
      timers.delete(timerID);
      if (!disposed) {
        callback();
      }
    }, delay);
    timers.add(timerID);
    return timerID;
  };

  const setIntervalTracked = (callback, delay = 0) => {
    if (disposed || typeof windowObject?.setInterval !== "function") {
      return 0;
    }
    const timerID = windowObject.setInterval(() => {
      if (!disposed) {
        callback();
      }
    }, delay);
    intervals.add(timerID);
    return timerID;
  };

  const clearTimer = (timerID) => {
    if (!timerID) {
      return;
    }
    windowObject?.clearTimeout?.(timerID);
    timers.delete(timerID);
  };

  const clearIntervalTimer = (timerID) => {
    if (!timerID) {
      return;
    }
    windowObject?.clearInterval?.(timerID);
    intervals.delete(timerID);
  };

  const resetBindings = () => {
    for (const [target, type, listener, options] of listeners.splice(0)) {
      target.removeEventListener?.(type, listener, options);
    }
    for (const timerID of timers) {
      windowObject?.clearTimeout?.(timerID);
    }
    timers.clear();
    for (const timerID of intervals) {
      windowObject?.clearInterval?.(timerID);
    }
    intervals.clear();
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    resetBindings();
    return true;
  };

  return Object.freeze({
    clearInterval: clearIntervalTimer,
    clearTimeout: clearTimer,
    dispose,
    isDisposed: () => disposed,
    listen,
    resetBindings,
    setInterval: setIntervalTracked,
    setTimeout: setTimeoutTracked,
  });
}
