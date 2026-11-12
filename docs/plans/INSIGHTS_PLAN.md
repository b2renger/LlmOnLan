# Insights plan: what the sessions may see of how LlmOnLan is used

**Status: approved by the owner, 2026-11-12, for §6.5 and §7.1 only:** **build "Save a usage report" first** (a file on the person's own
computer, nothing sent). Decisions 1 to 4, which change the project's central promise, still wait. Written 2026-11-12 (session 1).

## 1. The ask (owner, 2026-11-12)

> We need an opt-in option to share statistics with the farm for clients and you. You need to be able to have access to
> several levels of data to be able to rerun user scenarios, find bugs and think about better UX when used by humans.
> And a full log access when you run your own test by controlling the apps yourself.

## 2. The conflict to settle first

`CLAUDE.md`, prime directive 3: *"All persistent data stays on the client machine… **The farm is stateless and stores
nothing.**"* And `docs/context/privacy.md`: *"If a feature would move stored data off the device or persist anything
server-side, it breaks the promise — flag it."*

Usage statistics kept on the farm are data from a person's computer, stored on a server. Even with consent, and even
with no chat text in them, that is a change to the promise, not a detail of it. This plan therefore proposes the
**exact new sentence** the promise would carry (§6, decision 1), and builds nothing until the owner accepts it.

## 3. What a session can already read today (no change needed)

| Source | Where | What it holds | Limits |
|---|---|---|---|
| The farm's snapshot | `GET /lol/self`, the panel | engine, model, seats, connected clients, GPU load | now only; nothing kept |
| The farm's log | the Farm app's `farm.log` | starts, stops, errors, plugin lines; **no prompt, no document text** (by rule) | the live farm's log is the owner's: a session reads it only when asked |
| The client's boot log | `<userData>/logs/boot.log` | Open WebUI's states and timings at start | this computer's client only |
| The Computer's Record log | `%APPDATA%\LlmOnLan\logs\computer\*.jsonl` | a person's recorded bug: the graph's events, keys redacted | opt-in per recording, this computer only |
| The client harness | `shell/test/chat-harness/` | everything: console, network, screenshots, over CDP | a test client on a mock farm |
| A scratch farm | the skill `lol-scratch-farm` | everything: its own log, LiteLLM's, the engine's | a test farm |

So **level 3 below already exists**: when a session drives the apps itself, it has full logs. What is missing is
anything from real use by other people.

## 4. The proposal: three levels, each with its own switch

| Level | What | Who turns it on | Holds |
|---|---|---|---|
| **0. Nothing** (the default, as today) | no usage data leaves the computer | nobody | — |
| **1. Counts** | per day, per client version: which surface was opened (Open WebUI, LOL Vibe, the Computer), how many replies, the wait for a first word (median, worst), error codes with their count (`lol_seats_full`, a 502, an upload that failed), which box types and templates were run | the person, in Preferences ▸ a new **Share usage statistics** switch, off | numbers and names from fixed lists. **Never**: text of a chat, a prompt, a document, a file name, a search, a graph's content, an address a person typed |
| **2. Scenarios** | the same, plus the ordered steps of a session as events from a fixed list (`opened Computer`, `ran template Read the news`, `box Instruction failed: seats full`, `cancelled`), with timings, so a session can replay the path on the harness | the person, a second switch under the first, off, with **Show what would be sent** | event names and timings. The same "never" list |
| **3. Full logs** | everything | no one: only test instances a session starts itself | exists today (§3) |

Design points:
- **Fixed lists, not free text.** An event is a name from a list in the code plus numbers. A field that could carry
  what a person wrote does not exist, so it cannot leak. One test asserts every event's shape.
- **No identity.** No hostname, no user name, no IP kept. A random id made per install, changed each month, so a
  scenario's steps hold together and nothing follows a person for long.
- **Seen before sent.** *Show what would be sent* opens the exact JSON of the day. A person can turn it off at any time;
  off stops sending at once.
- **Where it is kept:** on the farm in use (the school's own computer, never a cloud), in one folder the panel names,
  as dated files, deleted after 30 days. The panel shows the folder, its size, and **Delete all**. The farm's beacon
  says whether it accepts statistics; a farm that does not gets none.
- **Who reads it:** the operator in the panel (a simple page of the counts), and the sessions, from that folder, on
  the development computer.
- **Size:** two new routes on the farm (`POST /lol/insights` behind the farm password, the panel's page), one module
  on the client that fills a day's buffer in `DATA_DIR` and sends it, one Preferences section. Open WebUI is not
  touched: what happens inside its webview is not counted beyond "it was open" (prime directive 1 and 4).

## 5. What it would let a session do

- **Find bugs people hit and do not report:** error counts by version, the step before a cancel, a template nobody
  finishes.
- **Rerun a scenario:** level 2's steps replayed on the harness against a mock or a scratch farm.
- **Put work in order by use:** which boxes, templates and surfaces teachers really open.
- **Measure the wait people feel** on real hardware and real class sizes, beside the bench numbers.

It would not show what people write, and it should not: a UX question that needs the words is a question to ask a
teacher, in person.

## 6. Decisions for the owner

1. **The promise.** Accept this sentence in prime directive 3 and in the privacy boundary, or refuse the feature:
   *"The farm stores nothing, with one exception a person turns on: usage statistics (counts, and optionally the steps
   of a session), with no text a person wrote and no identity, kept 30 days on the farm in use."*
2. **Who consents.** Each person on their own computer (proposed). Students may be minors and the school has its own
   rules: who at the school must agree before any student's client can show the switch? Until that is answered, the
   switch could exist only on clients the owner marks (a setting, off by default).
3. **Levels.** Both 1 and 2, or level 1 first and level 2 after a term of use (proposed: level 1 first).
4. **Retention.** 30 days (proposed), or another length.
5. **A simpler first step, needing no change to the promise:** a button **Save a usage report** in Preferences that
   writes the same level-1 JSON to a file on the person's own computer, which they hand over as they choose (a USB
   stick, an email). Nothing is sent, nothing is stored on the farm. It would test the event lists and the usefulness
   of the data before deciding 1–4. **Recommended as the first build.**

## 7. Build order, once decided

1. The event lists and the day's buffer on the client, with the shape test; **Save a usage report** (decision 5).
2. With decision 1 accepted: the Preferences switches and *Show what would be sent*; the farm's route, folder, 30-day
   deletion and panel page; `privacy.md`, `CLAUDE.md` and the client's About text changed in the same commits.
3. A harness scenario that turns it on, runs a template, and checks the file on a scratch farm holds only listed
   names; HUMAN_TESTS entries for the switch, the preview and the deletion.
4. The replay: a harness mode that takes a level-2 file and walks its steps.
