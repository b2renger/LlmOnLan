# CLASSIFY_VLLM_PLAN: the Classify box answered by the vLLM the farm already runs

**Status: proposed, for the owner** (night n° 17, 2026-11-26, from the measurement the owner asked for on 2026-11-25 19:05,
plans ▸ Next 22). Size **S–M**. The farm (`farm/src/classify.js`, `farm/src/pysvc/classify_server.py`), and one small client change
for the words (step 3); the Classify box's contract stays; no new dependency.

## Why (measured 2026-11-26, [RESULTS](../spike/RESULTS.md) ▸ *Classify: vLLM's decision endpoint against Laya*)

194 public headlines, English and French, labelled by the section that published them, one `choice` question with seven
options:

| | right | at confidence ≥ 0.8 | per item | 194 items |
|---|---|---|---|---|
| Laya 0.3.20, the farm's plugin today (CPU, 4 threads) | 59 % (en 60, fr 59) | 71 % right, on 60 % | 166 ms | ~32 s |
| Laya 0.5.4 (the newest) | 59 % | 70 %, on 60 % | 78 ms | ~15 s |
| **vLLM 0.33.0's `/v1/systemone`, Qwen3.6 on the GPU** | **73 %** (en 71, fr 75) | **83 %, on 71 %** | **31 ms** (48 beside 10 chats) | 5.7 s; **2.1 s 16 at once** |

The model the farm already serves reads French, needs no second model or venv (Laya: a 904 MB venv, 808 MB of weights, a
CPU core per thread), and its confidence is closer to what it claims. The read is one step, thinking always off.

## The change

1. **The farm's classify service asks vLLM when vLLM serves** (`classify_server.py`, or the farm's Node side before it):
   when the farm's engine is vLLM and its model is one vLLM reads decisions for (Qwen3.6, Qwen3.8, Gemma 4: the read
   strategies in vLLM 0.33; not Nemotron), each item is one `POST http://127.0.0.1:<vllm port>/v1/systemone` (state = the
   item, the box's question and options), on loopback, not through the seat gate (its allowlist has no such route, and a
   decision is not a person's chat). Up to 8 at once per request (tonight: 16 at once took 2.1 s for 194).
2. **Laya stays for the other engines** (Ollama, llama.cpp) and as the fallback when vLLM does not answer; the plugin's
   switch and its CPU venv are unchanged. When vLLM serves, the plugin need not install Laya at all (to be decided in the
   build: the first version keeps the install as it is).
3. **The answer's shape is unchanged** (`choice`, `confidence`, `probabilities`): vLLM's `confidence` (the top label's
   probability times the labels' share) maps to it; the Computer's Classify box and its *Sure above* 0.6
   (`DEFAULT_THRESHOLD`, `graph/parts/classify.mjs:31`) stay as they are. **The box's words name Laya**
   (`by: 'laya'`, `classify.mjs:116`; the status line *… · Laya* and the help, `strings/parts-classify.en.mjs:19–21`): a
   small client change reads the `model` the service already returns, in the next client release. Until then a vLLM
   farm's answers are right and the box still says *Laya*.
4. **Tests:** the service's routing (vLLM on, a supported model → the decision route; another engine or no answer →
   Laya), with a fake vLLM; the farm's lifecycle suite gains one step (a decision through the running fake); a scratch
   farm on vLLM answers a Computer Classify box (the harness). Docs: `farm.md`, `computer.md`, the Classify box's help.

## What it does not change

The privacy boundary: the items already go to the farm, which keeps nothing; vLLM keeps nothing either (its prefix cache is
memory, as for chats). The seat gate and people's seats: a decision read takes no seat, as Laya's never did.

## The question

**Build this plan?** *Recommended:* yes (14 points more right, French included, 5× faster, no extra model on a vLLM farm).
*Default if no answer:* not built; Laya stays the Classify box's only answer.
