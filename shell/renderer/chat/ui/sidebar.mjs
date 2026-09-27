// @ts-check
// The library: the thread list, its groups, the search box, the row menu and inline rename
// (plan §3.4 / §3.5, §4 P1-U4 then §4 P2-U4, which took this file over).
//
//   createSidebar(app, el) → {render({rescan}), highlight(threadId)}
//
// P1 scope, all of it still true:
//   - the active row is highlighted (class `active` + aria-current), a row click hands the id to
//     controller.selectThread, and the hover × asks dialogs.confirm before repo.deleteThread;
//   - rows are KEYED by thread id: a re-render updates and reorders the existing nodes, so hover,
//     focus and the scroll position survive every THREADS_CHANGED;
//   - skeleton rows stand in while the repo is `pending`;
//   - the SLOTS.NEW_MENU ⌄ button sits beside #chat-new (els.sideHead) when the slot has items —
//     the sidebar NEVER binds #chat-new itself (§2.6 P: that button is the composer's);
//   - a thread holding a reply that was cut off carries a small dot.
//
// P2 adds:
//   - GROUPS: Pinned, Today, Yesterday, Previous 7 days, Previous 30 days, then month names. The
//     headings are derived from the order repo.listThreads already returns (pinned first, then
//     updatedAt desc), so a heading is emitted exactly when the group key changes — the list can
//     never disagree with its own headings.
//   - SEARCH in els.sideTools: 150 ms debounce, diacritic-folded, titles AND message bodies (one
//     repo.scanMessages pass), each result carrying a snippet; a click selects the thread and
//     flashes the matching message.
//   - the SLOTS.THREAD_MENU … button per row (Rename, Pin/Unpin, the two exports, Delete), with the
//     item list read at OPEN time (§2.6 AD) so later features appear without touching this file;
//   - inline rename, on the menu item or a double-click;
//   - the NEW_MENU "New ephemeral chat" item, and the eye-off marker on ephemeral rows.
//
// WHAT MUST STAY CHEAP (D-M10.2): a search keystroke, a rename and a pin all end in render(), and
// render() must not cursor the message store for interrupted dots. Only render({rescan:true}) does
// — main.mjs asks for it once after recoverInterrupted(). Search does its own single scan, per
// query, debounced.

import { EV } from '../core/events.mjs';
import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { icon } from './layout.mjs';
import { exportThreadFile } from './transfer.mjs';
import '../strings/sidebar.en.mjs';
import '../strings/library.en.mjs';

const SKELETON_ROWS = 5;
const SEARCH_DEBOUNCE_MS = 150;
const MAX_RESULTS = 60;
/** How many matching messages the search may keep for narrowing the NEXT keystroke. */
const SCAN_CACHE_ROWS = 4000;
const SNIPPET_RADIUS = 42;
const DAY = 86_400_000;

/** Lucide `eye-off`, for the rows that are never written down. */
const EYE_OFF = [
  'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68',
  'M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61',
  'M2 2l20 20',
];
/** Lucide `more-horizontal`. */
const MORE = ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'];

// ---------------------------------------------------------------------------------------------
// pure helpers (exported for shell/test/chat/unit/search.test.mjs)
// ---------------------------------------------------------------------------------------------

/**
 * The comparison form used by search: decomposed, stripped of diacritics, lower-cased. So
 * `fold('Éléphant') === fold('elephant')` and a French chat is findable from an ASCII keyboard.
 * @param {any} s
 */
