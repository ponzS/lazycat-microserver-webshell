const clonePalette = (palette) => Array.isArray(palette) ? [...palette] : palette;

export const cloneTheme = (theme) => {
  if (!theme || typeof theme !== "object") {
    return null;
  }
  return {
    ...theme,
    palette: clonePalette(theme.palette),
    xterm: { ...(theme.xterm || {}) },
  };
};

export const cloneThemeCatalog = (themes) => (
  Array.isArray(themes) ? themes.map(cloneTheme).filter(Boolean) : []
);

const hexToRGB = (value) => {
  const normalized = String(value || "").trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return null;
  }
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
};

const colorFromChannels = (red, green, blue) => {
  const normalizeChannel = (value) => (
    Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()
  );
  return `#${normalizeChannel(red)}${normalizeChannel(green)}${normalizeChannel(blue)}`;
};

export const normalizeThemeColor = (value, fallback = "#000000") => {
  const rgb = hexToRGB(value);
  return rgb ? colorFromChannels(rgb[0], rgb[1], rgb[2]) : fallback;
};

const parseThemeColor = (color) => {
  const rgb = hexToRGB(normalizeThemeColor(color)) || [0, 0, 0];
  return { red: rgb[0], green: rgb[1], blue: rgb[2] };
};

export const themeRGBA = (color, alpha, fallback = "#e5e7eb") => {
  const rgb = hexToRGB(color) || hexToRGB(fallback);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : fallback;
};

export const rgbaFromThemeColor = (color, alpha) => {
  const { red, green, blue } = parseThemeColor(color);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

export const dimThemeColor = (color, factor = 0.3) => {
  const { red, green, blue } = parseThemeColor(color);
  return `rgb(${Math.round(red * factor)}, ${Math.round(green * factor)}, ${Math.round(blue * factor)})`;
};

export const themeBrightness = (color) => {
  const { red, green, blue } = parseThemeColor(color);
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
};

export const normalizeThemeCatalog = (catalog) => {
  if (!Array.isArray(catalog)) {
    return [];
  }
  const normalized = [];
  for (const item of catalog) {
    const id = String(item?.id || "").trim();
    const xterm = item?.xterm && typeof item.xterm === "object" ? { ...item.xterm } : null;
    if (!id || !xterm?.background || !xterm?.foreground) {
      continue;
    }
    const background = String(item?.background || xterm.background).trim() || "#000000";
    const foreground = String(item?.foreground || xterm.foreground).trim() || "#FFFFFF";
    const accent = String(item?.accent || xterm.cursor || foreground).trim() || foreground;
    normalized.push({
      ...item,
      id,
      name: String(item?.name || id).trim() || id,
      accent,
      background,
      foreground,
      palette: clonePalette(item?.palette),
      xterm,
    });
  }
  return normalized;
};

export const selectTheme = (themes, themeID) => {
  const catalog = Array.isArray(themes) ? themes : [];
  const requestedID = String(themeID || "").trim();
  return catalog.find((theme) => theme.id === requestedID) || catalog[0] || null;
};

export const terminalThemeOptions = (theme) => {
  const active = theme || {};
  const xterm = { ...(active.xterm || {}) };
  xterm.cursor = xterm.foreground || active.foreground || "#FFFFFF";
  return xterm;
};

export const terminalThemePayload = (theme) => {
  const active = theme || {};
  const xterm = active.xterm || {};
  return {
    foreground: normalizeThemeColor(xterm.foreground || active.foreground || "#00cd00", "#00CD00"),
    background: normalizeThemeColor(xterm.background || active.background || "#000000", "#000000"),
    cursor: normalizeThemeColor(xterm.cursor || active.foreground || "#00cd00", "#00CD00"),
  };
};
