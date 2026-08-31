const terminalMouseLegacyCoordinateLimit = 95;

export const terminalMouseModeEnabled = (term, mode) => {
  try {
    return typeof term?.getMode === "function" && term.getMode(mode, false) === true;
  } catch (error) {
    return false;
  }
};

export const terminalMouseTrackingState = (session) => {
  const term = session?.term;
  if (!term || session?.closed) {
    return null;
  }
  const x10 = terminalMouseModeEnabled(term, 9);
  const normal = terminalMouseModeEnabled(term, 1000);
  const drag = terminalMouseModeEnabled(term, 1002);
  const any = terminalMouseModeEnabled(term, 1003);
  let tracking = x10 || normal || drag || any;
  try {
    tracking = tracking || term.hasMouseTracking?.() === true;
  } catch (error) {
  }
  if (!tracking) {
    return null;
  }
  return {
    x10,
    normal,
    drag,
    any,
    sgr: terminalMouseModeEnabled(term, 1006),
  };
};

export const terminalMouseButtonFromEvent = (event) => {
  switch (event?.button) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 2;
    default:
      return -1;
  }
};

const terminalMouseButtonMask = (button) => {
  switch (button) {
    case 0:
      return 1;
    case 1:
      return 4;
    case 2:
      return 2;
    default:
      return 0;
  }
};

export const terminalMouseButtonFromButtons = (buttons, preferred = -1) => {
  const mask = Number(buttons || 0);
  if (preferred >= 0 && (mask & terminalMouseButtonMask(preferred))) {
    return preferred;
  }
  if (mask & 1) {
    return 0;
  }
  if (mask & 4) {
    return 1;
  }
  if (mask & 2) {
    return 2;
  }
  return -1;
};

export const terminalMouseModifierCode = (event) => (
  (event?.shiftKey ? 4 : 0)
  | (event?.altKey ? 8 : 0)
  | (event?.ctrlKey ? 16 : 0)
);

export const terminalMouseEventFromTouch = (
  event,
  touch = null,
  { fallbackX = 0, fallbackY = 0, ...extra } = {},
) => ({
  clientX: Number(touch?.clientX ?? fallbackX) || 0,
  clientY: Number(touch?.clientY ?? fallbackY) || 0,
  shiftKey: Boolean(event?.shiftKey),
  altKey: Boolean(event?.altKey),
  ctrlKey: Boolean(event?.ctrlKey),
  ...extra,
});

export const encodeTerminalLegacyMouseSequence = (
  buttonCode,
  x,
  y,
  coordinateLimit = terminalMouseLegacyCoordinateLimit,
) => {
  if (
    buttonCode < 0
    || buttonCode > coordinateLimit
    || x < 1
    || y < 1
    || x > coordinateLimit
    || y > coordinateLimit
  ) {
    return "";
  }
  return `\x1b[M${String.fromCharCode(buttonCode + 32)}${String.fromCharCode(x + 32)}${String.fromCharCode(y + 32)}`;
};

export const encodeTerminalMouseSequence = ({
  trackingState,
  cell,
  event,
  action,
  button = -1,
} = {}) => {
  if (!trackingState || !cell) {
    return "";
  }
  const x = Number(cell.col) + 1;
  const y = Number(cell.row) + 1;
  const modifiers = terminalMouseModifierCode(event);
  let buttonCode = -1;
  let suffix = "M";

  if (action === "press") {
    if (button < 0) {
      return "";
    }
    buttonCode = button;
  } else if (action === "release") {
    if (trackingState.x10 && !trackingState.normal && !trackingState.drag && !trackingState.any) {
      return "";
    }
    if (trackingState.sgr) {
      buttonCode = button >= 0 ? button : 0;
      suffix = "m";
    } else {
      buttonCode = 3;
    }
  } else if (action === "move") {
    if (button >= 0) {
      if (!trackingState.drag && !trackingState.any) {
        return "";
      }
      buttonCode = 32 + button;
    } else {
      if (!trackingState.any) {
        return "";
      }
      buttonCode = 35;
    }
  } else if (action === "wheel") {
    const delta = Math.abs(event?.deltaY || 0) >= Math.abs(event?.deltaX || 0)
      ? event?.deltaY
      : event?.deltaX;
    if (!delta) {
      return "";
    }
    buttonCode = delta < 0 ? 64 : 65;
  } else {
    return "";
  }

  buttonCode += modifiers;
  if (trackingState.sgr) {
    return `\x1b[<${buttonCode};${x};${y}${suffix}`;
  }
  return encodeTerminalLegacyMouseSequence(buttonCode, x, y);
};
