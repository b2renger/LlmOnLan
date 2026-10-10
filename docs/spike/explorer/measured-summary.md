# Measured spike data: headline numbers (for checking measured.json)

Written 2026-10-09T18:58+02:00 from `measured.json` (generated 2026-10-09T18:58:51+02:00) by `write_summary.py`. Sources: `docs/spike/results/*.json` (PRO 6000 run 2026-10-04; DGX Spark run 2026-10-05 13:51 to 2026-10-06 11:37), RESULTS.md / README.md / ESTIMATES_2026-10-05.md (mtime 2026-10-06 17:09-17:12), the Spark guard CSV. Superseded runs excluded.

**Pass rule:** no errors, TTFT p95 < 5 s, per-user decode p10 >= 15 tok/s. People = the largest passing tested level, `every turn / steady`. `≥ N` = N was the top level tested; `< N` = the lowest level tested (N) failed; `0` = one user failed. Follow-ups: every turn = the first follow-up (round 1) and the later one (round 2) both pass; steady = round 2. Follow-up rows use the `--append` run where one exists, as RESULTS.md's headline does.

## measured.json at a glance

- `configs[]` - one per box x engine x model (x llama.cpp `--parallel` variant): `id` (e.g. `spark/vllm/qwen36`), `server_flags`, `runs[]` (source file, profile, start/finish, notes), `profiles{chat, chat_nothink, agent, cold_32k|64k|128k, followup_<32k|64k|128k>_<append|replace>}` each with `levels[]` (one per tested concurrency, raw tails kept) and `people_every` / `people_steady` (`{pass, fail, label, tested}`; follow-ups also `people_pooled`), `people{chat_4k, agent_step, chat_4k_thinking_off_natural, followup_32k|64k|128k, cold_32k|64k|128k}` (headline, follow-ups prefer `--append`), `single_user`, `cold_prefill_single_user`, `peak_aggregate`, `quality{thinking_on, thinking_off}`, `memory`, `kv`.
- Chat/agent/cold level: `c, run, n, err, prompt_tok, out_tok, ttft_p50, ttft_p95, ttft_p95_r0, ttft_p50_steady, ttft_p95_steady, dec_p50, dec_p10, dec_p10_steady, agg_tps, pass_every, pass_steady, pass_median, kv_use_max, preempt, prefix_hit, waiting_max, power_w, vram_mib`.
- Follow-up level: the same pooled fields plus `r1` / `r2` (`ttft_p50, ttft_p95, dec_p10, dec_p50, n, pass`), `pass_pooled`, `pass_every` (r1 and r2), `pass_steady` (r2), `cold_load`, `cached_tok`.
- `headline[]` - flat rows (config x scenario -> every/steady label and number) for a table. `hardware{}` - specs and prices (measured boxes + the ESTIMATES cards, flagged). `models{}` - checkpoints, weights, vLLM paging (`page_bytes`, `block_tokens`, `fixed_blocks_per_request`). `rethreshold` - how to re-apply another TTFT / decode bar from the raw tails. `checks`, `crosscheck_vs_results_md`, `sources`.

## People per box

