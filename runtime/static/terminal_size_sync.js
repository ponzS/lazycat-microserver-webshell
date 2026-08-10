const terminalDimension = (value) => Math.max(0, Math.floor(Number(value) || 0));

export const shouldSendTerminalSize = ({
  cols,
  rows,
  pixelWidth,
  pixelHeight,
  lastSentCols,
  lastSentRows,
  lastSentPixelWidth,
  lastSentPixelHeight,
  force = false,
} = {}) => {
  const nextCols = terminalDimension(cols);
  const nextRows = terminalDimension(rows);
  const nextPixelWidth = terminalDimension(pixelWidth);
  const nextPixelHeight = terminalDimension(pixelHeight);
  const pixelSizeChanged = (
    nextPixelWidth > 0
    && nextPixelHeight > 0
    && (terminalDimension(lastSentPixelWidth) !== nextPixelWidth || terminalDimension(lastSentPixelHeight) !== nextPixelHeight)
  );
  if (nextCols <= 0 || nextRows <= 0) {
    return false;
  }
  return (
    force
    || terminalDimension(lastSentCols) !== nextCols
    || terminalDimension(lastSentRows) !== nextRows
    || pixelSizeChanged
  );
};

export const terminalSizeDiffersFromServer = ({
  cols,
  rows,
  pixelWidth,
  pixelHeight,
  serverCols,
  serverRows,
  serverPixelWidth,
  serverPixelHeight,
} = {}) => {
  const nextCols = terminalDimension(cols);
  const nextRows = terminalDimension(rows);
  const nextPixelWidth = terminalDimension(pixelWidth);
  const nextPixelHeight = terminalDimension(pixelHeight);
  const remoteCols = terminalDimension(serverCols);
  const remoteRows = terminalDimension(serverRows);
  const remotePixelWidth = terminalDimension(serverPixelWidth);
  const remotePixelHeight = terminalDimension(serverPixelHeight);
  const pixelSizeDiffers = (
    nextPixelWidth > 0
    && nextPixelHeight > 0
    && remotePixelWidth > 0
    && remotePixelHeight > 0
    && (nextPixelWidth !== remotePixelWidth || nextPixelHeight !== remotePixelHeight)
  );
  return (
    nextCols > 0
    && nextRows > 0
    && remoteCols > 0
    && remoteRows > 0
    && (nextCols !== remoteCols || nextRows !== remoteRows || pixelSizeDiffers)
  );
};
