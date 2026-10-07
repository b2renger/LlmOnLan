"""Write measured-summary.md from measured.json (tables generated, not typed)."""
import json, os, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(HERE, "measured.json"), encoding="utf-8"))
C = {c["id"]: c for c in d["configs"]}
NAME = {"qwen36": "Qwen3.6-35B-A3B", "nemotron": "Nemotron 3.5 Lightning", "qwen38": "Qwen3.8-27B (dense)"}
ORDER = ["pro6000/vllm/qwen36", "pro6000/vllm/nemotron", "pro6000/vllm/qwen38", "pro6000/llamacpp/nemotron/p16", "pro6000/llamacpp/nemotron/p8",
         "pro6000/llamacpp/qwen38/p8", "pro6000/llamacpp/qwen38/p16",
         "spark/vllm/qwen36", "spark/vllm/nemotron", "spark/vllm/qwen38", "spark/llamacpp/nemotron/p16", "spark/llamacpp/qwen38/p8", "spark/llamacpp/qwen38/p16"]


def nm(cid):
    c = C[cid]
    return "%s · %s · %s%s" % ("PRO 6000" if c["box"] == "pro6000" else "Spark", "vLLM" if c["engine"] == "vllm" else "llama.cpp",
                               NAME[c["model"]], (" " + c["variant"]) if c["variant"] else "")


def pp(cid, key):
    h = C[cid]["people"].get(key)
    if not h:
        return "—"
    e = h["every"]["label"] if h["every"] else "n/a"
    s = h["steady"]["label"] if h["steady"] else "n/a"
    return "%s / %s" % (e, s)


L = []
now = dt.datetime.now().astimezone().isoformat(timespec="minutes")
L.append("# Measured spike data: headline numbers (for checking measured.json)")
L.append("")
L.append("Written %s from `measured.json` (generated %s) by `write_summary.py`. Sources: `docs/spike/results/*.json` "
         "(PRO 6000 run 2026-10-04; DGX Spark run 2026-10-05 13:51 to 2026-10-06 11:37), RESULTS.md / README.md / "
         "ESTIMATES_2026-10-05.md (mtime 2026-10-06 17:09-17:12), the Spark guard CSV. Superseded runs excluded." % (now, d["generated"]))
L.append("")
L.append("**Pass rule:** no errors, TTFT p95 < 5 s, per-user decode p10 >= 15 tok/s. People = the largest passing tested level, "
         "`every turn / steady`. `≥ N` = N was the top level tested; `< N` = the lowest level tested (N) failed; `0` = one user failed. "
         "Follow-ups: every turn = the first follow-up (round 1) and the later one (round 2) both pass; steady = round 2. "
         "Follow-up rows use the `--append` run where one exists, as RESULTS.md's headline does.")
L.append("")
L.append("## measured.json at a glance")
L.append("")
for s_ in [
    "`configs[]` - one per box x engine x model (x llama.cpp `--parallel` variant): `id` (e.g. `spark/vllm/qwen36`), `server_flags`, `runs[]` (source file, profile, start/finish, notes), "
    "`profiles{chat, chat_nothink, agent, cold_32k|64k|128k, followup_<32k|64k|128k>_<append|replace>}` each with `levels[]` (one per tested concurrency, raw tails kept) and `people_every` / `people_steady` (`{pass, fail, label, tested}`; follow-ups also `people_pooled`), "
    "`people{chat_4k, agent_step, chat_4k_thinking_off_natural, followup_32k|64k|128k, cold_32k|64k|128k}` (headline, follow-ups prefer `--append`), `single_user`, `cold_prefill_single_user`, `peak_aggregate`, `quality{thinking_on, thinking_off}`, `memory`, `kv`.",
    "Chat/agent/cold level: `c, run, n, err, prompt_tok, out_tok, ttft_p50, ttft_p95, ttft_p95_r0, ttft_p50_steady, ttft_p95_steady, dec_p50, dec_p10, dec_p10_steady, agg_tps, pass_every, pass_steady, pass_median, kv_use_max, preempt, prefix_hit, waiting_max, power_w, vram_mib`.",
    "Follow-up level: the same pooled fields plus `r1` / `r2` (`ttft_p50, ttft_p95, dec_p10, dec_p50, n, pass`), `pass_pooled`, `pass_every` (r1 and r2), `pass_steady` (r2), `cold_load`, `cached_tok`.",
    "`headline[]` - flat rows (config x scenario -> every/steady label and number) for a table. `hardware{}` - specs and prices (measured boxes + the ESTIMATES cards, flagged). `models{}` - checkpoints, weights, vLLM paging (`page_bytes`, `block_tokens`, `fixed_blocks_per_request`). `rethreshold` - how to re-apply another TTFT / decode bar from the raw tails. `checks`, `crosscheck_vs_results_md`, `sources`.",
]:
    L.append("- " + s_)
