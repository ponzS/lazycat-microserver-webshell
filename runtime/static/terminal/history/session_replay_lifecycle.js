const noop = () => {};

export function createTerminalSessionReplayLifecycle({
  windowObject = globalThis.window,
  getActiveName = () => "",
  isReplayCommitted = () => false,
  isMeasurable = () => false,
  canvasMatchesExpectedSize = () => false,
  recordEvent = noop,
  checkpointDelayMs = 48,
} = {}) {
  const sessions = new Set();
  let disposed = false;

  const clearCheckpoint = (session) => {
    if (!session) {
      return false;
    }
    if (session.replayPresentationCheckpointTimer) {
      windowObject?.clearTimeout?.(session.replayPresentationCheckpointTimer);
      session.replayPresentationCheckpointTimer = 0;
    }
    session.replayPresentationCheckpointPending = false;
    sessions.delete(session);
    return true;
  };

  const scheduleCheckpoint = (session) => {
    if (
      disposed
      || !session
      || session.closed
      || session.replayPresentationCheckpointPending
      || session.name !== getActiveName()
      || isReplayCommitted(session)
    ) {
      return false;
    }
    session.replayPresentationCheckpointPending = true;
    const replayGeneration = Number(session.terminalReplayGeneration || 0);
    const connectionEpoch = Number(session.connectionEpoch || 0);
    sessions.add(session);
    session.replayPresentationCheckpointTimer = windowObject?.setTimeout?.(() => {
      session.replayPresentationCheckpointTimer = 0;
      session.replayPresentationCheckpointPending = false;
      sessions.delete(session);
      if (
        disposed
        || session.closed
        || session.name !== getActiveName()
        || isReplayCommitted(session)
        || Number(session.terminalReplayGeneration || 0) !== replayGeneration
        || Number(session.connectionEpoch || 0) !== connectionEpoch
        || !isMeasurable(session)
        || !canvasMatchesExpectedSize(session)
      ) {
        return;
      }
      recordEvent(session, "replay_presentation_checkpoint_skipped", {
        cursor: String(session.appliedHistoryCursor || 0n),
        reason: "replay_not_committed",
      });
    }, checkpointDelayMs) || 0;
    return true;
  };

  const disposeSession = (session) => clearCheckpoint(session);

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    for (const session of Array.from(sessions)) {
      clearCheckpoint(session);
    }
    return true;
  };

  return Object.freeze({
    clearCheckpoint,
    dispose,
    disposeSession,
    scheduleCheckpoint,
  });
}
