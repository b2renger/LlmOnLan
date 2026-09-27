// @ts-check
/**
 * render/stream-dom.mjs - the streaming markdown DIFF (plan §3.8, P1-U3).
 *
 * `createStreamRenderer(H, container, opts)` turns the block parser's per-feed output
 * ({committed, newlyCommitted, open}) into the SMALLEST DOM change that gets the container to the
 * state `renderBlocks(blocks, H)` would have produced. It is pure with an injected `H`
 * (render/dom.mjs `domFactory`), so it runs unchanged under the unit runner's DOM shim - which is
 * what streamdom.test.mjs uses to prove the diff equals the one-shot render.
 *
 * The three invariants it exists to hold (§3.8):
 *  1. a COMMITTED block's nodes are created once and never touched again (node identity survives
 *     the whole stream, so scroll position, selection and the code chrome all survive);
 *  2. the OPEN block is PATCHED, never rebuilt: an open fence grows its ONE text node with
 *     `appendData`, an open list appends an `li`, an open table appends a `tr`, an open paragraph
 *     commits inline nodes up to `createInlineStream`'s last safe point and re-renders only the
 *     unsafe tail;
 *  3. `finish(blocks)` does the end-of-stream compare against the one-shot `parseBlocks()` and
 *     touches only the blocks that actually differ, returning whether it changed anything.
 *
 * Why a full re-check is cheap. Every leaf view remembers the exact STRING it rendered, and the
 * parser never rewrites a settled block's text - it builds a new string for the growing one. So
 * "did this block change?" is a `===` on two string references: O(1) for every settled block, and
 * O(tail) for the one that is growing. That is why `update()` and `finish()` can walk the whole
 * block tree instead of guessing which blocks might have moved.
 *
 * Why identity-compare works for containers: the parser pushes a NEW cells array per table row and
 * a NEW item object per list item (see md-block execute()), so `rows[i] === view.cells` is a sound
 * "this row is untouched" test, while `item.blocks` is mutated in place and is recursed into.
 *
 * The one shape that can SHRINK between feeds is the partial line: md-block applies it as an
 * undoable overlay, so a line that looked like fence CONTENT can come back as a fence CLOSE, which
 * the overlay skips entirely. Every view therefore treats "shorter than what I rendered" as
 * "rebuild my tail", and `finish()` re-syncs a fence's text node unconditionally.
 *
 * opts:
 *   citations   (n) => {url, title}|null   passed straight to render/dom.mjs (its truthiness also
 *                                          turns [n] parsing on, in BOTH parsers - they must agree)
 *   onBlockReady(node, block, {final})     called for a code block when its fence CLOSES, and for
 *                                          every code block at finish() with final:true. The caller
 *                                          (render/thread-view.mjs) runs CODE_DECORATORS from it
 *                                          and is responsible for not decorating the same node
 *                                          twice. The streaming tail never gets a call (§3.8).
 */

import { renderBlock, renderBlocks, renderInline } from './dom.mjs';
import { createInlineStream } from './md-inline.mjs';

/** Array copy of a node's children (a shim Array, a real NodeList, both). */
const kidsOf = (node) => Array.prototype.slice.call(node.childNodes);

/** Remove every child of `node` without touching any HTML sink. */
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** The language class dom.mjs puts on <code> - kept character-identical on purpose. */
const langClass = (lang) => (lang ? `language-${String(lang).replace(/[^a-z0-9+#.-]/gi, '')}` : null);

// ---------------------------------------------------------------------------------------------
// inline run: the inline half of an open paragraph / heading / tight list item / table cell
// ---------------------------------------------------------------------------------------------

/**
 * True when `next` still contains everything of `prev` from `from` on - i.e. the text only GREW.
 *
 * It is not enough to compare lengths. md-block caches the plan of a partial line and replays it
 * for the rest of that line (that is what keeps a long line O(new chars) per feed), so a line whose
 * CONTAINER PREFIX was still incomplete when the plan was cached is re-read at a different content
 * offset once the line finishes: "> Seat…" first renders as " Seat…" (the plan was cached on the
 * bare ">") and settles as "Seat…" one character to the left. That shift is invisible to a length
 * check, and an inline stream fed the shifted text keeps whatever it had already committed - which
 * is how a space ends up on the wrong side of a word. Comparing from the start of the CURRENT LINE
 * (everything before it is a completed line, and completed lines are permanent) catches it for the
 * cost of one native startsWith over that line.
 */
