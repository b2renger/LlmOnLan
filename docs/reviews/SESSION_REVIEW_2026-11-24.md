# Session review of 2026-11-24 (night n° 15)

*The third adversarial review (the skill `lol-review`). Scope: the 134 commits since the last review's
(`b0ecae8`, [SESSION_REVIEW_2026-11-19](SESSION_REVIEW_2026-11-19.md)), sessions n° 11 to n° 14 and the day work of
2026-11-23, **unreleased work first** (the farm: Qwen3.8's 16-bit state, 128k by default, the panel's bar and its
note, `serve.sh`'s kernel folders); then what v0.2.20 brought (released 2026-11-23: Plan first and its buttons, the page
beside its code, the document read once per chat, the Computer's lost wake-up). The area in depth, in rotation after
the farm: **the client shell and Open WebUI's contract**. Beside it, while the card was free: J19's measured parts and
FARM_START steps 3 and 4 measured (the owner's yes, 2026-11-23 12:11). The Farm app was off at 02:00 and stayed off.*

**How it ran:** (in progress)

## Findings, by severity

Each: where · what is wrong · the proof · the fix.

### Medium

**M1 · Unreleased farm work (FARM_START step 2, 2026-11-23) · `farm/src/vllm.js` `PHASES.kernels` · the panel promised
*up to 5 minutes* for a phase that took 7 min 34 s.** Step 2 was built so that nobody stops a start a minute from ready,
and it gave the kernel phase *preparing the GPU (seconds; up to 5 minutes once after vLLM is installed or updated)*, a
bound taken from Qwen3.6's rebuilds (168–250 s). *Proof:* tonight's test farm, Qwen3.8 (drafting, 32k) on a root with an
empty kernel folder: `~/lol-vllm-033/logs/vllm.log`, the first JIT build at 02:03:14, graph capture at 02:10:48, so the
phase that text names ran 7 min 34 s; the whole start 605 s (02:01:46 → ready). A person told *up to 5 minutes* sees
minute 6 go by on Qwen3.8, the model the owner keeps for coding. *Fixed tonight* (a run reproduced it; test first):
*seconds; several minutes once after vLLM is installed or updated*, no number; the test now fails on any bound under 8
minutes (it failed on the old text, farm **293/293** after); farm.md and FARM_START_PLAN say so. Not released (the next
Farm app), so no person met it.

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

## Questions (suspicions not proved)

1. **A farm that picks Qwen3.8 with *Use this* and never wrote a context runs it at 128k after the next update.** The
   panel's *Use this* posts `{model}` only (`admin/index.html:1714`), `applyChange` keeps the context
   (`vllm.js:548-571`), `patchSection` writes only the patch (`configFile.js:58-66`), and the default is now 131072
   (`config.js:496`); nothing holds Qwen3.8 at the 32k its own note asks for (*Keep it at 32k: at 64k 20 people 50k
   deep failed*). Not proved to fail: Automatic sizes the seats to the memory at 128k, and the 64k failure was more
   people than vLLM's own count. To prove: Qwen3.8 at 128k, Automatic, everyone ~100k deep. A fix, if it fails: a
   per-model context ceiling in the library entry, which is a plan.

## Checked and found sound

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
