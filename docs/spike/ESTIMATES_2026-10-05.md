# Blackwell cards and the DGX Spark: specs, prices, estimated people per card (2026-10-05)

**For the owner and anyone choosing what to buy.** The RTX PRO 6000 row is MEASURED (docs/spike/RESULTS.md).
Every other row is an **estimate**, scaled from that card with the method below. The DGX Spark row comes from
its own spike run (2026-10-05), not from this file. All figures are for vLLM 0.30 serving
Qwen3.6-35B-A3B NVFP4, unless a table says otherwise. People are counted as `every turn / steady`, with the
spike's pass rule: TTFT p95 < 5 s and decode p10 >= 15 tok/s.

**Which "new A5500"?** NVIDIA has a card literally named after the A5500: the **RTX PRO 5500 Blackwell**,
84 GB, listed around 2026-09-15 and marked "coming soon" by NVIDIA. The owner said "the new one", meaning
the Blackwell card; this file covers the PRO 5500 and both PRO 5000 sizes (48 and 72 GB).

## Specs

| Card | Memory | Type / bus | Bandwidth | FP4 tensor (AI TOPS, sparse; dense = ½) | CUDA cores / SMs | Power | Interface | Status 2026-10-05 |
|---|---|---|---|---|---|---|---|---|
| RTX PRO 6000 Blackwell Workstation | 96 GB (97,887 MiB visible, measured) | GDDR7 ECC / 512-bit | **1,792 GB/s** | **4,000** (FP32 125 TFLOPS) | 24,064 / 188 | 600 W | PCIe 5.0 x16 | shipping |
| RTX PRO 6000 Blackwell Max-Q | 96 GB | GDDR7 ECC / 512-bit | 1,792 GB/s | 3,511 (FP32 110) | 24,064 / 188 | 300 W | PCIe 5.0 x16 | shipping |
| **RTX PRO 5500 Blackwell** | **84 GB** | GDDR7 ECC / 448-bit (inferred from 28 × 3 GB; flopper.io prints 416-bit) | **1,398 GB/s** | not published (est. ~3,350–3,600: same 170 SMs as an RTX 5090, which is 3,352) | 21,760 (PNY) / 170 | up to 600 W | PCIe 5.0 x16, MIG 1×84 / 2×42 GB | NVIDIA: "Coming soon" |
| RTX PRO 5000 Blackwell 72 GB | 72 GB | GDDR7 ECC / 384-bit (Scan; flopper.io says 512) | **1,344 GB/s** | **2,064** (dense 1,032; FP32 65) | 14,080 / 110 | 300 W | PCIe 5.0 x16 | shipping (UK pre-order; FR in stock through a marketplace seller) |
| RTX PRO 5000 Blackwell 48 GB | 48 GB | GDDR7 ECC / 384-bit | 1,344 GB/s | 2,064 | 14,080 / 110 | 300 W | PCIe 5.0 x16 | shipping |
| DGX Spark (GB10) | 128 GB LPDDR5x unified (NVIDIA also lists an OEM-only **64 GB** version) | 256-bit | **273 GB/s** | "up to 1 PFLOP FP4" (1,000) | 6,144 (as reported in the press) / 48 | GB10 140 W, 240 W PSU | ConnectX-7 200 Gb/s | shipping |
| (old) RTX A5500, Ampere | 24 GB GDDR6 | 384-bit | 768 GB/s | no FP4 | 10,240 | 230 W | PCIe 4.0 | Cannot run Qwen3.6 NVFP4 with any KV: 20.37 GiB weights + ~3.7 GiB runtime is more than 24 GB |

**Ratios against the PRO 6000.** Bandwidth (this sets decode): PRO 5500 0.780 · PRO 5000 0.750 · Max-Q 1.0 · Spark 0.152. Compute (this sets prefill): PRO 5000 0.516 (2,064/4,000) · Max-Q 0.878 · PRO 5500 ~0.84–0.90 (estimated; its TOPS are unpublished) · Spark 0.25. The PRO 5000/5500 use the same GB202 die and sm_120 as the measured card, so scaling from it is sound. The Spark (GB10, sm_121, unified LPDDR5x) is a different family and has to be measured.

## Prices (France, 2026-10-05)

All prices are retail and include VAT unless marked. They were fetched 2026-10-05 unless another date is given. French VAT is 20%, so ex-VAT (HT) = TTC ÷ 1.2. These are card-only prices: a PRO card also needs a host PC, while the Spark is a complete computer.

