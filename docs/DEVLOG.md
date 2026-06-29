# DEVLOG — LlmOnLan

A running, dated log of what was built, how it was tested, and decisions taken. Newest first.
Each milestone lands as one (or a few) granular commits; an entry here is written **before** the
commit so the history records that a feature was tested + documented before it was pushed.

---

## 2026-06-29 — M2: the `lol` farm CLI (+ integration research)

**What:** Built the whole farm backend (`farm/`) — a dependency‑light Node CLI that turns one
declarative `lol.config.json` into a running, OpenAI‑compatible, load‑balanced inference farm.
- **Config** ([config.js](../farm/src/config.js)) — a strict `zod` schema with materialized defaults;
  beacon group defaults to `239.255.43.10` (distinct from ComfyQ's `239.255.42.99`, per the spec).
- **LiteLLM generation** ([litellm.js](../farm/src/litellm.js)) — emits `model_list` as
  *models × hosts*, so every Ollama host is a deployment of the same `model_name` →
  LiteLLM's router load‑balances + fails over. Routing is **derived, never hand‑authored**.
- **Ollama client** ([ollama.js](../farm/src/ollama.js)) — `/api/version|tags|ps|pull` over plain
  HTTP, no SDK. `hasModel` tolerates an implicit `:latest`.
- **Commands** — `init`, `up`/`serve`, `down`, `status`, `models ls|add|rm|pull`. `up` runs in the
  foreground and writes `.lol-runtime.json` so `status`/`down` work from another shell; `down` clears
  that file *before* killing so a foreground `up` recognizes an intentional stop and exits 0 quietly.
- **Snapshot** ([snapshot.js](../farm/src/snapshot.js)) — the discovery contract built once
  (shared by the M3 beacon + `/lol/self`), `v:1 { id, name, proxyPort, ips, openaiBaseUrl, models,
  healthy, … }`. The beacon itself is **deferred to M3** per the plan (M2 only logs it).

**Tested — end‑to‑end on the dev box, real inference:**
- `npm test` → 10/10 unit tests (config validation, models×hosts generation, snapshot, helpers).
- `lol init` scaffolds a config in a fresh dir (and refuses to clobber an existing one).
- `lol up` → Ollama detected, `gemma4` present (no pull), LiteLLM config generated, proxy healthy,
  `/v1/models` lists `gemma4`. **`POST /v1/chat/completions` returned a real completion** routed
  LiteLLM → Ollama → gemma4. `lol status` (separate shell) shows the live proxy + loaded model;
  `lol down` stops it cleanly and `up` exits 0.

**Bug fixed (Windows):** LiteLLM crashed on startup with `UnicodeEncodeError` — its box‑drawing
banner can't encode on a cp1252 Windows console. Fix: spawn the proxy with `PYTHONUTF8=1` /
`PYTHONIOENCODING=utf-8` ([proc.js](../farm/src/proc.js)). This is a real, load‑bearing fix for any
Windows operator.

**Research landed:** a multi‑agent web‑research + fact‑check workflow produced
[docs/INTEGRATION_BRIEF.md](INTEGRATION_BRIEF.md). Headline facts the later milestones depend on:
- **Pin `open-webui==0.10.1`** (Python 3.11/3.12 only; run `open-webui serve --host --port` — the
  `PORT` env is *not* honored). Branding kept → license rider imposes nothing at any scale.
- **Config gotcha**: OWUI's `OPENAI_*` are PersistentConfig — env seeds only the *first* boot, then
  the DB wins. Decision for M1: **bake env + `ENABLE_PERSISTENT_CONFIG=false`** so env is always
  authoritative (the kiosk move), and set `ENABLE_OLLAMA_API=false`. Admin REST `POST /openai/config/update`
  exists but still needs an admin token even under `WEBUI_AUTH=false`, and only sticks while persistent
  config is on — so env‑authoritative is simpler and matches invariant #4.

**Decision — beacon group `239.255.43.10:41998`** (UDP) + `httpPort 41997` for the unicast `/lol/self`
fallback, all distinct from ComfyQ so both tools coexist on one LAN.

---

## 2026-06-29 — Scaffold (repo structure + tooling)

**What:** Bootstrapped the empty repo into the layout `CLAUDE.md` prescribes.
- `.gitignore` — excludes `node_modules`, build output, Python venvs, the generated LiteLLM
  config, the `lol.config.json` runtime file (example is kept), and — critically — any local
  `DATA_DIR` / `*.db` / `*.sqlite` so OWUI user data can **never** be committed (invariant #3).
- Root `README.md` — project overview, the three pieces, the prime directive, quick starts.
- `docs/DEVLOG.md` (this file) — the running build log.

**Environment confirmed on the dev box (Windows 11):**
- Node 24.14, npm 11.9 · Ollama 0.30.11 running on `127.0.0.1:11434` with `gemma4:latest` (9.6 GB).
- Python 3.12.10 available (used for LiteLLM + the OWUI sidecar; 3.14 is too new for OWUI).
- `gh` 2.92 authed to `b2renger/LlmOnLan`.

**Decision — work on `main`, granular commits.** This is a greenfield bootstrap, so per the
owner's "do everything in one path" direction the build proceeds on `main` with one tested +
documented commit per milestone (rather than per-feature PRs), so `git log` reads as the
milestone history.

**Tested:** structure only; nothing executable yet.

---
