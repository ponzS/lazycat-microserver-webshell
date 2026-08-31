(() => {
  const lazycatIOSUserAgent = "Lazycat_103";
  const closeButtonBridgeName = "SetCloseBtnShowStatus";
  const reinforceDelays = [250];

  const isLazycatIOSHost = () => String(navigator.userAgent || "").includes(lazycatIOSUserAgent);

  const hideCloseButton = () => {
    if (!isLazycatIOSHost()) {
      return;
    }
    const bridge = window?.webkit?.messageHandlers?.[closeButtonBridgeName];
    if (!bridge?.postMessage) {
      return;
    }
    bridge.postMessage({ params: [false] });
  };

  const reinforceHiddenCloseButton = () => {
    hideCloseButton();
    for (const delay of reinforceDelays) {
      window.setTimeout(hideCloseButton, delay);
    }
  };

  reinforceHiddenCloseButton();
  document.addEventListener("DOMContentLoaded", reinforceHiddenCloseButton, { once: true });
  window.addEventListener("pageshow", reinforceHiddenCloseButton);
  window.addEventListener("focus", reinforceHiddenCloseButton);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      reinforceHiddenCloseButton();
    }
  });
})();
