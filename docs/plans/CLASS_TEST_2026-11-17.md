# The class of Tuesday 17 November 2026

**Status:** approved by the owner, 2026-11-13, in these words (08:40): *"FYI we will have a test with a group of 30
students on tuesday 17, until then we should work at having something robust and most functionnal with the best quality
possible. It is a real life test everything should be tight and working for this date : chat, vibe and computer. You can
update the plans and plan the future night session with this goal"*; and later that morning: *"Your goal by tuesday will
be also to refine tutorials, docs, in app tutorials. Write also a list of human tests I should do before tuesday."*
Approved by those messages and the owner's answers of the same morning:
- the goal: chat (Open WebUI), LOL Vibe and its coding agent, and the Computer, tight for 30 students;
- **the tutorials, the docs and the in-app tutorials refined** for a first-time user;
- fixes for the defects the checks below find, each with its test;
- **J14 by a session** (vLLM 0.30.0 → 0.33.0 on the PRO 6000, from the panel), and **the rehearsal on the live farm**
  (30 simulated people, no restart beyond J14's, no config change);
- Plans ▸ Next 2's caps, 200 pages and 100 MB (built 2026-11-13);
- after the class: Super VL with `--trust-remote-code`, once, in the trial vLLM; Next 10, pruning the coding agent's
  session logs older than 30 days.

**The night table below is proposed** by the session of 2026-11-13; an `> owner:` line in a session summary changes it.
**No new feature before the class**, unless the owner says yes to one by name (question 1).

## The class, as the owner described it (2026-11-13)

- **Not a lesson:** the owner shows LlmOnLan, then the students try it hands-on and give feedback.
- **30 students, their own laptops, Windows and Mac.** They **install on Tuesday**, in the room.
- **The owner's own Wi-Fi.** The farm has **no password**.
- Sheets in English.

## What must hold on the day

*Done when* (Tuesday, before the class): every line is ticked, by the owner ([BEFORE_TUESDAY.md](../BEFORE_TUESDAY.md)) or by a
session, with its evidence.

- [ ] Thirty installs in the room fit the time: the Wi-Fi's speed is measured (test 2) and the students' sheet tells them
      what to start first (risk 1).
- [ ] A student's 20 minutes pass from a fresh install on Windows and on a Mac, on the builds the students get (test 5,
      and night n° 4 on a scratch client).
- [x] The farm serves 30 people at once, measured in J16's units: no refusal, first token p95 under 5 s, decode p10 at 15
      tokens a second or more; both from 30 addresses and from **one** (the NAT case) (risk 2).
      *Night n° 3, 2026-11-14:* vLLM · Qwen3.8 · 32k · 36 seats passes every shape at 30 (and 36) (RESULTS ▸ *30 people for the
      class*); the farm left on it.
- [ ] A laptop on the owner's Wi-Fi finds the farm, or the students' sheet says how to add it by address (test 2, risk 3).
- [ ] The tutorials, the in-app tutorials and the docs a student or the owner meets are refined (risk 6).
- [ ] **The client freeze, Monday 16, 12:00:** the last client release before the class (the students install on
      Tuesday, so they get the latest). The owner runs test 5 on it on Monday afternoon.
- [ ] **The farm freeze, Monday 16, evening:** after it, only a blocker changes the farm.
- [ ] The two sheets (`docs/CLASS_SHEETS.md`, English): the students' (install, find the farm, what to try, how to give
      feedback) and the owner's (what to do on *farm full*, *not responding*, *the sandbox could not start*, a slow
      download). Committed with placeholders for the farm's address: the repository is public; no school name, no
      student's name.

## The risks, worst first

1. **Each student downloads about 1 GB on first start, in the room** (v0.2.17's Windows assets, read 2026-11-13:
   installer 99 MB, chat engine `owui-sidecar-win32-x64` 740 MB, coding agent `dsh-runtime-win32-x64` 104 MB; a Mac about
   0.9 GB; plus Open WebUI's document model on a farm without document search, up to about 92 MB). 30 students is
   about 30 GB through the Wi-Fi's internet line. At 6 MB/s (the school's line on 2026-11-10) that is **about 80
   minutes**; at 20 MB/s, about 25. *Answer, with what exists:* Test 2 measures the line; the students start the install
   first, while the owner shows; the coding agent only for those who try the IDE; the installers on a USB stick save
   only 10 %. *Answer that needs a build:* the farm hands out the chat engine and the coding agent on the LAN, and the
   client asks the farm before GitHub (question 1). Not built; **M**; it would have to land before the client freeze,
   so test 2 must be done **by Saturday evening**: a yes then means night n° 4 builds it, and the student's 20 minutes move
   to a day session. If the Wi-Fi's internet is a 4G/5G box, 30 GB may also meet its data cap.
