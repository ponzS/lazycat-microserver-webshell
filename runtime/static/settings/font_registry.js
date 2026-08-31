const cssString = (value) => `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function createFontRegistry({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  FontFaceCtor = globalThis.FontFace,
} = {}) {
  const faces = new Map();
  let generation = 0;
  let disposed = false;

  const keyFor = (font) => `${font?.id || ""}:${font?.family || ""}`;
  const sourceFor = (font) => new URL(
    font?.url || `api/settings/fonts/${encodeURIComponent(font?.id || "")}/file`,
    windowObject?.location?.href || "http://localhost/",
  ).toString();

  const register = async (font, expectedGeneration) => {
    const key = keyFor(font);
    if (!font?.id || !font?.family || faces.has(key) || typeof FontFaceCtor !== "function" || !documentObject?.fonts) {
      return;
    }
    const face = new FontFaceCtor(font.family, `url(${cssString(sourceFor(font))})`, { display: "swap" });
    await face.load();
    if (disposed || expectedGeneration !== generation) {
      return;
    }
    documentObject.fonts.add(face);
    faces.set(key, face);
  };

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      for (const face of faces.values()) {
        documentObject?.fonts?.delete?.(face);
      }
      faces.clear();
    },
    async registerAll(fonts, symbolFont) {
      if (disposed) return { fontFailures: [], symbolFailed: false };
      const expectedGeneration = ++generation;
      let symbolFailed = false;
      const fontFailures = [];
      if (symbolFont) {
        try {
          await register(symbolFont, expectedGeneration);
        } catch (error) {
          symbolFailed = true;
        }
      }
      await Promise.all(Array.from(fonts || []).map(async (font) => {
        try {
          await register(font, expectedGeneration);
        } catch (error) {
          fontFailures.push(font?.label || font?.filename || font?.id || "未知字体");
        }
      }));
      if (disposed || expectedGeneration !== generation) {
        return { fontFailures: [], symbolFailed: false, stale: true };
      }
      return { fontFailures, symbolFailed, stale: false };
    },
  };
}
