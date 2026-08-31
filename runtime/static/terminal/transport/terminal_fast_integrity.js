const textDecoder = new TextDecoder();

const crc32 = (data) => {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
};

export const encodeFastBinaryFrame = ({
  selector,
  paneID,
  historyGeneration = "",
  sequence,
  startCursor,
  payload,
}) => {
  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const start = BigInt(startCursor);
  const checksum = crc32(data).toString(16).padStart(8, "0");
  const header = JSON.stringify({
    protocol_version: 1,
    selector: String(selector || ""),
    pane_id: String(paneID || ""),
    history_generation: String(historyGeneration || ""),
    sequence: String(sequence),
    start_cursor: start.toString(),
    end_cursor: (start + BigInt(data.byteLength)).toString(),
    length: data.byteLength,
    checksum,
  });
  const headerBytes = new TextEncoder().encode(header);
  const frame = new Uint8Array(8 + headerBytes.byteLength + data.byteLength);
  frame.set([0x4c, 0x43, 0x46, 0x31]);
  new DataView(frame.buffer).setUint32(4, headerBytes.byteLength, false);
  frame.set(headerBytes, 8);
  frame.set(data, 8 + headerBytes.byteLength);
  return frame;
};

export const decodeFastBinaryFrame = (input, identity = {}) => {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (data.byteLength < 8 || String.fromCharCode(...data.subarray(0, 4)) !== "LCF1") {
    throw new Error("invalid Fast binary envelope magic");
  }
  const headerLength = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, false);
  if (headerLength <= 0 || headerLength + 8 > data.byteLength) {
    throw new Error("invalid Fast binary envelope header length");
  }
  let header;
  try {
    header = JSON.parse(textDecoder.decode(data.subarray(8, 8 + headerLength)));
  } catch {
    throw new Error("invalid Fast binary envelope JSON");
  }
  const payload = data.subarray(8 + headerLength);
  const parse = (value) => /^\d+$/.test(String(value ?? "").trim()) ? BigInt(String(value).trim()) : null;
  const start = parse(header.start_cursor);
  const end = parse(header.end_cursor);
  const sequence = parse(header.sequence);
  if (header.protocol_version !== 1 || (identity.selector && header.selector !== identity.selector) || (identity.paneID && header.pane_id !== identity.paneID) || (identity.historyGeneration && header.history_generation !== identity.historyGeneration) || start === null || end === null || sequence === null || end - start !== BigInt(payload.byteLength) || Number(header.length) !== payload.byteLength) {
    throw new Error("Fast binary envelope identity or range mismatch");
  }
  if (identity.expectedSequence !== undefined && sequence !== BigInt(identity.expectedSequence)) {
    throw new Error("Fast binary envelope sequence discontinuity");
  }
  if (identity.expectedStartCursor !== undefined && start !== BigInt(identity.expectedStartCursor)) {
    throw new Error("Fast binary envelope cursor discontinuity");
  }
  const checksum = crc32(payload).toString(16).padStart(8, "0");
  if (checksum !== String(header.checksum || "").toLowerCase().replace(/^0x/, "").padStart(8, "0")) {
    throw new Error("Fast binary envelope checksum mismatch");
  }
  return { header, payload, startCursor: start, endCursor: end, sequence };
};
