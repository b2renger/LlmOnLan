# The owner's standing decisions

Read first by every session ([CLAUDE.md](../../CLAUDE.md) ▸ *Sessions*). A decision here stands until the owner changes
it, and **a question it answers is never asked again**, in a summary, a plan or a test. Newest first. Each line: the
date, the decision in the owner's words where there are some, and where it was said.

**How this file grows:** the questions are asked in the chat at a session's end (at most five, each with the default the
next session takes without an answer). The owner answers in the chat. The next session copies each answer here, with
its date, before anything else, and commits it. An unanswered question's default is taken, and written here as
*default taken, <date>*, so the owner can overturn it.

## How the sessions work

- **2026-11-18, the chat.** Sessions are approved **in advance** for: fixing a bug a test or a run reproduces, review
  findings, test flakes, tests for existing behaviour, docs and help corrected to the code, the class rehearsal. They use
  their whole time and stop only when their time is up or everything left needs the owner, listing those items.
  "The thing is we need better communication."
- **2026-11-18, the chat.** Questions are asked **in the chat**, at most five a session; the owner answers there and asks
  for clarification there. Each question carries the default the next session takes.
- **2026-11-18, the chat.** Summaries are short and open with `RELEASE READY` when there is one.
- **2026-11-18, the chat.** A hook gives the real time; no time is ever guessed.
- **2026-11-18, the chat.** CLAUDE.md may be changed to carry these; changes to the process itself come as suggestions.
- **2026-11-12.** Sessions commit on `main` and back up with `git push origin main:night` only; a release (push of
  `main`, a tag) only after the owner tests and says go. One objective per session; every fifth is a review.

## The farms and the room

- **2026-11-18, the chat.** The Sparks stay live and without a password, classes included: "stop asking me that. There
  is a reason for the spark being live and having no password atm." Two farms in a room is the client's to handle.
- **2026-11-18, the chat.** The class Mac's 137 s first start: "explainable by the download time".
- **2026-11-14.** The development computer serves real users on weekdays; on Saturday and Sunday a session may start and
  stop any client or farm on it.
