# LlmOnLan × ComfyQ — media generation from the chat (DESIGN — not yet built)

> **Status: PLANNED, not implemented (recorded 2026-07-05).** This is an approved design captured for a
> future build — no code exists yet. Owner decisions are locked (see "Decisions locked"). When building,
> follow the build order in "Execution / operations". Line/route references were verified against the
> code at the time of writing; re-check before implementing.

## Context

Today an OWUI client on the LlmOnLan farm can chat, search the web, OCR documents, and (opt-in) drive Blender. It **cannot generate media**. Separately, the owner runs **ComfyQ** (`e:\ComfyQ`) — a multi-user ComfyUI workflow scheduler — on GPU boxes on the same LAN. Each ComfyQ box in *student mode* serves one active workflow (flux image, wan video, audio, etc.) and already advertises itself over a UDP beacon + `GET /federation/self`.

**Goal:** let a chat user generate media by having the **farm discover running ComfyQ boxes**, an **operator toggle which served workflows to expose** (in the lol admin panel), and **clients gain a "generate media" tool** in OWUI that renders the result inline. The two hard UX surfaces — the operator's *activation* flow and the client's *invocation + render* flow — are the focus.

## Decisions locked (owner)

1. **Broker lives on the farm.** One farm-hosted broker discovers ComfyQ, holds all booking logic, serves an OpenAPI tool server on the existing `:41997`, and proxies result media. Clients just register the farm's tool-server URL — no new per-client process.
2. **Add a thin REST route to ComfyQ.** ComfyQ has *no* REST job-creation (booking is Socket.IO-only). We add `POST /federation/generate` to ComfyQ wrapping the existing `book_job` logic, so the broker uses plain HTTP — **no socket.io-client dependency on the farm**.
3. **v1 = text-driven workflows only** (prompt → image/video/audio). **Phase 2 (designed here, not built): image editing with Flux.2, with or without a reference image.**

## Architecture

```
ComfyQ box(es) — student mode          lol farm (broker, in `lol up`)         OWUI client
  beacon 239.255.42.99:41999   ──beacon/HTTP──►  ComfyListener (discovers)
  GET /federation/self  (open)                   config.comfyMedia (enabled set)
  GET /workflows/:id/parameters (open)           OpenAPI tool server @ :41997  ──snapshot──►  registers tool
  POST /federation/generate  (NEW) ◄──HTTP──     POST /comfy/generate/<srv>/<wf>  ◄──tool call── model calls generate_*
  GET /jobs/:id  (open, poll)      ──HTTP──►      (book → poll → media)
  GET /images/:file  (open)        ──HTTP──►      GET /comfy/media/<srv>/<file> (proxy) ──iframe──►  renders inline
                                                  admin page "Media (ComfyQ)" card
```

**Data flow (one generation):** model calls `generate_<wf>({prompt})` → OWUI `PUT`s the farm's `/comfy/generate/<srv>/<wf>` → broker `POST`s ComfyQ `/federation/generate` → `{jobId}` → broker polls ComfyQ `GET /jobs/:id` until `completed` → broker returns `200 text/html; Content-Disposition: inline` embedding `<img|video|audio src="http://<farm>:41997/comfy/media/<srv>/<file>">` → OWUI renders it as an inline iframe.

## Grounding facts (load-bearing, from exploration)

