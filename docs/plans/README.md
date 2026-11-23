# The next work, in order

*Written 2026-11-05 from the project review of that day: every plan was read against the code, and the leftovers
of the plans now in [../archive/plans/](../archive/plans/) are here, one line each, so nothing open hides in the
archive. Released 2026-11-09: client v0.2.16 and Farm app farm-v0.0.52, with the review's fixes.*

Sizes: **S** under a day, **M** a few days, **L** a week or more. The owner's direction behind the order: one big
box serves the class (20–30 people, 50 at most) with vLLM; the operator does everything from the app; nothing is
processed in a cloud; the code follows the ponytail ladder.

**The open plans:**
- [OWUI_START_PLAN.md](OWUI_START_PLAN.md) — **the class's failure (2026-11-17):** Open WebUI killed during its first
  start by the client's farm switches, its database left broken, every later start *exits (code 1)*. Reproduced;
  **approved and built the same day** (owner 2026-11-17); the client release waits on the owner's go and HUMAN_TESTS A28.
- [OWUI_REPAIR_PLAN.md](OWUI_REPAIR_PLAN.md) — **a button that repairs a laptop the class broke** (night n° 9,
  2026-11-18): on *keeps exiting (code 1)* with Open WebUI's migration error, move the database aside and put back the
  copy taken before the update, if any. **Approved by the owner and built 2026-11-18** (day session); in v0.2.19.
- [CLASS_REHEARSAL_PLAN.md](CLASS_REHEARSAL_PLAN.md) — **the class rehearsed every night** (scratch farms, scripted
  clients, lost beacons, 10 and 20 chats at once). **Approved by the owner 2026-11-18**; steps 1–3 built (night n° 10).
- [VIBE_PAGE_PLAN.md](VIBE_PAGE_PLAN.md) — **LOL Vibe's page preview, its code beside it** (owner, in the chat,
  2026-11-18): errors that name their block and line, the code and the page side by side in the side column, edits
  run as one types and kept with the thread, and a pop-out window. **Approved by the owner 2026-11-18**; Now, built by day.
- [VLLM_DRAFT_PLAN.md](VLLM_DRAFT_PLAN.md) — **Qwen3.8 on vLLM drafts ahead with its own MTP layer** (owner, in the
  chat, 2026-11-18: evaluate HyperQwen, build tonight if the verdict is *try*): twice the speed alone and for 30 people
  at the same quality, a fifth to a third less room, counted by the farm. **Approved by the owner 2026-11-18**; Now,
  built by night (n° 10); HUMAN_TESTS J19. Qwen3.6 with the same drafting: the owner's question.
- [CLASS_TEST_2026-11-17.md](CLASS_TEST_2026-11-17.md) — **the class of 30 students on Tuesday 17 November** (owner
  2026-11-13): chat, LOL Vibe and the Computer tight for that day, and the tutorials, docs and in-app tutorials refined.
  **It comes first until the class**: its nights, its freezes (the client Monday 16 at 12:00, the farm Monday evening)
  and the owner's list of tests ([BEFORE_TUESDAY.md](../BEFORE_TUESDAY.md)).
- [CLOUD_SOURCES_PLAN.md](CLOUD_SOURCES_PLAN.md) — documents from Microsoft 365 and synced folders. Nothing built, and
  **on hold** (owner 2026-11-06): a request from the school's administrators; nothing starts before they and IT say go.
  The school has no Google Workspace.
- [IDE_PLAN.md](IDE_PLAN.md) — LOL Vibe's IDE. Slice 7 and §5 B/C are open.
- [INSIGHTS_PLAN.md](INSIGHTS_PLAN.md) — opt-in usage statistics, so the sessions can see how the apps are used
  (owner 2026-11-12). Nothing built: it changes the promise "the farm stores nothing", so it **waits for the owner's
  decisions** (its §6). A first step that sends nothing is proposed there.

**How the work is run** (owner 2026-11-12): in sessions, each ending with a dated summary in
[../sessions/](../sessions/README.md). The summaries' "Next" and the owner's lines there give the day's order; this
file stays the whole list.

---

## 1. Now

