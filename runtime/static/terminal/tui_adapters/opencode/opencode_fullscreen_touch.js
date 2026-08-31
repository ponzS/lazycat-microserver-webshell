import { createFullscreenTuiTouchGesture } from "../common/index.js";

const stripQuotes = (value) => {
  const token = String(value || "").trim();
  if (token.length < 2) {
    return token;
  }
  const quote = token[0];
  return (quote === "\"" || quote === "'") && token[token.length - 1] === quote
    ? token.slice(1, -1)
    : token;
};

const tokens = (value) => (
  String(value || "").match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
).map(stripQuotes);

const executable = (value) => {
  const normalized = stripQuotes(value).replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
};

const opencodeExecutablePattern = /^opencode(?:-\d+(?:\.\d+){1,3})?$/i;
const isOpencodeEntrypoint = (value) => (
  opencodeExecutablePattern.test(executable(value))
  || /(?:^|\/)opencode(?:\/|$)/i.test(stripQuotes(value).replace(/\\/g, "/"))
);

export const isOpencodeTerminalIdentity = (session) => {
  if (isOpencodeEntrypoint(session?.command)) {
    return true;
  }
  const commandTokens = tokens(session?.processCommandLine);
  if (isOpencodeEntrypoint(commandTokens[0])) {
    return true;
  }
  const launcher = executable(commandTokens[0]).toLowerCase();
  if (["node", "nodejs", "bun", "deno"].includes(launcher) && isOpencodeEntrypoint(commandTokens[1])) {
    return true;
  }
  return ["opencode", "opencode code"].includes(String(session?.title || "").trim().toLowerCase());
};

export const isOpencodeFullscreenTouchCandidate = (session, { mouseTracking = false } = {}) => (
  isOpencodeTerminalIdentity(session) && mouseTracking === true
);

export { createFullscreenTuiTouchGesture };
