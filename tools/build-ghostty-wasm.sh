#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${GHOSTTY_WEB_DIR:-${repo_dir}/ghostty-web}"
native_dir="${source_dir}/ghostty"
patches=(
  "${source_dir}/patches/ghostty-wasm-api.patch"
  "${source_dir}/patches/ghostty-scrollback-generation.patch"
  "${repo_dir}/tools/ghostty-reflow.patch"
  "${repo_dir}/tools/ghostty-reflow-capacity.patch"
  "${repo_dir}/tools/ghostty-clear-rows-stored-width.patch"
  "${repo_dir}/tools/ghostty-checkpoint.patch"
  "${repo_dir}/tools/ghostty-render-diagnostics.patch"
  "${repo_dir}/tools/ghostty-resize-diagnostics.patch"
  "${repo_dir}/tools/ghostty-write-diagnostics.patch"
  "${repo_dir}/tools/ghostty-allocation-safety.patch"
  "${repo_dir}/tools/ghostty-page-initialization.patch"
)
applied=()

command -v zig >/dev/null
command -v node >/dev/null
zig_version="$(zig version)"
if [[ "$zig_version" != "0.15.2" ]]; then
  printf 'Ghostty WASM requires Zig 0.15.2; found %s\n' "$zig_version" >&2
  exit 1
fi
native_revision="$(git -C "$native_dir" rev-parse HEAD)"
cache_key="$(node --input-type=module - "$zig_version" "$native_revision" "${patches[@]}" <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const [zigVersion, revision, ...patches] = process.argv.slice(2);
const hash = createHash('sha256');
hash.update(JSON.stringify(['webshell-wasm-v1', zigVersion, revision, 'wasm32-freestanding', 'ReleaseSmall']));
for (const patch of patches) {
  const bytes = readFileSync(patch);
  hash.update(`\0${bytes.length}\0`);
  hash.update(bytes);
}
process.stdout.write(hash.digest('hex'));
JS
)"
# The complete WebShell patch set must not share Zig's local compilation cache
# with upstream/API-only builds. The latter can change generated code even when
# the final source contents match. A changed toolchain or patch set starts fresh.
cache_dir="${native_dir}/.zig-cache/webshell/${cache_key}"
# Keep upstream checkouts untouched after building, including failed builds.
# Keep the shipped optimization mode while applying WebShell's measured fix.
cleanup() {
  local index
  for ((index=${#applied[@]}-1; index>=0; index--)); do
    git -C "$native_dir" apply -R "${applied[index]}"
  done
}
trap cleanup EXIT
for patch in "${patches[@]}"; do
  git -C "$native_dir" apply --check "$patch"
  git -C "$native_dir" apply "$patch"
  applied+=("$patch")
done
(
  cd "$native_dir"
  zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall --cache-dir "$cache_dir"
)
cp "$native_dir/zig-out/bin/ghostty-vt.wasm" "$source_dir/ghostty-vt.wasm"
node "$repo_dir/tools/prepare-checkpoint-wasm.mjs" "$source_dir/ghostty-vt.wasm"
