export function createAppBootstrapLifecycle() {
  let started = false;
  let disposed = false;
  let generation = 0;

  const begin = () => {
    if (started || disposed) {
      return 0;
    }
    started = true;
    generation += 1;
    return generation;
  };

  const isCurrent = (expectedGeneration) => (
    !disposed && Number(expectedGeneration || 0) === generation
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
    begin,
    dispose,
    isCurrent,
    isDisposed: () => disposed,
    isStarted: () => started,
  });
}
