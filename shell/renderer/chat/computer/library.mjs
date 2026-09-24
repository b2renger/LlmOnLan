// @ts-check
// The Computer's library sidebar (COMPUTER_PLAN §3.4, §7.1, §7.6). K1-U2.
//
// This is the surface's answer to "where are my graphs". The chat has threads in a sidebar; the
// Computer has DOCUMENTS in one, and a library document is nothing more exotic than a `graphs` row
// whose `threadId` is null (§7.1). No DB version bump, no new store.
//
// What it owns:
//   the head      [＋ New] [search] [Import…]
//   the list      one card per document: title · N parts · last run, and per-card actions
//                 (Rename inline · Duplicate · Export… · Delete)
//   the width     a drag handle on the right edge, remembered in kv 'computer:sideWidth'
//   the choice    kv 'computer:lastGraphId', so a relaunch reopens the graph you left
//
// THREE DESIGN DECISIONS WORTH THE INK:
//
// 1. EXPORT AND IMPORT GO STRAIGHT THROUGH graph/serialize.mjs, not through the canvas. The plan
//    words it as "canvas.exportText/importText minus the thread guard", and that is exactly what
//    those two canvas methods are — `toText(session.doc(), {specs})` and a `fromText` — with a
//    `session.thread()` guard in front of the import that K1-U1 deletes. Calling the pure module
//    lets the library export a document that is not the OPEN one (the common case: a card's
//    Export…) and lets Import… land the file as a NEW library document rather than overwriting
//    whatever the canvas happens to be showing. The canvas keeps its own drop/import for
//    replacing the open graph; the two do not fight, because they write different documents.
//    "New ids" comes free: `fromJson` mints a fresh id for every part and wire.
//
// 2. THE DOCUMENT OPERATIONS PREFER THE HOST'S STORE AND FALL BACK TO THE REPO. §7.1 puts
//    list/create/rename/duplicate/remove on `computer/docstore.mjs`, which the host constructs.
//    When the host exposes it (`app.host.store`) the library uses it, so there is exactly one
//    debounced writer in the process. When it does not, the same operations run directly against
//    `app.repo` — they are plain `graphs` rows and the semantics are §7.1's, verbatim. This is
//    what lets the sidebar be built and tested beside the host rather than behind it.
//
// 3. BEFORE READING THE OPEN DOCUMENT OUT OF THE REPO, FLUSH. The host's writer is debounced by
//    500 ms, so exporting or duplicating the graph you are looking at, moments after moving a
//    box, would otherwise hand you the version from before the move. Every read path that can
//    touch the open document flushes first.

import { t } from '../core/i18n.mjs';
import { specMap } from '../graph/parts/index.mjs';
import { createDoc } from '../graph/model.mjs';
import { toText, fromText, FILE_SUFFIX } from '../graph/serialize.mjs';
import { readRuns, journalKey } from '../graph/journal.mjs';
import { download, pickImportFile, slugify } from '../ui/transfer.mjs';
import '../strings/computer.en.mjs';

/** kv: the document the reader left open (mirrors `ui:lastThreadId`). */
export const LAST_GRAPH_KEY = 'computer:lastGraphId';
/** kv: the sidebar's width in CSS pixels. */
export const SIDE_WIDTH_KEY = 'computer:sideWidth';
/** Where the drag handle stops, so the sidebar can never be dragged out of existence. */
/** How long the open card waits before re-reading its own numbers off the live session. */
export const META_REFRESH_MS = 400;

export const MIN_SIDE_W = 180;
export const MAX_SIDE_W = 520;
/** A graph file above this is not one of ours; refused before it becomes a string. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

/**
 * When a document last RAN, or 0 for never.
 *
 * Critic R1, B13: the run JOURNAL (`kv 'computer:runs:<id>'`, §7.3) is the answer — its newest
 * run's end (or start, while it is still live). It used to be `updatedAt` whenever any part had
 * `stats`, so the card said "last run" and meant "last edit", and a duplicate (which copied the
 * stats) said "last run just now" about a graph that had never run. A document with no journal —
 * one that last ran before K3 — still falls back to that approximation, because "never run" would
 * be a worse lie about a box full of answers.
 * @param {any} doc @param {any[]} [runs] the document's journal rows, when they have been read
 * @returns {number}
 */
