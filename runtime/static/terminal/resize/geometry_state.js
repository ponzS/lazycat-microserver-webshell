const nonNegativeInteger = (value) => Math.max(0, Math.floor(Number(value) || 0));

export const normalizeTerminalResizeEpoch = (value) => {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) && text !== "0" ? text : "";
};

export const nextTerminalResizeEpoch = (session, {
  now = () => Date.now(),
  random = () => Math.random(),
} = {}) => {
  const previous = normalizeTerminalResizeEpoch(session?.requestedResizeEpoch)
    || normalizeTerminalResizeEpoch(session?.appliedResizeEpoch)
    || "0";
  try {
    const previousValue = BigInt(previous);
    const clockValue = BigInt(now()) * 1000n + BigInt(Math.floor(random() * 1000));
    return String(clockValue > previousValue ? clockValue : previousValue + 1n);
  } catch (error) {
    return String(BigInt(now()) * 1000n);
  }
};

export const terminalSize = (session, getPixelSize = () => null) => {
  const cols = nonNegativeInteger(session?.term?.cols);
  const rows = nonNegativeInteger(session?.term?.rows);
  const pixels = getPixelSize(session?.term) || {};
  return {
    cols,
    rows,
    pixelWidth: Math.max(0, Math.round(Number(pixels.width) || 0)),
    pixelHeight: Math.max(0, Math.round(Number(pixels.height) || 0)),
  };
};

export const terminalDimensionsEqual = (session, dimensions, getPixelSize = () => null) => {
  if (!dimensions) {
    return false;
  }
  const current = terminalSize(session, getPixelSize);
  return nonNegativeInteger(dimensions.cols) === current.cols
    && nonNegativeInteger(dimensions.rows) === current.rows;
};

export const terminalResizeTargetsMatch = (left, right) => Boolean(
  left
  && right
  && nonNegativeInteger(left.cols) === nonNegativeInteger(right.cols)
  && nonNegativeInteger(left.rows) === nonNegativeInteger(right.rows)
  && (!left.pixelWidth || !right.pixelWidth || Number(left.pixelWidth) === Number(right.pixelWidth))
  && (!left.pixelHeight || !right.pixelHeight || Number(left.pixelHeight) === Number(right.pixelHeight))
);

export const terminalCanvasSize = (session) => {
  const canvas = session?.term?.canvas || session?.term?.renderer?.getCanvas?.();
  return {
    width: Math.max(0, Number(canvas?.width) || 0),
    height: Math.max(0, Number(canvas?.height) || 0),
  };
};

export const terminalCanvasMatchesExpectedSize = (
  session,
  dimensions,
  {
    getPixelSize = () => null,
    isCanvasElement = (value) => Boolean(value && typeof value.getContext === "function"),
  } = {},
) => {
  const canvas = session?.term?.canvas || session?.term?.renderer?.getCanvas?.();
  const current = dimensions || terminalSize(session, getPixelSize);
  const cols = nonNegativeInteger(current?.cols);
  const rows = nonNegativeInteger(current?.rows);
  const expected = session?.term?.renderer?.canvasSize?.(cols, rows);
  if (!isCanvasElement(canvas) || !expected || cols <= 0 || rows <= 0) {
    return false;
  }
  return canvas.width === Math.max(0, Number(expected.pixelWidth) || 0)
    && canvas.height === Math.max(0, Number(expected.pixelHeight) || 0)
    && canvas.style.width === `${expected.cssWidth}px`
    && canvas.style.height === `${expected.cssHeight}px`;
};

export const terminalPaneIsMeasurable = (
  session,
  isElement = (value) => Boolean(value && typeof value.getBoundingClientRect === "function"),
) => {
  const host = session?.terminalHost;
  if (!isElement(host) || !host.isConnected || host.clientWidth <= 0 || host.clientHeight <= 0) {
    return false;
  }
  const rect = host.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

export const failedTerminalFit = (measurable = false) => ({
  ok: false,
  measurable,
  cols: 0,
  rows: 0,
  sizeChanged: false,
  canvasChanged: false,
});
