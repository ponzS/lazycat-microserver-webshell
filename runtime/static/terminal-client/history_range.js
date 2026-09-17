export const terminalSessionHistoryRangeForConnect = (session) => {
  if (!session?.historyGeneration || session.resetOnNextReplay) {
    return null;
  }
  if (session.historyStateReady) {
    return {
      generation: session.historyGeneration,
      baseCursor: session.localBaseCursor,
      endCursor: session.appliedHistoryCursor,
      source: "memory",
    };
  }
  if (session.historyCacheDisabled) {
    return null;
  }
  const snapshot = session.historyCacheSnapshot;
  const snapshotGeneration = snapshot?.historyGeneration || snapshot?.generation || "";
  if (!snapshot || snapshotGeneration !== session.historyGeneration) {
    return null;
  }
  return {
    generation: snapshotGeneration,
    baseCursor: snapshot.baseCursor,
    endCursor: snapshot.endCursor,
    source: "cache",
  };
};
