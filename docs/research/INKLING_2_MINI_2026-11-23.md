# Inkling 2 Mini: worth a place on the farm? (2026-11-23)

The owner (2026-11-23, 08:41, in the chat): *"I found that inkling2 was released this weekend, it suggest better scores
that qwen3.8 with smaller weights can you investigate this ?"* Every fact below is marked: **checked** (read in the
repository's files or a merged pull request), **vendor** (the lab's own numbers), **estimated** (our arithmetic,
unmeasured) or **measured** (on the PRO 6000, §5).

## 1. What it is

Two models from Thinking Machines Lab carry the name. **Inkling 2 Small** (`thinkingmachines/Inkling-2-Small`, 594B
total / 17B active, weights since 2026-11-12) is far past one 96 GB card: not for us. **Inkling 2 Mini**
(`thinkingmachines/Inkling-2-Mini`, announced 2026-11-20) is the one in our range. Checked in the repository
(Hugging Face API and `config.json`, 2026-11-23 08:44):

- **Licence Apache 2.0**, not gated; one checkpoint of **20.2 GB**, NVFP4 through ModelOpt (the lab: most weights in
  NVFP4, the last four layers in MXFP8, "the training precision", so no conversion loss).
- **A looped Mixture-of-Experts:** 24 stored layers, 128 experts, 8 a token; layers 6 to 17 run **three passes** a
  token (`loop_config` 6–18, `num_passes` 3), so 48 layer runs from 24 layers: **26.4B total, 3.4B active, 5.4B
  "weight activations" a token** once the loops are counted (vendor).
- **Attention:** 20 layers see a **1,024-token sliding window**, 4 see the whole context (layers 5, 11, 17, 23), 24
  query heads and **8 KV heads** of 128. Context up to **1,048,576 tokens** (`model_max_length`).
- **Pictures in, text out** (a 23-layer vision encoder); no sound.
- A **3-layer drafting head** in the checkpoint (`mtp_config`): vLLM's recipe drafts 7 tokens with it ("DSpark").

## 2. The scores (vendor, the model card's table, its own harnesses)

| | Inkling 2 Mini | Qwen3.8-27B | Gemma 4 31B |
|---|---|---|---|
| Active / total parameters | 5.4 (3.4) / 26.4B | 27 / 27B | 30.7 / 30.7B |
| AA Index v5.0 | 20.1 | 20.1 | 4.4 |
| SWE-bench Verified (bash only) | 79.2 % | 77.8 % | 46.1 % |
| DeepSWE v1.1 | 48.2 % | 42.2 % | 0.3 % |
| Terminal Bench v2.1 | 71.6 % | 73.0 % | 43.4 % |
| LongBench v2 | 66.9 % | 52.3 % | 52.9 % |
| MRCR v2, 8 needles, 256k–512k | 46.4 % | 38.0 % | – |
| MMMU Pro (pictures) | 74.9 % | 76.3 % | 73.4 % |
| OmniDocBench v1.6 (documents) | 92.8 % | 91.5 % | 82.5 % |
| HLE-Diamond | 15.2 % | 15.3 % | 7.2 % |
| ComplexConstraints v1.1 | 33.4 % | 30.1 % | 31.6 % |

Read with care:
- **Equal to Qwen3.8-27B overall** (the same AA Index), ahead on agentic coding and long documents, a little behind on
  pictures and hard reasoning. "Better than Qwen3.8" holds on coding and long context, not across the board.
