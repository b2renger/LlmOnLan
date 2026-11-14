# The Open WebUI integration contract

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

## The integration contract (the entire OWUI coupling)

| Direction | Mechanism | Notes |
|---|---|---|
| Lifecycle | Shell spawns the OWUI sidecar as a child process and supervises it. | Shell = process manager + window. |
| Config → OWUI | Env vars at **every** launch, made authoritative by `ENABLE_PERSISTENT_CONFIG=false` — repointing the farm restarts the sidecar with new env. **Three exceptions**, all written from the authed webview via OWUI's user‑settings API `POST /api/v1/users/user/settings/update`: switching web search back off, once, on a profile a client up to v0.2.7 turned on (`ui.webSearch` 'always' → null, only while its `lolWebSearchSeeded` marker is there and the value is still 'always'; marked `lolWebSearchUnseeded`) — web search is off by default; the globe button turns it on for a chat; the **date line** (2026‑10‑05: the model otherwise believes it is 2025): `ui.system` = `Today is {{CURRENT_WEEKDAY}} {{CURRENT_DATE}}.`, once per profile and only when the person's system prompt is empty (marked `lolDateLineSeeded` either way, so a prompt they wrote or emptied is never touched; OWUI fills the variables at each message, on chat requests only, not title generation); and the opt‑in Blender tool server (`ui.toolServers` + `ui.tools`). None has a usable env (`DEFAULT_MODEL_PARAMS.system` never reaches a farm model's messages; 0.11's `DEFAULT_INTERFACE_SETTINGS` is missing from 0.10 and comes back when a person empties it). | See gotchas below. |
| Data | `DATA_DIR` → the user's chosen local folder; the vectors are kept there whoever computes them (the farm's document search once the folder adopted it, else OWUI's MiniLM on this computer); telemetry off. | Enforces invariant #3. |
| Net out of OWUI | Chat completions to the farm endpoint; plus, when the farm advertises them: web searches, Kokoro TTS requests, uploaded‑file bytes to the farm OCR extractor, and (2026-10-09) the microphone's and Call mode's recordings to the farm's speech to text (written down and dropped there; OWUI keeps its copy in `DATA_DIR/cache/audio`, as with its local engine); and MCP tool calls to the Computer on 127.0.0.1 (this machine) — which answers the home tools against the Home Assistant a person linked. **Web search v2** (2026-10-05): OWUI's searches go to this app's main on 127.0.0.1 (`POST /web/search` on the MCP listener, OWUI's external-search env); main sends the query to the farm's SearXNG and itself reads the top pages of each search — up to 6 automatic GETs, public internet only (`webSearch.ts` through `io.ts`) — instead of OWUI fetching only the pages the model picks; a page the model still fetches itself (`fetch_url`) is OWUI's own GET. That is native tool calling, OWUI's default; a chat set to Legacy function calling gets main's results too, but OWUI then loads those pages itself (its web loader). When that port is taken, OWUI queries SearXNG directly, as before. **Document search** (2026-10-08): once the data folder adopted the farm's contract, the text of each piece of an uploaded document, and of a search, goes to the farm's document search (`RAG_OPENAI_API_BASE_URL`, its own port and key) and the vectors come back. | The vectors are stored only in DATA_DIR; the farm keeps no text and no vector. |
| Webview | The renderer reads the OWUI origin's `localStorage.token`, validates it with `GET /api/v1/auths/` (drop + reload, ≤4 tries) before revealing the webview, and reads the user's settings once per session to undo the old web‑search seed and write the date line (a failed read writes nothing); a page that loaded while the farm in use was not answering is reloaded once, 500 ms after that farm answers (`reloadIfFarmBack`: OWUI reads the model list only as its page loads, measured on 0.11.4; re-check on a pin bump); the `persist:owui` partition is granted mic/camera/clipboard only, and only to the sidecar's own origin; a link Open WebUI opens in a new window (a citation, a search's source, a link in a reply) goes to the system browser, except Open WebUI's own pages (a file it shows), which open in an app window where they are signed in (both 2026-11-05, v0.2.16: `keepOwuiLinks`, `util.ts` `sameOrigin`). | `renderer/app.js`, `src/main/index.ts`. |
| Hugging Face cache | Before each start of a data folder still on MiniLM (none once it indexes on the farm), main repairs a half or damaged MiniLM in huggingface_hub's cache, never OWUI's own files. `repairMiniLm` removes the hub's file list and dangling links, and the snapshots only if the model is still half there; the blobs always stay. While MiniLM is not on disk, main also sends huggingface.co one HEAD (3 s) to choose `HF_HUB_OFFLINE` for that launch. "Whole" (`hfModelState`) copies huggingface_hub 1.33's local lookup and the files MiniLM's loader reads: re-check both on every pin bump. | `configBridge.ts`, `sidecar.ts`. |
| Everything else | None. OWUI is a black box. | No DB poking, no template/CSS edits, no internal imports. |

