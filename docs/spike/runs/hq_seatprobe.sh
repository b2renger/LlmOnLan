#!/bin/bash
# Seat counts of the HyperQwen evaluation (night n° 10 and 2026-11-19; research/2026-11-19-codeaf-hyperqwen.md): a stock
# configuration started through HyperQwen's log-only kv-cache-seat-budget patch. Needs ~/lol-hq/HyperQwen/venv (hq_batch.sh's
# install). Run in WSL; the GPU must have room for the pool.
#   hq_seatprobe.sh <label> <checkpoint folder> <served name> <context> <pool GiB> [vllm flags...]
set -u
LABEL="$1"; shift
R=$HOME/lol-hq/probe-root; mkdir -p "$R/logs" "$R/run"; [ -e "$R/.venv" ] || ln -s $HOME/lol-hq/HyperQwen/venv "$R/.venv"
: > "$R/logs/vllm.log"
( while :; do sleep 5; echo || exit; done ) | LOL_VLLM_ROOT=$R LOL_VLLM_PORT=8192 bash /mnt/c/Users/ateliernum/Documents/code/LlmOnLan/docs/spike/runs/trial_serve.sh "$@" > /dev/null 2>&1 &
for i in $(seq 1 120); do grep -q "seat budget" "$R/logs/vllm.log" && break; grep -qa "Traceback\|exited" "$R/logs/vllm.log" && break; sleep 5; done
echo "[$LABEL] $(grep -aE "GPU KV cache size" "$R/logs/vllm.log" | sed 's/^.*\] //' | head -1)"
echo "[$LABEL] $(grep -a "seat budget" "$R/logs/vllm.log" | sed 's/^.*\] //' | head -1)"
grep -a "Traceback" -A3 "$R/logs/vllm.log" | head -5
LOL_VLLM_ROOT=$R bash /mnt/c/Users/ateliernum/Documents/code/LlmOnLan/farm/vllm/stop.sh > /dev/null 2>&1; sleep 3
