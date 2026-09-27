// @ts-check
// The v1 → v2 history migration (plan §3.7). PURE: no window, document, localStorage or
// indexedDB — the Storage-like object and the repo are passed in, so Node tests drive it with fakes.
//
// v0.1.45 and earlier kept every conversation in ONE localStorage key, newest first:
//   lol.chat.threads.v1 = [{id, title, messages: [{role, content, reasoning?, stats?}]}]  (≤ 100)
// That client can still be installed (a rollback), and it keeps writing that key. So the migration:
//   - never removes the key (only `removeV1Copy`, behind a settings button, ever does);
//   - never duplicates: a thread is identified by (legacyId, legacyHash = hash of its messages), and
//     an already-imported pair is skipped;
//   - never mutates what it already imported: if the SAME legacyId comes back with different
//     messages (the user rolled back and kept chatting), the new shape is imported beside it as
//     "{title} (older version)";
//   - is cheap on a normal boot: hash(raw) is compared with kv.v1RawHash first.
//
// The v1 client had no branches, no parts and no statuses — it wrote two failure modes into the
// assistant's own text (chat.js:192 and chat.js:296-299). Those strings are recognised here and
// turned into real statuses, so `draftFromPath` can leave them out of the history it sends:
//   '⏳ The server is busy…' as the WHOLE message      → status 'local'  (a note the client wrote)
//   '…\n\n[error: <message>]' ENDING the message        → status 'error'  (content = the text before)
//   '…\n\n⏳ The server is busy: <sentence>' ENDING it  → status 'error'  (content = the text before)
// Both are matched ONLY at the end (that is where chat.js appends them): a message that merely
// quotes one keeps its full text and status 'done'.

import { newId as makeId, hash as fnv } from '../core/ids.mjs';
import { EV } from '../core/events.mjs';

/** The one localStorage key the v1 client used. */
export const V1_KEY = 'lol.chat.threads.v1';

/** The title a v1 thread gets when it had none — matches strings/core.en.mjs `core.newChat`.
 *  Migrated DATA, not a UI string: it is written into the record once and can be renamed after. */
const DEFAULT_TITLE = 'New chat';
const OLDER_SUFFIX = ' (older version)';

const BUSY_WHOLE = '⏳ The server is busy';
const ERROR_TAIL = '\n\n[error: ';
const BUSY_TAIL = '\n\n⏳ The server is busy:';

/** Ids the v1 client made start with String(Date.now()); anything outside this window is not one. */
const MIN_TIME = Date.UTC(2024, 0, 1);
const DAY = 86_400_000;

/** @param {any} v1thread @param {(s: string) => string} hash */
function legacyKeyOf(v1thread, hash) {
  return {
    legacyId: String(v1thread && v1thread.id != null ? v1thread.id : ''),
    legacyHash: hash(JSON.stringify((v1thread && v1thread.messages) || [])),
  };
}

/**
 * The creation time of a v1 thread: the 13-digit Date.now() prefix of its id when that is a
 * plausible time, else a synthesised one (newest first, one minute apart).
 * @param {any} v1thread @param {number} index @param {number} nowMs
 */
function createdAtOf(v1thread, index, nowMs) {
  const m = /^(\d{13})/.exec(String((v1thread && v1thread.id) || ''));
  if (m) {
    const t = Number(m[1]);
    if (Number.isFinite(t) && t >= MIN_TIME && t <= nowMs + DAY) return t;
  }
  return nowMs - index * 60_000;
}

/**
 * Split a v1 assistant message into (content, status, error).
 * @param {string} content
 * @returns {{content: string, status: string, error: {kind: string, code: null, message: string, retryAfter: null}|null}}
 */
function classifyV1Content(content) {
  if (content.startsWith(BUSY_WHOLE)) {
    // The v1 client wrote this instead of sending: nothing ever reached the farm.
    return { content, status: 'local', error: null };
  }
  // BOTH markers are APPENDED to the END of the message by chat.js:296-299, so they are only
  // recognised there. An unanchored search would truncate a real answer that merely QUOTES an
  // "[error: ...]" line (and mark it 'error', which draftFromPath then drops from the history
  // it sends) - silent, permanent loss of the user's own text at upgrade time.
  const errAt = content.lastIndexOf(ERROR_TAIL);
  if (errAt >= 0) {
    const tail = content.slice(errAt + 2);              // drop the two newlines
    const end = tail.lastIndexOf(']');
    // The bracket must close at the very end (trailing whitespace only), or this is prose.
    if (end > 0 && !tail.slice(end + 1).trim()) {
      const message = tail.slice('[error: '.length, end);
      return { content: content.slice(0, errAt), status: 'error', error: { kind: 'stream_error', code: null, message, retryAfter: null } };
    }
  }
  const busyAt = content.lastIndexOf(BUSY_TAIL);
  // The busy sentence is a single line and always the last one; anything after a newline means
  // the model was quoting it, not the client appending it.
  if (busyAt >= 0 && !content.slice(busyAt + BUSY_TAIL.length).includes('\n')) {
    return { content: content.slice(0, busyAt), status: 'error', error: { kind: 'upstream_down', code: null, message: content.slice(busyAt + 2), retryAfter: null } };
  }
  return { content, status: 'done', error: null };
}

