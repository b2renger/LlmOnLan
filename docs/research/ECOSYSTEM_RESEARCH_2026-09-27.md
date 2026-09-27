# Ecosystem research: facts behind the 2026-09-27 plan

Written 2026-09-27 for [ECOSYSTEM_PLAN.md](../ECOSYSTEM_PLAN.md). The facts below are checked against the
sources named with each item on that date. Where something was measured on this box, the item says so.
It builds on [COMPUTER_DATA_AND_TRAINING.md](COMPUTER_DATA_AND_TRAINING.md) (2026-09-23), which first
identified "latya" as **Laya**.

---

## 1. Laya: the owner's "latya"

- **What it is.** Laya is a non-autoregressive "System 1" decision model from Convai Innovations.
  - It reads a *state* (text, an e-mail, a ticket or a JSON object) and *typed questions*.
  - In one forward pass, it returns typed answers with probabilities.
  - It does not generate prose. It works as a fast classifier beside a slow thinking model.
- **Question types.**

  | Type | Answer | Measured strength |
  |---|---|---|
  | `choice` | one of the options you name | tested up to 77 options; weaker above ~20 |
  | `score` | a place on an ordered rubric | the weakest type (SST-5: 0.372) |
  | `noul` | P(true) for a yes/no statement | on the English checkpoint the label can dominate the answer |

- **Checkpoints.**

  | Checkpoint | Backbone | Size | Context | Use |
  |---|---|---|---|---|
  | `laya` | ModernBERT-large | 421M | 512 tokens | English |
  | `laya-multilingual` | mmBERT-base | 322M | 1024 tokens (8192 via RoPE) | 100+ languages, 2.2× faster |
  | `laya-typed-decisions` | ModernBERT-large | 421M | 1024 tokens | four fine-tuned workflows, 0.766 |

  A `Router` detects the script (<1 ms) and picks the checkpoint.
