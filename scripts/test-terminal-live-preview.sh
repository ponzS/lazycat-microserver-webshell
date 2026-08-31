#!/usr/bin/env bash
set -euo pipefail

node --check runtime/static/main.js
node --check runtime/static/terminal/history/terminal_cache_v2.js
node --test tests/terminal_cache_v2_test.mjs
node --test tests/terminal_overview_preview_test.mjs
go test ./... -count=1 -run 'TestRuntimeContainerCacheV2AndPWAContract'
go test ./... -count=1 -run 'TestRuntimeTerminalCanvasResidueGuard'
git diff --check
