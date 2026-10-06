#!/bin/bash
# DGX Spark: the whole spike matrix, unattended, one engine at a time (README "Re-run on another box").
#   vLLM: Qwen3.6 -> Nemotron -> Qwen3.8 (vllm_all.sh + --append follow-ups at 32k and 128k), then
#   llama.cpp: Nemotron p16 (suite + follow-ups), Qwen3.8 p8 (suite), Qwen3.8 p16 (chat/agent/chat-off).
# Run runs/spark_guard.sh beside it: it stops the engine if unified memory gets low (a unified-memory OOM wedged
# this box's GPU at 702 MHz on 2026-09-16). If the guard trips, this script stops.
#   spark_matrix.sh [steps...]      default: all steps
set -u
D="$(cd "$(dirname "$0")/.." && pwd)"
R="$D/runs"
HF="$HOME/lol-spike/hf"
LOGS="$HOME/lol-spike/logs"
# FlashInfer JIT-compiles Qwen3.8's native-FP4 CUTLASS kernels at start-up; with one job per core (20) the compilers
# took ~20 GB on top of the KV pool and tripped the guard (2026-10-06 01:03). Four jobs keep start-up in budget.
export MAX_JOBS="${MAX_JOBS:-4}"
KV=62277025792   # the PRO 6000's 58 GiB pool: same KV capacity on both boxes, ~30 GB of unified memory spare
COMMON="--host 127.0.0.1 --port 8100 --max-model-len 131072 --max-num-seqs 192 --kv-cache-memory-bytes $KV --enable-prefix-caching --mamba-cache-mode align --enable-auto-tool-choice"
U=http://127.0.0.1:8100/v1
OLL=/usr/share/ollama/.ollama/models/blobs
NEMO_GGUF=$OLL/sha256-5c19f6282f4fc51cb114cb6c876d70ca2fc3b9cf0fbd0a018d9908f4fe1f63b3
QW38_GGUF=$OLL/sha256-f5f1dd8920d417aac2718b0bda3403da274301efdd6760b4f0f4b864ff2ad57d

