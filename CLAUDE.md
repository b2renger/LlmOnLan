# CLAUDE.md — LlmOnLan (LOL)

> **LlmOnLan** (short: **LOL**) is a desktop client + a LAN inference farm. The client
> bundles a **pinned, unmodified Open WebUI** and auto‑connects to the farm so a person on
> the office Wi‑Fi can chat with a local model with zero setup. All data stays on the user's
> machine.
>
> We do **not** hide that the chat UI is Open WebUI. The window chrome is LOL‑branded; the
> Open WebUI surface inside keeps its own name and branding. Think "LlmOnLan, powered by
> Open WebUI." The shell's own surfaces (topbar, settings, connection screen) follow
> **ComfyQ's visual language** for a consistent feel across the two tools.
>
> Reference project (visual + Electron/auto‑update conventions): https://github.com/b2renger/ComfyQ

**The aim** (owner, 2026-11-12): teachers use it, and it shows that a small compute cluster gives a school fast, local AI.

**Status:** released client `v0.2.17` (Open WebUI `0.11.4`) and Farm app `farm-v0.0.53` (2026-11-12). Work is committed
on `main` in this checkout and backed up to the `night` branch; `origin/main` is the last release. What is released, verified and still to check: [docs/context/status.md](docs/context/status.md).

This file is the core every session loads. The detail lives in **context modules** (the table below): read the ones
your task touches before you act, and no others.

---

## The four pieces

1. **`lol`, the farm CLI** (`farm/`, Node): one `lol.config.json` → one serving engine (Ollama by default; llama.cpp or
   vLLM from the panel; an external server from the file) behind LiteLLM and the farm's seat gate, the shared plugins,
   the admin panel, and a UDP beacon so clients find it.
2. **The client shell** (`shell/`, Electron + TypeScript): supervises the Open WebUI sidecar, finds the farm, keeps all
   data in a folder the person chooses, and adds two surfaces of its own: **LOL Vibe** (chat and the coding agent) and
   **the Computer** (the node graph).
3. **Open WebUI**: vendored, version-pinned, **unmodified**.
4. **The Farm app** (`farm-app/`, Electron): the operator's installer and window on the farm.

The whole text: [docs/context/overview.md](docs/context/overview.md).

---

## Prime directive (non‑negotiable invariants)

If a task seems to require breaking one of these, **stop and flag it**.

1. **Open WebUI is vendored, version‑pinned, and UNMODIFIED.** Never edit, patch, or fork its
   source. It is fetched at build time at a pin and bundled as an opaque artifact. **Zero
   Open WebUI source diffs in this repo, ever.**
