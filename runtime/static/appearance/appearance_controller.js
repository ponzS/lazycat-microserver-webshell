import { createAppearanceLifecycle } from "./appearance_lifecycle.js";
import { createThemeCatalogLoader, fallbackThemeCatalog } from "./theme_catalog.js";
import {
  cloneTheme,
  cloneThemeCatalog,
  selectTheme,
  terminalThemeOptions,
  terminalThemePayload,
} from "./theme_model.js";
import { createAppearanceView, themeCardMetrics } from "./appearance_view.js";

const createAbortError = () => {
  const error = new Error("appearance disposed");
  error.name = "AbortError";
  return error;
};

const readStoredThemeID = (storage, storageKey) => {
  try {
    return String(storage?.getItem?.(storageKey) || "").trim();
  } catch (error) {
    return "";
  }
};

export function createAppearanceController({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  storage = windowObject?.localStorage,
  storageKey = "webshell.theme",
  fetchImpl = globalThis.fetch,
  view = createAppearanceView({ documentObject, windowObject }),
  catalogLoader = createThemeCatalogLoader({ fetchImpl }),
  lifecycleFactory = createAppearanceLifecycle,
  isMobileLayout = () => false,
  preparePickerOpen = () => {},
  onPickerBackdropClose = () => {},
  onThemeChange = () => {},
} = {}) {
  const pickerScrollbarMinThumbPx = 100;
  const pickerSwipeEdgeWidth = 24;
  const pickerSwipeAxisThreshold = 12;
  const pickerSwipeCloseDistance = 56;
  const pickerSwipeMaxVerticalTravel = 40;
  const settingsScrollbarHideDelayMs = 800;

  let themes = fallbackThemeCatalog();
  let activeTheme = selectTheme(themes, readStoredThemeID(storage, storageKey));
  let cardWidth = themeCardMetrics.width;
  let lifecycle = null;
  let started = false;
  let disposed = false;
  let catalogGeneration = 0;
  let catalogAbortController = null;
  let catalogPromise = null;
  let pickerFocusTimer = 0;
  let pickerScrollbarFrame = 0;
  let pickerScrollbarDragging = false;
  let pickerScrollbarPointerID = null;
  let pickerScrollbarThumbPointerOffset = 0;
  let pickerEdgeSwipe = null;
  let settingsScrollbarHideTimer = 0;

  const clearTimer = (timer) => {
    if (timer) {
      windowObject?.clearTimeout?.(timer);
    }
  };

  const cancelFrame = (frame) => {
    if (!frame) {
      return;
    }
    if (typeof windowObject?.cancelAnimationFrame === "function") {
      windowObject.cancelAnimationFrame(frame);
      return;
    }
    windowObject?.clearTimeout?.(frame);
  };

  const requestFrame = (callback) => {
    if (typeof windowObject?.requestAnimationFrame === "function") {
      return windowObject.requestAnimationFrame(callback);
    }
    return windowObject?.setTimeout?.(callback, 0) || 0;
  };

  const themeViewOptions = () => ({ themes, activeTheme, cardWidth });

  const measureCardWidth = () => {
    cardWidth = Number(view.measureCardWidth?.(themes)) || themeCardMetrics.width;
  };

  const schedulePickerScrollbarSync = () => {
    if (disposed || pickerScrollbarFrame) {
      return;
    }
    pickerScrollbarFrame = requestFrame(() => {
      pickerScrollbarFrame = 0;
      if (disposed) {
        return;
      }
      view.syncPickerScrollbar?.({
        visible: view.isPickerOpen?.() === true,
        dragging: pickerScrollbarDragging,
        minThumbPx: pickerScrollbarMinThumbPx,
      });
    });
  };

  const renderPicker = () => {
    measureCardWidth();
    view.renderPicker?.(themeViewOptions());
    schedulePickerScrollbarSync();
  };

  const renderSettingsThemes = () => {
    measureCardWidth();
    view.renderSettingsThemes?.(themeViewOptions());
  };

  const renderAll = () => {
    view.applyDocumentTheme?.(activeTheme);
    renderPicker();
    renderSettingsThemes();
  };

  const stopPickerScrollbarDrag = () => {
    if (!pickerScrollbarDragging) {
      return;
    }
    pickerScrollbarDragging = false;
    pickerScrollbarPointerID = null;
    pickerScrollbarThumbPointerOffset = 0;
    view.setPickerDragging?.(false);
    view.setPickerScrollbarHovering?.(false, false);
  };

  const hideSettingsScrollbar = () => {
    clearTimer(settingsScrollbarHideTimer);
    settingsScrollbarHideTimer = 0;
    view.setSettingsScrolling?.(false);
  };

  const showSettingsScrollbarDuringScroll = () => {
    clearTimer(settingsScrollbarHideTimer);
    view.setSettingsScrolling?.(true);
    settingsScrollbarHideTimer = windowObject?.setTimeout?.(() => {
      settingsScrollbarHideTimer = 0;
      if (!disposed) {
        view.setSettingsScrolling?.(false);
      }
    }, settingsScrollbarHideDelayMs) || 0;
  };

  const closePicker = () => {
    clearTimer(pickerFocusTimer);
    pickerFocusTimer = 0;
    view.closePicker?.();
    stopPickerScrollbarDrag();
    view.setPickerScrollbarHovering?.(false, false);
    pickerEdgeSwipe = null;
    schedulePickerScrollbarSync();
  };

  const applyTheme = (themeID) => {
    if (disposed) {
      return false;
    }
    const nextTheme = selectTheme(themes, themeID);
    if (!nextTheme || nextTheme.id !== String(themeID || "").trim()) {
      return false;
    }
    const previousTheme = cloneTheme(activeTheme);
    activeTheme = nextTheme;
    try {
      storage?.setItem?.(storageKey, activeTheme.id);
    } catch (error) {
    }
    renderAll();
    onThemeChange(cloneTheme(activeTheme), previousTheme);
    return true;
  };

  const handleBackdropClick = (event) => {
    if (!view.isPickerBackdropTarget?.(event?.target)) {
      return;
    }
    const point = {
      clientX: Number(event?.clientX) || 0,
      clientY: Number(event?.clientY) || 0,
    };
    closePicker();
    onPickerBackdropClose(point);
  };

  const resetPickerEdgeSwipe = () => {
    pickerEdgeSwipe = null;
  };

  const handleTouchStart = (event) => {
    if (view.isPickerOpen?.() !== true || !isMobileLayout() || event?.touches?.length !== 1) {
      resetPickerEdgeSwipe();
      return;
    }
    const touch = event.touches[0];
    if (touch.clientX > pickerSwipeEdgeWidth) {
      resetPickerEdgeSwipe();
      return;
    }
    pickerEdgeSwipe = {
      startX: touch.clientX,
      startY: touch.clientY,
      horizontal: false,
    };
  };

  const handleTouchMove = (event) => {
    if (!pickerEdgeSwipe || event?.touches?.length !== 1) {
      return;
    }
    const touch = event.touches[0];
    const deltaX = touch.clientX - pickerEdgeSwipe.startX;
    const deltaY = touch.clientY - pickerEdgeSwipe.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (!pickerEdgeSwipe.horizontal) {
      if (absY > pickerSwipeAxisThreshold && absY > absX) {
        resetPickerEdgeSwipe();
        return;
      }
      if (deltaX > pickerSwipeAxisThreshold && absX > absY * 1.2) {
        pickerEdgeSwipe.horizontal = true;
      }
    }
    if (!pickerEdgeSwipe?.horizontal) {
      return;
    }
    event.preventDefault?.();
    if (deltaX >= pickerSwipeCloseDistance && absY <= pickerSwipeMaxVerticalTravel) {
      closePicker();
    }
  };

  const setPickerScrollFromThumbTop = (nextThumbTop) => {
    if (view.scrollPickerFromThumbTop?.(nextThumbTop, pickerScrollbarMinThumbPx)) {
      schedulePickerScrollbarSync();
    }
  };

  const handleScrollbarTrackPointerDown = (event) => {
    if (view.isPickerThumbTarget?.(event?.target) || event?.button !== 0) {
      return;
    }
    event.preventDefault?.();
    const trackRect = view.pickerScrollbarTrackRect?.();
    if (!trackRect) {
      return;
    }
    const { thumbHeight = 0 } = view.getPickerScrollbarMetrics?.(pickerScrollbarMinThumbPx) || {};
    setPickerScrollFromThumbTop(event.clientY - trackRect.top - thumbHeight / 2);
    view.setPickerScrollbarHovering?.(true, pickerScrollbarDragging);
  };

  const handleScrollbarThumbPointerDown = (event) => {
    if (event?.button !== 0) {
      return;
    }
    const thumbRect = view.pickerScrollbarThumbRect?.();
    if (!thumbRect) {
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    pickerScrollbarDragging = true;
    pickerScrollbarPointerID = event.pointerId;
    pickerScrollbarThumbPointerOffset = event.clientY - thumbRect.top;
    view.setPickerDragging?.(true);
    view.setPickerScrollbarHovering?.(true, true);
  };

  const handleScrollbarPointerMove = (event) => {
    if (!pickerScrollbarDragging || event?.pointerId !== pickerScrollbarPointerID) {
      return;
    }
    const trackRect = view.pickerScrollbarTrackRect?.();
    if (!trackRect) {
      return;
    }
    event.preventDefault?.();
    setPickerScrollFromThumbTop(event.clientY - trackRect.top - pickerScrollbarThumbPointerOffset);
  };

  const handleScrollbarPointerUp = (event) => {
    if (!pickerScrollbarDragging || event?.pointerId !== pickerScrollbarPointerID) {
      return;
    }
    stopPickerScrollbarDrag();
  };

  const lifecycleHandlers = {
    onBackdropClick: handleBackdropClick,
    onClosePicker: closePicker,
    onPickerScroll: schedulePickerScrollbarSync,
    onScrollbarPointerEnter: () => view.setPickerScrollbarHovering?.(true, pickerScrollbarDragging),
    onScrollbarPointerLeave: () => {
      if (!pickerScrollbarDragging) {
        view.setPickerScrollbarHovering?.(false, false);
      }
    },
    onScrollbarPointerMove: handleScrollbarPointerMove,
    onScrollbarPointerUp: handleScrollbarPointerUp,
    onScrollbarThumbPointerDown: handleScrollbarThumbPointerDown,
    onScrollbarTrackPointerDown: handleScrollbarTrackPointerDown,
    onSelectTheme: (event) => applyTheme(view.themeIDFromEvent?.(event)),
    onSettingsScroll: showSettingsScrollbarDuringScroll,
    onTouchEnd: resetPickerEdgeSwipe,
    onTouchMove: handleTouchMove,
    onTouchStart: handleTouchStart,
  };

  return {
    applyTheme,
    closePicker,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      catalogGeneration += 1;
      catalogAbortController?.abort?.();
      catalogAbortController = null;
      catalogPromise = null;
      clearTimer(pickerFocusTimer);
      pickerFocusTimer = 0;
      clearTimer(settingsScrollbarHideTimer);
      settingsScrollbarHideTimer = 0;
      cancelFrame(pickerScrollbarFrame);
      pickerScrollbarFrame = 0;
      lifecycle?.dispose?.();
      lifecycle = null;
      view.dispose?.();
    },
    getActiveTheme: () => cloneTheme(activeTheme),
    getTerminalTheme: () => terminalThemeOptions(activeTheme),
    getTerminalThemePayload: () => terminalThemePayload(activeTheme),
    handleResize() {
      if (disposed) {
        return;
      }
      measureCardWidth();
      view.redrawOptions?.(themeViewOptions());
      schedulePickerScrollbarSync();
    },
    hideSettingsScrollbar,
    isPickerOpen: () => view.isPickerOpen?.() === true,
    async load() {
      if (disposed) {
        throw createAbortError();
      }
      if (catalogPromise) {
        return catalogPromise;
      }
      const generation = ++catalogGeneration;
      catalogAbortController = typeof AbortController === "function" ? new AbortController() : null;
      const signal = catalogAbortController?.signal;
      const promise = (async () => {
        const loadedThemes = await catalogLoader.load({ signal });
        if (disposed || generation !== catalogGeneration) {
          throw createAbortError();
        }
        if (Array.isArray(loadedThemes) && loadedThemes.length > 0) {
          themes = cloneThemeCatalog(loadedThemes);
          activeTheme = selectTheme(themes, readStoredThemeID(storage, storageKey));
        }
        renderAll();
        return this.snapshot();
      })();
      catalogPromise = promise.finally(() => {
        if (generation === catalogGeneration) {
          catalogPromise = null;
          catalogAbortController = null;
        }
      });
      return catalogPromise;
    },
    openPicker() {
      if (disposed) {
        return;
      }
      preparePickerOpen();
      renderPicker();
      view.openPicker?.();
      clearTimer(pickerFocusTimer);
      pickerFocusTimer = windowObject?.setTimeout?.(() => {
        pickerFocusTimer = 0;
        if (disposed || view.isPickerOpen?.() !== true) {
          return;
        }
        schedulePickerScrollbarSync();
        view.focusSelectedThemeOption?.();
      }, 0) || 0;
    },
    redraw: () => {
      if (!disposed) {
        view.redrawOptions?.(themeViewOptions());
      }
    },
    renderPicker,
    renderSettingsThemes,
    snapshot: () => ({
      activeTheme: cloneTheme(activeTheme),
      themes: cloneThemeCatalog(themes),
      loading: Boolean(catalogPromise),
      pickerOpen: view.isPickerOpen?.() === true,
      started,
    }),
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      lifecycle = lifecycleFactory({
        windowObject,
        elements: view.elements || {},
        handlers: lifecycleHandlers,
      });
      lifecycle.start?.();
      renderAll();
    },
  };
}
