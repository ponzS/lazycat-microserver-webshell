#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
GHOSTTY_WEB_DIR="${GHOSTTY_WEB_DIR:-${REPO_DIR}/../ghostty-web}"
STATIC_DIR="${REPO_DIR}/runtime/static"

usage() {
  cat <<'EOF'
用法:
  ./tools/sync-ghostty-web-assets.sh --check
  ./tools/sync-ghostty-web-assets.sh --sync
  ./tools/sync-ghostty-web-assets.sh --rebuild-wasm

说明:
  --check         校验可用的 Ghostty 源 WASM 与 WebShell 随包 WASM。
  --sync          构建 Ghostty Web JavaScript，并同步 JS、现有 WASM 和许可证。
  --rebuild-wasm  重建 WASM 和 JavaScript，再同步全部运行时资产。

可选环境变量:
  GHOSTTY_WEB_DIR 指向 ghostty-web 源码目录；源码不可用时 --check 仍验证随包 WASM 格式。
EOF
}

mode="${1:---check}"
if [[ $# -gt 1 ]]; then
  usage >&2
  exit 1
fi
case "$mode" in
  --check|--sync|--rebuild-wasm)
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "未知参数: ${mode}" >&2
    usage >&2
    exit 1
    ;;
esac

source_wasm="${GHOSTTY_WEB_DIR}/ghostty-vt.wasm"
runtime_wasm="${STATIC_DIR}/ghostty-vt.wasm"
if [[ ! -f "$runtime_wasm" ]]; then
  echo "缺少 WebShell WASM: ${runtime_wasm}" >&2
  exit 1
fi

if [[ "$(od -An -tx1 -N4 "$runtime_wasm" | tr -d ' \n')" != "0061736d" ]]; then
  echo "WebShell WASM 文件头无效: ${runtime_wasm}" >&2
  exit 1
fi

sha256_file() {
  sha256sum "$1" | awk '{ print $1; exit }'
}

check_wasm() {
  local runtime_hash
  runtime_hash="$(sha256_file "$runtime_wasm")"
  if [[ -f "$source_wasm" ]]; then
    local source_hash
    source_hash="$(sha256_file "$source_wasm")"
    if [[ "$source_hash" != "$runtime_hash" ]]; then
      echo "Ghostty WASM 未同步" >&2
      echo "源码资产: ${source_hash}  ${source_wasm}" >&2
      echo "WebShell: ${runtime_hash}  ${runtime_wasm}" >&2
      echo "请执行 ./tools/sync-ghostty-web-assets.sh --sync；若 ABI/patch 已变化则使用 --rebuild-wasm。" >&2
      return 1
    fi
    echo "Ghostty WASM SHA256: ${runtime_hash}"
  else
    echo "Ghostty 源码目录不可用，仅验证随包 WASM: ${runtime_hash}"
  fi
}

if [[ "$mode" == "--check" ]]; then
  check_wasm
  exit 0
fi

if [[ ! -d "$GHOSTTY_WEB_DIR" ]]; then
  echo "找不到 Ghostty Web 源码目录: ${GHOSTTY_WEB_DIR}" >&2
  exit 1
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "同步 Ghostty Web 资产需要 bun" >&2
  exit 1
fi

if [[ "$mode" == "--rebuild-wasm" ]]; then
  (cd "$GHOSTTY_WEB_DIR" && bun run build)
else
  (cd "$GHOSTTY_WEB_DIR" && bun run build:lib)
fi

source_js="${GHOSTTY_WEB_DIR}/dist/ghostty-web.js"
if [[ ! -f "$source_js" ]]; then
  echo "Ghostty Web 构建未生成 ${source_js}" >&2
  exit 1
fi

cp "$source_js" "${STATIC_DIR}/ghostty-web.js"
cp "$source_wasm" "$runtime_wasm"
cp "${GHOSTTY_WEB_DIR}/LICENSE" "${STATIC_DIR}/ghostty-web.LICENSE"
check_wasm
echo "Ghostty Web JS SHA256: $(sha256_file "${STATIC_DIR}/ghostty-web.js")"
echo "Ghostty Web 运行时资产已同步。"
