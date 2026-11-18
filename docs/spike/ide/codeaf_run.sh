#!/bin/bash
# CodeAF (github.com/Agent-Field/CodeAF) on the coding agent's tasks, beside run.js's dsh (night n° 10, 2026-11-18/19).
# Run in WSL. CodeAF runs sealed: bubblewrap with no network at all (--unshare-net) and the whole disk read-only but
# the task's folder and CodeAF's own state; inside, the farm's relay.py turns the vLLM's Unix socket into
# 127.0.0.1:8190, the only server it can reach. Telemetry, the model pool and attribution are off as well.
#   codeaf_run.sh <label> <codeaf binary> <vLLM socket> <model id> <do|exec> <task,task,...> [rep]
# Each task: a fresh copy of its seed, the prompt verbatim, then its check.js (in the same sandbox). One JSON line per
# task to ~/lol-codeaf/<label>/results.jsonl.
set -u
LABEL="$1"; BIN="$2"; SOCK="$3"; MODEL="$4"; MODE="$5"; TASKS="$6"; REP="${7:-1}"
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
BASE=~/lol-codeaf/"$LABEL"; HOME_C="$BASE/codeaf-home"; mkdir -p "$BASE" "$HOME_C"
RELAY_PY=~/lol-vllm-033/.venv/bin/python
for task in ${TASKS//,/ }; do
  for r in $(seq 1 "$REP"); do
    dir="$BASE/$task-$r-$RANDOM"; mkdir -p "$dir"; cp -r "$HERE/tasks/$task/seed/." "$dir/"
    # No git repository: CodeAF never merges onto main, so a fresh repo would keep its work on a side branch; without
    # one it edits the folder in place (its GUIDE), as dsh does.
    prompt="$(cat "$HERE/tasks/$task/prompt.txt")"
    if [ "$MODE" = do ]; then
      cmd=(do "$prompt" --dir "$dir" --json --model "$MODEL" --plan-model "$MODEL" --check-model "$MODEL" --yes-spend --timeout 20m)
    else
      cmd=(exec "$prompt" --dir "$dir" --json --model "$MODEL" --timeout 20m)
    fi
    t0=$(date +%s)
    bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --bind "$dir" "$dir" --bind "$HOME_C" "$HOME_C" \
      --unshare-net --die-with-parent --chdir "$dir" \
      --setenv CODEAF_HOME "$HOME_C" --setenv HOME "$HOME_C" --setenv CODEAF_BASE_URL http://127.0.0.1:8190/v1 \
      --setenv OPENAI_API_KEY EMPTY --unsetenv OPENROUTER_API_KEY --setenv CODEAF_TELEMETRY off --setenv DO_NOT_TRACK 1 \
      --setenv CODEAF_MODEL_POOL off --setenv CODEAF_ATTRIBUTION off --setenv CODEAF_COMPLETION_RESERVE 8192 \
      --setenv CODEAF_CONTEXT_FILL_PCT 60 --setenv CODEAF_DAILY_BUDGET 0 --setenv CODEAF_PREAUTHORIZE_SPEND 1 \
      bash -c '"$0" "$1" 127.0.0.1 8190 "$2" >/dev/null 2>&1 & sleep 1
               out="$4"; shift 4; "$@" > "$out/.codeaf-out.json" 2> "$out/.codeaf-err.txt"; echo "exit=$?" >> "$out/.codeaf-err.txt"' \
      "$RELAY_PY" "$REPO/farm/vllm/relay.py" "$SOCK" _ "$dir" "$BIN" "${cmd[@]}" 2>/dev/null
    t1=$(date +%s)
    code=$(grep -o 'exit=[0-9]*' "$dir/.codeaf-err.txt" | tail -1 | cut -d= -f2)
    chkout=$(bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --bind "$dir" "$dir" --unshare-net --die-with-parent \
      node "$HERE/tasks/$task/check.js" "$dir" 2>&1); [ $? = 0 ] && pass=true || pass=false
    chk=$(echo "$chkout" | tail -2 | tr '\n' ' ' | tr -d '"\\' | cut -c1-200)
    line=$(printf '{"label":"%s","mode":"%s","task":"%s","rep":%s,"pass":%s,"exit":%s,"seconds":%s,"check":"%s","dir":"%s"}' \
      "$LABEL" "$MODE" "$task" "$r" "$pass" "${code:-null}" "$((t1 - t0))" "$chk" "$dir")
    echo "$line" | tee -a "$BASE/results.jsonl"
  done
done
