#!/usr/bin/env bash
# Build the bundled Open WebUI sidecar (macOS/Linux). Thin wrapper over the
# cross-platform Node script. Needs Node and `tar` (both present on CI runners).
set -euo pipefail
cd "$(dirname "$0")"
exec node build-sidecar.mjs "$@"
