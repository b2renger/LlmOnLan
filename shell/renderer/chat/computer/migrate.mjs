// @ts-check
// Per-thread graphs -> library documents (COMPUTER_PLAN §7.2). K1-U2.
//
// Run once after `repo.ready`, only when `repo.mode === 'idb'` (computer/main.mjs decides both and
// publishes the verdict on window.LolComputer.migration). This module is a PURE function of a repo:
// it reads rows, writes rows, sets two kv keys, and returns what it did. It renders nothing.
//
// THE TWO RULES THAT MATTER, and why:
//
//   COPY, NEVER MOVE. `repo.deleteThread` cascades: it deletes every `graphs` row indexed to that
//   thread (state/repo.mjs). A migrated graph that KEPT its threadId would therefore be destroyed
//   the day the reader deletes that chat — the surface we just promised them would eat their work.
//   The original row is left exactly as it was, so nothing in the chat changes either.
//
//   THE DERIVED ID IS WHAT MAKES THIS IDEMPOTENT. `'lib-' + hash(row.id)` with core/ids.mjs's
//   FNV-1a (NOT a new hash) is stable, so a crash halfway through the loop cannot duplicate the
//   library on the next launch: the rows already written are recognised by their own ids and
//   skipped. The kv marker is the fast path; the derived id is the correctness.
//   A 32-bit collision between two of one person's graphs is vanishingly unlikely and, if it ever
//   happened, the `getGraph(derived) -> skip` check makes the outcome "one of them is not
//   migrated" and never "one overwrote the other". The originals survive in both cases.
//
// The migrated document's `from-thread` / `to-thread` parts are NOT dropped: they load, render a
// legacy badge and fail with one sentence at run time (K1-U3). `part:unknown-type` would lose the
// reader's work, which is the thing this whole file exists to prevent.

import { hash } from '../core/ids.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/computer.en.mjs';

/** The kv key that says "this account has already been through it". */
export const MIGRATED_KEY = 'computer:migratedV1';
/** How many library documents the migration wrote, for the DEVLOG and for a toast. */
export const MIGRATED_COUNT_KEY = 'computer:migratedCount';
/**
 * Critic R1, B14: the SOURCE rows already carried over, by their own id. The derived id alone
 * answered "is the copy still there?", so a migrated graph the reader DELETED was carried over
 * again on the next launch whenever the migration was still retrying (one row had failed, so the
 * done-marker was not written yet). A source in this list is never copied twice, whatever became
 * of its copy.
 */
export const MIGRATED_SOURCES_KEY = 'computer:migratedSources';

/**
 * The library id a thread-owned row migrates to. Exported because it is the idempotency rule:
 * a test that cannot recompute it cannot prove the migration is safe to re-run.
 * @param {string} rowId
 * @returns {string}
 */
export function derivedId(rowId) {
  return `lib-${hash(String(rowId))}`;
}

/**
 * The title a migrated document gets. The row's own title wins when it has one — nothing writes
 * `GraphDoc.title` today, but an imported file carries one and a K1 rename writes one, so a
 * re-run after either must not overwrite the reader's own words.
 * @param {any} row @param {any} thread @returns {string}
 */
export function titleFor(row, thread) {
  const own = row && typeof row.title === 'string' ? row.title.trim() : '';
  if (own) return own;
  const from = thread && typeof thread.title === 'string' ? thread.title.trim() : '';
  return from ? t('computer.migrateFromThread', { title: from }) : t('computer.migrateFromThreadUnknown');
}

/**
 * `skipped` is "already there / deliberately not carried over"; `errors` is "we tried and it
 * threw". They are counted apart because only the second one means a graph is still waiting: the
 * done-marker is written ONLY when `errors === 0`, so a row that threw (a QuotaExceededError on
 * putGraph is the realistic case) is retried on the next launch instead of being sealed behind the
 * marker for ever. A re-run is already safe — the derived id makes every row idempotent.
 *
 * @param {{repo: any, now?: () => number}} o
 * @returns {Promise<{status: 'done'|'already'|'none'|'failed'|'skipped', imported: number,
 *   skipped: number, errors: number, total?: number, reason?: string}>}
 */
