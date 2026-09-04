import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outputRoot = fileURLToPath(new URL("../build/runtime/static/", import.meta.url));
const requiredFiles = [
  "index.html",
  ".vite/manifest.json",
  "app/bootstrap/legacy_service_worker_retirement.js",
  "ghostty-web.LICENSE",
];

const files = (await readdir(outputRoot, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(outputRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
  .sort();

for (const relativePath of requiredFiles) {
  if (!files.includes(relativePath)) {
    throw new Error(`Vite runtime is missing ${relativePath}`);
  }
}

const javascriptFiles = files.filter((relativePath) => relativePath.endsWith(".js"));
if (javascriptFiles.length > 8) {
  throw new Error(`Vite runtime contains ${javascriptFiles.length} JavaScript files, budget is 8`);
}
if (files.includes("global-runtime.js") || files.some((relativePath) => relativePath.startsWith("workspace/"))) {
  throw new Error("Vite runtime contains unbundled WebShell source modules");
}
if (!files.some((relativePath) => relativePath.endsWith(".wasm"))) {
  throw new Error("Vite runtime is missing the Ghostty WASM asset");
}

const indexHTML = await readFile(path.join(outputRoot, "index.html"), "utf8");
if (!indexHTML.includes("__LCMD_ASSET_BASE__assets/")) {
  throw new Error("Vite index is missing the runtime asset base placeholder");
}
if (indexHTML.includes('src="./assets/') || indexHTML.includes('href="./assets/')) {
  throw new Error("Vite index contains an asset URL outside the versioned runtime base");
}

const manifest = JSON.parse(await readFile(path.join(outputRoot, ".vite/manifest.json"), "utf8"));
const entryFiles = Object.values(manifest).filter((item) => item?.isEntry).map((item) => item.file);
if (entryFiles.length === 0 || entryFiles.some((file) => !javascriptFiles.includes(file))) {
  throw new Error(`Vite manifest has invalid entry files: ${JSON.stringify(entryFiles)}`);
}

process.stdout.write(
  `Verified Vite runtime: ${javascriptFiles.length} JavaScript files, ${files.length} files total\n`,
);
