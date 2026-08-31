import {
  cloneDesktopShortcuts,
  cloneMobileShortcutRows,
  desktopShortcutActionLabels,
  displayShortcut,
  encodeMobileShortcutKeyInput,
  mobileShortcutActionOptions,
  mobileShortcutKeyOptions,
  normalizeShortcutDefinition,
} from "./settings_model.js";

const newID = (prefix, now = Date.now(), random = Math.random()) => (
  `${prefix}-${Number(now).toString(36)}-${Number(random).toString(36).slice(2, 8)}`
);

export const shortcutAt = (rows, rowIndex, index) => rows?.[rowIndex]?.[index] || null;

export function buildMobileShortcut({ draft, rows, editorState, now, random } = {}) {
  const label = String(draft?.label || "").trim();
  if (!label || Array.from(label).length > 16) {
    throw new Error("快捷键名称必须是 1-16 个字符。");
  }
  const count = cloneMobileShortcutRows(rows).flat().length;
  if (count >= 64 && Number(editorState?.index ?? -1) < 0) {
    throw new Error("手机快捷键最多 64 个。");
  }
  const existing = shortcutAt(rows, editorState?.rowIndex, editorState?.index);
  const shortcut = {
    id: existing?.id || newID("custom", now, random),
    label,
    ariaLabel: label,
  };
  const type = ["action", "text"].includes(draft?.type) ? draft.type : "input";
  if (type === "action") {
    const action = String(draft?.action || "").trim();
    if (!mobileShortcutActionOptions.some((item) => item.value === action)) {
      throw new Error("请选择有效动作。");
    }
    shortcut.action = action;
    if (action === "open_mobile_menu") shortcut.kind = "menu";
    else if (action === "toggle_touch_feedback") shortcut.kind = "feedback";
    else if (action.startsWith("sticky_") || action.startsWith("zoom_")) shortcut.kind = "modifier";
    return shortcut;
  }
  if (type === "text") {
    const text = typeof draft?.text === "string" ? draft.text : "";
    if (text === "" || Array.from(text).length > 1024) {
      throw new Error("发送文字必须是 1-1024 个字符。");
    }
    if (text.includes("\x00")) {
      throw new Error("发送文字不能包含 NUL 字符。");
    }
    shortcut.text = text;
    shortcut.data = text;
    return shortcut;
  }
  let inputKey = String(draft?.inputKey || "").trim();
  if (inputKey === "custom") {
    inputKey = Array.from(String(draft?.customKey || ""))[0] || "";
  }
  if (!inputKey) {
    throw new Error("请输入或选择按键。");
  }
  shortcut.inputKey = inputKey;
  shortcut.inputModifiers = {
    ctrl: draft?.ctrl === true,
    alt: draft?.alt === true,
    shift: draft?.shift === true,
  };
  if (["enter", "escape"].includes(inputKey)) shortcut.kind = "primary";
  else if (inputKey.startsWith("arrow_")) shortcut.kind = "nav";
  else if (inputKey.length === 1 && !/[A-Za-z0-9]/.test(inputKey)) shortcut.kind = "symbol";
  shortcut.data = encodeMobileShortcutKeyInput(inputKey, shortcut.inputModifiers);
  return shortcut;
}

export function applyMobileShortcutEdit(rows, editorState, shortcut) {
  const nextRows = cloneMobileShortcutRows(rows);
  const rowIndex = Math.max(0, Math.min(1, Number(editorState?.rowIndex || 0)));
  const index = Number(editorState?.index ?? -1);
  if (index >= 0 && nextRows[rowIndex]?.[index]) {
    nextRows[rowIndex][index] = shortcut;
  } else {
    nextRows[rowIndex].push(shortcut);
  }
  return nextRows;
}

export function removeMobileShortcut(rows, rowIndex, index) {
  const nextRows = cloneMobileShortcutRows(rows);
  nextRows[Math.max(0, Math.min(1, Number(rowIndex || 0)))]?.splice(Number(index || 0), 1);
  return nextRows;
}

export function buildDesktopShortcut({ draft, shortcuts, editorState, navigatorObject, now, random } = {}) {
  const label = String(draft?.label || "").trim();
  if (!label || Array.from(label).length > 32) {
    throw new Error("快捷键名称必须是 1-32 个字符。");
  }
  if (cloneDesktopShortcuts(shortcuts).length >= 64 && Number(editorState?.index ?? -1) < 0) {
    throw new Error("PC快捷键最多 64 个。");
  }
  const action = String(draft?.action || "").trim();
  if (!desktopShortcutActionLabels.has(action)) {
    throw new Error("请选择有效动作。");
  }
  const normalized = normalizeShortcutDefinition(draft?.shortcut);
  if (!normalized) {
    throw new Error("请输入有效快捷键。");
  }
  const duplicate = cloneDesktopShortcuts(shortcuts).some((item, itemIndex) => (
    itemIndex !== Number(editorState?.index ?? -1)
    && normalizeShortcutDefinition(item.shortcut) === normalized
  ));
  if (duplicate) {
    throw new Error("该快捷键已经被其他动作使用。");
  }
  const existing = cloneDesktopShortcuts(shortcuts)[Number(editorState?.index ?? -1)];
  return {
    id: existing?.id || newID("desktop", now, random),
    label,
    action,
    shortcut: displayShortcut(normalized, navigatorObject),
  };
}

export function applyDesktopShortcutEdit(shortcuts, editorState, shortcut) {
  const next = cloneDesktopShortcuts(shortcuts);
  const index = Number(editorState?.index ?? -1);
  if (index >= 0 && next[index]) next[index] = shortcut;
  else next.push(shortcut);
  return next;
}

export function removeDesktopShortcut(shortcuts, index) {
  const next = cloneDesktopShortcuts(shortcuts);
  next.splice(Number(index || 0), 1);
  return next;
}

export function mobileEditorInitialDraft(existing) {
  const inputKey = existing?.inputKey || "tab";
  const knownKey = inputKey !== "" && mobileShortcutKeyOptions.some((item) => item.value === inputKey);
  const hasText = typeof existing?.text === "string" && existing.text !== "";
  return {
    type: existing?.action ? "action" : hasText ? "text" : "input",
    label: existing?.label || "",
    action: existing?.action || "copy",
    text: typeof existing?.text === "string" ? existing.text : "",
    inputKey: knownKey ? inputKey : "custom",
    customKey: knownKey ? "" : inputKey,
    ctrl: existing?.inputModifiers?.ctrl === true,
    alt: existing?.inputModifiers?.alt === true,
    shift: existing?.inputModifiers?.shift === true,
  };
}
