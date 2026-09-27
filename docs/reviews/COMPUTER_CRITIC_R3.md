# The Computer: critic report, round 3 (2026-09-24)

**Verdict: HAPPY-PENDING-RIG.**
- **Round 2's fixes:** N1 to N5 are all fixed. I checked each against the code, and with real input
  where it mattered: small control boxes run at their new default sizes, and the compact
  Instruction at every width the shipped lessons and templates use, in light and in dark.
- **Nothing blocks sign-off.** No blocker and no major problem is left. Four minor problems are
  left; they are listed below and can go into the next polish pass.
- **Still pending on the rig:**
  - A1: a pinned seed on `gemma4:12b` gives the same answer through LiteLLM.
  - A8: each Write-… preset draws at least 4 times out of 5.

## How this was checked

- **Code:** the uncommitted tree on top of `4cabdbd`: 20 files and 2 new scenarios. I read every diff.
- **Gates, re-run on this tree:**
  - `chat-unit`: 1489 passed, 0 failed.
  - `chat-lint`: 219 files, 0 violations.
  - `--phase k9` on slot 7: 5 passed, 0 failed (`k9-fit` plus the four `k9-r2` checks).
- **Throwaway real-input probes on slot 7**, in one file `zz-critic-r3.mjs`, now deleted:
  - each small control part (Button, Condition, Confirm, Dialog, Timer, Toggle), run for real at its new default size and at its size before R1. The Dialog and Confirm were answered by clicking, the Button by pressing its face. Each was measured before the run, while waiting and after the run, in dark and in light;
  - Instructions at 300×300, 300×260, 240×260, 280×270, 320×260, 200×260 and 300×200, after an answer that was cut off (`mock-length`), in both themes. The probe checked, for every control, whether it is clipped by the body, or covered at its centre (hit test);
  - Keep with a real click on the 240-wide box, then Ctrl+Z;
  - lesson 2 run as a person runs it (wire, then Run all), at 100 %, in both themes.
- **Screenshots** (gitignored), in `shell/test/chat-harness/generated/shots/zz-critic-r3-*.png`:
  `controls-waiting-light`, `controls-after-light`, `controls-after-dark`, `ins-light`, `ins-dark`,
  `l02-light`, `l02-dark`.

## Status of round 2's findings

| # | Status | Evidence |
|---|---|---|
| N1: boxes cramped at exact heights | **Fixed** | See detail below. |
| N2: zoom-chip menu off-screen | **Fixed** | The chip's menu is `position: fixed` below the chip and clamped to the window: its box is 899, 39 → 1119, 140 in a 1264×795 window, and "Zoom to fit" is hit at its centre (`k9-zoom-chip-menu-opens-on-screen`). |
| N3: Keep stales downstream | **Fixed** | `setSettings(…, {stale:false})`, used by Keep only when the seed matches the answer on screen and the box is neither running nor queued. My probe: Keep on a finished box leaves it `done` (`k9-keep-pins-the-seed-and-stales-nothing`: 0 requests on the next Run all). See **R3-4** for Undo. |
| N4: tour step 1 wording | **Fixed** | Step 1 now says "scroll with two fingers (or the mouse wheel) to move… Dragging empty canvas draws a box that selects". The hint names Space, the middle button and the Hand tool (H). The other tour steps match what the canvas does. |
| N5: one paste, two boxes | **Fixed** | `onPaste` and `onBeforePaste` return on `ev.defaultPrevented`. A picture with text makes one box (`k9-paste-a-picture-with-text-makes-one-box`). |
| Rig: A1 seed through LiteLLM | **Pending rig** | Needs the owner's client relaunched with a debug port. |
| Rig: A8 each Write-… preset draws at least 4 of 5 | **Pending rig** | As above. |

N1 in detail:
- `k9-fit` passes. It opened every lesson and every template from the shelf, and an imported graph with all 24 part types at their sizes before R1. No box body scrolled. Prompt heights (box height : prompt height, in px):
  - lessons: 129, 129 / 129 and 139;
  - research template: 117 to 149;
  - old-size Instruction after a cut-off run: 63;
  - new Instruction in its densest state: 70.
