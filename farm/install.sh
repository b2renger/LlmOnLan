#!/usr/bin/env bash
# One-command farm bootstrap (macOS/Linux).
#   ./install.sh
# Installs the CLI's Node deps, then runs `lol install` (Ollama + LiteLLM + models).
set -euo pipefail
cd "$(dirname "$0")"
echo "== installing CLI dependencies =="
npm install
echo "== bootstrapping the farm (Ollama + LiteLLM + models) =="
node bin/lol.js install
