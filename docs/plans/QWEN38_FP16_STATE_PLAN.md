# QWEN38_FP16_STATE_PLAN: Qwen3.8 keeps its recurrent state in 16 bits

**Status: approved by the owner, 2026-11-19, steps 2–4 only if step 1 passes** (the chat, 12:30: "1- Yes" to
*should I write a plan for the fp16 flag on Qwen3.8?*; 18:15, after step 1 at 32k and 64k was asked for: "Lets do the
tests now and the implementation in tonight session", read by the session as covering this plan too and told to the
owner to correct, DECISIONS). Step 1 ran on 2026-11-20. Size **S**.

## Why

Qwen3.8 is a hybrid: 48 Gated DeltaNet layers each keep a recurrent state per person, read and written at every token.
vLLM keeps it in float32 by default; both farm checkpoints say `"mamba_ssm_dtype": "float32"`. vLLM 0.33.0, the farm's
pin, takes `--mamba-ssm-cache-dtype float16` (`vllm/config/cache.py:300`, stock, no patch). HyperQwen's batch mode
ships it ([the research](../research/2026-11-19-codeaf-hyperqwen.md), *HyperQwen's batch mode*). Measured on the RTX
PRO 6000, the whole GPU, a 50 GiB pool, the farm's Qwen3.8 entry (`QWEN38_ARGS`, MTP drafting) with and without it:

| Qwen3.8 27B NVFP4, drafting | Today (B) | + fp16 state (G) |
|---|---|---|
| One person | 155 tok/s | 157.9 |
| 30 people at once, each | 94.4 (93.2 the control, 2026-11-19) | **123.8** |
| 30 people each ~23k deep (first token p95 / p10) | 2.4 s / 52.8 | 2.4 s / **60.2** |
| People the pool holds at 32k / 64k (vLLM's own count) | 22 / 15 | **30 / 18** |
| Quality gate | 28/28 | 28/28 |
| Same answers (210 samples a question) | 166/210 | 175/210 (p = 0.32 against B, 0.70 against stock) |

## What is not known, and why step 1 comes first

- **Qwen3.8 deeper than 23k with the flag was not run.** On Qwen3.6 + drafting the same flag **failed 30 people
  ~50k deep twice** (p95 19.7 s / p10 13.2, then 7.8 s / 24.5; without it, the night's single run: 3.9 s / 51.1). The
  follow-up turns stopped reusing their cached prefix. Halving the state halves vLLM's block (Qwen3.8 ~1,600 → 832
  tokens), and that may be the cause. It was not proven.
- **Long texts.** The quality gate and the same-answers check use short prompts. A 16-bit state rounds at every token,
  so an error would build up over a long text. Nothing measured shows one, and nothing measured looked for one.
- **Automatic seats do not see the gain.** `vllm.js` `seatsAuto()` takes Qwen3.8's measured label (`16` at 32k,
  `src/capacity/measured.json`, measured before drafting). The memory fit only lowers it. Without a new measurement the
  farm still admits 16, and the 30-people numbers above need seats set by hand.

## Step 1: the measurement (no farm change)

A trial vLLM (`docs/spike/runs/trial_serve.sh`, `~/lol-vllm-033`, never production's root), Qwen3.8 NVFP4 with
`QWEN38_ARGS` exactly, a 50 GiB pool, `--max-model-len 32768` (the farm's setting for it). Run B (as today) and G
(+ `--mamba-ssm-cache-dtype float16`) in the same session, B first as the control:

1. **30 people ~30k deep:** `spike_bench` followup, as the 23k step was run. Pass = first token p95 < 5 s and p10 ≥ 15
   tok/s, and G no worse than B.
2. **A long text:** a fact placed early in a ~28k-token document and asked at the end. Use the same documents and the
   same questions for B and G, 20 samples each. G must answer as often as B (Fisher, as `hq_same.mjs`).
3. **People at once, like for like with today's label:** Qwen3.8's `16` at 32k comes from
   `pro6000-vllm030-qwen38-27b-nvfp4__bench__followup-append__…20261004-202141.json` (vLLM 0.30, no drafting). Run
   the same command for B and G:
   `spike_bench.py bench --profile followup --append --prompt-tokens 30000 --levels 16,24,32 --extend "" --rounds 3`.
   Then `docs/spike/explorer/build_measured.py` assembles the new `every` label; it does not run anything.
4. **Seats in memory:** stock vLLM's *Maximum concurrency for N tokens per request* line (`spike_bench kvlog`), from
   two boots of each, `--max-model-len 32768` and `65536`. HyperQwen's seat patch is not needed, and its install was
   deleted (owner, 2026-11-19).

*Done when:* the four results are in RESULTS and the research file, with a verdict. **Stop** if G fails step 1 or 2.
Write the failure down; the plan ends there. **If the owner wants Qwen3.8 at 64k** (the context question of
2026-11-19), add step 1 again at ~50k deep, where Qwen3.6 failed.

## Steps 2–4: the change (after approval, and only if step 1 passes)

2. **`farm/src/config.js`**: `QWEN38_ARGS` gains `--mamba-ssm-cache-dtype float16`; the entry's note says what it does
   and holds. Not Qwen3.6 (`QWEN36_ARGS`): it failed at 50k.
3. **`farm/src/vllm.js` `facts()`**: the state charge halves when the entry's flags carry `--mamba-ssm-cache-dtype
   float16` or `bfloat16`, the way the KV dtype is read today. `measured.json`'s Qwen3.8 labels take step 1.3's
   results. One test in `farm/test/` checks the fit at 32k and 64k against step 1.4's count.
4. **Docs and the human test:** `docs/context/farm.md`, RESULTS, the entry's note in the panel, and **HUMAN_TESTS J19
   run again** with the flag (its *Expect* gains the seats).

Not in this plan: Qwen3.6, until its 50k failure is explained. Not other hybrids either (Nemotron's Mamba-2 state):
nothing was measured on them.
