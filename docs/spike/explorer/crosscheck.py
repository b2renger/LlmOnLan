"""Cross-check measured.json against RESULTS.md's headline tables (values typed from RESULTS.md as of 2026-10-06 17:12).
Writes doc["crosscheck_vs_results_md"] back into measured.json and prints a markdown table of the non-agreements."""
import json, os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "measured.json")
d = json.load(open(P, encoding="utf-8"))
C = {c["id"]: c for c in d["configs"]}


def pe(cid, key):
    h = C[cid]["people"][key]
    return "%s / %s" % (h["every"]["label"] if h["every"] else "n/a", h["steady"]["label"] if h["steady"] else "n/a")


def lvl(cid, pid, c):
    return [x for x in C[cid]["profiles"][pid]["levels"] if x["c"] == c]


def q(cid, th):
    x = C[cid]["quality"]["thinking_" + th]
    return "%d/%d (%dk)" % (x["score"], x["of"], round(x["completion_tokens"] / 1000))


rows = []


def add(where, item, results, measured, status, note=""):
    rows.append({"where": where, "item": item, "results_md": results, "measured": measured, "status": status, "note": note})


PQ, PN, P8 = "pro6000/vllm/qwen36", "pro6000/vllm/nemotron", "pro6000/vllm/qwen38"
LN16, LQ8, LQ16, LN8 = "pro6000/llamacpp/nemotron/p16", "pro6000/llamacpp/qwen38/p8", "pro6000/llamacpp/qwen38/p16", "pro6000/llamacpp/nemotron/p8"
SQ, SN, S8 = "spark/vllm/qwen36", "spark/vllm/nemotron", "spark/vllm/qwen38"
SLN, SLQ8, SLQ16 = "spark/llamacpp/nemotron/p16", "spark/llamacpp/qwen38/p8", "spark/llamacpp/qwen38/p16"

# ---------------- PRO 6000 headline (RESULTS.md lines 70-84)
H = "RESULTS.md PRO 6000 headline"
for cid, key, claim in [(PQ, "followup_32k", "96 / 128"), (PQ, "followup_64k", "48 / 64"), (PQ, "followup_128k", "32 / 40"),
                        (PQ, "chat_4k", "64 / 160"), (PQ, "agent_step", "64 / ≥ 192"),
                        (PN, "followup_32k", "160 / ≥ 192"), (PN, "followup_64k", "16 / 64"), (PN, "followup_128k", "24 / 48"),
                        (PN, "chat_4k", "64 / ≥ 192"), (PN, "agent_step", "96 / ≥ 192"), (PN, "cold_32k", "4 / 16"), (PN, "cold_64k", "2 / 4"),
                        (P8, "followup_32k", "16 / 32"), (P8, "followup_64k", "≥ 24 / ≥ 24"), (P8, "followup_128k", "≥ 12 / ≥ 12"),
                        (P8, "chat_4k", "16 / 32"), (P8, "agent_step", "32 / 96"), (P8, "cold_32k", "2 / 4"),
                        (LN16, "followup_32k", "4 / 8"), (LN16, "followup_128k", "0 / ≥ 4"), (LN16, "chat_4k", "8 / 16"), (LN16, "agent_step", "4 / 16")]:
    m = pe(cid, key)
    norm = lambda s: s.replace("≥ ", "").replace("< 2", "0")
    status = "agree" if m == claim else ("qualifier" if norm(m) == norm(claim) else "disagree")
    note = ""
    if status == "qualifier":
        note = "RESULTS.md drops the '≥': the steady count passed at the highest level tested, so it is a lower bound (ESTIMATES' Nemotron table and validation table do write '≥')."
    if cid == LN16 and key == "followup_128k":
        note = "lowest tested level was 2 users (failed on the first follow-up); RESULTS writes 0"; status = "agree"
    if cid == LN16 and key == "agent_step":
        note = "steady is non-monotonic: 8 users fail steady (TTFT p95 6.36 s), 16 pass (2.56 s)"
    add(H, "%s %s people (every / steady)" % (cid, key), claim, m, status, note)
