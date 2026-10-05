#!/bin/bash
# Install vLLM into its own venv and download the default model, for serve.sh. Idempotent: run it again to resume a
# download or repair the venv. Never touches any other venv.
#
#   bash install.sh [hf repo id]       (Windows: wsl -d Ubuntu -- bash /mnt/c/<path to the repo>/farm/vllm/install.sh)
#
# Default repo: nvidia/Qwen3.6-35B-A3B-NVFP4 (~23.5 GB) -> $LOL_VLLM_ROOT/hf/Qwen3.6-35B-A3B-NVFP4.
# Needs: an NVIDIA driver (on Windows, the Windows driver is enough: WSL2 gets the GPU through it), x86_64 or
# arm64 Linux, and uv (https://docs.astral.sh/uv/). Env: LOL_VLLM_ROOT (default ~/lol-vllm), LOL_VLLM_VERSION
# (default 0.30.0, the version measured in docs/spike/RESULTS.md).
set -euo pipefail
VER="${LOL_VLLM_VERSION:-0.30.0}"
REPO="${1:-nvidia/Qwen3.6-35B-A3B-NVFP4}"
ROOT="${LOL_VLLM_ROOT:-$HOME/lol-vllm}"
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
[ -x "$UV" ] || { echo "uv is missing. Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
mkdir -p "$ROOT/hf"
[ -x "$ROOT/.venv/bin/python" ] || "$UV" venv "$ROOT/.venv" --python 3.12 --seed
PY="$ROOT/.venv/bin/python"
# --torch-backend=auto picks the torch wheel that matches the installed driver (uv >= 0.8).
"$UV" pip install --python "$PY" "vllm==$VER" --torch-backend=auto
"$UV" pip install --python "$PY" "huggingface_hub[hf_xet]"
# FlashInfer JIT-compiles kernels with the pip CUDA toolkit. vLLM 0.30.0 resolved nvidia-cuda-nvcc 13.4 next to the
# 13.2 runtime headers ("CUDA compiler and CUDA toolkit headers are incompatible"), and a 13.4 cicc (nvidia-nvvm)
# emits PTX that a 13.2 ptxas refuses. Pin all three to the runtime torch was built for.
RT=$("$PY" -c "import importlib.metadata as m; v=m.version('nvidia-cuda-runtime').split('.'); print(v[0]+'.'+v[1])" 2>/dev/null || true)
[ -n "$RT" ] && "$UV" pip install --python "$PY" "nvidia-cuda-nvcc==$RT.*" "nvidia-cuda-crt==$RT.*" "nvidia-nvvm==$RT.*"
"$PY" - <<'PY'
import torch, vllm, platform
print("vllm", vllm.__version__, "| torch", torch.__version__, "cuda", torch.version.cuda, "| python", platform.python_version(), platform.machine())
print("gpu", torch.cuda.get_device_name(0), "cap", torch.cuda.get_device_capability(0))
PY
"$ROOT/.venv/bin/hf" download "$REPO" --local-dir "$ROOT/hf/${REPO##*/}" --exclude "*.png" --exclude ".eval_results/*"
echo "Installed. Start it with: bash $(cd "$(dirname "$0")" && pwd)/serve.sh   (weights: $ROOT/hf/${REPO##*/})"
