import { createWorkspaceTargetLifecycle } from "./target_lifecycle.js";

export function createWorkspaceTargetController({
  initialName = "",
  lifecycle = null,
  lifecycleFactory = createWorkspaceTargetLifecycle,
  isDisposed = () => false,
  clearRefreshRetry = () => {},
  hideStartupError = () => {},
  invalidateWorkspaceGeneration = () => {},
  syncNetworkSockets = () => {},
  onTargetChange = () => {},
  resetWorkspace = () => {},
  updateLocation = () => {},
  refreshWorkspaceWithRetry = () => Promise.resolve(false),
} = {}) {
  const targetLifecycle = lifecycle || lifecycleFactory({ initialName });
  let disposed = false;

  const getActiveName = () => targetLifecycle.getActiveName();
  const getGeneration = () => targetLifecycle.getGeneration();

  const setActiveName = (name) => {
    if (disposed || isDisposed()) {
      return getGeneration();
    }
    const previousName = getActiveName();
    const generation = targetLifecycle.setName(name);
    const nextName = getActiveName();
    if (nextName !== previousName) {
      invalidateWorkspaceGeneration();
      syncNetworkSockets({ reset: true });
      onTargetChange({ previousName, name: nextName, generation });
    }
    return generation;
  };

  const isCurrentRequest = (name, generation) => (
    !disposed
    && !isDisposed()
    && targetLifecycle.isCurrent(name, generation)
  );

  const isCurrentSession = (session) => {
    const name = String(session?.name || "").trim();
    return Boolean(name) && name === getActiveName() && !disposed && !isDisposed();
  };

  const switchTo = async (nextName, { updateURL = true, replaceURL = false } = {}) => {
    const normalized = String(nextName || "").trim();
    if (disposed || isDisposed() || !normalized || normalized === getActiveName()) {
      return false;
    }
    clearRefreshRetry();
    hideStartupError();
    const generation = setActiveName(normalized);
    if (updateURL) {
      updateLocation(normalized, { replace: replaceURL, tabId: "" });
    }
    resetWorkspace();
    await refreshWorkspaceWithRetry({
      focus: true,
      instanceName: normalized,
      generation,
    });
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    targetLifecycle.dispose();
    return true;
  };

  return Object.freeze({
    dispose,
    getActiveName,
    getGeneration,
    isCurrentRequest,
    isCurrentSession,
    isDisposed: () => disposed,
    setActiveName,
    switchTo,
  });
}
