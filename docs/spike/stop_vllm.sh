#!/bin/bash
# Stop the spike's vLLM server: TERM its process group, wait, then KILL the group and any descendants left.
# Only touches the group recorded by serve_vllm.sh (never other vLLM instances on the box).
ROOT="${LOL_SPIKE_ROOT:-$HOME/lol-spike}"
F="$ROOT/run/vllm.pgid"
[ -f "$F" ] || { echo "no $F"; exit 0; }
G=$(cat "$F")
desc() { local p; for p in $(pgrep -P "$1"); do echo "$p"; desc "$p"; done; }
PIDS="$(pgrep -g "$G") $(desc "$G")"
echo "stopping group $G: $(echo $PIDS | tr '\n' ' ')"
kill -TERM -- "-$G" 2>/dev/null
for i in $(seq 1 30); do
  alive=0
  for p in $PIDS; do kill -0 "$p" 2>/dev/null && alive=1; done
  [ $alive = 0 ] && break
  sleep 1
done
for p in $PIDS; do kill -0 "$p" 2>/dev/null && { echo "SIGKILL $p ($(ps -o comm= -p "$p"))"; kill -KILL "$p"; }; done
kill -KILL -- "-$G" 2>/dev/null
rm -f "$F"
sleep 1
pgrep -af "vllm serve|EngineCore" || echo "no vllm/EngineCore processes left"
