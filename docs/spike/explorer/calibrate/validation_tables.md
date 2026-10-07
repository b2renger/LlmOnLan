### A. People at once, predicted vs measured (vLLM, 58 GiB KV pool, fp8 KV, 256-token replies)

Measured = the spike's label: `N` passed and the next tested level failed (true value in [N, next)), `≥ N` = highest tested passed, `< N` = lowest tested failed. Predictions are the central run. Error = distance to the measured interval (0 = inside). S0 = previous method, S1 = PRO-only physics, S2 = shipped, G = as if the model had never been measured. "class" = the explorer default (a class averages half a cache block re-computed per turn) with its low–high range.

| Box | Model | Context | Mode | Measured | S0 | S1 | S2 | G | class (low–high) | binds (S2) |
|---|---|---|---|---|---|---|---|---|---|---|
| pro6000 | qwen36 | 32k (29.9k, miss 175) | every | 96 | 118 ✓ | 119 ✓ | 119 ✓ | 122 ✓ | 68 (39–128) | decode bandwidth (first turn) |
| pro6000 | qwen36 | 32k (29.9k, miss 175) | steady | ≥ 128 | 125 (-2%) | 125 (-2%) | 125 (-2%) | 125 (-2%) | 101 (74–128) | memory (KV) |
| pro6000 | qwen36 | 64k (61.9k, miss 674) | every | 48 | 61 ✓ | 60 ✓ | 60 ✓ | 62 ✓ | 45 (25–74) | prefill compute (first token) |
| pro6000 | qwen36 | 64k (61.9k, miss 674) | steady | ≥ 64 | 72 ✓ | 68 ✓ | 68 ✓ | 72 ✓ | 62 (47–74) | decode bandwidth |
| pro6000 | qwen36 | 128k (120.1k, miss 222) | every | 32 | 31 (-3%) | 41 (+5%) | 41 (+5%) | 41 (+5%) | 27 (16–42) | memory (KV) |
| pro6000 | qwen36 | 128k (120.1k, miss 222) | steady | ≥ 40 | 41 ✓ | 41 ✓ | 41 ✓ | 41 ✓ | 37 (29–42) | memory (KV) |
| pro6000 | nemotron | 32k (29.9k, miss 298) | every | 160 | 109 (-32%) | 167 ✓ | 167 ✓ | 213 (+12%) | 46 (25–155) | prefill compute (first token) |
| pro6000 | nemotron | 32k (29.9k, miss 298) | steady | ≥ 192 | 212 ✓ | 246 ✓ | 246 ✓ | 274 ✓ | 127 (78–258) | decode bandwidth |
| pro6000 | nemotron | 64k (61.9k, miss 3021) | every | 16 | 53 (+71%) | 27 ✓ | 27 ✓ | 35 (+13%) | 37 (20–122) | prefill compute (first token) |
| pro6000 | nemotron | 64k (61.9k, miss 3021) | steady | ≥ 64 | 104 ✓ | 76 ✓ | 76 ✓ | 123 ✓ | 94 (59–179) | decode bandwidth |
| pro6000 | nemotron | 128k (119.8k, miss 2472) | every | 24 | 27 ✓ | 23 (-4%) | 23 (-4%) | 31 ✓ | 26 (14–89) | prefill compute (first token) |
| pro6000 | nemotron | 128k (119.8k, miss 2472) | steady | ≥ 48 | 54 ✓ | 59 ✓ | 59 ✓ | 87 ✓ | 64 (42–116) | decode bandwidth |
| pro6000 | qwen38 | 32k (30.3k, miss 110) | every | 16 | 35 (+13%) | 42 (+35%) | 42 (+35%) | 39 (+26%) | 30 (17–43) | memory (KV) |
| pro6000 | qwen38 | 32k (30.3k, miss 110) | steady | 32 | 42 ✓ | 42 ✓ | 42 ✓ | 42 ✓ | 38 (29–43) | memory (KV) |
| pro6000 | qwen38 | 64k (61.9k, miss 338) | every | ≥ 24 | 23 (-4%) | 23 (-4%) | 23 (-4%) | 21 (-12%) | 20 (12–24) | memory (KV) |
| pro6000 | qwen38 | 64k (61.9k, miss 338) | steady | ≥ 24 | 23 (-4%) | 23 (-4%) | 23 (-4%) | 23 (-4%) | 22 (17–24) | memory (KV) |
| pro6000 | qwen38 | 128k (119.8k, miss 224) | every | ≥ 12 | 13 ✓ | 13 ✓ | 13 ✓ | 12 ✓ | 11 (8–13) | memory (KV) |
| pro6000 | qwen38 | 128k (119.8k, miss 224) | steady | ≥ 12 | 13 ✓ | 13 ✓ | 13 ✓ | 13 ✓ | 13 (10–13) | memory (KV) |
| spark | qwen36 | 32k (30.3k, miss 514) | every | 8 | 6 (-25%) | 13 ✓ | 12 ✓ | 12 ✓ | 11 (8–14) | decode bandwidth (first turn) |
| spark | qwen36 | 32k (30.3k, miss 514) | steady | 8 | 7 (-12%) | 13 ✓ | 13 ✓ | 13 ✓ | 12 (9–15) | decode bandwidth |
| spark | qwen36 | 64k (61.9k, miss 676) | every | 8 | 4 (-50%) | 8 ✓ | 8 ✓ | 8 ✓ | 7 (5–10) | decode bandwidth |
| spark | qwen36 | 64k (61.9k, miss 676) | steady | 8 | 4 (-50%) | 9 ✓ | 8 ✓ | 9 ✓ | 8 (6–10) | decode bandwidth |
| spark | qwen36 | 128k (120.1k, miss 216) | every | 4 | 2 (-50%) | 6 ✓ | 5 ✓ | 6 ✓ | 5 (3–6) | decode bandwidth (first turn) |
| spark | qwen36 | 128k (120.1k, miss 216) | steady | 4 | 2 (-50%) | 6 ✓ | 6 ✓ | 6 ✓ | 5 (4–6) | decode bandwidth |
| spark | nemotron | 32k (30.3k, miss 635) | every | 16 | 5 (-69%) | 16 ✓ | 15 (-6%) | 17 ✓ | 9 (5–17) | decode bandwidth (first turn) |
| spark | nemotron | 32k (30.3k, miss 635) | steady | 16 | 5 (-69%) | 17 ✓ | 16 ✓ | 18 ✓ | 13 (9–19) | decode bandwidth |
| spark | nemotron | 64k (61.9k, miss 3019) | every | < 8 | 2 ✓ | 6 ✓ | 5 ✓ | 7 ✓ | 7 (4–14) | prefill compute (first token) |
| spark | nemotron | 64k (61.9k, miss 3019) | steady | 8 | 2 (-75%) | 11 ✓ | 9 ✓ | 12 ✓ | 10 (8–15) | decode bandwidth |
| spark | nemotron | 128k (120.1k, miss 2813) | every | 4 | 1 (-75%) | 5 ✓ | 4 ✓ | 5 ✓ | 5 (3–11) | prefill compute (first token) |
| spark | nemotron | 128k (120.1k, miss 2813) | steady | 4 | 1 (-75%) | 8 (+14%) | 7 ✓ | 9 (+29%) | 8 (6–12) | decode bandwidth |
| spark | qwen38 | 32k (30.3k, miss 110) | every | < 4 | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | 0 (0–0) | decode bandwidth |
| spark | qwen38 | 32k (30.3k, miss 110) | steady | < 4 | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | 0 (0–0) | decode bandwidth |
| spark | qwen38 | 64k (61.9k, miss 350) | every | < 8 | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | 0 (0–0) | decode bandwidth |
| spark | qwen38 | 64k (61.9k, miss 350) | steady | < 8 | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | 0 (0–0) | decode bandwidth |
| spark | qwen38 | 128k (120.1k, miss 539) | every | < 2 | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | 0 (0–0) | decode bandwidth |
| spark | qwen38 | 128k (120.1k, miss 539) | steady | < 2 | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | 0 (0–0) | decode bandwidth |

