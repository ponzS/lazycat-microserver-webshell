import {
  dimThemeColor,
  normalizeThemeColor,
  rgbaFromThemeColor,
  themeBrightness,
} from "./theme_model.js";

export const themeCardMetrics = Object.freeze({
  width: 280,
  height: 60,
  cornerRadius: 5,
  outerPadding: 10,
  contentInset: 8,
  previewLineY: 20,
  nameLineY: 40,
  backgroundAlpha: 0.8,
});

const previewPromptText = "lazycat@terminal:~/Theme$ _";
const previewFont = "16px monospace";

const previewSource = (theme) => {
  const xterm = theme?.xterm || {};
  const background = normalizeThemeColor(theme?.background || xterm.background, "#000000");
  const foreground = normalizeThemeColor(theme?.foreground || xterm.foreground, "#FFFFFF");
  const accent = normalizeThemeColor(theme?.accent || xterm.cursor || foreground, foreground);
  const color11 = normalizeThemeColor(theme?.color_11 || theme?.color11 || xterm.brightGreen || xterm.green || foreground, foreground);
  const color13 = normalizeThemeColor(theme?.color_13 || theme?.color13 || xterm.brightBlue || xterm.blue || accent, foreground);
  return {
    name: String(theme?.name || ""),
    background,
    foreground,
    color11,
    color13,
    isLightBackground: themeBrightness(background) > 0.5,
  };
};

const drawRoundedRect = (context, x, y, width, height, radius) => {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
};

const drawText = (context, text, x, y, color) => {
  context.fillStyle = color;
  context.fillText(text, x, y);
  return context.measureText(text).width;
};

const previewTextColor = (theme, color) => (
  theme?.isLightBackground ? dimThemeColor(color) : normalizeThemeColor(color, "#FFFFFF")
);

export const measureThemeCardWidth = ({ documentObject, themes = [] } = {}) => {
  const measurementCanvas = documentObject?.createElement?.("canvas");
  const context = measurementCanvas?.getContext?.("2d");
  if (!context) {
    return themeCardMetrics.width;
  }
  context.font = previewFont;
  const promptWidth = context.measureText(previewPromptText).width;
  const widestThemeNameWidth = themes.reduce((maxWidth, theme) => {
    const themeName = typeof theme?.name === "string" ? theme.name : "";
    return Math.max(maxWidth, context.measureText(themeName).width);
  }, 0);
  const contentWidth = Math.max(promptWidth, widestThemeNameWidth);
  return Math.max(
    themeCardMetrics.width,
    Math.ceil(contentWidth + (themeCardMetrics.outerPadding + themeCardMetrics.contentInset) * 2 + 12),
  );
};

export const drawThemePreviewCard = ({
  canvas,
  theme,
  selected = false,
  activeTheme,
  cardWidth = themeCardMetrics.width,
  pixelRatio = 1,
} = {}) => {
  const context = canvas?.getContext?.("2d");
  if (!context || !theme) {
    return;
  }
  const previewTheme = previewSource(theme);
  const currentPreviewTheme = previewSource(activeTheme);
  const ratio = Math.max(1, Math.floor(Number(pixelRatio) || 1));
  canvas.width = cardWidth * ratio;
  canvas.height = themeCardMetrics.height * ratio;
  if (canvas.style) {
    canvas.style.width = `${cardWidth}px`;
    canvas.style.height = `${themeCardMetrics.height}px`;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cardWidth, themeCardMetrics.height);

  const cardX = themeCardMetrics.outerPadding;
  const width = cardWidth - themeCardMetrics.outerPadding * 2;
  drawRoundedRect(context, cardX, 0, width, themeCardMetrics.height, themeCardMetrics.cornerRadius);
  context.fillStyle = rgbaFromThemeColor(previewTheme.background, themeCardMetrics.backgroundAlpha);
  context.fill();
  if (selected) {
    const borderWidth = 1;
    const inset = borderWidth / 2;
    drawRoundedRect(
      context,
      cardX + inset,
      inset,
      width - borderWidth,
      themeCardMetrics.height - borderWidth,
      Math.max(0, themeCardMetrics.cornerRadius - inset),
    );
    context.strokeStyle = currentPreviewTheme.foreground || previewTheme.foreground;
    context.lineWidth = borderWidth;
    context.stroke();
  }

  context.font = previewFont;
  context.textBaseline = "alphabetic";
  let textX = cardX + themeCardMetrics.contentInset;
  textX += drawText(context, "lazycat", textX, themeCardMetrics.previewLineY, previewTextColor(previewTheme, previewTheme.color11));
  textX += drawText(context, "@", textX, themeCardMetrics.previewLineY, previewTextColor(previewTheme, previewTheme.foreground));
  textX += drawText(context, "terminal", textX, themeCardMetrics.previewLineY, previewTextColor(previewTheme, previewTheme.color13));
  drawText(context, ":~/Theme$ _", textX, themeCardMetrics.previewLineY, previewTextColor(previewTheme, previewTheme.foreground));
  drawText(context, previewTheme.name, cardX + themeCardMetrics.contentInset, themeCardMetrics.nameLineY, previewTextColor(previewTheme, previewTheme.foreground));
};
