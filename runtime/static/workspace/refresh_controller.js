import { createWorkspaceRefreshLifecycle } from "./refresh_lifecycle.js";

export function createWorkspaceRefreshController({
  getActiveName = () => "",
  getActiveGeneration = () => 0,
  isCurrentRequest = () => true,
  fetchWorkspaceState = () => Promise.reject(new Error("Workspace fetch is unavailable.")),
  ensureResponseSelector = () => {},
  observeServerRevision = () => {},
  applyWorkspaceState = () => {},
  markStartupMetric = () => {},
  appendStartupTrace = () => {},
  performanceNow = () => Date.now(),
  measureTask = (name, task) => task(),
  getTabCount = () => 0,
  lifecycleFactory = createWorkspaceRefreshLifecycle,
  lifecycleOptions = {},
} = {}) {
  let latestRecoveryMetrics = null;
  let disposed = false;
  let lifecycle = null;

  const request = async ({
    instanceName = getActiveName(),
    generation = getActiveGeneration(),
  } = {}) => {
    const requestName = String(instanceName || "").trim();
    if (disposed) {
      throw new Error("Workspace refresh controller is disposed.");
    }
    const recoveryMetrics = {
      selector: requestName,
      generation,
      startedAt: performanceNow(),
      readyAt: 0,
    };
    if (isCurrentRequest(requestName, generation)) {
      latestRecoveryMetrics = recoveryMetrics;
    }
    markStartupMetric("workspaceRequestStartedAt");
    appendStartupTrace("workspace 请求开始", `selector=${requestName}`, {
      dedupeKey: `workspace-request:${requestName}`,
    });
    const state = await fetchWorkspaceState(requestName);
    if (disposed || !isCurrentRequest(requestName, generation)) {
      return { state, requestName, generation };
    }
    recoveryMetrics.readyAt = performanceNow();
    markStartupMetric("workspaceReadyAt");
    appendStartupTrace("workspace 响应完成", `selector=${requestName}`, {
      dedupeKey: `workspace-ready:${requestName}`,
    });
    return { state, requestName, generation };
  };

  const apply = ({ state, requestName, generation }, { focus = false } = {}) => {
    if (disposed || !isCurrentRequest(requestName, generation)) {
      return state;
    }
    ensureResponseSelector(state, requestName);
    observeServerRevision(state);
    applyWorkspaceState(state, { focus, instanceName: requestName, generation });
    markStartupMetric("workspaceAppliedAt");
    appendStartupTrace("workspace 应用完成", `tabs=${getTabCount()}`, {
      dedupeKey: "workspace-applied",
    });
    lifecycle?.clear();
    return state;
  };

  const refresh = async ({
    focus = false,
    instanceName = getActiveName(),
    generation = getActiveGeneration(),
  } = {}) => measureTask("workspace refresh", async () => {
    const result = await request({ instanceName, generation });
    return apply(result, { focus });
  });

  lifecycle = lifecycleFactory({
    ...lifecycleOptions,
    getActiveName,
    getActiveGeneration,
    isCurrentRequest,
    isDisposed: () => disposed,
    runRefresh: (context) => refresh(context),
  });

  const refreshWithRetry = async (options = {}) => {
    try {
      return await refresh(options);
    } catch (error) {
      lifecycle.schedule(options);
      throw error;
    }
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    lifecycle.dispose();
    latestRecoveryMetrics = null;
    return true;
  };

  return Object.freeze({
    apply,
    clearRetry: () => lifecycle.clear(),
    dispose,
    getLatestRecoveryMetrics: () => latestRecoveryMetrics ? { ...latestRecoveryMetrics } : null,
    getRetryContext: () => lifecycle.getContext(),
    isDisposed: () => disposed,
    refresh,
    refreshWithRetry,
    request,
    resumeRetry: () => lifecycle.resume(),
    scheduleRetry: (options) => lifecycle.schedule(options),
  });
}