- **My probes:**
  - Every control part at its **new default size** ran with no overflow, horizontal or vertical, before the run, while waiting and after, in dark and in light.
  - Instructions at 300 and 320 wide, and 280×270, showed nothing clipped or covered after a cut-off run, in both themes.
  - Lesson 2's 240-wide boxes after a normal run: no overflow, prompt 72 px, and Keep is reachable (a real click pinned the seed).
  - The Title's S/M/L now sits in its title bar, where the ▶ and state are hidden for annotation parts, so nothing overlaps.

## Remaining findings (all minor, none blocking)

**R3-1. At 240 px wide, the Instruction's Model picker is squeezed until its value is unreadable.**
- **Where:**
  - `graph.css`: `.graph-ins-fields > .graph-part-field { flex: 1 1 0 }`, while the Answer-shape field is `flex: 0 1 auto`, so the shape field keeps its natural width and the Model field absorbs all the shrinking;
  - `.graph-part-field > :is(input, select) { flex: 1 1 64px; min-width: 0 }`.
- **Scenario:** lesson 2 (`02-wires.mjs:38, 42`, both Instructions 240×260). The Model select is 35 px wide and shows "Au▾", in light and in dark (`l02-*.png`). It still opens and works, but nobody can read which model a box uses.
- **Fix, either of:**
  - give the Model field priority: `flex: 1 1 auto` on both fields, `min-width: 96px` on the Model select;
  - wrap the row when the box is narrow: `flex-wrap` is already on, so give each field `flex-basis: 120px`.
- **Test:** add the check "the Model select is at least 90 px wide" to `k9-fit` for every Instruction.

**R3-2. Control boxes in graphs saved before R1 overflow once they run or ask.**
- **Where:** the new defaults were raised (Button 156, Condition 214, Confirm 186, Dialog 230, Timer 176, Toggle 156 px), but stored heights were not. `k9-fit` measures the legacy graph **before** any run.
- **Scenario (probe, real run):**
  - A **Dialog at 260×190** asking its question: the body scrolls 29 px, and the answer field and **Send** are below the fold. The person must scroll the box to answer.
  - A **Condition at 240×170** after a run: the body scrolls 40 px, and its verdict line is hidden.
  - A **Button at 200×120** after a press: 27 px.
  - A **Timer at 220×140** after a run: 5 px.
  - Confirm and Toggle at their old sizes: no overflow after the run (Confirm scrolls 1 px while it waits).
- **Fix:** when a document is loaded, raise the height of a Button, Condition, Confirm, Dialog, Timer or Toggle whose `h` is below its type's current default to that default. These are small boxes, so the growth is at most 40 px. Put it in `normaliseDoc`, or as a flagged one-time pass so a person's own later shrink is kept.
- **Test:** `k9-fit`'s legacy graph, run once: Dialog and Confirm answered by clicking, the Button pressed. Then assert that no body scrolls.

**R3-3. A 240-wide Instruction whose prose answer was cut off overflows by 9 px.**
- **Scenario:** the cut-off chip takes a line of its own, and at 240 wide the seed row has already wrapped its last-run half. The "sends N words" strip is then clipped.
- It is rare, because prose now has 2048 tokens, and fixing R3-1 with a wrap gives the room back.
- **Test:** the cut-run case in `k9-fit` at 240×260.

**R3-4. Undoing a Keep marks the box and everything downstream stale again, which is round 2's N3 by the back door.**
- **Where:** `undo.mjs` `restoreProgram` compares `settings` with `stable()`. The only difference is `seed: '514397'` against `''`, so it `markStale`s the box and everything downstream.
- **Scenario (probe):** Keep leaves the box `done`. Ctrl+Z turns it `stale`, and the next Run all regenerates the downstream Instructions with new seeds.
- **Fix:** in `restoreProgram`, a settings difference that is only `seed`, where the part's current `stats.seed` equals one side's pinned value, is not a program change. Alternatively, record `{stale:false}` on the undo entry, so Undo and Redo of that edit skip `markStale`.
- **Test:** unit on `restoreProgram` covering Keep and then Undo.

