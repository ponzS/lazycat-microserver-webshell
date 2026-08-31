/**
 * Owns the lifetime fence for application shortcut commands.
 * Page listeners remain owned by app_lifecycle.js; this module only rejects
 * commands that arrive after application disposal.
 */
export function createAppShortcutLifecycle() {
  let disposed = false;
  let generation = 0;

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
    generation: () => generation,
    isDisposed: () => disposed,
  });
}
