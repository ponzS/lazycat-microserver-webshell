const terminalCheckpointProtocol = "checkpoint-window-v1";
const terminalCheckpointMaxTailBytes = 32 * 1024 * 1024;
const terminalCheckpointMaxScreenRows = 4096;
const terminalCheckpointRequiredModes = Object.freeze([
  "alternate_screen",
  "origin",
  "wraparound",
  "insert",
  "application_cursor",
  "bracketed_paste",
]);

const terminalCheckpointCapability = Object.freeze({
  protocol: terminalCheckpointProtocol,
  requires: Object.freeze(["semantic_state_export", "semantic_state_import"]),
  maxTailBytes: terminalCheckpointMaxTailBytes,
});

const terminalCheckpointAdapter = (terminal) => {
  const adapter = terminal?.getSemanticCheckpointAdapter?.();
  if (adapter && typeof adapter === "object") {
    return adapter;
  }
  if (typeof terminal?.exportSemanticState === "function" && typeof terminal?.importSemanticState === "function") {
    return terminal;
  }
  return null;
};

const terminalCheckpointAdapterIsComplete = (terminal) => {
  const adapter = terminalCheckpointAdapter(terminal);
  return typeof adapter?.exportSemanticState === "function"
    && typeof adapter?.importSemanticState === "function";
};


const terminalCheckpointCapabilities = ({ semanticStateExport = false, semanticStateImport = false } = {}) => (
  semanticStateExport && semanticStateImport
    ? [terminalCheckpointCapability]
    : []
);

const terminalCheckpointCapabilitiesForTerminal = (terminal) => terminalCheckpointCapabilities({
  semanticStateExport: terminalCheckpointAdapterIsComplete(terminal),
  semanticStateImport: terminalCheckpointAdapterIsComplete(terminal),
});

const exportTerminalCheckpoint = (adapter, checkpoint) => {
  if (!terminalCheckpointAdapterIsComplete(adapter)) {
    throw new Error("semantic checkpoint adapter is incomplete");
  }
  const normalized = normalizeTerminalCheckpoint(adapter.exportSemanticState(), {
    expectedIdentity: checkpoint?.identity,
  });
  if (checkpoint?.checkpointCursor !== undefined && normalized.checkpointCursor !== String(checkpoint.checkpointCursor)) {
    throw new Error("exported checkpoint cursor does not match the requested cursor");
  }
  return normalized;
};

const importTerminalCheckpoint = (adapter, checkpoint, { expectedIdentity = null } = {}) => {
  if (!terminalCheckpointAdapterIsComplete(adapter)) {
    throw new Error("semantic checkpoint adapter is incomplete");
  }
  const normalized = normalizeTerminalCheckpoint(checkpoint, { expectedIdentity });
  adapter.importSemanticState(normalized.state);
  return normalized;
};

const negotiateTerminalCheckpointProtocol = ({ localCapabilities = [], remoteCapabilities = [] } = {}) => {
  const local = localCapabilities.find((entry) => entry?.protocol === terminalCheckpointProtocol);
  const remote = remoteCapabilities.find((entry) => entry?.protocol === terminalCheckpointProtocol);
  if (!local || !remote) {
    return null;
  }
  const localMaxTail = Number(local.maxTailBytes || 0);
  const remoteMaxTail = Number(remote.maxTailBytes || 0);
  if (!Number.isSafeInteger(localMaxTail) || !Number.isSafeInteger(remoteMaxTail)) {
    return null;
  }
  const maxTailBytes = Math.min(localMaxTail, remoteMaxTail, terminalCheckpointMaxTailBytes);
  return maxTailBytes > 0 ? Object.freeze({
    protocol: terminalCheckpointProtocol,
    maxTailBytes,
  }) : null;
};

