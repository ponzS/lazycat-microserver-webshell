import assert from "node:assert/strict";
import test from "node:test";

import { createAttachmentsClipboard } from "../runtime/static/attachments/attachments_clipboard.js";

class FakeBlob {
  constructor(parts = [], { type = "" } = {}) {
    this.parts = parts;
    this.size = parts.reduce((total, part) => total + Number(part?.size || String(part || "").length), 0);
    this.type = type;
  }
}

class FakeFile extends FakeBlob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
  }
}

test("attachment clipboard preserves file blobs and synthesizes useful names", async () => {
  const clipboard = createAttachmentsClipboard({
    navigatorObject: {
      clipboard: {
        read: async () => [{
          types: ["text/plain", "image/png"],
          getType: async () => new FakeBlob(["png"], { type: "image/png" }),
        }],
        readText: async () => "fallback",
      },
    },
    windowObject: { isSecureContext: true },
    FileCtor: FakeFile,
    BlobCtor: FakeBlob,
  });
  const files = await clipboard.readFiles();
  assert.equal(files.length, 1);
  assert.equal(files[0].type, "image/png");
  assert.match(files[0].name, /^clipboard-.*-1\.png$/);
});

test("attachment clipboard reports the original permission boundary instead of hiding it", async () => {
  const denied = Object.assign(new Error("clipboard-read not allowed"), { name: "NotAllowedError" });
  const clipboard = createAttachmentsClipboard({
    navigatorObject: {
      clipboard: {
        read: async () => { throw denied; },
        readText: async () => "",
      },
    },
    windowObject: { isSecureContext: true },
    FileCtor: FakeFile,
    BlobCtor: FakeBlob,
  });
  await assert.rejects(
    () => clipboard.readFiles(),
    /当前页面策略禁止主动读取剪贴板，请使用系统粘贴快捷键/,
  );
});
