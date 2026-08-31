export const normalizeViewportPixels = (value) => Math.max(0, Math.round(Number(value) || 0));

const normalizeViewportScale = (value) => Math.max(0, Math.round((Number(value) || 0) * 1000) / 1000);

export function currentMobileViewportOrientation({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
} = {}) {
  const type = String(windowObject?.screen?.orientation?.type || "").toLowerCase();
  if (type.startsWith("landscape")) {
    return "landscape";
  }
  if (type.startsWith("portrait")) {
    return "portrait";
  }
  const rawAngle = windowObject?.screen?.orientation?.angle ?? windowObject?.orientation;
  const angle = Number(rawAngle);
  if (Number.isFinite(angle)) {
    const normalized = ((Math.round(angle) % 360) + 360) % 360;
    if (normalized === 90 || normalized === 270) {
      return "landscape";
    }
    if (normalized === 0 || normalized === 180) {
      return "portrait";
    }
  }
  const screenWidth = Number(windowObject?.screen?.width) || 0;
  const screenHeight = Number(windowObject?.screen?.height) || 0;
  if (screenWidth > 0 && screenHeight > 0 && screenWidth !== screenHeight) {
    return screenWidth > screenHeight ? "landscape" : "portrait";
  }
  const visualViewport = windowObject?.visualViewport;
  const viewportWidth = Number(
    visualViewport?.width
    || windowObject?.innerWidth
    || documentObject?.documentElement?.clientWidth
    || 0
  );
  const viewportHeight = Number(
    visualViewport?.height
    || windowObject?.innerHeight
    || documentObject?.documentElement?.clientHeight
    || 0
  );
  if (viewportWidth > 0 && viewportHeight > 0 && viewportWidth !== viewportHeight) {
    return viewportWidth > viewportHeight ? "landscape" : "portrait";
  }
  return "";
}

export function measureTerminalViewportGeometry({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
} = {}) {
  const visualViewport = windowObject?.visualViewport;
  const layoutWidth = normalizeViewportPixels(
    windowObject?.innerWidth || documentObject?.documentElement?.clientWidth || 0,
  );
  const layoutHeight = normalizeViewportPixels(
    windowObject?.innerHeight || documentObject?.documentElement?.clientHeight || 0,
  );
  return Object.freeze({
    layoutWidth,
    layoutHeight,
    visualWidth: normalizeViewportPixels(visualViewport?.width || layoutWidth),
    visualHeight: normalizeViewportPixels(visualViewport?.height || layoutHeight),
    screenWidth: normalizeViewportPixels(windowObject?.screen?.width),
    screenHeight: normalizeViewportPixels(windowObject?.screen?.height),
    devicePixelRatio: normalizeViewportScale(windowObject?.devicePixelRatio || 1),
    orientation: currentMobileViewportOrientation({ windowObject, documentObject }),
  });
}

export function terminalViewportGeometryEqual(left, right) {
  if (!left || !right) {
    return false;
  }
  return (
    left.layoutWidth === right.layoutWidth
    && left.layoutHeight === right.layoutHeight
    && left.visualWidth === right.visualWidth
    && left.visualHeight === right.visualHeight
    && left.screenWidth === right.screenWidth
    && left.screenHeight === right.screenHeight
    && left.devicePixelRatio === right.devicePixelRatio
    && left.orientation === right.orientation
  );
}

export function terminalViewportGeometryRequiresClaim(previous, next, {
  keyboardActive = false,
  resizeSuppressed = false,
} = {}) {
  if (!previous || !next) {
    return false;
  }
  if (
    previous.layoutWidth !== next.layoutWidth
    || previous.layoutHeight !== next.layoutHeight
    || previous.visualWidth !== next.visualWidth
    || previous.screenWidth !== next.screenWidth
    || previous.screenHeight !== next.screenHeight
    || previous.devicePixelRatio !== next.devicePixelRatio
    || previous.orientation !== next.orientation
  ) {
    return true;
  }
  return !keyboardActive
    && !resizeSuppressed
    && previous.visualHeight !== next.visualHeight;
}

export function measureMobileViewportBottomInset({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
} = {}) {
  const visualViewport = windowObject?.visualViewport;
  if (!visualViewport) {
    return 0;
  }
  const viewportOffsetTop = normalizeViewportPixels(visualViewport.offsetTop);
  const layoutHeight = Number(
    windowObject?.innerHeight
    || documentObject?.documentElement?.clientHeight
    || 0
  );
  return normalizeViewportPixels(layoutHeight - visualViewport.height - viewportOffsetTop);
}

export function isKeyboardLikeViewportHeightChange(previousHeight, nextHeight, {
  touchLayout = false,
  orientationChanged = false,
  thresholdPx = 80,
} = {}) {
  if (!touchLayout || orientationChanged) {
    return false;
  }
  const fromHeight = normalizeViewportPixels(previousHeight);
  const toHeight = normalizeViewportPixels(nextHeight);
  if (fromHeight <= 0 || toHeight <= 0) {
    return false;
  }
  return Math.abs(toHeight - fromHeight) > normalizeViewportPixels(thresholdPx);
}

export function terminalViewportPanY(session, {
  resizeSuppressed = false,
  viewportReferenceHeight = 0,
  viewportHeight = 0,
  isHostElement = (value) => Boolean(value && Number.isFinite(Number(value.clientHeight))),
} = {}) {
  if (!resizeSuppressed) {
    return 0;
  }
  const term = session?.term;
  const host = session?.terminalHost;
  const metrics = term?.renderer?.getMetrics?.();
  const cursor = term?.wasmTerm?.getCursor?.();
  if (!term || !isHostElement(host) || !metrics?.height || !cursor) {
    return 0;
  }
  const cellHeight = Math.max(1, Number(metrics.height) || 0);
  const logicalHeight = Math.ceil((Number(term.rows) || 0) * cellHeight);
  const visibleHeight = Math.max(0, Number(host.clientHeight) || 0);
  if (logicalHeight <= 0 || visibleHeight <= 0 || logicalHeight <= visibleHeight) {
    return 0;
  }
  const cursorRow = Math.max(
    0,
    Math.min(Math.max(0, (Number(term.rows) || 1) - 1), Number(cursor.y) || 0),
  );
  const cursorBottom = Math.ceil((cursorRow + 1) * cellHeight);
  const keyboardPanLimit = Math.max(
    0,
    normalizeViewportPixels(viewportReferenceHeight) - normalizeViewportPixels(viewportHeight),
  );
  const overflowPastViewport = Math.max(0, cursorBottom + cellHeight - visibleHeight);
  return Math.min(logicalHeight - visibleHeight, keyboardPanLimit, overflowPastViewport);
}
