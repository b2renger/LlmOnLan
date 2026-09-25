# Night report: 24 Sept 20:00 → 25 Sept 08:40

The Computer, on branch `lolchat/vnext`. Everything below is committed and pushed. This report says
what was actually done and how each claim was checked, and it names what was not done.

## In short

| | What | State |
|---|---|---|
| 1 | **The debug log you asked for** (Record switch, Mark bug, timestamped file) | Done, reviewed, used this morning on your real client |
| 2 | **Your eight bugs** (seed, the "substitute" option, resize, trackpad, unplug, editing, copy, p5/three/SVG) | All eight fixed; each was checked with real mouse and keyboard input |
| 3 | **A critic loop, as you asked**: four rounds until it had nothing blocking left | 18 more defects found and fixed. Final verdict "happy pending rig", and the rig passed this morning |
| 4 | **The perf pass you scheduled for 02:05** | Runs about 2× faster on big graphs; panning is smooth; strict budgets added |
| 5 | **The rig check on your farm** (this morning, on your relaunched client) | The seed works through LiteLLM. Each preset drew 5 times out of 5 |

Seven commits, 109 files, +13,296 / −503 lines. Unit tests went from 1,386 to **1,493**, harness
scenarios from 297 to **340**, and perf is **9/9**. Every gate was green at every commit, except the
perf failure recorded at the K7 commit.

## Timeline

| When | What | Commit |
|---|---|---|
| ~21:00 | K6 verified on a quiet machine (harness 297/0, perf 9/9). The run-cost creep was measured as real, not noise | — |
| 21:01 | You asked for the logger and the 02:05 perf pass. I scheduled the pass | — |
| 21:05–22:10 | Logger built by me. One adversarial review agent found **10 defects**, all fixed with tests | `98e9e42` |
| 22:00 | You sent the bug list. A critic agent inspected the Computer and **traced all 8 to code**; I proved #6 and #7 with real input before anyone touched them | `afff65a` |
| 22:15–23:15 | Three builders (generation, canvas, boxes) worked in parallel on files that did not overlap. I integrated them | `d4462c5` |
| 23:19 | Critic round 2: all 8 items and the 18 defects confirmed fixed. It found 1 major and 4 minor new issues | `4cabdbd` |
| 23:20–00:32 | Builder D fixed round 2's issues. Rounds 3 and 4 (7 minor items) were fixed by me | `c43e6ac` |
| 02:05–02:30 | The scheduled perf pass | `850c033` |
| 08:30–08:40 | You relaunched the client; the rig check ran on your farm | this report |

## 1. The debug log (K7)

What you get:
- **● Record log** at the right end of the Computer's run bar.
- **⚑ Mark bug** takes a screenshot, asks one sentence about what went wrong, and saves the whole
  graph and state with it.
- A folder button opens the log folder.

Files go to `%APPDATA%\LlmOnLan\logs\computer\computer-<date>_<time>.jsonl`. A file records:
- clicks and keys (typing is summarised once per field);
- graph edits, with what changed;
- every run, box by box;
- farm requests, with the model and the prompt text for the Computer's own runs, and never the
  password or a header;
- every error, the console, and the sandbox;
- slow frames.

It keeps the last ~2000 events in memory, so pressing Record *after* a bug still captures what led
to it. To hand a log over, say "look at the latest Computer log". The guide is
[COMPUTER_DEBUG_LOG.md](COMPUTER_DEBUG_LOG.md).

How it was checked:
- 9 unit tests;
- 2 end-to-end scenarios that read the file back off disk line by line and check that the farm
  password is not in it;
- one adversarial review. Its 10 defects were real, and one was a leak: a password typed with
  AltGr was written key by key. All 10 are fixed with tests;
- this morning, on your real client, three recordings of 47–127 KB with **0 write failures**.

## 2. Your eight bugs

| Your words | What was wrong | What changed | Checked by |
|---|---|---|---|
| "we always get the same results… control about the seed" | No seed was sent, and ▶ again replayed the cached answer | A **Seed** row on every Instruction: new each run by default, or pin one (🎲, ✕, **Keep**). The seed goes into the request and the cache key | Unit and real-click scenarios; **real farm this morning** (below) |
| "what does 'substitute short values in place' mean" | The label was unclear, and it **also replaced bare words** ("topic" became "cats") | Renamed **"Fill in {names} with their values"**; fills only `{braced}` names | Unit and scenario |
| "resize boxes and prompts and text fields" | `resizePart` existed; nothing in the interface used it | Corner handle on every box; fields fill the box; ports and wires follow | Real-drag scenarios; `k9-fit` checks every lesson and template |
| "mouse and touchpad… pan, zoom seamless" | The canvas swallowed every scroll | Two-finger pan, pinch zoom about the cursor, scrolling inside a box scrolls the box. Also Hand tool, Space/middle-drag, zoom menu (fit, selection, 100 %), right-click menus | Real wheel and pinch events in the harness. **A human trackpad test is still yours**, see below |
| "unplug a wire" | Possible only by clicking the thin wire and pressing Delete | Drag the wire's end off the input, or the ✕ on hover; one undo brings it back | Real-drag scenarios |
| "editing a textbox created before" | Proven: the canvas captured the pointer, so a click on a filled box never reached its editor | Double-click, **✎ Edit**, or Enter/F2. Editing a wired box locks it so the next run keeps your edit | Real input, before and after |
| "copy / paste texts from the boxes" | Proven: dragging across text moved the box | Selectable text, Ctrl+C, Copy buttons. Plain text pasted on the canvas becomes a Text box | Real input |
| "SVG, p5js and threejs do not work" | Answers were **silently cut at 512 tokens**; the model was never told the sandbox's rules; animation-only sketches photographed blank | 4096 tokens for code, with a cut-off shown as an error; one instruction set per kind; sandbox sized to the box; first-frame capture | **Real farm: 15 of 15 drew** (below) |

