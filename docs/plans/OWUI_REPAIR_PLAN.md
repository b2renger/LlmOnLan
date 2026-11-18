# OWUI_REPAIR_PLAN: one button repairs a laptop whose Open WebUI database was broken

**Status: proposed, waiting on the owner** (session n° 8's question 3, 2026-11-17; plan written by night n° 9,
2026-11-18). Nothing is built. It is a new button, so it needs the owner's yes; it could ship in v0.2.19 if the yes
comes before the release.

## Why

The class of 2026-11-17 broke Open WebUI's database on many laptops ([OWUI_START_PLAN](OWUI_START_PLAN.md)): a kill
inside one of its migrations leaves `webui.db` half-migrated, and every later start exits with code 1. v0.2.19 stops
the kills and heals an interrupted **first** start by itself (its marker), but a laptop broken **in the class** has no
marker, and an **upgrade** start that is interrupted (a quit, a crash, a power cut while a new Open WebUI migrates a
database that holds chats) is not healed either. Today the repair is by hand: quit, find `owui-data`, move three files,
reopen (HUMAN_TESTS A28's last lines). A student will not do that.

## What the person sees

On the error panel *Could not start the chat — Open WebUI keeps exiting (code 1)*, and **only** when Open WebUI's own
output said why (below), a second button beside **Retry**:

> **Repair Open WebUI's database**
> *Open WebUI's database was left half-built, so it cannot start. This moves it aside and starts again. Your LOL Vibe
> and Computer work is not touched.* (plus, when a copy exists: *Your chats from before the update are put back.*)

After the click: *Moved to `<folder>`. Starting again…*, then the usual start. The files are moved, never deleted.

## When the button shows

`sidecar.ts` `logChild` already sees every line of a start. A start whose output has a line matching
`/\(sqlite3\.OperationalError\).*(already exists|duplicate column name)/` sets `migrationBroken = true` (reset at each
`start()`). The supervisor's error state carries `repairable: true` (`types.ts` `SidecarState`, one optional field)
only when the last start ended with that flag. Any other exit code 1 (a port, a missing library) shows Retry only.
*To check when built:* the exact line on a real broken database, with n° 8's reproduction (a kill inside migration
30, 50 or 60; DEVLOG 2026-11-17 14:30, its scripts are not in the repository); the pattern is taken from SQLAlchemy's message form
and the reproduction's errors (`table _alembic_tmp_knowledge already exists`, `duplicate column name: timer_at`).

## What the click does (main, one IPC `repair-owui-db`)

1. Refuse while Open WebUI runs or starts (`isBooting()` or a child): the button only exists on the error state.
2. Move `webui.db`, `webui.db-wal`, `webui.db-shm` into `<DATA_DIR>/broken-<time>/` (the same move as
   `setAsideUnfinishedDb`, one shared function). Never `lol-client`, never anything else.
3. **If `webui.db.before-owui-<this version>` exists** (the copy `keepDbBeforeEngine` made before this Open WebUI
   version first started on the folder), copy it (and its `-wal`) back as `webui.db`. Why this is safe: these errors
   come only from migrations, and migrations run only on the first start of a version on a folder; a version whose
   migrations never finished never opened, so nothing was written under it. The copy holds every chat. Open WebUI
   then migrates the copy again, now with no kill (v0.2.19's rule).
   **If no copy exists**, the database was being built for the first time (it can hold nothing a person wrote), and
   Open WebUI builds a new one. The client signs in again by itself (`WEBUI_AUTH=false`).
4. Reset the crash counter and start, as Retry does (`restart-sidecar`'s path, the farm's password kept).
5. Log one line to `owui.log`: `--- repaired: moved to broken-<time>[, the copy before Open WebUI <v> put back]`.

What the person can lose: nothing on the first-start case; on the upgrade case, nothing that the copy does not hold,
and by the reasoning in 3, the copy holds everything Open WebUI had. The broken files stay in `broken-<time>/`.

## Checks

- **Unit** (`shell-main`): a folder with a fake `webui.db` and a `-wal`: moved to `broken-*`, `lol-client` untouched;
  with a `webui.db.before-owui-0.13.3`: it is back as `webui.db` and still beside it; no button flag without the
  error line; the flag is cleared by the next start.
- **Real Open WebUI** (scratch, the released sidecar as in DEVLOG 2026-11-18 02:15): break a first start with the
  kill script, see the flag; repair, healthy. Then a database with one chat made under an older pin, upgrade start
  killed inside a migration, repair: the chat is there.
- **Harness:** the panel shows the button only with `repairable`, and its click calls the IPC.
- **HUMAN_TESTS:** A28's manual lines become: *a laptop from the class: the panel shows **Repair Open WebUI's
  database**; press it; the chat opens.*

## Size

**S**: about 40 lines in `sidecar.ts` and `index.ts`, 15 in `renderer/app.js` (the shell's own panel; its words
inline like Retry's), one preload line, the tests above. No new dependency, no call into Open WebUI (files only, as
`keepDbBeforeEngine` already does).

## Not in this plan

- Repairing **without** a click: the client cannot read the database (no SQLite in main) to prove it holds nothing,
  and question 3 offered the owner a button, the person's own choice.
- A Preferences "restore an older copy" for other cases (`keepDbBeforeEngine`'s comment names it as the upgrade path).
