# AGENT_LOOP_PLAN: stop LOL Vibe's coding agent when it goes round in circles

**Status: proposed, for the owner** (night n° 13, 2026-11-22). Size **S**. Nothing built.

## What happens

Night n° 13 ran LOL Vibe's coding agent on its five tasks with Gemma 4 26B on vLLM 0.34.0 (RESULTS, "Ollama 0.40.17
against 0.40.16", its vLLM paragraph). In 30 tasks, 4 ran past 300 s in one reply; the worst, the TDD task,
went **205 steps and 782 s**: it wrote the test file 92 times, and 57 of its edits failed with the same error (*"old_string
and new_string must differ"*). On 2026-11-06 (vLLM 0.33.0) the same model had one such run in 15 (309 s, 111 steps); on
Ollama its longest tonight was 145 s.

Nothing stops it: LlmOnLan's studio sets no step limit, and dsh's own `repeat-tool-reminder` only adds a note for the
model. The student waits, and **the reply holds the student's farm seat the whole time** (a class runs out of seats
first: 24 at 128k on the PRO 6000). Stop works, if the student thinks of it.

A step limit alone would be wrong: tonight, runs that passed took up to 109, 126 and even 407 steps (1,143 s).

## What would change

The Computer's Agent box already stops a run that repeats itself (`graph/parts/agent.mjs` `loopOf`: the same step and
result three times in a row, or two alternating, A B A B; built 2026-11-18). **LOL Vibe's turn would use the same rule on
the agent's tool calls and their results** (`projects/agent.mjs`: each `call` and `result` record is already folded
there): on a match it stops the turn (`door.stop`, as Stop does) and the reply says why: *"The coding agent was going
round in circles (the same <tool> on <file>, failing the same way). It was stopped; what it did is kept. Ask again, in
smaller steps."* Never in a **Keep going** loop's rounds (they have their own cap), only within one reply.

## Before it is built: the evidence

Step 1, no code in the app: replay the rule on the agent's session logs of tonight's 120 tasks (90 on Ollama, 30 on vLLM) (dsh's
`session.v4.jsonl.zstd`, in the session's scratch until it is cleaned, or a fresh run) and count where it would have
stopped: in runs that passed (a cost) and in runs that failed or ran past 300 s (the gain). Built only if it stops no
passing run, or the owner accepts the few it would.

## Tests

- The unit test of the rule on recorded sequences (one that repeats, one that alternates, one long but varied).
- The mock dsh learns a turn that repeats a failing edit; a k24 scenario sees the turn stopped with the sentence.

## For the owner

Approve as written (with step 1 first), or say *no*: Stop stays the student's to press.
