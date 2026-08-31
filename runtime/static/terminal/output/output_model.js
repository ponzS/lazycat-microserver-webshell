export const TERMINAL_OUTPUT_MEASURE_CHUNK_CHARS = 32 * 1024;

const textEncoder = new TextEncoder();
const measureBuffer = new Uint8Array(TERMINAL_OUTPUT_MEASURE_CHUNK_CHARS * 4);

export const terminalOutputKind = (data) => {
  if (typeof data === "string") {
    return "text";
  }
  if (data instanceof Uint8Array) {
    return "bytes";
  }
  return "";
};

export const terminalOutputByteLength = (data) => {
  if (typeof data === "string") {
    if (data.length === 0) {
      return 0;
    }
    let total = 0;
    for (let offset = 0; offset < data.length;) {
      let end = Math.min(data.length, offset + TERMINAL_OUTPUT_MEASURE_CHUNK_CHARS);
      if (end < data.length) {
        const code = data.charCodeAt(end - 1);
        if (code >= 0xD800 && code <= 0xDBFF) {
          end -= 1;
        }
      }
      if (end <= offset) {
        end = Math.min(data.length, offset + 1);
      }
      const result = textEncoder.encodeInto(data.slice(offset, end), measureBuffer);
      total += result.written;
      offset = end;
    }
    return total;
  }
  if (data instanceof Uint8Array) {
    return data.byteLength;
  }
  return 0;
};

export const utf8ByteLengthForCodePoint = (codepoint) => (
  codepoint <= 0x7f ? 1
    : codepoint <= 0x7ff ? 2
      : codepoint <= 0xffff ? 3
        : 4
);

export const terminalOutputByteChunkEnd = (data, start, maxBytes) => {
  const hardEnd = Math.min(data.byteLength, start + maxBytes);
  if (hardEnd >= data.byteLength) {
    return hardEnd;
  }
  let end = hardEnd;
  while (end > start && (data[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return end > start ? end : hardEnd;
};

export const splitTerminalOutputText = (data, maxBytes) => {
  const chunks = [];
  let chunk = "";
  let chunkBytes = 0;
  for (let index = 0; index < data.length;) {
    const codepoint = data.codePointAt(index);
    const text = String.fromCodePoint(codepoint);
    const byteLength = utf8ByteLengthForCodePoint(codepoint);
    if (chunk && chunkBytes + byteLength > maxBytes) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += text;
    chunkBytes += byteLength;
    index += text.length;
  }
  if (chunk) {
    chunks.push(chunk);
  }
  return chunks;
};

export const coalesceTerminalOutputBatch = (chunks, kind, byteLength) => {
  if (chunks.length === 1) {
    return chunks[0];
  }
  if (kind === "text") {
    return chunks.join("");
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

export const parseTerminalOutputCursor = (value) => {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }
  try {
    return BigInt(text);
  } catch (error) {
    return null;
  }
};
