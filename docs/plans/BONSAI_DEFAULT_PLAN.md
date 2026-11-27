# BONSAI_DEFAULT_PLAN: Ternary Bonsai 2.5 27B as the llama.cpp engine's default

**Status: approved by the owner, 2026-11-26** (summary n° 17, question 3: "yes", the chat 08:52; proposed night n° 17, from the measurement the owner asked for on 2026-11-25
18:51, plans ▸ Next 21). Size **S**. Farm only (`farm/src/config.js`, the llama.cpp library and default). Nothing for
the class farm: the PRO 6000 serves vLLM; llama.cpp is the engine of small cards and of an operator's choice.

## Why (measured 2026-11-26, [RESULTS](../spike/RESULTS.md) ▸ *Ternary Bonsai 2.5 27B*)

On the farm's own llama.cpp (b12377, the farm's argv, q4_0 KV, 4 people at 64k), against today's default `UD-IQ2_S` (the
same Qwen3.8 27B, Unsloth's 2-bit, 8.37 GB, its draft head stripped):

- **Answers:** the 28-item quality check **28, 28 and 28** (three passes, two with its draft head off, one on) against
  **24 and 23**. The coding agent's five tasks, three passes each: **a tie** (8 of 15 for both at what LOL Vibe sends
  each; 11 against 8 when both get 8,192 reply tokens).
- **Speed:** one person 119.5 tok/s against 109.7 with its draft head off; **183 tok/s with it on** (×1.53: llama.cpp's
  `draft-mtp` on the file's own MTP layers, 72 % of the drafts accepted); four at once 74.7 / 60.4 tok/s (median / slowest)
  against 58.9 / 51.1.
- **Memory:** 11.1 GB against 11.9 GB at 4 × 64k; **13.0 GB with the draft on** (its draft context).
- **License:** Apache-2.0, not gated (PrismML, `prism-ml/Ternary-Bonsai-2.5-27B-GGUF`); `Q2_0` runs on stock llama.cpp
  since b11556, so on the pinned b12377.

## The change

1. **The library** (`config.js` `llamacpp.library`): a new first entry, *Ternary Bonsai 2.5 27B · Q2_0*, the `-mtp` file
   (7.9 GB) and its `mmproj-Q8_0` (0.63 GB), `mtp: true`. UD-IQ2_S, IQ2_XXS, Q2_K_XL and the NVFP4 stay as they are.
2. **The default** (`llamacpp.model`, `llamacpp.mmproj`) points at it, with `mtp` on when the default is used: **new farms
   only**. A farm whose file names a model keeps it (the panel's library offers Bonsai with *Download*, then *Use this*).
3. **The draft counted in the farm's sizing, then a 12 GB card** (the reason UD-IQ2_S is the default: it leaves headroom on
   a 12 GB card). Today `fitBudget` (`farm/src/perf.js:206`, called by `up.js` `computeFit`) counts the weights, the vision
   projector, a fixed overhead and the KV cache, **not the draft's own context** (13.0 GB against 11.1 GB at 4 × 64k on the
   PRO 6000, read 2026-11-26): with `mtp` on, `contextLength: 'auto'` would fill a small card and leave the draft no room.
   (Latent today: the default UD-IQ2_S has no draft head; the library's UD-Q2_K_XL entry, `mtp: true`, already has it.) So:
   the draft's memory as a term in `fitBudget` (measured per model, as `kvRate` is), with its test; then the K test box's
   RTX 4070 (12 GB) at the farm's sizing, the draft on and off; if it does not fit, the entry says *draft on 16 GB and up*
   and the farm turns it on by the card's memory.
4. **Tests:** the config's default and the library's first entry (the existing config tests); a scratch farm downloads it
   and serves it (tonight's runner, `docs/spike`); HUMAN_TESTS K-row: the 4070, a chat and LOL Vibe's agent.

## Built (night n° 18, 2026-11-27, DEVLOG 03:25): step 3's sizing, step 1; the 4070 and step 2 wait

- **Step 3, the draft in the farm's sizing:** `perf.js` `fitBudget({ …, mtp, slots })` adds `DRAFT_FIXED_GB` 0.4,
  `DRAFT_GB_PER_SLOT` 0.32 and `DRAFT_GB_PER_16K` 0.08, measured that night. The pinned llama-server b12377 ran alone with
  the farm's arguments, Bonsai Q2_0-mtp, the card's memory with the draft on less off:
  - one slot: **+746 MiB at 16k, +956 at 64k, +1,276 at 128k**;
  - at 64k: **2 slots +1,254, 4 slots +1,852**.
  The night before's +1.9 GB was 4 slots sharing 64k (`--kv-unified`), not 4 × 64k. `up.js` `computeFit` passes
  `llamacpp.mtp` and `llamacpp.parallel`.
  - Checked through a scratch farm sized as a 12 GB card (`gpuReserveGb` 84, `contextLength: 'auto'`, the draft on, no
    vision file): a 4,096-token context, **8.6 GB on the card inside the 9.1 GB budget**.
  - Test: `farm/test/run.js` *fitBudget counts the draft head's own memory…* (the six measured points, a 12 GB card,
    off unchanged).
- **Step 1, the library:** *Ternary Bonsai 2.5 27B · Q2_0* (the `-mtp` file and `mmproj-Q8_0`, both checked to exist,
  `mtp: true`), second, after the default. **Not the default** (step 2) until **HUMAN_TESTS K18**, the 4070 with its
  draft off and on.
  - Found: the panel has no MTP switch, and *Use this* only ever turns MTP off, so K18 turns it on in `lol.config.json`.
    Step 2 (the default with MTP on) is what an operator would get.

## What was not measured

- Vision beyond one picture: one question (a three.js scene) named its three objects and colours in 1.0 s (RESULTS).
- Which reply room suits Bonsai's agent: LOL Vibe would give it the farm's 32,768 (no profile matches its file name,
  `renderer/chat/projects/models.mjs:55`) and it passed 8 of 15 there, 11 of 15 at 8,192 with its draft off; three passes
  each do not settle it. A `ternary-bonsai` profile entry (its `maxTokens`) may belong with step 1, after more passes.
- A 12 GB card itself; previewed on the PRO 6000 by reserving 84 GB (the farm budgets ~9 GB): Bonsai with its draft and
  vision got the same 4,096-token context as UD-IQ2_S and took 10.9 GB against 11.1 (RESULTS). The vendor's benchmarks.

## Not proposed

- Bonsai's `PTQ1_0` and `PQ2_0` (smaller and faster per the vendor) need PrismML's llama.cpp fork: a second engine
  build, not ours to bundle.
- vLLM cannot load these files: the PRO 6000's class farm is untouched.

## The question

**Build this plan (step 3, the 4070, first)?** *Recommended:* yes. *Default if no answer:* not built; Bonsai stays a
measured option, an operator can add it by its link in the panel's library.

**Answered 2026-11-26** (the chat, 08:52): yes.
