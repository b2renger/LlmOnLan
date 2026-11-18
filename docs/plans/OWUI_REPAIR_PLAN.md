# OWUI_REPAIR_PLAN: one button repairs a laptop whose Open WebUI database was broken

**Status: approved by the owner, 2026-11-18** ("ok for the repair button"; v0.2.19 after it). **Built 2026-11-18**
(day session, DEVLOG 10:24): `sidecar.ts` `repairOwuiDb` / `MIGRATION_BROKEN` / `repairDb`, the IPC `repair-owui-db`
in `index.ts`, the button in `renderer/app.js`. Two fixes found while checking it, below (*Built*).

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
*Checked 2026-11-18 (night n° 9, DEVLOG 02:29):* the released v0.2.18 sidecar on Windows, its first start killed at
migration 60 (*Add single-parent group hierarchy*), then started by the compiled supervisor: every one of the six
starts printed `ERROR [open_webui.env] Error running migrations: (sqlite3.OperationalError) duplicate column name:
version_id` (and the same in SQLAlchemy's `sqlalchemy.exc.OperationalError: (sqlite3.OperationalError) …`), about
2.3 s in, and its last error line reached `owui.log` about 0.3 s **before** the child's exit, so the flag is set
before the error state. Not checked: the order on a Mac, and the `already exists` form (n° 8 saw it at migration 30;
tonight's kill there recovered).

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
   **A copy is put back at most once.** The copy can itself be broken: a laptop the class broke that stays broken
   until a later client bumps the pin gets, at that pin's first start, a `before-owui-<new>` copy *of the broken
   database* (`keepDbBeforeEngine` copies whatever `webui.db` is there). Putting it back would fail the same way, and
   the button would loop. So the repair records the copy it put back (`lol-owui-repaired`, the copy's name); a click
   that finds that copy already recorded moves the database aside **without** putting anything back, Open WebUI builds
   a new one, and the panel names the folder that holds the moved files and every `before-owui-*` copy (an older,
   good copy, such as a teacher's `before-owui-0.13.3`, stays there for a later restore; not this plan).
4. Reset the crash counter and start, as Retry does (`restart-sidecar`'s path, the farm's password kept).
5. Log one line to `owui.log`: `--- repaired: moved to broken-<time>[, the copy before Open WebUI <v> put back]`.

**What the person can lose, case by case** (the broken files stay in `broken-<time>/` in every case):
- *An interrupted first start* (no copy): nothing; the database never opened.
- *An interrupted upgrade, the copy made at the start that broke*: nothing, by the reasoning in 3.
- *A database broken under one pin and copied by a later pin's first start*: the first click puts back a broken copy
  and fails again; the second builds a new database. Open WebUI's chats are then only in the moved files and the older
  copies, and the panel says so. v0.2.19 keeps the 0.13.3 pin, so it makes no such copy; a pin bump before the class's
  laptops are repaired would.

## Checks

- **Unit** (`shell-main`): a folder with a fake `webui.db` and a `-wal`: moved to `broken-*`, `lol-client` untouched;
  with a `webui.db.before-owui-0.13.3`: it is back as `webui.db` and still beside it; a second click with that copy
  recorded puts nothing back; no button flag without the error line; the flag is cleared by the next start.
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

## Built (2026-11-18)

As planned, with these differences, each checked:
- **The repair's notice** comes with the next ready (the toast the offline-start notice uses), not in the panel: the
  panel is replaced by *Starting…* at once. It names the folder of the broken files, and, when nothing was put back,
  the `before-owui-*` copies left in the data folder.
- **The rollback journal moves too** (`webui.db-journal`, in the shared move, so the first-start set-aside also
  gets it): Open WebUI's SQLite runs in rollback-journal mode, and a kill left a `webui.db-journal` beside the
  database. A hot journal left beside a new database is rolled into it, which corrupts it (sqlite.org/howtocorrupt.html).
- **"Keeps exiting" is no longer overwritten** 3 minutes later by *did not become healthy in time*: the start's health
  wait ran on after its child had exited for good and replaced the message (and so hid the button's reason).
  Older than this plan; found in the dev client.

**Checked** (the released v0.2.18 Windows sidecar, Open WebUI 0.13.3, driven by the compiled supervisor; DEVLOG):
a first start killed at migration 60 as in v0.2.18 (the version recorded first): *keeps exiting* with `repairable`,
one repair, healthy 25 s later. The same without the record (a copy of the broken database taken): the first repair
puts the broken copy back and fails, the second builds a new database, healthy. An Open WebUI 0.10.1 database with one
chat, its upgrade to 0.13.3 killed: one repair puts the copy back, 0.13.3 migrates it, healthy in 13 s, **the chat is
there**. In a dev client (the real window): the panel showed the sentence and the button 19 s after launch; one click;
ready 25 s later, the chat on screen, the notice naming the folder. *Not checked:* a Mac; the `already exists` form
(matched by the unit test only).

## Not in this plan

- Repairing **without** a click: the client cannot read the database (no SQLite in main) to prove it holds nothing,
  and question 3 offered the owner a button, the person's own choice.
- A Preferences "restore an older copy" for other cases (`keepDbBeforeEngine`'s comment names it as the upgrade path).
