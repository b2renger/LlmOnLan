"""Build measured.json from the spike's raw results (read-only on the repo).

Per-level numbers are the harness's own (spike_bench.summarize_level fields, i.e. what `spike_bench.py summarize`
prints); per-round follow-up numbers use the same computation as runs/round_stats.py (spike_bench.pct over ok,
non-cold requests of one round). Run: python build_measured.py
"""
import json, glob, os, re, math, sys, csv, datetime as dt
from collections import defaultdict

REPO = r"C:/Users/ateliernum/Documents/code/LlmOnLan"
SPIKE = REPO + "/docs/spike"
RES = SPIKE + "/results"
OUT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SPIKE)
from spike_bench import pct  # the harness's percentile (linear interpolation)

TTFT_MAX, MIN_TPS = 5.0, 15.0


def r(x, n):
    return None if x is None else round(x, n)


# ------------------------------------------------------------------------------------------------ labels -> configs
def parse_label(label):
    box = "pro6000" if label.startswith("pro6000") else "spark"
    engine = "vllm" if "vllm030" in label else "llamacpp"
    model = "qwen36" if "qwen36" in label else "nemotron" if "nemotron" in label else "qwen38"
    variant = None
    m = re.search(r"-p(8|16)$", label)
    if m:
        variant = "p" + m.group(1)
    cid = "%s/%s/%s" % (box, engine, model) + ("/" + variant if variant else "")
    return box, engine, model, variant, cid


def ctx_bucket(tokens):
    return "32k" if tokens < 45000 else "64k" if tokens < 90000 else "128k"


def profile_id(d):
    p, pp = d["profile"], d["profile_params"]
    if p == "chat":
        return "chat_nothink" if (d["thinking"] == "off" and d.get("natural")) else "chat"
    if p == "agent":
        return "agent"
    if p == "long":
        return "cold_" + ctx_bucket(pp["prompt_tokens"])
    if p.startswith("followup"):
        return "followup_%s_%s" % (ctx_bucket(pp["prompt_tokens"]), "append" if p.endswith("append") else "replace")
    raise ValueError(p)


def metrics(l):
    sm = l.get("server_metrics") or {}
    g, c = sm.get("gauges_max") or {}, sm.get("counters_delta") or {}
    out = {}
    kv = [v for k, v in g.items() if "kv_cache_usage" in k]
    if kv:
        out["kv_use_max"] = r(kv[0], 4)
    if "vllm:num_preemptions_total" in c:
        out["preempt"] = int(c["vllm:num_preemptions_total"])
    if sm.get("prefix_cache_hit_rate") is not None:
        out["prefix_hit"] = sm["prefix_cache_hit_rate"]
    for k in ("vllm:num_requests_waiting", "llamacpp:requests_deferred"):
        if k in g:
            out["waiting_max"] = int(g[k])
    gpu = l.get("gpu") or {}
    if gpu.get("power_w_mean") is not None:
        out["power_w"] = gpu["power_w_mean"]
    if gpu.get("vram_used_mib_max") is not None:
        out["vram_mib"] = int(gpu["vram_used_mib_max"])
    return out


def round_block(rq, rd):
    t = [x["ttft"] for x in rq if x["round"] == rd and x["ttft"] is not None]
    dec = [x["decode_tps"] for x in rq if x["round"] == rd and x["decode_tps"]]
    if not t:
        return None
    b = {"ttft_p50": r(pct(t, 50), 3), "ttft_p95": r(pct(t, 95), 3),
         "dec_p10": r(pct(dec, 10), 2), "dec_p50": r(pct(dec, 50), 2), "n": len(t)}
    b["pass"] = bool(b["ttft_p95"] is not None and pct(t, 95) < TTFT_MAX and dec and pct(dec, 10) >= MIN_TPS)
    return b


def level_plain(l, run):
    e = {"c": l["concurrency"], "run": run, "n": l["requests"], "err": l["errors"],
         "prompt_tok": l["prompt_tokens_mean"], "out_tok": l["completion_tokens_mean"],
         "ttft_p50": l["ttft_p50"], "ttft_p95": l["ttft_p95"],
         "ttft_p95_r0": l.get("ttft_p95_round0"), "ttft_p50_steady": l.get("ttft_p50_steady"),
         "ttft_p95_steady": l.get("ttft_p95_steady"),
         "dec_p50": l["decode_tps_median"], "dec_p10": l["decode_tps_p10"], "dec_p10_steady": l.get("decode_tps_p10_steady"),
         "agg_tps": l["agg_tps"],
         "pass_every": bool(l["pass_p10"]), "pass_steady": l.get("pass_steady"), "pass_median": bool(l["pass_median"])}
    e.update(metrics(l))
    return {k: v for k, v in e.items() if v is not None}


