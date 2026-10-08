#!/bin/bash
# The scripts in this folder (serve.sh, stop.sh, install.sh, status.sh) with farm/test/fake-vllm in place of vLLM and
# of hf: no GPU, no download. Linux or WSL. Roots and logs live under /tmp/lol-as-* only, on free ports; a server
# started from any other root (a real one on this computer) is only ever read, by status.sh's found= scan.
#   bash test_scripts.sh [test names...]
#   Windows: wsl -d Ubuntu --cd <repo>\farm\vllm -e bash ./test_scripts.sh
D="$(cd "$(dirname "$0")" && pwd)"
FAKE="$(cd "$D/../test/fake-vllm" && pwd)"
TESTS="${*:-daemon stopsh interactive devnull guard badfloor crash rewrite managed marker refusals rotation tilde status install stopscope foreign timelimit}"
ROOT=/tmp/lol-as-root; ROOT2=/tmp/lol-as-root2; LINK=/tmp/lol-as-link; EMPTY=/tmp/lol-as-empty; TH=/tmp/lol-as-home
mkroot() {   # a root whose vllm and hf are the fakes, with the dist-info folder an install of vLLM 0.30.0 has
  pkill -KILL -f "$1/" 2>/dev/null
  rm -rf "$1"; mkdir -p "$1/.venv/bin" "$1/.venv/lib/python3.12/site-packages/vllm-0.30.0.dist-info"
  cp "$FAKE/vllm" "$FAKE/fake_vllm.py" "$FAKE/hf" "$1/.venv/bin/"; chmod +x "$1/.venv/bin/vllm" "$1/.venv/bin/hf"
  ln -s /usr/bin/python3 "$1/.venv/bin/python"
}
for r in "$ROOT" "$ROOT2" "$TH/r"; do mkroot "$r"; done
rm -rf "$LINK" "$EMPTY"; mkdir -p "$LINK" "$EMPTY"; ln -s "$ROOT/.venv" "$LINK/.venv"
free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }
PORT=$(free_port); PORT2=$(free_port); while [ "$PORT2" = "$PORT" ]; do PORT2=$(free_port); done
export LOL_VLLM_ROOT="$ROOT" LOL_VLLM_PORT="$PORT"
LOG="$ROOT/logs/vllm.log"
OUT="$ROOT/out"; ST="$ROOT/st"
echo "scripts from $D, roots $ROOT and $ROOT2, ports $PORT and $PORT2"
pass=0; fail=0
check() { local n="$1"; shift; if "$@"; then echo "  PASS $n"; pass=$((pass+1)); else echo "  FAIL $n"; fail=$((fail+1)); fi; }
answers() { curl -s -o /dev/null -m 2 "http://127.0.0.1:${1:-$PORT}/v1/models"; }
wait_answers() { for _ in $(seq 1 "$1"); do answers "${2:-}" && return 0; sleep 1; done; return 1; }
alive() { [ -d "/proc/$1" ] && [ "$(awk '{print $3}' "/proc/$1/stat" 2>/dev/null)" != Z ]; }
exits() {   # exits <pid> <secs> <status>: our child exits within secs, with that status
  for _ in $(seq 1 "$2"); do alive "$1" || break; sleep 1; done
  alive "$1" && { echo "    still running after $2 s"; return 1; }
  wait "$1"; RC=$?; echo "    exit status $RC"; [ "$RC" = "$3" ]
}
nothing_left() { ! pgrep -f "$ROOT/" >/dev/null && ! pgrep -g "$1" >/dev/null; }
has_line() { grep -qF -- "$1" "$LOG"; }
lacks_line() { ! grep -qF -- "$1" "$LOG"; }
lacks() { ! grep -qE -- "$1" "$2"; }
st() { LOL_VLLM_ROOT="${1:-$ROOT}" LOL_VLLM_ROOTS="${2:-}" bash "$D/status.sh" > "$ST"; }
b64() { python3 -c 'import base64, sys; print(base64.b64encode("\0".join(sys.argv[1:]).encode()).decode())' "$@"; }   # as vllm.js joins it
daemon() { LOL_VLLM_DAEMON=1 FAKE_DELAY="${FAKE_DELAY:-1}" exec bash "$D/serve.sh" "$@" < /dev/null > "$OUT" 2>&1; }   # with &: it execs, so $! is serve.sh
clean() {
  for r in "$ROOT" "$ROOT2" "$TH/r" "$LINK"; do
    LOL_VLLM_ROOT="$r" bash "$D/stop.sh" >/dev/null 2>&1; LOL_VLLM_ROOT="$r" bash "$D/stop.sh" install >/dev/null 2>&1
    pkill -KILL -f "$r/" 2>/dev/null; rm -rf "$r/run" "$r/logs" "$r/hf"
  done
  rm -f "$OUT" "$ST"; sleep 1
}

