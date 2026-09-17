import { ClientTerminalReplayAdapter } from "./replay_adapter.js";

// The shared socket owner handles health, identity and rendering. All client
// v8 history preparation and cached/delta recovery live behind this adapter.
export function createClientTerminalSessionProtocol({
  isClientTarget = () => false,
  history,
  output,
  resize,
  resetTerminalForHistoryReplay,
} = {}) {
  const restoreHistory = (session, {
    historyConnectRange, historyGeneration, deltaFromCursor,
    syncMode, serverBaseCursor, message, rejectHistorySync,
  }) => {
    if (!historyConnectRange || historyConnectRange.generation !== historyGeneration || historyConnectRange.endCursor !== deltaFromCursor) {
      rejectHistorySync("local and server history ranges do not match");
      return false;
    }
    if (historyConnectRange.source === "memory") {
      if (!session.historyStateReady || session.appliedHistoryCursor !== deltaFromCursor) {
        rejectHistorySync("in-memory terminal cursor is not reusable");
        return false;
      }
      output.discard(session);
      session.receivedHistoryCursor = deltaFromCursor;
    } else if (historyConnectRange.source === "cache") {
      const snapshot = session.historyCacheSnapshot;
      if (!snapshot || snapshot.generation !== historyGeneration || snapshot.baseCursor !== historyConnectRange.baseCursor || snapshot.endCursor !== deltaFromCursor) {
        rejectHistorySync("cached terminal history is unavailable");
        return false;
      }
      if (!resetTerminalForHistoryReplay(session)) {
        rejectHistorySync("terminal reset for cached history failed");
        return false;
      }
      resize.prepareReplayGeometry(session, message);
      session.historyGeneration = historyGeneration;
      session.historyProtocolActive = true;
      session.historySyncMode = syncMode;
      session.serverBaseCursor = serverBaseCursor;
      session.localBaseCursor = snapshot.baseCursor;
      session.receivedHistoryCursor = snapshot.baseCursor;
      session.appliedHistoryCursor = snapshot.baseCursor;
      session.persistedHistoryCursor = snapshot.endCursor;
      for (const chunk of snapshot.chunks) {
        output.write(session, chunk.data, {
          historySource: "cache",
          startCursor: chunk.startCursor,
          endCursor: chunk.endCursor,
        });
      }
      if (session.receivedHistoryCursor !== deltaFromCursor) {
        rejectHistorySync("cached terminal history did not reach requested cursor");
        return false;
      }
    } else {
      rejectHistorySync("unknown local history source");
      return false;
    }
    return true;
  };

  const adapter = Object.freeze({
    async prepareSession(session) {
      await history.prepareSession(session);
      await output.flush(session, { force: true });
      await history.flushSession(session);
    },
    rangeForConnect: (session) => history.rangeForConnect(session),
    createReplayAdapter: (controller, channel) => channel === "fast"
      ? new ClientTerminalReplayAdapter(controller) : null,
    deleteHistory: (session) => history.deleteSession(session),
    disableHistory: (session) => history.disableSession(session),
    resetHistory: (session, generation, cursor) => history.resetSession(session, generation, cursor),
    restoreHistory,
  });
  return Object.freeze({
    forSession: (session) => isClientTarget(session?.name) ? adapter : null,
  });
}
