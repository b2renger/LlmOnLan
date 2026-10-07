#!/bin/bash
# What the farm needs to know about vLLM on this computer, as key=value lines (farm/src/vllm.js parseStatus).
# Read-only: it starts, stops and creates nothing. Env: LOL_VLLM_ROOT (default ~/lol-vllm), LOL_VLLM_ROOTS (more
# roots to look for an install in, colon-separated).
#   home= arch= root= distro= uv= curl=      this Linux, and the tools install.sh needs
#   gpu=<name>, <MiB total>, <MiB free>, <compute capability>   (no line: nvidia-smi sees no GPU)
#   mem_total_kb= mem_available_kb= disk_free_kb=   (the disk under the root)
#   install=<root> <vLLM version>             one per root with a vLLM, and venv_link=<root> when its .venv is a link
#   model=<folder> <kB> vision=<0|1> native=<window> partial=<0|1>   one per folder in <root>/hf
#   running=<pgid>, then env=LOL_VLLM_…=, arg=<each `vllm serve` argument, the model first>, ready=1
#   found=<root> <port> <pgid>                every serve.sh running on this computer, from any root
#   guard=<the memory guard's last line>  installing=<pgid>  managed=1 (the farm owns the root)
set -u
ex() { echo "${1/#\~/$HOME}"; }
leader() { [ -n "$1" ] && grep -qa "$2" "/proc/$1/cmdline" 2>/dev/null; }
ROOT=$(ex "${LOL_VLLM_ROOT:-$HOME/lol-vllm}")
echo "home=$HOME"; echo "arch=$(uname -m)"; echo "root=$ROOT"; echo "distro=${WSL_DISTRO_NAME:-}"
echo "uv=$(command -v uv || { [ -x "$HOME/.local/bin/uv" ] && echo "$HOME/.local/bin/uv"; })"
echo "curl=$(command -v curl)"
g=$(nvidia-smi --query-gpu=name,memory.total,memory.free,compute_cap --format=csv,noheader,nounits 2>/dev/null | head -1)
[ -n "$g" ] && echo "gpu=$g"
awk '/^MemTotal:/{print "mem_total_kb=" $2} /^MemAvailable:/{print "mem_available_kb=" $2}' /proc/meminfo
d="$ROOT"; while [ ! -d "$d" ]; do d=$(dirname "$d"); done   # the root may not exist yet
echo "disk_free_kb=$(df -Pk "$d" | awk 'NR==2{print $4}')"
seen=:
IFS=: read -ra MORE <<< "${LOL_VLLM_ROOTS:-}"
for r in "$ROOT" "${MORE[@]}"; do
  r=$(ex "$r"); case "$seen" in *":$r:"*) continue;; esac; seen="$seen$r:"
  [ -x "$r/.venv/bin/vllm" ] || continue
  v=$(ls -d "$r"/.venv/lib/python3*/site-packages/vllm-*.dist-info 2>/dev/null | tail -1); v=${v##*/vllm-}
  echo "install=$r ${v%.dist-info}"
  [ -L "$r/.venv" ] && echo "venv_link=$r"
done
for m in "$ROOT"/hf/*/; do
  [ -d "$m" ] || continue
  c="$m/config.json"; inc=$(find "$m" -name '*.incomplete' 2>/dev/null | head -1)
  [ -f "$c" ] || [ -n "$inc" ] || continue   # a folder that is not a model
  vis=0; grep -q '"vision_config"' "$c" 2>/dev/null && vis=1
  nat=$(grep -o '"max_position_embeddings": *[0-9]*' "$c" 2>/dev/null | head -1 | grep -o '[0-9]*$')
  part=0; { [ -n "$inc" ] || [ ! -f "$c" ]; } && part=1
  echo "model=$(basename "$m") $(du -sk "$m" | cut -f1) vision=$vis native=${nat:-} partial=$part"
done
G=$(cat "$ROOT/run/vllm.pgid" 2>/dev/null)
if leader "$G" 'serve\.sh'; then
  echo "running=$G"
  tr '\0' '\n' < "/proc/$G/environ" 2>/dev/null | grep -E '^LOL_VLLM_(PORT|MIN_FREE_GB|ARGS_B64)=' | sed 's/^/env=/'
  p=$(pgrep -o -g "$G" -f ' serve ')   # vLLM's API server: `… vllm serve <model> <flags>`
  [ -n "$p" ] && tr '\0' '\n' < "/proc/$p/cmdline" | sed -n '/^serve$/,$p' | tail -n +2 | sed 's/^/arg=/'
  curl -sf -o /dev/null -m 5 --unix-socket "$ROOT/run/vllm.sock" http://localhost/health && echo "ready=1"
fi
for p in $(pgrep -f 'serve\.sh'); do
  [ "$(cut -d' ' -f5 "/proc/$p/stat" 2>/dev/null)" = "$p" ] && leader "$p" 'serve\.sh' || continue   # a group leader
  e=$(tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null)
  r=$(sed -n 's/^LOL_VLLM_ROOT=//p' <<< "$e"); pt=$(sed -n 's/^LOL_VLLM_PORT=//p' <<< "$e")
  echo "found=$(ex "${r:-$HOME/lol-vllm}") ${pt:-8100} $p"
done
[ -e "$ROOT/run/vllm.guard" ] && echo "guard=$(grep '^\[guard\]' "$ROOT/logs/vllm.log" 2>/dev/null | tail -1)"
I=$(cat "$ROOT/run/install.pgid" 2>/dev/null)
leader "$I" 'install\.sh' && echo "installing=$I"
[ -e "$ROOT/run/managed-by-farm" ] && echo "managed=1"
exit 0
