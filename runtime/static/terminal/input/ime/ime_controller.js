import { createTerminalIMELifecycle } from "./ime_lifecycle.js";
import {
  isAndroidPlatform,
  isBackwardDeleteInputType,
  isForwardDeleteInputType,
  isTerminalASCIICompositionCommit,
  normalizeTerminalCompositionTextCandidates,
  stripTerminalInputSentinel,
  terminalInputDeleteBuffer,
} from "./ime_model.js";

const noop = () => {};

export function createTerminalIMEController({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  navigatorObject = globalThis.navigator,
  getActiveSession = () => null,
  getTerminalFontSize = () => 16,
  getTerminalFontFamily = () => "monospace",
  getTheme = () => ({ foreground: "#ffffff", background: "#000000" }),
  isTouchShortcutLayout = () => false,
  requiresTouchKeyboardDoubleTap = () => false,
  isKeyboardViewportActive = () => false,
  updateActiveTabTitle = noop,
  captureInputViewportLock = noop,
  releaseInputViewportLock = noop,
  scheduleKeyboardDismissRecovery = noop,
  reassertSize = noop,
  claimCurrentDeviceSize = noop,
  scrollToBottom = noop,
  sendInput = noop,
  pasteText = () => Promise.resolve(false),
  showToast = noop,
  shouldApplyStickyTextInput = () => false,
  shouldApplyStickyCompositionInput = () => false,
  consumeStickyInput = (value) => value,
  installKeyOverrides = noop,
  registerSessionCleanup = noop,
  moveThresholdPx = 8,
  doubleTapDelayMs = 320,
  focusAllowWindowMs = 600,
  nativeDeleteIdleResetMs = 900,
  lifecycleFactory = createTerminalIMELifecycle,
} = {}) {
  let disposed = false;
  const lifecycle = lifecycleFactory({ windowObject });
  const cleanupRegistered = new WeakSet();
  const installedSessions = new WeakSet();
  const claimedTouchEnds = new WeakSet();
  const now = () => Number(windowObject.performance?.now?.() || Date.now());
  const isHTMLElement = (value) => {
    const HTMLElementImpl = windowObject.HTMLElement || globalThis.HTMLElement;
    return typeof HTMLElementImpl === "function" && value instanceof HTMLElementImpl;
  };
  const isElement = (value) => {
    const ElementImpl = windowObject.Element || globalThis.Element;
    return typeof ElementImpl === "function" && value instanceof ElementImpl;
  };

  const moveTextareaCaretToEnd = (textarea) => {
    try {
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    } catch (error) {
    }
  };

  const resetHostViewport = (session, { clean = false } = {}) => {
    const host = session?.terminalHost;
    if (!host) {
      return;
    }
    if (host.scrollTop !== 0) {
      host.scrollTop = 0;
    }
    if (host.scrollLeft !== 0) {
      host.scrollLeft = 0;
    }
    if (!clean) {
      return;
    }
    const keep = new Set([
      session.term?.canvas,
      session.term?.textarea,
      session.terminalFrameHold,
      session.compositionPreview,
    ].filter(Boolean));
    for (const node of Array.from(host.childNodes || [])) {
      if (!keep.has(node) && (node.nodeType === 1 || node.nodeType === 3)) {
        node.remove();
      }
    }
  };

  const scheduleHostViewportReset = (session, options = {}) => {
    resetHostViewport(session, options);
    lifecycle.frame(session, () => resetHostViewport(session, options));
  };

  const prepareTextareaForInput = (session) => {
    const textarea = session?.term?.textarea;
    if (!textarea || session.composingIME || session.nativeDeleteInputPending) {
      return;
    }
    if (textarea.value !== terminalInputDeleteBuffer) {
      textarea.value = terminalInputDeleteBuffer;
    }
    moveTextareaCaretToEnd(textarea);
  };

  const clearTextareaSentinel = (session) => {
    const textarea = session?.term?.textarea;
    if (!textarea) {
      return "";
    }
    const value = stripTerminalInputSentinel(textarea.value);
    if (textarea.value !== value) {
      textarea.value = value;
      moveTextareaCaretToEnd(textarea);
    }
    return value;
  };

  const textareaCompositionText = (session) => {
    if (!session) {
      return "";
    }
    const textarea = session.term?.textarea;
    const textareaText = textarea ? stripTerminalInputSentinel(textarea.value) : "";
    if (session.composingIME && typeof session.compositionText === "string") {
      return session.compositionText || textareaText;
    }
    return textarea ? textareaText : "";
  };

  const setTextareaCompositionText = (session, text) => {
    if (!session) {
      return "";
    }
    const normalized = stripTerminalInputSentinel(text);
    const previous = typeof session.compositionText === "string" ? session.compositionText : "";
    if (normalized && normalized !== previous) {
      session.compositionPreviousText = previous;
      const history = Array.isArray(session.compositionTextHistory) ? session.compositionTextHistory.slice() : [];
      if (!history.includes(normalized)) {
        history.push(normalized);
      }
      session.compositionTextHistory = history.slice(-8);
    }
    session.compositionText = normalized;
    return normalized;
  };

  const compositionPreeditCandidates = (session, ...extraValues) => normalizeTerminalCompositionTextCandidates(
    session?.compositionTextHistory,
    session?.compositionPreviousText,
    session?.compositionText,
    extraValues,
  );

  const setCompositionPreviewVisible = (session, visible) => {
    const preview = session?.compositionPreview;
    if (!preview) {
      return;
    }
    preview.hidden = !visible;
    if (!visible) {
      preview.textContent = "";
    }
  };

  const syncCompositionPreview = (session, {
    x = 0,
    y = 0,
    width = 1,
    height = 16,
    maxWidth = width,
  } = {}) => {
    const preview = session?.compositionPreview;
    if (!preview) {
      return;
    }
    if (session.terminalHost && preview.parentElement !== session.terminalHost) {
      session.terminalHost.appendChild(preview);
    }
    const text = session.composingIME ? textareaCompositionText(session) : "";
    if (!text) {
      setCompositionPreviewVisible(session, false);
      return;
    }
    preview.textContent = text;
    preview.style.left = `${x}px`;
    preview.style.top = `${y}px`;
    preview.style.minWidth = `${Math.max(width, 2)}px`;
    preview.style.maxWidth = `${Math.max(maxWidth, width, 2)}px`;
    preview.style.height = `${height}px`;
    preview.style.font = `${getTerminalFontSize()}px ${getTerminalFontFamily()}`;
    preview.style.lineHeight = `${height}px`;
    preview.style.boxSizing = "border-box";
    const theme = getTheme();
    preview.style.color = theme.foreground;
    preview.style.background = theme.background;
    setCompositionPreviewVisible(session, true);
  };

  const positionInput = (session) => {
    const term = session?.term;
    const textarea = term?.textarea;
    const renderer = term?.renderer;
    const cursor = term?.wasmTerm?.getCursor?.();
    const metrics = renderer?.getMetrics?.();
    if (!textarea || !cursor || !metrics) {
      return;
    }
    const width = Math.max(1, Number(metrics.width) || 1);
    const height = Math.max(1, Number(metrics.height) || Number(getTerminalFontSize()) || 16);
    const cursorX = Math.max(0, Math.min(Math.max(0, (term.cols || 1) - 1), Number(cursor.x) || 0));
    const cursorY = Math.max(0, Math.min(Math.max(0, (term.rows || 1) - 1), Number(cursor.y) || 0));
    const previewLeft = cursorX * width;
    const previewTop = cursorY * height;
    const hostWidth = Math.max(width, Number(session.terminalHost?.clientWidth) || (Number(term.cols) || 1) * width);
    const hostHeight = Math.max(height, Number(session.terminalHost?.clientHeight) || (Number(term.rows) || 1) * height);
    const preserveAnchor = documentObject.activeElement === textarea;
    const previousAnchor = preserveAnchor ? session.terminalInputAnchor : null;
    const anchorTop = Math.max(0, Math.min(hostHeight - height, Number(previousAnchor?.top ?? previewTop) || 0));
    const anchorIndent = Math.max(0, Math.min(hostWidth - width, Number(previousAnchor?.indent ?? previewLeft) || 0));
    session.terminalInputAnchor = { top: anchorTop, indent: anchorIndent };
    textarea.setAttribute("rows", "1");
    textarea.setAttribute("wrap", "off");
    textarea.style.position = "absolute";
    textarea.style.left = "0px";
    textarea.style.top = `${anchorTop}px`;
    textarea.style.width = `${Math.max(hostWidth, 2)}px`;
    textarea.style.minWidth = `${Math.max(hostWidth, 2)}px`;
    textarea.style.maxWidth = `${Math.max(hostWidth, 2)}px`;
    textarea.style.height = `${height}px`;
    textarea.style.minHeight = `${height}px`;
    textarea.style.maxHeight = `${height}px`;
    textarea.style.font = `${getTerminalFontSize()}px ${getTerminalFontFamily()}`;
    textarea.style.lineHeight = `${height}px`;
    textarea.style.padding = "0";
    textarea.style.border = "0";
    textarea.style.outline = "0";
    textarea.style.boxShadow = "none";
    textarea.style.appearance = "none";
    textarea.style.webkitAppearance = "none";
    textarea.style.margin = "0";
    textarea.style.boxSizing = "border-box";
    textarea.style.opacity = "0.01";
    textarea.style.clipPath = "none";
    textarea.style.overflow = "hidden";
    textarea.style.overflowX = "hidden";
    textarea.style.overflowY = "hidden";
    textarea.style.whiteSpace = "pre";
    textarea.style.overflowWrap = "normal";
    textarea.style.wordBreak = "normal";
    textarea.style.textIndent = `${anchorIndent}px`;
    textarea.style.resize = "none";
    textarea.style.color = "transparent";
    textarea.style.background = "transparent";
    textarea.style.caretColor = "transparent";
    textarea.style.pointerEvents = "none";
    textarea.style.zIndex = "3";
    if (textarea.scrollTop !== 0) {
      textarea.scrollTop = 0;
    }
    prepareTextareaForInput(session);
    syncCompositionPreview(session, {
      x: previewLeft,
      y: previewTop,
      width,
      height,
      maxWidth: Math.max(width, hostWidth - previewLeft),
    });
  };

  const requestAndroidSoftKeyboard = (textarea) => {
    if (!isAndroidPlatform(navigatorObject) || documentObject.activeElement !== textarea) {
      return false;
    }
    const keyboard = navigatorObject.virtualKeyboard;
    if (!keyboard || typeof keyboard.show !== "function") {
      return false;
    }
    try {
      const result = keyboard.show();
      result?.catch?.(() => {});
      return true;
    } catch (error) {
      return false;
    }
  };

  const blurInput = (session) => {
    const textarea = session?.term?.textarea;
    const host = session?.terminalHost;
    const shell = session?.shellEl;
    textarea?.blur?.();
    host?.blur?.();
    shell?.blur?.();
    const activeElement = documentObject.activeElement;
    if (isHTMLElement(activeElement) && (host?.contains(activeElement) || shell?.contains(activeElement))) {
      activeElement.blur();
    }
    updateActiveTabTitle();
    scheduleKeyboardDismissRecovery();
  };

  const focusInput = (session, {
    requestMobileKeyboard = false,
    forceMobileFocusTransition = false,
    focusSource = "user",
  } = {}) => {
    const textarea = session?.term?.textarea;
    if (!textarea || disposed) {
      return false;
    }
    if (requiresTouchKeyboardDoubleTap() && focusSource === "system") {
      if (documentObject.activeElement !== textarea) {
        return false;
      }
      positionInput(session);
      resetHostViewport(session, { clean: true });
      updateActiveTabTitle();
      return true;
    }
    if (requiresTouchKeyboardDoubleTap() && now() > Number(session?.allowMobileKeyboardFocusUntil || 0)) {
      blurInput(session);
      return false;
    }
    const activateAndroidKeyboard = requestMobileKeyboard && isAndroidPlatform(navigatorObject);
    if (
      activateAndroidKeyboard
      && forceMobileFocusTransition
      && documentObject.activeElement === textarea
      && !session.composingIME
    ) {
      textarea.blur();
    }
    if (documentObject.activeElement !== textarea) {
      session.terminalInputAnchor = null;
    }
    positionInput(session);
    const previousPointerEvents = textarea.style.pointerEvents;
    if (activateAndroidKeyboard) {
      textarea.style.pointerEvents = "auto";
    }
    try {
      try {
        textarea.focus({ preventScroll: true });
      } catch (error) {
        textarea.focus();
      }
      prepareTextareaForInput(session);
      if (requestMobileKeyboard) {
        requestAndroidSoftKeyboard(textarea);
      }
    } finally {
      if (activateAndroidKeyboard) {
        textarea.style.pointerEvents = previousPointerEvents || "none";
      }
    }
    resetHostViewport(session, { clean: true });
    updateActiveTabTitle();
    return documentObject.activeElement === textarea;
  };

  const setComposing = (session, composing) => {
    const wasComposing = Boolean(session.composingIME);
    if (composing && !session.inputViewportLock) {
      captureInputViewportLock(session);
    }
    session.composingIME = composing;
    if (composing) {
      if (!wasComposing) {
        session.compositionPreviousText = "";
        session.compositionTextHistory = [];
      }
      if (typeof session.compositionText !== "string") {
        session.compositionText = "";
      }
    } else {
      session.compositionText = "";
      setCompositionPreviewVisible(session, false);
    }
    if (session.term?.inputHandler) {
      session.term.inputHandler.isComposing = composing;
    }
  };

  const clearPostCompositionInput = (session) => {
    if (session) {
      session.pendingCompositionInput = null;
    }
  };

  const isPostCompositionInputAlreadySent = (session, committed) => {
    const pending = session?.pendingCompositionInput;
    const committedText = stripTerminalInputSentinel(committed);
    if (!pending?.sent || !committedText) {
      return false;
    }
    if (now() > Number(pending.expiresAt || 0)) {
      clearPostCompositionInput(session);
      return false;
    }
    return pending.committed === committedText;
  };

  const armPostCompositionInput = (session, {
    preedit = "",
    preedits = [],
    committed = "",
    sent = false,
    suppressSeparator = false,
  } = {}) => {
    if (!session) {
      return null;
    }
    const preeditCandidates = normalizeTerminalCompositionTextCandidates(preedits, preedit);
    const pending = {
      preedit: preeditCandidates[0] || "",
      preedits: preeditCandidates,
      committed: stripTerminalInputSentinel(committed),
      sent: Boolean(sent),
      suppressSeparator: Boolean(suppressSeparator),
      expiresAt: now() + 350,
    };
    session.pendingCompositionInput = pending;
    return pending;
  };

  const resolvePostCompositionInput = (session, value) => {
    const pending = session?.pendingCompositionInput;
    if (!pending) {
      return null;
    }
    if (now() > Number(pending.expiresAt || 0)) {
      clearPostCompositionInput(session);
      return null;
    }
    const rawValue = stripTerminalInputSentinel(value);
    const preedits = normalizeTerminalCompositionTextCandidates(pending.preedits, pending.preedit);
    const committed = pending.committed || "";
    let data = rawValue;
    let handled = false;
    if (!rawValue) {
      data = "";
      handled = true;
    } else if (pending.sent) {
      if (
        (committed && rawValue === committed)
        || preedits.includes(rawValue)
        || (committed && preedits.some((preedit) => rawValue === `${preedit}${committed}`))
        || (pending.suppressSeparator && rawValue === " ")
      ) {
        data = "";
        handled = true;
      }
    } else if (committed && rawValue === committed) {
      data = committed;
      handled = true;
    } else if (committed && preedits.some((preedit) => rawValue === `${preedit}${committed}`)) {
      data = committed;
      handled = true;
    } else {
      const preeditPrefix = preedits.find((preedit) => rawValue.startsWith(preedit) && rawValue.length > preedit.length);
      if (preedits.includes(rawValue)) {
        data = rawValue;
        handled = true;
      } else if (preeditPrefix && preedits.includes(rawValue.slice(preeditPrefix.length))) {
        data = rawValue.slice(preeditPrefix.length);
        handled = true;
      } else if (preeditPrefix && preedits.length === 1) {
        data = rawValue.slice(preeditPrefix.length);
        handled = true;
      } else if (!committed) {
        data = rawValue;
        handled = true;
      }
    }
    if (handled) {
      if (!data) {
        return "";
      }
      clearPostCompositionInput(session);
      return data;
    }
    if (pending.sent) {
      clearPostCompositionInput(session);
    }
    return null;
  };

  const rememberPostCompositionSentInput = (session, pending, committed) => {
    const committedText = stripTerminalInputSentinel(committed);
    if (!session || !committedText) {
      return;
    }
    armPostCompositionInput(session, {
      preedits: pending?.preedits || pending?.preedit || "",
      committed: committedText,
      sent: true,
      suppressSeparator: Boolean(pending?.suppressSeparator),
    });
  };

  const sendTextInput = (session, data, { dedupe = false, applySticky = false } = {}) => {
    const rawData = String(data || "");
    if (!session || !rawData) {
      return;
    }
    const currentTime = now();
    const last = session.lastTextInput;
    if (dedupe && (last?.data === rawData || last?.rawData === rawData) && currentTime - last.time < 80) {
      return;
    }
    const inputData = applySticky ? consumeStickyInput(rawData) : rawData;
    if (!inputData) {
      return;
    }
    if (dedupe) {
      session.lastTextInput = { data: inputData, rawData, time: currentTime };
    }
    sendInput(session, inputData);
  };

  const resetTextareaValue = (session) => {
    const textarea = session?.term?.textarea;
    if (!textarea || session.composingIME || session.nativeDeleteInputPending) {
      return;
    }
    textarea.value = terminalInputDeleteBuffer;
    moveTextareaCaretToEnd(textarea);
    positionInput(session);
  };

  const endNativeDeleteInput = (session, { reset = true } = {}) => {
    if (!session) {
      return;
    }
    if (session.nativeDeleteResetTimer) {
      windowObject.clearTimeout(session.nativeDeleteResetTimer);
      session.nativeDeleteResetTimer = 0;
    }
    session.nativeDeleteInputPending = false;
    if (reset) {
      resetTextareaValue(session);
    }
  };

  const armNativeDeleteInput = (session) => {
    if (!session) {
      return;
    }
    session.nativeDeleteInputPending = true;
    if (session.nativeDeleteResetTimer) {
      windowObject.clearTimeout(session.nativeDeleteResetTimer);
    }
    session.nativeDeleteResetTimer = windowObject.setTimeout(() => {
      session.nativeDeleteResetTimer = 0;
      if (lifecycle.isBound(session)) {
        endNativeDeleteInput(session);
      }
    }, nativeDeleteIdleResetMs);
  };

  const handleBeforeInput = (session, event) => {
    reassertSize(session, { force: true });
    const type = String(event.inputType || "");
    const textarea = session?.term?.textarea;
    if (
      isBackwardDeleteInputType(type)
      && (!session?.composingIME || session?.pendingCompositionInput?.sent)
    ) {
      clearPostCompositionInput(session);
      if (session?.composingIME) {
        setComposing(session, false);
      }
      armNativeDeleteInput(session);
      sendTextInput(session, "\x7f");
      event.stopImmediatePropagation();
      return;
    }
    if (session?.nativeDeleteInputPending) {
      endNativeDeleteInput(session);
    }
    if (
      type === "insertText"
      && event.data === " "
      && session?.pendingCompositionInput?.sent
      && session.pendingCompositionInput.suppressSeparator
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setComposing(session, false);
      if (textarea) {
        textarea.value = terminalInputDeleteBuffer;
        moveTextareaCaretToEnd(textarea);
      }
      resetHostViewport(session, { clean: true });
      positionInput(session);
      return;
    }
    if (type === "insertCompositionText" || type === "deleteCompositionText" || event.isComposing) {
      setComposing(session, true);
      if (typeof event.data === "string") {
        setTextareaCompositionText(session, event.data);
      }
      scrollToBottom(session);
      clearTextareaSentinel(session);
      positionInput(session);
      scheduleHostViewportReset(session, { clean: true });
      event.stopImmediatePropagation();
      return;
    }
    positionInput(session);
    let data = "";
    if (isBackwardDeleteInputType(type)) {
      data = "\x7f";
    } else if (isForwardDeleteInputType(type)) {
      data = "\x1b[3~";
    } else if (type === "insertLineBreak" || type === "insertParagraph") {
      data = "\r";
    } else if (type === "insertText" || type === "insertReplacementText") {
      data = event.data || "";
    } else if (type === "insertFromPaste") {
      const text = event.dataTransfer?.getData("text/plain") || event.data || "";
      const recentlyHandledPaste = text
        && session?.lastPasteText === text
        && now() - Number(session?.lastPasteAt || 0) < 150;
      event.preventDefault();
      event.stopImmediatePropagation();
      setComposing(session, false);
      if (textarea) {
        textarea.value = terminalInputDeleteBuffer;
        moveTextareaCaretToEnd(textarea);
      }
      if (text && !recentlyHandledPaste) {
        session.lastPasteText = text;
        session.lastPasteAt = now();
        Promise.resolve(pasteText(session, text)).catch((error) => showToast(error.message));
      }
      resetHostViewport(session, { clean: true });
      positionInput(session);
      return;
    } else if (event.data) {
      data = event.data;
    }
    if (data && session?.composingIME && (type === "insertText" || type === "insertReplacementText")) {
      const textareaPreeditText = textarea ? stripTerminalInputSentinel(textarea.value) : "";
      const preeditCandidates = compositionPreeditCandidates(session, textareaPreeditText);
      event.preventDefault();
      event.stopImmediatePropagation();
      setComposing(session, false);
      armPostCompositionInput(session, {
        preedits: preeditCandidates,
        committed: data,
        sent: true,
        suppressSeparator: isTerminalASCIICompositionCommit(data),
      });
      if (textarea) {
        textarea.value = terminalInputDeleteBuffer;
        moveTextareaCaretToEnd(textarea);
      }
      sendTextInput(session, data, {
        dedupe: true,
        applySticky: shouldApplyStickyCompositionInput(data),
      });
      resetHostViewport(session, { clean: true });
      positionInput(session);
      return;
    }
    const pendingComposition = session?.pendingCompositionInput;
    const compositionValue = data ? resolvePostCompositionInput(session, data) : null;
    if (compositionValue !== null) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setComposing(session, false);
      if (textarea) {
        textarea.value = terminalInputDeleteBuffer;
        moveTextareaCaretToEnd(textarea);
      }
      if (compositionValue) {
        sendTextInput(session, compositionValue, {
          dedupe: true,
          applySticky: shouldApplyStickyCompositionInput(compositionValue),
        });
        rememberPostCompositionSentInput(session, pendingComposition, compositionValue);
      }
      resetHostViewport(session, { clean: true });
      positionInput(session);
      return;
    }
    if (!data) {
      if (type.startsWith("insert") || type.startsWith("delete")) {
        event.stopImmediatePropagation();
      }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    setComposing(session, false);
    if (textarea) {
      textarea.value = terminalInputDeleteBuffer;
      moveTextareaCaretToEnd(textarea);
    }
    sendTextInput(session, data, {
      dedupe: type === "insertText" || type === "insertReplacementText" || Boolean(event.data),
      applySticky: shouldApplyStickyTextInput(data, type),
    });
    resetHostViewport(session, { clean: true });
    positionInput(session);
  };

  const handleTextareaInput = (session, event) => {
    event.stopPropagation();
    reassertSize(session);
    const textarea = session?.term?.textarea;
    if (!textarea) {
      return;
    }
    const type = String(event.inputType || "");
    if (session.composingIME) {
      clearPostCompositionInput(session);
      const value = stripTerminalInputSentinel(textarea.value);
      if (value) {
        setTextareaCompositionText(session, value);
      }
      resetHostViewport(session, { clean: true });
      positionInput(session);
      return;
    }
    const value = stripTerminalInputSentinel(textarea.value);
    if (isBackwardDeleteInputType(type) || (session.nativeDeleteInputPending && !type)) {
      const handledByBeforeInput = Boolean(session.nativeDeleteInputPending);
      if (!handledByBeforeInput) {
        sendTextInput(session, "\x7f");
      }
      armNativeDeleteInput(session);
      resetHostViewport(session, { clean: true });
      positionInput(session);
      return;
    }
    const pendingComposition = session?.pendingCompositionInput;
    const compositionValue = (value || (!isBackwardDeleteInputType(type) && !isForwardDeleteInputType(type)))
      ? resolvePostCompositionInput(session, value)
      : null;
    if (compositionValue !== null) {
      if (compositionValue) {
        sendTextInput(session, compositionValue, {
          dedupe: true,
          applySticky: shouldApplyStickyCompositionInput(compositionValue),
        });
        rememberPostCompositionSentInput(session, pendingComposition, compositionValue);
      }
    } else if (!value && isBackwardDeleteInputType(type)) {
      sendTextInput(session, "\x7f");
    } else if (!value && isForwardDeleteInputType(type)) {
      sendTextInput(session, "\x1b[3~");
    } else if (value) {
      sendTextInput(session, value, {
        dedupe: true,
        applySticky: shouldApplyStickyTextInput(value, type),
      });
    }
    textarea.value = terminalInputDeleteBuffer;
    moveTextareaCaretToEnd(textarea);
    resetHostViewport(session, { clean: true });
    positionInput(session);
  };

  const detachHostCompositionListeners = (session) => {
    const host = session?.terminalHost;
    const handler = session?.term?.inputHandler;
    if (!host || !handler || handler.webshellCompositionDetached) {
      return;
    }
    const compositionListeners = [
      ["compositionstart", "compositionStartListener"],
      ["compositionupdate", "compositionUpdateListener"],
      ["compositionend", "compositionEndListener"],
    ];
    for (const [type, key] of compositionListeners) {
      const listener = handler[key];
      if (typeof listener === "function") {
        host.removeEventListener(type, listener);
      }
      handler[key] = null;
    }
    handler.isComposing = false;
    handler.webshellCompositionDetached = true;
  };

  const installHostInputIsolation = (session) => {
    const host = session?.terminalHost;
    if (!host) {
      return;
    }
    host.removeAttribute("contenteditable");
    detachHostCompositionListeners(session);
    const stopHostEditableInput = (event) => {
      if (event.target !== host) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopImmediatePropagation();
      if (event.type === "compositionend") {
        setComposing(session, false);
      }
      scheduleHostViewportReset(session, { clean: true });
      positionInput(session);
    };
    const blockedHostInputEvents = ["beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"];
    const interceptTextareaBeforeInput = (event) => {
      if (event.target !== session?.term?.textarea) {
        return;
      }
      handleBeforeInput(session, event);
      event.stopImmediatePropagation();
    };
    lifecycle.listen(session, host, "beforeinput", interceptTextareaBeforeInput, { capture: true });
    for (const type of blockedHostInputEvents) {
      lifecycle.listen(session, host, type, stopHostEditableInput, { capture: true });
    }
  };

  const installInputFocus = (session) => {
    const term = session?.term;
    const host = session?.terminalHost;
    const shell = session?.shellEl;
    const textarea = term?.textarea;
    if (!term || !host || !shell || !textarea) {
      return;
    }
    textarea.setAttribute("inputmode", "text");
    textarea.setAttribute("enterkeyhint", "enter");
    textarea.setAttribute("rows", "1");
    textarea.setAttribute("wrap", "off");
    term.focus = () => focusInput(session, { focusSource: "system" });
    lifecycle.listen(session, textarea, "focus", () => {
      positionInput(session);
      updateActiveTabTitle();
    });
    lifecycle.listen(session, textarea, "blur", () => {
      session.terminalInputAnchor = null;
      releaseInputViewportLock(session);
      updateActiveTabTitle();
      scheduleKeyboardDismissRecovery();
    });
    let lastMobileTapAt = 0;
    let lastMobileTapX = 0;
    let lastMobileTapY = 0;
    let mobileTapTouchState = null;
    let mobileTapFinishState = null;
    lifecycle.listen(session, host, "keydown", () => {
      reassertSize(session, { force: true });
    }, { capture: true });
    lifecycle.listen(session, textarea, "beforeinput", (event) => {
      handleBeforeInput(session, event);
    }, { capture: true });
    lifecycle.listen(session, textarea, "compositionstart", (event) => {
      event.stopPropagation();
      scrollToBottom(session);
      clearTextareaSentinel(session);
      clearPostCompositionInput(session);
      setComposing(session, true);
      session.compositionTextHistory = [];
      session.compositionPreviousText = "";
      setTextareaCompositionText(session, "");
      positionInput(session);
      scheduleHostViewportReset(session, { clean: true });
    }, { capture: true });
    lifecycle.listen(session, textarea, "compositionupdate", (event) => {
      event.stopPropagation();
      setComposing(session, true);
      if (typeof event.data === "string") {
        setTextareaCompositionText(session, event.data);
      }
      positionInput(session);
      scheduleHostViewportReset(session, { clean: true });
    }, { capture: true });
    lifecycle.listen(session, textarea, "compositionend", (event) => {
      event.stopPropagation();
      const preeditText = textareaCompositionText(session);
      const textareaPreeditText = stripTerminalInputSentinel(textarea.value);
      const preeditCandidates = compositionPreeditCandidates(session, preeditText, textareaPreeditText);
      const committedText = typeof event.data === "string" ? stripTerminalInputSentinel(event.data) : "";
      const committedAlreadySent = isPostCompositionInputAlreadySent(session, committedText);
      setComposing(session, false);
      armPostCompositionInput(session, {
        preedits: preeditCandidates,
        committed: committedText,
        sent: Boolean(committedText),
        suppressSeparator: isTerminalASCIICompositionCommit(committedText),
      });
      textarea.value = terminalInputDeleteBuffer;
      moveTextareaCaretToEnd(textarea);
      if (committedText && !committedAlreadySent) {
        sendTextInput(session, committedText, {
          dedupe: true,
          applySticky: shouldApplyStickyCompositionInput(committedText),
        });
      }
      lifecycle.timeout(session, () => {
        const fallbackValue = stripTerminalInputSentinel(textarea.value);
        if (fallbackValue) {
          const pendingComposition = session?.pendingCompositionInput;
          const compositionValue = resolvePostCompositionInput(session, fallbackValue);
          if (compositionValue) {
            sendTextInput(session, compositionValue, {
              dedupe: true,
              applySticky: shouldApplyStickyCompositionInput(compositionValue),
            });
            rememberPostCompositionSentInput(session, pendingComposition, compositionValue);
          }
        }
        resetTextareaValue(session);
        resetHostViewport(session, { clean: true });
      }, 0);
    }, { capture: true });
    lifecycle.listen(session, textarea, "input", (event) => {
      handleTextareaInput(session, event);
    }, { capture: true });
    lifecycle.listen(session, textarea, "paste", (event) => {
      const text = event.clipboardData?.getData("text/plain") || "";
      if (!text) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      reassertSize(session, { force: true });
      session.lastPasteText = text;
      session.lastPasteAt = now();
      Promise.resolve(pasteText(session, text)).catch((error) => showToast(error.message));
    }, { capture: true });
    const isTerminalTouchTarget = (target) => isElement(target) && target.closest(".terminal-host") === host;
    const claimCurrentDeviceTerminalSize = (event) => {
      if (
        !isTerminalTouchTarget(event.target)
        || event.isPrimary === false
        || (event.pointerType === "mouse" && event.button !== 0)
      ) {
        return;
      }
      claimCurrentDeviceSize(session);
    };
    lifecycle.listen(session, shell, "pointerdown", claimCurrentDeviceTerminalSize, { capture: true, passive: true });
    lifecycle.listen(session, host, "pointerdown", (event) => {
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        return;
      }
      if (requiresTouchKeyboardDoubleTap()) {
        session.allowMobileKeyboardFocusUntil = now() + focusAllowWindowMs;
      }
      lifecycle.frame(session, () => focusInput(session));
    });
    const startMobileTap = (event) => {
      mobileTapFinishState = null;
      if (!requiresTouchKeyboardDoubleTap() || event.touches.length !== 1 || !isTerminalTouchTarget(event.target)) {
        mobileTapTouchState = null;
        return;
      }
      claimCurrentDeviceSize(session);
      blurInput(session);
      const touch = event.touches[0];
      mobileTapTouchState = { startX: touch.clientX, startY: touch.clientY, moved: false };
    };
    const moveMobileTap = (event) => {
      if (!mobileTapTouchState || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      if (
        Math.abs(touch.clientX - mobileTapTouchState.startX) >= moveThresholdPx
        || Math.abs(touch.clientY - mobileTapTouchState.startY) >= moveThresholdPx
      ) {
        mobileTapTouchState.moved = true;
      }
    };
    const finishMobileTap = (event) => {
      if (!requiresTouchKeyboardDoubleTap() || !mobileTapTouchState) {
        mobileTapTouchState = null;
        return;
      }
      const touch = event.changedTouches?.[0] || event.touches?.[0] || null;
      const state = mobileTapTouchState;
      mobileTapTouchState = null;
      if (!touch || state.moved) {
        mobileTapFinishState = null;
        return;
      }
      const currentTime = now();
      const dx = touch.clientX - lastMobileTapX;
      const dy = touch.clientY - lastMobileTapY;
      const isDoubleTap = currentTime - lastMobileTapAt <= doubleTapDelayMs && Math.hypot(dx, dy) < moveThresholdPx * 2;
      lastMobileTapAt = currentTime;
      lastMobileTapX = touch.clientX;
      lastMobileTapY = touch.clientY;
      mobileTapFinishState = { event, isDoubleTap };
      if (!isDoubleTap) {
        return;
      }
      session.allowMobileKeyboardFocusUntil = currentTime + focusAllowWindowMs;
      claimedTouchEnds.add(event);
      focusInput(session, {
        requestMobileKeyboard: true,
        forceMobileFocusTransition: true,
      });
      if (event.cancelable) {
        event.preventDefault();
      }
    };
    const settleMobileTap = (event) => {
      const finishState = mobileTapFinishState;
      mobileTapFinishState = null;
      if (finishState?.event === event && !finishState.isDoubleTap) {
        blurInput(session);
      }
    };
    const cancelMobileTap = () => {
      mobileTapTouchState = null;
      mobileTapFinishState = null;
    };
    lifecycle.listen(session, shell, "touchstart", startMobileTap, { capture: true, passive: true });
    lifecycle.listen(session, shell, "touchmove", moveMobileTap, { capture: true, passive: true });
    lifecycle.listen(session, shell, "touchend", finishMobileTap, { capture: true, passive: false });
    lifecycle.listen(session, shell, "touchend", settleMobileTap);
    lifecycle.listen(session, shell, "touchcancel", cancelMobileTap, { capture: true, passive: true });
    positionInput(session);
  };

  const installHostViewportGuard = (session) => {
    const host = session?.terminalHost;
    if (!host) {
      return;
    }
    lifecycle.listen(session, host, "beforeinput", () => scheduleHostViewportReset(session, { clean: true }));
    lifecycle.listen(session, host, "input", () => scheduleHostViewportReset(session, { clean: true }));
    lifecycle.listen(session, host, "scroll", () => scheduleHostViewportReset(session));
    lifecycle.listen(session, host, "blur", () => {
      setComposing(session, false);
      scheduleHostViewportReset(session, { clean: true });
    });
    resetHostViewport(session, { clean: true });
  };

  const disposeSession = (session) => {
    if (!session) {
      return false;
    }
    endNativeDeleteInput(session, { reset: false });
    releaseInputViewportLock(session, { resync: false });
    setComposing(session, false);
    session.pendingCompositionInput = null;
    session.terminalInputAnchor = null;
    installedSessions.delete(session);
    return lifecycle.disposeSession(session);
  };

  return Object.freeze({
    installSession(session) {
      if (disposed || !session) {
        return false;
      }
      if (installedSessions.has(session)) {
        return true;
      }
      if (!lifecycle.bind(session)) {
        return false;
      }
      installedSessions.add(session);
      if (!cleanupRegistered.has(session)) {
        cleanupRegistered.add(session);
        registerSessionCleanup(session, () => disposeSession(session));
      }
      installHostInputIsolation(session);
      installInputFocus(session);
      installKeyOverrides(session);
      installHostViewportGuard(session);
      return true;
    },
    resetHostViewport,
    scheduleHostViewportReset,
    positionInput,
    focusInput,
    blurInput,
    blurMobileKeyboard() {
      const session = getActiveSession();
      blurInput(session);
      const activeElement = documentObject.activeElement;
      if (isHTMLElement(activeElement) && activeElement !== documentObject.body) {
        activeElement.blur();
      }
    },
    focusFromShortcut(session = getActiveSession()) {
      if (!isTouchShortcutLayout()) {
        return false;
      }
      const targetSession = session || getActiveSession();
      if (!targetSession?.term?.textarea) {
        return false;
      }
      targetSession.allowMobileKeyboardFocusUntil = now() + focusAllowWindowMs;
      return focusInput(targetSession, { requestMobileKeyboard: true });
    },
    focusForNativePaste(session = getActiveSession()) {
      if (!session?.term || session.closed) {
        return false;
      }
      if (requiresTouchKeyboardDoubleTap()) {
        session.allowMobileKeyboardFocusUntil = now() + focusAllowWindowMs;
      }
      return focusInput(session, { requestMobileKeyboard: true });
    },
    shouldPreserveKeyboardForShortcut(shortcut) {
      return String(shortcut?.action || "") !== "open_mobile_menu";
    },
    isKeyboardActive(session = getActiveSession()) {
      if (!isTouchShortcutLayout()) {
        return false;
      }
      const textarea = session?.term?.textarea;
      return Boolean(textarea && (documentObject.activeElement === textarea || isKeyboardViewportActive()));
    },
    setFocusAllowance(session, until) {
      if (session) {
        session.allowMobileKeyboardFocusUntil = Number(until || 0);
      }
    },
    consumeKeyboardClaim(event) {
      return claimedTouchEnds.delete(event);
    },
    disposeSession,
    dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      for (const session of lifecycle.sessions()) {
        disposeSession(session);
      }
      lifecycle.dispose();
      return true;
    },
  });
}
