#!/bin/bash
# Stop the vLLM server serve.sh started from $LOL_VLLM_ROOT (default ~/lol-vllm): TERM its process group (vLLM,
# EngineCore, the relay, the watchdog), wait up to 40 s, then KILL what is left. Touches only that group.
#   bash stop.sh          (Windows: wsl -d Ubuntu -- bash /mnt/c/<path to the repo>/farm/vllm/stop.sh)
ROOT="${LOL_VLLM_ROOT:-$HOME/lol-vllm}"
F="$ROOT/run/vllm.pgid"
[ -f "$F" ] || { echo "No server recorded in $F."; exit 0; }
G=$(cat "$F")
pgrep -g "$G" >/dev/null || { echo "Process group $G is already gone."; rm -f "$F" "$ROOT/run/vllm.sock"; exit 0; }
echo "Stopping process group $G: $(pgrep -g "$G" | tr '\n' ' ')"
kill -TERM -- "-$G" 2>/dev/null
for _ in $(seq 1 40); do pgrep -g "$G" >/dev/null || break; sleep 1; done
pgrep -g "$G" >/dev/null && { echo "Still running after 40 s: KILL."; kill -KILL -- "-$G" 2>/dev/null; sleep 1; }
rm -f "$F" "$ROOT/run/vllm.sock"
pgrep -af "vllm serve|EngineCore" || echo "No vLLM process left."
