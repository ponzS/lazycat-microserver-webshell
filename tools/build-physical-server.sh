#!/bin/sh
set -eu
SCRIPT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT=${1:?output executable path required}
cd "$SCRIPT_ROOT/physicalserver"
GOTOOLCHAIN=go1.26.8 CGO_ENABLED=0 GOOS=linux GOARCH=amd64 "${PTY_SERVER_GO:-go}" build -buildvcs=false -trimpath -o "$OUTPUT" .
