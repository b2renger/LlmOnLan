# P5-0 spike — DeepSeek Harness on the farm (2026-09-28, 11:00–11:42, on the owner's OK)

**Question** (docs/ECOSYSTEM_PLAN.md §4.3): can DeepSeek Harness (`dsh`) be LOL Vibe's coding agent on the farm's
models? Four exit criteria; below them, the fallback is our own minimal loop.

**Verdict: PASS — all four criteria.** Use `dsh`, driven from the IDE's main process through its SDK (JSON-RPC on
stdio), with **qwen3.8** (the owner's pick) or **nemotron**; the IDE picks the model per session from the farm's
catalog. Not gemma4 for the edit loop (it thinks itself out of budget on edits).

## Setup
- `@deepseek-ai/dsh` **0.1.7-rc.2** (MIT; its sub-packages BSD-3-Clause), installed in a scratch folder:
  283 packages, **520 MB**. A developer preview.
- A **private test farm** from this repo on 127.0.0.1 only (ports 4100 / 42097, no beacon, no plugins, a password)
  with the Ollama catalog qwen3.8:latest (default), nemotron-3.5-lightning:30b, ornith-1.5:35b and gemma4:12b at a
  32k context. (The owner's Farm app was not running; it was not touched.)
- `dsh` configuration = one patch file, [`cordis.patch.yml`](cordis.patch.yml): a hand-declared `llm-pi-ai` route
  `lolfarm` (`api: openai-completions`, the farm's `/v1`, the password from an environment variable), the default
  model, and **no shell tool** (`tool-pwsh` / `tool-bash` disabled — the plan's first cut: read, edit, preview).
- Scripts: [`run.mjs`](run.mjs) (headless runs, one per model and repetition, a fresh project folder each, the
  raw events kept) and [`sdk.mjs`](sdk.mjs) (the SDK path).

## The four criteria

| # | Criterion | Result |
|---|---|---|
| 1 | dsh runs against the farm through `llm-pi-ai`'s OpenAI-compatible route | ✔ first task (write a file) in 15 s on qwen3.8 |
| 2 | ponytail loads from a folder | ✔ `SKILL.md` in `$DSH_HOME/skills/ponytail` (from the ponytail repo, MIT); qwen3.8 loaded it on every coding run and followed it (skipped an ambient light, "minimal") |
| 3 | a small task (a three.js page in a project folder) with ≥ 80% correct tool calls | ✔ 12/12 builds, 100% of tool calls (below) |
| 4 | the SDK drives a session headless | ✔ `dsh --profile sdk`: `initialize` {cwd, provider, model, maxTokens} → `session/prompt` → 22–42 `session.event`s → `running → idle`; a valid page in 16–18 s on qwen3.8, nemotron and gemma4 |

## Build — "create index.html: a three.js page with a rotating cube" (3 runs per model)

| Model | Pages that pass every check | Tool calls completed | Time | ponytail loaded |
|---|---|---|---|---|
| qwen3.8:latest | 3/3 | 8/8 | 6–9 s | 3/3 |
| nemotron-3.5-lightning:30b | 3/3 | 4/4 | 4–12 s | 0/3 |
| ornith-1.5:35b | 3/3 | 5/5 | 4–13 s | 0/3 |
| gemma4:12b | 3/3 | 3/3 | 8–24 s | 0/3 |

## Edit — "add a speed slider to this page; change nothing else" (the IDE's everyday job; 3 runs per model)

| Model | Done right (slider wired, the rest kept) | Tool calls completed | Time |
|---|---|---|---|
| **qwen3.8:latest** | **3/3** | 12/12 | 8–11 s |
| **nemotron-3.5-lightning:30b** | **3/3** | 14/14 | 5–9 s |
| ornith-1.5:35b | 2/3 (one run went round in 11 calls, 2 failed, the slider not wired) | 19/21 | 5–12 s |
| gemma4:12b | 1/3 — twice it thought 22,861 tokens in one step and hit the 32k ceiling (`max-tokens`, an empty answer, ~3 min) | 12/13 | 44–186 s |

qwen3.8 and nemotron always read the file, then made targeted `edit`s (never a whole-file rewrite).
Through the SDK with `maxTokens: 4096`, gemma4 no longer hangs (idle in 35 s) — but it still fails the edit 3/3
(the budget goes to thinking). The cap is the right guard; it does not make gemma4 an editor.

## What the IDE must do (design notes from the runs)
- **Adapt to models (the owner's rule):** the SDK takes `provider`, `model`, `reasoningEffort` and `maxTokens` at
  `initialize`, per session — the IDE lists the farm's catalog (llm-pi-ai can also discover `GET /v1/models`) and
  keeps a small **per-model profile**: a token cap, a reasoning effort, and a "good at edits" mark earned by this
  script's edit task. A new model is one run of `run.mjs --task edit` away from being trusted.
- **Detect `max-tokens`:** a turn that ends with reason `max-tokens` and an empty answer must be shown as such
  (never as "done").
- **Pin the skill roots:** by default dsh ALSO reads the user's `~/.claude/skills` and `~/.agents/skills` (it
  offered the owner's own "gepeto" and "pinokio"). The IDE sets its roots to `DATA_DIR/skills` (+ the project's
  `.dsh/skills`).
- **Session ids are durable** (`DSH_HOME/sessions`): one fresh id per conversation; `DSH_HOME` belongs in
  `DATA_DIR` (all data local, invariant #3).
- **Closing:** the SDK has no close method; a client ends a runtime by closing it — on Windows kill the process
  tree (a plain `kill()` leaves the child's pipes open).
- **Weight:** 520 MB of packages — download on first use (like the OWUI sidecar), not in the installer.
- **Two upstreams** (OWUI and dsh), both pinned: dsh is a developer preview; pin the exact version and its lockfile.

## Not yet shown
- Long tasks (10+ steps across several files), git, and the preview/serve loop — those are the v1 IDE's work.
- The web UI (`dsh web`) was not tried: the plan embeds the SDK in LOL Vibe instead.