**Summary of people errors** (mean |error| / worst |error| / cells inside the measured interval):

| Stage | PRO 6000 | Spark (out of sample for S0, S1) |
|---|---|---|
| S0 | 7% / 71% / 11 of 18 | 33% / 75% / 7 of 18 |
| S1 | 3% / 35% / 12 of 18 | 1% / 14% / 17 of 18 |
| S2 | 3% / 35% / 12 of 18 | 0% / 6% / 17 of 18 |
| G | 4% / 26% / 11 of 18 | 2% / 29% / 17 of 18 |

The explorer's default ("class": half a cache block re-computed per turn) overlaps the measured interval with its low–high range in 17 of 18 PRO cells and 18 of 18 Spark cells.

### B. One person alone: decode tok/s, predicted vs measured

| Box | Model | Context | Measured | S1 | S2 | G |
|---|---|---|---|---|---|---|
| pro6000 | qwen36 | 4k chat | 192.7 | 183.0 (-5%) | 182.9 (-5%) | 217.0 (+13%) |
| pro6000 | qwen36 | 32k cold | 187.4 | 176.2 (-6%) | 176.1 (-6%) | 208.8 (+11%) |
| pro6000 | qwen36 | 64k cold | 181.9 | 169.0 (-7%) | 169.0 (-7%) | 200.2 (+10%) |
| pro6000 | qwen36 | 128k cold | 170.3 | 157.8 (-7%) | 157.7 (-7%) | 186.6 (+10%) |
| pro6000 | nemotron | 4k chat | 243.4 | 215.2 (-12%) | 215.2 (-12%) | 207.3 (-15%) |
| pro6000 | nemotron | 32k cold | 240.3 | 212.4 (-12%) | 212.4 (-12%) | 204.3 (-15%) |
| pro6000 | nemotron | 64k cold | 238.5 | 209.1 (-12%) | 209.1 (-12%) | 201.0 (-16%) |
| pro6000 | nemotron | 128k cold | 233.9 | 203.7 (-13%) | 203.7 (-13%) | 195.3 (-16%) |
| pro6000 | qwen38 | 4k chat | 63.6 | 66.7 (+5%) | 66.7 (+5%) | 63.8 (+0%) |
| pro6000 | qwen38 | 32k cold | 61.5 | 63.8 (+4%) | 63.8 (+4%) | 60.9 (-1%) |
| pro6000 | qwen38 | 64k cold | 59.0 | 60.8 (+3%) | 60.8 (+3%) | 58.0 (-2%) |
| pro6000 | qwen38 | 128k cold | 55.3 | 56.2 (+2%) | 56.2 (+2%) | 53.4 (-3%) |
| spark | qwen36 | 4k chat | 76.5 | 82.2 (+7%) | 76.5 (+0%) | 69.6 (-9%) |
| spark | qwen36 | 32k cold | 69.4 | 73.8 (+6%) | 69.2 (0%) | 64.3 (-7%) |
| spark | qwen36 | 64k cold | 63.2 | 66.1 (+5%) | 62.4 (-1%) | 59.2 (-6%) |
| spark | qwen36 | 128k cold | 54.6 | 55.9 (+2%) | 53.2 (-3%) | 51.9 (-5%) |
| spark | nemotron | 4k chat | 69.6 | 87.6 (+26%) | 69.6 (+0%) | 80.4 (+16%) |
| spark | nemotron | 32k cold | 68.1 | 84.6 (+24%) | 67.7 (-1%) | 77.5 (+14%) |
| spark | nemotron | 64k cold | 66.5 | 81.3 (+22%) | 65.6 (-1%) | 74.4 (+12%) |
| spark | nemotron | 128k cold | 64.0 | 76.1 (+19%) | 62.2 (-3%) | 69.5 (+9%) |
| spark | qwen38 | 4k chat | 12.1 | 12.1 (0%) | 12.1 (0%) | 12.0 (-1%) |
| spark | qwen38 | 32k cold | 11.5 | 11.5 (0%) | 11.5 (0%) | 11.3 (-1%) |
| spark | qwen38 | 64k cold | 10.8 | 10.8 (+1%) | 10.8 (+1%) | 10.7 (-1%) |
| spark | qwen38 | 128k cold | 10.0 | 9.9 (-1%) | 9.9 (-1%) | 9.7 (-3%) |