- **2026-11-12.** A session may load models on the GPU beside the live farm, with clients connected or not.
- **2026-11-05.** Clients run on people's own computers; farms on the owner's machines. No shared-computer case.
- **2026-10-07.** The operator does everything from the Farm app: no config file or script for an operator.
- **2026-10-04.** Scale up on big boxes with vLLM; the small GPUs are not farm capacity; no per-person identity.
- **2026-11-18, the chat (21:14).** "Qwen 3.8 is our best local model for the ratio size quality." The owner asked for an
  evaluation of HyperQwen (a faster vLLM for Qwen3.8) as a backend and of CodeAF as a harness for LOL Vibe and the
  Computer, to be tried soon if it is interesting (n° 9's summary ▸ Next).
- **2026-11-18, the chat (21:23).** "You can start now the evaluation, and if the the verdict is try, build it tonight.
  There is no users I closed tha apps and free the vram": an **extended night session** (n° 10) from 21:23 to 08:00 on 19
  November, to evaluate, plan, build and test, with the whole GPU. A *try* verdict counts as the owner's approval to build
  that piece tonight. The scheduled review moves to the next session.
- **2026-11-19, the chat (09:03).** HyperQwen's batch mode, the one built for many people, was the one to evaluate:
  "considering the context of Lol it is pretty obvious that we want the batch mode". A tool with modes is evaluated in
  its many-people mode first, and an evaluation says which modes it did not run.
- **2026-11-19, the chat (12:30).** "1- Yes": write the plan for Qwen3.8's recurrent state in fp16
  ([QWEN38_FP16_STATE_PLAN](../plans/QWEN38_FP16_STATE_PLAN.md)). That is a plan, not approval to build: its step 1 is
  a measurement, and steps 2–4 wait for the plan's approval. "2- Yes delete": HyperQwen's install `~/lol-hq` (37 GB),
  deleted the same day; `docs/spike/runs/hq_batch.sh` holds the recipe.
- **2026-11-19, the chat (18:15).** A longer context is wanted for **long chats and documents in Open WebUI**. **The
  farm's default context per person becomes 128k** ("default at 128k"): "Lets do the tests now and the implementation
  in tonight session", so it is approved to build in a night session, after the tests. QWEN38_FP16_STATE_PLAN's step 1
  runs at 32k **and 64k**. One long conversation without fewer seats (a longer maximum than the seats are counted at):
  no answer, so no plan. The owner quit the Farm app for the tests (the card free at 2026-11-20 08:42).
  Read with the same message: "the implementation" covers QWEN38_FP16_STATE_PLAN's steps 2–4 too, **if its step 1
  passes** (the session's reading, told to the owner on 2026-11-20 to correct).
- **2026-11-20, the chat (08:44).** The night sessions are expected every night: "since we didn't run last two session
  you will need to tell me why, and you'll need to work harder today". (n° 10's question 4 had *no cron* as its
  default; the cron was started again at 08:46, job `4ef5e27b`, 01:30 each night, expires 2026-11-27.) A question
  whose default stops the work is not a good default.
- **2026-11-20, the chat (08:44).** LOL Vibe builds from a picture: an interface's screenshot or a Figma design → a page
  in HTML, CSS and JS; a scene's picture → three.js (plans ▸ Next 18, a plan first).
- **2026-11-20, the chat (12:46).** n° 11's question 1, seats at 128k: "24, 128k can be the default". **128k is the
  farm's default context per person, and the Automatic seats follow the measured label** (24 people on the PRO 6000),
  not 30 set by hand.
- **2026-11-20, the chat (12:46).** n° 11's question 3: "yes", the night's build includes
  [QWEN38_FP16_STATE_PLAN](../plans/QWEN38_FP16_STATE_PLAN.md) steps 2–4 (step 1 passed at 32k).

## LOL Vibe and the Computer

- **2026-11-20, the chat (12:46).** [STUDENT_PLAN_MODE_PLAN](../plans/STUDENT_PLAN_MODE_PLAN.md): "yes, we can build",
  as written. Its two questions take their recommendations: a *Plan first* switch per thread, off by default (a
  teacher's default later, if classes ask); the Agent box left out.
- **2026-11-20, the chat (12:46).** On LOL Vibe from a picture: "You mentionned images, but not figma". Figma is a
  full part of the ask, not a footnote: the plan (plans ▸ Next 18) gives it its own options.

- **2026-11-18, the chat.** LOL Vibe's page preview: errors shown better, the result and the code side by side, the code
  edited with live reload, detachable ([VIBE_PAGE_PLAN](../plans/VIBE_PAGE_PLAN.md)). Detachable means **the side column
  and a pop-out window**; edits are **kept with the thread** (the answer itself unchanged); the editor is **the
  Computer's** (no new dependency, no syntax colours).

## Open WebUI, privacy, cloud

- **2026-11-20, the chat (12:46).** n° 11's question 2, `RAG_SYSTEM_CONTEXT=true`: "yes". An attached document goes
  into the system message and is read once per chat ([CONTEXT_128K_PLAN](../plans/CONTEXT_128K_PLAN.md) step 3).
- **2026-11-20, the chat (12:46).** n° 11's question 5, Open WebUI 0.13.4: "yes we can bump". The pin bump with its
  smoke tests, after the 128k build (invariant 5: a version bump, no LOL code change).
- **2026-11-18, the chat.** The repair button (OWUI_REPAIR_PLAN): yes. v0.2.19: go, after the repair button (released
  the same day).
- **2026-11-06.** Microsoft 365 waits for the school's and IT's go; no Google Workspace; the focus is consolidation,
  docs, better and faster models.
- **2026-11-05.** Open WebUI is not touched beyond what exists today, not even by a new REST call; what it does not do
  from its own buttons and env is built in our Electron app.
- **2026-11-05.** Inference, document reading, document search and speech never go to a cloud API.
