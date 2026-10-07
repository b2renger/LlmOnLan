#!/bin/bash
# Serve a model with vLLM as a LlmOnLan farm's `external` engine. Operator-run: the farm routes to it and reads
# its /metrics, but never starts or stops it (farm/README.md, "Serving with vLLM on Windows (WSL2)" and "on Linux").
# Keep it in the foreground of a window that stays open:
#
#   wsl -d Ubuntu -- bash /mnt/c/<path to the repo>/farm/vllm/serve.sh [extra vllm serve args...]   (Windows)
#   bash farm/vllm/serve.sh [extra vllm serve args...]                                             (Linux)
#
# It serves http://127.0.0.1:$LOL_VLLM_PORT/v1 through relay.py, while vLLM itself listens on a Unix socket: under
# WSL2's mirrored networking vLLM's own TCP port never answers (relay.py says why). Defaults: the Qwen3.6-35B-A3B
# NVFP4 checkpoint install.sh downloads, a 64k window, up to 128 requests at once, a 50 GiB KV pool sized for
# a 96 GB card that also holds the farm's OCR model, and replies of at most 32,768 tokens, whatever a request asks.
# Extra args go after the defaults, and a repeated flag keeps its last value, so
# `serve.sh --kv-cache-memory-bytes 40000000000` overrides the pool.
#
# Stop it with Ctrl+C, by closing the window, or with `bash stop.sh`. When stdin closes (the window or wsl.exe
# goes away), a watchdog stops the whole process group: vLLM, its EngineCore and the relay. Killing wsl.exe
# alone leaves Linux processes running.
#
# Started by the system instead (lol-vllm.service, start-windows.ps1), stdin is /dev/null or a console nobody
# types in: LOL_VLLM_DAEMON=1 drops the watchdog and the copy of the log on stdout. A SIGTERM to the process group
# (systemctl stop) or stop.sh then stops it, and it exits 143.
#
# Env: LOL_VLLM_ROOT (default ~/lol-vllm: venv, weights, logs), LOL_VLLM_PORT (8100), LOL_VLLM_MODEL (a checkpoint
# folder or a Hugging Face repo id), LOL_VLLM_DAEMON (1 = no watchdog), LOL_VLLM_MIN_FREE_GB (unset = off: the
# memory guard for a box whose GPU shares the system memory, the DGX Spark; when MemAvailable falls under this many
# GB, it stops vLLM and exits 3). Log: $LOL_VLLM_ROOT/logs/vllm.log.
set -u
{   # parsed whole before it runs, so saving this file in place (an editor, cp) under a running server changes nothing
ROOT="${LOL_VLLM_ROOT:-$HOME/lol-vllm}"
PORT="${LOL_VLLM_PORT:-8100}"
MODEL="${LOL_VLLM_MODEL:-$ROOT/hf/Qwen3.6-35B-A3B-NVFP4}"
DAEMON="${LOL_VLLM_DAEMON:-0}"
MIN_FREE="${LOL_VLLM_MIN_FREE_GB:-}"
case "$MIN_FREE" in *[!0-9]*) echo "LOL_VLLM_MIN_FREE_GB must be a whole number of GB, not '$MIN_FREE'."; exit 1;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$(ps -o pgid= -p $$ | tr -d ' ')" != "$$" ]; then
  exec setsid --wait bash "$0" "$@"   # become a process-group leader, so stopping the group is exact
fi
PGID=$$
[ -x "$ROOT/.venv/bin/vllm" ] || { echo "No vLLM in $ROOT/.venv: run install.sh first, or set LOL_VLLM_ROOT."; exit 1; }
mkdir -p "$ROOT/logs" "$ROOT/run"
LOG="$ROOT/logs/vllm.log"
SOCK="$ROOT/run/vllm.sock"
PGF="$ROOT/run/vllm.pgid"
GUARDF="$ROOT/run/vllm.guard"   # the memory guard stopped this run
if [ -f "$PGF" ] && pgrep -g "$(cat "$PGF")" >/dev/null 2>&1; then
  echo "A server from $ROOT is already running (process group $(cat "$PGF")): stop it first with stop.sh."; exit 1
fi
echo "$PGID" > "$PGF"
rm -f "$SOCK" "$GUARDF"   # a socket file left by the last server makes the next bind fail (EADDRINUSE)
{
  echo "[serve] $(date -Is) host=$(hostname) pgid=$PGID port=$PORT model=$MODEL daemon=$DAEMON min_free_gb=${MIN_FREE:-off}"
  echo "[serve] GPU before start: $(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null | head -1)"
} | tee -a "$LOG"

WATCHDOG=
if [ "$DAEMON" != 1 ]; then
  exec 3<&0
  (
    trap '' INT TERM HUP
    while read -r -u 3 _; do :; done
    echo "[watchdog] $(date -Is) stdin closed: stopping process group $PGID" >> "$LOG"
    kill -TERM -- "-$PGID" 2>/dev/null
    sleep 30
    kill -KILL -- "-$PGID" 2>/dev/null
  ) &
  WATCHDOG=$!
fi

# FlashInfer JIT-compiles kernels at first use (sm_120): it needs the venv's ninja and the pip CUDA toolkit's nvcc
# on PATH, CUDA_HOME, and unversioned library names to link against (the pip toolkit ships only libcudart.so.13,
# and the driver's libcuda.so lives in /usr/lib/wsl/lib on WSL). install.sh pins nvcc/crt/nvvm to the runtime.
export PATH="$ROOT/.venv/bin:$PATH"
CU=$(ls -d "$ROOT"/.venv/lib/python3*/site-packages/nvidia/cu1[0-9] 2>/dev/null | tail -1)
SHIM="$ROOT/cudalib"; mkdir -p "$SHIM"
if [ -n "$CU" ] && [ -x "$CU/bin/nvcc" ]; then
  export CUDA_HOME="$CU" PATH="$CU/bin:$PATH"
  for so in "$CU"/lib/lib*.so.[0-9]*; do b=$(basename "$so"); ln -sf "$so" "$SHIM/${b%%.so.*}.so"; done