def level_followup(l, run):
    rq = [x for x in l.get("requests_detail", []) if x["ok"] and not x.get("cold_load")]
    r1, r2 = round_block(rq, 1), round_block(rq, 2)
    later = [x for x in rq if x["round"] >= 2]
    e = {"c": l["concurrency"], "run": run, "n": l["requests"], "err": l["errors"], "prompt_tok": l["prompt_tokens_mean"],
         "out_tok": l["completion_tokens_mean"],
         # pooled = all scored follow-up turns (rounds >= 1), the harness's own level fields (what summarize prints)
         "ttft_p50": l["ttft_p50"], "ttft_p95": l["ttft_p95"], "dec_p50": l["decode_tps_median"], "dec_p10": l["decode_tps_p10"],
         "agg_tps": l["agg_tps"], "pass_pooled": bool(l["pass_p10"]),
         "r1": r1, "r2": r2,
         "cold_load": l.get("cold_load"), "cached_tok": l.get("cached_tokens_mean")}
    if r1 is None or r2 is None:
        e["pass_every"] = e["pass_steady"] = None
    else:
        # every turn = the first follow-up after the room loaded its contexts AND the later one both pass;
        # steady = the later turn (round 2) passes (RESULTS.md's every-turn / steady for follow-ups)
        e["pass_every"] = bool(r1["pass"] and r2["pass"] and not l["errors"])
        e["pass_steady"] = bool(r2["pass"] and not l["errors"])
    if l["errors"]:
        e["error_samples"] = l.get("error_samples")
    e.update(metrics(l))
    return {k: v for k, v in e.items() if v is not None}


def people(levels, key):
    tested = sorted({x["c"] for x in levels if x.get(key) is not None})
    if not tested:
        return None
    ok = sorted({x["c"] for x in levels if x.get(key)})
    bad = sorted({x["c"] for x in levels if x.get(key) is False})
    p = max(ok) if ok else 0
    above = [c for c in bad if c > p]
    fail = min(above) if above else None
    if p == 0:
        label = "0" if min(tested) == 1 else "< %d" % min(tested)
    elif fail is None:
        label = "≥ %d" % p
    else:
        label = str(p)
    out = {"pass": p, "fail": fail, "label": label, "tested": tested}
    below_bad = [c for c in bad if c < p]
    if below_bad:
        out["nonmonotonic_fail_below"] = below_bad
    return out


# ------------------------------------------------------------------------------------------------ load raw files
files = sorted(f for f in glob.glob(RES + "/*.json"))
bench, quality, kvs = defaultdict(list), defaultdict(dict), {}
for f in files:
    d = json.load(open(f, encoding="utf-8"))
    base = os.path.basename(f)
    label = d.get("label") or base.split("__")[0]
    if base.endswith("__kv.json"):
        kvs[parse_label(base.split("__")[0])[4]] = d
        continue
    box, engine, model, variant, cid = parse_label(label)
    if d["kind"] == "bench":
        bench[cid].append((d.get("started"), base, label, d))
    elif d["kind"] == "quality":
        quality[cid][d["thinking"]] = (base, d)

# ------------------------------------------------------------------------------------------------ static facts
POOL_58 = 62277025792
VLLM_KV = {  # vLLM 0.30 hybrid paging (ESTIMATES_2026-10-05.md § Method 2; Qwen3.8 page derived, see notes)
    "qwen36": {"page_bytes": 21463040, "block_tokens": 2096, "fixed_blocks_per_request": 6,
               "attn_kv_bytes_per_token": 10240,
               "page_note": "2,096-token block x 10 attention layers x 1,024 B fp8 (ESTIMATES Method 2)"},
    "nemotron": {"page_bytes": 12828672, "block_tokens": 4176, "fixed_blocks_per_request": 8,
                 "attn_kv_bytes_per_token": 3072,
                 "page_note": "4,176-token block x 6 attention layers x 512 B (ESTIMATES Method 2)"},
    "qwen38": {"page_bytes": 51380224, "block_tokens": 1568, "fixed_blocks_per_request": 6,
               "attn_kv_bytes_per_token": 32768,
               "page_note": "DERIVED here, not stated in ESTIMATES: 1,568 x 32,768 B. It reproduces floor(58 GiB/page) = 1,212 "
                            "blocks, the start-up line 13.47x at 131,072 (1,212/(84+6)) and ESTIMATES' 46.6 at a 30k conversation "
                            "(1,212/26). Any page in (51,341,323, 51,383,685] B gives the same 1,212."},
}
MODELS = {
    "qwen36": {"name": "Qwen3.6-35B-A3B", "arch": "hybrid GatedDeltaNet MoE, ~3B active", "vision": True,
               "vllm_checkpoint": "nvidia/Qwen3.6-35B-A3B-NVFP4 (NVFP4; experts W4A16 via Marlin)",
               "vllm_weights_gib": 20.37, "disk_gb": 23.46, "gguf_tested": None,
               "vendor_swe_verified": 73.4,
               "vllm_flags": "--kv-cache-dtype fp8 --reasoning-parser qwen3 --tool-call-parser qwen3_xml"},
    "nemotron": {"name": "NVIDIA Nemotron 3.5 Lightning 30B-A3B", "arch": "Mamba-2 + MoE, 6 attention layers of 52, ~3B active",
                 "vision": False,
                 "vllm_checkpoint": "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 (experts W4A16 via Marlin)",
                 "vllm_weights_gib": 17.82, "disk_gb": 21.58, "gguf_tested": "Q4_K_M (Ollama blob)",
                 "vendor_swe_verified": 52.8,
                 "vllm_flags": "--kv-cache-dtype fp8 --mamba-backend flashinfer --reasoning-parser nemotron_v3 --tool-call-parser qwen3_coder"},
    "qwen38": {"name": "Qwen3.8-27B", "arch": "dense, hybrid attention", "vision": None,
               "vllm_checkpoint": "nvidia/Qwen3.8-27B-NVFP4 (W4A4 dense, native FP4 GEMM via FlashInferCutlassNvFp4LinearKernel)",
               "vllm_weights_gib": 19.92, "disk_gb": 21.95, "gguf_tested": "Q4_K_M (Ollama blob, no mmproj)",
               "vendor_swe_verified": None,
               "vllm_flags": "--kv-cache-dtype fp8_e4m3 --reasoning-parser qwen3 --tool-call-parser qwen3_coder"},
}
for k, v in VLLM_KV.items():
    MODELS[k]["vllm_kv"] = dict(v, recurrent_state_mb_per_request=round(v["fixed_blocks_per_request"] * v["page_bytes"] / 1e6, 1))

