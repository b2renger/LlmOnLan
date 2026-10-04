#!/bin/bash
# Run the full vLLM suite against a vLLM server already listening (default :8100).
#   vllm_suite.sh <label> <notes> [base_url]
# Order: quality (thinking on) -> chat -> agent -> long 32k -> chat thinking-off (natural lengths)
#        -> long 64k / 128k at low concurrency -> quality thinking off.
set -u
LABEL="$1"; NOTES="$2"; URL="${3:-http://127.0.0.1:8100/v1}"
# On WSL2 vLLM was reached over its Unix socket: SPIKE_UDS=~/lol-spike/run/vllm.sock (the URL host is then ignored).
PY="${SPIKE_PY:-$HOME/lol-spike/.venv/bin/python}"
cd "$(dirname "$0")/.."
B="--base-url $URL --label $LABEL"
$PY spike_bench.py quality $B --thinking on --concurrency 4 --notes "$NOTES" ${QUALITY_ARGS:-}
$PY spike_bench.py bench $B --profile chat  --levels 1,4,8,16,32 --extend 48,64 --notes "$NOTES" ${BENCH_ARGS:-}
$PY spike_bench.py bench $B --profile agent --levels 1,4,8,16,32 --extend 48,64 --notes "$NOTES" ${BENCH_ARGS:-}
$PY spike_bench.py bench $B --profile long  --levels 1,2,4,8,16 --extend 24,32 --notes "$NOTES" ${BENCH_ARGS:-}
$PY spike_bench.py bench $B --profile chat --thinking off --natural --levels 1,8,16,32 --extend 48,64 --notes "$NOTES" ${BENCH_ARGS:-}
$PY spike_bench.py bench $B --profile long --prompt-tokens 64000 --levels 1,2,4,8 --extend "" --notes "$NOTES (64k prompts)" ${BENCH_ARGS:-}
$PY spike_bench.py bench $B --profile long --prompt-tokens 120000 --levels 1,2,4 --extend "" --notes "$NOTES (128k prompts)" ${BENCH_ARGS:-}
$PY spike_bench.py quality $B --thinking off --concurrency 4 --max-tokens 8192 --notes "$NOTES" ${QUALITY_ARGS:-}
echo "[suite] done $LABEL"