/**
 * PURE. Turn the v1 blob into v2 records. Throws on JSON that will not parse or that is not an
 * array — `migrateV1` turns that into status 'failed' and leaves the key alone.
 * @param {string|any[]} raw the localStorage string (or an already-parsed array, for tests)
 * @param {{now?: number|(() => number), newId?: () => string, hash?: (s: string) => string}} [inject]
 * @returns {{threads: any[], messages: any[], skipped: number}}
 */
export function transformV1(raw, inject = {}) {
  const nowMs = typeof inject.now === 'function' ? inject.now() : (typeof inject.now === 'number' ? inject.now : Date.now());
  const newId = inject.newId || (() => makeId({ now: nowMs }));
  const hash = inject.hash || fnv;

  const list = Array.isArray(raw) ? raw : JSON.parse(String(raw));
  if (!Array.isArray(list)) throw new Error('v1 store is not an array');

  /** @type {any[]} */ const threads = [];
  /** @type {any[]} */ const messages = [];
  let skipped = 0;

  list.forEach((v1, i) => {
    if (!v1 || typeof v1 !== 'object') { skipped++; return; }
    const createdAt = createdAtOf(v1, i, nowMs);
    const { legacyId, legacyHash } = legacyKeyOf(v1, hash);
    const threadId = newId();
    /** @type {any[]} */
    const own = [];
    /** @type {string|null} */
    let parentId = null;

    const v1messages = Array.isArray(v1.messages) ? v1.messages : [];
    if (!Array.isArray(v1.messages)) skipped++;
    for (const src of v1messages) {
      const role = src && src.role;
      if (!src || typeof src !== 'object' || (role !== 'user' && role !== 'assistant') || typeof src.content !== 'string') { skipped++; continue; }
      const at = createdAt + own.length * 1000;
      const cls = role === 'assistant' ? classifyV1Content(src.content) : { content: src.content, status: 'done', error: null };
      const id = newId();
      own.push({
        id, threadId, parentId, role, createdAt: at, updatedAt: at,
        parts: role === 'user' ? [{ type: 'text', text: cls.content }] : [],
        content: cls.content,
        reasoning: role === 'assistant' && typeof src.reasoning === 'string' && src.reasoning ? src.reasoning : null,
        reasoningMs: null, sawToolCalls: false,
        model: null, underlying: null, farmName: null, farmId: null, params: null, recipeId: null,
        stats: typeof src.stats === 'string' && src.stats
          ? { promptTokens: null, completionTokens: null, ttftMs: null, tokPerSec: null, finishReason: null, text: src.stats }
          : null,
        status: cls.status, error: cls.error, pinned: false,
      });
      parentId = id;
    }

    const last = own.length ? own[own.length - 1] : null;
    threads.push({
      id: threadId,
      title: typeof v1.title === 'string' && v1.title ? v1.title : DEFAULT_TITLE,
      titleSource: 'auto',
      createdAt,
      updatedAt: last ? last.updatedAt : createdAt,
      headId: last ? last.id : null,
      pinned: false, ephemeral: false, recipeId: null, systemOverride: null, params: null,
      model: null, modelSource: null, farmId: null, draft: null,
      imported: true, legacyId, legacyHash,
    });
    for (const m of own) messages.push(m);
  });

  return { threads, messages, skipped };
}