### Verified OWUI config surface (re‑verify per pinned version; authoritative list = `shell/src/main/configBridge.ts`)

Connection: `OPENAI_API_BASE_URL` + `OPENAI_API_KEY` (the farm is OpenAI‑compatible via LiteLLM;
`ENABLE_OLLAMA_API=false` so OWUI never talks to Ollama directly). The exact env the shell sets
(values from `configBridge.ts`):

- **Always:** `DATA_DIR`=<chosen, default `<userData>/owui-data`> · `WEBUI_SECRET_KEY`=<hex generated once
  into `<userData>/.webui-secret-key`> · `WEBUI_AUTH=false` · `ENABLE_PERSISTENT_CONFIG=false` ·
  `ENABLE_VERSION_UPDATE_CHECK=false` · `ENABLE_OLLAMA_API=false` · `RAG_FULL_CONTEXT` (**adaptive**:
  `'true'` — whole‑document answers — when the farm's `backend.contextPerSlot` ≥ 24576 or is not advertised,
  else `'false'`; full injection produced hard ContextWindowExceededErrors on small‑context farms) ·
  `RAG_TOP_K=8` (always set; read only in retrieval mode) · `ENABLE_LOCAL_WEB_FETCH=true` (OWUI's SSRF guard
  otherwise refuses attaching any LAN/intranet page — matrix‑verified) · `ENABLE_RETRIEVAL_QUERY_GENERATION=false`
  (with files attached OWUI otherwise runs a hidden extra LLM call whose output full‑context mode never uses;
  `ENABLE_SEARCH_QUERY_GENERATION` stays on) · `DEFAULT_MODEL_METADATA={"capabilities":{"vision":true}}`
  (+ `"web_search":true` with a farm SearXNG) · `AUDIO_STT_ENGINE=''` + `WHISPER_MODEL=base` (local STT, unless
  the farm advertises speech to text, below) · `AUDIO_TTS_SPLIT_ON=punctuation` (OWUI's default, restated: Call mode
  speaks a streamed reply sentence by sentence) ·
  `AUDIO_TTS_ENGINE=''` · the **TTFT trio** `ENABLE_FOLLOW_UP_GENERATION`/`ENABLE_TAGS_GENERATION`/
  `ENABLE_AUTOCOMPLETE_GENERATION` = `false` (OWUI's background calls would otherwise queue ahead of the user
  on llama‑server's single slot; title generation stays ON) · `TASK_MODEL_PARAMS={"chat_template_kwargs":
  {"enable_thinking":false},"think":false,"max_tokens":1000}` (owner decision 9, 2026‑10‑04: title and
  web‑search‑query generation answer without thinking — OWUI 0.11 copies it onto those requests; `max_tokens`
  restates the title default it would otherwise drop; chats untouched; 0.10.x ignores it — the Computer's
  lists, JSON, agent steps and code answers (an Instruction with a code kind, owner 2026‑11‑14) send the same pair unless a person ticks the canvas toolbar's **Think all**
  box, `pref:computeThink`, default `DEFAULT_THINK` = off, MCP runs included; its yes/no decisions, Condition
  and Filter, think either way, `THINKING_TASKS`, owner 2026‑10‑05 from a measurement) · `DEFAULT_LOCALE=en-US`
  (+ Chromium `--lang en-US`) · `ANONYMIZED_TELEMETRY=false` · `DO_NOT_TRACK=true` · `SCARF_NO_ANALYTICS=true` ·
  `RAG_EMBEDDING_MODEL_AUTO_UPDATE=false` (no per-boot huggingface.co revision check; a missing MiniLM is still
  downloaded, and a half-downloaded one is repaired before the start so it is too) · `HF_HUB_OFFLINE=1` when the
  models test as cached (every needed file in the snapshot `refs/main` names), else `HF_HUB_ETAG_TIMEOUT=2` —
  plus, per launch and outside `buildSidecarEnv` (so `repoint`'s env comparison never sees it), `HF_HUB_OFFLINE=1`
  when MiniLM is not on disk, no proxy is set in the environment (`HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`, either
  case), and huggingface.co does not answer a 3 s HEAD sent through Electron's `net.fetch` (the system proxy);
  `HF_HUB_ETAG_TIMEOUT=2` stays set beside it. A data folder that indexes on the farm needs only whisper-base cached
  for `HF_HUB_OFFLINE=1`, and gets no MiniLM repair and no HEAD.
- **Document search** (when the data folder's contract, `DATA_DIR/lol-embedding.json`, or the farm's advertised
  `embed.contract` is one this client knows — `configBridge.ts` `EMBEDDING_CONTRACTS`): `RAG_EMBEDDING_ENGINE=openai` ·
  `RAG_EMBEDDING_MODEL=embeddinggemma-2` · `RAG_OPENAI_API_BASE_URL=<embed.url>/v1` (NEVER unset: OWUI then falls back
  to the chat address) · `RAG_OPENAI_API_KEY=<embed key>` (fetched through the farm password on a keyed farm) ·
  `RAG_EMBEDDING_QUERY_PREFIX="task: search result | query: "` · `RAG_EMBEDDING_CONTENT_PREFIX="title: none | text: "`
  (OWUI 0.11.4 prepends them; no field name) · `RAG_EMBEDDING_BATCH_SIZE=32` · `RAG_EMBEDDING_CONCURRENT_REQUESTS=2` ·
  `RAG_EMBEDDING_TIMEOUT=300`. A folder with a contract on a farm that does not offer it: the same, with
  `RAG_OPENAI_API_BASE_URL=http://127.0.0.1:0/v1` (port 0: nothing listens, an upload fails at once) and
  `RAG_OPENAI_API_KEY=sk-lol-none`. The env changes only with the farm's service or the folder's marker.
