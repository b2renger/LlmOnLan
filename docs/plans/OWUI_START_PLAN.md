# Open WebUI must survive its first start

**Status: approved by the owner, 2026-11-17** ("Do whatever now we need to fix this"). Built the same day; a client
release waits on the owner's test.

**Also found after the plan was written:** LOL Vibe and the Computer use whichever farm Open WebUI is pointed at
(`shell/renderer/app.js:404` `activeFarm`). So every switch also moved a student's LOL Vibe and Computer to
spark-2cb5 (2 seats, both in use at 12:31, gemma4:12b): the likely cause of "sluggish with ten people". The PRO 6000
itself never had more than 1 request running: its gate passed 16 chat requests to the model, all between 12:21 and
12:26, then none until it was stopped at 14:13 (LiteLLM's and vLLM's own logs; the seat gate logs no refusals, so a
refused request would not show). Item 2 protects all three tabs.

## What happened in the class (2026-11-17)

Few students got the Open WebUI tab working (the owner); the screens showed *"Could not start the chat — Open WebUI
keeps exiting (code 1)"*. The farm was healthy when read (PRO 6000: 0.0.54, vLLM, 48 seats, 5 in use at 12:31). One
student's Mac log (`boot.log`, read with the owner; not kept here: it holds a person's path) shows the chain:

1. **The first start of Open WebUI on a fresh Mac was slow:** not healthy after 137 s.
2. **The client moved Open WebUI between the two farms in the room** (the PRO 6000, pinned, and spark-2cb5) about 30
   times in 20 minutes. Every move kills Open WebUI and starts it again. The cause: a farm not heard for 12 s is
   *stale* (`shell/src/main/discovery.ts:73`), and a stale farm loses even its pin (`shell/src/main/farmSelect.ts:96-98`).
   Why the PRO 6000 went quiet for 12 s on that Mac is not known (a hypothesis: the Wi-Fi, with 30 laptops each
   downloading 740 MB; see below). The other farm's next 5 s beacon wins, and the switch comes back as soon as the PRO
   6000 answers.
3. **From the fourth start on, every start exited with code 1**, 16–20 s in, with no switch between, and *Retry* did
   not help.

## The cause, reproduced

