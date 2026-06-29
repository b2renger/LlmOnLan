<!--
  MACHINE-GENERATED research brief (2026-06-29), produced by a multi-agent
  web-research workflow with an adversarial fact-check pass. It pins down the
  version-specific facts the milestones depend on (OWUI pin + config surface,
  LiteLLM↔Ollama routing, sidecar packaging, electron-builder recipe). Treat the
  "high" confidence rows as actionable and re-verify "medium"/§7 items on the rig.
  This is reference material, not first-party code — see DEVLOG.md for what was
  actually built on top of it.
-->

# LlmOnLan — Integration Brief

**Project:** Electron client that bundles a pinned, UNMODIFIED Open WebUI and connects it to a LAN LiteLLM + Ollama farm.
**Brief date basis:** mid-2026 verified findings. Every "exact value" below carries a confidence + source note. Treat anything tagged **medium** or flagged in §7 as guidance to re-verify on the rig.

---

## 1. Open WebUI pin (version + Python + run command)

| Item | Value |
|---|---|
| **Pin** | `open-webui==0.10.1` (pip package is `open-webui`; import module is `open_webui`, underscore) |
| **Python** | `>= 3.11, < 3.13` — i.e. **3.11 or 3.12 only; 3.13 is NOT supported.** Build/run against **3.11** (safest, best-tested) |
| **Run** | `open-webui serve` (console script). Fallback if not on PATH: `python -m open_webui serve` |
| **Default bind** | host `0.0.0.0`, port `8080` |
| **Override host/port** | CLI flags only: `open-webui serve --host 0.0.0.0 --port 8080`. **The `PORT` env var is NOT honored by `open-webui serve`** — use `--port` |

**Conservative fallback:** v0.10.1 and v0.10.0 both shipped 2026-06-29 (brand-new); v0.10.1 is a single-bug fix on 0.10.0 ("shared-folder read-only chats no longer sign users out"). If you want a release with settling time, the prior stable is **v0.9.6** (2026-06-01). Recommended pin remains **v0.10.1**.

**Licensing — no obligation for this project:** v0.10.1 is BSD-3-Clause + a branding/attribution rider (added in v0.6.6). The rider restricts removing/altering Open WebUI branding above 50 end users / rolling 30 days. **Because LlmOnLan vendors Open WebUI UNMODIFIED with branding intact, the rider imposes no obligation at any scale.** Keep the branding intact and you stay fully compliant.

> Confidence: **high** for all rows. Sources: `releases/tag/v0.10.1`, `blob/v0.10.1/pyproject.toml`, `blob/v0.10.1/backend/open_webui/__init__.py`, `blob/v0.10.1/LICENSE`, `docs.openwebui.com/getting-started/quick-start/`.

---

## 2. OWUI config surface — env seed + admin REST reconcile (the precedence gotcha)

### The core gotcha
`OPENAI_API_BASE_URL(S)` / `OPENAI_API_KEY(S)` are **PersistentConfig (ConfigVar)**. Environment is read **only on the first launch**; thereafter the value is stored in the SQLite `configs` table and **the DB wins** — a single Admin-UI edit pins a stale URL that overrides your env forever after.
> Confidence: **high**. Source: `docs.openwebui.com/reference/env-configuration/` (PersistentConfig + AIOHTTP recovery notes), corroborated in `config.py`.

### Three levers controlling DB-vs-env precedence

| Var | Default | Effect |
|---|---|---|
| `ENABLE_PERSISTENT_CONFIG` | `true` | **`false` = env is always authoritative.** DB never loaded for ConfigVar settings; UI edits apply for the session but are lost on restart. **This is the kiosk/lab move.** |
| `RESET_CONFIG_ON_START` | `false` | One-shot: on next startup, reset persisted config back to env values, then revert. Use once to clear a bad UI-saved URL. |
| (do neither) | — | DB wins after first boot — the gotcha. |
> Confidence: **high**. Source: `docs.openwebui.com/reference/env-configuration/`.

### Env vars to point at the external endpoint (LiteLLM)

| Var | Type / default | Note |
|---|---|---|
| `ENABLE_OPENAI_API` | bool, `True` | master enable (ConfigVar) |
| `OPENAI_API_BASE_URL` | str, `https://api.openai.com/v1` | singular base URL (ConfigVar) |
| `OPENAI_API_KEY` | str | singular key (ConfigVar) |
| `OPENAI_API_BASE_URLS` | str, `;`-separated | plural / load-balanced (ConfigVar) — admin REST reads/writes this list |
| `OPENAI_API_KEYS` | str, `;`-separated | plural keys, positionally paired |
| `ENABLE_OLLAMA_API` | bool, `True` | **set `false`** — OWUI talks only to LiteLLM, never directly to Ollama |