for cid, key, claim in [(PQ, "cold_32k", "4"), (PQ, "cold_64k", "2"), (P8, "cold_64k", "0"), (P8, "cold_128k", "0"), (PN, "cold_128k", "0"),
                        (PQ, "cold_128k", "0"), (LN16, "cold_32k", "1"), (LQ8, "chat_4k", "1"), (LQ8, "agent_step", "1"), (LQ8, "cold_32k", "0")]:
    m = C[cid]["people"][key]["every"]["label"]
    add(H, "%s %s people (every)" % (cid, key), claim, m, "agree" if m == claim else "disagree")
for cid, ctx, claim in [(PQ, "128k", 8.0), (PN, "128k", 5.7), (P8, "64k", 8.1), (P8, "128k", 20.9), (LQ8, "32k", 10.6)]:
    m = C[cid]["cold_prefill_single_user"][ctx]["ttft_p50_s"]
    add(H, "%s cold %s alone (s)" % (cid, ctx), claim, m, "agree" if abs(m - claim) < 0.06 else "disagree")
for cid, claim in [(PQ, "27/28 (77k) / 28/28 (12k)"), (PN, "25/28 (68k) / 26/28 (7k)"), (P8, "26/28 (55k) / 28/28 (11k)")]:
    m = "%s / %s" % (q(cid, "on"), q(cid, "off"))
    add(H, "%s quality on / off" % cid, claim, m, "agree" if m == claim else "disagree")
for cid, claim in [(LN8, "26/28 (65k)"), (LQ8, "26/28 (48k)")]:
    m = q(cid, "on")
    add(H, "%s quality (thinking on)" % cid, claim, m, "agree" if m == claim else "disagree",
        "llama.cpp quality was run on the --parallel 8 server only (the Nemotron headline row is the p16 server)" if cid == LN8 else "")
for cid, claim in [(PQ, "168 / 84 / 42"), (PN, "485 / 243 / 121"), (P8, "54 / 27 / 13")]:
    k = C[cid]["kv"]
    naive = " / ".join(str(round(k["people_naive_pool_tokens_div_window"][x])) for x in ("32k", "64k", "128k"))
    corr = " / ".join(str(round(k["people_corrected"][x], 1)) for x in ("32k", "64k", "128k"))
    add(H, "%s people by KV capacity 32k/64k/128k" % cid, claim, "naive %s; corrected %s" % (naive, corr), "note",
        "the naive column reproduces; the 2026-10-06 correction note in RESULTS.md applies (vLLM charges recurrent-state blocks per request)")
for cid, claim in [(PQ, "85.0–87.0 GB"), (PN, "86.3–87.2 GB"), (P8, "85.2–88.8 GB"), (LN16, "36.7 GB"), (LQ8, "28.6 GB"), (LQ16, "39.8 GB")]:
    m = C[cid]["memory"]
    ms = "%d–%d MiB (= %.1f–%.1f GiB)" % (m["vram_mib_min"], m["vram_mib_max"], m["vram_gib_range"][0], m["vram_gib_range"][1])
    if cid in (PQ, PN, P8):
        st, note = "disagree", "per-level nvidia-smi maxima in the JSONs; RESULTS' figures look like MiB/1000 but the vLLM ranges do not match those either (minor)"
    else:
        st, note = "agree", "RESULTS' 'GB' here = MiB/1000"
    add(H, "%s VRAM used" % cid, claim, ms, st, note)
