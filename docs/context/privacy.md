# Data flow and the privacy boundary

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

## Data‑flow & privacy boundary

- **On the device, all under `DATA_DIR`:** every conversation, folder, prompt, document, and RAG vector
  (OWUI's); LOL Vibe's history and the Computer's graphs and media (the main window's session,
  `DATA_DIR/lol-client`); the Computer's File-box outputs (`DATA_DIR/LOL Studio Projects`); and, since 2026-11-12 (not
  released yet), the **usage counts** (`chat/core/usage.mjs`, in the same session's storage): per day, which surface was
  opened, how LOL Vibe's replies ended and their timings, the Computer's runs and the box types they used, numbers and
  names from fixed lists only, kept 30 days, counted for everyone from the update on, and **sent nowhere**: a person
  saves them as a file from Preferences ▸ Usage report and gives that file to whom they choose. The vectors are kept
  here; the farm's document search computes them (MiniLM on this computer for a folder that has not met it yet),
  and which model a folder uses is written in `DATA_DIR/lol-embedding.json`. Outside DATA_DIR, under userData, only app plumbing: settings, the downloaded engine,
  OWUI's webview token/caches, logs (`logs/boot.log`, `logs/client-data.log`, the Computer's opt-in recordings), and
  — after an upgrade from v0.1.x — the old LOL Vibe copy kept as a backup. Outside both, the machine's Hugging Face
  cache (`~/.cache/huggingface`, shared by every data folder) holds MiniLM, the old search model: no user content.
  The app repairs a half-downloaded copy there before the start of a folder still on it.
- **Over the network (all to the trusted‑LAN farm, which stores nothing; the client trusts its network, so use it on one you trust: a device that answers as a farm gets this list, above all a new client's first farm, but every address stays on the host the chat goes to, 2026-11-06):** the chat context per
  completion (from OWUI, LOL Vibe, or a Computer Instruction — with an Image box's or a Preview's rendered pixels when wired);
  web‑search queries to the farm's SearXNG — since web search v2 sent by this app's main, which then itself
  reads the top pages of each search (up to 6 GETs, to the public internet only, never the LAN; nothing kept),
  while a page the model picks is fetched by OWUI as before (main's page reads are for OWUI's native tool calling,
  its default; a chat set to Legacy function calling still has OWUI load the result pages itself); TTS requests when
  the farm hosts Kokoro (and a Computer Speak box's text, with the farm voice); a Computer Sound box's
  recording, only in **Listen** mode, to be written down by the farm's speech-to-text (never logged or
  kept), and — when the farm offers speech to text — every recording of Open WebUI's microphone button and Call
  mode, written down the same way (Open WebUI's own copy and transcript stay in `DATA_DIR/cache/audio`); and — with the default‑on farm OCR — an uploaded file's (or a Computer Document
  box's) raw bytes, for text **extraction** (nothing kept); with the farm's **document search**, the text of each
  piece of a document and of each search, turned into vectors that come back and are kept on this computer (the
  farm keeps no text and no vector, and its log holds token counts only); presence heartbeats
  (`POST /lol/client-ping` every 10 s: hostname, platform, version, idle seconds).
- **To third parties a person names:** a Computer **Fetch** box's GET to the address typed in it (nothing
  from the graph is sent with it); an **Open data** box's GETs to data.gouv.fr for the dataset pasted in it; an **Agent** box's GETs, only to hosts a person listed on it; a **Send** box's message to the device typed in it, only once a person
  armed the outputs (a dry run otherwise); the **Home Assistant** a person linked (states and actions read when a model asks or a Computer Home box runs — and what a model read can leave with its other
  tools in the same chat, e.g. Open WebUI's `fetch_url` when a person turns web search on, so the docs say to leave it off there; a
  command only while a person allowed home commands). A board on this computer's USB cable (Send by USB, Receive) stays
  on this computer; the farm's message bus carries what a graph publishes (armed) to whoever subscribed on the
  LAN, and keeps nothing.
- **Beyond the farm (no user content):** GitHub, for the app update check and the chat-engine (sidecar)
  download/update check, and the IDE's coding-agent runtime when a person clicks Install; huggingface.co, until
  MiniLM and whisper-base are cached (then `HF_HUB_OFFLINE=1`): Open WebUI's downloads and, while MiniLM is not on
  disk, one HEAD from this app's main before each Open WebUI start (3 s, through the system proxy, none behind an env
  proxy; nothing about the person) to decide whether that launch starts offline; PyPI, when the Blender tools are first
  turned on (by a person in Preferences, or by a farm that recommends them to a client whose person never chose): pip
  installs mcpo and blender-mcp, and upgrades pip, into `<userData>/mcp-tools`. The coding agent itself talks only to the farm's
  `/v1` (its cloud, web and telemetry rows are off; checked with a netstat watch, 2026-09-28) — and, with **Use the
  Computer** on, to the Computer's MCP server on 127.0.0.1 (this machine).
- **The IDE's publishing, only on a person's click:** **Push** sends a project's committed files to the https git
  server a person typed (GitHub or a LAN Gitea), with a token kept encrypted by the OS (`safeStorage`,
  `<userData>/git-tokens.json`, never handed back to the page); **Pull** brings that server's commits here
  (fast-forward only, local work committed first). **Share on the LAN** serves one project read-only to the LAN
  until it is turned off or the app closes. A project's history (`.git`, isomorphic-git) stays in its folder in
  DATA_DIR.
- **Never sent anywhere:** a document's text for indexing to anyone but the farm in use (its document search, on the host the chat goes
  to: an advertised address cannot point elsewhere, `discovery.ts` `onHost`), a Computer Sound box's recording unless its Listen switch is on, and telemetry
  (off).
- **Planned, not built: a person's own documents in Microsoft 365 or Google** (owner, 2026-11-05,
  [docs/plans/CLOUD_SOURCES_PLAN.md](../../docs/plans/CLOUD_SOURCES_PLAN.md)): LlmOnLan may read them client side only, when
  that person asks, with their own account and the rights their IT set, or from a folder a sync app keeps; nothing of it
  on the farm. When it is built, its lines go in this section.

If a feature would move *stored* data off the device or persist anything server‑side, it breaks the
promise — flag it.
