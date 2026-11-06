#!/bin/bash
# Serve a model on trial through the farm's own serve.sh, from a root that is NOT production's (2026-11-06):
#   trial_serve.sh <checkpoint folder> <served name> <context> <pool GiB> [the model's vLLM flags...]
# Keep a pipe open on stdin, or the watchdog stops the server when the launcher goes. From Git Bash on Windows:
#   ( while :; do sleep 5; echo || exit; done ) | MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/c/.../trial_serve.sh ...
# Stop it with: LOL_VLLM_ROOT=<the root> bash farm/vllm/stop.sh
set -u
ROOT="${LOL_VLLM_ROOT:-$HOME/lol-vllm-033}"
[ "$ROOT" != "$HOME/lol-vllm" ] || { echo "Refused: that is production's root."; exit 1; }
MODEL="$1"; NAME="$2"; CTX="$3"; POOL_GIB="$4"; shift 4
BYTES=$(python3 -c "print(int($POOL_GIB * 2**30))")
ARGS=(--served-model-name "$NAME" --max-model-len "$CTX" --max-num-seqs 192 --kv-cache-memory-bytes "$BYTES" "$@"
      --override-generation-config '{"max_new_tokens":32768}')
export LOL_VLLM_ROOT="$ROOT" LOL_VLLM_PORT="${LOL_VLLM_PORT:-8190}" LOL_VLLM_MODEL="$MODEL"
LOL_VLLM_ARGS_B64=$(printf '%s\0' "${ARGS[@]}" | base64 -w0)
export LOL_VLLM_ARGS_B64
exec bash "$(dirname "$0")/../../../farm/vllm/serve.sh"
