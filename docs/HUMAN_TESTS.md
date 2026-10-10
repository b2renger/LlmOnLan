# Human tests — the one list

Every check a **person** still has to do with LlmOnLan, gathered on 2026-10-09 from eleven older lists and the DEVLOG's
"not done, the owner's" lines. Each test says what it proves, what it needs, the steps, and what you should see. Tick
the box when it holds; write what you saw on the *Found* line when it does not (or when the test asks you to note a
number). Where a test came from is on its *Was:* line, so an old reference can be followed here.

**What is already tested without you** (and so is not here): the unit tests, the chat harness on a mock farm, the
farm's vLLM lifecycle against a stand-in vLLM, and the agents' runs on a real farm recorded in
[DEVLOG.md](DEVLOG.md) and the night logs. What is left is what needs a person's hands, eyes, devices, a second
machine, an installer or a reboot. The section at the end lists what was dropped, and why.

**How the list is ordered.** Sessions are grouped by setup, so one sitting needs one set of machines. The client comes
first (A–I), then the farm side a client test needs (J–N). Inside a session the most valuable or riskiest test comes
first.

**★ blocks the next release** (Farm app farm-v0.0.44 + client v0.2.10: the update's file-by-file copy, the vLLM
card, llama.cpp b11512, document search; DEVLOG 2026-10-09 "Releases wait"). Everything else is for later.
- A ★ test runs on the **candidate builds** of `multiuser-phase0` (an installer built from it, e.g. `npm run dist` in
  `shell/` and `farm-app/`), except C1, which needs the published release's update feed: run C1 right after
  publishing, before telling anyone.
- **Owner's call:** whether the candidate is a local build or a pre-release tag on GitHub.

**Machines this list names.** The studio's RTX PRO 6000 box (production farm); a Windows test box with an RTX card
(not production), ideally also the RTX 4070 (12 GB) and 4080 (16 GB) boxes; a DGX Spark; one or two Windows
laptops (one fresh); an Apple Silicon Mac, an Intel Mac, a Linux x64 PC; the office's Home Assistant Green. Never run
a test that sets one seat, kills an engine or restarts the farm on production while people use it.

## Sessions at a glance

