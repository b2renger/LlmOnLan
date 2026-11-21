# LOLVIBE_POC_PLAN: a student builds a small web application in LOL Vibe, start to finish

**Status: proposed, for the owner** (night n° 12, 2026-11-21; plans ▸ Next 15). Not approved: no code before the
owner's yes. Size **M** (each step **S**).

## Why

The owner, 2026-11-14: "I am not convinced about what we have right now in lol vibe ... we need a better lol vibe
experience for the users and we should be able to build a poc web application". The facts came first: night n° 5
walked LOL Vibe through a reading-list application as a student would ([SESSION_REVIEW_2026-11-15](../reviews/SESSION_REVIEW_2026-11-15.md)):
built in 20.5 s and working, with four stumbles (M2, M3, L2, L3).

## What exists now (read 2026-11-21)

- **Built since:** the page beside its code, edited live, and a pop-out window ([VIBE_PAGE_PLAN](VIBE_PAGE_PLAN.md),
  unreleased; L2's cramped Preview is the side column's job now); *Plan first* beside the message box
  ([STUDENT_PLAN_MODE_PLAN](STUDENT_PLAN_MODE_PLAN.md), unreleased); a model line that says Qwen3.6 was tried, not
  untried (M3, `projects/models.mjs` `tried`); the agent at 128k, 5/5 on its five tasks (RESULTS 2026-11-21).
- **Still as found:**
  - **M2, a project's data is lost at every restart.** The Preview server listens on port 0 (`src/main/studio.ts:1059`),
    so each launch serves the project from a new origin, and the page's `localStorage` (where a student's list lives) is
    per origin. A reload keeps it; a restart of LlmOnLan does not.
  - **L3, words and the first look.** The empty chat says *Chat directly with the farm.* (`strings/core.en.mjs:16`) and
    offers no example; the context meter says *advertised* (`strings/context.en.mjs:12`); a *Thought for 0s* row shows on
    a reply that did not think; and the agent ends with "Open index.html in a browser" while the Preview shows it.
  - **A picture cannot reach the agent** ([PICTURE_TO_PAGE_PLAN](PICTURE_TO_PAGE_PLAN.md), step 2 for the owner).

## What would change

1. **The page keeps its data** (M2). **Built the same night, as a review finding (approved in advance):** each
   project's Preview asks for its last port again (`DATA_DIR/lol-studio/preview-ports.json`), so its origin, and what
   its page kept in the browser, survives a restart; a taken port moves and is remembered. A studio test reproduced
   it first (a second studio on the same data folder got another origin) and passes now. Left for the owner: the
   panel saying "the page starts empty this once" when the port had to move (a new line of text).
2. **A first look that shows what to do** (L3): a new project chat shows three example asks a student can click to put
   in the message box (a page with a form and a list kept in the browser; a three.js scene; a quiz with a score), and
   the empty chat says what LOL Vibe is in plain words. Strings and one harness scenario. **S**.
3. **The words** (L3): the meter without *advertised*; no *Thought for* row on a reply that did not think; the agent's
   skill told that the Preview shows the page, so it says "look at the Preview" instead of "open it in a browser". **S**.
4. **The audit again, as the proof:** the reading-list application built again end to end as a student (a form, a list,
   delete, kept in the browser, a restart in the middle), each step on screen, against night n° 5's stumbles; HUMAN_TESTS
   gets the same five-minute walk for a student's laptop. **S**.

Not in this plan: the picture hand-over (PICTURE_TO_PAGE_PLAN); templates for whole projects (a later question, if the
examples are not enough).

## Questions for the owner

1. **Steps 1–4 as written?** *Recommended:* yes; step 1 is the one a student would lose work to. *Default if no
   answer:* not built.
2. **The three example asks** (step 2): a form and a list, a three.js scene, a quiz? *Recommended:* those three, the
   kinds a class asks for first. *Default:* those three.
