# DEVLOG — LlmOnLan

A running, dated log of what was built, how it was tested, and decisions taken. Newest first.
Each milestone lands as one (or a few) granular commits; an entry here is written **before** the
commit so the history records that a feature was tested + documented before it was pushed.

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
