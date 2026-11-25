# The owner's standing decisions

Read first by every session ([CLAUDE.md](../../CLAUDE.md) ▸ *Sessions*). A decision here stands until the owner changes
it, and **a question it answers is never asked again**, in a summary, a plan or a test. Newest first. Each line: the
date, the decision in the owner's words where there are some, and where it was said.

**How this file grows:** the questions are asked in the chat at a session's end (at most five, each with the default the
next session takes without an answer). The owner answers in the chat. The next session copies each answer here, with
its date, before anything else, and commits it. An unanswered question's default is taken, and written here as
*default taken, <date>*, so the owner can overturn it.

## How the sessions work

- **Default taken, 2026-11-24** (n° 14's question 2, asked again by day 2026-11-23 18:21; no answer by 02:00): **no
  second nightly job** at 04:17 to wake a night that stopped; the memory and the summary guard it instead.
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

- **Default taken, 2026-11-25** (asked by day 2026-11-24 ~08:55, no answer by 02:00): **J16 steps 2–4 wait for the
  owner**; no session runs them on the Farm app itself.
- **Default taken, 2026-11-25** (asked by day 2026-11-24 ~08:55, no answer by 02:00): a vLLM **release candidate** does
  not count as the official support Inkling 2 waits for; plans ▸ Next 20 runs when **vLLM 0.34.1 is on PyPI**.
- **2026-11-24, the chat (08:45).** n° 15's question 1, Qwen3.6's recurrent state in 16 bits: **"no"**.
  [QWEN36_FP16_STATE_PLAN](../plans/QWEN36_FP16_STATE_PLAN.md) is not built; Qwen3.6 stays at 32 bits (48 people at 64k,
  24 at 128k).
- **2026-11-24, the chat (08:45).** n° 15's question 3, the leftovers: **"yes"**. A session deletes
  `~/lol-vllm-033/.cache/flashinfer.{j19,before,after-q36}-n15`, `~/lol-vllm-034/aside-n15/` and the four old client
  test builds in `shell\dist` (`0.2.19+n12`, `+n13`, `+n14`, `0.2.20-n12`); the FlashInfer wheels in 033 stay.
- **Default taken, 2026-11-24** (n° 14's question 1, no answer by 02:00): `~/lol-vllm-nightly` in WSL (23 GB, vLLM's
  nightly and part of Inkling 2 Mini) is **kept**.
- **Default taken, 2026-11-24** (n° 14's question 3, no answer by 02:00): **J16 waits for the next Farm app**; no
  session runs its steps 2 to 5 from a test farm.
- **Default taken, 2026-11-24** (n° 14's question 4, no answer by 02:00): Inkling 2 **Mini** (26.4B) is the one
  evaluated when a backend supports it (plans ▸ Next 20).
- **2026-11-23, the chat (12:11).** [FARM_START_PLAN](../plans/FARM_START_PLAN.md), its four steps (vLLM alongside the
  other services; the panel's elapsed time and the truth; precompiled kernels, measured first; a faster way to load the
  weights): "yes on all those". Step 3 is measured on a trial root, then installed if the numbers hold.
- **2026-11-23, the chat (12:11).** "May tonight's session quit the Farm app if it's running at 02:00, run J19, and
  restart the Farm app before 06:30?" → "Yes". A Farm app found off at 02:00 stays off.
- **2026-11-23, the chat (12:11).** "J15: on a test farm, or on the Farm app itself at night (Download, Use this, then
  back to Qwen3.6)?" → "after J19 yes": the default offered, **the test farm, after J19** (the Farm app itself only if
  the owner says so).
- **2026-11-23, the chat (11:25).** "it takes ages to start vllm and the farm basically. Can we do some improvements and
  optimisations in this matter ?" And on J19 and J15: "look like things you could do on your own, right ?"
- **2026-11-23, the chat (09:06).** Inkling 2: "No lets wait for official support in either of the backend we have.
  Put that into to the todo list (evaluate inkling 2 small for a replacement of qwen3.6 or qwen3.8)." No trial on a
  vLLM nightly; plans ▸ Next 20 waits for a release of vLLM, Ollama (on NVIDIA) or llama.cpp that supports it. (Small
  is 594B and fits no card here; Mini is the one in range: the plan says so.)
- **Default taken, 2026-11-23** (n° 13's question 4, no answer by 02:00): `~/lol-vllm-034` in WSL (27 GB, vLLM 0.34.0
  and Gemma 4 26B NVFP4) is **kept**.
- **Default taken, 2026-11-22** (n° 12's question 2, no answer by 02:00): the **Documents preset stays at 64k** with
  Qwen3.6 (at 128k its rule would pick Nemotron, which sees no pictures); Balanced is the 128k preset.
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

- **Default taken, 2026-11-24** (PLAN_FIRST_NEW_CHAT_PLAN's question, asked by day 2026-11-23 18:21; no answer by
  02:00): *Plan first* is **off by default** in a new chat, as decided 2026-11-20; (a) and (b) make it one press away.
- **2026-11-23, the chat (17:41).** "re-check passed on +n14, release v0.2.20": the go of 12:11 holds; v0.2.20 is
  tagged from a `main` whose `shell/` is `5cf6743`'s.
- **2026-11-23, the chat (12:11).** Client **v0.2.20 with the new plan buttons, after the owner's two-minute re-check on
  `0.2.19+n14`: "yes"**. The go holds once the owner reports that re-check passed; the release ships what was
  re-checked (`git diff 5cf6743 -- shell` empty at the tag), so no `shell/` change lands on `main` before it.
- **2026-11-23, the chat (12:11).** Plan first in a new chat: "(a) A new chat opened from a project's chat stays in that
  project, so Plan first is there before the first message. => yes"; "(b) Every new chat offers Plan first, and
  turning it on asks which project to use, or makes one. => yes it is good practice to elaborate a plan rather than
  start coding right away so yes it is an important to plan first when start a new chat, new project"
  ([PLAN_FIRST_NEW_CHAT_PLAN](../plans/PLAN_FIRST_NEW_CHAT_PLAN.md); after the v0.2.20 tag).
- **2026-11-23, the chat (11:25).** HUMAN_TESTS G14 (Plan first) and A29 (the page beside its code) on `0.2.19+n13`:
  A29 "we are good to go"; G14 "works as expected, but yes the buttons are very small and not really visible, in
  terms of UX they should be more visible and it should be more natural to go through this chain of thoughts using the
  buttons". And: "In a new chat it looks like we cannot start with a plan ... we should be able to start with a plan".
- **Default taken, 2026-11-23** (n° 13's question 1, no answer by 02:00): [AGENT_LOOP_PLAN](../plans/AGENT_LOOP_PLAN.md)
  **not built**; a coding-agent reply that goes round in circles is stopped by the student's Stop only.
- **Default taken, 2026-11-23** (n° 13's question 2, no answer by 02:00):
  [AGENT_FIRST_STEP_PLAN](../plans/AGENT_FIRST_STEP_PLAN.md) **not built**; a reply that only thought says nothing was
  done.
- **Default taken, 2026-11-23** (n° 13's question 3, no answer by 02:00): the Project panel's weak-model sentence
  (`project.modelWeak`, *qwen3.8 or nemotron*) is **unchanged**.
- **Default taken, 2026-11-22** (n° 12's question 3, no answer by 02:00): LOL Vibe from a picture,
  [PICTURE_TO_PAGE_PLAN](../plans/PICTURE_TO_PAGE_PLAN.md) steps 2–4 **not built**; Figma not measured (no frames).
- **Default taken, 2026-11-22** (n° 12's question 5, no answer by 02:00):
  [LOLVIBE_POC_PLAN](../plans/LOLVIBE_POC_PLAN.md) steps 2–4 **not built**.
- **Default taken, 2026-11-21** (n° 11's question 7, no answer by 02:00): *Plan first* moves **beside the message box,
  per thread**, as the approved plan says (it was built in the Project panel's bar, per project).
- **Default taken, 2026-11-21** (n° 11's question 6, no answer by 02:00): Figma through **the export path only** (a
  frame exported as SVG or PNG); no connection to Figma's desktop MCP server.
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

- **2026-11-24, the chat (08:45).** n° 15's question 2, the dev environment's Open WebUI (`sidecar/.venv`, 0.10.1,
  three versions behind the pin): **"yes"**. A session deletes the folder and makes it again at the pin
  (`sidecar/README.md` step 3).
- **Default taken, 2026-11-22** (n° 12's question 1, no answer by 02:00): Open WebUI **stays at 0.13.3**;
  [BLENDER_TOOLS_ENV_PLAN](../plans/BLENDER_TOOLS_ENV_PLAN.md) not built.
- **Default taken, 2026-11-22** (n° 12's question 4, no answer by 02:00): **nothing is released**; G14 and A29 wait on
  the local build `0.2.19+n12`, J16 on the next Farm app.
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
