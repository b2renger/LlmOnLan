# The Computer: critic report, series S, round 2 (2026-09-25)

**Verdict: NOT YET.** 0 blocker · 2 major · 3 minor.

All 16 S1 findings are fixed, and I checked each against the code, most with real input. Two new
majors came out of the seams S1 opened:

- **S2-1:** a long input now leaves the answer with only 512 tokens. This regresses S1-3. The test
  suite asserts this behaviour, so it looks intended.
- **S2-2:** a stale box behind an unpressed Button still reads "Nothing to run — every box is up to
  date" and offers "Run everything again". This is S1-1's contract, broken in a state the fix did not
  cover.

The three minors are small.

## How this was checked

- **Code:** HEAD `06240ff`. I read every changed source file of the 59 in the S1 commit, and diffed
  the docs.
- **Gates, re-run on this tree:**
  - `chat-unit`: 1517 passed, 0 failed.
  - `chat-lint`: 0 violations.
  - `--phase k10` on slot 7: 13 passed, 0 failed.
  - `--phase k9`: 5 passed, 0 failed.
  - `--phase k8`: 34 passed and 1 failed (`k8-input-hover-a-wire-and-click-its-x`: a `waitFor`
    timed out), then 35 passed, 0 failed on a second run. The failing scenario passed twice more on
    its own. I read this as an order-dependent flake. Nothing links it to S1, but keep an eye on it.
- **Throwaway real-input probes on slot 7** (`zz-critic-s2-{a,b,c}.mjs`, now deleted):
  - a hidden run, then a visible run;
  - an unpressed Button;
  - Tab inside a box taller than the view;
  - the thinking cut on a text, a list and a JSON Instruction, and on a fan-out;
  - Escape out of the ＋ menu after panning away with the wheel. This one found nothing.
- **Node (pure modules):** I ran `planFor` against 8k, 16k and 32k windows with 9k–40k-token inputs
  to cover the clamp.
- **Startup:** I listed every module that `computer/main.mjs` and its MODULES rows import, following
  static imports, at `1f584f0` and at `06240ff`. See the dedicated section below.

## Status of the S1 findings

| # | Status | Evidence |
|---|---|---|
| S1-1 hidden run reads "Nothing to run" | **Fixed** | Probe on a hidden window: bar and live region both read "Paused: this window was in the background…"; "Run everything again" is hidden. Visible again, Run all sends **1** request and the done box keeps its seed (365051 → 365051). |
| S1-2 sentence outlives its run | **Fixed** | `say('')` on the runner's `start`, `outcomeText` on `done` from every door, cleared when `rev` moves or the graph changes (`runbar.mjs:489, 576, 588`). `k10-run-outcomes` covers edit then ▶. |
| S1-3 thinking models starve | **Fixed for short prompts, regressed for long ones** | See **S2-1**. |
| S1-4 thoughts become the answer | **Fixed** | Probe with `mock-think-length`: the text, list and JSON Instructions and all 3 fan items end in `error` with `errCutOffThinking` and no value. **6 requests for 6 asks** (no JSON-ladder retry). 6 generations counted. The bar reads "4 boxes failed — each one says why." |
| S1-5 drop on the box body | **Fixed** | `bodyDropPort` asks `addWire` for each input, so it can never disagree with a drop on the dot. Refusals, loops and full `many:false` ports read the same sentences. k10 covers lessons 2 and 4. |
| S1-6 lesson 3 "click and type" | **Fixed** | Pill text, F2, or typing on a selected arrow; `revealWire` for "Show me"; k10. |
| S1-7 password reads "no farm" | **Fixed** | `failFromAsk` keeps the ask's sentence (`common.mjs:64-85`); `c1-run` now asserts `ask.noFarm`. |
| S1-8 Show me | **Fixed** | `reveal` plus focus on the answer field (`runbar.mjs:405-423`); k10. |
| S1-9 Tab to an off-screen box | **Fixed for boxes that fit the view** | Boxes taller or wider than the view do not follow: see **S2-3**. |
| S1-10 Timer plan sentence | **Fixed** | `limitTimerPlan` when `planned`; bar outcome `runOutcomePlanned`. |
| S1-11 Export/Import doors | **Fixed** | Both exports default to "Include results", ticked; the note hides when unticked; "Replace from file…" and its confirm. |
| S1-12 sentences that lie | **Fixed** | One latent leftover: see **S2-5**. |
| S1-13 model names and seeds | **Fixed** | No model id in `ask.*`/`parts.*` (unit); the seed hint and Keep are honest. |
| S1-14 two Run buttons | **Fixed** | `#lolcomputer .graph-toolbar :is(.graph-run,.graph-stop){display:none}`. |
| S1-15 Ctrl+0 on AZERTY, Ctrl+Enter in a Dialog | **Fixed** | `isZoomResetKey` by `code`; the Dialog stops propagation; "A run is already going." |
| S1-16 docs | **Fixed** | The tutorial is rewritten and accurate; I spot-checked it against strings and handlers. One sentence is still false: "Tab goes from box to box, and the view follows" (S2-3). COMPUTER_STATUS and the plan's SUPERSEDED notes are correct. |

