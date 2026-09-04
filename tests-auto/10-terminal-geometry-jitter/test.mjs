const activeHost = (page) => page.locator(".terminal-pane.active .terminal-host").first();

const waitForReadyPresentation = (page) => page.waitForFunction(() => {
  const shell = document.querySelector(".terminal-pane.active .pane-shell");
  const connection = shell?.dataset?.connection || "";
  return shell?.dataset?.renderReady === "true"
    && shell?.dataset?.hasPresentedFrame === "true"
    && !["offline", "network-error", "error", "closed"].includes(connection);
}, null, { timeout: 60_000 });

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
      theme: document.body?.dataset?.theme || "",
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

const liveCanvasSizeChanges = (result) => new Set(result.samples.map((sample) => JSON.stringify([
  Math.round(sample.live.width),
  Math.round(sample.live.height),
  sample.liveBacking.width,
  sample.liveBacking.height,
]))).size;

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

const assertLiveFontGeometry = (label, result) => {
  const usable = result.samples.filter((sample) => (
    sample.host.width > 0
      && sample.host.height > 0
      && sample.live.width > 0
      && sample.live.height > 0
      && sample.hasPresentedFrame === "true"
  ));
  const unsafe = usable.filter((sample) => (
    sample.holdHidden === false
      || sample.liveVisibility !== "visible"
      || sample.renderReady !== "true"
      || Math.abs(sample.live.top - sample.host.top) > 1
      || Math.abs(sample.live.left - sample.host.left) > 1
  ));
  const last = usable.at(-1);
  if (
    usable.length < 3
      || unsafe.length > 0
      || liveCanvasSizeChanges(result) < 2
      || !last
      || Math.abs(last.live.width - last.host.width) > 16
      || Math.abs(last.live.height - last.host.height) > 16
  ) {
    throw new Error(`${label}: font geometry did not stay on the live canvas ${JSON.stringify({
      usable: usable.length,
      unsafe: unsafe.slice(0, 12),
      canvasSizes: liveCanvasSizeChanges(result),
      last,
    })}`);
  }
};

