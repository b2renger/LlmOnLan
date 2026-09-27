# LOL Chat vNext: rig checklist (a human on real machines)

This checklist covers what the automated harness cannot prove. Run it on real laptops against the real
farm.

- **Harness scope:** [LOLCHAT_PLAN.md](LOLCHAT_PLAN.md) §2 runs on a mock farm in an isolated Electron
  profile.
- **This checklist:** real laptops, the real farm (`gemma4:12b` on Ollama, a llama.cpp alias, password
  farms, a switching or full farm), real Wi-Fi, real Blender, and real installers upgraded from v0.1.45.

**Conventions:**
- Tick `[x]` and write the date, machine and result on the line.
- **Expected** is what a pass looks like. Anything else is a bug; note it in DEVLOG.
- Items marked **(C-21)** are *live verification* questions: the build ships a fallback, and your answer
  decides whether the fallback or the primary path becomes the default.
- **Never** run these on AN-A6000PRO while colleagues are using its farm, unless the item says
  "quiet farm OK". Every completion takes a real seat.

**Suggested rig:**
- **Laptop A:** Windows 11 with the v0.1.45 client and real LOL Chat v1 history.
- **Laptop B:** a macOS arm64 laptop.
- **Laptop C (optional):** Linux AppImage.
- **Farm F1:** the default farm, Ollama `gemma4:12b`, 1–2 slots, open (no password).
- **Farm F2:** llama.cpp alias `assistant`, password-protected. A Farm app on a spare box is fine.
- **Blender:** 4.x with the BlenderMCP addon on laptop A.

---

## 0. Before you start
- [ ] Record the client version under test, the farm version (`/lol/self` → `version`) and the engine of
      each farm.
- [ ] Laptop A has LOL Chat v1 history: at least 5 threads, including one with a code block and one with
      reasoning. Screenshot the thread list **before** upgrading.
- [ ] On laptop A, quit LlmOnLan and back up **both** `%APPDATA%\LlmOnLan\Local Storage` (v1 history) and
      `%APPDATA%\LlmOnLan\IndexedDB` (where vNext history lives, once it exists). Copy the folders. This is
      the rollback if migration misbehaves.
