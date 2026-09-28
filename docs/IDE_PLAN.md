# LOL Vibe IDE (P5 v1) — build plan

Owner, 2026-09-28: "yes start the build" (after the P5-0 spike passed — [research/p5-spike/RESULTS.md](research/p5-spike/RESULTS.md));
qwen3.8 first, "it should adapt to several models, new models will appear"; git to the real GitHub, not a priority.
The target is [ECOSYSTEM_PLAN.md §4.3](ECOSYSTEM_PLAN.md): a lightweight IDE in LOL Vibe, driven by DeepSeek Harness
(dsh) on the farm's models, no shell tool in the first cut, projects in `DATA_DIR/LOL Studio Projects/`.

## 1. What the probes settled (2026-09-28, 13:25–13:45, a private test farm on 127.0.0.1:4100)

| Question | Answer | So the IDE… |
|---|---|---|
| Can dsh run on Electron's own Node (`ELECTRON_RUN_AS_NODE`)? | **No.** Its native addon accepts Electron 43–45 only; the shell is on 42.5.1 (`node-addon-require-builtin unsupported … fingerprint`). | ships **its own Node** inside the dsh runtime, like the sidecar ships its own Python. dsh and Electron then upgrade independently. |
| Can the app write the profile before dsh's first start? | Yes: a fresh `DSH_HOME` with only `profiles/sdk/cordis.patch.yml` boots in 0.7 s; dsh adds its own files beside it. | writes the patch from the **current farm** before every start (base URL, catalog, context per slot). |
| What does the model see with our patch? | 9 tools: `read write edit glob grep read_image skill todo_write exit_plan_mode`; skills: **only** the ones in our folder. | no shell, jobs, goals, subagents, workflows or web. The owner's `~/.claude` skills no longer leak in (they did in the spike). |
| Does anything leave for the internet? | A 1 s netstat watch over a whole session: **no non-loopback connection**. | also sets `DSH_TELEMETRY_DISABLED=1` and disables every DeepSeek cloud row (telemetry, account, cloud LLM, web search/fetch, session-log upload). |
| Can a new dsh process continue a session? | **No** — `session "…" already exists`; the SDK has no resume and no cancel. | treats a dsh session as **working memory for one process**. The LOL Vibe thread is the durable history; a new session (after Stop, a relaunch, a model or project switch) starts with a short **recap** of the thread. The files on disk are the real state. |
| What does a turn look like? | Per **step**, not per token: `assistant/message` (reasoning, text, tool-call blocks, `usage`, `stopReason`), `tool/call` {name, arguments}, `tool/result` {isError, `meta.diffs: [{path, oldText, newText}]` for edits}, `turn/end` {reason}. | shows the answer (text), a step log in the collapsible reasoning block ("read index.html", "edit index.html ✓"), and the **Changes** view straight from `meta.diffs` — no diff algorithm. |
| max-tokens | The SDK profile reports it as success unless `DSH_MAX_TOKENS_AS_SUCCESS=false`. | sets it false, and a `stopReason: length` step with no text is shown as "the model ran out of room", never as done. |

## 2. Architecture

```
renderer (LOL Vibe)                                    main                                   children
controller.generate()  ── project thread? ──┐
  projects/agent.mjs  (a generation: {done, abort}, │   src/main/studio.ts                     node + dsh --profile sdk
    same shape as net/run's startGeneration) │ IPC  │   - resolve the runtime                  (JSON-RPC on stdio,
  projects/bridge.mjs (the ONE door, rule 10)├─────►│   - write the profile patch               cwd = the project)
  ui/project-panel.mjs (a workbench panel:   │      │   - one runtime per window; restart on
    files · Preview · Code · Changes)        │      │     project/model change; Stop = kill tree
                                             │      │   - project events → compact records
                                             │      │   - a static server per project on
                                             │      │     127.0.0.1 (the Preview + "serve locally")
```