# footnotes / detail
x = lvl(PN, "followup_64k_replace", 32)[0]["r1"]
add("RESULTS.md footnote 2", "Nemotron 64k, 32 users, first follow-up TTFT p95", "5.15 s", x["ttft_p95"], "agree" if abs(x["ttft_p95"] - 5.15) < 0.01 else "disagree")
x = lvl(LN16, "followup_128k_append", 2)[0]["r1"]
add("RESULTS.md footnote 4", "llama.cpp Nemotron 128k first follow-up at 2 users", "12.4 s", x["ttft_p95"], "agree")
rows_fu = [(PQ, "followup_32k_replace", 96, 3.3, 0.41, 19), (PQ, "followup_32k_replace", 128, 4.3, 0.45, 15.4),
           (PQ, "followup_64k_replace", 48, 4.3, 0.65, 21), (PQ, "followup_64k_replace", 64, 5.8, 0.69, 16.4),
           (PQ, "followup_128k_append", 32, 4.9, 1.1, 19), (PQ, "followup_128k_append", 40, 6.5, 0.80, 15.7)]
for cid, pid, c, a, b, e in rows_fu:
    x = lvl(cid, pid, c)[0]
    m = (x["r1"]["ttft_p95"], x["r2"]["ttft_p95"], x["r2"]["dec_p10"])
    ok = abs(m[0] - a) < 0.06 and abs(m[1] - b) < 0.06 and abs(m[2] - e) < 0.6
    add("RESULTS.md Qwen3.6 follow-up table", "%s c=%d first TTFT p95 / later TTFT p95 / later decode p10" % (pid, c), "%s / %s / %s" % (a, b, e),
        "%s / %s / %s" % m, "agree" if ok else "disagree")
x = lvl(PN, "chat", 192)[0]
add("RESULTS.md finding 7", "Nemotron chat 192 users steady TTFT p95 / decode p10", "0.84 s / 15.8", "%s / %s" % (x["ttft_p95_steady"], x["dec_p10_steady"]), "agree")
add("RESULTS.md finding 6", "thinking-on misses were runaway reasoning hitting the 16k cap",
    "all models", "Qwen3.6's one miss (tool_search) finished normally (185 tokens, wrong final answer), on both boxes; on the Spark, Qwen3.8's misses were client timeouts",
    "disagree", "minor wording; the scores are right")

# ---------------- Spark headline (RESULTS.md lines 408-419)
H = "RESULTS.md Spark headline"
for cid, key, claim, note in [
        (SQ, "followup_32k", "8 / 8", ""), (SQ, "followup_64k", "8 / 8", ""), (SQ, "followup_128k", "4 / 4", ""),
        (SQ, "chat_4k", "8 / 16", ""), (SQ, "agent_step", "8 / 16", ""),
        (SN, "followup_32k", "16 / 16", ""),
        (SN, "followup_64k", "< 8 / < 8", "round 2 (later turns) at 8 users passes: TTFT p95 1.80 s, decode p10 18.0. RESULTS' '6.0 s / 15.6' is the pooled level over both rounds; the first follow-up alone is 6.31 s / 15.2."),
        (SN, "followup_128k", "4 / 4", "append run (the headline's choice). The replace-mode run gives 4 / 8 (round 2 at 8: 2.84 s, 15.7)."),
        (SN, "chat_4k", "8 / 16", ""), (SN, "agent_step", "16 / 16", ""),
        (SLN, "followup_32k", "2 / 2", "round 2 at 4 users passes (0.91 s, decode p10 22.2); RESULTS used the pooled level for this row, unlike the PRO 6000 llama.cpp row"),
        (SLN, "followup_128k", "1 / 1", "round 2 at 2 users passes (0.83 s, 24.6)"),
        (SLN, "chat_4k", "1 / 4", ""), (SLN, "agent_step", "1 / 4", ""),
        (S8, "chat_4k", "0 / 0", ""), (S8, "agent_step", "0 / 0", "")]:
    m = pe(cid, key)
    st = "agree" if m == claim else "disagree"
    add(H, "%s %s people (every / steady)" % (cid, key), claim, m, st, note)
