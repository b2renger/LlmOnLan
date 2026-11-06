# Ripple-65B Preview — a study for LlmOnLan

*2026-11-06, asked by the owner. Read from the model's cards, its config, vLLM's pull request and recipe, and our own
spike numbers. **Nothing was run.** The seats and speeds below are estimates, to be measured.*

**The short answer.** It is worth one measurement, not a switch. It could be the best coding model for a small group,
but on the PRO 6000 it would serve about 4–13 people at 64k, against Qwen3.6's 48. It cannot run on our stack today:
vLLM 0.33.0 does not know it. On a Spark it fits, but it should be too slow to use live.

## What it is

- **[Ripple-65B Preview](https://huggingface.co/ricursiveAI/Ripple-65B-Preview)**, by Ricursive Intelligence: a dense
  model, so all 65B parameters work on every token (Qwen3.6 uses 3B of 35B). Apache 2.0.
- **Text only:** it was trained on text and has no vision.
- **1M tokens of context**, through a Gemma-like design: 16 full-attention layers and 64 layers that only see the last
  1,024 tokens.
- **Tuned for agentic coding.** Its card gives Terminal-Bench 2.1 at 80.5 and SWE-bench Verified at 76.5.
- **Cautions:** the scores are the maker's own, and Qwen3.6 and Flint are not in its table. The card calls the
  post-training "relatively light", and the NVFP4 build "Experimental". vLLM's recipe marks only the B300 as verified,
  so a PRO 6000 is untested.

## Can our stack run it?

| Engine | Today | What it needs |
|---|---|---|
| **vLLM** | No: not in 0.33.0's model list | Merged to vLLM's main on 2026-11-05 (PR 65745). The recipe says `nightly_required`. A nightly, or the next release, through Update vLLM |
| **llama.cpp** | No: merged after our pin b11836 | PR 31692, merged 2026-11-05. A new pin. Dense models served ~1 person on llama.cpp in our spike, so little is lost without it |
| **Ollama** | Not checked | Dense models and the coding agent both do poorly there (ollama#19191) |

vLLM runs it natively, with no `--trust-remote-code`, and has parsers for it: `--reasoning-parser ripple`,
`--tool-call-parser ripple`.

## Memory: how many people

Weights: 53.3 GiB in NVFP4 (attention stays BF16; the recipe asks 69 GB of VRAM). The farm's Automatic formula on the
96 GiB PRO 6000 leaves **about 19 GiB** for conversations, or **about 28 GiB** with document reading off.

Each person's context, from `config.json`:
- full-attention layers: 16 × 2 × 8 heads × 128 × 2 bytes = **65,536 bytes a token**;
- sliding layers: 64 × 1,024 tokens × 4,096 bytes = **about 0.25 GiB**, whatever the context.

The checkpoint declares no KV type, so BF16 is the base case. FP8 would halve it, if vLLM accepts it for this model
(Flint would not take it).

| Whole context for every person | At 32k | At 64k |
|---|---|---|
| BF16, document reading on | 8 | 4 |
| BF16, document reading off | 12 | 6 |
| FP8 if it works, document reading on | 16 | 8 |
| FP8 if it works, document reading off | 24 | 13 |

The DFlash2 draft below costs 7.5 GiB of the same pool, so about 2–4 fewer people at 64k. For scale, at 64k on the
PRO 6000: Qwen3.6 serves 48, Flint 20, Gemma 4 12B 8.

## Speed

Our nearest measurement is dense Qwen3.8-27B on vLLM. Ripple does about 2.4 times its work per token, so a crude
division gives:

| | Qwen3.8-27B, measured | Ripple-65B, estimated | Qwen3.6, measured |
|---|---|---|---|
| One person, PRO 6000 | 64 tok/s | ~26 tok/s | 193 tok/s |
| Peak total, PRO 6000 | 1,663 tok/s | ~690 tok/s | 3,431 tok/s |
| One person, Spark | 12 tok/s | ~5 tok/s | |

Our pass mark is 15 tok/s each. So on a PRO 6000 memory limits people before speed does. On a **Spark** the card's "fits
on consumer hardware" is true for memory, but dense Qwen3.8 already fell below the mark for one person, and Ripple would
be slower. That weakens it as the "near-frontier model for 1–2 people on a Spark" unless the draft helps.

**DFlash2** is the unknown that could change this. A 7.5 GiB draft model guesses several tokens ahead; vLLM's PR reports
4.98 → 7.34 tokens accepted per step on GSM8K. Our spike has never used speculative decoding.

## If it is adopted

The path is Flint's:
1. A vLLM that knows it, with `minVllm` on the list entry.
2. A list entry with the `ripple` parsers (`ricursiveAI/Ripple-65B-Preview-NVFP4`).
3. A capacity catalog entry from the measured bytes per token.
4. `AGENT_PROVEN` only if it earns it.

It would never fit the Computer preset (no vision), and document reading stays on gemma4:12b.

## The measurement

After J14 (vLLM 0.33.0 on production), at a quiet hour, in a root of its own (never `~/lol-vllm`), with a vLLM nightly.
It downloads 57 GB, plus 8 GB for the draft.
1. Real KV bytes per token, BF16 and FP8 if it starts.
2. People at 32k and 64k by our pass mark, with and without DFlash2.
3. The five agent tasks three times, against Flint's 13/15 and Qwen3.6's 7–11/15. **This decides it:** only a clear win
   justifies giving up that many seats.
4. If those are good, one person's tok/s on a Spark, with DFlash2.
