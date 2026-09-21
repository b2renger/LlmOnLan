# LOL Chat vNext + the Computer — how to try it

> For the owner, 2026-09-16. Everything below is on branch **`lolchat/vnext`**, built over phases
> P0–P2 (the chat) and S0 + C1–C3 (the workbench and the Computer). The build stops here on purpose:
> the vibecode bench (S2) and the design/board benches (S3) are planned but **not built**.

---

## 1. Run it

**On `AN-A6000PRO` (the coding machine) this just works** — the branch is here, the deps are installed,
`npm run build` has been run, the 2.4 GB sidecar is already downloaded and the farm is on localhost:

```bash
cd shell
npx electron .            # the real client, from the working tree
```

Two things to know first, neither of them a reason to use another machine:

1. **Close your installed LlmOnLan client if it is open.** `app.requestSingleInstanceLock()` makes the
   second copy quit immediately. (The *Farm* app is unrelated — leave it running.)
2. **A dev run shares your real data folder.** `app.setName('LlmOnLan')` and no `userData` override, so
   it uses `%APPDATA%\LlmOnLan` — the same `Local Storage` your v1 LOL Chat threads live in, the same
   `owui-data`, the same sidecar. First open therefore runs the **IndexedDB v1 → v2 upgrade on your real
   history**. It is designed to be non-destructive (the v1 `localStorage` key is copied, never removed),
   but it has only ever run on synthetic data. Back the small stuff up first — seconds, and it makes the
   whole thing reversible:

   ```powershell
   $ud = "$env:APPDATA\LlmOnLan"
   Copy-Item "$ud\Local Storage" "$ud\..\LlmOnLan-backup-LocalStorage" -Recurse -Force
   Copy-Item "$ud\IndexedDB"     "$ud\..\LlmOnLan-backup-IndexedDB"    -Recurse -Force -EA SilentlyContinue
   Copy-Item "$ud\shell-settings.json" "$ud\..\LlmOnLan-backup-settings.json" -Force
   ```

**If you would rather not touch your real data at all**, run isolated — a different `userData` also gets
its own single-instance lock, so it can run *alongside* your installed client. Junction the sidecar in so
it doesn't re-download 2.4 GB:

```powershell
$t = "D:\lolchat-test"                                  # anywhere you like
New-Item -ItemType Directory -Force $t | Out-Null
New-Item -ItemType Junction -Path "$t\sidecar" -Target "$env:APPDATA\LlmOnLan\sidecar" -EA SilentlyContinue
cd C:\Users\ateliernum\Documents\code\LlmOnLan\shell
npx electron . --user-data-dir=$t
```

Fresh profile = empty chat history (nothing to migrate) and the farm found by beacon as usual.

**On another machine**, it is the ordinary route:

```bash
git fetch && git switch lolchat/vnext     # once it is pushed — see §6
cd shell && npm ci && npm run build && npx electron .
```

The farm is found by the usual beacon; nothing about discovery, the sidecar or Open WebUI changed.
Press the topbar toggle to reach **LOL Chat**.

*Don't want to run Open WebUI at all while testing?* `shell/src/main/clientMode.ts` `OWUI_ENABLED` and
the `NO_OWUI` const at the top of `renderer/app.js` still flip together, as before.

---

## 2. What is new in the chat itself (P1–P2)

Your old threads migrate on first open: the `localStorage` v1 threads are copied into IndexedDB
(non-destructively — the old key is **not** removed, so a downgrade loses nothing).

Worth poking at:

- **Markdown that streams** — tables, lists, nested fences, code blocks with copy buttons, at ~1500
  tokens/s of rendering. Try pasting something long and scrolling up while it writes: the view should
  not yank you back down.
- **The context meter** above Send, and the cost gate before a big paste ("Send · ~61k tokens").
- **The message tree** — edit an old question (it forks, nothing is lost), regenerate (siblings,
  `◀ 2/3 ▶`), and Continue when a reply was cut off.
- **Farm honesty** — when every seat is taken you get *"Waiting for a seat"* with Cancel / Try now
  instead of an HTTP 429, and it sends itself when a seat frees.
- **The library** — search, groups, pin, rename, ephemeral threads, export/import.

## 3. The Computer (C1–C3) — the part to really test

