# Session review of 2026-11-24 (night n° 15)

*The third adversarial review (the skill `lol-review`). Scope: the 134 commits since the last review's
(`b0ecae8`, [SESSION_REVIEW_2026-11-19](SESSION_REVIEW_2026-11-19.md)), sessions n° 11 to n° 14 and the day work of
2026-11-23, **unreleased work first** (the farm: Qwen3.8's 16-bit state, 128k by default, the panel's bar and its
note, `serve.sh`'s kernel folders); then what v0.2.20 brought (released 2026-11-23: Plan first and its buttons, the page
beside its code, the document read once per chat, the Computer's lost wake-up). The area in depth, in rotation after
the farm: **the client shell and Open WebUI's contract**. Beside it, while the card was free: J19's measured parts and
FARM_START steps 3 and 4 measured (the owner's yes, 2026-11-23 12:11). The Farm app was off at 02:00 and stayed off.*

**In numbers:** 9 findings (2 medium, 7 low); 6 fixed tonight (M1, M2, L1, L4, L5, L6), 3 filed (L2 needs the owner: a
folder to delete; L3 and L7 for Later); 2 questions, both answered the same night (1 by measurement, which became
QWEN36_FP16_STATE_PLAN and showed its accuracy cost; 2 proved and fixed as M2). **The next review's area** (the rotation): LOL Vibe and the IDE.

**How it ran:** reading each change in scope as someone who wants it to fail, with tonight's real runs as evidence: J19's
test farm from the checkout (Qwen3.8 drafting, its start from an empty kernel folder, a restart, 30 people through the
gate, the agent's five tasks, the panel in headless Edge), and FARM_START step 3's cold starts of Qwen3.6 and Qwen3.8
on the trial root. Three read-only explorers mapped Open WebUI's contract surface and fact-checked `client.md` and
`farm.md` (+ the farm README's first 610 lines) against the code; every claim used here was re-read in the code.

**Suites (02:19–02:24):** farm `node test/run.js` **293/293** (after M1's fix; 292 + the new check failing before it);
shell `npm run test:chat` **1989 passed, 0 failed, 1 skipped**, its lint rules 0 violations in 296 files; farm-app
`npm test` **12 + 3**; `farm/vllm/test_scripts.sh` in WSL **131/131**; the client harness, full run (03:42–03:58,
v0.2.20's code: Plan first's buttons, the page beside its code, the Computer's wake-up) **423/423**. Its first try
aborted at once, *cdp port 9333 is already in use*: my own headless Edge for the panel shots had left processes
holding that port (stopped, then the run). Not run: `shell/test/e2e.js` (it cannot run on this computer).

## Findings, by severity

Each: where · what is wrong · the proof · the fix.

### Medium

**M1 · Unreleased farm work (FARM_START step 2, 2026-11-23) · `farm/src/vllm.js` `PHASES.kernels` · the panel promised
*up to 5 minutes* for a phase that took 7 min 34 s.** Step 2 was built so that nobody stops a start a minute from ready,
and it gave the kernel phase *preparing the GPU (seconds; up to 5 minutes once after vLLM is installed or updated)*, a
bound taken from Qwen3.6's rebuilds (168–250 s). *Proof:* tonight's test farm, Qwen3.8 (drafting, 32k) on a root with an
empty kernel folder: `~/lol-vllm-033/logs/vllm.log`, the first JIT build at 02:03:14, graph capture at 02:10:48, so the
phase that text names ran 7 min 34 s; the whole start 605 s (02:01:46 → ready). A person told *up to 5 minutes* sees
minute 6 go by on Qwen3.8, the model the owner keeps for coding. **And the cause was wider than step 2 named:** a model's first start builds
kernels of its own. Qwen3.6's cold start built 6 modules, Qwen3.8's 10; they share 5, and Qwen3.8's own include
`fp4_gemm_cutlass_sm120` (about 2½ minutes) and four attention kernels for its head ratio (`head_group_ratio_6` against
Qwen3.6's `_8`; the module names in `scratchpad/step3/*.modules`, from `~/lol-vllm-033/logs/vllm.log`). So the first
*Use this* on a model is slow too, and its confirm said *about 2 minutes*. *Fixed tonight* (a run reproduced it; test
first): the phase says *seconds; several minutes the first time with a model, or after vLLM is installed or updated*, no
number; *Use this* says *about 2 minutes, longer the first time with a model*; the test fails on a bound under 8 minutes
and on either sentence missing; farm.md and FARM_START_PLAN say so. Not released (the next Farm app), so no person met it.

**M2 · `farm/vllm/status.sh` (released since farm-v0.0.44, `f4fe62c` 2026-10-07) · a Stop of a model Download leaves
the model "only partly downloaded" for good.** The rule counted any `*.incomplete` under a model folder. huggingface_hub
(2.4.0 in the trial roots; `install.sh` takes the latest) downloads each file to a uniquely named temp file
(`<hash>.<ETag>.<8 random hex>.incomplete`, PR #4228) and removes it in a `finally:` that a TERM never reaches; a Stop
is `stop.sh install`, a TERM to the download's group. The next Download finishes the file under a new temp name and
leaves the old one, so the farm keeps serving Ollama and saying *press Download to finish it*, which cannot. *Proof:* in
the scratch folder, `hf download openai-community/gpt2 model.safetensors --local-dir …`, a TERM to its group after 6 s,
then the same download to its end (548,105,171 bytes): the 0-byte `….956aec2f.incomplete` stays, and the rule says
`partial=1`; seen for real on `~/lol-vllm-034`'s Gemma 4 26B (two such files, J15). *Fixed tonight (test first):* an
`.incomplete` whose ETag already has its `.metadata` beside it does not count (`status.sh`; `test_scripts.sh`
*status*: a whole model with a stale temp file → `partial=0`, a file still downloading → `partial=1`; it failed on the
old rule; 133/133; the real gpt2 folder now reads `partial=0`). HUMAN_TESTS K6 step 3 (*Stop it half-way, Download
again*) covers it for a person. Not released: until the next Farm app, a stopped Download's stale file can be deleted by
hand.

### Low

**L1 · `docs/context/client.md` · three behaviours of the coding agent were in no context module** (CLAUDE.md: a
module is true or it is fixed). Its session logs older than 30 days go at each start (`studio.ts` `pruneSessions`,
`SESSION_KEEP_DAYS`, :60–97, :548), dsh's own plan mode is off (`buildPatch` `'plan-mode'`, :183), and a reply that ends
without a word says one of three things (`projects/agent.mjs` `resultOf` :148–152, `agent.en.mjs` :42–44). *Proof:* a
read-only fact check of client.md against the code (an explorer, each line re-read here): none of the three is in it;
status.md lists them as released in v0.2.20. *Fixed tonight:* client.md says all three.

**L2 · `sidecar/.venv` (the dev environment) runs Open WebUI 0.10.1, three pins behind.** `sidecar/README.md`'s pin
bump step 3 (*Recreate `sidecar/.venv` at the new pin … a dev client, and so the smoke test, runs the venv*) was not
done at the 0.11.4 bump (2026-09-27) nor at 0.13.3 (2026-11-14). A dev client (`npm run dev`) and the smoke test run
0.10.1 while About and `keepDbBeforeEngine` read 0.13.3 from `OPENWEBUI_VERSION` (`sidecarManager.ts:234`,
`sidecar.ts:286`), so the dev data folder is stamped `0.13.3` by an Open WebUI that is not. A dev client's userData is
`llmonlan-shell` (no `productName` in `package.json`), not the installed client's, so the owner's chats are not
reached. *Proof:* `sidecar/.venv/Lib/site-packages/open_webui-0.10.1.dist-info`, dated 2026-06-29; the released
sidecar is 0.13.3 (`open_webui-0.13.3.dist-info`). Nothing a session runs uses the venv (the harness is chat-only, the
rehearsal takes the released sidecar), which is why it went unseen. *Fix (the owner's: it deletes a folder outside the
scratch one):* step 3 of the README, `sidecar/.venv` deleted and made again at the pin.

**L3 · LOL Vibe's renderer · code and strings no person reaches** (n° 14's notes, checked again here). The batch
queue and its chip: `app.ask.queue` (`app/ask.mjs`), `ui/queue.mjs` and `strings/ask.en.mjs`'s `queue.*` have no caller
in the app (every hit is a comment or a type; the graph runner keeps its own queue, `graph/runner.mjs:46`), so only
tests show the chip; `projects/bridge.mjs` `explain()` has no caller (the bridge shows main's own message,
`bridge.mjs:229-234`), so `projects.err_*` reach nobody; `graph.wireCycle` is mapped (`graph/canvas.mjs:133`) for a
refusal that no longer happens (loops are legal, `graph.en.mjs:30`). *Proof:* `grep` of `shell/renderer/chat` for each
name (02:10). *Fix (filed, plans ▸ Later):* remove them (the ponytail ladder: deletion over addition) with the tests that
only exercise them, or wire the batch where a plan wants it; not tonight: a module and its tests are not a small fix.

**L4 · `farm/README.md:291`, `docs/context/farm.md:87, 174` · three lines behind the code.** The README said
Qwen3.8's Automatic seats *stay on its measured label (16 at 32k)*: 32 since its 16-bit state (`measured.json`
`pro6000/vllm/qwen38` `followup_32k` *≥ 32*, `vllm.js` `seatsAuto`; README:278 and the panel tonight say 32).
farm.md said *A running bar shows how long it has run* (written by day yesterday): only a bar with no bytes to count,
and every download (`admin/index.html:988`). farm.md said Qwen3.6 *failed 30 people ~50k deep with the flag*: with the
flag **and** drafting (QWEN38_FP16_STATE_PLAN:28; `config.js:411-412` names only drafting). *Proof:* a fact check of
farm.md and the README's first 610 lines against the code (an explorer), each line re-read here; its fourth claim
(`measured-extra.json` not read by the farm) was wrong: `build_page.js` merges it into `farm/src/capacity/measured.json`,
as farm.md says. *Fixed tonight.*

**L5 · `farm/src/config.js` Qwen3.8's note (the panel's vLLM list), `docs/context/farm.md:87` · *Keep it at 32k: at
64k 20 people 50k deep failed* was the bench's shape, not the model's.** The 2026-11-20 run behind it replaced the
question each turn (`spike_bench` followup without `--append`, its file `lc1120-G64-follow50k-20…`: `append: False`),
which empties a hybrid model's prefix cache (RESULTS says so for that run: *hit rate down to 0 %*). *Proof:* tonight,
Qwen3.8 as the farm serves it (drafting, 16-bit state, a 53 GiB pool as Automatic gives), appended turns as in a chat:
**21 people ~50k deep at 64k pass** (first word p95 4.16 s, p10 44.7 tok/s) and **11 people ~100k deep at 128k pass**
(3.56 s, 47.5 tok/s): Automatic's own seats at both (`seatsAuto`: 21 and 11, from the memory). This also closes the
question this review had opened (a farm that picks Qwen3.8 with *Use this* and never wrote a context runs it at 128k
after an update): it holds. *Fixed tonight:* the note says *with everyone deep in a conversation, 32 people at 32k, 21
at 64k and 11 at 128k passed*, farm.md says why the old run failed (farm 293/293). Files:
`results/q1-n15-q38-{128k-follow100k-11,64k-follow50k-21}__bench__followup-append__*.json`.

**L6 · `docs/LOLVIBE_IDE_GUIDE.md` *Plan first* · the guide described the buttons as before v0.2.20.** It said *The
buttons stay under every plan of the chat; Go ahead always carries out the newest one*, and *Change the plan* only moved
the cursor. Since 2026-11-23 (released in v0.2.20) they show under the newest plan only, without a hover, Go ahead in the
accent (`css/thread.css`, the `:has()` rules), and Change the plan sets the box's hint (`agent.changePlanHint`). *Proof:*
the guide's lines 55 and 61 against `thread.css` and `project-panel.mjs` (the harness's
`k24-plan-first-changes-nothing-until-go-ahead` checks all three, 423/423 tonight). *Fixed tonight.*

**L7 · `farm/src/capacity/measured.json` (from `measured-extra.json`) · Qwen3.8's 64k and 128k labels predate its
drafting.** `measuredFor` gives *≥ 24* at 64k and *≥ 12* at 128k (runs without drafting); with drafting and the 16-bit
state Automatic seats 21 and 11 from the memory (`seatsAuto` takes the lower, so the seats are right), and tonight 21 and
11 passed everyone deep (L5). The panel's sentence *Measured on this card with this model: ≥ 24 at 64k …* beside 21
seats is then the old flags' number. *Proof:* `vllm.measuredFor` and `seatsAuto` for `qwen3.8-27b-nvfp4` (node, 02:44).
*Fix (filed, plans ▸ Later):* the 64k and 128k labels from tonight's runs (21, 11) in `measured-extra.json`, with
`build_page.js`.

## Questions (suspicions not proved)

1. ~~**Qwen3.6's "failed 30 people ~50k deep" with the fp16 state and drafting**~~ *answered the same night by
   measurement:* the farm serves Qwen3.6 without drafting, and so served, with the flag, 28 people ~120k deep pass at
   128k where 24 did (32 fail, 5.31 s), the long-text check 20/20 at ~120k: a plan for the owner,
   [QWEN36_FP16_STATE_PLAN](../plans/QWEN36_FP16_STATE_PLAN.md).
2. ~~**A complete model the farm calls partial.**~~ *Proved the same night and fixed: M2.*

## Checked and found sound

- **v0.2.20's *document read once per chat*, on the released Open WebUI** (`docs/spike/runs/owui_doc_check.sh`, v0.2.19's
  sidecar 0.13.3 = v0.2.20's manifest, started as the client starts it, through `launcher.py`; 05:13–05:14): **PASS**,
  with the setting on, message 0 holds the document (205,921 characters) under one hash on all three turns; off, it
  moves into each new question with a new hash. (A first try gave the sidecar's `Scripts/open-webui.exe`, which never
  starts: it names the build machine's Python; the script's header now says so.)
- **Qwen3.8's 16-bit state, the unreleased change the next Farm app ships** (QWEN38_FP16_STATE_PLAN adopted it on one
  gate run and the long-text check): the quality gate 10 runs each side tonight, with it 279/280, without 270/280; no
  cost seen (its runs repeat their token counts, so weaker evidence than Qwen3.6's, where the same comparison found one:
  QWEN36_FP16_STATE_PLAN).
- **Open WebUI's whole contract surface** (an explorer listed every env var, request and webview hook; each
  mismatch it raised re-read here): every env var `owui-contract.md` lists is set (`configBridge.ts` `buildSidecarEnv`,
  `sidecar.ts:267–275`); the shell's requests to Open WebUI are `GET /health` (the lifecycle), the token check
  `GET /api/v1/auths/`, and the user-settings read and write, whose four call sites (`renderer/app.js:583, 619, 671,
  707`) are the doc's three exceptions (the Blender tool server's add and its removal, since 2026-07-03, `cdbf785`, are
  one); no admin API, no CSS or script injected into Open WebUI's page (no `insertCSS`, no `dom-ready`, no webview
  preload); the `executeJavaScript` calls only read the token and call those endpoints.
