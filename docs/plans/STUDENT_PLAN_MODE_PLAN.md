# STUDENT_PLAN_MODE_PLAN: the coding agent proposes, the student approves

**Status: approved by the owner, 2026-11-20** (the chat, 12:46: "yes, we can build", as written; its two questions
take their recommendations: a switch per thread, off by default; the Agent box left out). From plans ▸ Next 13 and
[the Qwen Code review](../research/QWEN_CODE_2026-11-14.md) item 5 (owner 2026-11-14: "those are good, we need to
include those in our plans"). Written 2026-11-20. Size **M**.

## Why

A student who asks LOL Vibe's coding agent for a change sees files change before understanding what will happen. In a
teaching mode the agent first writes **what it will do and why**, the student reads it, and only an approval lets it
change the project. The student learns to read a plan, and catches a wrong direction before it costs a project.

## What exists (read in the code on 2026-11-20; nothing run)

- **dsh, the agent's runtime, has a plan mode of its own,** but LlmOnLan cannot reach it:
  - it is entered by a `/plan` command and left through an `exit_plan_mode` review (*Approve* or *Keep planning*);
    without a channel to answer that review it fails closed (`dsh-plan-mode/README.md`, *Entering and leaving plan
    mode*, *The reviewed exit*);
  - the runtime's JSON-RPC server answers only `initialize`, `session/prompt` and `shutdown`
    (`dsh-sdk-jsonrpc-server/lib/index.js:195-202`). Using dsh's mode means changing a runtime we build from a pin: not
    the way.
- **LlmOnLan's own fence already decides every file tool call.** A PreToolUse hook (`shell/src/main/studio.ts:861-875`,
  matcher `read|glob|grep|read_image|write|edit`) runs `FENCE_JS` (`:756-780`), which already refuses writes to
  `project.json` and `.git`. Refusing **every** `write` and `edit` while a plan is asked for is the same mechanism.
- **The thread already carries the plan to the next turn:** each turn starts with a recap of the thread
  (`studio.ts:583`), so a turn that says "carry out the plan above" has the plan in front of the model.
- **The student has no way to pause a turn today.** Stop is the only control (`studio.ts:597-601`,
  `renderer/chat/projects/agent.mjs:213`).
- **The Computer's Agent box changes nothing outside its box:** no file, no device, no output it could arm
  (`renderer/chat/graph/parts/agent.mjs:13`). A plan mode there would only show steps before computing them.
  **Proposed: not in this plan.**

## What would change

1. **A *Plan first* switch** beside LOL Vibe's message box in a project thread, off by default. **It is new: a
   button, the owner's call.**
2. **A planning turn** (the switch on):
   - the fence refuses `write` and `edit` for that turn, with the reason *planning: nothing is changed until you
     approve*. It knows from a marker file the shell writes in `DATA_DIR/lol-studio/dsh` before the turn and removes
     after it. ponytail: one file; the upgrade path is dsh's own review channel, if its runtime ever serves one;
   - the message sent is the student's, plus one line asking for a numbered plan: the files it would create or change,
     what each change does, and how to check it worked. Reading the project is allowed, so the plan rests on what is
     there.
3. **The plan reply carries two buttons:**
   - **Go ahead** sends a normal turn, *Carry out the plan above*, with the fence back to normal;
   - **Change the plan** puts the cursor in the message box, for the student to say what to change, and the next turn
     plans again.
4. **Strings and help** (`renderer/chat/strings/`): the switch, the two buttons, the refusal's reason, a line in LOL
   Vibe's help and in the tutorial that introduces the coding agent.
5. **Tests:**
   - a unit test of the fence with the marker (`write` refused, `read` allowed, the marker gone after the turn,
     even when the turn fails or is stopped);
   - a harness scenario on the mock farm: plan, approve, files written only after *Go ahead*.

## Questions for the owner

1. **Is a switch the right shape,** or should a project (or the whole class) be in plan mode by default, set by the
   teacher? *Recommended:* a switch per thread, off by default; a teacher default later if classes ask for it.
2. **The Agent box left out?** *Recommended:* yes. It cannot change anything outside itself.

**Done when** (after approval): the switch, the planning turn, the two buttons and their strings exist; the unit test
and the harness scenario pass; `docs/context/client.md`, the help and the tutorial say it; HUMAN_TESTS has a
five-minute test for a student's laptop.

## Built (2026-11-20, by day after the owner's yes; unreleased)

As written, with four choices the session made, each for the owner to overturn:
- ~~**Where the switch is:** in the Project panel's top bar beside *Keep going until done* and *Use the Computer*, kept
  **per project** like them, not beside the message box per thread.~~ **Moved on 2026-11-21** (night n° 12; n° 11's
  question 7 had no answer, its default taken): **beside the message box, one per chat**, as the plan was approved. The
  composer's action slot (`COMPOSER_ACTIONS`, unused until then) holds it, in a chat bound to a project; its note sits
  above the message box. The harness scenario checks it is absent from a plain chat, on for its own chat, and its note.
- **The Computer's tools are refused too** while planning, when *Use the Computer* is on: the fence also runs before
  `mcp__computer__*` calls (a second hook group; it skips the file checks there). Otherwise a plan could still build
  or run a graph. So is `create_goal`, so a plan with *Keep going until done* on never starts a loop.
- **The buttons stay under every plan of the chat** (a reply's buttons are built once and cannot tell the last one);
  *Go ahead* carries out the newest plan. Marked `ponytail:` in `ui/project-panel.mjs`.
- **The go-ahead is the message, not a state:** a message that says exactly *Carry out the plan above.* is never
  planned, so Regenerate on it carries out too, and nothing is left armed by a click whose send failed.

Checked: the studio unit tests (the tools the real dsh offers, asserted: `write` and `edit` are the only ones that
change files; the fence with the marker: write, edit, `create_goal` and the Computer's tools refused, reads allowed; the marker set, gone at the end, gone on Stop, and a leftover one cleared before a normal turn; the plan and
its Go ahead in one session) and **the real dsh runtime** (`shell/dsh/build`) refusing the write in its Windows
sandbox while planning and letting it through after; the harness scenario
`k24-plan-first-changes-nothing-until-go-ahead` (3/3 alone); the chat suite. Not checked: a real model's plans on a
farm (HUMAN_TESTS G14), macOS and Linux (where the fence's own coverage is HUMAN_TESTS E4).
