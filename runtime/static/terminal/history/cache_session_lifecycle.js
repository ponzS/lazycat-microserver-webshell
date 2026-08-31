export function createTerminalCacheSessionLifecycle({
  windowObject = globalThis.window,
} = {}) {
  const sessions = new Set();
  let disposed = false;

  const track = (session) => {
    if (session) {
      sessions.add(session);
    }
  };

  const clearWriteSchedule = (session) => {
    if (!session) {
      return false;
    }
    let cleared = false;
    if (session.historyCacheWriteFrame) {
      windowObject?.cancelAnimationFrame?.(session.historyCacheWriteFrame);
      session.historyCacheWriteFrame = 0;
      cleared = true;
    }
    if (session.historyCacheWriteTimer) {
      windowObject?.clearTimeout?.(session.historyCacheWriteTimer);
      session.historyCacheWriteTimer = 0;
      cleared = true;
    }
    return cleared;
  };

  const cancelPreviewCapture = (session) => {
    if (!session) {
      return false;
    }
    let cleared = false;
    if (session.cacheV2PreviewCaptureTimer) {
      windowObject?.clearTimeout?.(session.cacheV2PreviewCaptureTimer);
      session.cacheV2PreviewCaptureTimer = 0;
      cleared = true;
    }
    if (session.cacheV2PreviewCaptureIdle) {
      if (session.cacheV2PreviewCaptureIdleKind === "idle") {
        windowObject?.cancelIdleCallback?.(session.cacheV2PreviewCaptureIdle);
      } else {
        windowObject?.clearTimeout?.(session.cacheV2PreviewCaptureIdle);
      }
      session.cacheV2PreviewCaptureIdle = 0;
      session.cacheV2PreviewCaptureIdleKind = "";
      cleared = true;
    }
    return cleared;
  };

  const cancelCompaction = (session) => {
    if (!session?.cacheV2CompactionHandle) {
      return false;
    }
    if (session.cacheV2CompactionKind === "idle") {
      windowObject?.cancelIdleCallback?.(session.cacheV2CompactionHandle);
    } else {
      windowObject?.clearTimeout?.(session.cacheV2CompactionHandle);
    }
    session.cacheV2CompactionHandle = 0;
    session.cacheV2CompactionKind = "";
    session.cacheV2CompactionScheduled = false;
    return true;
  };

  const scheduleWrite = (session, callback, {
    useTimeoutOnly = false,
    timeoutMs = 0,
  } = {}) => {
    if (disposed || !session || typeof callback !== "function") {
      return false;
    }
    track(session);
    if (!useTimeoutOnly) {
      session.historyCacheWriteFrame = windowObject?.requestAnimationFrame?.(callback) || 0;
    }
    session.historyCacheWriteTimer = windowObject?.setTimeout?.(callback, timeoutMs) || 0;
    return true;
  };

  const schedulePreviewCapture = (session, callback, {
    delayMs = 0,
    idle = false,
    idleTimeoutMs = 1500,
  } = {}) => {
    if (disposed || !session || typeof callback !== "function") {
      return false;
    }
    track(session);
    session.cacheV2PreviewCaptureTimer = windowObject?.setTimeout?.(() => {
      session.cacheV2PreviewCaptureTimer = 0;
      if (disposed || session.closed) {
        return;
      }
      if (idle && typeof windowObject?.requestIdleCallback === "function") {
        session.cacheV2PreviewCaptureIdleKind = "idle";
        session.cacheV2PreviewCaptureIdle = windowObject.requestIdleCallback(callback, { timeout: idleTimeoutMs });
      } else {
        session.cacheV2PreviewCaptureIdleKind = "timeout";
        session.cacheV2PreviewCaptureIdle = windowObject?.setTimeout?.(callback, 0) || 0;
      }
    }, delayMs) || 0;
    return true;
  };

  const scheduleCompaction = (session, callback, {
    idleTimeoutMs = 5000,
    fallbackDelayMs = 2000,
  } = {}) => {
    if (disposed || !session || typeof callback !== "function") {
      return false;
    }
    track(session);
    if (typeof windowObject?.requestIdleCallback === "function") {
      session.cacheV2CompactionKind = "idle";
      session.cacheV2CompactionHandle = windowObject.requestIdleCallback(callback, { timeout: idleTimeoutMs });
    } else {
      session.cacheV2CompactionKind = "timeout";
      session.cacheV2CompactionHandle = windowObject?.setTimeout?.(callback, fallbackDelayMs) || 0;
    }
    return true;
  };

  const disposeSession = (session) => {
    if (!session) {
      return false;
    }
    clearWriteSchedule(session);
    cancelPreviewCapture(session);
    cancelCompaction(session);
    sessions.delete(session);
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    for (const session of sessions) {
      disposeSession(session);
    }
    sessions.clear();
    return true;
  };

  return Object.freeze({
    cancelCompaction,
    cancelPreviewCapture,
    clearWriteSchedule,
    dispose,
    disposeSession,
    scheduleCompaction,
    schedulePreviewCapture,
    scheduleWrite,
  });
}
