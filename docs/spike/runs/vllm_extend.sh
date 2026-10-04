#!/bin/bash
# Past --max-num-seqs 64: restart the server with a higher cap (e.g. 192), then
#   vllm_extend.sh <label> <notes> [base_url]
# chat + agent at 64..192 users, and the followup profile (context loaded once, then cached turns)
# at 32k / 64k / 128k per person, up to the KV pool's capacity.
set -u
LABEL="$1"; NOTES="$2"; URL="${3:-http://127.0.0.1:8100/v1}"
PY="${SPIKE_PY:-$HOME/lol-spike/.venv/bin/python}"
cd "$(dirname "$0")/.."
B="--base-url $URL --label $LABEL"
HI="${HI_LEVELS:-64,96,128,160,192}"
$PY spike_bench.py bench $B --profile chat  --levels "$HI" --extend "" --notes "$NOTES" ${BENCH_ARGS:-}
$PY spike_bench.py bench $B --profile agent --levels "$HI" --extend "" --notes "$NOTES" ${BENCH_ARGS:-}
$PY spike_bench.py bench $B --profile followup --prompt-tokens 30000  --rounds 3 --levels "${F32:-8,16,32,64,96,128}" --extend "" --notes "$NOTES (32k contexts)" ${BENCH_ARGS:-}
$PY spike_bench.py bench $B --profile followup --prompt-tokens 62000  --rounds 3 --levels "${F64:-8,16,32,48,64}" --extend "" --notes "$NOTES (64k contexts)" ${BENCH_ARGS:-}
$PY spike_bench.py bench $B --profile followup --prompt-tokens 120000 --rounds 3 --levels "${F128:-4,8,16,24,32}" --extend "" --notes "$NOTES (128k contexts)" ${BENCH_ARGS:-}
echo "[suite] done extend $LABEL"