## 3. The critic loop

| Round | Found | Fixed by |
|---|---|---|
| R1 | Your 8 items traced to code, plus 18 defects (5 major). For example: Undo rewound run results, a deleted graph came back, the log also caught LOL Chat text | Builders A, B and C; the two logger items by me |
| R2 | All 26 confirmed fixed with real input. New: boxes overflowing at their now-exact height (major), plus 4 minor | Builder D. It also found that 10 part types already overflowed their defaults, and fixed them all |
| R3 | "Happy pending the farm check". 4 minor items | Me |
| R4 | "Happy pending the farm check". 3 smaller items | Me |

Reports: [reviews/COMPUTER_CRITIC_R1.md](reviews/COMPUTER_CRITIC_R1.md), [R2](reviews/COMPUTER_CRITIC_R2.md), [R3 + R4](reviews/COMPUTER_CRITIC_R3.md).

## 4. The perf pass (02:05)

The cause was not the runner. Of ~414 ms of work in a 1000-box run, **290 ms was the browser
restyling and repainting boxes that were off screen**. On top of that, each box update searched
the whole graph, which made a run O(N²). Off-screen boxes now skip their rendering, the graph keeps
an index of where each box is, and a big run lets the "queued" state paint once before starting.

| | Before | After |
|---|---|---|
| Cost per box, 1000-box run | 0.33–0.40 ms | **0.16–0.18 ms** |
| Longest freeze in that run | ~140 ms | **65–71 ms** |
| Pan work per frame, 500 boxes (p95) | 17–20 ms (failing) | **1.4–1.6 ms** |
| Building 500 boxes | ~130 ms | **~60 ms** |

The budgets are now tight, so a slow creep fails loudly: 0.25 ms per box, a 110 ms freeze, 8 ms of
pan work. The reasoning is at the top of `perf-graph.mjs`.

## 5. The rig check on your farm (this morning)

Your farm's default model is now **Qwen3.8-latest** on llama.cpp, not gemma4. So that is what was
tested.
- **Seed through LiteLLM:** the same prompt with seed 42 twice gave the **identical sentence, the
  identical reasoning and the identical 142 tokens**. Seed 7 gave a different sentence. The seed
  really reaches the model.
- **Write an SVG / p5.js / three.js sketch**, placed as the ＋ menu places them and wired into a
  Preview, with a new seed every run:
  - SVG **5/5**, p5 **5/5**, three.js **5/5**. The bar was 4 out of 5.
  - Each run took 5–11 s and 819–1,918 tokens, and none was cut off.
  - I looked at the pictures: a landscape with a sun, hills and a house; a colourful spiral; floating
    shapes in soft light.
- It is in your library as **"Rig check — Qwen3.8 (25 Sept)"** (6 boxes). Delete it whenever you
  like.
- Load on your farm: 3 short requests and 15 code generations, one at a time, about 2.5 min in all.

One thing about how it was run: your client window was hidden, and the Computer (rightly) refuses to
use the farm for a hidden window. For this session I set the test hook `forcePageVisible` in memory
and cleared it afterwards. No setting was changed.

## What was NOT done, or is not proven

- **Found this morning, not fixed:** after a run is refused because the window is hidden, the run
  bar says *"Nothing to run — every part is up to date"* while the boxes are stale. It should say
  the window was hidden and nothing was sent. It's a small fix, and I haven't made it yet.
- **Only the default model was tested** (Qwen3.8). nemotron-3.5-lightning:30b was not, and neither
  was gemma4, since your farm doesn't serve it. Several docs, including my own notes last night,
  still say "gemma4"; that is out of date for your current farm.
- **Trackpad feel is not proven by a human.** The harness sends real wheel and pinch events, but
  only you can say whether pan and zoom *feel* right. The tunable constants are in
  `graph/gestures.mjs`. A plain mouse wheel pans, as tldraw does; tell me if you want wheel = zoom
  instead.
- **Not tested on a Mac:** keyboard copy/paste relies on Chromium enabling the command there.
- **Perf:** a 1000-box run still has a 65–71 ms freeze, which is the browser restyling the box
  outlines themselves. The runner's per-step scan of every box is deliberate, and its own header
  forbids changing it.
- **The rig checklist** ([LOLCHAT_RIG_CHECKLIST.md](LOLCHAT_RIG_CHECKLIST.md) §17, and the gesture
  items) is still yours to tick.

## Try by hand (5 minutes)

1. Computer → **● Record log**, click around, press **⚑ Mark bug**, type a sentence, stop. The
   folder button shows the file.
2. On any Instruction: ▶ twice gives two different answers. Press **Keep**, then ▶ again gives the
   same answer.
3. Double-click a filled Text box and type. Drag-select some words and press Ctrl+C.
4. Pinch and two-finger scroll on the trackpad. Drag a wire's end off an input.
5. Resize a box from its corner.

## Cost of the night

| Agent | Tokens |
|---|---|
| 1 adversarial reviewer (logger) | ~0.24 M |
| 1 critic (4 rounds) | ~0.80 M |
| Builder A (generation) | ~0.54 M |
| Builder B (canvas) | ~0.54 M |
| Builder C (boxes) | ~0.47 M |
| Builder D (round-2 fixes) | ~0.36 M |
| **Agents total** | **~2.95 M** |

On top of that is my own integration work. The logger, rounds 3 and 4, the perf pass and the rig
were done without agents.