export async function migrateGraphsV1(o) {
  const repo = o && o.repo;
  const now = o && typeof o.now === 'function' ? o.now : Date.now;
  if (!repo || typeof repo.listGraphs !== 'function') {
    return { status: 'skipped', imported: 0, skipped: 0, errors: 0, reason: 'no-repo' };
  }

  try {
    const marker = await repo.kvGet(MIGRATED_KEY, null);
    if (marker) {
      const count = Number(await repo.kvGet(MIGRATED_COUNT_KEY, 0)) || 0;
      return { status: 'already', imported: 0, skipped: 0, errors: 0, total: count };
    }
  } catch (err) {
    console.warn('[lolcomputer] reading the migration marker failed', err);
    return { status: 'failed', imported: 0, skipped: 0, errors: 0, reason: 'kv-read' };
  }

  /** @type {any[]} */ let rows = [];
  try {
    rows = (await repo.listGraphs()) || [];
  } catch (err) {
    console.warn('[lolcomputer] listing the graphs to migrate failed', err);
    return { status: 'failed', imported: 0, skipped: 0, errors: 0, reason: 'list' };
  }

  const owned = rows.filter((r) => r && r.threadId !== null && r.threadId !== undefined);
  if (!owned.length) {
    // Nothing to carry over — still mark it, so a reader who never used the panel does not pay a
    // full `listGraphs()` on every launch for the rest of the product's life.
    await markDone(repo, 0);
    return { status: 'none', imported: 0, skipped: 0, errors: 0, total: 0 };
  }

  /** @type {Set<string>} */ let done = new Set();
  try {
    const list = await repo.kvGet(MIGRATED_SOURCES_KEY, []);
    if (Array.isArray(list)) done = new Set(list.map((/** @type {any} */ v) => String(v)));
  } catch { /* no list is an empty list: the derived id still keeps a re-run safe */ }
  const before = done.size;

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  for (const row of owned) {
    if (done.has(String(row.id))) { skipped += 1; continue; }
    const id = derivedId(row.id);
    try {
      if (await repo.getGraph(id)) { skipped += 1; done.add(String(row.id)); continue; }
      const thread = typeof repo.getThread === 'function' ? await repo.getThread(row.threadId) : null;
      // An ephemeral chat is the one the reader asked never to be written down; copying its graph
      // into a permanent library is not the consent that reverses that. In practice the ephemeral
      // backend is empty at boot, so this guard almost never fires — it is here so that the
      // almost never is not a silent exception to the promise.
      if (thread && thread.ephemeral) { skipped += 1; continue; }
      await repo.putGraph({
        ...row,
        id,
        threadId: null,
        folder: null,
        title: titleFor(row, thread),
        updatedAt: Number(row.updatedAt) || now(),
      });
      imported += 1;
      done.add(String(row.id));
    } catch (err) {
      console.warn('[lolcomputer] migrating one graph failed', err);
      errors += 1;
    }
  }

  if (done.size !== before) {
    try { await repo.kvSet(MIGRATED_SOURCES_KEY, Array.from(done)); } catch (err) {
      // Without the list a re-run falls back to the derived-id check, which is what it was before.
      console.warn('[lolcomputer] writing the migrated-sources list failed', err);
    }
  }

  // The marker is a "never look again" promise. Making it while a row is still unwritten would
  // strand that graph: the original thread-owned row survives (copy-never-move), but no surface
  // can open a thread-owned graph any more, so it would be unreachable and unmentioned.
  if (!errors) await markDone(repo, imported);
  return { status: 'done', imported, skipped, errors, total: owned.length };
}

/** @param {any} repo @param {number} n */
async function markDone(repo, n) {
  try {
    await repo.kvSet(MIGRATED_COUNT_KEY, n);
    await repo.kvSet(MIGRATED_KEY, true);
  } catch (err) {
    // The rows are already written and the derived ids make a re-run safe, so a marker that did
    // not land costs one wasted listGraphs() and nothing else. Never fail the migration for it.
    console.warn('[lolcomputer] writing the migration marker failed', err);
  }
}
