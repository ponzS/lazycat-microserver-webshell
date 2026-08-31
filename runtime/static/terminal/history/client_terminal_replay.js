const parseCursor = (value) => {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? BigInt(text) : null;
};

// Client v8 carries ordered raw bytes rather than the container Fast envelope.
// Adapt that transport to the same strict replay controller contract.
export class ClientTerminalReplayAdapter {
  constructor(controller) {
    this.controller = controller;
    this.reset();
  }

  reset() {
    this.sequence = 1n;
    this.cursor = null;
    return this.snapshot();
  }

  begin({ requestID = "", connectionEpoch = 0, identity = {}, startCursor = 0n, targetCursor = null } = {}) {
    const start = parseCursor(startCursor);
    const target = targetCursor === null || targetCursor === undefined ? null : parseCursor(targetCursor);
    if (start === null || (target !== null && target < start)) {
      throw new Error("invalid client replay cursor range");
    }
    this.sequence = 1n;
    this.cursor = start;
    const snapshot = this.controller.begin({
      requestID,
      connectionEpoch,
      identity,
      startCursor: start,
      targetCursor: target,
    });
    return { ...snapshot, clientSequence: this.sequence, clientCursor: this.cursor };
  }

  acceptBinary({ data, requestID, connectionEpoch, identity } = {}) {
    const payload = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (this.cursor === null) {
      throw new Error("client replay has not started");
    }
    const startCursor = this.cursor;
    const endCursor = startCursor + BigInt(payload.byteLength);
    const snapshot = this.controller.acceptBinary({
      sequence: this.sequence,
      startCursor,
      endCursor,
      length: payload.byteLength,
      requestID,
      connectionEpoch,
      identity,
    });
    this.sequence += 1n;
    this.cursor = endCursor;
    return { ...snapshot, clientSequence: this.sequence, clientCursor: this.cursor };
  }

  complete({ cursor, requestID, connectionEpoch, identity } = {}) {
    const snapshot = this.controller.complete({ cursor, requestID, connectionEpoch, identity });
    return { ...snapshot, clientSequence: this.sequence, clientCursor: this.cursor };
  }

  snapshot() {
    return {
      clientSequence: this.sequence,
      clientCursor: this.cursor,
    };
  }
}
