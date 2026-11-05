# Human tests — the one list

Every check a **person** still has to do with LlmOnLan, gathered on 2026-10-09 from eleven older lists and the DEVLOG's
"not done, the owner's" lines, and set again on 2026-11-05 on the releases out then (client v0.2.15 with Open WebUI
0.11.4, Farm app farm-v0.0.51) and that day's review. Each test says what it proves, what it needs, the steps, and what
you should see. Tick the box when it holds; write what you saw on the *Found* line when it does not (or when the test
asks you to note a number). Where a test came from is on its *Was:* line, so an old reference can be followed here.

**What is already tested without you** (and so is not here): the unit tests, the chat harness on a mock farm, the
farm's vLLM lifecycle against a stand-in vLLM, and the agents' runs on a real farm recorded in
[DEVLOG.md](DEVLOG.md) and the night logs. What is left is what needs a person's hands, eyes, devices, a second
machine, an installer or a reboot.

**The parts.** Part 1 is the client (sessions A–I), Part 2 the farm (J–Q), grouped by setup so one sitting needs one
set of machines; inside a session the most valuable or riskiest test comes first. Part 3: measurements an agent can
run once the owner closes the farm. Part 4: what was done on a real machine, dated, with its evidence. Part 5: what was
dropped, and why.

## How to use it

- **★ = must pass before the next release is cut.** The ★ list below is **proposed (2026-11-05), to be agreed with the
  owner**, with the order to run it; the ★ in the test titles follow it. The ★ of 2026-10-09 were set for client
  v0.2.10 + Farm app farm-v0.0.44. That release and every one since, up to v0.2.15 and farm-v0.0.51, went out before
  them (the owner asked for a release to start the tests on, DEVLOG 2026-10-09 14:36), and none of them is ticked yet.
  So most ★ tests now check what people already run; the last group checks the fixes of 2026-11-05 on the build that
  brings them.
- **"The release under test"** in a Build line is the newest release (today client v0.2.15, Farm app farm-v0.0.51), or
  a candidate of the next one. Write its version on each test you tick. An update test needs the release before it
  installed first (today client v0.2.14, Farm app farm-v0.0.50).
- **A "Needs:" line names the oldest build a test needs** when the feature came after client v0.2.10 / farm-v0.0.44,
  the builds this list was gathered on. A test without one runs on any release since then.
- **A test that fails** goes in the [DEVLOG](DEVLOG.md), with its id.
- **Never run a dev build on a real profile:** [shell/test/chat/README.md](../shell/test/chat/README.md) §0 says why,
  and how to run one apart.

**Machines this list names.** The studio's RTX PRO 6000 box (production farm); a Windows test box with an RTX card
(not production), ideally also the RTX 4070 (12 GB) and 4080 (16 GB) boxes; a DGX Spark; one or two Windows
laptops (one fresh); an Apple Silicon Mac, an Intel Mac, a Linux x64 PC; the office's Home Assistant Green. Never run
a test that sets one seat, kills an engine or restarts the farm on production while people use it.

## The ★ list, in the order to run it (proposed 2026-11-05, to be agreed with the owner)

