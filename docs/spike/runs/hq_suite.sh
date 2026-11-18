#!/bin/bash
# The same measurements for each way of serving Qwen3.8-27B (HyperQwen evaluation, night n° 10, 2026-11-18/19):
#   hq_suite.sh <label> <server root URL, no /v1> [model id] [steps, default one,edit,people,long,quality]
# Run from Git Bash on Windows, against a server with the whole GPU. Results: docs/spike/results/hq-<label>-*.json.
#   one      one person, a short question, 3 rounds (the speed a person alone feels)
#   edit     one person asks for a whole file back with one rename, thinking off (hq_edit.mjs: the answer repeats its
#            prompt, as a code edit does; it also checks the copy is exact)
#   people   30 people at once from one address, the short question, 2 rounds (the class shape, no seat gate)
#   long     30 people, each deep in a ~23k conversation, natural answers (spike_bench followup, the class's limiter)
#   long50   30 people, each ~50k deep (a 64k setting; not in the default steps)
#   quality  the 28-item quality gate, thinking off
set -u
LABEL="$1"; URL="${2%/}"; MODEL="${3:-qwen38}"; STEPS=",${4:-one,edit,people,long,quality},"
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
OUT="$REPO/docs/spike/results"; mkdir -p "$OUT"
PY="$REPO/farm/.venv/Scripts/python.exe"; [ -x "$PY" ] || PY=python3
LOL="node $REPO/farm/bin/lol.js bench --url $URL --model $MODEL"

[[ "$STEPS" == *,one,* ]] && $LOL --users 1 --rounds 3 --max-tokens 1000 --out "$OUT/hq-$LABEL-one.json"
[[ "$STEPS" == *,edit,* ]] && node "$HERE/hq_edit.mjs" "$URL" "$LABEL" "$MODEL" 3   # thinking off: the copy itself
[[ "$STEPS" == *,people,* ]] && $LOL --users 30 --rounds 2 --max-tokens 1000 --out "$OUT/hq-$LABEL-people30.json"
[[ "$STEPS" == *,long,* ]] && "$PY" "$REPO/docs/spike/spike_bench.py" bench --base-url "$URL/v1" --model "$MODEL" \
    --label "hq-$LABEL-follow23k" --profile followup --prompt-tokens 23000 --levels 30 --extend "" --rounds 2 --natural \
    --out-dir "$OUT" --notes "HyperQwen evaluation, night n° 10: 30 people each ~23k deep"
[[ "$STEPS" == *,long50,* ]] && "$PY" "$REPO/docs/spike/spike_bench.py" bench --base-url "$URL/v1" --model "$MODEL" \
    --label "hq-$LABEL-follow50k" --profile followup --prompt-tokens 50000 --levels 30 --extend "" --rounds 2 --natural \
    --out-dir "$OUT" --notes "HyperQwen evaluation, night n° 10: 30 people each ~50k deep (a 64k setting)"
[[ "$STEPS" == *,quality,* ]] && "$PY" "$REPO/docs/spike/spike_bench.py" quality --base-url "$URL/v1" --model "$MODEL" \
    --label "hq-$LABEL" --thinking off --concurrency 4 --out-dir "$OUT"
echo "[hq_suite] $LABEL done $(date -Is)"