L.append("")
L.append("## People per box")
L.append("")
L.append("| Config | 4k chat | Agent step | At 32k | At 64k | At 128k | Cold 32k | Cold 64k | Cold 128k |")
L.append("|---|---|---|---|---|---|---|---|---|")
for cid in ORDER:
    L.append("| %s | %s |" % (nm(cid), " | ".join(pp(cid, k) for k in ("chat_4k", "agent_step", "followup_32k", "followup_64k", "followup_128k",
                                                                       "cold_32k", "cold_64k", "cold_128k"))))
L.append("")
L.append("Alternative follow-up modes kept in measured.json (`profiles.followup_<ctx>_replace`): PRO 6000 Qwen3.8 32k replace = "
         "%s (cache miss on the first follow-up); Spark Qwen3.6 32k replace = %s, 128k replace = %s; Spark Nemotron 128k replace = %s." % (
             "%s / %s" % (C["pro6000/vllm/qwen38"]["profiles"]["followup_32k_replace"]["people_every"]["label"], C["pro6000/vllm/qwen38"]["profiles"]["followup_32k_replace"]["people_steady"]["label"]),
             "%s / %s" % (C["spark/vllm/qwen36"]["profiles"]["followup_32k_replace"]["people_every"]["label"], C["spark/vllm/qwen36"]["profiles"]["followup_32k_replace"]["people_steady"]["label"]),
             "%s / %s" % (C["spark/vllm/qwen36"]["profiles"]["followup_128k_replace"]["people_every"]["label"], C["spark/vllm/qwen36"]["profiles"]["followup_128k_replace"]["people_steady"]["label"]),
             "%s / %s" % (C["spark/vllm/nemotron"]["profiles"]["followup_128k_replace"]["people_every"]["label"], C["spark/vllm/nemotron"]["profiles"]["followup_128k_replace"]["people_steady"]["label"])))
L.append("")
L.append("## Speed")
L.append("")
L.append("| Config | 1-user decode (tok/s, 4k chat) | 1-user TTFT 4k (s) | Cold prefill alone 32k / 64k / 128k (s) | Prefill tok/s at 32k | Peak aggregate (tok/s @ users, profile) |")
L.append("|---|---|---|---|---|---|")
for cid in ORDER:
    c = C[cid]
    su = c["single_user"].get("chat", {})
    cp = c["cold_prefill_single_user"]
    cold = " / ".join(str(cp[k]["ttft_p50_s"]) if k in cp else "—" for k in ("32k", "64k", "128k"))
    pk = c["peak_aggregate"].get("any", {})
    L.append("| %s | %s | %s | %s | %s | %s @ %s (%s) |" % (nm(cid), su.get("decode_tps_p50"), su.get("ttft_p50_s"), cold,
                                                          cp.get("32k", {}).get("prefill_tps", "—"), pk.get("tps"), pk.get("c"), pk.get("profile")))