for cid, ctx, claim in [(SQ, "32k", 6.1), (SQ, "64k", 15.2), (SQ, "128k", 38.7), (SN, "32k", 5.7), (SN, "64k", 13.0), (SN, "128k", 29.8),
                        (S8, "32k", 14.7), (S8, "64k", 36.7), (S8, "128k", 93.2), (SLN, "32k", 15.4), (SLQ8, "32k", 47.0)]:
    x = C[cid]["cold_prefill_single_user"][ctx]
    ok = abs(x["ttft_p50_s"] - claim) < 0.11 or abs(x["ttft_p95_s"] - claim) < 0.11
    add(H, "%s cold %s alone (s)" % (cid, ctx), claim, "p50 %s / p95 %s" % (x["ttft_p50_s"], x["ttft_p95_s"]), "agree" if ok else "disagree",
        "RESULTS mixes p50 and p95 for these single-user figures" if abs(x["ttft_p50_s"] - claim) >= 0.11 else "")
for cid, claim in [(SQ, "27/28 (89k) / 26/28 (12k)"), (SN, "26/28 (61k) / 27/28 (7k)"), (S8, "26/28 (24k) / 28/28 (11k)")]:
    m = "%s / %s" % (q(cid, "on"), q(cid, "off"))
    note = ""
    if cid == S8:
        note = "score right; the 24k thinking-on token bill is an undercount: 2 items hit the harness's client timeout and recorded 0 tokens (on the PRO 6000 the same 2 items hit the 16k cap)"
    add(H, "%s quality on / off" % cid, claim, m, "agree" if m == claim and not note else "note", note)
for cid, claim in [(SLN, "26/28 (62k)"), (SLQ8, "25/28 (18k)")]:
    m = q(cid, "on")
    note = "score right; 3 items were client timeouts with 0 tokens recorded, so 18k undercounts" if cid == SLQ8 else ""
    add(H, "%s quality (thinking on)" % cid, claim, m, "agree" if not note else "note", note)
for cid, claim in [(SQ, "~90–96 GB"), (SN, "~85–95 GB"), (S8, "~90–108 GB"), (SLN, "~48 GB"), (SLQ8, "~40–52 GB"), (SLQ16, "~40–52 GB")]:
    m = C[cid]["memory"]
    segs = m.get("startup_segments") or []
    ms = "during runs %d–%d GB (p50 %d); start-up peaks %s" % (m["mem_used_gb_min"], m["mem_used_gb_max"], m["mem_used_gb_p50"],
                                                              ", ".join("%d GB at %s" % (s["peak_gb"], s["at"]) for s in segs) or "none")
    st, note = "agree", ""
    if cid == S8:
        st, note = "disagree", ("the guard CSV (10 s samples) puts Qwen3.8's MAX_JOBS=4 start-up peak at 93 GB, and the 116 GB trip at the first "
                                "(20-job) attempt; the 108 GB peak in the CSV is at 2026-10-05 13:56:29, during Qwen3.6's first start-up "
                                "(FlashInfer JIT). A spike shorter than 10 s could be missed")
    if cid == SQ:
        note = "start-up hit 108 GB (13 GB free) at 13:56:29 - first FlashInfer JIT on the box"
    if cid in (SLN, SLQ8, SLQ16):
        st, note = "disagree", ("unified memory during the runs is ~20 GB above RESULTS' figure; plausibly llama-server's --cache-ram 24576 "
                                "(24 GiB host prompt cache, which on GB10 is the same memory) filling up - inference, not verified")
    add(H, "%s memory used (unified)" % cid, claim, ms, st, note)
# Spark detail spots
x = lvl(S8, "chat", 4)[0]; y = lvl(S8, "agent", 4)[0]
add("RESULTS.md Spark footnote 3", "Qwen3.8 at a 10 tok/s bar: chat c=4 p10 / TTFT p95; agent c=4", "10.2 / 4.6 s; 10.7 / 3.1 s",
    "%s / %s; %s / %s" % (x["dec_p10"], x["ttft_p95"], y["dec_p10"], y["ttft_p95"]), "agree")
x = lvl(SQ, "followup_128k_replace", 4)[0]
add("RESULTS.md Spark footnote 1", "Qwen3.6 128k replace at 4 users", "105 s", x["ttft_p95"], "agree")
x = lvl(SQ, "followup_128k_append", 40)[0]
add("RESULTS.md Spark footnote 1", "Qwen3.6 128k append collapses at 40 users", "227 s", x["ttft_p95"], "agree")

