# AGENT_FIRST_STEP_PLAN: when the coding agent only thinks, then stops, ask it once to go on

**Status: proposed, for the owner** (night n° 13, 2026-11-22). Size **S**. Nothing built beyond the sentence below.

## What happens

Night n° 13's Ollama trial (RESULTS, "Ollama 0.40.17 against 0.40.16") ran LOL Vibe's coding agent on its five tasks
90 times with Gemma 4 26B, the farm's default model on Ollama. **3 of the 90** ended in about 2 seconds with nothing:
the model's first step was a thought (*"First, I'll explore the codebase to locate the files…"*, ~250 tokens), then
`stop`, with no text and no tool call, and dsh ended the turn (read in dsh's session log). It happened on both Ollama
versions (1 and 2), always on the refactoring task. None of the ~250 agent tasks stored before tonight
(`docs/spike/results/ide/`, vLLM and Ollama 0.33.0, Gemma 4 26B among them) shows it; at 1 in 30, 0 of 15 on Ollama
0.33.0 proves nothing either way. On vLLM 0.34.0 the same night: 0 of 30 (which, at 1 in 30, says little either).

A student sees an empty reply. Since tonight it at least says so (*"The coding agent stopped before it did anything:
nothing changed. Send your message again, or press Regenerate."*, `projects/agent.mjs` `resultOf`, built as a reproduced
bug); before, it pointed to the Changes tab, which shows an earlier reply's changes.

## What would change

**When a turn ends at its first step with no text and no tool call, LlmOnLan asks the agent once, in the same session
and the same reply, to go on:** *"Do the task now: use your tools."* The step log says so (*↻ asked to go on*), and a
second empty step ends the turn as tonight (the sentence above). Never more than once a turn; never in Plan first (a
plan is text), never when the turn wrote any text or made any call, never after Stop.

Where: the renderer's turn (`projects/agent.mjs` `startAgentTurn`) already folds every record and knows the three facts
(steps, text, calls). On main's `done` with nothing done, instead of finishing, it calls `door.prompt` once more with the
nudge as the text (a new turn id, the same state, so it stays one reply); main keeps the thread's agent session between
prompts, as **Go ahead**'s carried-out message shows (k24), so the agent sees its own first step. Main and dsh are not
changed.

Not this way: a dsh `Stop` hook (dsh supports one: `dsh-hooks-claude-code`, *turn-stopping*, a `deny` steers the agent
with its reason). It is the natural place, but dsh gives the hook an empty `transcript_path`, so it cannot tell a turn
that did nothing from one that answered a question in words.

## Tests

- A unit test: a turn of one thought and `stop` gets the follow-up once; a turn with text, with a call, in Plan first,
  or stopped, does not; a second empty step ends the turn with the sentence.
- The mock dsh (`test/mock-dsh.mjs`) learns a message that thinks only on its first step; a k24 scenario sends it and
  sees one reply that did the task, with *↻ asked to go on* in its step log.
- The same 90 tasks again on the farm's default model: no empty reply.

## For the owner

Approve as written, or say *no*: the sentence alone stays (the student resends). Costs one more farm request in about
1 task of 30, on that student's seat.