| Card | Price | Where, date | Reliability |
|---|---|---|---|
| RTX PRO 6000 WS | **€17,679.95 TTC** (OEM, 7–15 days) · HT €14,733 | LDLC.com, 2026-10-05 | high (retailer page; lead time means it can move) |
| | £14,259.96 inc VAT OEM (due 15 Nov) · £14,740.99 retail (pre-order) | Scan.co.uk, 2026-10-05 | high |
| | $16,000 on NVIDIA's US Marketplace (out of stock), up from $13,250 in June 2026. Launch MSRP was $8,565 (Mar 2025) | mlq.ai 2026-08-13; Thunder Compute blog | medium |
| | Newegg $16,599–17,999 (Oct 1). A $8,345.99 "Newegg Business" listing looks like a stale or third-party price | nowinstock.net, 2026-10-05 | medium / low |
| RTX PRO 6000 Max-Q | **€17,709.95 TTC** (in stock) · Scan £14,709.98 | LDLC / Scan, 2026-10-05 | high |
| **RTX PRO 5500 84 GB** | **€16,469.95 TTC** retail / €16,439.95 OEM ("+15 days") · HT €13,725 | LDLC.com, 2026-10-05 | medium (NVIDIA publishes no price and calls the card "coming soon") |
| RTX PRO 5000 72 GB | **€11,193.70 TTC** (in stock, delivery Oct 7, from marketplace seller "Leasi-fr") · HT €9,328 | PCComponentes.fr, 2026-10-05 | medium (marketplace seller) |
| | €10,559.95 TTC (listed as no longer sold) | LDLC.be | low (stale) |
| | £8,788.49 inc VAT (pre-order) | Scan.co.uk, 2026-10-05 | high |
| | B&H $8,999.99 / Newegg $9,999.99; Newegg's product page today shows Hong Kong marketplace sellers at $13,135 | search snippets (undated); Newegg page | low |
| RTX PRO 5000 48 GB | **€9,939.95 TTC** retail / €9,899.95 OEM ("+15 days") · HT €8,283 | LDLC.com and Materiel.net, 2026-10-05 | high |
| | £8,240.48 (OEM) – £8,268.49 inc VAT, in stock | Scan.co.uk, 2026-10-05 | high |
| | €6,975 HTVA on sale (sold out) | zstore.be | low |
| DGX Spark 128 GB | **€6,599.95 TTC** (PNY Founders, "+15 days") · HT €5,500 | LDLC.com, 2026-10-05 | high |
| | OEM GB10 boxes from €5,038 HT (Lenovo ThinkStation PGX 1 TB) up to €8,096 HT | pi3g.com, 2026-09-24 | medium |
| | Founders $4,699 since Feb 2026 (was $3,999); Amazon $4,999.99 (Sep 2026) | NVIDIA developer forum price-change notice; pi3g | medium |
| Education pricing | Not visible publicly. It goes through NVIDIA partner (NPN) quotes, or UGAP for French public bodies; not checked | — | — |

**Note:** memory-supply prices have roughly doubled the PRO 6000 since its 2025 launch. In France the PRO 5500 costs 93% of a PRO 6000 for 88% of the memory and 78% of the bandwidth.

## People per card (estimated unless marked)

### People per card, vLLM 0.30 · Qwen3.6-35B-A3B NVFP4 (labelled *estimated* unless measured)

