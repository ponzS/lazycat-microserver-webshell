const cellFlagInverse = 16;
const cellFlagFaint = 128;

const colorRGB = (color) => {
  const value = String(color || "").trim();
  const hex = value.match(/^#([\da-f]{6}|[\da-f]{3})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? Array.from(hex, (digit) => digit + digit).join("") : hex;
    return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16));
  }
  const rgb = value.match(/^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  return rgb ? rgb.slice(1).map(Number) : null;
};

const luminance = (rgb) => rgb.reduce((total, channel, index) => {
  const value = channel / 255;
  const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return total + linear * [0.2126, 0.7152, 0.0722][index];
}, 0);

const cursorTextRGB = (cursorColor, backgroundColor) => {
  const cursor = luminance(colorRGB(cursorColor) || [255, 255, 255]);
  const background = colorRGB(backgroundColor);
  if (background) {
    const text = luminance(background);
    if ((Math.max(cursor, text) + 0.05) / (Math.min(cursor, text) + 0.05) >= 4.5) {
      return background;
    }
  }
  return (cursor + 0.05) / 0.05 >= 1.05 / (cursor + 0.05) ? [0, 0, 0] : [255, 255, 255];
};

// Reuse the normal glyph/Powerline renderer so graphemes, font styles and
// decorations stay aligned. Only the cursor's copy receives the contrast color.
export function drawTerminalBlockCursor(renderer, column, row, {
  getCell,
  getBackground,
  bleed = 0,
}) {
  const metrics = renderer.metrics || renderer.getMetrics?.();
  const width = Number(metrics?.width) || 0;
  const height = Number(metrics?.height) || 0;
  if (!width || !height) return false;

  let cellColumn = column;
  let cell = getCell(renderer, row, cellColumn);
  // A cursor may address the continuation cell of a wide glyph.
  if (cell?.width === 0 && column > 0) {
    const previous = getCell(renderer, row, column - 1);
    if (previous?.width > 1) {
      cellColumn -= 1;
      cell = previous;
    }
  }
  const cellWidth = Math.max(1, Number(cell?.width) || 1) * width;
  const x = cellColumn * width;
  const y = row * height;
  const context = renderer.ctx;
  const selection = renderer.currentSelectionCoords;
  const colorMap = renderer.webshellColorMap;
  const lastRenderFont = renderer.lastRenderFont;
  context.save();
  try {
    context.globalAlpha = 1;
    context.fillStyle = renderer.theme.cursor;
    const cursorColor = context.fillStyle;
    context.fillRect(x - bleed, y, cellWidth + bleed * 2, height);
    if (!cell || typeof renderer.renderCellText !== "function") return true;

    const background = getBackground(renderer, cell, cellColumn, row) || renderer.theme.background;
    const [red, green, blue] = cursorTextRGB(cursorColor, background);
    const cursorCell = {
      ...cell,
      fg_r: red,
      fg_g: green,
      fg_b: blue,
      flags: cell.flags & ~(cellFlagInverse | cellFlagFaint),
    };
    context.beginPath();
    context.rect(x, y, cellWidth, height);
    context.clip();
    // Selection and theme remapping must not replace the chosen contrast color.
    renderer.currentSelectionCoords = null;
    renderer.webshellColorMap = null;
    // The bundled renderer's fourth argument is the pixel scroll offset.
    renderer.renderCellText(cursorCell, cellColumn, row, 0);
    return true;
  } finally {
    renderer.currentSelectionCoords = selection;
    renderer.webshellColorMap = colorMap;
    context.restore();
    // Keep the renderer's font cache consistent with the restored Canvas font.
    renderer.lastRenderFont = lastRenderFont;
  }
}
