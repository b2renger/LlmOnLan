# Open WebUI must survive its first start

**Status: proposed 2026-11-17 after the class, waiting on the owner.** Nothing is built.

## What happened in the class (2026-11-17)

Most students could not use the Open WebUI tab: *"Could not start the chat — Open WebUI keeps exiting (code 1)"*.
The farm was healthy the whole time (PRO 6000: 0.0.54, vLLM, 48 seats, never more than 5 in use). One student's Mac
log (`boot.log`, read with the owner; not kept here: it holds a person's path) shows the chain:

1. **The first start of Open WebUI on a fresh Mac was slow:** not healthy after 137 s.
2. **The client moved Open WebUI between the two farms in the room** (the PRO 6000, pinned, and spark-2cb5) about 30
   times in 20 minutes. Every move kills Open WebUI and starts it again. The cause: a farm not heard for 12 s is
   *stale* (`shell/src/main/discovery.ts:73`), and a stale farm loses even its pin (`shell/src/main/farmSelect.ts:96-98`).
   On a classroom Wi-Fi where 30 laptops download 740 MB each, 12 s without one 2 s poll answering (1.5 s timeout) is
   easy. The other farm's next 5 s beacon wins, and the switch comes back as soon as the PRO 6000 answers.
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
`webui.db` aside repaired it (healthy in 13.5 s). On Linux (the released `owui-sidecar-linux-x64`, killed like the Mac
client kills: SIGTERM to the group, SIGKILL 1.5 s later) 14 kills at the start of a migration all recovered: the
window is a kill that lands *inside* a migration's SQL, which a slow first start makes far more likely. The Mac's own
error text was not read (Open WebUI's output goes to the console only, item 4).

## The fix (four small changes, each with its check)

1. **Never kill Open WebUI while it starts.** `sidecar.repoint()` during a start that has not reached *healthy*
   records the new farm and applies it when the start ends (healthy, or failed). Check: a test that repoints a
   starting sidecar and sees one start, then one repoint. (Quitting the app during a first start still kills it:
   item 3 covers that.)
2. **A pinned or current farm keeps Open WebUI while it is only quiet.** Stale (12 s) stays what the farm list shows;
   moving Open WebUI away from the pinned or current farm waits until it has been silent for 60 s, or the farm says
   it is unhealthy. Check: `farmSelect` tests, a stale pin with another healthy farm present → no switch before 60 s.
3. **A database whose first start never finished is not kept.** Before a start, the client notes whether `webui.db`
   exists. If it did not, and that start ends without reaching healthy (killed, crashed, app quit), the next start
   first moves `webui.db*` into `owui-data/interrupted-<time>/`. Nothing a person wrote can be in it: Open WebUI never
   opened. Check: the reproduction above, run through the client's sidecar code.
   *Not covered:* a folder with chats broken by an interrupted **upgrade** migration. The copy the client already makes
   before a new Open WebUI's first start on a folder (`keepDbBeforeEngine`) is the way back; the error panel should
   name it. A plan line if wanted.
4. **Keep Open WebUI's output in a file:** `[owui]` lines also go to `<userData>/logs/owui.log` (1 MB, then `.1`, as
   `boot.log`). It stays on the computer (privacy boundary unchanged: a local log, read by the person). Then the next
   error can be read from the file, not only from a Terminal.

None of these touch Open WebUI: they are the client's start, its farm choice and its log.

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
