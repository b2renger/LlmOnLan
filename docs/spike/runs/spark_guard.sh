#!/bin/bash
# DGX Spark guard for unattended sweeps: logs temp/clock/power/memory every 10 s, and stops the spike's engine
# (vLLM or llama-server, only the ones our stop scripts started) when unified memory runs low or the GPU
# overheats. A unified-memory OOM is what wedged this box's GPU at 702 MHz on 2026-09-16 (fixed only by a cold
# power drain), so memory is guarded hard.
#   spark_guard.sh <csv> [min_avail_gb=8] [max_temp_c=90]
OUT="$1"; MINAV="${2:-8}"; MAXT="${3:-90}"
D="$(cd "$(dirname "$0")/.." && pwd)"
echo "time,temp_c,sm_mhz,power_w,mem_used_gb,mem_avail_gb" >> "$OUT"
while :; do
  g=$(nvidia-smi --query-gpu=temperature.gpu,clocks.sm,power.draw --format=csv,noheader,nounits | tr -d ' ')
  av=$(awk '/^MemAvailable:/{printf "%d", $2/1048576}' /proc/meminfo)
  used=$(free -g | awk '/^Mem:/{print $3}')
  echo "$(date +%H:%M:%S),$g,$used,$av" >> "$OUT"
  t=${g%%,*}
  if [ "$av" -lt "$MINAV" ] || [ "${t:-0}" -ge "$MAXT" ]; then
    echo "[guard] $(date -Is) TRIP avail=${av}G temp=${t}C: stopping engines" >> "$OUT"
    bash "$D/stop_vllm.sh" >> "$OUT" 2>&1
    bash "$D/stop_llamacpp.sh" >> "$OUT" 2>&1
    touch "${OUT%.csv}.tripped"
  fi
  sleep 10
done
