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

  const alternating = [];
  for (let round = 0; round < config.rounds; round += 1) alternating.push([mobile, "mobile"], [desktop, "desktop"]);
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
