const text = (value) => String(value ?? "").trim();
const epochOf = (value) => /^\d+$/.test(text(value)) ? BigInt(text(value)) : null;

const dimensionsOf = (value = {}) => ({
  cols: Math.max(1, Math.floor(Number(value.cols) || 0)),
  rows: Math.max(1, Math.floor(Number(value.rows) || 0)),
  pixelWidth: Math.max(0, Math.floor(Number(value.pixelWidth ?? value.pixel_width) || 0)),
  pixelHeight: Math.max(0, Math.floor(Number(value.pixelHeight ?? value.pixel_height) || 0)),
});

export class TerminalResizeController {
  constructor() {
    this.reset();
  }

  reset() {
    this.phase = "idle";
    this.connectionEpoch = 0;
    this.requestID = "";
    this.requestedEpoch = null;
    this.appliedEpoch = null;
    this.requested = null;
    this.applied = null;
    this.settleToken = 0;
  }

  request({ requestID = "", connectionEpoch = 0, resizeEpoch, dimensions = {} } = {}) {
    const epoch = epochOf(resizeEpoch);
    const rawCols = Math.floor(Number(dimensions.cols) || 0);
    const rawRows = Math.floor(Number(dimensions.rows) || 0);
    const size = dimensionsOf(dimensions);
    if (epoch === null || rawCols <= 0 || rawRows <= 0) {
      throw new Error("invalid resize request");
    }
    this.phase = "awaiting_ack";
    this.requestID = text(requestID);
    this.connectionEpoch = Number(connectionEpoch || 0);
    this.requestedEpoch = epoch;
    this.requested = size;
    this.settleToken += 1;
    return this.snapshot();
  }

  assertCurrent({ requestID = this.requestID, connectionEpoch = this.connectionEpoch } = {}) {
    if (text(requestID) !== this.requestID || Number(connectionEpoch || 0) !== this.connectionEpoch) {
      throw new Error("resize request or connection epoch mismatch");
    }
  }

  acknowledge({ requestID, connectionEpoch, resizeEpoch, dimensions = {} } = {}) {
    this.assertCurrent({ requestID, connectionEpoch });
    const epoch = epochOf(resizeEpoch);
    if (epoch === null || (this.requestedEpoch !== null && epoch < this.requestedEpoch)) {
      throw new Error("stale resize acknowledgement");
    }
    this.appliedEpoch = epoch;
    this.applied = dimensionsOf(dimensions);
    this.phase = "applied";
    return this.snapshot();
  }

  fail({ requestID, connectionEpoch, resizeEpoch } = {}) {
    this.assertCurrent({ requestID, connectionEpoch });
    const epoch = resizeEpoch === undefined || resizeEpoch === "" ? this.requestedEpoch : epochOf(resizeEpoch);
    if (epoch !== null && this.requestedEpoch !== null && epoch !== this.requestedEpoch) {
      throw new Error("stale resize error");
    }
    this.phase = "error";
    return this.snapshot();
  }

  beginSettle() {
    if (this.phase !== "applied") {
      throw new Error("resize settle is not ready");
    }
    this.phase = "settling";
    this.settleToken += 1;
    return this.settleToken;
  }

  finishSettle(token) {
    if (this.phase !== "settling" || Number(token) !== this.settleToken) {
      return false;
    }
    this.phase = "ready";
    return true;
  }

  commit() {
    if (this.phase !== "ready" && this.phase !== "applied") {
      throw new Error("resize commit is not ready");
    }
    this.phase = "committed";
    return this.snapshot();
  }

  snapshot() {
    return {
      phase: this.phase,
      connectionEpoch: this.connectionEpoch,
      requestID: this.requestID,
      requestedEpoch: this.requestedEpoch,
      appliedEpoch: this.appliedEpoch,
      requested: this.requested && { ...this.requested },
      applied: this.applied && { ...this.applied },
      settleToken: this.settleToken,
    };
  }
}