fi
DRV_SO=$(ls /usr/lib/wsl/lib/libcuda.so.1 2>/dev/null || ldconfig -p | awk '/libcuda.so.1 /{print $NF; exit}')
[ -n "$DRV_SO" ] && ln -sf "$DRV_SO" "$SHIM/libcuda.so"
export FLASHINFER_EXTRA_LDFLAGS="-L$SHIM"
[ -d "$MODEL" ] && export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"   # local weights: never ask huggingface.co

"$ROOT/.venv/bin/python" "$HERE/relay.py" 127.0.0.1 "$PORT" "$SOCK" >> "$LOG" 2>&1 < /dev/null 3<&- &
RELAY=$!
sleep 1
if ! kill -0 "$RELAY" 2>/dev/null; then
  echo "The relay could not listen on 127.0.0.1:$PORT (is the port in use?). See $LOG."
  kill -KILL "$WATCHDOG" 2>/dev/null; rm -f "$PGF"; exit 1
fi

ARGS=(
  --uds "$SOCK"
  --served-model-name qwen3.6-35b-a3b
  --max-model-len 65536
  --max-num-seqs 128
  --kv-cache-memory-bytes 53687091200   # 50 GiB (README: sizing). Never --gpu-memory-utilization: a fraction of
                                        # TOTAL VRAM, and its start-up profiler aborts when Ollama loads beside it
  --kv-cache-dtype fp8
  --enable-prefix-caching --mamba-cache-mode align
  --reasoning-parser qwen3
  --enable-auto-tool-choice --tool-call-parser qwen3_xml
  --override-generation-config '{"max_new_tokens": 32768}'   # the farm's proxy.maxReplyTokens (config.js says why),
                                        # a CEILING on vLLM 0.30, not a default: every request gets min(what the window
                                        # leaves, its own max_tokens, this) (entrypoints/serve/utils/api_utils.py
                                        # get_max_tokens), so one asking 40000 gets 32768. First-party callers ask
                                        # 16384 at most. The farm cannot send a default instead (vLLM refuses prompt +
                                        # max_tokens past the window), and proxy.maxReplyTokens does not change this
                                        # number. An --override-generation-config of yours replaces this one: put
                                        # max_new_tokens in it.
)
"$ROOT/.venv/bin/vllm" serve "$MODEL" "${ARGS[@]}" "$@" >> "$LOG" 2>&1 < /dev/null 3<&- &
VLLM=$!
[ "$DAEMON" = 1 ] || { tail -n 0 -f --pid="$VLLM" "$LOG" 3<&- & }
(
  until curl -sf -o /dev/null -m 5 --unix-socket "$SOCK" http://localhost/health; do
    kill -0 "$VLLM" 2>/dev/null || exit
    sleep 3
  done
  echo "[serve] $(date -Is) ready: http://127.0.0.1:$PORT/v1" >> "$LOG"
) 3<&- &
# The memory guard (LOL_VLLM_MIN_FREE_GB). On a DGX Spark the GPU allocates from the system memory, and a
# system-wide out-of-memory there latched the GPU at ~700 MHz until a cold power drain (docs/spike/RESULTS.md, DGX
# Spark). So it stops vLLM while the box still has memory left: it reads MemAvailable every 2 s, as the spike's
# guard did every 10 s, which caught a 30-second climb from 35 to 116 GB at 5 GB free.
if [ -n "$MIN_FREE" ]; then
  (
    trap '' INT TERM HUP
    while sleep 2 && kill -0 "$VLLM" 2>/dev/null; do
      free=$(awk '/^MemAvailable:/{print int($2/1048576)}' /proc/meminfo)
      [ "$free" -ge "$MIN_FREE" ] && continue
      echo "[guard] $(date -Is) ${free} GB of memory available, under LOL_VLLM_MIN_FREE_GB=$MIN_FREE: stopping vLLM" >> "$LOG"
      : > "$GUARDF"
      kill -TERM -- "-$PGID" 2>/dev/null
      sleep 5   # then KILL what is left, all but serve.sh and this guard: memory cannot wait for a slow exit
      for p in $(pgrep -g "$PGID"); do [ "$p" != "$$" ] && [ "$p" != "$BASHPID" ] && kill -KILL "$p" 2>/dev/null; done
      exit
    done
  ) 3<&- &
fi

stop_server() {
  trap '' INT TERM HUP
  echo "[serve] $(date -Is) stopping" >> "$LOG"
  kill -TERM "$VLLM" "$RELAY" 2>/dev/null
  for _ in $(seq 1 30); do kill -0 "$VLLM" 2>/dev/null || break; sleep 1; done
}
trap stop_server INT TERM HUP
wait "$VLLM"; rc=$?
kill -TERM "$RELAY" 2>/dev/null
sleep 1
for p in $(pgrep -g "$PGID"); do [ "$p" != "$$" ] && kill -KILL "$p" 2>/dev/null; done   # EngineCore, watchdog, tail
rm -f "$SOCK" "$PGF"
[ -f "$GUARDF" ] && rc=3   # lol-vllm.service does not restart after this one (RestartPreventExitStatus=3)
msg="[serve] $(date -Is) vLLM exited (status $rc); the relay and the watchdog are stopped."
echo "$msg" >> "$LOG"; echo "$msg" 2>/dev/null   # the log first: the window may already be gone
exit "$rc"
}
