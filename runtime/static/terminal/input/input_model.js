const generatedTerminalResponsePattern =
  /^(?:\x1b)?(?:\[\d{1,4};\d{1,4}R|\[\d{1,4}R|\[0n|\[\?[\d;]{1,16}c|\[>[\d;]{1,16}c)/;
const generatedTerminalResponseTailPattern =
  /^(?:\[\d{1,4};\d{1,4}R|\[\d{1,4}R|\d{1,4};\d{1,4}R|;\d{1,4}R|\d{1,4}R|\dR)+$/;

export function isGeneratedTerminalResponse(data, { isKittyGraphicsResponse = () => false } = {}) {
  if (typeof data !== "string" || data === "") {
    return false;
  }
  if (isKittyGraphicsResponse(data)) {
    return true;
  }
  let remaining = data;
  while (remaining) {
    const match = generatedTerminalResponsePattern.exec(remaining);
    if (!match) {
      return false;
    }
    remaining = remaining.slice(match[0].length);
  }
  return true;
}

export function isGeneratedTerminalResponseTail(data) {
  return typeof data === "string"
    && data !== ""
    && generatedTerminalResponseTailPattern.test(data);
}

export function splitTerminalInputChunks(data, chunkChars = 16 * 1024) {
  const value = String(data || "");
  const size = Math.max(1, Math.floor(Number(chunkChars) || 1));
  const chunks = [];
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + size);
    if (end < value.length) {
      const code = value.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) {
        end -= 1;
      }
    }
    if (end <= offset) {
      end = Math.min(value.length, offset + 1);
    }
    chunks.push(value.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export function buildTerminalInputQueueItems(data, {
  generated = false,
  maxBytes = Infinity,
  chunkChars = 16 * 1024,
  textEncoder = new TextEncoder(),
} = {}) {
  const items = [];
  let byteLength = 0;
  for (const chunk of splitTerminalInputChunks(data, chunkChars)) {
    const chunkByteLength = textEncoder.encode(chunk).length;
    byteLength += chunkByteLength;
    if (byteLength > maxBytes) {
      return { items: [], byteLength, exceeded: true };
    }
    items.push({
      data: chunk,
      generated: generated === true,
      byteLength: chunkByteLength,
    });
  }
  return { items, byteLength, exceeded: false };
}
