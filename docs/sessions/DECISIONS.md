# The owner's standing decisions

Read first by every session ([CLAUDE.md](../../CLAUDE.md) ▸ *Sessions*). A decision here stands until the owner changes
it, and **a question it answers is never asked again**, in a summary, a plan or a test. Newest first. Each line: the
date, the decision in the owner's words where there are some, and where it was said.

**How this file grows:** the questions are asked in the chat at a session's end (at most five, each with the default the
next session takes without an answer). The owner answers in the chat. The next session copies each answer here, with
its date, before anything else, and commits it. An unanswered question's default is taken, and written here as
*default taken, <date>*, so the owner can overturn it.

## How the sessions work

- **2026-11-25, the chat (08:51).** "Do the commiting, pushing an cut a release for testing": the go for **Farm app
  farm-v0.0.55 and client v0.2.21**, both RELEASE READY in summary n° 16, tagged before the owner's tests of n° 16's
  builds; the owner tests on the released installers.
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

- **2026-11-27, the chat (16:04).** Day question 3 ("3 yes"): **"all that" is the three fixes**. The Computer's dots,
  Blender Lab's MCP and the panel's plugin download progress hold farm-v0.0.56 and client v0.2.22. LOL Vibe's
  annotate mode does not: it comes after the release (*LOL Vibe and the Computer*, below).
- **2026-11-27, the chat (14:23).** After the morning tests of the n18 builds, the day questions 1 and 2 (release
  farm-v0.0.56 and client v0.2.22): **"1, no, 2, no … We should do all that before releasing new farm and new
  client."** Nothing is released until these are built and tested:
  - the Computer's dots;
  - Blender Lab's MCP;
  - the panel's plugin download progress (the owner, 14:06: "we probably need some feedback about what is happening in
    the download and give the farm operator proper information (including the download progress)").

  The session read "all that" as these three findings of the tests, not LOL Vibe's annotate ideas (below); the
  owner confirmed it at 16:04 (above).
- **2026-11-27, the chat (09:20).** n° 18's questions 2 and 3 ("1 yes, 2 yes, 3 yes"; 1 is under *Open WebUI*):
  **yes**. llama.cpp goes to **b12774** (the official v1.1.0) instead of b12751, with the Spark's CI build; LiteLLM goes
  from 1.106.9 to **1.108.19** (the LTS line), `install.js` and the Farm app's `LITELLM_PIN` together. Both in the Farm
  app after farm-v0.0.56, in the same build (the recommendation).
- **2026-11-26, the chat (08:52).** n° 17's questions 1, 3, 4 and 5 ("1 yes, 2 yes, 3 yes, 4 yes, 5 yes"; 2 is
  under *Open WebUI*): **yes**.
  [WSL_PORTS_PLAN](../plans/WSL_PORTS_PLAN.md) is built (the farm holds its panel and beacon ports before any WSL call);
  [BONSAI_DEFAULT_PLAN](../plans/BONSAI_DEFAULT_PLAN.md) is built, the 4070 first (Ternary Bonsai 2.5 27B the llama.cpp
  engine's default for new farms); [CLASSIFY_VLLM_PLAN](../plans/CLASSIFY_VLLM_PLAN.md) is built (the Classify box
  answered by the farm's vLLM serving Qwen3.6 or Qwen3.8, Laya kept for Ollama and llama.cpp farms); llama.cpp moves
  from b12377 to b12751 with the Spark's CI build, in the Farm app after farm-v0.0.56 (the recommendation).
- **2026-11-25, the chat (19:05).** Measuring Classify on vLLM's decision endpoint against Laya: **"yes, after Bonsai in
  tonight's queue"** (plans ▸ Next 22). And: "You can start tonights session at midnight to give you more room to work
  with all the tests needed" (the night of 2026-11-25 → 26 runs 00:00 to 07:00).
- **2026-11-25, the chat (18:51).** Measuring Ternary Bonsai 2.5 27B against the llama.cpp default (`UD-IQ2_S`):
  **"yes after tonight objective"** (plans ▸ Next 21).
- **2026-11-25, the chat (08:51).** n° 16's question 1, Ripple-65B's files: **"yes"**. Deleted the same morning:
  `~/lol-vllm-034/hf/Ripple-65B-Preview-NVFP4` (54 GB) and `Ripple-65B-Preview-DFlash2` (7.6 GB); Gemma-4-26B-A4B-NVFP4
  stays.
- **2026-11-25, the chat (08:51).** n° 16's question 2, [RUNTIME_UPDATE_PLAN](../plans/RUNTIME_UPDATE_PLAN.md): **"yes"**,
  with the python-build-standalone bump to 20261124, built in the Farm app after farm-v0.0.55.
- **2026-11-25, the chat (08:51).** n° 16's question 3, Macs on macOS 12 Monterey: **"no Macs on Monterey"**. The client
  releases on Electron 45 (macOS 13 Ventura and later; Intel Macs already needed macOS 14).
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

- **2026-11-27, the chat (16:04).** Day question 4 ("4 yes"): **after the release**, LOL Vibe gets:
  - first, reference screenshots: [PICTURE_TO_PAGE_PLAN](../plans/PICTURE_TO_PAGE_PLAN.md) steps 2–4 (a picture dropped
    in a project chat is saved in the project and the coding agent reads it). This answers that plan's question 1;
  - then annotate mode on the project's Preview: [VIBE_ANNOTATE_PLAN](../plans/VIBE_ANNOTATE_PLAN.md) step 2 (marks and
    a comment, one screenshot saved in the project, the agent reads it).

  **With its privacy line:** a marked screenshot of the person's own project page goes to the farm's model with the
  request, and is kept only in the project folder. The plan's steps 3 (plain-chat pages) and 4 (DOM inspection, fonts,
  variations) were not asked; its question 3 stays open.
