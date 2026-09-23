# The Computer, data and training: a feasibility study

> Status: **research only**. No code was written and nothing was committed. Date: 2026-09-23.
> The owner's question, verbatim: *"I think this thinking model would also be great to actually work
> with data (csv, json etc.) we could use something like kev or latya to actually train data. This last
> is a research question: I would like an agent to tinker on that and give us some feedback, pros and
> cons of implementing this idea. And what it could actually be useful for."*
> Grounding: [CLAUDE.md](../../CLAUDE.md), [COMPUTER_STATUS.md](../COMPUTER_STATUS.md),
> [COMPUTER_PLAN.md](../COMPUTER_PLAN.md) §0, §4 and §6, [farm/README.md](../../farm/README.md), and the parts in
> `shell/renderer/chat/graph/parts/`. Web sources were checked on 2026-09-23 and are listed at the end.

---

## 0. What "kev or latya" most likely means

| Reading | What it is | How well it fits |
|---|---|---|
| **Kev and Laya**, two "System One" decision models | Two open alternatives to TypeSafe's closed, cloud-only **Jev** (launched 2026-09-15). These models make fast typed decisions (yes/no, a choice, a score) with probabilities, working beside slow "thinking" models. **Laya** (Convai Innovations) came out on 2026-09-19. **Kev** (Jared Palmer) moved to Qwen3.5 on 2026-09-21. Both are Apache-2.0 and both are pitched as models you train and run yourself. | **Most likely.** They are the two most-cited open Jev alternatives this week. "latya" is one letter off "Laya". "Something like kev or latya" pairs two similar things. And Jev's framing (a fast System One next to a thinking model) is close to the owner's own sentence. |
| **Letta** (formerly MemGPT) | Agents that "learn" by editing their memory, not their weights. Needs a server, Postgres with pgvector, and an embedding model. | It sounds like "latya", but it does not train on data. It also needs a stateful server and embeddings, both against the farm's rules. |
| **LoRA/QLoRA with Unsloth** | Fine-tuning the chat model itself. | These are not the names the owner used, but it is what most people mean by "train on our data", and the farm already serves Unsloth GGUFs. See §2c. |
| Keras, Ludwig, Kedro, KTransformers | Libraries, pipelines, an inference engine | Weak fits. None of them adds a new option. |

**The owner should confirm the reading.** Sections 1 and 3 hold whatever it turns out to be.

---

## 1. Working with data in the graph, with no training

### 1.1 What works today without new code

Paste a CSV into a **Text** box and wire it into a **Code** box, which parses it, infers a schema (column names, types, missing values, ranges) and returns JSON. **Split** in `json` mode turns the rows into a list, and an **Instruction** fans out once per item. A second Code box joins and counts the results. A Code box whose output format is set to SVG draws a chart in a **Preview** box. The Code part's own header states the rule: *"a model that sorts forty items is forty chances to drop one."*

### 1.2 Who does what

| Job | Who | Why |
|---|---|---|
| Parsing, types, deduplication, joins, group-by, sums, means, percentiles, outliers, charts | **Code** | Exact, deterministic, free. |
| Naming columns, guessing what a dataset is, drafting a data dictionary | Model | Language work. A wrong guess is easy to see. |
| Labelling free-text rows (client feedback into *lighting / modelling / texture / UX*), pulling fields from messy cells | Model, fanned out in batches | What a 12B model is actually good at. Errors happen per row and can be checked on a sample. |
| Explaining an anomaly Code found ("render 812 took 9× the median and has 4× the samples") | Model | It explains a small context that code already computed. |
| Cleaning rules ("the dates come in two formats") | The model **suggests**, a **person** pastes it into Code | A Code box's program is `settings.code`, which only a person types. Keep it that way. |
| **Any number**: a count, total, average, maximum, trend | **Never the model** | On TableBench, GPT-4-Turbo scored 51% against 86% for humans, on tables of **16.7 rows on average**. A 12B model does worse. |

### 1.3 Context windows and chunking

