# CONTEXT_128K_PLAN: 128k of context per person by default

**Status: approved by the owner, 2026-11-19** (the chat, 18:15: "default at 128k", "Lets do the tests now and the
implementation in tonight session"; the aim: long chats and documents in Open WebUI). Step 3 (Open WebUI's document
placement) is the session's proposal inside that aim; the owner may say no to it alone. Size **S**.

## What was measured (2026-11-20, the RTX PRO 6000, vLLM 0.33.0, the live farm's 50 GiB pool)

Qwen3.6 35B-A3B NVFP4, the farm's own flags (`QWEN36_ARGS`), `--max-model-len 131072`:

- **vLLM's own count:** 34 whole conversations of 128k (*Maximum concurrency for 131,072 tokens per request: 34.47x*;
  4,518,343 tokens of pool). The live farm at 64k says *room for 60*.
- **The long-text check** (`runs/longtext_check.mjs`, a list of numbered lockers, one code asked from anywhere in it):
  20/20 at ~60k tokens and 20/20 at ~120k. The first question read the whole list in 4.0 s and 5.4 s, with 4 people
  asking at once; each later question about the same list took a median 0.4 s and 0.9 s.
- **A text past the window** is refused by vLLM (HTTP 400, *maximum context length is 131072 tokens*). A person sees
  LiteLLM's version of it through Open WebUI.
- **People at once, each ~120k deep, each turn extending the last** (the profile of the 2026-10-04 label, which said
  32 on vLLM 0.30; `lc1120-q36-128k-label120k`; pass = first word p95 < 5 s and p10 ≥ 15 tok/s):

  | People | First word p95 | p10 tok/s | |
  |---|---|---|---|
  | 16 | 3.3 s | 29.2 | pass |
  | 24 | 4.6 s | 21.6 | pass |
  | 32 | 6.1 s | 17.0 | fail (first word) |
  | 40 | 245 s | 2.5 | the pool is full |

  **The new label is 24**, below the old 32 and below a class of 30. That holds when everyone is 120k deep at
  once, the worst case. 28 and 30 are measured next (2026-11-20, after the Qwen3.8 runs).
- **The same 120k context with a new question each turn** (`lc1120-q36-128k-replace120k`): 2 people 0.56 s p95, 4 people
  0.93 s, 8 people 1.67 s and 57.8 tok/s p10, all pass. vLLM 0.30 failed this at 4 (13.5 s); **0.33.0 reuses the
  cached context**, which step 3 below relies on.

## Why documents need one more change (read in Open WebUI 0.13.3's code, not yet run)

With the client's settings (`RAG_FULL_CONTEXT` on, the `file_context` capability on), Open WebUI **puts an attached
document's whole text into the newest user message, on every turn**:
- the frontend sends the chat's files again with each message (`Chat.svelte`: `let files = structuredClone(chatFiles)`);
- earlier turns are replayed from its database without the text (`utils/middleware.py:2079-2114`);
- the text is prepended to `messages[-1]` (`middleware.py:634-645`, `RAG_SYSTEM_CONTEXT` false by default, `env.py:362`).

So the document moves to the end of the conversation at each turn, and vLLM reads all of it again: about 5 s for one
person at 120k, and a class's re-reads queue up behind each other. **`RAG_SYSTEM_CONTEXT=true`** (an env setting, the
public config surface) puts the same text at the end of the system message instead (`misc.py`
`add_or_update_system_message`, append). The default RAG template has no `{{QUERY}}` (`config.py:1080-1104`), and the
client's system prompt changes once a day (`Today is {{CURRENT_WEEKDAY}} {{CURRENT_DATE}}.`, `renderer/app.js:617`).
So the prompt is identical up to the end of the document from one turn to the next, and vLLM reads it once per
conversation (0.4–0.9 s a question, measured above).

**Measured through a real Open WebUI 0.13.3** (2026-11-20 10:00): the trial vLLM above, the client's settings (with
`BYPASS_EMBEDDING_AND_RETRIEVAL` so no embedding model was needed), a ~100k-token document attached to the first
question, three questions in one chat, a relay between Open WebUI and vLLM logging each request
(`results/lc1120-owui-relay.txt`):

| Turn | Default: the document in the newest message | `RAG_SYSTEM_CONTEXT=true`: in the system message |
|---|---|---|
| 1 | 5.42 s to the first word | 5.45 s |
| 2 | 5.26 s | **0.13 s** |
| 3 | 5.28 s | **0.15 s** |

All six answers right. The relay showed the default moving the 166,652 characters to messages 1, 3 and 5 in turn, and
the setting keeping them in message 0 at the same size each turn; no other context (knowledge or skill lists) was
sent. For a class this is the difference between the farm reading every attached document again at every question
and reading it once per chat.

## What changes

1. **`farm/src/config.js`**: the vLLM schema's `contextLength` default 65536 → 131072. The Balanced preset follows
   (`presets.js:189` takes `SHIPPED.vllm.contextLength`): a new farm starts at 128k, and an existing farm moves when its
   operator applies Balanced (the panel's review shows *Context per person: 64k → 128k*). A stored value is never
   changed behind the operator. ponytail: no migration; the preset is the way.
2. **`farm/src/capacity/measured.json`**: Qwen3.6's 128k label from today's run on 0.33.0, so Automatic seats at 128k
   follow it; the Qwen3.6 entry's note (`config.js:434`) gains the 128k number.
3. **`shell/src/main/configBridge.ts`**: `RAG_SYSTEM_CONTEXT: 'true'` beside `RAG_FULL_CONTEXT`, with its comment and
   `docs/context/owui-contract.md`'s env list. Measured above (turns 2 and 3: 5.3 s → 0.13–0.15 s, the answers right);
   the client's own test of `buildSidecarEnv` checks the value; a person's check goes in HUMAN_TESTS (a document of
   a few hundred pages, three questions, the second and third answering at once).
4. **The Documents preset** (`presets.js:100`, 64k): 128k too, if its pick stays a model that sees images and serves
   the class (the farm test *presets* shows the pick). If it flips to another model, it stays at 64k and the summary
   asks the owner. LOL Vibe's preset stays at 64k (the coding agent's window; not the owner's aim).
5. **Tests:** farm `node test/run.js` (289/289 on 2026-11-20 before the change): the asserts that pin the shipped
   default, and one that checks Balanced picks 128k. The shell: the env test of `buildSidecarEnv`.
6. **Docs:** `docs/context/farm.md` (the default, the presets), `docs/context/owui-contract.md`, HUMAN_TESTS J16 (128k
   becomes its main step, not the optional one), RESULTS, DEVLOG.

Not changed: Ollama and llama.cpp (their context stays Automatic). The client needs nothing else: 64k → 128k does not
relaunch Open WebUI (`sidecar.ts:374`).

**Done when:** the farm suite and the shell's tests pass; Balanced shows 128k with Automatic seats from the new
label; step 3's measurement is in RESULTS; docs, DEVLOG, commit, `night` backup. Not released: the owner's tests
(J16 at 128k) first.
