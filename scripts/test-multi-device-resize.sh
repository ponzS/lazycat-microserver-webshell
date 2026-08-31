#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${repo_dir}"

go test ./... -count=1 -run 'TestTerminalPaneResizeEpochIsMonotonicIdempotentAndOrdered|TestTerminalControlInputCannotPassivelyResizeOwnedPane|TestRuntimeResizeEpochAckGuard|TestRuntimeCrossClientResizeDoesNotAutoReclaim'
node --check runtime/static/main.js
node --test tests/terminal_resize_scheduler_test.mjs
git diff --check
