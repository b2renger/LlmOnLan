#!/bin/bash
# Install a current vLLM into its OWN venv (~/lol-spike/.venv). Never touches any other venv.
# Works on x86_64 (WSL2 Ubuntu) and linux-arm64 (DGX Spark). Needs `uv` (https://docs.astral.sh/uv/).
#   bash install_vllm.sh [vllm_version]      default: 0.30.0 (current on 2026-10-04)
set -euo pipefail
VER="${1:-0.30.0}"
ROOT="${LOL_SPIKE_ROOT:-$HOME/lol-spike}"
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
mkdir -p "$ROOT"
cd "$ROOT"
if [ ! -x "$ROOT/.venv/bin/python" ]; then
  "$UV" venv "$ROOT/.venv" --python 3.12 --seed
fi
# --torch-backend=auto picks the torch wheel matching the installed driver (uv >= 0.8).
"$UV" pip install --python "$ROOT/.venv/bin/python" "vllm==$VER" --torch-backend=auto
"$UV" pip install --python "$ROOT/.venv/bin/python" aiohttp "huggingface_hub[hf_xet]"
# FlashInfer JIT-compiles kernels with the pip CUDA toolkit. vLLM 0.30.0 resolved nvidia-cuda-nvcc 13.4 next to the
# 13.2 runtime headers, and CCCL refuses that pairing ("CUDA compiler and CUDA toolkit headers are incompatible").
# Match nvcc/crt to the runtime that torch was built for.
RT=$("$ROOT/.venv/bin/python" -c "import importlib.metadata as m; v=m.version('nvidia-cuda-runtime').split('.'); print(v[0]+'.'+v[1])" 2>/dev/null)
if [ -n "$RT" ]; then
  # nvvm too: cicc lives in nvidia-nvvm, and a 13.4 cicc emits PTX 9.4 that a 13.2 ptxas refuses
  # ("Unsupported .version 9.4; current version is '9.2'").
  "$UV" pip install --python "$ROOT/.venv/bin/python" "nvidia-cuda-nvcc==$RT.*" "nvidia-cuda-crt==$RT.*" "nvidia-nvvm==$RT.*"
fi
"$ROOT/.venv/bin/python" - <<'PY'
import torch, vllm, platform
print("vllm", vllm.__version__)
print("torch", torch.__version__, "cuda", torch.version.cuda)
print("python", platform.python_version(), platform.machine())
print("gpu", torch.cuda.get_device_name(0), "cap", torch.cuda.get_device_capability(0))
PY