HARDWARE = {
    "pro6000": {"name": "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", "measured": True,
                "memory_gb": 96, "memory_visible_mib": 97887, "memory_type": "GDDR7 ECC, 512-bit",
                "bandwidth_gbs": 1792, "fp4_tops_sparse": 4000, "fp32_tflops": 125, "cuda_cores": 24064, "sms": 188,
                "power_w": 600, "interface": "PCIe 5.0 x16", "arch": "GB202, sm_120",
                "price_eur_ttc": 17679.95, "price_eur_ht": 14733, "price_where": "LDLC.com (OEM, 7-15 days)", "price_date": "2026-10-05",
                "price_notes": "card only, needs a host PC; ESTIMATES assumes ~EUR 3,000 for a host when one is needed (an assumption)",
                "needs_host": True, "bandwidth_ratio": 1.0, "compute_ratio": 1.0,
                "bench_host": {"hostname": "AN-A6000PRO", "dates": "2026-10-04",
                               "os": "Windows 11 + WSL2 Ubuntu 26.04 (vLLM, 16 vCPU / 94 GB RAM to WSL); native Windows (llama.cpp)",
                               "driver": "596.36 (CUDA 13.2)", "exclusive_gpu": True,
                               "desktop_vram_gib": 1.7, "notes": "ceiling numbers: ComfyUI and the live farm were stopped"}},
    "spark": {"name": "NVIDIA DGX Spark (GB10, Founders Edition)", "measured": True,
              "memory_gb": 128, "memory_visible_gib": 121, "memory_type": "LPDDR5x unified, 256-bit",
              "bandwidth_gbs": 273, "fp4_tops_sparse": 1000, "cuda_cores": 6144, "sms": 48,
              "power_w": "GB10 140 W TDP, 240 W PSU", "interconnect": "ConnectX-7 200 Gb/s", "arch": "GB10, sm_121, 20 Grace cores",
              "price_eur_ttc": 6599.95, "price_eur_ht": 5500, "price_where": "LDLC.com (PNY Founders, +15 days)", "price_date": "2026-10-05",
              "price_oem": {"eur_ht_from": 5038, "eur_ttc_from_approx": 6046, "what": "Lenovo ThinkStation PGX 1 TB (pi3g.com, 2026-09-24)"},
              "price_notes": "complete computer, no host needed; a 64 GB OEM-only GB10 exists - check extra units are 128 GB",
              "needs_host": False, "bandwidth_ratio": 0.152, "compute_ratio": 0.25,
              "bench_host": {"hostname": "spark-59f9", "dates": "2026-10-05 13:51 to 2026-10-06 11:37",
                             "os": "DGX OS 7.5.0, kernel 6.17.0-1032-nvidia, native Linux", "driver": "580.173.02 (CUDA 13.0)",
                             "exclusive_gpu": True, "resident_other_gb": 2.7,
                             "notes": "every number taken after a cold power drain cleared a 702 MHz clock latch (since a 2026-09-16 "
                                      "unified-memory OOM); clock held 2.4-2.48 GHz; the 702 MHz numbers were deleted"},
              "pair_note": "The owner received a second Spark (2026-10-07). Two Sparks link through ConnectX-7 200 Gb/s. NOT measured: "
                           "no tensor/pipeline-parallel or two-box run exists in the spike."},
    "pro6000_maxq": {"name": "RTX PRO 6000 Blackwell Max-Q", "measured": False, "memory_gb": 96, "bandwidth_gbs": 1792,
                     "fp4_tops_sparse": 3511, "fp32_tflops": 110, "power_w": 300, "price_eur_ttc": 17709.95,
                     "price_where": "LDLC.com (in stock)", "price_date": "2026-10-05", "needs_host": True,
                     "bandwidth_ratio": 1.0, "compute_ratio": 0.878},
    "pro5500": {"name": "RTX PRO 5500 Blackwell", "measured": False, "memory_gb": 84, "bandwidth_gbs": 1398,
                "fp4_tops_sparse": None, "fp4_tops_note": "unpublished; est. ~3,350-3,600", "power_w": 600,
                "price_eur_ttc": 16469.95, "price_where": "LDLC.com (retail; NVIDIA says 'coming soon')", "price_date": "2026-10-05",
                "needs_host": True, "bandwidth_ratio": 0.780, "compute_ratio": [0.84, 0.90]},
    "pro5000_72": {"name": "RTX PRO 5000 Blackwell 72 GB", "measured": False, "memory_gb": 72, "bandwidth_gbs": 1344,
                   "fp4_tops_sparse": 2064, "power_w": 300, "price_eur_ttc": 11193.70,
                   "price_where": "PCComponentes.fr marketplace seller (medium reliability)", "price_date": "2026-10-05",
                   "needs_host": True, "bandwidth_ratio": 0.750, "compute_ratio": 0.516},
    "pro5000_48": {"name": "RTX PRO 5000 Blackwell 48 GB", "measured": False, "memory_gb": 48, "bandwidth_gbs": 1344,
                   "fp4_tops_sparse": 2064, "power_w": 300, "price_eur_ttc": 9939.95,
                   "price_where": "LDLC.com / Materiel.net", "price_date": "2026-10-05",
                   "needs_host": True, "bandwidth_ratio": 0.750, "compute_ratio": 0.516},
}

