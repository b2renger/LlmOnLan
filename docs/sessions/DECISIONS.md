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

## LOL Vibe and the Computer

- **2026-11-18, the chat.** LOL Vibe's page preview: errors shown better, the result and the code side by side, the code
  edited with live reload, detachable ([VIBE_PAGE_PLAN](../plans/VIBE_PAGE_PLAN.md)). Detachable means **the side column
  and a pop-out window**; edits are **kept with the thread** (the answer itself unchanged); the editor is **the
  Computer's** (no new dependency, no syntax colours).

## Open WebUI, privacy, cloud

- **2026-11-18, the chat.** The repair button (OWUI_REPAIR_PLAN): yes. v0.2.19: go, after the repair button (released
  the same day).
- **2026-11-06.** Microsoft 365 waits for the school's and IT's go; no Google Workspace; the focus is consolidation,
  docs, better and faster models.
- **2026-11-05.** Open WebUI is not touched beyond what exists today, not even by a new REST call; what it does not do
  from its own buttons and env is built in our Electron app.
- **2026-11-05.** Inference, document reading, document search and speech never go to a cloud API.
