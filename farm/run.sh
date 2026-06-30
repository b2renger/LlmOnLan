#!/usr/bin/env bash
# One-command farm run (macOS/Linux). Starts the farm in the foreground (Ctrl-C stops).
#   ./run.sh
set -euo pipefail
cd "$(dirname "$0")"
node bin/lol.js up