- **A farm that is ready sooner** ([FARM_START_PLAN](FARM_START_PLAN.md), approved by the owner 2026-11-23 12:11, "yes on
  all those"): measured, ~2 min 30 s from the Farm app's launch, ~5 min 30 s when FlashInfer rebuilds; the trial-root
  rebuilds fixed the same day. Steps: vLLM alongside the other services (−29 s), the panel's elapsed time and the
  truth, precompiled kernels (`flashinfer-jit-cache-sm120f`, 194 MB: measured first, night n° 15), the weights' load
  strategy (measured first, night n° 15). **S + S + M + S**. Farm only.
- **Start a new chat with a plan** ([PLAN_FIRST_NEW_CHAT_PLAN](PLAN_FIRST_NEW_CHAT_PLAN.md), approved by the owner
  2026-11-23 12:11): (a) a new chat from a project's chat stays in it; (b) every new chat offers *Plan first*. **S + S**.
  **Ready:** v0.2.20 is tagged (2026-11-23 17:41; the owner's re-check passed). One question: on by default in a new
  chat (default if no answer: off, as decided 2026-11-20).
- **128k of context per person by default** ([CONTEXT_128K_PLAN](CONTEXT_128K_PLAN.md), approved by the owner
  2026-11-19 18:15, for a night session after the tests of 2026-11-20): the vLLM default and the Balanced preset at
  128k, Qwen3.6's 128k label measured on 0.33.0 (24; the owner, 2026-11-20 12:46: "24, 128k can be the default").
  **Its step 3, Open WebUI's document text in the system message** (`RAG_SYSTEM_CONTEXT`, read once per chat: 5.3 s →
  0.15 s from the second question), **approved 2026-11-20 12:46**. **S**. **Built in night n° 12** (unreleased; the
  plan's *Built*: a farm whose file does not name its context moves on update; Documents stays at 64k, where 128k would
  pick Nemotron; `RAG_SYSTEM_CONTEXT` only with whole documents). HUMAN_TESTS J16 (128k its main step, and a long
  document's three questions) for the owner.
- **Qwen3.8's recurrent state in fp16** ([QWEN38_FP16_STATE_PLAN](QWEN38_FP16_STATE_PLAN.md)): **step 1 passed
  2026-11-20 at 32k** (30 people 28k deep pass with the flag, fail without; people at once 24 → ≥ 32; the long-text
  check unchanged; at 64k both fail alike). Steps 2–4 in night n° 12, after CONTEXT_128K_PLAN (confirmed by the owner
  2026-11-20 12:46). **S**. **Built in night n° 12** (unreleased): the flag, `facts()` halving the state charge, the 32k
  label ≥ 32 (Automatic 32); HUMAN_TESTS J19 for the owner.
- **A plan mode for students in LOL Vibe** ([STUDENT_PLAN_MODE_PLAN](STUDENT_PLAN_MODE_PLAN.md), approved by the owner
  2026-11-20 12:46, as written): a *Plan first* switch, the fence refusing writes while the agent plans, *Go ahead*
  and *Change the plan*. **M**. **Built by day, 2026-11-20** (unreleased; the plan's *Built* says the four choices
  made, for the owner to overturn); HUMAN_TESTS G14 for the owner.
- **Open WebUI 0.13.4** (plans ▸ Next 19; approved 2026-11-20 12:46: "yes we can bump"): the pin bump and its smoke
  tests, after the 128k build. **Done when** the smoke tests pass and `docs/spike/runs/owui_doc_check.sh` gives PASS on
  0.13.4 (an attached document stays the same in the system message from turn to turn: CONTEXT_128K_PLAN step 3's
  gain). **S**. **Blocked, night n° 12 (2026-11-21):** `owui_doc_check.sh` PASS on 0.13.4, but 0.13.4 removes a
  person's own tool servers (moved to its Tether app; `ENABLE_DIRECT_INTEGRATIONS` gone), which is how the Blender
  tools reach chats: they would vanish (TOOL_UPDATES_2026-11-20, corrected). The pin stays 0.13.3; the owner's
  question in n° 12's summary.
- **LOL Vibe's page preview, code beside it** ([VIBE_PAGE_PLAN](VIBE_PAGE_PLAN.md), the owner's request of 2026-11-18,
  approved with its three choices): step 1 the side column (errors with block and line, the shared editor, live
  reload, edits kept with the thread), step 2 the pop-out window. **M**. Built by day, 2026-11-18.
- **Qwen3.8 drafts ahead** ([VLLM_DRAFT_PLAN](VLLM_DRAFT_PLAN.md), approved 2026-11-18 21:23 in the chat): MTP drafting
  in the Qwen3.8 entry, its memory counted by `facts()`. **S**. Built by night n° 10; J19 for the owner.
- **The class rehearsal** ([CLASS_REHEARSAL_PLAN](CLASS_REHEARSAL_PLAN.md), approved 2026-11-18): two scratch farms,
  scripted clients with fresh first starts, lost beacons, 10 and 20 chats at once, every night. Step 1 first (the
  regression test of the class). **M**. **Steps 1 and 2 built 2026-11-19 (night n° 10):** `shell/test/rehearsal/run.js`,
  sealed on 127.0.0.1; v0.2.18 moves farm 10 times in 5 min where v0.2.19 never does, and kills first starts under a
  blip where v0.2.19 waits; 20 clients ready and answered, ~793 MiB each. **Step 3 built the same night:** Qwen3.6 as
  people use it, a seat per client. Open WebUI and the gate cost nothing measurable. The wait is the thinking: half
  the answers' first word at 11–18 s with 10 people, 18–22 s with 20, against 0.2–0.3 s with thinking off (Waiting on
  the owner, 6). Next: *keeps exiting* itself, step 4.