- **Window sizes.** gemma4:12b has a native 262,144-token window. The client trusts at most that much, and assumes 32,768 when a farm reports nothing (`ctx/budget.mjs`). llama.cpp's automatic sizing gives about 36k on the 12 GB boxes and about 78k on the 16 GB ones.
- **CSV costs many tokens.** At roughly 3–4 characters per token (digits cost more), 1,000 rows × 10 columns (about 50 KB) comes to about 15k tokens. A 1 MB CSV (the graph's stored-value cap, `MAX_VALUE_BYTES`) comes to about 250–350k tokens, more than any window. *(These are estimates, not measured on our tokenizer.)*
- **A long prompt holds a seat.** We measured prefill at 4–6k tokens/s on the A6000 Pro (DEVLOG 2026-09-07 c). A 200k-token table would hold a seat for about 40–60 s before the first token there, and for minutes on the 12/16 GB boxes. Accuracy over long tables also drops.

What follows from this:

1. **Never send the table itself.** Send the schema, the statistics Code computed, and a sample of 50 rows or fewer.
2. **Fan out in batches of 20–50 rows.** Ask for JSON labels **keyed by row id**, and let Code join them back **by id, never by position**.
3. **Plan around the cap.** A run's default cap of 50 generations counts every fanned-out item. Labelling 1,000 rows one at a time is 1,000 generations, so the run stops at 50. In batches of 25 it takes 40.

### 1.4 What is missing

- **A Data part.** It is already on the owner's parked list. It would let you drop or pick a `.csv`, `.tsv` or `.json` file, detect the header, and output the rows as a `json` value. It would refuse files over 1 MB with a clear sentence, and its face would show the first 50 rows and the column types. `computer/intake.mjs` already has the same pattern for pictures.
- **A table view.** A Preview `table` mode for JSON arrays. Markdown tables already render, so this is small.
- **A chunker.** A Split mode for "rows, N at a time".
- **Charts and joins as Code templates, not new parts.** `describe`, `groupBy`, `join`, and SVG `bar`/`line`/`scatter`. These should be snippets, not a library: three.js, p5 and matter already use 1,774 KB of the sandbox's 2.0 MB library budget, so Plotly and TensorFlow.js do not fit.

**Cost:** about one K-sized phase, all in the client. No farm change, no new dependency, and no prime directive touched.

---

## 2. Training

### 2a. Tiny models inside the Code box, on the laptop

Linear and logistic regression, k-means, k-NN, a small decision tree or a two-layer MLP each take 50–150 lines of plain JavaScript in the existing sandbox. That means no library, no farm and no GPU. **The data never leaves the laptop and the farm stays stateless.**

- **Is it fast enough?** Logistic regression on 10k rows × 20 features for 200 epochs is about 80 million multiply-adds, under a second. A small MLP on 5k rows for 50 epochs is about a billion operations, a few seconds. That is close to the Code box's 5-second timeout. The fix is also the teaching device: run 10 epochs per activation, and pass the weights around a **gated loop** (a Toggle on a back edge; `maxIterations` can be raised to 100). Each iteration then redraws a loss curve and the fit in a Preview box, so you watch it learn.
- **Useful in this studio:**
  - predicting **render time** from scene stats (polygons, samples, resolution, lights) using the studio's own logs;
  - flagging **VR playtest sessions** likely to end in a discomfort report, from telemetry;
  - grouping the **asset library** by size and complexity.
- **Limits:** thousands of rows, not millions, and no images.
- **Cost:** templates plus one or two lessons. No infrastructure.

### 2b. System One decision models: Kev and Laya (the owner's reading)

| | **Kev** | **Laya** |
|---|---|---|
| What it is | A rank-16 LoRA plus a pointer head on Qwen3.5 0.8B / 4B / 9B. It answers typed questions about one input in a single pass and returns probabilities plus a confidence. | ModernBERT-large, 421M parameters (English, 512 tokens), or mmBERT-base, 322M (100+ languages, 1,024 tokens), plus a decision head with an act/escalate output. |
| Licence | Apache-2.0 for code **and** weights. The Qwen3.5 base is Apache-2.0. | Apache-2.0 |
| Running it | PyTorch with transformers ≥ 5.17, behind its own `/v1/systemone` server (not OpenAI chat). One request at a time. About 4 / 16 / 32 GB of VRAM. No GGUF. | Runs on CPU. About 33–40 ms per question on a T4. |
| Training on your own data | JSONL of state, questions and label. "A few hundred" labels suggested. The 0.8B trains on a 4 GB GPU; the 4B needs 16 GB or more. | Near chance zero-shot (**0.362**). Reaches **0.766** only after fine-tuning on the benchmark's own 1,200 cases (4–5 h on 2×T4). Ships over-confident. |
| Quality | Kev-9B: 0.852 on new sources, about 4% confident errors. | One adversarial evaluation: **40.3%** accuracy, with 54% of high-confidence answers wrong. |

**Where it would fit.** **Condition** in `mode:'model'` is already a "semantic if": one gemma4 generation with a fixed `{verdict}` schema. A System One model does that job better, returning a typed answer with a probability in tens of milliseconds. Wiring *low confidence → Confirm* gives an agent that knows when to ask a person.

**What it would cost:**
- **Farm:** a plugin shaped like OCR (`pysvc`, the plugin registry, a venv built by `lol install`). It needs CUDA PyTorch (several GB) in its own venv, and its endpoint sits outside LiteLLM, so the seat gate does not cover it.
- **VRAM:** Kev-0.8B needs about 4 GB on top of gemma4's roughly 10 GB. That does not fit the 12 GB cards and is tight on 16 GB. Laya on CPU avoids the GPU.
- **Client:** a "decide" mode that shows the probabilities.
- **Effort:** inference alone is about a week across farm and client. Adding training is two weeks or more, plus §2e.

**Would the studio use it?** Its pitch is **volume**: millions of decisions, where 30 ms matters. A studio making dozens of decisions a day does not have that problem, and gemma4 already answers a Condition in seconds. Training also needs **a few hundred labelled examples of a stable decision** (asset QA pass/fail, feedback categories). Without those there is nothing to train. Kev is English-only; French would need Laya's multilingual checkpoint.

### 2c. LoRA/QLoRA fine-tuning of the chat model (Unsloth)

- **Facts.** The Unsloth core is Apache-2.0; Unsloth Studio is AGPL-3.0 (fine internally, never bundle it). QLoRA on Gemma 4 12B peaks at about **14–16 GB** (a third-party guide). It exports GGUF for llama.cpp and Ollama. Gemma 4 is Apache-2.0, so derivatives are allowed.
- **On this farm.** Training keeps the GPU saturated for tens of minutes to hours.
  - A 16 GB box that is serving gemma4 has no room for it.
  - The 96 GB box or the Spark can hold both, but everyone's generation slows. Nothing gives Ollama priority over a PyTorch job.
  - On Windows, overcommitted VRAM spills into system RAM. That is the *"few tokens a second"* crawl the farm README warns about.
- **Serving the result.** The weights must be **stored** on the farm and loaded next to or instead of gemma4. Once served, **every LAN user can query a model trained on one person's data.**
- **Useful for:** a house style or output format. It does not reliably teach facts; a 262k window with the documents in it does that better. A few examples in a Text box get most of the benefit today.
- **What it teaches:** very little anyone can see. A loss number drifts down for an hour.
- **Verdict:** do not build it into LOL. If a real need appears, fine-tune by hand outside LOL, export a GGUF, and serve it through the existing llama.cpp model library, which takes a `.gguf` URL. That needs no LOL code.

### 2d. Embeddings plus a small classifier

This is the classic cheap recipe, but it is ruled out twice. The Computer never calls `/v1/embeddings` (LOLCHAT_PLAN §1.2, enforced by lint). And doing embeddings inside the sandbox would need onnxruntime-web plus a model, tens of MB against a 2 MB budget. Kev and Laya are this recipe done end to end (a pretrained encoder plus a trained head), so §2b is the form it should take.

### 2e. The stateless farm versus training

Training turns user data into an artifact, and the artifact has to live somewhere. There are three ways out:

1. **Train on the laptop (§2a).** No conflict at all, but only for tiny models.
2. **The farm computes, the laptop keeps.** The client uploads the dataset with the job. The farm trains in a temporary folder, sends back the adapter, then deletes everything. For inference, the farm holds adapters only in an **evictable cache keyed by content hash**, and the client re-sends one on a miss.
   - This is the OCR pattern (bytes pass through, nothing is stored) plus a cache, and it is defensible.
   - But an adapter **memorises its training data**, so it must never appear in `/v1/models`.
   - This option is also where scope creep starts: job queues, cancellation, GPU scheduling against live chats.
3. **A named, openly stateful training box.** That is a written exception to invariant #3, an owner decision rather than engineering.

---

## 3. Educational value

**Training teaches better about *models*, not about *agents*, and the Computer needs both.** Prompting shows that an agent is a model plus tools, a loop, control and human gates. Prompting cannot show **where a model's behaviour comes from**. Training can, and it unlocks these lessons:

1. **A model is numbers fitted to examples.** You watch the weights move and the line bend.
2. **Generalisation versus memorisation.** Training and test curves pull apart on screen.
3. **Data quality is model quality.** Mislabel 10% of the rows and watch.
4. **Knowing when it doesn't know.** Low confidence routes to a Confirm box. *This one is an agent lesson.*
5. **System 1 versus System 2.** A narrow model that decides in 30 ms against a general one that reasons for seconds.
6. **Few-shot prompting as the cheapest training.** Put five labelled examples in an Instruction and let Code score it on 50 held-out rows. No weights change. This is the bridge lesson, and the safest kind of "training" a shared farm can do.

Lessons 1–3 and 6 need only §2a. Lessons 4–5 need §2b, or an honest stand-in: ask gemma4 for a probability, measure how badly calibrated it is, and make that the lesson. **The Code-box path gives most of the teaching value for almost none of the cost.**

---

## 4. Pros, cons and risks

| Option | Pros | Cons |
|---|---|---|
| **Data parts** (§1) | Useful immediately (render logs, asset inventories, timesheets, feedback sheets). Client-only. Teaches the split between model and code. | New surface to maintain; people will hit the 1 MB cap. |
| **Tiny training in Code** (§2a) | No infrastructure. Data stays local, the farm stays stateless. You watch it learn. | Small data only, no GPU, no images. Needs well-written templates. |
| **Kev/Laya inference** (§2b) | A calibrated semantic "if", plus the System 1 vs 2 lesson. | New Python/CUDA service, VRAM pressure, an endpoint outside the seat gate, models only days old. |
| **Kev/Laya training** | A model specialised on the studio's own decisions. | Needs hundreds of labels the studio may not have, a stateful farm or a cache design, and GPU contention. |
| **LoRA of the chat model** (§2c) | A house style. | Hours of saturated GPU, a stateful farm, data exposed to the LAN, little visible teaching. Prompting gets most of the benefit. |

**Risks**

- **GPU contention.** Training is compute-bound for minutes to hours. The seat gate and the Computer's background lane govern LLM calls, not a training process.
- **A stateful farm.** "The farm stores nothing" is also how the farm runs day to day: boxes can be wiped and clients fail over. A box that holds someone's model cannot be failed over.
- **Data leaving the laptop.** Today only completions, OCR bytes and search queries leave. Training would send whole datasets, and adapters memorise them.
- **Scope creep.** Dataset versioning, experiment tracking and a model registry are the job of Kiln, Ludwig or Unsloth Studio. CLAUDE.md puts model management out of scope.
- **Licences.** Kev, Laya, Qwen3.5, Gemma 4 and the Unsloth core are Apache-2.0: fine. Unsloth Studio is AGPL-3.0: never bundle it. TabPFN's weights are **non-commercial**: leave it out.
- **Freshness.** Kev and Laya are days old, and Laya's headline numbers are already contested.
- **Wrong numbers in confident prose.** This is the data risk that matters most, and the reason aggregation always stays in code.

---

## 5. Recommendation: build part of it

**Build now, in the client:** data in the graph (§1) and tiny training in the Code box (§2a).

**Wait on Kev and Laya.** Revisit once the studio has a stable decision with a few hundred real labels, and the projects are a few months older. The cheapest early experiment would be **Laya-multilingual inference on CPU**, as an opt-in farm plugin that is off by default, with no training.

**Do not build:** LoRA fine-tuning from the Computer; farm-side training jobs or model storage; embeddings; Letta; TabPFN; a vendored ML library in the sandbox; any path where model-written code runs on data without a person pasting it.

**The smallest first step worth building** is one K-sized phase (2–3 units), all in `shell/renderer/chat/`. It changes nothing in `farm/`, `farm-app/`, `sidecar/` or the dependencies:

1. **A Data part.** Drop a CSV/TSV/JSON file, with a 1 MB cap and a table face (`computer/intake.mjs`, a new `graph/parts/data.mjs`, one row in `index.mjs`).
2. **Two Code templates:** `describe` (schema and statistics) and `chart` (SVG into Preview).
3. **A template called "Label, then count":** Data → Split (25 rows at a time) → Instruction (a JSON label per row id) → Code (join by id, count) → chart. It shows the division of labour in one picture.
4. **A lesson called "Watch it learn":** render logs → Code (linear regression, 10 epochs per activation) ↺ Toggle → Preview (loss curve, fit, train/test split). It fits as an act-3 lesson in K5.

Each step adds value on its own, and none of them moves a byte off the laptop.

---

---

## Addendum (orchestrator, 2026-09-23): a client-side path the study did not weigh

A search while verifying the names above turned up **kevala** ([robtandy/kevala](https://github.com/robtandy/kevala),
mirrored at [bvolpato/kevala](https://github.com/bvolpato/kevala)): "Decision models (Laya, Kev) in any web page: a
zero-dependency Rust engine compiled to WebAssembly, with WebGPU kernels. One import, no server." That weakens §2b's
main reason to wait — Kev and Laya need not require a new CUDA/PyTorch service on the farm at all. They could run on
the laptop, next to the graph, which also keeps the farm stateless for free.

It is not a free win, and these are the costs to weigh before anyone builds it:

- **CSP.** The renderer's CSP blocks WebAssembly today, and the sandbox page's CSP is frozen by chat-lint rule 9.
  Either one would need a deliberate, reviewed change (most likely `wasm-unsafe-eval` in the sandbox only).
- **Weights on every laptop.** Even the 0.8B Kev is hundreds of megabytes per client, downloaded once. There is no
  CDN here, so the weights would have to be served from the farm or bundled like the Open WebUI sidecar.
- **WebGPU in this Electron**, on the office's actual laptops, is unmeasured.
- **Maturity.** Days-old models behind a days-old engine. This fits §5's "wait", but as a *client* experiment
  rather than a farm service.

If the owner wants an early test, this addendum changes the cheapest experiment. Instead of Laya on CPU on the farm,
it becomes kevala + Laya inside a scratch Electron window on one laptop: no farm change, no product change, one
afternoon, and it answers the three unknowns above.

## Sources

- TypeSafe, *Introducing System One Models & Jev* (2026-09-15): https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Kev repository and README (Apache-2.0; Qwen3.5 generation 2026-09-21): https://github.com/jaredpalmer/kev
- AI Weekly on Kev's Qwen3.5 port: https://aiweekly.co/alerts/jared-palmer-ships-kev-an-apache-20-jev-style-decision-model-family-built-on
- Laya model card: https://huggingface.co/convaiinnovations/laya · typed-decisions checkpoint: https://huggingface.co/convaiinnovations/laya-typed-decisions
- AI Weekly on Laya (2026-09-19, benchmark caveats): https://aiweekly.co/alerts/convai-ships-laya-a-421m-modernbert-decision-model-apache-20
- Invide Labs, *System One models: Jev and its open-source alternatives* (independent evaluation figures): https://blog.invidelabs.com/system-one-models-jev-laya-open-alternatives/
- Letta (Apache-2.0, memory-based learning): https://www.letta.com/blog/ · Docker/Postgres deployment: https://docs.letta.com/v1-sdk/docker
- Unsloth, Gemma 4 fine-tuning guide: https://unsloth.ai/docs/models/gemma-4/train · repository and licences: https://github.com/unslothai/unsloth
- Third-party Gemma 4 12B QLoRA VRAM figure: https://markaicode.com/howto/how-to-fine-tune-gemma-4/
- Google, *Gemma 4 under Apache 2.0*: https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html
- Kiln: https://github.com/Kiln-AI/Kiln · Ludwig: https://github.com/ludwig-ai/ludwig
- TabPFN-2.5 licence (non-commercial weights): https://huggingface.co/Prior-Labs/tabpfn_2_5
- TableBench (GPT-4-Turbo 51% vs humans 86%): https://tablebench.github.io/
- In-repo facts: `graph/parts/code.mjs` (`CODE_TIMEOUT_MS`), `graph/serialize.mjs` (`MAX_VALUE_BYTES`),
  `ctx/budget.mjs`, `graph/runner.mjs` (the generation cap), `graph/parts/condition.mjs`, `sandbox/libs.mjs`,
  `shell/test/chat-lint.js` (`LIB_BUDGET_BYTES`), DEVLOG 2026-09-07 c (prefill), farm/README (VRAM shapes, the
  Windows overcommit crawl, the OCR precedent).