- **With a farm:** `ENABLE_OPENAI_API=true` · `OPENAI_API_BASE_URL=http://<host we reached it at>:<proxyPort>/v1`
  · `OPENAI_API_KEY`=<farm password> or `sk-lol-lan` · `DEFAULT_MODELS`=<the farm's default id, when listed>.
  **Without:** `ENABLE_OPENAI_API=false` (a no‑farm boot must not fall back to api.openai.com).
- **SearXNG** (when advertised): `ENABLE_WEB_SEARCH=true` · `WEB_SEARCH_RESULT_COUNT=5` ·
  `WEB_SEARCH_CONCURRENT_REQUESTS=10` · `WEB_FETCH_MAX_CONTENT_LENGTH=12000`; then, while the MCP listener is up
  (web search v2, 2026-10-05): `WEB_SEARCH_ENGINE=external` · `EXTERNAL_WEB_SEARCH_URL=http://127.0.0.1:41995/web/search`
  · `EXTERNAL_WEB_SEARCH_API_KEY`=<per-install mcpToken>; else `WEB_SEARCH_ENGINE=searxng` ·
  `SEARXNG_QUERY_URL=<url>/search?q=<query>` · `SEARXNG_LANGUAGE=auto`. No external page loader
  (`WEB_LOADER_ENGINE` stays unset): attaching a LAN page keeps working through `ENABLE_LOCAL_WEB_FETCH`.
- **Kokoro** (when advertised): `AUDIO_TTS_ENGINE=openai` · `AUDIO_TTS_OPENAI_API_BASE_URL=<ttsUrl>` ·
  `AUDIO_TTS_OPENAI_API_KEY=sk-lol-tts` · `AUDIO_TTS_MODEL=<ttsModel|kokoro>` · `AUDIO_TTS_VOICE=<ttsVoice|af_heart>`.
- **Speech to text** (when advertised with a key, 2026-10-09): `AUDIO_STT_ENGINE=openai` ·
  `AUDIO_STT_OPENAI_API_BASE_URL=<stt.url>/v1` (OWUI appends `/audio/transcriptions` and trims no slash) ·
  `AUDIO_STT_OPENAI_API_KEY=<stt.key>` (fetched through the farm password on a keyed farm) ·
  `AUDIO_STT_MODEL=<stt.model|whisper-1>`. OWUI's Call mode (0.11.4, unmodified) then does the voice mode: the
  browser ends a phrase after 2 s of silence (hard-coded in its frontend), the recording is written down on the farm,
  the reply streams and each sentence goes to Kokoro as soon as it is complete; a person can interrupt by speaking
  only with OWUI's own setting *Allow voice interruption in call* (off by default).
