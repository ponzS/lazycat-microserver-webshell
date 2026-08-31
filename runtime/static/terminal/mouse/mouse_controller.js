import { createTerminalMouseLifecycle } from "./mouse_lifecycle.js";
import {
  encodeTerminalMouseSequence,
  terminalMouseButtonFromButtons,
  terminalMouseButtonFromEvent,
  terminalMouseEventFromTouch,
  terminalMouseTrackingState,
} from "./mouse_model.js";

const defaultMoveThresholdPx = 8;
const defaultDoubleTapDelayMs = 320;
const defaultFocusAllowWindowMs = 600;
const defaultMaxWheelSteps = 10;

export function createTerminalMouseController({
  documentObject = globalThis.document,
  lifecycleFactory = createTerminalMouseLifecycle,
  cellFromPoint = () => null,
  activateSession = () => {},
  clearSelection = () => {},
  sendInput = () => {},
  reassertSize = () => {},
  isTouchLayout = () => false,
  requiresTouchKeyboardDoubleTap = () => false,
  isDeferredTouchClickSession = () => false,
  blurInput = () => {},
  requestTouchKeyboard = () => {},
  setTouchKeyboardFocusAllowance = () => {},
  registerSessionCleanup = () => {},
  now = () => globalThis.performance?.now?.() || Date.now(),
  moveThresholdPx = defaultMoveThresholdPx,
  doubleTapDelayMs = defaultDoubleTapDelayMs,
  focusAllowWindowMs = defaultFocusAllowWindowMs,
  maxWheelSteps = defaultMaxWheelSteps,
} = {}) {
  const lifecycle = lifecycleFactory({ documentObject });
  const claimedEvents = new WeakSet();
  const cleanupRegisteredSessions = new WeakSet();
  const installedSessions = new WeakSet();
  const sessions = new Set();
  let started = false;
  let disposed = false;

  const start = () => {
    if (started || disposed) {
      return;
    }
    started = true;
    lifecycle.start();
  };

  const ensureSessionCleanup = (session) => {
    if (!session || cleanupRegisteredSessions.has(session)) {
      return;
    }
    cleanupRegisteredSessions.add(session);
    registerSessionCleanup(session, () => disposeSession(session));
  };

  const trackingState = (session) => disposed ? null : terminalMouseTrackingState(session);

  const encode = (session, event, action, button = -1) => {
    if (disposed) {
      return "";
    }
    const state = trackingState(session);
    if (!state) {
      return "";
    }
    const cell = cellFromPoint(session, event?.clientX, event?.clientY);
    return encodeTerminalMouseSequence({
      trackingState: state,
      cell,
      event,
      action,
      button,
    });
  };

  const sendClick = (session, event, touch = null) => {
    if (disposed || !session) {
      return false;
    }
    const mouseEvent = touch ? terminalMouseEventFromTouch(event, touch) : event;
    const press = encode(session, mouseEvent, "press", 0);
    if (!press) {
      return false;
    }
    const release = encode(session, mouseEvent, "release", 0);
    sendInput(session, press + release);
    return true;
  };

  const sendWheel = (session, steps, event, touch) => {
    if (disposed || !session) {
      return false;
    }
    const count = Math.abs(Math.trunc(Number(steps) || 0));
    if (!count) {
      return false;
    }
    const wheelEvent = terminalMouseEventFromTouch(event, touch, {
      deltaX: 0,
      deltaY: Math.sign(steps),
    });
    const sequence = encode(session, wheelEvent, "wheel");
    if (!sequence) {
      return false;
    }
    sendInput(session, sequence.repeat(count));
    return true;
  };

  const stopEvent = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
  };

  const installSession = (session) => {
    if (disposed || installedSessions.has(session)) {
      return;
    }
    const shell = session?.shellEl;
    const host = session?.terminalHost;
    if (!shell || !host || !session?.term) {
      return;
    }
    start();
    installedSessions.add(session);
    sessions.add(session);
    ensureSessionCleanup(session);

    const isTerminalMouseTarget = (target) => target?.closest?.(".terminal-host") === host;
    const mouseState = {
      activeButton: -1,
      lastMoveSequence: "",
    };
    const touchMouseState = {
      identifier: -1,
      active: false,
      deferredClick: false,
      lastX: 0,
      lastY: 0,
    };
    const touchKeyboardState = {
      active: false,
      startedAt: 0,
      startX: 0,
      startY: 0,
      moved: false,
      wheelRemainderY: 0,
      lastTapAt: 0,
      lastTapX: 0,
      lastTapY: 0,
    };

    const sendMouseSequence = (event, action, button = -1) => {
      const sequence = encode(session, event, action, button);
      if (!sequence) {
        return false;
      }
      if (action === "move") {
        if (sequence === mouseState.lastMoveSequence) {
          return true;
        }
        mouseState.lastMoveSequence = sequence;
      } else {
        mouseState.lastMoveSequence = "";
      }
      reassertSize(session, event);
      sendInput(session, sequence);
      return true;
    };

    const mouseEventFromTouch = (event, touch = null, extra = {}) => terminalMouseEventFromTouch(event, touch, {
      fallbackX: touchMouseState.lastX,
      fallbackY: touchMouseState.lastY,
      ...extra,
    });

    const flushDeferredTouchWheel = (event, touch) => {
      if (!touchKeyboardState.moved || !touchKeyboardState.wheelRemainderY) {
        return;
      }
      const renderer = session.term?.renderer;
      const rowHeight = Math.max(
        moveThresholdPx,
        Number(renderer?.getMetrics?.().height) || Number(renderer?.charHeight) || 18,
      );
      const rawSteps = touchKeyboardState.wheelRemainderY / rowHeight;
      const wholeSteps = rawSteps > 0 ? Math.floor(rawSteps) : Math.ceil(rawSteps);
      if (!wholeSteps) {
        return;
      }
      const stepCount = Math.min(Math.abs(wholeSteps), maxWheelSteps);
      const direction = wholeSteps > 0 ? 1 : -1;
      const wheelEvent = mouseEventFromTouch(event, touch, {
        deltaX: 0,
        deltaY: direction,
      });
      for (let index = 0; index < stepCount; index += 1) {
        sendMouseSequence(wheelEvent, "wheel");
      }
      touchKeyboardState.wheelRemainderY -= direction * stepCount * rowHeight;
    };

    const changedTouchForActiveMouse = (event) => {
      const touches = Array.from(event?.changedTouches || []);
      return touches.find((touch) => touch.identifier === touchMouseState.identifier) || null;
    };

    const resetTouchMouseState = () => {
      touchMouseState.identifier = -1;
      touchMouseState.active = false;
      touchMouseState.deferredClick = false;
      touchMouseState.lastX = 0;
      touchMouseState.lastY = 0;
    };

    const resetTouchKeyboardState = (clearTapHistory = false) => {
      touchKeyboardState.active = false;
      touchKeyboardState.startedAt = 0;
      touchKeyboardState.startX = 0;
      touchKeyboardState.startY = 0;
      touchKeyboardState.moved = false;
      touchKeyboardState.wheelRemainderY = 0;
      if (clearTapHistory) {
        touchKeyboardState.lastTapAt = 0;
        touchKeyboardState.lastTapX = 0;
        touchKeyboardState.lastTapY = 0;
      }
    };

    const finishDeferredTouchKeyboardTap = (event, touch) => {
      const currentTime = now();
      const previousTapAt = touchKeyboardState.lastTapAt;
      const previousTapX = touchKeyboardState.lastTapX;
      const previousTapY = touchKeyboardState.lastTapY;
      const isTap = (
        event.type === "touchend"
        && touchKeyboardState.active
        && touch
        && !touchKeyboardState.moved
        && Math.abs(touch.clientX - touchKeyboardState.startX) < moveThresholdPx
        && Math.abs(touch.clientY - touchKeyboardState.startY) < moveThresholdPx
        && currentTime - touchKeyboardState.startedAt <= doubleTapDelayMs
        && requiresTouchKeyboardDoubleTap()
        && isDeferredTouchClickSession(session)
        && trackingState(session)
      );
      if (isTap) {
        const mouseEvent = mouseEventFromTouch(event, touch);
        sendMouseSequence(mouseEvent, "press", 0);
        sendMouseSequence(mouseEvent, "release", 0);
      }
      resetTouchKeyboardState(false);
      if (!isTap) {
        resetTouchKeyboardState(true);
        return;
      }
      const dx = touch.clientX - previousTapX;
      const dy = touch.clientY - previousTapY;
      const isDoubleTap = (
        previousTapAt > 0
        && currentTime - previousTapAt <= doubleTapDelayMs
        && Math.hypot(dx, dy) < moveThresholdPx * 2
      );
      touchKeyboardState.lastTapAt = currentTime;
      touchKeyboardState.lastTapX = touch.clientX;
      touchKeyboardState.lastTapY = touch.clientY;
      if (!isDoubleTap) {
        return;
      }
      resetTouchKeyboardState(true);
      setTouchKeyboardFocusAllowance(session, currentTime + focusAllowWindowMs);
      requestTouchKeyboard(session);
    };

    const handleMouseDown = (event) => {
      if (claimedEvents.has(event)) {
        mouseState.activeButton = -1;
        mouseState.lastMoveSequence = "";
        return;
      }
      if (!isTerminalMouseTarget(event.target)) {
        return;
      }
      if (!trackingState(session)) {
        mouseState.activeButton = -1;
        mouseState.lastMoveSequence = "";
        return;
      }
      const button = terminalMouseButtonFromEvent(event);
      if (button < 0) {
        return;
      }
      stopEvent(event);
      activateSession(session);
      mouseState.activeButton = button;
      sendMouseSequence(event, "press", button);
    };

    const handleMouseMove = (event) => {
      if (claimedEvents.has(event)) {
        return;
      }
      const state = trackingState(session);
      if (!state) {
        mouseState.lastMoveSequence = "";
        return;
      }
      const button = terminalMouseButtonFromButtons(event.buttons, mouseState.activeButton);
      const hasCapturedButton = mouseState.activeButton >= 0;
      const isLocalTarget = isTerminalMouseTarget(event.target);
      if (!hasCapturedButton && !isLocalTarget) {
        return;
      }
      if (hasCapturedButton || (isLocalTarget && state.any)) {
        stopEvent(event);
      }
      sendMouseSequence(event, "move", hasCapturedButton ? button : -1);
    };

    const handleMouseUp = (event) => {
      if (claimedEvents.has(event)) {
        mouseState.activeButton = -1;
        mouseState.lastMoveSequence = "";
        return;
      }
      const hadActiveButton = mouseState.activeButton >= 0;
      const state = trackingState(session);
      if (!state && !hadActiveButton) {
        return;
      }
      const button = terminalMouseButtonFromEvent(event);
      const releasedButton = mouseState.activeButton >= 0 ? mouseState.activeButton : button;
      mouseState.activeButton = terminalMouseButtonFromButtons(event.buttons, mouseState.activeButton);
      if (mouseState.activeButton === releasedButton) {
        mouseState.activeButton = -1;
      }
      mouseState.lastMoveSequence = "";
      if (!state) {
        return;
      }
      if (hadActiveButton || isTerminalMouseTarget(event.target)) {
        stopEvent(event);
        sendMouseSequence(event, "release", releasedButton);
      }
    };

    const handleWheel = (event) => {
      if (!isTerminalMouseTarget(event.target) || !trackingState(session)) {
        return;
      }
      if (sendMouseSequence(event, "wheel")) {
        stopEvent(event);
      }
    };

    const handleClickLike = (event) => {
      if (claimedEvents.has(event)) {
        return;
      }
      if (isTerminalMouseTarget(event.target) && trackingState(session)) {
        stopEvent(event);
      }
    };

    const handleTouchStart = (event) => {
      const state = trackingState(session);
      if (
        !isTouchLayout()
        || event.touches.length !== 1
        || !isTerminalMouseTarget(event.target)
        || !state
      ) {
        resetTouchMouseState();
        resetTouchKeyboardState(true);
        return;
      }
      const touch = event.touches[0];
      stopEvent(event);
      activateSession(session);
      clearSelection(session);
      touchMouseState.identifier = touch.identifier;
      touchMouseState.active = true;
      touchMouseState.lastX = touch.clientX;
      touchMouseState.lastY = touch.clientY;
      touchMouseState.deferredClick = requiresTouchKeyboardDoubleTap() && isDeferredTouchClickSession(session);
      if (touchMouseState.deferredClick) {
        setTouchKeyboardFocusAllowance(session, 0);
        blurInput(session);
        touchKeyboardState.active = true;
        touchKeyboardState.startedAt = now();
        touchKeyboardState.startX = touch.clientX;
        touchKeyboardState.startY = touch.clientY;
        touchKeyboardState.moved = false;
        touchKeyboardState.wheelRemainderY = 0;
      } else {
        resetTouchKeyboardState(true);
        sendMouseSequence(mouseEventFromTouch(event, touch), "press", 0);
      }
    };

    const handleTouchMove = (event) => {
      if (!touchMouseState.active || !trackingState(session)) {
        return;
      }
      const touch = Array.from(event.touches || []).find((item) => item.identifier === touchMouseState.identifier) || null;
      if (!touch) {
        return;
      }
      const previousY = touchMouseState.lastY;
      stopEvent(event);
      touchMouseState.lastX = touch.clientX;
      touchMouseState.lastY = touch.clientY;
      if (touchMouseState.deferredClick) {
        touchKeyboardState.wheelRemainderY += previousY - touch.clientY;
        if (
          Math.abs(touch.clientX - touchKeyboardState.startX) >= moveThresholdPx
          || Math.abs(touch.clientY - touchKeyboardState.startY) >= moveThresholdPx
        ) {
          touchKeyboardState.moved = true;
        }
        flushDeferredTouchWheel(event, touch);
        return;
      }
      sendMouseSequence(mouseEventFromTouch(event, touch), "move", 0);
    };

    const finishTouchMouse = (event) => {
      if (!touchMouseState.active) {
        return;
      }
      const touch = changedTouchForActiveMouse(event);
      stopEvent(event);
      if (touch) {
        touchMouseState.lastX = touch.clientX;
        touchMouseState.lastY = touch.clientY;
      }
      if (touchMouseState.deferredClick) {
        finishDeferredTouchKeyboardTap(event, touch);
      } else {
        sendMouseSequence(mouseEventFromTouch(event, touch), "release", 0);
      }
      resetTouchMouseState();
    };

    const listenerOptions = { capture: true, passive: false };
    lifecycle.listenSession(session, shell, "mousedown", handleMouseDown, listenerOptions);
    lifecycle.listenSession(session, shell, "mousemove", handleMouseMove, listenerOptions);
    lifecycle.listenSession(session, shell, "wheel", handleWheel, listenerOptions);
    lifecycle.listenSession(session, shell, "click", handleClickLike, listenerOptions);
    lifecycle.listenSession(session, shell, "dblclick", handleClickLike, listenerOptions);
    lifecycle.listenSession(session, shell, "auxclick", handleClickLike, listenerOptions);
    lifecycle.listenSession(session, shell, "contextmenu", handleClickLike, listenerOptions);
    lifecycle.listenSession(session, shell, "touchstart", handleTouchStart, listenerOptions);
    lifecycle.listenSession(session, shell, "touchmove", handleTouchMove, listenerOptions);
    lifecycle.listenSession(session, shell, "touchend", finishTouchMouse, listenerOptions);
    lifecycle.listenSession(session, shell, "touchcancel", finishTouchMouse, listenerOptions);
    lifecycle.listenSession(session, documentObject, "mousemove", handleMouseMove, listenerOptions);
    lifecycle.listenSession(session, documentObject, "mouseup", handleMouseUp, listenerOptions);
    lifecycle.addSessionCleanup(session, () => {
      mouseState.activeButton = -1;
      mouseState.lastMoveSequence = "";
      resetTouchMouseState();
      resetTouchKeyboardState(true);
    });
  };

  function disposeSession(session) {
    if (!session) {
      return;
    }
    lifecycle.disposeSession(session);
    installedSessions.delete(session);
    sessions.delete(session);
  }

  return Object.freeze({
    claimEvent(event) {
      if (disposed || !event || (typeof event !== "object" && typeof event !== "function")) {
        return false;
      }
      claimedEvents.add(event);
      return true;
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const session of [...sessions]) {
        disposeSession(session);
      }
      lifecycle.dispose();
    },

    disposeSession,
    encode,

    hasTracking(session) {
      return Boolean(trackingState(session));
    },

    installSession,
    sendClick,
    sendWheel,
    start,
    trackingState,
  });
}