- **Cost and speed.**
  - Memory: ~0.8 GB (English), ~0.65 GB (multilingual).
  - Upstream figures: 33 ms per call on a T4 GPU, 193–464 ms per call on CPU; 103–332 questions/s batched.
  - Our own CPU measurement is in the ["Spike" section below](#spike-laya-on-this-boxs-cpu-2026-09-27).
- **Limits (from its own card).**
  - Base checkpoints are near chance on typed decisions zero-shot (0.362); fine-tuning lifts that to 0.766.
  - It ships over-confident (ECE 0.466), which temperature fitting on domain data brings down to 0.081.
  - It does **not** analyse tables or numbers. It works on text only.
  - Quality degrades past ~4k tokens.
- **Running it.**
  - `pip install "laya[serve]"` (Python ≥ 3.10, torch ≥ 2, transformers ≥ 4.48).
  - `laya-serve` exposes `POST /v1/systemone` over HTTP.
  - Optional extras: ONNX (`laya[onnx]`), MCP (`laya[mcp]`).
  - License Apache-2.0. Repository: NandhaKishorM/laya (26k stars, pushed 2026-09-26; PyPI 0.3.20).
- **Client-side alternative: kevala.** kevala (robtandy/kevala) is a Rust→WASM engine with WebGPU kernels for
  Laya and Kev in a web page.
  - It is 5 days old: 0 stars, npm 0.1.3.
  - It would need `wasm-unsafe-eval` in a CSP, and hundreds of MB of weights on every laptop.
  - Whether WebGPU works on the office laptops is unmeasured.
- Sources: https://huggingface.co/convaiinnovations/laya ·
  https://huggingface.co/blog/sora-2/laya-ai-model-how-it-works-run-it-locally-and-eval ·
  https://pypi.org/project/laya/ · https://github.com/robtandy/kevala

### Spike: Laya on this box's CPU (2026-09-27)
Setup: Python 3.12, a scratch venv, the `torch` CPU wheel plus `laya[serve]` 0.3.20, and `Router()` at its
default (lazy loading).

- **Install size:** a **904 MB venv** (CPU torch; a CUDA torch adds about 2.5 GB) plus **808 MB of weights**.
- **Speed:** the first call took **13.7 s**. The weights were already downloaded, so that is the load
  itself. After that, **~200 ms per call** (186–216 ms, two questions per call) on this box's CPU.
- **A warning at load time:** *"this checkpoint ships invalid temperatures … Treat confidence … as
  uncalibrated."*
- **Answers on 10 story titles.** Question 1 was a `choice` of topic (ai / software / hardware / science /
  business). Question 2 was a `noul`: "is this someone presenting a project they built?"

  | Title | topic (confidence) | launch P |
  |---|---|---|
  | Show HN: A local-first graph editor for LLM workflows | software (0.67) | 0.37 ✗ |
  | Why the Fed held rates steady again | business (0.96) ✓ | 0.08 ✓ |
  | Rust 2.0 release candidate is out | software (0.82) ✓ | 0.44 |
  | A new CRISPR technique edits mitochondrial DNA | science (0.84) ✓ | 0.58 ✗ |
  | Ask HN: How do you run LLMs on a LAN for a school? | software (0.53) ✗ (ai) | 0.14 ✓ |
  | OpenAI rival releases a 27B open-weights model | ai (0.73) ✓ | 0.61 |
  | The history of the ESP32 microcontroller | hardware (0.65) ✓ | 0.33 ✓ |
  | SpaceX lands a booster on a barge in heavy seas | science (0.50) ✓ | 0.71 ✗ |
  | PostgreSQL 19 adds native vector search | software (0.69) ✓ | 0.49 |
  | Show HN: I built a DMX lighting controller with a Raspberry Pi | software (0.47) ✗ (hardware) | 0.77 ✓ |

- **Reading.**
  - `choice` with a few options works as a fast first pass: about 7–8 of 10 are right, and the wrong ones
    come with lower confidence (0.47–0.53).
  - `noul` is unreliable zero-shot (a Show HN scored 0.37, SpaceX 0.71), just as the model card warns.
- **What this means for the design.**
  - Use Laya for `choice` questions, and show its confidence.
  - Send the items below a threshold (about 0.6) to the thinking model or to a person.
  - Do not build on `noul` without a calibration set.

### Laya on 109 real titles (2026-09-27, 21:55) — the critic's "confirm on 100+"

109 Hacker News titles (the front page + recent stories with > 20 points), 8 categories (ai, software,
hardware, science, business, politics, culture, other), CPU, `Router()` default: **21.5 s for 109** (~0.2 s
each). Reference labels by the integrator (Claude); 5 genuinely ambiguous titles excluded, 104 judged.

| | right | wrong | precision | share of items |
|---|---|---|---|---|
| all | 77 | 27 | **74%** | 100% |
| confidence ≥ 0.6 ("sure") | 54 | 13 | **81%** | 64% |
| confidence < 0.6 (sent on) | 23 | 14 | 62% | 36% |
| confidence ≥ 0.8 | 35 | 6 | 85% | 39% |

- The 0.6 default is a fair trade: two thirds of the items never reach the thinking model, and 4 in 5 of
  those are right. 0.8 buys 4 points of precision for 25 points of coverage.
- **Its typical error is over-assigning "ai"** to technical titles: *Go Concurrency Distilled* → ai (0.87),
  *Flip Fluid on Flip Dots* → ai (0.92), *Rusty thoughts on "Parse, don't validate"* → ai (0.78). About
  one item in eight is sure AND wrong, and nothing re-checks it — the lesson text says so.
- Raw output: kept in the session scratchpad (bench-out.json), not committed.

## 2. DeepSeek Harness: the owner's "deepseek harness"

- **What it is.**
  - `deepseek-ai/deepseek-harness` (`dsh`), MIT-licensed, a developer preview (breaking changes expected).
  - Node + TypeScript, built on the **Cordis** plugin kernel.
  - "Everything is a plugin": models, tools, skills, sessions, sandboxes, storage, the loop, scheduling and
    the UI.
  - An append-only session log records everything the model saw.
- **Modes.**

  | Mode | What the agent gets |
  |---|---|
  | standard | file edit, shell, file and web search, skills, planning, goals, subagents, workflows |
  | code | tools through a TypeScript SDK |
  | minimal | two tools: a persistent bash and `str_replace_editor` |
  | creator | runtime inspection and plugin experiments |

- **Running it.**
  - Web UI: `npx @deepseek-ai/dsh web`, on `127.0.0.1:3080`.
  - An SDK package (`client` / `protocol` / `server`) exists for driving it headless.
- **Packages** (listed through the GitHub API): acp, api, browser-use, computer-use, context, fs, hooks, llm, lsp, mcp, plan, sandbox (sandbox-local, sandbox-policy,
  **sandbox-windows-acl**), sdk, session, shell, skill (skill-filesystem, tool-skill), ssh, subagent,
  terminal, todo, web, webhook, workflow and workspace.
- **Local models.** Yes. `@deepseek-ai/dsh-llm-pi-ai` routes to OpenAI-compatible gateways declared by
  hand, which is exactly the farm's endpoint:
  `{ api: openai-completions, baseURL, models: [{ id, contextWindow }], compat: { thinkingFormat } }`.
- **Skills.** `skill-filesystem` discovers `SKILL.md` skills in project, custom and user directories, and
  `tool-skill` gives the model a `skill` loader tool plus `/name` invocation. So **ponytail** and
  **agent-skills** could load as plain skill folders.
- Sources: https://github.com/deepseek-ai/deepseek-harness · https://deepseek.com/harness/en/ ·
  packages/llm/llm-pi-ai/README.md and packages/skill/README.md in that repository.

## 3. Skills the owner named

- **ponytail** (dietrichgebert/ponytail, MIT). A "lazy senior developer" ruleset: YAGNI → reuse → stdlib →
  platform → dependency → one line → minimum.
  - Commands: `/ponytail`, `-review`, `-audit`, `-debt`.
  - It ships as a plugin for Claude Code, Codex and others, as rule files for Cursor and similar tools, and
    as `AGENTS.md`.
  - Upstream reports 54% less code, 22% fewer tokens and no loss of safety over 12 tasks.
  - We adopted it for our own code today (CLAUDE.md → Conventions).
- **agent-skills** (addyosmani/agent-skills, MIT). 25 `SKILL.md` workflows (frontmatter with `name` and
  `description`), grouped by phase:

  | Phase | Skills |
  |---|---|
  | Define | interview-me, idea-refine, spec-driven, constraint-driven |
  | Plan | planning-and-task-breakdown |
  | Build | incremental, TDD, context-engineering, source-driven, doubt-driven, frontend-ui, api-design |
  | Verify | browser-testing-with-devtools, debugging |
  | Review | code-review, simplification, security, performance |
  | Ship | git-workflow, ci-cd, deprecation, docs-and-ADRs, observability, shipping |

  They load through `npx skills` or host adapters (`.claude/`, `.gemini/`, `.codex-plugin/`).
- **graphify** (Graphify-Labs/graphify, Apache-2.0/MIT). An agent skill (`SKILL.md`), a CLI and a Python
  library.
  - It turns a codebase with its docs, SQL, configs, PDFs and media into a **queryable knowledge graph**:
    `graph.json`, `graph.html` (a force-directed view) and `GRAPH_REPORT.md`.
  - Code is parsed locally with tree-sitter.
  - Docs and media need an LLM backend, and Ollama is one of those listed.
  - Install: `uv tool install graphifyy`, Python ≥ 3.10.

## 4. Speech

- **Confucius4-R2T2** (netease-youdao).
  - A true-streaming ASR model: 2B parameters (1.7B per our earlier notes), BF16 safetensors.
  - Configurable 80 ms – 2 s decoding chunks, with append-only output.
  - Chinese and English first; also fr, de, it, ja, ko, pt, ru, es, ar.
  - It runs on **vLLM** (the primary route), or on transformers (CPU possible, not primary).
  - Code is Apache-2.0; the **weights are under the "NetEase Model Use License Agreement"**, which must be
    read before we redistribute or use them in a school.
- **Our own measurement** (Rtranslate project, 2026-09-24, on this box):
  - R2T2 median word latency ~0.48 s (p90 ~0.72 s), WER 1.2–1.3% in French and 2.5% in English.
  - It is ~6× faster than QVAC at equal accuracy.
  - It runs on Linux only (vLLM; on Windows through WSL2).
  - It does not translate, and French with real voices is unmeasured.
  - On a shared GPU, vLLM needs `kv_cache_memory_bytes`.
  - Processes started through `wsl.exe` must kill themselves on stdin EOF.
- **What we already have.**
  - The farm's Kokoro TTS plugin (OpenAI-compatible `/v1/audio/speech`, off by default).
  - OWUI's local faster-whisper STT (`WHISPER_MODEL=base`) inside the client's sidecar. The Computer cannot
    call it without coupling to OWUI.
  - The Computer's Sound box (a file in the graph, **never sent** today).
- Source: https://huggingface.co/netease-youdao/Confucius4-R2T2

## 5. Data sources and visualisation

- **Hacker News through Algolia** (`https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30`).
  - No key needed.
  - It reflects the caller's `Origin` in `access-control-allow-origin` (checked with `Origin: file://`), so
    the renderer could call it directly.
  - Each hit has `title`, `url`, `author`, `points`, `num_comments` and `created_at`.
  - That is text rich enough for Laya, with numbers for a chart.
- **CORS in general.** Many open-data APIs send no CORS headers, so a Computer "Fetch" should run in the
  main process (Electron `net.fetch`: no CORS, the system proxy, an explicit size and time cap).
- **d3.** Not in the sandbox today (`sandbox/lib/` has three r160, p5 1.11.13 and matter 0.20.0). d3 v7's
  UMD build would be vendored the same way (chat-lint rule 14: vendored libraries stay unmodified).

## 6. Connectors: what each needs on this stack (Electron 42, Node 22 in main, Chromium in the renderer)

| Connector | Where it can run | Native module? | Notes |
|---|---|---|---|
| HTTP fetch | main (`net.fetch`) | no | no CORS; cap size and time |
| WebSocket client (ESP32 as a server) | renderer (`WebSocket`) | no | a platform feature |
| WebSocket server (ESP32 as a client) | main | no (a minimal server is small), or the `ws` package | a LAN listener: opt-in, bound, token |
| OSC (send/receive) | main (`dgram` UDP) | no | encoding is ~60 lines, or the `osc-min` package |
| DMX over Art-Net / sACN | main (`dgram` UDP) | no | the packet format is simple; USB DMX (Enttec) goes through serial |
| Serial (Arduino, ESP32 over USB) | renderer (**Web Serial**, `navigator.serial`) | no | needs `session.on('select-serial-port')` plus a permission handler in main; avoids the `serialport` native module |
| MQTT | renderer over WebSocket (`mqtt.js`, vendored), or main over TCP | no | many brokers (Mosquitto) expose WS on 9001 |
| TTS / STT | farm plugins (Kokoro exists; STT new) or the client | — | the audio boundary changes: see the plan |
| Google Home / Alexa | cloud APIs | — | **conflicts with "local only, never cloud"**; only through a local bridge (Home Assistant) |
