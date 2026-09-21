// @ts-check
/**
 * render/thread-view.mjs - the message list (P1-U3). Plan §3.4, §3.5, §3.8, §3.9.
 *
 * It owns everything inside `#chat-messages` and NOTHING else: it never reads the farm, never
 * subscribes to FARM_CHANGE/FARM_TICK (§3.8 - that is exactly why a 4-second farm refresh cannot
 * disturb a scroll position, an open reasoning block or a text selection), and never talks to the
 * network. Its inputs are messages; its outputs are DOM and two bus events it emits on click
 * (BRANCH_SWITCH) plus whatever a registered MESSAGE_ACTION does.
 *
 * Rows are KEYED by message id. A row whose (updatedAt, status, content length, reasoning length,
 * sibling position) is unchanged is not touched at all, so node identity - and with it the
 * selection, the scroll offset and the code chrome - survives any number of re-renders.
 *
 * Streaming (§3.8). `beginStream(id)` gives the controller three calls:
 *   paint(content, reasoning)  cumulative text; coalesced to at most ONE paint per animation
 *                              frame, and to every SECOND frame after a paint that took > 6 ms.
 *   setStatus(status)          the row's data-status while it runs.
 *   end(msg)                   flush, one final parseBlocks compare (stream-dom finish()), stats,
 *                              notes, aria-busy off and one "Reply finished" announcement.
 * The markdown diff itself lives in render/stream-dom.mjs; reasoning is PLAIN TEXT in one text
 * node grown with appendData - a model's "thinking" is not markdown and must not be rendered as
 * any (a half-open fence in reasoning would otherwise swallow the answer).
 *
 * Time (§3.9): the only clock this module reads is app.now(), and only from inside a paint or an
 * end() - it starts NO timer of its own, so a minimised window costs nothing.
 */

import { domFactory, renderBlocks } from './dom.mjs';
import { parseBlocks, createStreamParser } from './md-block.mjs';
import { createStreamRenderer } from './stream-dom.mjs';
import { icon } from '../ui/layout.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/core.en.mjs';
import '../strings/render.en.mjs';

const REASONING_KEY = 'ui:reasoningOpen';
/** How many opened-reasoning ids `ui:reasoningOpen` keeps (§3.7: "last 200 ids"). */
const REASONING_KEEP = 200;
/** Paint samples kept for debug.paintStats(); the perf gate reads p50/p95/max per stream. */
const PAINT_SAMPLES = 2000;
const SLOW_PAINT_MS = 6;
const COPY_ICON = ['M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z',
  'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'];

/** Statuses whose row carries a note instead of (or beside) a body. */
const NOTE_FOR = { error: 'render.noteError', interrupted: 'render.noteInterrupted', aborted: 'render.noteAborted' };

/**
 * Copy text, preferring the async clipboard and falling back to a hidden textarea + execCommand.
 * Exported because render/code.mjs's Copy button needs exactly the same fallback chain, and a
 * second copy of it would drift.
 * @param {string} text
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(String(text));
      return true;
    }
  } catch (err) {
    void err;                       // fall through to the textarea
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = String(text);
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (err) {
    void err;
    return false;
  }
}

const div = (cls) => {
  const d = document.createElement('div');
  d.className = cls;
  return d;
};

/**
 * @param {import('../core/types.mjs').App} app
 * @param {HTMLElement} el  app.els.messages
 */
