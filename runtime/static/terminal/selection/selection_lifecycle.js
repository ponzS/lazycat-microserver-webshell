const noop = () => {};

export function createTerminalSelectionLifecycle({
  windowObject = globalThis.window,
} = {}) {
  const globalCleanups = [];
  const sessionCleanups = new Map();
  const sessionTimeouts = new Map();
  const sessionIntervals = new Map();
  let started = false;
  let disposed = false;

  const cleanupBucket = (map, session) => {
    const bucket = map.get(session);
    if (!bucket) {
      return;
    }
    map.delete(session);
    for (const cleanup of [...bucket]) {
      try {
        cleanup();
      } catch (error) {
      }
    }
  };

  const addCleanup = (session, cleanup) => {
    if (disposed || typeof cleanup !== "function") {
      cleanup?.();
      return noop;
    }
    const target = session ? sessionCleanups : globalCleanups;
    if (session) {
      const bucket = sessionCleanups.get(session) || new Set();
      bucket.add(cleanup);
      sessionCleanups.set(session, bucket);
      return () => bucket.delete(cleanup);
    }
    target.push(cleanup);
    return () => {
      const index = globalCleanups.indexOf(cleanup);
      if (index >= 0) {
        globalCleanups.splice(index, 1);
      }
    };
  };

  const listen = (session, target, type, listener, options) => {
    if (!started || disposed || !target?.addEventListener || typeof listener !== "function") {
      return noop;
    }
    target.addEventListener(type, listener, options);
    let active = true;
    const cleanup = () => {
      if (!active) {
        return;
      }
      active = false;
      target.removeEventListener?.(type, listener, options);
    };
    addCleanup(session, cleanup);
    return cleanup;
  };

  const timerBucket = (map, session) => {
    const bucket = map.get(session) || new Set();
    map.set(session, bucket);
    return bucket;
  };

  return Object.freeze({
    addSessionCleanup(session, cleanup) {
      return addCleanup(session, cleanup);
    },

    clearSessionInterval(session, intervalID) {
      if (!intervalID) {
        return;
      }
      windowObject?.clearInterval?.(intervalID);
      sessionIntervals.get(session)?.delete(intervalID);
    },

    clearSessionTimeout(session, timeoutID) {
      if (!timeoutID) {
        return;
      }
      windowObject?.clearTimeout?.(timeoutID);
      sessionTimeouts.get(session)?.delete(timeoutID);
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const session of [...sessionCleanups.keys()]) {
        this.disposeSession(session);
      }
      for (const cleanup of globalCleanups.splice(0)) {
        try {
          cleanup();
        } catch (error) {
        }
      }
    },

    disposeSession(session) {
      cleanupBucket(sessionCleanups, session);
      for (const timeoutID of sessionTimeouts.get(session) || []) {
        windowObject?.clearTimeout?.(timeoutID);
      }
      sessionTimeouts.delete(session);
      for (const intervalID of sessionIntervals.get(session) || []) {
        windowObject?.clearInterval?.(intervalID);
      }
      sessionIntervals.delete(session);
    },

    listenGlobal(target, type, listener, options) {
      return listen(null, target, type, listener, options);
    },

    listenSession(session, target, type, listener, options) {
      return listen(session, target, type, listener, options);
    },

    setSessionInterval(session, callback, delay) {
      if (!started || disposed || typeof callback !== "function") {
        return 0;
      }
      const intervalID = windowObject?.setInterval?.(callback, delay) || 0;
      if (intervalID) {
        timerBucket(sessionIntervals, session).add(intervalID);
      }
      return intervalID;
    },

    setSessionTimeout(session, callback, delay) {
      if (!started || disposed || typeof callback !== "function") {
        return 0;
      }
      let timeoutID = 0;
      timeoutID = windowObject?.setTimeout?.(() => {
        sessionTimeouts.get(session)?.delete(timeoutID);
        callback();
      }, delay) || 0;
      if (timeoutID) {
        timerBucket(sessionTimeouts, session).add(timeoutID);
      }
      return timeoutID;
    },

    start() {
      if (started || disposed) {
        return;
      }
      started = true;
    },
  });
}
