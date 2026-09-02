const activeHost = (page) => page.locator(".terminal-pane.active .terminal-host").first();

const installGeometrySampler = async (page) => page.evaluate(() => {
  const startedAt = performance.now();
  const samples = [];
  const events = [];
  window.__testsAutoResizeTrace = [];
  window.__testsAutoPresentationTrace = [];
  const selector = ".terminal-pane.active .terminal-host";
  const snapshot = (kind = "raf") => {
    const host = document.querySelector(selector);
    const shell = host?.closest(".pane-shell");
    const live = host?.querySelector("canvas:not(.terminal-frame-hold)");
    const hold = host?.querySelector("canvas.terminal-frame-hold");
    const rect = (element) => {
      const value = element?.getBoundingClientRect?.();
      return {
        top: Number(value?.top || 0),
        left: Number(value?.left || 0),
        width: Number(value?.width || 0),
        height: Number(value?.height || 0),
      };
    };
    samples.push({
      at: Math.round(performance.now() - startedAt),
      kind,
      devicePixelRatio: Number(window.devicePixelRatio || 1),
      host: rect(host),
      live: rect(live),
      hold: rect(hold),
      liveBacking: { width: Number(live?.width || 0), height: Number(live?.height || 0) },
      liveScale: {
        x: host ? Number(live?.getBoundingClientRect?.().width || 0) / Math.max(1, Number(host.getBoundingClientRect?.().width || 0)) : 0,
        y: host ? Number(live?.getBoundingClientRect?.().height || 0) / Math.max(1, Number(host.getBoundingClientRect?.().height || 0)) : 0,
      },
      holdBacking: { width: Number(hold?.width || 0), height: Number(hold?.height || 0) },
      liveStyle: { width: live?.style?.width || "", height: live?.style?.height || "" },
      liveVisibility: live ? getComputedStyle(live).visibility : "",
      holdStyle: { width: hold?.style?.width || "", height: hold?.style?.height || "" },
      holdHidden: hold?.hidden !== false,
      renderReady: shell?.dataset?.renderReady || "",
      renderRecovery: shell?.dataset?.renderRecovery || "",
      terminalFrameHeld: shell?.dataset?.terminalFrameHeld || "",
      hasPresentedFrame: shell?.dataset?.hasPresentedFrame || "",
    });
  };
  const onEvent = (event) => {
    events.push({
      at: Math.round(performance.now() - startedAt),
      type: event.type,
      target: event.target?.tagName || "",
      key: event.key || "",
    });
    snapshot(`event:${event.type}`);
  };
  for (const type of ["resize", "focusin", "focusout", "keydown", "keyup"]) {
    window.addEventListener(type, onEvent, true);
  }
  let running = true;
  const tick = () => {
    if (!running) return;
    snapshot();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  snapshot("start");
  window.__testsAutoGeometrySampler = {
    reset(label = "reset") {
      samples.length = 0;
      events.length = 0;
      snapshot(label);
    },
    stop() {
      running = false;
      for (const type of ["resize", "focusin", "focusout", "keydown", "keyup"]) {
        window.removeEventListener(type, onEvent, true);
      }
      snapshot("stop");
      return { samples, events };
    },
  };
});

const readSamples = (page) => page.evaluate(() => ({
  ...(window.__testsAutoGeometrySampler?.stop?.() || { samples: [], events: [] }),
  resizeTrace: window.__testsAutoResizeTrace || [],
  presentationTrace: window.__testsAutoPresentationTrace || [],
}));

const resetSampler = (page, label) => page.evaluate((value) => window.__testsAutoGeometrySampler?.reset?.(value), label);

const visibleHoldSamples = (result) => result.samples.filter((sample) => sample.holdHidden === false);

const geometryChanges = (result) => {
  const usable = result.samples.filter((sample) => sample.host.width > 0 && sample.host.height > 0);
  const baseline = usable[0];
  if (!baseline) return [];
  return usable.filter((sample) => (
    Math.abs(sample.host.top - baseline.host.top) > 1
      || Math.abs(sample.host.height - baseline.host.height) > 1
      || Math.abs(sample.live.top - baseline.live.top) > 1
      || Math.abs(sample.live.left - baseline.live.left) > 1
  ));
};

const assertNoUnsafeHold = (label, result) => {
  const visible = visibleHoldSamples(result);
  const unsafe = result.samples.filter((sample) => (
    sample.hasPresentedFrame === "true"
      && sample.renderReady === "false"
      && sample.holdHidden
  ));
  const unsafeLiveDuringHold = result.samples.filter((sample) => (
    sample.holdHidden === false
      && sample.renderReady === "false"
      && sample.hasPresentedFrame === "true"
      && sample.liveVisibility !== "hidden"
  ));
  if (unsafe.length || unsafeLiveDuringHold.length || visible.some((sample) => (
    sample.hold.top < sample.host.top - 1
      || sample.hold.top + sample.hold.height > sample.host.top + sample.host.height + 1
      || sample.hold.left < sample.host.left - 1
      || sample.hold.left + sample.hold.width > sample.host.left + sample.host.width + 1
      || Math.abs(sample.holdBacking.width - sample.host.width * Math.max(1, sample.devicePixelRatio || 1)) > 2
      || Math.abs(sample.holdBacking.height - sample.host.height * Math.max(1, sample.devicePixelRatio || 1)) > 2
  ))) {
    throw new Error(`${label}: unsafe presentation geometry ${JSON.stringify({ unsafe, unsafeLiveDuringHold, visible })}`);
  }
  const last = result.samples.at(-1);
  if (last && last.holdHidden === false) {
    throw new Error(`${label}: presentation hold remained visible after settle ${JSON.stringify(last)}`);
  }
};

const triggerFontSize = (page, key = "=") => page.evaluate((value) => {
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: value,
    code: value === "-" ? "Minus" : "Equal",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }));
}, key);

