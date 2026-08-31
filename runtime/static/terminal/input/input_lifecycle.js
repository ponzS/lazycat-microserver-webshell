const noop = () => {};

export function createTerminalInputLifecycle({
  windowObject = globalThis.window,
  registerSessionCleanup = noop,
} = {}) {
  let disposed = false;
  const boundSessions = new Set();
  const dataDisposables = new WeakMap();

  const clearTimer = (session, field) => {
    if (!session?.[field]) {
      return false;
    }
    windowObject.clearTimeout(session[field]);
    session[field] = 0;
    return true;
  };

  const scheduleTimer = (session, field, callback, delay = 0) => {
    if (disposed || !session || session.closed || session[field]) {
      return false;
    }
    session[field] = windowObject.setTimeout(() => {
      session[field] = 0;
      if (!disposed && !session.closed) {
        callback();
      }
    }, delay);
    return true;
  };

  const disposeData = (session) => {
    const disposable = dataDisposables.get(session);
    dataDisposables.delete(session);
    try {
      disposable?.dispose?.();
    } catch (error) {
    }
  };

  const disposeSession = (session) => {
    if (!session) {
      return false;
    }
    boundSessions.delete(session);
    disposeData(session);
    clearTimer(session, "inputFlushTimer");
    clearTimer(session, "inputPumpTimer");
    clearTimer(session, "pendingInputExpiryTimer");
    return true;
  };

  return Object.freeze({
    bindData(session, callback) {
      if (disposed || !session?.term || typeof session.term.onData !== "function") {
        return noop;
      }
      disposeData(session);
      const disposable = session.term.onData((data) => {
        if (!disposed && !session.closed && boundSessions.has(session)) {
          callback(data);
        }
      });
      dataDisposables.set(session, disposable);
      boundSessions.add(session);
      const cleanup = () => disposeSession(session);
      registerSessionCleanup(session, cleanup);
      return cleanup;
    },

    clearFlushTimer(session) {
      return clearTimer(session, "inputFlushTimer");
    },

    clearPumpTimer(session) {
      return clearTimer(session, "inputPumpTimer");
    },

    clearPendingExpiryTimer(session) {
      return clearTimer(session, "pendingInputExpiryTimer");
    },

    scheduleFlush(session, callback, delay) {
      return scheduleTimer(session, "inputFlushTimer", callback, delay);
    },

    schedulePump(session, callback, delay) {
      return scheduleTimer(session, "inputPumpTimer", callback, delay);
    },

    schedulePendingExpiry(session, callback, delay) {
      return scheduleTimer(session, "pendingInputExpiryTimer", callback, delay);
    },

    disposeSession,

    dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      for (const session of Array.from(boundSessions)) {
        disposeSession(session);
      }
      return true;
    },
  });
}
