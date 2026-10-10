#!/bin/bash
# Install vLLM into its own venv and download a model, for serve.sh. Idempotent: run it again to resume a download
# or repair the venv. Never touches any other venv. The farm's panel runs it (Install vLLM, Download); by hand:
#
#   bash install.sh [hf repo id] [folder]   (Windows: wsl -d Ubuntu -- bash /mnt/c/<path to the repo>/farm/vllm/install.sh)
#
# Default repo: nvidia/Qwen3.6-35B-A3B-NVFP4 (~23.5 GB) -> $LOL_VLLM_ROOT/hf/<folder, default the repo's name>.
# Needs: an NVIDIA driver (on Windows, the Windows driver is enough: WSL2 gets the GPU through it), x86_64 or
# arm64 Linux, and curl. It installs uv (https://docs.astral.sh/uv/) in ~/.local/bin when missing, and uv brings
# its own Python. Env: LOL_VLLM_ROOT (default ~/lol-vllm), LOL_VLLM_VERSION (default 0.30.0, the version measured
# in docs/spike/RESULTS.md), LOL_VLLM_STEPS (default "venv,model"; "model" only downloads and never touches the venv).
#
# For the farm, which reads this script's output: "[lol-step] uv|venv|vllm|cuda-pins|check|model <repo>|done"
# before each step, and "[lol-error] gated|notfound|disk|network|noinstall <text>" when the download fails (noinstall:
# a download asked of a root with no vLLM, whose `hf` it uses). It runs as its
# own process group, recorded in $LOL_VLLM_ROOT/run/install.pgid: `stop.sh install` stops it, download included.
set -euo pipefail
VER="${LOL_VLLM_VERSION:-0.30.0}"
REPO="${1:-nvidia/Qwen3.6-35B-A3B-NVFP4}"
FOLDER="${2:-${REPO##*/}}"
ROOT="${LOL_VLLM_ROOT:-$HOME/lol-vllm}"; ROOT="${ROOT/#\~/$HOME}"
STEPS=",${LOL_VLLM_STEPS:-venv,model},"
export UV_PYTHON_PREFERENCE=only-managed   # uv's own Python 3.12, never the system's
# A .venv that is a symbolic link belongs to another install (a test root borrowing a serving one): installing
# into it would change the packages under a running server.
if [[ "$STEPS" == *,venv,* ]] && [ -L "$ROOT/.venv" ]; then
  echo "$ROOT/.venv is a link to another install: refusing to install into it (only LOL_VLLM_STEPS=model works here)."; exit 1
fi
if [ "$(ps -o pgid= -p $$ | tr -d ' ')" != "$$" ]; then
  exec setsid --wait bash "$0" "$@"   # become a process-group leader, so `stop.sh install` stops it all
fi
mkdir -p "$ROOT/hf" "$ROOT/run" "$ROOT/logs"
G=$(cat "$ROOT/run/install.pgid" 2>/dev/null || true)
# Ours only when that leader is an install.sh into this root (its LOL_VLLM_ROOT): a file left by a reboot can name
# another root's install.
rootof() { local r; [ -r "/proc/$1/environ" ] || return 0; r=$(tr '\0' '\n' < "/proc/$1/environ" | sed -n 's/^LOL_VLLM_ROOT=//p' | head -1); r="${r:-$HOME/lol-vllm}"; r="${r/#\~/$HOME}"; echo "${r%/}"; }
if [ -n "$G" ] && [ "$G" != "$$" ] && grep -qa 'install\.sh' "/proc/$G/cmdline" 2>/dev/null && [ "$(rootof "$G")" = "${ROOT%/}" ]; then
  echo "An install into $ROOT is already running (process group $G)."; exit 1
fi
echo "$$" > "$ROOT/run/install.pgid"
trap 'rm -f "$ROOT/run/install.pgid"' EXIT
PY="$ROOT/.venv/bin/python"