0. **The class of Tuesday 17 November** ([its plan](CLASS_TEST_2026-11-17.md), owner 2026-11-13): until then, only what
   the 30 students touch and the farm that serves them; no new feature. After the class, the order below resumes.
   *Night n° 5's review* ([SESSION_REVIEW_2026-11-15](../reviews/SESSION_REVIEW_2026-11-15.md)) fixed the sandbox that
   could not start from a `c:\` app path (H1), the chat page's layout (H2) and the Farm app's wait for pip (H4).
   **Done by night n° 6 (2026-11-16, DEVLOG 02:04): all of the list below**, and **released** in client v0.2.18 and
   Farm app farm-v0.0.54 (DEVLOG 03:04). M2 stays in Next 15.
   *Night n° 6, before the releases, in the order students meet them:*
   M4 the Text box's line breaks (lesson 1's haiku on one line; `pre-line`, `css/computer-text.css:139`); M3 Qwen3.6
   "untried" (words only, a measured-but-mixed line; never `edits: 'good'`, which `pickEditor` would prefer to Gemma 4
   26B); M6 `.btn-ghost` (`renderer/styles.css:136`, the declarations of `chat/css/base.css:139-153`); L5 and L6 (words);
   M1 the usage report's boxes after a restart (`chat/main.mjs` `lolUsage.save`: import the parts registry and
   `setBoxTypes` before `report()`; the review's script as the test); M5, if time allows, the Tour's new box over the
   Markdown view (`graph/canvas.mjs placeEntry`: step to a free spot). The near-patches are in the review.
1. **The human testing phase** (owner 2026-11-09): client v0.2.16 and Farm app farm-v0.0.52 carry the review's fixes, the
   owner's decisions of 2026-11-06 and 09 and Gemma 4 26B. Run the ★ list of [HUMAN_TESTS](../HUMAN_TESTS.md) in its order;
   each finding goes back here.
   - *Found 2026-11-10:* the Farm app's **Check for updates** said *Couldn't check: GitHub API 403*. GitHub's API allows 60
     requests an hour to everything behind one public address, and the school's network had used them up. Fixed in
     **v0.2.17 and farm-v0.0.53** (released 2026-11-12): the update check, the wizard's downloads and the client's chat
     engine and coding agent no longer use the API. On older builds, try again after the hour.
   - *Found 2026-11-10:* the default model, Gemma 4 12B, was weak (owner). Released in **farm-v0.0.53** (2026-11-12): the farm ships
     **Gemma 4 26B** for documents, pictures and a little code on 24 GB and above, and Balanced brings a farm to it
     (measured: [RESULTS "Ollama's default"](../spike/RESULTS.md#ollamas-default-rtx-pro-6000-2026-11-10)). Next: HUMAN_TESTS
     **K14** and **K15**.
2. **The ★ list** in [HUMAN_TESTS](../HUMAN_TESTS.md) (proposed 2026-11-05): agree it, then run it in its order.
3. **On the PRO 6000, at a quiet hour:** install farm-v0.0.52, then J14 and J15. J14 is Update vLLM 0.30.0 → 0.33.0,
   which takes it from 32 to 48 people at 64k every turn. J15 is Gemma 4 26B from the panel. **M**, the owner's hour.
   *Owner, 2026-11-14:* J14 **before** the class, by night n° 4 (the box is idle on weekends; a session may switch the
   live farm), with the newer llama.cpp on a scratch farm; the releases are cut after. Every session's research also
   covers the updates of the tools we pin (CLAUDE.md ▸ Sessions).
   **J14 done 2026-11-14 by day (session n° 4):** the live farm on vLLM 0.33.0, Qwen3.6 at 64k, 48 seats, measured for
   30 ([the summary](../sessions/2026-11-14-n4.md)); two panel bugs fixed for the next Farm app (J17). J15 open.

## 2. Next — the most value for the office

**New models, measured 2026-11-06** ([RESULTS](../spike/RESULTS.md#model-trials-rtx-pro-6000-2026-11-06)): nothing beats Qwen3.6 for a class,
and it serves more than we said. Gemma 4 26B is LOL Vibe's coding model since 2026-11-09 (owner), in Flint's place. Nanbeige4.3 and Apex-35B are not for this farm.
**Measured again 2026-11-13** ([the research](../research/MODELS_2026-11-13.md), [RESULTS](../spike/RESULTS.md#new-models-for-a-class-rtx-pro-6000-2026-11-1213)):
Kolibri-1 and LFM2.5 do not beat Qwen3.6 either; Super VL waits on the owner (4 ▸ The farm).

1. **The class-size test through the seat gate** (HUMAN_TESTS J16): 24 people at 128k (the default since night n° 12), 48–64 at 64k. It is the only
   proof of "a class of 50", and the purchase table rests on it. The harness measured Qwen3.6 at 64 people on Open WebUI's
   traffic shape (2026-11-06): if J16 agrees, the capacity page goes from 48 and 96 to 64 and 128. After Now 3. **S**.
2. **One PDF must not hold the shared GPU:** a page cap and a stop between pages when the client leaves (OCR's
   `pysvc/server.py` reads every page), and an upload cap like speech to text's 25 MB (the owner: 100 MB?). OCR runs
   outside the seat gate. **S**. *Built 2026-11-13, unreleased (K16): the stop between pages (session 2: `process`
   watches `request.is_disconnected()`, `_extract_pdf` checks before each page; a run of the real service against a slow
   stub model stopped after 2 of 10 pages when its client left), and by day the owner's caps, **200 pages** (the rest
   not read, a last page says so) and **100 MB** (413), `OCR_MAX_PAGES` and `OCR_MAX_MB`; `check_services.py` asserts
   all of it.*
3. **Web search under a class's burst** (one public IP), then the owner decides whether it goes back on by default.
   **S**.
4. **Tests before a release:** the farm suite, the Farm app's test, and the shell's unit, chat-unit and lint, in
   `release.yml` and `release-farm.yml` (a workflow_dispatch dry run first). No release since v0.2.10 ran its ★ tests,
   so the automatic suites should at least block one. The owner: CI minutes. **M**.
5. ~~**Slow down wrong admin-token guesses**~~ *built 2026-11-13 (session 2, unreleased): `selfServer.js` `refuse`, 400 ms
   before every 401 on `/lol/admin/*` and `/lol/plugin-keys`; a per-address lockout is the upgrade if ever needed.*
   On `/lol/admin/*` (a delay per 401, as `/lol/plugin-keys` waits 400 ms).
   The token guards the whole panel on a LAN of students. **S**.
6. **Small hardening** (*checked 2026-11-13, session 2: all three settled*):
   - ~~a main-frame navigation guard on the client's window~~ *already there since 2026-11-06 (ec67ceb):
     `index.ts` `will-frame-navigate` refuses a main frame that is not the app's own `index.html`;*
   - ~~make the Trigger's gap check and its start record one step~~ *not a race in the code: `trigger.mjs` `onEvent`
     awaits `door.armed()` BEFORE both, and `mayFire` and `st.runs.push` run with no await between them, so a second event
     sees the first's run (code unchanged since 2026-09-28; the review's wording of 2026-11-05 not found);*
   - ~~a timeout before a download's first byte in the Farm app's wizard~~ *built (unreleased): `runtimeManager.ts`
     `downloadTo` 60 s and its `httpGet` 30 s through the request's own `timeout`; checked against a server that accepts and
     never answers (a scratch script: the error came at 1,010 ms of a 1,000 ms timeout).*

   **S**.
7. **A plugin's first install shows its progress** (Voice takes about 10 minutes behind a "…"). The owner picks: in
   the download slot, or as a job that tells the laptops the farm is busy. **M**.
8. **The IDE's model line agrees with the farm's proven list** (`projects/models.mjs` calls Qwen3.6 untried; Gemma 4 26B
   is good there since 2026-11-09). The owner: does Qwen3.6's 7–11/15 count as good at edits? **S**.
9. **The client says when a farm is older than it expects.** Farm updates are manual, and older farms refuse newer
   settings. The owner: the minimum version. **S**.
10. ~~**Prune old coding-agent session logs**~~ *built 2026-11-21 (night n° 12, unreleased):* `studio.ts`
    `pruneSessions`, once a start before the first runtime: `DATA_DIR/lol-studio/dsh/sessions/<project>/<session>/`
    whose newest file is **older than 30 days** (owner 2026-11-13) goes, and a project folder left empty; a unit test.
    The item was: those older than 30 days in `DATA_DIR/lol-studio/dsh` (IDE_PLAN slice 7), after the class. **S**.
11. **The coding agent's fence check on macOS and Linux** (`sandboxBlocked` checks only on Windows). After HUMAN_TESTS
    E4. **M**.
12. **Measure Ripple-65B Preview**, a dense model tuned for coding: about 4–13 people at 64k on the PRO 6000 by
    estimate, so a small group's model at best. It needs a vLLM nightly in a root of its own, after Now 3
    ([the study](../research/RIPPLE_65B_STUDY.md)). *2026-11-22: no nightly any more: vLLM 0.34.0 (2026-11-16) lists
    "Ricursive Ripple-65B Preview … `ripple` reasoning and tool parsers | #65745", and night n° 12's trial root
    `~/lol-vllm-034` has 0.34.0, if the owner keeps it. Still after Now 3 (J15 open); 57 GB + 8 GB to download.* Nanbeige, also dense and tuned for agents with a shell, did 5/15 on our
    fenced agent: expect the same risk. **S**, the owner's quiet hour.

13. **From Qwen Code** ([the review](../research/QWEN_CODE_2026-11-14.md), owner 2026-11-14: "those are good, we need
    to include those in our plans"), after the class, in this order:
    - **n° 9 (Thursday 19): loop detection in the Computer's Agent box** (**S**): stop a run on the same tool call
      several times in a row, or two calls alternating, and tell the student why (today it spends its 12 steps and says
      "out of steps"); one unit test. **Built 2026-11-18 (n° 9, on `main`, not released):** `agent.mjs` `loopOf`, the
      same step and result 3 times in a row or A B A B; unit test and harness `k22-agent-going-round-in-circles…`.
      **Never write from a cut tool call: checked 2026-11-18 (n° 9), nothing to fix** (DEVLOG): dsh drops every tool
      call of a reply cut at max_tokens before running tools; the Agent box never repairs a cut object and writes no
      file. The item was: **never write from a cut tool call** (**S**): first check what dsh and the
      Agent box do with a tool call cut by `finish_reason: length`; the fix only where a file can be written from it.
    - ~~**n° 11: tool-call examples in each model's own style**~~ *measured 2026-11-19 (night n° 10), not adopted: the
      Agent box shows no tool-call examples (one JSON object a step, held to a schema), and the agent spike's two modes
      on our models leave nothing to win: Qwen3.6 native 40/40, JSON 40/40; Qwen3.8 with drafting native 40/40, JSON
      37/40, all three misses on the request September already called ambiguous; episodes 10/10 each
      ([agent-spike RESULTS](../research/agent-spike/RESULTS.md), last section).* The item was: the Agent box's prompt
      on Qwen3.6 with JSON examples against the model's own format; adopted only if it measures better.
    - **n° 11 or 12: a plan mode for students** (**M**): the agent proposes, the student approves, before anything
      changes (LOL Vibe's coding agent and the Agent box). A plan in `docs/plans/` first, for the owner. **Written
      2026-11-20 (n° 11): [STUDENT_PLAN_MODE_PLAN](STUDENT_PLAN_MODE_PLAN.md)**, approved 2026-11-20 12:46 (now in
      *1. Now*). It proposes a
      *Plan first* switch, with LlmOnLan's own fence refusing writes while the agent plans; dsh's own plan mode is out of
      reach (its runtime answers no review). It leaves the Agent box out, since that box changes nothing outside itself.

    (n° 10 is a review. The cron ends on 2026-11-19: n° 9 onwards needs it started again.)

14. **Electron 45** (42 is past its end of life, 2026-10-20): tried 2026-11-14 and dropped for the class. On 45 the
    harness's sandbox stops booting once a long-running window has run earlier scenarios (`--phase c` 57/73 twice,
    k 174/217; on 42.6.0 the same tree gives 73/73), though each scenario passes alone: an order-dependent defect, maybe
    the same one 42 showed rarely on 2026-11-12 (k 175/217). First find what earlier scenario leaves the state, then
    bump (also: the sync `safeStorage` calls before Electron 46). After the class. **S–M**.
    *On Electron 42, three full runs lost one scenario each, a different one each time* (n° 8:
    `k1-runbar-escape-stops-from-the-bar`; n° 9: `k25-graph-preview-live-a-drag-on-a-node-moves-the-drawing`; n° 10,
    2026-11-19 02:48: `k3-control`, the 207th, a 30 s `waitFor`), each passing alone 3/3 and, k1 and k25, 8/8 under a
    20-client rehearsal's load: not load, a full run's order. Likely this same defect: the step above finds it for both.
    *2026-11-22 (n° 13): k25 again, once in a full run (422/423, beside a vLLM measurement), then 3/3 alone under that load.*
    *2026-11-23 (n° 14): not the frame's timing (a 4 ms drag moves the drawing, 10/10); something laid over the live
    frame gives exactly its 0 %, the canvas unpanned. The scenario now names what is under the pointer before it drags
    (DEVLOG 02:19): the next failure says what covered the frame.*
    *2026-11-15 (review H1):* the harness's sandbox failures depend on the case of the drive letter the harness was
    started with (`c:\` refused the runner), now fixed; measure 45 again with it before looking for another cause.
    *2026-11-19 (night n° 10, 05:10–05:32), measured again: Electron 45.3.2 in a worktree of `main` (its own
    `node_modules`): `--phase c` **74/74** (57/73 twice on 2026-11-14), `--phase k` **221/222**. So 45's sandbox defect
    was H1.* The one failure, `k2-shots-dark`, was a race in the test: 14 scenarios waited for the blank placeholder's id
    (`debug.computer.doc().id`) instead of the document really open (`docId()`), so the canvas refused their boxes
    (`unknown-part`; 3 failures in 9 alone on 45). It is fixed in all 14: 8/8 alone on 45; on 42 `--phase c` 74/74,
    `--phase k` 221/222. That run's one failure, `k3-sched`, passed 4/4 alone: the fourth scenario of the
    order-dependent kind, a different defect. The full run after the fix (42, 05:57–06:12): **420/420**, after three
    full runs that lost one scenario each. **Next: the bump itself** (both apps; the sync `safeStorage` calls before
    46), v0.2.20 having shipped (2026-11-23), with `--phase p` and a full run on 45.
    *2026-11-20 (day n° 11), the four read and three fixed* (read each one's waits, n° 10's *Next*):
    - **k1-escape** set `delayMs`, which the mock never reads (its knob is `askDelayMs`), so its "20 s reply" did not
      exist and Escape raced a run that ended in a moment;
    - **k3-sched** reloaded before the journal's write landed; it now waits for the stored row;
    - **k25** looked once after a fixed 700 ms; it now looks again up to 5 s.

    Each of the three passed alone and in all four `--phase k` runs on 42: 222/222, 221/222, 222/222, 220/222.
    **Not fixed:**
    - ~~**k3-control** (run 4, after `k3-canvas-every-notice-has-its-button`): its run's promise **never settled**.~~
      *Found and fixed 2026-11-21 (night n° 12), from the code:* the Dialog box draws its answer field from the start
      and only hides its row while nobody is asked (`graph/parts/dialog.mjs`), so the scenario's wait for
      `.graph-part-answer` was always already true. Step 5 answered before its second run had parked; that run then
      parked with nobody to answer, and `report()` waited 30 s. The scenario waits for the park itself now
      (`debug.computer.waits()`), and asserts the field is there with nothing parked. 3/3 alone, then `--phase k`
      223/223 in the full order. **That was not all:** a third full run (beside other work) failed at the same step,
      and `report()` now names its caller and what the page shows: no park open, the box still `waiting`. Reproduced
      2 runs in 3 under load (`--phase k3` beside ten CPU burners). **The cause is in the product**, the Computer's run
      loop (`graph/runner.mjs`): an answer given while the loop flushes its journal, just before it sleeps, woke
      nobody, and the loop slept up to 60 s, so a run went on up to a minute after a person answered a Dialog, a
      Confirm or a Timer. A wake that finds the loop awake is now kept for its next sleep; a unit test answers during a
      slow journal write (it timed out before, passes now); `--phase k3` under the same load 3/3; the whole
      harness 421/421 on the final code (04:48), and **`--phase k` 223/223 in full order beside the ten burners**
      (05:14–05:21).
    - ~~**k24-the-ide-binds-a-project…** (runs 2 and 4; 3/3 alone): a 20 s `waitFor` came back null.~~ *Found and
      fixed 2026-11-20 by day:* it failed alone too (1 in 3, 2 in 8, 1 in 10), at `k24-ide.mjs:204`, *Address saved*.
      **A race in the page**, not the test: after a refused `http://` address, `gitAct` reloads the saved remote, which
      overwrote the field unless it had focus. The test (or a quick person) typed the https address first, the reload
      put back the saved one (empty), and Save sent nothing. Now the field follows the saved address only while it
      still shows the last one loaded, or is empty (`project-panel.mjs` `shownRemote`). A refused address also stays
      there to fix, where it used to vanish. 12/12 alone after.

    **The harness now says which wait timed out:** `h.waitFor` adds the scenario's line to its message
    (`helpers.js`, e.g. `(scenarios/k24-ide.mjs:204:21)`). k3-control: found in its code before the next failure.

15. **A better LOL Vibe, able to build a proof-of-concept web application** (owner, 2026-11-14: "I am not convinced
    about what we have right now in lol vibe ... we need a better lol vibe experience for the users and we should be able
    to build a poc web application"; no Qwen Code trial for now). First the facts: night n° 5's audit walks LOL Vibe
    through building a small web application end to end, as a student would (a page with a form, a list kept in the
    browser, two or three files), and records every stumble with its screenshot; then a plan in `docs/plans/` for the
    owner (what the experience should be, what to build), after the class. **M–L**.
    *The facts, 2026-11-15* ([the review](../reviews/SESSION_REVIEW_2026-11-15.md)): a reading-list app (form, list, delete,
    kept in the browser, three files) built in 20.5 s and working; the stumbles: the page forgets its data at each restart
    (M2), the class model introduced as untried (M3), a cramped Preview in Split (L2), an empty chat with no example,
    jargon, and the agent sending the student to a browser the Preview already is (L3).
    **The plan: [LOLVIBE_POC_PLAN](LOLVIBE_POC_PLAN.md)** (night n° 12, proposed): a first look with three example
    asks, the words (L3), and the audit again as the proof. Its step 1, the page keeping its data across a restart
    (M2), was built the same night as a review finding.
16. ~~**The capacity page knows drafting**~~ *marked 2026-11-19 (night n° 10, 04:40): the capacity page's Qwen3.8 row
    and a preset that picks a drafting model say what drafting changes and that the estimate leaves it out (the
    catalog's `drafting`; `presets.js` reads the flags the farm starts the model with). The numbers stay the stock
    model's (drafting moves two limits in opposite directions). Test: farm `run.js` "presets and the capacity page".*
    The item was: `src/capacity/estimator.js` and the presets' estimate work from the catalog alone; pass the drafting
    to the estimator, or mark the row. **S**.
17. ~~**Two findings of the review of 2026-11-19**~~ *both fixed in the same night (n° 10, 03:45, unreleased): L2 by
    a ready record (`lol-owui-ready`) that spares the database, L6 by closing the page window first on quit; the
    review file says how.* ([SESSION_REVIEW_2026-11-19](../reviews/SESSION_REVIEW_2026-11-19.md)):
    **L2** a first-start marker that cannot be removed (a lock on a synced Documents folder) makes the next start set a
    used Open WebUI database aside (`sidecar.ts:268`, `:313`): retry the removal, and let `setAsideUnfinishedDb` spare a
    database Open WebUI has opened since (a record written at ready). **L6** quitting from the main window loses the
    page window's last ~0.85 s of typing (its `pagehide` edits reach a main window already gone): flush the page window
    before the main one closes. **S** each.
18. **LOL Vibe builds from a picture** (owner, 2026-11-20: "upload images of interfaces to be able to reproduce them
    with html css js - and even figma files, or images of scenes to be able to reproduce them with threejs"). Three
    asks: **a screenshot of an interface → a page in HTML, CSS and JS**; **a Figma design → the same**; **a picture of a
    scene → a three.js scene**. **The plan: [PICTURE_TO_PAGE_PLAN](PICTURE_TO_PAGE_PLAN.md)** (night n° 12, proposed:
    step 1 measures three models on screenshots, Figma exports and rendered scenes; found: a picture dropped in a chat
    bound to a project never reaches the agent today, `controller.mjs:594-599`). What exists
    (checked 2026-11-20 in the code, not yet run end to end):
    - the farm's default model sees pictures (Qwen3.6: `vision: true`, `farm/src/config.js`; Qwen3.8 and Gemma 4 26B too);
    - LOL Vibe's chat already sends a picture with a message (`shell/renderer/chat/net/request.mjs:155`, `image_url`);
    - the coding agent has a `read_image` tool (`shell/src/main/studio.ts:867`), so a picture saved in the project
      could be read;
    - three.js r160 ships in the client already, for the Computer's sandbox (`shell/renderer/chat/sandbox/libs.mjs`). A
      project page could use a local copy of it, with no network and no new dependency.

    **The plan must answer:**
    - **How a person hands over the picture:** dropped in the chat, or saved in the project for the agent to read.
    - **How well each farm model copies an interface or a scene.** *Measured in night n° 12* (the plan's step 1 without
      Figma; RESULTS ▸ *Pages from a picture*): six inputs made here, 3 samples each, through the chat API: Qwen3.6
      16/18 by the check, Gemma 4 26B 16 (by eye its three dashboards draw no chart), Qwen3.8 14; a simple page near
      identical, a scene right in objects and colours, off in light and depth. Figma: no frames yet.
    - **Figma** (the owner, 2026-11-20 12:46: "You mentionned images, but not figma"). Five ways in, read on Figma's
      own pages on 2026-11-20 (undated pages; [docs](https://developers.figma.com/docs/figma-mcp-server/),
      [help](https://help.figma.com/hc/en-us/articles/360040028114-Export-from-Figma-Design)):
      1. **Export a frame** (PNG, JPG, SVG or PDF; *all plans*, the free one too). A PNG is a picture like a
         screenshot. An SVG is text: the boxes' positions and sizes, the colours, the text, which the model can read
         exactly where a picture is guessed. Nothing new leaves the computer, and nothing to approve. **The first
         way to build and to measure** (an SVG and a PNG of the same frame through each model). Not checked: whether
         Figma's SVG export keeps text as text or turns it into outlines by default.
      2. **Figma's desktop MCP server** (`http://127.0.0.1:3845/mcp`, in the Figma desktop app, Dev Mode ▸ *Enable
         desktop MCP server*). It is local, and LOL Vibe's coding agent already speaks MCP (the Computer's server,
         `studio.ts:107`). Its tools give the design's code (React and Tailwind by default, plain HTML and CSS when
         asked), a screenshot, the variables (colours, spacing, type), the layers' outline, and the images. **But:** it
         needs a *Dev or Full seat* on a Professional, Education, Organization or Enterprise plan; Figma calls it
         "intended for specific organization and enterprise needs" and recommends its cloud server. High-school
         students and teachers get Figma's Professional plan free (Figma for Education); which seat that gives is not
         stated. The design comes from the person's own Figma account, so it is the case of DECISIONS 2026-11-05 (a
         person's own cloud documents read on their computer): **privacy.md first, with the owner's yes**. Not checked:
         whether the server's code generation calls Figma's cloud (Figma's AI is off for K-12 users).
      3. **A local copy (`.fig`, File ▸ *Save local copy*, all plans)**: a ZIP holding Figma's own binary format with
         no public spec. Open parsers exist, reverse-engineered (`fig-kiwi`, `openfig-core`); one would be a new
         dependency that breaks when Figma changes its format. Not now.
      4. **Figma's cloud MCP server** (`mcp.figma.com`): "Only clients listed in the Figma MCP catalog … can connect";
         a new client joins a waitlist. LlmOnLan cannot use it.
      5. **Figma's REST API** (`api.figma.com`, a personal token): a new cloud service from the client, and 20 calls a
         month for a View seat. The owner's call, after the two local ways.
    - **Where three.js comes from in a project:** copying it from the client's own copy (r160) or a CDN, which needs
      the internet.
    - **What a picture costs the shared GPU:** the image tokens of each turn, for a class at once.

    **M**.
19. **The tools' releases of 2026-11-20** ([the research](../research/TOOL_UPDATES_2026-11-20.md)):
    - **vLLM 0.34.0:** a trial on a second root, a measurement. It fuses the GDN prefill for the Qwen3.5 line
      (1.16–1.50×). It changes the default block size to 64. `--mamba-cache-mode` does nothing there. Then a plan for
      the bump if it wins. **Run in night n° 12 (RESULTS, 2026-11-21): it does not win.** The same pools and labels
      (Qwen3.6 24 at 128k, Qwen3.8 ≥ 32 at 32k), Qwen3.8's first word 0.1–0.5 s sooner, Qwen3.6 level, quality 28/28
      both, nothing broken. No bump on its own. Its **KV offload to system memory** (`--kv-offloading-size`), tried the
      same night on Qwen3.6 at 128k, stored but was never read (0 % hits; 40 people collapsed as without it): no lead
      either, for a hybrid model, as shipped.
    - **Open WebUI 0.13.4:** the pin bump and its smoke tests (invariant 5). Its "fewer repeated context lists" stops
      a 128k chat from filling with repeated skill and knowledge lists. **Approved 2026-11-20 12:46** (now in *1. Now*);
      **blocked 2026-11-21** (the Blender tools; BLENDER_TOOLS_ENV_PLAN).
    - vLLM: the owner says go for the bump, after the trial. **S** each.
20. **Evaluate Inkling 2 as a replacement of Qwen3.6 or Qwen3.8** (the owner, 2026-11-23 09:06: "lets wait for
    official support in either of the backend we have. Put that into to the todo list (evaluate inkling 2 small for a
    replacement of qwen3.6 or qwen3.8)"). **Waits for official support:** a vLLM **release** that serves
    `Inkling2LoopForConditionalGeneration` (in main since #69028, 2026-11-21; the recipe says 0.35.0+), an Ollama
    **release** that runs it on NVIDIA (today on Apple Silicon only, #19799), or llama.cpp merging #32187/#32695. Each
    session's look at the pinned tools' releases checks for it. *Which one:* **Inkling 2 Small** is 594B total (17B
    active), about 300 GB in NVFP4: it fits neither the PRO 6000 nor a Spark; **Inkling 2 Mini** (26.4B, 20.2 GB) is
    the one in our range ([the research](../research/INKLING_2_MINI_2026-11-23.md)), so the evaluation is Mini's
    unless the owner says otherwise. *Then:* people per card at 128k and 64k against Qwen3.6's 24 and 48 (estimated
    ~8 and ~13), the gate, a French classroom probe (`docs/spike/runs/fr_probe.py`; the vendor says it is weaker
    outside English), the coding agent's tasks, and the think-off switch (it reads `reasoning_effort`, not
    `enable_thinking`). **S**, the measurement; the adoption is the owner's.

## 3. Later

- **The farm:**
  - free a person's seat when they quit (D-F1; "Free an idle seat after" covers it today);
  - ~~the panel drops a finished job's bar after a few minutes (review 2026-11-15 L1: *Updating vLLM … with Qwen3.8* stayed
    up while Qwen3.6 served)~~ *built 2026-11-23 (night n° 14, unreleased): a bar that finished well leaves after 5 min, a
    failed one stays until the next job; a farm test;*
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
- ~~**Split DEVLOG.md** at 2026-10-01 into the archive.~~ *Done 2026-11-13: [archive/DEVLOG_2026-06_to_09.md](../archive/DEVLOG_2026-06_to_09.md).*

## 4. Waiting on the owner

**The ones that unblock the most:**
- **[BLENDER_TOOLS_ENV_PLAN](BLENDER_TOOLS_ENV_PLAN.md)** (night n° 12, proposed): the Blender tools through
  `TOOL_SERVER_CONNECTIONS` (env, as the Computer's), so Open WebUI 0.13.4 and later can come without losing them.
  **S**. Until the owner says yes, Open WebUI stays at 0.13.3 (plans ▸ Now, the bump: blocked).
- **[AGENT_FIRST_STEP_PLAN](AGENT_FIRST_STEP_PLAN.md)** (night n° 13, proposed): Gemma 4 26B on Ollama ends 1 coding
  task in 30 with a thought and nothing else (3 of 90, both Ollama versions); LlmOnLan would ask it once, in the same
  reply, to go on. **S**. Until then the reply says nothing was done (built tonight as a reproduced bug).
- **[AGENT_LOOP_PLAN](AGENT_LOOP_PLAN.md)** (night n° 13, proposed): Gemma 4 26B on vLLM ran 4 coding tasks of 30 past
  300 s in one reply (up to 1,143 s and 407 steps), holding the student's seat. Replayed on 120 logs, the Agent box's
  rule would stop 16 passing tasks; stopping at the fifth identical failure stops 1 passing and 3 failing. **S**.
0. **Client v0.2.19** with [OWUI_START_PLAN](OWUI_START_PLAN.md) (built 2026-11-17 on `main`, approved by the owner):
   your go to push `main` and tag it, then HUMAN_TESTS A28 on the release. `main` now also carries the Agent box's
   loop stop (Next 13, night n° 9; unit tests and the harness, not in A28) and
   [OWUI_REPAIR_PLAN](OWUI_REPAIR_PLAN.md)'s repair button (approved and built 2026-11-18; A28 step 7). Owner
   2026-11-18: go for v0.2.19 once the repair button is in. **Released 2026-11-18** (CI green); A28 is what waits on you.
1. **The next release and the ★ list** (Now 1–2), and which build tests today's fixes: a local build or a pre-release
   tag. *Owner, 2026-11-14: full release tags at the end of Monday's session (n° 6), tested on Monday.*
2. **A quiet hour on the PRO 6000** (Now 3, then Next 1).
3. **May vLLM's own model read documents** instead of a second gemma4:12b? It frees 9 GB, about 14 % more room for
   conversations (multi-user decision 6). **M**.
4. **CI minutes for the tests** (Next 4).
5. **CLAUDE.md:**
   - ~~cut it to about 350 lines~~ done 2026-11-12: 172 lines, the detail moved verbatim to
     [../context/](../context/). Still to do: check each module against the code (the first reviews' job);
   - change it only when a rule, the contract, a port or the map changes;
   - reword invariant #4 to the calls the contract table lists (it says "admin REST API", which the app never uses).
6. **Should Open WebUI chats think by default?** (night n° 10, [CLASS_REHEARSAL_PLAN](CLASS_REHEARSAL_PLAN.md) ▸
   step 3.) The slowness with ten is the thinking. Qwen3.6 thinks 1,000–2,000 words before an answer's first word.
   Half the people wait 11–18 s at 10 at once and 18–22 s at 20, against 0.2–0.3 s with thinking off; with thinking
   off each person also gets 101 words a second instead of 78 at 20. Ways it could go, each a plan first:
   - **off by default for Open WebUI's chats, from env alone:** Open WebUI 0.13.3 reads `DEFAULT_MODEL_PARAMS`
     (`config.py:1727`) as every chat's base parameters, and deep-merges its `custom_params` into the request
     (`utils/payload.py:108-134`). So `{"custom_params":{"chat_template_kwargs":{"enable_thinking":false}}}` would
     do it, with no REST call. A chat's own parameters still win (`main.py:1201-1216`), so a person can turn thinking
     back on in Chat Controls, though only as a custom parameter. LOL Vibe and the Computer ask the farm directly and
     are not touched. The contract table would list the new env. *Read in the code, not run:* the contract found
     that `DEFAULT_MODEL_PARAMS.system` never reaches a farm model's messages, so the plan checks first that
     `custom_params` does;
   - a farm-side default on `assistant` (LiteLLM). This would also stop the thinking of the Computer's thinking
     boxes and LOL Vibe's agent (`ask.mjs`: `think: true` sends nothing, the model's own default);
   - a second model name that thinks;
   - leave it, and say in the help what the *Thinking* fold is.

   Quality: the spike's 28-item check on Qwen3.6 (PRO 6000) scored 27/28 with thinking (77k tokens) and 28/28 without
   (12k; `build_catalog.py`, Qwen3.6's `spike_quality`). Not measured: a class's own kind of questions.
7. ~~**Qwen3.8's recurrent state in fp16?**~~ *Answered: step 1 passed 2026-11-20 and the owner confirmed steps 2–4
   the same day, 12:46 (now in *1. Now*).* (2026-11-19, learnt from HyperQwen's batch mode;
   [research](../research/2026-11-19-codeaf-hyperqwen.md) ▸ *HyperQwen's batch mode*.) One stock vLLM flag,
   `--mamba-ssm-cache-dtype float16`, on the built-in Qwen3.8 entry: 30 people 93 → 124 tok/s each, seats at 32k
   22 → 30, 28/28 and the same answers (210 samples). **The plan is written** (the owner's yes, 2026-11-19):
   [QWEN38_FP16_STATE_PLAN](QWEN38_FP16_STATE_PLAN.md). **Its step 1 is a measurement any session may run:** 30
   people ~30k deep, a long-text check, people at once like for like with today's label, and seats from stock vLLM's
   own line. **Steps 2–4 (the flag, `facts()`, J19 again) wait for the plan's approval.** Not Qwen3.6: there it fails
   30 people ~50k deep (twice), cause not found.

**Choices to make, one line each:**
- **The farm:**
  - ~~may a session serve **Nemotron 3.5 Super VL** with `--trust-remote-code` in the trial vLLM?~~ *Yes, once (owner
    2026-11-13), after the class of 17 November ([the class's plan](CLASS_TEST_2026-11-17.md), night n° 7);*
  - ~~an OCR upload cap of 100 MB~~ *200 pages and 100 MB (owner 2026-11-13), built (Next 2);*
  - FSV-2's progress, (a) or (b);
  - the panel's text for an Ollama the farm did not start (FSV-7);
  - a panel change after a terminal pick writes the picked list whole (FEN-2): fix it, or leave it;
  - CLI farms whose file says `vllm.version 0.30.0` (FEN-3): follow the farm, or a README line;
  - a preset also sets "Free an idle seat after";
  - Ollama's people at once applied without a restart;
  - speech to text on by default on NVIDIA, Qwen3-Omni as the transcriber, and vLLM on a 16 GB card (DEVLOG
    2026-10-10).
- **The client:**
  - ~~**the Computer waits while LOL Vibe answers** (one request at a time per laptop, `net/governor.mjs`): keep it, or
    let the Computer run beside a chat when the farm reports spare places~~ *Keep the rule, for now (owner
    2026-11-16, FIELD_NOTES). The middle way, if asked again: a second lane only when the farm reports spare places,
    the person's chat still first; a plan and a measure of 30 laptops × 2 before code;*
  - Open WebUI's terminal links now open nothing (xterm's blank window): accept it, or allow a blank window;
  - refuse the bus's WebSocket port 8893 in Fetch/Send;
  - LOL Vibe's wait sentence while vLLM starts;
  - LOL Vibe's old discussion items (D-C6 screen capture, D-C8 mailto, D-F7 OCR progress, D-F8 a farm page fetch,
    D-O1 *Continue in Open WebUI* as a file, D-O3, D-U1, D-U6, D-S1).
- **The Computer:**
  - *found 2026-11-12, not reproduced since:* **the Computer's sandbox failed to start in the harness** on the evening
    of 12 November, with *The sandbox could not start, so nothing was run*, each just past its 3,000 ms boot limit
    (`sandbox/protocol.mjs` `TIMEOUTS.boot`): `--phase k` 175/217 then 174/217, every sandbox scenario from the first one
    on; the 500x200 scenario failed alone while another harness ran beside it. **At 22:15 the same day, the same tree:**
    `--phase k` 216/217 (every sandbox scenario passed; `k3-control-branches` timed out once and passed alone), and the
    500x200 scenario alone passed in 863 ms. **The mechanism first written here was wrong:** a failed boot does not stay
    `disabled`; `destroyFrame` clears the frame, and every later `compute`/`run` calls `boot()` and builds a fresh one
    (`sandbox/host.mjs` `boot`), so each box waited its own 3 s. What made every boot slow that evening is not known (a
    large download ran both then and at 22:15; the GPU was full for one failed run and free for the other). **Watch:** if
    a harness run shows it again, note what else runs on the machine; if a real window shows it, the 3 s limit is the
    question (a slow school laptop);
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
