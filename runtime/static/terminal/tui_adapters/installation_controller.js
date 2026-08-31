/**
 * Composes tool-specific fullscreen TUI adapters for a terminal session.
 * Identity detection and gesture mechanics stay in the tool/common modules;
 * this controller only supplies application actions and owns no session data.
 */
export function createTerminalTUIAdapterInstaller({
  ElementCtor = globalThis.Element,
  isTouchShortcutLayout = () => false,
  isMobileMenuOpen = () => false,
  isClaudeTouchSession = () => false,
  isClaudeContextMenuEvent = () => false,
  isClaudeDesktopSelectionEvent = () => false,
  getTerminalMouse = () => null,
  getTerminalIME = () => null,
  getTerminalSelection = () => null,
  getTerminalResize = () => null,
  getTerminalInteraction = () => null,
  setActivePane = () => {},
  getTabById = () => null,
  markContextMenuCandidate = () => {},
  registerCleanup = () => {},
  installClaudeFullscreenTouchAdapter = () => {},
  installFullscreenTuiTouchAdapter = () => {},
  installOpencodeFullscreenTouchAdapter = () => {},
  installHerdrFullscreenTouchAdapter = () => {},
  installPiFullscreenTouchAdapter = () => {},
  installClaudeFullscreenContextMenuAdapter = () => {},
  installClaudeFullscreenDesktopSelectionAdapter = () => {},
  isOpencodeFullscreenTouchCandidate = () => false,
  isHerdrFullscreenTouchCandidate = () => false,
  isPiFullscreenTouchCandidate = () => false,
  moveThresholdPx = 8,
  longPressDelayMs = 450,
  desktopSelectionMoveThresholdPx = 4,
} = {}) {
  const isElement = (value) => (
    typeof ElementCtor === "function"
      ? value instanceof ElementCtor
      : Boolean(value && typeof value.closest === "function")
  );

  const activateSessionPane = (session) => {
    const tab = getTabById(session?.tabId);
    if (tab && session?.id) {
      setActivePane(tab, session.id, { focus: false });
    }
  };

  const touchOptions = (session, host, candidate = null) => ({
    shell: session?.shellEl,
    shouldStart: (event) => {
      if (
        !isTouchShortcutLayout()
        || Number(event?.touches?.length || 0) !== 1
        || (typeof candidate === "function" && !candidate(session, {
          mouseTracking: getTerminalMouse()?.hasTracking(session) === true,
        }))
        || isMobileMenuOpen()
      ) {
        return false;
      }
      const target = event?.target;
      return isElement(target)
        && !target.closest(".mobile-selection-handle")
        && target.closest(".terminal-host") === host;
    },
    cellFromPoint: (clientX, clientY) => getTerminalSelection()?.cellFromPoint(session, clientX, clientY),
    activatePane: () => activateSessionPane(session),
    markContextMenuCandidate,
    blurInput: () => getTerminalIME()?.blurInput(session),
    suppressTouchScroll: () => getTerminalSelection()?.suppressTouchScroll(session),
    applySelection: (start, end) => getTerminalSelection()?.apply(session, start, end),
    updateSelectionHandles: () => getTerminalSelection()?.updateHandles(session),
    updateSelectionAutoScroll: (state, applyPoint) => getTerminalSelection()?.updateAutoScroll(session, state, applyPoint),
    stopSelectionAutoScroll: (state) => getTerminalSelection()?.stopAutoScroll(state),
    clearSelectionIfTapOutside: (touch) => getTerminalSelection()?.clearIfTapOutside(session, touch) === true,
    hasSelection: () => getTerminalSelection()?.hasSelection(session) === true,
    consumeKeyboardClaim: (event) => getTerminalIME()?.consumeKeyboardClaim(event) === true,
    prepareMouseInput: () => {
      const resize = getTerminalResize();
      if (typeof resize?.claimForCurrentDevice === "function") {
        return resize.claimForCurrentDevice(session);
      }
      return resize?.claimSize?.(session, { force: true });
    },
    rowHeight: () => {
      const renderer = session?.term?.renderer;
      return Math.max(
        moveThresholdPx,
        Number(renderer?.getMetrics?.().height) || Number(renderer?.charHeight) || 18,
      );
    },
    sendWheel: (steps, event, touch) => getTerminalMouse()?.sendWheel(session, steps, event, touch) === true,
    sendClick: (event, touch) => getTerminalMouse()?.sendClick(session, event, touch) === true,
    registerCleanup: (callback) => registerCleanup(session, callback),
    moveThresholdPx,
    longPressDelayMs,
  });

  const installFullscreenTouch = (session, candidate, installer) => {
    const shell = session?.shellEl;
    const host = session?.terminalHost;
    if (!shell || !host || !session?.term) {
      return false;
    }
    installer(touchOptions(session, host, candidate));
    return true;
  };

  const installClaudeTouch = (session) => {
    const shell = session?.shellEl;
    const host = session?.terminalHost;
    if (!shell || !host || !session?.term) {
      return false;
    }
    installClaudeFullscreenTouchAdapter({
      ...touchOptions(session, host),
      shouldStart: (event) => touchOptions(session, host).shouldStart(event) && isClaudeTouchSession(session),
    });
    return true;
  };

  const installOpencodeTouch = (session) => installFullscreenTouch(
    session,
    isOpencodeFullscreenTouchCandidate,
    installOpencodeFullscreenTouchAdapter,
  );

  const installHerdrTouch = (session) => installFullscreenTouch(
    session,
    isHerdrFullscreenTouchCandidate,
    installHerdrFullscreenTouchAdapter,
  );

  const installPiTouch = (session) => installFullscreenTouch(
    session,
    isPiFullscreenTouchCandidate,
    installPiFullscreenTouchAdapter,
  );

  const installClaudeContextMenu = (session) => {
    const shell = session?.shellEl;
    const host = session?.terminalHost;
    if (!shell || !host) {
      return false;
    }
    installClaudeFullscreenContextMenuAdapter({
      shell,
      shouldStart: (event) => {
        const target = event?.target;
        return isElement(target)
          && target.closest(".terminal-host") === host
          && isClaudeContextMenuEvent(session, event);
      },
      claimEvent: (event) => getTerminalMouse()?.claimEvent(event),
      registerCleanup: (callback) => registerCleanup(session, callback),
    });
    return true;
  };

  const installClaudeDesktopSelection = (session) => {
    const shell = session?.shellEl;
    const host = session?.terminalHost;
    if (!shell || !host) {
      return false;
    }
    installClaudeFullscreenDesktopSelectionAdapter({
      shell,
      shouldStart: (event) => {
        const target = event?.target;
        return isElement(target)
          && target.closest(".terminal-host") === host
          && isClaudeDesktopSelectionEvent(session, event);
      },
      claimEvent: (event) => getTerminalMouse()?.claimEvent(event),
      sendClick: (event) => getTerminalMouse()?.sendClick(session, event) === true,
      registerCleanup: (callback) => registerCleanup(session, callback),
      moveThresholdPx: desktopSelectionMoveThresholdPx,
    });
    return true;
  };

  return Object.freeze({
    installClaudeContextMenu,
    installClaudeDesktopSelection,
    installClaudeTouch,
    installHerdrTouch,
    installOpencodeTouch,
    installPiTouch,
  });
}