## Startup (the integrator's question)

- **The Computer did not get heavier.** Its static import closure is **132 modules both before and
  after S1**, and its source grew by 36 KB (+2 %).
  - The new edges only link modules that were already loaded: `host → runbar`, `bind → ctx/budget`
    and `ctx/tokens`, `common → strings`, `library → strings`.
  - The loader still imports every row with one `Promise.all`, and none of the new edges forms a
    cycle.
- **The two `c1` races were latent in the tests, not in the product.** Both scenarios read
  Computer-owned state right after `LolChat.ready`, without waiting for `LolComputer.ready`:
  - `graph.*` strings, which only the Computer's modules register;
  - `LolComputer.app.ask`.
- **No user-visible race sits behind them.**
  - LOL Chat never reads `graph.*`.
  - The Computer's own surface waits for its own loader.
- The new `waitFor(LolComputer.ready)` lines are the correct fix.

## New findings

### Major

**S2-1. A long input now gets a 512-token answer, which a thinking model is sure to overrun. This
regresses S1-3.**
- **Where:** `graph/bind.mjs` `planFor` (the `if (window)` branch) and `clampMaxTokens`.
  - `maxTokens` is `min(ceiling, window − whole prompt − 256)` with a floor of 512, computed from the
    **untrimmed** prompt. The prompt is then cut to whatever that answer leaves.
  - So the prompt wins every time and the answer gets what is left.
  - Before S1 it was the other way round: the prompt was cut to `window − 4096`, and the answer got
    2048 (prose) or 4096 (code).
