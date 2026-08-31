const noop = () => {};

/**
 * Owns the small set of DOM listeners that connect a pane shell to the
 * application commands.  Feature controllers own their own listeners; this
 * lifecycle only handles the listeners whose sole purpose is to activate a
 * session or forward native paste.
 */
export function createTerminalSessionInstallationLifecycle({
  documentObject = globalThis.document,
} = {}) {
  const cleanups = new WeakMap();
  const installedSessions = new Set();
  const disposedSessions = new WeakSet();
  let disposed = false;

  const listen = (session, target, type, listener, options) => {
    if (
      disposed
      || disposedSessions.has(session)
      || !target?.addEventListener
      || typeof listener !== "function"
    ) {
      return noop;
    }
    const guardedListener = (...args) => {
      if (disposed || disposedSessions.has(session) || session?.closed) {
        return;
      }
      listener(...args);
    };
    target.addEventListener(type, guardedListener, options);
    return () => target.removeEventListener?.(type, guardedListener, options);
  };

  const install = (session, {
    shellEl = session?.shellEl,
    terminalHost = session?.terminalHost,
    onPointerDown,
    onFocusIn,
    onPaste,
  } = {}) => {
    if (!session || disposed || disposedSessions.has(session)) {
      return noop;
    }
    const sessionCleanups = [];
    sessionCleanups.push(listen(session, shellEl, "pointerdown", onPointerDown));
    sessionCleanups.push(listen(session, shellEl, "focusin", onFocusIn));
    sessionCleanups.push(listen(session, terminalHost, "paste", onPaste));
    const cleanup = () => {
      if (disposedSessions.has(session)) {
        return;
      }
      disposedSessions.add(session);
      cleanups.delete(session);
      installedSessions.delete(session);
      for (const remove of sessionCleanups.splice(0)) {
        try {
          remove();
        } catch (error) {
        }
      }
    };
    cleanups.set(session, cleanup);
    installedSessions.add(session);
    return cleanup;
  };

  const disposeSession = (session) => {
    const cleanup = cleanups.get(session);
    if (cleanup) {
      cleanup();
    } else if (session) {
      disposedSessions.add(session);
      installedSessions.delete(session);
    }
  };

  return Object.freeze({
    dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      for (const session of [...installedSessions]) {
        disposeSession(session);
      }
      return true;
    },
    disposeSession,
    install,
  });
}