2. **Answered by night n° 3 (2026-11-14), then by the owner the same day:** Qwen3.6 35B-A3B at **64k** for the class ("3.6 long
   context is valuable"); night n° 3 had left vLLM · Qwen3.8 27B · 32k a person · 36 seats, which also holds
   30 on every shape measured; llama.cpp cannot (16 seats at most, and it collapses with documents). Kept below for the
   record: **Found 2026-11-13 15:52 (`/lol/self`): the live farm runs llama.cpp, not vLLM**: Qwen3.8-27B-NVFP4-MTP, `parallel` 1, one 262k window, so **1 seat**. From 30 addresses that refuses 29 students (*farm full*); behind NAT it admits them all and answers one at a time. The owner switches it back to vLLM (32 people at 64k) from the panel, or says otherwise, **before night n° 3**; night n° 3 checks `backend.engine` and `capacity.slots` first and runs J14 and the rehearsal only on vLLM.
   **30 at once has never run through the seat gate** (J16 was never run). Production's vLLM is **0.30.0** (read in
   WSL, 2026-11-13): 32 people at 64k every turn. **J14 (0.33.0, 48 people) is run by night n° 3**, if the Farm app
   there is farm-v0.0.51 or later (the last recorded is farm-v0.0.48: the owner's step 3 installs the new one first).
   **Behind NAT, the farm sees the owner's Wi-Fi as one address** (checked in the code 2026-11-13, every per-address
   rule): the seat gate gives the 30 students **one seat** and refuses none of them (vLLM serves them all up to its own
   room and queues the rest; the pill's `N/M free` then means little); but **speech to text and Classify allow one
   request at a time per address** (`stt_server.py`, `classify_server.py`: *one recording at a time from this
   computer*, 429, the client retries once after 3 s), so behind NAT **one student at a time** can speak to the
   Computer or use voice. The bus only logs addresses. The rehearsal measures the chat in both shapes; the owner's sheet
   carries the voice limit.
3. **Discovery:** the beacon reaches a laptop only on the farm's own subnet; the search sweeps only the laptop's own
   subnet ([discovery](../context/discovery.md)). If the owner's Wi-Fi is another subnet than the PRO 6000's, each
   student adds the farm by its address (Test 2 decides; the students' sheet says how either way).
4. **A student's first 20 minutes have not run end to end on the current builds:** night n° 4 runs them on a scratch
   client against the live farm, the owner on real laptops (test 5). A client defect must be fixed before Monday 12:00.
5. **The Computer's sandbox has a 3 s start limit** (`sandbox/protocol.mjs` `TIMEOUTS.boot`), and it failed on this
   machine one evening (plans ▸ 4 ▸ the Computer). *Answer:* the rehearsal runs the harness with the farm loaded; the
   owner runs test 5 on the slowest laptop. Raising the limit is a one-line fix, decided on that evidence, before the client
   freeze.
6. **The words a first-time user reads:** the in-app Tour, lessons and help, LOL Vibe's empty state and its guide,
   GETTING_STARTED's install section (its "about 0.8 GB" is right: 728–776 MB in v0.2.17's assets, checked 2026-11-14;
   the macOS 15 route was missing, added that night). **macOS 15 and later** no longer let right-click ▸ Open pass an app that is not notarized
   (ours is ad-hoc signed, [release](../context/release.md)): the student opens it once, then System Settings ▸ Privacy
   & Security ▸ *Open Anyway* (an admin password). Test 5 records what a current Mac asks; the sheets give both ways, the
   minimum systems (an Intel Mac needs macOS 14) and that a Chromebook cannot run the client. *Answer:* night n° 4 reads them along the first 20 minutes and fixes what a
   student would stumble on; night n° 5's review checks them against the running app.
7. **30 PDFs at once:** OCR runs outside the seat gate. *Answer:* the stop between pages and the caps (200 pages,
   100 MB), in the Farm app release (K16).
8. **Web search under a burst** is untested (Next 3) and off by default. It stays off for the class; the owner's sheet
   says so.

## The nights

The cron fires each night at about 01:49 for five hours; it expires on **2026-11-19**.

| Night | Session | Objective | Done when |
|---|---|---|---|
| Sat 14, 01:49 to ~06:50 | n° 3 | **Changed by the owner, 2026-11-13 16:00** ([the summary](../sessions/2026-11-13.md#next-objective)): **both engines for 30 people**, Qwen3.8-27B on llama.cpp and Qwen3.6 35B-A3B on vLLM, the session switching the live farm; the farm left on the one that holds 30 (Qwen3.8 if it does); J14 only if time is left. *Was:* **J14, then the rehearsal on the live farm.** First `/lol/self`: nobody on it, and the Farm app's version (J14 needs farm-v0.0.51+; if older, skip J14 and say so). J14 from the panel, as HUMAN_TESTS J14 writes it, its way back read before starting. Then 30 people through the gate from 30 addresses (`lol bench --people --users 30`) and from **one** (J16 step 3 at 16 and 30), with coding agents (`docs/spike/ide/run.js`) and the Computer harness (`--phase k`) beside it, and a few PDFs to OCR. | J14 done (or why not), the farm back up and answering as before; the rehearsal's table in RESULTS (refusals, first token p50/p95, decode p10, agent tasks passed, harness passes) and the defects ranked. |
| Sun 15, 01:49 to ~06:50 | n° 4 | **Changed by the owner, 2026-11-14 11:00** ([the summary](../sessions/2026-11-14.md#next-objective)): **the engines' upgrades**: research of each pinned tool's releases, J14 (vLLM update) on the live farm with Qwen3.6 35B-A3B at 64k measured again for 30, the newer llama.cpp on a scratch farm, thinking off measured in the real app; then RELEASE READY. The farm left on Qwen3.6 64k. *Was:* **A student's 20 minutes** on a scratch client against the live farm (BEFORE_TUESDAY test 5's steps), and **the words along it**: the Tour, the lessons, LOL Vibe's help, GETTING_STARTED's install, fixed where a student would stumble; the rehearsal's defects, client first. *Side task:* `docs/CLASS_SHEETS.md`. | Each step passes or is fixed with its test; the sheets written. |
| Mon 16, 01:49 to ~06:50 | n° 5 | **The review** (every fifth session, `lol-review`), scoped to what the students meet: the in-app tutorials and help, the guides, the sheets, against the running app. Its small fixes to words land before the client freeze (12:00), in a day session the owner opens, or wait on the owner's sheet. | The review report; each finding fixed, or on the owner's sheet. |
| Tue 17, 01:49 to ~06:50 | n° 6 | **Checks only.** `/lol/self` answers with the right version, engine and seats; one chat, one coding-agent task and one Computer run, as one person. No restart, no config change, no commit but the summary. | The summary's first lines say the farm is ready, or what is wrong, by 06:30. |
| Wed 18, 01:49 | n° 7 | The class's feedback into FIELD_NOTES first (the owner's notes); then Super VL (approved once). | — |

## What the owner does

[BEFORE_TUESDAY.md](../BEFORE_TUESDAY.md), seven short tests, about 2 h in all: the Farm app updated on the PRO 6000
before Saturday 01:00 (1), the Wi-Fi by Saturday evening (2), the usage report and the PDFs on the new releases (3, 4),
a student's 20 minutes on Windows, a Mac and the slowest laptop on Monday afternoon (5), three laptops at once (6),
Tuesday morning (7). And a day session on Monday morning for the review's fixes, before the client freeze.

## Questions for the owner

1. **A farm copy of the chat engine** (risk 1): may a session build it before the client freeze (the farm serves the
   chat engine and the coding agent it downloaded once; a new client asks the farm first, GitHub second)? *Recommended:
   decide after test 2, by Saturday evening.* If one 740 MB download takes under about 40 s on your Wi-Fi, no: the class installs in about 25
   minutes while you show. If it takes much longer, yes, knowing it is a new path in the client two days before the
   class.
2. **The releases:** cut client v0.2.18 and the next Farm app now and run A24 and K16 on them (the practice since
   2026-10-09: the tests run on published releases), or a local build first? *Recommended: cut them now*: the
   students install the latest on Tuesday, and a fix release before Monday 12:00 stays possible.
   > owner (2026-11-14): test the new vLLM and llama.cpp tonight, cut the releases after.
3. **Today's window:** the live farm is off and the GPU free now. May a session run test 5's student path on a scratch
   client and a scratch farm today, and start the words pass? *Recommended: yes*: it takes the riskiest client work off
   the last night before the freeze.
4. **Where is the PRO 6000 on Tuesday?** On your Wi-Fi's own network, or on the office network your Wi-Fi connects
   to? (test 2 answers it too.)
5. **LOL Vibe shows what it made, at once** (the owner's test, 2026-11-13, FIELD_NOTES): a ▶ Preview on an HTML answer
   in the chat, like the SVG one (no project needed), and running a Python script. A new feature: **may a session build
   the HTML preview before the client freeze?** Python needs a plan (no Python on a student's laptop is assumed).
6. **vLLM by default** on a farm like the PRO 6000 (the owner, 2026-11-13: "it should be the default for this
   configuration"): after night n° 3's numbers, since the owner prefers Qwen3.8 on llama.cpp if it holds 30. A plan line.
   > owner (2026-11-14): yes, vLLM as the default on big cards. A plan, after the class.
