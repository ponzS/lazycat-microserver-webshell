import { createServerRevisionAPI } from "./server_revision_api.js";
import { createServerRevisionLifecycle } from "./server_revision_lifecycle.js";

const createStableClientID = ({ storage, key, cryptoObject = globalThis.crypto } = {}) => {
  const generate = () => cryptoObject?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    const stored = String(storage?.getItem?.(key) || "").trim();
    if (stored) {
      return stored;
    }
    const next = generate();
    storage?.setItem?.(key, next);
    return next;
  } catch (error) {
    return generate();
  }
};

export function createServerRevisionController({
  windowObject = globalThis.window,
  navigatorObject = globalThis.navigator,
  storage = windowObject?.localStorage,
  storagePrefix = "webshell",
  api = null,
  lifecycleFactory = createServerRevisionLifecycle,
  getActiveName = () => "",
  getActiveGeneration = () => 0,
  isCurrentRequest = () => true,
  getActiveTabId = () => "",
  getTerminalInput = () => null,
  isMobileLayout = () => false,
  openDialog = () => Promise.resolve(false),
  confirmMobileSheet = () => Promise.resolve(false),
  rememberRestartTabForReload = () => {},
  suppressBeforeUnloadForNavigation = () => {},
  showToast = () => {},
  appendDebugWarning = () => {},
  appendDebugError = () => {},
  initialCheckDelayMs = 1000,
  cryptoObject = globalThis.crypto,
} = {}) {
  const clientID = createStableClientID({
    storage,
    key: `${storagePrefix}.clientID`,
    cryptoObject,
  });
  const revisionAPI = api || createServerRevisionAPI({ windowObject });
  const lifecycle = lifecycleFactory({ windowObject });
  let disposed = false;
  let generation = 0;
  let currentRevision = "";
  let reloadPrompted = false;
  let dialogOpen = false;

  const setInputBlocked = async (blocked) => {
    const name = getActiveName();
    if (!name || disposed) {
      return false;
    }
    await revisionAPI.setInputBlocked({
      name,
      clientID,
      inputBlocked: blocked === true,
    });
    return true;
  };

  const showRestartDialog = async () => {
    if (disposed || dialogOpen) {
      return false;
    }
    const dialogGeneration = generation;
    const restartTargetName = getActiveName();
    const restartTargetTabId = getActiveTabId();
    dialogOpen = true;
    const input = getTerminalInput();
    input?.armAllGeneratedSuppression?.(2000);
    input?.setAllLocked?.(true);
    setInputBlocked(true).catch(() => {});
    input?.discardAll?.();
    let shouldUnlock = true;
    try {
      const options = {
        title: "WebShell 已更新",
        message: "检测到 WebShell 服务已更新，请重新加载页面以使用最新版本。",
        okText: "重新加载",
        cancelText: "取消",
        initialFocus: "ok",
      };
      const restart = isMobileLayout()
        ? await confirmMobileSheet({ ...options, actionsLayout: "vertical-ok-first" })
        : await openDialog(options);
      if (disposed || dialogGeneration !== generation) {
        return false;
      }
      if (restart === true) {
        shouldUnlock = false;
        rememberRestartTabForReload(restartTargetName, restartTargetTabId);
        input?.armAllGeneratedSuppression?.(2000);
        input?.discardAll?.();
        suppressBeforeUnloadForNavigation();
        windowObject.location.reload();
        return true;
      }
      return false;
    } finally {
      if (shouldUnlock && !disposed && dialogGeneration === generation) {
        await setInputBlocked(false).catch(() => {});
        getTerminalInput()?.setAllLocked?.(false);
        dialogOpen = false;
      }
    }
  };

  const observe = (state) => {
    if (disposed) {
      return false;
    }
    const nextRevision = String(state?.server_revision || "").trim();
    if (!nextRevision) {
      return false;
    }
    const revisionChanged = Boolean(currentRevision && currentRevision !== nextRevision);
    currentRevision = nextRevision;
    if ((!revisionChanged && state?.reload_required !== true) || reloadPrompted) {
      return false;
    }
    reloadPrompted = true;
    showRestartDialog().catch((error) => showToast(error?.message || "重启提示失败"));
    return true;
  };

  const refresh = async () => {
    if (disposed) {
      return false;
    }
    const requestGeneration = generation;
    const requestName = getActiveName();
    const targetGeneration = getActiveGeneration();
    const state = await revisionAPI.read({ name: requestName, clientID });
    if (
      disposed
      || requestGeneration !== generation
      || (requestName && !isCurrentRequest(requestName, targetGeneration))
    ) {
      return false;
    }
    observe(state);
    return true;
  };

  return Object.freeze({
    async clearStartupInputLock() {
      await setInputBlocked(false);
      getTerminalInput()?.setAllLocked?.(false);
    },
    dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      generation += 1;
      dialogOpen = false;
      lifecycle.dispose();
      getTerminalInput()?.setAllLocked?.(false);
      return true;
    },
    getClientID: () => clientID,
    isDialogOpen: () => dialogOpen,
    observe,
    refresh,
    scheduleInitialCheck() {
      return lifecycle.scheduleInitialCheck(() => {
        if (navigatorObject?.onLine === false) {
          appendDebugWarning("版本检查跳过：当前网络离线");
          return;
        }
        refresh().catch((error) => {
          appendDebugError("版本检查失败", error?.message || String(error));
        });
      }, initialCheckDelayMs);
    },
    setInputBlocked,
    showRestartDialog,
  });
}
