"""Per-round TTFT / decode stats from a bench JSON saved with per-request records (followup profile).
   python runs/round_stats.py results/<file>.json"""
import json, sys
sys.path.insert(0, __file__.rsplit("runs", 1)[0])
from spike_bench import pct
for f in sys.argv[1:]:
    d = json.load(open(f, encoding="utf-8"))
    print(f.split("/")[-1])
    for l in d["levels"]:
        rq = [r for r in l.get("requests_detail", []) if r["ok"] and not r.get("cold_load")]
        for rd in sorted({r["round"] for r in rq}):
            t = [r["ttft"] for r in rq if r["round"] == rd]
            dec = [r["decode_tps"] for r in rq if r["round"] == rd and r["decode_tps"]]
            ok = pct(t, 95) < 5 and pct(dec, 10) >= 15
            print("  ctx~%-7s c=%-4s round %d: ttft p50/p95 %.2f/%.2f s  decode p10 %.1f  %s" % (
                int(l["prompt_tokens_mean"] or 0), l["concurrency"], rd, pct(t, 50), pct(t, 95), pct(dec, 10), "PASS" if ok else "-"))
