export const compareTerminalSelectionCells = (left, right) => {
  if (!left || !right) {
    return 0;
  }
  if (left.absoluteRow !== right.absoluteRow) {
    return left.absoluteRow - right.absoluteRow;
  }
  return left.col - right.col;
};

export const normalizeTerminalSelectionCells = (start, end) => {
  if (!start || !end) {
    return null;
  }
  return compareTerminalSelectionCells(start, end) <= 0
    ? { start, end }
    : { start: end, end: start };
};

export const previousTerminalSelectionCell = (cols, cell) => {
  const width = Math.max(1, Math.floor(Number(cols) || 1));
  if (!cell) {
    return null;
  }
  if (cell.col > 0) {
    return { col: cell.col - 1, absoluteRow: cell.absoluteRow };
  }
  return { col: width - 1, absoluteRow: Math.max(0, cell.absoluteRow - 1) };
};

export const nextTerminalSelectionCell = (cols, cell) => {
  const width = Math.max(1, Math.floor(Number(cols) || 1));
  if (!cell) {
    return null;
  }
  if (cell.col < width - 1) {
    return { col: cell.col + 1, absoluteRow: cell.absoluteRow };
  }
  return { col: 0, absoluteRow: cell.absoluteRow + 1 };
};

export const terminalSelectionRange = (manager) => {
  if (!manager?.selectionStart || !manager?.selectionEnd) {
    return null;
  }
  let startCol = Number(manager.selectionStart.col);
  let startRow = Number(manager.selectionStart.absoluteRow);
  let endCol = Number(manager.selectionEnd.col);
  let endRow = Number(manager.selectionEnd.absoluteRow);
  if (![startCol, startRow, endCol, endRow].every(Number.isFinite)) {
    return null;
  }
  startCol = Math.max(0, Math.floor(startCol));
  startRow = Math.max(0, Math.floor(startRow));
  endCol = Math.max(0, Math.floor(endCol));
  endRow = Math.max(0, Math.floor(endRow));
  if (startRow > endRow || (startRow === endRow && startCol > endCol)) {
    [startCol, endCol] = [endCol, startCol];
    [startRow, endRow] = [endRow, startRow];
  }
  return { startCol, startRow, endCol, endRow };
};

const terminalSelectionLineAt = (manager, absoluteRow, scrollback) => {
  if (!manager?.wasmTerm || absoluteRow < 0) {
    return null;
  }
  return absoluteRow < scrollback
    ? manager.wasmTerm.getScrollbackLine?.(absoluteRow) || null
    : manager.wasmTerm.getLine?.(absoluteRow - scrollback) || null;
};

const terminalSelectionCodepointText = (codepoint) => {
  const value = Number(codepoint || 0);
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
    return "";
  }
  return String.fromCodePoint(value);
};

const terminalSelectionCellText = (manager, cell, absoluteRow, column, scrollback) => {
  if (!cell) {
    return { text: " ", content: false };
  }
  if (Number(cell?.width ?? 1) === 0) {
    return { text: "", content: false };
  }
  if (!cell.codepoint) {
    return { text: " ", content: false };
  }
  const text = cell.grapheme_len > 0
    ? (absoluteRow < scrollback
      ? manager.wasmTerm?.getScrollbackGraphemeString?.(absoluteRow, column)
      : manager.wasmTerm?.getGraphemeString?.(absoluteRow - scrollback, column))
    : terminalSelectionCodepointText(cell.codepoint);
  if (!text) {
    return { text: " ", content: false };
  }
  return { text, content: Boolean(text.trim()) };
};

export const terminalSelectionText = (manager) => {
  const range = terminalSelectionRange(manager);
  if (!range || !manager?.wasmTerm) {
    return "";
  }
  const scrollback = Math.max(0, Math.floor(manager.wasmTerm.getScrollbackLength?.() || 0));
  let text = "";
  for (let absoluteRow = range.startRow; absoluteRow <= range.endRow; absoluteRow += 1) {
    const line = terminalSelectionLineAt(manager, absoluteRow, scrollback);
    if (!line) {
      continue;
    }
    const startCol = absoluteRow === range.startRow ? range.startCol : 0;
    const endCol = absoluteRow === range.endRow ? range.endCol : Math.max(0, line.length - 1);
    let lineText = "";
    let lastContentLength = -1;
    for (let column = startCol; column <= endCol; column += 1) {
      const cellText = terminalSelectionCellText(manager, line[column], absoluteRow, column, scrollback);
      lineText += cellText.text;
      if (cellText.content) {
        lastContentLength = lineText.length;
      }
    }
    lineText = lastContentLength >= 0 ? lineText.substring(0, lastContentLength) : "";
    text += lineText;
    if (absoluteRow < range.endRow) {
      text += "\n";
    }
  }
  return text;
};

export const currentTerminalSelectionCells = (session) => {
  const manager = session?.term?.selectionManager;
  if (!manager?.selectionStart || !manager?.selectionEnd) {
    return null;
  }
  return normalizeTerminalSelectionCells(
    { col: manager.selectionStart.col, absoluteRow: manager.selectionStart.absoluteRow },
    { col: manager.selectionEnd.col, absoluteRow: manager.selectionEnd.absoluteRow },
  );
};

export const terminalSelectionContainsCell = (selection, cell) => {
  if (!selection || !cell) {
    return false;
  }
  if (cell.absoluteRow < selection.start.absoluteRow || cell.absoluteRow > selection.end.absoluteRow) {
    return false;
  }
  if (selection.start.absoluteRow === selection.end.absoluteRow) {
    return cell.col >= selection.start.col && cell.col <= selection.end.col;
  }
  if (cell.absoluteRow === selection.start.absoluteRow) {
    return cell.col >= selection.start.col;
  }
  if (cell.absoluteRow === selection.end.absoluteRow) {
    return cell.col <= selection.end.col;
  }
  return true;
};
