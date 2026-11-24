#!/bin/bash
# CONTEXT_128K_PLAN step 3's check, on the client's own document path (the vector store, no GPU): does Open WebUI keep
# an attached document byte for byte the same in the system message from turn to turn with RAG_SYSTEM_CONTEXT=true?
# If it does, vLLM reads the document once per chat (measured 2026-11-20 on 0.13.3: turns 2 and 3 5.3 s → 0.13–0.15 s).
# Re-run it on every Open WebUI pin bump: a change in its middleware could undo the gain without any error.
#
# A stub stands in for the farm (owui_doc_stub.mjs: fixed embeddings, a fixed reply, a hash of each message logged);
# Open WebUI runs twice with the client's document settings (shell/src/main/configBridge.ts), once with the setting off
# and once on; three questions about a ~100k-token locker list (seed 7, 3,300 records) in one chat each time.
#   bash owui_doc_check.sh <open-webui executable, e.g. a venv's Scripts/open-webui.exe> <empty work folder>
# The released sidecar's own Scripts/open-webui.exe does not start (it names the build machine's Python): give a
# two-line wrapper that runs `<sidecar>/python/python.exe <sidecar>/launcher.py "$@"`, as the client does (2026-11-24).
# Ports 8196 (the stub) and 8197 (Open WebUI) must be free. Git Bash on Windows (taskkill), or any bash with netstat.
# Last line: PASS (setting on: the same document hash in message 0 on all three turns) or FAIL. The turns say WRONG:
# the stub always answers 0000; the answers were checked on a real vLLM (results/lc1120-owui-*.json). About 40 s.
# First run, 2026-11-20 12:54, Open WebUI 0.13.3: PASS (205,921 characters in message 0, one hash on three turns).
set -u
OWUI=$1; W=$2
HERE=$(cd "$(dirname "$0")" && pwd)
pidOn() { netstat -ano | grep -E "127\.0\.0\.1:$1 .*LISTENING" | awk '{print $NF}' | head -1; }
killOn() { local p; p=$(pidOn $1); [ -n "$p" ] && taskkill //F //T //PID $p >/dev/null 2>&1; }
for p in 8196 8197; do [ -n "$(pidOn $p)" ] && { echo "port $p busy"; exit 1; }; done
mkdir -p "$W" && cd "$W" || exit 1
node "$HERE/owui_doc_gen.mjs" 7 3300 lockers.txt answers.json > /dev/null
: > stub.log
node "$HERE/owui_doc_stub.mjs" 8196 stub.log > /dev/null 2>&1 &
sleep 2
for mode in true false; do
  d=$W/owui-$mode; rm -rf "$d"; mkdir -p "$d"
  echo "--- RAG_SYSTEM_CONTEXT=$mode" >> stub.log
  env DATA_DIR="$d" WEBUI_AUTH=false WEBUI_SECRET_KEY=owui-doc-check ENABLE_PERSISTENT_CONFIG=false \
      ENABLE_VERSION_UPDATE_CHECK=false ENABLE_OLLAMA_API=false ENABLE_OPENAI_API=true \
      OPENAI_API_BASE_URL=http://127.0.0.1:8196/v1 OPENAI_API_KEY=sk-owui-doc-check \
      RAG_FULL_CONTEXT=true RAG_TOP_K=8 ENABLE_RETRIEVAL_QUERY_GENERATION=false \
      DEFAULT_MODEL_METADATA='{"capabilities":{"vision":true,"file_context":true}}' ENABLE_DIRECT_INTEGRATIONS=true \
      ENABLE_AUTOCOMPLETE_GENERATION=false ENABLE_FOLLOW_UP_GENERATION=false ENABLE_TAGS_GENERATION=false \
      RAG_EMBEDDING_MODEL_AUTO_UPDATE=false HF_HUB_OFFLINE=1 \
      RAG_EMBEDDING_ENGINE=openai RAG_EMBEDDING_MODEL=stub-embed RAG_OPENAI_API_BASE_URL=http://127.0.0.1:8196/v1 \
      RAG_OPENAI_API_KEY=sk-owui-doc-check RAG_SYSTEM_CONTEXT=$mode \
      "$OWUI" serve --host 127.0.0.1 --port 8197 > "owui-$mode.log" 2>&1 &
  for i in $(seq 1 90); do sleep 2; curl -s -m 2 http://127.0.0.1:8197/health | grep -q true && break; done
  node "$HERE/owui_doc_turns.mjs" http://127.0.0.1:8197 qwen36 "turns-$mode" lockers.txt answers.json 2>&1 | tail -n 3
  killOn 8197; sleep 3
done
killOn 8196
echo "=== the chat requests (message index:role:characters:hash, DOC = holds the document)"
grep -v embeddings stub.log | cut -c1-200
# The verdict: with the setting on, three chat requests, each with the document in message 0, all with one hash.
on=$(awk '/^--- RAG_SYSTEM_CONTEXT=true/{f=1;next} /^---/{f=0} f && / chat /' stub.log)
n=$(printf '%s\n' "$on" | grep -c ' chat 0:system:[0-9]*:[0-9a-f]*:DOC')
h=$(printf '%s\n' "$on" | sed -n 's/.* chat 0:system:[0-9]*:\([0-9a-f]*\):DOC.*/\1/p' | sort -u | wc -l)
if [ "$n" -eq 3 ] && [ "$h" -eq 1 ]; then echo PASS; else echo "FAIL ($n turns with the document in message 0, $h different hashes)"; exit 1; fi
