export function createWorkspaceRefreshLifecycle({
  windowObject = globalThis.window,
  navigatorObject = globalThis.navigator,
  random = Math.random,
  getActiveName = () => "",
  getActiveGeneration = () => 0,
  isCurrentRequest = () => true,
  isDisposed = () => false,
  runRefresh = () => Promise.resolve(false),
  logInfo = () => {},
  logWarning = () => {},
  baseDelayMs = 500,
  maxDelayMs = 15 * 1000,
  jitterRatio = 0.2,
  maxAttempts = 20,
} = {}) {
  let retryTimer = 0;
  let retryAttempts = 0;
  let retryInFlight = false;
  let retryContext = null;
  let disposed = false;

  const isInactive = () => disposed || isDisposed();

  const clear = () => {
    if (retryTimer) {
      windowObject.clearTimeout(retryTimer);
      retryTimer = 0;
    }
    retryAttempts = 0;
    retryContext = null;
  };

  const schedule = ({
    focus = false,
    instanceName = getActiveName(),
    generation = getActiveGeneration(),
    immediate = false,
  } = {}) => {
    const requestName = String(instanceName || "").trim();
    if (isInactive() || !isCurrentRequest(requestName, generation)) {
      return false;
    }
    if (
      retryContext?.instanceName === requestName
      && retryContext?.generation === generation
    ) {
      retryContext.focus = Boolean(focus || retryContext.focus);
    } else {
      retryContext = {
        focus: Boolean(focus),
        instanceName: requestName,
        generation,
      };
    }
    if (retryTimer || retryInFlight || navigatorObject?.onLine === false) {
      return true;
    }
    const attempt = Math.max(0, Number(retryAttempts || 0));
    const baseDelay = immediate
      ? 0
      : Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(attempt, 8)));
    const jitter = baseDelay * jitterRatio * ((random() * 2) - 1);
    const delay = Math.max(0, Math.round(baseDelay + jitter));
    retryTimer = windowObject.setTimeout(async () => {
      retryTimer = 0;
      const context = retryContext;
      if (!context || isInactive() || !isCurrentRequest(context.instanceName, context.generation)) {
        return;
      }
      retryInFlight = true;
      let retryError = null;
      const attemptBeforeRun = retryAttempts;
      try {
        await runRefresh(context);
        logInfo("[workspace-recovery] refresh succeeded", {
          name: context.instanceName,
          attempts: attemptBeforeRun,
        });
        clear();
      } catch (error) {
        retryError = error;
        retryAttempts = Math.min(maxAttempts, retryAttempts + 1);
        logWarning("[workspace-recovery] refresh failed", {
          name: context.instanceName,
          attempt: retryAttempts,
          error: error?.message || String(error),
        });
      } finally {
        retryInFlight = false;
      }
      if (!disposed && retryError && retryContext === context) {
        schedule(context);
      }
    }, delay);
    return true;
  };

  const resume = () => {
    if (!retryContext || isInactive()) {
      return false;
    }
    return schedule({ ...retryContext, immediate: true });
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    clear();
    return true;
  };

  return Object.freeze({
    clear,
    dispose,
    getAttempts: () => retryAttempts,
    getContext: () => retryContext ? { ...retryContext } : null,
    isDisposed: () => disposed,
    isInFlight: () => retryInFlight,
    resume,
    schedule,
  });
}
