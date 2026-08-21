# quantbench — which GGUF quant is actually fastest on *this* rig

A zero-dependency harness for picking the right Unsloth Dynamic quant per GPU. Clone,
run one command, get a `.md` report with speed, GPU telemetry and every answer.

## Why this exists

**Smaller quants are not always faster.** Below a certain size the `IQ1_*` / `IQ2_XXS` /
`IQ2_XS` formats are codebook-based: they cost more GPU compute to unpack than they save in
memory traffic. So the speed curve *rises, peaks, then falls* — it falls again at the top
only once the file is big enough to be bandwidth-bound.

Measured on an RTX PRO 6000 (96 GB, everything resident, ctx 8192, MTP on):

| Quant | File | tok/s |
|---|---|---|
| UD-IQ2_S | 7.8 GB | 113.8 |
| UD-Q2_K_XL | 9.2 GB | **142.3** |
| UD-IQ3_XXS | 11 GB | **149.8** |
| UD-Q4_K_XL | 17.6 GB | 132.3 |

The peak's location depends on the card's compute:bandwidth ratio *and* its VRAM, so it has
to be found per rig. That's what this script does.

Two things dominate everything else:

1. **Spill to CPU.** If the model doesn't fully fit in VRAM, nothing else matters — you're
   measuring PCIe. The script records `ollama ps`'s `PROCESSOR` column and flags anything
   that isn't `100% GPU` as **not comparable**. Treat a spill as a *result*: it locates the
   cliff on that card.
