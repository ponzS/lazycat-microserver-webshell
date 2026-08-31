const noop = () => {};

export function createTerminalMouseLifecycle() {
  const sessionCleanups = new Map();
  let started = false;
  let disposed = false;

  const addSessionCleanup = (session, cleanup) => {
    if (!session || typeof cleanup !== "function") {
      return noop;
    }
    if (disposed) {
      cleanup();
      return noop;
    }
    const cleanups = sessionCleanups.get(session) || new Set();
    cleanups.add(cleanup);
    sessionCleanups.set(session, cleanups);
    return () => cleanups.delete(cleanup);
  };

  return Object.freeze({
    addSessionCleanup,

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const session of [...sessionCleanups.keys()]) {
        this.disposeSession(session);
      }
    },

    disposeSession(session) {
      const cleanups = sessionCleanups.get(session);
      if (!cleanups) {
        return;
      }
      sessionCleanups.delete(session);
      for (const cleanup of [...cleanups]) {
        try {
          cleanup();
        } catch (error) {
        }
      }
    },

    listenSession(session, target, type, listener, options) {
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
      addSessionCleanup(session, cleanup);
      return cleanup;
    },

    start() {
      if (started || disposed) {
        return;
      }
      started = true;
    },
  });
}
