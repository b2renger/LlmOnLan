#!/bin/bash
# What a vLLM start says about memory, and what its speculative decoding achieved (HyperQwen evaluation, night n° 10):
#   hq_loginfo.sh <vLLM log> [the server's start time, as the log prints it: "11-18 21:26"]
# Run in WSL. Prints the KV pool, the people it holds at 32k and 64k, and the last speculative-decoding metrics.
LOG="$1"; SINCE="${2:-}"
lines() { if [ -n "$SINCE" ]; then awk -v s="$SINCE" 'index($0, s) { on = 1 } on' "$LOG"; else cat "$LOG"; fi; }
lines | grep -aE "GPU KV cache size|Maximum concurrency|speculative_config=|Model loading took" | sed 's/^.*\] //' | cut -c1-200 | tail -6
pool=$(lines | grep -aoE "GPU KV cache size: [0-9,]+ tokens" | tail -1 | grep -oE "[0-9,]+" | tr -d ,)
[ -n "$pool" ] && echo "pool $pool tokens: $((pool / 32768)) people at 32k, $((pool / 65536)) at 64k (the pool alone; the GatedDeltaNet state is apart)"
lines | grep -aE "SpecDecoding metrics|acceptance length|Mean acceptance" | tail -3 | sed 's/^.*\] //' | cut -c1-260