export function createThreadView(app, el) {
  const H = domFactory(document);
  const els = app.els;
  /** @type {Map<string, any>} */ const rows = new Map();
  /** @type {Set<string>} */ const reasoningOpen = new Set();
  /** @type {number[]} */ const paints = [];          // ring-buffered: see pushPaint()
  /** @type {Map<string, {position: number, count: number}>|null} */ let lastSiblings = null;
  /** @type {Set<string>} */ let outside = new Set();
  let follow = true;
  let atBottom = true;
  let streaming = 0;

  // ------------------------------------------------------------------ citations and decorators

  /** The CITATIONS slot, resolved for one message: first non-null wins (§3.4). */
  const citationsFor = (msg) => (n) => {
    for (const c of app.registry.list(app.SLOTS.CITATIONS)) {
      try {
        const hit = c.resolve(n, msg, app);
        if (hit) return hit;
      } catch (err) {
        console.warn('[lolchat] citation resolver failed', err);
      }
    }
    return null;
  };

  /**
   * Run CODE_DECORATORS on one fence, at most once per decorator per node. The list of decorators
   * already applied rides on the node itself (data-deco), so it survives anything that keeps the
   * node - which, thanks to the stream diff, is every settled block.
   */
  function decorateCode(node, block, info, msg) {
    const applied = new Set((node.getAttribute('data-deco') || '').split(' ').filter(Boolean));
    const arg = { lang: (block && block.lang) || '', code: (block && block.code) || '', msg, final: !!info.final };
    for (const d of app.registry.list(app.SLOTS.CODE_DECORATORS)) {
      if (applied.has(d.id)) continue;
      let ok = false;
      try { ok = !!d.match(arg); } catch (err) { console.warn('[lolchat] decorator match failed', err); }
      if (!ok) continue;
      try {
        d.decorate(node, arg, app);
        applied.add(d.id);
      } catch (err) {
        console.warn(`[lolchat] code decorator "${d.id}" failed`, err);
      }
    }
    node.setAttribute('data-deco', [...applied].join(' '));
  }

  /** The render options for one message: citations + the code-chrome hook. */
  const optsFor = (msg) => ({
    citations: citationsFor(msg),
    onBlockReady: (node, block, info) => decorateCode(node, block, info, msg),
  });

  // ------------------------------------------------------------------------------- the scaffold

  const sentinel = div('chat-anchor');
  sentinel.setAttribute('aria-hidden', 'true');

  function placeTail() {
    // the sentinel, then .chat-jump, are always the LAST children (ui/layout.mjs's contract)
    el.appendChild(sentinel);
    if (els.jump && els.jump.parentNode === el) el.appendChild(els.jump);
  }
  placeTail();

  const scrollToBottom = () => { el.scrollTop = el.scrollHeight; };

  function updateJump() {
    if (!els.jump) return;
    els.jump.classList.toggle('hidden', follow || atBottom);
  }

  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      for (const e of entries) atBottom = e.isIntersecting;
      if (atBottom) follow = true;
      updateJump();
    }, { root: el, threshold: 0 }).observe(sentinel);
  }

  el.addEventListener('wheel', (e) => {
    if (e.deltaY < 0 && follow) { follow = false; updateJump(); }
  }, { passive: true });

  // §3.8's key path. It used to listen on `el` — which has no tabindex, is never
  // document.activeElement (Chromium skips a scroller that has focusable children) and therefore
  // only ever saw keys bubbling from a message button. Focus really sits in #chat-input (the
  // controller focuses the composer after every generate), where PageUp/Home scroll the LIST, so
  // the listener has to be on the document. A key typed INSIDE the composer's text moves the
  // caret, not the list — unless the composer is empty, when the browser scrolls the page.
  document.addEventListener('keydown', (e) => {
    if (!follow || !['PageUp', 'ArrowUp', 'Home'].includes(e.key)) return;
    const focused = document.activeElement;
    const typing = !!focused && focused !== document.body && !el.contains(focused)
      && (/** @type {any} */ (focused).value ? String(/** @type {any} */ (focused).value).length > 0 : false);
    if (typing && e.key !== 'PageUp') return;   // the caret is moving inside text the reader wrote
    follow = false;
    updateJump();
  });

  document.addEventListener('selectionchange', () => {
    if (!follow) return;
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode) return;
    if (el.contains(sel.anchorNode)) { follow = false; updateJump(); }
  });

  if (els.jump) {
    els.jump.addEventListener('click', () => {
      follow = true;
      scrollToBottom();
      updateJump();
    });
  }

  // reasoning open/closed is remembered across renders and across launches (§3.8)
  if (app.repo && typeof app.repo.kvGet === 'function') {
    Promise.resolve(app.repo.kvGet(REASONING_KEY, [])).then((ids) => {
      if (!Array.isArray(ids)) return;
      for (const id of ids.slice(-REASONING_KEEP)) reasoningOpen.add(String(id));
      for (const [id, row] of rows) if (row.reasoning && reasoningOpen.has(id)) setOpen(row, true);
    }).catch(() => { /* the store speaks for itself through its own banner */ });
  }

  // §3.7 says `ui:reasoningOpen` keeps the LAST 200 ids. A Set preserves insertion order, so the
  // newest 200 are simply its tail; ids are otherwise never pruned (a reader only removes one by
  // re-collapsing that exact message) and the value would grow for the life of the profile.
  const saveReasoningOpen = () => {
    if (!app.repo || typeof app.repo.kvSet !== 'function') return;
    if (reasoningOpen.size > REASONING_KEEP) {
      const keep = [...reasoningOpen].slice(-REASONING_KEEP);
      reasoningOpen.clear();
      for (const id of keep) reasoningOpen.add(id);
    }
    Promise.resolve(app.repo.kvSet(REASONING_KEY, [...reasoningOpen])).catch(() => { /* memory store */ });
  };

  // --------------------------------------------------------------------------------------- rows

  function buildRow(id) {
    const node = div('chat-msg');
    node.setAttribute('data-id', id);
    const parts = div('chat-msg-parts');
    const body = div('chat-body');
    const note = div('chat-msg-note');
    const foot = div('chat-msg-foot');
    const branch = div('chat-branch');
    const stats = div('chat-stats');
    const actions = div('chat-actions');
    // `.chat-stats` and `.chat-msg-note` are built here but attached ONLY while they have
    // something to say (setStats/setNote below). shell/test/e2e.js - frozen, byte-identical -
    // detects "the reply finished" with querySelector('.chat-stats') EXISTENCE, so an
    // always-present empty node made every e2e run read an empty stats line one second in.
    foot.append(branch, actions);
    node.append(parts, body, foot);
    const row = {
      id, node, parts, body, note, foot, branch, stats, actions,
      reasoning: null, reasoningBody: null, reasoningSummary: null, reasoningText: '',
      sr: createStreamRenderer(H, body, optsFor(null)),
      bodyText: null, rev: null, msg: null, stream: null, streaming: false,
      userToggled: false, autoOpen: null,
    };
    rows.set(id, row);
    return row;
  }

  /**
   * Show or hide `.chat-stats`. Presence, not a class: e2e.js asks whether the node EXISTS.
   * @param {any} row @param {string} text
   */
  function setStats(row, text) {
    row.stats.textContent = text || '';
    if (text) {
      row.stats.classList.remove('hidden');
      if (row.stats.parentNode !== row.foot) row.foot.insertBefore(row.stats, row.actions);
    } else {
      row.stats.classList.add('hidden');
      row.stats.remove();
    }
  }

  /** Same treatment for the note line (§3.5): present only while it carries a sentence. */
  function setNote(row, text) {
    row.note.textContent = text || '';
    if (text) {
      row.note.classList.remove('hidden');
      if (row.note.parentNode !== row.node) row.node.insertBefore(row.note, row.foot);
    } else {
      row.note.classList.add('hidden');
      row.note.remove();
    }
  }

  /**
   * Open or close the reasoning block OURSELVES.
   *
   * `<details>` fires `toggle` for a programmatic `open` exactly as it does for a click, and the
   * listener below cannot tell them apart - so the auto-open at the start of a stream used to mark
   * the row as "the reader opened this", which then suppressed the auto-collapse AND wrote the id
   * into the persisted `ui:reasoningOpen` set. Every auto-toggle therefore announces itself here,
   * and the listener swallows exactly that one event.
   * @param {any} row @param {boolean} want
   */
  function setOpen(row, want) {
    const d = row.reasoning;
    if (!d || d.open === want) return;
    row.autoOpen = want;
    d.open = want;
  }

  /** The reasoning <details>, created on first use and kept for the life of the row. */
  function ensureReasoning(row) {
    if (row.reasoning) return row.reasoning;
    const d = document.createElement('details');
    d.className = 'chat-reasoning';
    const s = document.createElement('summary');
    s.textContent = t('render.thought');
    const b = div('chat-reasoning-body');
    const text = document.createTextNode('');
    b.appendChild(text);
    d.append(s, b);
    row.node.insertBefore(d, row.body);
    d.addEventListener('toggle', () => {
      if (row.autoOpen !== null && row.autoOpen === d.open) { row.autoOpen = null; return; }
      row.userToggled = true;
      if (d.open) reasoningOpen.add(row.id); else reasoningOpen.delete(row.id);
      saveReasoningOpen();
    });
    row.reasoning = d;
    row.reasoningSummary = s;
    row.reasoningBody = text;
    setOpen(row, reasoningOpen.has(row.id));   // remembered from a previous session, not a click
    return d;
  }

  /** Grow the reasoning text node - never markdown, never a rebuild while it only appends. */
  function growReasoning(row, text) {
    const next = text || '';
    if (next === row.reasoningText) return;
    ensureReasoning(row);
    if (next.length > row.reasoningText.length && next.startsWith(row.reasoningText)) {
      row.reasoningBody.appendData(next.slice(row.reasoningText.length));
    } else {
      row.reasoningBody.data = next;
    }
    row.reasoningText = next;
  }

  /** @param {any} row @param {number|null} ms @param {boolean} live */
  function reasoningSummary(row, ms, live) {
    if (!row.reasoningSummary) return;
    const s = Math.max(0, Math.round((ms || 0) / 1000));
    row.reasoningSummary.textContent = live ? t('render.thinking', { s })
      : (ms === null || ms === undefined ? t('render.thought') : t('render.thoughtFor', { s }));
  }

  /** Render one message's parts through PART_RENDERERS (user rows). */
  function fillParts(row, msg) {
    const list = Array.isArray(msg.parts) && msg.parts.length
      ? msg.parts
      : (msg.role === 'user' && msg.content ? [{ type: 'text', text: msg.content }] : []);
    row.parts.replaceChildren();
    if (msg.role !== 'user' || !list.length) return;
    for (const part of list) {
      const r = app.registry.list(app.SLOTS.PART_RENDERERS).find((x) => x.type === part.type);
      if (!r) continue;
      try {
        const node = r.render(part, msg, app);
        if (node) row.parts.appendChild(node);
      } catch (err) {
        console.warn(`[lolchat] part renderer "${part.type}" failed`, err);
      }
    }
  }

  function fillActions(row, msg) {
    row.actions.replaceChildren();
    const ctx = { view: api, streaming: msg.status === 'streaming' };
    for (const a of app.registry.list(app.SLOTS.MESSAGE_ACTIONS)) {
      let show = true;
      try { show = a.visible ? !!a.visible(msg, ctx) : true; } catch (err) { show = false; }
      if (!show) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-action';
      b.setAttribute('data-action', a.id);
      b.title = a.label;
      b.setAttribute('aria-label', a.label);
      if (a.icon) b.appendChild(icon(a.icon, { size: 14 }));
      else b.textContent = a.label;
      b.addEventListener('click', () => {
        try { a.run(row.msg || msg, app, b); } catch (err) { console.warn(`[lolchat] message action "${a.id}" failed`, err); }
      });
      row.actions.appendChild(b);
    }
  }

  function fillBranch(row, msg, siblings) {
    const at = siblings && typeof siblings.get === 'function' ? siblings.get(msg.id) : null;
    row.branch.replaceChildren();
    if (!at || !(at.count > 1)) return;
    const mk = (dir, label, glyph, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-branch-btn';
      b.textContent = glyph;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.disabled = disabled;
      b.addEventListener('click', () => app.bus.emit(app.EV.BRANCH_SWITCH, { messageId: msg.id, dir }));
      return b;
    };
    const label = document.createElement('span');
    label.className = 'chat-branch-at';
    label.textContent = t('render.branchAt', { position: at.position, count: at.count });
    row.branch.append(
      mk(-1, t('render.branchPrev'), '◀', at.position <= 1),
      label,
      mk(1, t('render.branchNext'), '▶', at.position >= at.count),
    );
  }

  /** The whole row, from a settled message. */
  function fill(row, msg, siblings) {
    row.msg = msg;
    row.node.className = `chat-msg ${msg.role === 'user' ? 'user' : 'assistant'}`;
    row.node.setAttribute('data-status', msg.status || 'done');
    if (msg.status === 'streaming') row.node.setAttribute('aria-busy', 'true');
    else row.node.removeAttribute('aria-busy');
    row.node.classList.toggle('chat-outside', outside.has(msg.id));
    if (outside.has(msg.id)) row.node.title = t('render.outsideContext'); else row.node.removeAttribute('title');

    fillParts(row, msg);

    // reasoning
    if (msg.reasoning) {
      ensureReasoning(row);
      growReasoning(row, msg.reasoning);
      reasoningSummary(row, msg.reasoningMs === undefined ? null : msg.reasoningMs, false);
      if (!row.userToggled && !reasoningOpen.has(row.id)) setOpen(row, false);
    } else if (row.reasoning) {
      row.reasoning.remove();
      row.reasoning = null;
      row.reasoningBody = null;
      row.reasoningSummary = null;
      row.reasoningText = '';
    }

    // body: a 'local' message IS its note (the busy line the client wrote itself), so it never
    // reaches the markdown renderer. A USER row whose parts rendered is already on screen - §3.5
    // makes `.chat-msg-parts` the user surface (P3 hangs image/doc chips there), so painting
    // `content` into `.chat-body` as well showed every user message TWICE.
    const paintedParts = msg.role === 'user' && row.parts.childNodes.length > 0;
    const bodyText = (msg.status === 'local' || paintedParts) ? '' : (msg.content || '');
    renderBody(row, bodyText, msg);
    row.body.classList.toggle('hidden', paintedParts);

    // note
    const noteKey = NOTE_FOR[msg.status];
    let note = '';
    if (msg.status === 'local') note = msg.content || '';
    // 'waiting' is the seat-wait row (P2-U1): §3.5 lists it among the notes, and its text is the
    // FARM's sentence, so it comes from msg.error.message exactly like an error's — but with no
    // generic fallback, because a waiting row without a message has nothing to say yet.
    else if (msg.status === 'waiting') note = (msg.error && msg.error.message) || '';
    else if (msg.status === 'error') note = (msg.error && msg.error.message) || t('render.noteError');
    // A CANCELLED seat wait is an 'aborted' row that still carries the farm's reason (P2 landing,
    // P2-U1's contract request): keep it, and fall back to the generic sentence for the ordinary
    // Stop, where `error` is null.
    else if (msg.status === 'aborted') note = (msg.error && msg.error.message) || t('render.noteAborted');
    else if (noteKey) note = t(/** @type {any} */ (NOTE_FOR)[msg.status]);
    setNote(row, note);

    // stats (§3.4: only for a finished message that has them)
    const wantStats = (msg.status === 'done' || msg.status === 'aborted') && msg.stats && msg.stats.text;
    setStats(row, wantStats ? msg.stats.text : '');

    fillActions(row, msg);
    fillBranch(row, msg, siblings);
  }

  /** Render (or re-render) a settled body through the SAME path the stream uses. */
  function renderBody(row, text, msg) {
    if (row.bodyText === text) return;
    row.sr = row.sr || createStreamRenderer(H, row.body, optsFor(msg));
    if (row.srMsg !== msg) {
      // the options close over the message (citations, decorator context): rebuild the renderer
      row.sr = createStreamRenderer(H, row.body, optsFor(msg));
      row.srMsg = msg;
      row.sr.replaceAll([]);
    }
    row.sr.finish(parseBlocks(text));
    row.bodyText = text;
  }

  const revOf = (msg, siblings) => {
    const at = siblings && typeof siblings.get === 'function' ? siblings.get(msg.id) : null;
    return [
      msg.updatedAt, msg.status, (msg.content || '').length, (msg.reasoning || '').length,
      msg.stats && msg.stats.text ? msg.stats.text : '', at ? `${at.position}/${at.count}` : '',
      outside.has(msg.id) ? 'x' : '',
      // the note text itself: a seat-wait row rewrites it ("2/2 in use") while status and length
      // stay put, and without this the cached row would keep the first sentence for ever.
      msg.error && msg.error.message ? msg.error.message : '',
    ].join('|');
  };

  function ensureRow(msg, siblings) {
    const row = rows.get(msg.id) || buildRow(msg.id);
    // While a stream owns a row, the STREAM owns its DOM: re-filling it from the store's
    // checkpoint record (which is always behind) would repaint a half-written answer over the
    // live one. This is the path a thread switch back into a streaming thread takes.
    if (row.streaming) {
      row.msg = msg;
      return row;
    }
    const rev = revOf(msg, siblings);
    if (row.rev !== rev) {
      fill(row, msg, siblings);
      row.rev = rev;
    } else {
      row.msg = msg;
    }
    return row;
  }

  function place(node, after) {
    const want = after ? after.nextSibling : el.firstChild;
    if (node === want) return;
    if (node.previousSibling === after && node.parentNode === el) return;
    el.insertBefore(node, want);
  }

  /** Keep the last PAINT_SAMPLES samples: a long session would otherwise grow this forever. */
  function pushPaint(dt) {
    paints.push(dt);
    if (paints.length > PAINT_SAMPLES) paints.splice(0, paints.length - PAINT_SAMPLES);
  }

  /** Rows detached by a mid-stream thread switch stay in the map but are NOT on screen. */
  function attachedRows() {
    let n = 0;
    for (const row of rows.values()) if (row.node.parentNode === el) n++;
    return n;
  }

  function updateEmpty() {
    if (els.empty) els.empty.classList.toggle('hidden', attachedRows() > 0);
  }

  // ---------------------------------------------------------------------------------- the API

  const api = {
    /**
     * @param {any} thread @param {any[]} path
     * @param {{siblings?: Map<string, {position: number, count: number}>}} [opts]
     */
    showPath(thread, path, opts) {
      const list = Array.isArray(path) ? path : [];
      const siblings = opts && opts.siblings ? opts.siblings : null;
      lastSiblings = siblings;
      const keep = new Set(list.map((m) => m.id));
      for (const [id, row] of [...rows]) {
        if (keep.has(id)) continue;
        row.node.remove();
        // A row that is being PAINTED stays in the map, detached: the stream handle closes over
        // this row object, so dropping it froze the reply of the thread you switched away from
        // (it came back from the store as a half-written 'streaming' record that nothing ever
        // refreshed). Detached it keeps painting; coming back re-attaches it live; end() drops
        // it if it is still off-screen.
        if (!row.streaming) rows.delete(id);
      }
      /** @type {any} */ let after = null;
      for (const msg of list) {
        const row = ensureRow(msg, siblings);
        place(row.node, after);
        after = row.node;
      }
      updateEmpty();
      if (follow) scrollToBottom();
    },

    /** @param {any} msg */
    upsert(msg) {
      if (!msg || !msg.id) return;
      const fresh = !rows.has(msg.id);
      // Pass the siblings map the view was LAST shown: `null` made fillBranch clear the row's
      // branch control on every controller-driven upsert (invisible in P1, a real bug from P2-U3).
      const row = ensureRow(msg, lastSiblings);
      if (fresh) el.insertBefore(row.node, sentinel);
      updateEmpty();
      if (follow) scrollToBottom();
      return row.node;
    },

    /** @param {string[]} ids */
    remove(ids) {
      for (const id of ids || []) {
        const row = rows.get(id);
        if (!row) continue;
        row.node.remove();
        rows.delete(id);
      }
      updateEmpty();
    },

    /** @param {string} msgId */
    beginStream(msgId) {
      const row = rows.get(msgId) || buildRow(msgId);
      if (!row.node.parentNode) el.insertBefore(row.node, sentinel);
      updateEmpty();
      const parser = createStreamParser();
      const msg = row.msg || { id: msgId, role: 'assistant', status: 'streaming' };
      row.sr = createStreamRenderer(H, row.body, optsFor(msg));
      row.srMsg = msg;
      row.sr.replaceAll([]);
      row.bodyText = '';
      row.node.setAttribute('data-status', 'streaming');
      row.node.setAttribute('aria-busy', 'true');
      setStats(row, '');
      setNote(row, '');
      row.streaming = true;
      streaming++;

      let raf = 0;
      let skipFrame = false;
      let content = '';
      let reasoning = '';
      let painted = -1;
      let paintedReasoning = -1;
      let reasonStart = 0;
      let reasonEnd = 0;
      let done = false;

      const frame = () => {
        raf = 0;
        if (skipFrame) {               // the last paint was slow: leave this frame to the browser
          skipFrame = false;
          if (painted !== content.length || paintedReasoning !== reasoning.length) schedule();
          return;
        }
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
        if (reasoning.length !== paintedReasoning) {
          if (!reasonStart) reasonStart = app.now();
          growReasoning(row, reasoning);
          paintedReasoning = reasoning.length;
        }
        // Thinking ends when the ANSWER starts, not when the first paint happens: the controller
        // calls paint('', reasoning) for the whole reasoning phase, so keying this off "content
        // differs from what is painted" (painted starts at -1) stopped the clock on frame one and
        // the summary never said "Thinking…" at all.
        if (reasonStart && !reasonEnd && content.length > 0) reasonEnd = app.now();
        if (content.length !== painted) {
          row.sr.update(parser.feed(content));
          painted = content.length;
        }
        if (row.reasoning) {
          const live = !!reasonStart && !reasonEnd;
          reasoningSummary(row, (reasonEnd || app.now()) - reasonStart, live);
          // auto-collapse once the answer starts, unless the reader opened it on purpose
          if (reasonEnd && !row.userToggled && !reasoningOpen.has(row.id) && row.reasoning.open) {
            setOpen(row, false);
            row.collapsedOnce = true;          // never re-open it behind the reader's back
          } else if (!reasonEnd && !row.userToggled && !row.reasoning.open && !row.collapsedOnce) {
            setOpen(row, true);
          }
        }
        if (follow) scrollToBottom();
        const dt = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
        pushPaint(dt);
        if (dt > SLOW_PAINT_MS) skipFrame = true;
        if (painted !== content.length || paintedReasoning !== reasoning.length) schedule();
      };

      const schedule = () => {
        if (raf || done) return;
        raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(frame) : setTimeout(frame, 16);
      };

      return {
        /** @param {string} c @param {string|null} r */
        paint(c, r) {
          content = c || '';
          reasoning = r || '';
          schedule();
        },
        /** @param {string} status */
        setStatus(status) {
          row.node.setAttribute('data-status', status);
        },
        /** @param {any} m */
        end(m) {
          if (done) return;
          done = true;
          streaming = Math.max(0, streaming - 1);
          if (raf) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
            else clearTimeout(raf);
            raf = 0;
          }
          const finalMsg = m || row.msg || msg;
          const finalText = finalMsg.status === 'local' ? '' : (finalMsg.content || '');
          // One last parseBlocks compare (§3.8). The parser only ever moves forward; if the
          // controller replaced the content wholesale (an error path), fall back to a full render.
          try {
            row.sr.finish(parser.end(finalText));
          } catch (err) {
            void err;
            row.sr.replaceAll(parseBlocks(finalText));
          }
          row.bodyText = finalText;
          row.rev = null;                       // force a full fill: stats, notes, actions, status
          fill(row, finalMsg, lastSiblings);
          row.rev = revOf(finalMsg, lastSiblings);
          if (row.reasoning && finalMsg.reasoning) {
            const ms = finalMsg.reasoningMs === undefined || finalMsg.reasoningMs === null
              ? (reasonEnd && reasonStart ? reasonEnd - reasonStart : null)
              : finalMsg.reasoningMs;
            reasoningSummary(row, ms, false);
          }
          row.streaming = false;
          if (row.node.parentNode !== el) {
            // the reader walked away mid-stream: forget the row, the store has the final record
            rows.delete(row.id);
            updateEmpty();
          }
          if (els.live) els.live.textContent = t('render.replyFinished');
          if (follow) scrollToBottom();
        },
      };
    },

    /** @param {string} id @param {{flash?: boolean}} [opts] */
    scrollToMessage(id, opts) {
      const row = rows.get(id);
      if (!row) return;
      follow = false;
      updateJump();
      row.node.scrollIntoView({ block: 'nearest' });
      if (opts && opts.flash) {
        row.node.classList.add('chat-flash');
        setTimeout(() => row.node.classList.remove('chat-flash'), 900);
      }
    },

    isStuck() { return follow; },

    /**
     * @param {Set<string>} ids
     *
     * DIFFED, not reapplied. app/context.mjs recomputes the trim on every draft keystroke (250 ms
     * debounce), every thread switch, every stream end and every farm snapshot whose `perf` moved —
     * and the trimmed set is nearly always the same one. Nulling `row.rev` unconditionally made the
     * next showPath re-run fill() — renderBody → parseBlocks of the whole text — for every message
     * in the thread, each time (P2 review). Only rows whose membership actually changed are dirtied.
     */
    setOutsideContext(ids) {
      const next = ids instanceof Set ? ids : new Set(ids || []);
      const before = outside;
      outside = next;
      for (const [id, row] of rows) {
        const on = next.has(id);
        if (on === before.has(id)) continue;
        row.node.classList.toggle('chat-outside', on);
        if (on) row.node.title = t('render.outsideContext'); else row.node.removeAttribute('title');
        row.rev = null;
      }
    },

    /** @param {string} id */
    rowOf(id) {
      const row = rows.get(id);
      return row ? row.node : null;
    },

    debug: {
      paintStats() {
        const xs = paints.slice().sort((a, b) => a - b);
        const at = (q) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);
        return { count: xs.length, p50: at(0.5), p95: at(0.95), max: xs.length ? xs[xs.length - 1] : 0 };
      },
      /** The one-shot render of `markdown`, decorated exactly like a finished message. */
      renderOneShot(markdown) {
        const host = div('chat-body');
        const sr = createStreamRenderer(H, host, optsFor(null));
        sr.finish(parseBlocks(String(markdown || '')));
        return host;
      },
      rows: () => [...rows.keys()],
      follow: () => ({ follow, atBottom, streaming }),
    },
  };

  // --------------------------------------------------------------------- slots this view provides

  app.registry.add(app.SLOTS.PART_RENDERERS, {
    type: 'text',
    render(part, msg) {
      const node = div('chat-part chat-part-text');
      node.appendChild(renderBlocks(parseBlocks(String((part && part.text) || '')), H, { citations: citationsFor(msg) }));
      return node;
    },
  });

  app.registry.add(app.SLOTS.MESSAGE_ACTIONS, {
    id: 'copy-message',
    order: 100,
    icon: COPY_ICON,
    label: t('render.copyMessage'),
    visible: (msg) => !!(msg && (msg.content || (msg.parts || []).some((p) => p.type === 'text'))),
    run: (msg) => {
      const text = msg.content || (msg.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n\n');
      return copyText(text);
    },
  });

  updateEmpty();
  updateJump();
  return api;
}
