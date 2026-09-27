# Recheck 2026-09-27: the fixes to the three consistency reviews (32bcf8d..b43e6c6)

Critic pass over f7c0ac3 … b43e6c6, run against the current tree on `lolchat/vnext`. I read every behavior
fix with `git show` and checked it against the code; I did not rely on the commit messages.
Gates I ran: `node farm/test/run.js` **124 passed**; `node shell/test/chat-unit.js` **1605 passed, 0 failed**;
`node shell/test/chat-lint.js` **221 files, 0 violations**. I did not run the harness, and I contacted no port.
A link check of 28 markdown files (CLAUDE.md, the READMEs, docs/*.md and shell/test/chat/README.md) found
every relative link and #anchor valid. The only failures are 6 historical links in docs/DEVLOG.md (4106, 5821,
5823, 5826, 5853, 5932): they point at `.js` files that are now `.ts` or `chat.js`. They don't block the release.

**Coverage caveat.** I verified all of these myself: the behavior fixes (FA-*, SA-*, CA-*), the in-app strings
listed below, and the CLAUDE.md sentences listed in the audit. Three delegated sentence-by-sentence sweeps had
not returned when this report was due. They covered the farm docs C-tables, the client C.1/C.2 items and the
Computer C-1…C-12 items. The ledger marks those items **unverified**. Before tagging, finish the sweep of CLAUDE.md
:26-57 and :60-82 (farm), :232-262 (env list), :298-337 (config example and CLI table), :396-418 (discovery
numbers), :470-512 (the yml block and CI) and :121-143 (the Computer).

## Verdict — NOT HAPPY (small, docs-only must-fix list)

The code fixes are sound. I found no regression, race, missed call site or changed default in FA-1…FA-9,
SA-1…SA-16, CA-1 or CA-2. The one residual is in the same class as SA-8 and is listed under should-fix. What blocks
the release is doc accuracy: four docs promise that "the advertised name survives an engine switch", and on a
default farm it does not. CLAUDE.md also still contains two false sentences.

## Must-fix before release

1. **The name-survival claim is false for an unnamed default.** It appears at CLAUDE.md:58-59,
   farm/README.md:127-128, farm/README.md:533-534 and farm-app/README.md:67-68.
   - `carryNameAcross(config, true)` carries only a name the operator gave. It skips a raw checkpoint id on
     purpose (`farm/src/litellm.js`: `def.servedName !== def.underlying`, with the comment "A raw checkpoint id is
     not carried").
   - What happens on the shipped default (`gemma4:12b`, `modelAlias: null`): switching to llama.cpp renames the
     served model from `gemma4:12b` to `assistant`, and every chat bound to `gemma4:12b` asks the user to re-pick.
   - Switching back then persists `modelAlias: "assistant"`, so the Ollama default keeps that name afterwards.
   - The RIG item at RIG_CHECKLIST.md:149 is correct, because it renames the model first.
   - Fix: replace the claim with *"A name you gave (Rename, `modelAlias` or `llamacpp.alias`) survives an engine
     switch and a fallback (`carryNameAcross`). An unnamed default does not: its raw id (e.g. `gemma4:12b`) is
     not carried, so the first switch to llama.cpp serves `llamacpp.alias`, and switching back names the Ollama
     default after it."*
2. **CLAUDE.md:275 is false.** It says "`DATA_DIR` → user-chosen local folder (all persistent data lives here)".
   CLAUDE.md:373-374 and :576-579 say the opposite, and they match the code: LOL Chat's history and the Computer's
   graphs live in IndexedDB `lol-chat` under userData. Fix: *"(all of Open WebUI's persistent data lives here;
   LOL Chat's history and the Computer's graphs are in the app's IndexedDB, see Data-flow)"*.
3. **CLAUDE.md:597 is false.** It says "the admin API only for what env can't do, e.g. tool servers". The Blender
   tool server is written through the user-settings API `POST /api/v1/users/user/settings/update`, and the admin
   REST API is deliberately never used (CLAUDE.md:226 and :267-270; `shell/src/main/configBridge.ts:4`). Fix:
   *"— OWUI's user-settings API only for what env can't do (the web-search default, the opt-in tool server)"*.

## Should-fix (not blocking)

- **SA-8 missed call site: a Continue that gets a 429 is resent as a new reply and wipes the partial answer.**
  - The seats-full ERROR_HANDLER arms a wait on the partial message, whatever the mode was.
  - `resend()` calls `generate({ threadId, into: w.msg, holder })` with no `mode` (`app/seat-wait.mjs:227`).
  - In the new mode, `if (mode !== 'continue') { target.content = ''; … }` (`app/controller.mjs:483`) clears the
    text, then generates a fresh reply from the parent.
  - When it happens: the client's own seat has been idle for more than 900 s and the farm is full.
  - Fix: store `mode` on the wait (`waiting.mode = …` from the handler's context) and resend with
    `mode: 'continue'` when it was a Continue.
  - Test: add a `continue.test.mjs` world where the farm returns 429, then a seat frees; assert that the content
    starts with PARTIAL.
- **SA-3 side effect: a manually added farm can be pruned.** `merge()` keeps `prev.source` when it keeps the host
  (`shell/src/main/discovery.ts:202-203`). Example: the beacon finds a farm first, and then the user adds it by
  hostname. The record stays `'beacon'`, so `prune()` drops it after 120 s of silence (`:299-300`), although
  manual entries are meant to be "kept even when stale". Fix: `source: prev.source === 'added' || source ===
  'added' ? 'added' : prev.source`.
- **S:B-1 reads as if the Computer's data lives in the data folder.** The Data location hint says "…and the
  Computer's projects, live here" (`shell/renderer/index.html:84`). Only File-box outputs go to
  `DATA_DIR/LOL Studio Projects`. The graphs live in IndexedDB, and "Change folder…" does not move them. Say:
  *"…and the Computer's File-box outputs live here. LOL Chat's history and the Computer's graphs stay in the
  app's own storage on this machine."*
- **CLAUDE.md:210-213, invariants #3 and #4.** #3 still says everything lives "under a local `DATA_DIR`", and #4
  says "(env vars + admin REST API)". Both contradict the body of CLAUDE.md. The shell review left #4 to the owner.
  Suggested: #3 *"…under a local `DATA_DIR` the user chooses (OWUI) or the app's own local storage (LOL Chat,
  the Computer)"*; #4 *"(env vars + its public REST API)"*.
- **SA-2 is now live for the first time.** `HF_HUB_OFFLINE=1` never turned on before this fix. The RIG item added
  in 5b3f6dd should be run on a closed-LAN box before the tag: embeddings load and voice (STT) still works once
  whisper-base is cached.
- The DEVLOG's 6 stale file links (historical log; update or leave).

## Findings ledger

Status legend: **R** = resolved and verified by me; **R\*** = applied per the commit and diff stat, but the doc
text was not re-verified by me (delegated sweep pending); **P** = partially resolved, see the note.

**Farm: code**
- FA-1: **R**.
  - One `ollamaServes()` check now gates every warm-up, probe and knob (`up.js:95, 464, 865, 1407, 1429, 1562,
    1586, 1616`).
  - Under the external engine, slots/context/name/backend/Apply refuse; the password still applies.
  - Keep-alive is 5m and eviction runs whenever Ollama is not the engine.
  - The panel treats `engine !== 'ollama'` as standby and hides the slots and context rows.
- FA-2: **R** in the code (pure `carryNameAcross` in both directions; the default row's Rename is refused and
  hidden under llama.cpp; a failed switch restores memory and the raw file). The docs overstate it: must-fix 1.
- FA-3: **R**. `engineFallback` is called in all four paths (`up.js:440, 452`, second crash, start failure). The
  name is set in memory only, and rollbacks restore the raw file's `modelAlias`.
- FA-4: **R**. `net.serviceHosts` sets bind, probe and advertise for SearXNG, OCR and Kokoro. A loopback farm
  advertises 127.0.0.1 in the snapshot.
- FA-5: **R**. Standby catalog edits persist without a proxy restart or a warm-up.
- FA-6: **R**. `LOL_FARM_VERSION` flows from the Farm app into the snapshot and `lol --version`.
- FA-7: **R**. `add`/`rm` patch only `models`; `pull` uses `source || id`.
- FA-8: **R**. `deriveParams` is used in both `up.js` and `install.js`.
- FA-9: **R**. The Ollama slots row is per box, with the farm total beside it; Apply and `setSlots` compare and
  write `numParallel`.

**Farm: in-app text** (all checked in the diff)
- F:B-1 through F:B-12: **R**.
- F:B-13: kept as written, and correct, because FA-4 makes it true.

**Farm: docs**
- F:C-1 through F:C-8 (CLAUDE.md): applied. See the audit below; except for must-fix 1, the farm bullet was not
  re-verified sentence by sentence.
- Farm C-tables (farm/README, farm-app/README, GETTING_STARTED, RIG_CHECKLIST): **R\***, except the name claim
  (must-fix 1).
- F:D items: **R\***. They are documented in farm/README.md per 5085f7b.

**Shell: main process**
- SA-1: **R**. One `launchOpts()` feeds the crash restart, `setDataDir` and `repoint`.
- SA-2: **R**. MiniLM is looked up in the hub (`HF_HUB_CACHE`/`HF_HOME`/XDG honoured) and Whisper under
  `DATA_DIR/cache/whisper/models`. `repoint` computes the old and new env at the same moment, so there is no
  spurious restart.
- SA-3: **R**, with a minor side effect (see should-fix).
- SA-4: **R**. One `connectTo()` persists the whole context; the key is part of the comparison; the pin path uses
  it; the cold boot and the first-run boot seed `currentKey`.
- SA-5: **R**. The "Automatic — least busy farm" row unpins, the pinned card is badged, and entering a password
  no longer pins. 6df2f6f makes the toast true: a healthy farm is kept after unpinning.
- SA-6: **R**. The swap goes `live → live.old → pending → live` with rollback and recovery of a half-done swap.
  The pending tree is not precompiled; the live tree is precompiled after the swap.

**Shell: LOL Chat**
- SA-7: **R**.
- SA-8: **P**. The local busy / no-password / no-farm path is fixed. The 429 → seat-wait resend path still
  wipes the partial answer (should-fix).
- SA-9: **R**. `repo.mode === 'idb'` is required in `renderV1`, `act`, `migrateV1` and `removeV1Copy`.
- SA-10: **R**. `localNote` emits STREAM_END, and the seat wait releases on a status other than `waiting`.
- SA-11: **R**. Template overhead is subtracted; samples under 1000 characters and image requests are skipped.
- SA-12: **R**.
- SA-13: **R**.
- SA-14: **R**. `putMessage` (and so `finalize`) and `deleteSubtree` emit MESSAGE_PUT.
- SA-15: **R**. Both the alias and the underlying name are asked.
- SA-16: **R**, including the latent branching item (the thread is created before the attachments are copied).

**Shell: in-app text**
- S:B-3, S:B-4, S:B-5: **R** (dev-build guard added; closed-LAN message; Share-compute hint; "not installed yet").
- S:B-1: **R**, but misleading (should-fix).
- S:B-2 and S:B-6 through S:B-12: **R\*** per 1c322b3.

**Shell: docs**
- S:C.1: applied to CLAUDE.md; see the audit.
- S:C.2 and the S:D rows: **R\*** per 5b3f6dd and a2bc3b2.

**Computer: code**
- CA-1: **R**.
  - `errPaused` now covers every case of no sandbox: `compute`/`run`, Code, Preview draw, Render, and Live.
  - The toast subscription is attached once, when the sandbox is created (`computer/host.mjs:220`).
  - The devlog's `sbx.note` keeps its level and text.
  - Only `host.start()` re-arms a sandbox in the `disabled` state (`computer/host.mjs:421-423`), which matches
    the sentence "Run all (or ▶)".
- CA-2: **R**. F was added to `onSurfaceKeyDown` with the same guards, and the `root.contains(target)` early
  return prevents a double fit.

**Computer: in-app text and docs**
- K:B-3: **R**.
- K:B-1, K:B-2, K:B-4, K:B-5: **R\*** per 2a0177d.
- K:C-1 through K:C-11 and K:D-1 through K:D-8: **R\*** per 98d1c3c.
- K:C-12: applied to CLAUDE.md :121-143, not re-verified.

## CLAUDE.md audit (the sentences I verified; the rest is listed under the coverage caveat)

- :17 header: **true.** `shell/package.json` is 0.1.45 and `farm-app/package.json` is 0.0.38. The Computer is on
  `main` (merge 811451a; 11 fix commits ahead).
- :58-59 "The advertised name survives an engine switch and a fallback … so bound chats keep working": **false
  for an unnamed default.** See must-fix 1 (`farm/src/litellm.js` `carryNameAcross`).
- :77 "They bind to `proxy.host`": **true** (`net.serviceHosts`; searxng.js, extract.js, kokoro.js).
- :81-82 `LOL_FARM_VERSION` falling back to `farm/package.json`: **true** (`snapshot.js` `farmVersion`).
- :210-212 invariant #3 "…under a local `DATA_DIR`": **misleading.** LOL Chat and Computer data live in
  IndexedDB under userData (CLAUDE.md:373-374 and :576-579 say so). Should-fix.
- :213 invariant #4 "(env vars + admin REST API)": **contradicts :267-270** and `configBridge.ts:4`. Owner
  decision; should-fix.
- :275 "(all persistent data lives here)": **false.** Must-fix 2.
- :411-416 `farmSelect.ts` / `connectTo()`, the Automatic row, "entering a password does not pin", and a host
  that "moves only after 12 s of silence": **true** (`farmSelect.ts`; `index.ts` `connectTo`/`select-farm`;
  `discovery.ts:202` with `STALE_MS = 12_000`).
- :597 "the admin API only for what env can't do, e.g. tool servers": **false.** Must-fix 3.
