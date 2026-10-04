#!/bin/bash
# Start `vllm serve` for the spike with a stdin-EOF watchdog, so it can never outlive its launcher.
#
#   serve_vllm.sh <run-name> <model path or repo> [vllm serve args...]
#
# Logs to ~/lol-spike/logs/<run-name>.log; the server's process-group id goes to ~/lol-spike/run/vllm.pgid.
# WSL2 (from Windows), keep a pipe open on stdin and wsl.exe in the foreground, e.g. from Git Bash:
#   ( while :; do sleep 5; echo || exit; done ) | MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/c/.../serve_vllm.sh qwen36 ~/lol-spike/hf/Qwen3.6-35B-A3B-NVFP4 --port 8100 ...
# When the launcher dies (pipe closes), the watchdog TERMs then KILLs the whole process group, EngineCore included
# (killing wsl.exe alone does NOT stop Linux processes). On a native Linux box (DGX Spark) the same script works
# from any terminal: `bash serve_vllm.sh ... < <(while :; do sleep 5; echo; done)` or just run it under tmux and
# stop it with stop_vllm.sh.
set -u
ROOT="${LOL_SPIKE_ROOT:-$HOME/lol-spike}"
NAME="$1"; shift
mkdir -p "$ROOT/logs" "$ROOT/run"
LOG="$ROOT/logs/$NAME.log"
PGID=$(ps -o pgid= -p $$ | tr -d ' ')
if [ "$PGID" != "$$" ]; then
  # Not a group leader (e.g. started from an interactive shell): become one so the group kill is exact.
  exec setsid --wait bash "$0" "$NAME" "$@"
fi
echo "$$" > "$ROOT/run/vllm.pgid"
# A --uds socket file left by the previous server makes the next bind fail with EADDRINUSE.
prev=""; for a in "$@"; do [ "$prev" = "--uds" ] && rm -f "$a"; prev="$a"; done
{
  echo "[serve_vllm] $(date -Is) host=$(hostname) pgid=$$"
  echo "[serve_vllm] cmd: vllm serve $*"
} >> "$LOG"
exec 3<&0
(
  trap '' TERM
  while read -r -u 3 _; do :; done
  echo "[watchdog] $(date -Is) stdin closed: stopping process group $PGID" >> "$LOG"
  kill -TERM -- "-$PGID" 2>/dev/null
  sleep 10
  kill -KILL -- "-$PGID" 2>/dev/null
) &
# FlashInfer JIT-compiles kernels at first use: it needs `ninja` (in the venv) and nvcc (the pip CUDA toolkit
# that vLLM pulls in, nvidia/cu13). Without this, the first request dies with FileNotFoundError: 'ninja'.
export PATH="$ROOT/.venv/bin:$PATH"
CU=$(ls -d "$ROOT"/.venv/lib/python3*/site-packages/nvidia/cu1[0-9] 2>/dev/null | tail -1)
if [ -n "$CU" ] && [ -x "$CU/bin/nvcc" ]; then export CUDA_HOME="$CU"; export PATH="$CU/bin:$PATH"; fi
# ...and it links with -L$CUDA_HOME/lib64 -lcudart -lcuda, but the pip toolkit has only lib/libcudart.so.13 and
# the driver's libcuda.so lives elsewhere (WSL: /usr/lib/wsl/lib). Give the linker unversioned names.
SHIM="$ROOT/cudalib"; mkdir -p "$SHIM"
for so in "$CU"/lib/lib*.so.[0-9]*; do   # libcudart, libcublas, libcublasLt, ... (-lcublas etc. for the gemm module)
  [ -e "$so" ] || continue
  b=$(basename "$so"); ln -sf "$so" "$SHIM/${b%%.so.*}.so"
done
DRV_SO=$(ls /usr/lib/wsl/lib/libcuda.so.1 2>/dev/null || ldconfig -p | awk '/libcuda.so.1 /{print $NF; exit}')
[ -n "$DRV_SO" ] && ln -sf "$DRV_SO" "$SHIM/libcuda.so"
export FLASHINFER_EXTRA_LDFLAGS="-L$SHIM"
export VLLM_LOGGING_LEVEL="${VLLM_LOGGING_LEVEL:-INFO}"
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"
exec "$ROOT/.venv/bin/vllm" serve "$@" >> "$LOG" 2>&1 < /dev/null 3<&-
