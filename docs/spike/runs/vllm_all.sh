#!/bin/bash
# Base suite + extension against one vLLM server started with --max-num-seqs 192.
#   vllm_all.sh <label> <notes> [base_url]
set -u
D="$(dirname "$0")"
bash "$D/vllm_suite.sh" "$@"
bash "$D/vllm_extend.sh" "$1" "$2" "${3:-http://127.0.0.1:8100/v1}"
