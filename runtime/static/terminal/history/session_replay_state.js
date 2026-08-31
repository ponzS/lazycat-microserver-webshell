export const parseTerminalHistoryCursor = (value) => {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }
  try {
    return BigInt(text);
  } catch (error) {
    return null;
  }
};

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
    source: snapshot.historyGeneration ? "cache-v2" : "cache",
  };
};

export const setTerminalReplayAuthorization = (session, authorization = false) => {
  if (!session) {
    return false;
  }
  const normalized = authorization === "identified" || authorization === "legacy"
    ? authorization
    : false;
  session.replayAuthorization = normalized;
  session.replayVerified = normalized;
  return normalized;
};

export const terminalReplayAuthorization = (session) => (
  session?.replayAuthorization || session?.replayVerified || false
);

export const terminalReplayIsAuthorized = (session) => Boolean(terminalReplayAuthorization(session));

export const terminalReplayHasIdentifiedAuthorization = (session) => (
  terminalReplayAuthorization(session) === "identified"
);

export const terminalReplayCommitIsPending = (session) => Boolean(
  session
  && session.replayController?.phase === "awaiting_commit"
);

export const terminalReplayIsCommitted = (session) => Boolean(
  session
  && session.replayController?.phase === "committed"
);

export const terminalReplayRetryIsPaused = (session) => Boolean(
  session?.replayRetryPaused === true
);
