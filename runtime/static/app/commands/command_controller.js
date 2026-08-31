import { createAppCommandLifecycle } from "./command_lifecycle.js";

const noop = () => {};

const invoke = (callback, ...args) => (
  typeof callback === "function" ? callback(...args) : undefined
);

/**
 * Routes application-level user intent from mobile shortcuts and shell
 * controls. It owns no tab, pane, terminal, transport, history or rendering
 * state; all effects are explicit commands supplied by the app orchestrator.
 */
export function createAppCommandController({
  lifecycle = null,
  lifecycleFactory = createAppCommandLifecycle,
  getActiveName = () => "",
  getCurrentTab = () => null,
  postWorkspaceAction = () => Promise.resolve(false),
  closeTab = noop,
  renameTab = noop,
  swapRecentTabs = noop,
  setActiveTabByOffset = noop,
  splitPane = noop,
  openOverview = noop,
  openSearch = noop,
  openAttachments = noop,
  importAttachmentFromClipboard = noop,
  selectAttachmentFiles = noop,
  copySession = noop,
  pasteSession = noop,
  scrollSession = noop,
  adjustTerminalFontSize = noop,
  openMobileMenu = noop,
  showToast = noop,
  bindTargets = null,
} = {}) {
  const commandLifecycle = lifecycle || lifecycleFactory();

  const isDisposed = () => commandLifecycle.isDisposed();

  const createUserTab = async () => {
    if (isDisposed()) {
      return false;
    }
    if (!String(invoke(getActiveName) || "").trim()) {
      invoke(showToast, "No running container is available.");
      return false;
    }
    const tab = invoke(getCurrentTab) || null;
    await invoke(postWorkspaceAction, "create_tab", {
      tab_id: tab?.id || "",
      pane_id: tab?.activePaneId || "",
    });
    return true;
  };

  const runAction = async (action, session = null) => {
    if (isDisposed()) {
      return false;
    }
    const tab = invoke(getCurrentTab) || null;
    switch (String(action || "").trim()) {
      case "new_tab":
        return createUserTab();
      case "close_tab":
        return tab ? invoke(closeTab, tab.id) : false;
      case "rename_tab":
        return tab ? invoke(renameTab, tab.id) : false;
      case "swap_tab":
      case "swap_recent_tab":
      case "swap":
        return invoke(swapRecentTabs);
      case "next_tab":
        return invoke(setActiveTabByOffset, 1);
      case "previous_tab":
        return invoke(setActiveTabByOffset, -1);
      case "vertical_split":
        return tab?.activePaneId
          ? invoke(splitPane, tab.id, tab.activePaneId, "vertical")
          : false;
      case "horizontal_split":
        return tab?.activePaneId
          ? invoke(splitPane, tab.id, tab.activePaneId, "horizontal")
          : false;
      case "tab_overview":
      case "open_tab_overview":
      case "overview":
        return invoke(openOverview);
      case "search_terminal":
      case "search":
        return invoke(openSearch);
      case "attachment":
      case "open_attachment":
        return invoke(openAttachments);
      case "attachment_clipboard":
        return invoke(importAttachmentFromClipboard);
      case "attachment_file":
        return invoke(selectAttachmentFiles);
      case "copy":
        return invoke(copySession, session);
      case "paste":
        return invoke(pasteSession, session);
      case "page_up":
      case "page-up":
        return invoke(scrollSession, session, -1);
      case "page_down":
      case "page-down":
        return invoke(scrollSession, session, 1);
      case "zoom_in":
      case "zoom-in":
        return invoke(adjustTerminalFontSize, 1);
      case "zoom_out":
      case "zoom-out":
        return invoke(adjustTerminalFontSize, -1);
      case "open_mobile_menu":
        return invoke(openMobileMenu);
      default:
        return false;
    }
  };

  const install = (targets = bindTargets) => {
    if (isDisposed() || !commandLifecycle.markInstalled()) {
      return false;
    }
    const newTabButton = targets?.newTabButton || null;
    const emptyStateAction = targets?.emptyStateAction || null;
    const tabsElement = targets?.tabsElement || null;
    const onCreateTab = () => {
      createUserTab().catch((error) => invoke(showToast, error?.message || String(error)));
    };
    commandLifecycle.listen(newTabButton, "click", onCreateTab);
    commandLifecycle.listen(emptyStateAction, "click", onCreateTab);
    commandLifecycle.listen(tabsElement, "wheel", (event) => {
      if (Math.abs(Number(event?.deltaY || 0)) > Math.abs(Number(event?.deltaX || 0))) {
        tabsElement.scrollLeft += Number(event.deltaY || 0);
        event.preventDefault?.();
      }
    }, { passive: false });
    return true;
  };

  return Object.freeze({
    createUserTab,
    dispose: () => commandLifecycle.dispose(),
    install,
    isDisposed,
    runAction,
  });
}
