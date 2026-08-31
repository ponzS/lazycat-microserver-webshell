const parseCursor = (value) => {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? BigInt(text) : null;
};

const normalizeIdentity = (identity = {}) => ({
  selector: String(identity.selector || ""),
  paneID: String(identity.paneID || identity.pane_id || ""),
  historyGeneration: String(identity.historyGeneration || identity.history_generation || ""),
});

export class TerminalReplayController {
  constructor() {
    this.reset();
  }

  reset() {
    this.phase = "idle";
    this.requestID = "";
    this.connectionEpoch = 0;
    this.identity = normalizeIdentity();
    this.expectedSequence = 1n;
    this.expectedCursor = 0n;
    this.targetCursor = null;
    this.legacy = false;
  }

  begin({ requestID = "", connectionEpoch = 0, identity = {}, startCursor = 0n, targetCursor = null } = {}) {
    const start = parseCursor(startCursor);
    const target = targetCursor === null || targetCursor === undefined ? null : parseCursor(targetCursor);
    if (start === null || (target !== null && target < start)) {
      throw new Error("invalid replay cursor range");
    }
    this.phase = "replaying";
    this.requestID = String(requestID || "");
    this.connectionEpoch = Number(connectionEpoch || 0);
    this.identity = normalizeIdentity(identity);
    this.expectedSequence = 1n;
    this.expectedCursor = start;
    this.targetCursor = target;
    this.legacy = false;
    return this.snapshot();
  }

  beginLegacy({ requestID = "", connectionEpoch = 0, identity = {} } = {}) {
    this.phase = "replaying";
    this.requestID = String(requestID || "");
    this.connectionEpoch = Number(connectionEpoch || 0);
    this.identity = normalizeIdentity(identity);
    this.expectedSequence = null;
    this.expectedCursor = null;
    this.targetCursor = null;
    this.legacy = true;
    return this.snapshot();
  }

  assertCurrent({ requestID = this.requestID, connectionEpoch = this.connectionEpoch, identity = this.identity } = {}) {
    const actual = normalizeIdentity(identity);
    if (String(requestID || "") !== this.requestID || Number(connectionEpoch || 0) !== this.connectionEpoch || actual.selector !== this.identity.selector || actual.paneID !== this.identity.paneID || actual.historyGeneration !== this.identity.historyGeneration) {
      throw new Error("replay identity or connection epoch mismatch");
    }
    return true;
  }

  acceptBinary({ sequence, startCursor, endCursor, length, requestID, connectionEpoch, identity } = {}) {
    this.assertCurrent({ requestID, connectionEpoch, identity });
    if (this.phase !== "replaying") {
      throw new Error("replay binary frame arrived outside replay");
    }
    const seq = parseCursor(sequence);
    const start = parseCursor(startCursor);
    const end = parseCursor(endCursor);
    const size = Number(length);
    if (seq === null || start === null || end === null || !Number.isSafeInteger(size) || size < 0 || end - start !== BigInt(size) || seq !== this.expectedSequence || start !== this.expectedCursor) {
      throw new Error("replay binary sequence or cursor discontinuity");
    }
    this.expectedSequence += 1n;
    this.expectedCursor = end;
    return this.snapshot();
  }

  complete({ cursor, requestID, connectionEpoch, identity } = {}) {
    this.assertCurrent({ requestID, connectionEpoch, identity });
    const end = parseCursor(cursor);
    if (this.phase !== "replaying" || end === null || (this.targetCursor !== null && end !== this.targetCursor) || end !== this.expectedCursor) {
      throw new Error("replay completion cursor mismatch");
    }
    this.phase = "awaiting_commit";
    return this.snapshot();
  }

  completeLegacy({ requestID, connectionEpoch, identity } = {}) {
    this.assertCurrent({ requestID, connectionEpoch, identity });
    if (this.phase !== "replaying" || this.legacy !== true) {
      throw new Error("legacy replay completion is not pending");
    }
    this.phase = "awaiting_commit";
    return this.snapshot();
  }

  commit() {
    if (this.phase !== "awaiting_commit") {
      throw new Error("replay commit is not pending");
    }
    this.phase = "committed";
    return this.snapshot();
  }

  snapshot() {
    return {
      phase: this.phase,
      requestID: this.requestID,
      connectionEpoch: this.connectionEpoch,
      identity: { ...this.identity },
      expectedSequence: this.expectedSequence,
      expectedCursor: this.expectedCursor,
      targetCursor: this.targetCursor,
      legacy: this.legacy === true,
    };
  }
}