export function lastRunAt(doc, runs) {
  if (Array.isArray(runs) && runs.length) {
    let best = 0;
    for (const r of runs) {
      const ts = Number(r && (r.endedAt || r.startedAt)) || 0;
      if (ts > best) best = ts;
    }
    if (best) return best;
  }
  const parts = doc && Array.isArray(doc.parts) ? doc.parts : [];
  const ran = parts.some((p) => p && p.stats
    && (Number(p.stats.calls) > 0 || Number(p.stats.ms) > 0 || Number(p.stats.tokens) > 0));
  return ran ? (Number(doc.updatedAt) || 0) : 0;
}

/**
 * The one line under a card's title. Exported because it is the whole of the card's honesty: a
 * document that has never run must not imply that it has.
 * @param {any} doc @param {number} nowMs @param {any[]} [runs] its journal rows (B13)
 * @returns {string}
 */
export function cardMeta(doc, nowMs, runs) {
  const n = doc && Array.isArray(doc.parts) ? doc.parts.length : 0;
  const parts = n === 1 ? t('computer.libPartsOne') : t('computer.libParts', { n });
  const ran = lastRunAt(doc, runs);
  return `${parts} · ${ran ? t('computer.libLastRun', { when: whenText(ran, nowMs) }) : t('computer.libNeverRun')}`;
}

/**
 * A short, local "when". The platform's own formatting rather than a strings key, for the same
 * reason ui/sidebar.mjs's month headings are: the words are the locale's, not ours.
 * @param {number} ts @param {number} nowMs @returns {string}
 */
export function whenText(ts, nowMs) {
  const d = new Date(ts);
  const sameDay = new Date(nowMs).toDateString() === d.toDateString();
  try {
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return String(ts);
  }
}

/** Does this document match what was typed in the search box? @param {any} doc @param {string} q */
export function matches(doc, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  const title = String((doc && doc.title) || '').toLowerCase();
  if (title.includes(needle)) return true;
  // The untitled ones are findable by the word the card shows for them, or nothing would match.
  return !title && t('computer.libUntitled').toLowerCase().includes(needle);
}

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * @param {any} app
 * @param {any} els the frozen skeleton from computer/layout.mjs
 * @returns {any}
 */
