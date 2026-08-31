const canvasSummary = (state) => state.page.evaluate(() => {
  const canvas = document.querySelector(".terminal-pane.active .terminal-host canvas:not(.terminal-frame-hold)");
  if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) {
    return { width: 0, height: 0, nonTransparent: 0 };
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const stride = Math.max(4, Math.floor(pixels.length / 20_000 / 4) * 4);
  let nonTransparent = 0;
  for (let index = 3; index < pixels.length; index += stride) {
    if (pixels[index] !== 0) nonTransparent += 1;
  }
  return { width: canvas.width, height: canvas.height, nonTransparent };
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

const localWorkspaceResources = (state) => state.page.evaluate(() => {
  const suffixes = [
    "/workspace/index.js",
    "/workspace/tab_label_controller.js",
    "/workspace/tab_label_lifecycle.js",
  ];
  const names = performance.getEntriesByType("resource").map((entry) => entry.name);
  return Object.fromEntries(suffixes.map((suffix) => [
    suffix,
    names.some((name) => name.includes("/assets/") && name.endsWith(suffix)),
  ]));
});

export async function run({ config, states, eventLog, assertNoFatalErrors }) {
  if (!config.localStaticDir) {
    throw new Error("WEBSHELL_LOCAL_STATIC_DIR is required so the real environment loads the current workspace frontend");
  }
  const { desktop, mobile } = states;
  const tabID = String(desktop.testTabID || "").trim();
  if (!tabID) throw new Error("isolated workspace tab is unavailable");

  await desktop.page.waitForSelector('.terminal-pane.active .pane-shell[data-connection="open"]', { timeout: 60_000 });
  const tabButton = desktop.page.locator(`.tab[data-tab-id="${tabID}"]`);
  const tabLabel = tabButton.locator(".tab-label");
  await tabButton.waitFor({ state: "visible" });

  const renamed = `AUTO_TAB_${Date.now()}`;
  await tabLabel.dblclick();
  const input = desktop.page.locator(".tab-rename-input");
  await input.waitFor({ state: "visible" });
  await input.fill(renamed);
  const renameResponse = desktop.page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/api/workspace")
    && String(response.request().postData() || "").includes('"action":"rename_tab"')
  ));
  const [, response] = await Promise.all([input.press("Enter"), renameResponse]);
  if (!response.ok()) {
    throw new Error(`rename_tab failed (${response.status()}): ${await response.text()}`);
  }
  await desktop.page.waitForFunction(({ id, label }) => {
    const button = document.querySelector(`.tab[data-tab-id="${CSS.escape(id)}"]`);
    return button?.querySelector(".tab-label")?.textContent === label
      && !document.querySelector(".tab-rename-input");
  }, { id: tabID, label: renamed });

  await desktop.page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await desktop.page.waitForSelector('.terminal-pane.active .pane-shell[data-connection="open"]', { timeout: 60_000 });
  await desktop.page.waitForFunction(({ id, label }) => (
    document.querySelector(`.tab[data-tab-id="${CSS.escape(id)}"] .tab-label`)?.textContent === label
  ), { id: tabID, label: renamed });

  const canvas = await canvasSummary(desktop);
  if (canvas.width <= 0 || canvas.height <= 0 || canvas.nonTransparent <= 0) {
    throw new Error(`terminal canvas is blank after tab rename reload: ${JSON.stringify(canvas)}`);
  }
  const resources = await localWorkspaceResources(desktop);
  const missingResources = Object.entries(resources).filter(([, loaded]) => !loaded).map(([name]) => name);
  if (missingResources.length > 0) {
    throw new Error(`workspace tab label resources were not loaded from versioned assets: ${missingResources.join(", ")}`);
  }
  const sockets = {
    desktop: await unifiedSocketSnapshot(desktop),
    mobile: await unifiedSocketSnapshot(mobile),
  };
  if (sockets.desktop.active !== 1 || sockets.mobile.active !== 1) {
    throw new Error(`expected one active Unified socket per page: ${JSON.stringify(sockets)}`);
  }
  assertNoFatalErrors();
  await eventLog({
    status: "pass",
    action: "workspace-tab-label-real-environment",
    tabID,
    renamed,
    canvas,
    resources,
    sockets,
  });
}