L.append("")
L.append("Peak aggregate is the highest `agg_tps` of any level; on the Spark it sits at levels that fail the decode bar (e.g. Nemotron 858 tok/s at 192 users, 4.1 tok/s each).")
L.append("")
L.append("## Quality gate (28 items; score, completion tokens)")
L.append("")
L.append("| Config | Thinking on | Thinking off | Thinking-on misses |")
L.append("|---|---|---|---|")
for cid in ORDER:
    q = C[cid]["quality"]
    if not q:
        continue
    def f(k):
        if k not in q:
            return "—"
        x = q[k]
        return "%d/%d (%s tok)" % (x["score"], x["of"], format(x["completion_tokens"], ","))
    miss = "; ".join("%s (%s)" % (m["id"], m["why"]) for m in q.get("thinking_on", {}).get("failed", []))
    L.append("| %s | %s | %s | %s |" % (nm(cid), f("thinking_on"), f("thinking_off"), miss))
L.append("")
L.append("## KV capacity (vLLM, 58 GiB pool on both boxes) and memory")
L.append("")
L.append("| Config | Blocks | People by KV, naive (pool tokens ÷ window) 32k / 64k / 128k | **Corrected** (blocks ÷ (ceil(ctx/block) + fixed)) | Per person at the follow-up sizes (MB) | Memory used |")
L.append("|---|---|---|---|---|---|")
for cid in ORDER:
    c = C[cid]
    k, m = c["kv"], c["memory"]
    if c["box"] == "pro6000":
        mem = "%s–%s MiB VRAM (%s–%s GiB), of 97,887" % (format(m["vram_mib_min"], ","), format(m["vram_mib_max"], ","), m["vram_gib_range"][0], m["vram_gib_range"][1])
    else:
        mem = "%s–%s GB unified during runs (p50 %s); start-up peaks: %s" % (m["mem_used_gb_min"], m["mem_used_gb_max"], m["mem_used_gb_p50"],
                                                                           ", ".join("%s GB" % s["peak_gb"] for s in m.get("startup_segments", [])) or "—")
    if c["engine"] == "vllm":
        nv = " / ".join(str(k["people_naive_pool_tokens_div_window"][x]) for x in ("32k", "64k", "128k"))
        cr = " / ".join(str(k["people_corrected"][x]) for x in ("32k", "64k", "128k"))
        per = " / ".join(str(k["people_corrected_at_followup_profile_size"][x]["mb_per_person"]) for x in ("32k", "64k", "128k"))
        L.append("| %s | %s | %s | **%s** | %s | %s |" % (nm(cid), format(k["blocks"], ","), nv, cr, per, mem))
    else:
        L.append("| %s | pool %s tokens, %d slots | %s (slots) | — | — | %s |" % (nm(cid), format(k["pool_tokens"], ","), k["slots"],
                                                                         " / ".join(str(k["people_by_kv"][x]) for x in ("32k", "64k", "128k")), mem))
L.append("")
mk = d["models"]
L.append("Paging per model (vLLM 0.30): " + "; ".join("%s page %s B, %s-token blocks, +%s blocks per request (%s MB recurrent state)" % (
    NAME[m], format(mk[m]["vllm_kv"]["page_bytes"], ","), format(mk[m]["vllm_kv"]["block_tokens"], ","), mk[m]["vllm_kv"]["fixed_blocks_per_request"],
    mk[m]["vllm_kv"]["recurrent_state_mb_per_request"]) for m in ("qwen36", "nemotron", "qwen38")) +
    ". Qwen3.6 and Nemotron pages are ESTIMATES' figures; Qwen3.8's page is derived here (it reproduces 1,212 blocks, 13.47× and 46.6).")
