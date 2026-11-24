# QWEN36_FP16_STATE_PLAN: Qwen3.6's recurrent state in 16 bits: 64 people at 64k instead of 48, 28 at 128k instead of 24

**Status: proposed, 2026-11-24 (night n° 15), for the owner; not recommended (a trade: more people, a measurable
accuracy cost, below).** Size **S**. Farm only.

## Why

Qwen3.8 keeps its recurrent state in 16 bits since 2026-11-21 ([QWEN38_FP16_STATE_PLAN](QWEN38_FP16_STATE_PLAN.md)); Qwen3.6,
the farm's default model, was left at 32 bits because *with drafting* and the flag it failed 30 people ~50k deep
(2026-11-19). That run replaced the question each turn, which empties a hybrid model's prefix cache (review 2026-11-24
L5), and the farm serves Qwen3.6 **without** drafting. Measured as the farm serves it, the flag holds more people.

## Measured (night n° 15, 2026-11-24; RESULTS ▸ *128k for Qwen3.6, and Qwen3.8's recurrent state in fp16*)

The trial root `~/lol-vllm-033` (vLLM 0.33.0), `QWEN36_ARGS` + `--mamba-ssm-cache-dtype float16`, 128k, a 50 GiB pool,
`spike_bench` followup `--append`, everyone ~120k deep, 3 rounds: the test that set today's label of 24 (2026-11-20).

| ~120k deep | Without the flag (2026-11-20) | With it (2026-11-24) |
|---|---|---|
| vLLM's count, 128k on 50 GiB | 34.47 | 37.06 |
| 24 people | 4.6 s / 21.6 tok/s: pass | 4.06 s / 25.3: pass |
| 28 people | 5.35 s / 17.5: fails | **4.55 s / 22.8: passes** |
| 32 people | 6.1 s / 17.0: fails | 5.31 s / 19.9: fails |
| Long-text check, ~120k | 20/20 | **20/20** |

**And at 64k, the live farm's setting** (the 2026-11-14 label run's shape: 61 GiB, the question replaced each turn,
~62k deep, 3 rounds; RESULTS ▸ *The five models on 0.33.0*):

| ~62k deep | Without the flag (2026-11-14) | With it (2026-11-24) |
|---|---|---|
| vLLM's count, 64k on 61 GiB | 73.9 | 83.97 |
| 48 people | 3.60 s / 23.0: pass | 3.56 s / 21.4: pass |
| 64 people | 5.06 s / 18.6: fails | **4.67 s / 17.8: passes** |

In that replaced shape the flag did not hurt Qwen3.6 without drafting: its 2026-11-19 failure needed drafting too.

**But the quality gate loses a little** (`spike_bench quality`, thinking off, 4 at a time, the same night, the same
server settings, 10 runs each side): **without the flag 279/280, with it 272/280** (Fisher p ≈ 0.04). The misses with it:
`code_parse_duration` 6 of 10 runs (1 of 10 without; 2 in 11 earlier runs without), `tool_currency` 1, `math_digits` 1.
A coding item, where LOL Vibe works. The long-text check (20/20) did not see it. Files: `results/q1d-n15-q36-{fp16,base}-64k*`.

## The steps

1. `QWEN36_ARGS` gains `--mamba-ssm-cache-dtype float16` (`farm/src/config.js`); `facts()` already halves the state
   charge for it. A test that the built-in carries the flag (as Qwen3.8's does).
2. The labels in `docs/spike/explorer/measured-extra.json` (merged by `build_page.js`): 128k 24 → 28, 64k 48 → 64, so
   Automatic seats them; the presets' texts follow (Balanced, Documents, LOL Vibe). 64 at 64k is the bench's ceiling
   tonight (it ran 48 and 64): more may pass; a label stays what was measured.
3. Docs: farm.md, the README's table, the library note, HUMAN_TESTS J16 (24 → 28 at 128k).

**Not proved:** the long-text check finds facts by looking them up; it found no drift at ~120k, which is not proof that
there is none (as for Qwen3.8). A person's own long chats on the next Farm app are the test of that.

## The question

**Trade accuracy for people?** 16 more people at 64k and 4 more at 128k on the PRO 6000, for about one more miss in 28
on the quality gate (one coding item missed 6 runs in 10 instead of 1). *Recommended:* no: 48 at 64k already holds a
class, and the coding agent is what students use. *Default if no answer:* not built; Qwen3.6 stays at 32 bits.