- **Plan first's safety** (`studio.ts`): the agent has no shell (`tool-bash`, `tool-pwsh` off), so `write` and `edit`
  are its only ways to change a file, and the fence refuses both, `create_goal`, and the Computer's tools while the marker
  is there; the marker is set or cleared before every turn, so one a crash left cannot refuse a normal turn's writes.
  *Change the plan*'s hint: `layout.mjs:83` is the only other writer of the box's hint, so `back()` restores the right
  one. Nothing in the new `studio.ts` lines sends anything: it writes a marker, `preview-ports.json`, and prunes its own
  logs.
- **The farm's new sentences** against the code: *If vLLM writes nothing for 10 minutes, the farm stops it by itself*
  (`waitReady`'s stall, `vllm.js:1351`, then `stopVllmProcess`, `up.js` 1437+26); the seat text's *refused until a seat
  frees* (`seats.js:307`, a 429) after the hold set under Access (`proxy.seatIdleSec`).
- **The Computer's lost wake-up fix** (`graph/runner.mjs`): a wake while the loop is not asleep is kept for the next
  sleep; one left over from a run costs one extra pass, never a missed answer.
- **Open WebUI's contract, the one change since the last review:** `configBridge.ts` adds one env var,
  `RAG_SYSTEM_CONTEXT` (follows `RAG_FULL_CONTEXT`); no new call into Open WebUI. The released sidecar's Open WebUI
  (0.13.3, v0.2.19's asset, the same as v0.2.20's manifest) reads it (`open_webui/env.py:362`, used in
  `utils/middleware.py:780, 4813`); `owui-contract.md:29` and INTEGRATION_BRIEF list it.
- **The panel's bar during a vLLM start** (FARM_START step 2), seen in a real panel (headless Edge, the test farm,
  02:02): *running for 43s · If vLLM writes nothing for 10 minutes, the farm stops it by itself.*, the phase *loading
  the model weights (1 of 3) · 33%* ([shot](shots-2026-11-24/panel-vllm-start.png)).
- **The test farm wrote nothing into the Ollama app's models folder** (the last review's M1): `gemma4:12b` there is
  the one of 2026-11-18; the start's output has no pull.