| Config | 4k chat | Agent step | At 32k | At 64k | At 128k | Cold 32k | Cold 64k | Cold 128k |
|---|---|---|---|---|---|---|---|---|
| PRO 6000 · vLLM · Qwen3.6-35B-A3B | 64 / 160 | 64 / ≥ 192 | 96 / ≥ 128 | 48 / ≥ 64 | 32 / ≥ 40 | 4 / n/a | 2 / n/a | 0 / n/a |
| PRO 6000 · vLLM · Nemotron 3.5 Lightning | 64 / ≥ 192 | 96 / ≥ 192 | 160 / ≥ 192 | 16 / ≥ 64 | 24 / ≥ 48 | 4 / ≥ 16 | 2 / 4 | 0 / 0 |
| PRO 6000 · vLLM · Qwen3.8-27B (dense) | 16 / 32 | 32 / 96 | 16 / 32 | ≥ 24 / ≥ 24 | ≥ 12 / ≥ 12 | 2 / 4 | 0 / 0 | 0 / 0 |
| PRO 6000 · llama.cpp · Nemotron 3.5 Lightning p16 | 8 / 16 | 4 / 16 | 4 / 8 | — | < 2 / ≥ 4 | 1 / n/a | — | — |
| PRO 6000 · llama.cpp · Nemotron 3.5 Lightning p8 | 8 / n/a | 4 / n/a | — | — | — | 1 / n/a | — | — |
| PRO 6000 · llama.cpp · Qwen3.8-27B (dense) p8 | 1 / n/a | 1 / n/a | — | — | — | 0 / n/a | — | — |
| PRO 6000 · llama.cpp · Qwen3.8-27B (dense) p16 | 1 / n/a | 1 / n/a | — | — | — | — | — | — |
| Spark · vLLM · Qwen3.6-35B-A3B | 8 / 16 | 8 / 16 | 8 / 8 | 8 / 8 | 4 / 4 | 0 / 0 | 0 / 0 | 0 / 0 |
| Spark · vLLM · Nemotron 3.5 Lightning | 8 / 16 | 16 / 16 | 16 / 16 | < 8 / 8 | 4 / 4 | 0 / 0 | 0 / 0 | 0 / 0 |
| Spark · vLLM · Qwen3.8-27B (dense) | 0 / 0 | 0 / 0 | < 4 / < 4 | < 8 / < 8 | < 2 / < 2 | 0 / 0 | 0 / 0 | 0 / 0 |
| Spark · llama.cpp · Nemotron 3.5 Lightning p16 | 1 / 4 | 1 / 4 | 2 / 4 | — | 1 / 2 | 0 / 0 | — | — |
| Spark · llama.cpp · Qwen3.8-27B (dense) p8 | 0 / 0 | 0 / 0 | — | — | — | 0 / 0 | — | — |
| Spark · llama.cpp · Qwen3.8-27B (dense) p16 | 0 / 0 | 0 / 0 | — | — | — | — | — | — |

Alternative follow-up modes kept in measured.json (`profiles.followup_<ctx>_replace`): PRO 6000 Qwen3.8 32k replace = < 8 / ≥ 32 (cache miss on the first follow-up); Spark Qwen3.6 32k replace = 8 / 16, 128k replace = < 4 / ≥ 4; Spark Nemotron 128k replace = 4 / 8.

## Speed

| Config | 1-user decode (tok/s, 4k chat) | 1-user TTFT 4k (s) | Cold prefill alone 32k / 64k / 128k (s) | Prefill tok/s at 32k | Peak aggregate (tok/s @ users, profile) |
|---|---|---|---|---|---|
| PRO 6000 · vLLM · Qwen3.6-35B-A3B | 192.72 | 0.133 | 1.128 / 2.957 / 7.979 | 28330.0 | 3430.9 @ 192 (agent) |
| PRO 6000 · vLLM · Nemotron 3.5 Lightning | 243.44 | 0.117 | 1.066 / 2.475 / 5.681 | 29971.0 | 4959.0 @ 192 (agent) |
| PRO 6000 · vLLM · Qwen3.8-27B (dense) | 63.63 | 0.323 | 3.253 / 8.131 / 20.916 | 9842.0 | 1662.8 @ 128 (agent) |
| PRO 6000 · llama.cpp · Nemotron 3.5 Lightning p16 | 317.57 | 0.46 | 3.432 / — / — | 9312.0 | 597.7 @ 8 (agent) |
| PRO 6000 · llama.cpp · Nemotron 3.5 Lightning p8 | 315.21 | 0.482 | 3.304 / — / — | 9659.0 | 592.3 @ 8 (agent) |
| PRO 6000 · llama.cpp · Qwen3.8-27B (dense) p8 | 72.56 | 1.36 | 10.599 / — / — | 3022.0 | 178.9 @ 8 (agent) |
| PRO 6000 · llama.cpp · Qwen3.8-27B (dense) p16 | 73.65 | 1.31 | — / — / — | — | 195.9 @ 16 (agent) |
| Spark · vLLM · Qwen3.6-35B-A3B | 76.46 | 0.616 | 6.061 / 15.182 / 38.678 | 5273.0 | 584.8 @ 160 (agent) |
| Spark · vLLM · Nemotron 3.5 Lightning | 69.57 | 0.626 | 5.694 / 13.016 / 29.559 | 5616.0 | 858.3 @ 192 (agent) |
| Spark · vLLM · Qwen3.8-27B (dense) | 12.09 | 1.47 | 14.645 / 36.715 / 93.147 | 2186.0 | 271.6 @ 96 (agent) |
| Spark · llama.cpp · Nemotron 3.5 Lightning p16 | 73.68 | 2.47 | 15.012 / — / — | 2130.0 | 129.0 @ 16 (agent) |
| Spark · llama.cpp · Qwen3.8-27B (dense) p8 | 11.66 | 6.736 | 46.271 / — / — | 692.0 | 34.9 @ 8 (chat) |
| Spark · llama.cpp · Qwen3.8-27B (dense) p16 | 11.64 | 7.206 | — / — / — | — | 37.6 @ 16 (chat) |

