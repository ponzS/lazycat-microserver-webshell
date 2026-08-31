export function createAppearanceLifecycle({
  windowObject = globalThis.window,
  elements = {},
  handlers = {},
} = {}) {
  const listeners = [];
  let started = false;
  let disposed = false;

  const listen = (target, type, listener, options) => {
    if (!target?.addEventListener || typeof listener !== "function") {
      return;
    }
    target.addEventListener(type, listener, options);
    listeners.push([target, type, listener, options]);
  };

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const [target, type, listener, options] of listeners.splice(0)) {
        target.removeEventListener?.(type, listener, options);
      }
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      listen(elements.pickerClose, "click", handlers.onClosePicker);
      listen(elements.pickerBackdrop, "click", handlers.onBackdropClick);
      listen(elements.pickerBackdrop, "touchstart", handlers.onTouchStart, { passive: true });
      listen(elements.pickerBackdrop, "touchmove", handlers.onTouchMove, { passive: false });
      listen(elements.pickerBackdrop, "touchend", handlers.onTouchEnd, { passive: true });
      listen(elements.pickerBackdrop, "touchcancel", handlers.onTouchEnd, { passive: true });
      listen(elements.pickerList, "click", handlers.onSelectTheme);
      listen(elements.settingsThemeList, "click", handlers.onSelectTheme);
      listen(elements.settingsThemePanel, "scroll", handlers.onSettingsScroll, { passive: true });
      listen(elements.settingsThemeList, "scroll", handlers.onSettingsScroll, { passive: true });
      listen(elements.pickerList, "scroll", handlers.onPickerScroll, { passive: true });
      listen(elements.pickerScrollbarSensor, "pointerenter", handlers.onScrollbarPointerEnter);
      listen(elements.pickerScrollbarSensor, "pointerleave", handlers.onScrollbarPointerLeave);
      listen(elements.pickerScrollbarTrack, "pointerdown", handlers.onScrollbarTrackPointerDown);
      listen(elements.pickerScrollbarThumb, "pointerdown", handlers.onScrollbarThumbPointerDown);
      listen(windowObject, "pointermove", handlers.onScrollbarPointerMove, { passive: false });
      listen(windowObject, "pointerup", handlers.onScrollbarPointerUp);
      listen(windowObject, "pointercancel", handlers.onScrollbarPointerUp);
    },
  };
}