# ---- serve.sh as the operator runs it (the 35 checks from before the farm ran vLLM) ----------------------------
t_daemon() {
  echo "daemon mode, stdin /dev/null, stopped by a SIGTERM to its group (systemctl stop)"
  LOL_VLLM_DAEMON=1 FAKE_DELAY=3 bash "$D/serve.sh" < /dev/null > "$OUT" 2>&1 &
  local P=$!
  check "answers" wait_answers 30
  sleep 8
  check "still answers 8 s later" answers
  check "serve.sh still running" alive $P
  check "no watchdog" lacks_line "[watchdog]"
  check "no copy of the log on stdout" bash -c "! grep -qF '[fake-vllm]' '$OUT'"
  kill -TERM -- "-$P"
  check "exits 143" exits $P 45 143
  check "nothing left (EngineCore that ignores TERM included)" nothing_left $P
  check "the port is closed" bash -c "! curl -s -o /dev/null -m 2 http://127.0.0.1:$PORT/v1/models"
  check "pgid file and socket removed" bash -c "[ ! -e '$ROOT/run/vllm.pgid' ] && [ ! -e '$ROOT/run/vllm.sock' ]"
}
t_stopsh() {
  echo "daemon mode with a guard that does not trip, stopped by stop.sh"
  LOL_VLLM_DAEMON=1 LOL_VLLM_MIN_FREE_GB=1 FAKE_DELAY=3 bash "$D/serve.sh" < /dev/null > "$OUT" 2>&1 &
  local P=$!
  check "answers" wait_answers 30
  sleep 6
  check "a 1 GB floor does not stop it" alive $P
  bash "$D/stop.sh" > "$ROOT/stop.out" 2>&1
  check "exits 143" exits $P 50 143
  check "nothing left" nothing_left $P
}
t_interactive() {
  echo "interactive mode (default): stdin closes after 10 s"
  ( sleep 10 ) | FAKE_DELAY=2 bash "$D/serve.sh" > "$OUT" 2>&1 &
  local P=$!
  check "answers" wait_answers 9
  check "the watchdog stops it" exits $P 50 143
  check "watchdog line" has_line "stdin closed"
  check "log copied to stdout" grep -qF "[fake-vllm] listening" "$OUT"
  check "nothing left" nothing_left $P
}
t_devnull() {
  echo "interactive mode (default) with stdin /dev/null: stops at once"
  FAKE_DELAY=2 bash "$D/serve.sh" < /dev/null > "$OUT" 2>&1 &
  local P=$!
  check "stops within 15 s" exits $P 15 143
  check "watchdog line" has_line "stdin closed"
  echo "    left in its group right after: $(pgrep -g $P -a | tr '\n' ';')"
  for _ in $(seq 1 35); do nothing_left $P && break; sleep 1; done   # the watchdog KILLs the group after 30 s
  check "nothing left 35 s later" nothing_left $P
}
t_guard() {
  echo "the memory guard trips (floor above the box's memory)"
  local t0=$SECONDS
  LOL_VLLM_DAEMON=1 LOL_VLLM_MIN_FREE_GB=100000 FAKE_DELAY=60 bash "$D/serve.sh" < /dev/null > "$OUT" 2>&1 &
  local P=$!
  check "exits 3" exits $P 40 3
  echo "    stopped after $((SECONDS - t0)) s"
  check "within 15 s" [ $((SECONDS - t0)) -le 15 ]
  check "guard line" has_line "[guard]"
  check "nothing left (EngineCore that ignores TERM included)" nothing_left $P
  st
  check "status.sh: guard= its line" grep -q '^guard=\[guard\] .*LOL_VLLM_MIN_FREE_GB=100000' "$ST"
}
t_badfloor() {
  echo "a floor that is not a whole number"
  LOL_VLLM_DAEMON=1 LOL_VLLM_MIN_FREE_GB=8GB bash "$D/serve.sh" < /dev/null > "$OUT" 2>&1 &
  local P=$!
  check "exits 1" exits $P 10 1
  check "says why" grep -qF "whole number" "$OUT"
  check "nothing started" nothing_left $P
  check "and logs why" has_line "whole number"
}
t_crash() {
  echo "vLLM crashes (exit 1) in daemon mode"
  LOL_VLLM_DAEMON=1 FAKE_DELAY=2 FAKE_EXIT=1 bash "$D/serve.sh" < /dev/null > "$OUT" 2>&1 &
  local P=$!
  check "serve.sh exits 1" exits $P 30 1
  check "nothing left" nothing_left $P
}
t_rewrite() {
  echo "serve.sh is rewritten in place while it runs, then stopped"
  local E="$ROOT/edit"; rm -rf "$E"; mkdir -p "$E"; cp "$D/serve.sh" "$D/stop.sh" "$D/relay.py" "$E/"
  ( sleep 40 ) | FAKE_DELAY=2 bash "$E/serve.sh" > "$OUT" 2>&1 &
  local P=$!
  check "answers" wait_answers 20
  { head -n 1 "$E/serve.sh"; printf '# %0300d\n' 0; tail -n +2 "$E/serve.sh"; } > "$ROOT/new.sh"
  cat "$ROOT/new.sh" > "$E/serve.sh"   # same file, new content: what a copy over it from Windows does
  kill -TERM -- "-$P"
  check "exits 143" exits $P 45 143
  check "its last lines ran" has_line "vLLM exited (status 143)"
  check "no shell errors" bash -c "! grep -E 'command not found|syntax error|unexpected|No such file' '$OUT'"
  check "nothing left" nothing_left $P
  pkill -P $$ -x sleep 2>/dev/null
}

