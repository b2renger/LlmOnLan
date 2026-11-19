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
2. `git status` and `git branch --show-current`. You work on `main`, commit, and back up with `git push origin main:night` only. If the tree is dirty with work that is
   not yours, do not touch it: say so in the summary and work around it, or stop.
3. Count the dated files in `docs/sessions/` (`20*.md`: not the README, not FIELD_NOTES). This session's number is
   that count plus one; its summary will be `docs/sessions/<date>-n<number>.md` (the date the session starts).
   **If the number is a multiple of 5, this session is a review: run the skill `lol-review` and skip step 2 below.**

## 1. Read the thread

0. `docs/sessions/DECISIONS.md`: the owner's standing decisions. Never ask again what it answers. Then **copy into it
   every answer the owner gave in the chat since the last summary** (the last session asked its questions at the end of
   its final message; the conversation above holds the answers), dated, in the owner's words; for a question with no
   answer, write *default taken, <date>* and the default. Commit it before anything else.
1. `docs/sessions/FIELD_NOTES.md`: what happened when people used LlmOnLan. An open note (one with no `→` answer)
   outranks your own ideas; if one is urgent and approved work can answer it, it may become tonight's objective.
   Answer under a note you act on.
2. The five last dated files of `docs/sessions/`, newest first. A line starting with `> owner:` is an instruction: it outranks
   the summary's own "Next". An answer under "Questions for the owner" settles that question.
3. `docs/plans/README.md`: the next work, in order.
4. `git log --oneline` since the last summary's commit: what changed outside the sessions.
5. Only now, the context modules your work touches (the table in `CLAUDE.md`). Not the others.

**Your objective** is the last summary's *Next objective*, unless an owner's line says otherwise. Write in a few lines
how you will reach it and how you will know it is done (its *Done when*), and the one side task, if there is one.
**Consult the advisor before you lock it.** Build only what the owner approved: an item of `docs/plans/README.md`'s sections
*1. Now*, *2. Next* or *3. Later* (never *4. Waiting on the owner* or *5. Parked or dropped*), or a plan whose status
line reads `Status: approved by the owner, <date>`, or the work approved in advance (`CLAUDE.md` ▸ *Build only what the
owner approved*: reproduced bugs with their test, review findings, flakes, tests, docs to the code, the class
rehearsal). An idea of your own becomes a plan or a question.
If the objective is blocked, say why in the summary and take the next item of the queue.

## 2. Work

The objective is one of these kinds of work; stay on it until its *Done when* holds, then the side task:

- **Look:** read what changed since the last session; fact-check a doc against the code it describes.
- **Test:** the suites (`farm`: `node test/run.js`; `farm-app`: `npm test`; `shell`: `npm run test:chat`, and
  `node test/chat-harness/run.js` for the client driven for real). Run a farm and a client yourself with the skill
  `lol-scratch-farm`. Measure with `docs/spike/spike_bench.py`.
- **Research:** new models, engines and harnesses that matter here (the `docs` explorer reads the references). A
  finding is a dated file in `docs/research/` with its sources, and a line in the plans if it deserves work.
  **The tools we already pin** (owner, 2026-11-14): vLLM, llama.cpp (`farm/src/llamacpp.js` `PINNED_BUILD`), Ollama and
  python-build-standalone (`farm-app/src/main/runtimeManager.ts` `RUNTIME_PINS`), LiteLLM, Open WebUI's pin, Electron:
  their new releases, what changed for us, and whether a bump is worth a test. Read the release pages, never memory.
- **Plan:** a new feature gets a plan in `docs/plans/` before code. A plan that needs the owner's decision stops there.
- **Build:** a plan that is ready. Smallest change that works (the ponytail ladder in `CLAUDE.md`), with one runnable
  check for any logic that is not trivial.
