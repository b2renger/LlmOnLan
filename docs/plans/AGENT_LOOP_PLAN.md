# AGENT_LOOP_PLAN: stop LOL Vibe's coding agent when it goes round in circles

**Status: proposed, for the owner** (night n° 13, 2026-11-22). Size **S**. Nothing built in the app; the evidence
below was measured the same night.

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

## The evidence, measured the same night: the Agent box's rule does not transfer

The Computer's Agent box stops a run that repeats itself (`graph/parts/agent.mjs` `loopOf`: the same step and result
three times in a row, or two alternating, A B A B). Replayed on dsh's session logs of tonight's 120 agent tasks (90 on
Ollama, 30 on vLLM; `docs/spike/runs/agent_loop_replay.js` and `agent_error_replay.js`, on each run's `IDE_DATA`), it
would have stopped **16 passing tasks** (21 with a looser key, the tool and file without the arguments) for 3 failing
ones: normal work repeats itself (write the test, write the code, write the test…). Not that.

**A narrower rule, the same failure repeated** (the same tool on the same file, failing with the same error, anywhere in
the reply), replayed the same way:

| Stop at the same failure… | Passing tasks stopped | Failing tasks stopped | Of the 4 replies past 300 s |
|---|---|---|---|
| 3 times | 5 | 3 | 2 |
| **5 times** | **1** | **3** | **2** |
| 10 times | 1 | 2 | 2 |

All four hits at 5 are one error, dsh's *"old_string and new_string must differ"* (an edit that changes nothing): 44
times in the one passing task (it passed after 385 s), 30 times in the 782 s failure. The 1,143 s run (407 steps,
passed) never repeats a failure: no rule of this kind catches it.

## What would change

At the **fifth identical failure** in one reply, LlmOnLan stops the turn (`door.stop`, as Stop does; `projects/agent.mjs`
already folds each `call` and `result` record) and the reply says why: *"The coding agent was going round in circles:
<tool> on <file> failed five times the same way (<error>). It was stopped; what it did is kept. Ask again, in smaller
steps."* Never across a **Keep going** loop's rounds (they have their own cap), only within one reply. The known cost,
from the replay: 1 passing task of 109 stopped (one that passed after 385 s); the gain: 3 failing replies ended early,
the 782 s one among them.

## Tests

- The unit test of the rule on recorded sequences (the same failure five times, interleaved with other calls; four
  times; five different failures).
- The mock dsh learns a turn that repeats a failing edit; a k24 scenario sees the turn stopped with the sentence.

## For the owner

Approve the fifth-failure rule as written, or say *no*: Stop stays the student's to press. The long run that repeats no
failure (1,143 s) would need another kind of limit (how long one reply may hold a seat), a question of its own.
