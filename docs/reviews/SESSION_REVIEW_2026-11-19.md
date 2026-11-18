# Session review of 2026-11-19 (night n° 10, extended)

*The second adversarial review (the skill `lol-review`), run in the second half of an extended night whose first half was
the owner's HyperQwen and CodeAF evaluation ([research](../research/2026-11-19-codeaf-hyperqwen.md)) and the plan it
led to ([VLLM_DRAFT_PLAN](../plans/VLLM_DRAFT_PLAN.md)). Scope: the 48 commits since the last review's summary
(`2026-11-15-n5.md`), sessions n° 6 to n° 10, **unreleased work first**: LOL Vibe's page beside the chat and in its own
window (VIBE_PAGE_PLAN steps 1–2, client, not released) and Qwen3.8's drafting (VLLM_DRAFT_PLAN, farm, not released);
then what v0.2.18 and v0.2.19 brought (OWUI_START_PLAN, the repair button, the Agent box's loop stop, the review fixes).
The area in depth, in rotation after the 2026-11-15 review's "what a student meets": **the farm**.*

**How it ran:** reading as someone who wants each change to fail, with tonight's real runs as evidence (a scratch farm
from the checkout and the J19 rehearsal served hundreds of requests through the gate and LiteLLM, the agent's tasks,
streamed tool calls, 30 people at once); one read-only explorer mapped the farm's HTTP routes and their auth, each claim
used here checked again in the code.

**Suites (00:13–00:30):** shell `npm run test:chat` 1981 passed, 0 failed, 1 skipped, lint 0 violations in 296 files;
farm `node test/run.js` 288 passed (22:55 and again in this run); farm-app `npm test` **hung** (L7, fixed: 12 + 3
passed); `farm/vllm/test_scripts.sh` in WSL 129 passed; `shell/test/page-window-e2e.cjs` on the real app ok (after L5).

## Findings, by severity

No high finding. Each: where · what is wrong · the proof · the fix.

### Medium

**M1 · Tonight's own work · `.claude/skills/lol-scratch-farm/SKILL.md`, `docs/spike/runs/draft_test_farm.mjs` · the
night's scratch farm wrote 8 GB into the owner's Ollama models folder.** The scratch config pointed `ollama.hosts` at
port 11500 with no scratch Ollama started there, so `lol up` started the `ollama` on PATH (the Ollama app's,
`AppData\Local\Programs\Ollama\ollama.exe`) with its default models folder (`C:\Users\<owner>\.ollama\models`) and pulled
the config's `gemma4:12b` into it (23:11–23:23; the rehearsal at 23:42 found it). Every farm runs an Ollama and pulls its
`models`, vLLM farms included (`up.js` `ensureOllama`, `pullMissing`). *Proof:* `up.log`: `OLLAMA_MODELS:C:\\Users\\…\\.ollama\\models`,
`pulling bb722270d543 — …/7.4 GB`, `POST "/api/pull" 200 11m40s`. Nothing was deleted or changed in the folder; one model
was added; that Ollama stopped with `lol down` (no `ollama` process at 00:21). *Fix (tonight):* the skill now says to
start the scratch Ollama before `lol up` and why; J19 and its script say plainly that the test farm uses the Ollama
app's binary and models folder (it pulls nothing now: the model is there). Removing the model is the owner's call
(`ollama rm gemma4:12b`).

### Low

**L1 · Fixed tonight · `shell/src/main/sidecar.ts:422` (`repairDb`) · the main process repairs on any error, not only the migration
failure.** It checks that Open WebUI is in the error state and not running, never `this.migrationBroken` / the state's
`repairable`; only the renderer's button (shown when `repairable`, `renderer/app.js:902`) keeps it to that case. *Proof:*
the code; no path calls `repair-owui-db` but that button, and the button disables itself on click, and the panel is
re-rendered only on Open WebUI's state events (`app.js:1114-1118`), the next of which after a repair is *starting*: no
double repair was found. *Fix (tonight):* `repairDb` refuses unless the state is `repairable`, and clears it as it repairs, so a second call is
refused too; `shell-main.test.mjs` failed first (a good database was moved aside), then passed.

