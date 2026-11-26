# Decision models in vLLM, and what they could do for Classify (2026-11-25, by day, the owner's question)

The owner, 18:51–18:54: "a vllm gr thing that could be interesting … it has to do with decision models". Read by the
`docs` explorer (18:55) and checked by hand on GitHub's API, PyPI's JSON, Hugging Face's API and the installed vLLM
packages of the trial roots (marked **checked**). Nothing was run against a model.

**What we have:** the farm's Classify plugin, Laya 0.3.20 (`convaiinnovations/laya`, a 421M ModernBERT encoder,
English) on the CPU, OFF by default, answering the Computer's Classify box (`farm/src/classify.js`,
`farm/src/pysvc/classify_server.py`). Measured 2026-09-27 ([ECOSYSTEM_RESEARCH](ECOSYSTEM_RESEARCH_2026-09-27.md)):
~0.2 s an item, 74 % right on 104 headlines (81 % on the 64 % it was sure of), its confidence uncalibrated (its own
load-time warning), a 904 MB venv plus 808 MB of weights.

## What is new

- **vLLM answers decision questions with a chat model** (**checked**):
  - `POST /v1/systemone` (#59299, merged 2026-10-08, in v0.32.0's notes: "answers `choice`, `noul` and `score`
    questions over a structured state");
  - `POST /v1/decisions`, OpenAI's Decisions format, text only (#60465, merged 2026-10-13; the PR: "available by
    default on supported generation models", 501 otherwise; at most 64 questions and 26 choices; "Confidence is not
    calibrated to OpenAI's models").
  - Each read is one next-token step over the labels' tokens, with a softmax over them; the reads share the state's
    prefix (PR #59299).
  - Both routes are in our trial roots' vLLM 0.33.0 and 0.34.0 (`vllm/entrypoints/generate/structured_decisions/`,
    `vllm/entrypoints/openai/decisions/`).
  - Their read-strategy code names `Qwen3_5MoeForConditionalGeneration` (**Qwen3.6**, the class model),
    `Qwen3_5ForConditionalGeneration` (**Qwen3.8**), `Gemma4ForConditionalGeneration` (**Gemma 4 26B**), `Qwen3ForCausalLM`
    and others; not `NemotronHForCausalLM` (Nemotron).
  - vLLM's docs (structured_decisions_models): probabilities can differ between identical requests, with the batch
    and the prefix cache; `VLLM_BATCH_INVARIANT=1` makes them repeat, at a cost in throughput.
- **Laya on vLLM:** not merged (#58429 open, issue #58951 open). **Laya 0.5.4** was published today (2026-11-25 09:57
  UTC; our pin 0.3.20 of 2026-09-24): its PyPI page says "calibrated probabilities" and "any LLM as the reader",
  Apache-2.0; its continuous-learning parts are a separate package under PolyForm Noncommercial (not for us).
- **vLLM Semantic Router's Decision 1.0** (`vllm-sr/Decision-1.0-*`, 2026-09-21/22, Apache-2.0, not gated,
  **checked**): six models from 0.6B to 9B, architecture `Decision1Model` (not in vLLM's list: their own inference
  code, "an HTTP endpoint must be deployed separately"). Their own suite: Lux-9B 76.94, Nox-4B 73.09, a hosted
  reference 81.05. Decision 3.0 / Vela 3 is a proposal of the Router's, with no repository list or licence read.

## For us

- **The likely gain:** Classify answered by the model the farm already serves, on the GPU, through vLLM's
  `/v1/systemone`: no second model, no venv, no CPU time; Qwen3.6 reads French, which Laya does not; one prefill and
  one token a question. The Classify box's contract (`classify {url, key}` in the beacon, `POST /classify`) can stay,
  so no client release: the farm's service would ask vLLM when vLLM serves a model on the list, and Laya on the CPU
  otherwise. Privacy: unchanged (the items already go to the farm, which keeps nothing).
- **Not for us:** Decision 1.0 (a second server and model on the GPU, numbers only its own); a hosted decision API.
- **The measurement first (S, no farm code):** a scratch vLLM 0.34.0 with Qwen3.6 beside the live farm; a new
  labelled set of public headlines in English and French (September's 109 were not kept); `choice` accuracy and
  confidence against Laya 0.3.20 and 0.5.4 on the same items; the time per item, alone and beside 10 chats; whether
  the read needs thinking off (`chat_template_kwargs`). Then a plan for the owner if it wins.
- **Not checked:** any of it run; whether the farm's gate and LiteLLM would pass `/v1/systemone` (the plan's question);
  Laya 0.5.4's own claims.

## Measured (night n° 17, 2026-11-26)

194 public headlines (BBC News and Le Monde, seven sections, labelled by their section), one `choice` question: **vLLM
0.33.0's `/v1/systemone` with Qwen3.6 right 73 % (en 71, fr 75), 31 ms an item on the GPU; Laya 0.3.20 59 %, 166 ms;
Laya 0.5.4 59 %, 78 ms** (CPU, 4 threads). At confidence ≥ 0.8: vLLM 83 % right on 71 % of the items, Laya 70–71 % on
60 % (0.5.4's *calibrated* is not borne out here). The read forces thinking off (`strategies.py:128`, `:344`); 16 at once
took 2.1 s for all 194; beside 10 chats an item took 48 ms. The farm's gate does not pass the route: a farm would ask vLLM
on loopback. [RESULTS](../spike/RESULTS.md) ▸ *Classify*; the plan: [CLASSIFY_VLLM_PLAN](../plans/CLASSIFY_VLLM_PLAN.md).

Sources: https://github.com/vllm-project/vllm/pull/59299 · https://github.com/vllm-project/vllm/pull/60465 ·
https://github.com/vllm-project/vllm/pull/58429 · https://github.com/vllm-project/vllm/issues/58951 ·
https://github.com/vllm-project/vllm/releases/tag/v0.32.0 ·
https://docs.vllm.ai/en/latest/models/structured_decisions_models/ · https://pypi.org/project/laya/ ·
https://vllm-sr.ai/blog/decision-models/ · https://huggingface.co/vllm-sr/Decision-1.0-Lux-9B
