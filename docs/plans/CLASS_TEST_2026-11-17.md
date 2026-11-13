# The class of Tuesday 17 November 2026

**Status:** approved by the owner, 2026-11-13, in these words (08:40): *"FYI we will have a test with a group of 30
students on tuesday 17, until then we should work at having something robust and most functionnal with the best quality
possible. It is a real life test everything should be tight and working for this date : chat, vibe and computer. You can
update the plans and plan the future night session with this goal"*. Approved by that message and the owner's answers of
the same morning:
- the goal: chat (Open WebUI), LOL Vibe and its coding agent, and the Computer, tight for 30 students;
- fixes for the defects the checks below find, each with its test;
- Plans ▸ Next 2's caps: **200 pages and 100 MB per upload** ("a good start");
- after the class: Super VL with `--trust-remote-code`, once, in the trial vLLM; Next 10, pruning the coding agent's
  session logs older than **30 days**.

**The night table below is proposed** by the session of 2026-11-13 for the owner to read; an `> owner:` line in a session
summary changes it. **No new feature before the class**, and nothing that only matters after it.

## What must hold on the day

*Done when* (Tuesday, before the class): every line is ticked by a person or by a session, with its evidence in a session
summary or HUMAN_TESTS.

- [ ] Every student's laptop has the client installed and has **opened all three surfaces once**: the chat engine and
      the coding agent are downloaded (risk 1).
- [ ] A student's first hour passes from a fresh profile on the build the students install (risk 4).
- [ ] The farm serves 30 people at once through the seat gate, measured in J16's units: no refusal, first token p95
      under 5 s, decode p10 at 15 tokens a second or more (risk 2).
- [ ] Each student's laptop finds the farm, or has its address on the students' sheet (risk 3).
- [ ] **The client freeze, Sunday 15, 12:00:** the last client release before the class. Students install after it, or
      open the app once on Monday so its update applies before the class.
- [ ] **The farm freeze, Sunday 15, evening:** the last Farm app release installed on the PRO 6000, with J14 (vLLM
      0.33.0). After it, only a blocker changes the farm; Monday's review findings go on the teacher's sheet.
- [ ] The teacher's sheet: what to do on *farm full*, *not responding* and *the sandbox could not start*, and who to
      call. **The sheets are committed with placeholders** (the repository is public): the owner writes the farm's
      address and password on the printed copy. No school name, no student's name.

## The risks, worst first

1. **First start downloads about 1 GB per student** (v0.2.17's Windows assets, read 2026-11-13: installer 99 MB, chat
   engine `owui-sidecar-win32-x64` 740 MB, coding agent `dsh-runtime-win32-x64` 104 MB; a Mac about 0.9 GB), plus Open
   WebUI's document model from Hugging Face on a fresh profile (MiniLM, up to about 92 MB,
   [client](../context/client.md)). 30 students at once is about 30 GB through the school's line, which gave about
   6 MB/s on 2026-11-10: **about 80 minutes before the class can start**. *Answer:* the students install before Tuesday,
   at home or in a slot, and open the chat, LOL Vibe (pressing *Install the coding agent*) and the Computer once. The
   students' sheet says so. Nothing to build.
2. **The class at once has never run through the seat gate** (J16 was never run). Production's vLLM is **0.30.0**
   (read in WSL, 2026-11-13). On it, Automatic gives Qwen3.6 **32 people at 64k every turn**. A seat is one address: a
   student's chat, coding agent and Computer share it. The 32 must also hold the teacher, the owner's client on the farm
   box (127.0.0.1 holds a seat) and anyone in the office on the farm that day. **J14 (vLLM 0.33.0, 48 people) is close
   to required.** And if the students' Wi-Fi is behind NAT, 30 students are **one** address to the gate (question 2).
   *Answer:* the owner runs J14 this weekend; the rehearsal measures 30 through the gate on what runs that night (0.30.0
   if J14 comes later, which is the harder case).
3. **Discovery across subnets:** beacons do not cross from 10.10.16.x to 10.10.17.x
   ([discovery](../context/discovery.md)); the search sweeps only the laptop's own subnet. *Answer:* the owner says which
   network the students use; the sheet carries the add-by-address step either way.
4. **A student's first hour has not been run end to end on the current builds:** the chat with a PDF, LOL Vibe's chat
   and coding agent, a Computer lesson and a template. A defect found after the client freeze cannot reach the students.
   *Answer:* the first night runs it, from a fresh profile, on a scratch client and a scratch farm.
