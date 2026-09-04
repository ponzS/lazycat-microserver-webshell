const noop = () => {};

/**
 * Owns responsive layout policy and force-PC DOM synchronization. Feature
 * controllers are reached only through explicit callbacks.
 */
export function createAppLayoutController({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  mobileLayoutQuery = windowObject?.matchMedia?.("(max-width: 640px)"),
  touchShortcutLayoutQuery = windowObject?.matchMedia?.("(hover: none), (pointer: coarse)"),
  isDebugModeEnabled = () => false,
  getForcePCModeEnabled = () => false,
  getDesktopShortcutsBarEnabled = () => false,
  getMobilePixelScrollEnabled = () => true,
  closeMobileActionSheet = noop,
  closeMobileCloseConfirm = noop,
  closeMobileCustomSelect = noop,
  hideSelection = noop,
  handleViewportLayoutChange = noop,
  scheduleActiveTabLiveGeometry = noop,
  handleHostLayoutChange = noop,
  updateMobileActiveTabTitle = noop,
  updateSelection = noop,
} = {}) {
  let disposed = false;

  const isForcePCModeActive = () => Boolean(
    !disposed && isDebugModeEnabled() && getForcePCModeEnabled() === true,
  );
  const isMobileLayout = () => !isForcePCModeActive() && Boolean(mobileLayoutQuery?.matches);
  const isTouchShortcutLayout = () => !isForcePCModeActive() && Boolean(touchShortcutLayoutQuery?.matches);
  const isDesktopShortcutBarLayout = () => getDesktopShortcutsBarEnabled() === true && !isTouchShortcutLayout();
  const isTouchSelectionLayout = () => isMobileLayout() || isTouchShortcutLayout();
  const requiresTouchKeyboardDoubleTap = () => isTouchShortcutLayout();
  const isMobileCustomSelectLayout = () => isMobileLayout() || isTouchShortcutLayout();

  const syncForcePCModeState = () => {
    if (disposed) {
      return false;
    }
    const active = isForcePCModeActive();
    documentObject?.documentElement?.dataset && (documentObject.documentElement.dataset.forcePcMode = active ? "true" : "false");
    documentObject?.body?.classList?.toggle("force-pc-mode", active);
    if (active) {
      closeMobileActionSheet();
      closeMobileCloseConfirm(false);
      closeMobileCustomSelect();
      hideSelection();
    }
    handleViewportLayoutChange();
    scheduleActiveTabLiveGeometry();
    handleHostLayoutChange();
    updateMobileActiveTabTitle();
    updateSelection();
    return true;
  };

  const syncTerminalMobilePixelScroll = (session) => {
    if (disposed || !session?.term?.options) {
      return false;
    }
    session.term.options.mobilePixelScroll = getMobilePixelScrollEnabled() !== false && isMobileLayout();
    return true;
  };

  const syncTabMobilePixelScroll = (tab) => {
    if (disposed || !tab) {
      return false;
    }
    for (const session of tab.panes?.values?.() || []) {
      syncTerminalMobilePixelScroll(session);
    }
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    return true;
  };

  return Object.freeze({
    dispose,
    isDisposed: () => disposed,
    isDesktopShortcutBarLayout,
    isForcePCModeActive,
    isMobileCustomSelectLayout,
    isMobileLayout,
    isTouchSelectionLayout,
    isTouchShortcutLayout,
    requiresTouchKeyboardDoubleTap,
    syncForcePCModeState,
    syncTabMobilePixelScroll,
    syncTerminalMobilePixelScroll,
  });
}
