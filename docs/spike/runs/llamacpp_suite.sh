#!/bin/bash
# Run the llama.cpp reduced suite against a llama-server already listening on :8190.
#   llamacpp_suite.sh <label> <notes> [levels] [extra bench args...]
# Quality (thinking on; SKIP_QUALITY=1 skips it) + chat + agent sweeps + chat with thinking off (natural
# lengths) + long 32k (LONG_LEVELS, default 1,2,4,8; LONG_LEVELS= skips it).
set -u
LABEL="$1"; NOTES="$2"; LEVELS="${3:-1,4,8,16}"; shift 3 || true
PY="${SPIKE_PY:-$HOME/lol-spike/.client/bin/python}"
cd "$(dirname "$0")/.."
B="--base-url http://127.0.0.1:8190/v1 --label $LABEL"
[ -n "${SKIP_QUALITY:-}" ] || $PY spike_bench.py quality $B --thinking on --concurrency 4 --notes "$NOTES"
$PY spike_bench.py bench $B --profile chat --levels "$LEVELS" --extend "" --notes "$NOTES" "$@"
$PY spike_bench.py bench $B --profile agent --levels "$LEVELS" --extend "" --notes "$NOTES" "$@"
$PY spike_bench.py bench $B --profile chat --thinking off --natural --levels "$LEVELS" --extend "" --notes "$NOTES" "$@"
LL="${LONG_LEVELS-1,2,4,8}"
[ -z "$LL" ] || $PY spike_bench.py bench $B --profile long --levels "$LL" --extend "" --notes "$NOTES" "$@"
echo "[suite] done $LABEL"