- **ComfyQ booking is Socket.IO `book_job` only**; the ack returns `{ok, jobId}`; `scheduledTime:0` ⇒ run ASAP (no collision check). `server/realtime/realtimeBus.js:74`. The queue/registry live in **student mode**. → the new REST route reuses `queue.insert(...)` exactly like the socket handler.
- **ComfyQ everything-else is open HTTP, CORS `*`, no auth:** `GET /federation/self` (`server/routes/federation.js:13`), `GET /workflows` + `GET /workflows/:id/parameters` (`server/routes/workflows.js`), `GET /jobs/:id` (read-only, `server/routes/jobs.js`), `POST /upload` (field `file`), `GET /images/:filename(*)` (subfolder in path). API on **:3000**.
- **ComfyQ beacon** = `239.255.42.99:41999`; snapshot advertises a single `activeWorkflow {id,name,description,category,estimatedDurationSec}` (or null) + `mode`, `comfy:{running}`, `usage`, `jobs`. **Not** a catalog — the full list needs the `/workflows` probe.
- **`ExposedParameter` types** = `text, textarea, number, select, checkbox, image, video, audio, mask` (no `prompt`/`seed`/`3d` types). A prompt is a `textarea`; ComfyQ auto-stitches `book_job.prompt` into the first textarea param.
- **OWUI tool-server call has NO timeout by default** (`AIOHTTP_CLIENT_TIMEOUT` unset → `None`, inherited by `AIOHTTP_CLIENT_TIMEOUT_TOOL_SERVER`; `env.py:604`) and is env-overridable → a slow generation can be a **synchronous** tool call held open while the broker polls.
- **OWUI inline-media channel (verified in the pinned build):** an OpenAPI tool returning `Content-Disposition: inline` + `Content-Type: text/html` has its HTML **embedded as an iframe** (`utils/middleware.py process_tool_result` ~867-893) — the only channel that renders **video** (and image/audio). The LLM sees only a short "ui_component" summary (so it won't "see" the image — fine for generation; matters for Phase 2). Registration is per-user `ui.toolServers` + `ui.tools` via `/api/v1/users/user/settings/update` (what `app.js seedBlenderToolServer` actually does — **not** the `configs/tool_servers` the comments claim).
- **Farm already discovers peers:** `farm/src/peerListener.js` (`PeerListener`) does UDP-join + HTTP subnet-sweep, merges snapshots by `id`, TTL 90s — directly cloneable for ComfyQ (repoint group/port `239.255.42.99:41999` + path `/federation/self`, don't exclude self).
- **Farm advertise/toggle template:** `recommendClientPlugin` (`up.js`, config-array + `beacon.kick()`, no mutex) and the `plugin/<id>/enable|disable` regex (`selfServer.js`) are the exact patterns for the workflow toggle; the Blender row in `admin/index.html` is the card template.

---

## Phase 1 — build (text-driven media generation)

### A. ComfyQ side — one isolated edit (`e:\ComfyQ`)

- **`POST /federation/generate`** — new route mounted where the queue/registry are live (student mode). Body `{ workflowId?, prompt, params?, user_id? }`. Reuse the **exact** `book_job` body of `realtimeBus.js:74-121` (extract it to a shared `bookJob({queue,registry,config}, payload)` helper that both the socket handler and this route call — no logic fork). Returns `{ ok:true, jobId }` (or `{ok:false,error}`). Non-blocking (returns the id; broker polls existing `GET /jobs/:id`).
  - Gate: only when `mode==='student'` + an active workflow exists (else 409 with a clear message). Same open/LAN-trust model as `book_job` (no new auth).
  - `workflowId` defaults to `config.workflows.activeWorkflowId` (the warm one) — the broker always submits for the box's active workflow.
- No other ComfyQ changes. `/jobs/:id`, `/upload`, `/images` already suffice.

### B. Farm broker (`c:\Users\ateliernum\Documents\code\LlmOnLan\farm`)

- **`farm/src/comfyListener.js`** (new) — clone `peerListener.js`: UDP join `config.comfyMedia.group`/`.port` (default `239.255.42.99`/`41999`) + HTTP sweep of `/federation/self` on `:3000`; merge by `snap.id`, TTL. Expose `getServers()` → live list filtered to `mode==='student' && comfy.running && activeWorkflow`. Started in `up.js` next to the plugin services; refreshed on the existing health timer, which then `beacon.kick()`s.
- **`farm/src/config.js`** — new `ComfyMediaSchema`: `{ enabled:false, group:'239.255.42.99', port:41999, enabledWorkflows: [] }` where each entry is `{ serverId, workflowId }` (host re-resolved live from discovery — IPs move). Master `enabled` gates everything. Ephemeral-toggle friendly (matches other admin changes) but persisted if written to `lol.config.json`.
- **`farm/src/comfyBroker.js`** (new) — the tool-server logic:
  - `buildOpenApiSpec(enabled, servers)` → an OpenAPI 3.1 doc with **one operation per enabled+available workflow**: `operationId: generate_<sanitizedId>`, `POST /comfy/generate/<serverId>/<workflowId>`, requestBody `{ prompt: string (required) }`, `summary`/`description` from the workflow's name + description + a plain-language category ("Generates a **video** from a text prompt."). **v1 tool input = prompt only** (ComfyQ maps it to the textarea param; other params use workflow defaults). A curated `select` (e.g. aspect ratio) is an easy later add.
  - **Eligibility filter:** at enable time probe `GET http://<host>:3000/workflows/<id>/parameters`; a workflow with any **required** `image|video|audio|mask` param is **not v1-eligible** (surfaced greyed in the admin card as "needs media input — Phase 2"). Cache the param summary + description for the spec.
  - `generate(serverId, workflowId, {prompt})` → resolve live host (404 if the server vanished) → `POST /federation/generate` → poll `GET /jobs/:id` until terminal (ceiling = `estimatedDurationSec × 6`, hard-capped, e.g. 15 min) → on `completed` return `{ html }` embedding each output via the farm media-proxy URL; on `failed`/timeout return friendly error HTML. Output kind → tag: image→`<img>`, video→`<video controls>`, audio→`<audio controls>`, model3d/splat→a download link (no inline 3d viewer in OWUI). Set explicit width/max-height in the HTML so the iframe doesn't collapse.
- **`farm/src/selfServer.js`** — new **open** routes (media must be fetchable by the webview; the tool call carries no admin token):
  - `GET /comfy/openapi.json` → `broker.buildOpenApiSpec(...)`.
  - `POST /comfy/generate/:serverId/:workflowId` → `broker.generate(...)` → `200 text/html; Content-Disposition: inline` (+ error HTML on failure). Only serves **currently-enabled** pairs (404 otherwise).
  - `GET /comfy/media/:serverId/:file(*)` → stream bytes from that ComfyQ box's `/images/:file(*)` (single reachable origin for the iframe; also covers clients that can't reach ComfyQ directly). Validate `serverId` is enabled + path-pin (no `..`).
  - New **token-gated** admin routes: `POST /lol/admin/comfy/enable {serverId,workflowId}` / `.../disable`, `POST /lol/admin/comfy/media {on}` (master), `POST /lol/admin/comfy/rescan`.
- **`farm/src/commands/up.js`** — start the `ComfyListener`; add `control.setComfyWorkflow(serverId,workflowId,on)` (probe eligibility on enable → mutate `config.comfyMedia.enabledWorkflows` → `beacon.kick()`), `control.setComfyMedia(on)`, `control.rescanComfy()`; extend `getAdminState()` to return `comfyServers` (live discovered) + `comfyEnabled` + `comfyMediaEnabled`. `liveHealth.comfyServers` refreshed on the health timer.
- **`farm/src/snapshot.js`** — advertise, gated on `config.comfyMedia.enabled && enabledWorkflows.length`:
  ```
  comfyMedia: { toolServerUrl: `http://${primary}:${httpPort}`, openapiPath: '/comfy/openapi.json',
                workflows: [{ id, name, category }] }   // else omitted/null
  ```

### C. Admin activation UX (`farm/src/admin/index.html`)

A new **"Media (ComfyQ)"** card (below Plugins), rendered from `getAdminState().comfyServers/comfyEnabled`:
- **Master toggle** "Media generation (ComfyQ)" (on/off → `POST /lol/admin/comfy/media`). Off ⇒ nothing advertised, rest greyed.
- **Discovered servers** (read-only rows, Clients-card style): name · GPU · `mode` badge · `comfy.running` dot · **activeWorkflow** name + category · `usage.usersConnected`/`idleSec`. Empty state: "No ComfyQ boxes found — start one in student mode with a workflow active" + **Rescan** button (`POST /lol/admin/comfy/rescan`).
- **Per served workflow**: an **Enable/Disable** toggle (→ `.../comfy/enable|disable`), a "serving to clients" badge when on, and a **greyed "needs media input — Phase 2"** state for ineligible (required-media) workflows. All strings `esc()`'d. Clone `pluginAct`/`recommendAct` for the handlers; the existing 5 s poll refreshes it.

### D. Client invocation + render UX (`shell/`)

- **`shell/src/main/types.ts`** — `FarmSnapshot += comfyMedia?: { toolServerUrl:string; openapiPath:string; workflows:{id,name,category}[] } | null`.
- **`shell/src/main/index.ts`** — in `onFarms`, when `chosen.comfyMedia` is present, register the farm tool server with OWUI; when absent, unregister. **Simpler than Blender** (no local process — just a URL from the snapshot). Re-register when the workflow set changes (spec changed → reload the tool server so OWUI re-fetches `/openapi.json`). Auto-apply when advertised (zero-config, like web search/OCR) — an operator already opted in farm-side.
- **`shell/renderer/app.js`** — `seedComfyToolServer(url, path)` / `unseedComfyToolServer()` cloned from `seedBlenderToolServer`: append `{ url, path, auth_type:'none', config:{enable:true}, info:{id:'lol-comfy', name:'Media generation', description:'Generate images/video/audio via the studio farm.'} }` to `ui.toolServers` and push `direct_server:<idx>` into `ui.tools`, via `/api/v1/users/user/settings/update` in the authed webview. Reuse the index-renumber logic on unseed.
- **`shell/src/main/configBridge.ts`** — set `AIOHTTP_CLIENT_TIMEOUT_TOOL_SERVER` to a generous ceiling (e.g. `900`) so a hung generation eventually frees the chat while long videos still finish.
- **Model note (document, don't code):** tool-calling quality gates this UX — `gemma4:12b` is weak at tools (same caveat as Blender); recommend serving a tool-tuned model. The tool's per-workflow name + category description is what lets the model pick "video" vs "image".

### Reuse vs net-new (Phase 1)

| Seam | Reuse | Net-new |
|---|---|---|
| Discover ComfyQ | `peerListener.js` → `comfyListener.js` | repoint group/port/path |
| Advertise + toggle | `recommendClientPlugin`, `plugin/<id>/enable` regex, snapshot field | `config.comfyMedia`, `setComfyWorkflow` |
| Admin card | Blender row + `recommendAct` | "Media (ComfyQ)" card |
| Client register | `seedBlenderToolServer` (`ui.toolServers`+`ui.tools`) | `seedComfyToolServer` (no local proxy) |
| Booking | — | ComfyQ `POST /federation/generate`; `comfyBroker.js` (spec + generate/poll + media proxy) |

---

## Phase 2 — image editing with Flux.2 (designed, not built)

**Target:** "edit this image" and "edit with a reference image" — maps to ComfyQ's existing `image_flux2_inpaint` (base image only) and `image_flux2_inpaint_with_reference` (base + reference) bundles. ComfyQ already serves them; Phase 2 is the **input plumbing** to get image(s) into the tool.

**Mechanism (chained media):** the broker's tool gains an `image_url` param (and `reference_url` for the ref variant). On call: broker `GET`s the image bytes from `image_url` → `POST`s ComfyQ `/upload` (field `file`) → gets `comfyq_session__…` filename → sets it into the workflow's image param → `POST /federation/generate` with those `params`. Same for `reference_url`. The natural source of `image_url` is a **previously farm-generated image already in the chat** (chaining "make a cat" → "now make its hat red").

**The load-bearing risk — the source-image reference.** Under Phase 1's iframe render, the LLM never sees the media URL (only a "ui_component" summary), so it can't pass it to an edit tool. Phase 2 therefore needs images to render on a **model-visible** channel so the URL is in context. Two options to resolve in Phase-2 design:
- (a) Render **images** via the MCP channel (image content items → uploaded to OWUI files → URL visible to the model in both paths) — keep video/audio on the iframe channel. Requires the broker to also speak MCP (a second small surface).
- (b) Convention: the edit tool takes **no** image arg and always edits the **most recent generated image** for that chat (broker tracks last output per chat/session). Simpler for weak models; less flexible.

**Prep now (so Phase 1 doesn't preclude Phase 2):** keep the eligibility filter and the per-workflow spec builder generic over params (don't hardcode "prompt-only"); keep the broker's `generate()` accepting a `params` map + an upload helper stub; record each generation's output URL keyed by a request id so option (b) is cheap later. No image-input workflow is *exposed* in v1 (filtered out), but the plumbing seams exist.

---

## Verification

**Unit (farm `test/run.js`):** `comfyMedia` snapshot gating (enabled+non-empty ⇒ advertised; else omitted); `buildOpenApiSpec` emits one valid operation per enabled workflow with a `prompt` body + sane operationId; eligibility filter rejects required-media workflows; `comfyListener` merge/TTL; `setComfyWorkflow`/`setComfyMedia` mutate config + would kick. **ComfyQ:** unit the extracted `bookJob` helper (socket path unchanged) + a route test for `POST /federation/generate` → `{jobId}` (and 409 in admin mode).

**Integration (curl, before any UI):** on a student-mode ComfyQ box: `curl -XPOST :3000/federation/generate -d '{"prompt":"a red cube"}'` → `{jobId}` → `curl :3000/jobs/<id>` until `completed` → `curl :3000/images/<file>` returns bytes. Then against the farm: `curl :41997/comfy/openapi.json` lists the op; `curl -XPOST :41997/comfy/generate/<srv>/<wf> -d '{"prompt":"…"}'` returns inline HTML; `curl :41997/comfy/media/<srv>/<file>` streams the image.

**End-to-end (rig, two machines):** ComfyQ box serving flux (student) + a lol farm + a client. Admin panel shows the box under "Media (ComfyQ)" → **Enable** the workflow → client's OWUI gains a `generate_*` tool within ~5 s → in chat "make an image of a cat" → tool runs (spinner) → image renders inline. Repeat with a **video** workflow (confirm `<video controls>` plays in the iframe — watch iframe height doesn't collapse). Failure paths: ComfyQ box removed mid-generation → friendly error, farm doesn't hang; disable in the panel → tool disappears from clients.

## Risks & mitigations

- **iframe sizing** — OWUI's embed iframe is `w-full h-full`; a naive body can collapse. → return HTML with explicit `max-width`/`height` on the media element. (Verify on rig.)
- **Weak tool-calling models** — gemma4 won't reliably call the tool. → document; recommend a tool-tuned model, same as Blender.
- **Long generations** — held-open synchronous tool call. → OWUI tool timeout set generous (900 s) + broker poll ceiling + friendly timeout HTML; the tool description says "may take a minute".
- **ComfyQ box switches its active workflow** — an enabled `{serverId,workflowId}` no longer matches. → broker marks it unavailable (drops from the spec); admin card shows the discrepancy to re-enable.
- **Reachability of media** — always proxy via `/comfy/media` so the iframe hits the already-reachable farm origin, never a maybe-unreachable ComfyQ IP.
- **Trust model** — the new ComfyQ route + farm `/comfy/*` are open on the LAN, exactly like today's `book_job`/`/images` and `/lol/self`. No new secret. Admin toggles are token-gated.

## Out of scope (v1)

Image/video-input workflows (Phase 2); curated non-prompt params in the tool schema; a 3d inline viewer (download link only); per-client opt-out of media tools (auto-applied when advertised); persisting admin toggles by default (ephemeral like other admin changes).

## Files

- **ComfyQ:** `server/routes/federation.js` (+ extract `bookJob` from `server/realtime/realtimeBus.js`).
- **Farm:** new `farm/src/comfyListener.js`, `farm/src/comfyBroker.js`; edit `config.js`, `selfServer.js`, `commands/up.js`, `snapshot.js`, `admin/index.html`, `test/run.js`.
- **Client:** edit `shell/src/main/{types.ts,index.ts,configBridge.ts}`, `shell/renderer/app.js` (`store.ts` only if a client opt-out is added).

## Execution / operations

**Build order** (each step self-contained + verifiable before the next): (1) ComfyQ `POST /federation/generate` + curl-test it; (2) farm `comfyListener` + discovery visible via `getAdminState`; (3) farm `comfyBroker` + `/comfy/*` routes + curl-test end-to-end against a real ComfyQ box; (4) admin "Media (ComfyQ)" card; (5) snapshot field; (6) client tool registration + render. Land as **three commits** mirroring the split: ComfyQ route, farm broker+admin, client wiring.

**Local checks after each edit** (fast, gate every commit):
- Farm: `cd farm && node test/run.js` (unit) + `node --check` on each edited `.js`.
- Client: `cd shell && npx tsc --noEmit` + `node --check renderer/app.js`.
- ComfyQ: `node --check` on edited files + its test runner if present.

**Integration checks (curl, before wiring the UI)** — the sequence in *Verification* above: `POST /federation/generate` → poll `/jobs/:id` → `/images`, then `/comfy/openapi.json` → `POST /comfy/generate/...` → `/comfy/media/...`. Run against a real student-mode ComfyQ box on the LAN.

**Commit + release conventions** (commit/release only when explicitly asked):
- Commit as **b2renger <berenger.recoules@gmail.com>** with the `Co-Authored-By: Claude Fable 5` trailer; clear per-commit messages (the three-commit split above).
- **ComfyQ changes** reach GPU boxes via **`git pull`** on the ComfyQ repo (no release). **Farm changes** reach the lol boxes via `git pull` + restart `lol up` (no client release). **Client changes** (types/index/configBridge/app.js) ship via a **shell release** (`npm run release:patch` → CI builds installers → clients auto-update) — so the client wiring is the only part needing a version bump, cut **last**, after the farm+ComfyQ sides are rig-verified.
- Update **docs** in the same batch: `farm/README.md` (admin "Media (ComfyQ)" section), root `README.md` (feature line), `docs/DEVLOG.md` (dated entry), `docs/RIG_CHECKLIST.md` (a "Media generation" test section), and ComfyQ's `CLAUDE.md`/README for the new federation route.
