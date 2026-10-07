#!/bin/bash
# Stop the vLLM server serve.sh started from $LOL_VLLM_ROOT (default ~/lol-vllm): TERM its process group (vLLM,
# EngineCore, the relay, the watchdog), wait up to 40 s, then KILL what is left. Touches only that group.
#   bash stop.sh          (Windows: wsl -d Ubuntu -- bash /mnt/c/<path to the repo>/farm/vllm/stop.sh)
#   bash stop.sh install  stops a running install.sh (its download included) the same way.
# Exit 0 = nothing of that group is left; 1 = something survived the KILL (the files stay, so a retry finds it).
ROOT="${LOL_VLLM_ROOT:-$HOME/lol-vllm}"; ROOT="${ROOT/#\~/$HOME}"
if [ "${1:-}" = install ]; then F="$ROOT/run/install.pgid"; LEADER='install\.sh'; LEFT=("$F")
else F="$ROOT/run/vllm.pgid"; LEADER='serve\.sh'; LEFT=("$F" "$ROOT/run/vllm.sock"); fi
[ -f "$F" ] || { echo "No process recorded in $F."; exit 0; }
G=$(cat "$F")
# Only a group whose leader is that script is ours: a file left by a power cut or a WSL shutdown can name an
# unrelated process group after the next boot, and that one must never be killed.
if ! grep -qa "$LEADER" "/proc/$G/cmdline" 2>/dev/null; then
  echo "Process group $G is not a running ${LEADER/\\/} (a file left by an unclean stop): removing it."
  rm -f "${LEFT[@]}"; exit 0
fi
pgrep -g "$G" >/dev/null || { echo "Process group $G is already gone."; rm -f "${LEFT[@]}"; exit 0; }
echo "Stopping process group $G: $(pgrep -g "$G" | tr '\n' ' ')"
kill -TERM -- "-$G" 2>/dev/null
for _ in $(seq 1 40); do pgrep -g "$G" >/dev/null || break; sleep 1; done
pgrep -g "$G" >/dev/null && { echo "Still running after 40 s: KILL."; kill -KILL -- "-$G" 2>/dev/null; sleep 1; }
if pgrep -g "$G" >/dev/null; then echo "Still left in group $G: $(pgrep -ag "$G" | tr '\n' ';')"; exit 1; fi
rm -f "${LEFT[@]}"
echo "No process left in group $G."