export function createLibrary(app, els) {
  const specs = specMap();
  const now = () => (typeof app.now === 'function' ? app.now() : Date.now());

  /** @type {any[]} */ let rows = [];
  /** @type {string|null} */ let openId = null;
  /** @type {string|null} */ let renamingId = null;
  let query = '';
  let destroyed = false;
  /** @type {Function|null} */ let offSession = null;   // the open card's meta subscription
  let built = false;
  /** Each document's run journal, as last read (B13): what "last run" on its card is made of. */
  /** @type {Map<string, any[]>} */ const runsById = new Map();

  /** Read the journals of these rows. Never throws: no journal is an empty one. @param {any[]} list */
  async function readJournals(list) {
    await Promise.all((list || []).map(async (r) => {
      if (!r || !r.id) return;
      try { runsById.set(r.id, await readRuns(app.repo, r.id)); } catch { runsById.set(r.id, []); }
    }));
  }

  // ---- the document operations (§7.1: the host's store when there is one, the repo when not) ---

  /** The host's debounced writer, when the host has published one. @returns {any} */
  const store = () => {
    const s = app.host && app.host.store;
    return s && !s.stub ? s : null;
  };

  /** Everything the open document may still owe the database. */
  async function flushOpen() {
    const host = app.host;
    if (!host) return;
    try {
      const s = store();
      if (s && typeof s.flush === 'function') await s.flush();
      else if (host.debug && typeof host.debug.save === 'function') await host.debug.save();
    } catch (err) {
      console.warn('[lolcomputer] flushing the open graph before reading it failed', err);
    }
  }

  const docs = {
    /** @returns {Promise<any[]>} */
    async list() {
      const s = store();
      if (s && typeof s.list === 'function') return (await s.list()) || [];
      const all = (await app.repo.listGraphs()) || [];
      return all
        .filter((/** @type {any} */ r) => r && (r.threadId === null || r.threadId === undefined))
        .sort((/** @type {any} */ a, /** @type {any} */ b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    },
    /** @param {string} id @returns {Promise<any>} */
    get(id) { return app.repo.getGraph(id); },
    /** @param {{title?: string}} [o] @returns {Promise<string|null>} */
    async create(o = {}) {
      const title = String(o.title || '');
      const s = store();
      if (s && typeof s.create === 'function') {
        const made = await s.create({ title });
        return made && made.id ? made.id : null;
      }
      const doc = createDoc({ id: app.newId(), threadId: null, title, now });
      await app.repo.putGraph({ ...doc, folder: null });
      return doc.id;
    },
    /**
     * Retitle. The OPEN document goes through `host.rename`, which renames it through the session:
     * a row rewritten behind the session's back is overwritten by the next debounced save.
     * @param {string} id @param {string} title
     */
    async rename(id, title) {
      const host = app.host;
      if (host && typeof host.rename === 'function') { await host.rename(id, title); return; }
      const s = store();
      if (s && typeof s.rename === 'function') { await s.rename(id, title); return; }
      const row = await app.repo.getGraph(id);
      if (!row) return;
      await app.repo.putGraph({ ...row, title, updatedAt: now() });
    },
    /** @param {string} id @returns {Promise<string|null>} */
    async duplicate(id) {
      if (id === openId) await flushOpen();
      const from = await app.repo.getGraph(id);
      if (!from) return null;
      const title = t('computer.libDuplicateTitle', { title: from.title || t('computer.libUntitled') });
      const s = store();
      if (s && typeof s.duplicate === 'function') return (await s.duplicate(id, { title })) || null;
      const copy = {
        ...from,
        // B13: a copy has never run — its parts keep their answers, not their run stats.
        parts: (Array.isArray(from.parts) ? from.parts : []).map((/** @type {any} */ p) => ({ ...p, stats: null })),
        id: app.newId(),
        threadId: null,
        folder: null,
        title,
        createdAt: now(),
        updatedAt: now(),
      };
      await app.repo.putGraph(copy);
      return copy.id;
    },
    /** @param {string} id */
    async remove(id) {
      const s = store();
      if (s && typeof s.remove === 'function') await s.remove(id);
      else {
        await app.repo.deleteGraph(id);
        // B4: the run journal goes with the graph (the store does this itself when there is one).
        try { await app.repo.kvSet(journalKey(id), null); } catch { /* the store speaks for itself */ }
      }
      runsById.delete(id);
      // K6 kickoff (addendum KF-5): a deleted graph may have held the last reference to a PDF or a
      // sound kept on this computer. The file store drops what nothing refers to any more; a
      // failure there never undoes the delete. Critic R1, B17: `spareFresh`, like every automatic
      // sweep — a drop still landing in ANOTHER graph has just stored its file and has not yet
      // written the box that refers to it.
      const media = app && app.media;
      if (media && typeof media.sweep === 'function') {
        try { await media.sweep({ spareFresh: true }); } catch (err) { console.warn('[lolcomputer] sweeping unused files failed', err); }
      }
    },
  };

  // ---- export / import (§7.6, through graph/serialize.mjs) -------------------------------------

  /**
   * One document as `.lolgraph.json` text. `values:false` strips every cached value — including a
   * Dialog's typed answer, a person's own words, which is the case the checkbox exists for.
   * @param {string} id @param {{values?: boolean}} [o] @returns {Promise<string|null>}
   */
  async function exportText(id, o = {}) {
    if (id === openId) await flushOpen();
    const doc = await docs.get(id);
    if (!doc) return null;
    return toText(doc, { values: o.values !== false, title: doc.title || '', specs });
  }

  /**
   * Write one document out as a file. Never throws: ui/transfer.mjs's ladder (object URL → data
   * URL → "copy it instead") already has a last resort.
   * @param {string} id @param {{values?: boolean}} [o]
   */
  async function exportFile(id, o = {}) {
    const text = await exportText(id, o);
    if (text === null) return { ok: false, name: '', bytes: 0 };
    const doc = await docs.get(id);
    const name = `${slugify((doc && doc.title) || 'graph')}${FILE_SUFFIX}`;
    /** @type {any} */ let out = null;
    try {
      out = await download(name, text, 'application/json', { app });
    } catch (err) {
      console.warn('[lolcomputer] exporting the graph failed', err);
    }
    return { ok: !!(out && out.ok), name, bytes: text.length };
  }

  /**
   * Adopt a `.lolgraph.json` as a NEW library document and open it. A file from a newer version is
   * REFUSED, not imported with a warning (§7.6): a v3 file carrying a part type this build has
   * never heard of would come in as a subtly broken graph, which is the quiet field-loss the plan
   * bans one level up.
   * @param {string} text @param {{name?: string}} [o]
   * @returns {Promise<{ok: boolean, id: string|null, parts: number, wires: number,
   *   errors: string[], message: string}>}
   */
  async function importText(text, o = {}) {
    const nothing = { ok: false, id: null, parts: 0, wires: 0, errors: /** @type {string[]} */ ([]), message: '' };
    const id = app.newId();
    const out = fromText(String(text || ''), {
      specs, newId: app.newId, now, id, threadId: null, values: true,
    });
    if (!out.ok || !out.doc) {
      const newer = (out.errors || []).indexOf('unsupported-version') >= 0;
      const message = newer ? t('computer.libImportNewer') : t('computer.libImportFailed');
      say(message, 'error');
      return { ...nothing, errors: out.errors, message };
    }
    const title = out.doc.title || (o.name ? String(o.name).replace(/\.lolgraph\.json$/i, '') : '');
    await app.repo.putGraph({ ...out.doc, threadId: null, folder: null, title });
    await open(id);
    return {
      ok: true,
      id,
      parts: out.doc.parts.length,
      wires: out.doc.wires.length,
      errors: out.errors,
      message: '',
    };
  }

  /** The file picker half of Import…. A dismissed picker resolves null and says nothing. */
  async function pickAndImport() {
    const picked = await pickImportFile({ maxBytes: MAX_IMPORT_BYTES });
    if (!picked || destroyed) return null;
    if (picked.tooBig) {
      say(t('computer.libImportFailed'), 'error');
      return null;
    }
    return importText(picked.text, { name: picked.name });
  }

  /** @param {string} message @param {string} [kind] */
  function say(message, kind) {
    if (app.dialogs && typeof app.dialogs.toast === 'function') app.dialogs.toast(message, { kind: kind || 'info' });
    if (live) live.textContent = message;
  }

  // ---- the head --------------------------------------------------------------------------------

  /** @type {HTMLElement|null} */ let live = null;
  /** @type {HTMLInputElement|null} */ let searchInput = null;

  function buildHead() {
    if (built) return;
    built = true;
    els.sideHead.replaceChildren();

    const row = h('div', 'comp-side-row');
    const newBtn = h('button', 'comp-btn comp-btn-accent', t('computer.libNew'));
    /** @type {any} */ (newBtn).type = 'button';
    newBtn.setAttribute('data-act', 'new');
    newBtn.addEventListener('click', () => { void newDocument(); });

    const importBtn = h('button', 'comp-btn', t('computer.libImport'));
    /** @type {any} */ (importBtn).type = 'button';
    importBtn.setAttribute('data-act', 'import');
    importBtn.addEventListener('click', () => { void pickAndImport(); });

    row.append(newBtn, importBtn);

    const search = /** @type {HTMLInputElement} */ (h('input', 'comp-search'));
    search.type = 'search';
    search.placeholder = t('computer.libSearch');
    search.setAttribute('aria-label', t('computer.libSearch'));
    search.addEventListener('input', () => { query = search.value; paint(); });
    searchInput = search;

    live = h('div', 'comp-live');
    live.setAttribute('aria-live', 'polite');

    const label = h('div', 'comp-side-title', t('computer.libTitle'));
    els.sideHead.append(label, row, search, live);

    buildResizer();
  }

  // ---- the resizable edge ----------------------------------------------------------------------

  function buildResizer() {
    const grip = h('div', 'comp-side-grip');
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'vertical');
    els.side.appendChild(grip);
    let dragging = false;
    grip.addEventListener('pointerdown', (/** @type {any} */ ev) => {
      dragging = true;
      grip.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    grip.addEventListener('pointermove', (/** @type {any} */ ev) => {
      if (!dragging) return;
      const left = els.root.getBoundingClientRect().left;
      setWidth(ev.clientX - left);
    });
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      void app.repo.kvSet(SIDE_WIDTH_KEY, width());
    };
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
  }

  /** @returns {number} */
  function width() {
    const v = Number(String(els.root.style.getPropertyValue('--comp-side-w') || '').replace('px', ''));
    return Number.isFinite(v) && v > 0 ? v : MIN_SIDE_W;
  }

  /** @param {number} px */
  function setWidth(px) {
    const next = Math.max(MIN_SIDE_W, Math.min(MAX_SIDE_W, Math.round(Number(px) || 0)));
    els.root.style.setProperty('--comp-side-w', `${next}px`);
    return next;
  }

  // ---- the list --------------------------------------------------------------------------------

  /** Re-read the rows and repaint. */
  async function render() {
    if (destroyed) return;
    const list = await docs.list();
    await readJournals(list);
    if (destroyed) return;
    rows = list;
    paint();
  }

  /** Repaint from the rows already in hand (what search does). */
  function paint() {
    if (destroyed) return;
    const shown = rows.filter((r) => matches(r, query));
    els.list.replaceChildren();
    if (!shown.length) {
      const empty = h('p', 'comp-empty',
        query.trim() ? t('computer.libNoMatch', { q: query.trim() }) : t('computer.libEmpty'));
      els.list.appendChild(empty);
      return;
    }
    const nowMs = now();
    for (const row of shown) els.list.appendChild(card(row, nowMs));
    syncOpenMeta();
  }

  /**
   * The OPEN document's card, told the truth (K1 landing). `rows` is what the STORE last handed
   * over, and the store is written on a debounce, so the card for the document you are editing
   * read "0 parts · never run" while three parts sat on the canvas beside it. The open card takes
   * its numbers from the live session instead; every other card is a stored row, which is right,
   * because that is all anyone knows about a document that is not open.
   */
  function syncOpenMeta() {
    if (destroyed || !openId) return;
    const host = app.host;
    const live = host && host.session && typeof host.session.doc === 'function' ? host.session.doc() : null;
    if (!live || live.id !== openId) return;
    const el = els.list.querySelector(`.comp-card[data-id="${openId}"] .comp-card-meta`);
    if (!el) return;
    const next = cardMeta(live, now(), runsById.get(openId));
    if (el.textContent !== next) el.textContent = next;
    // Critic R1, B1 (d): the TITLE is the live one too. A rename of the open graph is written
    // through the session, and the card kept the old words until the next full repaint.
    if (renamingId !== openId) {
      const titleEl = els.list.querySelector(`.comp-card[data-id="${openId}"] .comp-card-title`);
      const title = live.title || t('computer.libUntitled');
      if (titleEl && titleEl.textContent !== title) titleEl.textContent = title;
    }
  }

  /** @param {any} row @param {number} nowMs @returns {HTMLElement} */
  function card(row, nowMs) {
    const el = h('div', 'comp-card');
    el.setAttribute('role', 'listitem');
    el.setAttribute('data-id', row.id);
    if (row.id === openId) el.setAttribute('data-open', 'true');

    const openBtn = h('button', 'comp-card-open');
    /** @type {any} */ (openBtn).type = 'button';
    openBtn.setAttribute('data-act', 'open');
    const title = h('span', 'comp-card-title', row.title || t('computer.libUntitled'));
    const meta = h('span', 'comp-card-meta', cardMeta(row, nowMs, runsById.get(row.id)));
    openBtn.append(title, meta);
    openBtn.addEventListener('click', () => { void openDocument(row.id); });
    openBtn.addEventListener('dblclick', () => startRename(row.id));
    el.appendChild(openBtn);

    const acts = h('div', 'comp-card-acts');
    acts.append(
      action('rename', t('computer.libRename'), () => startRename(row.id)),
      action('duplicate', t('computer.libDuplicate'), () => { void duplicateDocument(row.id); }),
      action('export', t('computer.libExport'), (btn) => askExport(row.id, btn)),
      action('delete', t('computer.libDelete'), () => { void deleteDocument(row.id); }),
    );
    el.appendChild(acts);

    if (renamingId === row.id) el.appendChild(renameBox(row));
    return el;
  }

  /** @param {string} act @param {string} label @param {(btn: HTMLElement) => void} fn */
  function action(act, label, fn) {
    const b = h('button', 'comp-card-act', label);
    /** @type {any} */ (b).type = 'button';
    b.setAttribute('data-act', act);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(b); });
    return b;
  }

  /** The inline rename box: Enter commits, Escape cancels, blur commits. @param {any} row */
  function renameBox(row) {
    const wrap = h('div', 'comp-rename');
    const input = /** @type {HTMLInputElement} */ (h('input', 'comp-rename-input'));
    input.type = 'text';
    input.value = row.title || '';
    input.placeholder = t('computer.libUntitled');
    input.setAttribute('aria-label', t('computer.libRename'));
    let settled = false;
    const commit = (/** @type {boolean} */ keep) => {
      if (settled) return;
      settled = true;
      renamingId = null;
      if (keep) void renameDocument(row.id, input.value);
      else void render();
    };
    input.addEventListener('keydown', (/** @type {any} */ ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
    wrap.appendChild(input);
    setTimeout(() => { try { input.focus(); input.select(); } catch { /* gone */ } }, 0);
    return wrap;
  }

  // ---- the actions -----------------------------------------------------------------------------

  /** @param {string} id */
  function startRename(id) {
    renamingId = id;
    paint();
  }

  /** @param {{title?: string}} [o] @returns {Promise<string|null>} */
  async function newDocument(o = {}) {
    const id = await docs.create({ title: String(o.title || '') });
    if (!id) return null;
    await openDocument(id);
    return id;
  }

  /** @param {string} id @param {string} title */
  async function renameDocument(id, title) {
    await docs.rename(id, String(title || '').trim());
    await render();
  }

  /** @param {string} id @returns {Promise<string|null>} */
  async function duplicateDocument(id) {
    const made = await docs.duplicate(id);
    await render();
    return made;
  }

  /**
   * Delete, with the confirm the plan asks for. `confirm:false` is the door the debug port and a
   * later undo path use; the BUTTON always asks.
   * @param {string} id @param {{confirm?: boolean}} [o]
   */
  async function deleteDocument(id, o = {}) {
    const row = rows.find((r) => r.id === id) || (await docs.get(id));
    const title = (row && row.title) || t('computer.libUntitled');
    if (o.confirm !== false) {
      const dialogs = app.dialogs;
      const go = dialogs && typeof dialogs.confirm === 'function'
        ? await dialogs.confirm({
          title: t('computer.libDelete'),
          body: t('computer.libDeleteAsk', { title }),
          ok: t('computer.libDeleteConfirm'),
          danger: true,
        })
        : true;
      if (!go) return false;
    }
    const host = app.host;
    const liveId = host && host.session && typeof host.session.docId === 'function' ? host.session.docId() : null;
    if (openId === id || liveId === id) {
      // Critic R1, B4: SWITCH AWAY FIRST, then delete. Removing the row first left the live run
      // owning the document: its next mark() saved the row straight back, and the flush at the
      // top of the next open rewrote it. Opening the next graph stops that run and flushes; the
      // run's last journal write is waited for; only then does the row (and its journal) go.
      const left = (await docs.list()).filter((r) => r.id !== id);
      const next = left[0] ? left[0].id : await docs.create({ title: '' });
      if (next) await openDocument(next);
      else openId = null;
      if (host && typeof host.settle === 'function') {
        try { await host.settle(); } catch (err) { console.warn('[lolcomputer] waiting for the run to end failed', err); }
      }
    }
    await docs.remove(id);
    await render();
    return true;
  }

  /** The Export… popover: one checkbox, "Include results", default on (§7.6).
   * @param {string} id @param {HTMLElement} anchor */
  function askExport(id, anchor) {
    const dialogs = app.dialogs;
    if (!dialogs || typeof dialogs.popover !== 'function') { void exportFile(id, { values: true }); return; }
    dialogs.popover(anchor, (/** @type {HTMLElement} */ el, /** @type {() => void} */ close) => {
      const label = h('label', 'comp-export-opt');
      const box = /** @type {HTMLInputElement} */ (h('input'));
      box.type = 'checkbox';
      box.checked = true;
      box.setAttribute('data-act', 'export-values');
      label.append(box, h('span', undefined, t('computer.libExportValues')));
      const go = h('button', 'comp-btn comp-btn-accent', t('computer.libExport'));
      /** @type {any} */ (go).type = 'button';
      go.setAttribute('data-act', 'export-go');
      go.addEventListener('click', () => {
        const values = box.checked;
        close();
        void exportFile(id, { values });
      });
      el.append(label, go);
    });
  }

  /** @param {string} id */
  async function openDocument(id) {
    return open(id);
  }

  /** @param {string|null} id */
  async function open(id) {
    if (!id) return null;
    const host = app.host;
    const live = () => (host && host.session && typeof host.session.docId === 'function' ? host.session.docId() : null);
    // Critic R1, B3: the card of the graph that is ALREADY open. Opening it again is not a switch
    // (the host would stop the run and reject a waiting Dialog to "switch" to itself).
    const already = !!id && id === live() && !(host && host.session && typeof host.session.opening === 'function' && host.session.opening());
    openId = id;
    renamingId = null;
    try { await app.repo.kvSet(LAST_GRAPH_KEY, id); } catch (err) { console.warn('[lolcomputer] remembering the open graph failed', err); }
    if (!already && host && typeof host.open === 'function') {
      try { await host.open(id); } catch (err) { console.warn('[lolcomputer] opening the graph failed', err); }
      // Critic R1, B11: the highlight follows what the canvas really SHOWS once the open settles
      // — a later click may have won the race — not what this click asked for.
      const shown = live();
      if (shown) openId = shown;
    }
    await render();
    return id;
  }

  // ---- start -----------------------------------------------------------------------------------

  /**
   * First paint. computer/main.mjs calls this AFTER the migration has resolved, so a first launch
   * after the upgrade lands on a document the reader recognises rather than on an empty list.
   */
  async function start() {
    buildHead();
    try {
      const saved = Number(await app.repo.kvGet(SIDE_WIDTH_KEY, 0));
      if (saved > 0) setWidth(saved);
    } catch (err) {
      console.warn('[lolcomputer] reading the sidebar width failed', err);
    }

    // THE HOST LANDS ON A DOCUMENT BY ITSELF and it uses the SAME kv marker (`host.ready` →
    // `session.open(null)` → last id, then newest row, then a new one). The library ADOPTS that
    // choice instead of racing it: two independent "the library is empty, make one" paths running
    // concurrently made two empty documents on every first launch, which is exactly the surprise
    // row a person would have to clean up by hand.
    const host = app.host;
    if (host && host.ready && typeof host.ready.then === 'function') {
      try { await host.ready; } catch (err) { console.warn('[lolcomputer] the host never landed on a document', err); }
    }
    // …and it keeps telling the truth while the reader works: every session event nudges the open
    // card's numbers, on a debounce, without rebuilding the list (a rebuild mid-rename would take
    // the input the reader is typing in out from under them).
    if (host && host.session && typeof host.session.on === 'function') {
      /** @type {any} */ let metaTimer = 0;
      offSession = host.session.on(() => {
        if (metaTimer) return;
        metaTimer = setTimeout(async () => {
          metaTimer = 0;
          // B13: a run that just ended wrote the journal; re-read the open one's before painting.
          if (openId) {
            try { runsById.set(openId, await readRuns(app.repo, openId)); } catch { /* keep the last read */ }
          }
          syncOpenMeta();
        }, META_REFRESH_MS);
      });
    }

    rows = await docs.list();
    await readJournals(rows);

    let id = host && host.session && typeof host.session.docId === 'function' ? host.session.docId() : null;
    if (!id) {
      /** @type {any} */ let want = null;
      try { want = await app.repo.kvGet(LAST_GRAPH_KEY, null); } catch { want = null; }
      if (typeof want === 'string' && rows.some((r) => r.id === want)) id = want;
    }
    if (!id) id = rows[0] ? rows[0].id : null;
    if (!id) id = await docs.create({ title: '' });
    await open(id);
  }

  return {
    start,
    render,
    open,
    create: newDocument,
    rename: renameDocument,
    duplicate: duplicateDocument,
    remove: deleteDocument,
    exportText,
    exportFile,
    importText,
    openId: () => openId,
    destroy() {
      destroyed = true;
      if (offSession) { try { offSession(); } catch { /* already gone */ } offSession = null; }
    },

    // The harness drives the library through exactly these — the same functions the buttons call,
    // so a scenario and a click walk one path.
    debug: {
      list: () => rows.map((r) => ({
        id: r.id, title: r.title || '', parts: (r.parts || []).length, updatedAt: r.updatedAt || 0, lastRun: lastRunAt(r, runsById.get(r.id)),
      })),
      cards: () => Array.from(els.list.querySelectorAll('.comp-card')).map((el) => ({
        id: el.getAttribute('data-id'),
        title: (el.querySelector('.comp-card-title') || { textContent: '' }).textContent,
        meta: (el.querySelector('.comp-card-meta') || { textContent: '' }).textContent,
        open: el.getAttribute('data-open') === 'true',
      })),
      empty: () => {
        const p = els.list.querySelector('.comp-empty');
        return p ? p.textContent : null;
      },
      openId: () => openId,
      render,
      create: (/** @type {string} */ title) => newDocument({ title }),
      open,
      rename: renameDocument,
      startRename,
      renaming: () => renamingId,
      duplicate: duplicateDocument,
      remove: (/** @type {string} */ id) => deleteDocument(id, { confirm: false }),
      search: (/** @type {string} */ q) => { query = String(q || ''); if (searchInput) searchInput.value = query; paint(); return query; },
      exportText,
      importText,
      width,
      setWidth: (/** @type {number} */ px) => { const w = setWidth(px); void app.repo.kvSet(SIDE_WIDTH_KEY, w); return w; },
      said: () => (live ? live.textContent : ''),
    },
  };
}
