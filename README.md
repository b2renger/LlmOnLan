# LlmOnLan (LOL)

> A desktop client + a LAN inference farm. The client bundles a **pinned, unmodified
> [Open WebUI](https://github.com/open-webui/open-webui)** and auto‑connects to the farm so
> anyone on the office Wi‑Fi can chat with a local model (`gemma4:12b`) with **zero setup**.
> All data stays on the user's machine.

LlmOnLan is a sibling of [ComfyQ](https://github.com/b2renger/ComfyQ): same visual language,
same Electron/auto‑update conventions, same dependency‑free UDP discovery. Where ComfyQ schedules
ComfyUI workflows, LOL gives a workshop a private, local‑first chat assistant.

```
  ┌──────────────── your machine ────────────────┐        ┌──────── LAN ────────┐
  │  LOL shell (Electron) — ComfyQ-styled chrome  │        │  lol CLI on GPU box │
  │   topbar · settings · connection screen       │        │   UDP beacon ──┐    │
  │   ┌─ <webview> ─ Open WebUI (pinned, UNMOD) ─┐ │  chat  │   LiteLLM proxy │   │
  │   │  all chats / docs / RAG vectors live     │◄├────────┤   ├ Ollama #1    │   │
  │   │  HERE, in a folder you choose (DATA_DIR) │ │ only   │   └ Ollama #N    │   │
  │   └──────────────────────────────────────────┘ │        │  (gemma4:12b)   │   │
  └────────────────────────────────────────────────┘        └─────────────────┘
```

## The three pieces

| Piece | What it is | Where |
|---|---|---|
| **`lol`** — farm CLI | Node CLI. Reads `lol.config.json`; ensures Ollama, generates + runs a LiteLLM proxy (one OpenAI‑compatible, load‑balanced endpoint), runs a UDP discovery beacon. **Where models are chosen.** | [`farm/`](farm/) |
| **Client shell** | Electron + TypeScript. Supervises the bundled Open WebUI, discovers the farm, points OWUI at it, stores all data in a user‑chosen local folder. Owns the topbar / settings / connection screen. | [`shell/`](shell/) |
| **Open WebUI sidecar** | Vendored, version‑pinned, **unmodified**. We inherit all its features and never edit its source. | [`sidecar/`](sidecar/) |

## Prime directive (non‑negotiable)

1. **Open WebUI is vendored, version‑pinned, and UNMODIFIED** — zero OWUI source diffs in this repo, ever.
2. **We keep Open WebUI's branding** (license convenience + product choice).
3. **All persistent data stays on the client machine** under a user‑chosen `DATA_DIR`. The farm is stateless.
4. **We touch OWUI only through its public surface** (env vars + admin REST API).
5. **Upgrading OWUI is a version bump, not a merge** — no LOL code changes.

See [`CLAUDE.md`](CLAUDE.md) for the full invariants, the integration contract, and the design
rationale, and [`implementation_plan.md`](implementation_plan.md) for the milestone plan.

## Status

**Shipped and self‑updating (v0.1.8, OWUI 0.10.2).** Milestones M0–M5 are done: small installer that
downloads the OWUI sidecar on first run and auto‑updates from GitHub Releases; zero‑config LAN discovery;
the `lol` farm serving **`gemma4:12b`**; and **full multimodal** — image understanding + voice (local
Whisper speech‑to‑text, Web‑Speech text‑to‑speech), all on‑device. Progress, design decisions, and the
debugging history are in [`docs/DEVLOG.md`](docs/DEVLOG.md); current state + roadmap (incl. multi‑box load
balancing) in [`implementation_plan.md`](implementation_plan.md).

## Quick start (farm operator)

```bash
cd farm
npm install
node bin/lol.js init           # scaffold lol.config.json
node bin/lol.js up             # ensure Ollama, generate+run LiteLLM, start the beacon
node bin/lol.js status         # health of hosts + proxy + loaded models
```

Prereqs: [Ollama](https://ollama.com) and [LiteLLM](https://docs.litellm.ai) installed on the GPU
box(es). See [`farm/README.md`](farm/README.md).

## Quick start (client, dev)

```bash
cd shell
npm install
npm run dev                    # boots the shell + OWUI sidecar, loads it in a webview
```

See [`shell/README.md`](shell/README.md) and [`sidecar/README.md`](sidecar/README.md).

## License

MIT (this repo's first‑party code). Open WebUI is bundled unmodified under its own license — see
its branding/attribution terms, which we deliberately keep. "Powered by Open WebUI."
