---
name: lol-review
description: Runs the adversarial review of LlmOnLan that every fifth session is - the code, the docs, and the in-app documentation and tutorials, each checked against the others and against a running app. Use it when the session number is a multiple of 5, or when the owner asks for a review.
argument-hint: "[area to weight, optional]"
---

# The fifth-session review

A review session builds nothing. Its job is to find what is wrong, missing or untrue, and to prove each finding.
Assume the last four sessions made mistakes: they did.

## Scope: the work since the last review, then one deep area

1. `git log` since the last review's summary (the last file in `docs/reviews/` named `SESSION_REVIEW_*`), and the four
   session summaries since. Everything they changed is in scope.
2. One area in depth, in rotation, so the whole project is covered over time: the farm → the client shell and Open
   WebUI's contract → LOL Vibe and the IDE → the Computer → the Farm app and the releases → then again. The last
   review's file says which one it took. `$ARGUMENTS` can name one instead.

## Three passes, each trying to break something

**1. The code.** For each change in scope: what input, state or order of events makes it wrong? Read it as someone who
wants it to fail: a second click, a file that is missing, a farm that answers slowly, a person who cancels, two clients
at once, a restart in the middle. Check that each has a test that would catch its regression, and run the suites.
Privacy and safety first: anything that sends, logs, stores or runs what another party wrote.

**2. The docs against the code.** Every statement in `CLAUDE.md`, the touched context modules, the READMEs and
`HUMAN_TESTS.md` that the changes could have made false. A number, a default, a file name, a button's label: open the
code and compare. A doc that says "tested" names a test that exists and passes.

**3. What a person sees.** The in-app text, help, lessons and templates (`shell/renderer/chat/strings/`,
`computer/tutorial/`, `computer/examples/`, the farm panel's page, the Farm app's wizard). Run the client harness and a
scratch farm (the skill `lol-scratch-farm`) and walk the changed paths as a teacher would on a first day: is each
sentence true, is it plain, does the next step exist? A lesson that cannot be followed to its end is a finding.

Use the `search`, `grep` and `docs` explorers to cover ground, then **verify each of their claims yourself** before it
becomes a finding. Consult the advisor on the findings list before you write it up: which are real, which matter most.

## What a finding is

`severity (high / medium / low)` · `where (path:line, or the screen)` · `what is wrong` · `how you proved it (the
command, the input, what happened)` · `the fix you propose`. A suspicion you could not prove is listed apart, as a
question. No finding without its proof.

## Output

1. `docs/reviews/SESSION_REVIEW_<date>.md`: the scope, the area taken in depth, the findings by severity, the
   questions, and what was checked and found sound (so the next review does not redo it).
2. Fix, in this session, the high findings whose fix is small and sure, each with its test. File the others in
   `docs/plans/README.md`.
3. The session summary (the skill `lol-session`, step 4) says how many findings, how many fixed, and what comes next.