Peak aggregate is the highest `agg_tps` of any level; on the Spark it sits at levels that fail the decode bar (e.g. Nemotron 858 tok/s at 192 users, 4.1 tok/s each).

## Quality gate (28 items; score, completion tokens)

| Config | Thinking on | Thinking off | Thinking-on misses |
|---|---|---|---|
| PRO 6000 · vLLM · Qwen3.6-35B-A3B | 27/28 (77,344 tok) | 28/28 (12,420 tok) | tool_search (final answer lacks index.ts/store.ts/reconnect) |
| PRO 6000 · vLLM · Nemotron 3.5 Lightning | 25/28 (67,692 tok) | 26/28 (7,295 tok) | code_parse_duration (hit max_tokens); code_eval_expr (hit max_tokens); code_palindrome (hit max_tokens) |
| PRO 6000 · vLLM · Qwen3.8-27B (dense) | 26/28 (55,331 tok) | 28/28 (10,852 tok) | code_eval_expr (hit max_tokens); code_palindrome (hit max_tokens) |
| PRO 6000 · llama.cpp · Nemotron 3.5 Lightning p8 | 26/28 (65,029 tok) | — | code_parse_duration (hit max_tokens); code_eval_expr (hit max_tokens) |
| PRO 6000 · llama.cpp · Qwen3.8-27B (dense) p8 | 26/28 (47,504 tok) | — | code_eval_expr (hit max_tokens); code_palindrome (hit max_tokens) |
| Spark · vLLM · Qwen3.6-35B-A3B | 27/28 (89,094 tok) | 26/28 (12,339 tok) | tool_search (final answer lacks index.ts/store.ts/reconnect) |
| Spark · vLLM · Nemotron 3.5 Lightning | 26/28 (61,357 tok) | 27/28 (6,711 tok) | code_parse_duration (hit max_tokens); code_eval_expr (hit max_tokens) |
| Spark · vLLM · Qwen3.8-27B (dense) | 26/28 (23,684 tok) | 28/28 (11,351 tok) | code_eval_expr (client timeout (no tokens recorded)); code_palindrome (client timeout (no tokens recorded)) |
| Spark · llama.cpp · Nemotron 3.5 Lightning p16 | 26/28 (62,105 tok) | — | code_parse_duration (hit max_tokens); code_eval_expr (hit max_tokens) |
| Spark · llama.cpp · Qwen3.8-27B (dense) p8 | 25/28 (18,409 tok) | — | code_parse_duration (client timeout (no tokens recorded)); code_eval_expr (client timeout (no tokens recorded)); code_palindrome (client timeout (no tokens recorded)) |

## KV capacity (vLLM, 58 GiB pool on both boxes) and memory

