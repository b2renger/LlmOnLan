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
