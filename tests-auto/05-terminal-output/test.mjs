const terminalHost = (state) => state.page.locator(".terminal-pane.active .terminal-host").first();

const waitForOutput = async (state, marker, timeout = 30_000) => {
  await state.page.waitForFunction((expected) => (
    String(window.__testsAutoTerminalOutput || "").includes(expected)
  ), marker, { timeout });
};

const canvasSummary = (state) => state.page.evaluate(() => {
  const canvas = document.querySelector(".terminal-pane.active .terminal-host canvas:not(.terminal-frame-hold)");
  if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) {
    return { width: 0, height: 0, nonTransparent: 0, hash: 0 };
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const stride = Math.max(4, Math.floor(pixels.length / 20_000 / 4) * 4);
  let nonTransparent = 0;
  let hash = 2166136261;
  for (let index = 0; index < pixels.length; index += stride) {
    if (pixels[index + 3] !== 0) nonTransparent += 1;
    hash ^= pixels[index] | (pixels[index + 1] << 8) | (pixels[index + 2] << 16);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return { width: canvas.width, height: canvas.height, nonTransparent, hash };
});

const unifiedSocketSnapshot = (state) => state.page.evaluate(() => {
  const unified = Array.from(window.__testsAutoSockets || [])
    .filter((socket) => String(socket.url || "").includes("mode=unified"));
  return {
    created: unified.length,
    active: unified.filter((socket) => (
      socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN
    )).length,
  };
});

const outputMetrics = (state) => state.page.evaluate(() => {
  const metrics = globalThis.__webshellTerminalPerformance;
  const snapshot = typeof metrics?.snapshot === "function"
    ? metrics.snapshot()
    : { counters: { ...(metrics?.counters || {}) } };
  return snapshot?.counters || {};
});

const metricDelta = (before, after, name) => (
  Number(after?.[name] || 0) - Number(before?.[name] || 0)
);

const localOutputResources = (state) => state.page.evaluate(() => {
  const suffixes = [
    "/terminal/output/index.js",
    "/terminal/output/output_controller.js",
    "/terminal/output/output_lifecycle.js",
    "/terminal/output/output_model.js",
  ];
  const names = performance.getEntriesByType("resource").map((entry) => entry.name);
  return Object.fromEntries(suffixes.map((suffix) => [
    suffix,
    names.some((name) => name.includes("/assets/") && name.endsWith(suffix)),
  ]));
});

const startAtomicPresentationObserver = (state) => state.page.evaluate(() => {
  const samples = [];
  let active = true;
  const sample = () => {
    if (!active) return;
    const shell = document.querySelector(".terminal-pane.active .pane-shell");
    const hold = shell?.querySelector(".terminal-frame-hold");
    const preview = shell?.querySelector(".terminal-cache-preview");
    const canvas = shell?.querySelector(".terminal-host canvas:not(.terminal-frame-hold)");
    const renderReady = shell?.dataset.renderReady === "true";
    const hasPresentedFrame = shell?.dataset.hasPresentedFrame === "true";
    const holdVisible = hold instanceof HTMLCanvasElement && hold.hidden === false && hold.isConnected;
    const previewVisible = preview instanceof HTMLElement && preview.hidden === false && preview.isConnected;
    const bounds = shell?.getBoundingClientRect?.();
    samples.push({
      at: performance.now(),
      stage: String(window.__testsAutoOutputStage || ""),
      tabID: shell?.closest(".terminal-pane")?.dataset.tabId || "",
      renderReady,
      hasPresentedFrame,
      holdVisible,
      holdHidden: hold instanceof HTMLCanvasElement ? hold.hidden : null,
      holdWidth: hold instanceof HTMLCanvasElement ? hold.width : 0,
      holdHeight: hold instanceof HTMLCanvasElement ? hold.height : 0,
      previewVisible,
      canvasWidth: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
      canvasHeight: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
      visible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
      unsafe: !renderReady && hasPresentedFrame && !holdVisible && !previewVisible,
    });
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  window.__testsAutoOutputPresentationObserver = {
    samples,
    stop() {
      active = false;
    },
  };
});

const stopAtomicPresentationObserver = (state) => state.page.evaluate(() => {
  const observer = window.__testsAutoOutputPresentationObserver;
  observer?.stop?.();
  const samples = observer?.samples || [];
  const unsafeIndexes = samples
    .map((sample, index) => sample.unsafe ? index : -1)
    .filter((index) => index >= 0);
  delete window.__testsAutoOutputPresentationObserver;
  return {
    count: samples.length,
    pending: samples.filter((sample) => !sample.renderReady && sample.hasPresentedFrame).length,
    hold: samples.filter((sample) => sample.holdVisible).length,
    unsafe: samples.filter((sample) => sample.unsafe).length,
    unsafeSamples: samples.filter((sample) => sample.unsafe).slice(0, 8),
    unsafeContexts: unsafeIndexes.slice(0, 4).map((index) => samples.slice(Math.max(0, index - 2), index + 3)),
  };
});

const setOutputStage = (state, stage) => state.page.evaluate((value) => {
  window.__testsAutoOutputStage = value;
}, stage);

const createTemporaryTab = async (state) => {
  const previousIDs = await state.page.locator("#tabs .tab").evaluateAll((buttons) => (
    buttons.map((button) => button.dataset.tabId)
  ));
  await state.page.locator("#newTab").click();
  await state.page.waitForFunction((count) => document.querySelectorAll("#tabs .tab").length > count, previousIDs.length);
  const activeID = await state.page.locator("#tabs .tab.active").getAttribute("data-tab-id");
  if (!activeID || previousIDs.includes(activeID)) {
    throw new Error(`new tab did not become active: ${JSON.stringify({ previousIDs, activeID })}`);
  }
  return activeID;
};

const closeTabByAPI = async (state, tabID) => state.page.evaluate(async (id) => {
  const name = new URLSearchParams(location.search).get("name");
  const response = await fetch(`./api/workspace?name=${encodeURIComponent(name || "")}&cols=120&rows=32`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "close_tab", tab_id: id, cols: 120, rows: 32 }),
  });
  if (!response.ok) throw new Error(`workspace close_tab ${response.status}: ${await response.text()}`);
}, tabID);

