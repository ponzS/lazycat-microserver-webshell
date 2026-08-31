export function createAppRuntimeRecoveryLifecycle({
  now = () => Date.now(),
  userRecoveryThrottleMs = 1500,
  foregroundRecoveryThrottleMs = 64,
} = {}) {
  let disposed = false;
  let generation = 0;
  let lastUserRecoveryAt = 0;
  let resumeGeneration = 0;
  let lastForegroundRecoveryAt = 0;

  const nextGeneration = () => {
    if (disposed) {
      return 0;
    }
    generation += 1;
    return generation;
  };

  const beginResumeGeneration = ({ force = false } = {}) => {
    if (disposed) {
      return Object.freeze({ accepted: false, generation, resumeGeneration });
    }
    const timestamp = now();
    const throttleMs = Math.max(0, Number(foregroundRecoveryThrottleMs) || 0);
    if (
      !force
      && lastForegroundRecoveryAt > 0
      && timestamp - lastForegroundRecoveryAt < throttleMs
    ) {
      return Object.freeze({ accepted: false, generation, resumeGeneration });
    }
    lastForegroundRecoveryAt = timestamp;
    generation += 1;
    resumeGeneration += 1;
    return Object.freeze({ accepted: true, generation, resumeGeneration });
  };

  const invalidate = () => {
    lastForegroundRecoveryAt = 0;
    return nextGeneration();
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
    invalidate,
    isCurrent,
    isDisposed: () => disposed,
    nextGeneration,
    beginResumeGeneration,
    getResumeGeneration: () => resumeGeneration,
    shouldRecoverFromUserGesture,
  });
}