# ---- run by the farm (docs/VLLM_MANAGED_PLAN.md §3.1) ------------------------------------------------------------
t_managed() {
  echo "run by the farm: its argv whole, none of serve.sh's defaults, no extra args, the marker written"
  local A=(--served-model-name x-model --max-model-len 4096 --tool-call-parser 'two words' --override-generation-config '{"max_new_tokens": 1024}')
  LOL_VLLM_MODEL=/models/x LOL_VLLM_ARGS_B64="$(b64 "${A[@]}")" daemon --bogus-extra &
  local P=$!
  check "answers" wait_answers 30
  st
  grep '^arg=' "$ST" > "$ROOT/got"; printf 'arg=%s\n' /models/x --uds "$ROOT/run/vllm.sock" "${A[@]}" > "$ROOT/want"
  check "vLLM gets exactly the farm's argv (read back by status.sh)" cmp -s "$ROOT/got" "$ROOT/want"
  check "none of serve.sh's defaults, nor the extra arg" lacks 'kv-cache-memory-bytes|qwen3_xml|max-num-seqs|bogus-extra' "$ST"
  check "the marker is written" [ -e "$ROOT/run/managed-by-farm" ]
  check "status.sh: managed=1 and the argv in env=" bash -c "grep -qx managed=1 '$ST' && grep -q '^env=LOL_VLLM_ARGS_B64=' '$ST'"
  bash "$D/stop.sh" > /dev/null
  check "stops (143)" exits $P 50 143
  LOL_VLLM_ARGS_B64=x LOL_VLLM_DAEMON=1 timeout -s KILL 30 bash "$D/serve.sh" < /dev/null > "$OUT" 2>&1; local rc=$?   # not the base64 of anything
  check "an argv that decodes to nothing: exit 1, logged" bash -c "[ $rc = 1 ] && grep -qF 'holds no arguments' '$LOG'"
}
t_marker() {
  echo "a start without the farm's argv on a root the farm runs does nothing"
  mkdir -p "$ROOT/run"; : > "$ROOT/run/managed-by-farm"
  daemon &
  local P=$!
  check "exits 0 at once" exits $P 5 0
  check "says so" grep -qF "The LlmOnLan farm runs this vLLM now" "$OUT"
  check "and logs it" has_line "this start does nothing"
  check "nothing started" bash -c "[ ! -e '$ROOT/run/vllm.pgid' ]"
  check "nothing left" nothing_left $P
  LOL_VLLM_ARGS_B64="$(b64 --served-model-name m)" daemon &
  P=$!
  check "with the farm's argv it runs" wait_answers 30
  bash "$D/stop.sh" > /dev/null
  check "stops (143)" exits $P 50 143
}
t_refusals() {
  echo "the early refusals reach the log too"
  LOL_VLLM_ROOT="$EMPTY" LOL_VLLM_DAEMON=1 timeout -s KILL 30 bash "$D/serve.sh" < /dev/null > "$OUT" 2>&1; local rc=$?
  check "no vLLM in the root: exit 1, logged" bash -c "[ $rc = 1 ] && grep -qF 'No vLLM in $EMPTY' '$EMPTY/logs/vllm.log'"
  python3 -c 'import socket, sys, time; s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(); time.sleep(60)' "$PORT" &
  local L=$!; sleep 1
  LOL_VLLM_DAEMON=1 timeout -s KILL 30 bash "$D/serve.sh" < /dev/null > "$OUT" 2>&1; rc=$?
  check "the port is taken: exit 1, logged" bash -c "[ $rc = 1 ] && grep -qF 'relay could not listen on 127.0.0.1:$PORT' '$LOG'"
  check "nothing left" nothing_left 999999
  kill $L 2>/dev/null; wait $L 2>/dev/null
}
t_rotation() {
  echo "a log over 50 MB moves to vllm.log.1 at a start"
  mkdir -p "$ROOT/logs"; truncate -s 51M "$LOG"
  daemon &
  local P=$!
  check "answers" wait_answers 30
  check "the old log is vllm.log.1, whole" [ "$(stat -c %s "$LOG.1" 2>/dev/null)" = 53477376 ]
  check "the new log starts with this start" bash -c "[ \$(stat -c %s '$LOG') -lt 100000 ] && head -1 '$LOG' | grep -qF 'pgid=$P '"
  bash "$D/stop.sh" > /dev/null
  check "stops (143)" exits $P 50 143
  daemon &   # a small log stays
  P=$!; wait_answers 30 >/dev/null
  check "a small log is not moved" bash -c "[ \$(grep -c 'host=' '$LOG') = 2 ] && [ \$(stat -c %s '$LOG.1') = 53477376 ]"
  bash "$D/stop.sh" > /dev/null; exits $P 50 143 > /dev/null
}
t_tilde() {
  echo "a root written with ~ (serve.sh, status.sh and stop.sh)"
  HOME="$TH" LOL_VLLM_ROOT='~/r' daemon &
  local P=$!
  check "answers" wait_answers 30
  check "it runs from \$HOME/r" [ "$(cat "$TH/r/run/vllm.pgid" 2>/dev/null)" = "$P" ]
  HOME="$TH" LOL_VLLM_ROOT='~/r' bash "$D/status.sh" > "$ST"
  check "status.sh finds it" bash -c "grep -qx 'running=$P' '$ST' && grep -qx 'root=$TH/r' '$ST'"
  HOME="$TH" LOL_VLLM_ROOT='~/r' bash "$D/stop.sh" > /dev/null
  check "stop.sh stops it" exits $P 50 143
}
t_status() {
  echo "status.sh: running, ready, env, arg, found= across two roots, installs, a linked venv, models, a stale pgid"
  mkdir -p "$ROOT/hf/M1" "$ROOT/hf/M2/.cache/huggingface/download" "$ROOT/hf/notes"
  printf '{"vision_config": {}, "text_config": {"max_position_embeddings": 262144}}' > "$ROOT/hf/M1/config.json"
  printf '{"max_position_embeddings":32768}' > "$ROOT/hf/M2/config.json"; : > "$ROOT/hf/M2/.cache/huggingface/download/x.incomplete"
  daemon &
  local P=$!
  LOL_VLLM_ROOT="$ROOT2" LOL_VLLM_PORT="$PORT2" LOL_VLLM_MIN_FREE_GB=1 daemon &
  local P2=$!
  check "both answer" bash -c "$(declare -f answers wait_answers); wait_answers 30 $PORT && wait_answers 30 $PORT2"
  st "$ROOT" "$ROOT2:$LINK:~/nowhere:$ROOT"
  sed 's/^/    | /; s/\(ARGS_B64=.\{20\}\).*/\1…/' "$ST"
  check "running= its pgid, ready=1" bash -c "grep -qx 'running=$P' '$ST' && grep -qx ready=1 '$ST'"
  check "env= its port, no floor" bash -c "grep -qx 'env=LOL_VLLM_PORT=$PORT' '$ST' && ! grep -q MIN_FREE '$ST'"
  check "the first arg= is the model, then serve.sh's flags" bash -c "grep '^arg=' '$ST' | head -3 | tr '\n' ' ' | grep -qx 'arg=$ROOT/hf/Qwen3.6-35B-A3B-NVFP4 arg=--uds arg=$ROOT/run/vllm.sock '"
  check "found= both servers, with their roots and ports" bash -c "grep -qx 'found=$ROOT $PORT $P' '$ST' && grep -qx 'found=$ROOT2 $PORT2 $P2' '$ST'"
  check "install= each root once, with its version" bash -c "[ \$(grep -c '^install=' '$ST') = 3 ] && grep -qx 'install=$ROOT 0.30.0' '$ST' && grep -qx 'install=$ROOT2 0.30.0' '$ST' && grep -qx 'install=$LINK 0.30.0' '$ST'"
  check "venv_link= the linked root only" [ "$(grep '^venv_link=' "$ST")" = "venv_link=$LINK" ]
  check "model= a whole one: vision, its window" grep -qE '^model=M1 [0-9]+ vision=1 native=262144 partial=0$' "$ST"
  check "model= a partial one" grep -qE '^model=M2 [0-9]+ vision=0 native=32768 partial=1$' "$ST"
  check "no model= for a folder that is no model; no guard=, installing= or managed=" lacks '^model=notes|^guard=|^installing=|^managed=' "$ST"
  check "cc= the C compiler vLLM needs at a start (this Linux has one)" grep -qE '^cc=/' "$ST"
  st "$ROOT2"
  check "the other root: its floor in env=" bash -c "grep -qx 'running=$P2' '$ST' && grep -qx 'env=LOL_VLLM_MIN_FREE_GB=1' '$ST'"
  bash "$D/stop.sh" > /dev/null; LOL_VLLM_ROOT="$ROOT2" bash "$D/stop.sh" > /dev/null
  check "both stop" bash -c "$(declare -f alive); for _ in \$(seq 1 50); do alive $P || alive $P2 || exit 0; sleep 1; done; exit 1"
  wait $P $P2 2>/dev/null
  echo 1 > "$ROOT/run/vllm.pgid"   # left by an unclean stop; after a reboot, 1 is init
  st
  check "a stale pgid file is no running server" lacks '^running=|^ready=' "$ST"
}
t_install() {
  echo "install.sh: a download only (STEPS=model) with a fake hf: its markers, its errors, the link refusal, stop.sh install"
  LOL_VLLM_STEPS=model bash "$D/install.sh" org/Some-Model > "$OUT" 2>&1; local rc=$?
  check "exit 0" [ "$rc" = 0 ]
  check "the step markers: model, then done" [ "$(grep '^\[lol-step\]' "$OUT" | tr '\n' '|')" = "[lol-step] model org/Some-Model|[lol-step] done|" ]
  check "the weights in hf/<the repo's name>, no pgid file left" bash -c "[ -f '$ROOT/hf/Some-Model/config.json' ] && [ ! -e '$ROOT/run/install.pgid' ]"
  LOL_VLLM_STEPS=model bash "$D/install.sh" org/Some-Model my-folder > "$OUT" 2>&1
  check "or in a folder named by the farm" [ -f "$ROOT/hf/my-folder/config.json" ]
  for k in gated:gated 404:notfound disk:disk net:network; do
    FAKE_HF=${k%%:*} LOL_VLLM_STEPS=model bash "$D/install.sh" org/x > "$OUT" 2>&1; rc=$?
    check "hf says ${k%%:*}: [lol-error] ${k##*:}" bash -c "[ $rc != 0 ] && grep -q '^\[lol-error\] ${k##*:} .' '$OUT'"
  done
  LOL_VLLM_ROOT="$EMPTY" LOL_VLLM_STEPS=model bash "$D/install.sh" org/x > "$OUT" 2>&1; rc=$?
  check "a download into a root with no vLLM: [lol-error] noinstall" bash -c "[ $rc != 0 ] && grep -q '^\[lol-error\] noinstall .' '$OUT'"
  LOL_VLLM_ROOT="$LINK" bash "$D/install.sh" org/x > "$OUT" 2>&1; rc=$?
  check "a .venv that is a link: the venv steps are refused before anything" bash -c "[ $rc = 1 ] && grep -q 'link to another install' '$OUT' && ! grep -q 'lol-step' '$OUT'"
  LOL_VLLM_ROOT="$LINK" LOL_VLLM_STEPS=model bash "$D/install.sh" org/Linked > "$OUT" 2>&1; rc=$?
  check "... and a download still works there" bash -c "[ $rc = 0 ] && [ -f '$LINK/hf/Linked/config.json' ]"
  FAKE_HF=slow LOL_VLLM_STEPS=model bash "$D/install.sh" org/Big > "$OUT" 2>&1 &
  local P=$!
  for _ in $(seq 1 20); do [ -s "$ROOT/run/install.pgid" ] && [ -e "$ROOT/hf/Big/.cache" ] && break; sleep 0.5; done
  check "it runs as its own process group (install.pgid)" [ "$(cat "$ROOT/run/install.pgid" 2>/dev/null)" = "$P" ]
  st
  check "status.sh: installing= and the partial download" bash -c "grep -qx 'installing=$P' '$ST' && grep -qE '^model=Big [0-9]+ vision=0 native= partial=1$' '$ST'"
  bash "$D/stop.sh" install > "$ROOT/stop.out" 2>&1; rc=$?
  check "stop.sh install: exit 0" [ "$rc" = 0 ]
  check "the install stops (143)" exits $P 20 143
  check "nothing of it left, its pgid file removed" bash -c "! pgrep -g $P >/dev/null && [ ! -e '$ROOT/run/install.pgid' ]"
  # Download again (seen live 2026-10-08): hf leaves the stopped attempt's .incomplete file and never reuses it.
  check "the stopped attempt left its unfinished file" [ -e "$ROOT/hf/Big/.cache/huggingface/download/w.safetensors.incomplete" ]
  LOL_VLLM_STEPS=model bash "$D/install.sh" org/Big > "$OUT" 2>&1; rc=$?
  st
  check "Download again: exit 0, the unfinished file gone, the model whole (partial=0)" bash -c "[ $rc = 0 ] && [ -z \"\$(find '$ROOT/hf/Big' -name '*.incomplete')\" ] && grep -qE '^model=Big [0-9]+ vision=0 native=4096 partial=0$' '$ST'"
}
t_stopscope() {
  echo "stop.sh stops its own group and reports on that group only"
  daemon &
  local P=$!
  LOL_VLLM_ROOT="$ROOT2" LOL_VLLM_PORT="$PORT2" daemon &
  local P2=$!
  check "both answer" bash -c "$(declare -f answers wait_answers); wait_answers 30 $PORT && wait_answers 30 $PORT2"
  bash "$D/stop.sh" > "$ROOT/stop.out" 2>&1; local rc=$?
  check "exit 0" [ "$rc" = 0 ]
  check "its last line is about its group" [ "$(tail -1 "$ROOT/stop.out")" = "No process left in group $P." ]
  check "no word of the other server" lacks "$ROOT2" "$ROOT/stop.out"
  check "the other server still answers" answers "$PORT2"
  check "stops (143)" exits $P 50 143
  LOL_VLLM_ROOT="$ROOT2" bash "$D/stop.sh" > /dev/null
  check "the other one stops when asked (143)" exits $P2 50 143
}
t_foreign() {
  echo "a pid file left in one root that names ANOTHER root's live server (WSL reuses low pids after a reboot)"
  daemon &
  local P=$!
  check "answers" wait_answers 30
  mkdir -p "$ROOT2/run"; echo "$P" > "$ROOT2/run/vllm.pgid"; echo "$P" > "$ROOT2/run/install.pgid"
  st "$ROOT2"
  check "status.sh at the other root: no running=, no installing=" lacks '^running=|^ready=|^installing=' "$ST"
  LOL_VLLM_ROOT="$ROOT2" bash "$D/stop.sh" > "$ROOT/stop.out" 2>&1; local rc=$?
  check "stop.sh at the other root: exit 0, says the file was stale" bash -c "[ $rc = 0 ] && grep -qF 'not a running serve.sh from $ROOT2' '$ROOT/stop.out'"
  LOL_VLLM_ROOT="$ROOT2" bash "$D/stop.sh" install > /dev/null 2>&1
  check "...and stopped nothing: this root's server still runs and answers" bash -c "$(declare -f alive answers); alive $P && answers $PORT"
  check "...the stale files are gone" bash -c "[ ! -e '$ROOT2/run/vllm.pgid' ] && [ ! -e '$ROOT2/run/install.pgid' ]"
  echo "$P" > "$ROOT2/run/vllm.pgid"
  LOL_VLLM_ROOT="$ROOT2" LOL_VLLM_PORT="$PORT2" daemon &
  local P2=$!
  check "serve.sh at the other root starts (not 'already running')" wait_answers 30 "$PORT2"
  check "status.sh at the other root sees its own server" bash -c "st() { LOL_VLLM_ROOT='$ROOT2' bash '$D/status.sh'; }; st | grep -qx 'running=$P2'"
  bash "$D/stop.sh" > /dev/null; LOL_VLLM_ROOT="$ROOT2" bash "$D/stop.sh" > /dev/null
  check "both stop when asked at their own root (143)" bash -c "$(declare -f alive); for _ in \$(seq 1 50); do alive $P || alive $P2 || exit 0; sleep 1; done; exit 1"
  wait $P $P2 2>/dev/null
}