LLAMA_ARGV = "-fa 1 --cache-type-k q8_0 --cache-type-v q8_0 --cache-reuse 256 --cache-ram 24576 --kv-unified --slot-prompt-similarity 0.4 --jinja"
LLAMA_POOL = {  # --ctx-size from results/logs/*.cmd; per-slot cap from the server log (n_ctx_slot)
    ("nemotron", "p8"): (1048576, 1048576), ("nemotron", "p16"): (2097152, 1048576),
    ("qwen38", "p8"): (262144, 262144), ("qwen38", "p16"): (524288, 262144),
}

# ------------------------------------------------------------------------------------------------ Spark guard CSV
guard, guard_events = [], []
with open(RES + "/logs/spark_guard_thermal_memory.csv", encoding="utf-8") as fh:
    day, prev = dt.date(2026, 10, 5), None
    for row in csv.DictReader(fh):
        if not re.match(r"^\d\d:\d\d:\d\d$", row["time"] or ""):
            if (row["time"] or "").startswith("[guard]"):
                guard_events.append(row["time"])
            continue
        t = dt.datetime.strptime(row["time"], "%H:%M:%S").time()
        if prev and t < prev:
            day += dt.timedelta(days=1)
        prev = t
        guard.append((dt.datetime.combine(day, t), int(row["temp_c"]), int(row["sm_mhz"]), float(row["power_w"]),
                      int(row["mem_used_gb"]), int(row["mem_avail_gb"])))


