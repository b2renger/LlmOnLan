#!/bin/bash
# Tonight's trial weights, one after the other, into a scratch folder (never production's ~/lol-vllm or ~/lol-vllm-033/hf),
# each file then checked against Hugging Face's own sha256 (the school's network corrupted a 16 GB file on 2026-11-10).
set -u
BIN="$HOME/lol-vllm-033/.venv/bin"
DEST="$HOME/lol-models-scratch"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DEST"
HF="$BIN/hf"; [ -x "$HF" ] || HF="$BIN/huggingface-cli"
dl() {
  local repo="$1" name="$2"
  echo "[dl] $(date +%H:%M) start $repo -> $DEST/$name"
  if ! "$HF" download "$repo" --local-dir "$DEST/$name" > "$DEST/$name.log" 2>&1; then
    echo "[dl] $(date +%H:%M) FAILED $repo"; tail -5 "$DEST/$name.log"; return 1
  fi
  echo "[dl] $(date +%H:%M) downloaded $repo ($(du -sh "$DEST/$name" | cut -f1))"
  "$BIN/python" "$HERE/verify_sha.py" "$repo" "$DEST/$name"
}
if [ $# -ge 2 ]; then dl "$1" "$2"   # download_verify.sh <repo> <folder name>
else
  dl nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4 nemotron35-super-vl-nvfp4
  dl Aleph-Alpha/Kolibri-1 kolibri1-fp8
fi
echo "[dl] $(date +%H:%M) all done"