t_timelimit() {
  echo "a download at the farm's time limit (vllm.js install): install.sh, hf and tee all stop, nothing left recorded"
  command -v node >/dev/null || { echo "  (skipped: no node)"; return; }
  # Killing only the farm's child (bash here) left hf and tee downloading, unrecorded (review 2026-10-07; seen here).
  local J='require(process.argv[1]).install({ platform: "linux", root: process.argv[2], port: 1 }, { steps: "model", repo: "org/Slow", folder: "Slow", timeoutMs: 4000 }).then((r) => { console.log(JSON.stringify(r)); process.exit(0); });'
  # Another program's `sleep 300` on this computer is not this download's hf, and must not fail the test.
  env -u LOL_VLLM_ROOT sleep 300 & local OTHER=$!
  FAKE_HF=slow node -e "$J" "$D/../src/vllm.js" "$ROOT" > "$OUT" 2>&1
  sleep 1
  check "it says so: still not done after 4 seconds" grep -qF '"error":"it was still not done after 4 seconds"' "$OUT"
  check "nothing of it left: install.sh, hf, tee, its pgid file" download_gone
  kill "$OTHER"; wait "$OTHER" 2>/dev/null
}
download_gone() {   # hf is the fake's `sleep 300`: one with this root in its environment (as lifecycle step 21 looks)
  ! pgrep -f 'install\.sh org/Slow' > /dev/null && ! pgrep -f "[t]ee $ROOT/logs/download.last" > /dev/null || return 1
  local p; for p in $(pgrep -fx 'sleep 300'); do
    tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -qxF "LOL_VLLM_ROOT=$ROOT" && { echo "    hf still runs: $p"; return 1; }
  done
  [ ! -e "$ROOT/run/install.pgid" ]
}

for t in $TESTS; do clean; "t_$t"; done
clean
echo "$pass passed, $fail failed"
exit "$fail"