- [ ] `e2e.js` passes on a machine with **no LlmOnLan client installed or running** (CI or a spare box;
      **never** AN-A6000PRO or any laptop with the real client: the mock's beacon would hijack that client):
      `LOL_MOCK_BEACON_OK=1 node test/mock-farm.js --coordinator` + `LOL_ENDPOINT=http://127.0.0.1:4009/v1 npx electron . --remote-debugging-port=9222` + `node test/e2e.js`
      → `E2E OK — … tok/s`. Without `LOL_MOCK_BEACON_OK=1` the mock refuses to beacon (by design).
      **Do not skip this one.** The P1 fix round found a defect that fails it deterministically and that
      NO harness gate could see: `e2e.js` decides "the reply finished" by the mere EXISTENCE of
      `.chat-stats`, while the harness's `waitReply` also requires non-empty text. It is fixed (and
      `p1-stats-presence` now asserts e2e's weaker predicate inside the harness), but e2e.js itself has
      still never been run against vNext — this box cannot run it. Expected: no `stats line malformed`.
- [ ] Open a chat, then **switch to another thread while a reply is streaming** and switch back.
      Expected: the reply is still growing, finishes with a stats line, and is not stuck on
      "streaming" (P1 fix round; `p1-switch-midstream` covers the mock, this covers a real farm's
      slower token rate).
- [ ] Quit the client with a conversation open and relaunch it. Expected: that conversation is open
      again (`ui:lastThreadId`), not the empty state.

## 1. Upgrade and migration (laptop A, v0.1.45 → vNext)
- [ ] Auto-update (or install) the vNext build over v0.1.45. **Expected:** the app opens on Open WebUI
      as before; the topbar toggle still reads "Open WebUI"/"LOL Chat".
- [ ] **(C-21)** **Packaged build loads the modules** (`.mjs` inside `app.asar`, DISCUSS D-P3; static imports
      AND the dynamic `import()` loader both passed a synthetic packed-asar probe at the P0 landing, under
      the shipping CSP — re-runnable at any time with `node shell/test/asar-probe.js`, which exits
      non-zero and prints its `PROBE_RESULT` line if an Electron bump or a packaging change ever breaks
      the assumption; this item confirms it on the REAL installer): LOL Chat shows its UI, not the
      "LOL Chat failed to load" fallback line, and no "Part of LOL Chat failed to load" banner. If you see
      either, open DevTools (Ctrl+Shift+I) and copy the console error into DEVLOG, and note
      `window.LolChat.failed` — it names the module and the import error verbatim.
- [ ] Toggle to LOL Chat. **Expected:** the chat is interactive within about a second, and every v1
      thread appears in the same order with the same titles and messages. Code blocks now render with a
      header and a Copy button; reasoning panels are collapsed.
- [ ] Quit and reopen, then toggle again. **Expected:** no duplicate threads.
- [ ] Settings (gear, bottom of the sidebar) → Storage. **Expected:** mode "saved on this computer",
      a usage figure, and a "Remove old v1 copy" button.
- [ ] Do **not** press "Remove old v1 copy" yet. Instead, roll back to v0.1.45 (reinstall).
      **Expected:** the v0.1.45 LOL Chat still shows the v1 threads (the key was not deleted).
- [ ] **While on v0.1.45:** create one new thread ("rollback-new") and add one message to an existing old
      thread ("rollback-appended"). Then re-upgrade to vNext.
      **Expected:** "rollback-new" appears as a normal thread; "rollback-appended" appears once more as
      "{title} (older version)" with the extra message; the original migrated copy is unchanged; no other
      duplicates.
- [ ] Settings → Storage → "Remove old v1 copy". **Expected:** if anything from the rollback was not yet
      brought over, the button first offers to bring it over; only then it removes the key. After a
      restart every thread (including both rollback ones) is still present.
- [ ] **Uninstall and reinstall** vNext (Windows NSIS per-user). **Expected:** LOL Chat history survives
      (`%APPDATA%\LlmOnLan\IndexedDB` is kept). Record the result either way.
- [ ] Laptop B, fresh install with no history. **Expected:** the empty state, no errors, and a new
      chat works.
- [ ] **(P0 store)** On each laptop, Settings → Storage: the mode must read "saved on this computer"
      (IndexedDB). A "history is not being saved" / memory banner on a normal profile is a bug — record
      the laptop, the OS and `window.LolChat.app.repo.mode` in DEVLOG. (The memory and late-attach paths
      are proven in the harness; the rig only has to prove the normal path is the one real machines take.)
- [ ] **(P0 store)** Preferences → Data location → move the data folder, then reopen LOL Chat.
      **Expected:** the thread list is unchanged — LOL Chat history lives in the renderer profile
      (`%APPDATA%\LlmOnLan\IndexedDB`), not under `DATA_DIR`, so a move must not touch it. If threads
      disappear, stop and report: that is data loss, not a display bug.
- [ ] **(P0 store)** A corrupt v1 history: on a spare profile, replace the `lolchat.threads.v1`
      localStorage value with `{`, then open LOL Chat. **Expected:** the chat opens on an empty list with
      no crash, and Settings → Storage → "Remove old v1 copy" REFUSES (it must never delete history it
      could not read).

## 2. Basic chat on each engine
### 2.1 F1: Ollama `gemma4:12b`
- [ ] Send "Write a markdown table of 5 Blender shortcuts, then a python snippet". **Expected:**
  - the reply streams smoothly;
  - the table renders as a table and the code has Copy/Wrap;
  - the stats line reads `N tok · X tok/s · first token Ys`, with X near the farm's real speed;
  - the farm strip shows `gemma4:12b · ollama · n/m seats` and GPU %, with no dashes or empty fields.
- [ ] Copy a code block and paste it into Notepad. **Expected:** the exact code, with no fence markers.
- [ ] Ask for an SVG ("draw a simple red circle as SVG"). **Expected:** a Preview tab shows the image;
      no script runs.
- [ ] Ask for a very long answer (e.g. "list 300 numbered items") and scroll up while it streams.
      **Expected:** the view stays where you scrolled, with no jump every 4 s. "Jump to latest"
      appears and works.
- [ ] Open a reasoning panel on a thinking model, select some text, and wait 15 s. **Expected:** the
      panel stays open and the selection stays.
- [ ] **Model pick right after New chat** (regression for the §2.6 X race, found at the P1 landing;
      the harness proves it against the mock, this proves it against a farm whose `/v1/models` is
      slow). On a farm serving two or more models: click **New chat**, change the model picker
      IMMEDIATELY (within a second), and send. **Expected:** the picker still shows your choice a few
      seconds later, the answer comes from the model you picked (the message's model stamp says so),
      and it does not flip back to the farm default at any point.
### 2.2 F2: llama.cpp alias (password farm)
- [ ] Select F2 on the farm card, without a password stored yet. **Expected:** the strip and composer
      say "Password needed — enter it on the farm card", and no request is sent.
- [ ] Enter the password on the farm card. **Expected:** the models load within 4 s and the alias
      `assistant` is preselected; a chat works; the strip shows the llama.cpp engine and, if published,
      tok/s from `perf`.
- [ ] Change the farm password on the admin panel while the client is open. **Expected:** within about
      60 s the model picker reads "password refused" and the next send says the farm refused the
      password; nothing else breaks.
- [ ] Enter the **new** password on the farm card without restarting. **Expected:** the models come back
      within a few seconds and the next send works (it uses the new key; no reload needed).
- [ ] **(C-21)** Continue on llama.cpp: ask for a long answer with a small max_tokens (params drawer, if
      shipped, or a recipe with `max_tokens: 100`), then press Continue. **Expected:** the text continues
      mid-sentence without restarting. Note whether the fallback "continue" user turn was needed (kv
      `continueMode`).
### 2.3 External engine (only if a vLLM/SGLang farm exists)
- [ ] A basic chat works; the strip shows `external`; the context meter uses the declared context.

## 3. A shared farm: seats, busy, switching, two laptops
- [ ] **Seat gate 429.** Set F1 to 1 slot. Laptop A chats; within 15 min laptop B sends. **Expected on B:**
  - no `[error: HTTP 429]`;
  - a "Waiting for a seat — 1/1 in use" note with the farm's own sentence, plus Cancel and Try now;
  - Send disabled with "Waiting for a seat…".
- [ ] Laptop A quits LOL Chat (close means close) and waits for the seat to free (≈15 min idle, or the
      operator lowers `seatIdleSec`). **Expected on B:** within ~10 s of the snapshot showing a free
      seat, the message sends **by itself exactly once**, and the reply completes.
- [ ] While B is waiting, switch B to Open WebUI (LOL Chat hidden). **Expected:** B does not grab the
      seat while hidden; it resumes when shown.
- [ ] B presses Cancel while waiting. **Expected:** nothing is sent later, even when the seat frees.
- [ ] **Seat wait while minimised:** B waits for a seat, then **minimises** the LlmOnLan window (LOL Chat
      still the active view). Free the seat. **Expected:** B does not send while minimised (check the farm
      log / admin clients list); restoring the window sends exactly once within ~10 s.
- [ ] **A seat wait survives a thread switch, and stays where it belongs** (P2 landing). While B is
      waiting, click **New chat** and type nothing. **Expected:** the new chat is EMPTY — the waiting
      row does not follow you — Send still refuses ("Waiting for a seat…"), and going back to the
      original chat shows the waiting row still there with its note up to date.
- [ ] **A seat wait does not survive a quit** (P2 landing). B waits for a seat, then quits LOL Chat
      (close means close) and reopens it. **Expected:** the row reads as an interrupted reply, NOT as
      a waiting row with Try now / Cancel buttons that do nothing; nothing is sent by itself; the
      reason (the farm's seats sentence) is still readable.
- [ ] **Cancel still says why** (P2 landing). B presses Cancel while waiting. **Expected:** the row
      keeps the farm's own sentence plus "Stopped waiting for a seat." ON SCREEN, not just a generic
      "You stopped this reply."
- [ ] **Give-up:** B waits on a farm that stays full for 15 min. **Expected:** the note turns into a
      readable "gave up waiting" error and Send is usable again; nothing is sent.
- [ ] **Stop frees the engine.** A starts a long answer and presses Stop after 3 s. **Expected:** the
      farm's slot is free immediately (admin panel / `lol status`); the partial reply is kept, marked
      stopped.
- [ ] **Delete a chat while its reply is streaming** (P1 fix round 2). A starts a long answer, then
      deletes THAT chat from the sidebar (× → Delete) while it is still painting. **Expected:** the
      chat disappears, the composer goes straight back to Send (no "A reply is already running"), and
      the farm's slot/seat is free within a second or two (admin panel / `lol status`) — the farm must
      not keep generating an answer nobody can read. `p1-delete-streaming` covers the mock; only a real
      farm can show the seat actually coming back.
- [ ] **A wrong farm password says where to fix it** (P1 fix round 2). Point the client at F2 with the
      wrong password and send. **Expected:** "The farm refused the password" plus our own sentence
      ("Check it in Preferences → Connection"), with LiteLLM's own jargon only in brackets after it.
- [ ] **Busy farm / engine switch.** Switch F1's engine (or pull a model) from the admin panel while A has
      LOL Chat open. **Expected:** the strip shows the busy label with a percentage; a send during the
      switch shows the local "server is busy" note and sends nothing; after the switch the model list
      refreshes and chat works again with no reload.
- [ ] **Model renamed/removed** while a thread uses it. **Expected:** the picker falls back to the farm
      default; old messages still show the original model stamp.
- [ ] **Two laptops, same thread content.** Export a thread on A (`.lolchat.json`), carry it to B on a
      USB stick or Slack, and import it. **Expected:** identical content, branches and attachments; B's
      import creates new ids, and importing twice gives two copies with no overwrite.
- [ ] **Local seat sharing:** on laptop A, OWUI and LOL Chat both chat within the same minute.
      **Expected:** both work (the same IP shares one seat). Note any slowdown caused by OWUI title
      generation.

- [ ] **A model that talks about thinking tags** (P1 fix round 2). Ask the farm's model to "show me an
      example of a `<think>` block, in a code fence". **Expected:** the tags are visible in the answer
      and in the fence; nothing of the answer is swallowed into the Thought block. (Only a leading
      `<think>` at the very start of a reply becomes reasoning.)
- [ ] **A thinking model whose stream is cut** (P1 fix round 2): press Stop while the Thought block is
      still running, before any answer text. **Expected:** the message shows the thinking text as its
      body rather than an empty message behind a collapsed "Thought".

- [ ] **A LONG seat wait on a real full farm** (P2 fix round). Fill every seat from the other laptops,
      send, and leave the waiting row alone for **five minutes or more** without touching anything.
      **Expected:** the note still reads exactly one sentence from the farm plus one
      "Waiting for a seat — N/N in use" — it must NOT grow a new copy of that sentence per farm
      publish (it did, ~once every 4 s, before this round). The note's left edge pulses the whole
      time, and **Try now / Cancel are visible without hovering**.
- [ ] **Delete the waiting row while it waits** (P2 fix round). With a wait pending, delete the whole
      THREAD from the sidebar (the row itself no longer offers Delete — check that too).
      **Expected:** Send comes back at once, Stop disappears, and when a seat frees nothing is sent
      and no deleted message reappears anywhere.

- [ ] **The answer comes back to the chat it was asked in** (P2 fix round 2). While B is waiting for a
      seat, click **New chat** so an empty conversation is on screen, then free the seat on the farm.
      **Expected:** the new chat stays **completely empty** while the answer streams — no reply text,
      no dots, nothing appears in it at any point — and the finished answer is found in the original
      chat when you click back to it. (Before this round the other conversation's reply painted live
      into whatever chat was open, for the whole length of the answer.) Worth doing with a slow model
      or a long question, so the stream lasts long enough to watch.
- [ ] **Enter while queued says the truth** (P2 fix round 2). With B waiting for a seat, type something
      and press Enter. **Expected:** the toast talks about **waiting for a seat**, not "A reply is
      already running" — nothing is running — and the composer shows a greyed **Waiting for a seat…**
      button next to **Stop** (Send must be visible, not hidden).
- [ ] **Regenerate / Edit while a seat wait is pending** (P2 fix round 2). With B waiting, scroll up to
      an older answer and press **Regenerate**; then try **Edit** on an older question. **Expected:**
      a toast explaining the wait and **nothing else happens** — the conversation does NOT collapse to
      its first question, no new empty turn appears, and the branch controls are unchanged. Repeat the
      same two actions while a reply is genuinely streaming: same refusal, same intact conversation.

## 4. Context: big pastes and long threads
- [ ] Paste about 100k characters (a long log). **Expected:**
  - the meter turns amber/red;
  - Send changes to "Send · ~N tokens · ~S s of shared GPU", and the first click only arms it;
  - the second click sends; the reply answers about the paste.
- [ ] Paste something larger than the farm's advertised context. **Expected:** Send blocked with "Too
      long for this farm"; the meter popover explains the breakdown; nothing is sent.
- [ ] A thread of 40+ turns on a 16k-context farm (F2 with `contextLength` 16384). **Expected:** an
      "outside context" divider appears above the oldest kept turn; replies still work, with no
      ContextWindowExceeded errors; a pinned early message stays inside the context (meter breakdown
      shows "pinned").
- [ ] **Long thread performance:** a thread with 300+ messages and one 50k-character reply. **Expected:**
      switching to it takes under 1 s; scrolling is smooth; typing in the composer has no lag.
- [ ] **Low-end laptop:** the oldest office laptop streams a 2,000-token reply on gemma4. **Expected:**
      the displayed tok/s is within ~10% of the farm's; the fan does not spin up from rendering alone.
- [ ] **(C-21)** Mid-stream error format: kill `llama-server` (spare farm only) during a reply.
      **Expected:** the partial reply is kept with a readable network or upstream note and a Continue
      button. Record what the renderer actually received.

## 5. Images, documents, search
- [ ] Paste a screenshot (Win+Shift+S) into the composer on F1 (gemma4, vision). **Expected:** a
      thumbnail chip; the reply describes the screenshot correctly.
- [ ] Drop 5 images. **Expected:** 4 accepted, plus a toast about the limit.
- [ ] Drop an image **outside** the chat area (on the topbar). **Expected:** nothing happens; the app
      does not navigate away.
- [ ] Send an image to the llama.cpp alias without mmproj. **Expected:** "This model can't see images"
      plus "Resend without images"; resending works.
- [ ] Drop a 40-page PDF on F1 (OCR on). **Expected:** the chip reads "reading…" then "40 pages"; a
      question about page 7 is answered; regenerating does not upload again (farm OCR log: one request).
- [ ] Drop a scanned image PDF and a DOCX. **Expected:** both extract. An unsupported file (e.g. `.blend`)
      shows "This file type can't be read".
- [ ] Drop a 300-page PDF. **Expected:** the page picker opens by itself; choosing `10-20` shrinks the
      meter and the answer uses only those pages.
- [ ] Drop a `.py` or `.log` file. **Expected:** read locally, with no OCR request (farm OCR log is
      empty).
- [ ] Turn a farm's OCR off. **Expected:** dropping a PDF says document reading isn't available on this
      farm.
- [ ] **Web search** on F1 (SearXNG on): toggle the globe and ask about a topic. **Expected:** a Sources
      card with up to 5 links; `[n]` chips in the answer open the matching link in the system browser.
- [ ] **Closed LAN:** unplug the farm's internet uplink (SearXNG has no upstream). **Expected:** "No
      results", the message still sends, and nothing hangs longer than ~8 s.
- [ ] Disable SearXNG on the farm. **Expected:** the globe toggle disappears within a few seconds.

## 6. Blender (laptop A, Blender 4.x + BlenderMCP addon)
- [ ] Preferences → Assistant tools → enable, and start the MCP server in Blender. **Expected:** the attach
      menu in LOL Chat shows "Blender viewport" and "Blender scene".
- [ ] **(C-21)** Attach viewport. **Expected:** a thumbnail of the actual viewport. If it fails, copy the
      error text; the real mcpo response shape goes to DEVLOG.
- [ ] Attach scene, then ask "what objects are in my scene?". **Expected:** a correct list.
- [ ] Ask "add a three-point light rig with python". **Expected:** the python block has **Run in
      Blender…**; clicking opens an editable copy, and nothing has run yet (the Blender scene is
      unchanged).
- [ ] Edit the code (change a light energy) and press Run. **Expected:** the edited code runs, and the
      result shows in the card.
- [ ] Run code that raises. **Expected:** the traceback shows; **Ask the model to fix** sends one message;
      the fixed code is **not** run until you click Run again.
- [ ] In a thread that used web search or a PDF, a Run card shows the "outside content" warning banner.
      In a clean thread there is no banner.
- [ ] Stop the Blender addon. **Expected:** attach viewport reports that Blender isn't listening on the
      port; disabling Assistant tools removes the Blender entries.

## 7. Offline, failures, quitting
- [ ] **Offline LAN (no internet at all):** unplug WAN at the office router, restart laptop A. **Expected:**
      LOL Chat works end-to-end against the LAN farm. No request goes to the internet (Resource Monitor /
      Little Snitch shows only farm IPs from the LlmOnLan renderer).
- [ ] **Farm disappears:** power off the farm mid-conversation. **Expected:** the in-flight reply ends with
      a network note plus Continue; the strip shows "farm silent" within ~15 s; the composer does not
      freeze.
- [ ] **Quit mid-stream** (window X → confirm). Reopen. **Expected:** the partial reply is still there,
      marked interrupted, with Continue.
- [ ] **Power loss simulation:** kill the LlmOnLan process from Task Manager mid-stream. **Expected:**
      the same as above, with at most ~1 s of text lost.
- [ ] **Ephemeral chat:** create one, chat, quit, reopen. **Expected:** gone; never listed in search.
- [ ] **Wi-Fi roaming** between access points during a reply. **Expected:** either completes or ends with
      a readable note plus Continue, never a stuck spinner.

## 8. History tools
- [ ] Edit an old question. **Expected:** a new branch `◀ 2/2 ▶`; the old answer is still reachable.
- [ ] Regenerate, and "Regenerate with… More precise". **Expected:** siblings; the switcher works after a
      restart.
- [ ] Fork from a middle message. **Expected:** a new thread "(fork)" with the path up to that message.
- [ ] Search the sidebar for a word with accents typed without them (`elephant` finds `Éléphant`).
      **Expected:** the hit is listed with a snippet, and clicking scrolls to the message.
- [ ] Pin and rename threads. **Expected:** both survive a restart and an app update.
- [ ] Type a long draft, switch threads, quit, reopen. **Expected:** the draft is restored in that thread.
- [ ] **Import by hand, once** (P2 landing). Settings → **Import chats…** opens a native file
      chooser, which no harness may click. Pick a `.lolchat.json` exported on the other laptop, and
      also press Cancel in the chooser once. **Expected:** the import lands as a COPY (new ids, both
      versions present when the same file is imported twice); Cancel leaves the app exactly as it
      was, with no stuck "Importing…" state.
- [ ] Export as Markdown and open it in a text editor. **Expected:** readable, with code fences intact.
- [ ] **(C-21)** Export in the **packaged** app. **Expected:** a save dialog or a file in Downloads.
      Record which; if nothing happens, the clipboard fallback must be offered.
- [ ] Export all, then import on laptop B. **Expected:** all threads present, and images still viewable.
- [ ] **Export all with a temporary chat open** (P2 fix round). Start an ephemeral chat, say something
      in it, then Settings → **Export all chats**. **Expected:** the toast says "… — 1 temporary chat
      left out"; opening the file in a text editor finds nothing from that chat. Exporting that one
      chat from its own … menu still works.
- [ ] **Import a hand-edited file** (P2 fix round). Open an export in a text editor, set one message's
      `"status"` to `"waiting"` and another's to `"streaming"`, save, import. **Expected:** both rows
      come in as ordinary finished/interrupted messages — no row offers Try now / Cancel, and none
      sits streaming for ever.

## 9. Recipes and structured output
- [ ] Type `/names`, fill the form, send. **Expected:** a card deck; keep 3 → "More like these"
      references exactly those 3.
- [ ] **(C-21)** `json_schema` on the llama.cpp farm: run Name deck on F2. **Expected:** cards render
      (via the prompt-embedded schema fallback). Note whether the reply was clean JSON.
- [ ] **(C-21)** `json_schema` on **Ollama gemma4 with thinking** (F1): run Name deck. **Expected:** cards
      render. Record which path worked: clean JSON content, JSON only in the reasoning, or an empty reply
      that needed **"Retry without strict format"** (after which the same model uses the prompt mode
      automatically).
- [ ] Run Asset tags on 3 dropped renders. **Expected:** a table; Copy TSV pastes cleanly into Google
      Sheets / Excel.
- [ ] Duplicate a built-in, edit its system prompt, export it as `.lolrecipe.json`, and import it on
      laptop B. **Expected:** the recipe works identically.
- [ ] Import a hand-broken recipe file. **Expected:** a clear error list, nothing imported.

## 10. Appearance, input, accessibility, platforms
- [ ] **Theme:** toggle light/dark in the topbar while LOL Chat is visible. **Expected:** every chat
      surface follows the tokens: sidebar, composer, cards, tables, code, meter, strip, dialogs, Run card,
      search card. No unreadable text, no hard-coded white or black patches.
- [ ] **Buttons:** New chat and Send have the accent styling (the old unstyled `.btn-accent` bug is gone).
- [ ] **IME:** type Japanese (Microsoft IME) and confirm a conversion with Enter. **Expected:** Enter
      confirms the conversion and does not send. French dead keys (`^` + `e`) also work.
- [ ] **Keyboard:** Esc stops a reply; ↑ in an empty composer edits the last question; Alt+←/→ switches
      branches; Ctrl+Shift+O opens a new chat; Ctrl+K opens the palette (if shipped). None of these fire
      while Open WebUI is visible.
- [ ] **Notifications:** start a long reply and switch to Blender. **Expected:** one OS notification when
      it finishes (Windows toast / macOS Notification Center / Linux). It can be disabled in chat settings.
  - Windows: test the **installed** (NSIS) build. An unpacked/dev run has no AppUserModelID and shows no
    toast; that is expected, not a bug.
  - Clicking the toast: record whether the window comes to the front. On Windows a renderer
    `window.focus()` often only flashes the taskbar; if so, note it (DISCUSS D-C7), it is a known limit.
- [ ] **(C-21)** **Read aloud** (farm with Kokoro TTS on): press Read aloud. **Expected:** audio plays
      through WebAudio; Stop works. Record whether MP3 decoded or the WAV fallback was used.
- [ ] **Numbered steps with a code block** (P0 fix round 2): ask for "three numbered install steps,
      each with a bash code block". **Expected:** every code block starts at column 0 — no hanging
      three-space indent — and **Copy** puts exactly that on the clipboard. This is the shape the
      parser used to get wrong (the fence re-opens at top level still indented to the closed list
      item's content column); a Python example is the sharpest test, since the indent makes it
      unrunnable.
- [ ] **A stuck model does not freeze the window** (P0 fix round 2): if a real farm ever produces a
      repetition loop (a long run of backticks, asterisks or underscores), the window must stay
      responsive — the sidebar scrolls, Stop works. Measured in the unit gate at 4,000 characters;
      a run in the 100k range has never been seen from a real farm and is the remaining unknown
      (DISCUSS D-M7). If it happens, capture the reply text.
- [ ] **Links in replies:** ask for "a link to http://<farm-ip>:41997/lol/admin and to https://docs.blender.org
      and an email address as a mailto link". **Expected:** both http(s) links open in the system browser
      (the LAN one too); the `mailto:` shows as plain text, not a dead link (DISCUSS D-C8).
- [ ] **Screen reader:** Narrator (Windows) / VoiceOver (macOS) announces "Reply finished" once, and
      the buttons have names.
- [ ] **High-DPI and small windows:** 150% scaling, window at 1024×700. **Expected:** no horizontal
      page scroll; tables and code scroll inside their own boxes.
- [ ] **macOS arm64 + Intel, Linux AppImage:** sections 2.1, 5 (images + one PDF) and 7 (quit mid-stream)
      pass on each.

- [ ] **Both themes on a real screen.** Open a thread with a code block, a table and a reasoning
      panel, and toggle the theme from the topbar. **Expected:** the chat repaints in the other theme
      with no light-on-light or dark-on-dark text, the code block keeps its surface and its header
      (language + Wrap/Copy), the SVG fence shows EITHER its preview OR its code (never both at once —
      the P1-landing `[hidden]` bug), and the scrollbars match the theme. The harness photographs
      this against the mock (`p1-shots-{dark,light}`); this item is the same check on a real display,
      at a window size the harness never uses.

## 11. Privacy and data locality
- [ ] With the farm's LiteLLM logs visible, attach a text file and a PDF and chat. **Expected:** **zero**
      `/v1/embeddings` calls. The farm receives only chat completions, one OCR PUT for the PDF, and a
      SearXNG query only when the globe is on.
- [ ] Nothing about LOL Chat history appears on the farm disk (`lol.config.json` directory, logs contain
      no thread titles beyond LiteLLM's normal request logging).
- [ ] **Data folder move** in Preferences. **Expected (known limitation, DISCUSS D-C2):** LOL Chat
      history does **not** move; it stays in the app profile. Confirm the history is still there after
      the move and note it for the owner's decision.

## 12. Studio rails (S0, added at the S0 landing 2026-09-16)
No panel ships in S0, so these are the rails themselves. Anything marked **(needs a panel)** waits
for the Computer panel.

- [ ] **The workbench column, on a real display.** With a chat open, press **Ctrl+\** to cycle
      chat → split → work → chat, and **Ctrl+1** to open the first panel. **Expected:** the column
      slides in on the right, the tab rail shows the panel, the width control (Chat / Split / Panel)
      follows, and in **Panel** the composer docks as a bar across the bottom with the conversation
      hidden. Photographed against the mock as `s0-shots-{dark,light}`; this is the same check on a
      real screen at a window size the harness never uses. Look specifically at the **composer in
      split**: the text box must be full width with the meter and Send under it (S0-landing fix).
- [ ] **Drag the split with a real mouse**, then relaunch the app. **Expected:** the fraction comes
      back exactly where it was left (`kv ui:workWidth`). The harness only drives synthetic pointer
      events, and the keyboard resize on the grip is unverified — try ← / → on the focused grip too.
- [ ] **Narrow the window below 900px** with the workbench open in split. **Expected:** it renders
      like Panel (the panel takes the room, the composer docks); widen it again and the split
      returns. No horizontal page scroll at any width.
- [ ] **A thread remembers its workbench.** Open the panel in chat A, switch to chat B (no panel),
      switch back. **Expected:** A reopens with its panel and width, B stays closed.
- [ ] **Hidden means idle.** Open the panel, switch to Open WebUI in the topbar, leave it ~15 s,
      come back. **Expected:** the panel is rebuilt and correct; nothing kept running while away
      (on a real farm, the strip's GPU line should show no activity from the panel).
- [ ] **Scratch projects on a real profile.** Nothing writes projects yet **(needs a panel)**, but
      the folder can be checked the day one does: `<data folder>/LOL Studio Projects`. Two things
      the harness cannot prove: (a) a **OneDrive-backed or antivirus-scanned** data folder — the
      atomic write retries up to 3× on EPERM/EBUSY; if a save ever reports "the file is locked",
      capture it; (b) **Reveal / Open** really opening Explorer/Finder on that folder.
- [ ] **A data-folder move with projects on disk** (Preferences → Change folder). **Expected
      (known limitation, same family as D-C2):** the projects root follows the new folder
      immediately, but projects already written under the OLD folder are **not** moved. Confirm and
      note it for the owner's decision.
- [ ] **The ask spine against the REAL farm** (this is the big one — every S0 test so far ran
      against the mock). When a panel first asks for structured output **(needs a panel)**, watch
      LiteLLM's log: the first call should carry `response_format`; if the deployment drops it, the
      client must fall back to a prompt-shaped ask and still return a valid object — and the verdict
      must be remembered so the second ask goes straight to the working rung. Record which rung
      `gemma4:12b` actually needs.
- [ ] **Vision capability against the real farm.** The probe reads `/model_group/info` ONCE per
      farm. On a farm serving `gemma4:12b`, an image ask must be allowed; on an `assistant`
      (llama.cpp text) farm it must be refused BEFORE sending. Check the farm's log shows exactly
      one `/model_group/info` GET per client per farm, not one per ask.

### 12.1 Added at the S0 fix round (2026-09-16)

- [ ] **The v1 → v2 database upgrade on a REAL profile.** This is the one that touches existing
      users' chats. On a laptop running shipped **v0.1.45** with a real history (several threads,
      branches, attachments, a recipe if you have one), install vNext **over it** — do not clear
      site data. **Expected:** every thread, message, branch and attachment is still there, the
      sidebar order is unchanged, and the last-opened chat reopens. Then check the database itself
      in devtools (Application → IndexedDB → `lol-chat`): **version 2**, stores `threads, messages,
      attachments, recipes, kv, graphs, projects`. `s0-store-v2` proves this against a synthetic v1
      database; only a real profile proves it against a real one. If anything is missing, STOP and
      capture the profile before touching it again — the upgrade never deletes, so the data is
      recoverable.
- [ ] **The queue chip on a real screen.** When a panel first runs a batch **(needs a panel)**:
      the chip must appear over the bottom-left of the chat area while the batch runs, read
      `<label> — i/n`, and disappear when it ends. Press its **Cancel**, and separately press
      **Escape** — both must stop the batch. Check it in both themes and at a narrow window: it must
      not cover the composer or push anything.
- [ ] **The background lane against a real multi-seat farm.** With the farm at 2+ seats and a
      second laptop idle, start a panel batch **(needs a panel)** and watch the farm's connected
      clients / seat count: this client must hold **one** seat, never two, however many asks the
      panel fans out. Then type and Send from the same laptop mid-batch — the batch's in-flight call
      must be aborted immediately and the reader's own answer must start.
- [ ] **`project.json` is the app's, not the model's** **(needs a panel)**. Once a panel writes
      files, confirm from the panel's own file list that the project's settings (auto-apply,
      auto-fix) can only be changed through the app's own control, and that a model-written file
      never lands on top of `project.json`. Both are refused in code; this is the eyes-on check that
      nothing routes around it.
- [ ] **The strict harness flake.** One `--strict` run in six went red on this box with the scenario
      name lost to the scrollback (S0 review, finding 7). The runner now repeats every failure by
      name in a `[run] FAILED (n):` block at the tail. Next time a strict run goes red on a green
      tree, **keep the tail** and file the scenario name — the flake is still unidentified.

## 13. The Computer (C1, added at the C1 landing 2026-09-16)

The panel is in the workbench rail as **Computer**. C1 has three part types — Note, Ask, Collect —
and one graph per thread. The harness drives it through a debug door on a mock farm; these are the
things only a person on a real farm can answer. **Quiet farm OK** for everything here except the
seat item, which needs a colleague or a second laptop.

- [ ] **A program on the first try.** On a real farm, start a chat, open **Computer**, place
      Note → Ask → Collect, wire them, type something into the Note, give Ask an instruction, press
      **Run**. Expected: each part goes Waiting → Running → Done with its own value under it, the
      cost chip shows real tokens and seconds, and the answer is the model's, not an echo. Note how
      long the whole thing took to *understand* — if you had to guess what a port meant, say so.
- [ ] **A typo costs one generation.** Change the Note's text and Run again. Expected: exactly the
      dirty parts re-run (watch the farm's own request count or the Farm app panel) — Ask runs once,
      not the whole graph. Then change nothing and press Run: it must say nothing is to be done.
- [ ] **Stop means stop.** On a slow real model, Run and press **Esc** (and separately the Stop
      button) mid-generation. Expected: the running part goes back to *Needs a re-run* with no red
      error, finished parts keep their values, and the farm shows the request really gone (the seat
      frees). Then press Run: it picks up where it stopped.
- [ ] **The seat belongs to the human.** With a colleague (or laptop B) chatting on the same farm,
      start a Run. Expected: your graph waits or gives up its seat with *"The farm went to someone
      else — press Run to pick up where it stopped."*, the colleague's answer is never delayed, and
      nothing is lost. **Do not run this on AN-A6000PRO during working hours.**
- [ ] **It survives the app.** Build a graph, quit LlmOnLan (the X — close means close), reopen, go
      back to that thread. Expected: the same parts in the same places at the same zoom, the values
      still there, and a part that was mid-run comes back as *Needs a re-run* rather than stuck on
      *Running*. Check a second thread has its OWN empty graph, and switching back and forth never
      mixes them up.
- [ ] **Undo is trustworthy.** Delete a part, undo; move parts, undo; wire and unwire, undo. Expected:
      Ctrl+Z walks back through real steps (not one giant one, not a stuck button) and the part
      values survive a move. A wire the graph refuses (a loop, a wrong type) must snap back with a
      sentence naming the reason, not a silent no-op.
- [ ] **The canvas at a real size.** At a narrow window in **Split** and again in **Panel** width:
      pan (space-drag, wheel), zoom (ctrl+wheel), press **f** to fit. Expected: smooth at 60 fps with
      a graph of a dozen parts, nothing painted outside the canvas, the toolbar always reachable, and
      Fit really framing everything. Try it in **both themes** — every state must read as a word
      next to the colour, not by colour alone.
- [ ] **Keyboard and screen reader.** Tab into the canvas: the focused part must show a visible focus
      ring (the harness cannot see `:focus` in an unfocused window — this is the eyes-on check), and
      arrow/Delete/Ctrl+Z must act on it. With a screen reader on, Run once and confirm the run
      result is announced as a sentence.
- [ ] **Touch and trackpad.** On a laptop trackpad (and a touchscreen if you have one): two-finger
      pan, pinch zoom, drag a part, draw a wire. Untested by the harness — note anything that needs
      a mouse.
- [ ] **A big graph.** Build or paste ~30 parts. Expected: placing, dragging and running stay
      responsive, the run is visibly serial (one part at a time), and the app never freezes while a
      part is thinking. Note the wall-clock cost of a 30-part run on the real model — that number
      decides C2's generation cap default.

### Added at the C1 fix round (2026-09-16)

- [ ] **The farm arriving late.** With the client fully quit, turn the farm OFF, launch the client,
      open a thread that already has a graph with an Ask part, then turn the farm back ON. Expected:
      within a few seconds the Ask part's **Model** dropdown fills with the farm's models on its own
      — no tab switch, no reopening the panel — and whatever the part was already set to is still
      selected. (This was the bug: the picker read the catalogue once, at boot, and never again.)
- [ ] **A long answer in the value popover.** Ask for something deliberately long (a thousand words),
      then click the value chip on the Ask part. Expected: the popover opens instantly, shows the
      answer with its line breaks, and ends with a line saying how many characters were left out —
      it must never try to paint the whole generation.
- [ ] **Run on a big graph stays responsive from the first instant.** With ~30 parts, press **Run**
      and immediately try to pan, scroll the chat and type in the composer. Expected: the window
      answers straight away — every part flips to *Waiting* in one go, and there is no freeze before
      the first request goes out.

## 14. The Computer, fanned out (C2, added at the C2 landing 2026-09-16)

Everything here needs the **real model**, because the whole phase is about what dozens of real
generations feel like from the outside. Run them on a farm a colleague is also using — that is the
condition the etiquette exists for.

- [ ] **A forty-item fan, start to finish.** Paste ~40 lines into a Note, wire it Note → Split
      (*by lines*) → Ask → Collect, and press Run. Expected: the Ask part's badge counts up
      (`7/40`, `8/40`…) as answers land, the window stays responsive throughout, and Collect ends
      with forty answers in the order the items were in. **Write down the wall-clock time** — that
      number is what decides whether the default cap of 50 is the right one for this farm.
- [ ] **A colleague keeps their chat fast while it runs.** With the forty-item fan running, have
      someone else (or a second machine) send an ordinary chat message to the same farm. Expected:
      their answer starts promptly — the graph yields its seat — and back on your machine the run
      stops with *"The farm went to someone else"*. Press **Run** again: it must pick up where it
      stopped and NOT re-pay for the items it already answered. (Watch the farm panel's seat count
      if you want proof.)
- [ ] **One genuinely bad item.** Put something the model will refuse or choke on among forty good
      lines (a 30,000-character paste, say). Expected: the run finishes, the part is **Done**, the
      badge says 40/40, and the one failure is listed by its number under the part in words you can
      act on. The other thirty-nine keep their answers.
- [ ] **The cap, on purpose.** Set the toolbar **Cap** to something small (5), run a fan of twenty.
      Expected: the run stops, the banner over the canvas says what happened, and **Raise the cap for
      this run** finishes the work at ten without re-asking the five already answered. Confirm the
      toolbar field is still 5 afterwards — a one-run raise must not change the stored preference.
      Then set it back and confirm it survives quitting and relaunching the app.
- [ ] **Repeat really costs what it says.** A Repeat of 4 over one prompt, into an Ask. Expected:
      **four different answers**, not the same answer four times — and four generations on the farm
      (check the farm panel or `lol status`). This is the whole point of the cache salt.
- [ ] **Filter in model mode.** Twenty items through a Filter with a plain-English test. Expected:
      one short judgement per item, the kept items carry on, and re-running the graph does not
      re-judge the items it already judged. The deterministic modes (*contains* / *matches* /
      *length*) must cost the farm nothing at all.
- [ ] **From thread / To thread, in a real conversation.** Ask the model something, then From thread
      (*last answer*) → Ask (*rewrite this as five bullets*) → To thread. Expected: the result
      appears in the conversation as a normal message you can copy, quote and scroll.
      **Known gap to confirm:** the very next thing you type will NOT yet see that posted message in
      its context until you switch away from the thread and back. Note whether that bites in practice.
- [ ] **The value inspector beside the conversation.** Click the value chip on a part that produced a
      long answer. Expected: it opens in the conversation column just above the composer — readable
      at conversation width, scrollable, with a heading saying where it came from — and Escape closes
      it without touching a running graph. Try it **in both themes**, and while a run is in flight.
- [ ] **A fan repainting on a slow machine.** On the oldest laptop you have, run a twenty-item fan
      and watch the panel. Expected: no visible stutter as each item lands. (The badge is patched
      about once every 8 ms while the fan runs; nobody has yet watched that on slow hardware.)

Added at the **C2 fix round** (2026-09-16) — all of these are about a fan that spends NOTHING, which
is the case no farm-side measurement can show you:

- [ ] **A big free fan keeps the window alive.** Paste a long document (a thousand lines or more)
      into a Note, wire Note → Split (*by lines*) → Split (*by separator*, a space), set the toolbar
      **Cap** above the line count, and press Run. Expected: the window stays usable the whole time —
      you can scroll the conversation, type in the composer, and **Stop actually stops it**. Nothing
      here touches the farm, so if it feels frozen the yield is broken.
- [ ] **The item ceiling says no, out loud.** Leave the Cap at 50 and fan a part over more items
      than that (split a 200-line paste). Expected: **nothing runs at all**, the banner says how many
      times the part would have run and what raising the cap has to reach, and the raise button
      finishes the work in one press. Confirm the farm was never contacted (farm panel / `lol status`
      shows no new generations) and that the stored Cap is still 50 afterwards.
- [ ] **Which items failed survives a reload.** Run a fan where a few items fail, then switch to
      another chat and back (or quit and relaunch). Expected: the badge, the cost line **and the
      numbered list of failed items** are all still there. Before the fix the failures vanished while
      the cost stayed.
- [ ] **A repeated line is asked once.** Paste a list with two identical lines into a Split → Ask.
      Expected: the farm sees **one** generation for the pair (the second is a cache hit) and both
      places in the list carry that answer. Then do the same through **Repeat** of 4: that one must
      cost **four** generations and give four different answers.
- [ ] **Typing a cap while the panel is loading.** Open the Computer and immediately type a new
      number into the **Cap** field. Expected: the number you typed stays — it must not be replaced a
      moment later by the previously stored one — and the next run honours it.

---

## 15. The Computer: code, pictures, files and sharing (C3, added at the C3 landing 2026-09-16)

C3 is the phase where the Computer stops asking the model for everything: `Code` computes in a
sandbox, `Render` draws a picture, `File` writes into the thread's project folder, and a graph can
leave the machine as a `.lolgraph.json`. The harness proves containment in an isolated Electron
profile; **what it cannot prove is a real person's disk, a real second machine, and a real GPU.**

- [ ] **Code, on a real graph.** Note (a few lines) → Code (`return inputs.in[0].split("
").length;`)
      → the value under the part. Expected: the answer appears immediately, the farm is **never
      contacted** (farm panel / `lol status` shows no new generations), and the run costs nothing on
      the cost line.
- [ ] **A mistake reads like a sentence, and points at the line.** Type code that throws on its third
      line. Expected: the part goes red with a sentence naming **line 3**, a clickable *Line 3* chip
      under the editor selects that line, and **no Windows/macOS path** appears anywhere in the
      message. Fix the line, run again: the chip disappears.
- [ ] **A runaway loop does not take the app with it.** Type `while (true) {}` and Run. Expected: the
      window stays responsive the whole time (scroll the conversation, type in the composer), the part
      fails after a few seconds saying it did not answer in time, and the next Run works. Do it
      **three times in a minute**: the sandbox goes quiet and says so — then press **Run** once more
      and confirm it comes back (the Run button is the re-arm; a part asking on its own must not be).
- [ ] **Send a model's code to the Computer.** Ask the model for a short JavaScript snippet, then use
      the button on the code block (or the message action) with the Computer open. Expected: a Code
      part appears **where you are looking** on the canvas carrying that code with the fence markers
      stripped, and a toast says so. Close the Computer and confirm the button disappears.
- [ ] **Render, in both themes.** Note (markdown) → Render (*Markdown*). Expected: a picture appears
      on the part, readable at panel width, and **Save as PNG** offers a file. Switch the app between
      light and dark and re-run: the picture is drawn for the theme you are in. Then Note (an `<svg>`)
      → Render (*SVG*): the picture shows and **Save as SVG** writes back the same source.
- [ ] **A vendored library really runs offline.** With the machine's **Wi-Fi switched off**, use a
      sketch that needs p5 or three.js. Expected: it draws. Nothing in the Computer may reach the
      network — if a sketch only works online, that is a bug worth stopping for.
- [ ] **File writes where you can find it.** Note → File (path `out/notes.md`). Run, then press
      **Reveal**. Expected: your file manager opens on the file, inside the thread's own project
      folder under the LOL data folder, with the text in it. Run again after editing the Note: the
      **same** file is overwritten — no `notes (1).md`. Then try a path with `..` in it: it must be
      refused in words and nothing may appear outside the project folder (check the parent folder by
      hand).
- [ ] **A file the other tools can open.** Write a `.md` and a `.png` (from a Render part) into the
      project, then open both from outside the app (Explorer/Finder, an editor, an image viewer).
      Expected: ordinary files, no lock, no odd permissions.
- [ ] **Share a graph between two machines (the item the harness cannot do).** On laptop A press
      **Export…**, leave the values box **unticked**, save the file, and send it to laptop B by USB
      stick or the office share. On B, **drag the file onto the canvas**. Expected: B asks before
      replacing a non-empty canvas, the graph arrives with its wires intact and its parts in the same
      arrangement, one **Undo** takes it away again, and the file carries **no farm address, no
      password and no chat text** (open it in a text editor and look — this is a privacy check, not a
      formality).
- [ ] **Export WITH values, and what that costs.** Export the same graph with the box ticked after a
      run that made a picture. Expected: the file is visibly bigger (the picture travels inside it),
      and on the other machine the parts show their values without re-running. Note the file size.
- [ ] **Refusals read like sentences.** On laptop B try to import: a text file that is not JSON, a
      JSON file that is not a graph, and (if you can make one) a graph from a newer version.
      Expected: three different, plain sentences, and nothing changes on the canvas.
- [ ] **Tidy, on a graph you made by hand.** Build a messy graph of a dozen parts, press **Tidy**.
      Expected: parts move left-to-right by what feeds what, nothing else changes (no value is lost,
      no wire is dropped), one **Undo** puts it all back, and pressing Tidy again says there is
      nothing to do rather than nudging everything a second time.
- [ ] **Dropping a file does not fight the composer.** Drag a `.lolgraph.json` over the conversation
      column: it must behave as it always did (nothing attaches from a graph file). Drag it over the
      canvas: the drop overlay appears. Drag an ordinary image over the canvas: it must not be
      swallowed by the Computer.
- [ ] **The Computer on a laptop GPU.** Run a graph with a Render part on the oldest/weakest laptop
      you have. Expected: the picture still appears and the canvas still pans smoothly at a few dozen
      parts. Note the machine if anything stutters — the sandbox draws in a real frame and nobody has
      watched that on integrated graphics yet.

### 15b. Added at the C3 fix round (2026-09-16)

- [ ] **A sanitised SVG, opened outside the app.** Ask the model for an SVG drawing, put it through a
      Render part in **svg** mode, send it to a File part as `out/pic.svg`, run, then open that file
      from Explorer/Finder in a browser. Expected: the picture draws, and the browser's network tab
      stays **empty** — no font, no stylesheet, no image fetched from anywhere. (With the Wi-Fi off it
      must look identical.) Then open the file in a text editor: no `<script>`, no `@import`, no
      `http://` reference anywhere in it.
- [ ] **An SVG the app refuses.** Paste a deliberately broken SVG into a Note (leave a tag unclosed,
      e.g. `<svg><rect`), wire it to Render in **svg** mode and run. Expected: the part fails with a
      plain sentence and **no file is written** — not a half-drawn picture.
- [ ] **Leave a sketch running and walk away.** Run a Render/Code part, then switch the client to the
      Open WebUI surface (or minimise the window) and leave it for a minute. Expected: the machine
      goes quiet — no fan, no GPU load — and coming back and pressing **Run** works normally. This is
      the suspend path; on the old build a finished sketch kept painting behind the hidden panel.
- [ ] **A graph file that is too big.** Make a big export (values ticked, a few pictures), then try to
      import a file you have padded past 8 MB. Expected: one plain refusal sentence and nothing on the
      canvas changes — not a long freeze and not a graph that will not reopen.
- [ ] **What an exported file says about you.** Export a graph from a thread that used a
      **From thread** part set to a specific message. Open the file in a text editor. Expected: no
      message id, no thread id, no farm address, no password — only parts, wires and settings.

## 16. The Computer's control flow (K3, added at the K3 landing 2026-09-23)

Every item here is about a graph that RUNS. Do them on the real farm, with the real client, on a
graph you drew yourself — the harness can prove the mechanism, it cannot tell you whether the thing
felt safe to use.

- [ ] **▶ on a box in the middle.** Draw four boxes in a row, run the whole thing once, edit only the
      third one's instruction, then press **▶ on that third box**. Expected: the third and fourth
      boxes run, the first two do NOT (no spinner, no cost, no change), and the run bar's generation
      count goes up by exactly what those two boxes cost.
- [ ] **▶ on a cold graph.** Same four boxes, but never run them, and press ▶ on the LAST one.
      Expected: everything it needs runs first, in order, and then it runs — one pass, no refusal
      about nothing being wired in.
- [ ] **The Button really is a brake.** Put a Button between a cheap box and an expensive one and
      press **Run all**. Expected: the wave stops at the Button, it says it is ready, the expensive
      box stays pale and hatched (NOT red), and nothing was spent past the Button. Then click the
      Button's face: the expensive box runs.
- [ ] **A question does not freeze the rest.** Two branches off one note; put a Dialog in one of them.
      Run all. Expected: the question appears **in its box** on the canvas with a field and Send, the
      other branch keeps running and finishes while the question sits there, and the run bar says one
      question is waiting with a **Show me** that pans to it.
- [ ] **Close the app with a question open.** Do the above, and quit the client while the question is
      unanswered. Reopen it. Expected: it comes back with the run listed as unfinished and nothing
      half-spent; resuming costs only what was left.
- [ ] **A loop that stops.** Draw a ring through a Toggle (the loop the tutorial teaches), switch the
      Toggle **on**, and run. Expected: it stops on its own at a named ceiling, the sentence says
      which box and which limit, and the offer to raise it applies to **that run only** — the next
      Run all starts from the stored limit again.
- [ ] **A loop you cannot draw.** Try to close a ring with no Toggle/Condition/Button in it. Expected:
      the arrow is refused as you draw it, with a sentence that says a loop needs a gate — not a
      silent failure and not a graph that hangs.
- [ ] **Stop keeps what you paid for.** Start a long Run all, press **Stop** halfway. Expected: the
      finished boxes keep their answers, the one that was mid-flight goes back to pale (no error), any
      waiting question closes, and pressing Run all again re-runs only what is left.
- [ ] **The grey teaches.** One Instruction into three Conditions (yes / no / maybe). Run it.
      Expected: exactly one branch stays bright and the other two arrows visibly fade — you can tell
      which way the graph went from across the room, without reading a word.

## 17. The Computer's debug log (K7, added 2026-09-24)

The harness proves the file is written, complete and without the key. These checks need the real
window, Explorer and your own eyes.

- [ ] **The switch is where you'd look.** Open the Computer. At the right end of the run bar is
      **● Record log**. Press it. Expected: it turns red, the dot pulses, it counts events, and a
      toast names the file.
- [ ] **The file is where the guide says.** Open `%APPDATA%\LlmOnLan\logs\computer\`. Expected: a
      `computer-<today>_<time>.jsonl` that grows while you click around.
- [ ] **Mark bug takes a real screenshot.** Press **⚑ Mark bug**, type a sentence, press Save
      marker. Expected: a `…-mark-1.png` next to the file, showing the canvas and NOT the question
      box.
- [ ] **The folder button.** Stop the recording, then press the folder icon. Expected: Explorer
      opens with the file selected.
- [ ] **It survives a relaunch.** Record, close the app, reopen it. Expected: the button is red
      again, and a second file begins with `"why":"resume"`. Turn it off, relaunch. Expected: it
      stays off.
- [ ] **No password in it.** On a farm with a password, record a run, then search the file for the
      password. Expected: not found. `apiKey` reads `[redacted]`.
- [ ] **Nothing while you're elsewhere.** Record, switch to LOL Chat, type a message, come back,
      stop. Expected: no `ui.*` lines for what you typed in the chat (a request it made may appear
      as `http.*`, which is intended).