2. **We keep Open WebUI's branding/attribution.** No logo swap, no `WEBUI_NAME` that hides it.
   This is the explicit product choice *and* a license convenience: the v0.6.6+ branding clause
   only constrains deployments over **50 aggregate users / 30 days**; keeping branding means no
   constraint and no enterprise license at any scale. (https://docs.openwebui.com/license/)
3. **All persistent data stays on the client machine** — under a local `DATA_DIR` the user chooses:
   OWUI's chats, folders, knowledge bases, documents and RAG vectors, LOL Vibe's history, and the
   Computer's graphs, media and projects. The farm is stateless and stores nothing.
4. **We touch Open WebUI ONLY through its public config surface** (env vars + admin REST API). If
   a behavior needs Open WebUI internals, we don't build it.
5. **Upgrading Open WebUI is a version bump, not a merge.** Bump one pin → rebuild the sidecar →
   run smoke tests. **No LOL code changes.** If an upgrade forces a code change in our shell,
   that's a separation defect to redesign, not absorb.

> **Open wording question for the owner (2026-09-27 review; invariant #4 is left verbatim):**
> - #4 says "admin REST API". The only shipped REST writes use OWUI's **user-settings** API, plus the
>   auth check and the user-settings read. The admin API is never used.
>
> **The owner's answer (2026-11-05, [docs/plans/CLOUD_SOURCES_PLAN.md](docs/plans/CLOUD_SOURCES_PLAN.md) §0 item 5):**
> Open WebUI is not touched beyond what exists today, not even by a new REST call: we follow Open WebUI's release
> rhythm, so anything it does not do from its own buttons and its env settings is a layer in our Electron app. The calls
> the contract table lists stay as they are. Invariant #4's words stay as written above; rewording it is the owner's call.

Two more rules with the same weight, each written out in its module:
- **The privacy boundary** ([docs/context/privacy.md](docs/context/privacy.md)): what leaves a person's computer, to
  whom, and what the farm keeps (nothing). A feature that sends or keeps something new changes that file first, with
  the owner's yes.
- **Local only:** inference, document reading, document search and speech never go to a cloud API.

---

## Context modules: read what the task touches

| Working on | Read first |
|---|---|
| Anything, at a session's start | the five last files of [docs/sessions/](docs/sessions/README.md); [docs/plans/README.md](docs/plans/README.md) (the next work, in order) |
| What is released or verified; what a person must still test | [docs/context/status.md](docs/context/status.md), [docs/HUMAN_TESTS.md](docs/HUMAN_TESTS.md) |
| The farm: engines, panel, presets, model storage, plugins, the config, the CLI | [docs/context/farm.md](docs/context/farm.md), then [farm/README.md](farm/README.md) |
| The client shell, Preferences, boot time, LOL Vibe, the IDE's coding agent | [docs/context/client.md](docs/context/client.md) |
| The Computer: boxes, runs, the sandbox, the MCP server, Home Assistant | [docs/context/computer.md](docs/context/computer.md) |
| Anything that touches Open WebUI: its env, its webview, a pin bump | [docs/context/owui-contract.md](docs/context/owui-contract.md), [docs/INTEGRATION_BRIEF.md](docs/INTEGRATION_BRIEF.md) |
| How a client finds and chooses a farm | [docs/context/discovery.md](docs/context/discovery.md) |
| What leaves the computer; anything that sends, logs or stores | [docs/context/privacy.md](docs/context/privacy.md) |
| The shell's look (tokens, radii, status colours) | [docs/context/design.md](docs/context/design.md) |
| The sidecar build, installers, CI, a release, auto-update | [docs/context/release.md](docs/context/release.md) |
| Where a file lives | [docs/context/repo-layout.md](docs/context/repo-layout.md) |
| How a piece was built and tested, by date | [docs/DEVLOG.md](docs/DEVLOG.md) (search it, never read it whole) |
| Capacity measurements and model trials | [docs/spike/RESULTS.md](docs/spike/RESULTS.md) |

A module is true or it is fixed: a change to the code a module describes changes the module in the same commit. A fact
that is in no module and not in the code is not a fact yet.

---

## How we work

### Sessions (owner, 2026-11-12)

The work runs in **sessions** of five hours: by night, 02:00 to 07:00, from a cron on the Claude Code session the owner
leaves open (it dies with that session; the owner asks for it again), and by day when the owner opens one. The thread
the owner and Claude share is [docs/sessions/](docs/sessions/README.md), one dated summary per session.

1. **Start:** read the five last summaries, and any line the owner wrote in them (`> owner:`): it outranks the summary's
   own "Next". Then [docs/plans/README.md](docs/plans/README.md) and `git log` since the last summary.
2. **One objective per session** (owner, 2026-11-12): the last summary's *Next objective*, with its *Done when*, plus
   at most one small side task. Not the whole menu. The menu the objective comes from: look at the code and the latest
   changes; run the tests, and the client and a farm for real (the skill `lol-scratch-farm`); measure; research models,
   engines and harnesses that matter to us; write a plan; build an approved plan; test what was built; prepare a human
   test; update the docs and the in-app help and tutorials. Finished early: the next item of the summary's queue.
3. **End:** write the summary: what was done, with the evidence; what was not, and why; the next objective with its
   *Done when*, its side task and the queue; the questions for the owner. Commit it, and push the backup.
4. **Every fifth session** is an adversarial review of the code, the docs and the in-app documentation and tutorials
   (the skill `lol-review`), in place of building.

**Build only what the owner approved:** code comes from an item of [docs/plans/README.md](docs/plans/README.md) or a
plan whose status line reads `Status: approved by the owner, <date>`. Anything else a session thinks of becomes a plan
or a question in its summary, not code.

**The owner's tests are the bottleneck**, so a session saves the owner's time: each human test it asks for is ready to
run in minutes (the steps written out in HUMAN_TESTS, the files and builds ready, the expected result stated), and it
raises `RELEASE READY` early, for small batches.

**Commits, backup, releases:** a session commits on `main`, and backs it up with exactly
`git push origin main:night`. Never a bare `git push`, never `origin main`, never `--tags` or `--follow-tags`: a push to
`main` starts two CI builds, and a tag builds the installers people update to. The repository is public, so what is
committed is published: no secret, nothing about a person, never a usage report's data. When the unreleased work
(`git log origin/main..main`) is worth a release, the summary **opens** with `RELEASE READY`: what it brings and which
HUMAN_TESTS to run first. The owner tests and says go; only then is `main` pushed and tagged
([docs/context/release.md](docs/context/release.md)).

The skill `lol-session` holds the whole procedure. **Precise before fast:** read the documentation, check the fact in
the code or by running it, and say what was not checked.

### Who does what (owner, 2026-11-12)

| Role | Model | How |
|---|---|---|
| Runs the session, writes the code | Sonnet 5.5 | the session's model (`.claude/settings.json`) |
| Explores, in parallel, read-only | Haiku 5.5 | the subagents `search` (maps a part of the repo), `grep` (finds call sites), `docs` (reads a reference) |
| Advises on the big calls | Opus 5.5 | Claude Code's advisor (`advisorModel`): it reads the whole session |

The night cron runs in the Claude Code session the owner leaves open, on that session's model: **Opus 5.5** since
2026-11-12, the owner's choice, in auto mode. `.claude/settings.json` sets Sonnet for a session started fresh.

**Consult the advisor at three moments, and only these:** before a plan locks; when the same error shows up twice;
before calling a task done. Explorers return facts with `file:line`; the session checks a fact before it builds on it.
Parallel agents beyond the three explorers need the owner's yes for that run. Fable 5.2 (4× Sonnet's price) is not in
the routine; the owner may switch a review session to it.

Small forks (which file, which tool, retry or stop) stay the session's own: inside Claude Code a separate decision model
costs a tool call for each answer, more than the decision. Where a script of ours needs a decision model, it is the
farm's local one, Classify (Laya), never a cloud one.

### What a session never does without the owner

- Push anything but the `night` backup, tag, or release (above).
- Stop, restart or reconfigure the farm people use (the Farm app on this computer, its vLLM in `~/lol-vllm`, its
  config and data), the owner's client and its data folder, the Ollama desktop app, ComfyUI. A session **may** load
  models on the GPU beside the live farm, with clients connected or not (owner 2026-11-12).
- Delete anything outside the session's own scratch folder; work around a refused permission.
- Break or reword a line of the prime directive or the privacy boundary: stop, and write the question in the summary.
- Post to another project (an issue, a pull request, a comment), or send anything to a service the docs do not name.

---

## Conventions & guardrails

**Code by the ponytail ladder** (owner, 2026-09-27; https://github.com/dietrichgebert/ponytail): after
reading the task and tracing the real flow, stop at the first rung that holds — does it need to exist →
already in this codebase → the standard library → a native platform feature → an installed dependency →
one line → only then the minimum that works. Root cause over symptom (fix the shared function once). No
unrequested abstractions, dependencies or boilerplate; deletion over addition; fewest files. Mark a
deliberate ceiling with a `ponytail:` comment naming it and the upgrade path. Never lazy about validation at
trust boundaries, error handling that prevents data loss, security, accessibility, or hardware calibration;
non-trivial logic leaves ONE runnable check.

**Do:** keep first‑party code in `shell/` and `farm/`; treat OWUI as an external product configured from
outside; re‑verify the config surface on each version bump; keep env authoritative every launch
(`ENABLE_PERSISTENT_CONFIG=false` — OWUI's user-settings REST API only for what env can't do: undoing
the old web-search-on default, the date line, and the tool server; never the admin API; no new call into Open WebUI
of any kind: what it does not do from its own buttons and env is built in our Electron app, owner 2026-11-05);
default to local‑only; apply ComfyQ tokens to shell surfaces only.

**Don't:** edit/fork/patch OWUI source; store user data server‑side; send document text anywhere but the
farm's OCR extraction and document search (owner decision 2026-10-08 — the farm keeps nothing and logs no text), or
mix two embedding models in one data folder; rebrand
or hide Open WebUI; inject CSS into the OWUI webview; enable OWUI's built‑in local inference; raise
client worker counts; reimplement features OWUI already has; reuse ComfyQ's multicast port (pick a distinct one).

## Out of scope (prototype)

Modifying/forking Open WebUI; a shared/central knowledge base (needs central storage — conflicts with the
local‑data invariant); custom auth/SSO/multi‑tenant admin; notarization/paid signing; reimplementing chat,
RAG, or model management.