say() { echo "[matrix] $(date -Is) $*"; }
tripped() { if ls "$LOGS"/*.tripped >/dev/null 2>&1; then say "guard tripped: stopping"; exit 3; fi; }
baseline() { sleep 5; say "after stop: $(free -g | awk '/^Mem:/{print "used "$3"G avail "$7"G"}'); left: $(pgrep -f 'vllm serve|EngineCore|llama-server' | wc -l) engine processes"; }

vllm_up() {  # <run> <model dir> <args...>
  local run="$1"; shift
  if curl -sf http://127.0.0.1:8100/health >/dev/null; then say "vLLM already up"; return 0; fi
  ( while :; do sleep 5; echo || exit; done ) | bash "$D/serve_vllm.sh" "$run" "$@" &
  for i in $(seq 1 180); do
    curl -sf http://127.0.0.1:8100/health >/dev/null && { say "vLLM $run up"; return 0; }
    grep -qE "EngineCore failed|Engine core initialization failed" "$LOGS/$run.log" 2>/dev/null && break
    tripped; sleep 10
  done
  say "vLLM $run failed to start"; bash "$D/stop_vllm.sh"; return 1
}

vllm_model() {  # <run> <label> <model dir> <served name> <per-model args>
  local run="$1" label="$2" dir="$3" name="$4" extra="$5"
  local cmd="vllm serve $dir --served-model-name $name $COMMON $extra"
  vllm_up "$run" "$dir" --served-model-name "$name" $COMMON $extra || return 1
  cp "$LOGS/$run.log" "$D/results/logs/$run.log"
  "$HOME/lol-spike/.venv/bin/python" "$D/spike_bench.py" kvlog "$D/results/logs/$run.log" --save "$D/results/${label}__kv.json"
  local be; be=$(grep -oE "Using '[A-Z_]+' NvFp4 MoE backend" "$LOGS/$run.log" | head -1)
  local notes="vLLM 0.30.0 (DGX Spark GB10, native, TCP): $cmd; ${be:-no NVFP4 MoE backend line}"
  tripped; bash "$R/vllm_all.sh" "$label" "$notes" "$U"
  tripped; bash "$R/followup_levels.sh" "$label" 30000 4,8,16,32,48,64,96,128 "$U" --append
  tripped; bash "$R/followup_levels.sh" "$label" 120000 2,4,8,16,24,32,40 "$U" --append
  cp "$LOGS/$run.log" "$D/results/logs/$run.log"
  bash "$D/stop_vllm.sh"; baseline; tripped
}

llama_up() {  # <gguf> <parallel> <ctx> <run> <alias>
  ALIAS="$5" bash "$D/serve_llamacpp.sh" "$1" "$2" "$3" "$D/results/logs/$4.log"
  for i in $(seq 1 90); do curl -sf http://127.0.0.1:8190/health >/dev/null && { say "llama $4 up"; return 0; }; tripped; sleep 5; done
  say "llama $4 failed to start"; bash "$D/stop_llamacpp.sh"; return 1
}

LN="DGX Spark GB10, llama-server b10670 linux-cuda-arm64 (the farm's build)"
FARM="--kv-unified -fa 1 -ctk/-ctv q8_0 --cache-reuse 256 --jinja (farm argv)"
step_qwen36()   { vllm_model spark_vllm_qwen36 spark-vllm030-qwen36-35b-a3b-nvfp4 "$HF/Qwen3.6-35B-A3B-NVFP4" qwen3.6-35b-a3b-nvfp4 \
                    "--kv-cache-dtype fp8 --reasoning-parser qwen3 --tool-call-parser qwen3_xml"; }
step_nemotron() { vllm_model spark_vllm_nemotron spark-vllm030-nemotron35L-30b-a3b-nvfp4 "$HF/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4" nemotron-3.5-lightning-30b-a3b-nvfp4 \
                    "--kv-cache-dtype fp8 --mamba-backend flashinfer --reasoning-parser nemotron_v3 --tool-call-parser qwen3_coder"; }
step_qwen38()   { vllm_model spark_vllm_qwen38 spark-vllm030-qwen38-27b-nvfp4 "$HF/Qwen3.8-27B-NVFP4" qwen3.8-27b-nvfp4 \
                    "--kv-cache-dtype fp8_e4m3 --reasoning-parser qwen3 --tool-call-parser qwen3_coder"; }
step_llama_nemotron() {
  local L=spark-llamacpp-nemotron35L-q4km-p16
  llama_up "$NEMO_GGUF" 16 2097152 spark_llamacpp_nemotron_p16 nemotron-3.5-lightning-q4km || return 1
  SPIKE_PY="$HOME/lol-spike/.venv/bin/python" bash "$R/llamacpp_suite.sh" "$L" "$LN, Ollama blob nemotron-3.5-lightning:30b Q4_K_M, --parallel 16 --ctx-size 2097152 (slot window capped at 1048576) $FARM" 1,4,8,16
  tripped; bash "$R/followup_levels.sh" "$L" 30000 2,4,8,16 http://127.0.0.1:8190/v1 --append
  tripped; bash "$R/followup_levels.sh" "$L" 120000 1,2,4 http://127.0.0.1:8190/v1 --append
  bash "$D/stop_llamacpp.sh"; baseline; tripped
}
step_llama_qwen38() {
  llama_up "$QW38_GGUF" 8 262144 spark_llamacpp_qwen38_p8 qwen3.8-27b-q4km || return 1
  SPIKE_PY="$HOME/lol-spike/.venv/bin/python" bash "$R/llamacpp_suite.sh" spark-llamacpp-qwen38-27b-q4km-p8 "$LN, Ollama blob qwen3.8:latest Q4_K_M (no mmproj), --parallel 8 --ctx-size 262144 $FARM" 1,4,8
  bash "$D/stop_llamacpp.sh"; baseline; tripped
  llama_up "$QW38_GGUF" 16 524288 spark_llamacpp_qwen38_p16 qwen3.8-27b-q4km || return 1
  SKIP_QUALITY=1 LONG_LEVELS= SPIKE_PY="$HOME/lol-spike/.venv/bin/python" bash "$R/llamacpp_suite.sh" spark-llamacpp-qwen38-27b-q4km-p16 "$LN, Ollama blob qwen3.8:latest Q4_K_M (no mmproj), --parallel 16 --ctx-size 524288 (slot window capped at 262144) $FARM" 1,4,8,16
  bash "$D/stop_llamacpp.sh"; baseline; tripped
}

STEPS=("$@"); [ ${#STEPS[@]} -eq 0 ] && STEPS=(qwen36 nemotron qwen38 llama_nemotron llama_qwen38)
for s in "${STEPS[@]}"; do say "=== step $s"; "step_$s" || say "step $s FAILED"; tripped; done
say "=== all done"
