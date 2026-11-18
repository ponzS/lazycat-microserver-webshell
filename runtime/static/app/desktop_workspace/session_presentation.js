import { desktopAgentIdentity } from "./agent_icons.js";
import { desktopToolIcon } from "./tool_icons.js";

const unquote = (value) => String(value || "").replace(/^(["'])(.*)\1$/, "$2");
const executableName = (value) => unquote(value).replace(/\\/g, "/").split("/").pop() || "";

// This describes the actual foreground entry point, not a list of AI brands.
// Only executable/module/script names are exposed; arbitrary arguments and
// inline code (python -c / node -e) must never become a visible session badge.
const tool = (name) => ({ name, icon: desktopToolIcon(name) });

const foregroundTool = (pane) => {
  const tokens = (String(pane.processCommandLine || "").match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map(unquote);
  const command = executableName(pane.command || tokens[0]);
  const launcher = executableName(tokens[0] || command);
  // npm overwrites argv[0] with a process title, including its subcommand.
  const node = /^(?:node|nodejs|bun)(?:\.exe)?$/i.test(command);
  if ((node || command === launcher || command.startsWith(launcher + " ")) && /^(?:npm|npx|pnpm|pnpx|yarn|yarnpkg)$/.test(launcher)) return tool(launcher);
  if (!/^(?:node|nodejs|bun|deno|python(?:w|\d+(?:\.\d+)*)?|ruby|perl|dotnet)(?:\.exe)?$/i.test(launcher)) return tool(command);
  let entry = "";
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (["-c", "-e", "--eval", "-p", "--print"].includes(token)) return tool(command);
    if (token === "-m") return /^[A-Za-z_]\w*(?:\.\w+)*$/.test(tokens[index + 1] || "")
      ? tool(tokens[index + 1].split(".")[0]) : tool(command);
    if (["--require", "-r", "--loader", "--experimental-loader", "--import", "--title", "-W", "-X"].includes(token)) {
      index += 1;
      continue;
    }
    if (token === "run" || (token === "exec" && /^dotnet(?:\.exe)?$/i.test(launcher))) continue;
    if (token.startsWith("-")) {
      if (token.includes("=") || ["--", "-u", "-B", "-E", "-I", "-O", "-OO", "-s", "-S", "-q", "-i",
        "-A", "--allow-all", "--no-warnings", "--no-deprecation", "--enable-source-maps", "--nolazy",
        "--use-strict", "--inspect", "--inspect-brk", "--experimental-strip-types"].includes(token)) continue;
      return tool(command);
    }
    entry = token;
    break;
  }
  if (!entry) return tool(command);
  const parts = entry.replace(/\\/g, "/").split("/");
  const packageIndex = parts.lastIndexOf("node_modules");
  const entryName = executableName(entry).replace(/\.(?:js|cjs|mjs|py|rb|pl|dll)$/i, "") || command;
  const packageName = packageIndex < 0 ? "" : parts[packageIndex + (parts[packageIndex + 1]?.startsWith("@") ? 2 : 1)];
  if (node) {
    if (entryName === "npm-cli" || entryName === "npx-cli") return tool(entryName.slice(0, 3));
    if (/^(?:npm|npx|pnpm|pnpx|yarn|yarnpkg|lzc-cli|lzc-docker|lzc-docker-compose)$/.test(entryName)) return tool(entryName);
    if (/^yarn-\d[\w.-]*$/.test(entryName) && parts.slice(-3, -1).join("/") === ".yarn/releases") return tool("yarn");
  }
  const name = packageName || entryName;
  const knownEntry = packageName || (entryName === executableName(entry) ? entryName : "");
  return { name, icon: desktopToolIcon(knownEntry) || desktopToolIcon(launcher) };
};

export function desktopSessionActivity(tab) {
  const panes = [...tab.panes.values()];
  const foreground = tab.panes.get(tab.activePaneId) || panes[0];
  const running = foreground && !foreground.closed && !foreground.terminalExited && !foreground.terminalExitRetained;
  // Foreground residency is useful for process labels and close protection,
  // but is not evidence that an interactive CLI is executing a task.
  const working = panes.some((pane) => !pane.closed && !pane.terminalExited
    && pane.programState === "working");
  const error = panes.some((pane) => pane.programState === "error"
    || ((pane.terminalExited || pane.terminalExitRetained) && Number(pane.terminalExitCode || 0) !== 0));
  const unread = tab.hasNotification === true;
  const blocked = panes.some((pane) => pane.programState === "blocked");
  const application = running && (desktopAgentIdentity(foreground) || (foreground.busy && foregroundTool(foreground)));
  return {
    application: application?.name || "",
    applicationIcon: application?.icon || "",
    busy: working,
    notification: unread,
    status: error ? "error" : working ? "working" : blocked ? "idle" : unread ? "unread" : "idle",
    statusLabel: error ? "执行出错" : working ? "正在工作" : blocked ? "等待输入或授权"
      : unread ? "已完成，未读" : "",
  };
}