- **Data** (invariant #3): projects in `DATA_DIR/LOL Studio Projects/<project>` (the existing projects API);
  `DSH_HOME` = `DATA_DIR/lol-studio/dsh` (dsh's own session logs); skills in `DATA_DIR/skills` (pinned, each with
  its licence; ponytail seeded on first use). Nothing is stored on the farm.
- **Network**: only the farm's `/v1` (the chat completions dsh makes). The Preview's static server listens on
  127.0.0.1 only; LAN exposure is a later, explicit toggle.
- **Seats**: dsh's requests come from this machine's IP — the same seat as LOL Vibe. A turn holds the foreground
  slot of LOL Vibe's governor, like any reply (the Stop button works the same).
- **Models** (`projects/models.mjs`, pure): a per-model profile {maxTokens, edits: good | weak | unknown}. qwen3.8 and
  nemotron **good** (3/3 on the spike's edit task), ornith unknown-ish (2/3), gemma4 **weak** (1/3; it thinks itself
  out of budget) → the panel says so and suggests a good one. A new model is `unknown` until someone runs
  `docs/research/p5-spike/run.mjs --task edit` on it.

## 3. Slices (each lands with its tests)

**Status (2026-09-28 afternoon):** slices 1–4 are built and tested: the runner (`src/main/studio.ts`, 11 unit tests
over `test/mock-dsh.mjs` and a recorded session, plus one run of the REAL dsh through it: a three.js page in 7 s on
qwen3.8); the agent reply (`projects/agent.mjs` + the one branch in `app/controller.mjs`, 6 unit tests); the Project
panel (`ui/project-panel.mjs`); the harness scenario **k24**. Slice 5 is built too: `shell/dsh/` pins dsh with its
lockfile (594 packages, each hashed), `build-runtime.mjs` makes `dsh-runtime-<platform>-<arch>.tar.gz` (Node 24.14.0
checked against nodejs.org's SHASUMS256 + `npm ci`, minus the unused 188 MB LibreOffice build: **110 MB**, 424 MB
unpacked; the built runtime ran a turn on its own Node), the release job builds and uploads it, and the Project panel
offers **Install the coding agent** (main downloads it from this version's release into `<userData>/dsh-runtime`
with the sidecar's own download + unpack). It reaches clients with the next release; until then, in dev, set
`LOL_DSH_DIR` to `shell/dsh/build/dsh-runtime` (its own Node) or to any folder with dsh installed + `LOL_DSH_NODE`.

1. **Main runner** — `src/main/studio.ts`: runtime resolution (`LOL_DSH_DIR` + `LOL_DSH_NODE` in dev; the downloaded
   runtime later), the profile patch builder (pure, unit-tested), spawn + JSON-RPC, the event projection (pure,
   unit-tested on recorded events), Stop, the per-project static server. IPC `lol:studio:*`, preload `lol.studio`.
2. **The agent generation** — `projects/agent.mjs` + one branch in `controller.generate()`: a thread with
   `studio.projectId` sends its prompt to dsh instead of `/chat/completions`; the recap for a fresh session.
3. **The Project panel** — the first tenant of the workbench (a 0-px column since K1): a project picker (new /
   open), the file tree, **Preview** (the loopback server in a sandboxed frame, reloaded after a turn that changed
   files), **Code** (the Computer's `code-edit.mjs`; save writes through the projects API), **Changes** (the last
   turn's `meta.diffs`).
4. **A mock dsh** for the harness (`test/mock-dsh.mjs`: speaks the SDK protocol, replays scripted steps, edits a
   file) and a scenario: new project → prompt → the file appears, Changes shows the edit, Preview reloads, Stop
   ends the process.
5. **The runtime download** — CI builds `dsh-runtime-<platform>-<arch>.tar.gz` (a pinned Node 24 + `npm ci` from a
   committed lockfile of `@deepseek-ai/dsh@0.1.7-rc.2`) on the client release; the shell fetches it on first use
   (like the sidecar), with progress in the panel.
6. **Later**: git over HTTPS (credentials in `safeStorage`), serve on the LAN (a toggle), the project's own
   `.dsh/skills`, pruning old dsh session logs.

## 4. Not in v1
A shell tool; web fetch/search by the model; subagents; background jobs; editing outside the project folder; the
dsh web UI.