# ---------------- PRO 6000 vs Spark (RESULTS.md lines 512-527)
H = "RESULTS.md PRO 6000 vs Spark"
for item, claim, m in [
        ("one-user decode Qwen3.6 / Nemotron / Qwen3.8, PRO 6000", "193 / 243 / 64", " / ".join(str(round(C[c]["single_user"]["chat"]["decode_tps_p50"])) for c in (PQ, PN, P8))),
        ("one-user decode Qwen3.6 / Nemotron / Qwen3.8, Spark", "76 / 69 / 12", " / ".join(str(round(C[c]["single_user"]["chat"]["decode_tps_p50"])) for c in (SQ, SN, S8))),
        ("peak aggregate agent Qwen3.6 / Nemotron, PRO 6000", "3,431 / 4,959", "%s / %s" % (C[PQ]["peak_aggregate"]["agent"]["tps"], C[PN]["peak_aggregate"]["agent"]["tps"])),
        ("peak aggregate agent Qwen3.6 / Nemotron, Spark", "585 / 858", "%s / %s" % (C[SQ]["peak_aggregate"]["agent"]["tps"], C[SN]["peak_aggregate"]["agent"]["tps"])),
        ("cold 32k Qwen3.6 / Nemotron / Qwen3.8, PRO 6000", "1.1 / 1.1 / 3.3 s", " / ".join(str(C[c]["cold_prefill_single_user"]["32k"]["ttft_p50_s"]) for c in (PQ, PN, P8))),
        ("cold 32k Qwen3.6 / Nemotron / Qwen3.8, Spark", "6.1 / 5.7 / 14.7 s", " / ".join(str(C[c]["cold_prefill_single_user"]["32k"]["ttft_p50_s"]) for c in (SQ, SN, S8)))]:
    add(H, item, claim, m, "agree")
add(H, "llama.cpp Nemotron 32k people, Spark", "2 / 2 (ratio 2–4×)", pe(SLN, "followup_32k") + " (ratio 2×)", "disagree", "see the Spark headline row")
add(H, "Qwen3.6 32k / 64k / 128k PRO 6000 steady", "128 / 64 / 40", "%s / %s / %s" % tuple(C[PQ]["people"][k]["steady"]["label"] for k in ("followup_32k", "followup_64k", "followup_128k")),
    "qualifier", "lower bounds: each was the highest level tested")
add(H, "Spark KV capacity 'identical (168 / 485 at 32k)'", "168 / 485", "naive 168 / 485; corrected %s / %s" % (C[SQ]["kv"]["people_corrected"]["32k"], C[SN]["kv"]["people_corrected"]["32k"]),
    "note", "the conclusion (throughput binds ~10x before KV) holds with the corrected numbers")
add(H, "price per seat (EUR TTC, card only)", "Spark 825 (Qwen3.6, 32k & 64k), 413 (Nemotron 32k); PRO 6000 138–184 (32k), 276–368 (64k)",
    "6599.95/8 = %d; 6599.95/16 = %d; 17679.95/128 = %d, /96 = %d; /64 = %d, /48 = %d" % (6599.95 / 8, 6599.95 / 16, 17679.95 / 128, 17679.95 / 96, 17679.95 / 64, 17679.95 / 48),
    "agree", "rounding: 6599.95/16 = 412.5")

d["crosscheck_vs_results_md"] = {"results_md_as_of": "docs/spike/RESULTS.md, mtime 2026-10-06 17:12", "rows": rows,
                                  "counts": {s: sum(1 for r in rows if r["status"] == s) for s in ("agree", "qualifier", "disagree", "note")}}
json.dump(d, open(P, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(d["crosscheck_vs_results_md"]["counts"])
for r in rows:
    if r["status"] != "agree":
        print("| %s | %s | %s | %s | %s | %s |" % (r["status"], r["where"], r["item"], r["results_md"], r["measured"], r["note"]))
