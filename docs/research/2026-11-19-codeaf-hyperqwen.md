# HyperQwen as a backend, CodeAF as a harness (night n° 10, 2026-11-18/19)

**The owner's ask** (chat, 2026-11-18 21:14 and 21:23; DECISIONS): evaluate
[CodeAF](https://github.com/Agent-Field/CodeAF) as a harness for LOL Vibe and the Computer, and whether
[HyperQwen](https://github.com/syv-ai/HyperQwen) can be a backend option, Qwen3.8 being "our best local model for the
ratio size quality"; build it tonight if the verdict is *try*. The owner freed the RTX PRO 6000 for the night: every
number here had the whole GPU (no farm, no client; ComfyUI's idle Python only).

**Status:** done (2026-11-19 00:05; HyperQwen's batch mode added 2026-11-19 10:10). Verdicts at the end: HyperQwen not
as a backend in either mode, but its drafting idea is built for Qwen3.8 on stock vLLM (VLLM_DRAFT_PLAN) and its batch
mode's fp16 recurrent state is a stock flag worth a plan; Qwen3.6 the same, the owner's question; CodeAF not now.

## What each one is (read 2026-11-18, sources at the end)

**HyperQwen** (Apache-2.0, syv-ai, checkout `3d6c954`, 2026-11-10): a set of 65 patches (`patches/series`) against **vLLM 0.33.0, the
version our farm pins** (`farm/src/config.js` `vllm.version`), plus a model-preparation pipeline. It serves Qwen3.8-27B
from a **W4A16** checkpoint (`dbirks/Qwen3.8-27B-W4A16-AutoRound`, int4 weights for cards without FP4) with its heads
requantized to int8, and speeds each answer up by **speculative decoding**: the model drafts several tokens ahead and
checks them in one step, either with the checkpoint's own MTP layer or with **DFlash2**, a separate 5-layer drafter
(`incoai/Qwen3.8-27B-DFlash2`, 3.85 GB bf16) that is good at answers that repeat their prompt. Its headline numbers
are for **one RTX 3090** (24 GB, compute capability 8.6), whose kernels (`pthfa/`, `fa2/`) it tunes; on sm_120
(our card) those do not run, and its own reproduction table says the long-context mode falls back.

Two facts decided where to look:
- **On our exact card** (its issue #348, RTX PRO 6000, 300 W, Docker, reported by a user): HyperQwen's DFlash2 mode
  gave **220 tok/s to one person against 120 for stock vLLM 0.32 on NVIDIA's NVFP4**, but **505–581 against 694 for
  stock NVFP4 at 8 people at once**. Its gain is the drafting; its W4A16 base loses to native FP4 under load.
- **Stock vLLM 0.33.0 already has both drafters**: `mtp` for Qwen3.8 (`qwen3_5_mtp`) and `dflash` with the
  `DFlash2DraftModel` architecture registered (`vllm/model_executor/models/registry.py`), plus a batch-size schedule
  (`num_speculative_tokens_per_batch_size`) that drafts more for few people and less, or none, for many. The NVFP4
  checkpoint the farm serves carries the MTP layer (`mtp_num_hidden_layers: 1`, 15 `mtp.*` tensors).

**CodeAF** (Apache-2.0, AgentField, build `dev-20261118-e98dadcba236`, a daily prerelease; ~100 MB binary): a coding
harness in Go for open models, with a planner, workers and a checker (`codeaf do`) or one worker (`codeaf exec`), a
`bash`/`sh` tool beside its file tools, and on Linux a jail for those commands. It talks to any OpenAI-style `/v1`
(`CODEAF_BASE_URL`), with native tool calls. Telemetry is **on by default** (to agentfield.ai) and turns off with
`CODEAF_TELEMETRY=off` / `DO_NOT_TRACK=1`. Headless, it returns one JSON object at the end: no event stream, and a
question it cannot answer ends the run (exit 4). Its README ranks it first of ten harnesses on DeepSWE (DeepSeek V4
Flash) and puts *deepseek-harness*, the dsh LOL Vibe runs, at 26.6× its cost per solved issue.

## The measurements (RTX PRO 6000, whole GPU, 2026-11-18 from 21:34)

Each way of serving Qwen3.8-27B ran the same suite (`docs/spike/runs/hq_suite.sh`, raw results
`docs/spike/results/hq-*`), with a **50 GiB KV pool** as the farm gives vLLM:

- **one person:** the short question of `lol bench`, 3 rounds, up to 1,000 tokens (Qwen3.8 thinks: the tokens are its
  thinking), tok/s over the whole reply;
- **code edit:** `hq_edit.mjs`, one person asks for an 8 KB source file back with one rename, thinking off (2,545
  tokens; the answer repeats its prompt, as LOL Vibe's code edits do), and the copy must be exact;
- **30 people:** the same short question, 30 at once, 2 rounds;
- **30 deep:** `spike_bench` followup, 30 people each ~23k tokens into a conversation, natural answers (the class's
  limiter; pass = first token p95 < 5 s and p10 ≥ 15 tok/s);
- **quality:** the 28-item gate, thinking off;
- **room:** the KV pool vLLM reports, in people at 32k.

| Serving | One person | Code edit | 30 people, each | 30 deep (p95 / p10) | Quality | Room at 32k |
|---|---|---|---|---|---|---|
| **A** stock vLLM 0.33.0, NVFP4, the farm's flags | 67 tok/s | 67.7 tok/s, exact | 51.2 tok/s (1,536 total) | 2.3 s / 28.6: pass | 28/28 | 40 (1.34 M tokens) |
| **B** A + `--speculative-config {"method":"mtp","num_speculative_tokens":3,"draft_sample_method":"probabilistic"}` | **155 tok/s** | **192.7 tok/s**, exact | **94.4 tok/s** | 2.4 s / **52.8**: pass | 28/28 | 32 (1.07 M) |

| **C** A + `{"method":"dflash","model":"Qwen3.8-27B-DFlash2" (incoai, bf16),"num_speculative_tokens":7,"draft_sample_method":"probabilistic"}`, stock vLLM | **234 tok/s** | **243.4 tok/s**, exact | 69.0 tok/s | **38.7 s / 6.6: fail** | 28/28 | 23 (756 k) |

| **D** HyperQwen as published: its patched vLLM 0.33.0 (65 patches, all applied), its prepared W4A16 checkpoint, its DFlash2 W4A16 drafter, `SPEC=dflash2` single-user mode (bf16 KV), `MAX_SEQS=32`, the same 50 GiB | **351 tok/s** | **509 tok/s**, exact | 75.7 tok/s | **132.6 s / 8.8: fail** | **23/28** | 15 (its own count) |

D is the fastest for one person by far (it beats the 220 tok/s its issue #348 reports on this card), and its
prompt-lookup drafting copies a file at 509 tok/s. Its single-user mode is not a farm: its own seat budget (below) holds 15 people at
32k and 9 at 64k, 30 deep conversations collapse, and it **lost 5 of 28 quality items**: three code answers stopped
(`finish: stop`) before closing their code block, one failed its tests, one sum was wrong (61 for 76). The same items
pass under A, B and C; whether the W4A16 weights or its sampler patches cause it was not looked into.

## HyperQwen's batch mode, the one built for many people (2026-11-19 09:05–10:09)

The night ran only the single-user mode; the owner pointed out (09:03) that a class wants the **batch mode**
(`batch/start_qwen.sh`, "for serving many concurrent requests … tuned for aggregate tokens per second"). Its settings:
no drafting, `MAX_SEQS` 64, fp8 KV, prefix caching, int8 activations on the MLP through two Marlin patches (+2.2 %
perplexity, its README), and the recurrent state in fp16 (`--mamba-ssm-cache-dtype float16`). Rebuilt as on the night
(the same checkout, its W4A16 checkpoint and prepared int8 heads, its 65 patches all applied: `apply.sh` takes the
`vllm` package folder) and run with `docs/spike/runs/hq_batch.sh`: its own settings, the same 50 GiB pool
(`--kv-cache-memory-bytes`; the batch launcher has no `KV_MEM`) and 64k context as A–D. Two install facts on our box:
its FlashInfer JIT (needed by fp8 KV, not by the night's bf16 single-user mode) links `-lcudart -lcuda` from
`$CUDA_HOME/lib64` and `lib64/stubs`, which the pip CUDA 13 copy lacks (three links in the scratch venv fixed it; its
Docker image carries a full toolkit); flashinfer.ai's index answered 503 once.

Every arm, Qwen3.8-27B on the whole RTX PRO 6000; seats by HyperQwen's seat-budget patch for all arms (stock arms through
its patched venv, as on the night):

| Qwen3.8-27B | One person | Code edit | 30 people, each | 30 deep at 23k (p95 / p10) | Quality | Seats at 32k / 64k |
|---|---|---|---|---|---|---|
| A stock, the farm's flags (night) | 67 | 67.7 | 51.2 | 2.3 s / 28.6 | 28/28 | 31 / 19 |
| B + MTP, 3 drafts: **the farm's built-in entry** (night) | 155 | 192.7 | 94.4 | 2.4 s / 52.8 | 28/28 | 22 / 15 |
| B again, 2026-11-19 (control) | 153.5 | 189.1 | 93.2 | 2.5 s / 49.4 | 28/28 | 22 / – |
| **F HyperQwen batch mode as published** | 82.7 | 83.6, exact | 65.7 | 2.8 s / 27.4 | 27, 26, 27 | **37 / 21** |
| F without int8 activations (`INT8_ACT=`) | 84.9 | – | 66.0 | – | 26, 26, 26 | – |
| F + MTP 3 drafts by hand (`--speculative-config` in `EXTRA_ARGS`) | **208.3** | **242.1**, exact | 73.9 | 3.1 s / 39.4 | 27, 27 | 30 / 18 |
| **G = B + `--mamba-ssm-cache-dtype float16`**, stock vLLM, no patch | 157.9 | 191.0, exact | **123.8** | 2.4 s / **60.2** | 28/28 | 30 / 18 |
| D single-user mode (night) | 351 | 509 | 75.7 | 132.6 s / 8.8: fail | 23/28 | 15 / 9 |

- **Batch mode is not the class backend either.** As published it beats stock vLLM *without* drafting (+23 % alone,
  +28 % each for 30, 6 more seats at 32k: its fp16 state), but stays far behind the farm's drafting entry (66 against 94
  each for 30; the slowest of 30 deep at 27 against 53). With MTP drafting added by hand it is the fastest for one
  person (208) and still slower than G for a class: **74 against 124 each for 30, 39 against 60 for the slowest deep**,
  the same seats. Its W4A16 Marlin path wins at small batches and loses to NVIDIA's native NVFP4 at large ones, as
  issue #348 found for the DFlash2 mode.
- **Its int8 activations buy nothing on this card** (84.9 / 66.0 tok/s without them, 82.7 / 65.7 with).
- **It loses a quality item every run:** `code_eval_expr` fails in all 8 batch-mode runs (its code crashes on
  `import re`, or a stray code fence), with `code_topo_sort` too without int8 and `code_palindrome` once; every
  Qwen3.8 arm on NVIDIA's NVFP4 passed 28/28 in each of its 5 runs (A, B, C, the B control, G). With the int8 activations off it is no better, so
  the cause is the W4A16 checkpoint with its int8 heads (or its patches), not the activations.

**What batch mode taught: the fp16 recurrent state, a stock vLLM flag** (`mamba_ssm_cache_dtype`, vLLM 0.33.0
`vllm/config/cache.py:300`; both NVFP4 checkpoints the farm serves set `"mamba_ssm_dtype": "float32"`). On Qwen3.8 with
the farm's drafting (G): **30 people 93 → 124 tok/s each, the slowest of 30 deep 49–53 → 60, seats at 32k 22 → 30 and
at 64k 15 → 18** (drafting's lost room comes back), one person unchanged, 28/28, and the same-answers check
(`runs/hq_same.mjs`, 210 samples a question, thinking on) 175/210 on the train question against 166 for B and 171 for A
(Fisher p = 0.32 and 0.70), the same wrong answer, 420/420 on the other two. HyperQwen's README reports perplexity 8.045
against 8.046. The state is read and written at every token by the 48 GatedDeltaNet layers, so halving it pays as
people are added.

**But on Qwen3.6 at 50k it fails** (the farm's default, 64k, MTP, + fp16 state): 23k deep gains (first token p95 2.8 →
1.9 s, p10 95.9 → 107.7, 30 people 165 → 198 each, pool 2.93 → 3.61 M tokens, 27/28), but **30 people ~50k deep fail
twice** (p95 19.7 s / p10 13.2, then 7.8 s / 24.5; without fp16: 3.9 s / 51.1, pass). Halving the state halves vLLM's
block (Qwen3.6 2,176 → 1,152 tokens; Qwen3.8 ~1,600 → 832), and in that step vLLM ran 16 of 30 with 14 waiting and
re-read prompts at ~25k tok/s while generating 4 tok/s: the follow-up turns did not reuse their cached prefix as they
did with fp32 state. Why was not found. Qwen3.8 at 50k with fp16 state was not run (the farm serves it at 32k).

**The farm's default, Qwen3.6 35B-A3B, carries an MTP layer too** (19 `mtp.*` tensors). The same A/B at its 64k
setting, its farm flags (`QWEN36_ARGS`), plus a 50k-deep step (`long50`: 30 people each ~50k tokens into a
conversation, what a 64k setting allows):

| Qwen3.6 35B-A3B NVFP4, 64k | One person | Code edit | 30 people, each | 30 deep at 23k (p95 / p10) | 30 deep at 50k (p95 / p10) | Quality | Pool |
|---|---|---|---|---|---|---|---|
| **E-A** stock, the farm's flags | 254 tok/s | 262.9, exact | 81.5 | 2.3 s / 44.4: pass | 3.2 s / 35.7: pass | 27/28 | 3.97 M tokens |
| **E-B** + MTP, 3 drafts, probabilistic | **512** | **627.1**, exact | **164.8** | 2.8 s / **95.9**: pass | 3.9 s / **51.1**: pass | 28/28 | 2.93 M |

Through a farm (2026-11-19 03:25, 64k, 32 seats set by hand, 30 people from 30 addresses): 103.8 → **163.7 tok/s** each,
and 30 people ~40k deep first token p95 3.4 → 2.2 s, p10 38.1 → 74.6 tok/s (RESULTS ▸ *Qwen3.8 drafting ahead*, the
last table). Twice the speed for everyone at the same quality, on the model the farm serves every day, accepted 3.55 tokens a
step (per position 0.94, 0.85, 0.75); the pool falls by about a quarter. Not built tonight: the owner's question.

**What drafting costs in people** (22:31–22:42). Stock vLLM's "Maximum concurrency" divides its pool by the context
and leaves out each request's recurrent state. HyperQwen's log-only patch `kv-cache-seat-budget.patch` counts it,
with vLLM's own admission arithmetic; A's and B's exact flags were started under HyperQwen's patched venv (the farm's
`serve.sh`, a probe root, `seatprobe.sh` in this session's scratch) just long enough to read it:

| 50 GiB pool, Qwen3.8 NVFP4 | Usable blocks (1,600 tokens) | Blocks a request holds whatever its length | People at 32k | At 64k |
|---|---|---|---|---|
| A, no drafting | 1,023 | 12 | 31 | 19 |
| B, MTP, 3 drafts | 962 | 21 (+3 a draft token) | 22 | 15 |

So MTP's 3 drafts cost **29 % of the room at 32k and 21 % at 64k**: the MTP layer is one more full-attention layer
(1,023 → 962 blocks: 17/16 of the memory a token takes), and each draft token holds 3 more pages of recurrent state
(one per group of the 48 GatedDeltaNet layers). Under the patched venv the pool is ~6 % smaller than stock's (A at
64k: 1,264,968 tokens against 1,342,177), so these are a little conservative. The farm's own formula
(`farm/src/vllm.js` `personBytes`) says 38 people at 32k for A where this count says 31: the catalog charges 6 pages of
state, *measured use* on vLLM 0.30, where admission *reserves* 12 in the worst case. **To check:** which of the two
governs when vLLM preempts a request was not measured.

C is HyperQwen's own drafter on stock vLLM 0.33.0 and NVIDIA's NVFP4, with no patch: it gives the one-person speed
HyperQwen reports on this card (#348: 220 tok/s), accepted 4.0–5.7 tokens a step. Seven drafts a request reserve so much
recurrent state (vLLM also warns "Add 4 padding layers, may waste at most 25.00% KV cache memory" for the drafter's
sliding-window layers) that the room falls to 23 people at 32k, under a class, and 30 deep conversations collapse.

B's drafts were accepted 3.1–3.6 tokens a step (mean acceptance length; per-position 0.84–0.96, 0.68–0.88,
0.56–0.79). The room it loses (a fifth) is the recurrent state each request reserves for its drafts (HyperQwen's
`start_qwen.sh` says the same: pages are reserved for `num_speculative_tokens`).

## CodeAF against dsh, on LOL Vibe's five agent tasks

Same server (A), same model, one after the other. dsh as LOL Vibe runs it (`docs/spike/ide/run.js`: 9 file tools, no
shell, the project fence and syntax check). CodeAF sealed (`docs/spike/ide/codeaf_run.sh`): bubblewrap with **no
network at all** and the disk read-only but the task's folder; inside, our `relay.py` turns vLLM's socket into
127.0.0.1:8190, the only server it can reach; telemetry, the model pool and attribution off. Tokens are vLLM's own
counters (`/metrics`) before and after each set: CodeAF's own count reads 0 on our server.

| Harness | Passed | Time (5 tasks, one by one) | Prompt tokens | Generated tokens |
|---|---|---|---|---|
| dsh 0.1.7-rc.2 (LOL Vibe) | 4/5 (t2-p5: "the Reset button does nothing") | 302 s | 99,295 | 17,577 |
| CodeAF `do` (planner, worker, checker: all Qwen3.8) | **5/5** | 569 s (t2-p5 alone: 271 s) | 447,320 | 36,322 |
| CodeAF `exec` (one worker) | 4/5 (t2-p5, the same miss) | 249 s | 167,323 | 15,992 |

- **On our model and tasks, CodeAF's single worker is level with dsh**, a little quicker; its full mode solved the task
  both single workers missed, at about twice the wait and 4.5× the prompt tokens (most of them cached prefixes) and
  twice the generated ones. Per solved task: dsh ~29k tokens, `do` ~97k, `exec` ~46k. The README's 26.6× (DeepSWE,
  DeepSeek V4 Flash, cloud prices) does not show here; one run of five tasks each is a small sample.
- **CodeAF's checker runs the tests in a shell** (its receipts record `bash` calls), inside its own sandbox runner
  (`bin/furrow-0.3.6`, unpacked into its state folder, with a per-task policy and credential folders hidden). LOL Vibe's
  agent has no shell by design (the project fence is a file fence); part of the 5/5 comes from a capability we do not
  grant.
- **It worked with no network at all**: it built its model list from our server (`model-catalog-*.json`: `price_unknown`,
  `base` 127.0.0.1:8190/v1) and wrote no telemetry spool with telemetry off. Its JSON still names the provider
  `openrouter`, a label only. Not proven: what it sends with telemetry on (not tried), and its Windows and macOS builds
  (only the Linux one ran; whether its jail exists there was not checked).

## The build, checked end to end (23:23–00:02)

The approved plan ([VLLM_DRAFT_PLAN](../plans/VLLM_DRAFT_PLAN.md)) was built (`a3ded3a`) and run as a farm from the
checkout (`lol up`, Automatic seats and pool, through the seat gate and LiteLLM), then as HUMAN_TESTS J19's own script
in its dry-run mode. Every number is in `docs/spike/RESULTS.md` ▸ *Qwen3.8 drafting ahead*: the argv carries the flag,
16 people at once from 16 addresses at 126.5 tok/s each, 30 people ~18.5k deep pass, LOL Vibe's agent 5/5 in 158 s
(stock: 4/5 in 302 s), streaming with thinking and tool calls clean, the GPU at most 85.8 of 97.9 GB, and **no sign that
drafting changes the answers**: on a question the model sometimes gets wrong, 171/210 right without drafting and 166/210
with (Fisher p = 0.62), the same wrong answer either way.

## Verdicts

- **HyperQwen's batch mode (2026-11-19): not as a backend either.** For 30 people it gives 66 tok/s each as published
  and 74 with drafting added, against 124 for the farm's drafting entry plus one stock flag (the fp16 recurrent state),
  and it misses a quality item every run. What it brings is that flag: a plan for the owner (Qwen3.8 only; on Qwen3.6
  it fails 30 people at 50k).
- **HyperQwen's single-user mode: not as a backend; its idea, yes, and built.** On our card its own stack is the fastest for one person
  (351 tok/s), but it holds 15 people at 32k, 30 deep conversations collapse, and it lost 5 of 28 quality items; it
  needs 65 patches, its own W4A16 weights and a Docker-first install. Its speed comes from drafting, which stock vLLM
  0.33.0 (the farm's pin) already does with the MTP layer NVIDIA's checkpoint carries: **Qwen3.8 drafting with MTP is
  twice as fast alone and for a class of 30, at the same quality, for a fifth to a third of the room.** Built tonight for
  Qwen3.8 (the owner's approval, 21:23). Its DFlash2 drafter on stock vLLM (234 tok/s alone, but 23 people at 32k) would
  suit one teacher at the projector: a plan, if the owner wants that mode.
- **Qwen3.6, the farm's default, gains the same** (512 tok/s alone, 165 each for 30, 28/28; 56 → 42 people at 64k by
  vLLM's admission): **the owner's question**, not built.
- **CodeAF: not now.** On LOL Vibe's tasks and our model its single worker is level with dsh (4/5, a little quicker);
  its full mode solved all five at twice the wait. The README's 26× cost claim does not show here. Against what LOL
  Vibe needs: its checker runs tests in a **shell** (LOL Vibe's agent has none, by design); headless it returns one
  JSON at the end (**no event stream** for the chat to show steps); telemetry is **on by default**; it ships as daily
  **prereleases** of ~100 MB; only its Linux build was run. Worth a look again when it has a stable release and a
  streaming headless mode; its jail for shell commands is an idea worth reading if LOL Vibe's agent ever gets a shell.

## Sources

- HyperQwen: README, PATCHES.md, docs/install.md, docs/long-context.md, docs/reproductions/README.md, single-user/start_qwen.sh,
  issue #348 (github.com/syv-ai/HyperQwen/issues/348), checkout `3d6c9543292efc17372b824071ef8d9f33366b21`.
- vLLM 0.33.0 as installed: `vllm/config/speculative.py`, `vllm/config/vllm.py` (`_maybe_disable_dynamic_sd_for_v1`),
  `vllm/v1/spec_decode/dynamic/utils.py`, `vllm/model_executor/models/registry.py`.
- CodeAF (branch `dev`): README, docs/GUIDE.md, docs/HEADLESS.md, docs/TELEMETRY.md, release `dev-20261118-e98dadcba236`
  (sha256 of `codeaf-linux-amd64` checked against its `checksums.txt`). DeepSWE's review: epoch.ai/benchmarks/deepswe/review.