Open a thread, then the **Computer** tab in the workbench column (right). Three widths: Chat / Split /
Panel. `Ctrl+\` cycles panels; drag the divider; it remembers per thread.

**A first graph (2 minutes).** Add a part → `Note`, type "Paris". Add `Ask`, wire Note → Ask, instruction
"name three things to see". Add `Collect`, wire Ask → Collect. **Run** (or `Ctrl+Enter`). Each part shows
its state and what it cost (`41 tok · 0.1s`).

**The one that matters — fan-out.** `Note` (a list of 20 things, one per line) → `Split` (by lines) →
`Ask` → `Collect`. One Run, twenty generations, `7/20` ticking on the Ask part. Then:

- kill the farm's patience: while it runs, **send a chat message** — yours should go first, the graph
  waits (it holds the farm at background priority);
- **Stop** mid-run — exactly one request aborts, everything already computed stays;
- make one item fail — the other nineteen still finish, and the failures are listed on the part;
- push past **50 generations** — it stops at the cap and offers to raise it *for this run*; raising it
  only pays for the items it never asked (cached answers cost nothing);
- edit the Note and Run again — only the dirty part of the graph recomputes.

**Deterministic work.** `Code` runs plain JavaScript over its inputs in a sandbox — arithmetic, parsing,
sorting: the things a 12B model should never be trusted with. It has no network and no file access; an
infinite loop is killed by a watchdog.

**Output that another program opens.** `Render` draws markdown / SVG / HTML as a tile (export `.svg` /
`.png`). `File` writes a value into the thread's scratch project folder, with "Reveal in Explorer" on
the part. Vendored and available to sandbox code: **three.js**, **p5.js**, **matter.js** (1.8 MB total,
unmodified, licences shipped; p5 is LGPL-2.1 and needs a line on the packaging licence page).

**Sharing.** Export a graph as `.lolgraph.json`, drop it on another machine's canvas. That is the sharing
story on a stateless farm — a file, no server, no account.

**Both directions to the conversation.** `From thread` pulls a message onto the canvas; `To thread` posts
a value back as a message. Click any part's value to open it full-size in the chat column.

**Try the examples.** Two worked graphs ship in [examples/](examples/) — press **Import…** in the
Computer toolbar, or drag the file onto the canvas:

- [`palette-check.lolgraph.json`](examples/palette-check.lolgraph.json) — the model proposes five
  colours, JavaScript computes their WCAG contrast exactly, a swatch sheet is drawn and a
  `tokens.css` is written into the thread's scratch project. Seven parts, **one** generation.
- [`fanout-pitches.lolgraph.json`](examples/fanout-pitches.lolgraph.json) — six topics, one Run, six
  generations, rejoined into `out/pitches.md`.

[**LOLCHAT_COMPUTER_TUTORIAL.md**](LOLCHAT_COMPUTER_TUTORIAL.md) walks the first one through by hand,
step by step, then uses the second to explain fan-out, the cap and the seat etiquette. Both files are
generated by [`examples/build-examples.mjs`](examples/build-examples.mjs) and run end to end by
`node shell/test/chat-harness/run.js --only examples-palette-check,examples-fanout-pitches`.

---

## 4. What I could not test here, and want your eyes on

The dev box runs your live farm and your client, so these never ran on real hardware:

1. **Two real machines** — discovery, a graph running on one while someone chats on the other, and
   whether the seat etiquette actually feels polite from the *other* person's seat.
2. **A real 40-item fan-out against gemma4** — wall-clock, and what it does to a colleague mid-chat.
3. **Vision** (`Look`-type work) — deferred out of C2; image intake lands with the design bench.
4. **The v1 → IndexedDB migration on a machine with real history** (mine was synthetic).
5. **The installer path** — packaged app, first run, auto-update. Nothing here was built in a packaged
   build; the module loader was verified inside an `app.asar` by probe only.

The full list with expected results is in [LOLCHAT_RIG_CHECKLIST.md](LOLCHAT_RIG_CHECKLIST.md) (written
for the older plan — §§ on documents/OCR/search describe cancelled work; ignore those).

---

## 5. Known gaps and deliberate omissions

- **Not built:** the vibecode bench (live preview + scratch project editing), design tools (vision
  critique, token playground, SVG), board-aware ESP32/Arduino assistance. Specced in
  [LOLCHAT_STUDIO_PLAN.md](LOLCHAT_STUDIO_PLAN.md) and [LOLCHAT_COMPUTER_SPEC.md](LOLCHAT_COMPUTER_SPEC.md).
- **No image parts yet** (`Image`, `Look`) — they need the attachment intake that ships with the design bench.
- **One graph per thread.** A second graph per thread is a workbench-side change, deliberately deferred.
- **No RAG, no documents, no web search** in LOL Chat — those stay in Open WebUI, one toggle away.
- `Render` produces a snapshot, not a live frame: one iframe per part would be one process per part.

---

## 6. State of the branch

Nothing is committed — the work is a dirty working tree on `lolchat/vnext`, so that you could veto the
direction before it became history. Say the word and I'll commit it phase by phase and push, which is
also what makes §1's `git switch` possible on a second machine.

Automated gates, all green on this box (re-run by me, not taken from the builders' reports):

| Gate | Result |
|---|---|
| `node shell/test/chat-unit.js` | unit tests for every pure module |
| `node shell/test/unit.js` | the pre-existing app.js tests |
| `node shell/test/chat-lint.js` | safety/style rules (no `innerHTML` with model text, one door to main, no colour literals, …) |
| `node shell/test/chat-scope.js` | nothing outside LOL Chat's agreed files changed |
| `node shell/test/chat-harness/run.js --strict` | the real app driven over CDP against a mock farm |
| `… --strict --phase perf` | streaming render + canvas budgets, median of 3 |

The harness never beacons, so it cannot be discovered by your real client; it refuses to start if a
live-farm port is busy, and it never talks to the real farm.
