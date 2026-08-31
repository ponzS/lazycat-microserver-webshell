export function createAppRuntimeRecoveryLifecycle({
  now = () => Date.now(),
  userRecoveryThrottleMs = 1500,
} = {}) {
  let disposed = false;
  let generation = 0;
  let lastUserRecoveryAt = 0;

  const nextGeneration = () => {
    if (disposed) {
      return 0;
    }
    generation += 1;
    return generation;
  };

  const isCurrent = (expectedGeneration) => (
    !disposed && Number(expectedGeneration || 0) === generation
  );

  const shouldRecoverFromUserGesture = () => {
    if (disposed) {
      return false;
    }
    const current = now();
    if (current - lastUserRecoveryAt < userRecoveryThrottleMs) {
      return false;
    }
    lastUserRecoveryAt = current;
    return true;
  };

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
    invalidate: nextGeneration,
    isCurrent,
    isDisposed: () => disposed,
    nextGeneration,
    shouldRecoverFromUserGesture,
  });
}
