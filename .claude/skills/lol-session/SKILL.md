---
name: lol-session
description: Runs one LlmOnLan work session from start to end - reads the five last session summaries, picks the work, does it with tests and evidence, and writes the dated summary. Use it when a scheduled night session starts, or when the owner says "start a session".
argument-hint: "[hours, default 5] [focus, optional]"
---

# One LlmOnLan session

You run one work session on LlmOnLan. `CLAUDE.md` ▸ *How we work* holds the rules; this is the procedure.
The owner wants precision, not speed: read the documentation, check each fact in the code or by running it, and write
down what you did not check.

## 0. Before anything

1. Run `date`. Note the start time and the time you must stop: the hours in `$ARGUMENTS`, else 5 (a night session runs 02:00 to 07:00). Plan to
   start the summary 20 minutes before that.
2. `git status` and `git branch --show-current`. You work on `main`, and you **commit without ever pushing**. If the tree is dirty with work that is
   not yours, do not touch it: say so in the summary and work around it, or stop.
3. Count the files in `docs/sessions/` (not the README). This session's number is that count plus one.
   **If the number is a multiple of 5, this session is a review: run the skill `lol-review` and skip step 2 below.**

## 1. Read the thread

1. The five last files of `docs/sessions/`, newest first. A line starting with `> owner:` is an instruction: it outranks
   the summary's own "Next". An answer under "Questions for the owner" settles that question.
2. `docs/plans/README.md`: the next work, in order.
3. `git log --oneline` since the last summary's commit: what changed outside the sessions.
4. Only now, the context modules your work touches (the table in `CLAUDE.md`). Not the others.

Write your plan for the session in a few lines: what, in which order, and how you will know each is done.
**Consult the advisor before you lock it.**

## 2. Work

Pick from this menu, following the owner's lines first, then the last "Next", then the plans:

- **Look:** read what changed since the last session; fact-check a doc against the code it describes.
- **Test:** the suites (`farm`: `node test/run.js`; `farm-app`: `npm test`; `shell`: `npm run test:chat`, and
  `node test/chat-harness/run.js` for the client driven for real). Run a farm and a client yourself with the skill
  `lol-scratch-farm`. Measure with `docs/spike/spike_bench.py`.
- **Research:** new models, engines and harnesses that matter here (the `docs` explorer reads the references). A
  finding is a dated file in `docs/research/` with its sources, and a line in the plans if it deserves work.
- **Plan:** a new feature gets a plan in `docs/plans/` before code. A plan that needs the owner's decision stops there.
- **Build:** a plan that is ready. Smallest change that works (the ponytail ladder in `CLAUDE.md`), with one runnable
  check for any logic that is not trivial.
- **Document:** the context module, the README, the in-app help and tutorial that the change touches, in the same commit.

How to work:
- Explore with the `search`, `grep` and `docs` subagents when a question needs many files; check what they return
  before you build on it.
- **Consult the advisor** when the same error shows up twice, and before you call a task done.
- After each tested step: a DEVLOG entry with the real time (`date`) and a commit on `main`. No push.
- A failing test is a finding, not an obstacle: fix the cause, or record it. Never weaken a test to pass.

## 3. Hard limits

Everything under "What a session never does without the owner" in `CLAUDE.md`. In short: no push, no tag, no
release; never touch the farm people use, the owner's client, its data, the Ollama app; nothing deleted outside your
scratch folder; nothing posted to another project; the prime directive and the privacy boundary are not yours to bend.
If the work needs one of these, stop that task and write the question in the summary.

If you are blocked on everything, write the summary and end the session early. An honest short session is a good one.

## 4. End

1. Stop every process you started (the scratch farm with `lol down` from its folder, a scratch Ollama, a test client)
   and check they are gone. Check the live farm still answers as it did at the start.
2. Write `docs/sessions/<date>.md` from the template in `docs/sessions/README.md`: done with evidence, not done and
   why, found, next, questions for the owner.
3. **Is a release due?** If the unpushed commits (`git log origin/main..main`) hold something people should get (a fix
   they are hitting, a feature that is whole and tested), open the summary with `RELEASE READY`: what it brings, and
   which HUMAN_TESTS a person should run first. Do not push or tag.
4. Commit the summary. No push. The last line of your final message is the path of the summary.
