# DEVLOG — LlmOnLan

A running, dated log of what was built, how it was tested, and decisions taken. Newest first.
Each milestone lands as one (or a few) granular commits; an entry here is written **before** the
commit so the history records that a feature was tested + documented before it was pushed.

**Entries before 2026-10-01** (the scaffold of 2026-06-29 to the Home Assistant release of 2026-09-30) are in
[archive/DEVLOG_2026-06_to_09.md](archive/DEVLOG_2026-06_to_09.md): search both when a date is older.

---

## 2026-11-14 (04:25) — The Computer's text answers lose a thinking model's leading blank lines

Found running lesson 1 in the real app on the live farm (Qwen3.8 on vLLM): the haiku reached the Text box as
`"

Gray waves…"`, two empty lines first. `app/ask.mjs` text lane: the box's value drops leading blank lines
(`/^(?:[ 	]*?
)+/`), keeping the first line's own indent; `raw` stays as received. Test: `ask.test.mjs` *text() drops
the blank lines…*; `npm run test:chat` 1,963 passed, lint 0; checked in the real app: *"Sea winds whisper low…"* from its
first line, 4.1 s. Also read, not changed: the text lane never sends "think off" (by design, `ask.mjs` 455), so the
Instruction and Creative coding think on Qwen3.8 (12,025 tokens, 188 s for one sketch): a question for the owner.
Measured after (04:30): the Computer's Creative coding request captured from the real app (a `fetch` wrapper over CDP)
and replayed through the gate: as sent 151–207 s, 8,005–11,026 thinking tokens; with `chat_template_kwargs.enable_thinking:
false` 13.6 s, 0 thinking; all three follow the box's rules. The same brief asked plainly thought only 133 tokens (21 s):
the box's rule list is what makes the model think long.

---

## 2026-11-14 (04:21) — A student's path in the real app on the live farm; the class sheets drafted

The next item of the queue (night n° 4's objective), started once the night's objective was done. A dev client
(`electron .` from `shell/`, `--user-data-dir` in the session's scratch folder, CDP on 9341, `LOL_DSH_DIR` at the installed
coding agent), the screen locked (`forcePageVisible`), pinned to the live farm with one click on its card (12 s).
- **The Computer's sandbox runs in the real app:** a p5 Preview in 213 ms, a three.js scene with `lol.orbit` in 101 ms,
  sandbox *ready*, no errors. The harness's `k11` failure (DEVLOG 03:41) is the harness's own.
- **LOL Vibe:** a question answered, first token 0.26 s, 61.6 tok/s; **Stop** ends the reply in 111 ms, and vLLM's
  `num_requests_running` is 0 three seconds later (the farm's `busy` lags by a refresh).
- **Project ▸ New project ▸ "Make index.html: a page with a bouncing ball":** the coding agent wrote it in 58 s (4 steps), and
  the Preview opened by itself on `127.0.0.1:<port>/index.html`. The same request in plain chat (no project): 106 s of
  thinking, 13,775 tokens, the page as a code block (the owner's field note of 2026-11-13).
- **The Computer's *Creative coding* template:** ran end to end (`ask` and `preview` done), **188 s, 12,025 tokens**
  (one call, nearly all thinking), alone on the farm.
- **Automatic picked a Spark first:** the fresh client chose spark-59f9 (2 seats) over the PRO 6000 (36): the
  least-busy rule ties farms within 15 points and picks at random (`farmSelect.ts`). One click on a card pins it.
- **`docs/CLASS_SHEETS.md`** drafted from these facts: the students' sheet and the owner's (each message, its meaning, what
  to do). Not checked: the Tour and lesson 1's words, Open WebUI with a PDF in the real app (night n° 4).
- Everything started here was stopped (`taskkill /T` on the dev client's launcher; no process with the scratch profile
  left); the live farm unchanged by it.

---

## 2026-11-14 (03:41) — 30 people for the class: Qwen3.8 on llama.cpp and on vLLM, against Qwen3.6 (night n° 3)

The owner's objective for tonight (2026-11-13, 16:00): measure both engines for 30 students on the live farm, the session
switching it; Qwen3.8 preferred if it holds 30. The live farm was found at 01:49 on llama.cpp, Qwen3.8-27B NVFP4-MTP GGUF,
`parallel` unset (1 seat), 262k shared. Everything was switched through the panel's own API (`/lol/admin/*`, the admin
token read from the config, never printed). Table and raw results: RESULTS ▸ *30 people for the class*.

- **llama.cpp, Qwen3.8, 16 seats** (the farm's cap, `setSlots`/`applyFarmSettings` 1–16): 16 people at 34 tok/s each;
  30 from 30 addresses: **14 refused**; 30 from one address: first token p95 44 s. A scratch llama-server with
  `--parallel 30` beside it (not the farm): 30 short chats at 22.5 tok/s each, but with 8k conversations it fails at 16
  (p95 23 s) and collapses at 30 (p95 111 s, 2.4 tok/s). **Out.**
- **vLLM 0.30.0, Qwen3.6, 64k, 48 seats (Automatic):** passes every shape at 30 (short: p95 0.4 s, 80 tok/s; ~50k
  conversations: p95 3.3 s, p10 28).
- **vLLM 0.30.0, Qwen3.8 (downloaded tonight through the farm, 21.9 GB), 32 seats by hand:** at 64k it passes short
  chats and 8k conversations at 30 but collapses at ~50k (the pool holds 22 whole 64k conversations); **at 32k it passes
  near-full conversations at 30** (p95 2.5 s, p10 20.6). Its coding agent: 12/14 at 64k (three at once), **13/15 at
  32k beside 27 people chatting** (216/216 answered, p95 0.5 s, 41 tok/s); Qwen3.6 scored 7–11/15 on earlier nights.
- **Left on vLLM · Qwen3.8 · 32k · 36 seats** (03:56; 36 short-chat people from 36 addresses and near-full conversations at 36 pass: p95 3.1 s, p10 18.2), persisted; the seat release put back to 900 s (60 s during the benches).
  Changed on the way: `llamacpp.parallel` 1 → 16 (unused while vLLM serves).
- **The Computer's harness** (`--phase k`) failed 43 of 217 both under load and on a quiet machine, from the first k11
  scenario on (*The sandbox could not start*); `--phase k8` alone passes 35/35; k11 alone fails (repro:
  `--only k11-edit-model-code-with-lol-orbit-and-the-mouse-draws-in-the-guest`, 6.3 s). No shell code changed since
  the 216/217 of 11-12 22:15. Ruled out tonight: load, and Chromium's occluded-window backgrounding (two switches added to
  the harness, reverted). The screen was locked (LockApp running); not ruled out. Not settled.
- **Checked at 32k through the live gate:** LOL Vibe's chat sends no `max_tokens`, the Computer 2,048/4,096; the coding agent never hit the window (a 92 KB file read in pieces, 75k input tokens, passed in 7 min); a picture is read. `max_tokens` 32,768 on this window is refused (400): `litellm.js`'s comment that vLLM 0.30 clamps it is wrong. Open WebUI injects whole documents at ≥ 24,576 (`RAG_FULL_CONTEXT`), so about 30–40 text pages fit one chat. The sandbox with a 20 s start limit (reverted): the run starts and never finishes, so broken, not slow.
- **Not done:** J14 (vLLM 0.33.0): the class passes on 0.30.0, and replacing production's vLLM three days before the
  class is a risk with no gain for it; PDFs through OCR under load (no PDF library on this box's Pythons to make a
  scanned file; OCR's model, gemma4:12b 8.5 GB, fits beside Qwen3.8: `ocrFits` true, 17 GB free).
- **Seen, not explained:** through the farm on llama.cpp, short questions waited 6–7 s for a first token at 16 people
  where llama-server alone gave 1.3 s; on vLLM the same path gave 0.2–0.4 s. The Qwen3.8 download fell to 0.3 MB/s for a
  minute, then ran at 28 MB/s.

---

## 2026-11-13 (08:48) — The OCR caps: 200 pages, 100 MB (plans ▸ 2. Next 2, the owner's numbers); the class's plan

**The owner's answers, 08:40:** the releases after A24 and K16; Super VL with remote code, once; the Kolibri-1 and
LFM2.5 weights deleted (done, `~/lol-models-scratch` keeps Super VL's 70 GB); pruning by age, 30 days; the OCR caps,
200 pages and 100 MB, "a good start". And **a class of 30 students on Tuesday 17 November**, so chat, LOL Vibe and the
Computer must be tight that day: [plans/CLASS_TEST_2026-11-17.md](plans/CLASS_TEST_2026-11-17.md) holds the risks, the
nights until then, two freezes and the owner's questions; the session summary's next objective now points at it.

**The caps** (`farm/src/pysvc/server.py`), built before the Farm app release so one release carries K16 whole:
- **Pages:** `_extract_pdf` reads `min(page_count, MAX_PAGES)` pages; past the cap a last page says *Pages 201 to N were
  not read … Split the file to ask about the rest*, and the log says *document: N pages; read the first 200*. The upload
  still succeeds: in Open WebUI a refusal is a failed upload, and the first 200 pages are useful.
- **Bytes:** `process` refuses a declared `Content-Length` over `MAX_BYTES` before reading, and counts a chunked
  upload as it streams in (Open WebUI streams its file), 413 *at most 100 MB per document*, as speech to text does with 25 MB.
- `OCR_MAX_PAGES` and `OCR_MAX_MB` in the farm's environment change them (as `OCR_CONCURRENCY`); no panel setting.

**Tested:** `check_services.py` (the stt venv, `PYTHONUTF8=1`): the defaults are the owner's numbers; a 6-page stub PDF
under a cap of 4 reads pages 0–3 and adds the note page; 11 bytes over a cap of 10 → 413, the same chunked → 413, 10
bytes → 200; all passed. `node test/run.js` 288 passed. Not run against the real service under uvicorn, nor in the app
(HUMAN_TESTS K16 step 4).

## 2026-11-13 (03:38) — The DEVLOG split at 2026-10-01 (plans ▸ 3. Later)

The 150 entries from 2026-06-29 to 2026-09-30 (6,774 lines) moved to `docs/archive/DEVLOG_2026-06_to_09.md`; this file
keeps the 95 entries from 2026-10-01 on (~4,000 lines) and says where the older ones are. **Checked:** a script asserted
every header above the cut is 2026-10-01 or later and every one below is earlier; 245 entries before and after; both
parts identical to the original byte for byte (before the links); the archive's 181 relative links got `../`, and every
target exists on disk. No link anywhere pointed at a DEVLOG anchor. `docs/context/repo-layout.md` names the archive.

---

## 2026-11-13 (03:35) — An abandoned PDF stops at the next page (plans ▸ 2. Next 2, its part with no number)

`farm/src/pysvc/server.py`: `process` starts a watcher (`request.is_disconnected()` every second) beside the thread that
reads the document; `_extract_pdf` checks the event before each page and stops with 499 and a log line that counts pages
("stopped after 2 of 10 page(s)"). The page being read finishes (one vision call). The page cap and the upload cap wait
on the owner's numbers. **Tested:**
- `check_services.py` (run by `node farm/test/run.js` from the stt venv): a stubbed six-page PDF stops after page 2 with
  499 when the client leaves during it; with no one leaving, 6 pages. Without the check in `_extract_pdf` the first fails.
- The real service under uvicorn from `farm/.extract/venv`, a stub vision model taking 2 s a page, a 10-page PDF in
  vision mode: a client that gave up at 3 s → 2 vision calls, then "stopped after 2 of 10"; a client that waited → 10
  calls, 200. (A first run gave a 500 on the summary line's "→": my harness lacked the `PYTHONUTF8=1` `extract.js` sets.)
- `farm/test/run.js` 288 passed.
**Not checked:** whether Open WebUI closes its request when a person leaves an upload; the stop also covers its own
request timeout and a client that restarts.

---

## 2026-11-13 (03:29) — The small hardening settled (plans ▸ 2. Next 6)

- **The Farm app's wizard no longer hangs on a server that accepts and never answers.** `runtimeManager.ts` `downloadTo`
  had a 60 s stall timer that arms only once a response arrives; it now also passes `timeout: 60000` to `https.get` with a
  `'timeout'` handler that fails the download ("no answer for 60 s while downloading …"), so the phase can retry. Its
  `httpGet` (the GitHub API fallback when a pinned file cannot be fetched) gets 30 s. **Checked:** a scratch script against
  a TCP server that accepts and stays silent errored at 1,010 ms of a 1,000 ms timeout; `farm-app` `npm test` 14 passed
  (build included). No test of `downloadTo` itself: it is HTTPS-only and not exported.
- **The client's main-frame guard was already there** (ec67ceb, 2026-11-06: `index.ts` `will-frame-navigate`).
- **The Trigger "race" is not one:** `trigger.mjs` `onEvent` awaits `door.armed()` before both the gap check and the
  start record, which then run in one synchronous step. Nothing changed.

---

## 2026-11-13 (03:27) — A wrong admin token waits 400 ms (plans ▸ 2. Next 5)

`farm/src/selfServer.js`: `refuse(res)` waits `GUESS_DELAY_MS` (400) and answers 401; `/lol/plugin-keys` used it inline
already, `/lol/admin/*` answered at once. Both now go through `refuse`. A `ponytail:` note names the ceiling: a fixed
delay per request, not a lockout per address (parallel guesses each wait). **Tested:** `farm/test/run.js` 288 passed;
the admin test now asserts a wrong token takes ≥ 350 ms and the right one < 350 ms; with the delay set to 0 it fails
("17 ms"), restored. The suite takes ~4 s longer (its other 401 checks wait too). Docs: farm README ▸ routes,
`docs/context/farm.md` ▸ Admin panel.

---

## 2026-11-13 (03:22) — The model research measured: Kolibri-1 and LFM2.5 against Qwen3.6; keep what the farm runs

Session 2's objective (the owner, 2026-11-12: state-of-the-art local models for many people on documents and code, on
the PRO 6000 and the Spark). `docs/research/MODELS_2026-11-13.md` §5–§6; RESULTS ▸ *New models for a class*.
- **Kolibri-1 FP8** (Aleph Alpha, 78B / 3.5B active): gate 24/28 and 22/28, coding agent 10/15, every planted fact found
  with thinking off, the hard comparison 13/18 with thinking on (Qwen3.6 71/72 overall). On FlashInfer (vLLM's pick) its
  decode collapsed at long context (11.8 tok/s each for 4 people at 62k); `--attention-backend TRITON_ATTN`: 101 each,
  32 people at 30k and ≥ 24 at 62k on a 16 GiB pool. vLLM's startup line counted 12.6 people of 64k; its own gauges showed
  24 distinct 62k contexts running with the pool 92.4 % full. Does not fit beside the farm's reserves.
- **LFM2.5-24B-A2B FP8** (Liquid, 24B / 2.45B active), served in the 48 GiB pool the farm's `poolGib` gives it: gate 26/28,
  coding agent 7/15, 250 tok/s for one, 64 people at 30k and 32 at 62k (memory the limit, pool 99 % full at 40). Always
  thinks (no switch). Missed 20 of 174 planted facts: 11 wrong answers, 9 empty.
- **Nemotron 3.5 Super VL** not served (remote code refused, DEVLOG 22:22): the owner's question.
- **Recommendation:** keep what the farm runs on both boxes: Qwen3.6 for documents and, through the LOL Vibe preset, for
  code (Gemma 4 26B stays the best coder measured, with fewer people). No farm change. Catalog and
  `measured.json` not touched: `presets.js` reads them, and neither model should become a pick.
- Corrections made on the way: §5 first said Kolibri's windows saved less memory than they do, and computed it at ~8 people
  as a farm (the margin is 8 % of the whole card: it does not fit); both fixed from vLLM's gauges and `poolGib`.
- `download_verify.sh` takes `<repo> <folder>`. The trial weights stay in `~/lol-models-scratch` (Super VL 70 GB,
  Kolibri-1 74 GB, LFM2.5 25 GB) until the owner decides on Super VL.

---

## 2026-11-12 (22:22) — Super VL refused by vLLM 0.33.0 without remote code; the sandbox failure not reproduced

- **Nemotron 3.5 Super VL NVFP4** downloaded (20:15–22:02, 92 files, every sha256 matches). Launching it with
  `--trust-remote-code` was refused by the session's permission check; without it vLLM 0.33.0 stops while loading:
  `'NemotronH_Omni_Reasoning_V3_Config' object has no attribute 'vit_hidden_size'`. vLLM's own config class for
  `nemotron_h_omni` lacks the field; the checkpoint's `configuration_nemotron_h_omni.py` defaults it to 1280 and
  `config.json` leaves it out. Not patched, not worked around: a question for the owner (research draft §5).
- **Kolibri-1 FP8** needs no remote code (no `auto_map`; `Kolibri1ForCausalLM` and `kolibri1` are built into vLLM 0.33.0
  and Transformers 5.20.2). Downloading at ~9 MB/s.
- **The sandbox failure of the evening entry below did not come back:** at 22:15 on the same tree, `--phase k` 216/217
  (every sandbox scenario passed; `k3-control-branches` timed out once, then passed alone in 2.6 s), and the 500x200
  repro alone passed in 863 ms. **The mechanism written below was wrong:** after a boot timeout `destroyFrame` clears the
  frame, and every later `compute`/`run` calls `boot()` again and builds a fresh frame (`sandbox/host.mjs`); nothing stays
  `disabled`. Each sandbox box then waited out its own 3 s. What slowed every boot that evening is not known. The plans
  entry (▸ 4 ▸ The Computer) now says "not reproduced; watch".

---

## 2026-11-12 (20:58) — Qwen3.6's RAG baseline, a hard RAG check, and "Save a usage report"

The owner (~20:40): carry on now, autonomously, no farm or client running. Two pieces of work:
- **The RAG baseline** (research draft §4): Qwen3.6 served from `~/lol-vllm-033` (production's weights read) found every
  planted fact at 30k and 60k with 1 to 16 people. Too easy to tell models apart, so `rag_check.mjs --hard` plants an outdated
  value of each fact 30 % further on and adds a comparison question. Thinking off: the comparison right 10/49, the deep fact
  33/48; thinking on: 71/72. Chats in Open WebUI think by default; the farm's quick tasks and the Computer's boxes do not.
- **"Save a usage report"** (INSIGHTS_PLAN §6.5 / §7.1, approved 2026-11-12): `shell/renderer/chat/core/usage.mjs`, a pure
  module (storage and clock passed in, in lint's pure list): per day, counts from a frozen list (`open.*`, `vibe.*`, `run.*`)
  and timings (`vibe.first_word_ms`, `vibe.reply_ms`, `vibe.tokens_per_s`, `run.ms`) plus the Computer's box types from the
  code's own registry; a name off the lists or a value that is not a finite number is never recorded; the report is built
  from the lists, never copied from storage, so planted garbage cannot leak; kept 30 days; recording never throws. Hooks:
  `app.js` (the surface switch), `chat/main.mjs` (`STREAM_END`, a local row skipped), `computer/host.mjs` (after a run, in a
  try, no new await). Preferences ▸ **Usage report** says what is counted and saves the JSON through `transfer.mjs`
  `download`. Nothing is sent; `privacy.md` says so. Templates opened: left out (a shipped id would need its own list).
- **Tested:** `usage.test.mjs` 5/5 (hostile names, values, box types, planted storage, a throwing storage); harness
  `k29-usage` passed after it caught a bug the unit test could not (`specMap()` is a Map: `Object.keys` gave no box
  types); on the final tree (22:09) `npm run test:chat` 1,962 passed and lint 0 violations, after renaming `computer.*`
  events to `run.*` (lint's string rule read them as text keys); `npm run test:unit` 30 passed. **Not exercised:** the save dialog and the surface counts
  (the harness has no `app.js` and cannot click a native dialog): HUMAN_TESTS **A24**. One harness test skipped for a reason
  of its own: ComfyQ's checkout at `E:/ComfyQ` moved to 8d27899 (the committed prompts come from 5d19e35).
- **The harness's `k` family did not pass** (175 then 174 of 217; 216/216 on 6 November): from the first scenario that
  starts the Computer's sandbox, every sandbox scenario failed with *The sandbox could not start*, just past the 3,000 ms
  boot limit, and every other passed. Ruled out with controls: the evening's changes (`k5` failed the same with them
  stashed), importing a graph first (the 500x200 scenario fails alone), RAM (105 GB free). A GPU nearly full was my first
  explanation and a free-GPU run contradicted it. `--phase k8` passes 35/35 (its first boot succeeds). Likely mechanism, not
  proven in code: a page's first boot overruns 3 s and the host keeps `disabled` for the page. Filed with its repro
  (`docs/plans/README.md` ▸ 4 ▸ The Computer); the usage report does not depend on it.

---

## 2026-11-12 (20:17) — The model survey, the fit, and tonight's two downloads

Tonight's research (the owner, 19:58), its daytime half. Three read-only Haiku readers surveyed new open-weight models, the
engines, and independent evidence; their reports with every URL are `docs/research/MODELS_2026-11-13.sources.md`, the draft is
`docs/research/MODELS_2026-11-13.md`. Found: vLLM 0.33.0 is still the newest; **no independent long-document result exists for
any model in our size range** (so the RAG check is the evidence); new candidates **Nemotron 3.5 Super VL** (120B/12B, hybrid
Mamba, pictures, NVFP4 75 GB) and **Kolibri-1** (78B/3.5B, sliding windows, long-document claims, FP8 79 GB); Ripple-65B's
architecture is not in vLLM 0.33.0 (queued, as the plans list said). The fit (`docs/spike/runs/fit_estimate.mjs`, the farm's own
Automatic rule) shows the 9 GiB document-reading reserve leaves a 70 GB model a 2 GiB pool on the PRO 6000: the owner's open
question on letting vLLM's model read documents decides whether such a model can serve a class. The estimator runs optimistic
(Qwen3.6: 99 estimated, 64 measured). Downloads began 20:15 (`docs/spike/runs/download_verify.sh`: one at a time into
`~/lol-models-scratch`, each file checked against Hugging Face's sha256).

---

## 2026-11-12 (20:03) — A RAG check for the model research (`docs/spike/runs/rag_check.mjs`)

Tonight's objective (the owner, 19:58) is a model survey for a class on the PRO 6000 and the Spark, RAG and code; the 28-item
gate measures no answers out of long documents. `rag_check.mjs` sends a whole document in the prompt, as Open WebUI's
full-context mode does: a slice of the DEVLOG (real text no model has seen) with three made-up facts planted at 10, 50 and 90 %
of its length, at the sizes asked (30k and 60k by default), by several people at once, each with their own slice and facts so no
prefix cache shares the work. A fact counts when the reply holds its value; misses are kept by depth; `usage.prompt_tokens` is
recorded beside the estimate. **Checked** against a stand-in server that reads the document and misses every fact past 85 % on
purpose: 2/3 and 8/12 found at both sizes, the misses all at depth 0.9, prompts at 30,100 and 60,100 tokens. The survey of
models, engines and evidence started at 20:05 (three read-only Haiku readers).

## 2026-11-12 (11:03) — Field notes: what teachers met, read first by every session

The owner accepted the suggestion: `docs/sessions/FIELD_NOTES.md`, where the owner writes a line after a class or a day
of use (no names: the repo is public). Every session reads it before the summaries; an open note outranks the session's
own ideas, and a session that acts on one answers under it (`→ date: what was done`). CLAUDE.md, the skill `lol-session`
(which now counts only the dated `20*.md` files for the session number) and the sessions README say so.

## 2026-11-12 (10:56) — The process, sharpened by the owner: one objective, approved work only, a night backup

The owner, on the review of the workflow (10:52): one main objective a session with a *Done when* and at most one side
task; code only from what the owner approved; human tests prepared so they take minutes, and `RELEASE READY` early for
small batches; a backup push of each commit to a branch, tags and releases still the owner's. The owner also switched
the session left open to Opus 5.5, in auto mode.
- **CLAUDE.md ▸ *How we work*,** the skill `lol-session` and the summary template carry it. "Approved" is checkable: an
  item of `docs/plans/README.md`'s *Now*, *Next* or *Later*, or a plan whose status line reads `Status: approved by
  the owner, <date>` (INSIGHTS_PLAN §6.5 and §7.1 are marked so).
- **The backup:** exactly `git push origin main:night`. Checked first: release builds start only on `v*` and `farm-v*`
  tags; `build-llamacpp-arm64` and `build-dsh-runtime` start on a push to `main` when their files change; `night`
  starts nothing (none ran after the first push, `21ee658`). `push.followTags` is unset.
- The memory notes on pushing and on agents follow. Session 1's summary holds the next objective in the new shape: build
  "Save a usage report", with *Done when*, the side task (check `docs/context/farm.md`) and the queue (prepare K14).

## 2026-11-12 (10:32) — Release client v0.2.17 and Farm app farm-v0.0.53 (the owner's go)

The owner, on the work of 2026-11-10: *"go then"*. Also from the owner today: sessions run five hours, 02:00 to 07:00, from a
cron on the Claude Code session left open; work is committed on `main` and never pushed by a session; a session flags
`RELEASE READY` in its summary and a person tests before a tag; the GPU may be used beside the live farm, clients connected or
not; "Save a usage report" (INSIGHTS_PLAN §6.5) is to be built first. Written into CLAUDE.md and the skills.
- **Client v0.2.17:** the chat engine and the coding agent are found by their download links, never the GitHub API (60
  requests an hour for a whole school behind one address).
- **Farm app farm-v0.0.53:** the same for its update check and its wizard's downloads; the farm ships **Gemma 4 26B** for
  documents, pictures and a little code on GPUs of 24 GB and above, with Gemma 4 12B kept to read scanned pages beside vLLM;
  **Balanced** brings a farm to it; reading documents beside llama.cpp uses the 8 GB reader while the default is the shipped one.
- **Before the tags**, on the tree released: `farm/test/run.js` 288 passed; the Farm app's `npm test` 11 + 3; the client's
  `npm run test:chat` 1,958 passed, lint 0 violations.
- **For a person, after it:** HUMAN_TESTS K14 and K15 (★ row 5), and N4 on the school's network.
- **CI** (checked 11:22): both green. Client v0.2.17: 09:33 → 11:07 (local), all six jobs; Farm app farm-v0.0.53:
  09:33 → 09:36 UTC, all four. Assets complete: the client's five installers (+ blockmaps), four `latest*.yml`
  (`latest.yml` says 0.2.17), five Open WebUI bundles + `owui-sidecar-manifest.json` (0.11.4, `bundleRev` 2), five
  coding-agent runtimes; the Farm app's Windows, macOS arm64 and Linux arm64 builds (a prerelease, as always).
  `releases/latest/download/owui-sidecar-win32-x64.tar.gz` now redirects to v0.2.17's, the client's new lookup.
  A "What's new" heads each release's notes, CI's text kept below.

## 2026-11-12 (10:20) — The work runs in sessions; CLAUDE.md becomes a core and eleven context modules

The owner: daily sessions that read the five last dated summaries and write one; Sonnet 5.5 runs, three read-only Haiku 5.5
explorers, Opus 5.5 as advisor at three moments; every fifth session an adversarial review; CLAUDE.md rewritten around it.
- **CLAUDE.md: 1,173 → 172 lines.** The detail moved verbatim, by line range, to `docs/context/` (status, overview, farm,
  client, computer, owui-contract, discovery, design, release, repo-layout, privacy), links re-based and checked. The prime
  directive and the conventions are unchanged. New: the table of modules and *How we work*.
- **`docs/sessions/`:** the README (template and rules) and session 1's summary, with the questions for the owner.
- **`.claude/`** (force-added past this checkout's local exclude): `settings.json` (`model: sonnet`, `advisorModel: opus`),
  the agents `search`, `grep`, `docs`, the skills `lol-session`, `lol-review`, `lol-scratch-farm`.
- **`docs/plans/INSIGHTS_PLAN.md`:** opt-in usage statistics, as a plan that waits for the owner: it changes "the farm stores
  nothing".
- Not done: the 2 am schedule (no `claude` CLI on this computer, and the owner's decisions on length and permissions), and
  "JEV" (in no Anthropic documentation). The modules are moved, not yet checked against the code.
- Tested: `farm/test/run.js` 288 passed (its docs test reads every `.md`), `shell/test/chat-lint.js` 0 violations. No code changed.

## 2026-11-10 (12:08) — The farm ships Gemma 4 26B, and Balanced brings a farm to it

The owner: *"I don't really get why our default model is gemma4 12B, this model is weak"*, then *"we need the farm to start
with a balanced preset. We want to do rag on document, be able to describe an image and be able to code a little. Targets are
gpu 24gb and above"*. Gemma 4 12B had been the default since 2026-08-27, for the 12 GB cards: 262k of context in ~10 GB and
pictures. The owner dropped those cards on 2026-10-04 and the default never followed. On the spike's check it scored 22/28 with
thinking on, after 155k tokens of thinking, the weakest model measured. A fresh farm starts on Ollama: vLLM needs a person's
setup, and where vLLM is set up, Balanced already picks Qwen3.6, which sees pictures and is proven with the coding agent.

**Measured** on the PRO 6000, through a scratch farm (its own folder, ports 4190/41990, beacon and plugins off) in front of a
scratch **Ollama 0.33.0**, the Farm app's pin, on port 11500 with its own models folder. The live farm and the owner's Ollama
app were left alone. Candidates that see pictures and fit 24 GB: `gemma4:26b` (Q4_K_M, 18.7 GB on disk), `qwen3.8:27b` and
`qwen3.6:27b` (18 GB). `qwen3.6:35b` (23 GB) is too tight. Gemma first: about 4B active, so faster, and its long-range layers
share one cache. Its first download arrived corrupt (Ollama's digest check refused it; the school network gave about 6 MB/s)
and was fetched again.
- **Quality**, the spike's 28 items through the farm's LiteLLM (`spike_bench.py` now also sends Ollama's `think` beside
  `chat_template_kwargs`, as LOL Vibe does): **28/28 with thinking off** (37 s, 11k tokens) and **28/28 with it on** (164 s,
  73k). On vLLM it scored 26 and 28; Gemma 4 12B 22 and 26.
- **A picture** (`docs/img/m6-farm-health.png`): the farm's address, its GPU and Open WebUI's version all right, in 2.4 s. It
  misread "LlmOnLan" as "LimOnLan".
- **A document sent whole** (39k tokens of this DEVLOG): three questions spread from its start to its end, answered in
  0.4–3.7 s. Two exact; the first said "172 steps" where the text has 172 checks over 24 steps.
- **The coding agent** (`ide/run.js`, five tasks × 3, 32,768 reply tokens): **14/15**, 22 s a task. On vLLM it scored 12/15,
  Qwen3.6 11/15. The one miss: t5 changed the tests it was given. ollama#19191 (an integer replayed as "30000.0"), which
  broke Flint there, did not touch it.
- **GPU memory**, two seats (Ollama gives each the whole `num_ctx`), against the GPU's own counter: **20.6 GiB at 32k each,
  22.0 at 64k, 24.8 at 128k, 30.5 at 256k**. Weights 15.9 GiB on the GPU, a built-in 0.4 GiB draft model, the 262k cache only
  1.09 GiB at f16. Ollama 0.33's `/api/ps` reports only the cache and buffers (4.4 GiB at 256k), not the weights. With the
  farm's 8 % margin, a 24 GB card holds two people at about 48k each: Open WebUI's whole-document mode starts at 24k. A 32 GB
  card holds two at about 128k, a 48 GB card the whole 256k.
- Qwen3.8 27B was not run: Gemma passed everything, and Qwen3.8's cache costs about three times as much per token on 24 GB.

**Changed:**
- `config.js`: `models` = `gemma4:26b`. `preinstall` = `gemma4:12b`, which reads scanned pages beside vLLM (`OCR_BESIDE`, in
  the 9 GB kept for it), so a farm that turns vLLM on later still reads documents. It replaces the Qwen3.8 UD-IQ2_XXS staged
  for 12 GB cards (8.6 GB), so `lol install` downloads about the same.
- **Balanced off vLLM** (`presets.js`): the model the farm ships, whatever the farm's own default. It asks for the download
  first when this Ollama lacks it, says when it changes the farm's default, and says so on a GPU under 24 GB.
- **Apply** (`up.js`): an engine switch writes the new default before Ollama starts (`prepareEngine`). On a farm Ollama
  already serves, `setOllamaModel` swaps the catalog, measures the context and rewrites the routing once, inside the job
  (`setDefaultModel` measures only outside one), and puts it all back if the proxy does not return. The new default
  **replaces** the old one, so nobody's model picker can unload it for a class; a name a person gave the old default passes
  to it. The dry run says a new model loads.
- **LOL Vibe:** Gemma 4 26B is proven on Ollama too. `NOT_PROVEN_ON`, which held only it, is gone.
- **Document reading beside llama.cpp** (`resolveOcrModel`, found while updating the docs): it read with the Ollama default
  when that sees pictures, so a new farm switched to llama.cpp would load the 19 GB model beside llama-server. Now it uses
  `gemma4:12b` while the Ollama default is still the shipped one. A default the operator chose is kept (review 2026-10-07),
  and so is an external server's choice.
- **Docs:** CLAUDE.md, the READMEs, GETTING_STARTED (the first download is now about 27 GB), HUMAN_TESTS (K9, N1 and N5
  corrected; **K14** and **K15** added, ★ row 5), and RESULTS "Ollama's default".
- **Farm app wizard:** pulls `gemma4:26b` (19 GB); the welcome screen says about 27 GB in all (28 with document search); the
  low-memory Mac warning is now under 32 GB.
- Installed farms keep their model when the app updates: the wizard wrote it into their config. **Balanced is how they
  move**: Review, then Apply.

**Tested:**
- `farm/test/run.js` **288 passed**: Balanced's picks, the needs, the 12 GB warning, the dry run, the stubbed Apply rig with
  `setOllamaModel`, and the preinstalled model being `OCR_BESIDE`.
- The Farm app's `npm test`: 11 + 3.
- **Live, on the scratch farm with the new code:**
  - From llama.cpp, with an Ollama default renamed `tutor`: Balanced switched to Ollama serving `gemma4:26b` under
    `assistant`, the name clients had seen. The catalog holds that one model, web search and document reading are on, and
    the card reads Balanced, recorded, unchanged.
  - From Ollama, with `qwen3:0.6b` made the default from the panel: the dry run said "Model: qwen3:0.6b → gemma4:26b";
    Apply left one model, and a chat answered.
  - The first live run caught a flaw, fixed before these: the old default was kept beside the new one.

## 2026-11-10 (10:34) — No GitHub API where a whole school asks (the Farm app's *GitHub API 403*)

The owner: the Farm app's Check for updates said *Couldn't check: GitHub API 403*. GitHub answered `403 rate limit exceeded`,
`X-RateLimit-Limit: 60`, `Remaining: 0` (reset 11:09). Requests that don't sign in get 60 an hour per public address, and the
school's network shares one. Three of our programs asked it: the Farm app's update check (`releases?per_page=30`), its first-run
wizard (the pinned Python and Ollama releases), and every client (its chat engine's release a minute after each start since
v0.2.16's automatic repair, the first install and About's check, and the coding agent's download). A new client could not
download its chat engine while the limit lasted.

- **Farm app update check** (`updater.ts`): reads `https://github.com/<repo>/releases.atom`, a github.com page and not the
  API, which lists the 10 newest releases, prereleases included. Only the entries' own links count: a release note's link is
  escaped inside the feed. The API is asked only when no farm release is among those 10. The fetch is a parameter, for the test.
- **Wizard** (`runtimeManager.ts`): the pinned files by name, `releases/download/<pin>/<file>`: Ollama's (four fixed names) and
  `cpython-3.12.14+20260825-<triple>-install_only.tar.gz`, the one 3.12 on that release. The API, as before, only if that
  link fails or `LOL_PY_VERSION` asks for another Python.
- **Client** (`sidecarManager.ts` `releaseAssetUrl`, shared by the chat engine and the coding agent): HEAD requests on
  `releases/latest/download/<file>` or `releases/download/<tag>/<file>`. 404 means the release has no such file; latest's
  redirect gives the tag's own link, which is returned so a release landing in between cannot mix two. The manifest is read
  from the same tag. No `api.github.com` in the file (a test says so).
- **Tests:** the Farm app's `npm test` (11 + 3: the feed, the API fallback, both closed is an error), the client's
  `chat-unit.js` 1958 passed (the hops as github.com answers them) and `chat-lint.js` 0 violations. **Live, while the API
  still answered 403:** the client found `owui-sidecar-win32-x64.tar.gz` on latest as `.../download/v0.2.16/...`, the coding
  agent's file on v0.2.16, null for a missing file and a missing release, and read the manifest (`latest` 0.11.4); the Farm
  app's check found farm-v0.0.52 from 0.0.51; HEAD answered 302 for the five Python files (a literal `+` too) and the four
  Ollama ones. App updates were never affected: electron-updater reads the feed, not the API.
- **Reaches people at the next releases** (client v0.2.17 and Farm app farm-v0.0.53, the owner's go). Until then: try again
  after the hour. HUMAN_TESTS N4 says so; plans README Now 1 has the finding, and its stale line 3 (farm-v0.0.51, Flint) now
  reads farm-v0.0.52 and Gemma 4 26B.

## 2026-11-10 (10:23) — The two scratch folders are gone

The two deletions of the 2026-11-09 housekeeping that were left to a person. `F:\lol-scratch-flint` (64 GB) the owner deleted. WSL's
`~/lol-models-scratch` (106 GB: Apex-35B, Gemma 4 26B-A4B, Nanbeige4.3 and their three load logs) went at the owner's typed command,
after a check that no process held it and no link in `~/lol-vllm` or `~/lol-vllm-033` pointed into it. J15 no longer mentions the
scratch copy: the panel downloads its own. The spike's result files keep the old path as a record of where the trial read its weights.

## 2026-11-09 (14:29) — Housekeeping after the release (the owner's yes)

- **GitHub:** the 22 branches already merged into `main` are deleted, each checked an ancestor of `main` first and with no open pull
  request. Their tips, so any can come back with `git branch <name> <sha>`: `client/unsloth-only` 8d22ec8, `comfyq-prompts` f3a733d, `converse` 4532ba8, `embed-farm` e017325, `farm/4070-defaults` efb997b, `farm/admin-owns-model-choice` 758de5f, `farm/llamacpp-backend` 46502ac, `farm/llamacpp-plus-studio-ui` b161004, `farm/mtp-draft-module` e00c80e, `flint` 119f0b2, `home-tutorials` a1e25f9, `human-tests` f8aede1, `llamacpp-next` 864662c, `lolchat/vnext` b43e6c6, `model-storage` 7dae3bd, `panel-engines` cae8a44, `presets` 6ab73e3, `presets-users` f0c3db6, `vllm-033` f512318, `vllm-managed` 5ee5d93, `vllm-models` c504540, `voice-mode` 729a4a6. Left: `main`, `multiuser-phase0`, and
  `bench/quant-ladder` (not merged: its measurements are not in `main`, so it stays until the owner says).
- **This checkout:** `arm-list.txt` and `owui-arm.tar.gz` (1.16 GB, an arm sidecar of 2026-09-02) at the root, and the empty dev run of
  2026-08-25 under `shell/` (`webui.db` and its two companions, `vector_db/`, `cache/`, `uploads/`: no user, chat, file or vector in it).
- **Not done, refused by Claude Code's own safety check** (a recursive delete of a whole folder needs a person at the prompt):
  `F:\lol-scratch-flint` (64 GB) and WSL's `~/lol-models-scratch` (106 GB). The owner runs them (plans README §4).
- **The capacity explorer** republished to its Artifact (version 3): the page as the farm serves it today, Gemma 4 26B measured,
  the class card for seats.

## 2026-11-09 (13:14) — Release client v0.2.16 and Farm app farm-v0.0.52, for a phase of human testing

The owner: *"document, review, release to enable a phase of human testing… everything in sync"*. Before the tags, on the merged
tree (`multiuser-phase0` fast-forwarded into `main`):
- client: `npm run build`, chat-unit 1957/1957, lint 0, shell 30/30, and the **whole Electron harness, 413/413** (the live half of
  `k26-home` skipped: no demo home up);
- farm: `test/run.js` 287/287, `vllm/test_scripts.sh` 129/0 and `LOL_VLLM_FAKE=1 test/vllm-lifecycle.js` 172/0 in WSL (production's root untouched, its own check);
- Farm app: `npm test` 9 + 3;
- PyAV 18.1.0, which the sidecar build now requires, has abi3 wheels for every platform CI builds;
- docs: no broken link outside the archive, the dated reviews and a test fixture; CLAUDE.md's "not released yet" now names the
  release; README, the plan and HUMAN_TESTS' ★ list (four sessions, ★ = run first) follow.

**Released** (both tagged from `main` at `045cb05`, then `multiuser-phase0` fast-forwarded to it):
- **client v0.2.16** (CI run 42615989391, 38 min, all six jobs green): 27 assets, *Latest*: the five installers and their update feeds,
  the chat engine for five platforms with `owui-sidecar-manifest.json` = `{"owuiVersion":"0.11.4","bundleRev":"2"}` (the number the
  automatic repair compares), and the coding agent's runtime for five. Every sidecar job installed PyAV 18.1.0 and ran the new
  recording check.
- **Farm app farm-v0.0.52** (CI run 42616036536, ~4 min): 10 assets, a prerelease as before.
- Release notes: a *What's new* above CI's own text on each.
- `build-llamacpp-arm64` also ran on the push to `main` (its path filter includes `farm/src/llamacpp.js`, changed on 2026-11-05):
  it rebuilt the same pinned b11836 for the Spark and replaced that one tarball.

## 2026-11-09 (12:55) — The owner's four answers: Gemma 4 26B for coding, class cards for people, the engine repairs itself, people in or out

The owner (2026-11-09): yes to Gemma 4 26B in vLLM's list and in Flint's place as LOL Vibe's coding model; yes to class cards that
favour people; yes to a chat engine that repairs itself; and, on a person's home state, "what is best?".

- **Gemma 4 26B-A4B in vLLM's list** (`config.js`, the seventh built-in, appended so a saved list gets it at the next start;
  `measured: 'gemma426'`, so Automatic seats it from the measured levels). **AGENT_PROVEN**: Qwen3.6 and Gemma 4 26B; Flint stays
  downloadable, no longer proven; not proven on Ollama (ollama#19191). The IDE's model line knows it (`projects/models.mjs`: good
  at edits, 32,768 a reply, as measured).
- **The capacity page:** the class card prefers people, so Qwen3.6's 96 beat Gemma's 40 again whatever the index says; without it
  the Balanced preset, built from that card, would have moved a PRO 6000 to Gemma once it joined the list. The coding card counts
  LOL Vibe's own agent runs (`CODING`, 10 of 15), so it no longer turns Gemma away for its outside SWE-bench of 17.4.
- **The chat engine repairs itself:** a minute after a packaged start, a rebuilt bundle of the SAME Open WebUI downloads into
  `sidecar.pending` and applies at the next start (`repairWanted`); one download at a time, shared with About's button; another
  Open WebUI version stays a click.
- **A person's state** (the owner asked what is best): `home` or `not_home`, never a zone's name. Whether people are in is what the
  home templates use; a zone called work or a school says where someone is (`readableState`).

**Tested:** farm 287/287, Farm app 9 + 3, chat-unit 1957/1957 with the new cases, shell 30/30, lint 0.

## 2026-11-06 (20:38) — New models measured: Qwen3.6 serves more than we said, and Gemma 4 26B codes as well as Flint

The owner: find new models for better quality, speed and scale, at a quiet hour. Candidates came from Hugging Face's API (dates, licences,
`config.json`) and vLLM 0.33.0's own registry rather than from leaderboards, whose dates disagreed. Everything ran from a scratch root;
production's `~/lol-vllm` was only read, for Qwen3.6's weights. Full method and numbers: [spike/RESULTS.md, *Model trials*](spike/RESULTS.md#model-trials-rtx-pro-6000-2026-11-06).

| Model | Gate on / off | Agent | 32k | 64k | Verdict |
|---|---|---|---|---|---|
| Qwen3.6 (default) | 27 / 28 | 7–11/15 | ≥ 128 | **64** | stays the class model |
| Gemma 4 26B | 26 / 28 | **12/15** | 40 | 20 | a real option for coding |
| Nanbeige4.3-33B | 27 / 27 | 5/15 | ≥ 18 | ≥ 8 | no: needs a shell, dense |
| Apex-35B | 24 / 23 | 8/15 | ≥ 96 | ≥ 56 | no: under the gate's floor |

- **Qwen3.6: 64 people at 64k on `--append`,** the shape Open WebUI sends, in both runs, 72 failing. The 48 we quote is the harder
  replaced-question profile. The capacity page stays at 48 until HUMAN_TESTS J16 confirms it through the seat gate.
- **The farm's estimate for Gemma 4 26B was wrong by 3.5 times** (70 people at 64k from the config; 26 by vLLM's own line; 20 measured).
  `catalog.json` now holds the measured 37,464 B a token and `measured-extra.json` the levels that passed each time they ran, so the
  capacity page says 40 and 20. Its class-of-30 card, with nothing served, now picks Gemma 4 26B by the existing rule (index 46 against
  43.4); a farm serving Qwen3.6 keeps it. Whether that rule is right is in the plan's §4.
- **A repeat changed the answer:** Gemma's first 62k sweep passed at 24, its second failed there with a 25.8 s spike. `model_trial.sh` says so.

Gemma 4 26B is NOT added to the farm's list or to LOL Vibe's proven list: those are the owner's, and the question is in the plan's §4.

**Tested:** farm 287/287 with the regenerated page data. New scripts: `docs/spike/runs/trial_serve.sh` (refuses production's root),
`model_trial.sh`. GPU left idle at 800 MiB, the scratch server stopped, 106 GB in `~/lol-models-scratch`.

## 2026-11-06 (16:57) — The Computer's sandbox really has no network now: WebRTC was a way out

The review's EGRESS-02 said WebRTC might escape the sandbox, "not verified at runtime". Measured in a real sandbox in Electron
(`c3-sandbox-webrtc`): a guest sent 4 UDP packets to an address of its choice, and opened a TCP connection through a TURN server.
A TURN username can carry whatever a guest read, so a Code box's document or home readings could leave. CLAUDE.md promised "no network".

Each proposed fix was tried, and three did not hold:

| Tried | Result |
|---|---|
| `webrtc 'block'` in the runner's CSP | **nothing**: with and without it the packets are the same (a control run). Removed: a rule that does nothing reads as a fence |
| The review's fix: delete `RTC*` in the runner | an `<iframe srcdoc>` is a fresh realm with its own constructor, and it ran. `frame-src 'none'` does not cover it, and `will-frame-navigate` never fires for it. (An empty `<iframe>` is refused: a cross-origin frame.) |
| `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` | stops all UDP, not TURN over TCP |
| **A preload in every frame** | **0 packets, by any route** |

The fix: `nodeIntegrationInSubFrames` runs the preload in every frame before that frame's scripts, however the frame was made. The
preload gives the `lol` door only when `process.isMainFrame === true`, so any other answer gives no door, and takes `RTC*` out of every
other frame through `contextBridge.executeInMainWorld`. The UDP policy stays as the backstop. No Node in any frame.

**Tested:** `--phase c3` 28/28 and `--phase k` 216/216 in Electron (`c3-sandbox-isolation`: `ownLol` still blocked), and the REAL compiled app on a throwaway
profile, because the harness has its own copy of the preload and a wrong answer there would cost the client its whole bridge: the main
frame keeps all 44 doors and reads its settings, and a real Code box sees `typeof RTCPeerConnection === 'undefined'`. Chat-unit and lint pass.

## 2026-11-06 (16:42) — The capacity generator runs again, and keeps Flint

`build_measured.py` no longer ran at all: every vLLM 0.33.0 result parsed as llama.cpp and crashed on `('gemma4', None)`, any model
it did not know was filed as Qwen3.8 (Flint's llama.cpp runs would have changed Qwen3.8's numbers), and its check read a
`_round_stats.txt` that was never committed. Now `NOT_HERE` names the runs the table is not built from (vLLM 0.33.0, the Farm app's,
Flint on llama.cpp, and the A/B on the farm's settings, which joined Qwen3.6's table on a first try), an unknown model stops the
script, and the check runs `round_stats.py` itself. Flint's hand-added point moved to `measured-extra.json`, which `build_page.js` adds.

**Tested:** both scripts ran, 324 round statistics matched with 0 mismatches, and the farm's `measured.json` is the same data apart
from its stamp. Farm 287/287.

**Left:** the page's numbers are still the spike's vLLM 0.30.0 runs, except Flint's, while the farm ships 0.33.0. The 2026-11-02 runs
on 0.33.0 are in RESULTS.md, not on the page.

## 2026-11-06 (16:38) — The laptop's own speech to text works again, and a rebuilt bundle can reach a laptop

**Reproduced first** in a throwaway venv: faster-whisper 1.2.1 with PyAV 19.0.2 gives `TypeError: open() got an unexpected keyword
argument 'metadata_errors'` on the first recording; with PyAV below 19 it decodes. Every bundle CI built after 2026-09-29 has PyAV
19, because it came in through `av>=11`, so on a farm without speech to text Open WebUI's microphone and Call mode failed.

- `build-sidecar.mjs` installs `av<19` and then decodes a tenth of a second of silence through `faster_whisper.audio`, the door
  Open WebUI uses. That check was run on both versions: it passes on 18.1.0 and fails on 19.0.2. The review proposed pinning
  `faster-whisper==1.2.1` too. That would make a bump of Open WebUI a code change, which invariant #5 forbids, so faster-whisper
  stays as Open WebUI pins it and the build fails if a future pair breaks.
- **PIN-2:** an installed bundle was never replaced while Open WebUI's version stayed the same. `sidecar/BUNDLE_REV` (2) goes in the
  bundle and the manifest, and `offerBundle` offers a different number. The review proposed the release tag as the id, which would
  have offered a 1 GB download at every release with nothing changed; the number moves only when a bundle must be replaced.

**Tested:** chat-unit 1956/1956, shell 30/30, lint 0, farm 287/287. Not run: a full `build-sidecar` (CI does it at the next tag, and
now fails there if the decode fails). Person's check: HUMAN_TESTS A18 step 5, on a farm with speech to text off.

## 2026-11-06 (16:34) — The review's last high findings: an address, a failed save, the panel's focus

- **A phone's street address** (TEXT-1, `homeAssistant.ts`). A geocoded-location sensor has the address as its STATE, so
  `home_devices`, `home_state` and a Home box handed it to a model. A sensor that holds a place attribute is now a place
  (`isPlace`): `(hidden: a place)`, no attributes, no past. The review's rule read "any entity with a place attribute",
  which would also have hidden a person's home/not_home (a person carries latitude) and a calendar's on/off (an event
  carries `location`): only sensors, and the phone apps' spelling (`Postal Code`) is folded. A person's state stays
  readable; the four texts that said "never where people are" now say what is true. Whether to hide it is the owner's
  (plans README §4).
- **A failed save** (VIBE-1). `repo.writeFailed` holds the error's name until a write lands, and a new `STORE_SAVED` clears it.
  `store-banner.mjs` keeps its own `role=alert` line beside the mode's, and Settings stops saying "Saved on this computer".
- **The panel's focus** (A11Y-01, A11Y-21). A row's button is found by its action and its id, so the focus stays on the same
  row, even once Stop became Offer. It used to land on the first row sharing the action, and the next Enter stopped the wrong
  model for everyone. Row buttons name their row for a screen reader.

**A regression the harness caught** (`--phase k`, 214 of 216): the `await` the morning's gate added to `start` broke a ▶ pressed
in the same tick as a run, which stopped merging and was refused as busy. Only a marked graph waits now. Two more failures
were timing flakes (a write racing a reload): `k1-library-width` and `k3-sched` pass alone, the latter twice.

**Tested:** chat-unit 1955/1955, lint 0, farm 287/287, `k3-sched` and `k28-handed` in Electron. Person's check: HUMAN_TESTS A23.

## 2026-11-06 (16:24) — A graph from a file lists what it reaches before its first run

The owner's decision of the morning (Q: graph files someone hands you). The review had it twice (OLD-1, EGRESS-01): a file
keeps every setting only a person chooses, so one Run all on a stranger's graph could read a linked home and hand it to an
Agent box whose hosts the file named. The settings stay in the graph, and the first run asks.

- `graph/person-only.mjs` (new, the list moved out of `mcp-tools.mjs`): `personChoices(doc)` says what a graph reaches, whole
  and on one line (a host list is never cut short, and control or invisible characters go, so a value cannot draw a list of
  its own in the question).
- `fromJson` marks `doc.settings.handed` on the file paths when there is something to list, and never reads the mark from
  the file. Templates and examples pass `shipped: true`. A paste this window did not copy counts as a file (Listen off, and
  the mark): the same hole, by the clipboard.
- `createHandedGate` sits inside `host.mjs` `start`, the one door every run takes (Run all, ▶, a Button, a Trigger, the resume
  banner). No answer, no run. MCP `run_graph` refuses with a sentence until a person said yes.

**Tested:** 7 unit cases (`person-only.test.mjs`), chat-unit 1952/1952, lint 0, and a real Electron window on the mock farm
(`k28-handed`): the question lists the address, Cancel has the focus and runs nothing, ▶ takes the same door, a yes is
asked once, a shipped graph asks nothing. Person's check: HUMAN_TESTS A22. Graphs imported before this version carry no
mark, so they do not ask.

The owner, the same message: **Microsoft 365 is on hold** until the school's administrators and IT say go, and the school has
no Google Workspace (CLOUD_SOURCES_PLAN, plans README). For now: consolidate, document, and find better and faster models.

## 2026-11-06 (09:57) — The review's second round: privacy leaks and LAN steering fixed; the owner's four answers

The owner asked to go slower and lighter on agents (the review cost about 29 million tokens, 167 agents): this was done
alone, one fix at a time. Round 2's results (152 findings, 51 confirmed, 96 partly, 5 refuted) are saved in
[reviews/PROJECT_REVIEW_2026-11-05.md](reviews/PROJECT_REVIEW_2026-11-05.md), generated from the results.

**Fixed:**
- *LOG-1:* SearXNG logged an engine's error with the URL it asked, a person's search inside, and `farm.log` kept it.
- *LOG-2:* OCR's upload stayed in the temp folder when the service was killed. It now works in `.extract/work`, emptied
  at every start and stop.
- *LAN steering (TRUST-1 to -8, SEC-2):* see the commit. In short, everything goes through `Discovery.getFarms`: a plugin
  address takes the host reached, a beacon is filed under its source, an id repeated from elsewhere changes nothing, a
  password stays at its address (the owner: yes), and a farm this client trusts comes before a stranger.

**Decided (owner, 2026-11-06):**
- Q8: register LlmOnLan inside the office's own Microsoft 365 and Google Workspace first. The admin's name is still needed.
- Q14: no picture block for now; CLOUD_SOURCES_PLAN §6 says what to look at again before this leaves the office.
- An imported graph lists its person-only settings before its first run (the roadmap's Now 5; not built yet).

**Studied:** Ripple-65B Preview ([research/RIPPLE_65B_STUDY.md](research/RIPPLE_65B_STUDY.md)): one measurement, not a
switch.

**Checks:** farm 287/287; shell unit 30/30, chat-unit 1945/1945, chat-lint 0. **Not run:** Electron itself, so HUMAN_TESTS
gains D17 and K12 (★), C8 and K13, which also gather the smaller fixes the first round left without a person's check.
**What the steering fix does not do:** a new client still takes the first farm it finds, and an open farm proves nothing
about itself. GETTING_STARTED now says to use LlmOnLan on a network you trust.

## 2026-11-05 (21:31) — A blind review of the whole project: docs sorted, six bugs fixed, the context resynced

The owner: *"review the code base, your context, the documentation and all the plans … if a plan is fully executed
it should be placed in an archive folder … plans and docs are mixed, it should be sorted … flag inconsistencies (fix
if it is straightforward), fix the docs, hierarchise what we can do next; update the human tests"*.

**How.** Two workflows. (1) 14 read-only reviewers, one area each (the plans ×3, the docs' structure and links, the
farm's engines, its services and panel, the client's main, its renderer, packaging and CI, the tests, the human
tests, the assistant's context, repo hygiene, the guides). They were told to trust no doc and no comment. A skeptic
re-checked every finding and every archive proposal against the files: 330 findings, 147 confirmed, 179 partly (real,
with a corrected fix), 4 refuted. A roadmap writer and a completeness critic followed. (2) Ten fixers on disjoint file
groups, each diff re-checked by a skeptic who re-ran the tests, CLAUDE.md last.

**The docs, sorted** (`f855e00`): `docs/` keeps the living documents; `docs/plans/` the open plans
(CLOUD_SOURCES_PLAN, IDE_PLAN) and, in its README, the next work in order with every archived plan's leftovers;
`docs/archive/` what is done: 15 plans in `plans/`, the four replaced checklists in `testing/`, the night logs in
`logs/`. Each archived file has a header saying what replaced it. `docs/README.md` is the map. 28 files moved, the
references in 164 files followed. The farm test that skipped when its plan was missing now fails instead, so a move
cannot switch it off.

**Bugs fixed** (each with a check):
- *SHM-1, security:* a link Open WebUI opened in a new window became an LlmOnLan window whose microphone, camera and
  clipboard were granted to any site. Now it goes to the system browser, and the permissions follow the sidecar's
  origin. Open WebUI's own file pages and its community site stay app windows. xterm's blank-window links in its
  terminal now open nothing (an owner question).
- *SHM-2:* a planned LiteLLM restart wiped every laptop's correct farm password.
- *SHM-3, data loss:* *Move my data* into a folder holding data overwrote that folder's chats.
- *REN-1:* LOL Vibe schedules over 60 minutes never fired.
- *FSV-1:* turning a plugin on froze the farm for the length of its install. Voice's is several GB of torch: every
  stream stalled and the beacon went quiet. The llama.cpp unpack now runs the same awaited way.
- *PKG-1:* a Farm app built on a dev box shipped that box's models, venvs and `lol.config.json.before-*` backups,
  which hold the farm password and the admin token.
- Smaller: the 503 tells starting from stopped; `lol init` and `lol install` write only the name (a full scaffold
  froze `vllm.version` at 0.30.0); speech to text and Classify compare their key in constant time; the vLLM minimum
  is rounded up in both places; `shell-settings.json` is written atomically.

**Docs that misled:** README, shell/README, sidecar/README and GETTING_STARTED told people their document text and
their voice stayed on the laptop. Both can go to the farm, since document search (2026-10-08) and speech to text
(2026-10-09). The guides also said a plugin switch lasted only until a restart, but it is kept since farm-v0.0.50.
HUMAN_TESTS was still set on v0.2.10 / farm-v0.0.44: it is rebased on the release under test, with a proposed ★ list,
a Part 4 of what was done on real machines (RIG_CHECKLIST's ticks included), new tests for today's fixes and the
features of October, and 133 tests, 23 ★.

**Housekeeping:** 18 stale worktrees removed (4.4 GB). Their 34 `node_modules` junctions were unlinked first, because
a skeptic's scratch test showed `git worktree remove` deletes through a junction; the main checkout's folders were
checked before and after. 26 merged local branches deleted. `.gitignore` is free of its BOM and mojibake. The
assistant's memory was corrected (production vLLM in `~/lol-vllm` run by the Farm app; the test farm's orphan-rule
trap; the refined local-only rule) and gained "clients on personal computers".

**Checks:** farm 287/287 (exit 0); shell unit 30/30, chat-unit 1940/1940, chat-lint 0; Farm app supervisor 10/10 and
a packaged dir build without dev-box folders; the link check unchanged. **Not run here (the production box):** e2e.js,
the CDP harness, vllm-lifecycle.js (WSL), copytree.test.js (Electron). **Left for the owner:** the questions in
`docs/plans/README.md` §4. A second review round, over the critic's gaps (farm logs, what a rogue farm can make a
client do, the newest trust boundaries, earlier reviews still open, the Computer's outgoing data, pins and licences,
accessibility), follows.

## 2026-11-03 (09:31) — Release Farm app farm-v0.0.51: vLLM 0.33.0, Flint in the vLLM list and LOL Vibe's proven list

The owner: *"Merge, then farm-v0.0.51"* and *"Add it now"* (Flint in `AGENT_PROVEN`, 09:23 below).
- **Merged:** `vllm-033` into `multiuser-phase0` (`876aeb8`; the DEVLOG's one conflict kept both sides by date). Gates on
  the merged tree: farm `test/run.js` 281/0; Farm app `npm test` 9 + 3 (under Electron 42.6.0). On the branch:
  `farm/vllm/test_scripts.sh` 129/0 and `LOL_VLLM_FAKE=1 node test/vllm-lifecycle.js` 172/0, rerun by the lead
  (no script changed after). No client change since v0.2.15 (`shell/`, `sidecar/` unchanged): no client release.
- **Farm app farm-v0.0.51** (tag `farm-v0.0.51`, commit `9777e48`, CI run 41603347833, ~4 min): success, a prerelease,
  10 assets (Windows x64, macOS arm64, Linux arm64 AppImage); GitHub's latest release is still the client's v0.2.15.
- **Release notes:** a "What's new" above CI's own text: vLLM 0.33.0 and how to update (Stop, Update, Start; nothing
  updates by itself), Flint and its memory, the two proven models, and three things to know (an older Farm app refuses
  the settings once the vLLM list was edited here; Gemma 4 12B answers French sound in English on 0.33.0; Flint's licence).
- **Not done, the owner's:** install farm-v0.0.51 on the PRO 6000; HUMAN_TESTS J14 (Update vLLM from the panel, one stop
  half-way) and J15 (Flint from the panel, in Open WebUI and LOL Vibe); session Q and A20 from before.

## 2026-11-03 (09:23) — Flint joins LOL Vibe's proven list, with a capacity catalog entry (branch `vllm-033`)

The owner (2026-11-03), after the vLLM 0.33.0 results below: merge the bump, release farm-v0.0.51, and add Flint to the
models proven with the IDE's coding agent now.

**Changed (farm):**
- `presets.js` `AGENT_PROVEN`: **Flint**, *13/15 on its five tasks, on vLLM 0.33.0*, beside Qwen3.6. **Not on Ollama**
  (`NOT_PROVEN_ON`): ollama#19191 turns a whole number from an earlier tool call into text, and the agent's read takes
  offset/limit; a farm whose Ollama serves Flint is told so. On llama.cpp it counts, as Qwen3.6 counts on every engine.
  The LOL Vibe reason names the other proven model; the "no proven model here" line names both with their proof.
- **What the presets pick does not change** on any card the capacity page knows (the four presets on 9 cards, every vLLM
  model on disk, compared before and after): the rule is the most people at 64k among proven models, and Qwen3.6
  serves 48 there against Flint's 20 on the PRO 6000, and more on every other card.
- `capacity/catalog.json`: a `flint` entry (the presets need it to name Flint; the farm's Automatic needs it to cap
  Flint's seats by the pool). Its context memory is the **measured** figure, not the config's: vLLM 0.33.0 held
  1,266,476 tokens in a 60 GiB pool, 50,869 B a token, in bf16, the only precision it runs Flint in. The config's 14
  full-attention layers give 28,672 B (llama.cpp's figure), which would claim ~33 people at 64k where 20 were measured.
  New field `kv_bf16_only`. The entry is in the generator (`docs/spike/explorer/build_catalog.py`, literal numbers from
  RESULTS); its `hf/` dumps are not in the repo, so a full run would drop the other models' sizes: the entry was spliced
  into the committed file, every other model as it was. Recursive's SWE-bench Pro v2 89.7 is left out of its scores
  (RESULTS 2026-10-23: undefined, never rerun, above its own Verified score); SWE-bench Verified 74.2 and Terminal-Bench
  2.1 54.9 are in. Its licence is recorded as unsettled.
- `capacity/estimator.js`: a `kv_bf16_only` model is counted in bf16 whatever the capacity page's toggle says (fp8
  would count Flint twice), and Flint's PRO 6000 measurements show as measured (`MEASURED_ONLY`). Every other model's
  estimates are unchanged: 6,000 compared (each model on 10 cards, 5 contexts, fp8 and bf16, both modes), 0 differ.
- `config.js`: Flint's list entry names its catalog id.
- **Automatic now says 19 people at 64k for Flint on a 60 GiB pool, not 20.** The farm caps the measured seats by what
  the pool holds at the whole window (65,536 tokens: 19.3), and the spike's "64k" was 62,000 tokens each (20.4); at 32k,
  38 (40 measured at 30,200). A smaller pool (document reading's 9 GB kept aside) seats fewer, which the farm could not
  say before this entry. HUMAN_TESTS J15 expects 19.

**Tested:** farm `test/run.js` **281/281** (new: Flint's memory per token, the pool's people at 62k, 30.2k, 64k and
32k, Automatic's seats on a 60 and a 51 GiB pool, the estimator in bf16; the preset tests: Flint named beside Qwen3.6,
proven on llama.cpp, not on Ollama and said so). `farm/vllm/test_scripts.sh` 129/129 and `LOL_VLLM_FAKE=1 node
test/vllm-lifecycle.js` 172/172 were rerun on the branch before this change; no script changed since. The explorer's
`calibrate/test_cases.js` runs with Flint.

**Still open:** which licence governs Flint's weights (its GGUF says `flint-preview`, its card Apache 2.0); Flint on a
DGX Spark (unmeasured; the estimate gives about 3 people at 64k); `build_measured.py` does not know the 2026-11-02
result labels.

## 2026-11-02 (18:09) — vLLM 0.33.0 for the farm, and Flint on it: the five models work, Qwen3.6 is faster, Flint serves 20 people at 64k (branch `vllm-033`)

The owner: *"I would like to try to bump vllm in a branch ... then we start testing flint in a branch."* Branch `vllm-033`
from `multiuser-phase0` (b515ad7). Not merged, not released. The owner closed the production farm for these tests, so
the PRO 6000's GPU was free (the Ollama app stayed open, no model loaded). All numbers, with their conditions:
[spike/RESULTS.md, *vLLM 0.33.0 and Flint on vLLM*](spike/RESULTS.md#vllm-0330-and-flint-on-vllm-rtx-pro-6000-2026-11-02).

**How it was run.** vLLM 0.33.0 went into a root of its own, `~/lol-vllm-033`, through the farm's own `install.sh`
(as the panel calls it); its `hf/` is a link to the production root's, so the models already there were reused, and the
new ones (Gemma 4 12B 8.7 GB, Qwen3-Omni 67 GB, Flint 22 GB: new folders only) went into the production `hf/` through
the farm's Download path. The production install (`~/lol-vllm`, vLLM 0.30.0) was never installed into; Nemotron and
Qwen3.8 were read where the parked spike root keeps them (list entries by path). Each model was served by a scratch farm
from this branch (`lol up` from a scratch folder: its own config and ports, beacon and plugins off, a stand-in Ollama)
with the farm's own argv, and checked through the farm's route. The same-day A/B ran production's 0.30.0 from a root
whose `.venv` and `hf` are links to production's, read only.

**vLLM 0.33.0 on the five models of the list: no model breaks, so nothing blocks the bump.**
- Every model starts with the farm's flags unchanged (first start 2–6.5 min: kernels compile; then 1–2.5 min) and
  answers; thinking, tool calls and pictures work as on 0.30.0; Qwen3-Omni hears French and English and writes speech
  down (`/v1/audio/transcriptions`, 0.11–0.16 s).
- The gate, thinking on / off: Qwen3.6 27/28 / 28/28 (0.30.0 the same day: 26 / 28), Nemotron 26 / 25 (0.30.0: 25 / 26),
  Qwen3.8 27 / 28 (26 / 28), Gemma 4 23 / 28 (22 / 26), Qwen3-Omni 26 and 27 in two runs (28): all within the gate's noise.
- **Qwen3.6 at 64k, same day, same argv: 0.33.0 serves 48 people on every turn against 0.30.0's 32**, ≥ 64 in steady use
  on both; decode is 15–25 % faster under load at every level (8 to 64 users).
- Found: a conversation takes ~8 % more of vLLM's pool on the hybrid Qwens (Qwen3.6 73.9 instead of 80.3 people of 64k in
  61 GiB; nothing measured changes, throughput binds first); `--mamba-cache-mode` is deprecated and does nothing (the farm
  keeps passing it while a 0.30.0 install may run its flags, and must drop it before a vLLM that refuses it); the reply
  limit is still a ceiling; **Gemma 4 12B now answers a French recording in English** (6 of 6; 0.30.0 the same day wrote
  the French, 6 of 6; English recordings and Qwen3-Omni unchanged; not root-caused; no LlmOnLan surface sends sound to
  Gemma yet).
- The install: torch 2.14.0+cu132 (uv's `--torch-backend=auto` still picks cu132 on driver 596.36), FlashInfer
  0.7.2.post1 compiles its kernels at the first start with the farm's toolchain, and `install.sh`'s `cuda-pins` step is
  still right (the resolver brought nvcc/crt/nvvm 13.4.92 again; the step pinned them to the 13.2 runtime). 9.0 GB.

**Flint on vLLM 0.33.0** (J12–J13 on vLLM; the NVFP4 GGUF and the BF16 repo's config and tokenizer, vLLM's recipe
flags):
- **Speed and people at once:** one person 252 tok/s (llama.cpp with its experts in RAM, 2026-10-23: 44–55); chat 64 /
  ≥ 128, agent steps ≥ 128 / ≥ 128; **40 people at 32k, 20 at 64k** (every turn and steady), both the limit of its memory:
  Flint's vLLM model takes a bf16 context cache only (fp8 stops the start), so the farm's 60 GiB pool holds 19.3
  conversations of 64k (Qwen3.6: 48 people at 64k).
- **Integer tool arguments survive across turns** (18 of 18 calls; Ollama's `"30000.0"` bug does not happen on vLLM),
  and an earlier turn's reasoning reaches the prompt.
- **Two problems, fixed in the farm:** an answer with no think block came back empty (vLLM's `glm47` parser starts every
  answer as thinking; 3 of 6 short answers after a tool result): `install.sh` now writes a copy of Flint's template whose
  answer opens a think block and the farm passes it (6 of 6). And `enable_thinking: false` (Open WebUI's titles) left
  the `<think>` block in the title (6 of 6): the route drops the switch for Flint (6 of 6 clean).
- **The gate:** 26, 24, 24 with Flint's own template, 25, 25, 25 with the farm's (llama.cpp, 2026-10-23: 27).
  `tool_calendar` failed every run (no `date` argument).
- **The coding agent, five tasks × 3** (the farm's reply room, 32,768): **Flint 13/15** (12/15 with its own template),
  39 s a task (median), against **Qwen3.6 7/15 on 0.33.0 and 9/15 on 0.30.0** the same day, 15–16 s a task. Flint still
  loops at times (110 and 149 steps in two runs that passed).

**Changed (farm):**
- `install.sh`: **Update vLLM builds the new version beside the working one** (`.venv-next`, a relocatable uv
  environment) and swaps it in only once its check passed; a cut download, a full disk, a failed check or Stop leaves
  0.30.0 in place, ready to serve. Checked for real: 0.30.0 → 0.33.0 stopped half-way twice (`.venv` still 0.30.0, its
  `vllm` runs, status.sh says 0.30.0), then Update again finishes and swaps (`vllm`, `hf` and the imports work from the
  renamed folder). The same version again installs in place, as before. It also installs `gguf>=0.19.0`, takes a config
  repo as a third argument (its json and chat template only, into `<folder>/config`), and writes Flint's open-think
  template copy when asked.
- **The version: 0.33.0** (`install.sh`, `vllm.version`). A farm with 0.30.0 reads *"vLLM 0.30.0 is installed; this farm
  was tested with 0.33.0."* with **Update vLLM** beside it and keeps serving on 0.30.0: nothing updates by itself, and the
  five models' flags are the same on both.
- **Flint in the list** (`config.js`): one GGUF file (`gguf`) with a config repo (`configRepo`), `minVllm: '0.33.0'`
  (the checklist and Use this refuse it on an older vLLM, before anything stops), `openThink`, `alwaysThinks` (the route
  drops the thinking switch), 21.86 GiB, the `glm47` parsers, text only. `status.sh` lists a GGUF folder and reads its
  window from `config/`; `serve.sh` starts a single-file model offline too; a Flint added by name gets Flint's flags.
- **Capacity:** `measured.json` `pro6000/vllm/flint` (40 at 32k, 20 at 64k), so Automatic serves 20 people at 64k on a
  PRO 6000 instead of 4. No catalog entry (no estimate for other boxes; no memory cap from the catalog, so a smaller pool,
  document reading on for example, holds fewer than the 20 seats). **Not in `AGENT_PROVEN`:** the panel's LOL Vibe line
  now says Flint passed 13 of the 15 tasks on the farm's vLLM; adding it is the owner's call.
- Tests: farm `test/run.js` **280/280** (the Flint entry, the version check, the route; the list's six built-ins);
  `farm/vllm/test_scripts.sh` **129/129** (a new `update` test with a fake uv: a failed download or check leaves 0.30.0 in
  place; the GGUF folder; the config repo; the open-think copy); `LOL_VLLM_FAKE=1 node test/vllm-lifecycle.js` **172/172**
  (all 24 steps). No shell change, so no shell test.

**My mistakes, undone:** the first install ran from Git Bash, which rewrote `/home/...` into `C:/Program Files/Git/home/...`:
it began a venv inside the worktree's `farm/vllm/` (stopped after 4 min, the folder removed). And I edited `install.sh`
while the next install was reading it (reverted within a minute): that install's last line failed with a syntax error
after its check had passed; the same install again finished cleanly in 4 s.

**Left:** `~/lol-vllm-033` (vLLM 0.33.0, 9.0 GB; a later Update of production can reuse its uv cache); the new model
folders in production's `hf/` (98 GB on WSL's disk on F:); uv's cache grew by ~5 GB. Nothing of mine runs (below). The
production root, its venv and its 0.30.0 are as they were; the owner's Farm app starts its own vLLM 0.30.0 as before.

---

## 2026-11-02 (14:36) — Release client v0.2.15: prompts for ComfyQ

The owner: *"lets do a release"* (after the Flint check of 14:00, which changed nothing in the client).
- **Client v0.2.15** (tag `v0.2.15`, commit `2a9a081`, CI run 41448863958, 38 min): success, 27 assets; `latest.yml` says
  0.2.15. What it adds: `comfyq_models` and `comfyq_prompt_guide` in the Computer's MCP server (the merge `26c0a81`;
  gates on that tree: shell build, chat-unit 1932/0, unit 29, lint 0; farm 279/0).
- **No Farm app release:** the farm did not change for it. The wording fix of 14:00 (`presets.js`: Flint joins "once
  the farm's vLLM serves it") waits for the next one.
- **Release notes:** a "What's new" above CI's own text (how to turn the tool on, nothing sent to ComfyQ).
- **Not done, the owner's:** HUMAN_TESTS A20 (a prompt for a ComfyQ workflow through Open WebUI, pasted into ComfyQ).

## 2026-11-02 (14:00) — Flint on the farm's other engines: Ollama and vLLM can serve it now, neither is ready for the coding agent yet

The owner, before the v0.2.15 release: *"before any change on the flint side? can it be run through other backends?"*
Checked on each project's GitHub and Hugging Face; nothing installed or run.
- **llama.cpp (today):** b11836, the farm's pin since farm-v0.0.49, serves it; a person adds the GGUF by URL in the
  llama.cpp section. A few people at once.
- **Ollama:** runs Flint on Windows and Linux since **v0.40.9** (2026-10-22; macOS before): `flint:40b-a2b-qat-int4`
  (23 GB, the size of `flint:latest`), `flint:40b-a2b-q4_1` (26 GB); text only, tools and thinking. The PRO 6000's
  Ollama app is **0.40.4**: it needs an update first, then the panel's catalog takes it with no code change. But
  **ollama#19191 is open**: an integer argument of an earlier tool call is written back into the prompt as `30000.0`,
  Flint copies it and returns a string, and a client that checks the tool's schema refuses that call and every later
  one with that argument. The coding agent's `read` takes `offset` and `limit` as numbers (dsh 0.1.7-rc.2,
  `dsh-tool-fs`), so it would very likely hit it (not measured). And Ollama serves 2 at once by default.
- **vLLM:** #62938 merged on 2026-10-22 and ships in **vLLM 0.33.0**, on PyPI since this morning (10:13 UTC); the
  farm installs **0.30.0**. Flint on the farm's vLLM would take:
  1. vLLM 0.30.0 → 0.33.x: PyTorch 2.14, CUDA 13.0 wheels only (12.9 dropped), Medusa and the MLP speculator removed;
     every model of the list checked again on the PRO 6000 (the gate, the seats) and `install.sh`'s Update vLLM path.
     A .0 of this morning: wait for its first fixes.
  2. A list entry of a new shape: the NVFP4 GGUF (`RecursiveSI/flint-nvfp4-gguf`, 21.3 GiB, weight-only W4A16) takes
     its config and tokenizer from the BF16 repo (`--hf-config-path`, `--tokenizer RecursiveSI/flint`: its small files,
     not its 74 GiB), needs `gguf>=0.19.0` and the `glm47` tool and reasoning parsers. The list holds one Hugging Face
     name per model today.
  3. Its fast kernels are for B200/GB200 (SM100); the PRO 6000 (sm_120) and the Spark get vLLM's standard layers, so
     its speed and people at once there are unknown: J12 on vLLM.
- **Changed:** the panel's LOL Vibe reason and the docs said Flint joins "once a vLLM release serves it"; now "once the
  farm's vLLM serves it" (`presets.js`, its test, `farm/README.md`, CLAUDE.md; spike/RESULTS.md has the details). Farm
  `test/run.js` 279/0.
- **Nothing else changes in v0.2.15.** If the owner wants Flint for many people, the next step is a branch that moves
  the farm's vLLM to 0.33.x once it has its first fixes, adds the two-repo entry, and runs J12–J13 on vLLM.

---

## 2026-11-02 (11:45) — Prompts for ComfyQ: two tools of the Computer's MCP server write a prompt for a ComfyQ workflow

The owner: *"I would like OWUI to have a skill or a tool to help write prompts directly for the models supported by
ComfyQ."* The owner's answers: prompts per workflow only (no storyboards, no jobs), and it must **not** connect to ComfyQ or
look for any machine — the students paste the prompt into ComfyQ's discovery app. Branch `comfyq-prompts` (from
`multiuser-phase0` 1728a9c). Not merged, not released. The older plan that books jobs (docs/archive/plans/COMFYQ_MEDIA_PLAN.md) stays
unbuilt.

**The data** — `shell/scripts/gen-comfyq-prompts.cjs <ComfyQ checkout>` reads `workflows/*/*.meta.json` (schema:
ComfyQ's `server/config/schemas.js`) and `git rev-parse HEAD`, and writes `shell/src/main/comfyqPrompts.json` (170 KB,
UTF-8, read back before it is written). From ComfyQ `5d19e35` (2026-10-16): **68 bundles; 54 take a text prompt** (36 of
them with a prompt guide), **14 do not** (the five 3D ones, the SeedVR2/PiD upscalers, frame interpolation, LivePortrait,
Krea's auto-prompt character sheet, Qwen's camera reshoot — kept by name, so a question about one says there is
nothing to write). Per workflow: id, name, ComfyQ's category and its user-facing kind (the taxonomy of ComfyQ's
`WorkflowSelector.jsx`: "i2v" is *Video generation*, text-to-video included), description, the pictures/video/sound
it needs, its prompt guides (label, https link, tip — only what the bundle carries; none added where it has none), the
text fields (label, required, a negative prompt, a JSON format, *used only when X is on*, the shipped text as an
example), the switches that change the prompt (*Enhance prompt with AI*…), the choices (aspect ratios, a category, a
LoRA list) and the size/length/steps fields with their min/max/step/default. **Not used:** the batch skill's
`reference/workflows.md`, whose measured grids (FLUX.2 Klein renders 1080 as 1072, a multiple of 16, though its meta
says step 8) are about storyboards on five workflows: the tool says what the form accepts.

**The tools** (`shell/src/main/comfyqPrompts.ts`, composed by `withComfyq()` around `withHome()` in `index.ts`, answered
in main, always listed): `comfyq_models` (an optional kind; one line per workflow: id · name · what it needs · prompt
guide or not, grouped as ComfyQ groups them) and `comfyq_prompt_guide` (`model` = an id or a name: an exact id or name
first, else every word of the name that names something must be in the workflow's id, name or tags — a version glued
back, "FLUX.2"/"flux 2" → flux2 — and filler words are left out; several matches → the candidates with what each needs,
never a guess; none → a plain sentence). The guide ends with what to do: follow the tips to the letter, English unless
the guide says otherwise, one block per field under its name, the size and duration to choose, and that nothing is sent
to ComfyQ. Pure data: no network, nothing about the person. The tool server's line in Open WebUI now reads *"Build and
run graphs on the LlmOnLan Computer, and write prompts for ComfyQ's image, video and audio models (this computer
only)."* (`configBridge.ts`; the env changes once, at the first start after the update — no extra restart, as it is set
before the first spawn). Open WebUI 0.11.4 shows each MCP tool to the model as `lol-computer_<name>` with our
description (`utils/mcp/client.py`), and the server's `info.description` in its tools menu (`routers/tools.py`).

**The real check** — the farm was down on the PRO 6000 (nothing on 4000/41997), so a scratch llama-server b11836 on
127.0.0.1:18094 with the farm's own model (Qwen3.8-27B NVFP4, 32k), the client's MCP server compiled from the branch on
:41975, and the bundled Open WebUI 0.11.4 on :18093 with the env `buildSidecarEnv` makes and a scratch DATA_DIR; one chat
sent as Open WebUI's page sends it (`parent_id: null`, a `session_id`: without one 0.11.4 does not run its tool loop),
the tool on. *"Write me a prompt for FLUX.2 Klein: a lighthouse at night in a storm"*: the model called
`comfyq_prompt_guide("FLUX.2 Klein")`, got the six FLUX.2 Klein workflows, called it again with
`image_flux2_klein_9b_t2i` itself, and answered in 16 s. First run: one long sentence ending in keywords — it had copied
the shipped example's style, which the guide said was "an example of the style"; now *"as an example (where it differs
from the guide, follow the guide)"* and *"following the guide's tips to the letter"*. Second run: *"A lighthouse on a
rocky cliff at night in the middle of a violent storm. Its powerful beam sweeps through the dark, huge waves crash
against the rocks sending spray into the air, lightning flashes split the storm clouds, thick rain falls sideways,
cinematic lighting, moody and dramatic atmosphere, highly detailed."* — subject first, two sentences, 51 words, a short
keyword tail left; negative prompt left empty; 1216×832 or 832×1216 (inside 256–2048). A third: *"…animate it with LTX
2.5, about 5 seconds"* → one call (`"LTX 2.5 image to video"`, one match), a present-tense paragraph with camera and
sound, Duration 5, 1280×704 (on the form's 64 grid), Enhance off.

**Tests:** `comfyq-prompts.test.mjs` (7: tools/list has both and the page never answers them; the listing's groups,
order and counts, a kind by id/label/category, an unknown kind; FLUX.2 Klein's guide by id, name and a loose name with
its tip, fields, example and sizes; a workflow without a guide gets none and no link; *used only when*, switches,
choices, Ideogram's JSON; "FLUX.2 Klein" → 6 candidates, never FLUX.3; a long list cut; Midjourney → a sentence; a
no-prompt workflow; the data's shape, https guides; the generator re-run on E:/ComfyQ byte for byte — skipped, saying
why, when the checkout is absent or at another commit). Gates: shell build; chat-unit 1932/0 (+7); unit 29; lint 0.
**Not done, the owner's:** HUMAN_TESTS A20 (a real ComfyQ box, the pasted prompts); re-run the generator whenever
ComfyQ's workflows change (the test then says the file is due).

## 2026-10-27 (11:45) — Release client v0.2.14 and Farm app farm-v0.0.50: presets for the most people, plugin switches kept

The owner asked for presets (RAG, LOL Vibe, Computer) and approved the release; then, *"more users: probably Nemotron
for Documents, LOL Vibe Flint, correct me if I am wrong"*. The lead's answer, built and checked:
- **Flint for LOL Vibe: not for more users today** — the farm serves it on llama.cpp only (a few people at once) and
  it was not better than Qwen3.6 on the agent's five tasks; it joins the agent-proven list once a vLLM release serves it
  and HUMAN_TESTS J12–J13 measured it.
- **Nemotron for Documents: not at 64k on the PRO 6000** — measured 64 vs Qwen3.6's 63 out of step (both at the spike's
  ceiling) and 16 vs 48 when everyone asks together. In a "most people" pick a lead under 10 % is now a tie the better
  model wins (`scenarios.js` `morePeople`, also the capacity page's rule; its six cards unchanged on every box). So on
  the PRO 6000 all four presets serve Qwen3.6 (nothing to download); Nemotron stays the Documents pick where its lead is
  real (the RTX PRO 5000/5500/Max-Q, estimated), and Q4 measures it past 64 people at 64k, which could flip it.
- **Merged:** `presets` (`79b51cf`) and `presets-users` (`4537dd4`). Gates on the merged tree: farm `test/run.js` 279/0;
  shell build, chat-unit 1925/0, unit 29, lint 0; Farm app `npm test` 9 + 3; on the branch, `vllm-lifecycle.js` 172/0
  (24 steps) and step 24 again 13/0.
- **Client v0.2.14** (tag `v0.2.14`, commit `9c15f95`, CI run 40486229713, 34 min): success, 27 assets; `latest.yml` says
  0.2.14. LOL Vibe's agent reads the farm's `backend.replyTokens` for a model it has no profile of.
- **Farm app farm-v0.0.50** (tag `farm-v0.0.50`, commit `71d2bdd`, CI run 40486234940): a prerelease, 10 assets. The
  Presets card, plugin switches kept, `backend.replyTokens` in the snapshot. A farm-v0.0.49 or older refuses a config
  with `preset`: the release notes say so. No arm64 llama.cpp build (the pin did not move).
- **Release notes:** both pages got a "What's new" above CI's own text.
- **Not done, the owner's:** install farm-v0.0.50 on the PRO 6000 and run HUMAN_TESTS session Q (each preset with a
  laptop; Q4 Nemotron at 64k past 64 people; Q5 the agent's five tasks on Qwen3.6 through the preset).

## 2026-10-27 (10:55, the tie rule 11:04) — Presets for more users: Documents = the most people among models good enough for documents, a lead under 10 % a tie (Qwen3.6 on the PRO 6000 until Nemotron is measured past 64), LOL Vibe = the most people among models proven with the coding agent (Qwen3.6)

The owner: *"I am thinking more users: so probably Nemotron for Documents, LOL Vibe Flint, but correct me if I am
wrong."* Branch `presets-users` (from `multiuser-phase0` 79b51cf). Not merged, not released.

**The rules** (`farm/src/presets.js`): both presets now rank the pairs that cover their head count by people first
(`prefer: 'people'`, the Computer's own ranking in `scenarios.js`) — **a lead under 10 % being a tie the better model
wins** (`scenarios.js` `morePeople`, `PEOPLE_TIE` 0.1, the lead's change at 11:04, below) — among a pool of models:
- **Documents** — models good enough for documents: **25/28 or more on every run of the spike's 28-item check**
  (`GATE_FLOOR`, thinking on and off, each box). Qwen3.6 (26–28), Nemotron 3.5 Lightning (25–27) and Qwen3.8 27B
  (26–28) pass; Gemma 4 12B (22 with thinking on) and Qwen3-Omni (never run on it) do not. 64k kept: Nemotron covers 5
  there. Nemotron does not read images, which documents in Open WebUI do not need (they arrive as text; scanned pages go
  through document reading, a model of its own): its reason says so.
- **LOL Vibe** — models **proven with the IDE's own coding agent** on its five tasks (`AGENT_PROVEN`; the estimator has
  no agent data): Qwen3.6 alone (11/15, docs/spike/RESULTS.md *The coding agent: five tasks*). **Flint is not picked**:
  the farm serves it on llama.cpp only (a few people at once), vLLM's support is in no release, and its agent results
  were not better than Qwen3.6's; its reason line says it joins once a vLLM release serves it and it is measured
  (HUMAN_TESTS J12–J13). Where vLLM does not serve (a GeForce card, no vLLM): a proven model if llama.cpp's or Ollama's
  is one, else llama.cpp's model as before, and the reasons say no proven model is available.

| Box | Balanced | Documents | LOL Vibe | Computer |
|---|---|---|---|---|
| RTX PRO 6000, vLLM set up | Qwen3.6 64k (~48) | **Qwen3.6 64k (~63, measured; 48 when everyone asks at the same moment)**: Nemotron's 64 is a tie | **Qwen3.6 64k (~64, measured)** | Qwen3.6 32k (~104) |
| RTX PRO 6000 Max-Q / 5500 / 5000 72 / 5000 48 | Qwen3.6 64k | Nemotron 64k (124 / 101 / 77 / 37, calibrated: a real lead) | Qwen3.6 64k (70 / 57 / 45 / 20) | Qwen3.6 32k |
| DGX Spark | Qwen3.6 64k (8) | Qwen3.6 64k (8: Nemotron ties at 8, the stronger model wins the tie) | Qwen3.6 64k (8: *not your 10*) | Qwen3.6 32k (8) |
| 24 / 12 GB GeForce, PRO 6000 without vLLM | Ollama `gemma4:12b` | the same | llama.cpp Qwen3.8 27B UD-IQ2_S, *no proven model available here* (without vLLM: *with it, ~64 with Qwen3.6*) | Ollama `gemma4:12b` |

**Where the brief's facts differed from the repo, and what I did:**
- **Nemotron at 64k IS measured** on the PRO 6000 (RESULTS.md headline table: 16 every turn / ≥ 64 out of step,
  replace profile, 58 GiB pool; `measured.json` `followup_64k`). The reason line therefore says *measured*, not
  *estimated*, and adds the number when everyone asks at the same moment (16), the one figure where Qwen3.6 is ahead at
  64k (48): out of step both passed the highest level tried (64), and Nemotron's pool holds ~3× more. HUMAN_TESTS **Q4**
  measures it on the farm itself (its Automatic memory beside document reading, documents appended, up to 128).
- **Qwen3.8 and Nemotron were run with the agent**, but only on the P5-0 spike's single edit task (3/3 each on
  Ollama, docs/research/p5-spike), never the five tasks: not "proven" by the rule, said in the code's comment.

**The tie rule (11:04, the lead's change after the finding above):** at 64k on the PRO 6000 Nemotron does not serve
"more users". Out of step it is **64 against Qwen3.6's 63**, both having passed 64, the spike's highest level (Qwen3.6's
63 is its pool on this farm's memory with document reading beside it), and when everyone asks at the same moment it is
**16 against 48**. A 1-person lead picked the weaker model (25–27/28 against 26–28, no images). So in `scenarios.js`
`byModel`, preferring people, a lead under 10 % is a tie and the order the capacity page already uses decides (good
enough, measured before estimated, then quality): **Documents = Qwen3.6 64k on the PRO 6000 again**. A real lead still
wins: at 32k Nemotron's 192 against Qwen3.6's 109 (160 / 96 when everyone asks together) picks Nemotron; on the Max-Q,
5500 and 5000 the estimate gives it one at 64k too. The capacity page's six cards are unchanged on every box of the
catalog (compared before and after). HUMAN_TESTS **Q4** is now the measurement that could flip Documents: Nemotron at
64k on the farm past 64 people (up to 128; Qwen3.6 too if time allows); 10 % or more ahead, once in `measured.json`, and
Nemotron is the pick by itself.

**Tests:** farm `node test/run.js` **279/0**: the presets tests on the final picks (the PRO 6000 with every model on
disk: Qwen3.6 for all four, the reason with the tie and *48* together; Nemotron alone in the list: picked, *does not read
images*; a box whose Qwen3.6 is not on disk: *Download Qwen3.6 35B-A3B · NVFP4 (23 GB)*, Apply refused before any job;
a model change Nemotron → Qwen3.6 in the dry run; Qwen3.6 proven, why not Flint; the Spark's tie; the GeForce cards' "no
proven model"; a proven Ollama default winning LOL Vibe; the no-vLLM box's "with it" per preset), and in *capacity
scenarios* the tie (documents at 64k on the PRO 6000: Nemotron ahead by under 10 % → Qwen3.6) and a real lead (32k →
Nemotron). Without `morePeople` the scenarios test and four presets tests fail. `LOL_VLLM_FAKE=1 node
test/vllm-lifecycle.js 24` **13/0** (the preset step through the real Apply path; the owner's vLLM, pgid 576, left
alone). Docs: CLAUDE.md, farm/README.md *Presets*, HUMAN_TESTS session Q (Q1/Q3 the picks, **Q4** Nemotron at 64k
measured on the farm past 64, **Q5** the five agent tasks on Qwen3.6 through the preset; 7 steps).

**Not done (the owner's):** session Q on the PRO 6000; the merge and the releases.

## 2026-10-27 (10:08) — Presets: Balanced, Documents, LOL Vibe, Computer, picked for this box; plugin switches kept; the coding agent's reply room

The owner: *"pre-configurations of models for the farm: a configuration for RAG, a configuration for LOL Vibe and a
configuration for the LOL Computer"* — one preset at a time per session, picked in the panel; a **Balanced** one = today's
defaults, the default; a preset switches plugins too, **except document search, never turned off**; the picks automatic
for THIS box from the spike's measurements and the capacity estimator, among what it can run, shown with the reason
before Apply, every field still changeable after. Branch `presets` (from `multiuser-phase0` ed41207). Not merged, not
released.

**The picks** (`farm/src/presets.js`, pure; no measured figure copied: `capacity/scenarios.js` `recommend()` over
`catalog.json`, `measured.json` and the estimator, restricted to this box's catalog entry and to the models of the vLLM
list, each through its `catalog` id). Each preset is picked for one of the capacity page's own cards (its use and head
count): Balanced for *A class chatting* (30), Documents for *documents (RAG)* (5), LOL Vibe for *vibe-coding* (10),
Computer for *a Computer workshop* (20).

| Box | Balanced | Documents | LOL Vibe | Computer |
|---|---|---|---|---|
| RTX PRO 6000, vLLM set up | vLLM Qwen3.6 64k (~48, measured) | vLLM Qwen3.8 27B 64k (~20, measured; 22 GB to download) | vLLM Qwen3.8 27B 64k (~23) | vLLM Qwen3.6 32k (~104, measured) |
| DGX Spark, vLLM set up | Qwen3.6 64k (8: *not your 30*, said) | Qwen3.6 64k (8; Qwen3.8 serves < 8 there) | Qwen3.6 64k (8: *not your 10*) | Qwen3.6 32k (8) |
| 24 GB GeForce (RTX 4090) | Ollama `gemma4:12b`, Automatic, 2 | the same | llama.cpp Qwen3.8 27B UD-IQ2_S, Automatic, 1 | Ollama `gemma4:12b` |
| 12 GB GeForce (RTX 4070) | the same as 24 GB | | | |
| RTX PRO 6000 without vLLM | the same, and *"with vLLM this GPU would serve about N people with …"* | | | |

People at once and GPU memory are **Automatic** on vLLM (the measured seats, capped by the pool). Plugins: Balanced =
as shipped (web search, document reading); Documents = web search + document reading; LOL Vibe = web search only
(document reading off: its 9 GB go to vLLM); Computer = all six. Document search is not one of them.

**Where I changed the proposal, and why:**
- **Documents at 64k**, not scenarios.js's 32k for documents: the owner's 64k (Open WebUI goes whole-document from 24k;
  64k holds twice as much). The capacity card's head count (5) stays.
- **Computer** adds *sees pictures, tool calling, BenchLM ≥ 40* to the capacity page's Computer use (which needs only
  32k): without it the most-people pick on the PRO 6000 was Nemotron, which cannot read the Image box. With it, Qwen3.6.
- **Balanced on vLLM** = vLLM's shipped defaults (Qwen3.6, 64k, Automatic), not the farm's default engine (Ollama):
  "today's default setup" on the PRO 6000 is what it serves now; switching it to Ollama's 2 seats would be no default.
- **vLLM only on a GPU the capacity page knows for a group** (an exact match: PRO 6000/5500/5000, Spark). A GeForce card
  (a one-person box there) or an unknown GPU keeps to Ollama and llama.cpp, even with vLLM set up; the reason says so.
- **People at once on Ollama and llama.cpp** stay their defaults (2 and 1): nothing measured supports more.
- **"Long replies" for LOL Vibe** is not a farm setting (the reply limit is already 32768 everywhere): it is the client
  change below, which uses it.

**Apply** (`up.js` `makePresets`, module level like `makeStorage`, tested with stubs): Review is a dry run (why each pick,
exactly what changes field by field, what a plugin's first start installs, what restarts and for how long, what to
download first — offered with a Download button on the existing routes, never waited for). Apply is ONE job through the
existing controls: `setBackend`, `applyFarmSettings` and `applyVllmSettings` take an `inJob` progress and run their body
inside the preset's job (`jobOr`) instead of starting their own — no second implementation. Order: the plugins it turns
off; the engine and its settings (another engine: its settings written first, checked by vLLM's own `applyChange`, so
the switch starts it once with them, and put back if the switch fails; the same engine: the one Apply, and a running vLLM
restarts when document reading or speech to text on the GPU flips — `forceRestart` — so Automatic memory follows); the
plugins it turns on (counted as on while the engine sizes its memory); then `preset: {id, applied}` in the file. The
card marks that preset, and **changed** with what differs when a setting was changed by hand since (compared with the
config FILE, never a fallback's memory). A farm that never applied one shows Balanced while its settings are Balanced's.

**Plugin switches persist** (the panel said "this session only"): Enable/Disable writes `<plugin>.enabled`, once the
plugin came up or stopped. The panel's sub line, the README and CLAUDE.md say so.

**The coding agent's reply room** (client): the farm calls every model `assistant`, so the IDE gave a model it has no
profile of 8192 tokens a reply, which cut Flint (DEVLOG 2026-10-23). The snapshot now advertises the farm's reply limit,
`backend.replyTokens` (`proxy.maxReplyTokens`, 32768; absent on an external server; contract updated); LOL Vibe's caps
carry it, `projects/models.mjs` `profileFor(model, farmReply)` gives it to a model with no profile, and main's
`agentMaxTokens` shrinks a room above 8192 on a small window as it does Keep going's (32768 on 64k, 20480 on 32k, 8192 on
16k), so dsh can still compact. A measured model keeps its own: **Qwen3.6 gets a profile at 8192** (15 agent tasks never
came near it), so the owner's default does not start compacting at 28k instead of 52k. A farm that does not say: 8192 as
before. Ships with the next client release.

**Tests:** farm `node test/run.js` **279/0** (10 new: the picks for the PRO 6000, a Spark, 24 GB, 12 GB, an RTX 5090 and
a box without vLLM; document search never switched; the dry-run list; a change by hand marks *changed*; Apply's order
and its failure path; the config key and plugin persistence; the panel card; `backend.replyTokens`. Two source-shape
tests follow the `inJob` paths). Shell: build, `chat-unit` **1925/0** (3 new), `chat-lint` 0, `test:unit` 29/29;
`chat-scope` flags the farm and main files, as for any such change. `LOL_VLLM_FAKE=1 node test/vllm-lifecycle.js`
**172/0, all 24 steps**, with a new step 24: a preset through the real Apply path on this box's GPU (the dry run's exact
list and "vLLM restarts once"; Apply restarted the fake vLLM once at 64k with Automatic people and memory, turned the message bus
off, kept everything in the file, recorded the preset; the bus enabled by hand afterwards stays in the file and marks
*LOL Vibe · changed*), run from a copy of the farm with a fake SearXNG (web search is on in every preset; nothing
installed). The owner's vLLM (`~/lol-vllm`, pgid 576) was read before and after, never touched.

**Seen on screen:** the panel against a stub of `/lol/admin/state` whose Presets card and dry runs come from the real
`presets.js` and `makePresets` (PRO 6000, Qwen3.6 serving), in an offscreen Electron: the card on top, Review of Computer
and LOL Vibe (Download offered, Apply waiting), a preset changed by hand, and a phone's width (no sideways scroll).

**Not done (the owner's):** HUMAN_TESTS session Q (each preset on the PRO 6000, a laptop in each use); the merge and the
releases (a farm-v0.0.49 refuses a file with `preset`).

## 2026-10-23 (19:04) — Release client v0.2.13 and Farm app farm-v0.0.49: the coding agent's fence on a second drive, llama.cpp b11836

The owner said "yes release" after the Flint evaluation. Done:
- **Merged:** `flint` into `multiuser-phase0` (`8a05ed1`), then `main` fast-forwarded. Gates on the branch, re-run by the
  lead before the merge: farm `test/run.js` 269/0; shell build, chat-unit 1922/0, unit 29, lint 0 (287 files).
- **Client v0.2.13** (tag `v0.2.13`, commit `568a765`, CI run 39986592810, 38 min): success, 27 assets; `latest.yml`
  says 0.2.13. It brings the coding agent's start check (dsh's own sandbox runner tried first; where it cannot run —
  a data folder on a second drive on Windows — the agent does not start and says to move the folder) and the fence
  accepting `sandbox_permissions: "workspace-write"` only.
- **Farm app farm-v0.0.49** (tag `farm-v0.0.49`, commit `8aad003`, CI run 39986599831): a prerelease, 10 assets. It
  brings llama.cpp b11836: the upstream non-streaming cancel fix (all 8 paths stop), document search's flash
  attention (~2.5x faster), the same flags.
- **`build-llamacpp-arm64`** (CI run 39986585475) published `llamacpp-b11836` for the Spark: success.
- **Release notes:** both pages got a "What's new" above CI's own text (Flint is not advertised: the IDE gives an
  unknown model 8192 tokens, too little for it).
- **Not done, the owner's:** delete `F:\lol-scratch-flint` (64 GB of the evaluation's downloads: a delete the session's
  safety check refused); install farm-v0.0.49 on the PRO 6000; HUMAN_TESTS G11 (the agent on a second drive) and, for
  Flint at full speed, J12–J13 (vLLM stopped at a quiet moment).

## 2026-10-23 (16:55) — Flint for the coding agent: llama.cpp b11512 → b11836, Flint measured beside the live farm, and the project fence found off on a second drive

The owner asked whether Recursive's **Flint** (released 2026-10-21; a 39.8B MoE with ~2.5B active, made for coding
agents) should be the farm's model for coding, above all for the IDE's coding agent. Branch `flint` (from
`multiuser-phase0` 2be6186). Not merged, not released; Flint is in no list and no default. The measurements and the
agent comparison: [spike/RESULTS.md, *Flint for coding*](spike/RESULTS.md#flint-for-coding-rtx-pro-6000-shared-gpu-2026-10-23).

**Recommendation: not now — keep Qwen3.6 on vLLM as the farm's model and the IDE's.** Flint does the agent's job about
as well as Qwen3.6 on these tasks (8/10 against 11/15, given the room it needs; 27/28 against 26/28 on the gate, with a
quarter of the thinking), not clearly better; it is text only, always thinks, and runs on the farm's llama.cpp only
(vLLM: a day-0 Docker image and an open PR), where a farm serves a few people, not 48. Where it fits is a **second, small
farm for coding**: its experts live happily in system RAM (3.3 GB of GPU, ~44 tok/s). Quant **UD-Q4_K_XL** (Q8_0 scored the same on the gate at 60 % of the speed).
What is still unknown is in HUMAN_TESTS J12–J13 and below.

### Part 1 — the llama.cpp pin: b11512 → b11836

**The pin: b11836**, an official ggml-org release of 2026-10-23 08:20 UTC, the newest with its Windows x64 CUDA zips
when pinned (324 commits after b11512). Three things the farm wants came after b11512:
- **Flint** (`flint`, PR #30928) from **b11803**; its chat template needs the template engine's hexadecimal escapes
  (#30929, b11798) and a namespace fix (#30941, b11802). b11512 refuses the GGUF (*unknown model architecture: 'flint'*)
  and the panel's sentence reads right ("…newer than the farm's llama.cpp build…"), checked.
- **The non-streaming cancel fix** (#29707, merged 2026-10-20, **b11769**): below.
- **Faster document search:** flash attention now runs for EmbeddingGemma 2 on CUDA (below).
- `farm/src/llamacpp.js` `PINNED_BUILD` and `.github/workflows/build-llamacpp-arm64.yml` `LLAMACPP_BUILD` are b11836
  (the workflow runs on the merge to `main`, not before; the push of `flint` ran nothing). The Windows zips are still
  `cuda-13.4`; `cudart-llama-bin-win-cuda-13.4-x64.zip` is byte for byte b11512's; the llama zip adds `llama-connect.exe`
  and removes nothing, so extracting over b11512 leaves no stale file. `ensureLlamacpp()` fetched both under the farm's
  names; their sha256 match the release's digests.

**What changed that touches the farm** (`common/arg.cpp`, the server sources, both binaries' `--help`, both DLLs):
- **Every flag `argsFor()` and `embed.js` pass is still there, with the same text and defaults**, `--spec-type
  draft-mtp`, `--spec-draft-n-max`, `--embeddings`, `--no-slots` and `--cache-ram 0` included.
- New: `--spec-draft-n-ubatch`; `--connect` / `--connect-code` (*experimental*: a peer-to-peer tunnel to the server
  from outside the LAN; off by default, or `LLAMA_ARG_CONNECT`); `LLAMA_ARG_SLOT_SAVE_PATH`.
- Defaults the farm overrides anyway: `--port` 8080 → 9931 (the farm always passes it); `--cache-ram` 0 for decision
  models.
- **The same:** the 15 `/metrics` names `perf.js` reads, `/health`, the log's level markers, and the *unknown model
  architecture* and *doesn't contain MTP layers* lines `explainEngineFailure()` quotes (in `llama.dll` on both).
- **MTP:** the flags parse as before; on the stripped UD-IQ2_S, b11836 says *"model doesn't contain MTP layers"* and the
  farm's sentence reads *"This quant has no MTP head…"* (checked through `spawnLlamacpp`). MTP's speed on an MTP quant
  (UD-Q2_K_XL) was not re-measured: no flag or default it uses changed.
- Not changed, noted: the log calls `--no-webui` deprecated (*use --ui/--no-ui*) on b11512 and b11836 alike; it works.
- **Found on the way, not changed:** the engine's `spawnLlamacpp` hands llama-server the box's whole environment, so a
  `LLAMA_ARG_CONNECT` set on the farm box would open that tunnel (`embed.js` already drops every `LLAMA_*` variable).
  Nobody sets it; the box's environment is the operator's.

**Measured on the PRO 6000** (driver 596.36) beside the owner's farm (Farm app v0.0.48 serving Qwen3.6 on vLLM, ~78 GB of
the card, ~17 GB free). A watchdog stopped my runs below 6 GB free or if the farm turned busy (it never had to; the
lowest free figure it saw was 6.6 GB). Scratch loopback ports (18181–18199) only; the owner's farm, vLLM, Ollama and
Farm app were never touched, `F:\LlmOnLan` only read.
- **The farm's own path** (config, `argsFor`, `spawnLlamacpp`, `waitForLlamacpp`, `fetchMetrics` + `metricsSample`) on
  Qwen3.8-27B-UD-IQ2_S (the main checkout's copy, read only), 32k, 2 slots, q4_0 KV, the unified pool, the projector:

| | b11512 | b11836 |
|---|---|---|
| healthy after | 6 s | 6 s |
| GPU memory | +10,407 MiB | +10,407 MiB |
| a reply, thinking off | "The capital of France is Paris.", 87.0 tok/s | the same answer, 89.6 tok/s |
| a reply, thinking on | 108.9 tok/s | 111.9 tok/s |
| a tool call with `--jinja` | `get_weather({"city":"Paris"})`, then an answer from its result | the same |
| two people at once (400 tokens each) | both at once, TTFT 244 ms, 92.4 tok/s each | both at once, TTFT 256 ms, 95.1 tok/s each |
| `/slots` | 2 slots, 32768 each | 2 slots, 32768 each |
| a red picture | "Red" | "Red" |
| `/metrics` through `perf.js` | 15 series; 96 tok/s; 38 % of prompt tokens from cache | 15 series; 100.7 tok/s; 38 % |

- **EmbeddingGemma 2** (the farm's pinned BF16, read where the owner's farm keeps it) with `embed.js`'s own argv:

| | b11512 | b11836 |
|---|---|---|
| the contract check (`waitForEmbed`) | 768 numbers | 768 numbers |
| French–English pair / an unrelated sentence | 0.893 / 0.590 | 0.893 / 0.590 |
| the same texts, one build against the other | | cosine ≥ 0.99999 |
| 400 pieces of ~175 tokens in one request | 1.97 s (twice) | **0.80 s** (three times) |
| GPU memory loaded / at its peak | 1,153 / 1,157 MiB | 1,039 / 1,159 MiB |

  2.4× faster because b11836 runs flash attention for this architecture on CUDA (b11512's log: *"Flash Attention not
  supported, set to disabled"*). `RESERVE_GIB` (1.5) still covers the peak.
- **The cancel test** (`LOL_CANCEL_ENGINE=llamacpp node test/litellm-cancel.js`, Qwen3.8 IQ2_S, LiteLLM 1.90.0): **8 of 8
  paths stop** — streams 17 ms after the abort, non-streaming calls 0.95–0.99 s after it, **the one abandoned while
  someone else streams included (945 ms; b11512: 19.6 s, 2071 tokens)**. README, `litellm.js`, the test's header and
  `docs/archive/LLAMACPP_NONSTREAM_CANCEL.md` (fixed upstream, nothing left to post) say so.

### Part 2 — Flint beside the live farm (most of its experts in system RAM)

- **The GGUF:** `general.architecture = flint`; 23.05 of UD-Q4_K_XL's 25.05 GB are routed experts; KV 28 KiB a token in
  f16 (14 full-attention layers), so 64k costs ~1 GB in q8_0; it carries Flint's sampling (`temp 1`, `top_p 0.95`,
  `top_k 20`), which llama-server takes as its defaults (`/props`), so the agent — which sends none — gets them. Its
  licence fields say `other` / `flint-preview`, the card says Apache 2.0: **which governs is unknown**.
- **Template:** GLM-4.x-style tool calls, no thinking switch (`enable_thinking: false` changes nothing), reasoning kept
  for every earlier turn; llama.cpp b11836 with `--jinja` parses the calls and keeps the reasoning (*"enabled by
  default"*). `--cache-reuse` is off for it (sliding window); the exact-prefix cache carries an agent's history.
- **The farm's route keeps what it asks for:** `reasoning_content` on earlier turns reaches the prompt and `top_k`
  arrives, through the seat gate and LiteLLM's `openai/` route (and the vLLM route keeps the reasoning too). **The coding
  agent sends its reasoning back** on every step and sends no sampling (a tap between dsh and the farm).
- **Speed, one person** (UD-Q4_K_XL, the farm's argv + `--n-cpu-moe`, q8_0 KV): every expert in RAM, **3.3 GB of GPU,
  43–45 tok/s, TTFT 2.9 s at 3.3k and 15.5 s at 24.8k with `-b 2048 -ub 2048`** (7.3 s / 46.6 s with llama.cpp's default
  batch: the experts cross PCIe once per batch); 12 of 47 expert layers on the GPU, 8.3–9.0 GB: 52–55 tok/s, 2.3 s at
  3.3k, 15.5 s at 31.4k. Q8_0, every expert in RAM: 4.0 GB, 30–32 tok/s, 5.1 s at 3.3k, 34 s at 31.4k. **The laptop-farm
  data point:** ~4 GB of GPU and ~25 GB of free RAM run it at ~44 tok/s.
- **The quality gate (28):** Flint UD-Q4_K_XL **27/28** with 21,260 completion tokens, Q8_0 **27/28** with 22,857 (the
  same miss); Qwen3.6 through the farm 26/28 thinking on (80,021 tokens), 28/28 off (10,633).
- **The coding agent** (`docs/spike/ide/run.js`: studio.js as LOL Vibe runs it, five tasks — a bug fix, a p5.js
  feature, tests that must catch mutants, a two-file refactor, code from a test file — each checked by running what the
  agent left):

  | Runs (reply room 8192 unless said) | t1 | t2 | t3 | t4 | t5 | **all** | wall a task (median) | steps (median) | tool calls (median) | failed tool calls (all) | output tokens a task (median) | ended on max-tokens |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | Qwen3.6, fence off (F:) | 2/3 | 2/3 | 1/3 | 3/3 | 2/3 | **10/15** | 13 s | 10 | 10 | 14 of 152 (9 %) | 2275 | 0 |
  | Qwen3.6, fence on | 3/3 | 3/3 | 1/3 | 3/3 | 1/3 | **11/15** | 21 s | 9 | 8 | 21 of 126 (17 %) | 2156 | 0 |
  | Flint, fence off (F:) | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 | **12/15** | 168 s | 12 | 16 | 78 of 390 (20 %) | 8084 | 3 |
  | Flint, fence on (as shipped) | 2/3 | 1/3 | 1/3 | 2/3 | 2/3 | **8/15** | 171 s | 15 | 18 | 103 of 274 (38 %) | 8399 | 2 |
  | Flint, fence on, standing mode allowed | 3/3 | 0/3 | 1/3 | 3/3 | 2/3 | **9/15** | 255 s | 9 | 14 | 50 of 228 (22 %) | 5590 | 4 |
  | Flint, same, 32768-token replies | 2/2 | 2/2 | 2/2 | 1/2 | 1/2 | **8/10** | 234 s | 13 | 15 | 64 of 287 (22 %) | 10922 | 0 |
  | Flint Q8_0 (every expert in RAM), same, 32768 | 1/1 | 0/1 | 1/1 | 1/1 | 1/1 | **4/5** | 209 s | 7 | 10 | 13 of 54 (24 %) | 5964 | 0 |

  - **The reply room:** at LOL Vibe's 8192 (any model it does not know; the owner's farm calls every model
    `assistant`) Flint ran out on the p5 task in 8 of its 9 runs; with 32,768 it passed 2 of 2. Qwen3.6
    never came near.
  - **The fence as shipped refused most of Flint's writes:** it names `sandbox_permissions: "workspace-write"` (the
    mode it already runs in) with a justification on 75 of 130 writes and edits; the fence refused every
    `sandbox_permissions` → 8/15, 38 % of its calls failed. **Fixed on this branch** (below): 9/15 at 8192, 8/10 at 32,768.
  - Flint's own misses: no-op edits in loops (one run 145 steps), re-reading files, asking for a shell, editing a file
    it was told to keep (twice in 40 runs with the fence), one malformed tool call in ~1,100 steps. Qwen3.6's: wrong
    expectations in the tests it writes, a subtle `deepStrictEqual` miss, `exit_plan_mode` outside plan mode.
  - **Time:** 2.5–4 min a task for Flint here (experts in RAM, 5–8k output tokens a task with 32k: 11k), 13–21 s for
    Qwen3.6 on the farm's vLLM.
- **vLLM:** day-0 support only in the `vllm/vllm-openai:flint` Docker image; mainline is PR #62938. The farm's managed
  vLLM (a pip install in WSL) cannot serve it until a release carries it.
- **Recursive's numbers** (Terminal-Bench 2.1 54.9 %, SWE-bench Pro v2 89.7 %, Verified 74.2 %) are its own; no
  independent rerun found. Pro scoring 15 points above Verified inverts every other model; "Pro v2" is not defined.
  Verified at 74.2 is level with Qwen3.6's reported 73.4.

### The project fence was off on a second drive — fixed (fail closed)

The first agent batches had their data folder on F:. There, **dsh ran no hook at all**: its Windows sandbox runner
sets a Low-integrity label and a write grant on the project folder (`SetNamedSecurityInfoW`), and on a second drive's
default rights (Authenticated Users: Modify, not Full control) Windows refuses (error 5). dsh then reports the hook as
*"sandbox mode … no sandbox backend is usable on this host"* and **lets the tool call through** (the hook bridge fails
open). So the fence and the syntax check were off: a real agent asked to read `../secret.txt` quoted it to the model
(checked on Qwen3.6 through the farm, a planted file). The same project on C: (the user's profile, Full control): the
read refused, `decision: block`. The owner's client uses the default data folder (C:), so it was safe; a person who moved
the data folder to another drive, a USB stick or a network folder was not.
- **Fix (`studio.ts` `sandboxBlocked`):** before dsh starts on Windows, the client runs dsh's own runner once (in the
  background, ~0.2 s) with the arguments dsh gives it, on a command that does nothing; if it fails, the agent does not start and the person reads
  *"The coding agent cannot work in this folder: Windows does not let it set up what keeps it inside the project (…).
  This happens when the data folder is on a second drive, a USB stick or a network folder. Move the data folder into
  your user folder (Preferences ▸ Data location), then send again."* Checked live: F: refused, C: starts.
- macOS and Linux need sandbox-exec or bubblewrap/Landlock the same way and are not checked by the client:
  HUMAN_TESTS E4 now says what a passing read means there; G11 is the Windows test.
- **The fence also lets a call name the standing mode** (`sandbox_permissions: "workspace-write"`, which dsh grants
  without a question): Flint's habit, refused until now. Any other value is still refused; the path still decides.

**Tests:** farm `node test/run.js` **269/269** (the pin test also asserts ≥ b11769 and ≥ b11803, and fails with
b11512: 268 + 1 failed). Shell `node test/chat-unit.js` **1922/0** (the new `sandboxBlocked` test fails without the
check; the fence test's three new lines fail with the old rule), `chat-lint` 0 violations, `npm run test:unit` 29/29.
`chat-scope.js` flags the 8 files outside LOL Chat's allowlist, as it does for any farm or main-process change.

**Not done (the owner's):** the merge (it runs `build-llamacpp-arm64`), a farm release and a client release; Flint on
the whole GPU (HUMAN_TESTS J12) and the agent at full speed against Qwen3.6 (J13); the fence on a second drive by a
person (G11) and on macOS/Linux (E4). Every process started here was stopped (the owner's farm stayed healthy on vLLM
throughout), and the worktree's `farm/.llamacpp` and `farm/.models` were removed. **Left for the owner to delete:**
`F:\lol-scratch-flint` (64 GB: the two Flint GGUFs and a b11512 copy) — Claude Code's own safety check refused a
recursive delete of a folder at a drive's root.

## 2026-10-13 (09:24) — The PRO 6000's models and its WSL disk are on F: — C: from 65 to 618 GB free

The owner: *"we need to actually move the models and free up space on C, lets do what we talked about"*. Done from
the panel's own routes (the Farm app's token), on the installed Farm app:
- **The models** (farm-v0.0.48, HUMAN_TESTS O1): Laya's weights were the one file v0.0.47 had left behind (judged
  damaged by the shared file's name). With nothing left to move for the farm, they were finished by hand exactly as
  v0.0.48 does it — the shared file copied to `<sha256>.lolmove-part`, its sha256 checked against the link's name
  (`891102…`), renamed into place; then Classify's old folder on C:, holding only that 0-byte link, removed. The
  shared 843 MB file stays in the Hugging Face cache. All of the farm's models are in `F:\LlmOnLan`: Ollama (10
  models, the app pointed there by the farm), gguf, speech to text, Classify.
- **WSL's disk** (HUMAN_TESTS O3): the vLLM section's move of Ubuntu (421 GB file) to `F:\LlmOnLan\wsl\Ubuntu` —
  dry run first (only Ubuntu ran: all of WSL was not stopped), then 7 min from *stopping Ubuntu* to *vLLM runs again*;
  the registry's BasePath points at F:, the old folder is gone, and a chat through the gate answered in 0.31 s.
- **Result: C: 65 → 618 GB free.** F: 1764 → 1211 GB free.
- **A slip of the lead's:** before the v0.0.48 install, `Stop-Process` ended the Farm app at once instead of the window
  close that runs `lol down` (a shell check had refused the combined command). vLLM kept running as after a crash and
  v0.0.48 adopted it at its start (busy cleared at once, no reload): the designed crash path, now seen on the real box.
- **Not exercised:** a deliberate Stop/Quit in the middle of the move (two real cuts were resumed instead), document
  reading of a scanned PDF from a laptop, and looking at Ubuntu's other projects by hand after the move.

## 2026-10-13 (09:09) — The models are on F: (140.1 GB freed on C:); Classify's weights judged damaged by the wrong name

farm-v0.0.47 was installed (the Farm app closed through its own Quit, so `lol down` stopped vLLM first; installer
sha256 checked) and Move here pressed again: it resumed from its journal and finished in 2 min 4 s (09:04:22 → 09:06:26):
Ollama's 136 GB copied and checked by checksum, the **Ollama app pointed at `F:\LlmOnLan\ollama` by the farm**
(closed, its setting written, reopened), the stores switched, **140.1 GB freed in the old folders** on C:.
- **One file left behind:** Laya's weights were *"damaged already (their checksum differs)"*. They are not: in a Hugging
  Face cache the sha256 is the **model's link name** (`blobs\891102…`, measured: the shared file's sha256 is exactly
  that), while the shared file `blobs\dd\dd8562…` is named by another hash. v0.0.47 read the shared name as the
  checksum. Nothing was lost (a damaged file is never copied or deleted: the original and Classify's link stay on C:),
  but `F:\LlmOnLan\classify` has no weights.
- **Fix (`storage.js` `sharedDigest`):** the checksum is the link's name when it is 64 hex digits, else size and bytes.
  The test now builds the real layout (link named by the sha256, the shared file by another hash) and a really damaged
  shared file (not copied); it fails on v0.0.47. Farm `test/run.js` 269/0. Shipped as farm-v0.0.48.

## 2026-10-13 (08:54) — The real move on the PRO 6000 stopped on Classify's model: Hugging Face's shared blobs

The owner asked to move the models off C: (65 GB free) now. farm-v0.0.46 was installed over v0.0.45 (silent per-user
installer, its sha256 checked against the release; the Farm app started, refreshed its farm code, and came up healthy
on vLLM). The dry run to `F:\LlmOnLan` (the 990 PRO NVMe, 1895 GB free) planned 140 GB: Ollama's models (136 GB, run by
the Ollama app, the app switched by the farm), the gguf folder (2.5 GB), speech to text (1.6 GB) and Classify (3.6 MB
listed).
- **The move stopped after 4 s, safely:** `models--convaiinnovations--laya\blobs\891102…` *is a link to something
  outside* its folder. Nothing was deleted, nothing switched; the journal keeps what was copied (4.1 GB).
- **Why:** huggingface_hub's **shared blobs** — a file is kept once in `<hub>\blobs\<2 chars>\<sha256>` (the folder is
  marked by `.huggingface-shared-blobs`) and a model's own `blobs\` only links to it. Laya's weights (804 MB) live
  there; the same cache holds ComfyUI's FLUX/LTX/Wan models, so deleting a shared file could break another program.
- **The fix (`storage.js` `sharedBlobOf`):** a link that leaves the model's folder and lands on a file in a folder marked
  as shared blobs is moved as that file: its content is copied into the farm's folder as a real file, checked against
  its name (its sha256), and afterwards only the model's link is deleted — never the shared file (`deleteMoved`
  `sharedLeftBytes`; Finish says how many GB stay in the shared cache and does not count them as freed). Any other link
  out of a folder still stops the move. Test: *a model in Hugging Face's shared blobs moves as its file…* (fails on the
  old code: the link was listed as a link and refused). Farm `test/run.js` 269/0.
- Shipped as farm-v0.0.47 (farm only; the client is unchanged); then the move goes on from its journal.

## 2026-10-12 (17:18) — Release client v0.2.12 and Farm app farm-v0.0.46: Converse, Model storage, the panel by engine

The owner chose (15:04) to ship farm-v0.0.46 together with Converse. Done:
- **Merged into `multiuser-phase0`:** `model-storage` (`1d67eab`, with both reviews' fixes and the owner's decisions of
  2026-10-12), a test made independent of what the machine downloaded (`600d65f`), `panel-engines` (`33cdaf2`), the
  plan with the owner's answers (`27817c1`) and `converse` (`7938f9d`). Gates on the merged tree: farm `test/run.js`
  268/0; shell build, chat-unit 1921/0, unit 29, lint 0 (287 files); on their branches: Farm app `npm test` 9 + 3,
  `LOL_VLLM_FAKE=1 vllm-lifecycle.js` 161/0, the chat harness 411/411 (converse).
- **Client v0.2.12** (tag `v0.2.12`, commit `69d9c6a`, CI run 38264352216, 39 min): success, 27 assets; `latest.yml` says
  0.2.12. It brings the Converse box, the Voice face preset and the Voice persona template.
- **Farm app farm-v0.0.46** (tag `farm-v0.0.46`, commit `b8bee37`, CI run 38264357882): a prerelease, 10 assets. It
  brings Model storage and the panel in one section per engine. farm-v0.0.45 and older refuse a config with
  `storage`: the release notes say a downgrade removes that line first.
- **`build-llamacpp-arm64`** (CI run 38264345548) ran again (`llamacpp.js` changed with Model storage): success.
- **Release notes:** both pages got a "What's new" above CI's own text.
- **Not done, the owner's:** HUMAN_TESTS session O (the real moves on the PRO 6000: F:, not D: — a hard disk —
  Ollama's 127 GB through the app, the WSL disk, the farm's own models), P1 (the panel's sections in the Farm app's
  window), F8–F11 (Converse with a real microphone, French, the mic light, a class).

## 2026-10-12 (16:20) — Converse: a real voice loop on the Computer, with a face (branch `converse`)

The owner: *"design students working on voice interaction: the identity of the voice bot, what to show, how the
feedback between bot and user works. Use the Computer for this. No Wizard of Oz … a POC."* Built from
[COMPUTER_VOICE_PLAN.md](archive/plans/COMPUTER_VOICE_PLAN.md) and the owner's four answers of 12 Oct (the face is whatever Preview is
▶ Live; Interruptible on by default; the transcript kept as the box's value; the app stays English, the template
carries a French persona with `ff_siwis`). Worktree `converse` from `multiuser-phase0` at `27817c1`; not merged, not
released.

**The plan first** (commit `5ddcdc7`): brought up to date at `27817c1` — the farm's speech to text on the GPU
(large-v3-turbo int8_float16, ~0.15 s for a 5 s phrase; `small` on the CPU), chunked uploads, PyAV pinned, the snapshot's
`stt {url, key, model}`, Open WebUI's Call pointed at it (and its fixed 2 s end of phrase), Kokoro's `/audio/voices` and
`speed` read in its source, lessons 13–14 being the home's, the classroom bottleneck re-measured (still one transcription
at a time farm-wide). Its new §15 names what the code changes in the contracts; every decision kept.

**Built** (renderer only; nothing in `src/main`, nothing on the farm):
- `graph/voice.mjs` (pure, in the lint's PURE_MODULES): the energy detector (calibration that waits while the bot speaks,
  a noise floor learnt only in silence and never from the bot, onset 120 ms back-dated, hysteresis, end-of-turn knob,
  cough, monologue, the raised barge-in threshold ×4 ≥ 0.07, a stalled frame ≤ 250 ms, `vadQuiet`), the turn's window
  in the take, mono 16 kHz resampling and the WAV, the sentence cutter (3.5, M., etc., French closing quotes, a comma
  cut over 160 characters), `speakable`, Whisper's silence phrases compared whole, the event shape, the timings, the
  history that always alternates.
- `graph/parts/converse.mjs`: the box (*think*, `manual`, glyph ◖)) and `converse(deps)`, the loop of §5 with every
  device and door injected; `capture.mjs` `openListening` (the one microphone door: echo cancellation, a meter on the
  window's AudioContext, takes that overlap so no turn loses its start, close stops every take and track; a window that
  cannot measure the microphone lets it go at once); `audio.mjs` `audioContext()` and `playBytes`'s `onStart`/`onLevel`;
  `app/ask.mjs` `onText`/`history`/`thinking` through `normalise()`; `net/stt.mjs` Retry-After; `net/tts.mjs` `speed` and
  `listVoices`; the sandbox's `event` command with `lol.on(type|'*', fn)`, `lol.voice` and `window.lol` for a live page,
  the live handle's `send(ev)`; `EV.COMPUTER_SHOWN` (and `app.state.shown`); MCP `run_graph` refuses a Converse box;
  `voice.*` lines in the Record log from a private bus name; the **Voice face (p5.js sketch)** preset (`presetOf` now takes
  the most specific match); the ? examples for both; the **Voice persona** template.
- Changed on the way, each named in the plan's §15: no `volatile` (it would re-run everything after the box at each Run
  all); the face through `sandboxNow()` (never booting a guest); Button's press registry, plus a 15 s freshness;
  `meteredAsk` now passes a part's own signal (it used to replace it, so an interrupted answer could not be aborted);
  the template declares 13 generations (its most), not 1.

**Tested.** Shell build clean; `chat-unit` **1921 passed** (from 1863: `voice` 26, `converse-part` 23 — whole
conversations on a virtual clock and the consent rules through the box's real `run()` —, and additions to `ask`,
`graph-runner`, `sandbox-protocol`, `sandbox-live`, `capture`, `core`); `test:unit` 29; `chat-lint` 0 violations, self-test
26/26; `chat-scope --base 27817c1` clean but for CLAUDE.md (outside the chat scope by nature). Every rule was taken out
once and its test failed (29 mutations, a scratch script). Harness: **k27-converse** (a speech-like WAV as Chromium's
fake microphone, `mic-fixture.js`; the mock's voice list, a voice as long as its text, a slow three-sentence model): one
turn reaches a live p5 face in §4's order, the first sentence goes to the voice before the stream ends, a turn of the
person's interrupts the bot and is answered, switching to LOL Vibe ends it and every microphone track is `ended`. The
harness now mutes its sound (`--mute-audio`) and its pinned catalogue lists moved for the new box (c3-landing,
k4-shots-kinds through `computer-look.css`'s kind map, k5-lessons, k5-palette). Whole harness, on the final code:
**411 passed, 0 failed** (one earlier run of the k3 phase had `k3-sched` time out; it passed on three reruns).

**Measured end to end on the PRO 6000, beside production** (production's vLLM idle with 48 seats; GPU kept ≥ 11 GB free):
scratch services on scratch ports — the worktree's `stt_server.py` with large-v3-turbo on the GPU (:8971, a scratch
venv, the model files copied from the Farm app's cache), the dev checkout's Kokoro v0.5.0 on the GPU (:8981), a scratch
llama-server b10516 with Qwen2.5-3B-Instruct Q4_K_M (:8961), a tiny `/lol/self` (:42091) — and the harness's Electron
main as the client (the real renderer and Computer), its microphone a WAV of two French questions said by Kokoro,
muted. A persona (Margot), Converse in French with `ff_siwis`, the Voice face Live. 3 runs, 9 turns:

| | median | range |
|---|---|---|
| end of speech → first sound (the wait a person feels; 800 ms end of turn) | **1.31 s** | 1.10–1.41 s |
| end of speech → words written down | 1.09 s | 0.94–1.17 s |
| the speech-to-text request alone (decode, upload, GPU) | 0.27 s | 0.12–0.34 s |
| model asked → first word (3B) | 18 ms | 17–22 ms |

Open WebUI's Call mode measured 2.1–2.5 s (median 2.37 s) on 9 Oct, 1.55–1.73 s of it its fixed end of phrase. The
second question, said over the bot's answer, interrupted it in every run: the voice stopped ~0.22 s later than an
ordinary onset is detected, about 0.35 s after the question began (the raised threshold needs the louder part of the
word). French was written down with its accents (*« Attends, attends, je voudrais plutôt savoir qui l'a fabriqué. »*). Every scratch
process stopped after; nothing of the owner's touched.

**Review** (a fresh agent, on the consent and privacy rules and the lint doors). No problem with: Run all, Resume, a
Trigger, MCP, imports and undo never opening the microphone; every way out reaching `mic.close()`; no sound stored, put
on the bus, logged or kept; the doors and the invisible characters. Found and fixed, each with a test that failed
before: (1, major) after ■ End a cough over the last sentence brought the conversation back, deaf to a second End and to
the time limit, and speech after End was sent to be written down — now anything said after End ends it unheard, End
twice is now, and the time limit stops hard 30 s after it asks; (2, major) a double click on ● Start, or the ▶ during a
conversation, merged into the live run and reopened the microphone after End — now a press while the box is busy is not
a Start, and a run right after the box's own end hands on the transcript; (3) a press its run never reached (Stop, a
failed box upstream) could be used by a Trigger within 15 s — the host now forgets a run's unreached seed presses; (4) a
box deleted while the system asked for the microphone went on talking — the stop handle now exists before the
microphone opens; (5) a sentence still being made when End was pressed was said. Notes kept: a turn whose take cannot be
decoded is sent whole (decision 6); the Record log holds the conversation's words (its switch now says so) and MCP's
`read_graph` reads the transcript like any value.

**Not done, the owner's:** HUMAN_TESTS F8 (a real microphone, a quiet and a noisy room, loudspeakers against a headset),
F9 (French with Margot), F10 (the microphone light: every way to end closes it), F11 (a class of laptops on one farm, GPU
and CPU speech to text). Releasing waits with farm-v0.0.46 (Model storage, the panel's sections), as the owner said.

## 2026-10-12 (14:02) — The farm panel: one section per engine, Serve with … inside it, Access for what they share (branch `panel-engines`)

The owner: *"In the farm we should probably have three collapsible with the options for Ollama, Llama.cpp and vllm."*
He saw the layout below as a mockup and asked for no changes. `farm/src/admin/index.html` only: no route, job, confirm
question or farm behaviour changed.

**What moved where.**
- **Serving** (was *Backend*): the hero (the name users see, the engine and model, people at once, connected) and
  the warnings about what serves: llama.cpp fell back, the GPU stuck at a low clock, an external server, vLLM's
  phase line.
- **One `<details>` section per engine**, always in this order: Ollama, llama.cpp, vLLM, and *External server* only
  while configured (as before). The summary line says, closed, the state (serving / standby / starting / stopped /
  not answering / could not start / stopped working / not installed / not set up yet / not for this GPU / cannot run
  on this computer) with a dot (green / amber / red / grey) and one fact: *4 models · gemma4:12b default*, *Qwen3.8
  27B · UD-IQ2_S chosen*, *Qwen3.6 35B-A3B · NVFP4 · 48 at 64k*. vLLM's small-GPU sentence moved from its old
  button to that line, still said before any check.
  - Ollama: *Models · Ollama* whole (its storage rows, the rows, Download a model).
  - llama.cpp: the *Model · llama.cpp* card whole (library, a look's results, Add) — now always there, not only after
    its button; the old engine button's sentence (*One model, fastest …*) heads it.
  - vLLM: the *Model · vLLM* card whole (checklist, Check again, Install/Update, the list, Add, Start/Stop, WSL's disk,
    the log), with the take-over block (*vLLM on this computer*, offer or done + Undo) at its top instead of a card
    above everything.
  - In the **serving** section only: *People and context* (people at once, the context, on vLLM the GPU memory, the
    trade line) and **Performance**. Apply writes these to the engine that serves (`applyFarmSettings`), so a standby
    section has none — the one place the mockup (which showed people and context in a standby Ollama) was not
    followed: showing them there would have meant Apply writing to an engine that does not serve.
  - In every **other** section, at its end: **Serve with <engine>**, the switch. Its line says what it costs (the
    question without its *Switch to …?*) or why it cannot go ahead (*Choose a model above first*, *Not set up on this
    computer yet*, *Not available on this computer*). It runs `engineClick`: the same question (`switchConfirm`, the
    take-over's), the same `/lol/admin/backend` (or `/lol/admin/vllm/take-over`). Serve with vLLM is off until vLLM is
    set up, and absent while the take-over is offered (the offer is the way).
- **Access**, under the sections: the name users see (llama.cpp, vLLM; on Ollama a line pointing at each row's
  Rename), *Free an idle seat after*, the farm password (+ Remove), and the ONE **Apply changes**. Apply still reads the
  same ids (`#name-in`, `#slots-sel`, `#ctx-sel`, `#kv-sel`, `#idle-sel`, `#sec-in`) wherever they sit, so its payload,
  its vLLM dry run and its one restart are unchanged; the serving section says *They apply with Apply changes, at the
  end of Access below*.
- Then Model storage, Plugins, Clients, This box, as before.

**Open and closed.** The serving engine's section is open by default, and opens again when the serving engine changes
(a switch, a fallback); every other section is as the person left it. Choices live in `engOpen`, saved to
`localStorage['lolEngineOpen']` (and the last serving engine to `lolServingSeen`), so the 5 s rebuild and the next
visit keep them. Only a person's click counts: each `<details>` carries `data-open`, and a `toggle` the render itself
caused (Chrome fires one for a parsed `<details open>`) matches it and is ignored. vLLM's section also opens by itself
while it has something to say (a take-over offered or done, a failed start while Ollama serves, an install or download
of its own; not a move of the models). Opening vLLM's section checks this computer once per page — what pressing the
vLLM button did; a section a page action needs (a look in a folder found models for it, Serve with vLLM pressed while
it is not set up) opens and scrolls into view. The 5 s rebuild now gives the keyboard focus back (`focusKeyOf`: an
id, a summary, a button's first `data-` attribute). `lolVllmOpen` / `lolLcOpen` and the Close buttons are gone.

**Fixed while looking at it** (the same Electron screenshots): a long select (vLLM's *Automatic — what the GPU has free,
less the model, 9 GB …*, the context list) squeezed its row's text to a narrow column and pushed the card past the
window (sideways scroll at 900 px): the text keeps 260 px and a select is cut to the card; on a phone a row's controls
go under its text. Performance's and This box's figures ran together (*17 requestsReading*: bare text in a flex row);
each is one item now. The password field was white (only `type=text` was styled). The split-`.gguf` pull error in
`up.js` named *Model · llama.cpp*; it names the llama.cpp section.

**Tested.** `node test/run.js` in `farm/`: **268 passed** (256 + 10 that pinned the old layout, rewritten to keep what
they proved, + 2 new). New: *the serving one opens by itself, and again when the engine changes; the others keep what
the person chose, through the rebuild*; *Access holds the name, the idle seat and the password, the serving section
its people and context, and the ONE Apply sends every field* (llama.cpp: one POST with name, slots, seatIdleSec,
password, context; vLLM: the dry run, then the same six fields). Rewritten: the engine grid → three sections in order,
External only while configured, each summary's words, Serve with … in its own section with `/lol/admin/backend`, the
question asked, and off when blocked; the small GPU on the summary; the llama.cpp section before a switch (opening it
asks and switches nothing; Serve with llama.cpp asks the question naming the model, then switches); vLLM opened by a
person checks once; the vLLM section's contents; Model storage's and a look's text. `loadPanel` exports the toggle
handler (`render.toggle(id, open)`).
**Seen.** The panel in Electron 42 offscreen against a **stub farm** (an in-process server on a random loopback port
serving `index.html` and a made-up `/lol/admin/state`; every POST answered `{ ok: true }`; no real farm or farm port):
Ollama, vLLM and llama.cpp serving, and a 16 GB GPU, each at 1280, 900 and 420 px, full page. No sideways scroll at any
width after the fixes; the summary keeps the focus through a rebuild; a clicked section stays open through a rebuild
and is saved; Enter on a focused summary toggles it; opening vLLM's section asked for one check.
**Not done.** The Farm app's own window on a real farm (HUMAN_TESTS P1). No change to the Farm app, the client or the
farm's routes.

## 2026-10-12 (11:57) — Model storage: one folder for the farm's models, Move here, models used where they are, WSL's disk

The owner: *"I need to be able to move or place the model at a specific place on disk"*; ONE folder for the whole farm;
*"Move WSL disk to D: as well as the models. But we should be able to manage this on the farm interface. We should be
able to point to a folder and say everything goes here, or look in this folder to find models."* Branch `model-storage`
(from `main` at 36a18e0), not merged, not released.

**Built** (`farm/src/storage.js`, new; the panel's **Model storage** card and one part on each engine's card):
- **`storage.dir`** ("Keep everything here", `config.js` StorageSchema, null = today's places). What the farm downloads
  goes into `<dir>/gguf` (llama.cpp, document search, drafts, the build's archives: `ollama.draftDir`), `speech-to-text/`
  (`stt.modelsDir`), `ollama/` (the `OLLAMA_MODELS` of an Ollama the farm starts: `up.js spawnLocalOllama`, `lol
  install`, the Farm app's wizard `installer.ts ollamaModelsEnv`) and on Linux `vllm/` (a new install's root,
  `vllm.resolveRoot`). `config.loadConfig` sets the folders for every command.
- **Move here** (download slot): copy through `<name>.lolmove-part`, fsync, rename; check sizes, and the sha256 the farm
  knows while copying (Ollama's blobs are named by theirs; document search's model is pinned); a file whose checksum
  already differs is left where it is and named. Then in `serialize`: stop what holds the files (llama.cpp only when it
  loads from them, document search, speech to text, the farm's Ollama, vLLM on Linux), copy what changed, check
  everything, save `storage.dir`, link vLLM's `hf` (Linux, `storage.linkHf`), start again; then delete each old copy
  whose user reads the new folder, file by file, never the same file under two names. Free space first (10 GB kept),
  refusals (inside the farm's files, a store inside another, a network share), hard disk / USB said (Windows
  `Get-PhysicalDisk`, Linux `/sys/dev/block`). A cut leaves `.lol-storage-move.json`: Move here goes on; Finish; Forget.
- **Ollama run by another program** (this box: the Ollama desktop app). Its source (app/store/store.go, app/server,
  app/ui/ui.go) says: **Settings ▸ Model location** is kept in the app's own database and **wins over the user's
  `OLLAMA_MODELS`**, which is read only when that setting is empty, and it is filled with the default by any save of the
  settings page; changing it restarts the app's Ollama by itself. So the farm does not set it: it copies the models,
  says what to set in the app, and **Finish** deletes the old copy only once Ollama is seen reading the new folder (a
  copy of one of its manifests under `lol-where-check:<random>` for a moment: Ollama 0.40.3 reads its manifests at
  every `/api/tags`, measured on a scratch Ollama). Where it reads now: its own `server.log` ("server config" line,
  read on this box: `OLLAMA_MODELS:C:\\Users\\ateliernum\\.ollama\\models`), else `OLLAMA_MODELS`, else the default.
- **Use the models in this folder**: a scan (`.gguf`, split parts grouped, a projector kept with its model; Hugging Face
  folders; an Ollama model folder); llama.cpp library entries by `path` (`url` or `path`, `llamacpp.model` takes either),
  vLLM entries by `path` (status.sh `pathmodel=`, `LOL_VLLM_PATHS_B64`; a Windows drive is `/mnt/<x>`, said to load
  slower), `storage.ollama` for an Ollama folder. Nothing copied; Remove never deletes such a file.
- **WSL's Linux disk** (the vLLM card, Windows): `wsl --manage <distro> --move <folder>` (WSL 2.6.3 has it; WSL's source
  LxssUserSession.cpp: MoveFileEx with COPY_ALLOWED, the old file deleted only after the copy, the registry then points
  at the new folder). vLLM stops first and starts again; progress = the new file growing; not cancellable.

**Measured on this box (scratch data only).**
- WSL keeps a terminated distribution's disk attached while another one runs: `--move` answered
  `ERROR_SHARING_VIOLATION` for a scratch Alpine distribution for 4+ minutes after `wsl --terminate`, and even right
  after a fresh `--import` (Ubuntu was running); WSL's own advice is `wsl --shutdown`, which stops every distribution.
  So the farm waits 90 s (WSL's machine stops a minute after its last Linux) and then says so; the next Move asks to
  stop all of WSL, naming what runs. A running distribution is refused (`WSL_E_DISTRO_NOT_STOPPED`).
- Copies: F:→C: 3.2 GB/s and C:→F: 3.6 GB/s for 4 GB (write cache), C:→D: (the HDD) 56 MB/s. Ubuntu's 421 GB F:-ward:
  expect about 7–10 min; to D: 1–2 h.
- Drives: D: `HDD|SATA`, E: `SSD|USB`, F: and C: `SSD|NVMe` (the panel's warnings follow).

**Tested.** `LOL_VLLM_FAKE=1 vllm-lifecycle.js` 161/0. Farm `test/run.js` 221 → 235 (new: the paths with and without a folder, the copy with a cut and a part
file, checksums and a damaged file, the same file twice, someone else's file, the refusals, disk kinds with stubs, the
scan, Ollama's manifests/log/canary, path entries for llama.cpp and vLLM, the vLLM `hf` link, the WSL answers and the
move with and without stopping all of WSL, the panel's card and each card's part, the Farm app's Ollama env).
`test_scripts.sh status` under WSL: 17/0 (pathmodel=, hf as a link). Farm app `npm test` 8 + 3. A real farm from this
worktree on scratch ports (4310/4311/41887, its own Ollama on 11544 with a scratch store, llama.cpp from the main
checkout's build on 8381), scratch folders on C:/D:/E:/F:: a move with a damaged pinned file (left, named, the rest
moved); the farm's Ollama moved and restarted (its log: `OLLAMA_MODELS:F:\\…\\LLM\\ollama`), old folders gone; the farm
process killed in the middle of a 3 GB file (2.8 GB part file) → restart → Move here went on, the sha256 of the copy
equal to the original's, then the old copies deleted; an Ollama "run by another program": Finish refused before the
step and deleted nothing, after the step it freed the old copy; the panel in a headless Chrome (CDP): the question,
the bar with bytes and speed, Finish, Forget, Look, Add the ticked ones, Use this folder; llama.cpp served a 105 MB
SmolLM2 GGUF from its own folder (a path with a space) and answered a chat; the farm's WSL move on the scratch
distribution: terminate, `--move` kept by WSL, 90 s, a plain message, Ubuntu still running. Scratch data, the scratch
Ollama and the two scratch distributions removed after.

**Not done.** (The independent reviews of the data-loss paths reported; their fixes are below.) The real moves are the
owner's: HUMAN_TESTS session O (everything to `F:\LlmOnLan`, Ubuntu's disk to `F:\LlmOnLan\wsl\Ubuntu`, the Ollama app
pointed there by the farm); the full WSL move was never run here (it needs all of WSL stopped while Ubuntu serves), nor
the Ollama app's quit / write / reopen (never against the owner's app). Linux (a DGX Spark): the `hf` link move only
unit-tested. Note: the Farm app's `supervisor.test.js` polls `127.0.0.1:41997/lol/self` for readiness (read-only),
which on this box is the live farm; and `vllm-lifecycle.js` starts `lol up` from the worktree, which downloads
document search's model into `farm/.models` (557 MB) — then `test/run.js`'s *classify + stt start AFTER the farm is
public* fails (it expects that model absent): delete it after a lifecycle run. *(Correction, 2026-11-05: `supervisor.test.js`
stubs `util`, so it never reaches 41997; and since 600d65f, the same day at 13:25, that `test/run.js` test uses an empty
temp `llamacpp.binDir`, so nothing needs deleting after a lifecycle run.)* HUMAN_TESTS "Questions" 9: answered
(below). A folder set by this branch's first build (d8ddb62) has no marker and is said missing: put an empty
`.lol-storage` in it, or Move here again.

**Review fixes (2026-10-12, 13:22).** Two independent reviews of d8ddb62's data-loss paths. The move's orchestration
had no test: it is now `up.js` `makeStorage(ctx)` (the same code, out of `run`; commit 4e2ede8 changes no behaviour),
driven by a harness in `test/run.js` (scratch folders; a fake Ollama that reads one folder and prunes, at its start,
the blobs no manifest names, as Ollama does; stubbed llama.cpp, vLLM, services and Ollama app; the real jobs, journal
and config file; the farm's default folders and the shared Hugging Face cache pointed into the scratch folder). Each
finding has a test that failed on the code of d8ddb62 (run on 4e2ede8 + the new tests: 26 of 26 failed) and passes now.
- **1** (Ollama run by the app could end broken in both folders: the switch skipped its re-copy and check, Finish
  deleted by size): the switch now copies and checks an app's Ollama too; Finish, for any Ollama store, copies what is
  missing (a blob the app's start pruned, a model pulled since), checks every blob by its sha256 and deletes nothing on
  a problem; an old manifest goes only when its copy has the same bytes and every blob it names is there and checked,
  and a kept manifest keeps its blobs (`storage.ollamaKeep`); the question says not to touch the app's location before
  the move is done. Tests *review 1* (the app pointed there mid-copy; a damaged blob keeps its manifest) and *review 1, M2*.
- **2, m10** (a same-name same-size file in the new folder was trusted, the original deleted): a file this move did
  not write (the journal's `written`, not a date) counts only when its bytes are the original's (its sum, or the
  sha256 of both); else the move stops, never writing over it. Test *review 2, m10*.
- **3, M1** (Move here to the folder in use never copied; `norm('')` is the working folder): the journal says
  `switched` (written right after the config); paths are compared only when both are set; the copy is skipped only on a
  journal marked switched; `linkHf` refuses a `to` that is not there, and vLLM's link is made only to a checked copy and
  never under a running vLLM (stopped first). Tests *review 3, M1* and *review 3, 8*.
- **4** (entries by path into a moving folder kept the old path): llama.cpp's model and projector and the llama.cpp and
  (Linux) vLLM entries by path follow, in the same flushed write as the folder; Look never offers the farm's own files
  and Use refuses them. Test *review 4*.
- **5, C2** (the farm's Ollama restarted on an empty folder when its models did not move, also at the next start): it
  restarts there only when its models moved (or it had none); otherwise `storage.ollama` keeps the folder it reads, in
  the same write (also when no Ollama answered at the start). Test *review 5, C2*.
- **6, M3** (Finish deleted the app's folder when the farm's own Ollama answered): Finish needs the same program as the
  move was for, and the app's log naming the new folder; `by` is never read again. Test *review 6, M3*.
- **7** (links deleted through two names): `deleteMoved` deletes nothing when the folders are one or nest through any
  link; links are compared by their own identity; Finish checks the two folders again. Test *review 7*.
- **8** (Finish never made vLLM's link): it does, after checking the copy, stopping vLLM and starting it again; a cut
  between the rename and the link leaves nothing missing (`hf` comes back when the new folder is not there). Test
  *review 8, M1*.
- **9** (a leftover `hf.lolmove-old` taken for the old copy): only a folder this move set aside is; a leftover is
  named, never deleted. Test *review 9, C1*.
- **C1** (an Ollama folder's or a shared HF cache's other files copied and deleted): only `blobs/` and `manifests/`
  (`manifests-v2/` when there; Ollama 0.34's store on this box has only the first two, read-only listing), vLLM's list
  folders, Laya's one repo; the rest is named in the question and left. Tests *review C1*, *review 9, C1*.
- **M4** (a missing folder — a USB drive unplugged — refilled from scratch): `<dir>/.lol-storage` written at the
  switch; without it the farm says *The model folder … is missing (is its drive plugged in?)* in its log and on the card,
  and downloads nothing into it (`downloadGguf`), starts no service nor Ollama on it, and `lol install` stops; the Farm
  app's wizard does not start Ollama on it. Tests *review M4* and the Farm app's.
- **M5** (a folder lent by Use this folder was moved and pruned): never moved except by its own button; Ollama started
  on it never prunes (`OLLAMA_NOPRUNE=1`). Test *review M5*.
- Lesser, fixed: Stop while the switch waits its turn (and before the deletes); Stop during the switch says it cannot
  stop halfway (m14); a file in use keeps its store for Finish, said as in use; the config and the journal are flushed
  to the disk before anything is deleted; Ollama's `-partial` blobs are never copied; a recorded Ollama process number
  is checked to be an Ollama before it is killed; Use and Add refused while the models move; Ollama not answering
  refuses the move instead of guessing its folder; network folders refused (UNC, a mapped drive's type 4, Linux nfs /
  cifs / sshfs) and Windows names ending in a dot or a space (m6); document search never deletes a file of someone
  else's under its model's name; the Linux step says read AND write; a farm stopping during a move no longer stops
  vLLM's install; the Farm app's wizard run again keeps the config's keys, `storage` above all (m2); Finish copies
  what was pulled into the app's old folder since, and "not copied" is said as such (m3); the sums read while copying
  are kept in the journal, so the switch reads nothing again (m7/m8); a vLLM move waits for an install or a download
  into its folder (m11); WSL (m12): the move carries the Linux the question named, `wsl -l --running -q` (any language)
  is read again before `wsl --shutdown` and a Linux started since stops the move, `--manage --move` is checked before
  `--terminate`, a disk whose size cannot be read is refused, and vLLM's log, a look in WSL's Linux and deleting a vLLM
  model's files wait for the move; free space and the folders' checks are read off the event loop (m14). One test each
  (*review …*, *review m11*, *review m12*).
- Noted, not changed: a downgrade to farm-v0.0.45 refuses a config with `storage` (strict): remove the key first
  (README, release notes) (m13); on Linux the measure reads `<root>/hf`'s real path synchronously once a minute (a
  sleeping USB disk could hold it a few seconds there); `checkDir` itself cannot tell a mapped network drive (the moves,
  Look and Use ask Windows separately); the `manifests-v2/` layout of Ollama 0.40 is read but was never seen here.

**The owner's decisions (2026-10-12), built.**
- **The farm sets the Ollama app's Model location itself** (`src/ollamaApp.js`). Its source (github.com/ollama/ollama
  at main c1c536297f and v0.40.3): the setting is the `models` column of the one `settings` row of the app's SQLite
  file (`%LOCALAPPDATA%\Ollama\db.sqlite`, macOS `~/Library/Application Support/Ollama/db.sqlite`, WAL, schema 19
  from v0.34 to v0.40; in the open source since v0.12.10, every schema change since only adding columns), read at each start of its server; its settings API needs a per-launch
  token held in memory only, so not usable. After the copy is checked and the switch made: the old value goes into the
  journal, the app is quit as its tray does it (`taskkill /PID` without /F, a close; by force after 20 s; macOS
  SIGTERM), the column written through Node's own `node:sqlite` (never a copy of the file), the app opened again hidden
  (`ollama app.exe hidden`, `open -j -a Ollama.app`); then the farm checks Ollama reads the new folder, and puts the old
  value back on any failure. Linux (a service), an app not running, a file without that column: the panel says what to
  set, as before, and that it must wait for the move. Never run against the real app here (HUMAN_TESTS O1).
- **Stopping all of WSL** after the second, named question: kept as it was.
- **Classify's and the voice's models** move into `classify/` (Laya's repo, the classify service's `HF_HUB_CACHE`) and
  `kokoro/` (the voice's `.pth` and `config.json`, its `MODEL_DIR`; downloads are written beside and renamed), their
  services stopped and started from there.
- **The folder is the source of truth**: a `.gguf` dropped into `gguf/` joins the llama.cpp list and one deleted leaves
  it; vLLM's `hf/` folders are its list the same way (after each check); Ollama reads `ollama/`; the vLLM card offers
  `<dir>\wsl\<distro>` for WSL's disk. Look, with a folder chosen, offers **Move the ticked ones into the farm's folder**
  (`.gguf`, copied, checked, the list following, then deleted where they were) and the Ollama card **Move into the
  farm's folder** for a lent folder. Not built: moving a vLLM model folder found elsewhere in (a Windows folder into
  WSL's disk); it is added where it is. Defaults unchanged for a farm without a folder.

**Tested.** Farm `test/run.js` 235 → 266 (the harness's 26 review tests, 5 for the owner's decisions, the WSL
answers, the panel's card). `LOL_VLLM_FAKE=1 vllm-lifecycle.js` 161/0. Farm app `npm test` 9 + 3. The vLLM scripts
did not change (no WSL run). Scratch folders only, removed after; no real Ollama, app, WSL distribution or port touched
(the lifecycle test's scratch ports as before).

## 2026-10-10 (19:08) — Release client v0.2.11 and Farm app farm-v0.0.45: the voice mode, Gemma 4 and Qwen3-Omni on vLLM

The owner asked to go back to `main` and release so the work can be tested. Done:
- **Merged.** `main` was fast-forwarded to `multiuser-phase0` at `be3be98` (the `voice-mode` and `vllm-models` merges,
  and speech to text's own share of vLLM's memory). Gates on that tree: farm `test/run.js` 221/0; shell build,
  chat-unit 1863/0, unit 29, lint 0; `vllm-models` alone: `LOL_VLLM_FAKE=1 vllm-lifecycle.js` 161/0.
- **Client v0.2.11** (tag `v0.2.11`, commit `924c53b`, CI run 38067827014, 38 min): success, 27 assets, the same set as
  v0.2.10; `latest.yml` says 0.2.11. It brings Open WebUI's microphone and Call mode through the farm's speech to text
  when the farm advertises it (`AUDIO_STT_ENGINE=openai`), and `AUDIO_TTS_SPLIT_ON=punctuation` stated.
- **Farm app farm-v0.0.45** (tag `farm-v0.0.45`, commit `f882348`, CI run 38067830389): a prerelease, 10 assets. It
  brings speech to text on the GPU (off by default), Gemma 4 12B and Qwen3-Omni 30B-A3B in vLLM's list (a saved list
  completes itself), `vllm[audio]` at install, the llama.cpp list before a switch, and speech to text named in vLLM's
  memory sizing.
- **`build-llamacpp-arm64`** (CI run 38067823991) ran again because `llamacpp.js` changed (`llamacpp.onDisk`): the same
  b11512, success.
- **Release notes:** both pages got a "What's new" above CI's own text.
- **Looked at, not taken: AirLLM** (github.com/lyogavin/airllm, the owner's question). It streams a model's layers
  from disk one at a time, so each token reads the whole model from disk: seconds to minutes per token (19.6 s per
  token for an 8B on a 16 GB Mac mini; 5–35 s for a 70B on NVMe), one person at a time, no OpenAI server. The farm's
  engines already hold their models in memory; for a laptop farm, llama.cpp / Ollama / MLX with a model sized to the
  machine (and llama.cpp's `--n-cpu-moe` for a mixture-of-experts model bigger than the card) is the path. Not
  measured here: an M1 16 GB and an 8 GB RTX laptop would be the first measurements of a laptop farm.
- **Not done, the owner's:** the tests of HUMAN_TESTS.md on these builds (the voice ones: A18, A19, J9, K7; the vLLM
  models: J10, J11; the llama.cpp list: K8), and the open questions (speech to text on by default on NVIDIA; Omni as
  the transcriber; Omni's seats; vLLM on a 16 GB card for Gemma 4).

## 2026-10-10 (14:59) — Merged `vllm-models` beside the voice work; speech to text gets its own share of vLLM's memory

- **The `vllm-models` agent stopped at its last step** (the account's weekly limit), with its work written but not
  committed. Checked before committing: farm `test/run.js` 220/0 once the agent's leftover downloads in its worktree
  were removed (`farm/.models`, `farm/.llamacpp`, 1.8 GB: with EmbeddingGemma 2 on disk, the test that document
  search starts late while its first download is ahead cannot hold); `LOL_VLLM_FAKE=1 vllm-lifecycle.js` 161/0; shell
  chat-unit 1862/0. No scratch vLLM left running in WSL; `~/lol-vllm-scratch` gone. Committed as `c504540`.
- **Merged into `multiuser-phase0`** after `voice-mode`: the code merged by itself; DEVLOG kept both entries;
  HUMAN_TESTS had both branches' new J9/K7 — the voice ones keep J9 and K7, this branch's become **J10, J11, K8**
  (107 tests).
- **The voice work's ponytail, done:** vLLM's memory took speech to text's 2 GB through document search's parameter,
  so a short-memory sentence named document search only and `gpuFit` (the "too small for vLLM" check) did not count
  it. `poolGib`/`planFor` now take `sttReserveGib` beside `embedReserveGib`, the sentence names *speech to text (2 GB)*,
  and `gpuFit` adds `stt.reserveGib(config)` (GPU only). Tests: the PRO 6000 at 48 GB with both, the sentence, the fit
  with and without it, on the CPU nothing. Gates: farm 221/0; shell build, chat-unit 1863/0, unit 29, lint 0.

## 2026-10-09 (19:01) — The llama.cpp list before a switch; Gemma 4 12B and Qwen3-Omni on vLLM, measured (branch `vllm-models`)

The owner's four asks of the afternoon, in order. Built in the worktree `vllm-models` from `main` at `ad5e53c`; not
merged, not released.

**1. The llama.cpp list before switching.** On Ollama (or vLLM) the panel showed *Model · llama.cpp* only once
llama.cpp served, so nobody could see or prepare what a switch would serve. Now the **llama.cpp** button opens that
card, brought into view (as the vLLM button opens its own), instead of switching: the list marks the model the switch
will serve **chosen** and those on this computer **downloaded** (`llamacpp.onDisk`, every part of a split file);
**Use this** makes another one the chosen model and downloads it now as the panel's job (`setLlamacppModel`'s new
branch: `ensureModel` on the would-be config, then the model persisted; a failed download changes nothing); a chosen
model not downloaded yet gets **Download**; **Add** works as before; the card says Ollama keeps serving until
**Switch to llama.cpp** at its bottom, whose question names the model it loads (and that it downloads it first).
**Close** hides it. While llama.cpp serves, the card is as it was.

**2–3. Two models in the vLLM list** (`config.js` `VLLM_LIBRARY`), chosen against the owner's rule (first-party or
his named publishers, the pinned vLLM 0.30.0):
- **Gemma 4 12B** — `unsloth/gemma-4-12b-it-NVFP4` (Apache 2.0, 9.3 GB): NVIDIA publishes NVFP4 only for the 26B-A4B
  and 31B; Google's own 12B quant is a QAT W4A16 (slower to batch on Blackwell); RedHat's NVFP4 is "preliminary".
  vLLM's Gemma 4 recipe flags (`--reasoning-parser gemma4 --tool-call-parser gemma4 --enable-auto-tool-choice`, fp8
  KV, `--limit-mm-per-prompt {"image":4,"audio":1,"video":0}`); no `--chat-template` (the checkpoint's own template
  carries the tool protocol, newer than the recipe's copy). `vllm.js facts()` now counts its sliding-window layers'
  168 MB a person (`kv_constant_bytes_per_request`), measured: 64 people at ~30.5k filled 51.8 % of a 52 GiB pool.
- **Qwen3-Omni 30B-A3B** — `Qwen/Qwen3-Omni-30B-A3B-Instruct` (Apache 2.0): no first-party FP8/NVFP4/AWQ exists, so
  vLLM quantizes the BF16 weights to FP8 as it loads them (`--quantization fp8`, 30.9 GiB; the load never held the
  BF16 size). vLLM serves the thinker (text out). Hermes tools; Qwen's sampling merged with the reply cap into ONE
  `--override-generation-config` (`argvFor`; vLLM keeps a repeated flag's last). Two fixes it needed, both general:
  `install.sh` writes a processor-only `chat_template.json` as `chat_template.jinja` (vLLM reads the tokenizer's
  template for requests with tools: every tool call was a 400), and LiteLLM's route to a vLLM model with no thinking
  parser drops `chat_template_kwargs` (`additional_drop_params`; the client's `enable_thinking: false` made its
  template append an empty think block and the model answered `<|im_start|>user`: 23/28 → **28/28**).
- Around them: both carry `audio: true` (a schema field; the snapshot's `backend.audio`, in the contract);
  `install.sh` installs `vllm[audio]` (vLLM's sound extras); `status.sh` says `audio=<root>`; the check warns *…
  cannot read sound yet: press Update vLLM* when the chosen model hears and its install lacks them. `FAMILY_ARGS`
  knows Gemma 4 and Qwen3-Omni; `isGeneric` is "no thinking and no tool parser". **The list completes itself:** a
  `library` an Add, a Remove or a take-over saved before (production's, after its take-over) gets the new built-ins
  at the next start, except the ids in the new `vllm.removed`, which a Remove of a built-in writes and an Add of it by
  name clears (it comes back as the built-in entry). With Gemma the smallest model, `gpuFit` now says *about 25 GB*
  with document reading (a 4070/4080/4090 still refused beside it; a 16 or 24 GB card fits Gemma with it off; a 32 GB
  one fits).

**4. Measured on the PRO 6000** (docs/spike/RESULTS.md, last section; `docs/spike/results/*gemma4*`, `*qwen3omni*`,
`results/probes/`, `runs/probe.js`). The owner's farm was not running and Ollama held 17.7–22.9 GB, so: a SCRATCH
vLLM (`install.sh` with `LOL_VLLM_ROOT=~/lol-vllm-scratch`, port 8177, never `~/lol-vllm` or 8100), the farm's own
argv (`argvFor`, read back in each log), a watchdog that would have stopped it if the owner's farm went on vLLM or
busy or the GPU fell under 6 GB free (it never fired), pools of 52 GiB (Gemma) and 30 GiB (Omni). The reduced suite:
chat 1–128, follow-ups at 30k/62k with `--append`, the 28-item gate, and the functional checks.

| | Gemma 4 12B | Qwen3-Omni 30B-A3B |
|---|---|---|
| Weights loaded | 9.25 GiB | 30.91 GiB (FP8 at load) |
| One user (4k message) | 91 tok/s, TTFT 0.20 s | 170 tok/s, TTFT 0.10 s |
| People, chat 4k (every turn / steady) | 32 / 64 | 64 / 128 |
| People at 32k (every / steady) | 16 / ≥ 64 | 20 / 20 (the 30 GiB pool's limit) |
| People at 64k | 8 / ≥ 48 | 10 / 10 (the pool's limit) |
| Quality gate | 26/28 thinking off, 22/28 on (misses: out of the 16k budget) | 28/28 (it does not think) |
| Picture, tool call | right, right | right, right (after the two fixes) |
| Sound in a message (FR, EN) | word for word, understood | word for word, understood |
| `/v1/audio/transcriptions` | 404 (not a transcription model) | **works**: 0.12–0.18 s for 7–8 s, FR and EN |

Gemma's every-turn misses are all the first follow-up after the documents loaded (round 1 TTFT 3–14 s; round 2 under
1 s everywhere), the hybrid-cache shape of RESULTS finding 10. Omni's limit is its memory (49 KB a token, 4.8×
Qwen3.6's): ~30 / ~14 people on a PRO 6000 of its own. Both measured configs are in `measured.json`
(`pro6000/vllm/gemma4`, `/omni`; `build_measured.py` now finds this checkout itself), so Automatic seats use them,
and the capacity page shows them as measured (`estimator.js` `MEASURED_ONLY`: measured cells only, not fitted into
the calibration). `catalog.json` gained Gemma's vLLM checkpoint and a Qwen3-Omni entry.

**For the voice work** (not touched here: `stt.js`, the snapshot's stt fields): with Qwen3-Omni serving, vLLM's
`/v1/audio/transcriptions` writes down French and English accurately in a fraction of a second, but it is vLLM's
route: the seat gate forwards only the routes clients use, and LiteLLM has no transcription route for it. Routing the
farm's speech-to-text to it is that work's call; `backend.audio` says the served model hears sound in a chat message.

**Tests:** farm `test/run.js` **220/0** (+4 tests: the llama.cpp card before a switch with its farm side,
`llamacpp.onDisk`, the two models (flags, families, one generation override, the self-completing list, the route that
drops the thinking switch), the sound check with Update vLLM; each fails when its change is reverted);
`LOL_VLLM_FAKE=1 node test/vllm-lifecycle.js` **161/0**; `farm/vllm/test_scripts.sh` under WSL **116/0** (+4 checks: `audio=`, the template
written, never over one there, not when the tokenizer has one); shell `chat-unit.js farm-contract` **4/0** (the schema's new `backend.audio`). Docs:
CLAUDE.md, farm/README.md, VLLM_MANAGED_PLAN.md (the default library 4–5, the self-completing list), HUMAN_TESTS.md
(J10, J11, K8; renumbered at the merge beside the voice branch; K5's numbers on this build), RESULTS.md.

**Cleaned up:** the scratch vLLM stopped, `~/lol-vllm-scratch` (vLLM and both downloads, ~90 GB) removed; nothing of
the owner's touched (no `~/lol-vllm` exists on this box; the Farm app was not running).

**The owner's calls:** whether a 16 GB card with document reading off should be offered vLLM for Gemma 4 12B (2–3
people), or `gpuFit` should keep refusing it; whether Omni's Automatic seats should come from its memory alone (the
measured 20 / 10 are this run's pool's limit, lower than a PRO 6000 of its own holds); whether the voice mode routes
speech-to-text to Omni's `/v1/audio/transcriptions`. **Human tests:** J10, J11, K8 (HUMAN_TESTS.md).

---

## 2026-10-09 (17:13) — Speech to text on the farm's GPU, and the voice mode is Open WebUI's Call, pointed at the farm

The owner asked (branch `voice-mode`): **A.** the farm's speech to text on its NVIDIA GPU with a better model, the CPU
kept for farms without one, its GPU memory counted like document search's; **B.** a live voice mode — a person talks,
the end of each phrase is found, it is transcribed and answered, and the answer is spoken by the farm's Kokoro phrase
by phrase — checking first what Open WebUI 0.11.4 already does.

**What Open WebUI 0.11.4 already does (read in the bundled sidecar, `open_webui/routers/audio.py`, `config.py`, and the
built frontend's source maps: `CallOverlay.svelte`, `Chat.svelte`, `utils/index.ts`).** Its **Call** mode (the headphones
button) is the whole voice mode: the browser listens (an AnalyserNode; any sound above −55 dB is speech), ends the
phrase after **2 s** without sound (hard-coded, no setting or env), posts the recording to `/api/v1/audio/transcriptions`,
sends the words as the message, and while the reply streams it cuts it at `. ! ?` and line breaks
(`AUDIO_TTS_SPLIT_ON=punctuation`, the default; a piece under 4 words or 50 characters joins the next) and asks
`/api/v1/audio/speech` for each piece at once, playing them in order. Speaking over the answer interrupts it only with
the person's own setting *Allow voice interruption in call* (off by default: the mic is deaf while it speaks). Its STT
engine `openai` posts `{AUDIO_STT_OPENAI_API_BASE_URL}/audio/transcriptions` (multipart `file`, `model`, `language`
only if the person set one; a failure is retried once without `language`) and reads `text`. So nothing had to be built
in LOL for B: it is configuration. Three facts found on the way: OWUI streams the file **chunked** (aiohttp with an
async generator, checked by capturing the request), which our service refused with 411; OWUI trims no slash from the
base URL; and OWUI keeps every recording and its transcript in `DATA_DIR/cache/audio/transcriptions` (never deleted:
the same with its local engine — on the laptop, inside the data folder).

**Built.**
- **Farm (`src/stt.js`, `pysvc/stt_server.py`, config `stt.device`/`stt.model` = `'auto'`).** `'auto'` = the GPU with
  Whisper **large-v3-turbo** (int8_float16) when an NVIDIA GPU is there on Windows or Linux x64, else the CPU with
  `small` (int8). The CUDA libraries are pip wheels in the service's venv: on Windows **cuBLAS alone** (CTranslate2
  4.8.2's wheel carries cuDNN's loader; measured: the GPU ran without the 1.1 GB cuDNN wheel), on Linux cuBLAS + cuDNN
  (faster-whisper's README; not run here). The farm passes their folders (Windows: DLL search, Linux:
  `LD_LIBRARY_PATH`). The service warms the model on 1 s of silence and, when the GPU does not load, loads `small` on
  the CPU and says why in `/health` (checked for real: cuBLAS hidden → `{"device":"cpu","fallback":"RuntimeError:
  Library cublas64_12.dll is not found…"}`). The model downloads into `farm/.stt/models` (so `rm -rf farm/.stt` is a
  full uninstall) and loads offline when it is there. Pinned **PyAV 18.1.0**: PyAV 19 (out now) drops an argument
  faster-whisper 1.2.1 passes, so a fresh unpinned install refused every recording. The upload may be chunked: read
  into memory up to the cap (413 past it, never further), parsed there. A GPU start whose files are on disk comes up
  before the engine sizes its memory (registry `early`, like document search); Ollama's context cache key gains `|stt`.
  vLLM's Automatic memory keeps **2 GB** for it while it is on, on the GPU, and not running yet (`up.js`
  `pluginReserveGib` = document search's + this; the snapshot advertises `stt {url, key, model}`).
- **Client (`configBridge.ts`, plumbed like `embed` through `farmSelect`/`index`/`sidecar`/`store`).** A farm advertising
  `stt` with a key → `AUDIO_STT_ENGINE=openai`, `AUDIO_STT_OPENAI_API_BASE_URL=<stt.url>/v1`, its key (fetched through
  the farm password on a keyed farm, kept while a fetch is pending), `AUDIO_STT_MODEL=<stt.model>` (`whisper-1` from a
  farm that names none). No farm STT → OWUI's local whisper `base`, as before. `AUDIO_TTS_SPLIT_ON=punctuation`
  restated. The farm decides the URL and model, so Qwen3-Omni (another branch) is a farm-side change.

**Measured on the RTX PRO 6000 (2026-10-09; French: LibriVox *J'accuse*, English: *Gettysburg Address*; 16 kHz WAV
clips of exactly 5 s and 30 s; faster-whisper's own `transcribe` with `vad_filter`, median of 3 after a warm run; GPU
memory = nvidia-smi's used total minus before, peak polled every 100 ms; the GPU otherwise idle):**

| | FR 5 s | FR 30 s | EN 5 s | EN 30 s | GPU memory | errors in FR 30 s |
|---|---|---|---|---|---|---|
| GPU large-v3-turbo int8_float16 (**the default**) | 0.17 s | 0.48 s | 0.14 s | 0.42 s | 1.7 GB | 1 (*tâches*) |
| GPU large-v3-turbo float16 | 0.15 s | 0.43 s | 0.13 s | 0.53 s | 2.7 GB | 1 |
| GPU large-v3 float16 | 0.38 s | 1.62 s | 0.29 s | 1.07 s | 4.6 GB | 0 |
| GPU small float16 | 0.18 s | 1.13 s | 0.16 s | 0.62 s | 1.2 GB | ~4 |
| CPU small int8, 4 threads (**today's**) | 1.90 s | 5.54 s | 1.77 s | 3.62 s | — | ~4 |
| CPU base int8, 4 threads (the laptop's OWUI) | 0.67 s | 1.67 s | 0.62 s | 1.23 s | — | ~8 |
| CPU large-v3-turbo int8, 4 threads | 7.1 s | 8.3 s | 6.9 s | 11.1 s | — | 1 |

Turbo writes long French without capitals or punctuation (the 30 s clip, both number formats); the 5 s clips, a
voice-mode phrase's length, keep them. With another engine holding the GPU at 100 % (a vLLM benchmark ran beside),
the installed service took 1.3 s for the 5 s clip through HTTP. The farm's own install path (`ensureStt`, Windows):
39 s with pip's cache, a 1.2 GB venv; the first start downloaded large-v3-turbo in 10 min on this afternoon's slow
link.

**The voice mode, end to end (method).** The built, unmodified sidecar on scratch ports and a scratch DATA_DIR/HF_HOME,
with the env the branch's compiled `buildSidecarEnv` gives it; the branch's STT service (GPU); the dev checkout's
Kokoro (GPU, voice `ff_siwis`); a scratch llama-server with Qwen2.5-1.5B-Instruct (the production model was not
used). A headless Chrome whose microphone is a WAV (`--use-file-for-fake-audio-capture`: 1.5 s silence, a question
said by Kokoro, silence) opens `/?call=true` — OWUI's own Call overlay — and the page's `getUserMedia`,
`MediaRecorder`, `fetch` and `play` are timed. **End of speech → first audio: 2.1–2.5 s** (6 runs, 3 French and
3 English, GPU idle; median 2.37 s), of which OWUI's end-of-phrase takes 1.55–1.73 s, the transcription round trip
through OWUI 0.27–0.33 s, the first sentence's text 0.11–0.32 s after the chat request (a 1.5B model; a 35B model adds
its time to first token), Kokoro's first piece 0.17–0.22 s (5 ms when OWUI had it in its cache). 3.1–3.5 s (3 runs) with the GPU at 100 % under another engine.
French was transcribed with its accents (*« Bonjour, peux-tu me donner trois idées de desserts faciles pour ce soir ? »*)
and the answers were spoken in 2–9 pieces. Two rig artefacts, not LOL's: OWUI 0.11.4's first title generation fails
with `KeyError: 'model'` (harmless), and llama-server's RAM prompt cache stalled a language switch by 14–23 s
(`--cache-ram 0` removed it).

**Tests.** Farm `node test/run.js` 217 passed (a new test: the GPU/CPU choice, the CUDA wheels per platform, the
libraries' folders, the model on disk, the reserve in every vLLM plan — 52 → 48 GB on the PRO 6000 with document
search and speech to text —, the advertised model after a fallback), and `check_services.py` (a chunked upload is
transcribed, a chunked one over the cap is 413, the GPU load, the CPU fallback with its reason, the CPU never trying
the GPU). Shell: build, `chat-unit` 1863 passed (a new test: the env from the snapshot, the slash, the local fallback,
the key pending, the saved context, every start path), `test:unit` 29, lint 0. Each new test fails on the old code.

**Left (vllm.js belongs to the vLLM branch now):** vLLM's Automatic memory counts speech to text through the parameter
named for document search, so its sentence when memory is short says "document search" for both, and `gpuFit` (the
"too small for vLLM" line) does not count speech to text: name it there when the vLLM card next changes. The
Computer's Sound box sends no `model` (vLLM's transcription endpoint takes its served model when none is named).
**The owner's:** A18–A19 (voice mode with a laptop's mic, a noisy room, French), J9 (the PRO 6000 beside vLLM), K7 (a
small card, no NVIDIA) in HUMAN_TESTS.md; whether speech to text should be on by default with a GPU like document
search (it stays off); whether OWUI's 2 s end-of-phrase is good enough in the studio (it cannot be tuned without a
voice mode of LOL's own).


## 2026-10-09 (14:36) — Release client v0.2.10 and Farm app farm-v0.0.44: document search on the farm, the home on the Computer

The owner asked at 12:00 for a release to start the human tests on (docs/HUMAN_TESTS.md). Done:
- **Merged.** `main` was fast-forwarded to `multiuser-phase0` at `edd1352` (the merges of `llamacpp-next`, `embed-farm`,
  `human-tests` and `home-tutorials`, and the fence fix `932166d`). Gates on that tree: farm `test/run.js` 216/0;
  shell build, chat-unit 1862/0, unit 29, lint 0; Farm app `npm test` 8 + 3 (copyTree under Electron). The
  `home-tutorials` branch's own chat harness ran 410/410 (with a live demo Home Assistant).
- **Client v0.2.10** (tag `v0.2.10`, commit `b42d919`, CI run 37927461198, 34 min): success, 27 assets, the same set as
  v0.2.9; `latest.yml` says 0.2.10, so installed clients update themselves. It brings document search on the farm
  (a data folder switches to EmbeddingGemma 2 for good, Reindex told once, an upload on a farm without it fails with a
  message), the Home and Home command boxes with lessons 13–14 and the Morning briefing / Comfort advisor / Energy
  report templates, and the coding agent kept off `.git/` and `project.json`.
- **Farm app farm-v0.0.44** (tag `farm-v0.0.44`, commit `ad6a8a4`, CI run 37927470136): a prerelease, 10 assets (Windows
  x64, macOS arm64, Linux arm64 AppImage), installed by hand. It brings the document search plugin (on with an NVIDIA
  GPU), llama.cpp b11512, the update's file-by-file copy, and the vLLM card in view.
- **`build-llamacpp-arm64`** (CI run 37927450520) ran on the pin bump reaching `main` and published the `llamacpp-b11512`
  prerelease (`llama-b11512-bin-linux-cuda-arm64.tar.gz`) that a Spark farm downloads.
- **Release notes:** both pages got a "What's new" for the people who install them, above CI's own text.
- **Not done, the owner's:** the ★ tests of HUMAN_TESTS.md on these builds (K1–K5, J1–J4, I1–I5, A1, B1, then C1–C2 on
  the live update feed); trying ggml-org's own arm64 CUDA build on a Spark (DEVLOG 2026-10-09 10:31); the open
  questions at the end of HUMAN_TESTS.md and of the home entry (11:44).

## 2026-10-09 (11:44) — The Computer reaches the home: Home and Home command boxes, lessons 13–14, three templates (branch `home-tutorials`)

**The owner's ask (2026-10-09):** the office has a Nabu Casa **Home Assistant Green**; look it up, find use cases, and
make them tutorials on the Computer. Until today a graph could not reach the home at all (the home tools were MCP-only,
answered in main; the Agent's `fetch` has no token). Design first, in [HOME_ASSISTANT.md](HOME_ASSISTANT.md).

**Research** (sources in HOME_ASSISTANT.md): the Green is Ethernet-only (RK3566, 4 GB, 32 GB eMMC, no Wi-Fi/BT/Zigbee/
Thread radio): it reaches network devices and Matter over Wi-Fi, and Zigbee/Thread only with a Connect ZBT-2. Every
install has met.no's `weather.forecast_home`; calendars are one integration away. So the shelf uses what an office most
likely has: temperature/humidity/CO2, a power-measuring plug, a light, the weather and a calendar. Nabu Casa cloud is
never used: the LAN address and the long-lived token only.

**Built** (ponytail: main's `homeAssistant.ts` reused, the outputs' arming reused, no dependency):
- `homeAssistant.ts`: `read(ids, hours)` (the devices a person picked, ≤ 30; `cleanAttrs` = the MCP tools' own
  no-coordinate filter; a weather's forecast through the read-only `weather.get_forecasts`; a calendar's next 24 h;
  history ≤ 168 h thinned to 240 points), `entities()` and `actionsOf()` for Choose…, and `commandTool` became
  `command(a, {outputsArmed?})`: one path for a model and a box, every check unchanged, and for a box a dry run unless
  the outputs are armed (read in main from `outputs.ts`) AND home commands are allowed. Errors carry a code so a box
  hands on its saved copy only when no home is linked. IPC `lol:home:read/entities/actions/command`; the native
  Allow dialog now says Home command boxes may switch the devices too.
- `graph/parts/home.mjs`: **Home** (*bring*) and **Home command** (*show*), through `bridge.mjs` `homeDoor`. The arming
  question (`send.mjs` `targetsIn`) names each Home command (its entity id even when a graph names it otherwise); the
  Outputs control and Panic show with one. `mcp-tools.mjs` `PERSON_ONLY`: a model never sets a Home box's devices nor a
  Home command's device/action/data.
- Lessons **13 · read the room** (Home → Instruction → Speak) and **14 · switch the home** (dry run, Allow, Arm, Panic),
  templates **Morning briefing**, **Comfort advisor** (code decides, a Condition gates the fan's Home command) and
  **Energy report** (code charts a plug's day; a seeing model describes it), each with a saved reading
  (`templates/home-readings.mjs`) so they walk with no home; a **?** example for each box.

**Tests:** `npm run build` clean; `node test/chat-unit.js` 1862 passed (35 new in `home-boxes.test.mjs` against the
compiled main and a fake Home Assistant, and `home-part.test.mjs`; the gate, PERSON_ONLY and the arming list were each
reverted once and their tests failed); `npm run test:unit` 29; `chat-lint` 0 violations (rule 15: 15 lessons, 11
templates), its self-test 26/26; `chat-scope --base 3b8c0c1` names the main/preload files (homeAssistant.ts, index.ts,
preload): outside the old LOL Chat carve-out by nature, as the 2026-09-30 home work was. Harness: `k26-home` (lessons
13–14 and the three templates walked with no home on the mock farm; arming refused mid-run, which fails with the guard
removed) and, with `LOL_HARNESS_HA` = the demo home in WSL, the live half: Choose…, a reading with forecast, calendar
and history, the bed light a dry run until armed AND allowed then on at 30 %, `unlock` refused, Panic. The whole harness: 410 passed, 0 failed.
Pins moved for the two new boxes and the shelf (c3-landing, k4-shots-kinds via `computer-look.css`'s kind map,
k5-lessons, k5-palette, h0-selfcheck); `palette-menu.mjs` `reveal` got a 1 px margin (a rounding bug the longer menu
exposed).

**Security review** (a fresh agent, on the diff against homeAssistant.ts's rules): no blocker; fixed — (1) a template's
made-up reading could drive a real fan when a linked home lacked the devices or did not answer: the copy is now handed
on only with no home linked; (2) arming during a run a model started would turn it live half-way: the run bar refuses;
(3, 5) an arriving object became the command's details (a model could set them through a wired box; a Condition passing
a reading sent the reading): details are now only the box's own With, shown in the arming question; (4) History could
overload a Green: ≤ 720 device-hours, one read per 5 s, an 8 MB streamed cap; (6) the arming line puts the entity id
first and clamps the name; (7) no history of person/device_tracker/zone, no event place; (8) `HIDDEN_ATTRS` compared
without case, plus `location`, `coordinates`, `entity_picture_local` (the MCP tools gain it too); (9, 10) wording: the
outputs are armed by the page's own question (the native Allow list is the gate a compromised page cannot pass), and
Panic does not undo what was switched.

**For the owner to decide:** whether a calendar's event descriptions (kept) are fine to hand to a model; whether the
templates' made-up studio ids should be replaced by the Green's real ones once it is linked (ids differ per home:
Choose… covers it).

**For the owner:** the rig checks with the real Green are in HOME_ASSISTANT.md ("Rig checks on the real Green"). Not
merged, not released.

## 2026-10-09 (10:59) — The coding agent can no longer change a project's remote or its settings

The test list's review (HUMAN_TESTS.md, decision 6) asked whether `project.json` was protected from the IDE's coding
agent. It was not, and neither was `.git/config`: the fence (`FENCE_JS`, `studio.ts`) only checked that a path stays
inside the project, and both live inside it. `.git/config` holds the remote a person's **Push** sends to, and the
token is kept per HOST — so an agent misled by something it read could point `origin` at another repository on
github.com, and the person's next Push would send the project there with their token.

- **The fix:** the fence refuses a `write` or `edit` whose real path is `project.json` or `.git` / anything under it
  (case folded on Windows, after `..` and links resolve). Reading both stays allowed; `.gitignore` is the project's
  own and stays writable.
- **Tested:** the fence test in `test/chat/unit/studio.test.mjs` gains the cases (an edit of `.git/config`, a write of
  `project.json`, a `src/../.git/hooks/x` detour, `.GIT` on Windows, a read allowed, `.gitignore` allowed); with the
  old fence it fails (`the remote cannot be changed: 0 !== 2`). Shell chat-unit 1844/0, chat-lint 0.

## 2026-10-09 (10:53) — One list of the human tests: docs/HUMAN_TESTS.md (branch `human-tests`)

The owner: "refactor and aggregate all the human tests we have to do with the client so I can get on to it." Docs
only; no code changed.
- **Collected** about 460 person-only items from eleven lists: TEST_SCENARIOS_v0.2.md (113, §1–§8 with 7d, 7e, 7f),
  RIG_CHECKLIST.md (46 open), LOLCHAT_RIG_CHECKLIST.md (200, none ever ticked), LOLCHAT_STUDIO_PLAN.md §5 (18),
  LOLCHAT_TESTING.md §4 (5), COMPUTER_PLAN.md §13 (40), COMPUTER_STATUS.md "What only you can check" (13),
  VLLM_MANAGED_PLAN.md §9.6/§11.5/§11.6 (12), EMBEDDINGS_STUDY.md (6), HOME_ASSISTANT.md "Not tried yet" (3, the
  file itself left alone while the Home Assistant tutorials are written), IDE_PLAN.md (1), and five new ones from this
  log's not-done lines (llama.cpp b11512 from the installed Farm app, a 12 GB card beside document search, the Spark's
  arm64 build and ggml-org's, the update's held-file copy, the clean-state run). Each was checked against this log,
  the night logs and the code, three of the sources by read-only agents.
- **Dropped as done** (about 20): the CI installers, the Open WebUI pin bump with no code change, a client on a shared
  Farm app, Home Assistant on the demo home, a Computer program on the first try, Code on a real graph, the debug
  log's file, and ten COMPUTER_PLAN items the harness proves.
- **Dropped as superseded or never shipped** (about 67): LOL Vibe's P3/P4 (images, documents, search, Blender cards,
  recipes, Read aloud), the history-rollback steps (history moved into the data folder), the per-thread Computer
  (From/To thread and the rest), "zero `/v1/embeddings`" (document search), the Studio's S1–S3 benches, the
  laptop-side embedding switch, the Farm app updates to 0.0.39/0.0.42/0.0.43 (now K1), the operator-run vLLM on the
  PRO 6000, and the production take-over (the clean-state run removed what it would take over).
- **A developer's, not a person's** (5): `e2e.js`, the ask spine's rung, the strict harness flake, the projects
  security review, the pinned Open WebUI's `--port`.
- **Kept** (about 365), merged into **99 tests** in 14 sessions grouped by setup: A–I the client (one laptop and the
  PRO 6000; a fresh laptop and no internet; upgrades and the data folder; two machines; Mac and Linux; the Computer's
  devices; the IDE; Home Assistant; document search), J–N the farm side (the PRO 6000; a Windows RTX test box; the
  Spark; reboots; a clean box). Each test: what it proves, its setup, steps, the expected result, a box and a *Found*
  line; a time per session (about 45–50 h in all).
- **18 tests block farm-v0.0.44 + client v0.2.10** (★): A1, B1, C1, C2, I1–I5, J1–J4, K1–K5.
- **The old lists now point into it:** TEST_SCENARIOS_v0.2.md is a table from each scenario number to its test or
  to where it was verified; RIG_CHECKLIST.md keeps every ticked line and turns each open one into an arrow (three
  newly ticked with their evidence); LOLCHAT_RIG_CHECKLIST.md, COMPUTER_PLAN §13, COMPUTER_STATUS's list and
  LOLCHAT_STUDIO_PLAN §5 became section maps; VLLM_MANAGED_PLAN §9.6/§11.5/§11.6, PRO6000_VLLM_SWITCH Part 2,
  IDE_PLAN, EMBEDDINGS_STUDY and LOLCHAT_TESTING got a pointer. Each says where the old wording is
  (`git show 3b8c0c1:<file>`). CLAUDE.md's "Still needs real … verification" paragraph is a two-line pointer.
- **Found on the way, for the owner** (HUMAN_TESTS.md, "Questions for the owner"): LOL Vibe tells a starting vLLM "a
  few seconds" while Open WebUI says 2 minutes; the Plugins switches do not last across a farm restart (old checks
  expected Classify back); the v0.2.9 search-model checks now apply only to folders that never met document search;
  "≈ 362.7 million" is recorded nowhere; the coding agent's model line does not know Qwen3.6; `project.json` is
  refused by the projects API but not by the agent's fence (read from the code, not tested); the vLLM button's "about
  35 GB" may read higher with document search on; whether the ★ tests run on a local build or a pre-release tag.
- **Checks:** no control character in any doc (the farm test's rule, run by hand); every old open item has one place.


## 2026-10-09 (10:31) — Owner decisions: document search stays on by default; ggml-org's arm64 build to be tried on a Spark; releases wait

- **Document search's default stays `enabled: 'auto'`** (on with an NVIDIA GPU, ~1.2 GB of its memory). Nothing to
  change in the code.
- **The DGX Spark's llama.cpp:** try ggml-org's own `llama-<build>-bin-ubuntu-cuda-13.4-arm64.tar.gz` (+ its
  `cudart-…` runtime) on a Spark. If it runs (GB10 seen, a reply, EmbeddingGemma 2 at 768), `assetsFor('linux',
  'arm64')` points at it like Windows and `build-llamacpp-arm64.yml` goes.
- **Releases wait:** farm-v0.0.44 + client v0.2.10 (the update copy fix, the vLLM card, llama.cpp b11512, document
  search) are not cut yet.
- Started the same morning: Computer tutorials for the office's Home Assistant Green, and one list of every test a
  person must still do with the client.

## 2026-10-08 (21:57) — Document search on the farm: EmbeddingGemma 2 turns the laptops' documents into vectors (branch `embed-farm`)

**The owner's decision (2026-10-08):** documents are embedded on the farm with google/embeddinggemma-2 (768 numbers,
Google's search prefixes); the vectors come back to the laptop and are kept there, as today; the farm keeps nothing.
The privacy rule changes with it: a document's text may be sent to the farm to be turned into vectors (nothing kept,
nothing logged). Open WebUI stays unmodified (env only). Not merged, not released.

**The farm: a plugin, *Document search*** (`farm/src/embed.js`, `plugins/registry.js`):
- **One model per LOL release, in the code:** ggml-org's BF16 conversion of google/embeddinggemma-2 (an official
  conversion with llama.cpp's own `convert_hf_to_gguf.py`), pinned by revision (`bfcd2987…`) and sha256 (checked after
  the download; a wrong file is deleted). Contract `embeddinggemma-2/768/v1`. No model choice in the panel.
- **llama-server in embedding mode,** reusing the llama.cpp engine's download and pin (`llamacpp.js`, untouched here)
  or `llamacpp.binDir`. EmbeddingGemma 2 needs b11454 or later: until the pin bump merges, the plugin says so and
  stays off. 8 slots of 2048 tokens, `--no-webui`, `--no-slots`, `--cache-ram 0`, default log level. Bound to
  `proxy.host` on port 8894; outside the seat gate, so no seat.
- **Its key** is `pluginKey('embed', password)`, like the other plugins (on a farm with a password it leaves the
  beacon and comes from `/lol/plugin-keys`). **Deviation from the design:** it goes in `LLAMA_API_KEY`, not
  `--api-key`, so it is not in the process list. The box's own `LLAMA_*` variables are dropped, so nothing can turn on
  `--log-prompts-dir`.
- **Advertised** as `embed: {url, key|null, keyId?, model, dims, contract}` (snapshot + contract schema).
- **On by default, the owner's rule:** `embed.enabled: 'auto'` = on when the box has an NVIDIA GPU and llama.cpp can run
  there, else off. It costs 1.05 GB of GPU memory loaded and 1.16 GB at its peak (measured on the RTX PRO 6000, b11512).
  The panel's Plugins card has its toggle and a plain sentence.
- **GPU memory:**
  - When its files are on disk, `lol up` starts it before llama.cpp measures the free memory and before Ollama's
    context probe. Ollama's cached context verdict is keyed on it, so a farm that gains it measures again.
  - A first download (llama.cpp + 0.6 GB) waits until the farm is public instead; `lol install` downloads it ahead.
  - vLLM's Automatic memory keeps 1.5 GB for it only while it is on but not running yet. Once it runs, its memory is
    no longer free; reserving it again would count it twice. On the PRO 6000 that is 52 → 50 GB while it is not running.
  - vLLM's "too small" check counts it.
- **Logs:** llama-server writes three lines per text (a slot taking it, a token count, releasing it), about 600 for a
  50-page document. **Deviation:** the farm's log drops those three (`logSkip`) and keeps every other line.
- **The rest:** `lol down`, the stale-run reap and the Farm app's reap stop it (`embedPid`). A boot that gives up
  stops the plugins it started early.

**The client** (`configBridge.ts`, `sidecar.ts`, `farmSelect.ts`, `index.ts`):
- **When the farm advertises a contract this client knows** (`EMBEDDING_CONTRACTS`), Open WebUI gets:
  - `RAG_EMBEDDING_ENGINE=openai` and `RAG_EMBEDDING_MODEL=embeddinggemma-2`;
  - `RAG_OPENAI_API_BASE_URL=<url>/v1`, never unset (Open WebUI would fall back to the chat address);
  - `RAG_OPENAI_API_KEY`, the plugin's key;
  - the two prefixes;
  - batches of 32, 2 at a time, 300 s per file.
- **The data folder adopts the farm's model for good** the first time it meets it: `DATA_DIR/lol-embedding.json`. It
  moves with the folder.
- **Never MiniLM again for that folder.** Read in Open WebUI 0.11.4's source:
  - With the embedding service unreachable, an upload's indexing fails and the file is marked failed.
  - `BYPASS_EMBEDDING_AND_RETRIEVAL` would keep uploads working, read whole, but they get no vectors. Later, on a farm
    with document search, a chat that still carries such a file reads its missing vectors and silently gets nothing.
  - So the honest choice is the failure. On a farm without the folder's contract, the engine points at
    `http://127.0.0.1:0/v1`: nothing can listen on port 0, so the upload fails at once and no text leaves.
  - A toast says why: *This farm does not index documents the way your documents are indexed, so uploading a
    document fails here…*
- **The move from MiniLM:** a folder whose vector store already held collections is told once to press **Reindex**
  (Admin Panel ▸ Settings ▸ Documents, next to *Reindex Knowledge and Memory Vectors*). The app never calls the admin
  API. Notices now stay on screen 16–45 s, by length.
- **A check before the switch (an addition):** before a folder adopts the model, one search of the word "ok" must
  answer from this computer with the key and 768 numbers. Otherwise a firewall closing the farm's port would switch
  the folder for good and fail every upload; that launch stays on MiniLM instead.
- **MiniLM:** with the farm's engine, Open WebUI never loads MiniLM. The MiniLM repair, the huggingface.co probe and
  the offline notice now apply only to folders still on MiniLM; `HF_HUB_OFFLINE` then needs Whisper alone.
- **No needless restart:** the env changes only with the farm's service or the marker, and a keyed farm's pending key
  fetch keeps the service Open WebUI already has (`keepPending`, generalised from `keepPendingExtract`).

**Tests:**
- Farm: `test/run.js` 215/0, 4 new: the argv, the key's place and the log filter; availability and `'auto'`; the key
  tied to the password, the snapshot entry and the schema; the start order, the Ollama verdict key and vLLM's reserve.
  With the reserve removed from `poolGib`, or the key left out of the env, they fail.
- Farm app: `supervisor.test.js` 8/0 (the reap counts `embedPid`).
- Shell: build; `chat-unit` 1844/0 (5 new: the env, the marker and never-MiniLM, Whisper-only offline, the farm
  context and keys, the check before the switch); `test:unit` 29/0; `chat-lint` 0. With the folder's marker ignored,
  2 of them fail. (`chat-scope` is LOL Vibe's phase gate and does not apply.)

**End to end on this box** (scratch ports 18894 and 18181–18185, a scratch data folder and HF_HOME; the owner's farm
on Ollama, 78 GB free):
- **The plugin alone,** through the real registry with an official llama.cpp b11512 (`binDir`): it downloaded and
  checked the model in 51 s, then started; its test search gave 768 numbers. A cached start took 1.6 s.
- **The built Open WebUI 0.11.4,** launched with `buildSidecarEnv`'s env:
  - healthy at 7–8 s, and nothing written to the scratch HF_HOME (no MiniLM);
  - a French text upload: its collection is 768 numbers wide in `vector_db`, with `embedding_config` naming
    `embeddinggemma-2`;
  - a French search and an English one both found the cheese passage; a budget question found the budget passage;
  - 200,000 characters (356 pieces) were indexed in 1.4 s.
- **A farm without document search, same folder:** the upload is marked failed in 2 ms (`Cannot connect to host
  127.0.0.1:0`). No request reached the farm, and nothing was downloaded.
- **A MiniLM folder:** a knowledge base of 384 numbers. After the switch, a search found nothing (HTTP 200, empty: the
  silent failure). After the three calls the Reindex button makes, every collection is 768 numbers wide and an English
  question finds the French passage. The test pressed Reindex; the app never does.
- **Privacy:** a made-up word in the document (*Quorvellisande*) was searched afterwards:
  - in the worktree's `farm/` (with `.models`), the llama.cpp folder, the plugin's whole unfiltered log, its key file
    and `%LOCALAPPDATA%\llama.cpp`: not found;
  - no farm-side file was written during the uploads;
  - the log holds token counts only;
  - on the laptop side it is in `uploads/`, `webui.db` and `vector_db`, as expected.
- **Cleaned up:** every process started here is stopped, and the GPU is back to 78.7 GB free.

**Not done, the owner's:**
- **The default:** `'auto'` (on with an NVIDIA GPU, ~1.2 GB). `false` in `EmbedSchema` makes it opt-in.
- **The release, after the llama.cpp pin bump merges** (b11454 or later, from the `llamacpp-next` branch), then:
  - the rig checks of TEST_SCENARIOS 7f;
  - the DGX Spark (our arm64 build of the new pin);
  - a 12 GB card, where Ollama's context gets measured again beside the plugin.
- **Not covered:**
  - macOS and Linux x64 farms have no ready-made llama.cpp, so they get no document search, unless a developer sets
    `llamacpp.binDir`;
  - a search longer than 2048 tokens (~8000 characters) is refused, so on a farm under 24k tokens per person it finds
    nothing; 4096 would cost +0.5 GB;
  - the first LAN start of llama-server may show a Windows Firewall prompt, as the other plugins do;
  - the plugin and the llama.cpp engine could both download the same build at the same moment, which is not guarded
    (a `ponytail:` note in `embed.js`).

## 2026-10-08 (21:40) — llama.cpp moves from b10670 to b11512: EmbeddingGemma 2 needs b11454 or later

**Why.** The owner chose to embed documents on the farm with `google/embeddinggemma-2`. llama.cpp knows its
architecture (`gemma-embedding2`, PR #30054) from b11454 on. b10670 refuses the GGUF ("unknown model architecture"),
and the panel's sentence for that case reads right ("This model's architecture ('gemma-embedding2') is newer than the
farm's llama.cpp build (b10670)…"), checked on the CPU.

**The pin: b11512**, an official ggml-org release of 2026-10-08 17:39 UTC.
- It was the newest with its Windows x64 CUDA zip at 19:21 UTC; b11513's zip was still uploading then.
  b11513 (a CUDA top-k change) is out since, and is not needed. Everything below was measured on b11512.
- Only official builds: ggml-org's Windows zips, and for the Spark our own CI build of the same tag.
- `farm/src/llamacpp.js`: `PINNED_BUILD` b11512. The Windows zips are now `cuda-13.4`: ggml-org moved from 13.3
  on 2026-09-15, and builds this new have no 13.3 zip. `assetsFor(platform, arch)` takes the platform, so a test
  can check every platform's names.
- `.github/workflows/build-llamacpp-arm64.yml`: `LLAMACPP_BUILD` b11512. It runs on the merge to `main`, not
  before. Nothing else changes: `llama-server-impl` is still a static library with `BUILD_SHARED_LIBS=OFF`,
  ggml's CMake still turns the plain `121` into `121a` (the Blackwell FP4 path), and the default flash-attention
  kernels are still q4_0, q8_0, f16 and bf16.

**What changed between the two builds (842 commits) that touches the farm.** Read in `common/arg.cpp`,
`common/common.h`, the server sources, and both binaries' `--help`:
- **Every flag `argsFor()` passes is still there, with the same parsing and defaults:** `-fa 1`, the cache types,
  `--spec-type draft-mtp`, `--spec-draft-n-max`, `--cache-reuse`, `--cache-ram`, `--kv-unified`,
  `--slot-prompt-similarity`, `--mmproj`, `--jinja`, `--metrics`, `--no-webui`, `--alias`.
- **Removed:** `--mlock`, `--mmap`/`--no-mmap` and `--direct-io` (use `--load-mode`), and `--tensor-read-lazy`
  (now `--lazy-mode`). The farm passes none of them. One in `llamacpp.extraArgs` now stops llama-server, and the
  panel reads "llama.cpp did not become healthy — its last error: error: invalid argument: --no-mmap" (checked).
  README and CLAUDE.md say so.
- **Reasoning kept in the history is now on by default** (#28174). For Qwen3.8's template this changes nothing.
  An earlier turn's `reasoning_content` reaches the prompt on b10670 too: 88 tokens on both builds, 76 with
  `--no-reasoning-preserve` (`/apply-template`, on the CPU). So the farm keeps the default. It only matters for a
  client that sends reasoning back: the coding agent does; Open WebUI through the farm and LOL Vibe do not.
- **The same in both:** the `/metrics` names `perf.js` reads, `/health`, the log's level markers, and the
  "unknown model architecture" and "doesn't contain MTP layers" lines `explainEngineFailure()` quotes. The zip
  holds the same files, so extracting over b10670 leaves no stale DLL.
- **New and unused by the farm:** `--moe-cache-mib`, `--spec-draft-sampling`, `--log-jsonl`, and `/v1/systemone`
  (decision models, Laya among them).

**Measured on the PRO 6000** (driver 596.36). The owner's farm was on Ollama and not busy, and 78.7 GB was free
before every run; a watchdog stopped a run if the farm turned busy or less than 6 GB stayed free. Only scratch
loopback ports (18181–18196) and my own processes.
- **Install:** `ensureLlamacpp()` in the worktree fetched both zips under the new names in 97 s. Their sha256
  match the release's digests, and the marker reads b11512.
- **The farm's own path:** config, `argsFor`, `spawnLlamacpp`, `waitForLlamacpp`, `llamacppAlive`, then
  `fetchMetrics` with `metricsSample`. The farm's argv with the context pinned at 32768, 2 slots, q4_0 KV, the
  unified pool and the vision projector, on Qwen3.8-27B-UD-IQ2_S. Each build ran the same suite:

| | b10670 | b11512 |
|---|---|---|
| healthy after | 4.0 s | 6.1 s |
| GPU memory | +10,381 MiB | +10,407 MiB |
| a reply, thinking off | "Paris is the capital of France.", 84.6 tok/s | same answer, 88.0 tok/s |
| a reply, thinking on | 109.8 tok/s | 111.0 tok/s |
| a tool call with `--jinja` | `get_weather({"city":"Paris"})`, then an answer from its result | the same |
| two people at once (400 tokens each) | both at once, TTFT 225 ms, 95.4 tok/s each | both at once, TTFT 250 ms, 94.6 tok/s each |
| `/slots` | 2 slots, 32768 each | 2 slots, 32768 each |
| a red picture | "red" | "red" |
| `/metrics` through `perf.js` | 15 series; 98 tok/s; 38 % of prompt tokens from cache | 15 series; 97 tok/s; 38 % |

- **MTP** on the library's UD-Q2_K_XL (downloaded, hash checked): healthy in 6 s on both builds, +11.5 GB, and
  thinking replies at 172 tok/s (b10670) and 177 tok/s (b11512). Drafts were accepted at 0.52–1.0 on both, and
  two people at once ran at 106–119 tok/s on both. MTP on the stripped UD-IQ2_S fails the same way on both builds,
  and the panel says "This quant has no MTP head…".
- **EmbeddingGemma 2** (ggml-org's official `embeddinggemma-2-Q8_0.gguf`, 310 MB, hash checked) with `--embeddings`:
  - `/v1/embeddings` answers with **768 dimensions**, normalised.
  - It takes +753 MiB on the GPU and is healthy in 1.5 s.
  - 400 chunks of ~151 tokens in one request: 1.3 s on the GPU, 19.3 s on the CPU.
  - The same texts on the GPU and on the CPU give vectors with cosine 0.9999.
  - French–English pair 0.874; against an unrelated sentence 0.689.
  - For the embeddings work: the server sets the batch to 512 tokens per input, and flash attention is not
    supported for this architecture on CUDA (it falls back by itself).
- **The cancel test** (`LOL_CANCEL_ENGINE=llamacpp node test/litellm-cancel.js`, Qwen3.8 IQ2_S): 7 of 8 paths stop.
  The non-streaming call abandoned while someone else streams still runs to its end: released 19.6 s after the
  abort, at 2071 tokens. That is the upstream bug of 2026-10-04; PR #29707 is still open. README, the test's header
  and `docs/archive/LLAMACPP_NONSTREAM_CANCEL.md` say b11512 has it too.

**Found on the way, not changed:**
- **`--cache-reuse` does nothing while the vision projector is loaded,** on b10670 too: the log says "cache_reuse
  is not supported by multimodal, it will be disabled". The default Qwen3.8 runs with its projector, so only the
  host-RAM cache and exact-prefix reuse work there (38 % from cache in the suite).
- **ggml-org has published its own Ubuntu arm64 CUDA 13.4 build since 2026-09-14,** with `121a`. It could replace
  our CI build once tried on a Spark.
- **After a farm update, the next llama.cpp start downloads ~577 MB.** Offline, it falls back to Ollama, as with
  every pin bump. The old zips (~537 MB) stay in `farm/.models`.

**Tests:** farm `node test/run.js` 212/212. The new test checks three things: the pin is at least b11454; the
Windows asset names are the ones ggml-org publishes (CUDA 13.4); and the Spark workflow's build and file name are
the ones the farm fetches. It fails with the pin, the CUDA tag or the workflow put back to b10670.

**Not done:** the merge (it runs `build-llamacpp-arm64`), a farm release, the Spark tarball on a real Spark, and
the farm's embeddings service itself (another branch).


## 2026-10-08 (14:05) — The clean-state run on the PRO 6000 begins; the vLLM card opened out of sight

**The clean-state run** (the owner's choice: a fresh Farm app, and a real vLLM install from the panel). Done from 12:46:
- **The farm's Quit.** The Farm app was closed normally: its `lol down` stopped LiteLLM, SearXNG and OCR. The
  operator-run vLLM kept running, as designed, and was then stopped with its own `stop.sh`; the GPU went back to 7 GB.
  The stuck `serve.sh` disappeared once its holder exited.
- **The logon task "LlmOnLan vLLM" was removed.** Its definition is saved in `Documents\LlmOnLan-vLLM-task.backup.xml`.
- **The old data folder was set aside,** renamed `%APPDATA%\LlmOnLan Farm.before-clean-2026-10-08` (90.8 GB, intact).
- **`~/lol-spike` was parked** as `~/lol-spike.parked-2026-10-08`, so the panel offers a real install.
- **Farm app farm-v0.0.43 ran its first-run wizard** on the empty folder. It reused the owner's Ollama and its
  `gemma4:12b`. The farm came up on Ollama, with no External button.
- **The checklist read:**
  - WSL 2 with Ubuntu;
  - the GPU seen;
  - 119 GB free;
  - "vLLM is not installed";
  - Install offered into `~/lol-vllm`.

**The owner: "I cannot click the vLLM button."**
- **The cause.** The button worked, but the card it opens starts 1,056 px down, below an 835 px window. Rendered
  offscreen with the farm's token and clicked: the only visible change was a sliver at the bottom.
- **The fix:** opening the card now scrolls it into view (smooth unless the person prefers reduced motion).
  Re-rendered against the live farm, the page scrolls 791 px and the card fills the window with Install vLLM in
  view.
- **A contradiction on the same screen.** Before vLLM is installed, the checklist said "press Download next to it"
  for the chosen model, and there is no Download button then. It now says "Install vLLM downloads it too".
- **The test stub got a real check.** The panel's test stub answers `getElementById` from the rendered HTML and
  records the scroll. The new test presses vLLM before it is set up, then checks that the card is drawn and
  scrolled to.
- **Tests:** farm 211/211.

## 2026-10-08 (12:02) — The Farm app's update stopped half-way over a running vLLM: the farm code is now copied file by file

**Found** by the owner's screenshot of farm-v0.0.43 on the PRO 6000: the panel showed the External server with no
"Let the farm run vLLM" offer.
- **What happened.** Installing farm-v0.0.43 copied the new farm code over the old with `fs.cpSync`. The copy stopped at
  `farm/vllm/serve.sh`, the script the running vLLM was started from:
  - `install.sh`, `lol-vllm.service` and `relay.py` were updated;
  - `serve.sh` was left "delete pending" (inside WSL it reads `-?????????`, still held by bash on fd 255);
  - `start-windows.ps1` and `stop.sh` stayed old, and `status.sh` was never copied.
- **The effects.** The take-over check needs `status.sh`, so it found nothing and logged nothing. The refresh's own
  error went to a console nobody keeps. `farmCodeVersion` stayed at 0.0.42, so the copy is retried at each launch,
  and it fails the same way while the old vLLM runs. Chat kept working on External.
- **The cause, reproduced.** Electron 42's own `fs.cpSync` (Node 24.18, `cpSyncOverrideFile`) deletes a file before
  writing it. A file another process holds with delete sharing (WSL's bash, or a Node handle in the test) is left
  "delete pending", the new copy cannot take its name (`EIO, Accès refusé`), and the copy throws. The system's Node
  24.14 overwrites in place, which is why the overnight test of a copy over a running `serve.sh` passed: it ran
  outside Electron.
- **The fix, `farm-app/src/main/copyTree.ts`:**
  - The farm code is copied file by file, and unchanged files are skipped.
  - A file that differs is moved aside into `farm/.replaced`, then the new one is written. Windows allows the move
    while a holder has the file open, and the holder keeps reading its old copy.
  - One failure never stops the others. The refresh names every failed file in `farm.log` and is retried at the
    next launch.
- **The farm side:**
  - A `farm/vllm` script that is missing is now said as such on the vLLM card ("A file of the farm is missing
    (vllm/status.sh): its last update did not finish. Restart the farm…"). Before, it read as "WSL did not answer:
    restart the computer", and was counted as no answer.
  - The take-over check now logs why it could not look.
- **Checked:**
  - `farm-app/test/copytree.test.js` runs under Electron's own Node (it re-runs itself there): a held file is
    replaced and the holder keeps its old bytes; the PRO 6000's stuck state, made with Electron's own `cpSync`, is
    reported with every other file still copied, and the next copy completes; unchanged files are left alone.
  - With the old `cpSync` copy put back, the test fails with the production error (`EIO … vllm\serve.sh`).
  - With a real WSL bash running a script from `/mnt/c` (`setsid`, as `serve.sh` does), the moved-aside copy updated
    every file, and the script ran to its end on its old copy.
  - Farm 210/210 (two new: the missing-script sentence and `unanswered`; `spawnScript` refuses before starting
    anything). Farm app 8 + 3.
- **Not done yet:** the release (farm-v0.0.44) and the clean-state run on the PRO 6000 with the owner.

## 2026-10-08 (07:08) — Release client v0.2.9 and Farm app farm-v0.0.43: vLLM run by the farm, Open WebUI booting once

The owner asked on 2026-10-07 at 20:58 to commit and document everything, check the docs against the code, merge into
`main`, then cut new releases. Windows with RTX cards and the DGX Spark come first. All of that is done.
- **Merged.** `main` was fast-forwarded to `multiuser-phase0` at `0ecfe3e` before tagging. That branch holds the
  `vllm-managed` merge (`8a37e6f`) and the docs pass (`dbf8b6b`, `0ecfe3e`).
- **Gates on the merged tree** (05:28–06:00, then 06:30):
  - farm `test/run.js` 209/0; LiteLLM cancel PASS; `LOL_VLLM_FAKE=1 test/vllm-lifecycle.js` 161/0 (23 steps);
    `farm/vllm/test_scripts.sh` under WSL 112/0;
  - Farm app `npm test` 8/0 and build;
  - shell build, chat-unit 1839/0, unit 29, lint 0, asar-probe OK;
  - the chat harness 407/408. The one failure, `p1-stick-bottom` (scroll timing), ran while the docs editor loaded
    the box. Its phase then passed 3 times out of 3 (49/49). LOL Vibe's scroll code is unchanged in this release.
- **The docs pass** (06:18): 3 reviewers found 166 findings, one editor applied them, and a verifier's 8 follow-ups
  were fixed by hand.
- **Client v0.2.9** (tag `v0.2.9`, commit `927d60b`, CI run 37728007354, 34 min): success, 27 assets, the same set as
  v0.2.8. That is 5 installers, 5 `owui-sidecar-*` (Open WebUI 0.11.4, unchanged), 5 `dsh-runtime-*`, the blockmaps,
  and `latest*.yml` saying 0.2.9. Installed clients update themselves. What changes for a person:
  - Open WebUI opens once: the farm found at the boot is saved, and a page that loaded without its farm reloads once
    the farm answers;
  - no per-boot huggingface.co check;
  - a half-downloaded search model is repaired before the start;
  - a start without huggingface.co opens the chat in 12–15 s, with a toast;
  - `logs/boot.log`.
- **Farm app farm-v0.0.43** (tag `farm-v0.0.43`, commit `8cd6980`, CI run 37728016009): a prerelease, 10 assets
  (Windows x64, macOS arm64, Linux arm64 AppImage for the Spark). Installed by hand. It brings:
  - vLLM run by the farm;
  - the take-over offer for an operator-run vLLM;
  - Plan capacity;
  - Quit stopping the farm's vLLM.
- **`build-llamacpp-arm64`** ran on the push to `main` and rebuilt the same pinned b10670 for the Spark: success.
- **Release notes:** both pages got a "What's new" written for the people who install them, above CI's own text.
- **Not done, the owner's:**
  - install farm-v0.0.43 on the PRO 6000, then press **Let the farm run vLLM** (`docs/archive/PRO6000_VLLM_SWITCH.md` Part 2).
    Its Farm app has been closed since 2026-10-07 20:46, and vLLM keeps running in WSL.
  - the rig checks of TEST_SCENARIOS 7e;
  - the DGX Spark checklist (`docs/archive/plans/VLLM_MANAGED_PLAN.md` §11.6);
  - whether the panel's Plugins switches should last across a farm restart. Today they don't, so an RTX 5090 keeps
    vLLM only until the next start;
  - the embeddings decision (`docs/archive/plans/EMBEDDINGS_STUDY.md`: not now).

## 2026-10-08 (06:18) — Docs true to the merge: vLLM run by the farm, operators never sent to a file, the v0.2.9 rig list

A docs review of 8a37e6f (the merge of `vllm-managed` into `multiuser-phase0`) listed more than a hundred findings: docs that
still described two engines, `main`, or the operator-run vLLM as the way, and operator docs that sent people to
`lol.config.json` or a terminal where the panel does it (owner rule, 2026-10-07). A first pass applied most of them
and stopped before committing; this pass checked that work against the code, kept it, and applied the rest. Each
finding was checked against the code first.
- **CLAUDE.md.** The bullets describe `multiuser-phase0`, not `main`, and say what ships as v0.2.9 / farm-v0.0.43.
  The panel's vLLM rows (name, context per person, Automatic people and memory, Apply's dry run, the download slot).
  `lol install` never installs vLLM. The contract table gains the Hugging Face cache row (`repairMiniLm`, the probe,
  re-check on a pin bump) and `reloadIfFarmBack`. The exact env: the per-launch `HF_HUB_OFFLINE` (no probe behind an
  env proxy, Electron's `net.fetch`), the OCR key fallback `sk-lol-ocr`, the MCP server's name and description.
  Data locality and the privacy boundary name the HF cache (where it moves, what the app writes there) and the
  HEAD to huggingface.co. What `boot.log` holds (states only; the repair and an offline start are console only).
  The repo layout: `farm/src/capacity/`, `farmProcess` (the reap and `lol down`), `farm-app/test/`. The rig list
  for v0.2.9 / farm-v0.0.43.
- **farm/README.md.** Three engines, one at a time, chosen in the panel. A table of which engine runs on which
  computer (Windows + NVIDIA, the Spark, Linux x64 with the CLI only, macOS). Every "llama.cpp only" now says vLLM
  too (the name users see, Apply, the Performance card, the model choice). The external-server refusal quotes the
  real text (up.js `externalRefusal`) and says the engine buttons still work. The operator-run recipe sections open
  with "for a developer": an operator presses the vLLM button. A headless Spark gets no farm at boot (R4). A row for
  "vLLM could not start". `lol status` does not report vLLM or llama.cpp. The two vLLM test suites under Develop.
- **farm-app/README.md.** vLLM is not in the first run; what Stop, Quit and Share do to vLLM; the vLLM rows and card;
  the idle-seat setting; which engines each platform gets, and a Linux x64 row (no build); `npm test`.
- **docs/GETTING_STARTED.md.** vLLM in the farm bullet, the downloads table, Route A (no Linux x64 build), `lol up`'s
  steps, the panel's list (with the password and Plan capacity), §4 and §5. Every operator step now goes through
  the panel: Configure, the plugins, the llama.cpp shapes table, OCR off, sizing, more boxes, the catalog, the
  closing note, §7. The client's first start downloads the search model; without huggingface.co chat opens and a
  message says so; Whisper's one download; about 12 s to reopen and where `boot.log` is; add a farm by address from
  the pill, checked in a browser.
- **shell/README.md.** LOL Vibe's name; seven `src/main` modules in the tree; the closed-LAN bullet as built (no
  per-boot revision check, `hfModelState`, the repair, the probe and its toast); `TASK_MODEL_PARAMS` and
  `TOOL_SERVER_CONNECTIONS`; why the Blender helper is not set through env (issue #18140); `connectPlan` and
  `reloadIfFarmBack`; `boot.log` to verify a packaged client.
- **docs/archive/plans/EMBEDDINGS_STUDY.md.** The download fix is done, and described as built (the gentle repair, the probe, the
  proxy rule); a switch must re-point the MiniLM-specific code and tests.
- **docs/archive/PRO6000_VLLM_SWITCH.md.** Part 1 marked as history, not to run again; Part 2 waits for farm-v0.0.43, and
  step 1 holds when the Farm app is already closed.
- **docs/archive/plans/VLLM_MANAGED_PLAN.md.** Merged, not released; what is left (the release, the production Farm app opened
  again, the take-over and reboot, the Spark, a fresh-PC install, a real vLLM on native Linux).
- **docs/archive/testing/RIG_CHECKLIST.md.** Two client items: a laptop that cannot reach huggingface.co (and one behind a system
  proxy), and a first download cut off.
- **docs/archive/testing/TEST_SCENARIOS_v0.2.md.** A new section 7e, the v0.2.9 / farm-v0.0.43 rig list (13 checks): the Farm app
  update and Plan capacity, a card too small, vLLM from nothing on Windows, switch and back, its settings, Stop /
  Start / Quit / Share, Launch at login, the production take-over and reboot, the Spark (§11.6), Open WebUI starting
  once, no huggingface.co, a proxy, a download cut off.
- **docs/archive/plans/multiuser_implementation_plan.md.** Revision 5 (Phase 2 built as an engine the farm runs). §2, §5, §11, §12 and
  §13 follow: decisions 5 and 10 answered (and the Spark's recipe superseded the same day), 0.6 / 1.4 / 1.5 / 2.x /
  5.1–5.4 statuses, the 128k test set in the panel, not by a flag, the vLLM risk as it stands (pinned 0.30.0, no
  Docker fallback, never run on a Spark by the farm), the reply cap the farm passes. The DEVLOG line numbers it
  quoted pointed at other entries; they now name the entries.
- **The panel (farm/src/admin/index.html), three texts.** The token prompt says where the Farm app keeps the token.
  The "could not reach" line no longer asks whether `lol up` runs. "What the config asked for" became "what this
  farm is set to".
- **Taken differently from the review, after the code:** `farmProcess` reaps and runs `lol down` (the supervisor
  spawns `lol up`), so the layout says that. On a switch the clients' pill reads "Switching to vLLM…" (the job's
  label), "Starting vLLM…" at a start. The panel's people list has no 40 (1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96,
  128), so 7e.5 uses 64 (inside the request cap 128: no restart) and 96 (a restart). Beside vLLM, documents are
  read with gemma4:12b only when it is installed. The review's 7e text stopped half-way through 7e.6: the rest was
  written from its list. The three findings on CLAUDE.md's first line were one change.
- **Tests:** farm 209/209 (it checks the docs for control characters, and reads the plan); Farm app 8/8.
- **The verifier's follow-ups (8, text only):**
  - The Plugins switch lasts only until the farm restarts (`setPlugin` keeps it in memory, as before). So "an RTX 5090
    fits with document reading off" now says so, in farm/README and TEST_SCENARIOS 7e.3. Making that switch last is a
    code change for the owner to decide.
  - The headless Spark can keep the operator-run recipe (README, as in the plan's R4).
  - The search-model repair leaves no trace in a packaged client (CLAUDE.md).
  - The panel's people-at-once list stops at 128, and the plan says so.
  - The plan no longer says the PRO 6000 serves today: its Farm app has been stopped since 2026-10-07 20:46.
  - The 7e.2 button text is quoted whole, and shell/README says LOL Vibe throughout.
  - Farm tests 209/209.

## 2026-10-08 (05:25) — vLLM run by the farm: French Windows without WSL gets the right sentence

The polish's own verifier found a regression. The "WSL is not installed" test expected a straight apostrophe.
French Windows' message ("Le Sous-système Windows pour Linux n’est pas installé…", KernelBase.dll.mui) has a
typographic one. The text then fell through to "no answer", so a French PC without WSL queued its start, fell back,
and was told to restart the computer, which never helps.
- **The test** now accepts both apostrophes. A test with Windows' real sentence fails with the old one.
- **The "no answer" sentence** no longer says "within a minute". It also covers errors that come back at once:
  "WSL did not answer. Restart the computer, then press Check again."
- **The unknown-size note:** a model added by its name has no size in the list (the text said "until it is
  downloaded").
- **Tests:** farm 209/209; with the old test put back, 208/1.

## 2026-10-08 (04:53) — vLLM run by the farm: the leftovers verifier's six minors

The verifier of the leftovers (verdict ok on d37164a) listed six small things. Each is fixed on the `vllm-managed`
branch with a test that fails when the fix is taken out: checked in a scratch copy of the tree, one fix reverted at
a time.

- **The plan's boot rule.** [VLLM_MANAGED_PLAN.md](archive/plans/VLLM_MANAGED_PLAN.md) §5, "Boot, step 0c-ter" b), still said
  "on timeout or error → unavailable". It now gives d37164a's rule: no answer at all queues the start, which checks
  again once the farm is up; a GPU too small is an answer. Test: the decisions test reads that step in the plan.
- **WSL not ready at log on.** When `wsl -l -v` failed without a list, the farm read it as "WSL has no Ubuntu yet".
  That counts as an answer, so a slow log on served Ollama for the whole run. Now `vllm.wslAnswer` says "no
  distribution" only when WSL says so: its English or French words (read from this computer's wsl.exe), or its
  error code `WSL_E_DEFAULT_DISTRO_NOT_FOUND`, which is the same in every language, where WSL prints it. Any other
  failure is no answer, and the start is queued. WSL's "no distribution with that name" is not counted. The limit: a
  computer in another language whose WSL prints no code reads as no answer, so its queued start checks again and then
  says WSL did not answer; its words get added when one is met (a `ponytail:` note says so). Test: the decisions
  test, with eleven of wsl.exe's answers.
- **A model added by its name** has no size in the list. `gpuFit` counted it as 0 GB, so adding one made
  a 16 GB card "fit": Install was offered, then the start failed. Now such a model is left out when the farm looks
  for the smallest one. With no size known at all, the answer is unknown and nothing is said. Test: the checklist
  test, an RTX 4080 with a model added by its name.
- **nvidia-smi slow at boot.** The farm read the GPU Windows sees once, at boot. A miss said "No NVIDIA GPU" (and hid
  "too small") for the whole run. Now `checkVllm` (Check again, and every start) reads it again while its name is
  missing (`vllm.hostGpuOf`). Test: the checklist corrects itself once the GPU is read, and `checkVllm` has the line.
- **`test_scripts.sh` `timelimit`** counted every `sleep 300` on the computer as this download's `hf`. Now it counts
  only a `sleep 300` with this test's root in its environment, as lifecycle step 21 does. The test also starts another
  program's `sleep 300` beside the download. Under WSL, the old check fails with that sleep running and the new one
  passes. With the time limit's group stop taken out of vllm.js, the new check still fails, on `hf` alone.
- **The fallback line** said "vLLM's log below says more" even when vLLM never ran: the boot's check, a start that
  stopped at its check, another program on the port. Now the farm says whether vLLM ran (`bootErrorRan`: a start
  that reached vLLM, or a crash while it served). The panel names the log only then. Otherwise it says "the
  checklist on the vLLM card below says what is missing" when the checklist lists a problem, and names nothing when
  it does not. Tests: the panel test (three cases, and the farm's wiring). Lifecycle steps 5, 16 and 20 check the
  flag on a real farm.

Tests: farm `node test/run.js` 209 passed (the new checks sit in existing tests); `litellm-cancel.js` PASS;
`LOL_VLLM_FAKE=1 node test/vllm-lifecycle.js` 161 passed, 0 failed (three checks now also read the flag);
`test_scripts.sh` under WSL Ubuntu 112 passed, 0 failed; farm-app `npm test` 8 passed, `npm run build` clean. The
other five fixes, each reverted alone in the scratch copy: run.js 208 passed, 1 failed (the decisions test for the
plan and WSL, the checklist test for the size and the GPU, the panel test for the line).

## 2026-10-08 (03:57) — vLLM run by the farm: the reviews' leftovers, the live test's two notes, the DGX Spark path, small RTX cards

The fix pass (00:49) read the two reviews' 24 findings cut at 9,000 characters each. Every one was read again in
full and checked against the code at 8efc9fd, on the `vllm-managed` branch ([VLLM_MANAGED_PLAN.md](archive/plans/VLLM_MANAGED_PLAN.md),
Build status, "Review leftovers", and §11.6). The owner's priority (2026-10-07): the farm on every OS, Windows with
RTX cards and the DGX Spark first.

- **Fixed by the fix pass, checked again at 8efc9fd:** two engines after a take-over (panel review 1); the switch
  doc's eaten backslashes (panel 2, lifecycle 5: no control byte left); the C compiler (panel 3); the vLLM button as
  the take-over, no External button on the farm's own vLLM, the GPU-share sentence (panel 4); the Farm app's Quit and
  Stop (panel 5, lifecycle 8); document reading's model beside vLLM only (panel 6); Download only once vLLM is
  installed (panel 7); `lol down` and an operator's vLLM (lifecycle 1); another program on the port (lifecycle 2);
  pid files per folder (lifecycle 3); the disk (lifecycle 4); no Ollama beside a vLLM that did not stop (lifecycle
  6); the watch during other jobs (lifecycle 7).
- **Still open, fixed now:**
  - **WSL with no answer at boot** (panel 9). The fix pass asked twice, then served Ollama for the whole run. Now the
    start is queued: it checks again once the farm is up, and falls back only if that check fails too. A GPU too
    small is an answer, not a silence.
  - **A start that meets a vLLM already running as it should** (lifecycle 10). It stopped it to start the same thing
    (2 minutes nobody can chat). Now a start keeps one that runs with these settings, is ready and answers; a hung
    one, or one whose port is dead, is still started again.
  - **Ollama during a start found in progress** (lifecycle 11): the boot's wait and a take-over of a vLLM still
    starting now evict Ollama's loaded models too.
  - **Automatic memory right after a stop** (lifecycle 12): sized once the free memory stops rising
    (`systemInfo.untilSteady`, which llama.cpp's sizing now shares). The lag itself was not measured here.
  - **`lol down` racing the farm** (lifecycle 9). The runtime file `lol down` removed is never written back; a proxy
    bounce that lands after it stops the farm, and so does a vLLM that stops once it is gone. Nothing starts vLLM
    or loads Ollama while the farm stops (the Apply's way back to its old settings could have).
  - **An install or a download at its 6-hour limit** (lifecycle 13). Inside WSL, killing wsl.exe already ended
    install.sh and hf (seen here). On native Linux, the farm's own code run under WSL's Linux left hf and tee
    downloading, unrecorded, and the next Download would have run a second one into the same folder. Now the time
    limit stops install.sh's whole process group first.
  - **Windows wording** (panel 10): a PC whose Windows sees no NVIDIA GPU is told so, not to install WSL or a driver.
    The vLLM card opened by a press now has Close (it stayed open in the browser for good).
  - **Sentences** (panel 8): the Apply row no longer says people at once always apply in seconds (48 → 80 restarts
    vLLM); the Farm app's Stop says a vLLM farm takes about 2 minutes to start again.
  - **The lifecycle test's last check** (panel 11) ignores the vLLMs other test runs start (`/tmp/lol-as-*`,
    `~/lol-fake-*`). Both full runs below had `test_scripts.sh` running beside them, and passed.
- **The live test's two notes.**
  - The fallback reason now reads "vLLM stopped working twice in 5 minutes (the second time, it shut down by
    itself)."; the status goes to the farm's log. The panel no longer puts "vLLM could not start:" in front of it.
  - The download meter: its text says "… GB on disk so far (files are written in large pieces, so this number
    jumps)", and a download's bar always shows how long it has run.
- **Smaller RTX cards on Windows** (the studio's 4070 12 GB and 4080 16 GB).
  - Before, a card counted as too small under the smallest model's weights + 6 GB, and only once WSL answered: a
    4070 without WSL was first told to install WSL, and a 24 GB card passed and then failed at its start.
  - Now `vllm.gpuFit` asks what the smallest model needs on an empty card, with document reading's 9 GB while that
    is on: about 35 GB with it, 25 GB without. On Windows it uses the size Windows sees, before anything about WSL.
  - The vLLM button says it before any check: "Not for this GPU (12 GB; vLLM's models need about 35 GB): llama.cpp
    or Ollama is the engine for it." No Install, no Download, and a switch is refused.
  - A 32 GB card fits only with document reading off, and the checklist says so.
- **The DGX Spark path, read, not run.**
  - What holds: `install.sh` is the spike's install that ran on the Spark (uv's own Python 3.12, so the headers
    Triton needs; vLLM 0.30.0 with the matching torch; the CUDA compiler pins).
  - `status.sh`'s GPU line with no memory numbers reads as unified memory, sized from `MemAvailable`, with the 8 GB
    guard, 4 compile jobs and the 27 GiB cap.
  - The clock watch runs whatever the engine. The AppImage carries `farm/vllm`, its scripts LF and run through bash.
  - What was wrong: the time limit above (Linux only), and nothing told a headless Spark that after a take-over vLLM
    starts with the farm, which the Farm app does at a desktop log-in. The take-over now says it on Linux before
    the click.
  - What only a real Spark can confirm: the plan's §11.6, ten checks for the owner.
- **Left.**
  - LOL Vibe's own text for a farm that is starting ("Try again in a few seconds") is the client's, unchanged here.
  - §11.6 on a Spark; §11.5 and §9.6 with the owner; the production Farm app, down since 2026-10-07 20:46, needs
    opening again.
- **Tests.**
  - farm `node test/run.js`: **209** passed (206).
  - `farm/vllm/test_scripts.sh` (WSL): **112/112** (110). New: `timelimit`.
  - Lifecycle `LOL_VLLM_FAKE=1 node test/vllm-lifecycle.js`: **161 passed, 0 failed** over 23 steps, twice. The
    second run is on the final code. New steps: 21, the time limit; 22, a start found in progress; 23, `lol down`
    racing the farm.
  - Farm app `npm test`: 8, and `npm run build`. LiteLLM 1.97 `test/litellm-cancel.js`: PASS. The shell is unchanged.
  - Every fix reverted, alone, fails its test: 15 unit reverts and 5 lifecycle ones. The time limit's revert passes
    the lifecycle step on Windows, where WSL ends the tree anyway, and fails `timelimit` on Linux.
- **Production untouched.** Its vLLM answered on 8100 as process group 401, serve.sh its leader, with no marker in
  `~/lol-spike/run`. The test used ports 4300-4302, 41897 and 8299, `~/lol-fake-a`, `/tmp/lol-as-*` and
  `/tmp/lol-leftover-root` (removed).

## 2026-10-08 (03:10) — The search-model repair, checked end to end twice: a closed LAN, a damaged cache, a proxy

Two end-to-end runs with the real Open WebUI 0.11.4 sidecar (`scratchpad/final/`, `scratchpad/recheck/`)
checked the 02:02 fix; each found something, fixed in `f130806` and this commit.
- **A closed LAN held Open WebUI's start for minutes.**
  - The case: MiniLM not on disk (half-downloaded and repaired, or a fresh install) and huggingface.co silent.
    The hub's per-file retries (5 per file, each up to the system's connect timeout) took 123 s when the
    connection was refused and 466 s when it was dropped, both past the app's 180 s wait, so the chat never opened.
    v0.2.8 started in ~30 s there.
  - The fix: `sidecar.ts` asks huggingface.co once (a 3 s HEAD) while MiniLM is not on disk. Without an answer,
    that launch alone gets `HF_HUB_OFFLINE=1`.
  - Re-measured: healthy at 11.9 s (refused) and 14.9 s (dropped). Uploads wait for a start with the network,
    and the next online start downloads the model (21.6–23.4 s).
- **The repair deleted a whole model damaged only by a dangling link.**
  - That cache came from hub 1.33's whole-repository download. With the snapshot deleted, the model could not load
    offline.
  - The fix: `repairMiniLm` first removes the hub's file list and the dangling link. The snapshots go only if the
    model is still half-downloaded.
  - Re-measured: kept, healthy at 11.3–11.6 s offline, upload OK.
- **A proxy-only network would never have downloaded MiniLM.**
  - Node's fetch ignores proxies; the hub's httpx uses the environment and the system proxy. So the first probe
    always said "no answer" there.
  - The fix: the probe now uses Electron's `net.fetch`, which uses the system proxy, and is skipped when a proxy
    is set in the environment.
  - Checked in a real Electron 42 main process: huggingface.co answered 200 in 194 ms; a dropped address gave up
    at 3.0 s and a refused one at 2.0 s.
- **The person is told.** After an offline start, a toast explains that document uploads need one start with
  internet access, and that chat works meanwhile.
- **A healthy cache:** no probe, nothing removed (re-check case 3).
- **Tests:** shell chat-unit 1839/0 (hubAnswers against local servers and through an injected fetch, envProxy, the
  gentle repair), unit 29, lint 0, asar-probe OK.

## 2026-10-08 (02:24) — vLLM run by the farm: the live test on the PRO 6000, beside production

The plan's §11.4 ([VLLM_MANAGED_PLAN.md](archive/plans/VLLM_MANAGED_PLAN.md)), on the `vllm-managed` branch, from 01:00 to 02:07: a
real vLLM 0.30.0 with a tiny model (Qwen/Qwen3-0.6B), run by a scratch farm from the worktree, beside the production
farm, and driven through the admin API the panel calls, as an operator would. Every step passes in the end: step 1
after a fix (the bug below, 05cf321), steps 5, 9 and 10 after a correction to the test driver itself.

- **The setup.**
  - The scratch farm: the gate on 4300 and LiteLLM 1.97 on 4301, the panel on 41897, 127.0.0.1 only, beacon and
    every plugin off, a fake Ollama on 4302.
  - Its vLLM: the folder `/home/ateliernum/lol-test`, whose `.venv` is a link to production's (`~/lol-spike/.venv`,
    so no install), port 8199, 4 people, 8k of context, 2 GiB for conversations.
  - Before every step, three guards: 8100 lists Qwen3.6, `~/lol-spike/run/vllm.pgid` is 401 with serve.sh its
    leader, and the GPU has 12 GiB free. They held at every step; the lowest was 14.6 GiB free.
- **The steps**, with what the panel said:
  1. **Add a model** "Qwen/Qwen3-0.6B": in the list. **Download**: 1.5 GB in 169 s, in the download slot. The bar
     said "checking this computer", then "downloading Qwen3-0.6B — n GB", then "Qwen3-0.6B is downloaded.".
     - It ended before its meter showed half. So the stop was tried on a second download, after deleting the folder.
     - **Stop** at 82 s: stopped, and the list said partly downloaded.
     - **Download again**: done in 126 s, but the list still said partly downloaded. That is the bug below.
     - After the fix, Download again: 1.1 s (the files were already whole), the stopped attempt's file gone, and
       the list says downloaded (1.5 GB).
  2. **The scratch farm** answered 7.1 s after `lol up`, serving the fake Ollama.
  3. **Check this computer** (0.2 s) listed:
     - "WSL is installed, with Ubuntu on WSL 2.";
     - "Ubuntu sees the GPU: NVIDIA RTX PRO 6000 Blackwell Workstation Edition (96 GB).";
     - "vLLM 0.30.0 is installed (in /home/ateliernum/lol-test).", found through the link;
     - "153 GB free for vLLM and its models.".
     No problem, no warning.
  4. **Switch to vLLM**: ready in 160 s. This was the model's first start, so its kernels compiled.
     - The panel's line: "starting vLLM" (1 s), "reading the model" (16 s), "loading the model weights (1 of 1)"
       (25 s), "preparing the GPU (the first start takes a few minutes longer)" (28 s), "capturing GPU graphs"
       (119 s).
     - The farm said healthy at every sample.
     - A chat through the gate: "The capital of France is Paris.".
     - The Performance card showed 4 slots and 18,720 tokens of conversation memory. Clients saw 4 seats of 8k.
     - The memory warning said what is true at 2 GiB: "The memory for conversations holds 2 people at 8k, fewer than
       the 4 this farm lets in at once: past 2, people wait. …".
     - GPU free: 19.3 GiB before, 14.9 GiB after.
  5. **`lol up` killed alone** (taskkill /F, no /T).
     - vLLM kept serving: chats on 8199 60 s and 5 min later, the same process group.
     - The next `lol up` kept it in 5.1 s: ready, no job.
     - The first run's direct chats got 404 because the test driver named the farm's model name, not vLLM's own.
       The step was run again.
     - **Measured (R1)**: killed WITH /T, the wsl.exe goes and vLLM with it, cleanly. serve.sh got a hang-up and
       stopped vLLM within 2 s ("vLLM exited (status 129)"), and the GPU was freed. The next `lol up` started it
       again, ready in about 25 s. An outside tree-kill costs one normal start, as the design assumed.
  6. **Apply.** The dry runs said a name keeps vLLM running and a context restarts it.
     - The name "tiny-live": 5.1 s, the same process, and clients see the new name.
     - 16k of context: one restart in 48 s ("Applied in one restart of vLLM: 16k of context each."). Healthy
       throughout, and saved for the next start.
  7. **`kill -9` of the test's EngineCore**, found by its process group (never 401).
     - Seen in 3 s; one restart; ready 21 s after the kill.
     - Again within 5 minutes: after 12 s Ollama (the fake) served under vLLM's name.
     - The panel said "vLLM stopped twice in 5 minutes (the second time, its process ended (status 0)).".
     - No vLLM was left, and the file still says vLLM.
  8. **Boot, Stop, Start, `lol down`.**
     - Boot: the panel answered after 5 s, healthy, with "Starting vLLM". A chat meanwhile got a 503 "This farm's
       model is starting: about 2 minutes. Try again then.". Ready 24 s after `lol up`.
     - **Stop**: 4 s. Nothing ran and the farm said unhealthy. A chat got "This farm's model is stopped for now. Try
       again later.".
     - **Start**: ready in 22 s.
     - **`lol down`**: 9 s. Nothing was left, the runtime file was gone, and the GPU was back to 19.2 GiB free
       (19.3 at the start).
  9. **The take-over rehearsal.**
     - The test server was started the operator's way: a hidden wsl.exe running serve.sh, with no farm arguments,
       from a copy of farm/vllm in a folder named "LlmOnLan Farm". It had LOL_VLLM_MODEL, and the tiny model's
       arguments after serve.sh's own Qwen3.6 defaults: the last one wins, in vLLM and in the farm's reading. It
       answered after 39 s.
     - The scratch farm then routed to it as its external server, and offered "Let the farm run vLLM" at once.
     - The click took 0.4 s: "The farm now runs vLLM. Nothing was restarted. If this computer started vLLM at log
       on before, that now only opens the Farm app.".
       - The same process group and the same LiteLLM process.
       - The marker was written.
       - The file was rewritten: the vllm block in, with what the server runs; the external block out; a backup
         of the old file beside it.
       - Chats kept working under the same name.
     - The old log-on script, `start-windows.ps1`, run against that folder (whoami.exe stood in for the Farm app):
       - on vLLM's port, it found vLLM answering, and serve.sh logged "The LlmOnLan farm runs this vLLM now (its
         panel starts and stops it): this start does nothing.";
       - on another port, serve.sh did nothing, and the script said "The farm runs vLLM now: opening the Farm app,
         which starts it.".
     - **Undo**: "Back as before: the farm routes to vLLM without running it.". The file came back byte for byte;
       the backup and the marker were gone; the same server.
     - `lol down` then left the operator's vLLM running.
     - Before this, the marker left by steps 4-8 was removed by hand: `lol down` leaves it by design (R12). A first
       try at 01:40, with the marker still there, found serve.sh doing nothing, as it should.
  10. **A16, the Farm app's code refresh over a running server.**
      - `fs.cpSync`, with the Farm app's own options, copied a fresh farm/vllm (each script one line longer) over
        the folder that server's serve.sh (open in bash) and relay.py came from.
      - 91 ms, no error, and Linux saw the new bytes. The server kept serving: the same group, a chat.
      - At the cleanup, that serve.sh still stopped cleanly.
      - A first try copied identical files and could not show the rewrite: Windows keeps a copied file's time.
  11. **Cleanup.**
      - stop.sh of the test folder; nothing left running from it.
      - `rm -rf /home/ateliernum/lol-test` removed the link only: the vLLM in `~/lol-spike/.venv` is intact.
      - The fake Ollama, the copy and the scratch farm are gone, and no test port answers.
- **The bug, fixed in 05cf321: a stopped model download left the model "partly downloaded" for ever.**
  - huggingface_hub 1.33 (the vLLM venv's) writes each file to a temporary file of its own attempt. It removes that
    file only when that attempt ends by itself.
  - A Stop left the file. No later attempt reused it, and status.sh counted it. Switching to vLLM was then refused
    ("only partly downloaded: press Download to finish it"), with no way out.
  - Now install.sh clears those files once a download ends.
  - The fake hf no longer clears them itself: that hid the bug. test_scripts.sh checks Stop, then Download again.
  - The panel no longer promises that a stopped download continues where it left off. It says what is true: the
    files it finished are kept.
- **Seen, not changed:**
  - The download meter lags. hf_xet keeps much of a file in memory before writing it. In the second download the
    meter (the folder on disk) said 0.02 GB for the first 80 s, and the first download ended with the meter at
    0.39 GB of 1.5 GB. The meter is true to the disk, but the bar sits low, then jumps.
  - The fallback's reason, "(the second time, its process ended (status 0))", is not plain words for an operator.
  - The test left about 137 MB in the shared Linux caches: three compile entries for the tiny model.
    - `~/.cache/vllm`: 127 MB. `~/.cache/flashinfer`: 7 MB. `~/.triton`: 3 MB. `~/.cache/huggingface`: 1 MB.
    - They are keyed by model and harmless. They are left in place: production's own entries live in the same
      folders, and telling the two apart is not certain.
- **Tests on the branch after the fix:**
  - farm `node test/run.js`: 206 passed;
  - `farm/vllm/test_scripts.sh` (WSL): 110/110 (108 before; the new ones are Stop, then Download again);
  - lifecycle `LOL_VLLM_FAKE=1 node test/vllm-lifecycle.js`: 153 passed, 0 failed (all 20 steps).
- **Production untouched.**
  - The production Farm app (its gate on 4000, its panel on 41997) has been stopped since 2026-10-07 20:46:13, before
    this test began (slice B's entry: its farm.log ends with no shutdown line). This test never started it: the
    guard on 4000 compared with that.
  - Production's vLLM answered on 8100 at every guard, as process group 401 with serve.sh its leader.
    `~/lol-spike/run` is unchanged since 2026-10-07 17:45, with no marker.
  - The "LlmOnLan vLLM" task is Ready, last run 2026-10-07 17:45:37. `%APPDATA%\LlmOnLan Farm` is unchanged.
  - At the end, Qwen3.6 on 8100 answered "The capital of France is Paris.". nvidia-smi showed 76,624 MiB used and
    19,965 MiB free of 97,887 (19,721 free at the start).
- **Left:**
  - the production Farm app, down since 20:46, needs opening again;
  - §11.5 / §9.6 with the owner: a Farm app release, then the production take-over (PRO6000_VLLM_SWITCH Part 2),
    and a reboot test.

## 2026-10-08 (02:02) — Gemma embeddings, studied: not now. And a half-downloaded search model no longer breaks uploads

**Question.** The owner asked whether Gemma embeddings could be interesting for us. A workflow answered it: the
models as of October 2026, how Open WebUI 0.11.4 and LlmOnLan use embeddings, a CPU measurement on this box with
French retrieval sets, a recommendation, and a critic who re-measured. The result is in `docs/archive/plans/EMBEDDINGS_STUDY.md`.
- **"Gemma 2 embeddings" is EmbeddingGemma 2, released by Google on 6 October 2026.** Open WebUI 0.11.4 pins
  transformers 5.5.4 and sentence-transformers 5.5.1, and the model needs newer versions, so it can't run in the
  sidecar until Open WebUI raises those pins. On French it is no better than the first EmbeddingGemma.
- **Recommendation: no change now.** On the studio farm (64k per person) Open WebUI reads attached files whole, so the
  search model barely matters. A switch costs every laptop a download, slower uploads and a Reindex click.
- **When to revisit:** French knowledge bases in real use, or a farm with less than 24k per person serving French
  users. Then switch to IBM granite-97m first: French 0.73 against MiniLM's 0.44, 211 MB, about 2× MiniLM's time.
  EmbeddingGemma 300M scores 0.79 but costs 1.27 GB and about 9× the time.
- **Decision:** the owner's.

**The bug the study found, fixed before v0.2.9.**
- **The cause.** Since 2026-10-07 (`0b69dd0`) Open WebUI never asks huggingface.co for updates. In that mode
  huggingface_hub hands back whatever snapshot `refs/main` names, even a half one. So a first MiniLM download cut off
  half-way failed to load at every boot after ("no file named model.safetensors"), and every upload failed.
  `hfModelsCached` also counted any non-empty folder as cached. Reproduced with the bundled sidecar.
- **A first fix was rejected by its own end-to-end check.** It turned Open WebUI's update back on for a half model.
  That fetched the whole repository (0.94 GB, once 196 s, past the app's 180 s start wait). With hub 1.33's shared
  blobs it also left one of MiniLM's three identical onnx files as a dangling link, and the hub's file list then
  refused the snapshot. The next start with huggingface.co unreachable took 305 s, or never finished.
- **The fix** (`configBridge.ts`, `sidecar.ts`):
  - `hfModelState` judges a model as huggingface_hub does. It follows `refs/main`; each file the loader needs must be
    there (MiniLM: modules, config, sentence_bert_config, pooling, tokenizer.json or vocab.txt, the weights;
    Whisper: config, model.bin, tokenizer, vocabulary). A dangling link counts as damage.
  - `repairMiniLm()` runs before each Open WebUI start. It removes a half or damaged MiniLM's snapshots and the hub's
    file list, never the downloaded bytes, and keeps update checks off. Open WebUI's loader then fetches the 11 files
    it needs, measured at about 92 MB and healthy at 22.6 s, then offline-proof (11.6 s with the network dropped).
  - Whisper's vocabulary is now required, so a half Whisper no longer turns the hub offline and leaves speech to
    text broken.
- **Tests:**
  - shell chat-unit 1838/0 (two new tests: the exact cut-off state, a leave-one-out over every needed file written
    from the measurement, refs/main cases, a dangling link, the repair keeping the bytes); unit 29; lint 0.
  - A mutation run on the built code: all 9 mutants caught (each needed file, both "either one" pairs, the
    dangling-link check).
  - The rejected first fix was measured end to end with the real sidecar (cases A–L, `scratchpad/halfdl/`); the
    adopted repair was measured there too (case G). The end-to-end runs of the final code are in the next entry.

## 2026-10-08 (00:49) — vLLM run by the farm: the review fixes

Two reviews of slices A-D (lifecycle and safety; panel and compatibility) found two blockers, seven majors and
about a dozen minors. Every blocker and major is fixed, and the minors that were cheap and certain. On the
`vllm-managed` branch ([VLLM_MANAGED_PLAN.md](archive/plans/VLLM_MANAGED_PLAN.md), Build status, "Review fixes").

- **`lol down` could stop a vLLM the farm does not run** (blocker).
  - The case: production before the take-over. A Download from the vLLM card wrote the operator's folder into the
    runtime file, and left it there after the download ended. The Farm app's Quit or Stop then runs `lol down`,
    which stopped production's vLLM.
  - Now the runtime file says whether the farm serves with that vLLM (`serving`), and forgets the folder once a
    download ends. `lol down` stops a running vLLM only when it is the farm's own: the one it serves with, or one
    carrying its marker. Otherwise it stops the download only.
- **Two engines on one GPU after a take-over** (blocker).
  - The case: a farm that served llama.cpp before an operator's vLLM keeps `llamacpp.enabled` in its file. After
    "Let the farm run vLLM", its next start started llama-server beside vLLM.
  - Now the take-over writes llama.cpp off, every "llama.cpp serves" test asks `engineOf`, and a file with both on
    serves vLLM, llama.cpp standing down.
- **Another program's server taken for vLLM** (major).
  - A start counted as ready as soon as anything answered on vLLM's port. Another vLLM there would have answered
    chats with its own model while the farm said healthy.
  - Now a start refuses when something already answers there ("Another program uses port 8100, maybe a vLLM
    started outside the farm…"). It counts only once `serve.sh` logged its own server ready, or `status.sh` says so.
- **A stale pid file naming another folder's server** (major). WSL hands out the same low pids at every boot, so a
  `run/vllm.pgid` left in one folder could name another folder's live server, which `stop.sh` would then stop.
  `stop.sh`, `status.sh`, `serve.sh` and `install.sh` now own a pid file only when its leader runs from their folder.
- **Disk** (major). Install, Update and Download check the free disk first, and leave 10 GB free beside what they
  fetch: on Windows, WSL's disk grows on drive C: and never gives the space back.
- **A C compiler** (major).
  - vLLM builds a small GPU launcher with the system's C compiler at every start, and a fresh Ubuntu in WSL has none.
    The start would fail with a Python error nobody can act on.
  - The check of this computer now lists it ("vLLM needs a C compiler to prepare the GPU … run  sudo apt install
    build-essential"), and Install is not offered without it.
  - Not tried on a fresh distribution: that would add one to this box's WSL. The check reads `status.sh`'s new
    `cc=` line, tested here.
- **The production switch doc** (major). Part 2 of PRO6000_VLLM_SWITCH.md had lost its Windows paths' backslashes:
  form feed and vertical tab bytes, in the rollback command too. Put back, and a test now refuses control characters
  in every doc.
- **Minors.**
  - Ollama never loads beside a vLLM that did not stop. A fallback stops vLLM first; when that fails, the farm stays
    on vLLM, stopped and unhealthy, and says why.
  - At boot:
    - a server running with these settings is kept even when the check lists a problem;
    - WSL is asked twice before the farm gives up on it;
    - the farm's own server that cannot serve as it is is stopped before Ollama serves.
  - The watch keeps looking during the panel's other jobs (an Ollama download, a password). A vLLM that dies then
    is seen at once (10 s in the test), and the farm says it is unhealthy; its restart follows the download.
  - On a farm like production's:
    - the vLLM button IS the take-over, with nothing restarted;
    - the External button never points at the vLLM the farm runs;
    - leaving an external server on this computer always says it keeps its share of the GPU.
  - Document reading prefers gemma4:12b only beside vLLM; a llama.cpp farm keeps its own choice.
  - Download shows only once vLLM is installed; one asked earlier says "press Install vLLM first". Install is not
    offered on a GPU too small for any model of the list.
  - The panel's starting line names what clients see: "Switching to vLLM" during a switch, "Applying the farm
    settings" during an Apply. An unplanned restart says clients see a problem and may move to another farm.
  - The Farm app:
    - Quit and Stop run `lol down` whenever a farm ran since the last stop (a crash loop leaves neither a child nor
      a runtime file);
    - meanwhile the window stays up and says "Stopping the farm… With vLLM this can take a minute, while it frees
      the GPU.", and Start waits;
    - a second launch meanwhile no longer touches a destroyed window.
- **Tests.**
  - farm `node test/run.js`: **206** passed (204 before). Two new tests: a start waits for its own server, and the
    docs' bytes. New checks in the checklist, decisions, take-over file, download slot, OCR and panel tests.
  - `farm/vllm/test_scripts.sh` (WSL): **108/108** (98 before): another folder's stale pid files, `cc=`,
    `noinstall`.
  - Farm app `npm test`: **8** passed (6 before).
  - Lifecycle, `LOL_VLLM_FAKE=1 node test/vllm-lifecycle.js`: **153 passed, 0 failed** in one run of all 20 steps.
    The six new steps:
    - 15: `lol down` never stops an operator's vLLM (during a download, and after it);
    - 16: another program on vLLM's port;
    - 17: vLLM and llama.cpp both on;
    - 18: a vLLM that dies during an Ollama download;
    - 19: a fallback whose stop fails;
    - 20: the farm's own vLLM that cannot serve at boot.
  - Every new test fails with its fix reverted, in scratch copies: 19 farm, 4 Farm app, 5 script and 6 lifecycle
    reverts. Two lifecycle steps fail by their own wait timing out. With the fix reverted, the farm said "vLLM is
    ready on :8299" while another program held the port (step 16), and served Ollama beside a vLLM that did not
    stop (step 19).
  - Unchanged and green: LiteLLM 1.97 `test/litellm-cancel.js` PASS. The shell is not changed.
- **Production untouched.** The runs used ports 4300-4302, 41897 and 8299, `~/lol-fake-a` (removed after),
  `/tmp/lol-as-*` and scratch folders. Production's vLLM still answers on 8100 as process group 401, and
  `~/lol-spike` has no marker. Its leader's environment names `~/lol-spike` as its folder, so the new ownership check
  keeps recognising it.
- **Not received whole:** the last finding of each review reached this slice cut off. The lifecycle review's last
  "minor" had no text. The panel review's "sentences that are not true in every case" stopped after its first
  example, which is fixed.
- **Left:**
  - the live test with a real vLLM (§11.4);
  - a Farm app release;
  - then the production take-over with the owner (PRO6000_VLLM_SWITCH Part 2).

## 2026-10-07 (23:09) — vLLM run by the farm, slice D: "Let the farm run vLLM", the Farm app's stops, Linux autostart, the docs

The plan's §12 item 7, on the `vllm-managed` branch ([VLLM_MANAGED_PLAN.md](archive/plans/VLLM_MANAGED_PLAN.md), Build status). With
it, the production farm can move from its operator-run vLLM to the farm's own with one click, and back.

- **The take-over (§9).**
  - A farm whose engine is an external server on this computer, a vLLM started from `farm/vllm`, now shows the card
    "vLLM on this computer" with **Let the farm run vLLM**. The farm looks once it is up and at Check again, never
    during its boot. It never takes over by itself (the owner's question (a)).
  - The click keeps the same model, name and settings, and restarts nothing. vLLM is the same process, and LiteLLM
    is not restarted, because the routing is the same apart from its key.
  - The file: a copy (`lol.config.json.before-managed-vllm`), then the `vllm` block in and the `external` block out.
    The block holds the folder, the port, the name, the declared context and people, the memory and request cap
    the server runs with, and its other flags in `extraArgs`.
  - `serve.sh`'s marker goes in the server's folder, so the old log-on task and `lol-vllm.service` do nothing
    from then on. No task or unit is changed.
  - It is offered only when the farm can keep the server exactly as it runs (`adoptable` is checked on the block it
    would write). Not, for instance, a server with `--api-key`, or one missing a flag the farm would add.
  - With nothing running but the model in the folder, it is offered too, and the farm starts vLLM, as a boot does.
  - **Undo** stays on the card until a setting changes or the farm restarts: the copy back byte for byte, the
    marker removed, vLLM still running.
- **The Farm app (§3.12, §3.13).**
  - Quit and Stop run `lol down` first, which stops vLLM too, then tree-kill `lol up` as a backstop.
  - The **Share compute with the network** switch keeps vLLM running: only `lol up`'s own pid is killed, never its
    tree, and the next `lol up` keeps vLLM.
  - A crash restart reaps the dead run's recorded processes first. On Windows its LiteLLM outlived it and made every
    restart fail with "Farm already running". `reapStaleFarm` now also reaps llama-server, Classify, speech to text
    and the bus, and still never stops vLLM.
  - Launch at login works on Linux: an XDG autostart entry for the AppImage.
- **Docs.**
  - farm/README:
    - a new "vLLM, run by the farm" section: where it runs, install, models, switching, settings, start and stop,
      document reading, files and log, the take-over, at login;
    - the general vLLM notes moved under it: the relay, thinking, LiteLLM's cost, replies that never end;
    - the recipe is now "External: a vLLM you run yourself", trimmed;
    - the `vllm` and `external` config keys, `lol up`'s order, the admin routes.
  - docs/archive/PRO6000_VLLM_SWITCH.md Part 2: the steps, the checks, Undo, the rollback by hand, and the downgrade warning
    (farm-v0.0.42 refuses a file with a `vllm` block).
  - CLAUDE.md: four engines, and the 2026-09-07 rule replaced. Also the multiuser plan's Phase 2 status.
  - The owner's four questions keep their defaults:
    - (a) one click by a person;
    - (b) Stop vLLM does not survive a farm restart;
    - (c) an unmeasured pair says so, with Plan capacity;
    - (d) WSL from written instructions.
- **Tests.**
  - farm `node test/run.js`: **204** passed (200 before). Four new tests:
    - the golden take-over from production's real `serve.sh` argv and external block (the routing the same apart
      from its key) and the Spark unit;
    - what a take-over keeps, and when it offers nothing;
    - the file (§11.1-15);
    - the panel's result card with Undo.
    The D10 check and the routes test now cover the take-over too.
  - Farm app: `npm run build` OK, and a new `farm-app/test/supervisor.test.js` (`npm test`): **6** passed (§11.1-19).
    It drives the compiled supervisor with stubs and checks `lol down` before the tree-kill, `keepEngine`, the reap
    before a crash restart, a `reapStaleFarm` that runs no `lol down`, and the autostart entry's quoting.
  - Lifecycle (`LOL_VLLM_FAKE=1 node test/vllm-lifecycle.js`): **135 passed, 0 failed** in one run of all 14 steps.
    - Step 13 (§11.3-12), 27 checks: a fake vLLM started the operator's way is offered, taken over (same process
      group, same LiteLLM pid, the file, the copy, the marker; `serve.sh` the old way then exits 0 and says why),
      undone byte for byte, taken over again and stopped by `lol down`. With nothing running it is offered and
      started.
    - Step 14 (§11.3-13, Windows), 21 checks: the same from a copy of the farm in `…\LlmOnLan Farm\farm`.
    - The run also checks that no other folder got the marker.
  - Every new test fails with its fix reverted: 21 reverts in scratch copies (13 farm, 8 Farm app), each failing its
    own test.
  - Unchanged and still green: LiteLLM 1.97 `test/litellm-cancel.js` PASS; `farm/vllm/test_scripts.sh` 98/98;
    shell build OK, chat-unit 1836, `test:unit` 29, chat-lint 0.
- **Production untouched.** The runs used ports 4300-4302, 41897 and 8299, `~/lol-fake-a` (removed after), and
  scratch folders. Production's vLLM still answers on 8100 as process group 401, and `~/lol-spike` has no marker
  (checked after the last run). The production Farm app has been stopped since 20:46 (slice B's entry). It was
  left as found.
- **Left:**
  - the live test with a real vLLM beside production (§11.4), with A16 (the Farm app's code refresh over a running
    `serve.sh`);
  - a Farm app release;
  - then the production take-over with the owner (PRO6000_VLLM_SWITCH Part 2).

## 2026-10-07 (22:17) — vLLM run by the farm, slice C: the panel, and everything an operator does with vLLM in it

The plan's §12 items 5-6, on the `vllm-managed` branch ([VLLM_MANAGED_PLAN.md](archive/plans/VLLM_MANAGED_PLAN.md), Build status).
The panel now offers vLLM as an engine like the others. The operator installs it, downloads models, switches to it
and back, sets it and starts or stops it there, and reads no config file or key anywhere.

- **The Backend card.**
  - The engine buttons are Ollama, llama.cpp and vLLM. "External server" appears only while the farm's file holds one
    a developer wrote, and switching away from it now works.
  - vLLM's button says what this computer has: ready, not set up yet, not checked yet, or not available. Pressed when
    not ready, it opens the vLLM card and checks this computer, without switching.
  - Every switch says what it costs before it happens: about 2 minutes into vLLM, about a minute out of it. Leaving a
    server on this computer that the farm does not run says it keeps its share of the GPU, with what is left.
  - A line says where vLLM is: starting (with its step), kept running from before, stopped, stopped by the memory
    guard, or not answering. After a start that fell back to Ollama, it gives vLLM's reason.
  - The rows under the one Apply: the name; people at once; context per person, never past what the model reads;
    GPU memory for conversations. Automatic says where its number comes from: measured on this card, what the
    memory holds, or 4 to start with.
  - The line under them gives the context each person gets and how many whole conversations the memory holds. It
    says what was measured on this card with this model, or that nothing was, with the Plan capacity link (the
    owner's question (c)). Then the clients' sentences, and a warning past what was measured or past what fits.
  - Apply on vLLM asks the farm first (a dry run) and asks the operator only when vLLM would restart.
- **The vLLM card.**
  - The checklist: ✓ what is in place, ✗ what blocks it with what to do, ⚠ what is said without blocking (an older
    card; an older vLLM, with Update vLLM). Then Check again.
  - Install vLLM, with what it downloads and how long it takes. It runs in the download slot, so the farm keeps
    serving, and it is refused while vLLM runs from that folder.
  - The model list:
    - Download, Use this and Remove, by state; Remove offers to delete the files too;
    - Add a model by its Hugging Face name or link, with its family's flags; a model of an unknown family says tools
      and thinking may not show;
    - folders found on disk, with "Add to the list".
  - Start, Stop, and vLLM's own log.
- **Two bars**, each with Stop: the job and the download. A stopped download says it continues where it left off.
- **Document reading beside vLLM:** the Performance card says when its model does not fit the 9 GB kept for it (on
  production that would be qwen3.8, 17 GB), and suggests gemma4:12b.
- **No config file or key in any text a person reads (D10).**
  - Swept: the external server's line, refusal and trade line; llama.cpp's "not available" (three places); the
    "not saved" warnings (now one helper, the reason in the farm's log); the page's sub-line.
  - A test renders the panel for every engine and vLLM phase. It also reads every string the farm can hand the
    panel, and fails on `lol.config.json`, `external.`, `binDir`, `enabled=` or `.parallel`.
- **Use this with a model that reads less than the current context per person** is refused up front, with what to
  do. vLLM would have refused to start, and the farm would have rolled back.
- **A health bug, found by the new lifecycle step and fixed** (older than this work).
  - The 10 s health tick could probe LiteLLM in the middle of a planned restart and record "down". The farm then said
    unhealthy for up to 10 s after a switch, an Apply or a model start, and clients could leave for a slower farm
    (what D5 forbids).
  - The tick now ignores a probe taken during a planned restart, and a restart that succeeds says up at once.
  - Step 12 samples `/lol/self` every 200 ms through two switches. Before the fix the farm went unhealthy in 3 runs
    of 3; after it, it stayed healthy in all 3 runs (two of step 12 alone, then the full run).
- **Tests.**
  - farm `node test/run.js`: **200** passed, from 190. The ten new tests:
    - Apply's decisions (§11.1-17: 48 → 40 people no restart, 48 → 80 a restart, a context a restart, a name none,
      Automatic → Automatic none);
    - the model list;
    - document reading's fit;
    - the panel: the engine grid, the phase lines, the vLLM card, the rows, trade line and Apply with its dry run,
      and both bars (§11.1-18);
    - the D10 check;
    - the new admin routes behind the token.
  - `farm/test/vllm-lifecycle.js` (`LOL_VLLM_FAKE=1`): **86 passed, 0 failed** in one run of all twelve steps. The new
    step 12 drives everything through the admin API with the fake vLLM:
    - a switch to Ollama and back, with the name following and the farm healthy throughout;
    - Download, then Use this, refused on a too-short window and then one restart;
    - the list's add (not twice) and remove (never the one serving; with its files);
    - the log;
    - Install refused while vLLM runs.
  - `farm/vllm/test_scripts.sh` under WSL: **98/98**. The fake `hf` now clears `.incomplete` files when it finishes, as
    the real one does.
  - LiteLLM 1.97 `test/litellm-cancel.js`: PASS. There is no shell or Farm app change in this slice.
  - Every new test fails with its fix reverted, checked in a scratch copy of `farm/`. That is twelve reverts:
    - Apply's request cap; Automatic memory worked out again; the window refusal; up.js without `applyChange`;
    - the family flags; doubles in the list;
    - the document-reading fit;
    - the slice B panel, externalRefusal, llamacpp.js and the "not saved" warning;
    - the slice B selfServer.js.
- **Production untouched.** The lifecycle runs used only ports 4300-4302, 41897 and 8299, and `~/lol-fake-a`. Each
  run read every other vLLM on the computer before and after: production's (pgid 401, :8100) was the same.
- **Left for the next slices:**
  - the take-over and Undo (the card is drawn and waits for the farm to fill `takeOver`);
  - the Farm app's supervisor (§3.12) and Linux autostart;
  - the docs: farm/README's "vLLM, run by the farm", PRO6000_VLLM_SWITCH Part 2, CLAUDE.md;
  - the live test with a real vLLM (§11.4).

## 2026-10-07 (21:12) — vLLM run by the farm, slice B: the farm starts, watches, restarts and stops it

The plan's §12 item 4, on the `vllm-managed` branch ([VLLM_MANAGED_PLAN.md](archive/plans/VLLM_MANAGED_PLAN.md), Build status).
A farm whose engine is vLLM now runs it: no panel for it yet (slice 5), but every behaviour below runs and was
tested end to end against a fake vLLM.

- **The boot never waits for vLLM.**
  - The proxy, gate, panel and beacon come up in seconds: the panel answered after 5.1 s in the test, LiteLLM's own
    start included.
  - vLLM then starts as the job "Starting vLLM". Meanwhile the farm stays healthy and says busy, so clients keep
    it, and the gate answers a chat with a 503: "This farm's model is starting: about 2 minutes. Try again then."
  - A vLLM already running with these settings is kept at once, with no job (a crashed `lol up`, a Farm app
    restart). One starting is waited for. One with other settings is stopped and started again.
  - What blocks it (not installed, model missing, WSL) serves with Ollama, with the reason.
- **Watched.** Three missed answers in a row, 10 s each, and the farm looks before acting:
  - a server that runs and answers was only slow, so nothing happens;
  - the memory guard's stop is never undone: the farm is unhealthy until the operator presses Start;
  - otherwise ONE restart ("Restarting vLLM after it stopped unexpectedly"). A second stop within 5 minutes falls
    back to Ollama, under vLLM's name, with the reason.
- **Stopped on purpose only.** `lol down`, Ctrl-C, Stop, a switch and an Apply that changes the launch run
  `stop.sh` until nothing runs and the port is quiet. A crash leaves vLLM for the next farm to adopt.
  - `lol down` finds it from the runtime file, or from the config when the file is gone.
  - At boot, a vLLM this farm started that still runs while another engine is chosen is stopped (the orphan rule);
    someone else's is left alone.
- **Downloads have their own slot**, outside the one-at-a-time job chain and never "busy" for clients: a crash of
  vLLM during a download is restarted at once (8 s in the test, not 23 GB later), and Stop on a download keeps
  what it fetched.
- **Also in this slice:**
  - Ollama's models leave the GPU before vLLM or llama.cpp starts.
  - Document reading uses gemma4:12b beside another engine when it is installed (production's would have been
    qwen3.8, 17.7 GB, over the 9 GB kept for it).
  - The pool warning is in plain words, and the gate gives its 503.
  - Pulled forward because the tests drive them (no panel yet): switching between the four engines, where a vLLM
    that does not stop changes nothing; Apply on vLLM with its dry run (48 → 40 people keeps it running, a new
    context restarts it); Stop and Start; Download; Stop on either slot.
- **Two bugs the lifecycle test found, fixed:**
  - the fallback said "healthy" before LiteLLM routed to Ollama, so a client met a 502;
  - a `lol down` during a proxy restart left `lol up` alive with no proxy, holding the farm's ports. It now stops.
- **Tests.**
  - farm `node test/run.js`: **190** passed, from 186. The four new tests cover the download slot (§11.1-16), the
    gate's 503, the OCR rule, and the plumbing's pure helpers.
  - `farm/test/vllm-lifecycle.js` (`LOL_VLLM_FAKE=1`, opt-in): **64 passed, 0 failed** in one run of all eleven
    §11.3 steps. It runs a real `lol up` from this worktree with the real scripts, a fake vLLM inside WSL
    (`farm/test/fake-vllm`, now printing vLLM 0.30's start lines with their `\r` bars, `/metrics`, a tiny chat, and
    the slow, OOM and port-held modes), `farm/test/fake-ollama.js` and LiteLLM 1.97. It used ports
    4300/4301/4302/41897/8299 and `~/lol-fake-a` only. It reads every other vLLM on the computer before and after:
    production's (pgid 401, :8100) was untouched.
  - `farm/vllm/test_scripts.sh` under WSL: **98/98** with the changed fake.
  - Every new test fails with its fix reverted, checked in a scratch copy (seven reverts, each with its failing
    test). Step 1 of the lifecycle fails with the previous `up.js`, and step 11 with the previous `down.js`.
  - No shell or Farm app change in this slice.
- **Production.** The Farm app stopped at 20:46:13: its farm.log ends there with no shutdown line, and its runtime
  file was removed at 20:46:17. Production's vLLM on :8100 keeps answering. Nothing in this slice's runs reaches
  the Farm app: the test farms used only the ports and folders above, and the worktree's own runtime file. It was
  left as found for the owner, not restarted.
- **Left for the next slices:**
  - the panel (Backend and vLLM cards, both bars, the D10 sweep, `ocrFits`);
  - Install and Update, and the library's add, remove and Use this;
  - the take-over, and the Farm app's supervisor.
  - An Ollama pull still runs in the job slot, so a vLLM crash during one waits for it.

## 2026-10-07 (19:58) — vLLM run by the farm, slice A: the scripts, the config and routing, the pure planning

The owner asked for vLLM to be an engine the farm runs, switched to and from in the panel, with no config file
("I want the farm operator to be able to do everything from the app"). That replaces the 2026-09-07 rule (the
farm never starts an external server) and the 2026-10-06 recipe plus autostart. The design, its build order and
the owner's four questions with their defaults are in [VLLM_MANAGED_PLAN.md](archive/plans/VLLM_MANAGED_PLAN.md):
- the take-over is one click by a person;
- Stop does not survive a farm restart;
- an unmeasured card says so, with the Plan capacity link;
- WSL is installed from written instructions.

This slice is the plan's §12 items 1-3, on the `vllm-managed` branch. Nothing starts vLLM yet: a config that
selects it serves with Ollama ("This version of the farm cannot run vLLM yet"), and the panel does not offer it.

- **The scripts (`farm/vllm/`).**
  - `serve.sh` takes the farm's whole argv in `LOL_VLLM_ARGS_B64` (NUL-separated, base64), with none of its own
    defaults and no extra args. It then writes `run/managed-by-farm`.
  - With that marker and no argv (the old log-on task, the Spark's unit, a hand), it says so, logs it and exits 0.
    `start-windows.ps1` then logs "The farm runs vLLM now" and only opens the Farm app.
  - It also expands `~` in the root, moves a log over 50 MB to `vllm.log.1` at a start, and logs its early refusals
    (no vLLM, port taken, bad floor), so a launch with no one reading its output still explains itself.
  - `status.sh` is new and read-only. It reports this Linux, the GPU, memory, disk, the installs (and a `.venv`
    that is a link), the models (vision, window, partial), the running server's env and exact argv, every `serve.sh`
    on the computer (`found=`), the guard, an install in progress and the marker.
  - `stop.sh install` stops an install. Its last line now speaks of its own group only: it used to list every vLLM
    on the box, production's included. It exits 1, keeping its files, when something survives the KILL.
  - `install.sh` gets steps (`LOL_VLLM_STEPS=model` = download only), `[lol-step]` markers and
    `[lol-error] gated|notfound|disk|network`. It installs uv itself, runs as its own process group, and refuses the
    venv steps when `.venv` is a link (the live test borrows production's).
- **The config, routing and names.**
  - A strict `vllm` block holds the library of the three measured NVFP4 models with the spike's flags.
  - `engineOf` resolves external > vLLM > llama.cpp > Ollama.
  - `serverRoute` is shared by external and vLLM (`hosted_vllm/`, the model's presence penalty and vision).
  - `carryNameAcross(config, from, to)` covers four engines, and `engineFallback('vllm')` serves Ollama under vLLM's
    name, in memory only.
  - The snapshot's `backend.engine` can be `vllm` (contract enum, plus two examples: starting and healthy with
    `busy`, then serving).
- **`farm/src/vllm.js`, pure.** It decodes `wsl -l -v`'s UTF-16 and skips Docker Desktop's distribution, and
  parses `status.sh`. From there it works out:
  - the checklist with every plain sentence (on Windows the disk is the smaller of WSL's virtual disk and the drive
    that holds it);
  - the root;
  - the pool (52 GiB on the PRO 6000 with OCR, 8 beside ComfyUI, 59 on a Spark before the cap);
  - people per pool (67 at 64k in 50 GiB; vLLM itself said 65.82x);
  - the Automatic seats (measured, never above what the pool holds);
  - `--max-num-seqs`;
  - the exact argv and env;
  - adoption by settings;
  - the boot, crash and orphan decisions;
  - the start phases from vLLM's log, and the failure sentences.
- **Changes to the design found while building** (listed in the plan's Build status):
  - the kernels pattern no longer matches the engine's config line;
  - a Spark's Automatic pool is 27 GiB once §3.2's own cap applies;
  - the checklist has non-blocking warnings;
  - a few helpers are pure so they are tested now;
  - `status.sh` creates nothing.
- **Tests.**
  - farm `node test/run.js` **186** passed, from 170: sixteen new tests for §11.1 items 1-14. Two of them are golden:
    the take-over's routing equals production's external routing apart from `api_key` (so the take-over needs no
    proxy restart), and production's running server is adopted, read from `serve.sh`'s own ARGS block and
    `lol-vllm.service`'s ExecStart. The phase test reads the real 17:45-17:47 start, cut read-only from
    `~/lol-spike/logs/vllm.log` with its `\r` bars.
  - `farm/vllm/test_scripts.sh` under WSL: **98/98**. That is the 35 checks from before, two more on the guard and
    the bad floor, and 61 new ones, with `farm/test/fake-vllm` (vllm and hf) on `/tmp` roots and free ports.
  - `start-windows.ps1` was run against a marked root: it logged the exit-0 line and opened its stand-in app.
  - LiteLLM 1.97 `test/litellm-cancel.js` PASS. Shell: build ok, `chat-unit` 1836, `test:unit` 29, `chat-lint` 0.
  - Every new test fails with its fix reverted, checked in scratch copies. With the b2944fe farm sources, the
    engine, config and contract tests fail. With `vllm.js` stubbed, its nine tests fail. With the b2944fe
    scripts, 36 of the new script checks fail; the others (such as "answers") hold either way.
- **Production untouched.** The scripts ran on `/tmp/lol-as-*` roots and free ports only. Production's vLLM still
  serves through pgid 401, and `127.0.0.1:4000/v1/models` still lists Qwen3.6 (checked after the last run).
- **Left for the next slices** (§12 item 4 onward):
  - the process half of `vllm.js` and `up.js`'s lifecycle: the boot job, health, supervision, fallback, the orphan
    rule, `lol down`, the gate's 503 and the download slot;
  - then the panel, `setBackend` over four engines (and its `restoreNames` over every alias), Apply, the library,
    install and download, the take-over, and the Farm app supervisor;
  - then the docs (farm/README, PRO6000_VLLM_SWITCH, CLAUDE.md);
  - `problemsFrom` reports any `installing=` as blocking. Once the farm's own download slot runs model-only
    downloads, it must not block using another model.

## 2026-10-07 (18:36) — Review fixes for the capacity page and the Open WebUI boot; a boot log

Both 18:14 and 18:18 pieces had an independent verifier. The boot fix came back **ok** with three minors; the
capacity page came back **fix-needed** with one major and three minors. All seven are handled here.
- **Capacity, major: a one-person card recommended to groups.** The GeForce RTX 5090 was the first pick for "a
  Computer workshop, 20 people" ("covers your 20 with 27"), while the catalog names it a *single-person
  reference* and the page's own table says "32 GB, 1 person". A 5090 was never measured with a group. The
  single-person GeForce cards now count only for one or two people, like the llama.cpp-only pairs. On its own
  farm, such a card says "A card for one person: about N on paper, but never measured with a group, so not
  your 20".
- **Capacity, minors:**
  - The Computer card picks Nemotron, which reads no images. Its reason now says the Image box and Describe a
    picture need another model.
  - "On this farm" now starts with the model the farm serves, when that model covers the head count. Before,
    the studio's PRO 6000 on Qwen3.6 was told "Qwen3.8-27B covers your 10", which reads as an advised switch.
  - A GeForce name no longer claims an exact match when the memory differs by more than 2 GB (a 16 GB 4070 Ti
    SUPER is not the 12 GB 4070).
  - Tests: the farm test gained these four checks; with the old `scenarios.js`, the first one already fails
    (rag: Qwen3.6 on a 5090).
- **Boot, minor: a reload the restart would kill.** Main sends the farm list before it decides to restart Open
  WebUI (`repoint` sets "restarting" in the same tick). The renderer's reload check now waits 500 ms, and any
  state other than ready drops the flag. A farm that comes back with a changed launch env therefore restarts
  Open WebUI once, without a wasted reload first.
- **A boot log.** The owner's slow load stays unexplained by data: the packaged client logged no boot timeline,
  and the owner's profile already had its farm saved. Now each Open WebUI state goes to
  `<userData>/logs/boot.log` with the seconds since launch: starting, ready, restarting and the farm, or an
  error. The log starts over past 1 MB and keeps the old file as `.1`. The next slow launch will show whether
  it was the boot itself, the discovery wait or a restart. The second boot minor (discovery lagging the page
  load) is rare (a warm page takes 12 s, the sweep starts at 0.8 s) and is left as it is.
- **The standalone explorer** (`scratchpad/farm-capacity/explorer.html`) is rebuilt with the fixed scenarios,
  for the Artifact.
- **Tests:** farm 170/0; shell build OK, chat-unit 1836/0, unit 29, lint 0.

## 2026-10-07 (18:18) — Open WebUI slow to load: a farm found during the boot was never saved; the per-boot Hugging Face check had no timeout

The owner: "the owui takes ages to load, we had fixed that though." The packaged client keeps no boot log (main's
console goes nowhere), so the owner's launches could not be timed. Measured here instead: the dev client from a
scratch profile and data folder, against the non-beaconing mock farm, Open WebUI 0.11.4 from `sidecar/build`.
- **Open WebUI's own boot is unchanged:** 11.9–12.2 s warm (0.10.1: 10.7–12.2 s), about 31 s when its files are
  cold (the first boot after they sat unused, both versions). A warm launch shows the chat input at 12.4 s.
  Nothing in v0.2.8's env varies between launches: the MCP listener is decided once, before the first spawn.
- **Cause 1, ours: the farm context was saved only when Open WebUI restarted.** A client that found its farm
  during the boot (every fresh install whose farm answers within 4.5 s) already ran that context, so it never
  saved it. Every launch then waited up to 4.5 s for discovery before starting Open WebUI. A launch with the
  farm down or not seen yet (today, during the vLLM switch) booted Open WebUI without it, then booted it again
  when the farm came. Measured: Open WebUI started at 4.9 s, showed no farm at 16.9 s, restarted at 20.3 s,
  and the chat came at 31.9 s instead of 12 s. Fix: `farmSelect.ts` `connectPlan` separates "restart Open WebUI"
  from "save the context"; `connectTo` saves whenever the settings lack it. After: the first launch saves it, the
  next one with the farm down starts Open WebUI at 0.2 s and needs no restart when the farm comes back.
- **What a saved context had always done, now fixed too:** a page Open WebUI loaded while the farm was down kept
  an empty model list. Neither its model picker nor New Chat asks again; only a reload does. The renderer now
  reloads it once when that farm answers (`app.js` `reloadIfFarmBack`). Measured: the farm back at 20 s, the
  model listed and selected at 20.5 s. A launch with the farm up does not reload.
- **Cause 2, ours where the network silently drops huggingface.co:** Open WebUI asks it for MiniLM's latest
  revision on every boot, with no timeout. `HF_HUB_ETAG_TIMEOUT` never covered that request. `HF_HUB_OFFLINE`
  waits for Whisper, which only the first use of Open WebUI's microphone fetches (the owner's profile never
  has). Measured with huggingface.co blackholed: healthy at 32.5 s (0.10.1: 31.8 s); with
  `RAG_EMBEDDING_MODEL_AUTO_UPDATE=false`, 11.6 s (10.4 s). On this LAN the check costs 0.15–0.3 s. A missing
  MiniLM is still downloaded at that boot (checked with an empty HF cache: healthy at 22.9 s, the download).
- **Tests:** `shell-main.test.mjs`: `connectPlan` (a boot that found the farm saves it; an unchanged beacon writes
  nothing) and the env (`RAG_EMBEDDING_MODEL_AUTO_UPDATE=false` cached or not). Both fail with the fixes
  reverted. chat-unit 1836/0, unit 29, lint 0, farm 168, harness h0 13/13. The reload was checked with the dev
  client over CDP; no committed test drives the real `app.js` webview.
- **Not done:** a boot log in the packaged client. The owner's installed client is v0.2.7 and still runs Open
  WebUI 0.10.2, downloaded 2026-07-01: the engine only updates from About ▸ Check for chat-engine update.
## 2026-10-07 (18:14) — The capacity explorer on the farm, with usage scenarios

The owner asked for the explorer to be on the farm, for operators to go through, with usage scenarios ("RAG with 5
people: what hardware, what model, what context"; "vibe-code a three.js XR app with 10").
- **The farm serves it** at `/lol/capacity` (open like `/lol/self`, read-only), with its scripts and data beside
  it under `/lol/capacity/`. The files moved to `farm/src/capacity/`, so the Farm app ships them. One copy of each:
  the docs scripts now write there (`build_catalog.py`, `build_page.js`) and the calibration reads from there.
  `measured.json` ships trimmed to what the page reads (31 KB of 338; every estimate unchanged, checked over all
  pairs at 32k/64k/128k in both modes).
- **Local only:** no Google Fonts any more (a system font stack); the page asks nothing off the farm.
- **This farm:** the page reads `/lol/self`, maps the GPU nvidia-smi names to the catalog (GB10 → DGX Spark, RTX PRO
  6000, Max-Q, PRO 5000 48/72 GB by memory, 5090/4080/4070; anything else → the largest box with no more memory,
  said to be a stand-in), marks its column, opens its detail on the model it serves, and says in every scenario
  what this box can do.
- **Scenarios** (`scenarios.js`, a pure module): documents for 5, vibe-coding for 10, a class of 30, a Computer
  workshop for 20, long reports for 2, a near-frontier model for 1–2, and "your own". Each turns how a surface
  loads the farm into estimator inputs and model needs, then picks up to three hardware × model pairs (one per box)
  that cover the head count with room to spare, cheapest box first, each with people at once, speed alone, the
  first word on a new document, the price per person, how sure, and a one-line reason. "Why not a Spark?" when a
  popular box falls short. Clicking a pick opens it in the table and the detail with the card's settings.
  - What comes out today: documents for 5 → Qwen3.6 on one DGX Spark (8, measured); vibe-coding for 10 → Qwen3.6 on
    a PRO 5000 72 GB (35, calibrated), not a Spark (8 at 64k); a class of 30 → Gemma 4 26B on a PRO 5000 72 GB
    (74, estimated), then Qwen3.6 on a PRO 5500 or the PRO 6000 (96, measured); the Computer → Nemotron 3.5
    Lightning, the head-count model.
- **The panel links to it** (Plan capacity ↗, also on the token screen). The Farm app's window dropped
  new-tab links from its webview: Electron needs `allowpopups` on the tag before the webview's window-open handler
  is even called (checked with a scratch Electron 42 app). The app now opens them in the system browser.
- **Tests:** farm 170/0 (two new: the routes, types, the no-outside-address rule, the links; the scenarios'
  filter, ranking, this-farm cases and GPU/model matching). Each fails with its fix reverted, checked in a scratch
  copy. Shell unchanged: build, chat-unit 1834/0, unit 29, lint 0. Headless-Chrome screenshots of the page served
  by the farm's own HTTP server on a scratch port (a PRO 6000 farm, light and dark; a GB10 farm), and of the single
  file offline.
## 2026-10-07 (17:48) — The studio's PRO 6000 farm now serves vLLM: 48 people at 64k instead of 2

The owner gave the go ("we can switch to vllm now"). It was done with `docs/archive/PRO6000_VLLM_SWITCH.md`, while the
farm was down, so nobody was cut off.

- **Install:** Farm app farm-v0.0.42 (silent install). Its first launch copied the farm code (0.0.42, with
  `vllm\`) and came up on Ollama as before.
  - **A trap on the way:** the agent's shell inherits `ELECTRON_RUN_AS_NODE=1` from VS Code, so the Farm app
    started as plain Node and exited at once, with no window and no log. It was launched again without it.
    `start-windows.ps1` now clears the variable, and memory notes it.
- **The switch:**
  - The logon task "LlmOnLan vLLM" is registered (`start-windows.ps1 -Root /home/ateliernum/lol-spike`,
    priority 4).
  - `lol.config.json` gained the `external` block: Qwen3.6, 48 seats, 64k, vision, presence penalty 1.5. The old
    file is kept as `lol.config.json.before-vllm`.
  - The Farm app was closed cleanly (its window: the farm stopped in 2 s), and `ollama stop qwen3.8:latest` freed
    35 GB.
  - The task was started: vLLM answered after 1 min 43 s, then the Farm app opened by itself.
- **Checked:**
  - The snapshot says engine external, "Qwen3.6-35B-A3B (vLLM)", 48 slots, 65,536 per person, healthy.
  - `/v1/models` lists `Qwen3.6`, and a real reply came back through the seat gate.
  - The GPU holds 76.6 GB.
  - Sent as raw bytes, `/vllm/%2E%2E/…`, `/vllm/../invocations` and `/azure/x/../../…` get a 400, and
    `/vllm/v1/chat/completions` a 404. curl had shown a 200 only because it normalised `%2E%2E` itself.
- **For people:** new chats use Qwen3.6. Chats bound to "Qwen3.8-latest" need the model picked once.
- **Rollback, if needed:** the three commands in the switch document.

## 2026-10-07 (11:35) — Release client v0.2.8 and Farm app farm-v0.0.42: the multi-user work

Released from `main` at `957ac71`. `multiuser-phase0` (47 commits since v0.2.7) was fast-forwarded into it after
the pre-release review was clean and every gate passed: farm 168/0, litellm-cancel PASS, shell chat-unit 1834/0,
unit 29, lint 0, and the chat harness 408/408 on a second full run.
- **Client v0.2.8** (tag `v0.2.8`, commit `1dc0e9e`, CI run 37597610724): 6 jobs green, 27 assets, the same set as
  v0.2.7. That is the installers for Windows x64, macOS arm64 and x64, and Linux x64 and arm64; the
  `owui-sidecar-*` (Open WebUI 0.11.4, unchanged); the `dsh-runtime-*`; and `latest*.yml` saying 0.2.8.
  Installed clients update themselves. At first launch each one switches web search back off once (where an
  older client had turned it on), writes the date line into an empty Open WebUI system prompt, and reloads Open
  WebUI once.
- **Farm app farm-v0.0.42** (tag `farm-v0.0.42`, commit `957ac71`, CI run 37597624651): a prerelease, as usual.
  Files: the Windows installer, macOS arm64 and the Linux arm64 AppImage. Installed by hand. On its first `lol up`
  the SearXNG settings move to v4 (no Yandex, Swisscows added; the secret kept). An open farm keeps its plugin
  keys, so no client restarts.
- **`build-llamacpp-arm64`** ran on the push to `main` (because `llamacpp.js` changed) and rebuilt the same pinned
  b10670 for the Spark: success.
- **What is in it:** the DEVLOG entries from 2026-10-04 11:40 to 2026-10-07 10:23 and the plan,
  `docs/archive/plans/multiuser_implementation_plan.md` (revision 4 and the statuses).
- **Next:**
  - Switch the production PRO 6000 farm to vLLM at a moment the owner picks (`docs/archive/PRO6000_VLLM_SWITCH.md`).
  - Run the rig checks of TEST_SCENARIOS 7d on installed builds.
  - Measure the two linked Sparks once they are cabled, then update the capacity explorer.

## 2026-10-07 (10:23) — Pre-release review: the seat gate forwards only what clients use; vLLM autostart on both boxes; the GB10 clock latch on the panel

Before tagging client v0.2.8 and Farm app farm-v0.0.42, five reviewers went over everything since v0.2.7 (farm,
the client's main process, the renderer, upgrade and compatibility, release mechanics and docs). A skeptic then
re-checked each finding, and four fix sets followed, each checked again. The owner's answers today: the Spark gets
the operator-run recipe with autostart (not the managed engine); release once the review is clean; switch the
production PRO 6000 to vLLM at a moment the owner picks.

- **Major, fixed (`ddb0556`): the seat gate forwards only the routes clients use.** With the external engine on
  `hosted_vllm/`, LiteLLM's pass-through routes (`/vllm/{path}` and others) forwarded to vLLM with no seat. httpx
  resolves a decoded `..`, so `POST /vllm/../invocations` reached the engine; a reviewer reproduced it on a
  scratch LiteLLM.
  - **The gate now decodes the path once:** a decoded `..`, `?`, `#` or NUL gets a 400.
  - **It forwards only:** the generation routes (seated); `GET /v1/models`, `/models`, `/v1/models/<id>`,
    `/model_group/info` and `/health/liveliness`; and their preflights. Everything else, including LiteLLM's
    admin API and `/ui`, embeddings and the full `/health`, gets the gate's own 404.
  - **Every caller was checked before the cut:** Open WebUI, LOL Vibe (which needs `/model_group/info`), the
    Computer, the coding agent, agent pages, `lol status`, the bench, coordinator peers and the README's curl
    examples.
  - **Live check:** the gate in front of a real LiteLLM 1.97. A farm that turns the gate off with an external
    engine now gets a warning at `lol up`.
- **Plugin keys follow the farm password.**
  - A password set or changed gives OCR, Classify and speech to text new keys at the next farm restart.
    Before, a device that read them from an open farm kept them for good.
  - An open farm keeps exactly farm-v0.0.41's keys, so the upgrade restarts no client's Open WebUI; a test
    pins it.
  - The panel's password row now says what is true: it protects the plugins, and old access lasts until the
    restart.
- **The GB10 clock latch on the panel.**
  - The farm's GPU sampler now reads the SM clock. Three busy samples in a row under 1,000 MHz (and under half
    the max when the GPU reports one) show: "The GPU is stuck at a low clock (702 MHz): fully power the box
    off (unplug it for a minute), then start it again."
  - The fixed floor matters twice: a GB10 may not report its max clock, and a 300 W card can dip under half
    its max while healthy.
- **vLLM autostart** (`ef8dce0`, plus the fixes here).
  - **serve.sh has a daemon mode** (`LOL_VLLM_DAEMON=1`): no stdin watchdog, a clean stop on SIGTERM, and a
    memory guard that stops vLLM below `LOL_VLLM_MIN_FREE_GB` (exit 3, not restarted).
  - **Spark:** a systemd unit with the Spark's numbers as overrides. It is ready only once vLLM answers, and
    it restarts at most 3 times an hour.
  - **PRO 6000:** a log-on task launcher, `start-windows.ps1`. It starts vLLM in WSL, waits until it answers,
    then starts the Farm app.
  - **Fixed after the skeptic:**
    - A stale `run/vllm.pgid` left by a power cut no longer blocks the next start: a recorded group counts
      only if its leader is a `serve.sh`, and `stop.sh` never kills an unrelated group.
    - The scheduled task no longer runs the whole farm below normal priority: the launcher resets itself to
      Normal, and the registration line sets priority 4.
    - `stop.sh` during a start no longer makes systemd restart vLLM.
    - The README and the unit name `reset-failed` after three failures.
  - **Tests:** `serve.sh`'s suite with a stand-in vLLM passes 35/35, plus a stale-file check. Neither the
    scheduled task nor the unit was run on the real boxes: that is the rig list's 7d.16–7d.17.
- **Shell fixes** (`c6aea2a`):
  - The skill refresh ignores files the OS adds (.DS_Store, Thumbs.db).
  - Agent pages say "the farm no longer serves the model X" instead of blaming the password.
  - LOL Vibe's seat wait counts a seat this computer holds.
  - Preferences no longer says closing frees your seat.
  - GETTING_STARTED and shell/README give web search v2's real cost.
- **Docs** (`77768e7`): the v0.2.8 / farm-v0.0.42 rig checks (TEST_SCENARIOS 7d, 18 checks), and the CLAUDE.md
  and IDE_PLAN lines the branch had made false.
- **Tests on the release candidate:** farm 168/0; litellm-cancel PASS (1.97.0); shell chat-unit 1834/0, unit 29,
  lint 0; chat harness 406/408 in a full run; the two misses (c1-landing-one-document, c2-bridges-legacy-out-of-the-palette, both under 0.5 s) passed 3/3 alone and in their family's run in sequence (c: 72/72): a load flake. A second full run before tagging.

## 2026-10-07 (10:07) — The capacity explorer: model × context × hardware, measured where it can be, estimated and labelled elsewhere

The owner asked for "a comparison table or a web visualisation where I can change parameters": which model, how
much context, on what hardware. A second DGX Spark has also arrived. It will be linked to the first over ConnectX-7
(200 Gb/s, not NVLink), for near-frontier models used by one or two people.

- **Data**, three agents:
  - Every measured point from both spike runs went into `measured.json`. It was cross-checked against RESULTS.md:
    87 rows agree, and the 12 disagreements are listed (missing "≥" on steady counts, pooled vs per-round rules
    for Spark llama.cpp and Nemotron 64k).
  - A catalog of 10 hardware entries and 29 current open-weight models, with sizes, attention layout,
    checkpoints, prices, benchmarks, and community speed reports for two linked Sparks.
  - An estimator, calibrated on the PRO 6000, predicted the Spark's measured people inside the measured range in
    **17 of 18** cells (mean error 1 %, worst 14 %). The previous method got 7 of 18.
- **The page** (a private Artifact, https://claude.ai/artifact/5voKHTLBktJuUpf9CLk9jt):
  - a models × hardware matrix, showing people, speed for one person, € per person, first word on a new document,
    or the longest context;
  - controls for context per person, a class or normal use, thinking, the memory budget, class size and the
    filters, plus the pass rule, the reply length and the two-Spark link delay as assumptions you can change;
  - a detail panel with the memory split, speed and first word as people join (with the measured points), and
    people against context.
  - Under a farm budget, a model that fits only with all the memory says "alone only".
  - Checked: 6,960 parameter combinations, none failing; the scripts parse; one headless-Chrome screenshot.
- **The sources live in `docs/spike/explorer/`**, with a README on how far to trust it and how to update it after
  the two Sparks are measured.
- **What the explorer confirms:** many people at once → RTX PRO 6000. Near-frontier models for one or two people
  → two Sparks: DeepSeek-V4-Flash, MiniMax-M2.7, Qwen3.5-397B and GLM-5.3-Flash fit, at roughly 15–40 tok/s for
  one person. A model that fits 96 GB runs faster on the PRO 6000, even for one person.

## 2026-10-06 (11:45) — The engine × model spike on the DGX Spark: one PRO 6000 serves 8–16× the people

The same harness, flags and 58 GiB KV pool as the PRO 6000 run, on `spark-59f9` (GB10, 128 GB unified), from
2026-10-05 13:51 to 2026-10-06 11:37. `docs/spike/RESULTS.md` has the Spark tables and a "PRO 6000 vs Spark"
section; `results/spark-*.json` holds the raw data.

- **People at 32k / 128k (every turn):**
  - vLLM + Qwen3.6: 8 / 4, against 96 / 32 on the PRO 6000.
  - vLLM + Nemotron: 16 / 4, against 160 / 24.
  - Qwen3.8-27B (dense) fails at 1 user: it decodes 12 tok/s, and the bar is 15.
  - llama.cpp + Nemotron: 2 at 32k.
- **Why:** the Spark's batched aggregate and prefill run at ~0.17–0.2× the PRO 6000's. Those two set head
  counts. Single-user decode does better, at 0.28–0.39×.
- **The 128 GB buys nothing here:** throughput binds ~10× before the KV pool. Quality was the same on both boxes.
- **Found on the way:** the GB10 had been stuck at 702 MHz since a unified-memory OOM on 2026-09-16, a known
  NVIDIA power-delivery latch. A reboot did not clear it; a cold power drain did. Every number was measured after
  the drain.
- **Also:**
  - The vLLM venv needs uv's own Python, because the system Python has no `Python.h`.
  - Qwen3.8's FlashInfer JIT needs `MAX_JOBS=4`: the memory guard (`runs/spark_guard.sh`) caught a 116 GB spike.
- **Tested:** the full matrix ran unattended (`runs/spark_matrix.sh`). Thermals levelled at 80–88 °C. The box was
  left at baseline, with OpenClaw and Agent Studio restarted.

---

## 2026-10-06 (10:51) — Web search measured at 17/18 fresh facts, as cheap as web search off; the last review findings

- **The final measurement of the shipping web search** (the client's search-and-read service in a worker,
  SearXNG without Yandex and with Swisscows, vLLM + Qwen3.6 with presence penalty 1.5 and the 32,768
  ceiling; 18 fresh-fact questions plus 3 stable ones, one chat each, 84 messages):

  | | Fresh facts right | Generations per message | Slot time per chat (median) | Wait to first word (median / p90) | Runaways |
  |---|---|---|---|---|---|
  | With the date line | **17/18** | **2.33** | 9.0 s | 4.0 / 5.9 s | 0 |
  | Without it | 14/18 | 2.72 | 11.0 s | 5.4 / 12.0 s | 0 |
  | Web search off (2026-10-05) | 0/12 | 2.4 | 13.9 s | 2.5 / 4.2 s | 0 |
  | Today's web search before v2 (2026-10-05) | 2/12 | 6.8 | 21.0 s | 5.3 / 26.3 s | 1 |

  - **With the date line:** the answer was in the evidence for 18/18 questions, and 0 of 29 queries asked
    for a stale year (9 of 32 did without it).
  - **The one miss:** the model wrote the right answer inside its thinking and returned an empty reply.
  - **Every miss without the date line was a year mistake.**
  - **Search costs:** a median 2.1 s per search, 58 ms of reading and ranking in the worker, and about 1.9 MB
    downloaded.
  - **The engines:**
    - **Answered:** Bing, Seznam and Swisscows on (almost) every search, and DuckDuckGo (web) on 53 of 61.
    - **Refused:** Qwant and Mojeek refuse this IP.
    - **Rate-limited:** Wikipedia was rate-limited mid-run.
  - **Verdict:** good enough to turn web search back on by default after a class-size check: the engines
    under a class's burst from one IP, ~5.5k uncached prompt tokens per chat, and the wait under load.
    Web search stays OFF by default until then.
- **The last review findings, fixed** (`56acb16`, `5c6b5bd`, `7567dfd`):
  - **Reading in a worker.** Page reading and ranking run in a `worker_thread`, which is `webSearch.js`
    itself and was checked loading from inside `app.asar` with Electron 42.5.1. Six hostile 2 MB pages now
    hold the main thread 25–34 ms, down from 0.8–1.8 s. After 3 s the answer falls back to the engines'
    snippets.
  - **Retrieval rules:**
    - The dictionary rule spares official docs (Google/AWS/Microsoft translate docs, Django, Apple).
    - Curly apostrophes count as apostrophes.
    - A stale page's version line is no longer boosted, and a dotted date isn't read as a version.
  - **The date line's wiring is tested.** The Blender tool-server write now waits for the first load's
    settings fixes; on Open WebUI 0.10, which replaces `ui` whole, one write could otherwise be lost.
    GETTING_STARTED says it applies to Open WebUI only, and how to add `{{CURRENT_DATE}}` to your own
    prompt.
  - **The runaway docs say what vLLM really does:** the reply limit is a server-wide ceiling there (vLLM
    0.30 takes the minimum), and a default on Ollama and llama.cpp. 32,768 is above every first-party ask
    (16,384 at most). The cancel test now checks a request above the limit on every route.
- **Tests:** farm 164/0; litellm-cancel PASS; shell chat-unit 1831/0, unit 29, lint 0; chat harness
  **408/408**.

## 2026-10-06 (09:48) — Decisions think; web search v2 built (no Yandex, with Swisscows); runaways fixed at the root; Open WebUI told the date

The owner's answers at the end of 2026-10-05:
- yes/no decisions think, the rest stays fast;
- drop Yandex and re-check, then add Swisscows (Swiss, no account, no key);
- cap runaway replies at the farm;
- write the date into an EMPTY Open WebUI system prompt;
- the merge and release wait for the Spark results.

Every change below was built in its own worktree and checked by a skeptic, and its findings were fixed. The
last small findings are being fixed now.

- **Decisions think, the rest stays fast** (`ce46b18`, `b9076c0`).
  - The rule lives in one place (`THINKING_TASKS` in `core/types.mjs`, read by `app/ask.mjs`). Condition and
    Filter verdicts send nothing about thinking, so the model's own default applies; json/list extraction
    and Agent steps send the thinking-off pair. The box, now labelled **Think all**, makes everything think.
  - Filter's system sentence now says what `keep` means: thinking scored 36/36 with it.
  - Verdicts get 8,192 tokens instead of 4,096.
  - The review fixes: the default flips with one edit; the hint is on the checkbox (tested); a focused
    checkbox no longer swallows the canvas keys; the Cap and the box are read at once.
- **Runaways, fixed at the root** (`64d4362`).
  - **The root cause:** Qwen3.6 was served without the `presence_penalty` 1.5 its model card asks for in
    thinking mode.
  - **The measurement:** replaying Open WebUI's saved requests, 8 of 500 replies looped until the 64k window
    was full. With the penalty, 0 of 1,057 did. The spike's quality set scored 81/84 with it against 83/84
    without, within noise.
  - `external.presencePenalty` (the recipe sets 1.5) rides the LiteLLM route as a default a request
    overrides.
  - **The safety net:** `proxy.maxReplyTokens` 32,768. On Ollama and llama.cpp it is a default for requests
    that name no limit. On vLLM, serve.sh's `--override-generation-config` makes it a server-wide ceiling;
    the review caught the docs calling it a default there, and that wording is being fixed.
  - **Why it matters on the production farm:** Ollama 0.34 shifts its window and carries on up to 10× the
    window, so a loop on its qwen3.8 ran almost unbounded.
- **Web search v2** (`b7829c2`, `4aed37c`).
  - **The farm's SearXNG keeps only the engines that answer from here:** DuckDuckGo (web), Bing, Seznam,
    Swisscows, Mojeek, Qwant and Wikipedia (settings v4; generated files upgrade, the secret is kept).
  - **The client's main process reads the pages:** it reads the top 6 pages of each search, keeps the best
    passages (BM25, ≤ 800 tokens a page, ≤ 3,000 a search) and serves them on the Computer's loopback
    listener (`/web/search`, the same bearer and Host check). Open WebUI uses it through
    `WEB_SEARCH_ENGINE=external`, env only.
  - **The fallback:** if that port is taken, Open WebUI's own SearXNG path gets 5 results, a 12,000-character
    fetch cap and `SEARXNG_LANGUAGE=auto`.
  - **What `io.ts` gained:** a public-only address rule, so 192.0.66.31 is allowed but not 192.0.2.x; a
    pinned connect address, which closes the DNS-rebinding gap for the Computer's Fetch, Open data and Agent
    boxes too; charset decoding; and truncation.
  - **What the review found:**
    - The HTML reader was quadratic on unclosed tags. A crafted 2 MB page would have frozen the client for
      about 30 minutes; it now takes 0.84 s, and moving reading off the main thread is in progress.
    - A 999 status lost its code.
    - The farm's SearXNG answer had no size cap.
    - Open WebUI's Legacy mode still loads pages itself.
  - **Retrieval:**
    - Dictionary sites go last.
    - "Now/aujourd'hui" no longer counts as a search term, because a TV show called "Ça commence aujourd'hui"
      outranked a minister's page.
    - Version lines get a boost when the question asks for the latest release.
- **Quality without Yandex, measured** (18 fresh questions; answer present in the passages):

  | Engine set | Answer in passages |
  |---|---|
  | with Yandex | 14/18 |
  | without Yandex | 13/18 |
  | without Yandex, with Swisscows | **17/18** (French 9/9) |

  In full chats, without Yandex and with Swisscows: 14/18 fresh facts right, 2.4 generations per message,
  0 runaways.
  - **The largest remaining cause of wrong answers:** the model believes it is 2025.
- **The date line** (`0497615`).
  - **What it writes:** "Today is {{CURRENT_WEEKDAY}} {{CURRENT_DATE}}.", into Open WebUI's system prompt,
    once, only when it is empty, with a marker so an emptied prompt stays empty. Open WebUI fills the date in
    at every message.
  - **Why no env route:** `DEFAULT_MODEL_PARAMS.system` never reaches a farm model (only Workspace models
    get it), and `DEFAULT_INTERFACE_SETTINGS` exists only in 0.11 and comes back when emptied.
  - **Tested:** live against throwaway Open WebUI 0.11.4 and 0.10.1 servers.
- **Ternary Bonsai 2 27B, the owner's question.**
  - **What it is:** Qwen3.8-27B in 6–7 GB, 98 % of its score by PrismML's own numbers.
  - **Not for the Spark's multi-user job:** the Spark isn't short of memory; it's a dense model, so about
    9× the compute per word of Qwen3.6-A3B; it runs only on a llama.cpp fork, with no vLLM and no Ollama;
    and the spike measured its base model on llama.cpp at 1 person at 32k.
  - **A strong candidate** for the laptop study (4.3) and for one-person boxes. Plan 4.3 has the trial
    steps.
- **Integration:**
  - The CLAUDE.md conflict between two commits was resolved by hand.
  - farm 164/0, shell chat-unit 1830/0, unit 26, lint 0.
  - The final end-to-end measurement of the shipping build failed to run the first time: the measuring
    agent answered the owner's Bonsai question instead. It is running again.

## 2026-10-05 (17:03) — Web search off by default, and measured back to good; thinking measured on the Computer's real asks; four owner decisions

Today's owner answers:
- web search off by default, but "for an agent it is an important feature and it should be performant and
  qualitative";
- a toggle to put thinking back on;
- the purchase choice is RTX Blackwell versus the GB10 (Spark), with the PRO 5500 only as a fallback;
- no LiteLLM bypass.

Seven agents built and measured beside the production farm, which was serving on this box: a 20 GB vLLM
pool, a scratch Ollama on another port, and nothing loaded into the production daemon.

- **Web search off by default** (`3717d6c`, verified).
  - **New profiles** get no seed; the globe still turns it on for a chat.
  - **Profiles an older client set to "always"** are switched back once. That happens only if they are still
    "always", and a new marker stops it from running twice.
  - **Checked against both Open WebUI versions:** live against throwaway 0.11.4 and 0.10.1 servers, whose
    `ui` write rules differ. The value is set to `null`, not deleted: 0.11 patches `ui` key by key, so
    deleting would have kept "always".
  - **Docs:** CLAUDE.md, GETTING_STARTED and the READMEs say "off by default".
- **A "Think first" box beside the Cap** (`3610e07`): one switch for the Computer's structured asks.
- **Thinking measured on the Computer's real asks.** The prompts were rebuilt from the box parts, about 50
  items × 3 runs on each engine, through the farm's LiteLLM. On the target, vLLM + Qwen3.6:
  - **Condition questions that need working out:** **44 % right with thinking off, 91 % with it on.**
  - **Easy questions, extraction and lists:** right either way (lists 89 → 100 %), at 10–25× the tokens with
    thinking on.
  - **Agent steps:** 22/24 → 24/24, at 12× the time. On gemma4:12b they got worse with thinking (24 → 21).
  - **Filter got worse with thinking:** its system sentence never says what "keep" means. With a one-sentence
    fix, thinking scored 36/36 on both engines.
  - **Decision 9 (thinking off for every structured ask) was wrong for yes/no decisions.**
  - **The owner chose:** decisions think, the rest stays fast, and the box makes everything think. Being
    built.
- **Web search v2, diagnosed, prototyped and measured end to end:** 15 questions per condition, 12 of them
  needing fresh facts, with answers established today.

  | | Fresh facts right | Generations per message | Wait to first word (median) | Runaways |
  |---|---|---|---|---|
  | Web search off | 0/12 | 2.4 | 2.5 s | 0 |
  | Today's web search | 2/12 | 6.8 (max 34) | 5.3 s | 1 |
  | B: engines fixed + 2 OWUI settings (config only) | 9/12 | 3.0 | 3.6 s | 2 |
  | C: a search-and-read service (prototype) | **10/12** | **2.3** | 4.3 s | 0 |

  - **Why today's search was poor:**
    - From this IP only Bing answered: DuckDuckGo html and Startpage gave CAPTCHAs, Brave a 429, Qwant and
      Mojeek a 403.
    - `search_web` hands the model 3 snippets, about 290 tokens.
    - `fetch_url` returns whole pages, about 6.6k tokens each, with no cap.
  - **The service:** SearXNG on the farm, then the client reads the top 6 pages, keeps the best passages
    (BM25) and returns them in one `search_web` call behind Open WebUI's `WEB_SEARCH_ENGINE=external`, env
    only. The model then never called `fetch_url`.
  - **On a laptop:** ~50 ms of CPU, ~1.5 MB of download and under 125 MB of memory per search, as a separate
    process. SearXNG stays on the farm: one cache, and a school's laptops share one public IP anyway.
- **Owner decisions after the measurements:**
  - Decisions think, the rest stays fast.
  - Drop Yandex from the engines: queries would go to a Russian company. Re-check quality without it.
  - Cap runaways at the farm. Separately from web search, some replies loop until the 64k window is full:
    ~290 s of a seat, then an empty reply.
  - Hold the merge and release until the Spark results are in.
- **Building now:** the thinking defaults, web search v2 (the engines without Yandex, the two settings, and
  the service in the client's main process), the runaway study with a measured cap, and the quality re-check
  without Yandex.
- **Tests on the branch** (`3610e07`): farm 161/0, shell chat-unit 1809/0, unit 15, lint 0.

## 2026-10-05 (13:27) — The review round: honest waits end to end, the contract built from the farm's own code, the panel's line for older clients

Each change from 12:42 had one adversarial review. Three agents fixed the findings in their own worktrees,
a skeptic checked each fix, and the last findings were fixed here.

- **Honest waits** (`19f9c2e` + this commit), plan §13b. The per-surface table is now in the plan.
  - **The gate's own 401, 429 and 502 carry CORS headers** (`Access-Control-Allow-Origin: *`,
    `Access-Control-Expose-Headers: Retry-After`). An agent page lives on another origin, so before this it
    saw only "Failed to fetch". In Electron, a page with only the allow-origin header could read the status
    but not Retry-After, hence the expose header. LiteLLM's own answers already allowed any origin.
  - **Retry-After is no longer a poll interval.** When every seat is generating it says the idle window
    (no seat can free sooner), not 30 s.
  - **The 429 sentence an Open WebUI user reads** drops "try again in a moment" and "ask around who's done":
    nobody can hand a seat back. LOL Vibe's two fallback sentences drop it too, and the quit dialog no longer
    claims that quitting frees the seat.
  - **Agent pages:**
    - They wait as long as Retry-After says, and only when the page shows the wait (`onWait`). A page
      written with the old skill fails at once with the farm's estimate, as before.
    - A wrong password is named.
    - The gate's 502 sentence is shown, not "answered 502".
  - **The pill's tooltip on a full farm is true for everyone:** "a computer without one has its new message
    refused". Farms before the unicast `mine` (farm-v0.0.41) never say which computer holds a seat. The
    pill's colour, words and tooltip are one tested helper, `pillState`.
  - **Bundled skills refresh** when a person hasn't edited their copy: a stamp file plus the one hash the
    v0.2.6–v0.2.7 agent-page shipped with. A refresh copies beside, then swaps. A locked file can neither
    stop the coding agent from starting nor leave half a skill.
- **The snapshot contract** (`8aea3fd`), plan 4.4.
  - The examples now build `plugins` and `busy` through the farm's own code (`pluginsSummary`; the job
    projection moved from `up.js` into `buildSnapshot`, behaviour identical), so a field added there fails
    the drift test.
  - `host` stays open like `perf`, and the README says so.
  - Five descriptions were corrected against the tags: `capacity` since v0.0.21, `seatIdleSec` since
    v0.0.38, `httpPort`, `ips` (the Farm app reads it), `requiresKey`.
  - Required fields are checked against what farm-v0.0.1 already sent.
- **The panel's slots-vs-context line** (`ef502ca`).
  - The coding agent's sentences say which clients behave that way: v0.2.7 and older still ask 16k replies
    under Keep going.
  - Ollama's Automatic note points the right way for fewer slots.
  - The Context window row no longer restates the sum the line makes.
  - **A pre-existing bug, fixed:** one Apply that changed the Ollama slots and measured Automatic filed the
    measurement under the new count while the daemon still ran the old one. The cache key now uses the count
    the daemon runs.
- **Tests:**
  - farm 161/0; shell chat-unit 1805/0; unit 8; lint 0.
  - The chat harness (Electron over CDP, mock farm): 405/406. The one miss, `p1-stick-bottom` (LOL Vibe's scroll stickiness, which nothing here touches), passed 3 of 3 re-run alone: a timing flake under the full run's load.
  - chat-scope still fails on this branch, by design (it gates LOL Vibe's carve-out).

## 2026-10-05 (12:42) — LiteLLM's delay halved; web search measured; thinking off on real engines; the llama.cpp bug has a fix upstream; prices per person

The owner's answers this morning (plan revision 4): ComfyQ moved off the PRO 6000 yesterday; classes are
usually 20–30 people, capped at 50; "A5500" means the new Blackwell card; the laptop study is low priority;
file the llama.cpp bug upstream. Seven agents then ran the items that needed no decision (one GPU job at a
time where timing mattered; the owner's Farm app came up on this box at ~11:40 and stayed healthy).

- **LiteLLM's extra delay at 100–140 streams, halved** (`8f137c6`).
  - **Cause, from a py-spy profile:** the farm's single LiteLLM Python process sat at one full core from
    ~50 streams. It passed on ~3,400–4,000 tokens/s while vLLM made 5,300–5,800. Half its event loop was
    the OpenAI SDK building typed objects for every streamed chunk (the `openai/` provider); ~15 % was
    rebuilding each reply at its end.
  - **Fix:** the external deployment uses `hosted_vllm/`, LiteLLM's own client and SSE parser.

    | People at once (200-token reply, through the seat gate) | vLLM alone | before | after |
    |---|---|---|---|
    | 100 | 3.4–3.5 s | 4.6–5.3 s | 4.1–4.2 s |
    | 140 | 4.0–4.2 s | 5.2–6.6 s | 4.9 s |

  - **What stays the same:** reasoning, images, tool calls, usage and thinking off. Stop still stops vLLM
    on all 10 paths, and `external.apiKey` still reaches the server.
  - **The difference:** `hosted_vllm/` strips `strict` and `additionalProperties` from tool schemas and
    forwards `reasoning_effort` and `stream_options`. No first-party client sends those.
  - **What didn't help:** `--num_workers` loses 12–21 of 100 streams on Windows; Granian refuses workers
    there; the WSL relay costs nothing.
  - **Left:** ~0.7 s at 140. The fix for that (the gate streams straight to a lone external engine,
    skipping LiteLLM) was prototyped (it matched vLLM alone) and is written up in `farm/README.md`, not
    built. It is the owner's call: LiteLLM was kept on 2026-09-04.
  - **Review:** one adversarial review; its findings are applied. Coordinator peers stay on `openai/`,
    unmeasured, to revisit with Phase 3.0. The cancel test fails if a routing shape disappears.
  - **Tests:** farm 155/0, then 160/0 with the next commits; `litellm-cancel` fake mode PASS on 1.97.0 and
    1.90.0, vLLM mode 10/10.
- **Web search per Open WebUI message, measured** (plan 1.4, decision 4). Open WebUI 0.11.4 ran with the
  client's exact env against vLLM + Qwen3.6: 8 questions × 2 turns per condition, 138 messages, 401
  completion calls, 238 searches.
  - **The plan's premise was wrong.** OWUI 0.11.4 defaults to *native* function calling, and LOL leaves it
    alone. The model loops over `search_web` / `fetch_url`; no search-query call runs, so turning query
    generation off (option b) changes nothing.
  - **Web search on:** a first message takes 7.8 generations against 3.1 (median 5, max 29). That is about
    2.5× the GPU work per chat, and the median wait to the first word of the answer goes from 1.9 s to
    5.4 s. Only 1 of 4 fresh-fact questions came back right: SearXNG here had only Bing answering, the
    other engines being blocked by CAPTCHAs.
  - **Runaways:** 4 of 36 native-mode follow-ups fell into degenerate repetition up to the 64k window.
  - **The legacy flow the plan assumed:** the query call is 2.5 % of slot time. Whole pages, though,
    overflowed 64k on 4 of 16 messages.
  - **Recommendation:** (c) web search off by default, one click away on the globe toggle. Waiting on the
    owner.
- **Thinking off on real engines** (decision 9). It reaches Ollama 0.34 (gemma4:12b does think by default;
  Qwen3.8) and llama.cpp b10670 through the farm's LiteLLM, streaming and not, and LiteLLM changes nothing.
  - **The price on small models:** 2 of 9 toy reasoning answers were deterministically wrong without
    thinking (gemma4 235 for 215; Qwen3.8 IQ2_S 385 for 395).
  - **Next:** the Computer's real verdict and agent-step asks, both ways, on the target model, before
    anything changes.
- **The llama.cpp Stop bug** (plan 0.0). It is still there in today's b11406 and on master (`e5983d6`),
  and it reproduces directly against llama-server, no proxy. Open PR ggml-org/llama.cpp#29707 already
  carries the exact fix (a deadline + `wait_until`), framed as a router fix and without a reproduction.
  - **Nothing was posted.** llama.cpp forbids AI-written issues and comments, and agent posting
    (CONTRIBUTING AI Usage Policy item 5; AGENTS.md).
  - **For the owner to post in their own words:** `docs/archive/LLAMACPP_NONSTREAM_CANCEL.md`, the facts,
    the log lines and a stdlib repro script. The farm's notes now point at the PR.
- **Prices per person for a purchase** (`docs/spike/ESTIMATES_2026-10-05.md`, plan §8). NVIDIA lists a card
  literally named after the A5500: the RTX PRO 5500, 84 GB. The estimates are scaled from the measured PRO
  6000 (validated within one tested level on that card), Qwen3.6 at 32k, OCR on the card, prices in France
  with VAT:

  | Card | Price per person at 32k |
  |---|---|
  | PRO 6000, measured | €138–184 |
  | PRO 5000 72 GB | €162–190 (needs a host PC) |
  | PRO 5500 | €177–187 |
  | PRO 5000 48 GB | ~€500 |

  - Expect a PRO 6000 to do the work of 4–6.6 Sparks, not "about 6".
  - **A correction to this morning's reading:** with the recipe's 50 GiB pool, a class of 30 fits at 128k
    only if vLLM is started for 128k, and then thinly (32 against 34–36).
- **Code, built in worktrees and reviewed** (`8c1f612`, `1dfbbf7`, `76f5ae1`; review fixes are running):
  - **4.4, the snapshot contract:** `farm/contract/snapshot.schema.json`, a farm test that fails on drift,
    and a shell test that reads today's farm, farm-v0.0.41 and the oldest allowed shape.
  - **13b, one honest wait per surface:**
    - Agent pages wait out a full farm (`onWait`).
    - The pill says "· 12 waiting" when vLLM queues.
    - The review found the gate's own 429/401/502 carry no CORS headers, so agent pages can't read them.
      The fix is in progress.
  - **13b, slots vs context:** the panel says, before Apply, the context each person gets and what the
    clients do with it.
  - **Tests on the integrated branch:** farm 160/0, shell chat-unit 1804/0, unit 6, lint 0.
- **Stray Electron:** one of the agents' scratch Electron tests hit a fixed port twice and showed an
  error dialog on the desktop. It was closed. Agents now use OS-assigned ports.

## 2026-10-05 (09:25) — vLLM on the Windows PRO 6000: the WSL recipe, checked live through the farm (owner decision 10)

- **Why vLLM's TCP port never answered under WSL2's mirrored networking:** vLLM 0.30 binds its port at
  start-up, but only calls `listen()` once the model is loaded, 1.5–2.5 min later. Mirrored networking
  stops forwarding a port left bound that long without listening. A plain Python socket reproduces it at
  a 75 s gap; 12–15 s still works. No flag listens earlier.
  - **The fix:** `farm/vllm/serve.sh` serves vLLM on a Unix socket behind `relay.py`, a ~50-line asyncio
    TCP→socket relay. The relay binds **127.0.0.1 only**, so the LAN can't bypass the seat gate. The
    same stdin-EOF watchdog stops both.
  - No `.wslconfig` change and no `wsl --shutdown` were needed. Windows `curl :8100/v1/models` → 200 in
    3 ms.
- **The recipe** (`farm/vllm/`: `install.sh`, `serve.sh`, `stop.sh`, `relay.py`; farm/README "Serving
  with vLLM on Windows (WSL2)"):
  - **Model:** Qwen3.6-35B-A3B NVFP4.
  - **`external`:** `parallel 48`, `contextLength 65536`, `vision true`. 48 is the spike's strictest
    figure at 64k (everyone pressing Enter together). vLLM pages its KV cache, so a seat is admission,
    not reserved memory.
  - **50 GiB KV pool:** that leaves 19.8 GiB free at peak, so the OCR model fits (owner decision 6), and
    the card stays at ~88.7 %, under the farm's 92 % eviction line.
  - **Stopping:** all three ways leave nothing behind (killing the launcher, closing the window, and
    `stop.sh`).
- **Live through a scratch test farm** (its own ports, beacon and plugins off, a stub Ollama), the first
  live check of `45d86c7`:
  - The farm reads the pool vLLM logs exactly (4,313,303 tokens).
  - 140 streams showed `busy` 128 and `queued` up to 8.
  - The perf block shows ~51 tok/s per person and 4,171–6,508 tok/s all together.
  - The pool warning fires at `parallel 96` ("68 can"), vision works, and an unhealthy server is followed
    by "is back".
  - Every metric name and label matches the fixture-based code.
  - **Fixed:** the panel said "Generating now 128/48". vLLM counts requests and 48 is seats, so it now
    says "N requests" for a vLLM.
- **Stop on vLLM:** `test/litellm-cancel.js` gains `LOL_CANCEL_ENGINE=vllm`, and all 10 paths pass,
  including **a non-streaming call abandoned while someone else streams**, the case llama.cpp b10670
  fails.
- **Thinking off reaches vLLM** through the farm's LiteLLM (`drop_params` on): 393 tokens, 984 characters
  of reasoning and 2.1 s become 14 tokens, no reasoning and 96 ms. vLLM ignores `think:false`.
- **One-box farms no longer cool their only deployment.**
  - The farm sets `allowed_fails: 1` for fast failover between hosts, which puts LiteLLM on its legacy
    cooldown path, past its own "never cool a single-deployment group" rule.
  - Once, under 140 streams, two dropped connections answered "No deployments available, try again in
    60 s" to everyone.
  - `buildLitellmConfig` now sets `disable_cooldowns` when no served name has 2+ deployments; several
    hosts and coordinator peers keep the cooldown.
  - **Honest note:** a sequential repro (500s, or dropped connections, on LiteLLM 1.90 and 1.97) did NOT
    lock out the next request, so the fix is defensive. LiteLLM accepts the key and starts fine, but its
    effect on that exact failure is unproven.
- **Open:** at 140 concurrent streams, LiteLLM adds 2.5–5 s per 200-token reply over going straight to
  vLLM (7–10 s vs 4.7 s).
- **Tests:** farm `npm test` **155/0** (the cooldown test, and the panel needle); the cancel check passes
  in fake mode.

## 2026-10-05 (08:49) — Thinking off for structured calls (owner decision 9)

- **Which flag reaches which engine** was measured, not assumed: a fake engine recorded what the farm's own
  LiteLLM config forwards (1.97.0 and 1.90.0, `drop_params: true`, the seat gate in front).
  - `chat_template_kwargs: {enable_thinking:false}` reaches vLLM and llama-server (`openai/`) at the top
    level.
  - `think:false` becomes Ollama's own field (`ollama_chat/`).
  - `reasoning_effort` is **dropped** on `openai/`, so it isn't used.
  - The client therefore sends the pair `chat_template_kwargs` + `think`. No farm config change was
    needed, and `test/litellm-cancel.js` now fails if a future LiteLLM drops either key.
- **The Computer:** the structured asks (json, list, verdict, agent step) send the pair. Text and code
  answers, LOL Vibe chat, OWUI chats and the coding agent are unchanged, and `thoughtOut`/`cutThinking`
  still handle a model that ignores the flag.
- **Open WebUI:** title and web-search-query generation get the same pair through `TASK_MODEL_PARAMS`
  (env, every launch). In 0.11.4 it is read in `config.py`, applied in `routers/tasks.py`, and lifted to
  the body's top level for an OpenAI connection. OWUI's own `generate_title`/`generate_queries`, run with
  the env set, carried both keys.
  - Setting it drops OWUI's title default of `max_tokens: 1000`, so that is restated. It now also caps
    the search query.
  - 0.10.x sidecars have no such setting and ignore it.
- **gemma4:12b** (the Ollama default) does think, per Ollama's `gemma4` renderer read on GitHub main.
  `think:false` is harmless on models that don't think.
- **Tests:** shell `chat-unit` 1794 → **1797/0**, `test:unit` 5, lint 0; farm 154; the cancel check
  passes on both LiteLLM versions, including the thinking keys.
- **Not yet on a real engine:** the vLLM end-to-end check is with the recipe work.

## 2026-10-05 (08:30) — Does Stop stop the engine? Real engines measured; the chat harness 406/406; three more owner decisions

- **Phase 0.0's last link, on real engines** (granite4.2:8b on the RTX PRO 6000, LiteLLM 1.97 and 1.90).
  `farm/test/litellm-cancel.js` gains an opt-in real-engine mode (`LOL_CANCEL_ENGINE=llamacpp|ollama`),
  timed by the engine's own task log (`cancel task`, `release … n_tokens`). It never polls `/metrics`
  mid-trial: polling would itself cause the bug it measures.
  - **Ollama 0.34** stops on every path (direct `/api/chat` and `/v1`, via LiteLLM, via the seat gate;
    stream and not) within 16–71 ms, and answers the next request in < 60 ms.
  - **llama.cpp b10670** stops streams within 8–13 ms, and a lone non-streaming call ~1 s after the abort.
  - **But a non-streaming call abandoned while someone else streams runs to its end** (9.8 s, all 2,000
    tokens). The handler only checks for a closed client when a 1 s wait times out, and every result
    posted for any request restarts that wait (upstream `server-queue.cpp` `recv_with_timeout`, still on
    master, per the agent's source reading). So the llama.cpp mode fails on purpose until a pinned build
    is fixed.
  - The default fake-engine mode still passes. The `litellm.js` comment and `farm/README.md` now say
    this.
- **The chat harness** (shell, beside the owner's open client; own user-data, non-beaconing mock):
  **406/406** and perf **9/9**, the same as v0.2.7. Multi-user 1.6 and the new 429 sentence needed no
  fixture change.
- **Owner decisions** (plan §13, 9–11):
  - Thinking off for **structured calls only**: the Computer's json/list/verdict/agent asks and
    background tasks; chat unchanged.
  - vLLM **managed on the Spark**. On the PRO 6000, fix the WSL TCP blocker first, then an
    operator-run `external` **recipe**.
  - **Move ComfyQ** off the PRO 6000, which makes the spike's exclusive-GPU numbers the real ones.

## 2026-10-04 (22:05) — The engine × model spike on the RTX PRO 6000: vLLM + Qwen3.6 serves ~100 people at 32k

Phase 0.6, run 12:55–22:03 with the GPU exclusive (ComfyQ and the farm stopped), so these are ceilings.
`docs/spike/RESULTS.md` has every table and the exact commands; `results/` holds the raw JSON.

- **Setup:** vLLM 0.30.0 in its own WSL2 venv (torch 2.13 + cu132, FlashInfer 0.6.18), against the Farm
  app's llama.cpp b10670. Three NVFP4 checkpoints, none gated: 67 GB downloaded at 10–16 MB/s.
- **The pass rule:** TTFT p95 < 5 s and 90 % of replies at ≥ 15 tok/s. "Every turn" counts everyone's
  first message with all of them starting within 3 s; "steady" counts later turns.
- **vLLM + Qwen3.6-35B-A3B:** 96 / 128 people at 32k, 48 / 64 at 64k, 32 / 40 at 128k, and the best
  quality (27/28, and 28/28 with thinking off). The pick for "people × quality × context".
- **vLLM + Nemotron 3.5 Lightning:** 160 / ≥ 192 at 32k, up to 4,959 tok/s aggregate. Slightly lower
  quality and no vision, so it suits the Computer and big head counts.
- **vLLM + Qwen3.8-27B (dense):** 16 / 32 at 32k. It is KV-bound: 35 KB per token, against 11 KB for
  Qwen3.6 and 3.9 KB for Nemotron.
- **vLLM against llama.cpp:** 24–40× more people on the same model (Nemotron 160–192 vs 4–8).
  - llama.cpp's aggregate flattens near 600 tok/s, against ~5,000.
  - vLLM's prefill is 3× faster.
  - llama.cpp is slightly faster for one person.
  - **llama.cpp + Qwen3.8 serves 1 person.**
- **Thinking off** scored the same or better on every model, using 5–9× fewer tokens.
- **How people arrive matters most:** a class pressing Enter together binds the chat at 64. A cold 128k
  prompt takes 5.7–20.9 s even alone, so long contexts only work built up turn by turn.
- **NVFP4 on sm_120:** the MoE checkpoints' experts are W4A16, so they run through Marlin; dense FP4 is
  native.
- **WSL2 workarounds:**
  - FlashInfer's compiler needed toolchain pins (nvcc/crt/nvvm at the runtime's 13.2) and a link shim.
  - **vLLM's TCP port never answered under mirrored networking**, so the spike used a Unix socket. The
    farm's Windows-side LiteLLM needs TCP, which blocks that path until fixed (plan §13 decision 10).
  - The spike also used a stdin-EOF watchdog.
- **The box afterwards:** VRAM back at 1.56 GB, no processes left; `~/lol-spike` is 71 GB.
- **`SPARK_HANDOFF.md`** now matches the final README: the same 0.30.0 via `install_vllm.sh`, TCP,
  192 sequences, a KV budget fitted to unified memory, and the `--append` follow-ups.
- **New owner decisions** (plan §13): 9, thinking off where; 10, vLLM's shape per box, including the WSL
  TCP blocker; 11, ComfyQ beside the farm on the PRO 6000.

## 2026-10-04 (18:05) — The workshop setting: "Free an idle seat after", applied live

Owner decision 1.2. The panel's Backend card gains **Free an idle seat after** (1, 2, 3, 5, 10, 15, 30 or
60 min, plus the current value if it is not in that list), shown while the seat gate is on, including
under an external server.

- **How it applies:** it sets `proxy.seatIdleSec` through the one **Apply changes** and is written to
  `lol.config.json` (raw patch).
- **Alone it restarts nothing**: `applyFarmSettings` returns before any job. The gate and the snapshot
  already read the value through a thunk, so the release window, `Retry-After`, the 429 wording and
  `capacity.seatIdleSec` follow on the next request.
- **With other changes,** it lands only after their restart succeeds, so a rollback still means "nothing
  changed".
- **The check:** `POST /lol/admin/apply` takes `seatIdleSec` (60–3600 s) and refuses anything else in
  plain words, through one check, `seatIdleChange()`.
- **A panel fix on the way:** the select joined `settingsDirty()`. Without it, the 5 s poll would reset an
  unapplied change.
- **Tests:** farm `npm test` 152 → **154** (the live gate and the file; the panel row). CLAUDE.md's
  admin-panel line is updated.

## 2026-10-04 (18:00) — The owner settles the open multi-user decisions

All recorded in `docs/archive/plans/multiuser_implementation_plan.md` §13 and the sections they touch.

- **Full farm:** the engine queues. With vLLM, seats are set near what the card serves at acceptable
  speed (the spike's latency-bounded count), and vLLM's scheduler queues the rest; the 429 becomes a
  rare safety valve.
  - Plus a **workshop setting**: a panel control for the seat hold (`proxy.seatIdleSec`).
  - The farm's fair queue is built only if the gate's new metrics (3.3) show frequent refusals.
- **Web search's per-message cost:** measure first (the query generation plus the injected pages), then
  turn query generation off or make web search off by default.
- **OCR beside vLLM:** reserve ~9 GB, about 14 % of the KV pool and free in practice, since memory isn't
  the limit on hybrid models. The 2026-08-26 no-reserve rule stays for llama.cpp on small cards.
- **Cut:** QVAC plugins (4.2), overflow to a weaker model (3.2, against the quality goal), TLS (a closed
  LAN).
- **Not cut:** the laptop model (4.3) becomes an open **use-case study**. Which uses (titles, the
  Computer's small calls, offline chat), on which laptops, at what speed and quality, measured with the
  spike harness on a few machines. CLAUDE.md's "inference goes to the farm, not the laptop" would need
  the owner's amendment if it goes ahead.

## 2026-10-04 (17:50) — The engine × model spike, in progress: harness and first results committed for the Spark run

Phase 0.6 is running on the RTX PRO 6000. ComfyQ was stopped by the owner, so the card is free. vLLM 0.30
is in its own WSL venv (`~/lol-spike`); Rtranslate's 0.14.0 is untouched.

- **The harness**, in `docs/spike/`, is committed now so tomorrow's Claude instance on the DGX Spark
  can pull it (`SPARK_HANDOFF.md`):
  - `spike_bench.py`: chat, long, agent and follow-up profiles, a concurrency sweep, thinking on/off.
  - `quality_set.json`: coding with asserts, reasoning, and tool-calling round-trips.
  - The serve and stop scripts, and `runs/` (the suites).
- **Measured so far:**
  - llama.cpp b10670 (Nemotron Lightning and Qwen3.8-27B at `--parallel` 8/16).
  - vLLM: Qwen3.6-35B-A3B NVFP4 (two configs), then Nemotron 3.5 Lightning NVFP4.
- **KV capacity on the 96 GB card** (vLLM's own figures, people = pool ÷ context):

  | Model | Pool | 32k | 64k | 128k |
  | --- | --- | --- | --- | --- |
  | Qwen3.6 | 5.5M tokens | ~168 | ~84 | ~42 |
  | Nemotron Lightning | 15.9M tokens | ~485 | ~243 | ~121 |

  Memory is not the limit on hybrid models. The latency-bounded counts (TTFT p95 < 5 s and ≥ 15 tok/s)
  and the quality scores come with `docs/spike/RESULTS.md` when the run ends.

## 2026-10-04 (14:19) — Multi-user 3.3, minimal: what people met at the gate

Decision 2 of the plan (keep the 429, or queue) now gets numbers instead of guesses.

- **What the seat gate counts** (`seats.js` `createGateStats`), over the last hour and since start:
  - generations let in, turned away (429) and refused for a wrong password (401);
  - replies the person stopped, and how many of those before the first word;
  - the fullest moment (N of M seats, at HH:MM);
  - the wait for a stream's first word, from the request reaching the gate to its first byte (p50/p95).
- **Privacy:** counts only, in memory. 60 one-minute buckets plus the totals, wait times binned, about
  13 KB whatever the traffic. Never an address, id or content, and everything resets at restart.
  - A test checks that every argument the gate hands the stats is a number or a boolean.
  - These are counts of **requests**, not people: a retried 429 counts twice.
- **Where it shows:** the panel's Clients card (its folded title says "N generations turned away in the
  last hour" when there are any) and token-gated `/lol/admin/state` `capacity.metrics`. Not in the beacon
  or the public snapshot, since no client reads it.
- **Tests:** farm `npm test` 149 → **152 passed**; shell `chat-unit` still 1794/0 (the mock reads
  `seats.js`).

## 2026-10-04 (14:08) — Multi-user 1.6: the client stops wasting seats (own seat, 429s, the agent's retries, small windows)

Item 1.6 of the multi-user plan, in `shell/` only. Results: build clean, `test:unit` 5/5, `chat-unit`
**1794/0**, `chat-lint` 0.

- **Phase 0 broke one test, now fixed.** `cfc3723` changed the farm's 429 sentence, and the shell's mock
  copy (`test/mock/seats-body.js`, checked against `farm/src/seats.js` by `mock.test.mjs`) still had the
  old one. Its 502 regex had also started matching the new 401 first. Both are fixed, and two fixture
  sentences now match the new wording.
- **The Computer's own seat.** Unicast `/lol/self` carries `capacity.mine`, and the farm half landed at
  14:01. `discovery.ts` keeps the last unicast value when a beacon arrives without it, so the lane
  doesn't flicker between polls. `freeSeat()` honours it: a person who chatted a minute ago can run
  model boxes on a full farm. Still one background request at a time, and Send still aborts it.
- **A 429 to a Computer box is `busy`:** no Cap generation, and the run yields. It is mapped once, at the
  ask layer (`farmFailure`), so the runner's existing no-seat path takes over.
- **The coding agent stops knocking on a full farm.**
  - LOL's dsh patch now carries a `retryPolicy` without `RATE_LIMIT`. 5xx and timeouts are still retried,
    since a LiteLLM restart answers 502.
  - A refused turn ends as `seats-full` with the farm's sentence, and LOL Vibe's seat-wait resends it.
  - Checked on the real dsh 0.1.7-rc.2 runtime against a fake farm: a 429 now gets **1 POST (was 5+)**,
    and a 502 is still retried.
  - `session-title-llm` is also off in LOL's patch. The sdk bundle already had it off, so this only pins
    it against a version bump. The audit's "neither disabled" was half wrong.
- **Small windows.**
  - The agent's window is clamped as LOL Vibe clamps its meter (1024–262144). The live farm advertises 1M
    per slot.
  - "Keep going" lowers its reply room on small windows, so dsh's compaction still triggers at ≥ ¼ of the
    window: 32k → 16384 (unchanged), 24k → 14336, 16k → 8192.
- **Agent pages use the farm's default model.** `/lol-farm.json` gains `defaultModel`, still with no
  credential (CLAUDE.md and IDE_PLAN updated). The old first-model fallback stays for older data.
- **Not run:**
  - The chat harness: it uses its own user-data and is safe beside the open client, but it starts
    Electron with the GPU, and the spike owns the GPU. It runs after the spike.
  - No live farm for (a): it was checked against the agreed contract and the farm's test.
- **`chat-scope.js` reports 29 violations:** it is the LOL Chat vNext phase's allowlist gate, and every
  `farm/` file on this branch is outside that allowlist by design. It is not part of the release
  checks.

## 2026-10-04 (14:01) — An external vLLM, read: live load, a Performance card, a pool check; `capacity.mine`

Phase 2 step (a) of the multi-user plan: the farm still never installs or starts the server (2026-09-07),
but now **reads** it. Farm `npm test` 146 → **149 passed, 0 failed**. No GPU used and no live vLLM was up,
so the metric fixture is built from vLLM's source (0.14.0 installed in WSL; v0.8.5 to main on GitHub), not
a capture.

- **Detection:** when `external` is a vLLM (its `/metrics` carries `vllm:` series; no new key), the health
  tick reads it through the shared `fetchMetrics`, which now takes a URL, a bearer and https.
- **What it feeds:**
  - `capacity.busy/queued` ← `num_requests_running/waiting`.
  - The Performance card shows running/waiting, KV used %, the KV pool in tokens, prefix-cache hits,
    tok/s per person (generated tokens ÷ the inter-token-latency sum, which means the same as llama.cpp's
    figure even under speculative decoding), tok/s all together, and draft acceptance.
  - The 0.9 and 0.11 metric renames are read as fallbacks.
- **Pool check:** the KV pool (`cache_config_info`: `kv_cache_size_tokens`, else blocks × block size, an
  upper bound on hybrids) is checked against `parallel × contextLength`. It warns at boot and on the card
  when the declared seats can't all hold their full window at once.
- **Seats unchanged:** `slots` stay `external.parallel` and `slotsVerified` stays false. The metrics can
  show a declaration does not fit, never that it does (no `max_num_seqs`/`max_model_len` metric), so
  "verified" would be the pessimistic guess 2026-09-07a warns against.
- **The panel:**
  - llama.cpp's card is byte-identical: four render states diffed, and a test pins its key set.
  - The "Capacity is unverified" row, with its Ollama advice, now shows only on Ollama. It wrongly
    showed on external.
- **`capacity.mine`:** unicast `GET /lol/self` now says whether the **caller's** IP holds a seat. The
  beacon broadcast never carries it. This is the farm half of the Computer's own-seat fix (1.6).
- **Fixed on the way:** a `/metrics` body that stalled never settled `get()`, which froze the whole health
  tick, including the external engine's death probe.

## 2026-10-04 (13:39) — Multi-user Phase 0: the seat gate checks the password, stopping a reply reaches the engine, farm restarts stop rebooting clients

Phase 0 of `docs/archive/plans/multiuser_implementation_plan.md` (rev. 3), branch `multiuser-phase0`. No GPU was used: a
measurement spike owned the card. Farm `npm test` went from 141 to **146 passed, 0 failed**, including
`check_services.py`.

- **Stop reaches the engine (0.0).** LiteLLM is pinned at `litellm[proxy]==1.97.0`
  (`commands/install.js:149`): the version the Farm app has run since 08-17, where the repo's dev venv
  had 1.90.0. Existing venvs are not upgraded.
  - `farm/test/litellm-cancel.js` (~30 s, not in `npm test`) checks it. A fake engine speaks both of the
    farm's routing shapes (`openai/`, `ollama_chat/`), the real seat gate sits in front, and LiteLLM
    runs from the generated config.
  - **Streams:** the engine saw the close 1–5 ms after the client aborted, on 1.90 and 1.97.
  - **Non-streaming calls** (agent pages, OWUI's title) ran to the end for nobody, until the generated
    config turned on LiteLLM's `general_settings.cancel_on_disconnect`. Now 1–2 ms.
  - Still unmeasured: whether real llama-server and Ollama stop generating on that close.
- **Seat gate (0.1, 0.2).**
  - The farm password is checked **before** a seat is claimed (`seats.js` `keyOk`): `Authorization:
    Bearer` or `x-api-key`, both hashed, constant-time compare. A wrong or missing key gets 401 and no
    seat. Before this, a keyless POST held a seat for 15 min on a passworded farm.
  - Every LiteLLM generation route is now gated: completions under all prefixes, responses,
    `/v1/messages`, Gemini's `:generateContent`. Before, only 4 spellings were.
  - The path is decoded first, which closes a `/v1/chat%2Fcompletions` bypass.
  - `Retry-After` now says when the soonest idle seat frees, matching the message (it said 30 s against
    "~15 min").
- **Farm restarts no longer reboot every client's Open WebUI (0.3).** The OCR key was random per start
  and rides into every client's OWUI env, so every farm restart or OCR toggle restarted every client's
  sidecar. Plugin keys are now HMACs of one persisted secret, `farm/.lol-secret`, next to `.lol-id`;
  `keyId` is stable. The secret is git-ignored and excluded from the Farm app's bundle and its copy
  into `userData/farm`. Changing the password no longer rotates plugin keys; deleting the file does.
- **OCR vision calls take turns (0.4).** A `BoundedSemaphore` (`OCR_CONCURRENCY`, default 1) around the
  Ollama call only. Pages wait their turn and are never refused, since a 429 would be a failed upload in
  OWUI. Text-layer pages skip the queue, and the log no longer names files.
- **`lol bench --people` (0.5)** sends each simulated user from its own 127.0.0.x (binding verified on
  Windows), so a bench can hold several seats. Also new: `--cancel F` and `--out file.json`. It is
  opt-in, because those seats stay held for `seatIdleSec` after a run.
- **llama.cpp auto context budgets against free VRAM (0.7).** On this box ComfyUI kept ~45 GB resident,
  and auto sized against the card's total. Now it uses min(total, free at start) −
  `llamacpp.gpuReserveGb` (a new key, default 0). The farm's own Ollama models still count as free,
  because pressure eviction frees them (2026-08-26). Example, Qwen3.8-27B on the 96 GB card: 1,171,456
  tokens against the whole card, 557,056 with 51 GB free.

Not done here: the engine × model spike (0.6) is running separately (`docs/spike/`).

## 2026-10-04 (11:40) — The multi-user plan: audited against the code, critiqued, revised with the owner's decisions

The owner brought a multi-user brief written from the READMEs without the source. It was handled in
three passes, all read-only on code:

- **The audit:** three agents covered the farm, the shell + OWUI 0.11.4, and LOL Vibe + the Computer,
  and every load-bearing claim was re-read by hand
  (`docs/reviews/MULTIUSER_PLAN_AUDIT_2026-10-04.md`).
  - Already implemented: cancel-on-disconnect, half of the background-task item.
  - Wrong: OWUI 0.10.2, the admin API, `OPENAI_API_KEYS`, ~28 GB, the Computer as "many short calls".
  - Latent bugs found: seats claimed before the password, per-start plugin keys rebooting OWUIs, and
    bench being one seat.
- **The critic:** an adversarial agent weighed revision 2 against the vision
  (`docs/reviews/MULTIUSER_PLAN_CRITIC_2026-10-04.md`). It caught two wrong inferences of the reviser's:
  - Bench *can* measure engine concurrency, since one seat admits unlimited streams.
  - Raising slots is not a free click: the pool stops at the native max, so 16 slots means a 16k floor,
    which flips RAG mode and reboots every OWUI.
- **The owner's decisions** (revision 3):
  - Optimise people × quality × context per **big** box.
  - The 4070/4080-class GPUs are booked for 3D/VR and are not farm capacity.
  - vLLM stays in scope.
  - No per-person identity.
  - A measured people-per-box table decides future purchases (Sparks vs RTX PRO 6000-class).
- **Also found today:** ComfyUI (ComfyQ) keeps ~45 GB of the PRO 6000 resident while idle, and WSL's
  only vLLM is Rtranslate's 0.14.0.
