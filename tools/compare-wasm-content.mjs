#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const sectionNames = new Map([
  [1, "type"],
  [2, "import"],
  [3, "function"],
  [4, "table"],
  [5, "memory"],
  [6, "global"],
  [7, "export"],
  [8, "start"],
  [9, "element"],
  [10, "code"],
  [11, "data"],
  [12, "data-count"],
  [13, "tag"],
]);

const readULEB128 = (bytes, start, file) => {
  let value = 0;
  let multiplier = 1;
  let offset = start;

  for (let index = 0; index < 5; index += 1) {
    if (offset >= bytes.length) {
      throw new Error(`${file}: truncated unsigned LEB128 at byte ${start}`);
    }
    const byte = bytes[offset];
    offset += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      return { value, offset };
    }
    multiplier *= 128;
  }

  throw new Error(`${file}: invalid unsigned LEB128 at byte ${start}`);
};

const parseCoreSections = (bytes, file) => {
  const expectedHeader = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  if (bytes.length < expectedHeader.length) {
    throw new Error(`${file}: truncated WebAssembly header`);
  }
  for (let index = 0; index < expectedHeader.length; index += 1) {
    if (bytes[index] !== expectedHeader[index]) {
      throw new Error(`${file}: invalid WebAssembly header or version`);
    }
  }

  const sections = [];
  let offset = expectedHeader.length;
  while (offset < bytes.length) {
    const id = bytes[offset];
    offset += 1;
    const size = readULEB128(bytes, offset, file);
    offset = size.offset;
    const end = offset + size.value;
    if (end > bytes.length) {
      throw new Error(`${file}: section ${id} extends past end of file`);
    }
    if (id !== 0) {
      sections.push({ id, bytes: bytes.subarray(offset, end) });
    }
    offset = end;
  }
  return sections;
};

const firstDifference = (left, right) => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : length;
};

const describeSection = (section) =>
  section ? `${sectionNames.get(section.id) || "section"}(${section.id})` : "missing";

const compare = (sourceSections, runtimeSections) => {
  const length = Math.max(sourceSections.length, runtimeSections.length);
  for (let index = 0; index < length; index += 1) {
    const source = sourceSections[index];
    const runtime = runtimeSections[index];
    if (!source || !runtime || source.id !== runtime.id) {
      return `section ${index}: source=${describeSection(source)}, runtime=${describeSection(runtime)}`;
    }
    const byteOffset = firstDifference(source.bytes, runtime.bytes);
    if (byteOffset >= 0) {
      return `${describeSection(source)} content differs at payload byte ${byteOffset} ` +
        `(source=${source.bytes.length} bytes, runtime=${runtime.bytes.length} bytes)`;
    }
  }
  return "";
};

const [sourcePath, runtimePath] = process.argv.slice(2);
if (!sourcePath || !runtimePath || process.argv.length !== 4) {
  console.error("usage: compare-wasm-content.mjs SOURCE.wasm RUNTIME.wasm");
  process.exit(2);
}

try {
  const [sourceBytes, runtimeBytes] = await Promise.all([
    readFile(sourcePath),
    readFile(runtimePath),
  ]);
  const difference = compare(
    parseCoreSections(sourceBytes, sourcePath),
    parseCoreSections(runtimeBytes, runtimePath),
  );
  if (difference) {
    console.error(`WASM core section content differs: ${difference}`);
    process.exit(1);
  }
  console.log("WASM core section content matches");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