- **The win is speed, not size on disk:** 20.2 GB against Qwen3.8's 27B dense weights, but above all 5.4B
  parameters at work a token against 27B. On the same card that should mean several times Qwen3.8's speed per
  person (estimated; Qwen3.8 is the farm's slowest model, too slow on a Spark).
- **The comparison is the vendor's, in its harnesses:** Gemma 4 31B at 0.3 % on DeepSWE and 4.4 on the AA Index says
  the harness did not suit Gemma, not that Gemma cannot code (its 26B sibling did 43 of 45 of our agent tasks on
  2026-11-22). No independent result was found.
- **Its own limits (model card):** "not the strongest small model for multi-turn chat or for instructions with many
  constraints" (MultiChallenge 50.0 %); "degraded performance in long multi-turn conversations"; **"Output quality can
  be lower outside English. In testing in Chinese we observed clipped phrasing and mixed languages"**: the school
  works in French, and nobody has said how it does in French; it "sometimes became stuck in long reasoning loops"
  when debugging code, and may delete or overwrite files without asking (our coding agent is fenced to its project,
  and History can go back); "Setting reasoning effort to its minimum does not fully disable reasoning".

## 3. Can our farm serve it? (checked, 2026-11-23)

- **vLLM: only from the nightly.** "[Model] Add Inkling 2 Mini" (#69028) merged 2026-11-21, after 0.34.0
  (2026-11-16); the recipe says "Use the vllm/vllm-openai:nightly image or a nightly wheel until it is in a vLLM
  release". The farm pins 0.33.0. Fixes land daily (open on 2026-11-23: #69297 streaming of long Inkling tool
  arguments, #69351 the end of reasoning before a tool call, #69104 an expert kernel's illegal memory access on B200).
- **Our card is not on its verified list:** the recipe verified "GB200, B300, GB300, H100, H200 and DGX Spark"; the
  RTX PRO 6000 is SM120 (compute capability 12.0, read on this card), not listed; an SM120 note is still a pull
  request (#69249).
- **Ollama:** only on Apple Silicon (its MLX runner, #19799 merged 2026-11-21, after v0.40.17): not on our NVIDIA
  farms. **llama.cpp:** Inkling 2 still in open pull requests (#32187, #32695), though GGUFs are published.
- **So for the farm:** a vLLM nightly, which the farm does not run, on a card the recipe has not verified. Nothing
  changes in the farm until a vLLM release carries it.

## 4. How many people on the PRO 6000 (estimated, to be measured)

Each pass keeps its own cache ("every core layer has a KV cache and a conv-state cache per pass (48 of each in
total)", the recipe). Counted from `config.json`: 8 runs of the 4 whole-context layers (5 and 23 once, 11 and 17 three
times) at 8 × 128 × 2 values, so about **32 KiB a token in 16 bits** (16 KiB in 8), plus 40 window runs of 1,024 tokens,
about 160 MiB a person. At 128k that is about 4.2 GB a person: **some 14 people at 128k, 26 at 64k** in ~60 GB left
beside the weights, against Qwen3.6's measured 24 and 48. The recipe's own figure ("a GB200 holds about 1.8 concurrent
1M-token requests") implies more per token than this count, so it may be about half. **Only a measurement says.**

## 5. Measured on the PRO 6000

**Not measured.** A trial root with vLLM's nightly (`docs/spike/runs/nightly_root.sh`, `~/lol-vllm-nightly`:
`0.34.0rc1.dev1165+g418af6073`, which registers `Inkling2LoopForConditionalGeneration`, the `inkling` reasoning and
tool parsers, and sees the card as capability 12.0) was built at 08:47; the checkpoint's download was stopped at
09:06, part-way, when the owner chose to **wait for official support in a backend we have** (DECISIONS 2026-11-23;
plans ▸ Next 20). Ready for that day: the 58 GiB pool of earlier trials, `--reasoning-parser inkling
--enable-auto-tool-choice --tool-call-parser inkling` (the recipe's flags), the gate's *thinking off* sent as
`reasoning_effort: "none"` (its template reads that, not `enable_thinking`; default 0.9), and `fr_probe.py`.

The recipe's own capacity line, for the estimate in §4: on one GB200, "with 32K, 64K and 128K-token sessions, about
45, 32 and 20 sessions run at 100 tokens/s per user"; scaled to the ~60 GB this card leaves beside the weights, about
**8 people at 128k and 13 at 64k** (estimated), against Qwen3.6's measured 24 and 48.

## Sources

- https://huggingface.co/thinkingmachines/Inkling-2-Mini (`config.json`, `README.md`, the API's file list), read 08:44
- https://thinkingmachines.ai/news/inkling-2-mini/ and https://thinkingmachines.ai/model-card/inkling-2-mini/ (a reader,
  its quotes checked against the repository's model card where they overlap)
- https://recipes.vllm.ai/thinkingmachines/Inkling-2-Mini (vLLM's recipe), read 08:45
- vLLM pull requests #69028, #69296, #69249, #69297, #69351, #69104; Ollama #19799; llama.cpp #32187, #32695 (`gh`)
