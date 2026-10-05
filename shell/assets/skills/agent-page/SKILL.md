---
name: agent-page
description: >
  Build an AGENT PAGE: a web page in this project whose own JavaScript runs an
  agent loop with the LAN farm's model — a quiz master, a tutor, a planner, a
  game master, a helper that computes or draws with the page's own tools. Use
  when the user asks for "an agent", "an assistant in the page", "a page that
  talks to the model", "a chatbot page", or a page that should think in steps.
  The loop library and the farm's address are served by LlmOnLan; you write
  index.html with the page's tools and its UI.
license: MIT
---

# Agent pages

LlmOnLan serves two things to every project page opened on this computer (the Preview, "Open in browser"):

- `/lol-agent.mjs` — the loop library (an ES module);
- `/lol-farm.json` — where the farm is (the library reads it itself).

So a page never needs a URL or a password written in it. **Never** put a password, a token or a key in the files.

## The library

```js
import { runAgent, ask, setKey } from '/lol-agent.mjs';
```

- `runAgent({ task, tools, maxSteps, onStep, onWait, signal })` → `{ answer, steps, stopped? }`. The model works in
  short steps: at each one it picks ONE of `tools` (or answers). The library runs the tool, shows the model its result
  at the next step, feeds back a wrong or malformed step, and makes the last step answer. `stopped: 'max-steps'` means
  it never answered.
- When the farm is full (every seat taken) and you pass `onWait`, the library waits for a seat and tries again by
  itself, for up to 5 minutes, when the farm says one frees by then. Before each wait it calls
  `onWait({ seconds, waited, message })`; `message` is a sentence to show as it is, like "The farm is full: a seat
  frees in about 2 min; checking again in 60 s." Stop (`signal`) ends the wait too. Without `onWait` it does not
  wait: it throws at once.
- A tool: `{ description: 'what it does, in a sentence', args: { name: 'string' | 'number' | … }, run: async (args) =>
  result }`. Whatever `run` returns is the result; whatever it throws is an error the model reads and can fix.
- `ask({ messages, json, maxTokens, onWait, signal })` → the model's text, for a single answer without a loop.
- `setKey(password)` — only for a farm with a password: ask the PERSON (an input field on the page), never guess it.

## Write the page like this

1. **Tools are the page's own abilities** — plain JavaScript: compute (numbers come from code, never from the model),
   read or change the page (the board, the score, the list), draw on a canvas, `speechSynthesis.speak()`, `fetch` a
   public API the PERSON named in the request (no other address). Name them with verbs (`roll_dice`, `check_answer`,
   `draw_chart`) and describe each in one sentence.
2. **The task** is a sentence built from what the person typed or clicked, plus what the page knows.
3. **Show every step**: `onStep` gets `{ tool, args, why, ok, result | error }`, or `{ tool: 'answer', answer }` at
   the end. Print them in a list, so the person sees the agent think.
4. **A Stop button**: an `AbortController`; pass `signal`.
5. **Small loops**: `maxSteps` 4–8. Every step is one generation on the farm, and the farm is shared.
6. **Say why it is waiting**: pass `onWait` and show its `message` in a status line, so a full farm reads as a wait
   and not as a frozen page. Clear the line at the next step and when the run ends.
7. **Errors are sentences**: `runAgent` throws with a readable message when the farm needs its password, did not
   accept it, does not answer, or stays full longer than the page waits; show it. Whenever the message names
   `setKey`, show a password field, call `setKey(value)`, and let the person try again.
8. One `index.html` with a `<script type="module">` is enough; add a `.js` file only when it is long.

## A skeleton

```html
<!doctype html>
<meta charset="utf-8">
<title>Dice coach</title>
<input id="q" placeholder="Ask me about dice…"> <button id="go">Ask</button> <button id="stop" disabled>Stop</button>
<p id="status"></p><ol id="steps"></ol><p id="answer"></p>
<script type="module">
import { runAgent } from '/lol-agent.mjs';
const tools = {
  roll_dice: { description: 'Roll n six-sided dice and return the faces.', args: { n: 'number' },
    run: ({ n }) => Array.from({ length: Math.min(20, Number(n) || 1) }, () => 1 + Math.floor(Math.random() * 6)) },
  sum: { description: 'Add a list of numbers.', args: { numbers: 'number[]' },
    run: ({ numbers }) => numbers.reduce((a, b) => a + Number(b), 0) },
};
let ctl = null;
document.getElementById('go').onclick = async () => {
  ctl = new AbortController();
  document.getElementById('stop').disabled = false;
  const list = document.getElementById('steps'); list.textContent = '';
  const status = document.getElementById('status');
  try {
    const r = await runAgent({ task: document.getElementById('q').value, tools, maxSteps: 6, signal: ctl.signal,
      onWait: (w) => { status.textContent = w.message; },
      onStep: (s) => { status.textContent = ''; const li = document.createElement('li');
        li.textContent = s.tool === 'answer' ? 'answer' : `${s.tool} ${JSON.stringify(s.args)} → ${s.ok ? JSON.stringify(s.result) : s.error}`;
        list.append(li); } });
    document.getElementById('answer').textContent = r.answer || 'No answer within the steps allowed.';
  } catch (e) { document.getElementById('answer').textContent = e.message; }
  status.textContent = '';
  document.getElementById('stop').disabled = true;
};
document.getElementById('stop').onclick = () => ctl && ctl.abort();
</script>
```

Then check your own files: the import path is exactly `/lol-agent.mjs`, every tool has a description, `onWait` shows
its message, and nothing holds a secret. The page runs in the project's **Preview**.
