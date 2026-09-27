# P4 agent spike — results (2026-09-27, 21:08–21:14, on the owner's OK)

**Question** (docs/ECOSYSTEM_PLAN.md §5, §8d): how reliably does the farm's model call tools? The bar:
**≥ 80% correct tool calls** → build the Computer's Agent box (P4) and let the IDE (P5) rely on tool calling;
below → the Agent box waits and the IDE uses small, confirmed steps.

**Verdict: PASS.** `gemma4:12b` (the default farm model, on Ollama, 262,144-token window) scored **95%**
with native tool calls, **90%** in JSON mode, and **10/10** multi-step episodes.

## Setup
- A dev farm from the repo on this box (AN-A6000PRO, RTX PRO 6000 96 GB), the owner's farm closed, no users on.
  The model served as `assistant` → `gemma4:12b`; a farm password set (so the seat gate and the key path ran).
- The script: [`run.mjs`](run.mjs) — rerun it on any farm:
  `node docs/research/agent-spike/run.mjs --base http://<farm>:4000/v1 --key <password> --reps 4 --mode both`
  (and `--mode episode --reps 10`). One request at a time; it stops on a 429 or a farm with people waiting.
- 8 tools: an IDE's (`list_files`, `read_file`, `write_file`, `preview`) and the Computer's (`add_box`,
  `wire`, `set_settings`, `run_graph`). Temperature 0.2.
- A call counts as CORRECT only when the tool is right AND its arguments parse AND carry what was asked
  (the right path, the box type, the value…).

## Single calls — 10 tasks × 4 repetitions per mode

| Mode | Correct | Right tool | Median |
|---|---|---|---|
| native (`tools`, via LiteLLM → Ollama) | **38/40 = 95%** | 95% | 1.3 s |
| JSON (`{"tool","args"}` forced by a schema) | **36/40 = 90%** | 90% | 1.6 s |

Every task scored 4/4 in both modes except ONE: *"Show me index.html."* → the model opened `preview` instead
of `read_file` (native 2/4, JSON 0/4). "Show me" is honestly ambiguous between the two tools: a tool-design
lesson (non-overlapping names and descriptions), not a model failure. Without that task: 100% in both modes.

## Episodes — several turns, tool results fed back

*"Change the title of the page to Night Garden; keep everything else"*: the model must look, then write
index.html with the new title AND the rest of the page intact, within 4 calls.

**10/10**, every time `read_file → write_file`, ~1.9 s per episode (through the seat gate, with the password).

## What this does NOT show yet
- Long tasks (a three.js page from scratch over 10+ calls), where errors compound: that is P5-0's test,
  with DeepSeek Harness itself (not installed tonight).
- Qwen3.8 on llama.cpp (the speed engine): not measured — only the served model was tested, by design.
- Tools with side effects in the Computer: the Agent box's tools will still end at a **Confirm** before
  anything leaves the machine, and an agent can never arm the outputs (plan §3.5, §8c).

## Decision it unlocks
- **P4 Agent box: go**, with small tool sets, clear non-overlapping tool descriptions, and a Confirm before
  outputs. Native tool calls first; the JSON mode is the fallback for a model or engine without them.
- **P5**: tool calling is not the blocker; the DeepSeek Harness spike (P5-0) now only has to prove the
  harness itself (install, skills, headless SDK) on Windows.

## The Agent box, built — on the rig (2026-09-27, 22:55–23:25)

The box (`shell/renderer/chat/graph/parts/agent.mjs`, commit 3f19c48) went JSON mode through the Computer's own
ask door — not native tools — so every step is a generation on the run's Cap and uses the lane every Instruction
uses (native tools stay the upgrade path). No output tool at all, so no Confirm was needed: an agent can only
compute, read the hosts a person listed, ask Laya and answer.

**Task** (the real app, the dev farm, live data.gouv.fr): an **Open data** box on *Fréquentation des Musées de
France* (12,292 rows) wired into an Agent allowed ONE host, `tabular-api.data.gouv.fr`: *"Over the WHOLE file,
which 5 regions had the most museum visitors in total, all years together?"* — the task text names the tabular
API's `?<column>__groupby&<column>__sum` syntax. 8 steps at most.

| Model (Ollama, same farm) | Steps | Time | Answer | What happened |
|---|---|---|---|---|
| gemma4:12b (the default) | 3 | 23 s | ✔ the 5 regions and sums, exactly the code's result | fetch `?region__groupby&total__sum` → sort in code → answer |
| qwen3.8:latest | 3 | 15 s | ✔ same, as a table | same path; added "2001–2022" (from the input's column stats) and "nearly 9×" (its own arithmetic, correct) |
| nemotron-3.5-lightning:30b | 4 | — | ✔ same | forgot the `?` → 404 fed back → fixed the URL next step |

**What the first runs taught the box** (each fixed, then the table above): a step's 4096 tokens were all spent
thinking (→ 16384, clamped to the window); a dataset's long description hid its `columns` in a 1500-character
preview (→ inputs and results go as a SKETCH: long texts cut, lists shortened with a count); one malformed
JSON step killed the run (→ fed back like a failed tool: at 90% per call, 8 steps would otherwise all have to
land); gemma4 wrote `results[0]` five times running against `inputs.results[0]` (→ `results` is in the code's
scope); code that `console.log`s returns null (→ the model is told to return). The rig's first runs also read
the WRONG file: a changed Open data link does not re-run a box that already holds a value when ▶ is pressed on
a box downstream — run the Open data box itself first (a Computer rule, not the Agent's).

**The template "Ask a dataset" (2026-09-28, 00:05–00:25)** — the festivals list, *"Which 5 regions have the most music
festivals?"*, gemma4. First run (6 steps at most): it wrote column names with underscores (400 ×2) and counted a
sub-category instead of filtering the discipline. Second run: the tabular API refused every call with a bare "400"
(`page_size` over 200) and the agent answered with the profile's counts of ALL festivals, labelled as music ones —
the worst failure of the night, and the reason for two fixes: `io.ts` now returns what the site SAID about a refusal
(≤ 300 characters: *"Page size exceeds allowed maximum: 200"*, *"column … does not exist"*), shown on the Fetch
box and fed to the agent; the answer tool must say plainly when the steps did not find what was asked. With the
task's encoding example (`?Discipline%20dominante__exact=Musique`) and 8 steps: **6 steps, 69 s, correct** —
Provence-Alpes-Côte d'Azur 416, Auvergne-Rhône-Alpes 408, Occitanie 386, Nouvelle-Aquitaine 345, Bretagne 315,
matching an independent query of the tabular API.