**L2 · `shell/src/main/sidecar.ts:313` · a first-start marker that cannot be removed sets a used database aside at the
next start.** On a healthy first start the marker is removed with `rmSync(…, {force:true})` in a `try` whose catch says
"removed at the next healthy start"; but the next start runs `setAsideUnfinishedDb` **first** (`:268`), which finds the
marker and moves `webui.db`, by then holding the session's chats, into `interrupted-<time>/`. Moved, not deleted, but
the person meets an empty Open WebUI. *Proof:* the code path, not reproduced (needs `rmSync` to fail: a lock on a
synced Documents folder is the plausible case). *Fix:* when the removal fails, keep that in memory and retry it, and
make `setAsideUnfinishedDb` leave a database alone when the marker is older than Open WebUI's last ready (a
`lol-owui-version`-style record written at ready).

**L3 · Fixed tonight · `farm/src/config.js:605` · the admin token's comment said only `/lol/admin/state` and the POST
routes need the token.** The code requires it on every `/lol/admin/*` route but the page itself, the vLLM log's GET
included (`selfServer.js:175-177`); `farm/README.md:1352` was already right. *Fix:* the comment now says so.

**L4 · Fixed tonight (JSON only) · `farm/src/selfServer.js:140-145`, `farm/src/commands/up.js:1935-1963` · any page or script on the LAN can make a
farm look full to the laptops choosing one.** `POST /lol/client-ping` is open and reads its body whatever its content
type, so a cross-site `text/plain` post (no preflight) is accepted; its ids (up to 200, the oldest evicted) are the
`clients` of `/lol/self`, and a client choosing the least busy farm reads load as `clients / slots`
(`shell/src/main/farmSelect.ts:45`). *Proof:* the code path (not run). Sticky and pinned laptops are not moved; the
farm is open on a trusted LAN by design. *Fix (tonight):* `/lol/client-ping` answers 415 to anything but `application/json` (a browser then needs a
preflight the farm does not answer); every client since its first version (2026-07-05) sends JSON. The test failed
first (a `text/plain` ping was counted), then passed. The per-address cap was not built: a script on the LAN itself is
inside the farm's trust stance.