**Assumed setup** (the same as today's PRO 6000 farm): Windows + WSL2, the OCR model (9.0 GiB) on the same card, and total memory at or below the farm's 92% eviction line. People are `every turn / steady`, using the spike's pass rule (TTFT p95 < 5 s and decode p10 ≥ 15 tok/s). The person sizes are the spike's follow-up profile: about 30k, 62k and 120k tokens already in the KV pool, plus a 256-token reply.

| Box | KV pool (blocks) | 32k | binds | 64k | binds | 128k | binds | Cold prompt alone, 32k / 64k / 128k |
|---|---|---|---|---|---|---|---|---|
| **PRO 6000 96 GB, MEASURED** (spike pool 58 GiB, no OCR room) | 58 GiB (2,901) | **96 / 128** | decode / KV + decode | **48 / 64** | TTFT / decode | **32 / 40** | TTFT / decode + KV | 1.1 / 3.0 / 8.0 s (measured) |
| PRO 6000 96 GB at the farm's 50 GiB pool (OCR on the card) | 50 GiB (2,501) | 96–110 / 104–110 | KV | 48–56 / 61–64 | TTFT / KV | 28–32 / 34–36 | TTFT / KV | same |
| PRO 6000 Max-Q (300 W), est. | 50 GiB (2,501) | 101–110 / 104–110 | TTFT–KV / KV | 49–56 / 61–64 | TTFT / KV | 25–28 / 34–36 | TTFT / KV | 1.3 / 3.4 / 9.1 s |
| **PRO 5500 84 GB, est.** | 42.2 GiB (2,110) | **88–89 / 88–93** | KV | **43–50 / 51–54** | TTFT / KV | 22–26 / 29–30 | TTFT / KV | 1.3 / 3.3–3.6 / 8.9–9.5 s |
| **PRO 5000 72 GB, est.** | 31.2 GiB (1,560) | **59–69 / 65–69** | TTFT–KV / KV | **28–40 / 38–40** | TTFT / KV | 14–21 / 21–22 | TTFT / KV | 2.2 / 5.8 / 15.5 s |
| **PRO 5000 48 GB, est.** | 9.2 GiB (460) | **19–20 / 19–20** | KV | **11 / 11** | KV | 6 / 6 | KV | 2.2 / 5.8 / 15.5 s |
| PRO 5000 48 GB, OCR on another box, est. | 18.2 GiB (910) | 38–40 / 38–40 | KV | 22–23 / 22–23 | KV | 12–13 / 12–13 | KV | same |
| PRO 5000 48 GB, headless Linux, OCR elsewhere, est. | 19.9 GiB (993) | 41–43 | KV | 24–25 | KV | 13–14 | KV | same |
| PRO 5000 72 GB, OCR elsewhere, est. | 40.2 GiB (2,010) | 59–85 / 81–89 | TTFT / decode–KV | 28–42 / 49–51 | TTFT / decode–KV | 14–21 / 27–29 | TTFT / KV | same |
| PRO 5500, OCR elsewhere, est. | 51.2 GiB (2,560) | 89 / 96 | decode | 43–50 / 55 | TTFT / decode | 22–26 / 30 | TTFT / decode | same |
| **DGX Spark 128 GB, MEASURED** (same 58 GiB pool) | 58 GiB (same as the PRO 6000) | **8 / 8** | decode + TTFT | **8 / 8** | decode | **4 / 4** | decode | 6.1 / 15.2 / 38.7 s (measured) |

**Against the class sizes** (usually 20–30, at most 50):
- **PRO 5000 72 GB:** covers 50 at 32k. At 64k it covers a usual class (28–40) but not 50 pressing Enter together.
- **PRO 5000 48 GB:** covers about 20 at 32k with OCR on the card, about 40 with OCR moved to another box. KV binds at every context.
- **PRO 5500:** covers 50 at 32k, and 43–54 at 64k (50 is marginal).
- **Cold pastes:** on the PRO 5000 a 64k cold paste breaks the 5 s TTFT even for one person (5.8 s).

**Validation on the measured card.** Run on the PRO 6000 itself, the model gives:

| Context | Model (every turn / steady) | Measured |
|---|---|---|
| 32k | 115 / 121–128 | 96 passed, 128 failed / 128 |
| 64k | 56 / 70–73 | 48 passed, 64 failed / ≥ 64 |
| 128k | 28 / 39–41 | 32 / 40 |

That is within one tested level everywhere except 128k every turn, where the model is ~12% pessimistic.

### Nemotron 3.5 Lightning NVFP4: low confidence

The data support Nemotron estimates only loosely. Its fit has 10–14% mean error. Its context term runs at only ~29% of peak bandwidth, so it is not cleanly bandwidth-bound. Its 64k first turn is anomalous on the PRO 6000 (16 pass, 32 fail at 5.15 s). Method used here:
- **Every turn** = the measured PRO 6000 level × [compute ratio … bandwidth ratio].
- **Steady** = the measured lower bound × the fit's scaling.
- Both are capped by KV.

The pools assume OCR on the card, Windows, and a non-KV footprint of 27.2 GiB (measured).

| Box | KV pool (blocks of 4,176 tokens) | 32k | 64k | 128k |
|---|---|---|---|---|
| PRO 6000, MEASURED (58 GiB) | 4,854 | 160 / ≥ 192 | 16 / ≥ 64 | 24 / ≥ 48 |
| PRO 5500, est. | 40.8 GiB (3,411) | 125–144 / ≥ 143 | 12–14 / ≥ 48 | 19–22 / ≥ 36 |
| PRO 5000 72 GB, est. | 29.8 GiB (2,490) | 83–120 / 94–136 | 8–12 / 31–45 | 12–18 / 23–34 |
| PRO 5000 48 GB, est. | 7.8 GiB (652) | 36–38 / 36–38 (KV) | 8–12 / 25–26 (KV) | 12–15 / 15–16 (KV) |

Nemotron's per-person KV is 2.2–2.9× smaller than Qwen3.6's: 205 / 295 / 475 MB against 451 / 773 / 1,374 MB. That is why its numbers hold up on the 48 GB card. It still lacks vision and scores lower on coding (26/28 with thinking off, against Qwen3.6's 28/28).

## Price per person

### Price per seat: Qwen3.6-35B-A3B NVFP4 on vLLM, card only, € TTC (France, 2026-10-05)

Seat = one person, counted `every turn / steady`. Estimates use the assumed setup above (Windows, OCR on the same card, ≤ 92%).

| Box | Card price | People at 32k | **€ per seat at 32k** | People at 64k | **€ per seat at 64k** | Status |
|---|---|---|---|---|---|---|
| RTX PRO 6000 96 GB (spike pool, no OCR room) | €17,680 | 96 / 128 | **€184 / €138** | 48 / 64 | **€368 / €276** | **measured** |
| RTX PRO 6000 96 GB, farm config (50 GiB pool + OCR) | €17,680 | 96–110 / 104–110 | €161–184 / €161–170 | 48–56 / 61–64 | €316–368 / €276–290 | 96 and 48 measured; the rest estimated (KV) |
| RTX PRO 6000 Max-Q 96 GB | €17,710 | 101–110 / 104–110 | €161–175 / €161–170 | 49–56 / 61–64 | €316–361 / €277–290 | estimated |
| RTX PRO 5500 84 GB | €16,470 | 88–89 / 88–93 | €185–187 / €177–187 | 43–50 / 51–54 | €329–383 / €305–323 | estimated |
| RTX PRO 5000 72 GB | €11,194 | 59–69 / 65–69 | €162–190 / €162–172 | 28–40 / 38–40 | €280–400 / €280–295 | estimated |
| RTX PRO 5000 48 GB (OCR on the card) | €9,940 | 19–20 | €497–523 | 11 | €904 | estimated |
| RTX PRO 5000 48 GB (OCR on another box) | €9,940 | 38–40 | €249–262 | 22–23 | €432–452 | estimated |
| DGX Spark 128 GB | €6,600 (Founders, LDLC) · from ~€6,046 TTC (Lenovo PGX 1 TB, €5,038 HT) | 8 / 8 | **€825** (OEM €756) | 8 / 8 | **€825** (OEM €756) | **measured** 2026-10-06 |

**Reading it:**
- **Per seat, the PRO 5000 72 GB is close to the PRO 6000.** It is ~€162–190 at 32k against €161–184, but it needs a host PC and has less headroom: KV binds at 65–69 people.
- **The PRO 5500 is no better per seat than a PRO 6000.** It costs 93% of the price for 80–85% of the people.
- **The PRO 5000 48 GB is the worst per seat** unless OCR lives elsewhere.
- **Host cost.** If a card needs a new host, add the host's price ÷ people. For example, a €3,000 host (an assumption) adds ~€43–50 per seat on a PRO 5000 72 GB at 32k, and ~€27–31 on a PRO 6000.

**Spark row: measured on 2026-10-06** (docs/spike/RESULTS.md, *PRO 6000 vs Spark*).
- **Per seat:** a Spark costs **€825 per seat** for Qwen3.6, at 32k and at 64k, against the PRO 6000's €138–184
  at 32k and €276–368 at 64k. That is 4.5–6× more per seat at 32k and 2.2–3× more at 64k, before the PRO 6000's
  host PC (~€27–31 per seat).
- **With Nemotron:** 16 people at 32k, so €413 per seat.
- **KV never binds on the Spark:** the KV-bound people (168 at 32k) are far above the measured 8, so the farm
  conversion (step 3) changes nothing.
- **Sparks per PRO 6000:** the measured people ratio is **12–16× at 32k and 6–8× at 64k** for Qwen3.6, and 10–12×
  for Nemotron at 32k. Step 5's bandwidth fit was not run; the measured ratio replaces it.
- **The method that was planned:**
1. **Run** SPARK_HANDOFF.md §5 unchanged: the same harness and profiles, `followup_levels.sh … --append` at 30k / 62k / 120k, and the same pass rule.
2. **People at 32k and 64k** = the highest passing tested level, as `every turn / steady`, from `spike_bench.py summarize` + `runs/round_stats.py`.
3. **Convert to the farm config, so it compares with the rows above.** Take the start-up "GPU KV cache size / Maximum concurrency" lines, then:
   - blocks = (pool bytes − 9 GiB for OCR) ÷ 21,463,040 B (Qwen3.6 page)
   - KV-bound people = 0.88–0.93 × blocks ÷ (ceil((C+256)/2096) + 6)
   - people_farm = min(measured people, KV-bound people)
4. **€ per seat** = €6,600 (or ~€6,046 for an OEM GB10) ÷ people_farm at 32k and at 64k. No host cost: the Spark is a complete computer.
5. **Bandwidth check.** Fit t10 = a + b·N + k·N·C on the Spark's follow-up levels. k_Spark/k_PRO6000 ≈ 6.6 means bandwidth-bound at the same efficiency. The measured people ratio (PRO 6000 ÷ Spark) is the "how many Sparks per PRO 6000" figure §8 needs.
6. **Model check.** Make sure any extra Sparks are 128 GB units, not the OEM-only 64 GB version.

## Method

**How the estimates were made.** No code changed. The scratch scripts are in `<scratchpad>/pro5000/` (extract.py, fit.py, est.py, est2.py, est_nem.py, rows.json).

1. **Memory.** KV pool = 0.92 × visible VRAM − 25.77 GiB − 9.0 GiB.
   - **25.77 GiB** = the desktop plus vLLM's non-KV footprint at peak. Measured as the farm's PRO 6000 peak (77,587 MiB) minus its 50 GiB pool. That is weights 20.37 GiB + CUDA graphs 0.52 + ~3.2 runtime + the Windows desktop ~1.66.
   - **9.0 GiB** = the OCR model, worked back from DEVLOG's 88.7% (0.887 × 97,887 − 77,587 = 9,239 MiB).
   - **New cards' visible memory** is assumed to be raw × 0.99576, the PRO 6000's visible/raw ratio. Headless Linux adds 1.66 GiB.
2. **KV per person.** vLLM 0.30 counts hybrids in pages:
   - **Qwen3.6:** a 2,096-token block × 10 attention layers × 1,024 B fp8 = 21,463,040 B. Each request costs ceil(tokens/2096) + 6 blocks, the 6 being 2 GDN-state blocks per state group in align mode. The GDN state is 30 layers × (2 MiB fp32 + 48 KiB conv) = 128.8 MB per person.
   - **Nemotron:** 4,176 × 6 × 512 B = 12,828,672 B per block, + 8 blocks per request.
   - **Check:** this reproduces every vLLM start-up line exactly (58 / 50 / 52 / 18.63 GiB → 42.04 / 65.82 / 68.45 / 24.5×).
   - **Fill:** KV-bound people = 0.88–0.93 × blocks ÷ blocks per person. 0.93 is the highest fill that passed (128 × 21 of 2,901 blocks).
   - **So pool ÷ tokens is not a constant:** 11,301 B/token at max-model-len 131072, 12,447 B at 65536. The real cost is 10,240 B/token + 128.8 MB per person.
3. **Decode, steady.** Least-squares fit on the PRO 6000's follow-up levels (N ≥ 8; 30k / 62k / 120k-append; round 2):
   - p10 step time = 6.96 ms + 0.1372 ms·N + 10.96 ms·(N·C in M tokens); mean error 3%, max 10%.
   - Round 1: 6.93 + 0.1721·N + 11.11·N·C.
   - **For card X:** the whole step scales by 1,792/BW_X (optimistic). The pessimistic bound puts the per-user term on the compute ratio instead. A level passes if the step is ≤ 66.7 ms (15 tok/s).
4. **Why decode is bandwidth-bound** (from the spike's data):
   - **Same KV, same speed:** every pass point sits at 3.8–4.8M live context tokens (128×29.9k, 64×61.9k, 40×120.1k) with decode p10 15.4–16.4.
   - **Context term:** 8.45 ms per M tokens (median) against 5.71 ms to stream 10.24 GB at 1,792 GB/s, i.e. 68% of peak (52% at p10).
   - **Per-user term:** 0.130 ms against 0.072 ms to read and write the 128.8 MB fp32 state, i.e. 55%.
   - **Share of the step:** at the pass points these two memory terms are ~89% of the step time.
   - **Speed falls with users:** at 30k the median decode goes 106.7 → 78.8 → 51.7 → 31.4 → 22.2 → 18.5 tok/s for 8 → 128 users, linear at ~0.38 ms per user.
   - **Caveat:** the card drew 528–592 W (cap 600 W). A 300 W card may lose more than the bandwidth ratio suggests.
5. **First turn and cold prefill** (compute-scaled).
   - Round-1 TTFT p95 = 0.196 s + 1.384 s·(N·C in M tokens); mean error 6%. On card X it is scaled by 1/ratio, with the ratio between the compute and bandwidth ratios.
   - Cold prefill (1.13 / 3.0 / 8.0 s) is scaled by 1/compute ratio.
6. **Result.** Every turn = min(TTFT bound, round-1 decode, KV). Steady = min(decode, KV). The binding term is named in the tables. Nemotron: see its table note (low confidence).

**Not done or not verified:**
- No new card was measured.
- The PRO 5500's TOPS and bus width are unpublished (0.84–0.90 compute ratio assumed).
- New cards' visible MiB is assumed.
- WSL2-versus-native overhead is not modelled.
- Prices are retail with VAT, card only. Education prices were not visible. No currency conversion was used: all € figures come from French or Belgian shops.
- PCComponentes' PRO 5000 72 GB price comes from a marketplace seller.
- Spark: method only.

## What this changes in the plan and in RESULTS.md

Line numbers are in `multiuser_implementation_plan.md` as it reads now (revision 4).

1. **Lines 32 and 1018–1019: "A5500 means… the Blackwell RTX PRO 5000 class".** NVIDIA lists an **RTX PRO 5500 Blackwell** (84 GB, 1,398 GB/s, 600 W, about 2026-09-15). It is the card literally named after the A5500 and the newest, and LDLC lists it at €16,470 TTC. The PRO 5000 also has a 72 GB version. Ask the owner which card he means. The estimates cover all three.
2. **Lines 1007–1009: "~15 % of its memory bandwidth… about 6 Sparks".**
   - **What holds:** the ratio itself, 273/1,792 = 15.2% (6.6×).
   - **Batched efficiency:** the PRO 6000's batched decode runs at only 52–68% of peak bandwidth (context term). The Spark reaches ~85% single-stream (line 1143), so the decode gap may be smaller than 6.6×.
   - **First turn:** the every-turn TTFT limit scales with compute, and the Spark has 25% (1 vs 4 PFLOPS FP4), so ~4× there.
   - **Expectation:** about 4–6.6 Sparks per PRO 6000, not "about 6".
   - **Price per seat:** a PRO 6000 costs 2.7× a Spark (€17,680 vs €6,600). It wins per seat only if it serves more than 2.7× the Spark's people.
   - **Memory:** "~1.3× its memory" (RESULTS finding 11) is raw. Usable is about equal: the handoff budgets 85–95 GB for weights + KV on the Spark, against ~88 GiB under the PRO 6000's 92% line.
3. **Lines 1002–1005 use the spike's 58 GiB pool.** The farm runs 50 GiB to leave room for OCR (`farm/vllm/serve.sh:82-84`). At 50 GiB vLLM's own capacity is 65.8 people at full 64k windows and 36.2 at 128k (2,501 blocks ÷ 38 and ÷ 69). So:
   - **64k:** "64 once out of step" sits at the KV edge (92–97% of the pool).
   - **128k:** steady 40 no longer fits (~34–36).
   - **32k:** steady drops from 128 to ~104–110.
   - **128k class:** "A usual class fits at 128k (32 people)" still holds, but only with `--max-model-len 131072` (the recipe serves 65,536), and the margin is thin (32 against 34–36).
4. **Lines 1063 and 1072 (KV per token).** Line 1063 says "counting only attention layers (hybrids… come out right)". That undercounts: vLLM also charges each request 6 state blocks (128.8 MB) for Qwen3.6 and 8 (102.6 MB) for Nemotron. The prototype's `users * state_GB_per_user` term on line 1072 has the right shape: use 0.129 / 0.103 GB.
   - **The same miscount in RESULTS.md:** its "People by KV capacity" column (168/84/42; Qwen3.8 54/27/13; Nemotron 485/243/121) is pool tokens ÷ window. vLLM's real capacity at 58 GiB is 132/76/42 for Qwen3.6, 303/202/121 for Nemotron, and 46.6 for Qwen3.8 at 30k conversations.
   - **That explains Qwen3.8 exactly:** it collapsed at 48 users because 48 × 26 = 1,248 blocks is more than its 1,212. Footnote ³'s "well before the 54" is the miscount, not early collapse.
   - **Finding 3's "~11 KB/token" for Qwen3.6** holds only at max-model-len 131072: the farm's 65536 gives 12.4 KB.
5. **Line 1065: "~85 % of memory bandwidth" for the roofline.** Measured batched decode on the PRO 6000 runs at 52% (p10) to 68% (median) for KV reads, and ~55% for the recurrent-state term. Use the measured fit instead.
6. **RESULTS finding 5, "the KV pool is not the binding limit on the MoE hybrids".** True on the 96 GB card only. On 48 / 72 / 84 GB cards with the OCR reserve, KV binds first for Qwen3.6 at 32k and 64k.
7. **Line 1117, Qwen3.6 NVFP4 "~19 GB".** Measured: 20.37 GiB loaded (21.9 GB), 23.46 GB on disk. **Line 1123, Qwen3.8 NVFP4 "23.4 GB":** measured 19.92 GiB loaded, 21.95 GB on disk. Nemotron's 21.58 GB on disk matches; it loads as 17.82 GiB.
8. **§9.2 (lines 1134–1141)** has no rows for the PRO 5000 48 / 72 GB, the PRO 5500 or the PRO 6000 Max-Q. The spec table above can fill them.
9. **Line 11–21 "Future purchases"** carries no prices. Since the 2025 launch, PRO 6000 prices have roughly doubled (MSRP $8,565 → $16,000 on NVIDIA's marketplace; €17,680 TTC in France), and the Spark went from $3,999 to $4,699 (€6,600 TTC in France). The per-seat comparison should use today's prices.

## Sources

- Repo: docs/spike/RESULTS.md:54-56 (headline Qwen3.6 rows), :93-96 (finding 3, KB/token), :106-108 (finding 5), :141-146 (finding 11), :155-177 (Qwen3.6 detail: weights 20.4 GiB, pool 5,510,722 tokens, follow-up table), :73-74 (footnote 3)
- Repo: docs/spike/results/*.json, per-level and per-round data via spike_bench.py summarize and runs/round_stats.py (read 2026-10-05)
- Repo: WSL ~/lol-spike/logs/{qwen36_*,qwen36_seq192*,nemotron_a,qwen38_*,tcpdiag,vllm}.log (vLLM start-up lines: 'GPU KV cache size', 'Model loading took', 'Graph capturing', block sizes, 18.63/50/52/58 GiB pools); du of ~/lol-spike/hf (checkpoint sizes on disk)
- Repo: farm/README.md:253-287 (48 seats at 64k; the 50 GiB pool; 77,587 MiB peak; the sizing formula); docs/DEVLOG.md:23-34 (2026-10-05: 50 GiB pool, 19.8 GiB free, 88.7%); farm/vllm/serve.sh:82-87
- Repo: multiuser_implementation_plan.md lines 32, 1002-1009, 1016-1019, 1063-1072, 1117-1123, 1134-1143 (revision 4)
- NVIDIA RTX PRO 5000 product page: 48 GB / 72 GB GDDR7 ECC, 1,344 GB/s, 2,064 AI TOPS, 300 W, PCIe Gen 5. https://www.nvidia.com/en-us/products/workstations/professional-desktop-gpus/rtx-pro-5000/ (fetched 2026-10-05)
- NVIDIA RTX PRO 6000 Blackwell Workstation page: 96 GB, 1,792 GB/s, 4,000 AI TOPS, 125 TFLOPS FP32, 600 W. https://www.nvidia.com/en-us/products/workstations/professional-desktop-gpus/rtx-pro-6000/ (fetched 2026-10-05)
- NVIDIA RTX PRO 5500 page: 84 GB, 1,398 GB/s, up to 600 W, PCIe Gen 5 x16, MIG, 'Coming Soon'. https://www.nvidia.com/en-us/products/workstations/professional-desktop-gpus/rtx-pro-5500/ (fetched 2026-10-05)
- Igor's Lab, RTX PRO 5500 (2026-09-15). https://www.igorslab.de/en/nvidia-rtx-pro-5500-blackwell-84-gb-gddr7-600-watts-mig-between-rtx-pro-5000-and-6000/
- flopper.io, RTX PRO 5500 (2026-09-17; 21,760 CUDA cores per PNY; prints 416-bit). https://flopper.io/docs/nvidia-rtx-pro-5500-blackwell
- flopper.io, RTX PRO 5000 72GB spec (14,080 CUDA cores, 110 SMs, FP4 1,032 dense / 2,064 sparse, 300 W). https://flopper.io/gpu/nvidia-rtx-pro-5000-blackwell-72gb (fetched 2026-10-05)
- RTX PRO 6000 Max-Q specs (3,511 AI TOPS, 300 W, 1,792 GB/s, 110 TFLOPS FP32), from search results citing NVIDIA's page https://www.nvidia.com/en-us/products/workstations/professional-desktop-gpus/rtx-pro-6000-max-q (2026-10-05; medium reliability)
- NVIDIA DGX Spark page: GB10, 128 GB or 64 GB (OEM-only) LPDDR5x, 256-bit, 273 GB/s, 1 PFLOP FP4, 240 W PSU, 140 W TDP. https://www.nvidia.com/en-us/products/workstations/dgx-spark/ (fetched 2026-10-05)
- LDLC.com searches (2026-10-05): PRO 6000 WS OEM EUR 17,679.95; Max-Q EUR 17,709.95; PRO 5500 EUR 16,469.95 / 16,439.95; PRO 5000 48GB EUR 9,939.95 / 9,899.95; DGX Spark EUR 6,599.95. https://www.ldlc.com/recherche/rtx%20pro%206000/ , /rtx%20pro%205500/ , /rtx%20pro%205000/ , /dgx%20spark/
- Materiel.net (2026-10-05): PRO 5000 48GB EUR 9,939.95 / 9,899.95. https://www.materiel.net/recherche/rtx%20pro%205000/
- PCComponentes.fr (2026-10-05): PRO 5000 72GB EUR 11,193.70 TTC, marketplace seller Leasi-fr, in stock. https://www.pccomponentes.fr/carte-graphique-nvidia-pro-rtx-5000-blackwell-pcie-5-0-72-go-gddr7-prete-pour-vr-ia
- LDLC.be: PRO 5000 72GB EUR 10,559.95 TTC, no longer sold (stale). https://www.ldlc.com/fr-be/fiche/PB00734967.html
- Scan.co.uk RTX PRO Blackwell listing (2026-10-05): PRO 6000 GBP 14,259.96-14,740.99; Max-Q GBP 14,709.98; PRO 5000 48GB GBP 8,240.48-8,268.49; 72GB GBP 8,788.49 (384-bit). https://www.scan.co.uk/shop/computer-hardware/gpu-nvidia-workstation/nvidia-rtx-pro-blackwell-graphics-cards
- zstore.be: PRO 5000 48GB EUR 6,975 HTVA sale, sold out (fetched 2026-10-05). https://www.zstore.be/products/nvidia-rtx-pro-5000-blackwell-48gb-graphics
- mlq.ai (2026-08-13): NVIDIA US Marketplace lists PRO 6000 at $16,000 (out of stock), was $13,250 in June 2026; Newegg $13,998, B&H $15,499. https://mlq.ai/news/nvidia-lists-rtx-pro-6000-blackwell-workstation-gpu-at-16000/
- Thunder Compute blog: PRO 6000 launch MSRP $8,565 (March 2025), now $16,000 (the article's own date is inconsistent: low-medium reliability). https://www.thundercompute.com/blog/nvidia-rtx-pro-6000-pricing
- nowinstock.net RTX PRO tracker (2026-10-05): Newegg PRO 6000 $16,599-17,999. https://www.nowinstock.net/computers/videocards/nvidia/rtxpro/
- pi3g.com (2026-09-24): DGX Spark EU prices EUR 5,038-8,096 net; Founders $4,699 since Feb 2026; Amazon $4,999.99. https://pi3g.com/nvidia-dgx-spark-price/
- NVIDIA developer forum, '2/23/2026 Price Change Announcement' (DGX Spark $3,999 to $4,699), via search. https://forums.developer.nvidia.com/t/2-23-2026-price-change-announcement/361713
- Newegg PRO 5000 72GB product page (2026-10-05): only Hong Kong marketplace sellers, $13,135. https://www.newegg.com/nvidia-rtx-pro-5000-blackwell-72g-72-gb-video-cards/p/1FT-0004-00973 ; B&H $8,999.99 / Newegg $9,999.99 from undated search snippets (low reliability)