| Config | Blocks | People by KV, naive (pool tokens ÷ window) 32k / 64k / 128k | **Corrected** (blocks ÷ (ceil(ctx/block) + fixed)) | Per person at the follow-up sizes (MB) | Memory used |
|---|---|---|---|---|---|
| PRO 6000 · vLLM · Qwen3.6-35B-A3B | 2,901 | 168.17 / 84.09 / 42.04 | **131.9 / 76.3 / 42.0** | 450.7 / 772.7 / 1373.6 | 85,703–86,998 MiB VRAM (83.7–85.0 GiB), of 97,887 |
| PRO 6000 · vLLM · Nemotron 3.5 Lightning | 4,854 | 485.4 / 242.7 / 121.35 | **303.4 / 202.2 / 121.3** | 205.3 / 295.1 / 474.7 | 87,017–87,245 MiB VRAM (85.0–85.2 GiB), of 97,887 |
| PRO 6000 · vLLM · Qwen3.8-27B (dense) | 1,212 | 53.87 / 26.93 / 13.47 | **44.9 / 25.2 / 13.5** | 1335.9 / 2363.5 / 4264.6 | 88,280–89,748 MiB VRAM (86.2–87.6 GiB), of 97,887 |
| PRO 6000 · llama.cpp · Nemotron 3.5 Lightning p16 | pool 2,097,152 tokens, 16 slots | 16 / 16 / 16 (slots) | — | — | 36,616–36,787 MiB VRAM (35.8–35.9 GiB), of 97,887 |
| PRO 6000 · llama.cpp · Nemotron 3.5 Lightning p8 | pool 1,048,576 tokens, 8 slots | 8 / 8 / 8 (slots) | — | — | 31,052–31,083 MiB VRAM (30.3–30.4 GiB), of 97,887 |
| PRO 6000 · llama.cpp · Qwen3.8-27B (dense) p8 | pool 262,144 tokens, 8 slots | 8 / 4 / 2 (slots) | — | — | 28,601–28,646 MiB VRAM (27.9–28.0 GiB), of 97,887 |
| PRO 6000 · llama.cpp · Qwen3.8-27B (dense) p16 | pool 524,288 tokens, 16 slots | 16 / 8 / 4 (slots) | — | — | 39,782–39,795 MiB VRAM (38.8–38.9 GiB), of 97,887 |
| Spark · vLLM · Qwen3.6-35B-A3B | 2,901 | 168.17 / 84.09 / 42.04 | **131.9 / 76.3 / 42.0** | 450.7 / 772.7 / 1373.6 | 90–97 GB unified during runs (p50 96); start-up peaks: 108 GB |
| Spark · vLLM · Nemotron 3.5 Lightning | 4,854 | 485.4 / 242.7 / 121.35 | **303.4 / 202.2 / 121.3** | 205.3 / 295.1 / 474.7 | 88–89 GB unified during runs (p50 89); start-up peaks: 89 GB |
| Spark · vLLM · Qwen3.8-27B (dense) | 1,212 | 53.87 / 26.93 / 13.47 | **44.9 / 25.2 / 13.5** | 1335.9 / 2363.5 / 4264.6 | 93–93 GB unified during runs (p50 93); start-up peaks: 116 GB, 93 GB |
| Spark · llama.cpp · Nemotron 3.5 Lightning p16 | pool 2,097,152 tokens, 16 slots | 16 / 16 / 16 (slots) | — | — | 42–68 GB unified during runs (p50 66); start-up peaks: 28 GB |
| Spark · llama.cpp · Qwen3.8-27B (dense) p8 | pool 262,144 tokens, 8 slots | 8 / 4 / 2 (slots) | — | — | 33–61 GB unified during runs (p50 55); start-up peaks: 30 GB |
| Spark · llama.cpp · Qwen3.8-27B (dense) p16 | pool 524,288 tokens, 16 slots | 16 / 8 / 4 (slots) | — | — | 43–76 GB unified during runs (p50 68); start-up peaks: — |