const triggerMobileZoom = async (page, action) => {
  const button = page.locator(`[data-mobile-action="${action}"]`).first();
  if (await button.count() === 0) {
    throw new Error(`mobile shortcut is unavailable: ${action}`);
  }
  await button.click();
};

const tabIDs = (page) => page.locator("#tabs .tab").evaluateAll((buttons) => (
  buttons.map((button) => ({ id: button.dataset.tabId || "", active: button.classList.contains("active") }))
));

export async function run({ config, states, eventLog, assertNoFatalErrors }) {
  if (!config.localStaticDir) throw new Error("WEBSHELL_LOCAL_STATIC_DIR is required");
  const { desktop, mobile } = states;
  const page = desktop.page;
  const host = activeHost(page);
  await page.waitForSelector('.terminal-pane.active .pane-shell[data-connection="open"]', { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector(".terminal-pane.active .terminal-host canvas:not(.terminal-frame-hold)")?.width > 0, { timeout: 30_000 });
  await page.waitForTimeout(700);
  await installGeometrySampler(page);

  await resetSampler(page, "font-start");
  await triggerFontSize(page, "=");
  await page.waitForTimeout(1_000);
  const fontResult = await readSamples(page);
  await eventLog({
    status: "info",
    action: "terminal-geometry-jitter-font-debug",
    font: {
      samples: fontResult.samples,
      events: fontResult.events,
      resizeTrace: fontResult.resizeTrace,
      presentationTrace: fontResult.presentationTrace,
    },
  });
  assertNoUnsafeHold("font-size", fontResult);

  await installGeometrySampler(mobile.page);
  await resetSampler(mobile.page, "mobile-zoom-start");
  await triggerMobileZoom(mobile.page, "zoom_in");
  await mobile.page.waitForTimeout(250);
  await triggerMobileZoom(mobile.page, "zoom_out");
  await mobile.page.waitForTimeout(1_000);
  const mobileZoomResult = await readSamples(mobile.page);
  assertNoUnsafeHold("mobile-zoom", mobileZoomResult);

  await installGeometrySampler(page);
  await resetSampler(page, "viewport-start");
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: Math.max(900, viewport.width - 180), height: Math.max(620, viewport.height - 90) });
  await page.waitForTimeout(1_200);
  const viewportResult = await readSamples(page);
  assertNoUnsafeHold("viewport-resize", viewportResult);
  await page.setViewportSize(viewport);
  await page.waitForTimeout(700);

  const tabs = await tabIDs(page);
  const currentTab = tabs.find((tab) => tab.active)?.id || "";
  const otherTab = tabs.find((tab) => tab.id && tab.id !== currentTab)?.id || "";
  let tabResult = { samples: [], events: [] };
  if (otherTab) {
    await installGeometrySampler(page);
    await resetSampler(page, "tab-start");
    await page.locator(`#tabs .tab[data-tab-id="${otherTab}"]`).click();
    await page.waitForTimeout(1_000);
    await page.locator(`#tabs .tab[data-tab-id="${currentTab}"]`).click();
    await page.waitForTimeout(1_000);
    tabResult = await readSamples(page);
    assertNoUnsafeHold("tab-activation", tabResult);
  }

  await eventLog({
    status: "info",
    action: "terminal-geometry-jitter-samples",
    tabs,
    currentTab,
    otherTab,
    font: { visibleHold: visibleHoldSamples(fontResult).length, geometryChanges: geometryChanges(fontResult).length, events: fontResult.events, samples: fontResult.samples, resizeTrace: fontResult.resizeTrace, presentationTrace: fontResult.presentationTrace },
    mobileZoom: {
      visibleHold: visibleHoldSamples(mobileZoomResult).length,
      geometryChanges: geometryChanges(mobileZoomResult).length,
      events: mobileZoomResult.events,
      samples: mobileZoomResult.samples,
      resizeTrace: mobileZoomResult.resizeTrace,
      presentationTrace: mobileZoomResult.presentationTrace,
    },
    viewport: { visibleHold: visibleHoldSamples(viewportResult).length, geometryChanges: geometryChanges(viewportResult).length, events: viewportResult.events, samples: viewportResult.samples, resizeTrace: viewportResult.resizeTrace, presentationTrace: viewportResult.presentationTrace },
    tab: { visibleHold: visibleHoldSamples(tabResult).length, geometryChanges: geometryChanges(tabResult).length, events: tabResult.events, samples: tabResult.samples, resizeTrace: tabResult.resizeTrace, presentationTrace: tabResult.presentationTrace },
  });
  assertNoFatalErrors();
  await eventLog({ status: "pass", action: "terminal-geometry-jitter-check" });
}