def guard_stats(windows):
    rows = [g for g in guard if any(a <= g[0] <= b for a, b in windows)]
    if not rows:
        return None
    mem = sorted(g[4] for g in rows)
    load = [g for g in rows if g[3] > 30]
    out = {"mem_used_gb_max": mem[-1], "mem_used_gb_p50": mem[len(mem) // 2], "mem_used_gb_min": mem[0],
           "mem_avail_gb_min": min(g[5] for g in rows), "temp_c_max": max(g[1] for g in rows), "samples": len(rows)}
    if load:
        mhz = sorted(g[2] for g in load)
        out["sm_mhz_under_load_p5_p50"] = [mhz[int(0.05 * (len(mhz) - 1))], mhz[len(mhz) // 2]]
        out["power_w_under_load_max"] = max(g[3] for g in load)
    return out


# ------------------------------------------------------------------------------------------------ build configs
configs = []
for cid in sorted(set(bench) | set(quality)):
    box, engine, model, variant = cid.split("/")[0], cid.split("/")[1], cid.split("/")[2], (cid.split("/")[3] if cid.count("/") == 3 else None)
    runs = sorted(bench.get(cid, []), key=lambda x: x[0] or "")
    cfg = {"id": cid, "box": box, "engine": engine, "model": model, "variant": variant,
           "engine_version": "vLLM 0.30.0 (torch 2.13.0+cu132, FlashInfer 0.6.18.post1)" if engine == "vllm" else "llama.cpp b10670 (the Farm app's build)",
           "weights": ("NVFP4 (" + MODELS[model]["vllm_checkpoint"] + ")") if engine == "vllm" else "Q4_K_M GGUF",
           "runs": [], "profiles": {}}
    if engine == "vllm":
        cfg["server_flags"] = ("--max-model-len 131072 --max-num-seqs 192 --kv-cache-memory-bytes 62277025792 --enable-prefix-caching "
                               "--mamba-cache-mode align --enable-auto-tool-choice " + MODELS[model]["vllm_flags"])
    else:
        pool, cap = LLAMA_POOL[(model, variant)]
        cfg["server_flags"] = "--parallel %s --ctx-size %d --n-gpu-layers 999 %s" % (variant[1:], pool, LLAMA_ARGV)
    prof_levels = defaultdict(list)
    for i, (started, base, label, d) in enumerate(runs):
        pid = profile_id(d)
        note = None
        if label.endswith("-seq192"):
            note = "server --max-num-seqs 192 (levels 64-192 and follow-ups)"
        elif cid == "pro6000/vllm/qwen36":
            note = "server --max-num-seqs 64 (first suite; RESULTS: levels <= 64 match the 192 server within noise)"
        if label.endswith("-coldtest"):
            note = "cold-load test run (replace mode, 8 users), separate label"
        cfg["runs"].append({"i": i, "file": base, "profile": pid, "rounds": d["args"].get("rounds"),
                            "started": started, "finished": d.get("finished"), **({"note": note} if note else {})})
        for l in d["levels"]:
            prof_levels[pid].append(level_followup(l, i) if pid.startswith("followup") else level_plain(l, i))
    for pid, lv in sorted(prof_levels.items()):
        lv.sort(key=lambda x: (x["c"], x["run"]))
        cfg["profiles"][pid] = {"levels": lv, "people_every": people(lv, "pass_every"),
                                "people_steady": people(lv, "pass_steady")}
        if pid.startswith("followup"):
            cfg["profiles"][pid]["people_pooled"] = people(lv, "pass_pooled")
    P = cfg["profiles"]

    def first_level(pid, c=1):
        for x in P.get(pid, {}).get("levels", []):
            if x["c"] == c:
                return x
        return None

    # ---- headline people (follow-ups prefer the --append run, as RESULTS.md's headline does)
    head = {}
    for key, pid in [("chat_4k", "chat"), ("agent_step", "agent"), ("chat_4k_thinking_off_natural", "chat_nothink")]:
        if pid in P:
            head[key] = {"every": P[pid]["people_every"], "steady": P[pid]["people_steady"], "profile": pid}
    for ctx in ("32k", "64k", "128k"):
        for mode in ("append", "replace"):
            pid = "followup_%s_%s" % (ctx, mode)
            if pid in P:
                head["followup_" + ctx] = {"every": P[pid]["people_every"], "steady": P[pid]["people_steady"], "profile": pid}
                break
        if "cold_" + ctx in P:
            pid = "cold_" + ctx
            head["cold_" + ctx] = {"every": P[pid]["people_every"], "steady": P[pid]["people_steady"], "profile": pid}
    cfg["people"] = head

    # ---- single user, cold prefill, peak aggregate
    su = {}
    for pid in ("chat", "agent"):
        x = first_level(pid)
        if x:
            su[pid] = {"decode_tps_p50": x["dec_p50"], "decode_tps_p10": x["dec_p10"], "ttft_p50_s": x["ttft_p50"],
                       "prompt_tok": x["prompt_tok"]}
    cfg["single_user"] = su
    cold = {}
    for ctx in ("32k", "64k", "128k"):
        x = first_level("cold_" + ctx)
        if x:
            cold[ctx] = {"ttft_p50_s": x["ttft_p50"], "ttft_p95_s": x["ttft_p95"], "prompt_tok": x["prompt_tok"],
                         "prefill_tps": r(x["prompt_tok"] / x["ttft_p50"], 0) if x["ttft_p50"] else None,
                         "decode_tps_after": x["dec_p50"]}
    cfg["cold_prefill_single_user"] = cold
    pk = {}
    for pid in ("agent", "chat", "chat_nothink"):
        lv = P.get(pid, {}).get("levels", [])
        if lv:
            b = max(lv, key=lambda x: x.get("agg_tps") or 0)
            pk[pid] = {"tps": b["agg_tps"], "c": b["c"], "dec_p10_there": b["dec_p10"], "top_c_tested": max(x["c"] for x in lv)}
    allv = [(x.get("agg_tps") or 0, p, x["c"]) for p, v in P.items() for x in v["levels"]]
    if allv:
        b = max(allv)
        pk["any"] = {"tps": b[0], "profile": b[1], "c": b[2]}
    cfg["peak_aggregate"] = pk

    # ---- quality
    q = {}
    for th, (base, d) in sorted(quality.get(cid, {}).items()):
        items = d["items"]
        q["thinking_" + th] = {
            "score": sum(1 for i in items if i["pass"]), "of": len(items), "by_kind": d["summary"],
            "completion_tokens": d["completion_tokens_total"], "wall_s": d["wall_s"],
            "max_tokens": d["sampling"]["max_tokens"],
            "hit_token_cap": sum(1 for i in items if i["finish"] == "length"),
            "client_timeouts": sum(1 for i in items if (i.get("reason") or "").startswith("error: TimeoutError")),
            "failed": [{"id": i["id"], "kind": i["kind"], "finish": i["finish"], "tokens": i["completion_tokens"],
                        "why": ("client timeout (no tokens recorded)" if (i.get("reason") or "").startswith("error: TimeoutError")
                                else "hit max_tokens" if i["finish"] == "length" else (i.get("reason") or "")[-90:].strip())}
                       for i in items if not i["pass"]],
            "file": base}
    cfg["quality"] = q

    # ---- memory
    mem = {}
    if box == "pro6000":
        v = [x["vram_mib"] for p in P.values() for x in p["levels"] if x.get("vram_mib")]
        if v:
            mem = {"source": "nvidia-smi max per level (incl. the ~1.7 GiB Windows desktop)",
                   "vram_mib_min": min(v), "vram_mib_max": max(v),
                   "vram_gib_range": [r(min(v) / 1024, 1), r(max(v) / 1024, 1)],
                   "vram_gb_range": [r(min(v) * 1.048576 / 1000, 1), r(max(v) * 1.048576 / 1000, 1)],
                   "of_visible_mib": 97887}
    else:
        wins = []
        for (_, base, label, d) in runs:
            a = dt.datetime.fromisoformat(d["started"])
            b = dt.datetime.fromisoformat(d["finished"]) if d.get("finished") else a + dt.timedelta(hours=1)
            wins.append((a, b))
        for th, (base, d) in quality.get(cid, {}).items():
            b = dt.datetime.fromisoformat(d["finished"])
            wins.append((b - dt.timedelta(seconds=d["wall_s"]), b))
        gs = guard_stats(wins)
        if gs:
            mem = {"source": "results/logs/spark_guard_thermal_memory.csv (free -g every 10 s) over this config's bench + quality windows; "
                             "whole-box unified memory, incl. ~2.7 GB of resident Farm sidecars and the OS",
                   **gs}
    cfg["memory"] = mem

    # ---- KV pool and capacity
    if engine == "vllm":
        kvj = kvs.get(cid, {})
        K = VLLM_KV[model]
        blocks = POOL_58 // K["page_bytes"]
        def per_req(tokens):
            return math.ceil(tokens / K["block_tokens"]) + K["fixed_blocks_per_request"]
        corr = {lab: r(blocks / per_req(t), 1) for lab, t in (("32k", 32768), ("64k", 65536), ("128k", 131072))}
        prof_sizes = {}
        for ctx in ("32k", "64k", "128k"):
            ls = [x["prompt_tok"] for pid in ("followup_%s_append" % ctx, "followup_%s_replace" % ctx) for x in P.get(pid, {}).get("levels", []) if x.get("prompt_tok")]
            if ls:
                t = round(sum(ls) / len(ls))
                prof_sizes[ctx] = {"tokens": t + 256, "people": r(blocks / per_req(t + 256), 1),
                                   "people_fill_088_093": [r(0.88 * blocks / per_req(t + 256), 1), r(0.93 * blocks / per_req(t + 256), 1)],
                                   "mb_per_person": r(per_req(t + 256) * K["page_bytes"] / 1e6, 1)}
        cfg["kv"] = {"pool_bytes": POOL_58, "pool_gib": 58.0, "kv_tokens_startup": kvj.get("kv_tokens"),
                     "startup_max_concurrency_131072": (kvj.get("max_concurrency") or {}).get("131072"),
                     "weights_gib": kvj.get("weights_gib"), "cuda_graphs_gib": kvj.get("cuda_graphs_gib"),
                     "blocks": blocks, "block_tokens": K["block_tokens"],
                     "people_naive_pool_tokens_div_window": (kvj.get("people_by_kv") or {}),
                     "people_corrected": corr,
                     "people_corrected_at_followup_profile_size": prof_sizes,
                     "mb_per_person_at_window": {lab: r(per_req(t) * K["page_bytes"] / 1e6, 1) for lab, t in (("32k", 32768), ("64k", 65536), ("128k", 131072))},
                     "formula": "people = floor(pool_bytes / page_bytes) / (ceil(context_tokens / block_tokens) + fixed_blocks_per_request); "
                                "ESTIMATES applies a 0.88-0.93 fill factor (0.93 = the highest fill that passed)"}
    else:
        pool, cap = LLAMA_POOL[(model, variant)]
        slots = int(variant[1:])
        cfg["kv"] = {"pool_tokens": pool, "slots": slots, "per_slot_cap_tokens": cap, "kv_type": "q8_0, --kv-unified",
                     "people_by_kv": {lab: min(slots, pool // t) for lab, t in (("32k", 32768), ("64k", 65536), ("128k", 131072))},
                     "formula": "min(--parallel slots, pool_tokens // context); requests beyond --parallel queue"}
    cfg["_win"] = (min(dt.datetime.fromisoformat(x[3]["started"]) for x in runs) if runs else None)
    configs.append(cfg)

# ---- Spark start-up memory: between the previous config's last window and this one's first, split into segments at
# every sample where unified memory drops below 20 GB (engine stopped); report each segment's peak.
sp = sorted([c for c in configs if c["box"] == "spark"], key=lambda c: c["_win"])
prev_end = guard[0][0]
for c in sp:
    first = c["_win"]
    for th, (base, d) in quality.get(c["id"], {}).items():
        first = min(first, dt.datetime.fromisoformat(d["finished"]) - dt.timedelta(seconds=d["wall_s"]))
    gap = [g for g in guard if prev_end < g[0] <= first]
    segs, cur = [], None
    for g in gap:
        if g[4] < 20:
            if cur:
                segs.append(cur)
            cur = None
            continue
        if cur is None:
            cur = {"from": g[0].strftime("%m-%d %H:%M:%S"), "peak_gb": g[4], "at": g[0].strftime("%m-%d %H:%M:%S")}
        elif g[4] > cur["peak_gb"]:
            cur["peak_gb"], cur["at"] = g[4], g[0].strftime("%m-%d %H:%M:%S")
    if cur:
        segs.append(cur)
    c["memory"]["startup_segments"] = segs
    ends = []
    for (_, base, label, d) in bench.get(c["id"], []):
        if d.get("finished"):
            ends.append(dt.datetime.fromisoformat(d["finished"]))
    prev_end = max(ends) if ends else first
for c in configs:
    c.pop("_win", None)

# ------------------------------------------------------------------------------------------------ assemble
doc = {
    "schema_version": 1,
    "generated": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    "what": "Every measured point of the LlmOnLan engine x model spike on an RTX PRO 6000 Blackwell (2026-10-04) and a DGX Spark "
            "(2026-10-05/06), normalised. No per-request rows. Estimates for cards not owned are NOT here (see ESTIMATES_2026-10-05.md); "
            "hardware facts for those cards are included for the explorer.",
    "pass_rule": {"ttft_p95_max_s": TTFT_MAX, "decode_p10_min_tps": MIN_TPS, "errors": 0,
                  "people": "largest passing tested concurrency",
                  "every_turn": "chat/agent/cold: all requests incl. each user's first (users start within 3 s); follow-ups: the first "
                                "follow-up after everyone loaded their context (round 1) AND the later one (round 2) both pass",
                  "steady": "chat/agent/cold: rounds >= 1 only; follow-ups: round 2 only (round_stats.py's per-round numbers)",
                  "pooled": "follow-ups only: the harness's level verdict over rounds 1+2 together (what summarize prints)",
                  "label": "'N' = N passed and the next tested level failed; '≥ N' = N was the highest level tested and passed; "
                           "'< N' = the lowest tested level N failed; '0' = 1 user failed"},
    "profiles": {
        "chat": {"prompt": "one ~4k-token unique message", "output_tokens": 512, "rounds": 2, "notes": "ignore_eos, max_tokens jittered +-20 %"},
        "chat_nothink": {"prompt": "~4k-token message, enable_thinking false", "output_tokens": "natural (model stops)", "rounds": 2,
                         "notes": "decode and aggregate not comparable with chat: replies are shorter"},
        "agent": {"prompt": "8k shared prefix (rules + 9 tool schemas) + ~2k unique, tools on", "output_tokens": 1024, "rounds": 2},
        "cold_32k/64k/128k": {"prompt": "a brand-new unique prompt of ~32k/64k/120k tokens", "output_tokens": 256, "rounds": 2},
        "followup_<ctx>_<mode>": {"prompt": "each user's own ~30k/62k/120k-token context already loaded (round 0, unscored), then a new "
                                            "question per round", "output_tokens": 256, "rounds": "3 (0 = load, 1 = first follow-up, 2 = later)",
                                  "modes": {"append": "whole history + one new exchange (as Open WebUI sends a chat)",
                                            "replace": "same document, question replaced (misses vLLM's hybrid prefix cache for "
                                                       "Qwen3.6/Qwen3.8 at some sizes - RESULTS finding 10)"}},
    },
    "level_fields": {
        "c": "concurrent users", "run": "index into the config's runs[]", "n": "scored requests", "err": "failed requests",
        "prompt_tok": "mean prompt tokens", "out_tok": "mean completion tokens",
        "ttft_p50/ttft_p95": "seconds, all scored requests", "ttft_p95_r0": "round 0 only (synchronised start)",
        "ttft_p50_steady/ttft_p95_steady/dec_p10_steady": "rounds >= 1", "dec_p50/dec_p10": "per-request decode tok/s",
        "agg_tps": "aggregate tok/s over the window when every user is active (harness agg_tps)",
        "r1/r2": "follow-ups: per-round stats (round_stats.py computation) with their own pass",
        "kv_use_max": "vLLM KV-cache usage gauge max (0-1)", "preempt": "vLLM preemptions", "prefix_hit": "prefix-cache hit rate",
        "waiting_max": "max queued requests", "power_w": "mean GPU power (nvidia-smi)", "vram_mib": "PRO 6000 only: VRAM max",
        "cold_load": "follow-ups: the unscored loading turn (ttft_p50, ttft_max, all_loaded_after_s)",
        "cached_tok": "mean cached prompt tokens reported per request"},
    "rethreshold": "Every level keeps its raw tails, so any bar can be re-applied: chat/agent/cold every = err==0 && ttft_p95 < T "
                   "&& dec_p10 >= D; steady = err==0 && ttft_p95_steady < T && dec_p10_steady >= D; follow-ups: apply the same to r1 "
                   "and r2 separately (every = both, steady = r2). People = the largest passing c (not 'all lower levels pass').",
    "headline": [],
    "hardware": HARDWARE,
    "spark_guard_events": guard_events,
    "models": MODELS,
    "configs": configs,
}

for cfg in configs:
    for scen, h in cfg["people"].items():
        doc["headline"].append({"config": cfg["id"], "box": cfg["box"], "engine": cfg["engine"], "model": cfg["model"],
                                "variant": cfg["variant"], "scenario": scen, "profile": h["profile"],
                                "every": h["every"]["label"] if h["every"] else None, "every_n": h["every"]["pass"] if h["every"] else None,
                                "steady": h["steady"]["label"] if h["steady"] else None, "steady_n": h["steady"]["pass"] if h["steady"] else None})


def mtime(p):
    return dt.datetime.fromtimestamp(os.path.getmtime(p)).strftime("%Y-%m-%d %H:%M")


doc["sources"] = [
    {"path": "docs/spike/results/*.json (%d bench + %d quality + %d kv files; results/superseded/ excluded)" % (
        sum(len(v) for v in bench.values()), sum(len(v) for v in quality.values()), len(kvs)),
     "measured": "PRO 6000 2026-10-04; DGX Spark 2026-10-05 13:51 to 2026-10-06 11:37"},
    {"path": "docs/spike/spike_bench.py (pct, summarize_level fields; `summarize` output saved as _summarize.md)", "mtime": mtime(SPIKE + "/spike_bench.py")},
    {"path": "docs/spike/runs/round_stats.py (per-round computation; output saved as _round_stats.txt)", "mtime": mtime(SPIKE + "/runs/round_stats.py")},
    {"path": "docs/spike/RESULTS.md (cross-check, hardware facts, correction note)", "mtime": mtime(SPIKE + "/RESULTS.md")},
    {"path": "docs/spike/README.md (harness, profiles, pass rule)", "mtime": mtime(SPIKE + "/README.md")},
    {"path": "docs/spike/ESTIMATES_2026-10-05.md (specs, prices fetched 2026-10-05, KV paging method)", "mtime": mtime(SPIKE + "/ESTIMATES_2026-10-05.md")},
    {"path": "docs/spike/results/logs/spark_guard_thermal_memory.csv (Spark unified memory, clock, power, temp every 10 s)", "mtime": mtime(RES + "/logs/spark_guard_thermal_memory.csv")},
    {"path": "docs/spike/results/logs/*.cmd and *.log (llama-server argv, n_ctx_slot; vLLM block sizes)", "mtime": mtime(RES + "/logs")},
    {"path": "scratchpad/pro5000/est.py (Qwen3.6 / Nemotron page sizes, +6 / +8 fixed blocks)", "mtime": "2026-10-05 09:59"},
]

# ------------------------------------------------------------------------------------------------ checks
# (1) the per-round numbers equal runs/round_stats.py's printed output
rs_txt = open(os.path.join(OUT, "_round_stats.txt"), encoding="utf-8").read()
rs = {}
cur = None
for line in rs_txt.splitlines():
    if line.endswith(".json"):
        cur = line.strip()
        continue
    m = re.match(r"\s+ctx~(\d+)\s+c=(\d+)\s+round (\d): ttft p50/p95 ([\d.]+)/([\d.]+) s\s+decode p10 ([\d.]+)\s+(PASS|-)", line)
    if m:
        rs[(cur, int(m.group(2)), int(m.group(3)))] = (float(m.group(4)), float(m.group(5)), float(m.group(6)), m.group(7) == "PASS")
mism, n_ok = [], 0
for cfg in configs:
    for pid, p in cfg["profiles"].items():
        if not pid.startswith("followup"):
            continue
        for x in p["levels"]:
            f = cfg["runs"][x["run"]]["file"]
            for rd in (1, 2):
                b = x.get("r%d" % rd)
                ref = rs.get((f, x["c"], rd))
                if b is None or ref is None:
                    mism.append(("missing", f, x["c"], rd))
                    continue
                got = (round(b["ttft_p50"], 2), round(b["ttft_p95"], 2), round(b["dec_p10"], 1), b["pass"])
                if (abs(got[0] - ref[0]) > 0.0101 or abs(got[1] - ref[1]) > 0.0101 or abs(got[2] - ref[2]) > 0.101 or got[3] != ref[3]):
                    mism.append((f, x["c"], rd, got, ref))
                else:
                    n_ok += 1
doc["checks"] = {"round_stats_match": {"matched": n_ok, "mismatches": mism, "tolerance": "one unit of round_stats.py's printed precision (double rounding); every PASS verdict must be equal"}}

# (2) per-file people from the harness (what summarize's second table prints) vs our recomputation of pass_every/pass_steady
summ = []
for cfg in configs:
    for run in cfg["runs"]:
        d = json.load(open(RES + "/" + run["file"], encoding="utf-8"))
        lv = [x for x in cfg["profiles"][run["profile"]]["levels"] if x["run"] == run["i"]]
        if not run["profile"].startswith("followup"):
            mine = people(lv, "pass_every")["pass"]
            if d.get("people_latency_bounded_p10") is not None and mine != d["people_latency_bounded_p10"]:
                summ.append((run["file"], "every", mine, d["people_latency_bounded_p10"]))
        else:
            mine = people(lv, "pass_pooled")["pass"]
            if d.get("people_latency_bounded_p10") is not None and mine != d["people_latency_bounded_p10"]:
                summ.append((run["file"], "pooled", mine, d["people_latency_bounded_p10"]))
doc["checks"]["summarize_people_match"] = {"mismatches": summ}

with open(os.path.join(OUT, "measured.json"), "w", encoding="utf-8") as fh:
    json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
print("configs", len(configs), "round_stats matched", n_ok, "mismatches", len(mism), "summarize mismatches", len(summ))
print("bytes", os.path.getsize(os.path.join(OUT, "measured.json")))