Paging per model (vLLM 0.30): Qwen3.6-35B-A3B page 21,463,040 B, 2,096-token blocks, +6 blocks per request (128.8 MB recurrent state); Nemotron 3.5 Lightning page 12,828,672 B, 4,176-token blocks, +8 blocks per request (102.6 MB recurrent state); Qwen3.8-27B (dense) page 51,380,224 B, 1,568-token blocks, +6 blocks per request (308.3 MB recurrent state). Qwen3.6 and Nemotron pages are ESTIMATES' figures; Qwen3.8's page is derived here (it reproduces 1,212 blocks, 13.47× and 46.6).

## Hardware facts used

| Box | Memory | Bandwidth (GB/s) | FP4 TOPS (sparse) | Power | Price € TTC (date, where) | Host needed | Measured |
|---|---|---|---|---|---|---|---|
| NVIDIA RTX PRO 6000 Blackwell Workstation Edition | 96 GB | 1792 | 4000 | 600 | 17,679.95 (2026-10-05, LDLC.com (OEM, 7-15 days)) | yes | yes |
| NVIDIA DGX Spark (GB10, Founders Edition) | 128 GB | 273 | 1000 | GB10 140 W TDP, 240 W PSU | 6,599.95 (2026-10-05, LDLC.com (PNY Founders, +15 days)) | no | yes |
| RTX PRO 6000 Blackwell Max-Q | 96 GB | 1792 | 3511 | 300 | 17,709.95 (2026-10-05, LDLC.com (in stock)) | yes | no (estimate only) |
| RTX PRO 5500 Blackwell | 84 GB | 1398 | unpublished; est. ~3,350-3,600 | 600 | 16,469.95 (2026-10-05, LDLC.com (retail; NVIDIA says 'coming soon')) | yes | no (estimate only) |
| RTX PRO 5000 Blackwell 72 GB | 72 GB | 1344 | 2064 | 300 | 11,193.70 (2026-10-05, PCComponentes.fr marketplace seller (medium reliability)) | yes | no (estimate only) |
| RTX PRO 5000 Blackwell 48 GB | 48 GB | 1344 | 2064 | 300 | 9,939.95 (2026-10-05, LDLC.com / Materiel.net) | yes | no (estimate only) |

Spark OEM GB10 boxes from €5,038 HT (~€6,046 TTC). Two Sparks link through ConnectX-7 200 Gb/s: **no two-box run exists in the spike**.

## Disagreements with RESULTS.md

112 checks against RESULTS.md: 87 agree, 7 qualifier only, 12 disagree, 6 notes. The non-agreements:

| Status | Item | RESULTS.md | Measured | Note |
|---|---|---|---|---|
| qualifier | pro6000/vllm/qwen36 followup_32k people (every / steady) | 96 / 128 | 96 / ≥ 128 | RESULTS.md drops the '≥': the steady count passed at the highest level tested, so it is a lower bound (ESTIMATES' Nemotron table and validation table do write '≥'). |
| qualifier | pro6000/vllm/qwen36 followup_64k people (every / steady) | 48 / 64 | 48 / ≥ 64 | RESULTS.md drops the '≥': the steady count passed at the highest level tested, so it is a lower bound (ESTIMATES' Nemotron table and validation table do write '≥'). |
| qualifier | pro6000/vllm/qwen36 followup_128k people (every / steady) | 32 / 40 | 32 / ≥ 40 | RESULTS.md drops the '≥': the steady count passed at the highest level tested, so it is a lower bound (ESTIMATES' Nemotron table and validation table do write '≥'). |
| qualifier | pro6000/vllm/nemotron followup_64k people (every / steady) | 16 / 64 | 16 / ≥ 64 | RESULTS.md drops the '≥': the steady count passed at the highest level tested, so it is a lower bound (ESTIMATES' Nemotron table and validation table do write '≥'). |
| qualifier | pro6000/vllm/nemotron followup_128k people (every / steady) | 24 / 48 | 24 / ≥ 48 | RESULTS.md drops the '≥': the steady count passed at the highest level tested, so it is a lower bound (ESTIMATES' Nemotron table and validation table do write '≥'). |
| qualifier | pro6000/vllm/nemotron cold_32k people (every / steady) | 4 / 16 | 4 / ≥ 16 | RESULTS.md drops the '≥': the steady count passed at the highest level tested, so it is a lower bound (ESTIMATES' Nemotron table and validation table do write '≥'). |
| note | pro6000/vllm/qwen36 people by KV capacity 32k/64k/128k | 168 / 84 / 42 | naive 168 / 84 / 42; corrected 131.9 / 76.3 / 42.0 | the naive column reproduces; the 2026-10-06 correction note in RESULTS.md applies (vLLM charges recurrent-state blocks per request) |
| note | pro6000/vllm/nemotron people by KV capacity 32k/64k/128k | 485 / 243 / 121 | naive 485 / 243 / 121; corrected 303.4 / 202.2 / 121.3 | the naive column reproduces; the 2026-10-06 correction note in RESULTS.md applies (vLLM charges recurrent-state blocks per request) |
| note | pro6000/vllm/qwen38 people by KV capacity 32k/64k/128k | 54 / 27 / 13 | naive 54 / 27 / 13; corrected 44.9 / 25.2 / 13.5 | the naive column reproduces; the 2026-10-06 correction note in RESULTS.md applies (vLLM charges recurrent-state blocks per request) |
| disagree | pro6000/vllm/qwen36 VRAM used | 85.0–87.0 GB | 85703–86998 MiB (= 83.7–85.0 GiB) | per-level nvidia-smi maxima in the JSONs; RESULTS' figures look like MiB/1000 but the vLLM ranges do not match those either (minor) |
| disagree | pro6000/vllm/nemotron VRAM used | 86.3–87.2 GB | 87017–87245 MiB (= 85.0–85.2 GiB) | per-level nvidia-smi maxima in the JSONs; RESULTS' figures look like MiB/1000 but the vLLM ranges do not match those either (minor) |
| disagree | pro6000/vllm/qwen38 VRAM used | 85.2–88.8 GB | 88280–89748 MiB (= 86.2–87.6 GiB) | per-level nvidia-smi maxima in the JSONs; RESULTS' figures look like MiB/1000 but the vLLM ranges do not match those either (minor) |
| disagree | thinking-on misses were runaway reasoning hitting the 16k cap | all models | Qwen3.6's one miss (tool_search) finished normally (185 tokens, wrong final answer), on both boxes; on the Spark, Qwen3.8's misses were client timeouts | minor wording; the scores are right |
| disagree | spark/vllm/nemotron followup_64k people (every / steady) | < 8 / < 8 | < 8 / 8 | round 2 (later turns) at 8 users passes: TTFT p95 1.80 s, decode p10 18.0. RESULTS' '6.0 s / 15.6' is the pooled level over both rounds; the first follow-up alone is 6.31 s / 15.2. |
| disagree | spark/llamacpp/nemotron/p16 followup_32k people (every / steady) | 2 / 2 | 2 / 4 | round 2 at 4 users passes (0.91 s, decode p10 22.2); RESULTS used the pooled level for this row, unlike the PRO 6000 llama.cpp row |
| disagree | spark/llamacpp/nemotron/p16 followup_128k people (every / steady) | 1 / 1 | 1 / 2 | round 2 at 2 users passes (0.83 s, 24.6) |
| note | spark/vllm/qwen38 quality on / off | 26/28 (24k) / 28/28 (11k) | 26/28 (24k) / 28/28 (11k) | score right; the 24k thinking-on token bill is an undercount: 2 items hit the harness's client timeout and recorded 0 tokens (on the PRO 6000 the same 2 items hit the 16k cap) |
| note | spark/llamacpp/qwen38/p8 quality (thinking on) | 25/28 (18k) | 25/28 (18k) | score right; 3 items were client timeouts with 0 tokens recorded, so 18k undercounts |
| disagree | spark/vllm/qwen38 memory used (unified) | ~90–108 GB | during runs 93–93 GB (p50 93); start-up peaks 116 GB at 10-06 01:03:03, 93 GB at 10-06 01:10:57 | the guard CSV (10 s samples) puts Qwen3.8's MAX_JOBS=4 start-up peak at 93 GB, and the 116 GB trip at the first (20-job) attempt; the 108 GB peak in the CSV is at 2026-10-05 13:56:29, during Qwen3.6's first start-up (FlashInfer JIT). A spike shorter than 10 s could be missed |
| disagree | spark/llamacpp/nemotron/p16 memory used (unified) | ~48 GB | during runs 42–68 GB (p50 66); start-up peaks 28 GB at 10-06 08:15:43 | unified memory during the runs is ~20 GB above RESULTS' figure; plausibly llama-server's --cache-ram 24576 (24 GiB host prompt cache, which on GB10 is the same memory) filling up - inference, not verified |
| disagree | spark/llamacpp/qwen38/p8 memory used (unified) | ~40–52 GB | during runs 33–61 GB (p50 55); start-up peaks 30 GB at 10-06 09:27:26 | unified memory during the runs is ~20 GB above RESULTS' figure; plausibly llama-server's --cache-ram 24576 (24 GiB host prompt cache, which on GB10 is the same memory) filling up - inference, not verified |
| disagree | spark/llamacpp/qwen38/p16 memory used (unified) | ~40–52 GB | during runs 43–76 GB (p50 68); start-up peaks none | unified memory during the runs is ~20 GB above RESULTS' figure; plausibly llama-server's --cache-ram 24576 (24 GiB host prompt cache, which on GB10 is the same memory) filling up - inference, not verified |
| disagree | llama.cpp Nemotron 32k people, Spark | 2 / 2 (ratio 2–4×) | 2 / 4 (ratio 2×) | see the Spark headline row |
| qualifier | Qwen3.6 32k / 64k / 128k PRO 6000 steady | 128 / 64 / 40 | ≥ 128 / ≥ 64 / ≥ 40 | lower bounds: each was the highest level tested |
| note | Spark KV capacity 'identical (168 / 485 at 32k)' | 168 / 485 | naive 168 / 485; corrected 131.9 / 303.4 | the conclusion (throughput binds ~10x before KV) holds with the corrected numbers |

Checks of the extraction itself: all 284 per-round follow-up figures equal `runs/round_stats.py`'s printed output (to its print precision, every PASS verdict equal); every file's people count equals the harness's own `people_latency_bounded_p10` (what `summarize` prints).

## Caveats

- One run per box, ceiling numbers with an exclusive GPU. The PRO 6000 ran vLLM inside WSL2 (overhead vs native Linux not measured); the Spark ran native Linux.
- Both boxes used the same 58 GiB vLLM KV pool. The Spark could hold ~75 GiB; this changes no people number (throughput binds first) but means the Spark's 'KV capacity' is not its maximum.
- Steady counts marked ≥ are lower bounds: the sweep stopped at the highest level tested.
- Non-monotonic case: PRO 6000 llama.cpp Nemotron p16 agent step, steady fails at 8 users (TTFT p95 6.36 s) but passes at 16 (2.56 s).
- PRO 6000 Qwen3.6 levels ≤ 64 come from a --max-num-seqs 64 server, levels 64-192 and the follow-ups from a 192 server (both kept; c=64 appears twice).
- Qwen3.6 cold-prompt and chat-thinking-off levels on the PRO 6000 come from the first suite, which recorded no steady metrics (steady = n/a).
- llama.cpp quality was run on the p8 server for Nemotron on the PRO 6000, p16 on the Spark; Qwen3.8 on p8 on both. No llama.cpp thinking-off gate.
- Spark Qwen3.8 thinking-on token bills (vLLM 24k, llama.cpp 18k) undercount: client timeouts recorded 0 tokens for 2 and 3 items.
- Spark memory is whole-box unified memory from `free -g` every 10 s (incl. OS and ~2.7 GB of Farm sidecars); PRO 6000 VRAM includes ~1.7 GiB of Windows desktop.
- Quality is a 28-item smoke gate, not a benchmark; within its noise it is the same on both boxes (a checkpoint property).
- Nothing here measures two linked Sparks, a model too large for the PRO 6000 (gpt-oss-120b class), speculative decoding, or the farm's seat gate / OWUI in front of the engine.
