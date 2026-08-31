const lineToTextAndMap = (line, { trimEnd = false } = {}) => {
  const length = Number(line?.length || 0);
  let text = "";
  const map = [];
  for (let col = 0; col < length; col += 1) {
    const cell = line.getCell(col);
    let chars = cell?.getChars?.() || "";
    if (!chars) {
      if (cell?.getWidth?.() === 0) {
        continue;
      }
      chars = " ";
    }
    for (let index = 0; index < chars.length; index += 1) {
      map.push(col);
    }
    text += chars;
  }
  if (trimEnd) {
    const trimmed = text.trimEnd();
    return { text: trimmed, map: map.slice(0, trimmed.length) };
  }
  return { text, map };
};

export const buildTerminalLogicalLines = (term) => {
  const buffer = term?.buffer?.active;
  const length = Number(buffer?.length || 0);
  const scrollback = term?.wasmTerm?.getScrollbackLength?.() || Math.max(0, length - (term?.rows || 0));
  const logicalLines = [];
  let current = null;
  for (let row = 0; row < length; row += 1) {
    const line = buffer.getLine(row);
    if (!line) {
      continue;
    }
    if (!current) {
      current = { text: "", positions: [], startRow: row, endRow: row };
    }
    const raw = lineToTextAndMap(line, { trimEnd: false });
    const rawTrimmedLength = raw.text.trimEnd().length;
    const wrapped = Boolean(line.isWrapped) || (row < scrollback && rawTrimmedLength >= Math.max(1, term?.cols || line.length));
    const { text, map } = wrapped ? raw : lineToTextAndMap(line, { trimEnd: true });
    for (let index = 0; index < text.length; index += 1) {
      current.positions.push({ row, col: map[index] ?? index });
    }
    current.text += text;
    current.endRow = row;
    if (!wrapped) {
      logicalLines.push(current);
      current = null;
    }
  }
  if (current) {
    current.text = current.text.trimEnd();
    current.positions = current.positions.slice(0, current.text.length);
    logicalLines.push(current);
  }
  return logicalLines;
};

export const terminalFullBufferText = (term) => (
  buildTerminalLogicalLines(term).map((line) => line.text).join("\n")
);

export const terminalLogicalLineAt = (term, absoluteRow) => (
  buildTerminalLogicalLines(term).find((line) => line.startRow <= absoluteRow && line.endRow >= absoluteRow) || null
);
