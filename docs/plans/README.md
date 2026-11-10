# The next work, in order

*Written 2026-11-05 from the project review of that day: every plan was read against the code, and the leftovers
of the plans now in [../archive/plans/](../archive/plans/) are here, one line each, so nothing open hides in the
archive. Released 2026-11-09: client v0.2.16 and Farm app farm-v0.0.52, with the review's fixes.*

Sizes: **S** under a day, **M** a few days, **L** a week or more. The owner's direction behind the order: one big
box serves the class (20–30 people, 50 at most) with vLLM; the operator does everything from the app; nothing is
processed in a cloud; the code follows the ponytail ladder.

**The open plans:**
- [CLOUD_SOURCES_PLAN.md](CLOUD_SOURCES_PLAN.md) — documents from Microsoft 365 and synced folders. Nothing built, and
  **on hold** (owner 2026-11-06): a request from the school's administrators; nothing starts before they and IT say go.
  The school has no Google Workspace.
- [IDE_PLAN.md](IDE_PLAN.md) — LOL Vibe's IDE. Slice 7 and §5 B/C are open.

---

## 1. Now

1. **The human testing phase** (owner 2026-11-09): client v0.2.16 and Farm app farm-v0.0.52 carry the review's fixes, the
   owner's decisions of 2026-11-06 and 09 and Gemma 4 26B. Run the ★ list of [HUMAN_TESTS](../HUMAN_TESTS.md) in its order;
   each finding goes back here.
   - *Found 2026-11-10:* the Farm app's **Check for updates** said *Couldn't check: GitHub API 403*. GitHub's API allows 60
     requests an hour to everything behind one public address, and the school's network had used them up. Fixed on
     `multiuser-phase0`, for the next releases: the update check, the wizard's downloads and the client's chat engine and
     coding agent no longer use the API. Until then, try again after the hour.
   - *Found 2026-11-10:* the default model, Gemma 4 12B, was weak (owner). Done on `multiuser-phase0`: the farm ships
     **Gemma 4 26B** for documents, pictures and a little code on 24 GB and above, and Balanced brings a farm to it
     (measured: [RESULTS "Ollama's default"](../spike/RESULTS.md#ollamas-default-rtx-pro-6000-2026-11-10)). It reaches
     operators with farm-v0.0.53 (the owner's go); then HUMAN_TESTS **K14** and **K15**.
2. **The ★ list** in [HUMAN_TESTS](../HUMAN_TESTS.md) (proposed 2026-11-05): agree it, then run it in its order.
3. **On the PRO 6000, at a quiet hour:** install farm-v0.0.52, then J14 and J15. J14 is Update vLLM 0.30.0 → 0.33.0,
   which takes it from 32 to 48 people at 64k every turn. J15 is Gemma 4 26B from the panel. **M**, the owner's hour.

## 2. Next — the most value for the office

**New models, measured 2026-11-06** ([RESULTS](../spike/RESULTS.md#model-trials-rtx-pro-6000-2026-11-06)): nothing beats Qwen3.6 for a class,
and it serves more than we said. Gemma 4 26B is LOL Vibe's coding model since 2026-11-09 (owner), in Flint's place. Nanbeige4.3 and Apex-35B are not for this farm.

1. **The class-size test through the seat gate** (HUMAN_TESTS J16): 48–64 people at 64k, 30 at 128k. It is the only
   proof of "a class of 50", and the purchase table rests on it. The harness measured Qwen3.6 at 64 people on Open WebUI's
   traffic shape (2026-11-06): if J16 agrees, the capacity page goes from 48 and 96 to 64 and 128. After Now 3. **S**.
2. **One PDF must not hold the shared GPU:** a page cap and a stop between pages when the client leaves (OCR's
   `pysvc/server.py` reads every page), and an upload cap like speech to text's 25 MB (the owner: 100 MB?). OCR runs
   outside the seat gate. **S**.
3. **Web search under a class's burst** (one public IP), then the owner decides whether it goes back on by default.
   **S**.
4. **Tests before a release:** the farm suite, the Farm app's test, and the shell's unit, chat-unit and lint, in
   `release.yml` and `release-farm.yml` (a workflow_dispatch dry run first). No release since v0.2.10 ran its ★ tests,
   so the automatic suites should at least block one. The owner: CI minutes. **M**.
5. **Slow down wrong admin-token guesses** on `/lol/admin/*` (a delay per 401, as `/lol/plugin-keys` waits 400 ms).
   The token guards the whole panel on a LAN of students. **S**.
6. **Small hardening:**
   - a main-frame navigation guard on the client's window (`index.ts` returns for the main frame);
   - make the Trigger's gap check and its start record one step (an `await` sits between them);
   - a timeout before a download's first byte in the Farm app's wizard (a server that never answers hangs it).

   **S**.
7. **A plugin's first install shows its progress** (Voice takes about 10 minutes behind a "…"). The owner picks: in
   the download slot, or as a job that tells the laptops the farm is busy. **M**.
8. **The IDE's model line agrees with the farm's proven list** (`projects/models.mjs` calls Qwen3.6 untried; Gemma 4 26B
   is good there since 2026-11-09). The owner: does Qwen3.6's 7–11/15 count as good at edits? **S**.
9. **The client says when a farm is older than it expects.** Farm updates are manual, and older farms refuse newer
   settings. The owner: the minimum version. **S**.
10. **Prune old coding-agent session logs** in `DATA_DIR/lol-studio/dsh` (IDE_PLAN slice 7). **S**.
11. **The coding agent's fence check on macOS and Linux** (`sandboxBlocked` checks only on Windows). After HUMAN_TESTS
    E4. **M**.
12. **Measure Ripple-65B Preview**, a dense model tuned for coding: about 4–13 people at 64k on the PRO 6000 by
    estimate, so a small group's model at best. It needs a vLLM nightly in a root of its own, after Now 3
    ([the study](../research/RIPPLE_65B_STUDY.md)). Nanbeige, also dense and tuned for agents with a shell, did 5/15 on our
    fenced agent: expect the same risk. **S**, the owner's quiet hour.

## 3. Later

- **The farm:**
  - free a person's seat when they quit (D-F1; "Free an idle seat after" covers it today);
  - load signals (busy, queued, perf) for Ollama (D-F2);
  - vision from Ollama's `/api/show` instead of the name pattern (D-F4);
  - per-host slots on a multi-host Ollama farm;
  - split `up.js` (5,300 lines);
  - a systemd user service for a Linux farm nobody logs in to (after HUMAN_TESTS M2);
  - the fair queue, Prometheus metrics, the planner learning from bench, and vLLM's speculative decoding, only if
    the gate's counts after real classes show refusals.
- **LAN model sharing between farms** (multi-user 4.1). **L**.
- **LOL Vibe polish:**
  - publish the farm on every change in the Open WebUI build (D-C3);
  - a notification click brings the window forward (D-C7);
  - a cached thread path (D-V1);
  - the plural string (D-U2).
- **Test hygiene:**
  - retire the old chat-scope gate;
  - `npm test` runs the chat suites;
  - vllm-lifecycle's stopped-503 assertions follow the new code (needs WSL);
  - the CRLF fixture.
- **Split DEVLOG.md** at 2026-10-01 into the archive.

## 4. Waiting on the owner

**The ones that unblock the most:**
1. **The next release and the ★ list** (Now 1–2), and which build tests today's fixes: a local build or a pre-release
   tag.
2. **A quiet hour on the PRO 6000** (Now 3, then Next 1).
3. **May vLLM's own model read documents** instead of a second gemma4:12b? It frees 9 GB, about 14 % more room for
   conversations (multi-user decision 6). **M**.
4. **CI minutes for the tests** (Next 4).
5. **CLAUDE.md:**
   - cut it to about 350 lines, with the details moved to the READMEs and each one checked there first;
   - change it only when a rule, the contract, a port or the map changes;
   - reword invariant #4 to the calls the contract table lists (it says "admin REST API", which the app never uses).

**Choices to make, one line each:**
- **The farm:**
  - an OCR upload cap of 100 MB, or another number;
  - FSV-2's progress, (a) or (b);
  - the panel's text for an Ollama the farm did not start (FSV-7);
  - a panel change after a terminal pick writes the picked list whole (FEN-2): fix it, or leave it;
  - CLI farms whose file says `vllm.version 0.30.0` (FEN-3): follow the farm, or a README line;
  - a preset also sets "Free an idle seat after";
  - Ollama's people at once applied without a restart;
  - speech to text on by default on NVIDIA, Qwen3-Omni as the transcriber, and vLLM on a 16 GB card (DEVLOG
    2026-10-10).
- **The client:**
  - Open WebUI's terminal links now open nothing (xterm's blank window): accept it, or allow a blank window;
  - refuse the bus's WebSocket port 8893 in Fetch/Send;
  - LOL Vibe's wait sentence while vLLM starts;
  - LOL Vibe's old discussion items (D-C6 screen capture, D-C8 mailto, D-F7 OCR progress, D-F8 a farm page fetch,
    D-O1 *Continue in Open WebUI* as a file, D-O3, D-U1, D-U6, D-S1).
- **The Computer:**
  - which unbuilt plan items still matter: a Section that carries its boxes, wires in their kind's colour, lesson
    buttons on more errors, five lessons, seven templates, a Data/table box;
  - Converse phase 2: events out to devices, speech to text on the laptop, lesson 15, several voices, a bot that
    speaks first;
  - may a model set a Send box's network target, or is it person-only like the USB port;
  - may a calendar's descriptions go to a model;
  - real ids for the home templates.
- **The Studio and the IDE:**
  - the designer bench and the board bench: wanted, as skills or boxes, or dropped;
  - IDE §5 B *Open in the Computer*;
  - which agent-skills project.
- **ComfyQ:** booking jobs from the chat (images, video, audio). Build it, park it or drop it, now that the prompt
  tools shipped.
- **Licences:**
  - p5.js's LGPL relink, wired or recorded as open;
  - who checks Flint's licence with Recursive (its GGUF says flint-preview, its card Apache 2.0).
- **Shipping:**
  - installed Farm apps fetch new runtime pins, or new installs only;
  - pin python-build-standalone for the client's sidecar;
  - commit the spike's vLLM logs.
- **Housekeeping:**
  - only if F: needs the space: WSL's disk file there keeps the 106 GB the test models freed (2026-11-10) until it is
    compacted, which needs `wsl --shutdown` and so stops the farm's vLLM (a quiet hour);
  - `bench/quant-ladder`, not merged: a tag, or `docs/spike/quant-ladder/`.
- **The record:**
  - how vLLM got into `~/lol-vllm` on the PRO 6000 (decides J1);
  - which Farm app runs there now;
  - what your client's About shows (decides C3);
  - A9's 362.7 million;
  - whether B3–B5 and J12–J13 on llama.cpp are still wanted.
- **Kept as "later", or dropped:**
  - the laptop model study (4.3);
  - a laptop fallback for document search once Open WebUI can load EmbeddingGemma 2;
  - Home Assistant's live push;
  - the Art-Net network card on a laptop with several.

## 5. Parked or dropped

- **Online documents** ([CLOUD_SOURCES_PLAN](CLOUD_SOURCES_PLAN.md)): the folder way, then the Microsoft 365 steps, all on
  hold until the school's administrators and IT give the green light (owner 2026-11-06). The plan keeps its decisions
  and its open questions, among them which formats `docs_save` may write and who administers Microsoft 365 (IT).
- **Several boxes behind one endpoint, and cache affinity:** parked until a second PRO-class card ("scale up, not
  out", 2026-10-04).
- **The small GPUs as farm capacity:** dropped 2026-10-04 (booked for 3D and VR).
- **Per-person identity:** dropped 2026-10-04; seats stay keyed by IP.
- **QVAC plugins, overflow, TLS:** cut 2026-10-04.
- **A gate that bypasses LiteLLM:** not built, 2026-10-05.
- **RAG, uploads and tools inside LOL Vibe (P3/P4):** replaced by the Studio vision, 2026-09-15.
- **Any new call into Open WebUI** (online documents included): dropped 2026-11-05. A layer in our app instead.
- **"Keep me signed in" and shared computers:** dropped 2026-11-05 (clients run on people's own computers).
- **The model may look on personal Google accounts:** not offered, 2026-11-05. The person is told why.
- **Flint on llama.cpp or Ollama for the coding agent:** not adopted (2026-10-23, 2026-11-02; ollama#19191).