- **2026-11-27, the chat (14:22–14:23).** The Computer's dots (day question 3: **"yes"**): "the inputs should be in
  the same order of the fields in the box, we should have a clearer connection on how they relate. Maybe we should add
  tooltips when hovering the inputs / outputs." Before the next release.
- **2026-11-27, the chat (14:22).** LOL Vibe, ideas from Google AI Studio "we could consider": an annotate mode (draw
  rectangles, arrows, circles or freehand on the preview, add a short comment, send it; the annotated view goes to the
  model, which changes the code); an edit tool (retouch or replace images, try fonts live, HTML/CSS design variations);
  DOM inspection (spacing, margins, colours on an element); reference screenshots to guide styling. A plan to write,
  not approved yet.
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

- **2026-11-27, the chat (16:04).** [BLENDER_LAB_MCP_PLAN](../plans/BLENDER_LAB_MCP_PLAN.md)'s two questions
  ("1 wheel, 2 yes"):
  - **The install route: the wheel.** Lab's server reaches a laptop as a wheel built once from Lab's commit `dbbf836`,
    shipped inside the client with its GPL-3.0-or-later licence and a link to its source, and installed from that
    file. Nothing is downloaded from Lab's site at a person's install.
  - **Lab's screenshot tools: allowed**, with a privacy line: pixels of the person's own Blender window (or one of its
    areas) go to the farm's model with the request, and nothing is kept but the chat on the person's computer.
  - Not asked, so unchanged: the background-Blender `_for_cli` tools stay off (`BLENDER_PATH` unset).
- **2026-11-27, the chat (14:22–14:23).** Blender (day question 4: **"yes"**): "I think we should use the 'official'
  blender lab MCP rather than the community one." The client's Blender tools move from the community `blender-mcp` and
  its BlenderMCP add-on to Blender Lab's MCP server and its **MCP** extension (Blender 5.1+), before the next release.
- **2026-11-27, the chat (09:20).** n° 18's question 1: **"1 yes"**. Open WebUI 0.13.5 does not start on Windows, so
  the client stays on **0.13.3**; the approved bump goes to the first release that starts on Windows (each session
  reads a new release's `utils/machines/managed.py` first).
- **2026-11-26, the chat (08:52).** n° 17's question 2: **"2 yes"**.
  [BLENDER_TOOLS_ENV_PLAN](../plans/BLENDER_TOOLS_ENV_PLAN.md) is built, then Open WebUI moves from 0.13.3 to
  **0.13.5** with its smoke tests; this overturns the default taken 2026-11-22. The plan's own question 2 takes its
  recommendation: Open WebUI restarts when the Blender toggle changes.
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