export function fold(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * fold(), plus the index of every folded character in the ORIGINAL string. Folding is not
 * length-preserving (NFD turns one É into two code units, one of which then disappears), so a match
 * position in the folded text means nothing until it is mapped back — that is what makes a snippet
 * land on the right characters instead of a few letters to the left.
 * @param {any} s
 * @returns {{folded: string, map: number[]}}
 */
export function foldIndex(s) {
  const raw = String(s == null ? '' : s);
  let folded = '';
  /** @type {number[]} */
  const map = [];
  for (let i = 0; i < raw.length; i += 1) {
    const f = fold(raw[i]);
    for (let k = 0; k < f.length; k += 1) { folded += f[k]; map.push(i); }
  }
  return { folded, map };
}

/**
 * A one-line excerpt of `text` around the first occurrence of the ALREADY FOLDED `needle`, or null.
 * @param {string} text @param {string} needle @param {{radius?: number}} [opts]
 * @returns {string|null}
 */
export function makeSnippet(text, needle, opts = {}) {
  if (!needle) return null;
  const radius = Number(opts.radius) > 0 ? Number(opts.radius) : SNIPPET_RADIUS;
  const { folded, map } = foldIndex(text);
  const at = folded.indexOf(needle);
  if (at < 0) return null;
  const raw = String(text == null ? '' : text);
  const start = map[at] === undefined ? 0 : map[at];
  const endIdx = at + needle.length - 1;
  const end = (map[endIdx] === undefined ? raw.length - 1 : map[endIdx]) + 1;
  const from = Math.max(0, start - radius);
  const to = Math.min(raw.length, end + radius);
  const body = raw.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${body}${to < raw.length ? '…' : ''}`;
}

/** Local midnight of the day `ts` falls in. @param {number} ts */
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The group a thread belongs to. `pinned` wins over everything; the rest are day buckets measured
 * from LOCAL midnight, so "Today" means today to the person reading it and not "within 24 hours".
 * @param {any} thread @param {number} nowMs
 * @returns {string} 'pinned' | 'today' | 'yesterday' | 'week' | 'month' | `m:YYYY-MM`
 */
export function groupKeyFor(thread, nowMs) {
  if (thread && thread.pinned) return 'pinned';
  const ts = Number(thread && thread.updatedAt) || 0;
  const midnight = startOfDay(nowMs);
  if (ts >= midnight) return 'today';
  if (ts >= midnight - DAY) return 'yesterday';
  if (ts >= midnight - 7 * DAY) return 'week';
  if (ts >= midnight - 30 * DAY) return 'month';
  const d = new Date(ts);
  return `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const FIXED_GROUP = {
  pinned: 'sidebar.pinned',
  today: 'library.groupToday',
  yesterday: 'library.groupYesterday',
  week: 'library.groupWeek',
  month: 'library.groupMonth',
};

/**
 * The heading text for a group key. Month buckets use the platform's own month names (and add the
 * year only when it is not the current one), which is why they are not in the strings file.
 * @param {string} key @param {number} nowMs
 */
export function groupLabel(key, nowMs) {
  if (FIXED_GROUP[key]) return t(FIXED_GROUP[key]);
  const m = /^m:(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const year = Number(m[1]);
  const d = new Date(year, Number(m[2]) - 1, 1);
  const sameYear = new Date(nowMs).getFullYear() === year;
  try {
    return d.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
  } catch {
    return key;
  }
}

/**
 * Everything of a message that search should look at. A user turn stores the same sentence TWICE —
 * once as `content`, once as its text part (controller.send writes both) — so a part whose text is
 * already in the content is left out: the snippet would otherwise read "hello hello".
 * @param {any} m
 */
export function messageHaystack(m) {
  if (!m) return '';
  const content = typeof m.content === 'string' ? m.content : '';
  const parts = Array.isArray(m.parts) ? m.parts : [];
  const extra = parts
    .filter((p) => p && p.type === 'text' && typeof p.text === 'string' && p.text && !content.includes(p.text))
    .map((p) => p.text);
  return [content, ...extra].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------------------------

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/**
 * @param {any} app
 * @param {HTMLElement} el   els.list (#chat-threads)
 */
export function createSidebar(app, el) {
  /** @type {Map<string, {row: HTMLElement, btn: HTMLElement, title: HTMLElement, dot: HTMLElement, eye: HTMLElement}>} */
  const rows = new Map();
  /** @type {Map<string, HTMLElement>} */
  const labels = new Map();
  /** @type {any[]} */
  let current = [];                       // the last painted order, for "select the next one"
  /** @type {Set<string>} */
  let interrupted = new Set();
  let scanning = false;                   // an interrupted scan is in flight
  let rescan = false;                     // a render arrived during it: scan once more after
  /** @type {string|null} */
  let scannedMode = null;                 // the repo.mode the last whole-store scan ran in
  let seq = 0;                            // render generation: a late listThreads never repaints
  let skeletonShown = false;
  /** @type {string|null} */
  let listLabel = null;                   // the list's own aria-label, borrowed while skeletons show
  /** @type {HTMLButtonElement|null} */
  let menuBtn = null;
  /** @type {{close: () => void}|null} */
  let openMenu = null;
  /** @type {HTMLInputElement|null} */
  let searchInput = null;
  /** @type {any} */
  let searchTimer = null;
  let searchSeq = 0;
  /** The previous query's matching messages, for narrowing (see runSearch). */
  /** @type {{needle: string, rows: {id: string, threadId: string, hay: string, folded: string}[], complete: boolean}|null} */
  let scanCache = null;
  /** Drop the narrowing cache: the store moved under it. */
  const dropScanCache = () => { scanCache = null; };
  let query = '';
  /** @type {{thread: any, msgId: string|null, snippet: string|null}[]|null} */
  let results = null;                     // null = not searching
  /** @type {string|null} */
  let renaming = null;

  const now = () => (typeof app.now === 'function' ? app.now() : Date.now());

  // ---- rows --------------------------------------------------------------------------------

  /** @param {any} th */
  function makeRow(th) {
    const row = h('div', 'chat-thread-row');
    row.setAttribute('role', 'listitem');
    row.setAttribute('data-id', th.id);

    const btn = h('button', 'chat-thread');
    /** @type {any} */ (btn).type = 'button';
    btn.setAttribute('data-id', th.id);

    const dot = h('span', 'chat-thread-dot hidden');
    dot.setAttribute('aria-hidden', 'true');
    const eye = h('span', 'chat-thread-eye hidden');
    eye.appendChild(icon(EYE_OFF, { size: 13 }));
    const title = h('span', 'chat-thread-title');
    btn.append(dot, eye, title);
    btn.addEventListener('click', () => {
      if (app.controller) app.controller.selectThread(th.id);
    });
    btn.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const id = row.getAttribute('data-id');
      if (id) startRename(id);
    });

    const more = h('button', 'chat-thread-more');
    /** @type {any} */ (more).type = 'button';
    more.setAttribute('aria-label', t('library.menu'));
    more.title = t('library.menu');
    more.setAttribute('aria-haspopup', 'menu');
    more.appendChild(icon(MORE, { size: 15 }));
    more.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = row.getAttribute('data-id');
      if (id) openThreadMenu(more, id);
    });

    const x = h('button', 'chat-thread-x', '×');
    /** @type {any} */ (x).type = 'button';
    x.setAttribute('aria-label', t('sidebar.delete'));
    x.title = t('sidebar.delete');
    x.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = row.getAttribute('data-id');
      if (id) askDelete(id);
    });

    row.append(btn, more, x);
    return { row, btn, title, dot, eye };
  }

  /** @param {any} th */
  function paintRow(th) {
    let entry = rows.get(th.id);
    if (!entry) { entry = makeRow(th); rows.set(th.id, entry); }
    const name = th.title || t('sidebar.untitled');
    if (entry.title.textContent !== name) entry.title.textContent = name;
    entry.btn.title = name;
    const active = app.state.threadId === th.id;
    entry.btn.classList.toggle('active', active);
    if (active) entry.btn.setAttribute('aria-current', 'true');
    else entry.btn.removeAttribute('aria-current');
    entry.row.classList.toggle('pinned', !!th.pinned);
    entry.row.classList.toggle('ephemeral', !!th.ephemeral);
    entry.eye.classList.toggle('hidden', !th.ephemeral);
    if (th.ephemeral) entry.eye.title = t('library.ephemeral');
    const cut = interrupted.has(th.id);
    entry.dot.classList.toggle('hidden', !cut);
    if (cut) entry.dot.title = t('sidebar.interrupted');
    return entry.row;
  }

  /** @param {string} key */
  function labelFor(key) {
    const text = groupLabel(key, now());
    let node = labels.get(key);
    if (!node) {
      node = h('div', 'chat-thread-group');
      node.setAttribute('role', 'presentation');
      labels.set(key, node);
    }
    if (node.textContent !== text) node.textContent = text;
    return node;
  }

  /** Put `nodes` into `el`, in order, moving the nodes that are already there. @param {Node[]} nodes */
  function reconcile(nodes) {
    let i = 0;
    for (const node of nodes) {
      const at = el.childNodes[i];
      if (at !== node) el.insertBefore(node, at || null);
      i += 1;
    }
    while (el.childNodes.length > nodes.length) el.removeChild(/** @type {Node} */(el.lastChild));
  }

  function showSkeleton() {
    if (skeletonShown) return;
    skeletonShown = true;
    if (listLabel === null) listLabel = el.getAttribute('aria-label');
    /** @type {Node[]} */
    const bones = [];
    for (let i = 0; i < SKELETON_ROWS; i += 1) {
      const b = h('div', 'chat-thread-skel');
      b.setAttribute('aria-hidden', 'true');
      bones.push(b);
    }
    el.setAttribute('aria-busy', 'true');
    el.setAttribute('aria-label', t('sidebar.loading'));
    reconcile(bones);
  }

  function clearSkeleton() {
    skeletonShown = false;
    el.removeAttribute('aria-busy');
    // Give the list its own name back: showSkeleton() borrowed it for "Loading chats…", and a list
    // still labelled that way half an hour later is a lie to a screen reader.
    if (listLabel !== null) { el.setAttribute('aria-label', listLabel); listLabel = null; }
  }

  /** @param {any[]} list */
  function paint(list) {
    current = list;
    if (results) { paintResults(); return; }
    /** @type {Node[]} */
    const nodes = [];
    let group = null;
    const ts = now();
    for (const th of list) {
      const key = groupKeyFor(th, ts);
      if (key !== group) { group = key; nodes.push(labelFor(key)); }
      nodes.push(paintRow(th));
    }

    const live = new Set(list.map((th) => th.id));
    for (const id of [...rows.keys()]) if (!live.has(id)) rows.delete(id);

    clearSkeleton();
    reconcile(nodes);
  }

  // ---- search ------------------------------------------------------------------------------

  function buildSearch() {
    const tools = app.els && app.els.sideTools;
    if (!tools || searchInput) return;
    const box = h('div', 'chat-search');
    const input = /** @type {HTMLInputElement} */ (h('input', 'chat-search-input'));
    input.type = 'search';
    input.placeholder = t('library.searchPlaceholder');
    input.setAttribute('aria-label', t('library.searchLabel'));
    input.autocomplete = 'off';
    input.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      // An input debounce, not a wall-clock rule (§2.6 AK): a timer here is fine.
      searchTimer = setTimeout(() => { searchTimer = null; void runSearch(input.value); }, SEARCH_DEBOUNCE_MS);
    });
    input.addEventListener('keydown', (/** @type {any} */ e) => {
      if (e && e.key === 'Escape' && input.value) { e.stopPropagation(); clearSearch(); }
    });
    const clear = h('button', 'chat-search-clear', '×');
    /** @type {any} */ (clear).type = 'button';
    clear.setAttribute('aria-label', t('library.searchClear'));
    clear.title = t('library.searchClear');
    clear.classList.add('hidden');
    clear.addEventListener('click', () => clearSearch());
    box.append(input, clear);
    tools.replaceChildren(box);
    searchInput = input;
  }

  function clearSearch() {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    if (searchInput) searchInput.value = '';
    searchSeq += 1;
    query = '';
    results = null;
    syncSearchChrome();
    paint(current);
  }

  function syncSearchChrome() {
    const tools = app.els && app.els.sideTools;
    if (!tools) return;
    const clear = tools.querySelector('.chat-search-clear');
    if (clear) clear.classList.toggle('hidden', !query);
  }

  /** @param {string} raw */
  async function runSearch(raw) {
    const repo = app.repo;
    const needle = fold(raw).trim();
    const mine = ++searchSeq;
    query = raw || '';
    syncSearchChrome();
    if (!needle) { results = null; paint(current); return; }
    if (!repo) return;

    /** @type {Map<string, {msgId: string, snippet: string}>} */
    const hits = new Map();
    /** Every message that matched THIS needle, in store order, for the next keystroke. */
    /** @type {{id: string, threadId: string, hay: string, folded: string}[]} */
    const matched = [];

    /** @param {{id: string, threadId: string, hay: string, folded: string}} row */
    const consider = (row) => {
      // The cheap test first: `fold()` is one normalize + one regex, while makeSnippet's foldIndex
      // walks the text character by character building a position map. Only the FIRST hit of a
      // thread — the one that becomes the snippet — is worth that.
      if (!row.folded.includes(needle)) return;
      matched.push(row);
      if (hits.has(row.threadId)) return;
      const snippet = makeSnippet(row.hay, needle);
      if (snippet) hits.set(row.threadId, { msgId: row.id, snippet });
    };

    // A longer needle can only match where the shorter one did, so a reader who keeps typing
    // re-filters the previous hits instead of cursoring the whole message store again — which is
    // what every keystroke used to cost (~140 ms at 12k messages, this file's own measurement).
    // The cache is dropped whenever the store moves, and a truncated one is never reused.
    const narrow = scanCache && scanCache.complete && scanCache.needle && needle.startsWith(scanCache.needle);
    if (narrow) {
      for (const row of /** @type {any} */ (scanCache).rows) consider(row);
    } else if (typeof repo.scanMessages === 'function') {
      await repo.scanMessages((/** @type {any} */ m) => {
        if (!m || !m.threadId) return true;
        const hay = messageHaystack(m);
        consider({ id: m.id, threadId: m.threadId, hay, folded: fold(hay) });
        return true;
      });
    }
    if (mine !== searchSeq) return;                       // a newer query is already running
    scanCache = { needle, rows: matched, complete: matched.length <= SCAN_CACHE_ROWS };

    const list = current.length ? current : await repo.listThreads();
    if (mine !== searchSeq) return;
    results = [];
    for (const th of list) {
      const hit = hits.get(th.id);
      const titleMatch = fold(th.title).includes(needle);
      if (!hit && !titleMatch) continue;
      results.push({ thread: th, msgId: hit ? hit.msgId : null, snippet: hit ? hit.snippet : null });
      if (results.length >= MAX_RESULTS) break;
    }
    paintResults();
  }

  function paintResults() {
    if (!results) return;
    clearSkeleton();
    /** @type {Node[]} */
    const nodes = [h('div', 'chat-thread-group', t('library.searchResults'))];
    if (!results.length) {
      nodes.push(h('div', 'chat-search-empty', t('library.searchNone', { q: query })));
    }
    for (const r of results) {
      const row = h('div', 'chat-thread-row chat-result');
      row.setAttribute('role', 'listitem');
      row.setAttribute('data-id', r.thread.id);
      if (r.msgId) row.setAttribute('data-msg', r.msgId);
      const btn = h('button', 'chat-thread');
      /** @type {any} */ (btn).type = 'button';
      btn.setAttribute('data-id', r.thread.id);
      btn.classList.toggle('active', app.state.threadId === r.thread.id);
      const title = h('span', 'chat-thread-title', r.thread.title || t('sidebar.untitled'));
      btn.appendChild(title);
      if (r.snippet) btn.appendChild(h('span', 'chat-result-snippet', r.snippet));
      btn.addEventListener('click', () => { void openResult(r.thread.id, r.msgId); });
      row.appendChild(btn);
      nodes.push(row);
    }
    // The keyed row map holds GROUP rows only; a result row is rebuilt per query on purpose (it
    // carries a snippet that belongs to this query and to no other).
    rows.clear();
    reconcile(nodes);
  }

  /** @param {string} threadId @param {string|null} msgId */
  async function openResult(threadId, msgId) {
    if (!app.controller) return;
    await app.controller.selectThread(threadId);
    if (msgId && app.view && typeof app.view.scrollToMessage === 'function') {
      app.view.scrollToMessage(msgId, { flash: true });
    }
  }

  // ---- interrupted threads -----------------------------------------------------------------

  async function scanInterrupted() {
    const repo = app.repo;
    if (!repo || typeof repo.scanMessages !== 'function') return false;
    /** @type {Set<string>} */
    const found = new Set();
    await repo.scanMessages((/** @type {any} */ m) => {
      if (m && m.status === 'interrupted' && m.threadId) found.add(m.threadId);
      return true;
    });
    const changed = found.size !== interrupted.size || [...found].some((id) => !interrupted.has(id));
    interrupted = found;
    return changed;
  }

  /**
   * Refresh the dots AFTER the rows are on screen, and repaint only if the set moved. The scan is
   * never awaited by render(): it must not delay the list.
   *
   * It is also NOT run per render. `scanMessages` cursors the WHOLE message store (~12 µs/record
   * measured: 14 ms for 1,200 messages, so ~140 ms at 12k), and render() fires on every thread
   * create/update/delete — three times per send, and once per search keystroke, rename and pin.
   * What the scan learns only changes at boot: `repo.recoverInterrupted()` turns 'streaming' into
   * 'interrupted' between main.mjs's two render() calls (§3.1 steps 11 and 12), which is why
   * main.mjs asks for the scan explicitly (`render({rescan:true})`) after recovery; a store that
   * attaches late changes `repo.mode` and re-arms it here. Everything that happens LIVE is covered
   * by the EV.MESSAGE_PUT listener at the bottom of this file.
   *
   * A render that arrives while a scan is in flight queues exactly ONE more scan: its result is
   * older than that render (measured — boot used to lose the dot to this race), and dropping it
   * without a follow-up left the dots a whole session behind.
   * @param {boolean} [force]
   */
  function refreshDots(force) {
    const repo = app.repo;
    if (!repo || repo.mode === 'pending') return;
    if (!force && scannedMode === repo.mode) return;      // already cursored in this store mode
    scannedMode = repo.mode;
    if (scanning) { rescan = true; return; }
    scanning = true;
    scanInterrupted().then(
      (changed) => {
        scanning = false;
        if (changed && current.length) paint(current);
        if (rescan) { rescan = false; refreshDots(true); }
      },
      (err) => {
        scanning = false;
        rescan = false;
        scannedMode = null;                               // it never landed: let the next render try
        console.warn('[lolchat] sidebar: interrupted scan failed', err);
      },
    );
  }

  // ---- rename ------------------------------------------------------------------------------

  /** Inline rename, from the … menu or a double-click. @param {string} id */
  function startRename(id) {
    const entry = rows.get(id);
    if (!entry || renaming === id) return;
    renaming = id;
    const th = current.find((x) => x.id === id);
    const input = /** @type {HTMLInputElement} */ (h('input', 'chat-thread-rename'));
    input.type = 'text';
    input.value = (th && th.title) || '';
    input.setAttribute('aria-label', t('library.renameLabel'));
    entry.row.classList.add('renaming');
    /** @type {any} */ (entry.btn).hidden = true;
    entry.row.insertBefore(input, entry.btn.nextSibling || null);

    let closed = false;
    const finish = async (/** @type {boolean} */ save) => {
      if (closed) return;
      closed = true;
      renaming = null;
      const value = String(input.value || '').trim();
      input.remove();
      /** @type {any} */ (entry.btn).hidden = false;
      entry.row.classList.remove('renaming');
      if (!save || !value || !app.repo) return;
      if (th && th.title === value) return;
      await app.repo.updateThread(id, { title: value, titleSource: 'user' });   // → THREADS_CHANGED
    };

    input.addEventListener('keydown', (/** @type {any} */ e) => {
      if (!e) return;
      if (e.key === 'Enter') { e.preventDefault(); void finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void finish(false); }
      if (typeof e.stopPropagation === 'function') e.stopPropagation();       // never reach SHORTCUTS
    });
    input.addEventListener('blur', () => { void finish(true); });
    if (typeof input.focus === 'function') input.focus();
    if (typeof input.select === 'function') input.select();
  }

  // ---- delete ------------------------------------------------------------------------------

  /** @param {string} id */
  async function askDelete(id) {
    const repo = app.repo;
    if (!repo) return;
    const th = current.find((x) => x.id === id) || (await repo.getThread(id));
    if (!th) return;
    const name = th.title || t('sidebar.untitled');

    if (!app.dialogs) {
      // No dialog surface (a production load failure): never delete history unasked.
      console.warn('[lolchat] sidebar: no dialogs component, refusing to delete without a confirm');
      return;
    }
    const ok = await app.dialogs.confirm({
      title: t('sidebar.deleteTitle'),
      body: t('sidebar.deleteBody', { title: name }),
      ok: t('sidebar.deleteOk'),
      danger: true,
    });
    if (!ok) return;

    const order = current;
    const at = order.findIndex((x) => x.id === id);
    const next = at >= 0 ? (order[at + 1] || order[at - 1] || null) : null;
    const wasActive = app.state.threadId === id;

    // Deleting the chat a reply is streaming INTO: stop it first and wait for it to settle. The
    // generation used to run on after the delete — the farm kept generating (and kept the seat the
    // seat gate gave this client) for an answer nobody would read, the governor stayed busy so the
    // composer refused every send, and the last checkpoint re-inserted the assistant row into a
    // thread that no longer existed. Settling first also puts every write BEFORE the cascade.
    if (app.controller && typeof app.controller.abortThread === 'function') {
      try {
        await app.controller.abortThread(id);
      } catch (err) {
        console.warn('[lolchat] sidebar: stopping the deleted thread’s reply failed', err);
      }
    }

    await repo.deleteThread(id);          // emits THREADS_CHANGED{delete} → render()
    interrupted.delete(id);

    if (wasActive && app.controller) {
      try {
        await app.controller.selectThread(next ? next.id : null);
      } catch (err) {
        console.warn('[lolchat] sidebar: selecting the next thread failed', err);
      }
    }
    await api.render();
  }

  // ---- the ⌄ new-chat menu -----------------------------------------------------------------

  function syncMenuButton() {
    const items = app.registry.list(SLOTS.NEW_MENU);
    const head = app.els && app.els.sideHead;
    if (!head) return;
    if (!items.length) {
      if (menuBtn) { menuBtn.remove(); menuBtn = null; }
      return;
    }
    if (menuBtn && menuBtn.parentNode === head) return;
    const btn = /** @type {HTMLButtonElement} */ (h('button', 'btn-accent chat-new-menu', '⌄'));
    btn.type = 'button';
    btn.setAttribute('aria-label', t('sidebar.newMenu'));
    btn.title = t('sidebar.newMenu');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.addEventListener('click', () => openNewMenu(btn));
    head.appendChild(btn);
    menuBtn = btn;
  }

  /** @param {HTMLElement} anchor */
  function openNewMenu(anchor) {
    openPopoverMenu(anchor, app.registry.list(SLOTS.NEW_MENU), (item) => { item.run(app); });
  }

  /** @param {HTMLElement} anchor @param {string} threadId */
  function openThreadMenu(anchor, threadId) {
    const thread = current.find((x) => x.id === threadId);
    if (!thread) return;
    // Read at OPEN time, never cached (§2.6 AD): a feature that registers later must appear here.
    const items = app.registry.list(SLOTS.THREAD_MENU)
      .filter((/** @type {any} */ item) => (typeof item.visible === 'function' ? !!item.visible(thread, app) : true));
    openPopoverMenu(anchor, items, (item) => { item.run(thread, app); });
  }

  /** @param {HTMLElement} anchor @param {any[]} items @param {(item: any) => any} run */
  function openPopoverMenu(anchor, items, run) {
    if (openMenu) { openMenu.close(); openMenu = null; }
    if (!app.dialogs || !items.length) return;
    openMenu = app.dialogs.popover(anchor, (/** @type {HTMLElement} */ box, /** @type {() => void} */ close) => {
      box.classList.add('chat-menu');
      box.setAttribute('role', 'menu');
      for (const item of items) {
        const b = h('button', 'chat-menu-item', String(item.label || item.id));
        /** @type {any} */ (b).type = 'button';
        b.setAttribute('role', 'menuitem');
        b.setAttribute('data-item', String(item.id));
        b.addEventListener('click', () => {
          if (typeof close === 'function') close();
          try { run(item); } catch (err) { console.warn(`[lolchat] menu item "${item.id}" failed`, err); }
        });
        box.appendChild(b);
      }
    });
  }

  // ---- api ---------------------------------------------------------------------------------

  const api = {
    /** @param {{rescan?: boolean}} [opts] rescan: cursor the whole store for interrupted replies */
    async render(opts) {
      const mine = ++seq;
      const repo = app.repo;
      buildSearch();
      syncMenuButton();
      if (!repo) { rows.clear(); reconcile([]); return; }
      if (repo.mode === 'pending' && !current.length) showSkeleton();

      const list = await repo.listThreads();
      if (mine !== seq) return;
      if (!list.length && repo.mode === 'pending') { showSkeleton(); return; }
      paint(list);
      refreshDots(!!(opts && opts.rescan));
    },

    /** @param {string|null} threadId */
    highlight(threadId) {
      for (const [id, entry] of rows) {
        const active = id === threadId;
        entry.btn.classList.toggle('active', active);
        if (active) entry.btn.setAttribute('aria-current', 'true');
        else entry.btn.removeAttribute('aria-current');
      }
      if (results) {
        for (const node of el.querySelectorAll('.chat-result .chat-thread')) {
          node.classList.toggle('active', node.getAttribute('data-id') === threadId);
        }
      }
    },
  };

  // ---- the built-in menu items ---------------------------------------------------------------
  // They are ordinary SLOTS.THREAD_MENU / SLOTS.NEW_MENU items, so the sidebar has exactly ONE menu
  // code path and a later feature's item sits among them by `order` rather than after them.

  app.registry.add(SLOTS.NEW_MENU, {
    id: 'ephemeral',
    order: 10,
    label: t('library.newEphemeral'),
    run: (/** @type {any} */ a) => {
      const c = (a && a.controller) || app.controller;
      if (c) c.newThread({ ephemeral: true });
      if (app.composer && typeof app.composer.focus === 'function') app.composer.focus();
    },
  });

  app.registry.add(SLOTS.THREAD_MENU, {
    id: 'rename', order: 10, label: t('library.rename'),
    run: (/** @type {any} */ th) => startRename(th.id),
  });
  app.registry.add(SLOTS.THREAD_MENU, {
    id: 'pin', order: 20, label: t('library.pin'),
    visible: (/** @type {any} */ th) => !th.pinned,
    run: (/** @type {any} */ th) => { void setPinned(th.id, true); },
  });
  app.registry.add(SLOTS.THREAD_MENU, {
    id: 'unpin', order: 20, label: t('library.unpin'),
    visible: (/** @type {any} */ th) => !!th.pinned,
    run: (/** @type {any} */ th) => { void setPinned(th.id, false); },
  });
  app.registry.add(SLOTS.THREAD_MENU, {
    id: 'export-md', order: 30, label: t('library.exportMd'),
    run: (/** @type {any} */ th) => { void exportThreadFile(app, th.id, 'markdown'); },
  });
  app.registry.add(SLOTS.THREAD_MENU, {
    id: 'export-json', order: 40, label: t('library.exportJson'),
    run: (/** @type {any} */ th) => { void exportThreadFile(app, th.id, 'json'); },
  });
  app.registry.add(SLOTS.THREAD_MENU, {
    id: 'delete', order: 90, label: t('library.deleteChat'),
    run: (/** @type {any} */ th) => { void askDelete(th.id); },
  });

  /** @param {string} id @param {boolean} on */
  async function setPinned(id, on) {
    if (!app.repo) return;
    await app.repo.updateThread(id, { pinned: on });      // → THREADS_CHANGED → render()
  }

  app.bus.on(EV.THREADS_CHANGED, () => { dropScanCache(); api.render(); });
  app.bus.on(EV.THREAD_SELECTED, (/** @type {any} */ p) => api.highlight(p && p.threadId ? p.threadId : null));
  app.bus.on(EV.STORE_MODE, () => { dropScanCache(); api.render(); });
  app.bus.on(EV.STREAM_END, dropScanCache);
  app.bus.on(EV.MESSAGE_PUT, (/** @type {any} */ msg) => {
    dropScanCache();
    if (!msg || msg.status !== 'interrupted' || !msg.threadId) return;
    if (interrupted.has(msg.threadId)) return;
    interrupted.add(msg.threadId);
    const entry = rows.get(msg.threadId);
    if (entry) { entry.dot.classList.remove('hidden'); entry.dot.title = t('sidebar.interrupted'); }
  });

  return api;
}
