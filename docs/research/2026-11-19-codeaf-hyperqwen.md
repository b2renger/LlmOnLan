# HyperQwen as a backend, CodeAF as a harness (night n° 10, 2026-11-18/19)

**The owner's ask** (chat, 2026-11-18 21:14 and 21:23; DECISIONS): evaluate
[CodeAF](https://github.com/Agent-Field/CodeAF) as a harness for LOL Vibe and the Computer, and whether
[HyperQwen](https://github.com/syv-ai/HyperQwen) can be a backend option, Qwen3.8 being "our best local model for the
ratio size quality"; build it tonight if the verdict is *try*. The owner freed the RTX PRO 6000 for the night: every
number here had the whole GPU (no farm, no client; ComfyUI's idle Python only).

**Status:** in progress (this file is written as the night goes; the verdicts are at the end).

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

## Sources

- HyperQwen: README, PATCHES.md, docs/install.md, docs/long-context.md, docs/reproductions/README.md, single-user/start_qwen.sh,
  issue #348 (github.com/syv-ai/HyperQwen/issues/348), checkout `3d6c9543292efc17372b824071ef8d9f33366b21`.
- vLLM 0.33.0 as installed: `vllm/config/speculative.py`, `vllm/config/vllm.py` (`_maybe_disable_dynamic_sd_for_v1`),
  `vllm/v1/spec_decode/dynamic/utils.py`, `vllm/model_executor/models/registry.py`.
- CodeAF (branch `dev`): README, docs/GUIDE.md, docs/HEADLESS.md, docs/TELEMETRY.md, release `dev-20261118-e98dadcba236`
  (sha256 of `codeaf-linux-amd64` checked against its `checksums.txt`). DeepSWE's review: epoch.ai/benchmarks/deepswe/review.
