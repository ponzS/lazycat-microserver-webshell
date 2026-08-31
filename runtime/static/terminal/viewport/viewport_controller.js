import { createTerminalViewportLifecycle } from "./viewport_lifecycle.js";
import {
  currentMobileViewportOrientation as readMobileViewportOrientation,
  isKeyboardLikeViewportHeightChange as keyboardLikeViewportHeightChange,
  measureMobileViewportBottomInset as readMobileViewportBottomInset,
  normalizeViewportPixels,
  terminalViewportPanY,
} from "./viewport_model.js";

const noop = () => {};

export function createTerminalMobileViewportController({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  navigatorObject = globalThis.navigator,
  mobileShortcuts = null,
  isIOSPlatform = () => false,
  isAndroidPlatform = () => false,
  isForcePCModeActive = () => false,
  isMobileLayout = () => false,
  isTouchShortcutLayout = () => false,
  getActiveSession = () => null,
  getSessions = () => [],
  hasActivePanes = () => Boolean(getActiveSession()),
  resizeActiveTabForCurrentDevice = noop,
  resetHostViewport = noop,
  positionInput = noop,
  updateSelectionHandles = noop,
  updateSelection = noop,
  isMobileMenuOpen = () => false,
  renderMobileMenu = noop,
  scheduleOverviewRender = noop,
  updateActiveTabTitle = noop,
  mobileKeyboardInsetThresholdPx = 80,
  mobileKeyboardDockMoveSettleMs = 260,
  mobileKeyboardResizeSettleMs = mobileKeyboardDockMoveSettleMs + 140,
  mobileKeyboardDismissRecoveryDelays = [0, 80, 180, 360, 720, 1200],
  mobileOrientationViewportRecoveryDelays = [0, 80, 180, 360, 720],
  mobileOrientationFinalSettleMs = 900,
  lifecycleFactory = createTerminalViewportLifecycle,
} = {}) {
  let disposed = false;
  let started = false;
  let mobileOrientationRecoverySeq = 0;
  let lastMobileViewportOrientation = "";
  let mobileViewportHeight = normalizeViewportPixels(
    windowObject?.visualViewport?.height || windowObject?.innerHeight || 0,
  );
  let mobileViewportReferenceHeight = mobileViewportHeight;
  let mobileKeyboardInsetBottom = 0;
  let mobileClientBottomSafeOffset = 0;
  let mobileKeyboardViewportActive = false;
  let mobileKeyboardResizeSuppressedUntil = 0;
  let mobileKeyboardDismissRecoverySeq = 0;
  let terminalInputViewportLockSession = null;
  const lifecycle = lifecycleFactory({ windowObject, documentObject });
  const now = () => Number(windowObject?.performance?.now?.() || Date.now());
  const isHTMLElement = (value) => {
    const HTMLElementImpl = windowObject?.HTMLElement || globalThis.HTMLElement;
    return typeof HTMLElementImpl === "function" && value instanceof HTMLElementImpl;
  };

  const usesMobileViewportInsets = () => (
    !isForcePCModeActive()
    && (isIOSPlatform(navigatorObject) || isAndroidPlatform(navigatorObject))
  );

  const isMobileKeyboardResizeSuppressed = () => (
    isTouchShortcutLayout()
    && (mobileKeyboardViewportActive || now() < mobileKeyboardResizeSuppressedUntil)
  );

  const syncTerminalViewportPan = (session) => {
    const panY = terminalViewportPanY(session, {
      resizeSuppressed: isMobileKeyboardResizeSuppressed(),
      viewportReferenceHeight: mobileViewportReferenceHeight,
      viewportHeight: mobileViewportHeight,
      isHostElement: isHTMLElement,
    });
    const transform = panY > 0 ? `translate3d(0, -${panY}px, 0)` : "";
    const term = session?.term;
    const canvas = term?.canvas || term?.renderer?.getCanvas?.();
    const textarea = term?.textarea;
    const preview = session?.compositionPreview;
    for (const node of [canvas, textarea, preview]) {
      if (isHTMLElement(node)) {
        node.style.transform = transform;
        node.style.willChange = transform ? "transform" : "";
      }
    }
    return panY;
  };

  const activeTerminalInputViewportLock = () => {
    const session = terminalInputViewportLockSession;
    const textarea = session?.term?.textarea;
    if (!session?.inputViewportLock || documentObject?.activeElement !== textarea) {
      return null;
    }
    return { session, ...session.inputViewportLock };
  };

  const scheduleMobileViewportResize = () => {
    lifecycle.frame("mobile-viewport-resize", () => {
      handleMobileViewportResize();
    });
  };

  const releaseTerminalInputViewportLock = (session, { resync = true } = {}) => {
    if (!session) {
      return false;
    }
    session.inputViewportLock = null;
    if (terminalInputViewportLockSession === session) {
      terminalInputViewportLockSession = null;
    }
    if (!resync || !isTouchShortcutLayout()) {
      return true;
    }
    lifecycle.frame("terminal-input-lock-release", () => {
      if (session.closed || documentObject?.activeElement === session.term?.textarea) {
        return;
      }
      syncMobileVisualViewport({ detectOrientation: false, ignoreTerminalInputLock: true });
      scheduleMobileViewportResize();
    });
    return true;
  };

  const captureTerminalInputViewportLock = (session) => {
    if (!session || session.inputViewportLock || !isTouchShortcutLayout()) {
      return false;
    }
    syncMobileVisualViewport({ detectOrientation: false, ignoreTerminalInputLock: true });
    session.inputViewportLock = {
      viewportHeight: mobileViewportHeight,
      referenceHeight: mobileViewportReferenceHeight,
      keyboardInsetBottom: mobileKeyboardInsetBottom,
      clientBottomSafeOffset: mobileClientBottomSafeOffset,
      keyboardActive: mobileKeyboardViewportActive,
    };
    terminalInputViewportLockSession = session;
    return true;
  };

  const isKeyboardLikeViewportHeightChange = (previousHeight, nextHeight, { orientationChanged = false } = {}) => (
    keyboardLikeViewportHeightChange(previousHeight, nextHeight, {
      touchLayout: isTouchShortcutLayout(),
      orientationChanged,
      thresholdPx: mobileKeyboardInsetThresholdPx,
    })
  );

  const syncActiveTerminalViewportForKeyboard = () => {
    const session = getActiveSession();
    resetHostViewport(session, { clean: true });
    positionInput(session);
    syncTerminalViewportPan(session);
    updateSelectionHandles(session);
    updateSelection();
    if (isMobileMenuOpen()) {
      renderMobileMenu();
    }
    scheduleOverviewRender();
  };

  const releaseMobileKeyboardResizeSuppression = () => {
    const remaining = mobileKeyboardResizeSuppressedUntil - now();
    if (remaining > 0) {
      lifecycle.timeout(
        "mobile-keyboard-resize-release",
        releaseMobileKeyboardResizeSuppression,
        Math.ceil(remaining),
      );
      return;
    }
    if (mobileKeyboardViewportActive) {
      syncActiveTerminalViewportForKeyboard();
      return;
    }
    syncTerminalViewportPan(getActiveSession());
    resizeActiveTabForCurrentDevice({ forceFullRender: true, hideUntilRender: true });
  };

  const armMobileKeyboardResizeSuppression = () => {
    mobileKeyboardResizeSuppressedUntil = Math.max(
      mobileKeyboardResizeSuppressedUntil,
      now() + mobileKeyboardResizeSettleMs,
    );
    lifecycle.timeout(
      "mobile-keyboard-resize-release",
      releaseMobileKeyboardResizeSuppression,
      mobileKeyboardResizeSettleMs,
    );
  };

  const currentMobileViewportOrientation = () => readMobileViewportOrientation({
    windowObject,
    documentObject,
  });

  const rememberMobileViewportOrientationChange = () => {
    if (!isTouchShortcutLayout()) {
      return false;
    }
    const orientation = currentMobileViewportOrientation();
    if (!orientation) {
      return false;
    }
    if (!lastMobileViewportOrientation) {
      lastMobileViewportOrientation = orientation;
      return false;
    }
    if (lastMobileViewportOrientation === orientation) {
      return false;
    }
    lastMobileViewportOrientation = orientation;
    return true;
  };

  const runMobileOrientationViewportRecoveryPass = (seq) => {
    if (seq !== mobileOrientationRecoverySeq) {
      return;
    }
    syncMobileVisualViewport({ detectOrientation: false });
    resizeActiveTabForCurrentDevice();
    updateActiveTabTitle();
    updateSelection();
  };

  const scheduleMobileOrientationViewportRecovery = () => {
    if (!isTouchShortcutLayout() || !hasActivePanes()) {
      return false;
    }
    mobileOrientationRecoverySeq += 1;
    const seq = mobileOrientationRecoverySeq;
    for (const delay of mobileOrientationViewportRecoveryDelays) {
      lifecycle.timeout(
        `mobile-orientation-pass:${seq}:${delay}`,
        () => runMobileOrientationViewportRecoveryPass(seq),
        delay,
      );
    }
    lifecycle.timeout("mobile-orientation-final", () => {
      if (seq !== mobileOrientationRecoverySeq) {
        return;
      }
      runMobileOrientationViewportRecoveryPass(seq);
    }, mobileOrientationFinalSettleMs);
    return true;
  };

  const handleMobileViewportResize = () => {
    if (isMobileKeyboardResizeSuppressed()) {
      syncActiveTerminalViewportForKeyboard();
      if (rememberMobileViewportOrientationChange() || lifecycle.hasTimeout("mobile-orientation-final")) {
        scheduleMobileOrientationViewportRecovery();
      }
      return;
    }
    resizeActiveTabForCurrentDevice();
    const session = getActiveSession();
    positionInput(session);
    syncTerminalViewportPan(session);
    updateSelectionHandles(session);
    updateSelection();
    if (isMobileMenuOpen()) {
      renderMobileMenu();
    }
    scheduleOverviewRender();
    if (rememberMobileViewportOrientationChange() || lifecycle.hasTimeout("mobile-orientation-final")) {
      scheduleMobileOrientationViewportRecovery();
    }
  };

  const isTerminalTextareaFocused = () => {
    const activeElement = documentObject?.activeElement;
    if (!isHTMLElement(activeElement)) {
      return false;
    }
    for (const session of getSessions()) {
      if (session?.term?.textarea === activeElement) {
        return true;
      }
    }
    return false;
  };

  const measureMobileViewportBottomInset = () => readMobileViewportBottomInset({
    windowObject,
    documentObject,
  });

  const forceClearMobileKeyboardDockIfTerminalBlurred = () => {
    if (!usesMobileViewportInsets() || isTerminalTextareaFocused()) {
      return false;
    }
    if (mobileKeyboardInsetBottom === 0 && mobileClientBottomSafeOffset === 0 && !mobileKeyboardViewportActive) {
      return false;
    }
    const measuredBottomInset = measureMobileViewportBottomInset();
    const nextSafeOffset = measuredBottomInset > 0 && measuredBottomInset <= mobileKeyboardInsetThresholdPx
      ? measuredBottomInset
      : 0;
    const changed = applyMobileViewportInsets(0, nextSafeOffset, { keyboardActive: false });
    if (changed) {
      scheduleMobileViewportResize();
    }
    return changed;
  };

  const runMobileKeyboardDismissRecoveryPass = (seq, { force = false } = {}) => {
    if (seq !== mobileKeyboardDismissRecoverySeq || !usesMobileViewportInsets()) {
      return;
    }
    syncMobileVisualViewport({ detectOrientation: false });
    if (force) {
      forceClearMobileKeyboardDockIfTerminalBlurred();
    }
  };

  const scheduleMobileKeyboardDismissRecovery = () => {
    if (!usesMobileViewportInsets()) {
      return false;
    }
    mobileKeyboardDismissRecoverySeq += 1;
    const seq = mobileKeyboardDismissRecoverySeq;
    const lastDelay = mobileKeyboardDismissRecoveryDelays[mobileKeyboardDismissRecoveryDelays.length - 1] || 0;
    for (const delay of mobileKeyboardDismissRecoveryDelays) {
      lifecycle.timeout(
        `mobile-keyboard-dismiss:${seq}:${delay}`,
        () => runMobileKeyboardDismissRecoveryPass(seq, { force: delay === lastDelay }),
        delay,
      );
    }
    return true;
  };

  const markMobileKeyboardDockMoving = () => {
    if (!documentObject?.body) {
      return;
    }
    documentObject.body.classList.add("mobile-keyboard-dock-moving");
    lifecycle.timeout("mobile-keyboard-dock-move", () => {
      documentObject.body?.classList.remove("mobile-keyboard-dock-moving");
    }, mobileKeyboardDockMoveSettleMs);
  };

  const syncMobileKeyboardDockTransform = (inset, safeOffset) => {
    if (!isHTMLElement(mobileShortcuts)) {
      return;
    }
    if (inset > mobileKeyboardInsetThresholdPx) {
      mobileShortcuts.style.transform = `translate3d(0, -${inset}px, 0)`;
      return;
    }
    if (safeOffset > 0) {
      mobileShortcuts.style.transform = `translate3d(0, -${safeOffset}px, 0)`;
      return;
    }
    mobileShortcuts.style.transform = "";
  };

  const applyMobileViewportInsets = (nextInset, nextSafeOffset, {
    animateDock = true,
    keyboardActive = null,
  } = {}) => {
    const inset = normalizeViewportPixels(nextInset);
    const safeOffset = normalizeViewportPixels(nextSafeOffset);
    const dockChanged = inset !== mobileKeyboardInsetBottom || safeOffset !== mobileClientBottomSafeOffset;
    const keyboardWasActive = mobileKeyboardViewportActive;
    const keyboardIsActive = keyboardActive === null
      ? inset > mobileKeyboardInsetThresholdPx
      : keyboardActive === true;
    if (keyboardWasActive || keyboardIsActive || dockChanged) {
      armMobileKeyboardResizeSuppression();
    }
    mobileKeyboardInsetBottom = inset;
    mobileClientBottomSafeOffset = safeOffset;
    mobileKeyboardViewportActive = keyboardIsActive;
    documentObject?.documentElement?.style?.setProperty("--mobile-keyboard-inset-bottom", `${inset}px`);
    documentObject?.documentElement?.style?.setProperty("--mobile-client-bottom-safe-offset", `${safeOffset}px`);
    documentObject?.body?.classList.toggle("mobile-keyboard-visible", inset > mobileKeyboardInsetThresholdPx);
    syncMobileKeyboardDockTransform(inset, safeOffset);
    if (dockChanged && animateDock) {
      markMobileKeyboardDockMoving();
    }
    return dockChanged;
  };

  const syncMobileVisualViewport = ({
    detectOrientation = true,
    ignoreTerminalInputLock = false,
  } = {}) => {
    if (disposed) {
      return false;
    }
    const supportsViewportInsets = usesMobileViewportInsets();
    const shouldResizeTerminal = supportsViewportInsets && isTouchShortcutLayout();
    const useKeyboardInset = isIOSPlatform(navigatorObject);
    const visualViewport = windowObject?.visualViewport;
    const nextHeight = normalizeViewportPixels(visualViewport?.height || windowObject?.innerHeight || 0);
    const orientationChanged = detectOrientation && rememberMobileViewportOrientationChange();
    const shouldRecoverOrientation = orientationChanged
      || (detectOrientation && lifecycle.hasTimeout("mobile-orientation-final"));
    if (orientationChanged && terminalInputViewportLockSession) {
      terminalInputViewportLockSession.terminalInputAnchor = null;
      releaseTerminalInputViewportLock(terminalInputViewportLockSession, { resync: false });
    }
    let inputLock = ignoreTerminalInputLock ? null : activeTerminalInputViewportLock();
    const lockedViewportBottomInset = inputLock ? measureMobileViewportBottomInset() : 0;
    const keyboardOpenedAfterLock = Boolean(
      inputLock
      && !inputLock.keyboardActive
      && documentObject?.activeElement === inputLock.session?.term?.textarea
      && (
        Number(inputLock.viewportHeight || 0) - nextHeight > mobileKeyboardInsetThresholdPx
        || lockedViewportBottomInset > mobileKeyboardInsetThresholdPx
      )
    );
    if (keyboardOpenedAfterLock) {
      const promotedKeyboardInset = useKeyboardInset ? lockedViewportBottomInset : 0;
      const promotedSafeOffset = promotedKeyboardInset === 0
        && lockedViewportBottomInset > 0
        && lockedViewportBottomInset <= mobileKeyboardInsetThresholdPx
        ? lockedViewportBottomInset
        : 0;
      inputLock.session.inputViewportLock = {
        ...inputLock.session.inputViewportLock,
        viewportHeight: nextHeight,
        keyboardInsetBottom: promotedKeyboardInset,
        clientBottomSafeOffset: promotedSafeOffset,
        keyboardActive: true,
      };
      inputLock = { session: inputLock.session, ...inputLock.session.inputViewportLock };
    }
    if (
      inputLock?.keyboardActive
      && nextHeight - inputLock.viewportHeight > mobileKeyboardInsetThresholdPx
      && lockedViewportBottomInset <= mobileKeyboardInsetThresholdPx
    ) {
      releaseTerminalInputViewportLock(inputLock.session, { resync: false });
      inputLock = null;
    }
    const appliedHeight = inputLock?.viewportHeight || nextHeight;
    if (appliedHeight > 0) {
      documentObject?.documentElement?.style?.setProperty(
        "--mobile-visual-viewport-height",
        `${appliedHeight}px`,
      );
    }
    if (inputLock && !orientationChanged) {
      mobileViewportHeight = inputLock.viewportHeight;
      mobileViewportReferenceHeight = inputLock.referenceHeight;
      if (
        mobileKeyboardInsetBottom !== inputLock.keyboardInsetBottom
        || mobileClientBottomSafeOffset !== inputLock.clientBottomSafeOffset
        || mobileKeyboardViewportActive !== inputLock.keyboardActive
      ) {
        applyMobileViewportInsets(
          inputLock.keyboardInsetBottom,
          inputLock.clientBottomSafeOffset,
          { animateDock: false, keyboardActive: inputLock.keyboardActive },
        );
      }
      syncTerminalViewportPan(inputLock.session);
      return true;
    }
    if (orientationChanged && nextHeight > 0) {
      mobileViewportReferenceHeight = nextHeight;
    }
    if (!supportsViewportInsets) {
      const previousHeight = mobileViewportHeight;
      const insetChanged = mobileKeyboardInsetBottom !== 0;
      const safeOffsetChanged = mobileClientBottomSafeOffset !== 0;
      const heightChanged = nextHeight !== mobileViewportHeight;
      const keyboardLikeHeightChange = isKeyboardLikeViewportHeightChange(
        previousHeight,
        nextHeight,
        { orientationChanged },
      );
      mobileViewportHeight = nextHeight;
      mobileViewportReferenceHeight = nextHeight;
      applyMobileViewportInsets(0, 0, {
        animateDock: false,
        keyboardActive: keyboardLikeHeightChange && nextHeight < previousHeight,
      });
      if (keyboardLikeHeightChange) {
        armMobileKeyboardResizeSuppression();
      }
      if (shouldResizeTerminal && (heightChanged || insetChanged || safeOffsetChanged)) {
        scheduleMobileViewportResize();
      }
      if (shouldRecoverOrientation) {
        scheduleMobileOrientationViewportRecovery();
      }
      return true;
    }
    const viewportOffsetTop = normalizeViewportPixels(visualViewport?.offsetTop);
    const measuredBottomInset = measureMobileViewportBottomInset();
    const measuredReferenceInset = visualViewport
      ? normalizeViewportPixels(
        (mobileViewportReferenceHeight || nextHeight) - visualViewport.height - viewportOffsetTop,
      )
      : 0;
    const shouldTrustReferenceInset = isTouchShortcutLayout() && (
      isTerminalTextareaFocused()
      || (mobileKeyboardViewportActive && measuredBottomInset > mobileKeyboardInsetThresholdPx)
    );
    const measuredInset = Math.max(
      measuredBottomInset,
      shouldTrustReferenceInset ? measuredReferenceInset : 0,
    );
    const nextKeyboardActive = measuredInset > mobileKeyboardInsetThresholdPx
      && !orientationChanged
      && isTouchShortcutLayout();
    const nextInset = useKeyboardInset && measuredInset > mobileKeyboardInsetThresholdPx ? measuredInset : 0;
    const nextSafeOffset = nextInset === 0
      && measuredBottomInset > 0
      && measuredBottomInset <= mobileKeyboardInsetThresholdPx
      ? measuredBottomInset
      : 0;
    const heightChanged = nextHeight !== mobileViewportHeight;
    const insetChanged = nextInset !== mobileKeyboardInsetBottom;
    const safeOffsetChanged = nextSafeOffset !== mobileClientBottomSafeOffset;
    if (nextInset === 0 && nextHeight > 0 && (orientationChanged || nextHeight > mobileViewportReferenceHeight)) {
      mobileViewportReferenceHeight = nextHeight;
    }
    mobileViewportHeight = nextHeight;
    applyMobileViewportInsets(nextInset, nextSafeOffset, { keyboardActive: nextKeyboardActive });
    if (
      heightChanged
      && !orientationChanged
      && isTouchShortcutLayout()
      && (nextKeyboardActive || mobileKeyboardViewportActive)
    ) {
      armMobileKeyboardResizeSuppression();
    }
    if (shouldResizeTerminal && (heightChanged || insetChanged || safeOffsetChanged)) {
      scheduleMobileViewportResize();
    }
    if (shouldRecoverOrientation) {
      scheduleMobileOrientationViewportRecovery();
    }
    return true;
  };

  const handleMobileOrientationChange = () => {
    syncMobileVisualViewport();
    rememberMobileViewportOrientationChange();
    scheduleMobileOrientationViewportRecovery();
  };

  const shouldPreventMobileViewportZoom = () => (
    isMobileLayout() || isTouchShortcutLayout() || usesMobileViewportInsets()
  );

  const preventMobileViewportZoom = (event) => {
    if (!shouldPreventMobileViewportZoom()) {
      return;
    }
    const touchCount = Number(event?.touches?.length || 0);
    if (String(event?.type || "").startsWith("gesture") || touchCount > 1) {
      event.preventDefault?.();
    }
  };

  return Object.freeze({
    start() {
      if (disposed || started) {
        return false;
      }
      started = true;
      lifecycle.start({
        onPreventZoom: preventMobileViewportZoom,
        onWindowResize: () => syncMobileVisualViewport(),
        onVisualViewport: () => syncMobileVisualViewport(),
        onOrientationChange: handleMobileOrientationChange,
      }, { listenVisualViewport: usesMobileViewportInsets() });
      syncMobileVisualViewport();
      return true;
    },
    usesInsets: usesMobileViewportInsets,
    isKeyboardActive: () => mobileKeyboardViewportActive,
    isResizeSuppressed: isMobileKeyboardResizeSuppressed,
    sync: syncMobileVisualViewport,
    syncPan: syncTerminalViewportPan,
    captureInputLock: captureTerminalInputViewportLock,
    releaseInputLock: releaseTerminalInputViewportLock,
    scheduleKeyboardDismissRecovery: scheduleMobileKeyboardDismissRecovery,
    handleLayoutChange() {
      if (isForcePCModeActive()) {
        lifecycle.clearTimeout("mobile-keyboard-dock-move");
        documentObject?.body?.classList.remove("mobile-keyboard-visible", "mobile-keyboard-dock-moving");
      }
      return syncMobileVisualViewport({ detectOrientation: false });
    },
    snapshot: () => Object.freeze({
      viewportHeight: mobileViewportHeight,
      viewportReferenceHeight: mobileViewportReferenceHeight,
      keyboardInsetBottom: mobileKeyboardInsetBottom,
      clientBottomSafeOffset: mobileClientBottomSafeOffset,
      keyboardActive: mobileKeyboardViewportActive,
      resizeSuppressed: isMobileKeyboardResizeSuppressed(),
      orientation: lastMobileViewportOrientation,
      inputLocked: Boolean(activeTerminalInputViewportLock()),
    }),
    dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      mobileOrientationRecoverySeq += 1;
      mobileKeyboardDismissRecoverySeq += 1;
      if (terminalInputViewportLockSession) {
        terminalInputViewportLockSession.inputViewportLock = null;
        terminalInputViewportLockSession = null;
      }
      mobileKeyboardViewportActive = false;
      mobileKeyboardResizeSuppressedUntil = 0;
      for (const session of getSessions()) {
        syncTerminalViewportPan(session);
      }
      lifecycle.dispose();
      if (isHTMLElement(mobileShortcuts)) {
        mobileShortcuts.style.transform = "";
      }
      documentObject?.body?.classList.remove("mobile-keyboard-visible", "mobile-keyboard-dock-moving");
      return true;
    },
  });
}