const normalizeUnsigned = (value, field) => {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${field} must be an unsigned decimal string`);
  }
  return BigInt(text).toString();
};

const normalizePositive = (value, field) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return number;
};

const normalizeNonnegative = (value, field) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return number;
};

const normalizeIdentity = (identity) => {
  const selector = String(identity?.selector || "").trim();
  const paneID = String(identity?.paneID || identity?.pane_id || "").trim();
  const historyGeneration = String(identity?.historyGeneration || identity?.history_generation || "").trim();
  if (!selector || !paneID || !historyGeneration) {
    throw new Error("checkpoint identity is incomplete");
  }
  return { selector, paneID, historyGeneration };
};

const normalizeTerminalState = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("checkpoint terminal state is missing");
  }
  const modes = state.modes;
  if (!modes || typeof modes !== "object" || Array.isArray(modes)) {
    throw new Error("checkpoint terminal modes are missing");
  }
  for (const mode of terminalCheckpointRequiredModes) {
    if (typeof modes[mode] !== "boolean") {
      throw new Error(`checkpoint terminal mode ${mode} is missing`);
    }
  }
  const screen = state.screen;
  if (!screen || typeof screen !== "object" || Array.isArray(screen)) {
    throw new Error("checkpoint screen state is missing");
  }
  const rows = normalizePositive(screen.rows, "checkpoint screen rows");
  const cols = normalizePositive(screen.cols, "checkpoint screen cols");
  if (rows > terminalCheckpointMaxScreenRows || !Array.isArray(screen.lines) || screen.lines.length !== rows) {
    throw new Error("checkpoint screen lines are invalid");
  }
  const cursorRow = Number(state.cursor?.row);
  const cursorCol = Number(state.cursor?.col);
  if (!Number.isInteger(cursorRow) || cursorRow < 0 || cursorRow >= rows || !Number.isInteger(cursorCol) || cursorCol < 0 || cursorCol >= cols) {
    throw new Error("checkpoint cursor is outside the screen");
  }
  return {
    modes: Object.fromEntries(terminalCheckpointRequiredModes.map((mode) => [mode, modes[mode]])),
    cursor: {
      row: cursorRow,
      col: cursorCol,
      visible: state.cursor?.visible !== false,
    },
    screen: {
      rows,
      cols,
      lines: screen.lines.map((line) => ({
        text: String(line?.text || ""),
        wrapped: line?.wrapped === true,
      })),
      alternate: screen.alternate === true,
    },
  };
};

const normalizeTerminalCheckpoint = (input, { expectedIdentity = null } = {}) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("terminal checkpoint must be an object");
  }
  if (String(input.protocol || "") !== terminalCheckpointProtocol) {
    throw new Error("unsupported terminal checkpoint protocol");
  }
  const identity = normalizeIdentity(input.identity);
  if (expectedIdentity) {
    const expected = normalizeIdentity(expectedIdentity);
    if (
      identity.selector !== expected.selector
      || identity.paneID !== expected.paneID
      || identity.historyGeneration !== expected.historyGeneration
    ) {
      throw new Error("terminal checkpoint identity does not match");
    }
  }
  const checkpointID = String(input.checkpointID || input.checkpoint_id || "").trim();
  if (!checkpointID) {
    throw new Error("checkpoint id is missing");
  }
  const checkpointCursor = normalizeUnsigned(input.checkpointCursor ?? input.checkpoint_cursor, "checkpoint cursor");
  const tailStartCursor = normalizeUnsigned(input.tail?.startCursor ?? input.tail?.start_cursor, "checkpoint tail start cursor");
  const tailEndCursor = normalizeUnsigned(input.tail?.endCursor ?? input.tail?.end_cursor, "checkpoint tail end cursor");
  const checkpoint = BigInt(checkpointCursor);
  const tailStart = BigInt(tailStartCursor);
  const tailEnd = BigInt(tailEndCursor);
  const tailBytes = normalizeNonnegative(input.tail?.byteLength ?? input.tail?.byte_length ?? 0, "checkpoint tail byte length");
  if (tailStart !== checkpoint || tailEnd < tailStart || tailEnd - tailStart !== BigInt(tailBytes)) {
    throw new Error("checkpoint tail range is not continuous");
  }
  if (tailBytes > terminalCheckpointMaxTailBytes) {
    throw new Error("checkpoint tail exceeds its bounded window");
  }
  const geometry = {
    cols: normalizePositive(input.geometry?.cols, "checkpoint geometry cols"),
    rows: normalizePositive(input.geometry?.rows, "checkpoint geometry rows"),
  };
  const state = normalizeTerminalState(input.state);
  if (state.screen.cols !== geometry.cols || state.screen.rows !== geometry.rows) {
    throw new Error("checkpoint geometry does not match screen state");
  }
  return Object.freeze({
    protocol: terminalCheckpointProtocol,
    checkpointID: String(input.checkpointID || input.checkpoint_id || "").trim(),
    identity,
    checkpointCursor,
    geometry,
    state,
    tail: {
      startCursor: tailStartCursor,
      endCursor: tailEndCursor,
      byteLength: tailBytes,
    },
  });
};

const terminalCheckpointIsUsable = (input, options = {}) => {
  try {
    normalizeTerminalCheckpoint(input, options);
    return true;
  } catch (error) {
    return false;
  }
};

export {
  terminalCheckpointProtocol,
  terminalCheckpointMaxTailBytes,
  terminalCheckpointCapability,
  terminalCheckpointAdapterIsComplete,
  terminalCheckpointCapabilities,
  terminalCheckpointCapabilitiesForTerminal,
  exportTerminalCheckpoint,
  importTerminalCheckpoint,
  negotiateTerminalCheckpointProtocol,
  normalizeTerminalCheckpoint,
  terminalCheckpointIsUsable,
};