- **Measured** (the real `planFor`, the real `budgetFor`, a "Summarise the report in a page"
  Instruction):

  | Window | Input | `max_tokens` sent (prose / svg) | Before S1 |
  |---|---|---|---|
  | 32k (no advertised window) | 40k-token document | **512 / 512** | 2048 / 4096 |
  | 16k slot | 20k | **512 / 512** | 2048 / 4096 |
  | 16k slot | 15k | **1022 / 757** | 2048 / 4096 |
  | 8k slot (16k at `parallel 2`) | 9k | **512 / 512** | 2048 / 4096 |

  - `shell/test/chat/unit/computer-s1.test.mjs:194-201` **asserts** the 512 ("A prompt bigger than
    the slot: the floor").
- **Scenario:**
  1. Wire a 60-page PDF (Document box) or a long Text into an Instruction: "Summarise the report in a
     page". This is the Research template's shape.
  2. The answer is capped at about 350 words.
  3. On a thinking model (gemma4 spent 396–601 tokens thinking before *one sentence* on the rig), it
     fails every time with `errCutOffThinking`.
- **Fix:** guarantee the answer a share, then cut the prompt to fit around it.
  - Let `answerMin = min(ceiling, max(MAX_TOKENS_FLOOR, floor(window / 4)))`. That is 4096 on a 16k
    slot and 8192 on 32k.
  - Send `maxTokens = max(answerMin, min(ceiling, window − prompt − MARGIN))`.
  - Keep the existing re-cut: `budgetFor(window, {reserve: maxTokens + fixed})`, and assemble with
    that budget whenever the whole prompt exceeds it.
  - A short prompt still gets the whole ceiling, so nothing changes for the case S1-3 was about.
- **Test:** change the `huge` assertion in `computer-s1.test.mjs` to "16k slot + 30k input:
  `maxTokens` = 4096, the prompt is cut, and prompt + answer ≤ 16384". Add the 15k-on-16k case
  (4096, cut) and the 10k-on-16k case (about 6k, not cut, as today).

**S2-2. A stale box behind an unpressed Button reads "Nothing to run — every box is up to date"
and offers "Run everything again".**
- **Where:**
  - `graph/runner.mjs:728-742` (`skippedManual`) marks the box `stale` and counts it in `skipped`.
  - The report has no field that says a Button held something back.
  - `computer/runbar.mjs` `outcomeOf` falls through to `nothing` (`!ran && !barred`).
  - `nothingRan()` is true, so the bar offers the re-roll. S1-1 promised this could only happen
    after a run that really found nothing to do.
- **Probe (real click):**
  1. Button → Instruction. Click Run all.
  2. The report is `{ran:0, skipped:1}` and the states are `button:idle`, `ask:stale`.
  3. The bar and the live region both read **"Nothing to run — every box is up to date."**
  4. **"Run everything again" is shown.** Its `force` run still skips the unpressed Button, so it
     re-rolls every other box and leaves this one stale.
- **Correct behaviour:** "Waiting for a press: press “{button}” to run the box after it" (plural:
  "the {n} boxes after it"). No "Run everything again".
- **Fix:**
  - `runner.mjs`: when `skippedManual` blocks a part, record the manual upstream id in a report
    field `heldBy: string[]`, unique Button ids.
  - `runbar.mjs` `outcomeOf`: add a `held` outcome ahead of `errors` and `nothing` when
    `heldBy.length`, using the first Button's title and the count of blocked boxes.
  - Two string keys in `computer.en.mjs`.
- **Test:**
  - Unit: `outcomeOf({ran:0, skipped:1, heldBy:['b']})` gives `held`, and `nothingRan` is false.
  - Scenario: the probe above. The sentence names the Button, "Run everything again" is hidden,
    and pressing the Button's face then runs the Instruction.

### Minor

**S2-3. In a box taller or wider than the view, Tab snaps the view to the box's top and the focused
control stays off screen.**
- **Where:** `graph/canvas.mjs` `followFocus`.
  - It pans to show the whole **box** (`partById(...)` rect).
  - `panToShow`, when the rectangle does not fit, aligns the box's top-left and ignores where the
    focused control is.
- **Probe (real keys):**
  1. An Instruction at 350 % (1050 px tall; the canvas runs from y 88 to 795).
  2. Click the prompt, then press Tab.
  3. The Model picker gets focus at y 840, the seed field at 945, 🎲 and ✕ at 951, and the "sends N
     words" strip at 1050. Every one is `inView=false`, and the view stays at y 24.
- **Related:** the tutorial's "Tab goes from box to box, and the view follows" is false here.
- **Fix:**
  - Pan to the **focused element's** rectangle (client rect → world through `view`) when the box
    does not fit, and keep the whole-box pan when it does.
  - Also follow only a focus change that a Tab key caused: set a flag on `keydown` when `key ===
    'Tab'`, instead of `focusByPointer = false` on every key. A programmatic re-focus after a
    keystroke then never moves the view. That covers the palette's Escape restore, the drawer's, and
    the window regaining focus.
- **Test:** the probe as a scenario: after each Tab, the focused element is inside the canvas.

**S2-4. The verdict ceilings are not clamped to the window, though the Instruction's are.**
- **Where:**
  - `graph/parts/condition.mjs` and `filter.mjs`: `maxTokens: VERDICT_MAX_TOKENS` (4096), sent
    as-is.
  - The Instruction clamps to `window − prompt − 256` (`bind.mjs clampMaxTokens`).
- **Scenario:**
  - On a farm routed to the `external` engine (vLLM or SGLang), which rejects prompt + `max_tokens`
    beyond `max_model_len` with a 400, a Filter in "the model says" mode over ~5k-token items on an
    8k slot fails every item: "The farm could not answer: … maximum context length…".
  - Before S1 it asked for 512 and fit.
  - llama.cpp and Ollama stop at the window instead, so the owner's farm is not affected today.
- **Fix:** `clampMaxTokens({ceiling: VERDICT_MAX_TOKENS, window: trustedBudget(caps),
  promptTokens: promptTokensOf(system, prompt, 0)})` in both parts, with the same floor.
- **Test:** unit. An 8k window with a 6k prompt sends at most 8192 − 6000 − 256.

**S2-5. `computer.loopLesson` now reads "No lesson on loops yet", but it is only ever drawn once
the lesson ships.**
- **Where:**
  - `strings/computer.en.mjs` has `loopLesson: 'No lesson on loops yet'`, and its comment says the
    button is drawn disabled.
  - The integrator changed `canvas.mjs` `sayLoopUngated` to draw **no** button until
    `tut.has('l10-loops')`. At that point the button that opens the lesson would read "No lesson on
    loops yet".
- **Fix:** `loopLesson: 'Open the lesson on loops'`, and correct the comment.
- **Test:** none needed. It is a string, and it is dormant until `l10-loops` ships.

## Smallest fix set (one builder)

1. **S2-1:**
   - `graph/bind.mjs`: add `answerMin` in `clampMaxTokens`/`planFor`.
   - `shell/test/chat/unit/computer-s1.test.mjs`: fix the `huge` case, and add the 15k and 10k
     cases.
2. **S2-2:**
   - `graph/runner.mjs`: add `heldBy`.
   - `computer/runbar.mjs`: add the `held` outcome.
   - `core/types.mjs`: document `heldBy` in the `RunReport` typedef.
   - `strings/computer.en.mjs`: add the two keys.
   - Unit test, and a new case in `k10-run-outcomes.mjs`.
3. **S2-3:** `graph/canvas.mjs` `followFocus`: pan to the focused element's rect, on Tab only. Add a
   case in `k10-canvas-lessons.mjs`.
4. **S2-4:** `graph/parts/condition.mjs` and `filter.mjs`: clamp the verdict `maxTokens`. Unit test.
5. **S2-5:** `strings/computer.en.mjs` `loopLesson` and its comment.

**Acceptance:**
- `chat-unit` and `chat-lint` green; `--phase k8`, `k9` and `k10` green on one slot.
- The S2-1 table re-run gives at least 4096 on the 16k rows and at least 8192 on the 32k row.
- The S2-2 scenario: the Button is named, and "Run everything again" is hidden.
- The S2-3 scenario: every tabbed control is on screen.
- The rig result on gemma4:12b (SVG, p5 and three each at least 4/5) still decides the S1-3 half.

With these landed I expect to be **HAPPY**, pending the rig.

---

## Round S3 (2026-09-25): the S2 fix set

**Verdict: HAPPY.** S2-1 to S2-5 are all fixed, and nothing blocking or major is left. The rig
condition is met: gemma4:12b drew SVG, p5 and three.js 5/5 each after S1.

One new minor (S3-1) and one note remain. Both are two-line changes. They can ride with this commit
or go in the next polish pass.

**How this was checked**
- **Code:** the uncommitted tree on top of `f34a501`. I read every source diff: `bind`, `runner`,
  `runbar`, `host`, `button`, `canvas`, `condition`, `filter`, `instruction` and the strings.
- **Gates:**
  - `chat-unit`: 1523 passed, 0 failed.
  - `chat-lint`: 0 violations.
  - On slot 7: `--phase k10` 15/15, `--phase k8` 35/35 and `--phase k9` 5/5. The k8 flake from S2
    did not recur.
- **Throwaway real-input probes on slot 7** (`zz-critic-s3-{a,b}.mjs`, now deleted), clicking the
  Button's face and pressing Tab and Shift+Tab:
  - Button then Instruction then Instruction, before and after pressing the Button;
  - the Button pressed **during** a run;
  - Tab and Shift+Tab through an Instruction at 350 %;
  - a pointer click, to confirm it does not pan.
- **Node:** the real `planFor` over 8k, 16k and 32k windows, with 9k–40k-token inputs and with 4–6
  pictures.

| # | Status | Evidence |
|---|---|---|
| S2-1 a long input leaves a 512-token answer | **Fixed** | See the S2-1 details below. |
| S2-2 an unpressed Button reads "up to date" | **Fixed** | See the S2-2 details below. |
| S2-3 Tab inside a box taller than the view | **Fixed** | At 350 %, every Tab stop is in view, both ways: Model, Answer shape, seed, 🎲, ✕ and the strip going forward, then ✕, 🎲 and seed coming back. A pointer click does not pan. Only a focus change caused by Tab moves the view. |
| S2-4 the verdict ceilings were unclamped | **Fixed** | `verdictMaxTokens` clamps 4096 to the window, per Filter item, floor 512. There is no import cycle: `condition` imports `instruction` and `bind`, and `filter` imports `condition`. |
| S2-5 the `loopLesson` label | **Fixed** | "Open the lesson on loops"; the comment is corrected. |

S2-1 in detail:
- **Answer size:**

  | Window | Input | `max_tokens` |
  |---|---|---|
  | 32k | 40k tokens | **8192** |
  | 16k slot | 20k or 15k | **4096** |
  | 16k slot | 10k | about 6k; the prompt is not cut, as before |
  | 8k slot | 9k | **2048** |

- **Fit:** every text row totals at most the window minus 256.
- **Prompt:** the prompt is cut, and says so.

S2-2 in detail:
- **Before the press:** the bar and the live region say "Waiting for a press: press “Go” to run the
  2 boxes after it." "Run everything again" is hidden.
- **The report:** `heldBy` holds the Button and `held` holds both boxes downstream.
- **After a real click on the face:** "3 boxes ran in 0.2s." All three boxes are done.

**S3-1 (minor). A Button pressed while the run is going: the held box runs, but the bar still says
it is waiting.**
- **Where:** `graph/runner.mjs`.
  - `held` and `heldBy` are filled when a box is skipped, and never emptied again.
  - `mergeInto` (§4.4) takes the pressed Button and its downstream back into the run
    (`blocked.delete(q)`), but leaves both sets alone.
- **Probe (real click):**
  1. A 5 s Timer and, separately, Button “Go” then an Instruction. Click Run all.
  2. The Instruction is skipped as held, and the Timer waits.
  3. Click “Go” mid-run. The press merges (`merged: 2`), and the Instruction runs and ends `done`.
  4. The bar and the live region say **"Waiting for a press: press “Go” to run the box after it. ·
     3 boxes ran in 5.0s."**
- **Fix:** in `mergeInto`, `held.delete(q)` for each merged id. Drop a Button from `heldBy` once it
  is merged, or once no id in `held` is still behind it. Alternatively, filter both at `finish()`:
  `held` to ids still `stale`, and `heldBy` to Buttons that still hold no value.
- **Test:** the probe as a k10 case. After the mid-run press, the outcome is "3 boxes ran…" with no
  `held`.

**Note (not a finding): pictures cannot be cut, so the answer's guaranteed share can overrun a
small slot.**
- Four pictures on an 8k slot are estimated at 6637 prompt tokens. Adding `answerMin` 2048 gives
  8685, which is over 8192. Before S2-1, the clamp would have sent about 1300.
- **Farm behaviour:**
  - llama.cpp and Ollama stop at the window, so the answer ends as "cut off".
  - An `external` vLLM or SGLang farm would refuse it with a 400.
- **Why it is rare:** `IMAGE_TOKENS` (1600) errs high, the owner's farms run far larger windows, and
  four pictures into one 8k slot is unusual.
- **If wanted:** in `planFor`, cap `maxTokens` at `window − (image tokens + system) − MARGIN` when
  that is smaller than `answerMin`, and keep the 512 floor.

**Sign-off.**
- **Results:**
  - Series S found 16 defects in S1, and S2 found 5. All 21 are fixed and checked, with real input
    wherever a hand was involved.
  - The rig passes on gemma4:12b, 15/15, after S1.
- **The loop ends here unless the owner wants another round.** S3-1 is the one thing I would fold
  in before this commit.
