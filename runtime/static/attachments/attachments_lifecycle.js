export function createAttachmentsLifecycle({ elements = {}, handlers = {} } = {}) {
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
      listen(elements.toggle, "click", handlers.onOpenDialog);
      listen(elements.dialogClose, "click", handlers.onCloseDialog);
      listen(elements.dialogBackdrop, "click", handlers.onDialogBackdrop);
      listen(elements.clipboardButton, "click", handlers.onImportClipboard);
      listen(elements.fileButton, "click", handlers.onSelectFiles);
      listen(elements.browserButton, "click", handlers.onOpenBrowser);
      listen(elements.browserClose, "click", handlers.onCloseBrowser);
      listen(elements.browserCancel, "click", handlers.onCloseBrowser);
      listen(elements.browserBackdrop, "click", handlers.onBrowserBackdrop);
      listen(elements.browserBack, "click", handlers.onCloseBrowser);
      listen(elements.browserBreadcrumbs, "click", handlers.onBreadcrumb);
      listen(elements.browserSortbar, "click", handlers.onSort);
      listen(elements.browserBackdrop, "touchstart", handlers.onTouchStart, { passive: true });
      listen(elements.browserBackdrop, "touchmove", handlers.onTouchMove, { passive: false });
      listen(elements.browserBackdrop, "touchend", handlers.onTouchEnd, { passive: true });
      listen(elements.browserBackdrop, "touchcancel", handlers.onTouchEnd, { passive: true });
      listen(elements.browserList, "click", handlers.onBrowserItem);
      listen(elements.browserList, "change", handlers.onSelectionChange);
      listen(elements.browserDownload, "click", handlers.onDownloadSelected);
      listen(elements.fileInput, "change", handlers.onFileInputChange);
      listen(elements.fileInput, "cancel", handlers.onFileInputCancel);
    },
  };
}
