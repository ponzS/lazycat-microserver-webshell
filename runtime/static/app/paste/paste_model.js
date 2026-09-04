const normalizeFiles = (files) => Array.from(files || []).filter((file) => (
  file && typeof file === "object" && Number.isFinite(Number(file.size))
));

export function nativePasteFiles(clipboardData) {
  const itemFiles = [];
  for (const item of Array.from(clipboardData?.items || [])) {
    if (String(item?.kind || "").toLowerCase() !== "file" || typeof item?.getAsFile !== "function") {
      continue;
    }
    const file = item.getAsFile();
    if (file) itemFiles.push(file);
  }
  return itemFiles.length > 0 ? normalizeFiles(itemFiles) : normalizeFiles(clipboardData?.files);
}

export function nativePasteText(clipboardData) {
  if (typeof clipboardData?.getData !== "function") return "";
  return String(clipboardData.getData("text/plain") || clipboardData.getData("text") || "");
}

const quotePOSIXShellArgument = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;

export function formatPastedAttachmentPaths(paths) {
  return Array.from(paths || [])
    .map((path) => String(path || "").trim())
    .filter((path) => path && !/[\r\n]/.test(path))
    .map(quotePOSIXShellArgument)
    .join(" ");
}
