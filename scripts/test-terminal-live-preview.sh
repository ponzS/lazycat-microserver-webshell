#!/usr/bin/env bash
set -euo pipefail

node --check runtime/static/main.js
node --check runtime/static/terminal_cache_v2.js
node --test terminal_cache_v2_test.mjs
go test ./... -count=1 -run 'TestRuntimeContainerCacheV2AndPWAContract'
git diff --check
