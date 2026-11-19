import { installFullscreenTuiTouchAdapter } from "../common/index.js";

const agyExecutable = /^(?:agy|antigravity|antigravity-cli)(?:\.exe)?$/i;

export const isAgyFullscreenTouchCandidate = (session, { mouseTracking = false } = {}) => {
  const term = session?.term;
  const alternate = term?.wasmTerm?.isAlternateScreen?.() || term?.buffer?.active?.type === "alternate";
  if (!mouseTracking || !alternate) return false;
  if (session.agentId) return session.agentId === "antigravity-cli";
  const command = String(session.command || "").replace(/\\/g, "/").split("/").pop();
  return agyExecutable.test(command);
};

export const installAgyFullscreenTouchAdapter = installFullscreenTuiTouchAdapter;
