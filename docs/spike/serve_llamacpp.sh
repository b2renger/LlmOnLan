#!/bin/bash
# Linux twin of serve_llamacpp.ps1 (DGX Spark): start the farm's own llama-server (b10670) with the farm's argv
# (farm/src/llamacpp.js argsFor), in its own process group, logging to a file. Stop it with stop_llamacpp.sh.
#
#   serve_llamacpp.sh <gguf> <parallel> <ctx> <log> [kv_type] [extra llama-server args...]
set -u
MODEL="$1"; PAR="$2"; CTX="$3"; LOG="$4"; KV="${5:-q8_0}"; shift 5 2>/dev/null || shift $#
ROOT="${LOL_SPIKE_ROOT:-$HOME/lol-spike}"
BIN="${LLAMA_BIN:-$HOME/.config/LlmOnLan Farm/farm/.llamacpp/bin/llama-server}"
ALIAS="${ALIAS:-assistant}"
mkdir -p "$ROOT/run" "$(dirname "$LOG")"
ARGS=(--model "$MODEL" --alias "$ALIAS" --host 127.0.0.1 --port 8190 --ctx-size "$CTX" --n-gpu-layers 999
      --parallel "$PAR" --jinja --no-webui --metrics -fa 1 --cache-type-k "$KV" --cache-type-v "$KV"
      --cache-reuse 256 --cache-ram 24576 --kv-unified --slot-prompt-similarity 0.4 "$@")
echo "[serve_llamacpp] $(date -Is) $BIN ${ARGS[*]}" > "$LOG.cmd"
LD_LIBRARY_PATH="$(dirname "$BIN"):${LD_LIBRARY_PATH:-}" setsid "$BIN" "${ARGS[@]}" > "$LOG.out" 2> "$LOG" < /dev/null &
echo $! > "$ROOT/run/llama.pid"
echo "[serve_llamacpp] pid $!"