L.append("")
L.append("## Hardware facts used")
L.append("")
L.append("| Box | Memory | Bandwidth (GB/s) | FP4 TOPS (sparse) | Power | Price € TTC (date, where) | Host needed | Measured |")
L.append("|---|---|---|---|---|---|---|---|")
for k, h in d["hardware"].items():
    L.append("| %s | %s GB | %s | %s | %s | %s (%s, %s) | %s | %s |" % (h["name"], h["memory_gb"], h["bandwidth_gbs"], h.get("fp4_tops_sparse") or h.get("fp4_tops_note"),
                                                                 h["power_w"], format(h["price_eur_ttc"], ",.2f"), h["price_date"], h["price_where"],
                                                                 "yes" if h["needs_host"] else "no", "yes" if h["measured"] else "no (estimate only)"))
L.append("")
L.append("Spark OEM GB10 boxes from €5,038 HT (~€6,046 TTC). Two Sparks link through ConnectX-7 200 Gb/s: **no two-box run exists in the spike**.")
L.append("")
L.append("## Disagreements with RESULTS.md")
L.append("")
cc = d["crosscheck_vs_results_md"]
L.append("%d checks against RESULTS.md: %d agree, %d qualifier only, %d disagree, %d notes. The non-agreements:" % (
    len(cc["rows"]), cc["counts"]["agree"], cc["counts"]["qualifier"], cc["counts"]["disagree"], cc["counts"]["note"]))
L.append("")
L.append("| Status | Item | RESULTS.md | Measured | Note |")
L.append("|---|---|---|---|---|")
for r in cc["rows"]:
    if r["status"] != "agree":
        L.append("| %s | %s | %s | %s | %s |" % (r["status"], r["item"], r["results_md"], r["measured"], r["note"]))
L.append("")
L.append("Checks of the extraction itself: all 284 per-round follow-up figures equal `runs/round_stats.py`'s printed output (to its print "
         "precision, every PASS verdict equal); every file's people count equals the harness's own `people_latency_bounded_p10` "
         "(what `summarize` prints).")
L.append("")
L.append("## Caveats")
L.append("")
for s in [
    "One run per box, ceiling numbers with an exclusive GPU. The PRO 6000 ran vLLM inside WSL2 (overhead vs native Linux not measured); the Spark ran native Linux.",
    "Both boxes used the same 58 GiB vLLM KV pool. The Spark could hold ~75 GiB; this changes no people number (throughput binds first) but means the Spark's 'KV capacity' is not its maximum.",
    "Steady counts marked ≥ are lower bounds: the sweep stopped at the highest level tested.",
    "Non-monotonic case: PRO 6000 llama.cpp Nemotron p16 agent step, steady fails at 8 users (TTFT p95 6.36 s) but passes at 16 (2.56 s).",
    "PRO 6000 Qwen3.6 levels ≤ 64 come from a --max-num-seqs 64 server, levels 64-192 and the follow-ups from a 192 server (both kept; c=64 appears twice).",
    "Qwen3.6 cold-prompt and chat-thinking-off levels on the PRO 6000 come from the first suite, which recorded no steady metrics (steady = n/a).",
    "llama.cpp quality was run on the p8 server for Nemotron on the PRO 6000, p16 on the Spark; Qwen3.8 on p8 on both. No llama.cpp thinking-off gate.",
    "Spark Qwen3.8 thinking-on token bills (vLLM 24k, llama.cpp 18k) undercount: client timeouts recorded 0 tokens for 2 and 3 items.",
    "Spark memory is whole-box unified memory from `free -g` every 10 s (incl. OS and ~2.7 GB of Farm sidecars); PRO 6000 VRAM includes ~1.7 GiB of Windows desktop.",
    "Quality is a 28-item smoke gate, not a benchmark; within its noise it is the same on both boxes (a checkpoint property).",
    "Nothing here measures two linked Sparks, a model too large for the PRO 6000 (gpt-oss-120b class), speculative decoding, or the farm's seat gate / OWUI in front of the engine.",
]:
    L.append("- " + s)
open(os.path.join(HERE, "measured-summary.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print("wrote", len(L), "lines")
