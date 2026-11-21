# CONTEXT_128K_PLAN: 128k of context per person by default

**Status: approved by the owner, 2026-11-19** (the chat, 18:15: "default at 128k", "Lets do the tests now and the
implementation in tonight session"; the aim: long chats and documents in Open WebUI) for steps 1, 2 and 4–6. **Step 3
(`RAG_SYSTEM_CONTEXT`, Open WebUI's document placement) approved by the owner, 2026-11-20** (the chat, 12:46: "yes"
to n° 11's question 2). The seats: Automatic, from the label ("24, 128k can be the default", same message). Size
**S**.

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
  | 28 | 5.35 s (p50 1.2 s) | 17.5 | fail (first word, by 0.35 s) |
  | 30 | 5.82 s (p50 1.3 s) | 17.3 | fail (first word, by 0.8 s) |
  | 32 | 6.1 s | 17.0 | fail (first word) |
  | 40 | 245 s | 2.5 | the pool is full |

  **The new label is 24**, below the old 32 and below a class of 30. That holds when everyone is 120k deep at
  once, the worst case, which still gives 30 people a median first word of 1.3 s and 17 tok/s for the slowest.
  **The owner's choice** (2026-11-20 12:46: "24, 128k can be the default"): the farm's Automatic seats at 128k come
  from this label, so **24 on the PRO 6000**; the 25th to 30th laptops active at once are refused a seat until one
  frees. An operator who wants 30 sets *People served at once* by hand.
- **The same 120k context with a new question each turn** (`lc1120-q36-128k-replace120k`): 2 people 0.56 s p95, 4 people
  0.93 s, 8 people 1.67 s and 57.8 tok/s p10, all pass. vLLM 0.30 failed this at 4 (13.5 s); **0.33.0 reuses the
  cached context**, which step 3 below relies on.

## Why documents need one more change (read in Open WebUI 0.13.3's code, then measured)

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

**The client's real path** (the same day, no GPU): that run bypassed the vector store, and a document over
`RAG_FULL_TEXT_CHAR_THRESHOLD` (50,000 characters) is read back from its collection, whose chunk order was not known to
be stable. Run again with retrieval on: embeddings through `RAG_EMBEDDING_ENGINE=openai` to a stub (fixed vectors; the
full-context mode reads the whole collection, so similarity does not matter), the chat to the same stub, which logged a
hash of each message. With `RAG_SYSTEM_CONTEXT=true` the system message carried the document with **the same hash on
all three turns** (`1751c4f9b5e6`, 205,921 characters): the order is stable, so the gain holds on the client's path.
With it off, the newest user message carried it, with a different hash each turn. **The check is in the repo**
(`docs/spike/runs/owui_doc_check.sh <open-webui executable> <empty folder>`, about 40 s, no GPU, its last line PASS or
FAIL; it runs the stub, `owui_doc_gen.mjs` seed 7 with 3,300 records, and `owui_doc_turns.mjs`): PASS again on 0.13.3
at 12:54. **Every Open WebUI pin bump re-runs it**, since a change in its middleware would undo the gain silently. **On that path the text is about a
quarter longer than the file** (205,921 characters for a 165,000-character file: the chunks' overlap and their
`<source>` tags), so a document of roughly 100k tokens, not 120k, is what fits a 128k window whole.
**Two limits:** a turn with web search on puts its results in the same place, so that turn reads the document again;
a document added later in the chat changes the system message from then on.

## What changes

1. **`farm/src/config.js`**: the vLLM schema's `contextLength` default 65536 → 131072. The Balanced preset follows
   (`presets.js:189` takes `SHIPPED.vllm.contextLength`): a new farm starts at 128k, and an existing farm moves when its
   operator applies Balanced (the panel's review shows *Context per person: 64k → 128k*). A stored value is never
   changed behind the operator. ponytail: no migration; the preset is the way.
2. **`farm/src/capacity/measured.json`**: Qwen3.6's 128k label from today's run on 0.33.0 (24), so Automatic seats at
   128k follow it; the Qwen3.6 entry's note (`config.js:434`) gains the 128k number. **First find how the 0.33.0
   labels got there:** `docs/spike/explorer/build_measured.py` cannot take today's files as they are. It reads the box
   from a `pro6000` prefix and the engine from `vllm030` in the label, and it leaves out every vLLM 0.33 run
   (`NOT_HERE`). Yet the farm's copy holds Qwen3.6's 0.33.0 label (48 at 64k, J14). Follow the same way (a hand edit
   with its schema checked, or copies under labels the script reads), and say which in the DEVLOG.
3. **Approved 2026-11-20: `shell/src/main/configBridge.ts`**: `RAG_SYSTEM_CONTEXT: 'true'` beside `RAG_FULL_CONTEXT`, with its comment and
   `docs/context/owui-contract.md`'s env list, and its pin-bump checks gain `owui_doc_check.sh` (PASS). Measured above
   (turns 2 and 3: 5.3 s → 0.13–0.15 s, the answers right);
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

**Done when:** the farm suite passes; Balanced shows 128k with Automatic seats from the new label; step 3 built and its
test passing; docs, DEVLOG, commit, `night` backup. Not released: the owner's tests (J16 at 128k, and the document
test of step 3) first.

## Built (night n° 12, 2026-11-21; unreleased)

Steps 1–6, with what the night found:
- **The default:** `vllm.contextLength` 65536 → 131072 (`config.js`). **The plan's step 1 was half right:** a stored
  value is never changed, but a farm's file does not always store one. The panel's engine switch writes only
  `vllm.enabled` (`up.js` `setEngineFlags`), and `applyChange` writes the context only when it differs. So a farm that
  went to vLLM by the switch and never changed its context follows the default **when it updates**; the PRO 6000's file
  names 65536 and moves only when Balanced is applied (a farm test checks both, and that Balanced sends 131072 to a
  farm at 64k). Not checked: what the two DGX Sparks' files hold (on a Spark, Balanced at 128k gives 4 seats, vLLM
  0.30's label, against 8 at 64k).
- **The label (step 2), and how the 0.33.0 labels reached the farm:** they did not. Qwen3.6's 96 / 48 / 32 in the
  farm's copy are all vLLM 0.30.0's runs of 2026-10-04; only Flint and Gemma 4 26B came in by `measured-extra.json`.
  `build_measured.py` stopped on the results of 2026-11-10 onward (`ollama033-*`, `lcpp-*`, `hq-*`, `lc1120-*`): it now
  builds only from the runs it was built from (`<box>-vllm030-*`, `<box>-llamacpp-*`), and gives the same table. The
  24 goes into `measured-extra.json` (both 2026-11-20 runs, the generator's own pass rule: every turn 24, steady 32), and
  `build_page.js` merges an extra config into the table's config of the same id instead of adding a second one, which
  nothing would read. The farm's copy changed in Qwen3.6's 128k only.
- **`RAG_SYSTEM_CONTEXT` (step 3)** follows `RAG_FULL_CONTEXT` instead of being always on: in retrieval mode (farms
  under 24k a person) the passages change with each question, and in the system message they would make the farm read
  the whole conversation again. So it never restarts Open WebUI by itself either (`repoint` compares the env).
- **Documents (step 4) stays at 64k:** at 128k its rule picks Nemotron 3.5 Lightning on the PRO 6000 (48 people
  against Qwen3.6's 24), which sees no pictures. A question for the owner.
- Checked: farm 290/290, `test:chat` 1986 (1 skipped, as before). Not checked: a farm started at 128k by the panel
  (J16), a document in a real client at 128k (J16 step 6).
