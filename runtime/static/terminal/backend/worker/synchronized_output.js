// Presentation may wait for DEC 2026; byte consumption and terminal replies
// must continue. Long network redraws keep the old frame, not a history animation.
export function createSynchronizedOutput({ now = () => performance.now() } = {}) {
  const initialGapMs = 32;
  const maxQuietMs = 500;
  const maxHoldMs = 2000;
  let startedAt = null;
  let lastOutputAt = null;
  let gapMs = initialGapMs;
  const reset = () => {
    startedAt = lastOutputAt = null;
    gapMs = initialGapMs;
  };
  return {
    wrote(active) {
      if (!active) return reset();
      const at = now();
      if (lastOutputAt !== null) {
        // Allow for a slow fragment immediately. Decay its influence as faster writes arrive.
        gapMs = Math.min(maxQuietMs / 3, Math.max(at - lastOutputAt, gapMs * 0.75));
      }
      lastOutputAt = at;
      startedAt ??= at;
    },
    observe(active) {
      if (!active) { reset(); return 0; }
      const at = now();
      startedAt ??= at;
      // A real end marker always bypasses these fallbacks. With an open transaction,
      // wait for a gap in the burst, and still make progress if no gap ever arrives.
      const quietMs = Math.max(initialGapMs, 3 * gapMs);
      const deadline = Math.min((lastOutputAt ?? startedAt) + quietMs, startedAt + maxHoldMs);
      return Math.max(0, deadline - at);
    },
    // Only a real snapshot consumes the safety release. Progress queries must not
    // restart the hold before that frame is captured, or a missing end could starve it.
    presented() { if (startedAt !== null) startedAt = now(); },
    reset,
  };
}
