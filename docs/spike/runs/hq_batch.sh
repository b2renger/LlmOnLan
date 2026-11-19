#!/bin/bash
# HyperQwen's BATCH mode on the RTX PRO 6000 (2026-11-19, research/2026-11-19-codeaf-hyperqwen.md): its launcher with its
# own settings (MAX_SEQS 64, fp8 KV, fp16 recurrent state, int8 MLP activations, prefix caching, WSL's GPU_UTIL 0.91),
# the same 50 GiB KV pool as the other arms (vLLM's --kv-cache-memory-bytes: the batch launcher has no KV_MEM) and 64k;
# a Unix socket behind the farm's relay on 127.0.0.1:8190 (served name qwen3.8-27b). Run in WSL:
#   hq_batch.sh            as published
#   hq_batch.sh noint8     INT8_ACT= (pure W4A16)
#   hq_batch.sh mtp        + MTP drafting by hand, 3 tokens, probabilistic (the farm's setting)
# Install (scratch root ~/lol-hq, never ~/lol-vllm*): clone syv-ai/HyperQwen at 3d6c954; hf download
# dbirks/Qwen3.8-27B-W4A16-AutoRound; its docs/install.md pip line into HyperQwen/venv; `bash patches/apply.sh <the vllm
# PACKAGE folder>` (site-packages/vllm, not site-packages); prepare/quant_{lm_head,embed,mtp}.py on the checkpoint. On
# WSL its FlashInfer JIT (fp8 KV) links -lcudart -lcuda from $CUDA_HOME/lib64(/stubs), which the pip CUDA 13 copy lacks:
#   cd venv/lib/python3.12/site-packages/nvidia/cu13 && ln -sfn lib lib64 && ln -sf libcudart.so.13 lib/libcudart.so \
#     && mkdir -p lib/stubs && ln -sf /usr/lib/wsl/lib/libcuda.so lib/stubs/libcuda.so
# Stop: pkill -f 'lol-hq/HyperQwen/venv/bin/vllm serve'
set -u
cd ~/lol-hq/HyperQwen; mkdir -p ~/lol-hq/run; rm -f ~/lol-hq/run/vllm.sock
export MODEL=$HOME/lol-hq/HyperQwen/models/Qwen3.8-27B-W4A16-AutoRound MAX_LEN=65536 PORT=18020
EXTRA="--uds $HOME/lol-hq/run/vllm.sock --kv-cache-memory-bytes 53687091200"
case "${1:-}" in
  noint8) export INT8_ACT= ;;
  mtp) EXTRA="$EXTRA --speculative-config {\"method\":\"mtp\",\"num_speculative_tokens\":3,\"draft_sample_method\":\"probabilistic\"}" ;;
esac
export EXTRA_ARGS="$EXTRA"
~/lol-vllm-033/.venv/bin/python /mnt/c/Users/ateliernum/Documents/code/LlmOnLan/farm/vllm/relay.py 127.0.0.1 8190 $HOME/lol-hq/run/vllm.sock >/dev/null 2>&1 &
RELAY=$!; trap 'kill $RELAY 2>/dev/null' EXIT
bash batch/start_qwen.sh