function grewFrom(next, prev, from) {
  if (prev.length <= from) return next.length >= prev.length;
  if (next.length < prev.length) return false;
  return next.startsWith(from ? prev.slice(from) : prev, from);
}

/**
 * Grows the inline content of `host` from a markdown string, committing nodes that can never
 * change and re-rendering only the unsafe tail.
 * @param {any} H @param {any} host @param {any} opts
 * @param {number} [keep] leading children of `host` this run must never touch (a task checkbox)
 */
function createInlineRun(H, host, opts, keep = 0) {
  const cite = !!(opts && opts.citations);
  let stream = createInlineStream({ citations: cite });
  let text = '';
  let lineAt = 0;                 // index after the last newline of `text`
  let done = 0;
  /** @type {any[]} */ let tail = [];

  const api = {
    get text() { return text; },
    reset() {
      stream = createInlineStream({ citations: cite });
      text = '';
      lineAt = 0;
      done = 0;
      tail = [];
      while (host.childNodes.length > keep) host.removeChild(host.lastChild);
    },
    /** @param {string} next @returns {boolean} changed */
    update(next) {
      if (next === text) return false;
      // A shrink (an overlay revert) or a shifted line offset: this block starts over.
      if (!grewFrom(next, text, lineAt)) api.reset();
      const r = stream.feed(next);
      for (const n of tail) if (n.parentNode) n.parentNode.removeChild(n);
      tail = [];
      if (r.committed.length > done) {
        host.appendChild(renderInline(r.committed.slice(done), H, opts));
        done = r.committed.length;
      }
      if (r.open.length) {
        const frag = renderInline(r.open, H, opts);
        tail = kidsOf(frag);
        host.appendChild(frag);
      }
      text = next;
      lineAt = next.lastIndexOf('\n') + 1;
      return true;
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------
// views - one per block. Each: {type, node, compatible?(block), update(block, final), kids()}
// ---------------------------------------------------------------------------------------------

/** @param {any} H @param {any} b @param {any} o @param {any} ctx */
function createView(H, b, o, ctx) {
  switch (b.type) {
    case 'paragraph': return paragraphView(H, b, o);
    case 'heading': return headingView(H, b, o);
    case 'code': return codeView(H, b, o, ctx);
    case 'list': return listView(H, b, o, ctx);
    case 'quote': return quoteView(H, b, o, ctx);
    case 'table': return tableView(H, b, o);
    default: return staticView(H, b, o);      // hr, and anything the grammar grows later
  }
}

/** A block that can never change once it exists (hr) - and the safe fallback for a new one. */
function staticView(H, b, o) {
  const node = renderBlock(b, H, o);
  return { type: b.type, node, update() { return false; }, kids() { return []; } };
}

function paragraphView(H, b, o) {
  const node = H.el('p');
  const run = createInlineRun(H, node, o);
  const view = {
    type: 'paragraph',
    node,
    update(/** @type {any} */ nb) { return run.update(nb.text); },
    kids() { return []; },
  };
  view.update(b);
  return view;
}

function headingView(H, b, o) {
  const level = Math.min(6, Math.max(1, b.level));
  const node = H.el(`h${level}`);
  const run = createInlineRun(H, node, o);
  const view = {
    type: 'heading',
    node,
    level,
    compatible(/** @type {any} */ nb) { return Math.min(6, Math.max(1, nb.level)) === level; },
    update(/** @type {any} */ nb) { return run.update(nb.text); },
    kids() { return []; },
  };
  view.update(b);
  return view;
}

function codeView(H, b, o, ctx) {
  const textNode = H.text(b.code);
  const codeEl = H.el('code', { class: langClass(b.lang) }, [textNode]);
  const node = H.el('figure', {
    class: 'chat-codeblock', 'data-lang': b.lang || '', 'data-closed': b.closed ? '1' : '0',
  }, [H.el('pre', { class: 'chat-code' }, [codeEl])]);

  const view = {
    type: 'code',
    node,
    code: b.code,
    lineAt: b.code.lastIndexOf('\n') + 1,
    lang: b.lang,
    closed: !!b.closed,
    block: b,
    compatible(/** @type {any} */ nb) { return nb.lang === view.lang; },
    /** @param {any} nb @param {boolean} [final] */
    update(nb, final) {
      let changed = false;
      view.block = nb;
      if (nb.code !== view.code) {
        // Growth is an append. A shrink (the overlay revert of a line that turned out to be the
        // fence CLOSE) or a shifted line offset (see grewFrom) rewrites the one text node.
        if (grewFrom(nb.code, view.code, view.lineAt) && textNode.length === view.code.length) {
          textNode.appendData(nb.code.slice(view.code.length));
        } else {
          textNode.data = nb.code;
        }
        view.code = nb.code;
        view.lineAt = nb.code.lastIndexOf('\n') + 1;
        changed = true;
      } else if (final && textNode.data !== nb.code) {
        textNode.data = nb.code;                    // belt and braces at the end of a stream
        changed = true;
      }
      if (!!nb.closed !== view.closed) {
        view.closed = !!nb.closed;
        node.setAttribute('data-closed', view.closed ? '1' : '0');
        changed = true;
        if (view.closed) ctx.ready(view, false);
      }
      return changed;
    },
    kids() { return []; },
  };
  if (view.closed) ctx.ready(view, false);
  return view;
}

function quoteView(H, b, o, ctx) {
  const node = H.el('blockquote');
  /** @type {any[]} */ const views = [];
  const view = {
    type: 'quote',
    node,
    update(/** @type {any} */ nb, /** @type {boolean} */ final) {
      return reconcile(H, node, views, nb.blocks || [], o, ctx, final);
    },
    kids() { return views; },
  };
  view.update(b, false);
  return view;
}

function tableView(H, b, o) {
  const align = b.align || [];
  const cell = (tag, text, i) => {
    const el = H.el(tag, align[i] ? { align: align[i] } : null);
    createInlineRun(H, el, o).update(text);
    return el;
  };
  const thead = H.el('thead', null, [H.el('tr', null, (b.header || []).map((c, i) => cell('th', c, i)))]);
  const tbody = H.el('tbody');
  const node = H.el('table', { class: 'chat-table' }, [thead, tbody]);

  /** @type {{cells: string[], node: any}[]} */ const rows = [];
  const buildRow = (cells) => H.el('tr', null, cells.map((c, i) => cell('td', c, i)));

  const view = {
    type: 'table',
    node,
    header: b.header,
    align: b.align,
    compatible(/** @type {any} */ nb) { return nb.header === view.header && nb.align === view.align; },
    update(/** @type {any} */ nb) {
      const want = nb.rows || [];
      let changed = false;
      while (rows.length > want.length) {
        const r = rows.pop();
        if (r && r.node.parentNode) r.node.parentNode.removeChild(r.node);
        changed = true;
      }
      for (let i = 0; i < want.length; i++) {
        const cells = want[i];
        const have = rows[i];
        if (!have) {
          const tr = buildRow(cells);
          tbody.appendChild(tr);
          rows.push({ cells, node: tr });
          changed = true;
        } else if (have.cells !== cells) {
          // A row's cells array is REPLACED by the parser, never mutated, so a different array is
          // a different row: rebuild just this <tr> (it is one line of text).
          const tr = buildRow(cells);
          tbody.replaceChild(tr, have.node);
          rows[i] = { cells, node: tr };
          changed = true;
        }
      }
      return changed;
    },
    kids() { return []; },
  };
  view.update(b);
  return view;
}

function listView(H, b, o, ctx) {
  const ordered = !!b.ordered;
  const start = b.start;
  const node = H.el(ordered ? 'ol' : 'ul', ordered && start && start !== 1 ? { start } : null);
  /** @type {any[]} */ const items = [];

  const view = {
    type: 'list',
    node,
    compatible(/** @type {any} */ nb) {
      return !!nb.ordered === ordered && (nb.start || 1) === (start || 1);
    },
    update(/** @type {any} */ nb, /** @type {boolean} */ final) {
      const want = nb.items || [];
      let changed = false;
      while (items.length > want.length) {
        const v = items.pop();
        if (v && v.node.parentNode) v.node.parentNode.removeChild(v.node);
        changed = true;
      }
      for (let i = 0; i < want.length; i++) {
        const item = want[i];
        const have = items[i];
        if (!have) {
          const iv = itemView(H, item, o, ctx);
          node.appendChild(iv.node);
          items.push(iv);
          changed = true;
        } else if (!have.compatible(item)) {
          const iv = itemView(H, item, o, ctx);
          node.replaceChild(iv.node, have.node);
          items[i] = iv;
          changed = true;
        } else if (have.update(item, final)) {
          changed = true;
        }
      }
      return changed;
    },
    kids() { return items; },
  };
  view.update(b, false);
  return view;
}

/** One <li>. "tight" = exactly one paragraph, rendered inline the way dom.mjs renderBlock does. */
function itemView(H, item, o, ctx) {
  const task = item.task === null || item.task === undefined ? null : !!item.task;
  const node = H.el('li', task === null ? null : { class: 'chat-taskitem' });
  if (task !== null) {
    node.appendChild(H.el('input', { type: 'checkbox', disabled: true, checked: task ? true : null, class: 'chat-task' }));
  }
  const keep = task === null ? 0 : 1;          // the task checkbox is never re-rendered
  /** @type {any} */ let run = null;
  /** @type {any[]} */ let views = [];
  /** @type {boolean|null} */ let tight = null;

  const view = {
    type: 'item',
    node,
    compatible(/** @type {any} */ nb) {
      const t = nb.task === null || nb.task === undefined ? null : !!nb.task;
      return t === task;
    },
    update(/** @type {any} */ nb, /** @type {boolean} */ final) {
      const blocks = nb.blocks || [];
      const wantTight = blocks.length === 1 && blocks[0].type === 'paragraph';
      let changed = false;
      if (wantTight !== tight) {
        // The item's shape changed (a tight item grew a second block, or the other way round):
        // drop everything after the task checkbox and start this item's content over.
        views = [];
        run = null;
        while (node.childNodes.length > keep) node.removeChild(node.lastChild);
        tight = wantTight;
        changed = true;
      }
      if (wantTight) {
        if (!run) run = createInlineRun(H, node, o, keep);
        if (run.update(blocks[0].text)) changed = true;
      } else if (reconcile(H, node, views, blocks, o, ctx, final)) {
        changed = true;
      }
      return changed;
    },
    kids() { return views; },
  };
  view.update(item, false);
  return view;
}

// ---------------------------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------------------------

/**
 * Bring `parent`'s children in line with `blocks`, reusing every view whose block is untouched.
 * @returns {boolean} whether anything in the DOM changed
 */
function reconcile(H, parent, views, blocks, o, ctx, final) {
  let changed = false;
  while (views.length > blocks.length) {
    const v = views.pop();
    if (v && v.node.parentNode) v.node.parentNode.removeChild(v.node);
    changed = true;
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const have = views[i];
    if (!have) {
      const v = createView(H, b, o, ctx);
      parent.appendChild(v.node);
      views.push(v);
      changed = true;
    } else if (have.type !== b.type || (have.compatible && !have.compatible(b))) {
      const v = createView(H, b, o, ctx);
      parent.replaceChild(v.node, have.node);
      views[i] = v;
      changed = true;
    } else if (have.update(b, final)) {
      changed = true;
    }
  }
  return changed;
}

/** Depth-first walk of a view tree. */
function visit(views, fn) {
  for (const v of views) {
    fn(v);
    const k = v.kids ? v.kids() : [];
    if (k && k.length) visit(k, fn);
  }
}

// ---------------------------------------------------------------------------------------------
// the renderer
// ---------------------------------------------------------------------------------------------

/**
 * @param {any} H a render/dom.mjs domFactory
 * @param {any} container the element that owns the rendered markdown (nothing else lives in it)
 * @param {{citations?: any, onBlockReady?: (node: any, block: any, info: {final: boolean}) => void}} [opts]
 */
export function createStreamRenderer(H, container, opts) {
  const o = opts || {};
  /** @type {any[]} */ const views = [];
  const debug = { updates: 0, finishes: 0, swaps: 0 };

  const ctx = {
    /** @param {any} view @param {boolean} final */
    ready(view, final) {
      if (typeof o.onBlockReady === 'function') o.onBlockReady(view.node, view.block, { final });
    },
  };

  /** @param {{committed: any[], newlyCommitted?: any[], open: any}} state */
  function update(state) {
    debug.updates++;
    const committed = (state && state.committed) || [];
    const open = state ? state.open : null;
    const blocks = open ? committed.concat([open]) : committed;
    return reconcile(H, container, views, blocks, o, ctx, false);
  }

  /**
   * End of stream: compare against the one-shot parse and change only what differs.
   * @param {any[]} blocks @returns {boolean} whether the DOM was swapped
   */
  function finish(blocks) {
    debug.finishes++;
    const changed = reconcile(H, container, views, blocks || [], o, ctx, true);
    if (changed) debug.swaps++;
    visit(views, (v) => { if (v.type === 'code') ctx.ready(v, true); });
    return changed;
  }

  /** Throw the incremental state away and render `blocks` in one shot (a hard resync). */
  function replaceAll(blocks) {
    views.length = 0;
    clear(container);
    container.appendChild(renderBlocks(blocks || [], H, o));
    return true;
  }

  return { update, finish, replaceAll, debug };
}
