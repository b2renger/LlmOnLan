#!/bin/bash
# A trial vLLM from the NIGHTLY wheels, in a root of its own, then one checkpoint (2026-11-23, for Inkling 2 Mini:
# its model is in vLLM main only, "Use the vllm/vllm-openai:nightly image or a nightly wheel until it is in a vLLM
# release", recipes.vllm.ai/thinkingmachines/Inkling-2-Mini). The steps of farm/vllm/install.sh, the nightly index in
# place of the pinned version. Never production's root.
#   LOL_VLLM_ROOT=~/lol-vllm-nightly nightly_root.sh <hf repo> [folder]
# Serve it with trial_serve.sh (LOL_VLLM_ROOT set the same). Remove it with rm -rf on the root: nothing else uses it.
set -euo pipefail
ROOT="${LOL_VLLM_ROOT:-$HOME/lol-vllm-nightly}"; ROOT="${ROOT/#\~/$HOME}"
[ "${ROOT%/}" != "$HOME/lol-vllm" ] || { echo "Refused: that is production's root."; exit 1; }
REPO="$1"; FOLDER="${2:-${REPO##*/}}"
mkdir -p "$ROOT/hf" "$ROOT/logs" "$ROOT/run"
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
[ -x "$UV" ] || { curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh; UV="$HOME/.local/bin/uv"; }
PY="$ROOT/.venv/bin/python"
if [ ! -x "$ROOT/.venv/bin/vllm" ]; then
  echo "[nightly] venv"
  [ -x "$PY" ] || "$UV" venv "$ROOT/.venv" --python 3.12 --seed --relocatable
  echo "[nightly] vllm (nightly wheels)"
  "$UV" pip install --python "$PY" --pre "vllm[audio]" --torch-backend=auto --extra-index-url https://wheels.vllm.ai/nightly
  "$UV" pip install --python "$PY" "huggingface_hub[hf_xet]"
  RT=$("$PY" -c "import importlib.metadata as m; v=m.version('nvidia-cuda-runtime').split('.'); print(v[0]+'.'+v[1])" 2>/dev/null || true)
  [ -n "$RT" ] && "$UV" pip install --python "$PY" "nvidia-cuda-nvcc==$RT.*" "nvidia-cuda-crt==$RT.*" "nvidia-nvvm==$RT.*"
fi
"$PY" - <<'PY'
import torch, vllm, platform
print("[nightly] vllm", vllm.__version__, "| torch", torch.__version__, "cuda", torch.version.cuda, "| python", platform.python_version())
print("[nightly] gpu", torch.cuda.get_device_name(0), "cap", torch.cuda.get_device_capability(0))
PY
echo "[nightly] model $REPO"
"$ROOT/.venv/bin/hf" download "$REPO" --local-dir "$ROOT/hf/$FOLDER" 2>&1 | tail -3
du -sh "$ROOT" "$ROOT/hf/$FOLDER"
echo "[nightly] done"
