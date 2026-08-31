export function createServiceForwardingLifecycle({ elements = {}, handlers = {} } = {}) {
  const listeners = [];
  let started = false;
  let disposed = false;

  const listen = (target, type, listener) => {
    if (!target?.addEventListener || typeof listener !== "function") {
      return;
    }
    target.addEventListener(type, listener);
    listeners.push([target, type, listener]);
  };

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const [target, type, listener] of listeners.splice(0)) {
        target.removeEventListener?.(type, listener);
      }
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      listen(elements.addButton, "click", handlers.onAdd);
      listen(elements.titleInput, "input", handlers.onTitleInput);
      listen(elements.portStepUp, "click", handlers.onPortStepUp);
      listen(elements.portStepDown, "click", handlers.onPortStepDown);
      listen(elements.form, "submit", (event) => {
        event.preventDefault();
        handlers.onSubmit?.();
      });
      listen(elements.cancelButton, "click", handlers.onCancel);
      listen(elements.editorScrim, "click", handlers.onCancel);
      listen(elements.deleteButton, "click", handlers.onDeleteCurrent);
      listen(elements.list, "click", handlers.onListAction);
    },
  };
}