**L5 · Fixed tonight · `shell/src/main/pageWindow.ts:140-144` · the page window may write edits on any answer, not only the one it was
given.** `page-window-edits` checks the sender is the page window and the shape, then passes any `threadId`/`msgId` on;
the main window writes them (`render/page-run.mjs` `writeEdits`, which does nothing for a message it cannot find). Only
our own page script can send it (the guest frame has no door), so this is hardening. *Fix (tonight):* edits pass only for an answer delivered to
that window in its life (not only the last: a switch flushes the previous page's typing after the new page arrives);
the routing test failed first, then passed; `page-window-e2e.cjs` ok on the real app.

**L6 · `shell/src/main/index.ts` (the main window's `closed`) · quitting from the main window loses the page window's
last half-second of typing.** The main window's `closed` closes the page window, whose `pagehide` then sends its
pending edits (`page-window.mjs`), but main forwards them to a main window that is gone. *Proof:* the order of the code
(not run). Typing in the page window and quitting the app within ~0.85 s (the editor's 250 ms and the save's 600 ms).
*Fix:* on the main window's `close` (before `closed`), ask the page window to flush and wait briefly, or close the page
window first.

**L7 · Fixed tonight · `farm-app/test/supervisor.test.js` · the Farm app's suite passed only while the farm people use
was up on this box, and hung otherwise.** Two tests swapped a stub for the real module and left it in Node's cache:
the Linux autostart test (`fresh('util')`) and the `reapStaleFarm` test (the real `farmProcess`). Every later supervisor
then ran the real `waitForHttp` against `127.0.0.1:41997` and the real `lol down`; the last test (the LiteLLM update's
announce) waited up to 5 silent minutes in `waitHealthy`. *Proof:* tonight, with no farm on 41997, `node
test/supervisor.test.js` hung at its 12th test three times (exit 124 under `timeout 60`); bisected pair by pair: test 7
(`fresh('util')`) with the last hangs alone, test 6 (the reap) with the last hung too. *Fix:* both tests put the stub
back (`UTIL_STUB`, `FARM_PROCESS_STUB`); 12 passed twice with nothing on 41997, `npm test` 12 + 3.

## Questions (not proven)

- **A model-written page and the microphone:** the sandbox's guest is refused the microphone by its iframe (opaque origin,
  `allow=''`, `renderer/chat/sandbox/host.mjs:262`), not by the session's permission handler, which grants `media` to any
  `file://` frame (`shell/src/main/serial.ts:28`) and the runner is one. No runtime test proves the refusal in either
  window. A harness scenario calling `getUserMedia` from a page would.
- **Which state charge governs preemption** (VLLM_DRAFT_PLAN ▸ Limits): the catalog's 6 pages of measured use or the 12
  vLLM's admission reserves.

## Checked and found sound (so the next review does not redo it)

- **VIBE_PAGE_PLAN's window:** built as the main window (context isolation, no Node in the page, the same preload, the
  same session, WebRTC off); `will-frame-navigate` → `frameAllowed` (the main frame stays on its file, a subframe only
  the runner); new windows refused, `http(s)` links to the system browser only; every IPC checks its sender and shape
  (`validPageTarget`, `validPageEdits`: 64 blocks, 2 MB, ids `^[\w.:-]+$`); a deleted answer is not written
  (`writeEdits` → `messageOf` null). The guest has no door (preload strips it from subframes).
- **The repair button's double click:** the button disables itself, and no re-render brings it back before *starting*.
- **The Agent box's loop stop:** a step's key includes its result, so a step that reads something changing is never
  stopped; three equal reads in a 6–12 step box are a stall.
- **The farm's routes:** every `/lol/admin/*` but the page needs the token, compared in constant time
  (`selfServer.js:88-96`), 400 ms after a wrong one; no cookie, no token in a query string; no route reflects input; a
  cross-site fetch cannot add `Authorization` without a preflight, which gets 401. `/lol/self` gives plugin keys only on a
  farm with no password (`snapshot.js:274-295`, by design: zero client setup).
- **Privacy under load (tonight's runs):** the scratch farm's log (481 lines), the rehearsal's (162) and vLLM's own
  (42,936 lines) hold none of the text sent (the train question, Lyon's weather, the agent's task files, tool calls); no
  "Received request" line; LiteLLM runs with `telemetry: false`, no callbacks, no database.
- **VLLM_DRAFT_PLAN:** every reader of a person's memory goes through `facts()` (`vllm.js` 446, 517, 575-580); `gpuFit`
  reads the smallest model's weights (Gemma 4 12B), unaffected; presets set people to Automatic and never pick Qwen3.8 by
  hand; vLLM 0.30.0 (a farm never updated) knows `draft_sample_method` and `qwen3_5_mtp` (read in its source); the fake
  vLLM of the lifecycle test does not parse flags strictly and never runs Qwen3.8; the test farm reads only its own vLLM
  root (`isOrphan` applies only when the engine is not vLLM), and quitting the Farm app runs `lol down`, which stops its
  vLLM (`farm-app/src/main/index.ts` before-quit). A person's Stop under drafting: `litellm-cancel.js` PASS on all ten
  paths.
- **Docs of tonight's work against the code:** `farm/README.md` (the table and its paragraph), `docs/context/farm.md`
  (seven models in the list: counted), HUMAN_TESTS J19 (the panel's address `/lol/admin`, the farm popover's cards and
  *Automatic — least busy farm*, the ready line, 10–15 minutes as rehearsed: corrected tonight).