- **OCR** (when advertised): `CONTENT_EXTRACTION_ENGINE=external` · `EXTERNAL_DOCUMENT_LOADER_URL=<extract.url>`
  · `EXTERNAL_DOCUMENT_LOADER_API_KEY=<extract.key>` (the key fetched through the farm password on a keyed farm;
  `sk-lol-ocr` when there is none, because OWUI's loader needs a non-empty key). The URL is sent without trailing slashes.
- **The Computer's MCP server** (2026-09-27, when its port is free): `TOOL_SERVER_CONNECTIONS=[{type:"mcp",
  url:"http://127.0.0.1:41995/mcp", auth_type:"bearer", key:<per-install mcpToken>, config:{enable:true},
  info:{id:"lol-computer", name:"LlmOnLan Computer", description:"Build and run graphs on the LlmOnLan Computer, and write prompts for ComfyQ's image, video and audio models (this computer only)."}}]`
  — OWUI 0.11.4's own tool-server setting (config.py), no OWUI change. Set once at boot, before the first spawn, so it
  never makes `repoint`'s env differ (the description's change of 2026-11-02 reaches OWUI at the first start after the update, no extra restart).
- The supervisor adds `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8` and otherwise inherits the shell's environment.

- **Gotcha #1 — persisted URLs beat env.** Connection URLs saved via the admin UI go to OWUI's DB
  and **take precedence over env on later starts.** The shipped strategy: `ENABLE_PERSISTENT_CONFIG=false`
  — env is authoritative on **every** launch, so repointing the farm is just a sidecar restart with new
  env, and no stale persisted URL can win. (OWUI's admin REST API is deliberately NOT used — it's
  session‑only while persistence is off. The three shipped writes all go to the user‑settings API
  `POST /api/v1/users/user/settings/update` from the authed webview: the one‑time undo of the old web‑search‑on
  default, the one‑time date line in an empty system prompt, and the opt‑in Blender tool server.) Ref: https://docs.openwebui.com/reference/env-configuration/
- **Gotcha #2 — JSON config env.** Open WebUI 0.10.1 did not parse `OPENAI_API_CONFIGS`/`OLLAMA_API_CONFIGS` from
  env (open‑webui#19017); the pinned 0.11.4 parses both (its config.py; re-check on a pin bump). The shell still seeds
  the connection with the simple `*_BASE_URL(S)` env and sets no `*_API_CONFIGS`.

Data locality:
- `DATA_DIR` → user‑chosen local folder (all persistent data lives here: OWUI's, and — in its `lol-client`
  subfolder, the main window's Chromium session — LOL Vibe's history and the Computer's graphs and media;
  File-box outputs in `LOL Studio Projects/`).
- **Document search: the farm computes the vectors, the laptop keeps them** (owner decision 2026-10-08, replacing
  "keep default local embeddings"). A document's text MAY be sent to the farm to be turned into vectors: the farm's
  document search (EmbeddingGemma 2, `farm/src/embed.js`) keeps nothing and logs no text, and the vectors are stored in
  `DATA_DIR` as before. One model per data folder, for good (`DATA_DIR/lol-embedding.json`, written the first time
  the folder meets a farm offering a contract this client knows): vectors of two models cannot be searched together,
  so a folder that adopted the farm's model never falls back to MiniLM (an upload fails on a farm without it, with a
  toast). Until then a folder stays on OWUI's in‑process default (`all-MiniLM-L6-v2`, on this computer), cached in
  the default HF_HOME — `~/.cache/huggingface`, deliberately NOT under `DATA_DIR` so a data‑folder move never
  re‑downloads it; `SENTENCE_TRANSFORMERS_HOME`, `HF_HUB_CACHE`, `HF_HOME` or `XDG_CACHE_HOME` in the inherited
  environment move it, as `hfHubDir` and `miniLmRoot` read them. For such a folder the app writes there only to
  repair MiniLM before a start: a half or damaged copy loses the hub's file list and its dangling links, and its
  snapshots too while it is still half-downloaded, so Open WebUI's loader fetches it again (~92 MB). The downloaded
  bytes (`blobs/`) stay. Never point the embedding engine anywhere but the farm's document search (never Ollama,
  never an unset `RAG_OPENAI_API_BASE_URL`, which falls back to the chat address). With the default‑on farm OCR, an
  uploaded file's raw bytes also go to the farm, for text extraction; nothing is kept there either.
- **Single worker** (default). Default Chroma is a local SQLite client that is not fork‑safe — never
  raise worker/replica counts in the client.

Kiosk/privacy: `WEBUI_AUTH=false` (single‑user, no login — nothing to gate since data is local and
per‑user; first user is auto‑admin); set a stable `WEBUI_SECRET_KEY`; `ANONYMIZED_TELEMETRY=false`,
`DO_NOT_TRACK=true`, `SCARF_NO_ANALYTICS=true`. Do **NOT** enable OWUI's built‑in local inference
engine (inference must go to the farm, not the laptop).