export async function run({ config, states, eventLog, assertNoFatalErrors }) {
  if (!config.localStaticDir) {
    throw new Error("WEBSHELL_LOCAL_STATIC_DIR is required so the real environment loads the current workspace frontend");
  }
  const { desktop, mobile } = states;
  await desktop.page.waitForSelector('.terminal-pane.active .pane-shell[data-connection="open"]', { timeout: 60_000 });
  await mobile.page.waitForSelector('.terminal-pane.active .pane-shell[data-connection="open"]', { timeout: 60_000 });

  const consoleErrors = [];
  const captureConsoleError = (windowName) => (message) => {
    if (message.type() === "error") consoleErrors.push(`${windowName}: ${message.text()}`);
  };
  desktop.page.on("console", captureConsoleError("desktop"));
  mobile.page.on("console", captureConsoleError("mobile"));

  const resources = await localOutputResources(desktop);
  const missingResources = Object.entries(resources).filter(([, loaded]) => !loaded).map(([name]) => name);
  if (missingResources.length > 0) {
    throw new Error(`output resources were not loaded from versioned assets: ${missingResources.join(", ")}`);
  }

  const socketsBefore = {
    desktop: await unifiedSocketSnapshot(desktop),
    mobile: await unifiedSocketSnapshot(mobile),
  };
  const metricsBefore = await outputMetrics(desktop);
  const canvasBefore = await canvasSummary(desktop);
  await startAtomicPresentationObserver(desktop);

  const marker = `AUTO_OUTPUT_${Date.now()}`;
  const normalDone = `${marker}_NORMAL`;
  const largeDone = `${marker}_LARGE_1572864`;
  const hiddenDone = `${marker}_HIDDEN_DONE`;
  const resizeDone = `${marker}_RESIZE_DONE`;
  let temporaryTabID = "";

  try {
    await setOutputStage(desktop, "normal-output");
    await terminalHost(desktop).click();
    await desktop.page.keyboard.insertText(`printf '%s\\n' '${normalDone}'`);
    await desktop.page.keyboard.press("Enter");
    await waitForOutput(desktop, normalDone);

    await setOutputStage(desktop, "large-output");
    await desktop.page.keyboard.insertText(`head -c 1572864 /dev/zero | tr '\\000' 'O'; printf '\\n%s\\n' '${largeDone}'`);
    await desktop.page.keyboard.press("Enter");
    await waitForOutput(desktop, largeDone, 60_000);

    await setOutputStage(desktop, "hidden-output-start");
    await desktop.page.keyboard.insertText(`i=0; while [ "$i" -lt 160 ]; do printf 'H%04d\\n' "$i"; i=$((i+1)); sleep 0.01; done; printf '%s\\n' '${hiddenDone}'`);
    await desktop.page.keyboard.press("Enter");
    await setOutputStage(desktop, "activate-temporary-tab");
    temporaryTabID = await createTemporaryTab(desktop);
    await desktop.page.waitForTimeout(500);
    await setOutputStage(desktop, "reactivate-output-tab");
    await desktop.page.locator(`#tabs .tab[data-tab-id="${desktop.testTabID}"]`).click();
    await desktop.page.waitForSelector('.terminal-pane.active .pane-shell[data-connection="open"]', { timeout: 30_000 });
    await waitForOutput(desktop, hiddenDone, 30_000);

    await setOutputStage(desktop, "resize-output");
    await terminalHost(desktop).click();
    await desktop.page.keyboard.insertText(`i=0; while [ "$i" -lt 180 ]; do printf 'R%04d\\n' "$i"; i=$((i+1)); sleep 0.01; done; printf '%s\\n' '${resizeDone}'`);
    await desktop.page.keyboard.press("Enter");
    await desktop.page.setViewportSize({ width: 1180, height: 760 });
    await desktop.page.waitForTimeout(350);
    await desktop.page.setViewportSize({ width: 1440, height: 900 });
    await waitForOutput(desktop, resizeDone, 30_000);
    await setOutputStage(desktop, "settle");
  } finally {
    if (temporaryTabID) {
      await closeTabByAPI(desktop, temporaryTabID).catch(() => {});
    }
  }

  await desktop.page.waitForTimeout(750);
  const presentation = await stopAtomicPresentationObserver(desktop);
  if (presentation.count < 10 || presentation.unsafe > 0) {
    throw new Error(`output activity exposed an unsafe intermediate frame: ${JSON.stringify(presentation)}`);
  }

  const canvasAfter = await canvasSummary(desktop);
  if (canvasAfter.nonTransparent <= 0 || canvasAfter.width <= 0 || canvasAfter.height <= 0) {
    throw new Error(`terminal canvas is blank after output stress: ${JSON.stringify(canvasAfter)}`);
  }
  if (canvasBefore.hash === canvasAfter.hash) {
    throw new Error(`terminal canvas did not change after output stress: ${JSON.stringify({ canvasBefore, canvasAfter })}`);
  }

  const metricsAfter = await outputMetrics(desktop);
  const overloads = metricDelta(metricsBefore, metricsAfter, "outputOverloads");
  const staleDrops = metricDelta(metricsBefore, metricsAfter, "staleOutputQueueDrops");
  if (overloads !== 0 || staleDrops !== 0) {
    throw new Error(`output stress required an unsafe resync: ${JSON.stringify({ overloads, staleDrops, metricsBefore, metricsAfter })}`);
  }

  const socketsAfter = {
    desktop: await unifiedSocketSnapshot(desktop),
    mobile: await unifiedSocketSnapshot(mobile),
  };
  for (const name of ["desktop", "mobile"]) {
    if (
      socketsBefore[name].active !== 1
      || socketsAfter[name].active !== 1
      || socketsAfter[name].created !== socketsBefore[name].created
    ) {
      throw new Error(`output activity replaced the Unified socket for ${name}: ${JSON.stringify({ before: socketsBefore[name], after: socketsAfter[name] })}`);
    }
  }
  if (consoleErrors.length > 0) {
    throw new Error(`console errors during output regression:\n${consoleErrors.join("\n")}`);
  }

  assertNoFatalErrors();
  await eventLog({
    status: "pass",
    action: "terminal-output-real-environment",
    marker,
    resources,
    presentation,
    canvas: { before: canvasBefore, after: canvasAfter },
    metrics: {
      overloads,
      staleDrops,
      outputQueuePeakBytes: Number(metricsAfter.outputQueuePeakBytes || 0),
      terminalOutputBytes: metricDelta(metricsBefore, metricsAfter, "terminalOutputBytes"),
      terminalOutputBatches: metricDelta(metricsBefore, metricsAfter, "terminalOutputBatches"),
    },
    socketsBefore,
    socketsAfter,
    temporaryTabID,
  });
}
