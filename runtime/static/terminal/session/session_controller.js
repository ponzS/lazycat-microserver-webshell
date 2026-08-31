import { createTerminalSessionLifecycle } from "./session_lifecycle.js";
import { createTerminalSessionState } from "./session_state.js";

const normalizeInitialSize = (value, minValue) => {
  const next = Math.floor(Number(value));
  return Number.isFinite(next) && next >= minValue ? next : 0;
};

export function createTerminalSessionController({
  createResources,
  lifecycleAdapters = {},
  lifecycleFactory = createTerminalSessionLifecycle,
  stateFactory = createTerminalSessionState,
  windowObject = globalThis.window,
} = {}) {
  if (typeof createResources !== "function") {
    throw new TypeError("terminal session resource factory is required");
  }

  let nextPaneSequence = 1;
  const lifecycle = lifecycleFactory({
    adapters: lifecycleAdapters,
    windowObject,
  });

  const allocatePaneID = (requestedID) => {
    const normalizedID = String(requestedID || `pane-${nextPaneSequence++}`).trim();
    const numeric = Number(normalizedID.replace(/^pane-/, ""));
    if (Number.isFinite(numeric) && numeric >= nextPaneSequence) {
      nextPaneSequence = numeric + 1;
    }
    return normalizedID;
  };

  return Object.freeze({
    addCleanup: lifecycle.addCleanup,
    create({
      id = "",
      tabId = "",
      name = "",
      connect = true,
      cols = 0,
      rows = 0,
      workspaceGeneration = "",
      baseTheme = null,
    } = {}) {
      const normalizedID = allocatePaneID(id);
      const initialCols = normalizeInitialSize(cols, 2);
      const initialRows = normalizeInitialSize(rows, 1);
      const initialTerminalOptions = initialCols > 0 && initialRows > 0
        ? { cols: initialCols, rows: initialRows }
        : {};
      const resources = createResources({
        connect: Boolean(connect),
        id: normalizedID,
        initialCols,
        initialRows,
        initialTerminalOptions,
      });
      return stateFactory({
        baseTheme,
        connect: Boolean(connect),
        id: normalizedID,
        initialCols,
        initialRows,
        name,
        resources,
        tabId,
        workspaceGeneration,
      });
    },
    dispose: lifecycle.dispose,
    disposeAll: lifecycle.disposeAll,
    isDisposed: lifecycle.isDisposed,
  });
}
