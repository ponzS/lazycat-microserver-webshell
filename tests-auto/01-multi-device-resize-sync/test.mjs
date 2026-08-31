import path from "node:path";

export async function run({ config, states, artifactsDir, eventLog, activity, paneSize, waitForResizeApplied, refreshResizeFrames, refreshTerminalOutput, assertNoFatalErrors }) {
  const { desktop, mobile } = states;
  const terminal = (state) => state.page.locator(".terminal-pane.active .terminal-host").first();
  const marker = `AUTO_MULTI_DEVICE_${Date.now()}`;
  const article = [
    `printf '%s\\n' '${marker}'`,
    "printf '%s\\n' 'WebShell real-device synchronization article begins'",
    "printf '%s\\n' 'The same PTY output must be visible to both browser windows.'",
    "printf '%s\\n' 'Resize ownership is intentionally transferred by clicking each terminal.'",
    "printf '%s\\n' 'This line is long enough to exercise wrapping on the mobile viewport.'",
    "printf '%s\\n' 'WebShell real-device synchronization article ends'",
  ].join("; ");
  const initialDesktop = paneSize(desktop, await activity(desktop));
  const initialMobile = paneSize(mobile, await activity(mobile));
  if (!initialDesktop || !initialMobile) throw new Error("workspace activity returned no pane for one of the windows");
  await eventLog({ status: "pass", action: "initial-activity", desktop: initialDesktop, mobile: initialMobile });

  let previous = initialDesktop;
  await refreshResizeFrames(mobile);
  const mobileFramesBeforeInput = mobile.framesSent.length;
  const mobileResizeErrorsBeforeInput = mobile.resizeErrors;
  await terminal(mobile).tap();
  const mobileClickResult = await waitForResizeApplied(mobile, previous, "click-mobile-before-input", mobileFramesBeforeInput, mobileResizeErrorsBeforeInput);
  previous = mobileClickResult.applied;
  await eventLog({ status: "pass", window: "mobile", action: "click-mobile-before-input", resize: mobileClickResult.expected, applied: mobileClickResult.applied, transientResizeErrors: mobileClickResult.resizeErrors });
  await refreshResizeFrames(desktop);
  const desktopFramesBeforeInput = desktop.framesSent.length;
  const desktopResizeErrorsBeforeInput = desktop.resizeErrors;
  await terminal(desktop).click();
  const clickResult = await waitForResizeApplied(desktop, previous, "click-desktop-before-input", desktopFramesBeforeInput, desktopResizeErrorsBeforeInput);
  previous = clickResult.applied;
  await eventLog({ status: "pass", window: "desktop", action: "click-desktop-before-input", resize: clickResult.expected, applied: clickResult.applied, transientResizeErrors: clickResult.resizeErrors });
  await desktop.page.waitForTimeout(500);
  await desktop.page.keyboard.insertText(`${article}\n`);
  await eventLog({ status: "pass", window: "desktop", action: "input-long-article", marker });
  const outputDeadline = Date.now() + 10_000;
  while (Date.now() < outputDeadline) {
    await Promise.all([refreshTerminalOutput(desktop), refreshTerminalOutput(mobile)]);
    if (desktop.output.includes(marker) && mobile.output.includes(marker)) break;
    await mobile.page.waitForTimeout(100);
  }
  assertNoFatalErrors();
  if (!desktop.output.includes(marker) || !mobile.output.includes(marker)) {
    throw new Error(`PTY output marker was not synchronized to both windows: ${marker}`);
  }
  await eventLog({ status: "pass", action: "output-synchronized", marker, windows: ["desktop", "mobile"] });

  const foldedViewport = mobile.page.viewportSize();
  const unfoldedViewport = { width: 700, height: 900 };
  await refreshResizeFrames(mobile);
  const unfoldFrameCount = mobile.framesSent.length;
  const unfoldErrors = mobile.resizeErrors;
  await mobile.page.setViewportSize(unfoldedViewport);
  const unfoldResult = await waitForResizeApplied(
    mobile,
    previous,
    "portrait-unfold-mobile",
    unfoldFrameCount,
    unfoldErrors,
  );
  if (unfoldResult.expected.claim !== true) {
    const diagnostics = await mobile.page.evaluate((frameCount) => ({
      frames: (window.__testsAutoResizeFrames || []).slice(frameCount),
      trace: (window.__testsAutoResizeTrace || []).slice(-120),
    }), unfoldFrameCount);
    throw new Error(`portrait-unfold-mobile: resize did not claim current-device ownership: ${JSON.stringify({
      expected: unfoldResult.expected,
      diagnostics,
    })}`);
  }
  const unfoldFrames = await mobile.page.evaluate(
    (frameCount) => (window.__testsAutoResizeFrames || []).slice(frameCount),
    unfoldFrameCount,
  );
  if (unfoldFrames.some((frame) => frame.claim !== true)) {
    const trace = await mobile.page.evaluate(() => (window.__testsAutoResizeTrace || []).slice(-160));
    throw new Error(`portrait-unfold-mobile: passive resize raced the viewport claim: ${JSON.stringify({
      frames: unfoldFrames,
      trace,
    })}`);
  }
  previous = unfoldResult.applied;
  await eventLog({
    status: "pass",
    window: "mobile",
    action: "portrait-unfold-mobile",
    viewport: unfoldedViewport,
    resize: unfoldResult.expected,
    frames: unfoldFrames,
    applied: unfoldResult.applied,
  });

  await refreshResizeFrames(mobile);
  const foldFrameCount = mobile.framesSent.length;
  const foldErrors = mobile.resizeErrors;
  await mobile.page.setViewportSize(foldedViewport);
  const foldResult = await waitForResizeApplied(
    mobile,
    previous,
    "portrait-fold-mobile",
    foldFrameCount,
    foldErrors,
  );
  if (foldResult.expected.claim !== true) {
    const diagnostics = await mobile.page.evaluate((frameCount) => ({
      frames: (window.__testsAutoResizeFrames || []).slice(frameCount),
      trace: (window.__testsAutoResizeTrace || []).slice(-120),
    }), foldFrameCount);
    throw new Error(`portrait-fold-mobile: resize did not claim current-device ownership: ${JSON.stringify({
      expected: foldResult.expected,
      diagnostics,
    })}`);
  }
  const foldFrames = await mobile.page.evaluate(
    (frameCount) => (window.__testsAutoResizeFrames || []).slice(frameCount),
    foldFrameCount,
  );
  if (foldFrames.some((frame) => frame.claim !== true)) {
    const trace = await mobile.page.evaluate(() => (window.__testsAutoResizeTrace || []).slice(-160));
    throw new Error(`portrait-fold-mobile: passive resize raced the viewport claim: ${JSON.stringify({
      frames: foldFrames,
      trace,
    })}`);
  }
  previous = foldResult.applied;
  const foldCanvas = await terminal(mobile).locator("canvas").first().evaluate((node) => ({
    width: node.width,
    height: node.height,
  }));
  if (!foldCanvas.width || !foldCanvas.height) {
    throw new Error(`portrait-fold-mobile: terminal canvas is blank (${foldCanvas.width}x${foldCanvas.height})`);
  }
  await mobile.page.screenshot({ path: path.join(artifactsDir, "00-mobile-fold-recovery.png") });
  await eventLog({
    status: "pass",
    window: "mobile",
    action: "portrait-fold-mobile",
    viewport: foldedViewport,
    resize: foldResult.expected,
    frames: foldFrames,
    applied: foldResult.applied,
    canvas: foldCanvas,
  });

  const alternating = [];
  for (let round = 0; round < config.rounds; round += 1) alternating.push([desktop, "desktop"], [mobile, "mobile"]);
  for (let index = 0; index < alternating.length; index += 1) {
    const [state, name] = alternating[index];
    const action = `click-${name}-${index + 1}`;
    await refreshResizeFrames(state);
    const frameCountBefore = state.framesSent.length;
    const resizeErrorsBefore = state.resizeErrors;
    await terminal(state)[name === "mobile" ? "tap" : "click"]();
    const result = await waitForResizeApplied(state, previous, action, frameCountBefore, resizeErrorsBefore);
    previous = result.applied;
    const canvas = await terminal(state).locator("canvas").first().evaluate((node) => ({ width: node.width, height: node.height }));
    if (!canvas.width || !canvas.height) throw new Error(`${action}: terminal canvas is blank (${canvas.width}x${canvas.height})`);
    await state.page.screenshot({ path: path.join(artifactsDir, `${String(index + 1).padStart(2, "0")}-${name}-click.png`) });
    await eventLog({ status: "pass", window: name, action, resize: result.expected, applied: result.applied, transientResizeErrors: result.resizeErrors, canvas });
    assertNoFatalErrors();
  }
}