- **Document:** the context module, the README, the in-app help and tutorial that the change touches, in the same commit.
- **Prepare a human test:** the owner's tests are the bottleneck. Write the test in `docs/HUMAN_TESTS.md` so it takes
  minutes: the exact steps, the files or builds it needs ready, the result expected.

How to work:
- Explore with the `search`, `grep` and `docs` subagents when a question needs many files; check what they return
  before you build on it.
- **Consult the advisor** when the same error shows up twice, and before you call a task done.
- After each tested step: a DEVLOG entry with the real time (`date`), a commit on `main`, and the backup
  `git push origin main:night`. Never another push, never a tag. The repo is public: no secret, nothing about a person.
- A failing test is a finding, not an obstacle: fix the cause, or record it. Never weaken a test to pass.

## 3. Hard limits

Everything under "What a session never does without the owner" in `CLAUDE.md`. In short: no push but the `night`
backup, no tag, no release; never touch the farm people use, the owner's client, its data, the Ollama app; nothing deleted outside your
scratch folder; nothing posted to another project; the prime directive and the privacy boundary are not yours to bend.
If the work needs one of these, stop that task and write the question in the summary.

**Use the whole time** (owner, 2026-11-18). The objective done: the side task, then the queue, then the work approved in
advance. End early only when everything left needs the owner, and list each of those items in the summary with what it
needs (a test, a decision, the farm at a quiet hour).

## 4. End

0. **The class rehearsal** (CLASS_REHEARSAL_PLAN step 4, about 5 minutes, no GPU): from `shell/`, after
   `npm run build`, with a scratch Ollama on 11500 (the skill `lol-scratch-farm`; the rehearsal starts one itself
   otherwise, with the `ollama` on PATH and a models folder of its own):
   `REH_SIDECAR=<the released Open WebUI sidecar> node test/rehearsal/run.js --clients 2 --minutes 3`.
   The sidecar is the latest client release's asset, unpacked once into the session's scratch folder
   (`gh release download <tag> -R b2renger/LlmOnLan -p owui-sidecar-win32-x64.tar.gz`, then `tar -xzf` it; the folder
   holds `launcher.py`). Put in the summary, per client: the farm moves, *keeps exiting* or not, ready and first-chat
   times, and `sealHeard`. Every farm move, a *keeps exiting*, or a `sealHeard` above 0 is a finding; so is a ready
   time much slower than the last summary's. Night n° 10's run (`docs/spike/results/rehearsal-2026-11-190347-2c.json`):
   4 minutes in all, 0 moves, no *keeps exiting*, ready at 22.8 and 39.4 s (that client started on no farm and moved
   to its farm once its first start had ended, by design), first chats at 25.7 and 29.7 s, `sealHeard` 0.
1. Stop every process you started (the scratch farm with `lol down` from its folder, a scratch Ollama, a test client)
   and check they are gone. Check the live farm still answers as it did at the start.
2. Write `docs/sessions/<date>-n<number>.md` from the template in `docs/sessions/README.md`: done with evidence, not done and
   why, found, next, questions for the owner. Short: the detail is in the DEVLOG.
3. **Is a release due?** If the unpushed commits (`git log origin/main..main`) hold something people should get (a fix
   they are hitting, a feature that is whole and tested), open the summary with `RELEASE READY`: what it brings, and
   which HUMAN_TESTS a person should run first. Raise it early, for small batches. Do not push `main` or tag until the
   owner says go.
4. Write the next session's **objective** with its *Done when*, at most one side task, and the queue after it.
5. Commit the summary, then `git push origin main:night`.
6. **The final message is how the owner hears from you.** It opens with `RELEASE READY` when there is one, then what was
   done in a few lines, then **the questions, at most five**: each one standing alone (the owner may read it days later),
   with the choice recommended and *Default if no answer: …*. Never a question `DECISIONS.md` answers. The owner
   answers in the chat; the next session copies the answers into `DECISIONS.md`. The last line of the final message is
   the path of the summary.
