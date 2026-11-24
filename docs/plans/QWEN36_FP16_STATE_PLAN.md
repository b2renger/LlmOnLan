# QWEN36_FP16_STATE_PLAN: Qwen3.6's recurrent state in 16 bits, 28 people at 128k instead of 24

**Status: proposed, 2026-11-24 (night n° 15), for the owner.** Size **S**. Farm only.

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

## The steps

1. `QWEN36_ARGS` gains `--mamba-ssm-cache-dtype float16` (`farm/src/config.js`); `facts()` already halves the state
   charge for it. A test that the built-in carries the flag (as Qwen3.8's does).
2. The 128k label 24 → 28 in `docs/spike/explorer/measured-extra.json` (merged by `build_page.js`), so Automatic seats 28
   at 128k; the Balanced preset's text follows. 64k (48 today) measured again the same way before its label changes.
3. Docs: farm.md, the README's table, the library note, HUMAN_TESTS J16 (24 → 28 at 128k).

**Not proved:** the long-text check finds facts by looking them up; it found no drift at ~120k, which is not proof that
there is none (as for Qwen3.8). A person's own long chats on the next Farm app are the test of that.

## The question

**Build it?** *Recommended:* yes, with the next Farm app (four more people at 128k on the PRO 6000, accuracy unchanged on
the check). *Default if no answer:* not built; Qwen3.6 stays at 32 bits and 24 people at 128k.
