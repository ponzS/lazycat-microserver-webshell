import { themeRGBA, normalizeThemeColor } from "./theme_model.js";
import {
  drawThemePreviewCard,
  measureThemeCardWidth,
  themeCardMetrics,
} from "./theme_preview.js";

export function createAppearanceView({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
} = {}) {
  const byID = (id) => documentObject?.getElementById?.(id) || null;
  const elements = {
    pickerBackdrop: byID("themePickerBackdrop"),
    pickerClose: byID("themePickerClose"),
    pickerList: byID("themePickerList"),
    pickerScrollbarSensor: byID("themePickerScrollbarSensor"),
    pickerScrollbarTrack: byID("themePickerScrollbarTrack"),
    pickerScrollbarThumb: byID("themePickerScrollbarThumb"),
    settingsThemePanel: byID("settingsPanelTheme"),
    settingsThemeList: byID("settingsThemeList"),
  };

  const setCSS = (name, value) => {
    documentObject?.documentElement?.style?.setProperty?.(name, value);
  };

  const renderOptions = (list, { themes = [], activeTheme, cardWidth } = {}) => {
    if (!list || !documentObject?.createElement) {
      return;
    }
    list.textContent = "";
    for (const theme of themes) {
      const option = documentObject.createElement("button");
      option.type = "button";
      option.className = "theme-picker-option";
      option.dataset.theme = theme.id;
      option.setAttribute("role", "option");
      option.setAttribute("aria-label", `使用 ${theme.name} 主题`);
      const selected = theme.id === activeTheme?.id;
      option.setAttribute("aria-selected", selected ? "true" : "false");
      option.setAttribute("aria-pressed", selected ? "true" : "false");
      const canvas = documentObject.createElement("canvas");
      canvas.className = "theme-picker-canvas";
      option.appendChild(canvas);
      list.appendChild(option);
      drawThemePreviewCard({
        canvas,
        theme,
        selected,
        activeTheme,
        cardWidth,
        pixelRatio: windowObject?.devicePixelRatio || 1,
      });
    }
  };

  const redrawOptions = (list, { themes = [], activeTheme, cardWidth } = {}) => {
    for (const option of list?.querySelectorAll?.(".theme-picker-option") || []) {
      const theme = themes.find((item) => item.id === option.dataset.theme);
      const selected = theme?.id === activeTheme?.id;
      option.setAttribute("aria-selected", selected ? "true" : "false");
      option.setAttribute("aria-pressed", selected ? "true" : "false");
      drawThemePreviewCard({
        canvas: option.querySelector?.(".theme-picker-canvas"),
        theme,
        selected,
        activeTheme,
        cardWidth,
        pixelRatio: windowObject?.devicePixelRatio || 1,
      });
    }
  };

  return {
    elements,
    applyDocumentTheme(theme) {
      if (!theme) {
        return;
      }
      setCSS("--terminal-bg", theme.background);
      setCSS("--terminal-fg", theme.foreground);
      setCSS("--accent", theme.accent);
      setCSS("--selection-bg", theme.xterm?.selectionBackground || theme.foreground);
      setCSS("--chrome-bg", theme.background);
      setCSS("--chrome-line", themeRGBA(theme.foreground, 0.18));
      setCSS("--chrome-text", themeRGBA(theme.foreground, 0.78));
      setCSS("--chrome-text-muted", themeRGBA(theme.foreground, 0.64));
      setCSS("--chrome-text-strong", theme.foreground);
      setCSS("--chrome-hover-bg", themeRGBA(theme.foreground, 0.1));
      setCSS("--panel-bg", themeRGBA(theme.background, 0.96, "#111827"));
      setCSS("--panel-border", themeRGBA(theme.foreground, 0.24));
      setCSS("--panel-hover-bg", themeRGBA(theme.foreground, 0.14));
      setCSS("--panel-subtle-bg", themeRGBA(theme.foreground, 0.08));
      setCSS("--panel-input-bg", themeRGBA(theme.foreground, 0.1));
      setCSS("--modal-backdrop-bg", themeRGBA(theme.background, 0.28, "#000000"));
      setCSS("--dialog-button-bg", themeRGBA(theme.foreground, 0.14));
      setCSS("--dialog-button-hover-bg", themeRGBA(theme.foreground, 0.22));
      setCSS("--dialog-button-border", themeRGBA(theme.foreground, 0.28));
      setCSS("--dialog-button-text", theme.foreground);
      setCSS("--text", theme.foreground);
      setCSS("--muted", themeRGBA(theme.foreground, 0.68));
      setCSS("--theme-picker-scrollbar", themeRGBA(theme.foreground, 0.3));
      setCSS("--theme-picker-scrollbar-hover", themeRGBA(theme.foreground, 0.45));
      setCSS("--theme-picker-scrollbar-active", themeRGBA(theme.foreground, 0.6));
      setCSS("--input-focus-border", themeRGBA(theme.accent, 0.52));
      const meta = documentObject?.querySelector?.('meta[name="theme-color"]');
      meta?.setAttribute?.("content", normalizeThemeColor(theme.background));
      if (documentObject?.body?.dataset) {
        documentObject.body.dataset.theme = theme.id;
      }
    },
    closePicker() {
      if (elements.pickerBackdrop) {
        elements.pickerBackdrop.hidden = true;
      }
    },
    dispose() {
      this.closePicker();
      this.setPickerDragging(false);
      this.setPickerScrollbarHovering(false, false);
      this.setSettingsScrolling(false);
      elements.pickerScrollbarTrack?.classList?.remove?.("is-visible", "has-scroll");
    },
    focusSelectedThemeOption() {
      elements.pickerList?.querySelector?.('.theme-picker-option[aria-selected="true"]')?.focus?.();
    },
    getPickerScrollbarMetrics(minThumbPx = 100) {
      const viewportHeight = elements.pickerList?.clientHeight || 0;
      const scrollHeight = elements.pickerList?.scrollHeight || 0;
      const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);
      const trackHeight = Math.max(0, elements.pickerScrollbarTrack?.clientHeight || 0);
      const hasScroll = maxScrollTop > 0 && trackHeight > 0;
      const thumbHeight = hasScroll
        ? Math.min(trackHeight, Math.max(minThumbPx, Math.round((viewportHeight / scrollHeight) * trackHeight)))
        : 0;
      const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
      const scrollRatio = maxScrollTop > 0 ? elements.pickerList.scrollTop / maxScrollTop : 0;
      return {
        hasScroll,
        maxScrollTop,
        thumbHeight,
        maxThumbTop,
        thumbTop: maxThumbTop * scrollRatio,
      };
    },
    isPickerOpen() {
      return Boolean(elements.pickerBackdrop && !elements.pickerBackdrop.hidden);
    },
    isPickerBackdropTarget(target) {
      return target === elements.pickerBackdrop;
    },
    isPickerThumbTarget(target) {
      return target === elements.pickerScrollbarThumb;
    },
    measureCardWidth(themes) {
      const width = measureThemeCardWidth({ documentObject, themes });
      setCSS("--theme-picker-card-width", `${width}px`);
      return width;
    },
    openPicker() {
      if (elements.pickerBackdrop) {
        elements.pickerBackdrop.hidden = false;
      }
    },
    pickerScrollbarThumbRect() {
      return elements.pickerScrollbarThumb?.getBoundingClientRect?.() || null;
    },
    pickerScrollbarTrackRect() {
      return elements.pickerScrollbarTrack?.getBoundingClientRect?.() || null;
    },
    redrawOptions(options) {
      redrawOptions(elements.pickerList, options);
      redrawOptions(elements.settingsThemeList, options);
    },
    renderPicker(options) {
      renderOptions(elements.pickerList, options);
    },
    renderSettingsThemes(options) {
      renderOptions(elements.settingsThemeList, options);
    },
    scrollPickerFromThumbTop(nextThumbTop, minThumbPx = 100) {
      if (!elements.pickerList) {
        return false;
      }
      const { hasScroll, maxScrollTop, maxThumbTop } = this.getPickerScrollbarMetrics(minThumbPx);
      if (!hasScroll) {
        return false;
      }
      const clampedThumbTop = Math.max(0, Math.min(maxThumbTop, nextThumbTop));
      const scrollRatio = maxThumbTop > 0 ? clampedThumbTop / maxThumbTop : 0;
      elements.pickerList.scrollTop = scrollRatio * maxScrollTop;
      return true;
    },
    setPickerDragging(dragging) {
      elements.pickerScrollbarThumb?.classList?.toggle?.("is-dragging", dragging === true);
    },
    setPickerScrollbarHovering(hovering, dragging) {
      elements.pickerScrollbarTrack?.classList?.toggle?.("is-hovering", hovering === true || dragging === true);
    },
    setSettingsScrolling(scrolling) {
      elements.settingsThemePanel?.classList?.toggle?.("is-scrolling", scrolling === true);
      elements.settingsThemeList?.classList?.toggle?.("is-scrolling", scrolling === true);
    },
    syncPickerScrollbar({ visible = false, dragging = false, minThumbPx = 100 } = {}) {
      const metrics = this.getPickerScrollbarMetrics(minThumbPx);
      const show = visible && metrics.hasScroll;
      elements.pickerScrollbarTrack?.classList?.toggle?.("has-scroll", metrics.hasScroll);
      elements.pickerScrollbarTrack?.classList?.toggle?.("is-visible", show);
      if (elements.pickerScrollbarThumb?.style) {
        elements.pickerScrollbarThumb.style.height = metrics.hasScroll ? `${metrics.thumbHeight}px` : "0px";
        elements.pickerScrollbarThumb.style.transform = metrics.hasScroll ? `translateY(${metrics.thumbTop}px)` : "";
      }
      if (!metrics.hasScroll && !dragging) {
        this.setPickerScrollbarHovering(false, false);
      }
      return metrics;
    },
    themeIDFromEvent(event) {
      return String(event?.target?.closest?.(".theme-picker-option")?.dataset?.theme || "").trim();
    },
  };
}

export { themeCardMetrics };
