import { createFullscreenTuiTouchGesture } from "./fullscreen_tui_touch.js";

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

const piExecutablePattern = /^pi(?:-\d+(?:\.\d+){1,3})?$/i;
const isPiEntrypoint = (value) => (
  piExecutablePattern.test(executable(value))
  || /(?:^|\/)pi(?:\/|$)/i.test(stripQuotes(value).replace(/\\/g, "/"))
);

export const isPiTerminalIdentity = (session) => {
  if (isPiEntrypoint(session?.command)) {
    return true;
  }
  const commandTokens = tokens(session?.processCommandLine);
  if (isPiEntrypoint(commandTokens[0])) {
    return true;
  }
  const launcher = executable(commandTokens[0]).toLowerCase();
  if (["node", "nodejs", "bun", "deno"].includes(launcher) && isPiEntrypoint(commandTokens[1])) {
    return true;
  }
  return String(session?.title || "").trim().toLowerCase() === "pi";
};

export const isPiFullscreenTouchCandidate = (session, { mouseTracking = false } = {}) => (
  isPiTerminalIdentity(session) && mouseTracking === true
);

export { createFullscreenTuiTouchGesture };