**Count: 0 blocker · 0 major · 4 minor.**

## Sign-off

I am **HAPPY with the Computer apart from the two rig checks.**
- The owner's eight complaints are answered in the code, and each was confirmed with real input.
- Round 1's 18 defects, and round 2's major and four minor findings, are fixed.
- The four minor items above make a small polish pass, in order of how visible they are: R3-1 (lesson 2 shows it), R3-2, R3-4, R3-3.
- They do not need another critic round unless the owner wants one. The rig session decides A1 and A8.

---

## Round 4 (2026-09-25): the four R3 minors

**Verdict: HAPPY-PENDING-RIG.** All four R3 items are fixed. I found nothing blocking or major.
Three small items remain; none needs another round.

**How this was checked**
- **Gates, re-run on this tree:** `chat-unit` 1492 passed, 0 failed; `chat-lint` 0 violations.
- **Real-input probes on slot 7**, in one file `zz-critic-r4.mjs`, now deleted:
  - a Dialog asking for real, answered by typing and clicking Send, measured in dark and in light;
  - lesson 2 wired and run, then measured in both themes;
  - an old-size Dialog and Condition imported;
  - the resize handle dragged up past its limit;
  - Condition in "model" mode after a real verdict and after a farm error.
- **Screenshots:** `generated/shots/zz-critic-r4-*.png`.

| # | Status | Evidence |
|---|---|---|
| R3-1: lesson 2's Model picker | **Fixed** | At 240 px wide the Model picker is 100 px and reads "Model: automatic"; the Answer picker is 110 px. Nothing overflows, in dark or light. A real click focuses the select. The captions are visually hidden but still name each `<select>` for screen readers, and each select has a title. |
| R3-2: old control boxes overflow | **Fixed** | See detail below. |
| R3-3: cut-off answer in a narrow box | **Fixed** | Covered by the one-line picker row. `k9-fit` holds a 63 px prompt after a cut-off run in a 260 px box. |
| R3-4: undoing Keep stales downstream | **Fixed** | `restoreProgram` ignores a difference in the seed alone (`withoutSeed`), with a unit test in `computer-r3.test.mjs`. |

R3-2 in detail:
- A Dialog at 260×240 fits while asking and after the answer, in dark and in light.
- Imported at their old sizes (Dialog 260×190, Condition 240×170), the boxes load at their minimum heights, 240 and 214.
- Dragging the resize handle to the top-left stops at h = 240. It never fights a reload.

**Left over (minor or cosmetic, for a later polish pass)**
- **R4-1.** A Condition in **"Decide by: the model"** mode overflows at its minimum height 240×214.
  - After a verdict the body scrolls 26 px, so its hint line is below the fold. After a farm error it scrolls 65 px, and the Model picker is scrolled away.
  - The minimum height was sized for the default "reading the words" mode, which has no Model row.
  - Fix: a mode-dependent minimum (`minHFor(part)`), or about 250 px for this part.
- **R4-2.** `insModelAuto` became "Model: automatic" everywhere, but only the Instruction hides its caption. The Condition (model mode) and the Filter now read "Model [Model: automatic ▾]".
  - Fix: give the Instruction its own string, or hide those two captions the same way.
- **R4-3.** `withoutSeed` ignores *every* seed-only change on Undo, not just a Keep.
  - Scenario: a box pinned to 42 is run, re-pinned to 99 and run again, then Ctrl+Z. It now says "pinned 42" while showing the answer for 99, still `done`.
  - It is rare, and the box's own "last run: 99 · Keep" line says the truth.
  - Fix if wanted: skip the stale only when the current `stats.seed` equals one side's pinned value.

**Final: HAPPY, pending the rig session.** Two checks are left:
- A1: a pinned seed on `gemma4:12b` through LiteLLM gives the same text twice, and two seeds give different text.
- A8: each Write-… preset (SVG, p5, three, HTML) draws in at least 4 of 5 runs.
