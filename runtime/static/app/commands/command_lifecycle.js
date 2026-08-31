/**
 * Owns the lifetime fence and DOM listener cleanup for application commands.
 * The command controller never relies on a listener surviving application
 * disposal; every callback is removed and invalidated by this lifecycle.
 */
export function createAppCommandLifecycle() {
  let disposed = false;
  let installed = false;
  let generation = 0;
  const listeners = [];

  const listen = (target, type, listener, options) => {
    if (disposed || !target?.addEventListener || typeof listener !== "function") {
      return false;
    }
    target.addEventListener(type, listener, options);
    listeners.push([target, type, listener, options]);
    return true;
  };

  const markInstalled = () => {
    if (disposed || installed) {
      return false;
    }
    installed = true;
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    generation += 1;
    for (const [target, type, listener, options] of listeners.splice(0)) {
      target.removeEventListener?.(type, listener, options);
    }
    return true;
  };

  return Object.freeze({
    dispose,
    generation: () => generation,
    isDisposed: () => disposed,
    isInstalled: () => installed,
    listen,
    markInstalled,
  });
}