Open WebUI creates its database by running ~72 migrations at its first start, and on SQLite they are **not
transactional**. Open WebUI's own documentation says that an interrupted migration leaves the database
"partially-migrated" and that later starts fail on it
([manual database migration](https://docs.openwebui.com/troubleshooting/manual-database-migration)).

Reproduced on this computer with the pinned Open WebUI 0.13.3, a fresh data folder, killed the instant it printed its
Nth migration, then started again normally (a script in the session's scratch folder, 2026-11-17; it becomes item
3's check):

| Killed inside migration | Next start |
|---|---|
| 3, 10, 20, 40, 70 | healthy in 12–14 s |
| 30 (`Add prompt history table`) | **exit 1** in 3 s: `table _alembic_tmp_knowledge already exists` |
| 50 (`add current_message_id to chat`) | **exit 1**: `duplicate column name: timer_at` |
| 60 (`Add single-parent group hierarchy`) | **exit 1**: `duplicate column name: version_id` |

A broken folder **stays broken**: every later start dies the same way, which is what *Retry* met on the Mac. Moving
`webui.db` aside repaired it (healthy in 13.5 s).

**The same on Unix**, with the released `owui-sidecar-linux-x64` of v0.2.18 in WSL, its data folder on ext4, SIGKILL to
the group 50 or 150 ms after the Nth migration's line: N = 60 → **exit 1** in 2 s, `duplicate column name:
version_id` (2 of 8 kills); N = 10, 30, 50 recovered. (A first try on WSL's `/tmp`, a RAM disk, never broke: the
migrations ran too fast for a kill to land inside one.) What breaks a folder is a kill that lands *inside* a
migration's SQL, and a slow first start gives every switch more chances to. The Mac's own error text was not read:
Open WebUI's output goes to the console only (item 4). So for the Mac, this is the cause that fits its log, proven on
the same Open WebUI on Windows and Linux, not read on the Mac itself.

**Read from one laptop:** the log is one student's Mac; the other laptops' failures were seen on their screens, not in
their logs. That the Wi-Fi's load made the PRO 6000 go quiet for 12 s is a hypothesis: this computer's own installed
client, wired, beside the farm, also moved to the Spark 2.5 s after a launch on 16 November and once at 21:00. So item
2 alone will not stop every switch; **item 1 is the one that protects a first start.**

## The fix (four small changes, each with its check)

1. **Never kill Open WebUI while it starts.** `sidecar.repoint()` during a start that has not reached *healthy*
   records the new farm and applies it when the start ends (healthy, or failed). Check: a test that repoints a
   starting sidecar and sees one start, then one repoint. (Quitting the app during a first start still kills it:
   item 3 covers that.)
2. **A pinned or current farm keeps Open WebUI while it is only quiet.** Stale (12 s) stays what the farm list shows;
   moving Open WebUI away from the pinned or current farm waits until it has been silent for 60 s, or the farm says
   it is unhealthy. Check: `farmSelect` tests, a stale pin with another healthy farm present → no switch before 60 s.
3. **A database whose first start never finished is not kept.** When a start finds no `webui.db`, the client writes a
   marker file in the data folder before it starts Open WebUI, and removes it when Open WebUI is healthy. A start that
   finds the marker (the first start was killed, crashed, or the app quit) first moves `webui.db*` into
   `owui-data/interrupted-<time>/`. The marker is on disk so that it survives quitting the app. Nothing a person wrote can be in it: Open WebUI never
   opened. Check: the reproduction above, run through the client's sidecar code.
   *Not covered:* a folder with chats broken by an interrupted **upgrade** migration. The copy the client already makes
   before a new Open WebUI's first start on a folder (`keepDbBeforeEngine`) is the way back; the error panel should
   name it. A plan line if wanted.
4. **Keep Open WebUI's output in a file:** `[owui]` lines also go to `<userData>/logs/owui.log` (1 MB, then `.1`, as
   `boot.log`). It stays on the computer (privacy boundary unchanged: a local log, read by the person). Then the next
   error can be read from the file, not only from a Terminal.

None of these touch Open WebUI: they are the client's start, its farm choice and its log.

**Built 2026-11-17 (afternoon)**, as above, plus: the health wait says *still starting* after 3 min and goes on to 10
(an error at 3 min invited a Retry, which kills), and Retry waits while a start runs (`isBooting`). Checks:
`npm run test:chat` 1974 passed (SA-5 split: quiet 20 s keeps the pin, Automatic and the booted farm; past 60 s or
unhealthy fails over; a new pick stays strict; three new tests for items 1, 3, 4); and the compiled supervisor driving
the real Open WebUI 0.13.3: a repoint 4 s into a fresh first start kept the same process and moved once it was healthy
(`starting → ready → restarting → ready`); a quit during a first start, then a start: `webui.db` set aside, healthy in
13.7 s; `owui.log` with no request line. Not run here: the app itself in a room with two farms (HUMAN_TESTS A28), a
Mac.

**Also to measure:** why a fresh Mac's first start takes more than 2 minutes (Windows here: 12–14 s; the Linux
bundle: 8–9 s). Likely the first import of the bundled Python on macOS (signature checks of each library); a person
with a fresh Mac and a stopwatch, plus item 4's log, answers it.

## Repair a laptop that already shows "keeps exiting (code 1)"

Quit LlmOnLan. In the data folder (default: Mac `~/Library/Application Support/LlmOnLan/owui-data`, Windows
`%APPDATA%\LlmOnLan\owui-data`), move **only** `webui.db`, `webui.db-shm` and `webui.db-wal` into a new folder `old`.
Reopen. Leave the `lol-client` folder: it holds LOL Vibe's and the Computer's work. Open WebUI's chats made before are
in the moved file (none on a laptop whose first start never finished). The client signs in again by itself
(`WEBUI_AUTH=false`, `renderer/app.js` drops a stale token).

**Before the next class, without code:** one farm in the room (the other farms stopped or behind a password), and the
students open LlmOnLan and wait for the first start to finish before anything else.
