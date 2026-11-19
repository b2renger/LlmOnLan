# VLLM_DRAFT_PLAN: Qwen3.8 drafts ahead with its own MTP layer

**Status: approved by the owner, 2026-11-18** (in the chat, 21:23: "You can start now the evaluation, and if the the
verdict is try, build it tonight"; the ask, 21:14: HyperQwen as a backend option for Qwen3.8, "our best local model
for the ratio size quality"). The verdict is *try*, as plain vLLM rather than HyperQwen:
[docs/research/2026-11-19-codeaf-hyperqwen.md](../research/2026-11-19-codeaf-hyperqwen.md). Size **S**.

## Why

HyperQwen's speed comes from speculative decoding: the model drafts a few tokens ahead and checks them in one step.
vLLM 0.33.0, the farm's pin, already does it, and NVIDIA's NVFP4 Qwen3.8 that the farm serves already carries the
layer that drafts (`mtp_num_hidden_layers: 1`). Measured on the RTX PRO 6000 with the whole GPU, the farm's flags plus
`--speculative-config {"method":"mtp","num_speculative_tokens":3,"draft_sample_method":"probabilistic"}`:

| | Today | With MTP |
|---|---|---|
| One person | 67 tok/s | **155** |
| A code edit (the answer repeats the file) | 67.7 | **192.7** |
| 30 people at once, each | 51.2 | **94.4** |
| 30 people each ~23k deep (first token p95 / p10) | 2.3 s / 28.6 | 2.4 s / **52.8** |
| Quality gate | 28/28 | 28/28 |
| People the pool holds (vLLM's admission count, 50 GiB) | 31 at 32k, 19 at 64k | **22** at 32k, **15** at 64k |

About twice the speed for everyone, alone or in a class of 30, at the same quality; it costs a fifth to a third of
the room. HyperQwen itself (its patches, W4A16 weights and DFlash2 drafter) is faster for one person (351 tok/s) but
holds 15 people at 32k, fails 30 deep conversations and lost 5 of 28 quality items: not a farm.

## What changes

1. **`farm/src/config.js`**: the Qwen3.8 entry's flags (`QWEN38_ARGS`) draft with MTP, 3 tokens, probabilistic
   (HyperQwen's issue #73: greedy drafts are the wrong default); `weightsGib` 19.92 → 20.7 (vLLM's "Model loading
   took 20.7 GiB" with the MTP layer loaded); its note says what it does and holds.
2. **`farm/src/vllm.js` `facts()`**: what drafting costs each person, read from the entry's own
   `--speculative-config` (method `mtp`, `num_speculative_tokens` k): the context memory a token takes grows by the
   MTP layer (one more full-attention layer: × (L + 1) / L, L from the catalog's architecture), and the per-request
   state by k × 3 pages (vLLM's admission count, measured: 12 → 21 blocks for k = 3). The fit, the pool cap and the
   panel's numbers then follow; `draftGib` (5.5 GiB measured beside the weights) keeps the Automatic pool from
   overshooting the card. **The panel's "room for N whole conversations" is vLLM's own line, the pool divided by the
   context, and it leaves out each request's state**: the built farm says *room for 27* at 32k on its 55 GB pool, where
   vLLM's admission holds about 24 (22 measured on 50 GiB, scaled to 55; not measured at 55). Automatic seats (16, Qwen3.8's measured label) are under both; **seats set by hand
   for a class** should stay near what passed: 30 people each ~23k deep (night n° 10), not 30 whole 32k conversations.
3. **A model the operator adds** (`FAMILY_ARGS`): a Qwen3.8 folder gets the entry's flags **without** the drafting:
   another checkpoint may have no MTP layer, and vLLM would refuse to start. Drafting is on the one checkpoint checked.
4. **Tests** (`farm/test/run.js`): `facts()` with and without the flag (the fit falls about as measured), the family
   flags carry no `--speculative-config`, the Qwen3.8 argv carries it.
5. **Docs**: `docs/spike/RESULTS.md` (a section for tonight), `farm/README.md` and `docs/context/farm.md` (what the
   Qwen3.8 entry runs), the root README's model row, `docs/HUMAN_TESTS.md` (a test the owner runs in minutes).

## Not in it

- **Qwen3.6, the farm's default, also carries an MTP layer.** Measured tonight (the research file); whether its entry
  drafts too is the owner's call, not this plan's.
- No panel switch: drafting is part of the Qwen3.8 entry, as its parsers are. An operator who wants it off removes and
  adds the model (its family flags have none).
- The DFlash2 drafter (234 tok/s alone on stock vLLM, but 23 people at 32k and 30 deep conversations fail): a "one
  teacher at the projector" mode, if the owner wants one, is another plan.
- The Automatic seats for Qwen3.8 keep their measured label (16 at 32k, `measured.json`, measured without drafting:
  conservative now); re-measuring the label with drafting is later work.

## Limits

- **Untested on a DGX Spark** (GB10, arm64). Qwen3.8 is "too slow on a DGX Spark" today; drafting should help most
  there, but a vLLM there that refuses MTP would not start the model. Tested only on the RTX PRO 6000.
- A farm whose list was saved by an Add, a Remove or a take-over keeps its Qwen3.8 entry's old flags (no drafting, no
  harm). The farm people use has no saved list (read 2026-11-18 22:40: its `vllm` holds no `library`).
- **At 64k the Automatic seats come from memory** (the measured label "≥ 24" is above the fit): 17 on a 50 GB pool, 19
  on 55 GB by `facts()`, where vLLM's admission count gives 15 on 50 GiB. The same gap stood before drafting (21 against
  19): it is the open question below. The entry's note gives speeds and "about a quarter more memory a person", no seat
  count, so it cannot disagree with the panel's.
- **To check:** the catalog's state charge (6 pages, *measured use* on vLLM 0.30) is half what vLLM's admission
  *reserves* in the worst case (12 blocks; HyperQwen's patched venv, whose pool is ~6 % smaller). Which one governs when
  vLLM preempts a request was not measured; it concerns every hybrid model, not only drafting.
- **The capacity page and the presets' estimate** (`src/capacity/estimator.js`) work from the catalog alone and do not
  know drafting: they show Qwen3.8 about a quarter roomier than it is now. No preset picks Qwen3.8 (they favour the most
  people) and presets set people to Automatic, so nothing over-promises seats; filed in the plans (Next). *Marked the
  same night (plans ▸ Next 16):* the capacity page's Qwen3.8 row says the farm drafts and what it changes (the
  catalog's `drafting`, shown in the row's notes), and a preset whose vLLM pick drafts says so in its reasons. The
  estimate's numbers are still the stock model's: drafting raises one limit (words a second) and lowers another
  (memory), so no single factor corrects them.

## Built

2026-11-18 (DEVLOG 23:24, `a3ded3a`), night n° 10: items 1–4 as written, plus `snapshot.js` `backend.mtp` read from the
argv; `farm/test/run.js` 288 passed. Item 5: `docs/spike/RESULTS.md` ▸ *Qwen3.8 drafting ahead*, `farm/README.md` (the
model table and its paragraph), `docs/context/farm.md`, `docs/HUMAN_TESTS.md` J19 with its script
`docs/spike/runs/draft_test_farm.mjs` (a test farm from the checkout; dress-rehearsed in its dry-run mode). Checked as a
farm: the numbers in RESULTS (the argv, 16 seats, the gate, the agent 5/5, streaming, the GPU's peak, the same answers).
