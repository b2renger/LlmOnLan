#!/bin/bash
# Stop the llama-server started by serve_llamacpp.sh (only that pid).
ROOT="${LOL_SPIKE_ROOT:-$HOME/lol-spike}"
F="$ROOT/run/llama.pid"
[ -f "$F" ] || { echo "no $F"; exit 0; }
P=$(cat "$F")
kill -TERM "$P" 2>/dev/null
for i in $(seq 1 30); do kill -0 "$P" 2>/dev/null || break; sleep 1; done
kill -0 "$P" 2>/dev/null && { echo "SIGKILL $P"; kill -KILL "$P"; }
rm -f "$F"
pgrep -af llama-server || echo "no llama-server processes left"
