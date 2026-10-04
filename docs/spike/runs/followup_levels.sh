#!/bin/bash
# Extra followup levels against a running server.
#   followup_levels.sh <label> <prompt_tokens> <levels> [base_url] [extra bench args, e.g. --append]
set -u
LABEL="$1"; PT="$2"; LV="$3"; URL="${4:-http://127.0.0.1:8100/v1}"; shift 4 2>/dev/null || shift $#
PY="${SPIKE_PY:-$HOME/lol-spike/.venv/bin/python}"
cd "$(dirname "$0")/.."
$PY spike_bench.py bench --base-url "$URL" --label "$LABEL" --profile followup \
  --prompt-tokens "$PT" --rounds 3 --levels "$LV" --extend "" --notes "followup levels (${PT}-token contexts) $*" "$@"
