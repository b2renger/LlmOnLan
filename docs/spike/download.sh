#!/bin/bash
# Download the spike's checkpoints into ~/lol-spike/hf/<name>, one after the other, timing each.
#   bash download.sh [repo ...]     default: the three short-listed NVFP4 checkpoints
set -uo pipefail
ROOT="${LOL_SPIKE_ROOT:-$HOME/lol-spike}"
UVX="$(command -v uvx || echo "$HOME/.local/bin/uvx")"
mkdir -p "$ROOT/hf"
REPOS=("$@")
[ ${#REPOS[@]} -eq 0 ] && REPOS=(
  nvidia/Qwen3.6-35B-A3B-NVFP4
  nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4
  nvidia/Qwen3.8-27B-NVFP4
)
for r in "${REPOS[@]}"; do
  name="${r##*/}"
  t0=$(date +%s)
  echo "[$(date -Is)] start $r"
  "$UVX" --from "huggingface_hub[hf_xet]" hf download "$r" --local-dir "$ROOT/hf/$name" --exclude "*.png" --exclude ".eval_results/*"
  rc=$?
  t1=$(date +%s)
  echo "[$(date -Is)] done $r rc=$rc seconds=$((t1-t0)) size=$(du -sh "$ROOT/hf/$name" | cut -f1)"
done
