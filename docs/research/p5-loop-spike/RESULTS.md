# P5-L spike — agent loops with qwen3.8 in the DeepSeek Harness we ship (2026-09-29, 14:20–15:16)

**Question (owner, 2026-09-29):** "I want to know if it's possible to do agents loops with qwen3.8 with the harness
we have." His answers framed it: loops that **finish a project, watch and act, research and report, run on a
schedule**; reach = **its project files + the Computer and devices**; started **only by a person**.

**Verdict: YES with qwen3.8 — with four changes to what we ship.** nemotron is not good enough for multi-tool loops.

## Setup
- The private farm on 127.0.0.1:4100 (no beacon, no plugins, no password), qwen3.8:latest and
  nemotron-3.5-lightning:30b. First round with the farm at a 1M context, the batch at **32k** (a constrained farm).
- dsh 0.1.7-rc.2 from `shell/dsh/build/dsh-runtime`, driven headless over its SDK exactly as the IDE does, with
  **the shipped profile patch** (`studio.js buildPatch`: the project fence, no shell, no web, telemetry off) plus:
  `tool-goal` + `goal-round-driver` re-enabled (a round cap), the compaction headroom fitted to 32k (see below), and
  for the Computer tasks an `mcp-client` row to the Computer's MCP server (an isolated dev client, 127.0.0.1:41995).
- dsh is told a 32k window; `maxTokens` 8192 (the IDE's default) or 16384.
- The driver: [`loop.mjs`](loop.mjs) — every event to `events.jsonl`, checks on the result. A goal can only be started
  by the MODEL (`create_goal`; dsh's SDK has no goal method and does not parse `/goal`), so the prompt carries the
  sentence a "keep going until done" switch would add.

## How dsh loops (read from its code, then confirmed)
- `create_goal {objective, max_goal_rounds}` on a person's turn arms a goal; when the agent goes idle with the goal
  still active, `goal-round-driver` queues a `<goal_round>` message ("Round r/max… gather evidence, mark it complete")
  — until the model calls `update_goal complete|blocked`, or the round cap. **No token/time budget** — only rounds.
- A turn that ends on **max-tokens disarms the goal** (silently, from the SDK's view).
- dsh's own **schedule is not usable headless** (it needs dsh's web host): a schedule has to come from our side.
- The MCP client exposes the Computer's 10 tools as `mcp__computer__*`.

## Results
| Task (what a person asked) | Model | Farm ctx | maxTokens | Outcome | Time | Tool calls (errors) |
|---|---|---|---|---|---|---|
| Snake, 4 requirements (no goal asked) | qwen3.8 | 1M | 8192 | ✔ all 4, one turn, self-checked | 62 s | 6 (0) |
| Snake, 8 requirements, as a goal | qwen3.8 | 1M | **8192** | ✘ **turn ended on max-tokens → goal disarmed**, no file | 139 s | 3 (0) |
| same | qwen3.8 | 1M | 16384 | ✔ 8/8, goal created → complete | 160 s | 16 (0) |
| same | qwen3.8 | 32k | 16384 | ✔ 8/8 (finished in one turn, no goal opened) | 75 s | 4 (0) |
| Snake, 8 req., **one per round** (forces the round driver) | qwen3.8 | 1M | 16384 | ✔ 8/8, **7 rounds**, one failed edit recovered | 239 s | 49 (1) |
| same, **with** the compaction fix | qwen3.8 | 32k | 16384 | ✔ 8/8, 7 rounds, **17 compactions** | 772 s | 77 (1) |
| same, **without** it (as shipped) | qwen3.8 | 32k | 16384 | ✘ **0 compactions; round 5 ended on max-tokens → stalled at 4/8** | 264 s | 30 (0) |
| Computer: build "Room monitor" (Text → Code → Preview, Send dry run), run 24 and 29 | qwen3.8 | 1M | 16384 | ✔ goal → complete; 24 → fine, 29 → too hot | 37 s | 18 (0) |
| same | qwen3.8 | 32k | 16384 | ✔ same verdicts | 86 s | 11 (0) |
| Research: data.csv → counts **computed by a Code box on the Computer** → report.md | qwen3.8 | 1M | 16384 | ✔ 5/5 regions, 3/3 top disciplines | 75 s | 11 (0) |
| same, irregular data (25/16/16/10/6; 31/13/12) | qwen3.8 | 1M | 16384 | ✔ 5/5, 3/3 | 70 s | 11 (0) |
| same | qwen3.8 | 32k | 16384 | ✔ 5/5, 3/3 | 148 s | 17 (0) |
| Snake, 8 req., as a goal | nemotron | 32k | 16384 | ~ marked complete, but "swipe" is tap zones with a case bug | 57 s | 16 (0) |
| Computer: Room monitor | nemotron | 32k | 16384 | ✔ (no goal opened) | 39 s | 19 (1) |
| Research via the Computer | nemotron | 32k | 16384 | ✘ refused arrows (`unknown-port`) ×8, 21 runs, drifted to graphify, **no report** | 263 s | 87 (10) |

qwen3.8 read before it edited, made targeted `edit`s, re-read and grepped its own files before marking a goal
complete, and recovered from a failed edit (re-read, retried). Whether it opens a goal varies (a job that fits one
turn is simply done in one turn). The Send box stayed a dry run: no MCP tool arms the outputs.

## What the product needs (none of it built yet)
1. **DONE (`392ea34`, v0.2.5) — compaction on small windows, a fix for the IDE as shipped**, loops or not: with a 32k window (also the IDE's
   fallback when a farm advertises none) dsh's compaction budget is negative and it never compacts; a long project
   conversation then dies on max-tokens. `- id: compaction-basic / config: { headroomTokens: 4096, maxTokens: 4096 }`
   in `buildPatch` made the same job compact 17× and finish. With it in the shipped patch alone: 9 compactions, 7 rounds, 12/12 (471 s).
2. **maxTokens ≥ 16384 for goal work** (8192 ended a turn mid-write and disarmed the goal).
3. **Goals on** (`tool-goal`, `goal-round-driver`, a round cap), and the runner (`studio.ts`) must keep listening past
   the first `idle` while a goal is armed (today it finishes the turn on the first idle), show the goal and its rounds
   (`goal/change` events), re-arm or say so after a max-tokens end, and Stop = a person's "pause the goal" turn or the
   process kill it already does.
4. **The Computer as the agent's hands** (MCP row, the bearer from main) — graphs built and run by the agent; devices
   only once a person arms the outputs, as today. Small help for weaker models: the `unknown-port` refusal should list
   the target box's ports.
5. **Schedules from our side** (dsh's needs its web host): e.g. a person switches on "every N minutes / at 08:00" in
   the Project panel, main sends the goal's prompt while the app is open — the Trigger box's rule.
6. **Costs:** a loop holds one farm seat for its whole run; at 32k a long loop is ~3× slower (each compaction is a
   generation).

## Correction (2026-09-30)
The first spike runs passed the hooks config to `buildPatch` as the JSON itself, where the product passes a file path,
so **the project fence was not loaded in those runs** (no task tried to leave its project, so no result changes).
`loop.mjs` now writes the hooks file as `studio.ts` does — the fence and the new syntax check (`CHECK_JS`) — and a run
asking to read `C:\Windows\win.ini` was blocked (`hook/result decision: block, exit 2`).
