const isModeParameter = (byte) => byte === 0x3b || (byte >= 0x30 && byte <= 0x39);

// Split at possible DECSET finals so Ghostty can confirm a transition before
// it consumes the first byte of the next synchronized redraw. A final at the
// start of a write may complete a sequence already buffered by Ghostty.
export function writeAtRenderBoundaries(native, bytes, onHoldStarted) {
  let offset = 0;
  for (let end = bytes.indexOf(0x68); end !== -1; end = bytes.indexOf(0x68, end + 1)) {
    let start = end;
    while (start > offset && isModeParameter(bytes[start - 1])) start -= 1;
    if (start > offset && bytes[start - 1] !== 0x3f) continue;
    if (end > offset) native.write(bytes.subarray(offset, end));
    const wasHeld = native.getMode(2026, false);
    const wasAlternate = native.isAlternateScreen();
    offset = end + 1;
    native.write(bytes.subarray(end, offset));
    if (!wasHeld && native.getMode(2026, false)) onHoldStarted(wasAlternate === native.isAlternateScreen());
  }
  if (offset < bytes.length) native.write(bytes.subarray(offset));
}

// A real synchronization boundary is preferred even if terminal output pauses.
// The deadline still gives programs with a missing end marker a way to update.
export function createSynchronizedOutput({ now = () => performance.now(), limitMs = 8000 } = {}) {
  let startedAt = null;
  const reset = () => { startedAt = null; };
  return {
    began() { startedAt = now(); },
    observe(active) {
      if (!active) { reset(); return 0; }
      const at = now();
      startedAt ??= at;
      return Math.max(0, limitMs - (at - startedAt));
    },
    presented() { if (startedAt !== null) startedAt = now(); },
    reset,
  };
}