Mean |error|: S1 8% (worst 26%), S2 4% (worst 13%), G 8% (worst 16%).

### C. One person pastes the whole context (cold prefill), seconds

| Box | Model | Context | Measured | S1 | S2 | G |
|---|---|---|---|---|---|---|
| pro6000 | qwen36 | 32k | 1.1 | 1.1 (-1%) | 1.1 (-1%) | 1.2 (+8%) |
| pro6000 | qwen36 | 64k | 3.0 | 3.0 (+0%) | 3.0 (+0%) | 3.1 (+3%) |
| pro6000 | qwen36 | 128k | 8.0 | 8.0 (+0%) | 8.0 (+0%) | 7.7 (-3%) |
| pro6000 | nemotron | 32k | 1.1 | 1.1 (+1%) | 1.1 (+1%) | 0.9 (-19%) |
| pro6000 | nemotron | 64k | 2.5 | 2.5 (0%) | 2.5 (0%) | 1.9 (-22%) |
| pro6000 | nemotron | 128k | 5.7 | 5.7 (0%) | 5.7 (0%) | 4.3 (-24%) |
| pro6000 | qwen38 | 32k | 3.3 | 3.2 (-1%) | 3.2 (-1%) | 3.9 (+19%) |
| pro6000 | qwen38 | 64k | 8.1 | 8.1 (+0%) | 8.1 (+0%) | 9.7 (+20%) |
| pro6000 | qwen38 | 128k | 20.9 | 20.9 (0%) | 20.9 (0%) | 24.7 (+18%) |
| spark | qwen36 | 32k | 6.1 | 4.5 (-26%) | 5.4 (-11%) | 5.9 (-3%) |
| spark | qwen36 | 64k | 15.2 | 11.9 (-22%) | 14.3 (-6%) | 14.7 (-3%) |
| spark | qwen36 | 128k | 38.7 | 31.9 (-17%) | 38.5 (-1%) | 37.2 (-4%) |
| spark | nemotron | 32k | 5.7 | 4.3 (-25%) | 5.2 (-9%) | 4.1 (-28%) |
| spark | nemotron | 64k | 13.0 | 9.9 (-24%) | 11.9 (-9%) | 9.3 (-29%) |
| spark | nemotron | 128k | 29.6 | 22.7 (-23%) | 27.3 (-7%) | 20.9 (-29%) |
| spark | qwen38 | 32k | 14.6 | 12.9 (-12%) | 15.5 (+6%) | 18.7 (+28%) |
| spark | qwen38 | 64k | 36.7 | 32.6 (-11%) | 39.2 (+7%) | 46.8 (+28%) |
| spark | qwen38 | 128k | 93.1 | 83.5 (-10%) | 100.6 (+8%) | 119.0 (+28%) |