**CRITICAL — set ONE pair only.** Do **not** set both singular and plural OpenAI vars. A config.py bug (issues #19684/#19683) can unconditionally reset the singular `OPENAI_API_BASE_URL` back to the OpenAI default and silently swallow key↔URL mapping errors. For a single LiteLLM endpoint, set only `OPENAI_API_BASE_URL` + `OPENAI_API_KEY` **or** only the plural pair — never both.
> Confidence: **high** for var names/types; **medium** for the precedence bug (from issue reports, not docs). Source: `docs.openwebui.com/reference/env-configuration/`, issues #19684/#19683.

### `*_API_CONFIGS` cannot be set from env
`OPENAI_API_CONFIGS` / `OLLAMA_API_CONFIGS` (per-connection model restrictions, naming, tags) **always initialize to `{}` and are NOT parsed from env** (issue #19017, closed not-planned; base URL + key DO work from env). Set per-connection model restrictions only via the **admin REST API** or Admin UI.
> Confidence: **high**. Source: `issues/19017`, `config.py`.

### Admin REST API — reconcile the connection each launch

| Method + path | Purpose |
|---|---|
| `GET /openai/config` | read `{ ENABLE_OPENAI_API, OPENAI_API_BASE_URLS[], OPENAI_API_KEYS[], OPENAI_API_CONFIGS{} }` |
| `POST /openai/config/update` | write same shape (keys list padded to base-URLs length) |
| `GET /ollama/config`, `POST /ollama/config/update` | Ollama equivalents (unused if `ENABLE_OLLAMA_API=false`) |

> Paths are under the `/openai` (and `/ollama`) prefix — **NOT** `/api/v1/...`.
> **Auth:** both require `get_admin_user` — a token/cookie for a user whose `role == 'admin'`. **`WEBUI_AUTH=false` does NOT make these token-free** — `get_current_user` still raises 401 with no `Authorization: Bearer <token>` header or `token` cookie. Send the admin's JWT (from signin) or an API key (Settings > Account).
> A value written here **persists to the DB and beats env on next start** (the same gotcha) — unless `ENABLE_PERSISTENT_CONFIG=false`, in which case a REST/UI write applies for the session and reverts on restart.
> Confidence: **high**. Source: `routers/openai.py`, `utils/auth.py`.

### Recommended strategy for LlmOnLan
1. **Bake the endpoint into env AND set `ENABLE_PERSISTENT_CONFIG=false`** so env is authoritative on every launch and no UI edit can pin a stale URL.
2. If you ever need to reconcile/override at runtime without a restart, drive `POST /openai/config/update` with an admin token — but understand it's session-only while `ENABLE_PERSISTENT_CONFIG=false`.
3. `WEBUI_AUTH=false` (kiosk/single-user) auto-provisions `admin@localhost` / password `admin` on first signin (fresh install only) and mints the JWT + `token` cookie you'd use for the REST API.

---

## 3. OWUI data-locality + privacy env

| Var | Value | Effect |
|---|---|---|
| `DATA_DIR` | `./data` (default) | **Single base dir for ALL local data** — uploads, cache, vector DB, `config.json`, SQLite DB, embedding-model cache. Put on a persistent volume. |
| `WEBUI_SECRET_KEY` | (set explicitly) | Signs JWTs + encrypts data at rest. `open-webui serve` auto-generates + persists `.webui_secret_key` in CWD; **set it explicitly to a stable value** so tokens survive app re-creation. `openssl rand -hex 32`. |
| `RAG_EMBEDDING_ENGINE` | **leave empty** | Empty = local SentenceTransformers (in-process). Do NOT set to `ollama`/`openai`. |
| `RAG_EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` (default) | Local MiniLM; downloaded from HuggingFace on first use unless cached. |
| `OFFLINE_MODE` | `true` (optional) | Sets `HF_HUB_OFFLINE=1` — first-party offline switch. **Requires a pre-seeded HF cache** under `DATA_DIR` or first RAG use fails. |
| `WEBUI_AUTH` | `false` (optional, kiosk) | Disables login; auto-creates `admin@localhost`/`admin` on fresh install only. |

**Telemetry off** (consumed by *dependencies*, not OWUI's own code — but correct + harmless to set):
- `ANONYMIZED_TELEMETRY=false` — ChromaDB/PostHog (OWUI's default vector DB). May be a no-op on Chroma ≥1.5.4.
- `DO_NOT_TRACK=true` — cross-vendor convention (HF/Scarf).
- `SCARF_NO_ANALYTICS=true` — Scarf download pixel.
> OWUI's own offline switch is `OFFLINE_MODE`; the three telemetry vars are not in the OWUI env reference but work via dependencies.
> Confidence: **high** (data/privacy rows). Source: `docs.openwebui.com/reference/env-configuration/`, `config.py`, `env.py`, `chroma-core/docs/telemetry.md`.

### Synthesized local-only env recipe
```
ENABLE_OPENAI_API=true
OPENAI_API_BASE_URL=http://<proxy-host>:4000/v1      # set ONLY this pair (not the plural)
OPENAI_API_KEY=sk-1234
ENABLE_OLLAMA_API=false
ENABLE_PERSISTENT_CONFIG=false                       # env stays authoritative
# (or RESET_CONFIG_ON_START=true once to clear a stale DB URL, then remove)
RAG_EMBEDDING_ENGINE=                                # empty = local MiniLM
WEBUI_SECRET_KEY=<openssl rand -hex 32>
DATA_DIR=/persistent/volume/data
ANONYMIZED_TELEMETRY=false
DO_NOT_TRACK=true
SCARF_NO_ANALYTICS=true
# OFFLINE_MODE=true   # only with a pre-seeded HF cache
```
> Confidence: **medium** (synthesis; each component independently **high**).

---

## 4. LiteLLM config.yaml for N Ollama hosts (load-balance + failover)

### Model entry shape
- `model_name` = client-facing alias (what OWUI requests).
- `litellm_params.model` = `ollama_chat/<model>` (hits Ollama `/api/chat`, **recommended** over `ollama/<model>` which hits `/api/generate`).
- `litellm_params.api_base` = `http://<host>:11434` — **required per entry for remote hosts** (the localhost doc snippet omits it only because it relies on the `:11434` default).
- **Same `model_name` across multiple entries → automatic load-balancing + failover** via the built-in router.

### Complete working config (two hosts, one logical model)
```yaml
model_list:
  - model_name: "gemma4:12b"
    litellm_params:
      model: "ollama_chat/gemma4:12b"
      api_base: "http://hostA:11434"
  - model_name: "gemma4:12b"
    litellm_params:
      model: "ollama_chat/gemma4:12b"
      api_base: "http://hostB:11434"

router_settings:
  routing_strategy: simple-shuffle   # DEFAULT + recommended
  num_retries: 2                     # retried on ALTERNATE deployments
  allowed_fails: 3                   # default 3; fails/min before cooldown
  cooldown_time: 30                  # default 5s; secs a dead host stays out

general_settings:
  master_key: sk-1234                # optional; omit for no-auth
```
**Failover semantics:** a dead Ollama host is retried-around (`num_retries`), then cooled down (`allowed_fails` over `cooldown_time`) so traffic shifts to the healthy host. To scale to N hosts, add more identical-`model_name` entries.
> Confidence: **high**. Sources: `docs.litellm.ai/docs/providers/ollama`, `/docs/proxy/load_balancing`, `/docs/routing`.

### Install + run + Python
- **Install:** `uv tool install 'litellm[proxy]'` (current docs form) — equivalently `pip install 'litellm[proxy]'`.
- **Run:** `litellm --config config.yaml --port 4000` (defaults: `--host 0.0.0.0`, `--port 4000`).
- **Python:** **`>=3.10, <3.14`** (litellm v1.91.0) — i.e. 3.10–3.13. **The earlier "≥3.9,<4.0" is REFUTED** (outdated).
> Confidence: **high**. Sources: `/docs/proxy/quick_start`, `/docs/proxy/cli`, `BerriAI/litellm/main/pyproject.toml`.

### Auth + endpoints
- **Auth:** proxy is **unauthenticated by default**. Set `general_settings.master_key` (or `LITELLM_MASTER_KEY` env) — **must start with `sk-`** — to require it. OWUI sends it as `Authorization: Bearer <key>`. If no master_key, any/empty key works (not recommended for production).
- **OWUI points at:** `http://<proxy-host>:4000/v1` (the bare `:4000` also works with OpenAI SDKs); key = the `master_key`.
- **OpenAI-compatible routes:** `GET /v1/models`, `POST /v1/chat/completions` (also without `/v1`), `POST /completions`, `POST /embeddings`.
- **Health probes:** `/health/readiness` and `/health/liveliness` are **UNPROTECTED** — use these for Electron/orchestration probes. `/health` makes a real LLM call per model and **requires auth** (good for confirming both Ollama hosts are reachable: returns `healthy_endpoints`/`unhealthy_endpoints`).
> Confidence: **high**. Sources: `/docs/proxy/virtual_keys`, `/docs/proxy/health`.

---

## 5. Sidecar packaging recommendation (single best approach for a prototype)

**Topology:** two Python sidecars under one Electron host, both bound to **loopback**:
- Open WebUI — `127.0.0.1:8080`
- LiteLLM proxy — `127.0.0.1:4000` (bind loopback-only to keep it off the LAN)
- Wire OWUI → `http://127.0.0.1:4000/v1` via `OPENAI_API_BASE_URL`.
- The LAN-facing Ollama farm is reached only by LiteLLM, not by the Electron host directly.
> Confidence: **medium** (integration design, not a single documented reference; constituent facts all **high**).

### Recommended approach: **PyInstaller → `extraResources` → spawn as child process**
1. **PyInstaller** each Python server (Open WebUI, LiteLLM) into a standalone executable.
2. **electron-builder `extraResources`** copies the binaries **outside `app.asar`** into the resources dir (`Contents/Resources` on mac, `resources/` on win/linux). Reference at runtime via `path.join(process.resourcesPath, '<binary>')`. **A binary cannot be exec'd while packed inside `app.asar`** — `extraResources` (or `asarUnpack`) is mandatory.
3. **Spawn at app startup** via Node `child_process` (`execFile` the packaged binary, not `python script.py`).

**Rationale:** This is the standard community pattern, keeps the Python runtime fully bundled (no system Python dependency on lab machines), and `extraResources` is the electron-builder-recommended home for large sidecar executables. Both `extraResources` and `asarUnpack` ship inside the installer/zip, so **auto-update replaces the sidecar binaries too**.

**Gotchas:**
- **macOS** PyInstaller-spawned binaries can return a null/unkillable handle — **plan a graceful sidecar shutdown** on app quit. On mac you may also need an afterPack `codesign --force --sign - <binary>` so hardened-runtime/Gatekeeper peers don't block the sidecar.
- Set OWUI's sidecar env at spawn time **and** keep `ENABLE_PERSISTENT_CONFIG=false` (§2) so the env-driven endpoint isn't "ignored" after first run.
> Confidence: **high** (pattern + `extraResources` mechanics). Sources: `electron.build/docs/contents/`, `electron/electron#17074`.

> **Note for this codebase:** the existing `desktop/` workspace (ComfyQ Discovery) uses a **vanilla HTML/JS renderer, no bundler**. LlmOnLan is a separate Electron app; the PyInstaller+sidecar packaging above is new surface for it and not present in the ComfyQ desktop app.

---

## 6. electron-builder / electron-updater recipe — deltas vs the CLAUDE.md spec

The CLAUDE.md mentions Electron **^42** (good) and treats `electron-builder` as an ad-hoc-only dep. For LlmOnLan's self-update via GitHub Releases (no paid signing), apply these corrections:

| Item | CLAUDE.md / common assumption | **Corrected value (mid-2026)** | Conf. |
|---|---|---|---|
| **electron-builder** | ^25 (or "ad-hoc only") | **^26 (26.15.x)** — current stable; pairs in lockstep with updater ^6. Stays a **devDependency**. | high |
| **electron-updater** | (not specified) | **^6 (6.8.9)** — **MUST be a real runtime dependency** (packed into the app), not dev. | high |
| **electron** | ^42 | **^42 (42.5.1)** bundles Node 22 — keep. | high |
| **Node floor** | — | electron-builder 26.x `engines.node` = `>=14` — **runs fine on Node 22**. The `>=22.12.0` floor + native-ESM break is **v27-only**; **avoid v27-alpha** for a lab tool. | high |

### GitHub Releases self-update recipe (no paid code-signing)
- **Publish provider:** `build.publish = { provider:'github', owner, repo, releaseType:'release'|'prerelease'|'draft' }`. electron-builder **creates a DRAFT by default**; **the updater only sees PUBLISHED (non-draft, non-prerelease) releases** (`/releases/latest`). Canonical flow: publish as draft → QA → flip to published. Set `releaseType:'release'` for CI to publish immediately.
- **CI:** matrix `[windows-latest, macos-latest, ubuntu-latest]`, each runs `npx electron-builder --publish always` with `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. **MUST grant `permissions: contents: write`** or release-create 403s even on a public repo.
- **Windows (NSIS):** **`perMachine:false`** (per-user, no admin) → electron-updater applies updates **silently, no UAC**. This is the load-bearing setting. No cert needed for updates; unsigned `.exe` triggers SmartScreen "Unknown publisher" on **first** download only (in-app updates don't re-trigger it).
- **Linux:** **AppImage** is the auto-updatable target (generates `latest-linux.yml`, no signing). Caveat: the AppImage must be **launched as an AppImage** or the updater logs "APPIMAGE env is not defined".
- **macOS — the one hard signing constraint:**
  - **Auto-update REQUIRES the app be signed.** A completely unsigned mac app **fails to auto-update** (Squirrel.Mac validates the update's signature against the running app). **Ad-hoc signing is the weakest link** — it works in practice for self-built self-updating but is not robustly documented; **validate on the actual target Macs.**
  - Require **both `dmg` AND `zip` mac targets** (zip feeds Squirrel.Mac + generates `latest-mac.yml`; dmg alone breaks auto-update). dmg+zip is the default set.
  - Ad-hoc config: `mac.identity:'-'` (or `null` to skip) + **`hardenedRuntime:false`** (ad-hoc + hardened runtime's library validation rejects the pre-signed Electron framework). Set `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI so a stray keychain cert doesn't hijack signing. Add an afterPack `codesign --force --deep --sign - App.app`.
  - **Build BOTH mac arches (arm64+x64) in the single `macos-latest` job** — separate jobs each emit `latest-mac.yml` and the last writer overwrites the other (#5592/#7975).
  - Gatekeeper first-launch warning is unavoidable without paid notarization (users right-click→Open or `xattr -dr com.apple.quarantine`) — only the first launch, not updates.

> Confidence: **high** for versions/engines/CI/win/linux/mac-target rules; **medium** for ad-hoc mac auto-update reliability and the NSIS install-path wording. Sources: npm registry (live), `electron.build/docs/mac`, `/nsis.html`, `/docs/features/auto-update/`, `/docs/features/github-actions/`, `/docs/migration/v26-to-v27/`, GitHub REST releases docs.

---

## 7. Open questions / verify empirically on the rig

1. **OWUI 0.10.x is brand-new (shipped 2026-06-29).** Decide v0.10.1 (latest) vs v0.9.6 (settled fallback). Re-check `docs.openwebui.com/license` wording at deploy time.
2. **`--port` vs `PORT` env** for `open-webui serve` — confirm against `backend/open_webui/__init__.py` at your exact pinned tag.
3. **Singular vs plural OpenAI env precedence** — set only one pair; verify the config.py reset bug (#19684/#19683) behavior on the pinned release.
4. **`OPENAI_API_CONFIGS` env-parsing** — still `{}`-only in current config.py; confirm a later release hasn't added parsing on your pin (else use REST/UI for per-connection model limits).
5. **`/v1` suffix on the OWUI base URL** — confirm OWUI's URL normalization for your pin; the `/v1`-suffixed base is the safe convention.
6. **Full air-gap RAG** — confirm `OFFLINE_MODE=true` + a pre-seeded HF/sentence-transformers cache path under `DATA_DIR`; exact cache subpath not fully verified.
7. **`ANONYMIZED_TELEMETRY` effectiveness** — may be a no-op on Chroma ≥1.5.4; confirm bundled Chroma version.
8. **LiteLLM Python floor** — `>=3.10,<3.14` for v1.91.0; the floor may rise — confirm the version you pin.
9. **macOS ad-hoc auto-update** — the recipe's weakest link; validate end-to-end on real target Macs. Note the v26.0.13+ ad-hoc **Camera/Microphone regression (#9529)** if LlmOnLan ever touches AV devices (it likely doesn't).
10. **Windows NSIS install path / no-UAC** — `%LocalAppData%\Programs\<productName>` is clearest for `oneClick:false`+`perMachine:false`; verify the exact folder + silent-update behavior on a real Windows build. The no-UAC guarantee rides on `perMachine:false`.
11. **macOS dual-job `latest-mac.yml` overwrite** — confirm CI builds both mac arches in one `macos-latest` job, and that the afterPack `codesign` step doesn't run on Linux/Windows runners.