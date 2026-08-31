export function createWorkspaceTargetLifecycle({ initialName = "" } = {}) {
  let activeName = String(initialName || "").trim();
  let generation = 0;
  let disposed = false;

  const setName = (name) => {
    if (disposed) {
      return generation;
    }
    const normalized = String(name || "").trim();
    if (normalized !== activeName) {
      activeName = normalized;
      generation += 1;
    }
    return generation;
  };

  const isCurrent = (name, expectedGeneration) => (
    !disposed
    && String(name || "").trim() === activeName
    && expectedGeneration === generation
  );

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    generation += 1;
    return true;
  };

  return Object.freeze({
    dispose,
    getActiveName: () => activeName,
    getGeneration: () => generation,
    isCurrent,
    isDisposed: () => disposed,
    setName,
  });
}