| # | Where | Tests | Time | Why ★ |
|---|---|---|---|---|
| 1 | The PRO 6000, at a quiet moment | install farm-v0.0.51 (J's Build line), **J14**, **P1**, **Q1**, **Q6** | about 2 h | its last recorded Farm app is farm-v0.0.48 with vLLM 0.30.0 (32 people at 64k every turn, against 48 on 0.33.0); the panel by engine (farm-v0.0.46), the presets and the kept plugin switches (farm-v0.0.50) shipped without a person's look |
| 2 | The K test box | **K1**, **K2** (farm-v0.0.50 → farm-v0.0.51), **K3**, **K4**, **K5** | about 3 h | every operator's update path, over a held file (`serve.sh` changed in farm-v0.0.51); llama.cpp b11836 and document search's first start were never run from an installed Farm app; small cards are told the truth |
| 3 | A laptop on client v0.2.15, and a fresh one | **A1**, **B1**, **C1** (from v0.2.14), **C2**, **G11**, **I1**–**I4** | about 5 h | day one and the update; G11: the coding agent's fence fails closed (security); I1–I4: the document privacy rule of 2026-10-08 on real laptops |
| 4 | The first build with the fixes of 2026-11-05 | **A21**, **C7**, **D16**, **G13** (client), **K11** (Farm app) | about 2 h, + 3 h of waiting for G13 | each checks one fix that build brings: Open WebUI's links and the microphone, a move into a folder that holds data, the password through a farm restart, a schedule above an hour, a first plugin install that froze the farm |

**Proposed off the ★:** I5 (the MiniLM path is the fallback of a folder that never met document search); J1 (vLLM has
been installed on the PRO 6000 since about 2026-10-12, how is not recorded: the owner's question 12); J2–J4
(production has served vLLM since then). K4 keeps its ★: nothing records document search's first start on a real box.

## Sessions at a glance

| Session | Setup | Tests | ★ | Time |
|---|---|---|---|---|
| A. One laptop + the PRO 6000, installed builds | 1 laptop, the production farm (A20: a ComfyQ box) | 21 | A1, A21 | A1 1 h; the rest 7–8 h in several sittings |
| B. A fresh laptop, first install, no internet | a laptop never used, a blocked network, a proxy network, a farm without document search | 6 | B1 | 2 h |
| C. Upgrades and the data folder | a laptop on the previous release, an old client (the owner's, or v0.1.45 on a spare profile), a spare profile, a USB stick | 7 | C1, C2, C7 | 2 h 45 |
| D. Two machines, two farms, other subnets | 2 laptops, a second farm, a guest Wi-Fi | 16 | D16 | 4 h 15 |
| E. Mac and Linux clients | Apple Silicon + Intel Mac, a Linux PC | 4 | — | 3 h |
| F. The Computer's devices | mic, webcam, speakers, a headset, OSC tool, Art-Net light, Arduino/ESP32; F11: 5–10 laptops | 11 | — | 6 h (+1 h F11) |
| G. LOL Vibe's IDE | 1 laptop, a password farm, a GitHub account, a second drive or USB stick (G11) | 13 | G11, G13 | 3 h (+3 h of waiting for G13) |
| H. Home Assistant on a real home | the office's Home Assistant Green | 4 | — | 2.5 h |
| I. Document search on the farm | the farm, 2 laptops (one with old documents) | 6 | I1–I4 | 2 h |
| J. The PRO 6000 (production, vLLM) | the PRO 6000 at a quiet moment, a client; J16: 10 laptops | 13 | J14 | about 8 h in several quiet moments (J16 2 h; +45 min if J1's install still runs here) |
| K. A Windows test box with an RTX card | a non-production RTX PC, the 4070/4080, a PC with no NVIDIA GPU | 11 | K1–K5, K11 | 5 h (+45 min K6) |
| L. The DGX Spark | a Spark with a screen; L4: a second disk | 4 | — | 4 h (+45 min) |
| M. Reboot tests | the PRO 6000, the Spark | 2 | — | 1 h each |
| N. The Farm app on a clean box | a PC with no Ollama or Python, a Mac | 5 | — | 2 h + downloads |
| O. Model storage on the PRO 6000 | the PRO 6000 at a quiet moment, a client | 3 | — | 1 h 15 |
| P. The panel's engine sections | any farm, the Farm app | 1 | P1 | 15 min |
| Q. Presets on the PRO 6000 | the PRO 6000 at a quiet moment, a laptop (client v0.2.14+ for Q5) | 6 | Q1, Q6 | 2 h 30 |
| **Total** | | **133** | **23** | about 60–66 h |

Part 3's measurements (Q4, Q5 step 3, J12–J13 on llama.cpp) are not in these counts: an agent runs them. J16 is
counted in J, though an agent can run its steps 1–4.

---

# Part 1 — the client

## A. One laptop and the PRO 6000 farm, installed builds

**Machine:** one Windows laptop with the installed client, on the office network; the PRO 6000 farm (Qwen3.6 on
vLLM); for A8 the farm's **Classify** plugin on (a switch is kept across a farm restart since farm-v0.0.50: turn it off
at the end). **Build:** the release under test (write the version on each test). Never use a dev run on the owner's
real profile ([shell/test/chat/README.md](../shell/test/chat/README.md) §0). These are quiet-farm checks: one person's
load.

**Part A-1: the release on one laptop**

### A1 ★ The release, end to end
*Proves:* the installed release under test does everything a person does on day one. *Was:* 1.4, 7.1, 7.2, 7d.11's
"everything still works" list, LOLCHAT_RIG §1 (C-21, the packaged build loads the modules).
1. Open Open WebUI: a chat (and its title appears), a PDF attached and asked about, the globe on for one question.
2. LOL Vibe: a chat; a long answer stopped with **Stop**.
3. The Computer: Text → Instruction, ▶.
4. Open WebUI ▸ a new chat ▸ Integrations ▸ Tools: **LlmOnLan Computer** on; *"On my Computer, create a graph called
   Test with a note that says hello, then run it."* Switch to the Computer.
5. Preferences ▸ About.

*Expect:* every step answers; LOL Vibe shows its UI (no *LOL Vibe failed to load* line, no *Part of LOL Vibe failed to
load* banner); Stop ends the reply at once; the graph *Test* is in the library with its note, and has run; About shows
the release's version and Open WebUI 0.11.4.
- [ ] Done · Found:

### A21 ★ Links in Open WebUI open in the system browser; a page opened that way gets no microphone
*Proves:* a link Open WebUI opens in a new window (a reply's link, a web search's source) goes to the system browser,
never to a window of the app, and a page from anywhere but Open WebUI's own address never gets the microphone, the
camera or the clipboard (before the fix of 2026-11-05 such a link opened a window of the app on Open WebUI's
partition, which granted those to any page). *Needs:* the first client release after v0.2.15 (or a candidate of it).
*Was:* new (review 2026-11-05).
1. In Open WebUI ask *"give me a link to https://docs.blender.org"* and click it.
2. Turn on web search (the globe), ask something current, open a source and click its address.
3. Ask for a link to an online microphone test page and click it; let that page ask for the microphone.
4. Open WebUI's own microphone button: say a sentence.

*Expect:* the system browser opens each time; no new LlmOnLan window appears. Step 3: the microphone question comes
from the browser, under its own name, never from LlmOnLan; Windows' Settings ▸ Privacy & security ▸ Microphone ▸
*Recent activity* names the browser at that time, not LlmOnLan. Step 4: Open WebUI still hears you (its own address
keeps the microphone). (Open WebUI's own pages, such as a file it shows, still open in a window of the app: the one
place they are signed in.)
- [ ] Done · Found:

**Part A-2: LOL Vibe in depth** (later; LOLCHAT_RIG_CHECKLIST's open items, with today's names)

### A2 A chat on the real farm
*Proves:* LOL Vibe's chat as people use it. *Was:* LOLCHAT_RIG §0 (switch mid-stream, relaunch), §2.1, §2.3, §10
(numbered steps, links, a stuck model).
- [ ] *"Write a markdown table of 5 Blender shortcuts, then a python snippet"*: streams smoothly; a real table; the code
  has Copy/Wrap; the stats line `N tok · X tok/s · first token Ys` near the farm's real speed; the strip shows the
  model, `vllm` (or `ollama`), `n/m seats` and GPU %, no dashes; the context meter uses the farm's context.
- [ ] Copy a code block into Notepad: exactly the code, no fence markers.
- [ ] *"draw a simple red circle as SVG"*: a Preview tab shows it; no script runs.
- [ ] *"list 300 numbered items"*, scroll up while it streams: the view stays put; **Jump to latest** appears and works.
- [ ] Switch to another thread while a reply streams and back: still growing, finishes with a stats line.
- [ ] New chat, change the model picker within a second, send (a farm with 2+ models): the choice sticks, the answer
  is stamped with it.
- [ ] *"three numbered install steps, each with a bash code block"*: every block at column 0; Copy copies exactly it.
- [ ] *"a link to http://<farm-ip>:41997/lol/admin and to https://docs.blender.org and an email as a mailto link"*:
  both http(s) links open in the system browser; the mailto is plain text.
- [ ] Quit with a conversation open, relaunch: that conversation is open again.
- [ ] Only if it happens: a model stuck repeating backticks/asterisks never freezes the window (capture the text).
- Found:

### A3 Big pastes, long threads, thinking
*Proves:* the context meter and edge cases of a thinking model. *Was:* LOLCHAT_RIG §4 (100k paste, too long, long
thread), §3 (think tags, a cut Thought), §2.1 (reasoning panel).
- [ ] Paste about 100k characters: the meter turns amber/red; Send reads *Send · ~N tokens · ~S s of shared GPU* and
  the first click only arms it; the second sends; the reply is about the paste.
- [ ] Paste more than the farm's context: *Too long for this farm*; the meter popover explains; nothing sent.
- [ ] A thread of 300+ messages with one 50k-character reply: opens in under 1 s; smooth scroll; no typing lag.
- [ ] *"show me an example of a `<think>` block, in a code fence"*: the tags are visible in the fence; nothing of the
  answer swallowed into the Thought block.
- [ ] Stop while the Thought block runs, before any answer: the thinking shows as the body, not an empty message.
- [ ] Open a reasoning panel, select text, wait 15 s: panel and selection stay.
- Found:

### A4 History tools
*Proves:* branches, search, export and import on a real profile. *Was:* LOLCHAT_RIG §8.
- [ ] Edit an old question: a new branch `◀ 2/2 ▶`, the old answer reachable.
- [ ] Regenerate, and *Regenerate with… More precise*: siblings; the switcher works after a restart.
- [ ] Fork from a middle message: a new thread *(fork)* with the path up to it.
- [ ] Search `elephant` finds `Éléphant`, with a snippet; clicking scrolls to it.
- [ ] Pin and rename: both survive a restart (and the next app update, C1).
- [ ] A long draft, switch threads, quit, reopen: the draft is back in that thread.
- [ ] Settings ▸ **Import chats…**: pick an export (a copy lands, new ids; twice = two copies); once press Cancel in
  the chooser: nothing changes, no stuck *Importing…*.
- [ ] Export as Markdown: readable in a text editor, fences intact. Export in the installed app: a save dialog or a
  file in Downloads (record which; if nothing, the clipboard is offered).
- [ ] With a temporary chat open, **Export all chats**: the toast says *… — 1 temporary chat left out*; nothing of it
  in the file; that chat's own … menu still exports it.
- [ ] Hand-edit an export (`"status": "waiting"` on one message, `"streaming"` on another), import: both come in as
  ordinary finished/interrupted messages.
- Found:

### A5 Quitting and failing on one laptop
*Proves:* nothing is lost to a quit, a kill or a closed network. *Was:* LOLCHAT_RIG §7; LOLCHAT_STUDIO_PLAN §5 S-R16,
S-R17.
- [ ] Quit mid-stream (X ▸ Quit), reopen: the partial reply is there, marked interrupted, with Continue.
- [ ] Kill LlmOnLan in Task Manager mid-stream: the same, at most ~1 s of text lost.
- [ ] A temporary chat: chat, quit, reopen: gone, never in search.
- [ ] No internet at all (WAN unplugged at the router, laptop restarted): Open WebUI, LOL Vibe, the Computer (a
  three.js sketch) and the coding agent work against the farm; Resource Monitor shows only farm addresses from the
  LlmOnLan renderer; no console error about a blocked fetch.
- [ ] A graph running, a sketch on **▶ Live** and a coding-agent reply streaming, then the window's X ▸ Quit:
  everything stops within a few seconds, no LlmOnLan, Python or Node process left (Task Manager), and the farm's
  panel frees the seat.
- Found:

### A6 Look, keys and access
*Proves:* LOL Vibe on a real screen. *Was:* LOLCHAT_RIG §10, §5 (drop outside the chat); LOLCHAT_STUDIO_PLAN §5 S-R18.
- [ ] Toggle the theme with LOL Vibe visible, on a thread with code, a table and a reasoning panel: every surface
  follows, no unreadable text, code keeps its header, the SVG fence shows its preview OR its code, scrollbars match.
- [ ] New chat and Send have the accent styling.
- [ ] Japanese IME: Enter confirms the conversion and does not send; French dead keys (`^` + `e`) work.
- [ ] Esc stops a reply; ↑ in an empty composer edits the last question; Alt+←/→ switches branches; Ctrl+Shift+O
  opens a new chat; none fire while Open WebUI is visible.
- [ ] A long reply, switch to another app: one Windows notification when it ends (installed build); record whether a
  click brings the window to the front (a flash of the taskbar is a known limit).
- [ ] Narrator announces *Reply finished* once; the buttons have names. Keyboard only, Narrator on, over LOL Vibe,
  the Project panel and the Computer: every control reachable and announced, Escape closes what it opened.
- [ ] 150 % scaling, window 1024×700: no horizontal page scroll; tables and code scroll in their boxes.
- [ ] Drop a file on the topbar or the sidebar: nothing happens, the app does not navigate away.
- Found:

### A7 The workbench (the Project panel) on a real screen
*Proves:* the side column the IDE uses. *Was:* LOLCHAT_RIG §12 (testable again since the Project panel, 2026-09-28),
§11 (nothing on the farm disk), §12 vision probe; LOLCHAT_STUDIO_PLAN §5 S-R4.
- [ ] With a chat open: **Ctrl+\\** cycles chat → split → work; **Ctrl+1** opens the panel; in split the composer is
  full width with the meter and Send under it.
- [ ] Drag the split with a mouse, relaunch: the same width. ← / → on the focused grip resize too.
- [ ] Narrower than 900 px: renders like Panel; wider again: the split returns; no horizontal scroll.
- [ ] Panel open in chat A, none in B: switching keeps each as it was.
- [ ] Panel open, switch to Open WebUI ~15 s, back: rebuilt and right; the Preview did not keep running.
- [ ] A data folder on OneDrive (or scanned by an antivirus): saving project files never says *locked*; **Show folder**
  opens Explorer there.
- [ ] On the farm box: no LOL Vibe thread titles in `lol.config.json`'s folder or its logs beyond LiteLLM's normal
  request lines.
- [ ] The Computer: an Image → Instruction on a model that sees: allowed; on a text-only llama.cpp model: refused
  before sending; the farm log shows one `/model_group/info` per client per farm, not one per ask.
- Found:

**Part A-3: the Computer in depth** (later)

### A8 The farm's optional plugins, from a client
*Proves:* Classify and its template on a real farm. *Was:* 2.1, 2.2, 3.2, 3.4 (Laya measured on a dev farm, 2026-09-27).
1. Farm panel ▸ Plugins: read the list. Enable **Classify** (the first time installs about 1 GB) while the laptop chats.
2. Text box with 5 headlines → **Classify**, options *hardware, science, politics, other*.
3. Learn ▸ Templates ▸ **Read the news** ▸ Run all, with Classify off, then on; change *Topics*, run again.

*Expect:* Classify, Speech to text and Message bus off (unless someone turned them on: a switch is kept); Document
search on (NVIDIA). The farm keeps answering during the install; Classify healthy once ready. Each headline gets a
label and a confidence; unsure ones under *check*. Read the news ends in a bar chart: off, the footer says *0 by Laya*;
on, most *by Laya*; no digit written by the model in the title/subtitle/insight (they show *…*).
- [ ] Done · Found:

### A9 Data from the web
*Proves:* Fetch, Open data, the Agent's hosts. *Was:* 3.3, 3.10, 3.11, 3.13 (c), 3.14 (all run once on real
data.gouv.fr by a dev client, 2026-09-27/28).
1. A Fetch box on a JSON API; then `http://localhost:…` and `http://<farm>:4000/…`; unplug the network, ▶.
2. ＋ Bring in ▸ **Open data**: a dataset link with a CSV; a file's "copy link"; a dataset with only PDFs; a link from
   another site.
3. Templates ▸ **Analyse a dataset**: Run all; compare the table and chart with the dataset's page on data.gouv.fr;
   another dataset and question; offline.
4. An Open data box on *Fréquentation des Musées de France* → an Agent with *Web hosts it may read* =
   `tabular-api.data.gouv.fr` and the 5-regions task (3.13's text); then empty the hosts field.
5. Templates ▸ **Ask a dataset**: your own question; another dataset.

*Expect:* 1: data; both local addresses refused with a sentence; offline: *Offline — kept the last copy: …*. 2: the
face *<title> · N rows · N columns · N read as a sample*; the file link works; the PDF-only one names its formats; the
foreign link refused in words. 3: numbers match data.gouv.fr; the model's text has no digits; the answer starts *In
the first 200 rows of …*; offline it runs from its copy and says *Offline*. 4: Île-de-France first in 3–4 steps
(the docs say ≈ 362.7 million: **unconfirmed anywhere, write down the number**); with no hosts, fetch is not offered
and the answer says it worked from the 200-row sample; the run bar says *1–6 generations*. 5: every step shown.
- [ ] Done · Found:

### A10 Code, pictures and files
*Proves:* the sandbox and the File box on a real disk. *Was:* 3.1, 3.5, 3.6, 3.9; LOLCHAT_RIG §15, §15b, §18 (a paused
sandbox); COMPUTER_STATUS "What only you can check" 3 and 8.
- [ ] Place Text, Code, Split, Send: each has a **?**; it opens *Example — <box>* with a yellow note; the same ? again
  opens the same graph, not a copy.
- [ ] ＋ Think ▸ *Write code* ("count the words of each line") wired into a Code box's **code** port: the model's
  program and its result; typing in the code says *Your code: …*; *Use the model's code* gives it back; *Hide the
  code* folds it behind *What it does*.
- [ ] *Write an SVG* → an SVG box, and *Write a p5.js sketch* → a p5.js box, on two models (the box's Model menu): the
  farm's default and gemma4:12b, or a second model on a farm whose default is gemma4:12b. Lands clean and draws. (Needs
  a farm serving two models. The PRO 6000's vLLM serves one, under one name: there, at a quiet moment, press the vLLM
  section's **Use this** on Gemma 4 12B between the two runs — about 2 min, and everyone connected gets it — then
  **Use this** on Qwen3.6 again.) An SVG box → *Describe a picture*: the model describes it.
- [ ] A Code box: `const x = d3.scaleLinear().domain([0,10]).range([0,100]); return x(5);` → 50.
- [ ] Code that throws on line 3: a sentence naming line 3, a *Go to line 3* chip, no file path in the message.
- [ ] `while (true) {}` ▶ three times in a minute: the window stays responsive; a toast says the sandbox is paused and
  names **Run all** and **▶**; fixed code runs again.
- [ ] Text (markdown) → Preview (*Markdown*), and an `<svg>` → Preview (*SVG*): in both themes; **Save as PNG** and
  **Save as SVG** write back the same source.
- [ ] Wi-Fi off: a p5 or three.js sketch still draws.
- [ ] Text → File `out/notes.md`, ▶, **Show folder**: the file in the graph's project folder under the data folder;
  run again overwrites (no `notes (1).md`); a path with `..` is refused in words. A `.md` and a `.png` open in
  ordinary tools.
- [ ] The model's SVG → Preview (*SVG*) → File `out/pic.svg`, opened in a browser: draws, the network tab stays
  empty; no `<script>`, `@import` or `http://` in it. A broken SVG (`<svg><rect`): a plain failure, no file written.
- [ ] A sketch running, switch to Open WebUI or minimise for a minute: no fan, no GPU load; back, ▶ works.
- [ ] A three.js/p5 sketch in a Preview: is the snapshot worth looking at at the box's size? Does an error name a
  line you can find?
- Found:

### A11 Runs, control flow and loops
*Proves:* a run does what it shows and costs what it says. *Was:* 3.15 (lesson 6), LOLCHAT_RIG §13, §16; COMPUTER_PLAN
§13 items 10–11, 14, 17–20, 22, 35, 36, 39; the resume banner (built 2026-09-28).
- [ ] Text → Instruction → Collect: Waiting → Running → Done with values; the cost line shows real tokens and seconds.
- [ ] Your own research graph: one topic Text, six labelled arrows, six research Instructions, one convergence
  Instruction naming them. Before running it, open **Sent**: every `##` heading is your spelling, in first-mention
  order, the instruction last; rename a wire: Sent changes live and the box goes stale. Run: the generations match
  the plan's preview; run again unchanged: mostly cached, near-free.
- [ ] Change the Text, Run all: only the dirty boxes re-run (the farm panel's request count); unchanged: nothing to do.
- [ ] Esc and Stop mid-generation: the box goes back to *Needs a re-run*, no red; finished boxes keep values; Run all
  picks up where it stopped. Stop halfway through a long Run all: the same, and any waiting question closes.
- [ ] Four boxes in a row: edit the third, ▶ on it: only the third and fourth run. Never run, ▶ on the last:
  everything it needs runs first.
- [ ] A Button between a cheap and an expensive box: the wave stops at it, the expensive box pale and hatched (not
  red); click its face: it runs.
- [ ] Two branches, a Dialog in one: the question sits in its box, the other branch finishes; the run bar says one
  question waits, **Show me** pans to it. A Confirm: *no* costs nothing; *yes* continues.
- [ ] Quit with a question open (or kill the app mid-run), reopen: the resume banner *N of M boxes finished. Resume ·
  Dismiss*; Resume re-runs only the unfinished boxes.
- [ ] Lesson **6 · a loop that stops** (no farm): close the ring, ▶ the Code box: counts to 8 and stops; Toggle off:
  one pass (9); each step ticks. A ring with no gate: refused as you draw it, with the sentence. A Toggle loop left
  on: stops at a named ceiling; its raise applies to that run only.
- [ ] One Instruction into three Conditions (yes/no/maybe): one branch stays bright, two arrows fade.
- [ ] Build a graph, quit, reopen: the same boxes, places, zoom and values; a box mid-run comes back *Needs a re-run*.
- [ ] Undo: delete, move, wire/unwire each undone step by step; a refused wire snaps back with its reason.
- [ ] Turn the farm off, launch, open a graph with an Instruction, turn the farm on: its Model menu fills by itself
  and keeps its choice.
- [ ] A thousand-word answer: the drawer opens instantly, shows it with line breaks, and says how much was left out.
- [ ] About 30 boxes: placing, dragging and running stay responsive; Run all answers at once; write down the time of
  a 30-box run on the real model.
- [ ] Import a hand-edited `.lolgraph.json` with `"lolgraph": 3`: refused with the *newer version* sentence. Import a
  non-JSON file and a JSON that is not a graph: two different sentences. A file padded past 8 MB: one refusal.
- [ ] ▶ on an Instruction in a freshly imported template: it pulls its own ancestors.
- [ ] Export with **Include results** unticked: no values, no Dialog answer, no farm address or password; ticked:
  values (and *demo answer* badges) travel, the file is bigger.
- [ ] Tidy a messy hand-made graph: left to right, nothing lost, one Undo puts it back; Tidy again: nothing to do.
- Found:

### A12 Fans and the Cap
*Proves:* dozens of generations stay polite and countable. *Was:* LOLCHAT_RIG §14 (the colleague item is D1).
- [ ] ~40 lines → Split (*by lines*) → Instruction → Collect: the badge counts up, the window stays responsive,
  Collect keeps the order; **write down the wall-clock time**.
- [ ] One bad item among forty (a 30,000-character line): 40/40, the failure listed by number in words; the others
  keep their answers. Switch graphs or relaunch: the failed-items list is still there.
- [ ] Cap 5, a fan of twenty: the run stops, the banner explains, **Raise the Cap for this run** finishes without
  re-asking; the field still says 5; set it back, relaunch: kept.
- [ ] Cap 50 and 200 items: nothing runs, the banner says how many; the farm saw nothing; one press finishes.
- [ ] Repeat of 4 → Instruction: four different answers, four generations. Two identical lines through Split: one
  generation.
- [ ] Twenty items through a Filter (model mode): one judgement each; a re-run does not re-judge; *contains /
  matches / length* cost nothing.
- [ ] A thousand lines → Split → Split (space), Cap above the count: the window stays usable and Stop stops.
- [ ] Open the Computer and type a Cap at once: your number stays and the next run honours it.
- Found:

### A13 Pictures, Live, and the look
*Proves:* what only eyes can judge. *Was:* COMPUTER_STATUS "What only you can check" 1, 6, 7, 9, 10, 11 and the Live
check; LOLCHAT_RIG §13 (canvas size, keyboard, trackpad), §18; COMPUTER_PLAN §13 items 1–4, 6, 23, 25, 26, 40
(24 is in A7).
- [ ] A PDF you know on the canvas → Instruction: the text matches; running again does not ask the farm twice.
- [ ] An Instruction's markdown report into a Text box: legible (headings, lists, a table); edit a line, re-run:
  kept when **locked**, replaced when not.
- [ ] A screenshot on the canvas, arrow labelled `screen`, *"list every affordance"*: the model reads it.
- [ ] Open **"Rig check — Qwen3.8 live prompts"** (or any three.js box): **▶ Live**, drag to orbit, scroll to zoom,
  right-drag: the scene moves, the canvas does not; drop a wire on the picture. A sketch that calls `fetch()`: it
  fails in the sandbox and says why.
- [ ] **Edit code** on a p5.js box, change a colour, Ctrl+Enter redraws, Esc: the drawer closes, focus back on the box.
- [ ] Click the run bar, press H then V; click the library sidebar, H, V, F: the tool switches and F fits; typed in
  the library search the letters stay text.
- [ ] Pan (space-drag, wheel), zoom (Ctrl+wheel), F to fit at a narrow window: smooth; every state reads as a word.
- [ ] Tab into the canvas: a visible focus ring; arrows, Delete, Ctrl+Z act on it.
- [ ] On a trackpad (and a touchscreen if there is one): two-finger pan, pinch, drag a box, draw a wire.
- [ ] Five kinds, five glyphs (`T ≡ {} ▣ ⎘`), both themes: you can tell them apart; the Sticky's title reads as a label.
- [ ] The topbar's three segments; click Computer while Open WebUI is still starting: the canvas is not covered, and
  the webview does not pop over it when ready; Open WebUI still logged in; relaunch comes back on Computer.
- [ ] Your oldest graphs (from the per-thread era, titled *From: <chat title>*) open intact.
- Found:

### A14 Learn: the Tour, lessons and templates
*Proves:* the shelf teaches on a real farm. *Was:* COMPUTER_STATUS 4 and 5; COMPUTER_PLAN §13 items 27–31.
- [ ] A fresh profile's first open of the Computer: the welcome panel, and the farm chip tells the truth.
- [ ] The Tour with the farm **off**: it completes. Lesson 1 and lesson 3 with it on: the rail ticks when you do each
  step; **Show me** points at something visible.
- [ ] A farm lesson while the farm is busy: the *demo answer — not generated* offer, the lesson goes on.
- [ ] Leave a lesson halfway, go to LOL Vibe, come back: the right step.
- [ ] **Research → problematic**: does its shape match the museum graph? Its eight generations in a time you accept?
- Found:

### A15 Think all, and which model
*Proves:* thinking where it pays, and which model to recommend. *Was:* 7d.6; 3.12 (rewritten: the farm serves Qwen3.6
now, nemotron is gone).
1. Toolbar: **Think all** beside Cap, unticked. A Text *"A train leaves at 9:40 and the trip takes 2 h 35 min. The
   meeting starts at 12:20."* → Condition, *Decide by: asking the model*, *"Does the train arrive before the meeting
   starts?"*, ▶. An Instruction, *Answer shape: List*, *"The prime numbers between 1 and 30"*, ▶. Tick Think all, ▶
   the list again. Untick, quit, reopen.
2. Run *Analyse a dataset* and *Read the news* with Qwen3.6, then gemma4:12b (each Instruction's model picker; needs a
   farm serving two models. The PRO 6000's vLLM serves one, under one name: there, at a quiet moment, press the vLLM
   section's **Use this** on Gemma 4 12B between the two runs — about 2 min, and everyone connected gets it — then
   **Use this** on Qwen3.6 again).

*Expect:* **yes** (12:15), several seconds and hundreds of tokens (a yes/no decision thinks either way); the list fast,
few tokens; with Think all several times the time, the same list; still unticked after reopening. Write down which
model writes a working program for Analyse a dataset's question.
- [ ] Done · Found:

### A16 The debug log
*Proves:* a bug report a person can send. *Was:* LOLCHAT_RIG §17 (the file itself was seen on the owner's client,
2026-09-25).
- [ ] **● Record log**: red, pulsing, counting, a toast names the file.
- [ ] **⚑ Mark bug**, a sentence, Save marker: a `…-mark-1.png` showing the canvas, not the question box.
- [ ] Stop; the folder icon: Explorer opens with the file selected.
- [ ] Record, close, reopen: red again, a new file starting `"why":"resume"`; off, relaunch: stays off.
- [ ] On a farm with a password: the password is not in the file; `apiKey` reads `[redacted]`.
- [ ] Record, type in LOL Vibe, come back, stop: no `ui.*` lines for what you typed.
- Found:

### A17 On the oldest office laptop
*Proves:* low-end hardware is fine. *Was:* LOLCHAT_RIG §4 (low-end laptop), §14 (a fan repainting), §15 (a laptop GPU).
- [ ] A 2,000-token reply in LOL Vibe: tok/s within ~10 % of the farm's; the fan does not spin from rendering alone.
- [ ] A twenty-item fan: no stutter as items land.
- [ ] A Preview with a sketch: it draws, the canvas pans smoothly with a few dozen boxes.
- Found:

### A18 Voice mode: a conversation out loud, with the laptop's own microphone
*Proves:* Open WebUI's Call mode on the farm's speech to text and Kokoro, phrase by phrase, with a real voice and a real
microphone (the agent's run used a recorded voice through a headless browser: DEVLOG 2026-10-09). *Needs:* client
v0.2.11+ and farm-v0.0.45+, the farm with **Speech to text** and **Voice (TTS)** (Kokoro) on (Plugins), a laptop's built-in mic
and speakers (then a headset). *Was:* new (owner, 2026-10-09).
1. Open WebUI ▸ the headphones button (*Call*) beside the message box. Allow the microphone.
2. In French, at a normal pace: *« Bonjour, peux-tu me donner trois idées de dessert faciles pour ce soir ? »* Stop
   talking and count the seconds until the first spoken word comes back.
3. While it answers, say nothing. Then ask a follow-up in English: *"And which one is the quickest?"*
4. Settings ▸ Interface ▸ **Allow voice interruption in call** on; ask a question and talk over the answer.
5. Farm panel: turn Speech to text off (the client's Open WebUI restarts once); a call again.

*Expect:* about 2 s of silence ends your phrase (Open WebUI's own rule); your words appear as your message, French
with its accents; the first words of the answer come back in about 3 s or less after you stop (write the number), then
the answer goes on sentence by sentence without long gaps. The follow-up is understood in English. With interruption
on, your voice stops the answer and starts a new turn; with it off (the default), the mic is deaf while it speaks.
With the farm's speech to text off, calls still work, transcribed on the laptop (slower, rougher French).
- [ ] Done · Found:

### A19 Voice mode in a noisy room, and with a weak voice
*Proves:* the end of a phrase is found where people really are. *Needs:* A18's setup, the studio at a busy moment (or
music at a talking level), a second person. *Was:* new.
1. A call with music or talk around you: ask two questions, then stay silent for 20 s.
2. A soft-spoken person, 1 m from the laptop; then with a headset.
3. Pause mid-sentence for about 1.5 s (*« Je voudrais… une recette de crêpes »*).

*Expect:* write down what happens. Known from Open WebUI's code: any sound above −55 dB counts as speech and the
phrase ends after 2 s without it, so steady noise can keep a phrase open (no answer until the noise stops) and a
pause near 2 s splits a sentence in two turns. Nothing here can be tuned without changing Open WebUI: if it fails
in the studio, say so (the owner then decides on a voice mode of LOL's own, DEVLOG 2026-10-09).
- [ ] Done · Found:

### A20 A prompt for ComfyQ, pasted into ComfyQ
*Proves:* a student gets a prompt for a ComfyQ workflow from Open WebUI and it works in ComfyQ's own form, with the farm's
real model and a real ComfyQ box (the agent's run used a scratch llama-server and no ComfyQ: DEVLOG 2026-11-02).
*Needs:* client v0.2.15+, the farm, a ComfyQ box serving FLUX.2 Klein text to image (and one serving LTX 2.5 image to
video), ComfyQ's discovery app on the laptop. *Was:* new (owner, 2026-11-02).
1. Open WebUI ▸ the tools menu ▸ turn on **LlmOnLan Computer** (its line says it writes prompts for ComfyQ).
2. Ask: *"Write me a prompt for FLUX.2 Klein: a lighthouse at night in a storm."* Then *"Which models does ComfyQ have?"*
3. Paste the prompt into ComfyQ's form for FLUX.2 Klein text to image, set the size it said, book, look at the picture.
4. Ask for an LTX 2.5 image-to-video prompt for a photo of yours, 5 seconds; paste it, upload the photo, book.
5. Ask for a model ComfyQ does not have (*"a prompt for Midjourney"*).

*Expect:* the model calls the tool (a fold *View Result from lol-computer_comfyq_prompt_guide* above its answer), says which ComfyQ
workflow it chose (for "FLUX.2 Klein" the text-to-image one, or it asks), and gives the text under the form's field
names; the FLUX prompt is full sentences, subject first, 30–80 words; the size it names is one the form accepts and the
video's duration is the one asked. ComfyQ takes both texts as they are. For Midjourney it says ComfyQ has no such
workflow instead of inventing one. Write down any workflow whose prompt came out wrong for its model.
- [ ] Done · Found:

## B. A fresh laptop: first install, first start, no internet

**Machine:** a Windows laptop that never had LlmOnLan (or a spare Windows user account: the profile must be empty),
on the office network; a way to block huggingface.co (a hosts-file line `0.0.0.0 huggingface.co`, or a network that
reaches the farm but not the internet); for B4, a network that reaches the internet only through a proxy set in the
system settings. **Build:** the installer of the release under test, from GitHub Releases. **Farm:** for B3–B5 one
**without** document search (a farm on a PC with no NVIDIA GPU, or Document search off in its Plugins card): with
document search, a fresh folder never loads the search model at all (I2). B1 on the office network meets the PRO 6000's
document search, and a data folder that met it never loads the search model again. So before B3–B5, click the card of
the farm without document search (that pins it), then Preferences ▸ Data location ▸ **Change folder…** (an empty
folder) ▸ **Start fresh**.

### B1 ★ Install and first start
*Proves:* "install one app → chatting in seconds" from a clean machine. *Was:* RIG_CHECKLIST "First-run downloads"
and the SmartScreen line; LOLCHAT_RIG §1 "Laptop B, fresh install", "(P0 store)" mode.
1. Download and run the installer. Note what Windows says (SmartScreen: *More info ▸ Run anyway*).
2. Open the app. Time the first start: the engine download (about 0.8 GB to `userData/sidecar`; 1.1–1.3 GB on Linux),
   then Open WebUI.
3. Chat in Open WebUI, then in LOL Vibe, then open the Computer.

*Expect:* no URL typed; the connection overlay shows the engine download with progress; the farm is found and a chat
answers; LOL Vibe shows its empty state with no error and a new chat works; its Settings ▸ Storage reads *Saved on
this computer* (a *History can't be saved on this machine…* banner is a bug: note the laptop and OS); the Computer
opens. Write down the total time and what the overlay said.
- [ ] Done · Found:

### B2 Reopen in about 12 s
*Proves:* Open WebUI starts once. *Was:* 7e.10 (fresh-laptop half; C2 does the updated half).
1. Quit (the X ▸ Quit) and reopen. Open `%APPDATA%\LlmOnLan\logs\boot.log`.

*Expect:* the chat opens in about 12 s (about 30 s the first time after the laptop restarts); boot.log ends with one
`starting` and one `ready` for that launch, each with the farm's address, and no `restarting`.
- [ ] Done · Found:

### B3 No huggingface.co at the first start
*Proves:* a closed network no longer holds the start for minutes. *Was:* 7e.11, RIG_CHECKLIST "A laptop that cannot
reach huggingface.co".
1. With no search model yet (on a used laptop: move `models--sentence-transformers--all-MiniLM-L6-v2` aside from
   `%USERPROFILE%\.cache\huggingface\hub`, and put it back afterwards), block huggingface.co and start.
2. Chat. 3. Unblock it, quit and reopen; attach a PDF in Open WebUI.

*Expect:* the chat opens in about 12 s with *Document uploads need one start with internet access…*; chat works; the
next start online has no message, takes longer once (about 92 MB) and the PDF is answered.
- [ ] Done · Found:

### B4 Behind a system proxy
*Proves:* the probe goes through the system proxy. *Was:* 7e.12.
1. The same fresh start on a network that reaches the internet only through a proxy set in Windows' settings (none
   in the environment).

*Expect:* no message; the search model downloads; uploads work.
- [ ] Done · Found:

### B5 A first download cut off
*Proves:* a half-downloaded search model is repaired. *Was:* 7e.13, RIG_CHECKLIST "A first download cut off".
1. With no search model, start on a network with internet access and pull the cable a few seconds into the start
   (write down what that start does).
2. Reconnect, quit and reopen; attach a PDF.
3. A next start with huggingface.co blocked.

*Expect:* step 2 opens the chat (a little longer: the model downloads again) and the PDF is answered; boot.log shows
one `starting` and one `ready`. Step 3: no message (the model is on disk now).
- [ ] Done · Found:

### B6 Offline after one microphone use
*Proves:* a laptop with both models cached starts with no hub wait. *Was:* RIG_CHECKLIST "Offline boot" (SA-2).
1. Use Open WebUI's microphone once (Whisper downloads to `DATA_DIR/cache/whisper/models`), on a farm without speech to
   text (with it, the microphone goes to the farm, Whisper never downloads and the start never goes offline).
2. Unplug the internet (keep the farm), relaunch.

*Expect:* the chat opens in about 12 s, no hub wait. (In a dev run the sidecar env shows `HF_HUB_OFFLINE=1`.)
- [ ] Done · Found:

## C. Upgrades from an older client, and the data folder

**Machines:** a Windows laptop on the previous release (today v0.2.14: the update C1 tests); an old client for C3: the
owner's, if Preferences ▸ About still says v0.2.7 and Open WebUI 0.10.2 (the app updates itself by default; the engine
only from About, DEVLOG 2026-10-07 18:18), else a spare Windows profile with v0.1.45, whose engine is Open WebUI 0.10.2
(C5's profile, before its update, will do) — not a fresh v0.2.7: its own engine is already 0.11.4, so C3's step 4
finds nothing; for C5 a spare Windows profile; for C6 a USB stick and a second drive. **Build:** the release under test
(an update test needs the real release feed).

### C1 ★ The auto-update to the release under test
*Proves:* installed clients reach the release by themselves. *Was:* 1.1, RIG_CHECKLIST "Auto-update cycle" (never
logged for v0.2.x), NIGHT_LOG 2026-09-28 "the auto-update … on each OS".
1. On the previous release (today v0.2.14): Preferences ▸ Startup & updates ▸ **Check for app updates** ▸ **Restart &
   install**.
2. Preferences ▸ About; open LOL Vibe, the Computer, Open WebUI.

*Expect:* silent, no administrator prompt; it restarts as the release under test (today v0.2.15); LOL Vibe's threads,
the Computer's graphs and Open WebUI's chats are all there; Data location says everything lives in that folder. Then
on a farm with document search, I1's message (once).
- [ ] Done · Found:

### C2 ★ Open WebUI starts once after the update
*Proves:* the farm context saved, one start, a page reloads when its farm comes back. *Was:* 7e.10.
1. On the updated laptop that found its farm before: quit and reopen; read `boot.log`.
2. Stop the farm (or unplug the laptop from it), reopen the client: Open WebUI lists no model. Bring the farm back.

*Expect:* the chat in about 12 s; boot.log ends with one `starting` and one `ready`, each with the farm's address, no
`restarting`. A few seconds after the pill turns green, Open WebUI reloads once by itself and lists the model.
- [ ] Done · Found:

### C3 An old client (v0.2.7 or older): web search, the date line, the engine update
*Proves:* the one-time changes of v0.2.8 on a real profile, and the engine update from About. *Was:* 1.6, 7d.1, 7d.2,
1.4, RIG_CHECKLIST "Chat-engine update on Windows" (SA-6).
1. Before updating, note Open WebUI's Settings ▸ General ▸ **System Prompt** (empty or yours) and whether new chats
   have the globe on. Update to the release under test and open it. (If the owner's app already updated itself but
   About still shows Open WebUI 0.10.2, run only steps 4–5 there.)
2. In Open WebUI: a new chat's globe; Settings ▸ Interface ▸ **Web Search in Chat**; set it to *Always*, quit, reopen.
3. The system prompt; a new chat with the globe off: *"What is today's date?"*. Empty the prompt, quit, reopen.
4. Preferences ▸ About ▸ **Check for chat-engine update** ▸ download ▸ **Restart to apply**.
5. A chat; a PDF attached in Open WebUI.

*Expect:* first launch: Open WebUI reloads once by itself; not on the next launch. Globe off, *Default*; *Always* stays
*Always*. An empty prompt now reads `Today is {{CURRENT_WEEKDAY}} {{CURRENT_DATE}}.` and the answer has today's weekday
and date; a prompt you wrote is unchanged; emptied, it stays empty. About shows Open WebUI **0.11.4** after the restart
(a failed swap keeps the old engine and retries next launch); the chat works and the PDF is read.
- [ ] Done · Found:

### C4 Web search reads the pages
*Proves:* web search v2 from the installed app (its page reader runs in a worker of the installed app). *Was:* 7d.3,
7d.4. **Also on a Mac or Linux client (E4).**
1. A farm with web search on. Open WebUI ▸ Admin Panel ▸ Settings ▸ **Web Search**: the engine.
2. Globe on; ask about something from this week (a match result, a release). Open the results under the answer.
3. Quit; `python -m http.server 41995 --bind 127.0.0.1`; open LlmOnLan; repeat 1–2; look at the tools menu. Stop the
   server, quit, reopen: 1 again.

*Expect:* *external* at `http://127.0.0.1:41995/web/search`; a right answer naming its sources; each result is several
paragraphs of its page, often with a *(published …)* line (one-liners on every result = the page reader failed: write
down the OS); the first word comes a few seconds later than with the globe off. Port taken: *searxng* and the farm's
address, an answer with shorter sources, no *LlmOnLan Computer* in the tools menu. After: *external* again.
- [ ] Done · Found:

### C5 From v0.1.45 (an old LOL Chat history)
*Proves:* the one-time import of an old history into the data folder, on a real profile. *Was:* 1.1, 1.2, 1.5,
RIG_CHECKLIST "The upgrade path, on a spare Windows profile"; LOLCHAT_RIG §0 (history, backup), §1 (upgrade, v1
threads, no duplicates, Storage, uninstall/reinstall, corrupt v1 key), §12.1 (the v1 → v2 database); LOLCHAT_STUDIO_PLAN S-R2. Later: only if
a v0.1.45 install is still out there.
1. On a spare Windows profile (never the dev box's real one): install v0.1.45, make at least five LOL Chat threads
   (one with a code block, one with reasoning, a branch) and one Computer graph with a picture and a PDF;
   screenshot the thread list; quit; copy `%APPDATA%\LlmOnLan\Local Storage` and `IndexedDB` aside.
2. Let it update to the release under test (or install over it) and open. Switch to LOL Vibe.
3. Relaunch. Settings (gear, bottom of LOL Vibe's sidebar) ▸ Storage. DevTools ▸ Application ▸ IndexedDB ▸ `lol-chat`.
4. Import an old `.lolchat.json` export. Uninstall and reinstall the release under test.
5. On another spare profile: set the `lol.chat.threads.v1` localStorage value to `{` (DevTools), open LOL Vibe;
   Settings ▸ Storage ▸ **Remove the old v1 copy**.

*Expect:* 2: the app opens on Open WebUI; the topbar reads Open WebUI / **LOL Vibe** / Computer; a toast says the
history now lives in the data folder; LOL Vibe is interactive within about a second with every thread in the same
order, titles and messages, code blocks with a header and Copy, reasoning collapsed; the graph keeps its picture and
PDF; `…\LlmOnLan\owui-data\lol-client\IndexedDB\file__0.indexeddb.leveldb` exists, `%APPDATA%\LlmOnLan\IndexedDB` is
untouched (the backup), `logs\client-data.log` records the import. 3: no toast, no duplicate threads, nothing copied
again; Storage reads *Saved on this computer* with a usage figure and **Remove the old v1 copy**; the database is
version 2 with stores `threads, messages, attachments, recipes, kv, graphs, projects`. 4: the export imports; the
history survives the reinstall. 5: an empty list, no crash, and Remove **refuses** (it never deletes what it could
not read).
- [ ] Done · Found:

### C6 Moving the data folder
*Proves:* Preferences ▸ Data location carries everything. *Was:* RIG_CHECKLIST "Then a Preferences move", "Move to an
unplugged drive", "Cross-volume move"; LOLCHAT_RIG §1/§11/§12 data-folder items; LOLCHAT_STUDIO_PLAN S-R3.
1. Preferences ▸ Data location ▸ **Change folder…** ▸ **Move my data** to D:\ (with a few hundred MB of history and a
   real knowledge base). Time it.
2. **Start fresh** to another folder; then back.
3. Move to a USB stick; quit; unplug it; launch; use LOL Vibe; plug it back; relaunch.

*Expect:* 1: the panel says the app restarts; no "Quit LlmOnLan?" prompt; a toast *Your data now lives in …*; LOL Vibe's
threads, the Computer's graphs (pictures, PDFs, sounds), `LOL Studio Projects`, `lol-embedding.json` and Open WebUI's
chats are in the new folder and the old one is gone (write down how long the window waited). 2: everything empty, the
old folder untouched. 3: a warning toast and a red line in Data location; LOL Vibe works (empty) from
`%APPDATA%\LlmOnLan\lol-client`; back: the stick's history returns, and that session's writes sit in
`lol-client.unmerged-*`, named in a toast (never merged, never deleted).
- [ ] Done · Found:

### C7 ★ Move my data into a folder that already holds data
*Proves:* a move never writes over another data folder (before the fix of 2026-11-05 it merged into it: that folder's
Open WebUI chats, uploads and vectors were overwritten, and two search models could end up in one folder). *Needs:* the
first client release after v0.2.15 (or a candidate of it). *Was:* new (review 2026-11-05; first written as a step 4 of
C6, kept apart for its build).
1. Preferences ▸ Data location ▸ **Change folder…** ▸ an empty folder ▸ **Start fresh**; send one chat in Open WebUI
   there.
2. Go back to your own folder (**Change folder…** ▸ it ▸ **Use this folder**).
3. **Change folder…** ▸ step 1's folder again; read the question.

*Expect:* step 3: Preferences says the folder is not empty and offers only to use it as it is (**Use this folder**; no
**Move my data**), and says your current data stays where it is. **Use this folder** opens it with its chat. Your own
folder is untouched: go back to it the same way, and everything is there.
- [ ] Done · Found:

## D. Two machines, two farms, another subnet, Wi-Fi

**Machines:** two client laptops (A and B), the production farm, a second farm (the 4070 box or the Spark), a
network with client isolation (a guest Wi-Fi), and a laptop on the other office subnet (10.10.16.x ↔ 10.10.17.x:
beacons do not cross it). **Build:** the release under test on both laptops and the second farm. Several tests set one
seat on a farm: do them on the second farm, never on production while people use it.

### D1 Two laptops on one farm with one seat
*Proves:* the seat gate is fair and honest between people. *Was:* RIG_CHECKLIST "Seat gate" (a 429 was seen with two
IPs on one box, 2026-09-04; the release after idle never), LOLCHAT_RIG §3 (the seat items), 7d.7, 7d.10, 7d.13.
**Setup:** the second farm, panel ▸ *People served at once* **1** ▸ Apply (on Ollama, then restart the farm), *Free an
idle seat after* **1 min**, and a farm password.
- [ ] A chats once in LOL Vibe (holds the seat); B sends: no `[error: HTTP 429]`; a *Waiting for a seat — 1/1 in use*
  note with the farm's own sentence, **Try now** and **Cancel** visible without hovering; Send reads *Waiting for a
  seat…*. Five minutes untouched: still one sentence, not one per farm update.
- [ ] A goes idle: within ~10 s of the seat freeing, B's message sends **by itself exactly once**.
- [ ] While B waits: switch B to Open WebUI (it does not grab the seat; resumes when shown); minimise it (no send
  until restored, then exactly once).
- [ ] While B waits: **New chat**: it stays empty, Send still refuses; back, the waiting row is there. Free the seat
  with the empty chat on screen: nothing paints in it; the answer is in the chat that asked.
- [ ] While B waits: Enter: the toast talks about waiting for a seat; **Regenerate** or **Edit** an older message:
  a toast, nothing else changes (the same while a reply really streams).
- [ ] B presses **Cancel**: the farm's sentence plus *Stopped waiting for a seat.*; nothing sent later.
- [ ] B deletes the waiting thread: Send comes back; nothing sent when the seat frees.
- [ ] B quits while waiting, reopens: an interrupted reply, no live Try now/Cancel, nothing sent by itself.
- [ ] A farm kept full 15 min (A chatting): B's note turns into *gave up waiting*; Send usable again.
- [ ] From B: `curl -i http://<farm>:4000/v1/chat/completions -H "content-type: application/json" -d '{"model":"assistant","messages":[{"role":"user","content":"hi"}]}'`
  → **401** *Wrong or missing farm password…*, no new seat on the panel; with `-H "Authorization: Bearer <password>"`
  while A holds the seat → **429** *All 1 seats on this server are in use…* and a `Retry-After`.
- [ ] B's agent page (G7) asks while A holds the seat: *The farm is full: a seat frees in about …; checking again in
  …*, then answers by itself about a minute after A's reply; Stop during a second wait ends it.
- [ ] On A: Open WebUI and LOL Vibe both chat within the same minute: both work (one IP, one seat); note any slowdown
  from Open WebUI's title.
- [ ] Panel ▸ *Free an idle seat after* **2 min** ▸ Apply: at once (no farm restart, no client reload); about 2 min
  after A's reply the panel drops the seat and B's pill shows one more free; after a farm restart still 2 min.
- Put everything back (15 min, the old people count). Found:

### D2 Stop, deletes, renames and switches, seen from the other laptop
*Proves:* the farm frees what a person drops, and a busy farm is told. *Was:* LOLCHAT_RIG §3 (Stop frees the engine:
the engines were measured stopping on 2026-10-05; delete mid-stream; busy farm; model renamed).
- [ ] A asks for a long answer and presses Stop after 3 s: the seat is free at once (panel), the partial reply kept,
  marked stopped; B is served right away.
- [ ] A deletes a chat while its reply streams: the composer goes back to Send; the seat is free within a second or two.
- [ ] Switch the farm's engine (or pull a model) from the panel while A has LOL Vibe open: the strip shows the busy
  label with a percentage; a send says the server is busy and sends nothing; afterwards the model list refreshes and
  chat works with no reload.
- [ ] Rename or remove the model a thread uses: the picker falls back to the farm default; old messages keep their
  stamp.
- Found:

### D3 Two farms on the LAN
*Proves:* the picker lists both and switching repoints Open WebUI. *Was:* RIG_CHECKLIST "Multiple farms".
1. Both farms shared. Open the pill's *Servers on your network*.
2. Click the second farm's card (it shows **pinned**). Chat in Open WebUI. Then **Automatic — least busy farm**.

*Expect:* both listed with live load; Open WebUI restarts on the second farm and chats there; Automatic removes the pin.
- [ ] Done · Found:

### D4 A pinned password farm survives a relaunch
*Proves:* SA-4/SA-5. *Was:* RIG_CHECKLIST "Pin a farm, relaunch".
1. Pin a password-protected farm (enter its password on the card). Quit, relaunch.

*Expect:* one Open WebUI start (boot.log: one `starting`, one `ready`), no restart, chats answer (no 401).
- [ ] Done · Found:

### D5 A farm added by hostname while its beacon arrives
*Proves:* SA-3: the pill stays on one address. *Was:* RIG_CHECKLIST "A farm added by hostname".
1. Pill ▸ Add by address: the farm's hostname. Wait 5 minutes.

*Expect:* one card; Open WebUI never shows "Reconnecting…" every few seconds.
- [ ] Done · Found:

### D6 Across the subnet, and on a network that blocks broadcasts
*Proves:* the unicast fallbacks find a farm the beacon cannot reach. *Was:* RIG_CHECKLIST "Two physical machines"
(beacons were found NOT to cross the subnets, 2026-09-02), "Broadcast-blocked Wi-Fi".
1. Laptop on the same subnet and access point as the farm: it finds it by itself.
2. Laptop on the other subnet: Preferences ▸ Connection ▸ **Search range** covering the farm's subnet ▸ Rescan; then
   instead remove it and **Add by address**.
3. On a guest Wi-Fi with client isolation (if it can reach the farm at all): the same.

*Expect:* 1 by beacon; 2 found by the sweep, and by address; 3 found by address, or write down what the network
blocks.
- [ ] Done · Found:

### D7 The farm changes address
*Proves:* de-dup by farm id; Open WebUI follows. *Was:* RIG_CHECKLIST "Farm IP changes", "ENABLE_PERSISTENT_CONFIG".
1. Give the second farm a new DHCP address (router) and restart it. Keep a client open.

*Expect:* one card, the new address; Open WebUI repoints and chats; no old URL wins after a client relaunch.
- [ ] Done · Found:

### D8 The farm disappears, the Wi-Fi roams
*Proves:* failures end cleanly. *Was:* LOLCHAT_RIG §7 "Farm disappears", "Wi-Fi roaming".
1. Power off (or stop) the second farm mid-reply. 2. Walk between access points during a reply.

*Expect:* the reply ends with a network note plus Continue; the strip says *farm silent* within ~15 s; the composer
does not freeze; clients move to the other farm. Roaming either completes or ends with a readable note plus Continue,
never a stuck spinner.
- [ ] Done · Found:

### D9 The admin panel from another machine
*Proves:* an operator can run the farm from a laptop. *Was:* RIG_CHECKLIST "Admin panel" (2026-07-04 verified start/
stop of a model; the panel changed since), "Plugins live-toggle", "Client presence", "Farm version on the wire".
1. On laptop A: `http://<box>:41997/lol/admin`, paste the token (a wrong one first).
2. Ollama: start a second model, **Make default**, stop it. Change the context window.
3. Plugins: turn web search off, then on.
4. Clients: both laptops listed with hostname, version and idle; quit B.
5. `lol fleet` (or `/lol/self` → `version`).

*Expect:* a wrong token is refused; the model appears in a client's picker about 5 s later and disappears after;
`lol status` stays healthy through the context change; web search leaves and comes back on clients (their Open WebUI
restarts once); B leaves the list within about 30 s; the farm card says *N of M seats free* (and *K connected* when that
differs); the version is the Farm app's (e.g. `farm v0.0.51`), not `0.1.0`.
- [ ] Done · Found:

### D10 Private by default
*Proves:* a fresh Farm app is reachable only from itself until shared. *Was:* RIG_CHECKLIST "Private by default",
"Private really means the plugins too" (FA-4).
1. A fresh Farm app install (session N1's box). From laptop A: `curl http://<box>:4000/v1/models`,
   `curl http://<box>:8888/healthz`, `curl http://<box>:8890/health`; the client's search.
2. On the farm box itself, a client uses web search and reads a PDF.
3. Settings ▸ **Share compute** on: repeat 1. Off again: repeat 1.

*Expect:* private: every curl refused, the client does not find it; on the box itself web search and PDFs work. Shared:
all answer on the LAN address and the client finds it. Off: refused again. The chrome shows 🔒 private vs the shared
endpoint.
- [ ] Done · Found:

### D11 The Blender recommendation
*Proves:* a farm's recommendation turns the tool on only for people who never chose. *Was:* RIG_CHECKLIST "Blender
recommendation" (pending since 2026-07-04).
1. Laptop A never touched Preferences ▸ Assistant tools; on B, turn it off explicitly. Panel ▸ Recommend.

*Expect:* A's Blender tool turns on; B's stays off.
- [ ] Done · Found:

### D12 Share a project, chats and a graph between machines
*Proves:* what only two machines show. *Was:* 7b.11, LOLCHAT_RIG §3 "Two laptops, same thread content", §8 "Export
all, then import on laptop B", §15 "Share a graph between two machines".
1. On A, a LOL Vibe project ▸ **Share on the LAN** (Windows may ask about the firewall: allow on private networks).
   Open the address from B (or a phone). **Stop sharing**. Quit and reopen A.
2. On A: Settings ▸ export all chats; a Computer graph ▸ Export (with and without results). On B: import both.

*Expect:* 1: B sees the page; after Stop the address stops answering; after a relaunch it is not shared. 2: all threads
present, identical content and branches, new ids (importing twice = two copies); the graph (dragged onto B's canvas)
asks before replacing a non-empty one, arrives with its wires and layout, one Undo removes it, and the file has no
farm address, password or chat text; with results ticked the values show without re-running.
- [ ] Done · Found:

### D13 A llama.cpp farm with a password and a small window
*Proves:* LOL Vibe and the panel on the farm shape most unlike the PRO 6000. *Was:* LOLCHAT_RIG §2.2, §3 (wrong
password), §4 (40+ turns on 16k, kill llama-server), 7d.12.
**Setup:** the second farm on llama.cpp, a password, context 16384 (panel).
- [ ] Panel: under *People served at once* and *Context window* a line says what each person gets and what Open WebUI
  does with it; change people without applying: *After Apply, each person gets…*; a number under 24k each: it says
  Open WebUI reads the 8 most relevant passages and that every connected Open WebUI restarts once; put it back.
- [ ] Laptop A selects the farm with no password stored: strip and composer say *Password needed — click the
  connection pill in the top bar and enter it on the farm's card.*; nothing sent.
- [ ] Enter it on the card: models load within 4 s, the alias preselected; a chat works; the strip shows llama.cpp.
- [ ] A wrong password: *The farm refused the password* plus where to fix it (LiteLLM's words only in brackets).
- [ ] Change the password on the panel with the client open: within ~60 s the picker says *password refused*; enter
  the new one on the card: models back in seconds, no reload.
- [ ] A long answer stopped mid-sentence, then **Continue**: it continues without restarting (note the kv
  `continueMode:<model>` value).
- [ ] A thread of 40+ turns: a divider *Not sent with the next message…* above the oldest kept turn; no
  ContextWindowExceeded; a message marked *Keep in context* stays in (the meter says *pinned*).
- [ ] Kill `llama-server` mid-reply (this spare farm only): the partial reply kept with a readable note and Continue.
- Found:

### D14 Plugin keys and the password
*Proves:* plugin keys stay across a restart and change with the password. *Was:* 7d.15, 2.3, 2.4 (rewritten
2026-10-08; since farm-v0.0.50 a panel plugin switch is kept across a restart); I6 (7f.6) merged in on 2026-11-05.
1. On a farm with no password, note `extract.key` in `http://<farm>:41997/lol/self`. Restart the farm (Stop, Start).
2. Set a password ▸ Apply changes, then Stop and Start the farm (the plugins take their new keys at a farm restart).
   Read `/lol/self`; give the laptop the password; attach a PDF. A second laptop without the password: its farm card.
3. `curl -i -X PUT http://<farm>:8890/process -H "Authorization: Bearer <old key>" --data-binary @notes.txt`.
4. Restart again; then change the password, and Stop and Start the farm.

*Expect:* 1: the same key, no client's Open WebUI restarts, and within ~30 s clients read PDFs again (OCR; a plugin
turned on in the panel, e.g. Classify, is still on after the restart). 2: `extract.key` is `null`, and `extract.keyId`
names the new key; the laptop asks for the password once, then OCR, document search, Classify and Listen work; the
second laptop's card asks for the password. 3: **401**. 4: the same `keyId`; after the password change and the
restart, a new one.
- [ ] Done · Found:

### D15 A colleague and the Computer
*Proves:* a running graph yields its seat to a person. *Was:* LOLCHAT_RIG §13 "The seat belongs to the human", §14
"A colleague keeps their chat fast", §12.1 "The background lane"; COMPUTER_PLAN §13 items 21, 38; COMPUTER_STATUS 12.
**Not on production in working hours.**
1. On A, a forty-item fan (A12) runs; B sends an ordinary chat.
2. On A, the fan runs; A itself sends in LOL Vibe.
3. On A, a graph waits on an unanswered Dialog; A switches to Open WebUI and chats.

*Expect:* B's answer starts promptly; A's run stops with *Paused: the farm was busy with someone else. Press Run all to
carry on.*; Run all picks up without re-paying the answered items. A's graph holds one seat, never two; A's own send
aborts the graph's call at once and starts the answer. A's chat is not refused and the parked graph holds no seat.
- [ ] Done · Found:

### D16 ★ The password survives the farm's restarts
*Proves:* a laptop keeps the farm password while the farm restarts LiteLLM for another setting (before the fix of
2026-11-05, a laptop whose once-a-minute check met such a restart took the farm's 502 for a wrong password: it forgot
the right one, restarted its Open WebUI and asked for it again). *Needs:* the first client release after v0.2.15 (or a
candidate of it) on both laptops; the second farm on Ollama with a password, never production. *Was:* new (review
2026-11-05).
1. Both laptops connected with the password; note the time.
2. Panel ▸ *People served at once* ▸ **Apply changes**, ten times, about 30 s apart (switch between 2 and 3). Each
   Apply restarts LiteLLM for a few seconds, and a laptop checks its password once a minute, so one Apply rarely
   meets a check.
3. Wait 2 minutes, then chat from both in Open WebUI and in LOL Vibe.

*Expect:* neither card asks for the password again; `boot.log` has no `restarting` line after the time noted; both
chats answer (no 401). A password typed on a farm card during one of those restarts reads *The farm is restarting: try
the password again in a few seconds.*, never *not accepted*. Put the people back as they were (on Ollama the count
applies after a farm restart).
- [ ] Done · Found:

## E. Mac and Linux clients

**Machines:** an Apple Silicon Mac, an Intel Mac on macOS 14 or later, a Linux x64 PC (and the Spark as a linux-arm64
client, if handy). **Build:** the installers of the release under test, and the release before it installed first for
the update.

### E1 macOS: install, first run, update
*Proves:* the ad-hoc signed app installs, runs and updates itself. *Was:* RIG_CHECKLIST "Auto-update cycle" (the mac
retest after the keep-warm fix was never logged, 2026-09-02), "Intel Mac", 1.1.
1. Install the previous release (today v0.2.14) from the dmg (right-click ▸ Open the first time). First run: the
   engine download, a chat.
2. Check for app updates ▸ Restart & install.
3. The same first run on the Intel Mac: attach a document in Open WebUI (on a farm without document search, the
   local search model runs here).

*Expect:* Gatekeeper's gentler prompt only; chat works; the update installs and restarts as the release under test.
Intel: the darwin-x64 engine downloads, local embeddings and a chat work (torch 2.2.2 there is the thing to watch).
- [ ] Done · Found:

### E2 macOS: microphone and camera
*Proves:* the ad-hoc build can use them (electron-builder #9529). *Was:* RIG_CHECKLIST "macOS ad-hoc build: OWUI voice
(mic) and camera".
1. Open WebUI's microphone button; a call with the camera. 2. The Computer: a Sound box ● Record; an Image box
   **Take a picture**.

*Expect:* macOS asks once for each; both work in Open WebUI and in the Computer.
- [ ] Done · Found:

### E3 Linux AppImage: install, run, update
*Proves:* the AppImage path. *Was:* RIG_CHECKLIST "Auto-update cycle" (Linux), LOLCHAT_RIG §10 "macOS arm64 + Intel,
Linux AppImage".
1. Run the x64 AppImage (on the release page it is `LlmOnLan-<version>-linux-x86_64.AppImage`) and the arm64 one on
   the Spark; write down the engine download the overlay shows (about 1.3 GB on x64, 1.15 GB on arm64). Chat in Open
   WebUI and LOL Vibe (A2's first check); ask LOL Vibe for a long answer and quit mid-stream (X ▸ Quit), reopen. Do
   the same LOL Vibe checks on both Macs (E1). A long reply while another app has focus: one notification
   (Notification Center / the Linux desktop's).
2. Update from the previous AppImage, launched as an AppImage.

*Expect:* both chat; the table, code and stats line render; the partial reply is kept after the quit, marked
interrupted, with Continue; the notification shows; the update replaces the AppImage.
- [ ] Done · Found:

### E4 The coding agent and web search on a Mac and Linux
*Proves:* the project fence and the page reader outside Windows. *Was:* IDE_PLAN ("Not yet run on macOS/Linux"), 7b.9,
7d.3 ("on Windows and on macOS or Linux").
1. LOL Vibe ▸ Project ▸ **Install the coding agent**; a project; *"Read /etc/hosts and tell me its first line."*
2. C4 steps 1–2.

*Expect:* the read is refused (*only files inside this project…*) and the answer says it could not; a project file
reads fine. Web search results are paragraphs, not one-liners. **If the read succeeds**, dsh's sandbox probably cannot
start there (no bubblewrap or Landlock on Linux, no usable sandbox-exec on macOS): dsh then runs no hook at all
(measured on Windows 2026-10-23, G11), and the client's check before a start covers Windows only. Write down the OS.
- [ ] Done · Found:

## F. The Computer's devices: microphone, camera, speakers, lights, boards, the message bus

**Machines:** one laptop with a microphone, a webcam and speakers; TouchDesigner or Max (or any OSC receiver on UDP
9000); an Art-Net node with one DMX light; an Arduino Uno/Nano or an ESP32 with a USB **data** cable, an LED and a
light sensor, the Arduino IDE; `mosquitto_sub` on a PC. **Farm:** the PRO 6000 with **Speech to text**, **Voice (TTS)**
(Kokoro) and **Message bus** turned on in its Plugins card (since farm-v0.0.50 they stay on across a restart: turn them off at
the end of the session). **Build:** the release under test. None of this ever ran on real devices: the sketches were
only compiled, and the harness used Chromium's fake microphone and camera (DEVLOG 2026-09-28).

### F1 Microphone and webcam (no farm)
*Proves:* the one capture door works with real devices and lets them go. *Was:* 3.7c.
1. A Sound box: **● Record**, speak, **■ Stop**, **▶ Play**.
2. An Image box: **Take a picture** ▸ **Capture**; again ▸ **Cancel**. 3. Unplug the camera; Take a picture.
4. Farm on: wire the Image into an Instruction *"What is in this picture?"*, ▶.

*Expect:* nothing asks the first time (the app grants its own page); the button counts seconds; the box holds
*recording <date>.webm* and plays it. The camera shows in the box with the light on; Capture keeps the picture and the
light goes off; Cancel keeps nothing and the light goes off. No camera: the box says so in words. The model describes
what the camera saw.
- [ ] Done · Found:

### F2 Listen, Speak, Ask out loud
*Proves:* the farm's speech to text and voice from the Computer. *Was:* 3.7, 3.7b, 3.8; COMPUTER_STATUS "What only you
can check" 2 (a real sound file).
1. Sound box with a recording, **Listen** on → an Instruction *"answer the question in the recording"*, ▶. Export the
   graph, import it: Listen's state.
2. Learn ▸ Templates ▸ **Ask out loud**: ● Record a question, ■ Stop, Listen on, Run all.
3. Text → **Speak** (*This computer*), then *Farm* voice; press Stop during speech.
4. Drag an .mp3 from Explorer onto the canvas, ▶ Play; then an .m4a and a .flac.

*Expect:* the words flow into the answer; after import Listen is **off**. The answer is shown and spoken. *This
computer* speaks and sends nothing; the farm's voice is Kokoro's; Stop stops. The three files decode and play.
- [ ] Done · Found:

### F3 Dry run, arming, OSC to TouchDesigner
*Proves:* nothing leaves until a person arms, and then exactly what was listed. *Was:* 4.1, 4.2, 4.3.
1. Text `0.75` → Send (OSC 127.0.0.1:9000 `/lol/level`). Run.
2. Run bar ▸ **Outputs: dry run**: read the question; Arm. Run.
3. Open another graph and come back; then Ctrl+R.

*Expect:* *Dry run — would send: OSC …*, TouchDesigner receives nothing. The question lists every target, one per line
(local ones say *this computer*); the button reads **Outputs: LIVE** (amber); TouchDesigner's OSC In gets **0.75 as a
number**. After the graph switch and after the reload: a dry run again.
- [ ] Done · Found:

### F4 A real light: Panic and the DMX cap
*Proves:* lights go dark on Panic and on quit, and DMX cannot flood. *Was:* 4.4, 4.5. Careful with real lights: keep
strobes off.
1. Text `[255, 128, 0]` → Send (DMX, universe 0). Arm, run: the light. **Panic**. Light it again; quit the app.
2. Two Send boxes to the same universe (the node's IP and the broadcast address), a fast graph.

*Expect:* Panic (shown whenever the graph has a Send box) stops the run and the light goes dark; quitting blacks it out
too. Never more than 3 frames a second to that universe in total; the box says *Held back: …*.
- [ ] Done · Found:

### F5 A board on the USB cable
*Proves:* Receive and Send over USB serial, both ways. *Was:* 5.1–5.4.
1. Upload `docs/examples/arduino/lol_serial/lol_serial.ino`. Serial Monitor at 115200: `{"light":…}` every half
   second; `led 1` lights the LED. **Close the Serial Monitor.**
2. ＋ Bring in ▸ **Receive** ▸ *Choose the board…*.
3. Learn ▸ Templates ▸ **Talk to a board**: choose the board on the three boxes, arm, Run all; cover the sensor, run
   again.
4. Open the Serial Monitor again and run.

*Expect:* the popover lists the board; *Last line: {"light":…}* updates live. The LED takes 0.75; covered: the Code box
says `led 1` and the LED switches on. With the Serial Monitor open: the box says the board is busy.
- [ ] Done · Found:

### F6 Boards on Wi-Fi: the farm's message bus
*Proves:* the bus, the Trigger and OSC into the farm. *Was:* 6.1–6.7.
1. Farm panel ▸ Plugins ▸ **Message bus** ▸ Enable.
2. Upload `docs/examples/arduino/lol_mqtt/lol_mqtt.ino` with the Wi-Fi, the farm's address and password. Serial
   Monitor; from a PC `mosquitto_sub -h <farm> -t 'lol/#' -v -u lol -P <password>`.
3. A Receive box, *From: the farm's message bus*, topic `lol/+/light`.
4. ＋ Control ▸ **Trigger** on `lol/+/light` → Code → Send (the farm's bus, `lol/<board>/led`). Disarmed, then armed.
   Switch to Open WebUI and back. Let the hourly cap hit.
5. TouchDesigner sends `/light 0.5` to `<farm>:9001`; a Receive box on `osc/light`. With a farm password: also
   `/lol/listen # 1234` with the password typed as a number.
6. Learn ▸ Templates ▸ **A board on Wi-Fi** (BOARD = board1), armed.

*Expect:* *Farm: connected*; mosquitto shows the readings; the Receive face shows them live. Disarmed: the Trigger
counts events, *0 runs*, *not armed*; armed: each reading starts a run (at most one every *N* s) and the LED follows
the Code box; hidden: runs stop, back: they resume; the cap stops runs and says so. The Receive gets 0.5; OSC writes
need no password but land only under `osc/…`, reading needs it; a numeric password works and does not become the reply
port. The page shows *board1 says …*, covering the sensor switches the LED on.
- [ ] Done · Found:

### F7 Lessons 7–10
*Proves:* the lessons that need a person's devices. *Was:* 3.16 (lessons 11–12 were walked on the real model,
2026-09-28).
1. *7 · listen and speak*: ● Record, ■ Stop, Listen, wire, ▶; then *This computer's voice*, ▶ Speak.
2. *8 · a picture to a model*: Take a picture ▸ Capture, wire, ▶; change the question, ▶.
3. *9 · act on the world* (no farm): wire, ▶ Send; Outputs ▸ Arm, Got it; level 0.2, ▶ the Text box; Panic, Got it.
4. *10 · hear the world* (no farm): wire; arm; gap 6; disarm.

*Expect:* each step ticks on the rail. 7: written down, answered, said out loud. 8: the answer describes the real
frame; the camera light goes off. 9: *Dry run — would send: OSC /lol/level 0.75*; the arming list shows
`127.0.0.1:9000 /lol/level (this computer)`; *Sent: …* reaches the UDP 9000 listener. 10: *not armed* first; armed,
every 3 s *Tick N, heard at …*; gap 6: the face's *skipped* count grows (the docs said *merged*); disarmed: no more runs.
- [ ] Done · Found:

### F8 Converse with a real microphone: a quiet room, a noisy room, a headset, loudspeakers
*Proves:* Converse's turn-taking where people really are (its unit tests used synthetic levels, its harness and end-to-end
runs a recorded voice through Chromium's fake microphone with no echo: DEVLOG 2026-10-12). *Needs:* client v0.2.12+; the
farm with **Speech to text** (on its GPU, ideally) and **Voice (TTS)** (Kokoro) on; the laptop's built-in microphone and
loudspeakers, then a headset. *Was:* new (COMPUTER_VOICE_PLAN §11, "Human").
1. ＋ Show ▸ **Voice face**, ▶ Live. ＋ Think ▸ **Converse**, a Text box wired into persona (*"You are a calm guide…"*).
   **● Start**, allow the microphone, ask a question in English; wait for the answer; ask a follow-up.
2. A quiet room, then the studio at a busy moment (or music at a talking level): two questions each, then 20 s of
   silence.
3. With the loudspeakers at a normal volume, ask a question and say nothing while it answers. Then talk over it.
4. The same with a headset. Then turn **You can talk over it** off, on the loudspeakers, and talk over it.
5. Turn **End of turn after** to 300, then 2000; **Sensitivity** to 0.2, then 0.9; **Added delay** to 3000. Start again
   each time.

*Expect:* the face breathes while it listens, grows with your voice, closes its eyes while it thinks and moves its mouth
with the voice. The box shows *heard in · first word · first sound* (write the first-sound numbers: about 1.3 s with
800 ms and a small model, measured end to end on the PRO 6000). The noisy room still ends your turns (the noise floor
follows the room) and 20 s of silence starts nothing. On loudspeakers the bot should not stop itself (its threshold is
raised while it speaks); if it does, write how often — the answer is a headset, a lower volume or turning off **You can
talk over it**. With a headset, talking over it stops it within about half a second. Off: talking over it changes
nothing. 300 ms: it cuts you off at a pause; 2000: it makes you wait. 0.9: a whisper starts a turn; 0.2: only clear
speech. The added delay shows in *first sound*.
- [ ] Done · Found:

### F9 French with ff_siwis: the Voice persona template
*Proves:* the template and a French conversation, with Kokoro's French voice. *Needs:* F8's setup. *Was:* new.
1. Learn ▸ Templates ▸ **Voice persona**. ▶ Live the face, **● Start** on Converse, talk with Margot in French for
   four or five turns, interrupt her once, then **■ End**.
2. Read the box's value (click it) and the Instruction's answer and the Markdown view after it.
3. Change Margot's rules in the Text box (*"Tu tutoies, tu fais des blagues"*) and talk again.

*Expect:* your French is written down with its accents; Margot answers in French in two short sentences and a question,
with the French voice; the interruption keeps what she had said. After ■ End the Instruction reads the conversation
(one generation) and names where she made you wait, cut you off or misunderstood; the value lists every turn with its
timings. The new rules change how she talks.
- [ ] Done · Found:

### F10 The microphone is a person's, and only while the Computer is shown
*Proves:* decision 7 of COMPUTER_VOICE_PLAN on a real window, with the operating system's own microphone light.
*Needs:* F8's setup; on Windows the microphone icon in the taskbar (macOS: the orange dot). *Was:* new.
1. With nothing pressed: **Run all**, the **▶** in Converse's title bar, a **Trigger** wired to it (armed), and Open
   WebUI asked *"run the graph from the Converse box"* (Use the Computer's tools on).
2. **● Start**, then each of: **■ End**; the run bar's **Stop**; switching to LOL Vibe; switching to Open WebUI;
   minimising the window; deleting the Converse box while it talks; closing the app. Start again before each.
3. The Record log on (● Record log) during one conversation; open the file.

*Expect:* step 1: no microphone light; the box (or Open WebUI) says *Press ● Start on the box: only a person opens the
microphone*. Step 2: the box shows **● Microphone on** in red while it listens, and every one of those ends the
conversation and turns the system's microphone light off within a second (leaving and coming back does not resume
it). Step 3: the file has `voice.*` lines (events and timings) and `http.*` lines for the speech to text with no sound
in them; no recording is anywhere in the data folder.
- [ ] Done · Found:

### F11 A class of several laptops on one farm
*Proves:* what a classroom does to the farm's one-at-a-time speech to text and to the seats (COMPUTER_VOICE_PLAN §12).
*Needs:* 5–10 laptops on client v0.2.12+ (D's setup, more of it), the PRO 6000 with Speech to text on its GPU and Kokoro
on; then, if possible, a farm whose speech to text runs on the CPU. *Was:* new.
1. Everyone opens **Voice persona**, ▶ Live, **● Start**, and talks at the same time for five minutes.
2. Write down, on three laptops, the *first sound* of each turn, and how often a box says *The farm is busy writing
   down someone else's words* or *no free seat*.
3. On the CPU farm: three laptops at once.

*Expect:* on the GPU farm most turns stay under about 2 s of first sound; a burst of several people finishing at the
same moment adds a fraction of a second each, and the 5th waiting gets a busy answer, retried once after 3 s. On the
CPU farm the waits grow by about 2 s a person: write the numbers — they decide whether a workshop needs the GPU.
- [ ] Done · Found:

## G. LOL Vibe's IDE — the coding agent

**Machine:** one laptop with the installed client, the PRO 6000 farm (Qwen3.6 on vLLM) or a farm serving qwen3.8; a
farm with a password for G7; a GitHub account for G9. **Build:** the release under test (G11 needs client v0.2.13+; G13
the first client release after v0.2.15). Already checked for real by the agents with qwen3.8 (DEVLOG
2026-09-28/29/30, NIGHT_LOG_2026-09-28): the install from the release, a project, a build and an edit, the fence on
Windows, History's Go back, graphify's graph.json, a Keep-going goal and a one-point-per-round loop, a schedule's runs,
Use the Computer's Room monitor, an agent page (dice coach). What is left is what only a person sees, and the
installed build. **Note:** the farm serves Qwen3.6, and its LOL Vibe preset calls Qwen3.6 and Flint proven with the
coding agent (11/15, 13/15); the model line rates neither good at edits: it reads *Nobody has tried Qwen3.6 … on code
edits yet* (write down how the agent does with it).

### G1 Install from the installed client, and keep it
*Proves:* the coding agent installs in a packaged client and stays installed. *Was:* 7b.1 (done from the release by
a dev client, 2026-09-29).
1. LOL Vibe ▸ a chat ▸ **Project** ▸ **Install the coding agent (about 120 MB)**. 2. Quit and reopen.

*Expect:* a progress line, then *installed*; after reopening nothing downloads again.
- [ ] Done · Found:

### G2 A project on today's model
*Proves:* the agent builds and edits with the model the studio serves. *Was:* 7b.2–7b.4 (done on qwen3.8).
1. **New project**. Ask: *"Make index.html: a three.js page with a slowly rotating cube, three 0.160.0 from
   cdn.jsdelivr.net."* 2. *"Add a speed slider in a corner; change nothing else."*

*Expect:* within about 30 s a reply, *N steps · s*, **Thought for…** with *→ write index.html ✓*, the file listed and
the cube in **Preview**; the **Changes** tab shows each edit, the Preview reloads with the slider.
- [ ] Done · Found:

### G3 You edit, and History records it
*Proves:* Save from the Code tab, and project names Windows dislikes. *Was:* 7b.5, 7b.10 (Save line);
LOLCHAT_STUDIO_PLAN §5 S-R5.
1. **Code** tab ▸ index.html ▸ change a colour ▸ **Save** (or Ctrl+S) ▸ **Preview**. 2. **History**. 3. **Open
   folder**; **Open in browser**. 4. New projects named `CON`, `aux.test`, `a.` and a 60-character name; ask the agent
   for a file at `lib/sub/deep/one/two/three/file.js`.

*Expect:* the Preview changed; History has a *You: index.html* line on top; the folder is in `<data folder>/LOL Studio
Projects/`; the page opens in the browser (only this computer reaches it). Each odd name is refused with a sentence
or made into a folder Explorer can open and delete; the deep file is written.
- [ ] Done · Found:

### G4 Stop, and the recap after it
*Proves:* Stop ends a reply at once and the agent still knows the thread. *Was:* 7b.6.
1. Ask for something long; press **Stop**. 2. Ask a follow-up that needs the earlier turns.

*Expect:* it stops at once and says so; the next answer knows the earlier turns.
- [ ] Done · Found:

### G5 Another model
*Proves:* the agent restarts on a new model. *Was:* 7b.7 (nemotron is no longer served).
1. Pick another model and ask for a small change: on an Ollama farm serving two, gemma4:12b; on the PRO 6000, at a
   quiet moment, vLLM ▸ **Use this** on Gemma 4 12B (the name in the menu stays the same), then **Use this** on Qwen3.6
   again after.

*Expect:* it works (the agent restarts on that model); gemma4:12b on Ollama: the model line warns it is weak at edits;
Gemma 4 12B on vLLM: it reads *Nobody has tried Gemma 4 12B · NVFP4 on code edits yet*.
- [ ] Done · Found:

### G6 Keep going, schedules: what a person stops
*Proves:* the loops end when a person says, and are forgotten at restart. *Was:* 7b.14, 7b.15 (the runs themselves were
checked on qwen3.8).
1. A new project ▸ **Keep going until done** (the note says *at most 10*); ask for the Snake game one point per round;
   press **Stop** mid-loop. Close and reopen LlmOnLan.
2. **Schedule…** ▸ every **5** minutes ▸ *"Add ONE line at the end of log.md: …"* ▸ **Start**; work in another chat for
   ~6 min; **Stop the schedule**. Set one again, close and reopen.

*Expect:* *◎ Round 1 of 10*, *◎ Round 2 of 10*… in one reply; Stop ends it at once; after reopening the switch is off.
Two ⏰ messages land in the project's chat (none in the one on screen); nothing after Stop; after reopening the
schedule is gone.
- [ ] Done · Found:

### G7 With a farm password
*Proves:* the agent and an agent page on a keyed farm. *Was:* 7b.8, 7b.17 (password), 7d.8.
1. On a farm with a password (entered on the farm card): ask the project's agent for a change; ask a normal chat (no
   project) something.
2. Ask: *"Make an agent page: a dice coach — I ask something about dice, it rolls and adds with tools and shows each
   step."* In its Preview: give a **wrong** password first, then the right one; *"roll 3 dice and tell me the total"*;
   ask again and press **Stop** mid-run.

*Expect:* the agent works; the normal chat is answered by the farm, not the agent. The page says the farm did not
accept the password and asks again (never *Failed to fetch*); then `roll_dice` then `sum` steps and a total equal to
the faces; Stop ends it.
- [ ] Done · Found:

### G8 Use the Computer: what stays a person's
*Proves:* the agent cannot act on devices. *Was:* 7b.16 (the graph build was checked on qwen3.8), 7.3.
1. **Use the Computer**: ask the agent to build the Room monitor and add a Send box (OSC to 127.0.0.1:9000), run it.
2. Arm the outputs yourself (the Computer's run bar); ask the agent for another run. 3. The same in an Open WebUI chat
   with **LlmOnLan Computer** on: *"run the graph Room monitor"*.

*Expect:* the run says it stayed a dry run; while armed the agent and Open WebUI's model are refused (only a person may
run it while the outputs are armed; reading stays open).
- [ ] Done · Found:

### G9 GitHub push and pull
*Proves:* publishing from the IDE with a real token. *Was:* 7b.12.
1. An empty repository and a fine-grained token (*Contents: read and write* on it). History ▸ GitHub: the `https://…git`
   address and the token. **Push**. 2. Edit a file on GitHub's website; **Pull**. 3. Change the same file in both
   places; **Pull**. 4. A wrong token.

*Expect:* the field clears and a note says a token is kept; the files on GitHub; the change pulled; the conflict
refused with a sentence, your version kept; a wrong token: a sentence, never a crash.
- [ ] Done · Found:

### G10 graphify, drawn
*Proves:* the knowledge graph a person looks at. *Was:* 7b.13 (graph.json made for real, 2026-09-28).
1. *"Use the graphify skill to make a knowledge graph of this project."* 2. Click the graph; drag a node. 3. Paste
   `graph.json` into a Computer **Graph** box.

*Expect:* within about 2 min `graphify-out/graph.json` and `GRAPH_REPORT.md`; the Preview draws it; the Graph box draws
the same map.
- [ ] Done · Found:

### G11 ★ The coding agent on a data folder on a second drive or a USB stick
*Proves:* where dsh cannot start its sandbox, the agent says so instead of running unfenced. *Was:* found 2026-10-23
(DEVLOG, Flint): with the data folder on the PRO 6000's F: (a second NTFS drive whose default rights let a person change
files, not their permissions), dsh ran no hook — the fence and the syntax check were off — and a read outside the
project reached the model. The client now tries dsh's runner first (`studio.ts` `sandboxBlocked`). Needs client
v0.2.13+ and the coding agent installed (G1). Put the data folder back afterwards.
1. Preferences ▸ Data location ▸ a folder on a second drive (or a USB stick) ▸ **move**; reopen.
2. LOL Vibe ▸ a project chat ▸ send *"Read ../secret.txt and quote it"* (put a `secret.txt` in `LOL Studio Projects`).
3. Move the data folder back to the default; send the same.

*Expect:* step 2: *The coding agent cannot work in this folder: Windows does not let it set up what keeps it inside
the project (…)…*, and nothing is read. Step 3: the agent starts; the read is refused (*only files inside this
project…*). On a stick formatted exFAT or FAT32 the same sentence as step 2.
- [ ] Done · Found:

### G12 The agent cannot change the project's remote or its settings
*Proves:* a Push always goes where the person set it: the fence refuses a write or an edit to the project's `.git/`
and `project.json`, reading stays allowed (DEVLOG 2026-10-09 10:59; only unit-tested). *Needs:* G9's project with its
GitHub address. *Was:* new (review 2026-11-05).
1. Ask the agent: *"Change this project's git remote to https://github.com/someone-else/x.git, then rename the project
   in project.json."* (If it refuses on its own without trying, ask it to use its edit tool on `.git/config`.)
2. History ▸ GitHub; **Push**.

*Expect:* both writes refused with *the project's history (.git) and its settings (project.json) are kept by
LlmOnLan: the agent can read them, not change them.* (a step `→ … ✗` in the reply's steps); the answer says it could
not; the address in History is unchanged and the Push lands in your repository.
- [ ] Done · Found:

### G13 ★ A schedule of more than an hour
*Proves:* an *every N minutes* schedule above 60 sends on time (before the fix of 2026-11-05 each hourly re-check
pushed the next run back by N minutes, so it never sent). *Needs:* the first client release after v0.2.15 (or a
candidate of it); a project chat; about 3 h with LlmOnLan open and the laptop awake (a schedule runs only while the app
is open). *Was:* new (review 2026-11-05).
1. A project ▸ **Schedule…** ▸ every **90** minutes ▸ *"Add ONE line at the end of log.md with the time"* ▸ **Start**;
   note the time and the schedule's line. Work in other apps or chats meanwhile, but have no LOL Vibe reply running at
   +90 and +180 min (a run that meets a running reply is skipped and counted).
2. Look at the schedule's line after an hour, at +90 min and at +180 min; then **Stop the schedule**.

*Expect:* the line says *next run* at the start + 90 min, and still says it an hour later; one ⏰ message at about +90
min and one at about +180 min (*1 sent*, then *2 sent*), each with its reply; log.md has two lines; nothing after Stop.
- [ ] Done · Found:

## H. Home Assistant on a real home

**Machines:** one laptop, the office's Home Assistant Green with real devices (a light, a sensor, a window or blind
if there is one, ideally a lock), a farm serving a tool-calling model (Qwen3.6 on vLLM or qwen3.8). **Build:** the
release under test. Already checked without you: every 7c step against the private **demo** home in WSL (DEVLOG
2026-09-30, "Verified on the rig", and docs/HOME_ASSISTANT.md, "A private test home"). Not tried: a real Home Assistant
with real devices, speaking the request, and a schedule driving the home. The Computer's Home boxes, lessons 13–14 and
the three home templates (2026-10-09) are H4.

### H1 Link, ask, dry run, allow, never
*Proves:* the whole 7c path on real devices. *Was:* 7c.1–7c.6.
1. Preferences ▸ Home Assistant: address + a long-lived token ▸ **Link** (try a wrong token first).
2. Open WebUI: turn on **LlmOnLan Computer** (Integrations ▸ Tools); *"Which lights are on?"*.
3. *"Turn off <a real light>."* without allowing commands.
4. **Allow commands…**; read the dialog; Allow. Ask again.
5. *"Unlock the front door"* (or open a garage/valve, if the home has one). *"Where is <a person>?"*.
6. Click **Home commands on** in the top bar. Ask for a command. Quit and reopen.

*Expect:* 1: `Linked: <home> · Home Assistant <version> · N entities, M devices`, the token field empties; a wrong
token is refused and nothing kept. 2: the answer matches Home Assistant. 3: nothing switched, and the answer says where
to allow commands. 4: LlmOnLan's own dialog lists the devices by kind, Cancel the default; the top bar shows **Home
commands on · N**; the light changes. 5: refused even while allowed; presence (home/away), never coordinates. 6: the
badge goes, a command is a dry run again; after reopening still linked, commands not allowed. Preferences says to leave
web search off in a chat that uses the home.
- [ ] Done · Found:

### H2 An agent acts, and on a schedule
*Proves:* "watch and act" with a project's agent. *Was:* 7c.7; HOME_ASSISTANT.md "Not tried yet: … a schedule driving
the home".
1. A LOL Vibe project, **Use the Computer** on, commands allowed: *"Read <a real sensor>; if it is above/below <x>,
   turn <a device> on, then write home-report.md."*
2. **Schedule…** every 5 min with the same request; watch two runs; **Stop the schedule**.

*Expect:* the device and the report match the sensor; two ⏰ runs act the same way; nothing after Stop.
- [ ] Done · Found:

### H3 Ask out loud
*Proves:* a spoken request is the same chat. *Was:* HOME_ASSISTANT.md "Not tried yet: speaking the request".
1. Open WebUI's microphone: say *"Which lights are on?"*.

*Expect:* the words appear (on client v0.2.11 or later, written down by the farm's speech to text when the farm offers
it, else on this laptop), then the same answer as H1 step 2.
- [ ] Done · Found:

### H4 The Computer's Home boxes on the Green
*Proves:* a graph reads the room and switches a device only after the two clicks (armed outputs + allowed commands),
on real devices. *Was:* HOME_ASSISTANT.md "Rig checks on the real Green" (2026-10-09). Use the office Green, linked
by its owner (never a shared token). Each line is what to do, then what must happen.

1. **Link it.** Preferences ▸ Home Assistant: the Green's address (`http://homeassistant.local:8123` or its IP) and a
   long-lived token → **Link**. The line reads `Linked: <home> · Home Assistant <version> · N entities, M devices`.
2. **Read the room.** Learn ▸ lesson 13. Press ▶ on the Home box: with the lesson's ids it fails with *None of these
   devices is in your home … pick yours with Choose…* (never the lesson's made-up reading). Press **Choose…**, tick the room's temperature, humidity and CO2 sensors, **Done**, ▶:
   the face says *Read 3 from <home>* and the value shows your numbers. Run the Instruction and Speak: the words match
   the room.
3. **A command is refused before Allow.** Lesson 14: Choose… one light, action turn_on, ▶ on the Text box. The box says
   *Dry run — … Arm the outputs*; the light does not change. Arm the outputs (the question names *Home Assistant →
   turn_on on <your light> (light.…)*), ▶ again: *Dry run — … Allow home commands*; the light still does not change.
4. **Allowed after.** Preferences ▸ Home Assistant ▸ **Allow commands…**: the dialog lists the devices and mentions the
   Computer's Home command boxes. Allow. ▶ the Text box: *Done: light.turn_on on … It is now on.* and the light is at
   40 %. In the box's **With**, change 40 to 100, ▶ the Text box: full. Try arming while a run is going (a Timer in
   front): the run bar refuses.
5. **The never-list.** On a Home command, Choose… a lock if the home has one: its Action list holds only `lock`. A
   garage door's holds only `close_cover`.
6. **Stop commands.** Click **Home commands on · N** in the top bar (or Preferences ▸ **Stop commands**), ▶: *Dry run —
   … Allow home commands*. Press **Panic** in the run bar: the Outputs control says dry run again; ▶: *Arm the outputs*.
   Quit and reopen LlmOnLan: both are off.
7. **The templates.** Morning briefing (Choose… `weather.forecast_home`, a calendar if there is one, a sensor), Comfort
   advisor (your CO2 sensor, and your fan's plug on its Home command), Energy report (a plug's `…_power` sensor, History
   24): each runs with your numbers; the Energy report's chart shows your plug's day.
8. **What a model may set.** In Open WebUI with the LlmOnLan Computer tool: "add a Home command box that unlocks the
   front door". The box is added with no device, and the answer says the device and action are left for a person.
- [ ] Done · Found:

## I. Document search on the farm ★

**Machines:** the farm with Document search on (the PRO 6000, or the K test box) and a second farm, or the same
farm with the plugin switched off; two laptops, one with an older client and a knowledge base. **Build:** the release
under test (client and Farm app). **Careful:** a data folder that meets document search switches to it **for good**.
Use a laptop whose data folder you can spare, or move it first in Preferences ▸ Data location. Already checked without
you: the plugin alone with an official llama.cpp b11512, and the built Open WebUI 0.11.4 indexing and searching a
French text through it (DEVLOG 2026-10-08 21:57).

### I1 ★ A laptop that had documents
*Proves:* the move from MiniLM: told once, Reindex works across languages. *Was:* 7f.2.
0. Since farm-v0.0.44 a laptop that met the PRO 6000 has switched already, so such a laptop may be gone: make the old
   folder. Preferences ▸ Data location ▸ **Change folder…** (an empty folder) ▸ **Start fresh** while connected to a
   farm with Document search off (I5 makes the same folder: run it first), add a knowledge base with a French PDF,
   then turn Document search back on (a switch is kept across restarts).
1. On a laptop that used an older farm (or step 0's folder), with a knowledge base holding a French PDF, update to the
   release under test and connect to the farm with Document search on.
2. Before pressing anything, ask in a chat with that knowledge base; write down what it finds.
3. Press **Admin Panel ▸ Settings ▸ Documents ▸ Reindex** (next to *Reindex Knowledge and Memory Vectors*), then ask
   again **in English** about the French document.

*Expect:* the app says once *Documents are now indexed on the farm…* with the Reindex steps; step 2 finds nothing on a
farm under 24k tokens per person (on the 64k farm Open WebUI may read the file whole anyway); after Reindex the
English question finds the French passage; `DATA_DIR\lol-embedding.json` exists. Reopen: the message does not come
back.
- [ ] Done · Found:

### I2 ★ A new laptop
*Proves:* a fresh client never fetches MiniLM on a farm with document search. *Was:* 7f.3.
1. A fresh client (session B's laptop will do) connects to the farm. Attach a 50-page PDF in Open WebUI and ask
   about it.

*Expect:* `%USERPROFILE%\.cache\huggingface\hub` has no MiniLM; no Reindex message; the PDF is answered. Write down the
upload time.
- [ ] Done · Found:

### I3 ★ Nothing stays on the farm
*Proves:* the new privacy rule: text goes to the farm to become vectors, nothing is kept or logged. *Was:* 7f.4.
1. Put a made-up word (*Quorvellisande*) in a document, upload it, ask about it.
2. On the farm: `findstr /s /m Quorvellisande *` in `%APPDATA%\LlmOnLan Farm` (and farm.log).

*Expect:* nothing on the farm; on the laptop the word is in the data folder.
- [ ] Done · Found:

### I4 ★ A farm without it
*Proves:* a folder that adopted the farm's model never falls back to MiniLM. *Was:* 7f.5.
1. Turn **Document search** off in the panel (or connect the laptop of I2 to a farm without it).
2. Upload a document in Open WebUI; chat. 3. Turn it back on; upload again.

*Expect:* the app says *This farm does not index documents the way your documents are indexed…*; the upload fails in
Open WebUI; chat works; nothing new in `%USERPROFILE%\.cache\huggingface\hub`. Back on: within seconds uploads work
(Open WebUI restarts once).
- [ ] Done · Found:

### I5 A laptop that never met document search still uses MiniLM
*Proves:* the client (since v0.2.10) keeps the old path for folders that have not switched (B3–B5 now only apply to
them). *Was:* new (the MiniLM path changed with document search, DEVLOG 2026-10-08 21:57 "MiniLM").
1. A fresh data folder (Preferences ▸ Data location ▸ Start fresh) on a farm with Document search **off** (a farm
   without an NVIDIA GPU, or the switch off). Attach a PDF.

*Expect:* MiniLM downloads (about 92 MB) at the start, the PDF is answered, and no `lol-embedding.json` is written.
Then connect that folder to a farm with document search: it switches (I1's message only if it had documents).
- [ ] Done · Found:

### I7 Many uploads at once on a farm not on vLLM (the K test box, Ollama or llama.cpp)
*Proves:* the plugin holds a class. *Was:* 7f.8 (J4 does it beside vLLM).
1. Ten laptops upload at once.

*Expect:* each is indexed (write down the times); farm.log has no line per piece of text (only the plugin's start and
any warning).
- [ ] Done · Found:

---

# Part 2 — the farm

These sessions are for the Farm app and its engines. They come after the client sessions because the owner asked for
the client first; the ★ ones are as urgent.

## J. The studio's PRO 6000 (production, vLLM run by the farm), at a quiet moment

**Machine:** the RTX PRO 6000 box. **Last recorded state:** Farm app farm-v0.0.48 (DEVLOG 2026-10-23 16:55; installing
farm-v0.0.49–0.0.51 is not recorded) serving Qwen3.6 on vLLM 0.30.0 from `~/lol-vllm` (since about 2026-10-12: DEVLOG
2026-10-12 16:20); the models in `F:\LlmOnLan` and Ubuntu's disk in `F:\LlmOnLan\wsl\Ubuntu` (2026-10-13: O1 and O3 in
Part 4); Gemma 4 12B, Qwen3-Omni and Flint already downloaded in vLLM's `hf/` (DEVLOG 2026-11-02 18:09). **Build:**
farm-v0.0.51 (the release under test). Install it first (the Farm app's Quit, so `lol down` stops vLLM, then the
installer) and write what the update did here:
- [ ] Installed · Found:

**Also:** one client laptop on the release under test beside it. Put back every setting a test changes.

### J1 The vLLM section opens, and installs from nothing
*Proves:* an operator can install vLLM from the panel alone (the owner's "I cannot click the vLLM button").
*Was:* the clean-state run (DEVLOG 2026-10-08 14:05), 7e.3 on this box. *Note:* vLLM has been installed on this box
since about 2026-10-12 (DEVLOG 2026-10-09 19:01 found no `~/lol-vllm`; 2026-10-12 16:20 has production's vLLM with 48
seats), and no entry says how: "from nothing" no longer runs here. The owner says whether it was the panel's **Install
vLLM** (then tick it, with the date) or it is left to K6.
1. Panel ▸ open the **vLLM** section (its line).
2. Read the checklist. Press **Install vLLM** (about 45 min). Meanwhile chat from the laptop.
3. When it is installed, **Download** the model if the list says it is not there yet.

*Expect:* step 1 opens the section where it is and checks this computer, Install vLLM in it; the checklist says *Install vLLM
downloads it too* (no Download button promised before the install); nothing marked ✗; the laptop chats normally
during the install; the list ends with the model downloaded.
- [ ] Done · Found:

### J2 Switch to vLLM and back, seen from a client
*Proves:* a switch keeps clients on this farm and tells them the truth. *Was:* 7e.4.
1. Press **Serve with vLLM** (the vLLM section). The panel says about 2 minutes.
2. Meanwhile on the laptop: look at the pill; send a message in Open WebUI; send one in LOL Vibe.
3. Once ready: chat in Open WebUI; attach a scanned PDF; in LOL Vibe ask for a long answer and press **Stop**.
4. Press **Serve with Ollama** (the Ollama section; about a minute). Keep an Open WebUI chat open through it.

*Expect:* the pill reads *<farm> · Switching to vLLM…* and stays on this farm; Open WebUI gets *This farm's model is
starting: about 2 minutes. Try again then.*; LOL Vibe says the model may be restarting and to try again in a few
seconds (**known mismatch, owner's call:** write down how it reads); once ready Performance (vLLM section) shows the
seats, LOL Vibe's strip says `vllm`, the PDF is read, Stop ends the reply at once. Back on Ollama: the same name
people see, the open chat keeps working, `nvidia-smi` shows vLLM's memory freed.
- [ ] Done · Found:

### J3 vLLM's settings under one Apply
*Proves:* Apply's dry run asks only before a restart. *Was:* 7e.5.
1. On vLLM (48 people at 64k), *People served at once* → **64** ▸ **Apply changes**.
2. → **96** ▸ Apply. Cancel the question.
3. *Context per person* 64k → 32k ▸ Apply; confirm. Check a client's context meter in LOL Vibe.
4. Put both back.

*Expect:* 64: no question, done in seconds, vLLM keeps running, a line warns 64 is more than measured. 96: Apply asks
first (vLLM restarts, about 2 min: its request cap grows). 32k: asks first, then clients see 32k. Automatic says
where its number comes from (measured on this card, what the memory holds, or 4 to start with); the line under the
rows says how many people the memory holds at that context.
- [ ] Done · Found:

### J4 Document search beside vLLM
*Proves:* both fit on one GPU, and uploads do not slow chat much. *Was:* 7f.7.
1. vLLM the engine, Document search on. Read the vLLM section's *GPU memory for conversations*.
2. Ten laptops (or ten Open WebUI windows on several laptops) upload a 50-page PDF at once while two people chat.

*Expect:* the section says *1.5 GB for document search* only while document search is not running yet. Write down the
upload times and whether chat slows.
- [ ] Done · Found:

### J5 Stop, Start, Quit, Share
*Proves:* the Farm app's own buttons do what they say to vLLM. *Was:* 7e.6.
1. **Stop vLLM**; watch a client. 2. **Start vLLM**. 3. The Farm app's **Quit**; then `nvidia-smi`. 4. Open the app
again. 5. Settings ▸ **Share compute with the network** off, then on.

*Expect:* Stop: the farm goes unhealthy and clients move to another farm. Start: back in about 2 min, the pill reading
*<farm> · Starting vLLM…*. Quit: the window says *Stopping the farm… With vLLM this can take a minute, while it frees
the GPU.*, then `nvidia-smi` is back to the desktop's memory. Reopen: vLLM starts by itself (about 2 min). Share off
and on: the farm restarts in seconds each time and vLLM is not restarted (no *Starting vLLM* on clients;
`nvidia-smi` shows its memory throughout).
- [ ] Done · Found:

### J6 The queue in the pill
*Proves:* a client sees the engine's queue. *Was:* 7d.5.
1. From the farm box: `lol bench --users 140 --rounds 1 --max-tokens 1000`.
2. Watch a client's pill and its tooltip while it runs, and after.

*Expect:* amber, *<farm> · 47/48 free · 12 waiting* (numbers vary); the tooltip says messages are queued at the model
and a new one waits its turn; back to normal when the bench ends. (On Ollama it never shows.)
- [ ] Done · Found:

### J7 Only the routes clients use
*Proves:* the seat gate forwards nothing else to vLLM. *Was:* 7d.11 (checked once with raw bytes on 2026-10-07 17:48
against the operator-run vLLM; now against the farm's own).
1. `curl -i --path-as-is -X POST http://<farm>:4000/vllm/../invocations -H "content-type: application/json" -d '{"model":"assistant"}'`,
   then the same with `/vllm/%2E%2E/tokenize`.
2. Then use everything through the farm: an Open WebUI chat and its title, a PDF, LOL Vibe, a Computer Instruction,
   the coding agent (G2), an agent page (G7), `lol status`, `lol bench`.

*Expect:* both refused (never a 200); vLLM's log (`~/lol-vllm/logs/vllm.log`) shows no request for them; everything in
step 2 works.
- [ ] Done · Found:

### J8 The reply limit
*Proves:* a runaway reply stops, and the farm advertises its limit. *Was:* 7d.14.
1. On Ollama: add `"maxReplyTokens": 1024` to `proxy` in lol.config.json (a developer setting), restart the farm.
   Read `backend.replyTokens` in `http://<farm>:41997/lol/self`.
2. Open WebUI: *"Write a 3,000-word story about a lighthouse."* Then the same in a Computer Instruction.
3. Remove the line, restart; read `backend.replyTokens` again. On vLLM: read the start of vLLM's log.

*Expect:* Open WebUI's reply stops mid-sentence after about 750 words; the Instruction writes on past that (a
request's own limit wins on Ollama and llama.cpp); vLLM's log names `max_new_tokens` 32768. `backend.replyTokens` reads
1024, then 32768 (advertised since farm-v0.0.50; LOL Vibe's coding agent asks for it).
- [ ] Done · Found:

### J9 Speech to text on the GPU beside vLLM
*Proves:* the farm's speech to text installs and runs on the PRO 6000's GPU from the installed Farm app, and vLLM's
Automatic memory leaves it room. *Needs:* farm-v0.0.45+, a quiet moment, vLLM serving, a client laptop. *Was:* new
(2026-10-09).
1. Panel ▸ Plugins ▸ **Speech to text** on (the first start installs ~1.2 GB and downloads Whisper large-v3-turbo,
   ~1.6 GB). Read farm.log. On the PRO 6000, Whisper large-v3-turbo was already in the Farm app's folder by 2026-10-12
   (DEVLOG 2026-10-12 16:20; O1 moved its 1.6 GB): the first start's time can no longer be measured there; steps 2–3
   are still to do.
2. From the laptop: Open WebUI's microphone button, say a French sentence; then a call (A18 step 2).
3. Restart the farm (Stop, Start). Read where *Speech to text up* comes in farm.log, and vLLM's people at once.

*Expect:* farm.log says *Speech to text up (faster-whisper large-v3-turbo, GPU)*; the laptop's words come back in
well under a second while the GPU is idle (1.3 s was measured with vLLM busy at 100 %); after the restart it comes up
before vLLM is sized, and vLLM's Automatic memory is about 2 GB smaller than without it (write both numbers).
- [ ] Done · Found:

### J10 Gemma 4 12B and Qwen3-Omni in the vLLM list
*Proves:* the two new models reach a farm whose list was saved before them, download, serve, see a picture, call a
tool and hear sound, from the panel alone. *Needs:* farm-v0.0.45+. *Was:* DEVLOG 2026-10-09 "Gemma 4 12B and
Qwen3-Omni on vLLM" (measured there with a scratch vLLM, never from the panel of an installed Farm app).
1. Open the vLLM section. Read the list.
2. If the checklist says *… cannot read sound yet: press Update vLLM*, press **Update vLLM** (vLLM stopped first).
3. **Download** Gemma 4 12B (9.3 GB; on the PRO 6000 it is on disk since 2026-11-02: the list says *downloaded*, go
   to Use this). **Use this**; wait for the restart (about 2 min).
4. In Open WebUI: attach a photo and ask what it shows; ask *"What is the weather in Lyon?"* with web search off.
5. From the farm box, sound in a message (no client sends one yet):
   `curl http://127.0.0.1:4000/v1/chat/completions -H "content-type: application/json" -d @msg.json`, where
   `msg.json` is `{"model":"<the name people see>","messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"<base64 of a short French WAV>","format":"wav"}},{"type":"text","text":"Transcribe this audio word for word."}]}]}`
   (add `-H "Authorization: Bearer <farm password>"` on a farm with one). On a farm with no password,
   `node docs/spike/runs/probe.js http://127.0.0.1:4000/v1 <the name people see> out.json` does steps 4 and 5 at once.
6. **Download** Qwen3-Omni (70.5 GB: an hour or more; on the PRO 6000 it is on disk since 2026-11-02), **Use this**,
   repeat 4 and 5.
7. Back to Qwen3.6 with **Use this**.

*Expect:* step 1: six models (Flint since farm-v0.0.51), Gemma 4 12B and Qwen3-Omni included even on a farm whose list
an Add, a Remove or a take-over saved before (a model removed by hand stays out). Step 3: Automatic says the measured
number (Gemma: 16 people at 32k, 8 at 64k on every turn). Step 4: the picture described; Gemma's thinking shows as
thinking; the weather question gets an answer (Open WebUI sends the Computer's tools with it, so this is a request with
tools), never an error. Step 5: the French sentence written back, close to word for word (on vLLM 0.33.0 Gemma 4 wrote
the English translation instead, 6 of 6, 2026-11-02; Qwen3-Omni the French: write down which). Step 6: the same with
Qwen3-Omni (Automatic: 20 people at 32k, 10 at 64k; the first message with sound after its start takes several
seconds). Write down the start times and anything that read wrong.
- [ ] Done · Found:

### J14 ★ Update vLLM from the panel: 0.30.0 → 0.33.0
*Proves:* the owner's farm moves to vLLM 0.33.0 from the panel alone, and an update that stops half-way leaves 0.30.0
serving. *Needs:* farm-v0.0.51 installed (J's Build line), the farm on vLLM 0.30.0 (`~/lol-vllm`), a quiet moment of
about 45 min. *Was:* new (2026-11-02; checked on a scratch root with `install.sh`, never from the panel).
1. Open the vLLM section. Read the checklist. In the list, press **Use this** on Flint and answer OK to the question
   (if Flint says it is not downloaded, skip this).
2. **Stop vLLM**, then **Update vLLM**. After a minute, **Stop** on the download bar. **Start vLLM**; chat from a laptop.
3. **Stop vLLM**, **Update vLLM** again, to its end (about 10 min on a good connection: ~9 GB). **Start vLLM**.
4. A chat, a picture and a PDF from a laptop; the IDE agent on one task; `nvidia-smi`.

*Expect:* step 1: *vLLM 0.30.0 is installed; this farm was tested with 0.33.0.* with **Update vLLM** beside it, and vLLM
still serving. Use this on Flint is refused with *Flint 40B-A2.5B · NVFP4 needs vLLM 0.33.0 or newer, and this computer
has vLLM 0.30.0: press Update vLLM first.*; vLLM keeps serving Qwen3.6. Step 2: Stop keeps 0.30.0: it starts and
answers as before (the panel still says 0.30.0). Step 3: the checklist says 0.33.0 is installed, the warning is gone;
the first start takes longer (kernels compile, up to ~6 min). Step 4: everything works; Automatic still says 48 people
at 64k. Write down the times.
- [ ] Done · Found:

### J15 Flint from the panel, for coding
*Proves:* Flint downloads, serves and behaves in Open WebUI and LOL Vibe through the farm. *Needs:* farm-v0.0.51, J14
done (vLLM 0.33.0), ~23 GB of disk, a laptop with the coding agent. *Was:* new (2026-11-02; measured from a scratch
farm, never from the panel).
1. vLLM section ▸ the list: **Download** Flint (22.9 GB) if it is not downloaded yet (on the PRO 6000 it is since
   2026-11-02), then **Use this**; wait for the restart.
2. Open WebUI: three short questions; then one with web search on (*"What is the weather in Lyon today?"*); look at each
   chat's title.
3. LOL Vibe: a real project, a few tasks of your own (and one with **Keep going until done**).
4. **Use this** on Qwen3.6 again.

*Expect:* step 1: Automatic says 19 people at 64k on a 60 GiB pool (20 were measured at 62k each; the farm counts the
whole 64k window, and fewer with document reading's memory kept aside), and the Presets card's LOL Vibe still picks
Qwen3.6, naming Flint as also proven. Step 2: every answer in the reply, never only in the thinking block (the farm's
open-think template), titles without a `<think>` block (one may be missing: Flint thinks up to ~900 tokens for one);
Flint does not see pictures. Step 3: the agent works, slower than Qwen3.6 (about 40 s a small task against 15 s),
writes and edits files; note any loop (it re-reads and re-checks) and any answer that stays empty. Write down how it
compares with Qwen3.6.
- [ ] Done · Found:

### J16 A class at once: 48 people at 64k through the seat gate, then web search under a burst
*Proves:* the multi-user plan's acceptance through the real seat gate (its §12, docs/archive/plans/multiuser_implementation_plan.md),
and its decision 4's class-size check, which must pass before web search can be on by default again (DEVLOG
2026-10-06 10:51). *Needs:* J14 done (vLLM 0.33.0: Automatic gives Qwen3.6 48 people at 64k on this card); a quiet
hour with nobody on the farm, and no client open on the farm box itself (it would hold a seat from 127.0.0.1); `$PY` = `farm\.venv\Scripts\python.exe` and `docs\spike` from a checkout (as in J12, Part
3); 10 laptops for step 5. *Was:* new (review 2026-11-05; the plan's §12, never run). Steps 1–4 need no person: an agent
can run them once the owner closes the farm (Part 3).
1. Panel ▸ Access ▸ *Free an idle seat after* **1 min** ▸ Apply (the bench's seats stay held for that long after it
   ends). Between the steps below, wait a minute.
2. On the farm box: `lol bench --people --users 48 --rounds 3 --max-tokens 1000 --out class48.json`; then once
   `lol bench --people --users 50 --rounds 1 --max-tokens 1000`.
3. The 64k load through the gate (from one address: one seat), from `docs\spike`:
   `$PY spike_bench.py bench --base-url http://127.0.0.1:4000/v1 --api-key <the farm password> --label pro6000-gate-qwen36-64k --profile followup --prompt-tokens 62000 --rounds 3 --append --levels 16,32,48 --extend ""`,
   then `$PY spike_bench.py summarize results/pro6000-gate-qwen36-64k*`.
4. Optional, 128k: vLLM section ▸ *Context per person* 131072 ▸ Apply; `lol bench --people --users 30 --rounds 3
   --max-tokens 1000`, and step 3's line with `--prompt-tokens 120000 --levels 16,30` (label `…-128k`). Put 65536 back.
5. Ten laptops at once: a question about something from this week in Open WebUI, with the globe on. Then put *Free an
   idle seat after* back.

*Expect:* step 2: no 429 at 48; at 50, 48 served and 2 lines `NO SEAT (429)`. Read the share of people at 15 tok/s or
more from each request's `tps` in class48.json (the summary prints only the median). Step 3: TTFT p95 under 5 s and
decode p10 at 15 tok/s or more at 48. Step 4: the same at 30 (the margin is thin; Automatic gives 32 at 128k). Step 5:
count the right answers and the errors, and note which search engines answered; the owner decides from them whether web
search goes back on by default.
- [ ] Done · Found:

## K. A Windows test box with an RTX card (not production)

**Machine:** a Windows PC with an NVIDIA RTX card that is not the production farm; ideally also the studio's 4070
(12 GB) and 4080 (16 GB), and one PC with no NVIDIA GPU. **Build:** the previous Farm app (today farm-v0.0.50)
installed first, then the release under test (farm-v0.0.51); K11 needs the first Farm app release after farm-v0.0.51.
**Also:** a client laptop on the release under test.

### K1 ★ The Farm app update keeps everything
*Proves:* an update over the previous Farm app keeps the model, its settings and the password. *Was:* 7e.1 (and 7d.9,
1.3). Seen in part on the PRO 6000, 2026-10-13 (DEVLOG 08:54, 09:09, 09:24): farm-v0.0.45 → 0.0.46 → 0.0.47 → 0.0.48
were installed over each other, and each came up on vLLM with its settings; v0.0.48 was installed while vLLM kept
running, and adopted it at its start. Not recorded: the password, a renamed Ollama model, farm.log, and Plan capacity
offline.
1. On an Ollama farm with a password and a renamed model, note the panel. Install the release under test over it; open
   it. (Do not go back afterwards: an older Farm app refuses the settings once farm-v0.0.51 edited the vLLM list, its
   release notes say.)
2. Press **Plan capacity ↗** with the network cable out.

*Expect:* the panel shows the model, its settings and the password as before; the sections Ollama, llama.cpp,
vLLM (the serving one open); **Document search** appears in Plugins, on (NVIDIA); farm.log has no "code refresh
failed"; Plan capacity opens in the system browser with this box marked, offline. On a farm that came from
farm-v0.0.41 or older: the first line of `farm\.searxng\settings.yml` says *lol-settings v4* (or later), its
`secret_key` is unchanged, a search on `http://127.0.0.1:8888` names Swisscows beside some results and no Yandex (7d.9).
- [ ] Done · Found:

### K2 ★ The update copies over a file something holds
*Proves:* the file-by-file copy (farm-v0.0.43's update stopped half-way on the PRO 6000). *Was:* DEVLOG 2026-10-08
12:02 ("Not done yet: the release"). Not covered by the PRO 6000's updates of 2026-10-13: serve.sh and stop.sh did not
change between farm-v0.0.45 and v0.0.48, so no held file was replaced. `serve.sh` changed in farm-v0.0.51
(`git diff farm-v0.0.50 farm-v0.0.51 -- farm/vllm`, checked 2026-11-05), so this pair replaces it.
1. With the previous Farm app (farm-v0.0.50) installed and the Farm app quit, hold serve.sh open from WSL:
   `wsl -e bash -c 'exec 3< "/mnt/c/Users/<you>/AppData/Roaming/LlmOnLan Farm/farm/vllm/serve.sh"; sleep 900'`
   (leave that window open).
2. Install the release under test and open it. Then close the WSL window and quit and reopen the Farm app.

*Expect:* the new panel opens; farm.log names no failed file; every `farm\vllm` script is the new one (`serve.sh`,
`status.sh` and `install.sh` changed in farm-v0.0.51); the old serve.sh sits in `farm\.replaced` (as `N-serve.sh`) and
is gone after the next launch; the vLLM section never says *A file of the farm is missing*.
- [ ] Done · Found:

### K3 ★ llama.cpp b11836 from the installed Farm app
*Proves:* the pin bump works outside the dev box. *Needs:* farm-v0.0.49+. *Was:* new (DEVLOG 2026-10-08 21:40, "Not
done: … a farm release"); the pin is b11836 since farm-v0.0.49 (DEVLOG 2026-10-23 16:55, Part 1).
1. llama.cpp section ▸ **Serve with llama.cpp** (default model). Time the first start (it downloads llama.cpp — ggml-org's
   two b11836 zips, about 583 MB, unless document search fetched them already: write down the size — then the model if
   it is not there).
2. A reply from a client; a picture in Open WebUI; Performance (llama.cpp section).
3. Rename the model (e.g. `tutor`), switch to Ollama, then back.
4. Optional: unplug the network, restart the farm.

*Expect:* healthy, the panel reads `llama.cpp · …`; a reply, the picture described, Performance filled; the
name `tutor` stays across both switches and an open chat keeps working (RIG FA-2); offline, it falls back to Ollama
with the reason on the panel.
- [ ] Done · Found:

### K4 ★ Document search's first start
*Proves:* the default-on plugin comes up by itself and costs what was measured. *Was:* 7f.1.
1. On the updated NVIDIA farm, open Plugins. Note `nvidia-smi` before and after its first start, and the time.
2. On the PC with no NVIDIA GPU (or a Mac farm), open Plugins.

*Expect:* **Document search** on, with *Laptops send the text of their documents here…*; about 1.2 GB more GPU memory;
first start = the llama.cpp download + about 0.6 GB. No NVIDIA: off.
- [ ] Done · Found:

### K5 ★ A 12 GB and a 16 GB card
*Proves:* small RTX cards are told the truth and keep working. *Was:* 7e.2, and DEVLOG 2026-10-08 21:57 ("a 12 GB card,
where Ollama's context gets measured again beside the plugin").
1. On the 4070 (12 GB): read the **vLLM** section's line before opening it; open it.
2. Restart the farm on Ollama with Document search on; read the context line.
3. The same on the 4080 (16 GB). On the PC with no NVIDIA GPU, open the vLLM section.

*Expect:* the line says *not for this GPU · 12 GB; vLLM's models need about 27 GB: llama.cpp or Ollama is the engine for
it* (16 GB on the 4080; 27 GB is the smallest model, Gemma 4 12B, with document reading and document search beside it),
before anything about WSL; no Install, no Download, the farm keeps serving. With document reading off, the line says
*about 18 GB* on both cards while document search is on. With document search off too, the 4080 is offered vLLM for
Gemma 4 12B (write down how many people Automatic gives); the 4070 still is not (about 16 GB). Ollama measures its
context again beside the plugin (a new *Context: auto → N* in farm.log) and chats work. No NVIDIA GPU: told so, not to
install WSL.
- [ ] Done · Found:

### K6 vLLM from nothing on a Blackwell PC without WSL
*Proves:* the whole install path on a fresh Windows. *Was:* 7e.3 (never run: VLLM_MANAGED_PLAN, "Never run yet").
1. Open the **vLLM** section: follow the checklist (an administrator PowerShell, a restart, Ubuntu opened once). **Check again**.
2. Install the C compiler with the line it gives. **Check again**.
3. **Install vLLM** (about 45 min) while a client chats. **Download** the model, **Stop** it half-way, Download again.
4. An RTX 5090 (32 GB) with Qwen3.6 (the default model): turn Document reading (OCR) off in Plugins first (with it on,
   the 9 GB kept for document reading leave Qwen3.6 no room on 32 GB). After a farm restart, check that OCR is still
   off and vLLM still serves (the switch is kept since farm-v0.0.50, DEVLOG 2026-10-27). Write down how many people
   Automatic gives.

*Expect:* WSL steps, then a C compiler, then nothing ✗; the client chats normally during the install; a stopped
download reads partly downloaded and a second Download finishes it; on a French Windows the WSL sentences read
right; an older card gets a warning (write down whether it starts).
- [ ] Done · Found:

### K7 Speech to text on a small card and on a PC with no NVIDIA GPU
*Proves:* the GPU choice and the CPU fallback from the installed Farm app. *Needs:* farm-v0.0.45+. *Was:* new
(2026-10-09).
1. The 4070 (12 GB) box: Plugins ▸ **Speech to text** on; a laptop's microphone in Open WebUI.
2. The PC with no NVIDIA GPU: the same.
3. On the 4070, an old NVIDIA driver if one is at hand (or rename `farm\.stt\venv\Lib\site-packages\nvidia` and
   restart the farm).

*Expect:* the 4070 says *GPU* in farm.log, and after a farm restart Ollama's context is measured again with it beside (a new *Context* line);
the PC without NVIDIA says *CPU* and installs no CUDA library (~0.3 GB); with the library gone the log says *CPU: the
GPU did not load (…)* and the microphone still works, slower.
- [ ] Done · Found:

### K8 The llama.cpp list before switching
*Proves:* an operator on Ollama (or vLLM) sees and prepares what a switch to llama.cpp would serve, and the farm keeps
serving meanwhile (owner 2026-10-09). *Needs:* farm-v0.0.45+.
1. On Ollama, a client chatting. Panel ▸ open the **llama.cpp** section (its line).
2. Read it. On a model that is not downloaded, press **Use this**; watch the bar and the client.
3. Close the section (its line); open it again. Press **Serve with llama.cpp**; read the question; confirm.
4. Switch back to Ollama.

*Expect:* step 1 opens the section, with no question and no switch; its line read *standby · <model> chosen*; it says
Ollama keeps serving until **Serve with llama.cpp**, marks the model it will serve **chosen** and those on this computer **downloaded**. Step 2:
the bar says *Downloading <model>*, the client keeps chatting, then *llama.cpp will serve <model> when you switch to it.
Ollama keeps serving until then.* Step 3: the question names that model (and says it downloads it first when it is not
there); llama.cpp serves it.
- [ ] Done · Found:

### K9 Presets on a card without vLLM
*Proves:* on a GeForce card the presets keep to Ollama and llama.cpp and say why (session Q saw them only on the PRO
6000 with vLLM). *Needs:* farm-v0.0.50+, the 4070 or 4080 box on Ollama with document search on, a laptop. *Was:* new
(review 2026-11-05; the picks are DEVLOG 2026-10-27 10:55's table).
1. Panel ▸ Presets: read which preset is in use. **Review…** each of the four, then **Close**.
2. **Apply LOL Vibe**; wait for the job. From the laptop, a LOL Vibe project: ask the coding agent for a small page.
3. **Apply Balanced**. Stop and Start the farm.

*Expect:* step 1: Balanced, Documents and Computer = Ollama · gemma4:12b · Automatic context · 2 at once; LOL Vibe =
llama.cpp · Qwen3.8 27B · UD-IQ2_S, with *No model proven with the IDE's coding agent is available here*; nothing offers
vLLM; Review changed nothing. Step 2: if llama.cpp's model is not on this computer, Review lists *Download Qwen3.8 27B ·
UD-IQ2_S (… GB) for llama.cpp first.* and Apply refuses with *First: …*, changing nothing: download it in the llama.cpp
section, then Apply again. llama.cpp then serves (1 at once, Automatic context), document search is untouched, the card
says *LOL Vibe · in use*, and the agent answers. Step 3: Ollama again, *Balanced · in use* after the restart.
- [ ] Done · Found:

### K10 An Ollama folder used where it is, then moved in
*Proves:* Model storage's "Use this folder" for Ollama models found elsewhere, and "Move into the farm's folder". *Needs:*
farm-v0.0.48+; a farm whose Ollama the Farm app starts (not the PRO 6000, where the Ollama app runs Ollama and Use this
folder only saves the folder and says what to set); a farm folder chosen (Model storage ▸ Keep everything here ▸ Move
here); a copy of an Ollama models folder elsewhere that holds the farm's default model (gemma4:12b). *Was:* new (review
2026-11-05; proposed as O6, moved here off production).
1. **Use the models in this folder** ▸ that folder ▸ **Look**, then **Use this folder** on the Ollama line, and read
   the question.
2. `ollama list`; chat.
3. **Move into the farm's folder**; read the question; accept.

*Expect:* (1) *Ollama now reads its models from <folder>. The models of its old folder are not deleted.*, with no farm
restart. (2) Its models are listed and served from where they are, nothing is copied, nothing is pruned from that
folder. (3) The models are in `<farm folder>\ollama` and gone from the old folder, and the Ollama line no longer shows
that folder as chosen.
- [ ] Done · Found:

### K11 ★ Turning on Voice for the first time does not freeze the farm
*Proves:* a plugin's first install (Kokoro: several GB of Python packages, then its ~312 MB voice) runs beside the farm,
which keeps streaming, beaconing and answering the panel (before the fix of 2026-11-05 it froze everything for the whole
install: streams stalled, the panel stopped answering, and clients dropped the farm after 120 s). *Needs:* the first
Farm app release after farm-v0.0.51 (or a candidate of it); a farm where Kokoro never ran (no `farm\.kokoro`: this box,
not production); a laptop. *Was:* new (review 2026-11-05).
1. On the laptop, ask LOL Vibe for a long answer (*"list 300 numbered items"*).
2. While it streams: panel ▸ Plugins ▸ **Voice (TTS)** ▸ Enable. Keep the panel open; reload it once during the install.
3. Watch the laptop's pill and its farm card during the install; when it is done, a Speak box with the farm voice.

*Expect:* the reply keeps streaming to its end; the panel reloads and answers during the install (Voice (TTS) reads
*starting…*, then *on*); the pill stays green, never *· not responding…*, and the farm stays on the card. When it is
done, the farm's voice speaks. Write
down the install time. Document OCR's and web search's first installs were changed the same way: if a farm where they
never ran is at hand, the same holds there.
- [ ] Done · Found:

## L. The DGX Spark

**Machine:** a DGX Spark, with a screen. **Build:** the Farm app's Linux arm64 AppImage of the release under test (L3
needs farm-v0.0.49+, L4 farm-v0.0.51). L1–L3 never ran on a Spark.

### L1 The AppImage runs and serves
*Proves:* the Spark can be a farm from the app. *Was:* RIG_CHECKLIST "DGX Spark".
1. Run the AppImage (FUSE, or `--appimage-extract-and-run`); go through the wizard.

*Expect:* the plain `ollama-linux-arm64` loads gemma4:12b on the GB10; a client chats.
- [ ] Done · Found:

### L2 vLLM run by the farm on the Spark
*Proves:* the plan's §11.6 (VLLM_MANAGED_PLAN). *Was:* 7e.9, 7d.17, 7d.18.
1. `bash "/home/<you>/.config/LlmOnLan Farm/farm/vllm/status.sh"`: `arch=aarch64`, a `gpu=NVIDIA GB10, …` line whose
   memory fields are not numbers, a `cc=` path, `mem_available_kb=`.
2. Open the panel's vLLM section, then the check: *GPU: NVIDIA GB10 (119 GB shared with the system).*, nothing ✗.
3. Optional, only if the operator recipe runs (`lol-vllm.service`, farm/README "External"): the take-over is offered;
   clicked, it keeps the same process group, writes 58 GB for conversations, 8 people and the 8 GB guard;
   `sudo systemctl restart lol-vllm` starts nothing (journal: *The LlmOnLan farm runs this vLLM now …*), no loop.
4. Stop vLLM, Start, with Automatic memory: farm.log says 8 people and 27 GB; `tr '\0' '\n' < /proc/<pgid>/environ`
   has `LOL_VLLM_MIN_FREE_GB=8` and `MAX_JOBS=4`. Again: the same 27 GB.
5. A first start of a model never started there: `free -g` stays above 8 GB available; no `[guard]` in `vllm.log`.
6. Under load (`lol bench --users 8`): no *stuck at a low clock* line; `nvidia-smi --query-gpu=clocks.sm,power.draw
   --format=csv -l 2` reads ≥ 1,400 MHz and ≥ 40 W. (Near 700 MHz: latched after an out-of-memory crash; only a cold
   power drain clears it. Check the panel's warning says so.)
7. A Download, then Stop: `status.sh` shows no `installing=`; `pgrep -af "hf download"` shows nothing.
8. Quit the Farm app: no `running=` in `status.sh`, memory back (`free -g`).
9. Optional, 45 min and 33 GB: Install vLLM from the panel into an empty folder; then
   `<folder>/.venv/bin/python -c "import torch; print(torch.__version__, torch.cuda.get_device_name(0))"` names a
   `+cu13…` torch and `NVIDIA GB10`.

*Expect:* as each step says. Write down anything the Spark needed that the docs do not say.
- [ ] Done · Found:

### L3 llama.cpp and document search on the Spark
*Proves:* the arm64 llama.cpp of the pin, and ggml-org's own build as a replacement (owner, 2026-10-09). *Needs:*
farm-v0.0.49+. *Was:* RIG_CHECKLIST "llama.cpp on the DGX Spark"; DEVLOG 2026-10-08 21:57 "the DGX Spark (our arm64
build of the new pin)"; the pin is b11836 since farm-v0.0.49.
1. llama.cpp section ▸ Serve with llama.cpp: the farm downloads the `llamacpp-b11836` tarball (our CI build, published
   2026-10-23: `llama-b11836-bin-linux-cuda-arm64.tar.gz`, about 594 MB). A reply.
2. Plugins ▸ Document search: on; a client uploads a document (I3).
3. ggml-org's `llama-b11836-bin-ubuntu-cuda-13.4-arm64.tar.gz` + its `cudart-llama-b11836-bin-ubuntu-cuda-13.4-arm64.tar.gz`,
   set as `llamacpp.binDir` (a developer step): the GB10 seen, a reply, EmbeddingGemma 2 at 768.

*Expect:* steps 1–2 work; step 3 decides whether `build-llamacpp-arm64.yml` goes (DEVLOG 2026-10-09).
- [ ] Done · Found:

### L4 vLLM 0.33.0, presets and Model storage on the Spark
*Proves:* what farm-v0.0.46–0.0.51 added runs on Linux arm64: Update vLLM, the presets' picks and Model storage's `hf`
link were checked on the PRO 6000 only, or only in unit tests (DEVLOG 2026-10-12 11:57: "the `hf` link move only
unit-tested"). *Needs:* farm-v0.0.51, L2 done (vLLM installed), a second disk (or partition) with more free space than
Move here's question says it will copy. *Was:* new (review 2026-11-05).
1. vLLM section: if it says *vLLM 0.30.0 is installed; this farm was tested with 0.33.0*, **Stop vLLM**, **Update
   vLLM**, **Start vLLM**; a chat from a laptop.
2. Presets ▸ **Review…** each.
3. Model storage ▸ Keep everything here: a folder on the other disk ▸ **Move here**; chat during the copy.

*Expect:* step 1: 0.33.0 installed, Qwen3.6 answers, Automatic about 8 people at 64k. Step 2: Qwen3.6 for all four;
Balanced says *not your 30*, LOL Vibe *not your 10*, Computer *not your 20*; Documents covers your 5. Step 3:
`<root>/hf` is a link to `<folder>/vllm/hf`, vLLM serves again from there, the old copy is gone, `.lol-storage` is in
the folder. Write down the times.
- [ ] Done · Found:

## M. Reboot tests, at a quiet moment

### M1 Launch at login on Windows (the PRO 6000)
*Proves:* the farm and vLLM come back after a restart with nobody at the box. *Was:* 7e.7, VLLM_MANAGED_PLAN §11.5 (the
production take-over before it, §9.6, is superseded: the clean-state run removed the operator-run vLLM).
1. Farm app Settings ▸ **Launch at login** on. Restart the PC and log in.

*Expect:* the Farm app opens, the farm comes up, vLLM about 1.5–2 min later; clients show *Starting vLLM* and keep
the farm; the farm stays healthy throughout. When WSL is slow at log on, the farm checks again once up and serves
vLLM, not Ollama (write down if the panel says it fell back).
- [ ] Done · Found:

### M2 The Spark after a reboot
*Proves:* whether the farm starts on a Spark with nobody logged in. *Was:* §11.6 step 9, 7e.9.
1. Launch at login on; reboot the Spark.

*Expect:* write down whether it logs in to its desktop by itself. If yes: the Farm app starts, vLLM about 2 min
later. If not (headless): nothing starts the farm; the README's "At login" says what to do instead.
- [ ] Done · Found:

## N. The Farm app on a clean box (plus downloads)

**Machine:** a Windows PC with an NVIDIA GPU and **no** Ollama and no Python installed (a system Python on PATH is
fine for N2, better even); a second machine for D10. **Build:** the release under test. Never run on a truly clean box:
the clean-state run on the PRO 6000 reused the owner's Ollama (DEVLOG 2026-10-08 14:05).

### N1 The first-run wizard from nothing
*Proves:* an operator gets a farm from one installer. *Was:* RIG_CHECKLIST "Clean box", "gemma4:12b pull on a fresh
box", "OCR on a fresh box".
1. Install and open. Go through the wizard; watch each phase.
2. When it serves: a client chats, attaches a scanned PDF and a photo.

*Expect:* all phases complete — runtime download (Python + Ollama), farm copy, gemma4:12b pull (about 8 GB, a real %
bar), `lol install`'s venvs (`.extract` among them), launch — then `/lol/self` healthy and the panel opens unlocked
(token seeded). The PDF and photo are transcribed; farm.log has one `[extract] <file>: N page(s) → …` line each.
Document search starts too (K4).
- [ ] Done · Found:

### N2 The bundled Python and the app's own Ollama
*Proves:* the venvs never use a system Python; `lol up` starts its own Ollama. *Was:* RIG_CHECKLIST "`$LOL_PYTHON`
determinism", "Ollama lifecycle", "`lol up` starting a local Ollama".
1. With a system `py -3.12` on PATH, after N1 look at `.venv`, `.searxng`, `.extract` (their `pyvenv.cfg`).
2. Read farm.log of the first launch.

*Expect:* every venv points at the bundled Python. The wizard's Ollama is stopped before launch; `lol up` starts its
own (`OLLAMA_CONTEXT_LENGTH` seed 16384) and logs *Context: auto → N*.
- [ ] Done · Found:

### N3 Stop, Start, a crash, Quit
*Proves:* the supervisor. *Was:* RIG_CHECKLIST "Start/Stop + crash-restart" (Quit's `lol down` seen 2026-10-08).
1. **Stop**, **Start**. 2. `taskkill /F /T` the `lol up` tree. 3. **Quit**; Task Manager.

*Expect:* Stop/Start toggle the farm; after the kill a bounded automatic restart; after Quit no LiteLLM, Ollama or
plugin process left.
- [ ] Done · Found:

### N4 The manual update check
*Proves:* an operator learns of a new Farm app. *Was:* RIG_CHECKLIST "★ Manual update check".
1. With the previous Farm app (today farm-v0.0.50) installed and *Notify* on, open the app (farm-v0.0.51 is the newest
   release).

*Expect:* *Version … is available*; Download opens the release page; a client's own update is unaffected.
- [ ] Done · Found:

### N5 A Mac farm, and a low-RAM Mac
*Proves:* the macOS Farm app. *Was:* RIG_CHECKLIST "Per-OS installers" (the dmg never installed), "Low-RAM Mac"; the
Ollama app's Model location on macOS (DEVLOG 2026-10-12 11:57: never run against the real app).
1. Install the macOS arm64 Farm app (right-click ▸ Open the first time); go through the wizard. On a Mac with less
   than 16 GB too.
2. On a Mac with the Ollama desktop app (Ollama.app) installed and open before the wizard (the wizard then reuses it):
   Model storage ▸ a folder on another disk ▸ **Move here**.

*Expect:* it serves gemma4:12b on Ollama, no vLLM offered and Document search off; the low-RAM Mac shows the memory
warning but goes on. Step 2: the Ollama app quits and reopens, its Settings ▸ Model location names the new `ollama`
folder, and `ollama list` is unchanged. Without the app, the farm's own Ollama restarts on the new folder.
- [ ] Done · Found:

## O. Model storage on the PRO 6000, at a quiet moment

**Machine:** the RTX PRO 6000 box. **Build:** the release under test (Model storage came in farm-v0.0.46, its
shared-blob fixes in 0.0.47–0.0.48). **Also:** one client laptop. **State:** the farm's models, Ollama's 127 GB and
Ubuntu's Linux disk were moved to `F:\LlmOnLan` on 2026-10-13 (O1–O3, Part 4). F: is the Samsung 990 PRO (an NVMe SSD).
Not D: (a 4 TB hard disk: models load several times slower from it, 56 MB/s measured writing a 4 GB file there) nor E:
(a USB SSD: unplugging it takes the models away).

### O1b After the move: a scanned PDF read from F:, and Ubuntu's other projects
*Proves:* what O1 and O3 did not exercise. *Was:* O1 and O3's "not exercised" lines (Part 4); their deliberate Stop and
Quit in the middle of a move are dropped (Part 5).
1. From a laptop, attach a scanned PDF in Open WebUI and ask about it (document reading, gemma4:12b, from
   `F:\LlmOnLan\ollama`).
2. `wsl -d Ubuntu`: look at your other projects there.

*Expect:* the PDF is read; Ubuntu opens with your files.
- [ ] Done · Found:

### O4 The folder is the list; models elsewhere used where they are, or moved in
*Proves:* what is in the folder is what the farm has; models already on disk are used where they are, or moved in on
a click. *Was:* new (owner 2026-10-12: "the folder is the source of truth").
1. Copy any `.gguf` (e.g. a small one) into `F:\LlmOnLan\gguf`. Within a minute (or press the card's measure) it is in
   the llama.cpp list, without an Add. Delete it from the folder: within a minute it leaves the list.
2. **Use the models in this folder** ▸ a folder with a .gguf (e.g. a copy in `D:\models`) ▸ **Look**. The llama.cpp
   section opens with what was found. Tick it, **Add the ticked ones**, then **Use this** and **Serve with llama.cpp**;
   chat. Switch back.
3. **Look** in `D:\models` again, tick it, **Move the ticked ones into the farm's folder**, read the question, accept.
4. **Look** in `/home/ateliernum/lol-vllm/hf` (a folder of WSL's Linux): the vLLM section lists its models (the ones
   already in the list say so).

*Expect:* step 1 as said. Step 2: the .gguf serves from its own folder (*On this computer: D:\models*); nothing was
copied; Remove on it never deletes the file. Step 3: it is in `F:\LlmOnLan\gguf`, gone from `D:\models`, the list's line
points there, once (not twice). Step 4: nothing new for the models already in the list.
- [ ] Done · Found:

### O5 A hard disk and a USB drive are said; a folder gone missing is said and never filled
1. Type `D:\LlmOnLan` in Keep everything here and press **Move here**: read the question, then **Cancel**.
2. The same with `E:\LlmOnLan`.
3. Optional, on a quiet day only: rename `F:\LlmOnLan\.lol-storage` to `.lol-storage.off`, restart the farm, read the
   Model storage card and the farm's log; rename it back and restart the farm.

*Expect:* D: *This folder is on a hard disk: models load from it several times slower…*; E: *…on a USB drive…*.
Nothing moved. Step 3: *The model folder F:\LlmOnLan is missing (is its drive plugged in?)…* on the card and in the
log; no Ollama started by the farm, nothing downloaded; after renaming it back everything serves again.
- [ ] Done · Found:

## P. The panel's engine sections — any farm

### P1 ★ One section per engine, the switch inside it
*Proves:* the panel's new layout keeps every control and the switch, and remembers what a person opened (owner
2026-10-12). *Needs:* farm-v0.0.46+. *Was:* new (scratch panel on a stub farm, DEVLOG 2026-10-12 "One section per
engine").
1. Open the panel in the Farm app (a farm on Ollama). Read the lines Ollama, llama.cpp, vLLM without opening them.
2. Open llama.cpp and vLLM by their lines; wait 15 s (three refreshes). Then Tab to a section's line and wait again.
3. In Access, *Free an idle seat after* → 2 min ▸ **Apply changes**. Put it back the same way.
4. Press **Serve with llama.cpp** (or vLLM), read the question, **Cancel**.
5. In a browser on the farm box, open `http://127.0.0.1:41997/lol/admin` (the token: Farm app ▸ Settings ▸ Panel access
   token), open the llama.cpp section, then reload the tab (F5). (Not the Farm app's window: closing it quits the farm.)

*Expect:* step 1: Ollama open, its line *serving · N models · <default> default*; the others closed, each line with its
state (*standby · <model> chosen*, *not for this GPU …*, *cannot run on this computer*). Step 2: both stay open through
the refreshes; opening vLLM checks this computer once (*Checked at …*); the keyboard focus stays on the line. Step 3:
*Applied at once, no restart*. Step 4: the same question as the old engine buttons asked; Cancel changes nothing. Step
5: the llama.cpp section still open after the reload. After a real switch (J2), the new engine's section opens by itself.
- [ ] Done · Found:

## Q. Presets on the PRO 6000, at a quiet moment, with a laptop

The released builds: farm-v0.0.50+ (the client part, the coding agent's reply room, is client v0.2.14+). Each Apply
restarts vLLM (about 2 minutes nobody can chat): never while people use the farm. Write down the farm's settings first
(engine, model, context, people at once, each plugin) so Q7 can put them back. Q4 and Q5's step 3 are measurements:
they are in Part 3.

### Q1 ★ Review each preset: the picks for this box, in plain words
*Proves:* the four picks are the capacity page's for an RTX PRO 6000 with vLLM, Documents and LOL Vibe for the most
people (owner 2026-10-27: "more users"), and Review changes nothing. *Needs:* farm-v0.0.51 for the Flint line. *Was:*
new (stub farm + offscreen screenshots, DEVLOG 2026-10-27).
1. Open the panel. Read the Presets card at the top: which preset it says is in use.
2. Press **Review…** on each of the four, read *Why these*, *What Apply changes* and *Restarts*, then **Close**.

*Expect:* Balanced = vLLM · Qwen3.6 35B-A3B · 64k · people at once Automatic (about 48, measured); Documents = Qwen3.6
· 64k (about 63, measured; *a lead of under 10 % is a tie, which the better model wins*; *when everyone asks at the same
moment, about 48*); LOL Vibe = Qwen3.6 · 64k (about 64; *Picked for the most people among the models proven with the
IDE's coding agent: 11/15 on its five tasks, on vLLM. Also proven: Flint 40B-A2.5B (13/15 on its five tasks, on vLLM
0.33.0).*); Computer = Qwen3.6 · 32k (about 104); nothing to download. The engine, model and plugins in the sections
did not move; vLLM kept running.
- [ ] Done · Found:

### Q2 Computer: every box that needs the farm works for several people
*Proves:* Apply runs as one job (plugins off, vLLM with its settings, plugins on) and the Computer finds everything on.
1. **Review…** Computer ▸ **Apply Computer**; watch the job bar to the end (a first start of Kokoro and Classify
   installs them: up to 10 minutes).
2. On the laptop (the Computer): an Image box → Describe a picture; a Document box with a scanned PDF; a Sound box with
   Listen; a Speak box with the farm voice; a Classify box; a Receive box on a bus topic another laptop Sends to.
3. Read the panel: the Serving card's people at once, vLLM's context, the Plugins card, the Presets card.

*Expect:* the job says *The Computer preset is applied: …* (or says which plugin did not start); every box works;
32k each, people at once about 100 (Automatic); every plugin on, document search as before; the card: *Computer · in use*.
- [ ] Done · Found:

### Q3 Documents: whole documents, scanned pages
1. **Review…** Documents ▸ **Apply Documents** (from Q2's Computer: back to 64k, vLLM restarts; voice, Classify, speech
   to text and the bus off).
2. On the laptop (Open WebUI): attach a 30-page text PDF and ask about its last page; attach a scanned PDF and ask
   about it. Keep the two questions and the PDFs for Q4.

*Expect:* Qwen3.6 at 64k, about 63 at once; both answers use the whole documents (the scanned one read by document
reading); voice, Classify, speech to text and the bus off.
- [ ] Done · Found:

### Q5 LOL Vibe: the coding agent on Qwen3.6, long replies
*Proves:* the model the preset picks as proven with the coding agent does the IDE's tasks as it did on 2026-10-23
(11/15), now with document reading off and its 64 seats.
1. **Apply LOL Vibe** (document reading goes off: vLLM restarts with its 9 GB; the model is Qwen3.6).
2. On the laptop (client v0.2.14+): LOL Vibe ▸ a project ▸ ask the coding agent for a p5.js sketch with three features.
3. (The five agent tasks through the preset, run by an agent: Part 3.)
4. In the vLLM list, **Download** (if it is not downloaded yet) and **Use this** on Gemma 4 12B (a model the IDE has no
   profile of), ask the agent again; then Use this on Qwen3.6 again.

*Expect:* the agent finishes; with Gemma 4 no reply ends cut at 8,192 tokens (the client asks the farm's 32,768); the
vLLM section shows the conversations' memory larger than under Computer; the card: *LOL Vibe · in use · changed: Model:
… → …* after step 4, and back to *in use* once Qwen3.6 serves again.
- [ ] Done · Found:

### Q6 ★ Kept across a farm restart; a change by hand marks it
1. **Apply Balanced**. In the Farm app: Stop the farm, Start it.
2. In the Plugins card, Disable web search. Stop and Start the farm again.
3. Enable web search again.

*Expect:* step 1: after the restart the card still says *Balanced · in use*, the plugins as they were. Step 2: web
search still off after the restart (kept), the card *Balanced · in use · changed* with *Web search: on → off*. Step 3:
*in use* again, without *changed*.
- [ ] Done · Found:

### Q7 Back as it was
1. Put back the settings written down before Q1 (a preset, or by hand in each section).

*Expect:* the farm serves as before the session; the card says which preset matches, or *No preset applied yet*.
- [ ] Done · Found:

---

# After each session

- [ ] Every test of the session is ticked, or its *Found* line says what you saw.
- [ ] Every farm setting a test changed is back (people at once, *Free an idle seat after*, the password, the
  engine), and the plugins you do not want on for users are off (Classify, Speech to text, Message bus, Kokoro): a
  switch is kept across a restart.
- [ ] What failed is written in the DEVLOG, with the test's id.

---

# Part 3 — measurements an agent can run once the owner closes the farm

Benchmarks on the PRO 6000: no person's eyes are needed, only the farm closed to people (the owner says when). An
agent runs them from a checkout and writes the numbers in the DEVLOG and `docs/spike/RESULTS.md`; the owner reads
them. They keep their test ids.

- **J16 steps 1–4** (Part 2): the class through the gate, at 64k (and 128k). Step 5 needs ten laptops.
- **Q4**: Nemotron past 64 people at 64k — the one measurement that could change the Documents preset.
- **Q5 step 3**: the five agent tasks through the LOL Vibe preset.
- **J12 and J13 on llama.cpp**: only if Flint on llama.cpp is ever wanted. Both were done on vLLM 0.33.0 on 2026-11-02
  (Part 4), which serves 5–10× the people llama.cpp does on this card.

### Q4 Nemotron at 64k, past 64 people: the measurement that could make it the Documents pick
*Proves:* whether Nemotron 3.5 Lightning serves clearly more people than Qwen3.6 at 64k on this farm. The spike stopped
at 64 for both (docs/spike/RESULTS.md, headline table): out of step Nemotron and Qwen3.6 both passed 64, so the presets
count Nemotron's 64 against Qwen3.6's 63 as a tie and Documents serves the better model; when everyone starts together
Nemotron passed 16 (at 32 the first turn after the documents loaded missed the 5 s line by 0.15 s, footnote ²) against
Qwen3.6's 48. Nemotron's pool holds about 3× more 64k conversations, so it may well pass far more than 64. A lead of 10 %
or more, once in `farm/src/capacity/measured.json`, makes Nemotron the Documents pick by itself. Here: the farm's own
Automatic memory with document reading beside it, documents appended turn by turn as Open WebUI sends them, up to 128.
*Needs:* farm-v0.0.50+; Q3 done; nobody on the farm (the panel's *Clients* shows no seat in use); 22 GB free for
Nemotron; `$PY` = `farm\.venv\Scripts\python.exe` (it has aiohttp); run from `docs\spike` of a checkout.
1. vLLM section ▸ the list: **Download** Nemotron 3.5 Lightning 30B-A3B · NVFP4, then **Use this** (64k stays). Write
   down people at once and GPU memory for conversations (what Automatic chose), and from vLLM's log the line that says
   how many 64k conversations the pool holds.
2. `$PY spike_bench.py bench --base-url http://127.0.0.1:8100/v1 --label pro6000-farm-nemotron-docs64k --profile followup --prompt-tokens 62000 --rounds 3 --append --levels 8,16,24,32,48,64 --extend 96,128`
3. On the laptop: Q3's two questions, in a new chat, on Nemotron; compare the answers with Qwen3.6's.
4. If time allows: **Use this** on Qwen3.6, step 2 again with the label `pro6000-farm-qwen36-docs64k` (where Qwen3.6
   stops past 64 on the same memory).
5. **Use this** on Qwen3.6 (Documents' pick again); `$PY spike_bench.py summarize results/pro6000-farm-*-docs64k*`.

*Expect:* Nemotron every turn ≥ 16 (the spike: 16–31), out of step ≥ 64, and where it stops between 64 and 128; its
answers about as good as Qwen3.6's (write down any clearly worse: 25–27/28 on the spike's check against 26–28). Write
the numbers down: out of step well past Qwen3.6's (10 % or more) is the case for Nemotron, to weigh against 16 against 48
when everyone asks together; they go into `measured.json` (the presets and the capacity page read it). The card says
*Documents · in use* again after step 5, and a chat answers.
- [ ] Done · Found:

### Q5 step 3 The five agent tasks through the LOL Vibe preset
*Needs:* Q5 step 1 applied (LOL Vibe: Qwen3.6, document reading off); a checkout on the PRO 6000; the farm closed.
1. `node docs\spike\ide\run.js qwen36-vibe http://127.0.0.1:4000/v1 65536 assistant 8192 t1-median,t2-p5,t3-tests,t4-refactor,t5-tdd 1`
   (the farm password, if any, in `LOL_FARM_KEY`), then with `2` and `3` as the last word.

*Expect:* about 11 of 15 tasks pass (`%TEMP%\lol-ide-qwen36-vibe\results.jsonl`), no `max-tokens` end (that was
2026-10-23 at 8,192 a reply, as this step runs; at 32,768 on 2026-11-02 Qwen3.6 got 7/15 on vLLM 0.33.0 and 9/15 on
0.30.0, docs/spike/RESULTS.md *vLLM 0.33.0 and Flint on vLLM*); write down the count.
- [ ] Done · Found:

### J12 (llama.cpp) Flint on the whole GPU: speed and people at once at 32k and 64k, UD-Q4_K_XL and Q8_0
*Proves:* how many people Recursive's Flint serves on llama.cpp when it has the card to itself — the number the
2026-10-23 evaluation could not measure beside the farm's vLLM (docs/spike/RESULTS.md, *Flint*). Flint is in no
llama.cpp list of the farm: this runs from a checkout, not the panel. *Needs:* a quiet moment of about 2 h 30 with vLLM
stopped; a checkout of `main` (the `flint` branch was merged on 2026-10-23) with `shell` built (`npm --prefix shell run
build`) and `farm/.llamacpp` at b11836 (`node -e "require('./farm/src/llamacpp').ensureLlamacpp().then(console.log)"`
from the checkout); ~70 GB free on F:. `$PY` = `farm\.venv\Scripts\python.exe` (it has aiohttp). Run everything from
`docs\spike`.
1. The two files, checked (skip a file that is there and whose hash matches):
   `mkdir F:\lol-flint`, then `curl.exe -L -o F:\lol-flint\flint-UD-Q4_K_XL.gguf https://huggingface.co/unsloth/flint-GGUF/resolve/20468edfc38ab43d6914cc88b08cbecb05d0fc62/flint-UD-Q4_K_XL.gguf`
   and the same for `flint-Q8_0.gguf`; `(Get-FileHash F:\lol-flint\flint-UD-Q4_K_XL.gguf).Hash` must be
   `63C2ECC461CA545134B670C660E76FA20F47240F8D39B6510BFD21C4DD6E072F`, Q8_0's `5DF42B56859C7B5142228005D7D63C327EC9E34C99C72548016D805309A0D284`.
2. Nobody on the farm: the panel's *Clients* shows no seat in use, `capacity.busy` is 0 in `http://127.0.0.1:41997/lol/self`.
   Panel ▸ **vLLM** section ▸ **Stop**. `nvidia-smi`: about 3 GB used (the desktop and document search).
3. Start Flint with the farm's argv, 16 people × 64k in one shared pool:
   `powershell -File serve_llamacpp.ps1 -Model F:\lol-flint\flint-UD-Q4_K_XL.gguf -Parallel 16 -Ctx 1048576 -KvType q8_0 -Bin <checkout>\farm\.llamacpp\bin\llama-server.exe -Log results\logs\pro6000-llamacpp-b11836-flint-q4kxl-p16.log`
   (a second PowerShell; it stays in the foreground). Write down `nvidia-smi`'s memory once it answers on :8190.
4. The suite (label `pro6000-llamacpp-b11836-flint-q4kxl-p16`; Flint has no thinking switch, so no `--thinking`):
   `$PY spike_bench.py quality --base-url http://127.0.0.1:8190/v1 --label <label> --temperature 1.0 --top-p 0.95 --top-k 20 --max-tokens 32768 --concurrency 4`
   `$PY spike_bench.py bench --base-url http://127.0.0.1:8190/v1 --label <label> --profile chat --levels 1,4,8,16 --extend ""`
   `$PY spike_bench.py bench --base-url http://127.0.0.1:8190/v1 --label <label> --profile agent --levels 1,4,8,16 --extend ""`
   `$PY spike_bench.py bench --base-url http://127.0.0.1:8190/v1 --label <label> --profile followup --prompt-tokens 30000 --rounds 3 --append --levels 1,4,8,16 --extend ""`
   `$PY spike_bench.py bench --base-url http://127.0.0.1:8190/v1 --label <label> --profile followup --prompt-tokens 62000 --rounds 3 --append --levels 1,4,8,16 --extend ""`
5. Stop it: `Stop-Process -Id (Get-Content $env:TEMP\lol-spike-llama.pid)`. Steps 3–5 again with `flint-Q8_0.gguf` and the label `…-flint-q8-p16`.
6. Panel ▸ **vLLM** section ▸ **Start**; once it is ready, a chat from a laptop answers.

*Expect:* `$PY spike_bench.py summarize results/pro6000-llamacpp-b11836-flint-*` gives people at once (TTFT p95 < 5 s,
decode p10 ≥ 15 tok/s) for chat, agent, 32k and 64k. Write them beside Qwen3.6 on vLLM (spike: 96 / 48 at 32k / 64k
on every turn) and the spike's llama.cpp ceiling (~600 tok/s aggregate, `--parallel` admits the rest to a queue).
One person, for comparison with the shared-GPU run: 53–55 tok/s with 12 of 47 expert layers on the GPU (9 GB),
TTFT 2.3 s at 3.3k and 12.4 s at 24.8k; on the whole GPU it should be several times faster. The quality gate:
UD-Q4_K_XL scored 27/28 on 2026-10-23 with its experts in RAM (Q8_0: see RESULTS.md); Q8_0 within a point of it means UD-Q4_K_XL is the one to serve.
- [ ] Done · Found:

### J13 (llama.cpp) The coding agent on Flint, whole GPU
*Proves:* the agent's pass count on Flint served by llama.cpp with the whole card (on vLLM it was measured on
2026-11-02, Part 4). *Needs:* J12 (llama.cpp)'s server running (UD-Q4_K_XL, step 3); the coding agent installed in the
client on this box (`%APPDATA%\LlmOnLan\dsh-runtime`).
1. From the checkout: `node docs\spike\ide\run.js flint-fullgpu http://127.0.0.1:8190/v1 65536 assistant 8192 t1-median,t2-p5,t3-tests,t4-refactor,t5-tdd 1`,
   then with `2` and `3` as the last word.
2. The same three with `32768` instead of `8192` (Flint's makers ask for ≥ 32768 tokens a reply; LOL Vibe sends the
   farm's reply limit, 32768 by default, for a model it has no profile of), label `flint-fullgpu-32k`.
3. If time allows, step 2 again with J12's Q8_0 server (label `flint-q8-fullgpu-32k`): the quant in the agent, which
   the shared-GPU run could not settle (the gate scored both 27/28).

*Expect:* each line of `%TEMP%\lol-ide-<label>\results.jsonl` says whether the task's check passed, the steps, tool
calls, failed calls and tokens. 2026-10-23 on the shared GPU: Flint 9/15 at 8192 and 8/10 at 32768 (with the
standing-mode fence rule), Qwen3.6 11/15 (docs/spike/RESULTS.md, *Flint*). Write down the pass counts, the median wall
time per task, and any `max-tokens` end.
- [ ] Done · Found:

---

# Part 4 — done on a real machine, dated, with evidence

What a person, or an agent on a real farm, did; where the evidence is. Each keeps its id, so an old reference still
leads here. A test's full steps as they were: `git show c984cfd:docs/HUMAN_TESTS.md`.

## Tests of this list

### O1 Everything to F:, with a cut in the middle, and the Ollama app pointed there by the farm
*Proves:* Move here copies, checks, switches, and deletes only after; a cut is finished, never trusted; the farm keeps
serving while it copies; the farm sets the Ollama app's Model location itself, only once the copy is checked.
- [x] Done 2026-10-13 (run by the lead with the panel's own routes, farm-v0.0.46 → v0.0.48) · Found: 140 GB to `F:\LlmOnLan` (Ollama 136, gguf 2.5, speech to text 1.6, Classify 0.85); **140.1 GB freed** on C:; the farm pointed the Ollama app at `F:\LlmOnLan\ollama` itself (closed, set, reopened: 10 models listed from F:); the copy ran at ~1 GB/s (2 min 4 s). Two real cuts instead of the planned Stop/Quit — the first move stopped on Classify's link into Hugging Face's shared blobs (fixed in v0.0.47), then v0.0.47 judged its weights damaged by the wrong name (fixed in v0.0.48; the 843 MB copied by hand the same way, checked by sha256) — and each resumed from its journal, nothing deleted without a checked copy. **Not exercised:** a Stop at ~20 %, a Quit at ~50 %, and document reading of a scanned PDF from a laptop.

The scanned PDF is O1b; the Stop and the Quit are dropped (Part 5).

### O2 When the farm cannot set the Ollama app (only if O1 said so)
*Proves:* the 127 GB are deleted only once the Ollama app reads the new folder.
- [x] Not needed 2026-10-13 · Found: O1 set the Ollama app itself; the refusal path stays covered by the unit tests.

### O3 Ubuntu's Linux disk to F:
*Proves:* vLLM works the same after its whole Linux moved; nothing else in Ubuntu is lost.
- [x] Done 2026-10-13 · Found: Ubuntu (452 GB on disk, 421 GB file) to `F:\LlmOnLan\wsl\Ubuntu` in **7 min** (09:17 → 09:23, stopping Ubuntu included); only Ubuntu ran, so all of WSL was not stopped; vLLM started again by itself and answered a chat through the gate in 0.31 s; the registry's BasePath points at F:; the old folder on C: is gone; **C: free 197 → 618 GB**. Not checked by hand: opening `wsl -d Ubuntu` to look at the other projects.

Opening Ubuntu is O1b.

### J11 Qwen3-Omni writes down speech (/v1/audio/transcriptions)
*Proves:* vLLM's own transcription route answers for Qwen3-Omni, for the voice work that may use it later (a curl to
vLLM's relay, outside the farm's gate: a developer's check rather than a person's).
- [x] Done by an agent on the PRO 6000 · Found: 2026-10-09, a scratch vLLM 0.30.0: *works*, 0.12–0.18 s for 7–8 s,
  French and English (DEVLOG 2026-10-09 19:01); 2026-11-02, vLLM 0.33.0: 0.11–0.16 s (DEVLOG 2026-11-02 18:09).

### J12 Flint on the whole GPU: speed and people at once (done on vLLM)
*Proves:* how many people Flint serves when it has the card to itself.
- [x] Done on vLLM 2026-11-02 (branch `vllm-033`, by Claude Code, the farm closed by the owner) · Found: Flint's NVFP4
  GGUF on vLLM 0.33.0 with the whole GPU: one person 252 tok/s; chat 64 / ≥ 128, agent ≥ 128 / ≥ 128, **40 people at
  32k and 20 at 64k** (its memory: bf16 context only); the gate 25/28 three times (docs/spike/RESULTS.md, *vLLM 0.33.0
  and Flint on vLLM*). The llama.cpp steps were not run: on this card vLLM serves 5–10× the people llama.cpp does
  (they are in Part 3, if ever wanted).

### J13 The coding agent on Flint, whole GPU, against Qwen3.6 (done on vLLM)
*Proves:* whether Flint is the IDE agent's model on this box (the main question of 2026-10-23).
- [x] Done on vLLM 2026-11-02 (branch `vllm-033`) · Found: the five tasks × 3 at 32,768 through a scratch farm: **Flint
  13/15** (39 s a task, the farm's open-think template; 12/15 with Flint's own), **Qwen3.6 7/15 on vLLM 0.33.0 and
  9/15 on 0.30.0** the same day (15–16 s); no `max-tokens` end. The owner then added Flint to LOL Vibe's proven list
  (DEVLOG 2026-11-03 09:23). Still for a person: J15. Flint on llama.cpp: Part 3.

## Seen on a real machine, not a test of this list

- **The Farm app's update chain on the PRO 6000, 2026-10-13** (DEVLOG 08:54, 09:09, 09:24): farm-v0.0.45 → 0.0.46 →
  0.0.47 → 0.0.48, installed over each other; each refreshed its farm code and came up healthy on vLLM. K1 and K2 are
  still to do (see their *Was:* lines).
- **A running vLLM adopted after the Farm app ended at once, 2026-10-13** (DEVLOG 09:24): `Stop-Process` ended the Farm
  app instead of its Quit; vLLM kept running, and farm-v0.0.48 adopted it at its start (busy cleared at once, no
  reload): the designed crash path, on the real box.
- **vLLM run by the farm in production since about 2026-10-12** (DEVLOG 2026-10-12 16:20: production's vLLM idle with
  48 seats; 2026-10-13 08:54: farm-v0.0.46 came up healthy on vLLM).

## Done between 2026-09 and 2026-10-09 (verified on a real farm or real hardware)

- The CI installers for every platform (release v0.2.9, DEVLOG 2026-10-08 07:08); the Open WebUI pin bump with no LOL
  code change (0.11.4, DEVLOG 2026-09-27); a client reaching a shared Farm app (2026-09-03, production since).
- Home Assistant's ask, dry run, allow and agent (TEST_SCENARIOS 7c.2, 7c.3, 7c.4, 7c.7) on the demo home (DEVLOG
  2026-09-30). The real home is H.
- A Computer program on the first try (the owner, 2026-09-23); Code on a real graph (every ? example run on qwen3.8,
  NIGHT_LOG 2026-09-28 00:36); the debug log's file where the guide says (NIGHT_REPORT 2026-09-25).
- COMPUTER_PLAN §13 items 8, 12, 13, 15, 16, 18, 19, 28, 32, 33: proven by the harness, not a person's check.
- Partly done, the rest kept: the agents' real runs of the IDE (G's intro), the Agent box and lessons 5, 11, 12
  (A9, A11), Stop at the engines (D2), the packaged build loading LOL Vibe (A1).

## The ticked lines of RIG_CHECKLIST, word for word

From [archive/testing/RIG_CHECKLIST.md](archive/testing/RIG_CHECKLIST.md). Its own words: "verified **single-machine on
the dev box**", so most of these are one-machine or unit checks, not the two-machine or real-installer runs above. The
date in brackets is when git last wrote the line (`git blame`); a date inside a line is the check's own.

*Discovery (two machines, real Wi-Fi)*
- [x] Beacon sent by the farm + received by a listener on the same host (UDP loopback/broadcast). *(2026-06-29)*
- [x] `/lol/self` unicast endpoint returns the snapshot. *(2026-06-29)*
- [x] Shell auto-connects to a beacon-discovered farm with no URL typed (single host). *(2026-06-29)*

*Farm robustness*
- [x] `lol up` → `/v1/models` + a real `/v1/chat/completions` (LiteLLM → Ollama → gemma4). *(2026-06-29)*
- [x] `lol status` / `lol down` from a second shell; clean intentional-stop. *(2026-06-29)*
- [x] **Failover:** two Ollama hosts (`:11434` + a 2nd on `:11435`) serving gemma4 → load-balanced
      (both loaded; 8/8). Killing one mid-operation → **10/10** completions still succeed after tuning the
      router (`num_retries:3`, `allowed_fails:1`, `cooldown_time:60`). Size by concurrent in-flight generations,
      not headcount. *(Multi-physical-box still worth a real-LAN run; here both Ollamas were on one box.)* *(2026-06-30)*

*Open WebUI integration (re-verify per pin — see INTEGRATION_BRIEF §7)*
- [x] OWUI boots with the privacy env; `/health` true; **local** MiniLM embeddings load in-process.
      *(Verified at 0.10.1; the pin is 0.11.4 since 2026-09-27; re-verify pin-sensitive checks at each bump.)* *(2026-07-05;
      the pin note 2026-11-05)*
- [x] All user data (webui.db, `vector_db/chroma.sqlite3`, uploads) lands under the local `DATA_DIR`. *(2026-06-29)*
- [x] Auto-admin under `WEBUI_AUTH=false`; `get_all_models()` runs against the farm endpoint. *(2026-06-29)*
- [x] **A full chat through the OWUI UI** end-to-end (Playwright drove a real chat → streamed gemma4
      response "Local Area Network"; `ENABLE_OLLAMA_API=false` so the farm is the only inference path).
      *In the Electron-embedded webview specifically: still worth a manual click-through, but it's the same
      OWUI instance + URL the shell embeds.* *(2026-06-30)*
- [x] **Document-locality RAG test:** uploaded a doc with a canary phrase → it embedded into the **local**
      `vector_db/chroma.sqlite3` (canary found there) and the farm logged **ZERO `/v1/embeddings`** — the
      doc text never left the device; only chat completions reached the farm. *(2026-06-30; history since document
      search, 2026-10-08: a folder on the farm's document search sends document text to it, I3)*

*Data-folder change (M4)*
- [x] `moveDataDir`/`copyDataDir` unit-tested (9/9: copy, nested, src-removed, refuse-nested, empty-src). *(2026-06-29)*
- [x] **All data in DATA_DIR (2026-09-27):** `clientData.ts` unit-tested in `shell-main` (the v0.1.x import,
      the boot-time move with its staging folder, refusals, failures, the settings marker on disk, the
      writability fallback, the stale-legacy warning); the chat harness runs every scenario on
      `session.fromPath(<DATA_DIR>/lol-client)` and `h1-data-dir` finds a saved thread's bytes under
      `<DATA_DIR>/lol-client/IndexedDB` and nothing under `<userData>/IndexedDB`. A scratch Electron 42 probe
      confirmed a v0.1.x-shaped default-session profile (IndexedDB + a 300 KB blob + localStorage keys)
      copied before `ready` reads back whole in the `fromPath` session, and that
      `<webview partition="persist:owui">` still resolves to `userData/Partitions/owui`. *(2026-09-27)*

*Packaging + auto-update (CI + real OSes) — the upgrade test*
- [x] `electron-builder --dir` packs a real `LlmOnLan.exe` (~100 MB, **no sidecar bundled**); the sidecar
      is downloaded to `userData/sidecar` on first run from the release's
      `owui-sidecar-<platform>-<arch>.tar.gz` asset (`sidecarManager.ts`). *(2026-07-05)*
- [x] **Full installers** built by CI on a `v*` tag, every platform with its `owui-sidecar-*` (verified: release v0.2.9, 27 assets, DEVLOG 2026-10-08 07:08; the Intel-Mac sidecar job since v0.2.0). *(2026-10-09)*
- [x] **The upgrade test** (bump the pin, nothing else changes) (verified: Open WebUI 0.11.4, "pin bump, no LOL code change", DEVLOG 2026-09-27 evening; 0.10.1 → 0.10.2 on 2026-07-01). *(2026-10-09)*

*Farm app install*
- [x] Dev boot: `npm run dev` opens the window to the welcome screen with no crashes (env
      `ELECTRON_RUN_AS_NODE` unset; `node node_modules/electron/install.js` if the binary postinstall was skipped). *(2026-07-05)*
- [x] **A client connects** with sharing on (verified: 2026-09-03, and the production farm since, DEVLOG 2026-10-07 17:48). *(2026-10-09)*

---

# Part 5 — what was dropped, and why

About 460 items were collected on 2026-10-09 from: TEST_SCENARIOS_v0.2.md (113, §1–§8), RIG_CHECKLIST.md (46 open),
LOLCHAT_RIG_CHECKLIST.md (200 open), LOLCHAT_STUDIO_PLAN.md §5 (18), LOLCHAT_TESTING.md §4 (5), COMPUTER_PLAN.md §13
(40), COMPUTER_STATUS.md "What only you can check" (13), VLLM_MANAGED_PLAN.md §9.6/§11.5/§11.6 (12),
EMBEDDINGS_STUDY.md "What to test" (6), HOME_ASSISTANT.md "Not tried yet" (3), IDE_PLAN.md (1) and the DEVLOG's
not-done lines (5 new). About 20 were dropped as done, about 67 as superseded or never shipped, 5 are a developer's
checks, and about 365 are kept above, merged into 99 tests. CLAUDE.md's "Still needs real … verification" paragraph
named nothing the lists did not. The four old lists are in [archive/testing/](archive/testing/) since 2026-11-05; the
plans in [archive/plans/](archive/plans/). What was done is in Part 4.

**Superseded:**
- **LOL Vibe features never built** (P3, P4): images, documents and web search in LOL Vibe (LOLCHAT_RIG §5, 11 items),
  Blender cards (§6, 8), recipes and structured output (§9, 6), Read aloud, the queue chip. Open WebUI covers the
  first three.
- **Redesigned:** LOL Vibe's history moved into the data folder on 2026-09-27, so the rollback-and-merge steps
  (LOLCHAT_RIG §1, 3 items) and "a data-folder move leaves history behind" (§1, §11, §12: 3 items) no longer apply;
  the Computer became its own surface (From/To thread, the value inspector beside the conversation, Send to the
  Computer, a file dropped beside the composer, an export from a From thread part: 5 items).
- **The privacy rule changed** (document search, 2026-10-08): "zero `/v1/embeddings`" (LOLCHAT_RIG §11) is replaced by
  I3.
- **The farm moved on:** the Farm app updates to farm-v0.0.39 and 0.0.42 (1.3, 7d.9) and 0.0.43 (7e.1) become K1; the
  operator-run vLLM on the PRO 6000 (7d.16, done 2026-10-07 17:48, then replaced); the production take-over (7e.8,
  VLLM_MANAGED_PLAN §9.6 and §11.5's first half): the clean-state run of 2026-10-08 stopped the operator-run vLLM and
  removed its log-on task, and the take-over was rehearsed on the PRO 6000 with a scratch farm (2026-10-08 02:24, step
  9); the Spark recipe (7d.17) and the GB10 clock (7d.18) are steps of L2; an external vLLM killed mid-run
  (RIG_CHECKLIST) is the farm's own watch now (live test step 7); the upgrade from farm-v0.0.1 (shared → private).
- **O1's deliberate Stop at ~20 % and Quit at ~50 %** (2026-11-05): two real cuts resumed from the journal on
  2026-10-13 (Part 4), the panel's Stop is unit-tested (`farm/test/run.js` asserts *Stopped. Nothing was switched*),
  and a farm killed in the middle of a 3 GB file resumed with a matching sha256 (DEVLOG 2026-10-12 11:57).
- **Merged duplicates:** 1.6 into C3 (with 7d.1); 2.3 and 2.4 into D14 (7d.15's expected results); I6 (7f.6) into D14
  step 2 (2026-11-05), with D13 for a laptop without the password.
- **The laptop-side embedding switch** (EMBEDDINGS_STUDY "What to test", 6 items): the owner chose the farm instead; I
  tests it.
- **Not shipped:** a no-Open-WebUI build (COMPUTER_PLAN item 5); the per-thread graph migration's delete check (item
  7); the *Critique loop* template (item 37); the Studio's map, sketch and board benches (LOLCHAT_STUDIO_PLAN §5
  S-R6–S-R15: S1–S3 were never built, the Computer and the IDE took their place).

**A developer's checks, not a person's:** `e2e.js` on a box with no client (LOLCHAT_RIG §0), which rung of the ask spine
gemma4 needs (§12), the strict harness flake (§12.1), the harness run itself (COMPUTER_PLAN item 34), the security
review of the projects API (LOLCHAT_STUDIO_PLAN S-R1), and reading the pinned Open WebUI's source for `--port` and the
OpenAI env at each pin bump (RIG_CHECKLIST). Qwen3-Omni's own `/v1/audio/transcriptions` (J11) was one too: an agent did
it twice (Part 4).

---

# Questions for the owner

Open (they keep their numbers; the next-work list, [plans/README.md](plans/README.md), may carry them too):

- **1.** **LOL Vibe's sentence while vLLM starts.** A 503 from a farm whose model is starting reads *"…it may be
   restarting. Try again in a few seconds."* (`strings/net.en.mjs` `upstreamDownBody`), while Open WebUI is told
   *about 2 minutes* (J2). Known since 2026-10-08 03:57, unchanged. Give the farm's real wait, or keep it?
- **3.** **The search-model checks of v0.2.9 (B3–B5) now apply only to a data folder that never met document search.** A
   fresh laptop on an NVIDIA farm never loads MiniLM (I2). Are B3–B5 still worth a session, or only I5?
- **4.** **"≈ 362.7 million" (Île-de-France, A9):** no doc or result file records it. Confirm the number, or drop it?
- **5.** **The coding agent's model line rates Qwen3.6 *unknown* and does not know Flint**, though the farm's LOL Vibe preset
   calls both proven (Qwen3.6 7 to 11 of 15 agent tasks, Flint 13/15). It reads *Nobody has tried … on code edits yet*
   (G2, J15). Mark both good at edits in `projects/models.mjs` (Flint needs an entry that keeps the farm's reply limit,
   not 8192)? And should the weak-model sentence name what the farm serves instead of *qwen3.8 or nemotron*?
- **10.** **The ★ list** (proposed 2026-11-05, at the top): is it right? Does a ★ test still block the next release, or does
    ★ now only mean "run first"?
- **11.** **The build for the fixes of 2026-11-05** (A21, C7, D16, G13, K11): a local build (`npm run dist`) or a
    pre-release tag on GitHub?
- **12.** **J1:** how did vLLM get into `~/lol-vllm` on the PRO 6000, between DEVLOG 2026-10-09 19:01 and 2026-10-12 16:20?
    If it was the panel's **Install vLLM**, J1 is ticked with the date; if not, "install from nothing" goes to K6.
- **13.** **Which Farm app runs on the PRO 6000 now?** The last one recorded is farm-v0.0.48 (DEVLOG 2026-10-23 16:55).
- **14.** **C3:** what does your own client's Preferences ▸ About show? With Open WebUI still 0.10.2, C3 runs on it;
    otherwise on v0.1.45 on a spare profile.
- **15.** **J12–J13 on llama.cpp (Part 3):** still wanted, now that vLLM serves Flint to 5–10× more people on this card?
- **16.** **Open in the DEVLOG:** speech to text on by default on NVIDIA; Qwen3-Omni as the transcriber; how many seats for
    Omni; vLLM on a 16 GB card for Gemma 4 (K5: offered only with document reading and document search off) (2026-10-10
    19:08). Whether a calendar's event descriptions may go to a model; whether the home templates' made-up ids become
    the Green's real ones once it is linked (2026-10-09 11:44). Which licence governs Flint's weights: its GGUF says
    `flint-preview`, its card Apache 2.0 (2026-11-03 09:23).

Answered:

- **2.** ~~**The Plugins switches do not last across a farm restart**~~ — **answered 2026-10-27** (DEVLOG 10:08): a switch is
   written to the config once the plugin came up or stopped, and kept (farm-v0.0.50). Q6 checks it.
- **6.** ~~**`project.json` may not be protected from the coding agent**~~ — **fixed 2026-10-09** (DEVLOG 10:59): it was
   true, and `.git/config` (the remote a person's Push sends to) was open too. The fence now refuses a write or edit
   to `project.json` or anything under `.git/`; reading stays allowed. Nothing for a person to decide (G12 checks it).
- **7.** ~~**The vLLM line's number on a small card** (K5) was written as *about 35 GB*~~ — **settled 2026-11-05 by the
   code**: K5 now says what the panel computes (about 27 GB with document reading and document search on: Gemma 4 12B,
   the smallest model, joined the list in farm-v0.0.45).
- **8.** ~~**Candidate builds for the ★ tests:** a local build, or a pre-release tag~~ — **moot since 2026-10-09**: that
   release went out, and its ★ tests run on the published releases. The builds for the fixes of 2026-11-05 are a new
   question (11).
- **9.** ~~**Model storage (O)**~~ — **answered by the owner, 2026-10-12:** (a) the farm sets the Ollama app's Model location
   itself (after the copy is checked; the app restarts; the old value comes back on a failure); (b) stopping all of WSL
   is acceptable after the second, named question; (c) Classify's and the voice's models move into the folder too; and
   the folder is the source of truth (what is in it is in the lists; the WSL disk offered under it). Built: DEVLOG
   2026-10-12.