Mean |error|: S1 10% (worst 26%), S2 4% (worst 11%), G 18% (worst 29%). On the PRO, S1 = S2 = in-sample.

### D. Models never measured by the studio: one person's decode tok/s vs reported runs (shipped constants, generic)

| Model | Box | Checkpoint used | Reported (source, date) | Predicted mid (low–high) | Error vs reported mid |
|---|---|---|---|---|---|
| gpt-oss-120b | dgx-spark | MXFP4 (native release) | 55.4–60.4 (NVIDIA blog 2025-10-24 llama.cpp 55.4; plan §9 vLLM 60.4) | 61.1 (48.6–80.2) | +5% |
| gpt-oss-120b | dgx-spark-x2 (TP=2) | MXFP4 (native release) | 75 (NVIDIA forum 2025-12, vLLM TP=2) | 72.5 (57.5–96.3) | -3% |
| qwen3.5-122b-a10b | dgx-spark | NVFP4 | 30 (NVIDIA forum 2026 spring, plain vLLM) | 31.7 (26.4–38.7) | +6% |
| nemotron-3-super-120b-a12b | dgx-spark | NVFP4 | 22.7–23.7 (vLLM blog 2026-06-01) | 28.1 (23.5–34.0) | +21% |
| qwen3.8-flash-next | dgx-spark | NVFP4, n-gram table offloaded to NVMe (patched vLLM) | 41.7 (ai-muninn 2026-09-12) | 43.5 (35.7–54.5) | +4% |
| qwen3.8-flash-next | dgx-spark-x2 (TP=2) | NVFP4 (routed experts W4A4; attention + shared experts BF16; n-gram FP8) | 51.9 (ai-muninn 2026-09-12, vLLM TP=2) | 54.2 (43.8–70.0) | +5% |
| qwen3.5-397b-a17b | dgx-spark-x2 (TP=2) | int4 AutoRound | 26–30.8 (NVIDIA forum 2026-03 / 2026-07-03, vLLM TP=2) | 33.9 (28.1–42.1) | +19% |
| minimax-m2.7 | dgx-spark-x2 (TP=2) | AWQ 4-bit | 40 (NVIDIA forum (search snippet), vLLM TP=2) | 43.4 (35.3–55.6) | +9% |
| glm-5.3-flash | dgx-spark-x2 (TP=2) | NVFP4 | 14.7 (NVIDIA forum 2026-08-28, SGLang TP=2, no MTP) | 32.2 (26.8–39.5) | +119% |
| deepseek-v4-flash-0731 | dgx-spark-x2 (TP=2) | FP8 attention + FP4 experts (official) | 41 (GitHub 2026-06, vLLM TP=2) | 43.1 (35.3–54.1) | +5% |
| qwen3-coder-next | dgx-spark | GGUF UD-Q4_K_XL | 60.8 (plan §9 vLLM NVFP4 42.7 GiB (proxy: the 4-bit GGUF entry)) | 75.3 (59.0–101.3) | +24% |
| ternary-bonsai-2-27b | rtx-5090 | GGUF PQ2_0 (2-bit slots, 2.13 bpw) | 129.9 (PrismML model card, llama.cpp fork) | 139.7 (117.1–169.3) | +8% |
| ternary-bonsai-2-27b | rtx-pro-6000-ws | GGUF PQ2_0 (2-bit slots, 2.13 bpw) | 124.8 (PrismML model card, llama.cpp fork) | 139.7 (117.1–169.3) | +12% |

Mean |error| 18%, worst 119% (signed mean +18%).

### E. Many people on Sparks, models never measured: aggregate decode tok/s at N users vs reported

Reported runs give no context size; the check uses a 2k-token context and 256-token replies, steady state.

| Model | Box | N | Reported aggregate tok/s (source) | Predicted mid (low–high) | Error |
|---|---|---|---|---|---|
| gpt-oss-120b | dgx-spark | 8 | 141.9 (plan §9, vLLM) | 147 (104–226) | +3% |
| gpt-oss-120b | dgx-spark | 16 | 181.2 (plan §9, vLLM) | 174 (124–271) | -4% |
| gpt-oss-120b | dgx-spark-x2 | 32 | 292.5 (NVIDIA forum 2025-12, vLLM TP=2 (SGLang 323)) | 390 (290–583) | +33% |
| deepseek-v4-flash-0731 | dgx-spark-x2 | 32 | 350 (GitHub 2026-06, vLLM TP=2) | 200 (145–307) | -43% |
| glm-5.3-flash | dgx-spark-x2 | 8 | 55.1 (NVIDIA forum 2026-08-28, SGLang TP=2 (78 with fp8 KV)) | 67 (41–125) | +22% |

Mean |error| 21% (signed +2%).