| Session | Setup | Tests | ★ | Time |
|---|---|---|---|---|
| A. One laptop + the PRO 6000, installed builds | 1 laptop, the production farm | 17 | A1 | A1 1 h; the rest 7–8 h in several sittings |
| B. A fresh laptop, first install, no internet | a laptop never used, a blocked network, a proxy network | 6 | B1 | 2 h |
| C. Upgrades and the data folder | a v0.2.9 laptop, the owner's v0.2.7 client, a spare profile, a USB stick | 6 | C1, C2 | 2.5 h |
| D. Two machines, two farms, other subnets | 2 laptops, a second farm, a guest Wi-Fi | 15 | — | 4 h |
| E. Mac and Linux clients | Apple Silicon + Intel Mac, a Linux PC | 4 | — | 3 h |
| F. The Computer's devices | mic, webcam, speakers, OSC tool, Art-Net light, Arduino/ESP32 | 7 | — | 4 h |
| G. LOL Vibe's IDE | 1 laptop, a password farm, a GitHub account | 10 | — | 2.5 h |
| H. Home Assistant on a real home | the office's Home Assistant Green | 4 | — | 2.5 h |
| I. Document search on the farm | the farm, 2 laptops (one with old documents) | 7 | I1–I5 | 2 h |
| J. The PRO 6000 (production, vLLM) | the PRO 6000 at a quiet moment, a client | 10 | J1–J4 | 4.5 h (+45 min install, +1 h for J9's 70 GB) |
| K. A Windows test box with an RTX card | a non-production RTX PC, the 4070/4080, a PC with no NVIDIA GPU | 7 | K1–K5 | 3.5 h (+45 min K6) |
| L. The DGX Spark | a Spark with a screen | 3 | — | 3 h (+45 min) |
| M. Reboot tests | the PRO 6000, the Spark | 2 | — | 1 h each |
| N. The Farm app on a clean box | a PC with no Ollama or Python, a Mac | 5 | — | 2 h + downloads |
| **Total** | | **103** | **18** | about 48–53 h |

**The release, in order:** K1–K5 on the test box first (the Farm app update, the held-file copy, llama.cpp b11512,
document search's first start, the small cards), then J1–J4 on the PRO 6000, then I1–I5 and A1, B1 with the
candidate client, then C1–C2 right after publishing.

---

# Part 1 — the client

## A. One laptop and the PRO 6000 farm, installed builds — about 1 h for A1, then 7–8 h over several sittings

**Machine:** one Windows laptop with the installed client, on the office network; the PRO 6000 farm (Qwen3.6 on vLLM,
or Ollama while J is not done); for A8 the farm's **Classify** plugin on (it stays on only until the farm restarts).
**Build:** client v0.2.10 for A1; any installed v0.2.x for the rest (write the version on each test). Never use a
dev run on the owner's real profile (LOLCHAT_TESTING §1). These are quiet-farm checks: one person's load.

**Part A-1: the release on one laptop**

### A1 ★ The release, end to end
*Proves:* the installed v0.2.10 does everything a person does on day one. *Was:* 1.4, 7.1, 7.2, 7d.11's "everything
still works" list, LOLCHAT_RIG §1 (C-21, the packaged build loads the modules).
1. Open Open WebUI: a chat (and its title appears), a PDF attached and asked about, the globe on for one question.
2. LOL Vibe: a chat; a long answer stopped with **Stop**.
3. The Computer: Text → Instruction, ▶.
4. Open WebUI ▸ a new chat ▸ Integrations ▸ Tools: **LlmOnLan Computer** on; *"On my Computer, create a graph called
   Test with a note that says hello, then run it."* Switch to the Computer.
5. Preferences ▸ About.

*Expect:* every step answers; LOL Vibe shows its UI (no *LOL Vibe failed to load* line, no *Part of LOL Vibe failed to
load* banner); Stop ends the reply at once; the graph *Test* is in the library with its note, and has run; About shows
v0.2.10 and Open WebUI 0.11.4.
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

*Expect:* Classify, Speech to text and Message bus off; Document search on (NVIDIA). The farm keeps answering during
the install; Classify healthy once ready. Each headline gets a label and a confidence; unsure ones under *check*. Read
the news ends in a bar chart: off, the footer says *0 by Laya*; on, most *by Laya*; no digit written by the model in
the title/subtitle/insight (they show *…*).
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
- [ ] *Write an SVG* → an SVG box, and *Write a p5.js sketch* → a p5.js box, on the farm's default and on gemma4:12b
  (the box's Model menu): lands clean and draws. An SVG box → *Describe a picture*: the model describes it.
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
2. Run *Analyse a dataset* and *Read the news* with Qwen3.6, then gemma4:12b (each Instruction's model picker).

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

## B. A fresh laptop: first install, first start, no internet — about 2 h

**Machine:** a Windows laptop that never had LlmOnLan (or a spare Windows user account: the profile must be empty),
on the office network; a way to block huggingface.co (a hosts-file line `0.0.0.0 huggingface.co`, or a network that
reaches the farm but not the internet); for B4, a network that reaches the internet only through a proxy set in the
system settings. **Build:** the client v0.2.10 installer from GitHub Releases. **Farm:** for B3–B5 one **without**
document search (a farm on a PC with no NVIDIA GPU, or Document search off in its Plugins card): with document
search, a fresh folder never loads the search model at all (I2).

### B1 ★ Install and first start
*Proves:* "install one app → chatting in seconds" from a clean machine. *Was:* RIG_CHECKLIST "First-run downloads"
and the SmartScreen line; LOLCHAT_RIG §1 "Laptop B, fresh install", "(P0 store)" mode.
1. Download and run the installer. Note what Windows says (SmartScreen: *More info ▸ Run anyway*).
2. Open the app. Time the first start: the engine download (a few hundred MB to `userData/sidecar`), then Open WebUI.
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
1. Use Open WebUI's microphone once (Whisper downloads to `DATA_DIR/cache/whisper/models`).
2. Unplug the internet (keep the farm), relaunch.

*Expect:* the chat opens in about 12 s, no hub wait. (In a dev run the sidecar env shows `HF_HUB_OFFLINE=1`.)
- [ ] Done · Found:

## C. Upgrades from an older client, and the data folder — about 2.5 h

**Machines:** a Windows laptop on v0.2.9 (the update the release ships); the owner's own client, still v0.2.7 with
Open WebUI 0.10.2 (DEVLOG 2026-10-07 18:18: the engine only updates from About); for C5 a spare Windows profile; for
C6 a USB stick and a second drive. **Build:** the v0.2.10 release (an update test needs the real release feed).

### C1 ★ The auto-update to v0.2.10
*Proves:* installed clients reach the release by themselves. *Was:* 1.1, RIG_CHECKLIST "Auto-update cycle" (never
logged for v0.2.x), NIGHT_LOG 2026-09-28 "the auto-update … on each OS".
1. On v0.2.9: Preferences ▸ Startup & updates ▸ **Check for app updates** ▸ **Restart & install**.
2. Preferences ▸ About; open LOL Vibe, the Computer, Open WebUI.

*Expect:* silent, no administrator prompt; it restarts as v0.2.10; LOL Vibe's threads, the Computer's graphs and Open
WebUI's chats are all there; Data location says everything lives in that folder. Then on a farm with document search,
I1's message (once).
- [ ] Done · Found:

### C2 ★ Open WebUI starts once after the update
*Proves:* the farm context saved, one start, a page reloads when its farm comes back. *Was:* 7e.10.
1. On the updated laptop that found its farm before: quit and reopen; read `boot.log`.
2. Stop the farm (or unplug the laptop from it), reopen the client: Open WebUI lists no model. Bring the farm back.

*Expect:* the chat in about 12 s; boot.log ends with one `starting` and one `ready`, each with the farm's address, no
`restarting`. A few seconds after the pill turns green, Open WebUI reloads once by itself and lists the model.
- [ ] Done · Found:

### C3 The owner's v0.2.7 client: web search, the date line, the engine update
*Proves:* the one-time changes of v0.2.8 on a real profile, and the engine update from About. *Was:* 1.6, 7d.1, 7d.2,
1.4, RIG_CHECKLIST "Chat-engine update on Windows" (SA-6).
1. Before updating, note Open WebUI's Settings ▸ General ▸ **System Prompt** (empty or yours) and whether new chats
   have the globe on. Update to v0.2.10 and open it.
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
2. Let it update to v0.2.10 (or install over it) and open. Switch to LOL Vibe.
3. Relaunch. Settings (gear, bottom of LOL Vibe's sidebar) ▸ Storage. DevTools ▸ Application ▸ IndexedDB ▸ `lol-chat`.
4. Import an old `.lolchat.json` export. Uninstall and reinstall v0.2.10.
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

## D. Two machines, two farms, another subnet, Wi-Fi — about 4 h

**Machines:** two client laptops (A and B), the production farm, a second farm (the 4070 box or the Spark), a
network with client isolation (a guest Wi-Fi), and a laptop on the other office subnet (10.10.16.x ↔ 10.10.17.x:
beacons do not cross it). **Build:** client v0.2.10 on both laptops, farm-v0.0.44. Several tests set one seat on a
farm: do them on the second farm, never on production while people use it.

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
differs); the version is the Farm app's (e.g. `farm v0.0.44`), not `0.1.0`.
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
*Proves:* plugin keys stay across a restart and change with the password. *Was:* 7d.15, 2.3, 2.4 (rewritten: a panel
plugin switch lasts only until a farm restart, DEVLOG 2026-10-08 06:18).
1. On a farm with no password, note `extract.key` in `http://<farm>:41997/lol/self`. Restart the farm (Stop, Start).
2. Set a password ▸ Apply changes. After the restart read `/lol/self`; give the laptop the password; attach a PDF.
3. `curl -i -X PUT http://<farm>:8890/process -H "Authorization: Bearer <old key>" --data-binary @notes.txt`.
4. Restart again; then change the password.

*Expect:* 1: the same key, no client's Open WebUI restarts, and within ~30 s clients read PDFs again (OCR; a plugin
turned on in the panel, e.g. Classify, is off again after the restart). 2: `extract.key` is `null`, `extract.keyId`
is new; the laptop asks for the password once, then OCR, document search, Classify and Listen work. 3: **401**. 4: the
same `keyId`; after the password change a new one.
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

## E. Mac and Linux clients — about 3 h

**Machines:** an Apple Silicon Mac, an Intel Mac on macOS 14 or later, a Linux x64 PC (and the Spark as a linux-arm64
client, if handy). **Build:** the v0.2.10 installers, and the previous release installed first for the update.

### E1 macOS: install, first run, update
*Proves:* the ad-hoc signed app installs, runs and updates itself. *Was:* RIG_CHECKLIST "Auto-update cycle" (the mac
retest after the keep-warm fix was never logged, 2026-09-02), "Intel Mac", 1.1.
1. Install v0.2.9 from the dmg (right-click ▸ Open the first time). First run: the engine download, a chat.
2. Check for app updates ▸ Restart & install.
3. The same first run on the Intel Mac: attach a document in Open WebUI (on a farm without document search, the
   local search model runs here).

*Expect:* Gatekeeper's gentler prompt only; chat works; the update installs and restarts as v0.2.10. Intel: the
darwin-x64 engine downloads, local embeddings and a chat work (torch 2.2.2 there is the thing to watch).
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
1. Run the x64 AppImage (and the arm64 one on the Spark). Chat in Open WebUI and LOL Vibe (A2's first check); ask
   LOL Vibe for a long answer and quit mid-stream (X ▸ Quit), reopen. Do the same LOL Vibe checks on both Macs (E1).
   A long reply while another app has focus: one notification (Notification Center / the Linux desktop's).
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
reads fine. Web search results are paragraphs, not one-liners.
- [ ] Done · Found:

## F. The Computer's devices: microphone, camera, speakers, lights, boards, the message bus — about 4 h

**Machines:** one laptop with a microphone, a webcam and speakers; TouchDesigner or Max (or any OSC receiver on UDP
9000); an Art-Net node with one DMX light; an Arduino Uno/Nano or an ESP32 with a USB **data** cable, an LED and a
light sensor, the Arduino IDE; `mosquitto_sub` on a PC. **Farm:** the PRO 6000 with **Speech to text**, **Kokoro TTS**
and **Message bus** turned on in its Plugins card (they stay on only until the farm restarts: turn them on again after
any restart, and off at the end). **Build:** client v0.2.10. None of this ever ran on real devices: the sketches were
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

## G. LOL Vibe's IDE — the coding agent — about 2.5 h

**Machine:** one laptop with the installed client, the PRO 6000 farm (Qwen3.6 on vLLM) or a farm serving qwen3.8; a
farm with a password for G7; a GitHub account for G9. **Build:** client v0.2.10. Already checked for real by the
agents with qwen3.8 (DEVLOG 2026-09-28/29/30, NIGHT_LOG_2026-09-28): the install from the release, a project, a build
and an edit, the fence on Windows, History's Go back, graphify's graph.json, a Keep-going goal and a one-point-per-round
loop, a schedule's runs, Use the Computer's Room monitor, an agent page (dice coach). What is left is what only a
person sees, and the installed build. **Note:** the farm now serves Qwen3.6, which the model line does not know: it
reads *Nobody has tried Qwen3.6 on code edits yet* (write down how the agent does with it).

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
1. Pick another model the farm serves (gemma4:12b, or qwen3.8 on another farm) and ask for a small change.

*Expect:* it works (the agent restarts on that model); gemma4: the model line warns it is weak at edits.
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

## H. Home Assistant on a real home — about 2.5 h

**Machines:** one laptop, the office's Home Assistant Green with real devices (a light, a sensor, a window or blind
if there is one, ideally a lock), a farm serving a tool-calling model (Qwen3.6 on vLLM or qwen3.8). **Build:** client
v0.2.10. Already checked without you: every 7c step against the private **demo** home in WSL (DEVLOG 2026-09-30,
"Verified on the rig", and docs/HOME_ASSISTANT.md, "A private test home"). Not tried: a real Home Assistant with real
devices, speaking the request, and a schedule driving the home. The Computer's Home boxes, lessons 13–14 and the three home
templates (2026-10-09) are H4.

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

*Expect:* the words appear (speech to text on this laptop), then the same answer as H1 step 2.
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

## I. Document search on the farm — about 2 h ★

**Machines:** the farm with Document search on (the PRO 6000, or the K test box) and a second farm, or the same
farm with the plugin switched off; two laptops, one with an older client and a knowledge base. **Build:** client
v0.2.10 + farm-v0.0.44. **Careful:** a data folder that meets document search switches to it **for good**. Use a
laptop whose data folder you can spare, or move it first in Preferences ▸ Data location. Already checked without you:
the plugin alone with an official llama.cpp b11512, and the built Open WebUI 0.11.4 indexing and searching a French
text through it (DEVLOG 2026-10-08 21:57).

### I1 ★ A laptop that had documents
*Proves:* the move from MiniLM: told once, Reindex works across languages. *Was:* 7f.2.
1. On a laptop that used an older farm, with a knowledge base holding a French PDF, update to v0.2.10 and connect.
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

### I5 ★ A laptop that never met document search still uses MiniLM
*Proves:* v0.2.10 kept the old path for folders that have not switched (B3–B5 now only apply to
them). *Was:* new (the MiniLM path changed with document search, DEVLOG 2026-10-08 21:57 "MiniLM").
1. A fresh data folder (Preferences ▸ Data location ▸ Start fresh) on a farm with Document search **off** (a farm
   without an NVIDIA GPU, or the switch off). Attach a PDF.

*Expect:* MiniLM downloads (about 92 MB) at the start, the PDF is answered, and no `lol-embedding.json` is written.
Then connect that folder to a farm with document search: it switches (I1's message only if it had documents).
- [ ] Done · Found:

### I6 With a farm password
*Proves:* the plugin's key follows the farm password. *Was:* 7f.6.
1. Set a password in the panel, restart the farm, enter it on the laptop; upload.
2. A second laptop without the password.

*Expect:* uploads are indexed; the second laptop's farm card asks for the password.
- [ ] Done · Found:

### I7 Many uploads at once
*Proves:* the plugin holds a class. *Was:* 7f.8 (J4 does it beside vLLM).
1. Ten laptops upload at once.

*Expect:* each is indexed (write down the times); farm.log has no line per piece of text (only the plugin's start and
any warning).
- [ ] Done · Found:

---

# Part 2 — the farm side a client test needs

These sessions are for the Farm app and its engines. They come after the client sessions because the owner asked for
the client first, but the ★ ones block the same release.

## J. The studio's PRO 6000 (production, vLLM run by the farm) — about 3.5 h (+45 min for the install), at a quiet moment

**Machine:** the RTX PRO 6000 box. **Last recorded state (DEVLOG 2026-10-08 14:05):** the clean-state run began: a fresh Farm
app farm-v0.0.43 on Ollama, the old operator-run vLLM stopped, its logon task removed, the old data folder kept as
`%APPDATA%\LlmOnLan Farm.before-clean-2026-10-08`, `~/lol-spike` parked; vLLM not installed by the panel yet.
**Build:** farm-v0.0.44 (the vLLM card scrolls into view; the update's file-by-file copy; llama.cpp b11512; document
search). **Also:** one client laptop on v0.2.10 beside it. Put back every setting a test changes.

### J1 ★ The vLLM card opens in view, and installs from nothing
*Proves:* an operator can install vLLM from the panel alone (the owner's "I cannot click the vLLM button").
*Was:* the clean-state run (DEVLOG 2026-10-08 14:05), 7e.3 on this box.
1. Panel ▸ Backend ▸ **vLLM**.
2. Read the checklist. Press **Install vLLM** (about 45 min). Meanwhile chat from the laptop.
3. When it is installed, **Download** the model if the list says it is not there yet.

*Expect:* step 1 scrolls the vLLM card into the window, Install vLLM in view; the checklist says *Install vLLM
downloads it too* (no Download button promised before the install); nothing marked ✗; the laptop chats normally
during the install; the list ends with the model downloaded.
- [ ] Done · Found:

### J2 ★ Switch to vLLM and back, seen from a client
*Proves:* a switch keeps clients on this farm and tells them the truth. *Was:* 7e.4.
1. Press **vLLM**. The panel says about 2 minutes.
2. Meanwhile on the laptop: look at the pill; send a message in Open WebUI; send one in LOL Vibe.
3. Once ready: chat in Open WebUI; attach a scanned PDF; in LOL Vibe ask for a long answer and press **Stop**.
4. Press **Ollama** (about a minute). Keep an Open WebUI chat open through it.

*Expect:* the pill reads *<farm> · Switching to vLLM…* and stays on this farm; Open WebUI gets *This farm's model is
starting: about 2 minutes. Try again then.*; LOL Vibe says the model may be restarting and to try again in a few
seconds (**known mismatch, owner's call:** write down how it reads); once ready the Performance card shows the
seats, LOL Vibe's strip says `vllm`, the PDF is read, Stop ends the reply at once. Back on Ollama: the same name
people see, the open chat keeps working, `nvidia-smi` shows vLLM's memory freed.
- [ ] Done · Found:

### J3 ★ vLLM's settings under one Apply
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

### J4 ★ Document search beside vLLM
*Proves:* both fit on one GPU, and uploads do not slow chat much. *Was:* 7f.7.
1. vLLM the engine, Document search on. Read the vLLM card's *GPU memory for conversations*.
2. Ten laptops (or ten Open WebUI windows on several laptops) upload a 50-page PDF at once while two people chat.

*Expect:* the card says *1.5 GB for document search* only while document search is not running yet. Write down the
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
*Proves:* a runaway reply stops. *Was:* 7d.14.
1. On Ollama: add `"maxReplyTokens": 1024` to `proxy` in lol.config.json (a developer setting), restart the farm.
2. Open WebUI: *"Write a 3,000-word story about a lighthouse."* Then the same in a Computer Instruction.
3. Remove the line, restart. On vLLM: read the start of vLLM's log.

*Expect:* Open WebUI's reply stops mid-sentence after about 750 words; the Instruction writes on past that (a
request's own limit wins on Ollama and llama.cpp); vLLM's log names `max_new_tokens` 32768.
- [ ] Done · Found:

### J9 Gemma 4 12B and Qwen3-Omni in the vLLM list (branch `vllm-models`)
*Proves:* the two new models reach a farm whose list was saved before them, download, serve, see a picture, call a
tool and hear sound, from the panel alone. *Was:* DEVLOG 2026-10-09 "Gemma 4 12B and Qwen3-Omni on vLLM" (measured
there with a scratch vLLM, never from the panel of an installed Farm app).
1. On the build with these models, open the vLLM card. Read the list.
2. If the checklist says *… cannot read sound yet: press Update vLLM*, press **Update vLLM** (vLLM stopped first).
3. **Download** Gemma 4 12B (9.3 GB). **Use this**; wait for the restart (about 2 min).
4. In Open WebUI: attach a photo and ask what it shows; ask *"What is the weather in Lyon?"* with web search off.
5. From the farm box, sound in a message (no client sends one yet):
   `curl http://127.0.0.1:4000/v1/chat/completions -H "content-type: application/json" -d @msg.json`, where
   `msg.json` is `{"model":"<the name people see>","messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"<base64 of a short French WAV>","format":"wav"}},{"type":"text","text":"Transcribe this audio word for word."}]}]}`
   (add `-H "Authorization: Bearer <farm password>"` on a farm with one). On a farm with no password,
   `node docs/spike/runs/probe.js http://127.0.0.1:4000/v1 <the name people see> out.json` does steps 4 and 5 at once.
6. **Download** Qwen3-Omni (70.5 GB: an hour or more), **Use this**, repeat 4 and 5.
7. Back to Qwen3.6 with **Use this**.

*Expect:* step 1: five models, Gemma 4 12B and Qwen3-Omni included even on a farm whose list an Add, a Remove or a
take-over saved before (a model removed by hand stays out). Step 3: Automatic says the measured number (Gemma: 16
people at 32k, 8 at 64k on every turn). Step 4: the picture described; Gemma's thinking shows as thinking; the weather
question gets an answer (Open WebUI sends the Computer's tools with it, so this is a request with tools), never an
error. Step 5: the French sentence written back, close to word for word. Step 6: the same with Qwen3-Omni (Automatic:
20 people at 32k, 10 at 64k; the first message with sound after its start takes several seconds). Write down the
start times and anything that read wrong.
- [ ] Done · Found:

### J10 Qwen3-Omni writes down speech (/v1/audio/transcriptions)
*Proves:* vLLM's own transcription route answers for Qwen3-Omni, for the voice work that may use it later. Not
reachable through the farm's gate (it forwards only the routes clients use), so it is tried on vLLM's relay.
1. With Qwen3-Omni serving: `curl http://127.0.0.1:8100/v1/audio/transcriptions -F file=@fr.wav -F model=<its id> -F language=fr`
   from the farm box (inside WSL on Windows: the relay listens on 127.0.0.1).
2. The same with an English WAV, and with no `language`.

*Expect:* `{"text": "…"}` with the sentence, in its own language, in well under a second for a short clip (0.12–0.18 s for 7–8 s on 2026-10-09).
- [ ] Done · Found:

## K. A Windows test box with an RTX card (not production) — about 3 h

**Machine:** a Windows PC with an NVIDIA RTX card that is not the production farm; ideally also the studio's 4070
(12 GB) and 4080 (16 GB), and one PC with no NVIDIA GPU. **Build:** farm-v0.0.43 installed first, then the
farm-v0.0.44 candidate. **Also:** a client laptop on v0.2.10.

### K1 ★ The Farm app update keeps everything
*Proves:* an update over farm-v0.0.43 keeps the model, its settings and the password. *Was:* 7e.1 (and 7d.9, 1.3).
1. On an Ollama farm with a password and a renamed model, note the panel. Install farm-v0.0.44 over it; open it.
2. Press **Plan capacity ↗** with the network cable out.

*Expect:* the panel shows the model, its settings and the password as before; engine buttons Ollama, llama.cpp,
vLLM; **Document search** appears in Plugins, on (NVIDIA); farm.log has no "code refresh failed"; Plan capacity opens
in the system browser with this box marked, offline. On a farm that came from farm-v0.0.41 or older: the first line
of `farm\.searxng\settings.yml` says *lol-settings v4* (or later), its `secret_key` is unchanged, a search on
`http://127.0.0.1:8888` names Swisscows beside some results and no Yandex (7d.9).
- [ ] Done · Found:

### K2 ★ The update copies over a file something holds
*Proves:* the file-by-file copy (farm-v0.0.43's update stopped half-way on the PRO 6000). *Was:* DEVLOG 2026-10-08
12:02 ("Not done yet: the release").
1. With farm-v0.0.43 installed and the Farm app quit, hold serve.sh open from WSL:
   `wsl -e bash -c 'exec 3< "/mnt/c/Users/<you>/AppData/Roaming/LlmOnLan Farm/farm/vllm/serve.sh"; sleep 900'`
   (leave that window open).
2. Install farm-v0.0.44 and open it. Then close the WSL window and quit and reopen the Farm app.

*Expect:* the new panel opens; farm.log names no failed file; `farm\vllm\status.sh` exists and every `farm\vllm`
script is the new one; the old serve.sh sits in `farm\.replaced` (as `N-serve.sh`) and is gone after the next
launch; the vLLM card never says *A file of the farm is missing*.
- [ ] Done · Found:

### K3 ★ llama.cpp b11512 from the installed Farm app
*Proves:* the pin bump works outside the dev box. *Was:* new (DEVLOG 2026-10-08 21:40, "Not done: … a farm release").
1. Backend ▸ **llama.cpp** (default model). Time the first start (it downloads about 577 MB of llama.cpp, then the
   model if it is not there).
2. A reply from a client; a picture in Open WebUI; the Performance card.
3. Rename the model (e.g. `tutor`), switch to Ollama, then back.
4. Optional: unplug the network, restart the farm.

*Expect:* healthy, the panel reads `llama.cpp · …`; a reply, the picture described, the Performance card filled; the
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
1. On the 4070 (12 GB): look at the **vLLM** button before pressing anything; press it.
2. Restart the farm on Ollama with Document search on; read the context line.
3. The same on the 4080 (16 GB). On the PC with no NVIDIA GPU, press vLLM.

*Expect:* the button says *Not for this GPU (12 GB; vLLM's models need about 35 GB): llama.cpp or Ollama is the engine
for it. Press to see why.* (16 GB on the 4080; the number may be a little higher with document search on), before
anything about WSL; no Install, no Download, the farm keeps serving. (From the build with Gemma 4 12B in the vLLM list,
branch `vllm-models`: the button says *about 26 GB* on both cards; with document reading off, the 4080 is offered vLLM for Gemma 4 12B,
with room for 2 or 3 people.) Ollama measures its context again beside the
plugin (a new *Context: auto → N* in farm.log) and chats work. No NVIDIA GPU: told so, not to install WSL.
- [ ] Done · Found:

### K6 vLLM from nothing on a Blackwell PC without WSL
*Proves:* the whole install path on a fresh Windows. *Was:* 7e.3 (never run: VLLM_MANAGED_PLAN, "Never run yet").
1. Press **vLLM**: follow the checklist (an administrator PowerShell, a restart, Ubuntu opened once). **Check again**.
2. Install the C compiler with the line it gives. **Check again**.
3. **Install vLLM** (about 45 min) while a client chats. **Download** the model, **Stop** it half-way, Download again.
4. An RTX 5090 (32 GB): turn Document OCR off in Plugins first; after a farm restart write down whether vLLM fell
   back to Ollama (the switch is not kept: owner's call, DEVLOG 2026-10-08 07:08).

*Expect:* WSL steps, then a C compiler, then nothing ✗; the client chats normally during the install; a stopped
download reads partly downloaded and a second Download finishes it; on a French Windows the WSL sentences read
right; an older card gets a warning (write down whether it starts).
- [ ] Done · Found:

### K7 The llama.cpp list before switching (branch `vllm-models`)
*Proves:* an operator on Ollama (or vLLM) sees and prepares what a switch to llama.cpp would serve, and the farm keeps
serving meanwhile (owner 2026-10-09).
1. On Ollama, a client chatting. Panel ▸ Backend ▸ **llama.cpp**.
2. Read the card. On a model that is not downloaded, press **Use this**; watch the bar and the client.
3. **Close** the card; press **llama.cpp** again. Press **Switch to llama.cpp**; read the question; confirm.
4. Switch back to Ollama.

*Expect:* step 1 opens *Model · llama.cpp* in view, with no question and no switch; it says Ollama keeps serving until
**Switch to llama.cpp**, marks the model it will serve **chosen** and those on this computer **downloaded**. Step 2:
the bar says *Downloading <model>*, the client keeps chatting, then *llama.cpp will serve <model> when you switch to it.
Ollama keeps serving until then.* Step 3: the question names that model (and says it downloads it first when it is not
there); llama.cpp serves it.
- [ ] Done · Found:

## L. The DGX Spark — about 3 h (+45 min for the optional fresh install)

**Machine:** a DGX Spark, with a screen. **Build:** the Farm app's Linux arm64 AppImage (farm-v0.0.44 candidate). All
of it never run on a Spark.

### L1 The AppImage runs and serves
*Proves:* the Spark can be a farm from the app. *Was:* RIG_CHECKLIST "DGX Spark".
1. Run the AppImage (FUSE, or `--appimage-extract-and-run`); go through the wizard.

*Expect:* the plain `ollama-linux-arm64` loads gemma4:12b on the GB10; a client chats.
- [ ] Done · Found:

### L2 vLLM run by the farm on the Spark
*Proves:* the plan's §11.6 (VLLM_MANAGED_PLAN). *Was:* 7e.9, 7d.17, 7d.18.
1. `bash "/home/<you>/.config/LlmOnLan Farm/farm/vllm/status.sh"`: `arch=aarch64`, a `gpu=NVIDIA GB10, …` line whose
   memory fields are not numbers, a `cc=` path, `mem_available_kb=`.
2. The panel's vLLM button, then the check: *GPU: NVIDIA GB10 (119 GB shared with the system).*, nothing ✗.
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
*Proves:* the arm64 llama.cpp of the new pin, and ggml-org's own build as a replacement (owner, 2026-10-09). *Was:*
RIG_CHECKLIST "llama.cpp on the DGX Spark"; DEVLOG 2026-10-08 21:57 "the DGX Spark (our arm64 build of the new pin)".
1. Backend ▸ llama.cpp: the farm downloads the `llamacpp-b11512` tarball (our CI build, after the merge to `main`).
   A reply.
2. Plugins ▸ Document search: on; a client uploads a document (I3).
3. ggml-org's `llama-b11512-bin-ubuntu-cuda-13.4-arm64.tar.gz` + its `cudart-…`, set as `llamacpp.binDir` (a
   developer step): the GB10 seen, a reply, EmbeddingGemma 2 at 768.

*Expect:* steps 1–2 work; step 3 decides whether `build-llamacpp-arm64.yml` goes (DEVLOG 2026-10-09).
- [ ] Done · Found:

## M. Reboot tests — about 1 h each, at a quiet moment

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

## N. The Farm app on a clean box — about 2 h (plus downloads)

**Machine:** a Windows PC with an NVIDIA GPU and **no** Ollama and no Python installed (a system Python on PATH is
fine for N2, better even); a second machine for D10. **Build:** farm-v0.0.44. Never run on a truly clean box: the
clean-state run on the PRO 6000 reused the owner's Ollama (DEVLOG 2026-10-08 14:05).

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
1. With farm-v0.0.43 installed and *Notify* on, publish farm-v0.0.44 (the real release does it). Open the app.

*Expect:* *Version … is available*; Download opens the release page; a client's own update is unaffected.
- [ ] Done · Found:

### N5 A Mac farm, and a low-RAM Mac
*Proves:* the macOS Farm app. *Was:* RIG_CHECKLIST "Per-OS installers" (the dmg never installed), "Low-RAM Mac".
1. Install the macOS arm64 Farm app (right-click ▸ Open the first time); go through the wizard. On a Mac with less
   than 16 GB too.

*Expect:* it serves gemma4:12b on Ollama, no vLLM offered and Document search off; the low-RAM Mac shows the memory
warning but goes on.
- [ ] Done · Found:

---

# After each session

- [ ] Every test of the session is ticked, or its *Found* line says what you saw.
- [ ] Every farm setting a test changed is back (people at once, *Free an idle seat after*, the password, the
  engine), and the plugins you do not want on for users are off (Classify, Speech to text, Message bus, Kokoro).
- [ ] What failed is written in the DEVLOG, with the test's id.

---

# Questions for the owner (the docs and the code disagree)

1. **LOL Vibe's sentence while vLLM starts.** A 503 from a farm whose model is starting reads *"…it may be
   restarting. Try again in a few seconds."* (`strings/net.en.mjs` `upstreamDownBody`), while Open WebUI is told
   *about 2 minutes* (J2). Known since 2026-10-08 03:57, unchanged.
2. **The Plugins switches do not last across a farm restart** (`setPlugin` keeps them in memory). Old checks expected
   Classify back after a restart (2.4); a 32 GB card needs document reading off to fit vLLM, and that is lost at
   the next start (K6). Keep, or make them last?
3. **The search-model checks of v0.2.9 (B3–B5) now apply only to a data folder that never met document search.** A
   fresh laptop on an NVIDIA farm never loads MiniLM (I2). Are B3–B5 still worth a session, or only I5?
4. **"≈ 362.7 million" (Île-de-France, A9):** no doc or result file records it. Confirm the number.
5. **The coding agent's model line does not know Qwen3.6**, the model the studio serves: it reads *Nobody has tried
   Qwen3.6 on code edits yet* (G2). Add Qwen3.6 to `projects/models.mjs` after G2?
6. ~~**`project.json` may not be protected from the coding agent**~~ — **fixed 2026-10-09** (DEVLOG 10:59): it was
   true, and `.git/config` (the remote a person's Push sends to) was open too. The fence now refuses a write or edit
   to `project.json` or anything under `.git/`; reading stays allowed. Nothing for a person to decide.
7. **The vLLM button's number on a small card** (K5) was written as *about 35 GB*; with document search on, the
   farm counts its 1.5 GB too, so the sentence may say a little more.
8. **Candidate builds for the ★ tests:** a local build, or a pre-release tag.

---

# What was dropped, and why

About 460 items were collected from: TEST_SCENARIOS_v0.2.md (113, §1–§8), RIG_CHECKLIST.md (46 open),
LOLCHAT_RIG_CHECKLIST.md (200 open), LOLCHAT_STUDIO_PLAN.md §5 (18), LOLCHAT_TESTING.md §4 (5), COMPUTER_PLAN.md §13
(40), COMPUTER_STATUS.md "What only you can check" (13), VLLM_MANAGED_PLAN.md §9.6/§11.5/§11.6 (12),
EMBEDDINGS_STUDY.md "What to test" (6), HOME_ASSISTANT.md "Not tried yet" (3), IDE_PLAN.md (1) and the DEVLOG's
not-done lines (5 new). About 20 were dropped as done, about 67 as superseded or never shipped, 5 are a developer's
checks, and about 365 are kept above, merged into 99 tests. CLAUDE.md's "Still needs real … verification" paragraph
named nothing the lists did not.

**Done since (verified on a real farm or real hardware):**
- The CI installers for every platform (release v0.2.9, DEVLOG 2026-10-08 07:08); the Open WebUI pin bump with no LOL
  code change (0.11.4, DEVLOG 2026-09-27); a client reaching a shared Farm app (2026-09-03, production since).
- Home Assistant's ask, dry run, allow and agent (TEST_SCENARIOS 7c.2, 7c.3, 7c.4, 7c.7) on the demo home (DEVLOG
  2026-09-30). The real home is H.
- A Computer program on the first try (the owner, 2026-09-23); Code on a real graph (every ? example run on qwen3.8,
  NIGHT_LOG 2026-09-28 00:36); the debug log's file where the guide says (NIGHT_REPORT 2026-09-25).
- COMPUTER_PLAN §13 items 8, 12, 13, 15, 16, 18, 19, 28, 32, 33: proven by the harness, not a person's check.
- Partly done, the rest kept: the agents' real runs of the IDE (G's intro), the Agent box and lessons 5, 11, 12
  (A9, A11), Stop at the engines (D2), the packaged build loading LOL Vibe (A1).

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
- **Merged duplicates:** 1.6 into C3 (with 7d.1); 2.3 and 2.4 into D14 (7d.15's expected results).
- **The laptop-side embedding switch** (EMBEDDINGS_STUDY "What to test", 6 items): the owner chose the farm instead; I
  tests it.
- **Not shipped:** a no-Open-WebUI build (COMPUTER_PLAN item 5); the per-thread graph migration's delete check (item
  7); the *Critique loop* template (item 37); the Studio's map, sketch and board benches (LOLCHAT_STUDIO_PLAN §5
  S-R6–S-R15: S1–S3 were never built, the Computer and the IDE took their place).

**A developer's checks, not a person's:** `e2e.js` on a box with no client (LOLCHAT_RIG §0), which rung of the ask spine
gemma4 needs (§12), the strict harness flake (§12.1), the harness run itself (COMPUTER_PLAN item 34), the security
review of the projects API (LOLCHAT_STUDIO_PLAN S-R1), and reading the pinned Open WebUI's source for `--port` and the
OpenAI env at each pin bump (RIG_CHECKLIST).
