#!/bin/bash
# One new model on a running vLLM, the short way (2026-11-06): enough to tell whether it is worth a place on the farm's
# list. The 28-item gate with thinking off and on, a chat sweep, then follow-ups at 30k and 62k, as Open WebUI sends them.
#   SPIKE_UDS=<socket> SPIKE_PY=<python> model_trial.sh <label> <notes> [32k levels] [64k levels]
# Run it inside WSL, on vLLM's own socket, as on 2026-11-02. Results go to docs/spike/results/.
set -u
LABEL="$1"; NOTES="$2"; L32="${3:-8,16,32,48,64,96,128}"; L64="${4:-8,16,32,48,64,80}"
PY="${SPIKE_PY:-$HOME/lol-vllm-033/.venv/bin/python}"
URL=http://localhost/v1
cd "$(dirname "$0")/.."
B="--base-url $URL --label $LABEL"
$PY spike_bench.py quality $B --thinking off --concurrency 4 --max-tokens 8192 --notes "$NOTES"
$PY spike_bench.py quality $B --thinking on --concurrency 4 --notes "$NOTES"
$PY spike_bench.py bench $B --profile chat --levels 1,8,16,32,64 --extend "" --notes "$NOTES"
$PY spike_bench.py bench $B --profile followup --prompt-tokens 30000 --rounds 3 --levels "$L32" --extend "" --append --notes "$NOTES (30k contexts)"
$PY spike_bench.py bench $B --profile followup --prompt-tokens 62000 --rounds 3 --levels "$L64" --extend "" --append --notes "$NOTES (62k contexts)"
echo "[trial] done $LABEL"