2. **MTP speculative decoding.** Qwen3.8 ships a built-in multi-token-prediction head.
   Ollama's *library* models enable it via `PARAMETER draft_num_predict 4`; a raw
   `hf.co/...` pull does **not**, which silently costs ~1.8×. This script always sets it
   (disable with `--no-mtp` to measure the delta on your card — on a tight GPU the draft
   head's extra VRAM may not be worth it).

## Requirements

- **Node ≥ 20** (no `npm install` — built-ins only)
- **Ollama** running (`ollama serve`)
- **nvidia-smi** on PATH for GPU telemetry (optional; the rest still works)

## Run it

```bash
git clone -b bench/quant-ladder https://github.com/b2renger/LlmOnLan.git
cd LlmOnLan/farm/bench

node quantbench.mjs --dry-run     # show the plan + download size, change nothing
node quantbench.mjs               # auto-picks the quants that fit this GPU
```

It reads the GPU's VRAM and selects the top rungs of the ladder that should fit, deliberately
including one marginal rung so the cliff gets located rather than guessed.

| Card | Auto-selected |
|---|---|
| 3070 (8 GB) | `UD-IQ1_S` |
| 4070 / 4070 Ti (12 GB) | `UD-IQ1_M, UD-IQ2_XXS, UD-IQ2_S, UD-Q2_K_XL` |
| 4080 (16 GB) | up to `UD-IQ4_XS` |
| RTX PRO 6000 (96 GB) | up to `UD-Q8_K_XL` |

### Useful flags

| Flag | Default | Notes |
|---|---|---|
| `--quants A,B` | auto | Test specific rungs; skips auto-selection and the big downloads |
| `--vram N` | detected | Override detected VRAM (simulate another card's *selection*) |
| `--ctx N[,N]` | `8192` | **List.** Sweeps each context. Use your real serving value |
| `--mtp on,off` | `on` | **List.** Sweeps `draft_num_predict 4` on/off |
| `--prompts SET` | `quick` | `quick` (fast, easy), `hard` (graded, discriminating), `all` |
| `--max-tokens N` | 300 / 700 | Defaults higher for `hard`, whose answers are far more verbose |
| `--repeats N` | `2` | Passes per prompt. With `hard` this becomes the pass-rate denominator |
| `--max-quants N` | `4` | How many rungs to auto-select |
| `--no-mtp` | off | Shorthand for `--mtp off` |
| `--thinking` | off | Leave reasoning on (better answers, noisier timings) |
| `--dry-run` | off | Print the plan and exit |
| `--cleanup` | off | Remove derived `qb-*` models afterward (keeps pulled quants) |
| `--repo R` | `hf.co/unsloth/Qwen3.8-27B-GGUF` | Benchmark a different model. Auto-selection assumes the Qwen3.8-27B size ladder, so pass `--quants` too |

`--ctx` and `--mtp` take lists and the run sweeps their **cross product** with the quants.
That matters because on a tight card these knobs are not independent: KV at a larger context
eats the headroom that decides whether a quant fits at all, and MTP's draft head costs VRAM
to buy throughput. `--quants A,B --ctx 8192,65536 --mtp on,off` is 8 configs.

## Measuring quality, not vibes

`--prompts hard` runs six prompts chosen to break damaged quants, most carrying an automatic
check, so quality comes out as a **pass rate** rather than an impression:

| Prompt | Tests | Check |
|---|---|---|
| `arith` | multi-step arithmetic (errors compound) | final answer is 3589 |
| `json` | strict structured output | parses + exact schema |
| `constraints` | 4 simultaneous format rules | all 4 held |
| `recall` | precise factual recall | 5432 and 6379 both present |
| `french` | non-English fluency (degrades first) | French marker density |
| `code-edge` | edge-case handling | structural markers present |

The `quick` set is deliberately kept for speed runs, but **it cannot discriminate quants** —
on a 4070 Ti every rung from IQ1_M to Q2_K_XL solved its riddle and produced a sane list.

**Truncated answers score as inconclusive (`?`), never as failures.** An answer cut off at
`--max-tokens` may have been on its way to being right — observed with `arith` producing
correct intermediates (3901, 437, 125, 3464) and running out before writing 3589. Counting
that as wrong would penalise verbosity instead of measuring capability.

> **Quality does not need the target rig.** The same GGUF produces the same output
> distribution on any card, so quality can be screened on whatever machine is fastest and
> only the *speed* sweep has to run on the rig you're choosing for.

Downloads are cached by Ollama, so re-runs are fast. To test only the interesting rungs on a
12 GB card and skip ~22 GB of downloads:

```bash
node quantbench.mjs --quants UD-IQ2_S,UD-Q2_K_XL
```

## Output

Written to `results/<host>-<gpu>-<timestamp>.{md,json}`:

- **`.md`** — rig spec, the speed table, and **every answer grouped by prompt** so quality can
  be compared across quants side by side.
- **`.json`** — everything, including per-run timings, GPU samples and full answer text.

Results are committed to the repo on purpose: run this on each rig, push, and the whole
fleet's numbers sit side by side.

## Sharing results between rigs

Result files are small (~50 KB per run) and named `<host>-<gpu>-<timestamp>`, so two rigs
never write the same filename and their commits merge cleanly.

**On each rig, after the run:**

```bash
cd LlmOnLan
git add farm/bench/results
git commit -m "bench: results from 4070ti"
git pull --rebase origin bench/quant-ladder   # required — another rig may have pushed first
git push origin bench/quant-ladder
```

The `pull --rebase` is the only step people skip and the only one that causes trouble: without
it a second rig gets rejected as non-fast-forward. Since each rig adds distinct files, the
rebase is always clean.

**First time on a fresh machine**, git needs an identity and credentials:

```bash
git config --global user.name  "your name"
git config --global user.email "you@example.com"

gh auth login && gh auth setup-git    # easiest; or let Git Credential Manager
                                      # open a browser on first push
```

**No-git fallback.** The two files are tiny — copy them off by any means (USB, email, Slack)
into `farm/bench/results/` on a machine that can push, then commit from there. Nothing in the
report depends on where it was committed from; the rig identity is inside the file.

**Then aggregate everything:**

```bash
git pull
node summarize.mjs          # one table across every rig
node summarize.mjs --md     # markdown, for pasting into an issue
node summarize.mjs --all    # include spilled rows (hidden by default)
```

`summarize.mjs` reads every `results/*.json`, hides rows that spilled to CPU (their timings
measure offload, not the quant), and prints the fastest fully-resident quant per rig — which
is the actual thing we're trying to learn.

## Reading the results

- **Ignore any row not marked `100% GPU`.** Those measure CPU offload.
- **`VRAM peak` is whole-GPU**, including the desktop — not the model alone. Compare it
  against the card's total to judge headroom.
- **Per-prompt spread is expected and informative.** MTP accepts more drafts on predictable
  content, so `code` runs much faster than `french`. Compare *the same prompt* across quants.
- The winner is the fastest quant that stays fully resident **at the context you'll actually
  serve**. A quant that fits at `--ctx 8192` may spill at 65536 — re-run with your real value
  before committing to it.

## Caveats

- Absolute rates don't transfer between cards (bandwidth differs several-fold); the *ranking*
  broadly does, but verify rather than assume.
- Speed only. This does not evaluate accuracy — that's what the captured answers are for.
- Single-stream (one request at a time). It does not measure concurrent-user throughput.
