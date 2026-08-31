import { buildTerminalLogicalLines } from "./terminal_text_model.js";

export const findTerminalSearchMatches = (term, query) => {
  const value = String(query || "");
  if (!term || !value) {
    return [];
  }
  const queryLower = value.toLowerCase();
  const matches = [];
  for (const logical of buildTerminalLogicalLines(term)) {
    const textLower = logical.text.toLowerCase();
    let offset = textLower.indexOf(queryLower);
    while (offset >= 0) {
      const position = logical.positions[offset];
      if (position) {
        matches.push({
          row: position.row,
          col: position.col,
          length: value.length,
        });
      }
      offset = textLower.indexOf(queryLower, offset + Math.max(1, queryLower.length));
    }
  }
  return matches;
};

export const scrollTerminalToAbsoluteRow = (term, absoluteRow, preferredViewportRow = 2) => {
  if (!term) {
    return 0;
  }
  const scrollback = term.wasmTerm?.getScrollbackLength?.() || 0;
  const viewportY = Math.max(0, Math.min(scrollback, scrollback + preferredViewportRow - absoluteRow));
  term.scrollToLine?.(viewportY);
  return Math.max(
    0,
    Math.min(
      Math.max(0, Number(term.rows || 0) - 1),
      absoluteRow - scrollback + Math.floor(term.getViewportY?.() || term.viewportY || 0),
    ),
  );
};