/** The v1 array, or null when the text is not one (corrupt: the caller must not assume anything). */
function parseList(/** @type {string} */ raw) {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

/** @param {{getItem(k: string): string|null}} storage */
function readRaw(storage) {
  try {
    const raw = storage && typeof storage.getItem === 'function' ? storage.getItem(V1_KEY) : null;
    return typeof raw === 'string' && raw.length ? raw : null;
  } catch {
    return null;    // a Storage that throws (private mode) is the same as an absent one
  }
}

const none = (/** @type {string} */ status) => ({ status, imported: 0, copies: 0, skipped: 0 });

/**
 * Import everything in the v1 key that is not already here. Never removes the key, never mutates an
 * already-imported thread. One transaction over threads/messages/kv.
 * @param {import('../core/types.mjs').MigrateOptions} opts
 * @returns {Promise<{status: 'done'|'already'|'none'|'failed', imported: number, copies: number, skipped: number}>}
 */
export async function migrateV1({ repo, storage, now, bus }) {
  const nowMs = typeof now === 'function' ? now() : Date.now();
  const raw = readRaw(storage);
  if (raw === null) return /** @type {any} */ (none('none'));

  const rawHash = fnv(raw);
  if ((await repo.kvGet('v1RawHash', null)) === rawHash) return /** @type {any} */ (none('already'));

  /** @type {{threads: any[], messages: any[], skipped: number}} */
  let out;
  try {
    out = transformV1(raw, { now: nowMs });
  } catch (err) {
    // Unreadable: leave the key exactly as it is and try again next boot.
    console.warn('[lolchat] v1 history could not be read; leaving it untouched', err);
    return /** @type {any} */ (none('failed'));
  }

  let imported = 0;
  let copies = 0;
  /** @type {string[]} */
  const ids = [];

  try {
    await repo.runTx(['threads', 'messages', 'kv'], 'readwrite', async (/** @type {any} */ tx) => {
      const existing = await tx.getAll('threads');
      /** @type {Set<string>} */
      const pairs = new Set();
      /** @type {Set<string>} */
      const byLegacyId = new Set();
      for (const th of existing) {
        if (th && th.legacyId) {
          byLegacyId.add(String(th.legacyId));
          if (th.legacyHash) pairs.add(`${th.legacyId}\u0000${th.legacyHash}`);
        }
      }
      for (const th of out.threads) {
        if (pairs.has(`${th.legacyId}\u0000${th.legacyHash}`)) continue;     // already here
        const copy = byLegacyId.has(th.legacyId);                            // same chat, different shape
        const record = copy ? { ...th, title: th.title + OLDER_SUFFIX } : th;
        await tx.put('threads', record);
        for (const m of out.messages) {
          if (m.threadId !== th.id) continue;
          await tx.put('messages', { ...m, parentId: m.parentId == null ? '' : m.parentId });
        }
        pairs.add(`${th.legacyId}\u0000${th.legacyHash}`);
        byLegacyId.add(th.legacyId);
        ids.push(th.id);
        if (copy) copies++; else imported++;
      }
      await tx.put('kv', { key: 'v1RawHash', value: rawHash });
    });
  } catch (err) {
    console.warn('[lolchat] v1 history import failed; leaving it untouched', err);
    return /** @type {any} */ (none('failed'));
  }

  if (bus && ids.length) bus.emit(EV.THREADS_CHANGED, { reason: 'migrate', ids });
  return { status: 'done', imported, copies, skipped: out.skipped };
}

/**
 * How much of the v1 key is already in the store. Read-only.
 * @param {{repo: any, storage: {getItem(k: string): string|null}, hash?: (s: string) => string}} opts
 * @returns {Promise<{present: boolean, total: number, migrated: number, pending: number}>}
 */
export async function v1Status({ repo, storage, hash }) {
  const raw = readRaw(storage);
  if (raw === null) return { present: false, total: 0, migrated: 0, pending: 0 };
  const h = hash || fnv;
  // Unreadable text counts as 0 of 0: `removeV1Copy` checks readability itself before deciding.
  const list = parseList(raw) || [];
  let migrated = 0;
  for (const v1 of list) {
    const { legacyId, legacyHash } = legacyKeyOf(v1, h);
    if (await repo.findLegacy(legacyId, legacyHash)) migrated++;
  }
  return { present: true, total: list.length, migrated, pending: list.length - migrated };
}

/**
 * The settings button (P2-U4): drop the old copy, but only once every v1 thread is safely here.
 * Refuses (false) when something is still pending — after one more migration attempt — and when
 * there is nothing to remove. THE ONLY place this module touches storage.removeItem.
 * @param {import('../core/types.mjs').MigrateOptions} opts
 * @returns {Promise<boolean>}
 */
export async function removeV1Copy({ repo, storage, now, bus }) {
  const raw = readRaw(storage);
  if (raw === null) return false;
  if (parseList(raw) === null) {
    // We cannot prove what is in there, so we must not throw it away.
    console.warn('[lolchat] the v1 history key is unreadable; keeping it');
    return false;
  }
  let status = await v1Status({ repo, storage });
  if (!status.present) return false;
  if (status.pending > 0) {
    await migrateV1({ repo, storage, now, bus });
    status = await v1Status({ repo, storage });
    if (status.pending > 0) return false;
  }
  try {
    storage.removeItem(V1_KEY);
  } catch (err) {
    console.warn('[lolchat] could not remove the v1 history key', err);
    return false;
  }
  return true;
}
