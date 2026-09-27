# Critic review: ECOSYSTEM_PLAN v1 (2026-09-27)

Reviewed: [ECOSYSTEM_PLAN.md](../ECOSYSTEM_PLAN.md) v1, its research note, CLAUDE.md (prime directive, data flow,
ponytail) and the code the plan leans on: `graph/parts/index.mjs`, `graph/runner.mjs`, `parts/button.mjs`,
`app/ask.mjs`, `computer/visible.mjs`, `values.mjs`, `serialize.mjs`, `sandbox/libs.mjs`, `test/chat-lint.js`,
`renderer/index.html` (CSP), `farm/src/plugins/registry.js`, `extract.js`, `snapshot.js`. Read-only; no network.

## Verdict

**Not tonight as written; yes tonight after amendments 1–4.** The direction is right: the plugin pattern, the
placement rule, "numbers from Code", output safety and the honest Laya reading are all sound. But v1 has
four problems. (a) P1 bundles a client feature, a new farm service with a torch stack, a new box, d3 and a
template into one night. (b) Several "no new X needed" claims are false against the code: reactive runs,
Sound → Listen, and d3 within the sandbox budget. (c) It builds 12 connector boxes and VRAM accounting that
presets and a CPU-first choice make unnecessary. (d) The privacy and trust story stops at the farm, although
Fetch, imported graphs and actuators reach further. The owner's first goal (online data → Laya + reasoning
→ SVG) can ship tonight **without any farm change**. Laya then slots in as the fast first pass.

Spot-check of §1 (accurate unless listed): 21 palette parts + 3 legacy, 9 presets, 2 templates,
lessons 00–04, `RUN_LIMITS` 8/50/10 min/2000, dead `ui/workbench.mjs` + `strings/studio.en.mjs`, no network
door beyond `net/{farm,run,extract}.mjs` + `app/caps.mjs` + `sandbox/libs.mjs`, OCR unseated. **Overclaims:**
§2.1.2 ("an incoming event is an automatic Button press… no new runner"; see Must 7) and §3.3/P2's "Sound box →
Listen" (the Sound box outputs *text*, and `values.mjs KINDS` has no audio kind; see Must 6). **Missing from
the inventory:** the lint doors (rules 10–13), which every new I/O path must pass; the 2.0 MB vendored-library
budget (1774 KB used); `MAX_VALUE_BYTES` = 1 MB per value; the renderer CSP `connect-src 'self' http: https:`
(no `ws:`); lint rule 2 forbidding `<audio>`/`new Audio()`; `ask.mjs` refusing while the Computer is hidden or
minimised; OCR's plugin key broadcast in the beacon snapshot (`snapshot.js:232`); Condition/Filter already
having a `model` mode (a "semantic if" exists).

## Must change