const assertLiveVisualUpdate = (label, result, { requireThemeChange = false } = {}) => {
  const usable = result.samples.filter((sample) => (
    sample.host.width > 0
      && sample.host.height > 0
      && sample.live.width > 0
      && sample.live.height > 0
      && sample.hasPresentedFrame === "true"
  ));
  const unsafe = usable.filter((sample) => (
    sample.holdHidden === false
      || sample.liveVisibility !== "visible"
      || sample.renderReady !== "true"
      || Math.abs(sample.live.top - sample.host.top) > 1
      || Math.abs(sample.live.left - sample.host.left) > 1
  ));
  const themes = new Set(usable.map((sample) => sample.theme).filter(Boolean));
  if (usable.length < 3 || unsafe.length > 0 || (requireThemeChange && themes.size < 2)) {
    throw new Error(`${label}: visual update did not stay on the live canvas ${JSON.stringify({
      usable: usable.length,
      unsafe: unsafe.slice(0, 12),
      themes: [...themes],
    })}`);
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

const setLineHeight = (page, requestedValue = null) => page.evaluate((requested) => {
  const input = document.getElementById("settingsLineHeightInput");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("line-height input is unavailable");
  }
  const previous = Number(input.value || 0);
  const minimum = Number(input.min || 100);
  const maximum = Number(input.max || 200);
  const next = requested === null
    ? Math.max(minimum, Math.min(maximum, previous >= maximum - 10 ? previous - 10 : previous + 10))
    : Number(requested);
  input.value = String(next);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return { previous, next };
}, requestedValue);

const switchThemeRoundTrip = async (page) => {
  await activeHost(page).click({ button: "right" });
  const action = page.locator('#contextMenu [data-action="theme"]');
  await action.waitFor({ state: "visible" });
  await action.click();
  const options = page.locator("#settingsThemeList .theme-picker-option");
  await options.first().waitFor({ state: "visible" });
  const themes = await options.evaluateAll((items) => items.map((item) => ({
    id: item.dataset.theme || "",
    selected: item.getAttribute("aria-selected") === "true",
  })));
  const current = themes.find((item) => item.selected)?.id || "";
  const alternate = themes.find((item) => item.id && item.id !== current)?.id || "";
  if (!current || !alternate) {
    throw new Error(`theme round-trip requires two themes: ${JSON.stringify(themes)}`);
  }
  await page.locator(`#settingsThemeList .theme-picker-option[data-theme="${alternate}"]`).click();
  await page.waitForFunction((id) => document.body?.dataset?.theme === id, alternate);
  await page.waitForTimeout(450);
  await page.locator(`#settingsThemeList .theme-picker-option[data-theme="${current}"]`).click();
  await page.waitForFunction((id) => document.body?.dataset?.theme === id, current);
  await page.waitForTimeout(750);
  await page.locator("#settingsClose").click();
  return { current, alternate };
};

const toggleSettingRoundTrip = async (page, id) => {
  const initial = await page.evaluate((elementID) => {
    const input = document.getElementById(elementID);
    if (!(input instanceof HTMLInputElement)) throw new Error(`${elementID} is unavailable`);
    const previous = input.checked;
    input.checked = !previous;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return previous;
  }, id);
  await page.waitForTimeout(600);
  await page.evaluate(({ elementID, value }) => {
    const input = document.getElementById(elementID);
    if (!(input instanceof HTMLInputElement)) throw new Error(`${elementID} is unavailable`);
    input.checked = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { elementID: id, value: initial });
  await page.waitForTimeout(900);
  return initial;
};

const switchFontFamilyRoundTrip = async (page) => {
  await page.locator("#instanceSwitcherButton").click();
  await page.locator("#instanceSwitcherPanel").waitFor({ state: "visible" });
  await page.locator("#settingsMenuButton").click();
  await page.locator("#settingsBackdrop").waitFor({ state: "visible" });
  await page.locator("#settingsTabTerminal").click();
  const cards = page.locator("#settingsFontCards .settings-font-card");
  await cards.first().waitFor({ state: "visible" });
  const fonts = await cards.evaluateAll((items) => items.map((item) => ({
    id: item.dataset.fontId || "",
    selected: item.getAttribute("aria-selected") === "true",
  })));
  const current = fonts.find((item) => item.selected)?.id ?? "";
  const alternate = fonts.find((item) => item.id !== current)?.id;
  if (alternate === undefined) {
    throw new Error(`font round-trip requires two font choices: ${JSON.stringify(fonts)}`);
  }
  await page.locator(`#settingsFontCards .settings-font-card[data-font-id="${alternate}"]`).click();
  await page.waitForFunction((id) => document.querySelector(
    `#settingsFontCards .settings-font-card[data-font-id="${CSS.escape(id)}"]`,
  )?.getAttribute("aria-selected") === "true", alternate);
  await page.waitForTimeout(700);
  await page.locator(`#settingsFontCards .settings-font-card[data-font-id="${current}"]`).click();
  await page.waitForFunction((id) => document.querySelector(
    `#settingsFontCards .settings-font-card[data-font-id="${CSS.escape(id)}"]`,
  )?.getAttribute("aria-selected") === "true", current);
  await page.waitForTimeout(900);
  await page.locator("#settingsClose").click();
  return { current, alternate };
};

const tabIDs = (page) => page.locator("#tabs .tab").evaluateAll((buttons) => (
  buttons.map((button) => ({ id: button.dataset.tabId || "", active: button.classList.contains("active") }))
));

const createTemporaryTab = async (page) => {
  const before = await tabIDs(page);
  await page.locator("#newTab").click();
  await page.waitForFunction((count) => document.querySelectorAll("#tabs .tab").length > count, before.length);
  const tabID = await page.locator("#tabs .tab.active").getAttribute("data-tab-id");
  if (!tabID || before.some((tab) => tab.id === tabID)) {
    throw new Error(`temporary tab was not created: ${JSON.stringify({ before, tabID })}`);
  }
  await waitForReadyPresentation(page);
  return tabID;
};

const closeTabByAPI = (page, tabID) => page.evaluate(async (id) => {
  const name = new URLSearchParams(location.search).get("name");
  const response = await fetch(`./api/workspace?name=${encodeURIComponent(name || "")}&cols=120&rows=32`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "close_tab", tab_id: id, cols: 120, rows: 32 }),
  });
  if (!response.ok) throw new Error(`workspace close_tab ${response.status}: ${await response.text()}`);
}, tabID);