5. **The Computer's sandbox has a 3 s start limit** (`sandbox/protocol.mjs` `TIMEOUTS.boot`), and it failed on this
   machine one evening (plans ▸ 4 ▸ the Computer). A slow school laptop could meet it. *Answer:* the first night runs the
   harness while the farm is loaded; the owner tries one slow laptop. Raising the limit is a one-line fix, decided on
   that evidence, before the client freeze.
6. **30 PDFs at once:** OCR runs outside the seat gate. *Answer:* the stop between pages and the caps (200 pages,
   100 MB), built 2026-11-13, in the one Farm app release (K16).
7. **Web search under a burst** is untested (Next 3) and off by default. *Answer:* it stays off for the class; the
   teacher's sheet says so.

## The nights

The cron fires each night at about 01:49 for five hours; it expires on **2026-11-19**.

| Night | Session | Objective | Done when |
|---|---|---|---|
| Sat 14, 01:49 to ~06:50 | n° 3 | **The readiness run.** A: a student's first hour from a fresh profile on a scratch client and a scratch farm: the chat with a PDF, LOL Vibe's chat and coding agent (`docs/spike/ide/run.js`), the Computer (the harness, `--phase k`, and a real window over CDP). B: 30 people through the seat gate (`lol bench --people --users 30`, then J16's step 3 at 16 and 30), with coding agents and the harness beside it. B on the live farm only if the owner said yes (question 4) and `/lol/self` shows nobody on it; otherwise on the scratch farm, sized as production. | A's steps pass or are defects ranked; B's table in RESULTS (refusals, first token p50/p95, decode p10, agent tasks passed, harness passes); the client defects fixed, or listed for the owner, before the client freeze. |
| Sun 15, 01:49 to ~06:50 | n° 4 | **The fixes** night 3 found, client first (the client freeze is at noon). *Side task:* the students' sheet and the teacher's sheet (`docs/CLASS_SHEETS.md`, with placeholders). | Each defect fixed with its test, or written on the teacher's sheet; the sheets written. |
| Mon 16, 01:49 to ~06:50 | n° 5 | **The review** (every fifth session, `lol-review`), scoped to what the students touch: the in-app help, tutorials and lessons, LOL Vibe's guide, GETTING_STARTED, against the running app. After the freezes: its findings go on the teacher's sheet unless one is a blocker. | The review report; the teacher's sheet updated. |
| Tue 17, 01:49 to ~06:50 | n° 6 | **Checks only.** `/lol/self` answers with the right version, engine and seats; one chat, one coding-agent task and one Computer run, as one person. No restart, no config change, no commit but the summary. | The summary says the farm is ready, or what is wrong, by 06:30. |
| Wed 18, 01:49 | n° 7 | The class's field notes first; then Super VL (approved once). | — |

## What the owner does

- **Friday or Saturday:** A24 and K16, then the Farm app release (it carries the token delay, the wizard's timeouts, the
  OCR stop and the caps). The client release can wait for night 3's first hour (Saturday morning), or go now if A24
  passes and a second client release by Sunday noon is fine.
- **This weekend, at a quiet moment, before the farm freeze:** J14 (vLLM 0.30.0 → 0.33.0 from the panel, about 45 min),
  and the new Farm app on the PRO 6000. Read its version in *About* (the record question 12).
- **After the client freeze:** send the students' sheet; the students install and open the three surfaces once.
- **Monday:** one slow laptop, a student's first ten minutes (risk 5).

## Questions for the owner

1. **The students' computers:** their own laptops? Windows, Mac, or both (Chromebooks cannot run the client)? Can they
   install before Tuesday?
2. **The network:** which Wi-Fi and subnet the students use; **is it behind NAT** (then 30 students are one address to
   the seat gate)? Does the farm have a password?
3. **The lesson:** what will the students do: questions with documents, a web page with the coding agent, which Computer
   lesson? The rehearsal should copy it.
4. **The rehearsal on the live farm,** night 3: may the session fill it with 30 simulated people for about an hour when
   nobody is on it (no restart, no config change)? **Answer before Saturday 01:49**; with no answer, night 3 runs B on a
   scratch farm, which needs the live farm closed that night (or B waits).
5. **J14:** you, this weekend, or may a session do it at night with your yes?
6. **The sheets' language:** French?