1. **Split P1 and shrink tonight.** Replace §5's P1 row and §6 with:
   > **P1a Data (tonight, client only):** Fetch box; the template "Read the news" with topic labels from an
   > Instruction (JSON by id) and the chart drawn by Code as plain SVG; no d3, no farm change. Exit: the template
   > runs on the mock farm from its saved copy (offline) and live on today's farm. **P1b Laya (next):** the farm
   > `classify` plugin plus the Classify box. The template gains a fast first pass and falls back to P1a's path
   > when the farm has no plugin. §6 tonight = P0 + P1a (+ P1b's plugin if time). "P2 start" leaves tonight.

   Why: the template does not need Laya to be correct. The fleet has farms on old builds, and farm plugins reach
   operators only through manual Farm-app installs. The fallback path must therefore be the *default* path,
   not an afterthought.
2. **Specify the Laya plugin as CPU-first, off, pinned (amend §3.2 and §4.1).**
   > `classify` plugin: **off by default** (like TTS); CPU `torch` from the PyTorch CPU index (no CUDA wheel, no
   > VRAM; GPU is a later opt-in); pinned `laya==0.3.20` plus the HF weight revision hash; the Router is loaded
   > **eagerly at plugin start** (the spike measured a 13.7 s first load); torch threads capped (for example 4) so
   > llama-server is not starved; ONE batched request per run (≤ 100 items); **`choice` only in v1** (no `score`,
   > no `noul` until a calibration set exists); every confidence is labelled "uncalibrated" (the model says so
   > at load). Weights are fetched at `lol install`, then HF offline.

   Strike "laya-serve is mature": it is a 0.3.x package released 8 days ago. Move "VRAM accounting for plugins"
   out of P1/P2: it is needed only when a plugin goes on the GPU. Note that PyPI's torch on Windows is CPU-only
   anyway, so "CUDA with CPU fallback" would silently be CPU on the Windows farms.
3. **Rewrite the template as "the model decides, Code computes" (P1 scope text).**
   > Fetch(HN Algolia, saved copy) → Code: parse `{id,title,domain,points,num_comments,created_at}`, XML-escape
   > titles → [P1b: Classify topic ∈ the categories Text box → Code: split at confidence 0.6] → Instruction:
   > label the (unsure) titles, JSON keyed by **id** → Code: join **by id**, compute every count, sum, mean and
   > rank → Instruction (JSON schema): turn "Your instruction" (a Text box) into a **chart spec** from enums
   > (`group ∈ {topic,domain,hour}`, `measure ∈ {count,points_sum,points_mean,comments_mean}`,
   > `chart ∈ {bar,dot}`, `sort`, `top 1–30`, `highlight`, `title`) → Code: draw the SVG from the stats + spec →
   > Preview(SVG) + File(.svg) + Preview(Markdown): the "check these" table (the unsure items with labels).
   > Optional caption: the model gets only the Code-computed stats, and a Code check flags any number in the
   > caption that is not among them.

   The model never emits a number that reaches the chart. The categories are an editable Text box, not a
   model output. Laya earns its place as the System 1 vs System 2 lesson (the transcript shows the timing
   difference), not as a correctness need at 30 items.
4. **Pin the Fetch box's contract (replace §4.2's Data line).**
   > Fetch (main process `net.fetch`, one IPC door added to lint rules 10/11): GET, http(s), **≤ 1 MB**
   > (`MAX_VALUE_BYTES`; 5 MB cannot be stored as a value), 15 s, no cookies or credentials. The **host is a
   > setting typed by a person**; arrow values fill only URL-encoded query parameters. Loopback, link-local
   > (169.254/16) and the farm's admin/plugin ports are refused by default; private-LAN hosts are allowed and
   > shown. The response is **held in the box with its time** (like the Document box's cache): re-runs are
   > free, templates work offline, and the harness is deterministic. "Refresh" re-fetches. Output: `json` when
   > the body parses, else `text`. **No API keys in a graph** (graphs are exported and shared); a later secret
   > store, referenced by name, is the upgrade path.
5. **Add a graph-import trust rule (new §3.8).**
   > A `.lolgraph.json` is now a program with network and actuator powers. An imported or reloaded graph opens
   > **disarmed**; before its first run it lists every Fetch host and every output destination; a person
   > starts the run.

   Why: shared templates in a classroom are the main vector, and a malicious graph could otherwise combine a
   Fetch and an output into an exfiltration path.
6. **Reshape speech (amend §3.3, §4.2 Speech and the P2 row).**
   > **Listen = a mode of the Sound box**, exactly the Document precedent (holds the file, sends it to a farm
   > service, outputs text). No new box, no new value kind. **Speak** plays through the platform
   > `speechSynthesis` (local OS voices, no farm) and uses Kokoro when the farm advertises it; playback goes
   > through Web Audio like the Sound box (lint forbids `<audio>`). The farm `stt` plugin speaks the OpenAI
   > contract `POST /v1/audio/transcriptions` (as Kokoro speaks `/v1/audio/speech`). faster-whisper runs CPU
   > int8 by default; R2T2 is an operator-run `external`. The microphone is **person-started only**, shows a
   > visible recording state, has a clip cap (60 s / 10 MB) and never runs from an armed trigger in v1. The
   > media permission handler goes on the `DATA_DIR/lol-client` session. P2 exit: record → transcribe → text
   > on the mock and real farm; text → Speak with no farm.
7. **State what reactive runs really need (replace §2.1.2's last sentence and §4.2 Reactive runs).** The code
   contradicts "no new runner" in three places:
   (a) `run()` refuses while a run is in flight (`busy`), and `addToRun` merges seeds, not payloads;
   (b) `ask.mjs` refuses every generation while the Computer is hidden or the window is minimised;
   (c) an unwired Button emits `{pressed:true}`, not a payload. Amend to:
   > A Trigger is a *source* box that holds the last event payload and starts
   > `run({mode:'from', seeds:[trigger]})`. While a run is in flight, each trigger keeps **only its latest
   > event** (coalesce, count the drops, show the count). **Armed runs live only while the Computer is shown**
   > (v1); hidden means "paused", as today's rule says. Each armed graph has a generation budget per hour
   > beside `RUN_LIMITS`. Armed state never survives a quit (close means close) or a reload.
8. **Split P3 and replace 12 boxes with 2 part types plus presets (amend §4.2 Connectors and the P3 row).**
   > **P3a Outputs** (person-started runs, no reactive runner): ONE `Send` part with a transport setting
   > (OSC, Art-Net, MQTT publish, WS send, HTTP POST, serial), each offered as a ＋-menu **preset** (the
   > `creative.mjs` mechanism). ALL outputs pass one `act()` choke point (dry run / armed / rate / clamp /
   > panic), enforced by a lint door. Transports run in ONE main-process I/O bridge; only Web Serial stays in
   > the renderer (an API constraint). This also avoids adding `ws:` to the renderer CSP and a second safety
   > path. Every transport ships an **on-screen simulator** (a virtual light rig, an OSC monitor).
   > **P3b Triggers + Armed:** ONE `Trigger` part (OSC in, MQTT subscribe, WS client message, serial read,
   > clock). v1 is **outbound-first**: the ESP32 as a WS *server* (the laptop connects out) and MQTT through a
   > broker. OSC-in is the only inbound listener, off by default and bound to one interface. **Cut Webhook-in and
   > the WS server** from v1 (redundant attack surface; inbound listeners trigger a Windows Firewall prompt that
   > non-admin students cannot accept).
   > Safety specifics: panic **sends and repeats a safe frame** (Art-Net nodes hold the last frame, so
   > stopping transmission leaves the lights on); per-channel clamps are set by a person, never by the model;
   > DMX intensity changes are limited to ≤ 3 Hz by default (photosensitive flashing); the dry run shows the
   > packets. The lesson says plainly that software is not an e-stop.
9. **Complete the privacy boundary and plugin auth (amend §3.4).**
   > Beyond the farm, with user content: a Fetch URL, including its query string, goes to third-party hosts;
   > MQTT/HA messages go to the broker; a git push sends the user's code to the remote. Farm plugins must
   > **never log request bodies** (one unit test per plugin). New plugins require the farm password when one
   > is set; today the OCR key rides the beacon snapshot in clear, so the password does not protect plugins.
   > State this, or fix it for all plugins at once.
10. **Take the OWUI bump now, not in P6 (amend §4.4 and §5).** "Stays close to upstream" is the owner's first
    bullet, yet the plan schedules bumps last. 0.10.2 → 0.11.x is by design a pin bump plus smoke tests, and
    doing it early is the cheapest test of invariant #5. Make it its own chore between P1a and P2.
11. **Put the unknowns before the builds (amend P4/P5).**
    > **dsh spike** (read-only, can run in parallel with P1b/P2). Exit criteria: it runs under Electron's Node
    > (`utilityProcess`, no Node shipped); it uses the farm through `llm-pi-ai` and survives `lol_seats_full`
    > 429s; `sandbox-windows-acl` blocks writes outside the workspace on Windows; the size on disk is measured;
    > and the farm's default model completes ≥ 4 of 5 scripted tasks in `minimal` mode. If it fails, fall back
    > to a minimal loop on LOL Chat's core.
    > **The Agent box ships only if** the same task suite shows tool-calling success ≥ 80% on the default
    > engine; until then, the graph itself is the agent.
    > **Skills: IDE only in v1** (drop "the Computer's Agent box" from §3.6). Seeded skills are pinned by commit
    > and hash (like lint rule 14), carry their MIT licence files, and are a curated subset: ponytail plus about 6
    > agent-skills (spec-driven, planning, incremental, debugging, code-review, git-workflow). The IDE's first cut
    > has **no shell tool** (file edit + preview + serve cover web and three.js apps), so there is no student-
    > prompted `npm install` supply-chain risk.

## Should change

- **d3 out of P1.** 1774 KB of the 2.0 MB sandbox budget is used; d3 v7's UMD (~280 KB, measure it) lands at
  or over the line, and `libs.mjs` says "a fourth library needs an owner decision". Code draws bar and dot SVG
  in about 40 lines, which is also the lesson. Revisit with graphify, choosing between `d3-force`+`d3-scale`
  only and dropping matter.js.
- **Name it Classify, not Decide.** v1 is `choice` only, and Condition already "decides"; two "deciding" boxes
  confuse a class.
- **Classify is visible and bounded like a generation.** It takes the list whole (no fan-out); it appears in
  the transcript (sent, got, ms); Stop aborts it; the plugin has a per-IP cap of 1 in flight, a global cap, and
  a 429 with Retry-After that the box explains.
- **Test fixtures.** The mock farm emulates `/v1/systemone` and `/v1/audio/transcriptions`; a fixture HTTP
  server serves the HN copy; UDP and WS sinks in the harness assert packets; ephemeral ports only (the dev box
  runs a live farm).
- **Windows rig checks on a non-admin student account:** the firewall prompt (OSC-in, LAN serve), USB-serial
  drivers (CH340/CP210x need admin), paths with spaces (`LOL Studio Projects`) in git and dsh, and interface
  choice for Art-Net on multi-NIC laptops.
- **graphify has no client home.** The client has no Python except the OWUI sidecar, and installing into it
  breaks the spirit of invariant #1. Make graphify an IDE skill run by dsh (P5); the Computer gets a
  `graph.json` view later.
- **Git: one path, chosen in the dsh spike**, not "system git, else isomorphic-git". A LAN Gitea is just a
  remote URL and needs no special case.
- **Farm CPU contention:** measure `lol bench` tok/s with Classify and STT busy before either defaults on.
- **One Learn-shelf sequence.** Slot the new templates into the unbuilt lessons 5–12 instead of a parallel
  track. Each phase's exit names the lesson.
- **LOL Chat:** don't delete the chat or the dead workbench until the IDE layout exists. If the spike embeds
  dsh's web UI, LOL Chat's tree and seat etiquette are *replaced*, not reused; §2.2.1 should say which.
- **Capability per run:** the client auto-picks the least busy farm, so `classify`/`stt` availability can flip
  between runs. Boxes read the snapshot's `plugins` map at run time, never once at mount.

## Keep

- The placement rule (models on the farm, world I/O in main, nothing stored on the farm), the plugin pattern,
  and `external` for R2T2.
- "Numbers never from the model", the "check these" list, the 0.6 threshold (it separated the spike's 10
  titles cleanly; confirm on 100+).
- Output safety as a first-class decision (dry run, arm, rate, panic, Confirm), and Home Assistant local
  instead of cloud skills.
- dsh pinned and unmodified like OWUI, with SDK vs web UI decided by a spike.
- Every phase ending with gates, a mock-farm scenario, a rig check, docs and a Learn item, and working on the
  mock farm with no GPU.
- The honest risks table: weak local agents, two upstreams, R2T2's licence.

## Answers to the plan's open questions (§7)

1. **Laya: farm or client?** **Farm, CPU-first, off by default, pinned.** One install serves every laptop,
   there are no 800 MB of weights per laptop and no `wasm-unsafe-eval` in the CSP. kevala is 5 days old with
   WebGPU unmeasured here; revisit when it is 3+ months old and measured on the office laptops.
2. **Audio to the farm?** **Yes, under the OCR rule**, with conditions: a person starts every capture, a
   visible recording state, a clip cap, no continuous listening from armed triggers in v1, no body logging,
   and in-app text plus a classroom consent note shipped in the same commit.
3. **R2T2 licence?** **Yes: read it before any use, not only before bundling** (school use is "use"). Default to
   faster-whisper (MIT code and weights). R2T2 stays operator-run `external`, never fetched by `lol install`.
4. **dsh churn?** **Accept it only behind the spike's exit criteria (Must 11)**, pinned to an exact version with
   a lockfile hash, with the minimal-loop fallback named in advance. Don't retire LOL Chat's chat before the
   IDE works.
5. **GitHub only or LAN Gitea?** **Build for any git remote over HTTPS**: GitHub and Gitea are the same
   protocol. Document Gitea as the fully local option; build no GitHub-only features (PRs, Actions) in v1.
6. **Google Home/Alexa → Home Assistant?** **Yes.** HA's MQTT integration falls out of the MQTT transport with
   no extra code; no cloud skills, ever (the local-only rule: a feature that needs a cloud API is cut). Keep it
   last.