if [[ "$STEPS" == *,venv,* ]]; then
  UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
  if [ ! -x "$UV" ]; then
    echo "[lol-step] uv"
    curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh   # user-local, no sudo
    UV="$HOME/.local/bin/uv"
  fi
  echo "[lol-step] venv"
  [ -x "$PY" ] || "$UV" venv "$ROOT/.venv" --python 3.12 --seed
  echo "[lol-step] vllm"
  # --torch-backend=auto picks the torch wheel that matches the installed driver (uv >= 0.8).
  # [audio]: the extras vLLM reads sound with (Gemma 4 12B and Qwen3-Omni hear audio in a chat message, and
  # Qwen3-Omni answers /v1/audio/transcriptions); without them a request with sound fails.
  "$UV" pip install --python "$PY" "vllm[audio]==$VER" --torch-backend=auto
  "$UV" pip install --python "$PY" "huggingface_hub[hf_xet]"
  echo "[lol-step] cuda-pins"
  # FlashInfer JIT-compiles kernels with the pip CUDA toolkit. vLLM 0.30.0 resolved nvidia-cuda-nvcc 13.4 next to the
  # 13.2 runtime headers ("CUDA compiler and CUDA toolkit headers are incompatible"), and a 13.4 cicc (nvidia-nvvm)
  # emits PTX that a 13.2 ptxas refuses. Pin all three to the runtime torch was built for.
  RT=$("$PY" -c "import importlib.metadata as m; v=m.version('nvidia-cuda-runtime').split('.'); print(v[0]+'.'+v[1])" 2>/dev/null || true)
  [ -n "$RT" ] && "$UV" pip install --python "$PY" "nvidia-cuda-nvcc==$RT.*" "nvidia-cuda-crt==$RT.*" "nvidia-nvvm==$RT.*"
  echo "[lol-step] check"
  "$PY" - <<'PY'
import torch, vllm, platform
print("vllm", vllm.__version__, "| torch", torch.__version__, "cuda", torch.version.cuda, "| python", platform.python_version(), platform.machine())
print("gpu", torch.cuda.get_device_name(0), "cap", torch.cuda.get_device_capability(0))
PY
fi

if [[ "$STEPS" == *,model,* ]]; then
  echo "[lol-step] model $REPO"
  [ -x "$ROOT/.venv/bin/hf" ] || { echo "[lol-error] noinstall vLLM is not installed in $ROOT yet (no hf command)."; exit 1; }
  OUT="$ROOT/logs/download.last"
  set +e
  "$ROOT/.venv/bin/hf" download "$REPO" --local-dir "$ROOT/hf/$FOLDER" --exclude "*.png" --exclude ".eval_results/*" 2>&1 | tee "$OUT"
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" != 0 ]; then
    last=$(tr '\r' '\n' < "$OUT" | grep -v '^\s*$' | tail -n 1 | cut -c1-300 || true)
    if grep -qiE '\b(401|403)\b|gated' "$OUT"; then kind=gated
    elif grep -qE '\b404\b|Repository Not Found|RepositoryNotFound' "$OUT"; then kind=notfound
    elif grep -qi 'No space left' "$OUT"; then kind=disk
    else kind=network; fi
    echo "[lol-error] $kind $last"; exit "$rc"
  fi
  # hf (huggingface_hub 1.33) writes each file to a temporary file of its own attempt, removed only when that attempt
  # ends by itself. A stopped download (stop.sh install) leaves its file, which no later attempt reuses: status.sh would
  # call the model partly downloaded forever, and it holds the disk. Every file is complete here.
  find "$ROOT/hf/$FOLDER" -name '*.incomplete' -delete 2>/dev/null || true
  # A model whose chat template is only its processor's (chat_template.json: Qwen3-Omni) gets it as
  # chat_template.jinja too, which the tokenizer reads: vLLM uses the processor's template except for a request with
  # tools, and then the tokenizer has none ("default chat template is no longer allowed", a 400 on every tool call).
  "$PY" - "$ROOT/hf/$FOLDER" <<'PY' || true   # a fix, never a reason to fail a finished download
import json, os, sys
d = sys.argv[1]
src, dst, tok = (os.path.join(d, f) for f in ("chat_template.json", "chat_template.jinja", "tokenizer_config.json"))
if os.path.exists(src) and not os.path.exists(dst) and not (os.path.exists(tok) and json.load(open(tok)).get("chat_template")):
    with open(dst, "w") as f:
        f.write(json.load(open(src))["chat_template"])
    print("wrote chat_template.jinja from chat_template.json")
PY
fi
echo "[lol-step] done"
echo "Installed. Start it with: bash $(cd "$(dirname "$0")" && pwd)/serve.sh   (weights: $ROOT/hf/$FOLDER)"