export async function run({ config, states, eventLog, assertNoFatalErrors }) {
  if (!config.localStaticDir) throw new Error("WEBSHELL_LOCAL_STATIC_DIR is required");
  const { desktop, mobile } = states;
  const page = desktop.page;
  const host = activeHost(page);
  await waitForReadyPresentation(page);
  await page.waitForFunction(() => document.querySelector(".terminal-pane.active .terminal-host canvas:not(.terminal-frame-hold)")?.width > 0, { timeout: 30_000 });
  await page.waitForTimeout(700);
  await mobile.context.close();
  await mobile.browser.close();
  await eventLog({ status: "pass", window: "mobile", action: "close-for-desktop-geometry" });

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
  assertLiveFontGeometry("font-size", fontResult);

  await installGeometrySampler(page);
  await resetSampler(page, "line-height-start");
  const lineHeight = await setLineHeight(page);
  await page.waitForTimeout(650);
  await setLineHeight(page, lineHeight.previous);
  await page.waitForTimeout(1_000);
  const lineHeightResult = await readSamples(page);
  assertLiveFontGeometry("line-height", lineHeightResult);

  await installGeometrySampler(page);
  await resetSampler(page, "theme-start");
  const themeRoundTrip = await switchThemeRoundTrip(page);
  const themeResult = await readSamples(page);
  assertLiveVisualUpdate("theme", themeResult, { requireThemeChange: true });

  await installGeometrySampler(page);
  await resetSampler(page, "font-family-start");
  const fontFamilyRoundTrip = await switchFontFamilyRoundTrip(page);
  const fontFamilyResult = await readSamples(page);
  assertLiveVisualUpdate("font-family", fontFamilyResult);

  await installGeometrySampler(page);
  await resetSampler(page, "desktop-shortcuts-start");
  const desktopShortcutsInitiallyEnabled = await toggleSettingRoundTrip(page, "settingsDesktopShortcutsBarToggle");
  const desktopShortcutsResult = await readSamples(page);
  assertLiveFontGeometry("desktop-shortcuts", desktopShortcutsResult);

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
  const otherTab = await createTemporaryTab(page);
  await page.locator(`#tabs .tab[data-tab-id="${currentTab}"]`).click();
  await waitForReadyPresentation(page);
  let tabResult = { samples: [], events: [] };
  try {
    await installGeometrySampler(page);
    await resetSampler(page, "tab-start");
    await page.locator(`#tabs .tab[data-tab-id="${otherTab}"]`).click();
    await page.waitForTimeout(650);
    await page.locator(`#tabs .tab[data-tab-id="${currentTab}"]`).click();
    await page.waitForTimeout(750);
    tabResult = await readSamples(page);
    assertLiveVisualUpdate("tab-current-fast-path", tabResult);
  } finally {
    await closeTabByAPI(page, otherTab).catch(() => {});
  }

  await eventLog({
    status: "info",
    action: "terminal-geometry-jitter-samples",
    tabs,
    currentTab,
    otherTab,
    font: { visibleHold: visibleHoldSamples(fontResult).length, geometryChanges: geometryChanges(fontResult).length, events: fontResult.events, samples: fontResult.samples, resizeTrace: fontResult.resizeTrace, presentationTrace: fontResult.presentationTrace },
    lineHeight: { visibleHold: visibleHoldSamples(lineHeightResult).length, geometryChanges: geometryChanges(lineHeightResult).length, events: lineHeightResult.events, samples: lineHeightResult.samples, resizeTrace: lineHeightResult.resizeTrace, presentationTrace: lineHeightResult.presentationTrace },
    theme: { roundTrip: themeRoundTrip, visibleHold: visibleHoldSamples(themeResult).length, events: themeResult.events, samples: themeResult.samples, resizeTrace: themeResult.resizeTrace, presentationTrace: themeResult.presentationTrace },
    fontFamily: { roundTrip: fontFamilyRoundTrip, visibleHold: visibleHoldSamples(fontFamilyResult).length, events: fontFamilyResult.events, samples: fontFamilyResult.samples, resizeTrace: fontFamilyResult.resizeTrace, presentationTrace: fontFamilyResult.presentationTrace },
    desktopShortcuts: { initiallyEnabled: desktopShortcutsInitiallyEnabled, visibleHold: visibleHoldSamples(desktopShortcutsResult).length, geometryChanges: geometryChanges(desktopShortcutsResult).length, events: desktopShortcutsResult.events, samples: desktopShortcutsResult.samples, resizeTrace: desktopShortcutsResult.resizeTrace, presentationTrace: desktopShortcutsResult.presentationTrace },
    viewport: { visibleHold: visibleHoldSamples(viewportResult).length, geometryChanges: geometryChanges(viewportResult).length, events: viewportResult.events, samples: viewportResult.samples, resizeTrace: viewportResult.resizeTrace, presentationTrace: viewportResult.presentationTrace },
    tab: { visibleHold: visibleHoldSamples(tabResult).length, geometryChanges: geometryChanges(tabResult).length, events: tabResult.events, samples: tabResult.samples, resizeTrace: tabResult.resizeTrace, presentationTrace: tabResult.presentationTrace },
  });
  assertNoFatalErrors();
  await eventLog({ status: "pass", action: "terminal-geometry-jitter-check" });
}
