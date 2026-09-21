// @ts-check
/**
 * render/md-block.mjs - the restricted-grammar block parser (plan section 3.8). PURE module: it
 * touches no window / document / localStorage / indexedDB, at import time or in any export.
 *
 * Grammar (exactly section 3.8):
 *  - a blank line outside a fence ends EVERY open block (no loose lists, no lazy continuation);
 *  - "1. a", blank, "2. b" is two ordered lists, the second with start = 2;
 *  - a list item continues on lines indented to its content column; a fence indented to that column
 *    belongs to the item, and blank lines inside that fence do not end the list (fence state wins);
 *  - a table starts only when a pipe row is followed by a delimiter row;
 *  - ATX headings and --- / *** / ___ hr are single-line blocks;
 *  - raw HTML is text; there are no setext headings and no indented code blocks.
 *
 * FOUR documented refinements, each a deterministic function of the LINE alone, so the streaming
 * parser and the one-shot parseBlocks can never disagree:
 *  - an hr / table-delimiter candidate line longer than HR_LIMIT (256) chars is a paragraph line;
 *  - a run of MORE than HR_LIMIT fence characters is a paragraph line too, opener and closer alike
 *    (added at the P0 fix round: uncapped, one repeated backtick cost 2,500x the line per feed);
 *  - a fence info string is capped at INFO_MAX (120) chars;
 *  - "===" is only ever a paragraph line (it is a setext underline in CommonMark, and we have
 *    none); "---" after a paragraph is an hr, since no setext heading can claim it.
 *
 * A fence records its own indentation and its content lines are de-indented by it, the way
 * CommonMark does - deterministic per line, so the two parsers still agree.
 *
 * Streaming. feed(fullText) takes the CUMULATIVE text. Complete lines mutate the parser
 * permanently; the PARTIAL line is applied as an undoable OVERLAY that never commits anything and
 * is reverted at the start of the next feed. Consequence: a block reported in `committed` is
 * deep-equal for the rest of the stream, and end() deep-equals parseBlocks().
 *
 * Work. debug.scanned counts characters actually inspected - including the ones rowScan() inspects,
 * which it bills itself. Per feed it is newChars + O(1) per completed line + O(1) for the partial
 * line, except while the partial line is still structurally ambiguous (a run of - * _ backtick ~ or
 * digits, or a table-delimiter candidate), which is bounded by HR_LIMIT. The open TABLE ROW is the
 * one shape that needs state to stay inside that bound: splitting it from scratch on every feed is
 * O(row^2) AND was invisible to the counter, so the split is resumable (rowScan/rowCells).
 */

/** @typedef {{type:'heading', level:number, text:string}} HeadingBlock */
/** @typedef {{type:'paragraph', text:string}} ParagraphBlock */
/** @typedef {{type:'code', lang:string, code:string, fence:string, closed:boolean}} CodeBlock */
/** @typedef {{type:'hr'}} HrBlock */
/** @typedef {{task:boolean|null, blocks:Block[]}} ListItem */
/** @typedef {{type:'list', ordered:boolean, start:number, items:ListItem[]}} ListBlock */
/** @typedef {{type:'quote', blocks:Block[]}} QuoteBlock */
/** @typedef {{type:'table', align:(('left'|'center'|'right')|null)[], header:string[], rows:string[][]}} TableBlock */
/** @typedef {HeadingBlock|ParagraphBlock|CodeBlock|HrBlock|ListBlock|QuoteBlock|TableBlock} Block */

const TAB = 4;
const HR_LIMIT = 256;
const INFO_MAX = 120;

const isWS = (/** @type {string} */ c) => c === ' ' || c === '\t';
/** Exactly the set String.prototype.trim() removes - the incremental row splitter must agree with splitCells. */
const isTrimWS = (/** @type {string} */ c) => /\s/.test(c);
const isDigit = (/** @type {string} */ c) => c >= '0' && c <= '9';

/** Split a table row on unescaped pipes, dropping one leading and one trailing empty cell. */
export function splitCells(/** @type {string} */ row) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '\\' && row[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  if (cells.length > 1 && cells[0].trim() === '') cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((s) => s.trim());
}

/**
 * 3+ of one of - _ * (spaces allowed). `ok` is that char (or null when the line is not an hr);
 * `possible` says the line could still grow into one; `ins` is the characters inspected.
 */
function hrScan(/** @type {string} */ line, /** @type {number} */ from) {
  const L = Math.min(line.length, from + HR_LIMIT + 1);
  if (line.length - from > HR_LIMIT) return { ok: null, possible: false, ins: 1 };
  let ch = null, count = 0, i = from;
  for (; i < L; i++) {
    const c = line[i];
    if (isWS(c)) continue;
    if ((c !== '-' && c !== '_' && c !== '*') || (ch !== null && c !== ch)) {
      return { ok: null, possible: false, ins: i - from + 1 };
    }
    ch = c;
    count++;
  }
  return { ok: count >= 3 ? ch : null, possible: true, ins: i - from };
}

/** Could this partial line still become a table delimiter row? */
function delimScan(/** @type {string} */ line, /** @type {number} */ from) {
  if (line.length - from > HR_LIMIT) return { possible: false, ins: 1 };
  let i = from;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c !== '|' && c !== '-' && c !== ':' && !isWS(c)) return { possible: false, ins: i - from + 1 };
  }
  return { possible: true, ins: i - from };
}

/** A delimiter row -> per-column alignment, else null. */
function delimAlign(/** @type {string} */ row) {
  if (row.length > HR_LIMIT) return null;
  const cells = splitCells(row);
  if (!cells.length) return null;
  const align = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(':'), right = cell.endsWith(':');
    align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return /** @type {(('left'|'center'|'right')|null)[]} */ (align);
}

/** A bullet / ordered list marker at j (visual column col). */
function matchMarker(/** @type {string} */ line, /** @type {number} */ j, /** @type {number} */ col) {
  const L = line.length;
  const c = line[j];
  let ordered = false, start = 1, marker = c, k = j;
  if (c === '-' || c === '+' || c === '*') {
    k = j + 1;
  } else if (isDigit(c)) {
    let d = j;
    while (d < L && isDigit(line[d]) && d - j < 9) d++;
    if (d >= L || (line[d] !== '.' && line[d] !== ')')) return null;
    ordered = true;
    start = parseInt(line.slice(j, d), 10);
    marker = line[d];
    k = d + 1;
  } else {
    return null;
  }
  if (k < L && !isWS(line[k])) return null;
  const afterMarker = col + (k - j);
  if (k >= L) return { ordered, start, marker, contentStart: k, contentCol: afterMarker + 1, eol: true };
  let s = k, cc = afterMarker, n = 0;
  while (s < L && isWS(line[s]) && n < 4) { cc += line[s] === '\t' ? TAB - (cc % TAB) : 1; s++; n++; }
  if (n >= 4 || s >= L) { s = k + 1; cc = afterMarker + 1; }
  return { ordered, start, marker, contentStart: s, contentCol: cc, eol: false };
}

/** "[ ]" / "[x]" + space at the start of an item's content. */
function matchTask(/** @type {string} */ line, /** @type {number} */ i) {
  if (line[i] !== '[' || line[i + 2] !== ']') return null;
  const c = line[i + 1];
  const on = c === 'x' || c === 'X';
  if (c !== ' ' && !on) return null;
  if (i + 3 < line.length && !isWS(line[i + 3])) return null;
  let s = i + 3;
  while (s < line.length && isWS(line[s])) s++;
  return { checked: on, contentStart: s };
}

class StreamParser {
  constructor() {
    /** @type {Block[]} */ this.doc = [];
    /** @type {Block[]} */ this.committedArr = [];
    /** @type {any[]} */ this.containers = [];
    /** @type {any} */ this.leaf = null;
    /** @type {any} */ this.li = null;
    /** @type {any} */ this.openTop = null;
    this.len = 0;
    this.lineStart = 0;
    this.overlay = false;
    /** @type {any[]} */ this.undo = [];
    /** @type {any} */ this.snap = null;
    /** @type {Block[]} */ this.newly = [];
    this.pending = '';
    /** @type {any} */ this.planCache = null;
    /** @type {any} */ this.rowState = null;
    this.rowComplete = false;
    this.debug = { scanned: 0 };
  }

  // ---- mutation helpers (undoable while an overlay is applied) -------------------------------
  mset(/** @type {any} */ o, /** @type {string} */ k, /** @type {any} */ v) {
    if (this.overlay) this.undo.push({ o, k, v: o[k] });
    o[k] = v;
  }

  mpush(/** @type {any[]} */ a, /** @type {any} */ v) {
    if (this.overlay) this.undo.push({ a, n: a.length });
    a.push(v);
  }

  mpop(/** @type {any[]} */ a) {
    if (this.overlay) this.undo.push({ a, n: a.length - 1, restore: a[a.length - 1] });
    return a.pop();
  }

  blocksHere() {
    const c = this.containers[this.containers.length - 1];
    if (!c) return this.doc;
    if (c.kind === 'quote') return c.block.blocks;
    if (c.kind === 'item') return c.item.blocks;
    return this.doc;
  }

  addBlock(/** @type {any} */ b) {
    this.mpush(this.blocksHere(), b);
    if (!this.containers.length) this.openTop = b;
    return b;
  }

  maybeCommit() {
    if (this.overlay) return;
    if (!this.leaf && !this.containers.length && this.openTop) {
      this.committedArr.push(this.openTop);
      this.newly.push(this.openTop);
      this.openTop = null;
    }
  }

  closeLeaf() {
    this.leaf = null;
    this.li = null;
  }

  closeTo(/** @type {number} */ depth, /** @type {boolean} */ closeLeaf) {
    if (closeLeaf || depth < this.containers.length) this.closeLeaf();
    while (this.containers.length > depth) this.containers.pop();
    this.maybeCommit();
  }

  fenceOpen() {
    return !!(this.leaf && this.leaf.type === 'code' && this.li && this.li.kind === 'fence' && !this.leaf.closed);
  }

  /**
   * Split the OPEN table row incrementally. A cell boundary before the last pipe cannot move as the
   * line grows, so the scan is RESUMED rather than redone - `splitCells(line.slice(from))` on every
   * feed is O(row^2), and (being uncounted) it used to hide that cost from debug.scanned entirely.
   * The characters this call actually inspects are added to debug.scanned right here, so the number
   * stays honest no matter who calls it (analyze, or execute replaying a cached plan).
   * @returns {{pipe: number}} `pipe` is the offset of the first unescaped pipe, or -1.
   */
  rowScan(/** @type {string} */ line, /** @type {number} */ from, /** @type {boolean} */ complete) {
    let r = this.rowState;
    if (!r || r.from !== from || r.pos > line.length) {
      r = this.rowState = { from, pos: from, pipe: -1, done: [], cur: '', tail: 0 };
    }
    const start = r.pos;
    const L = line.length;
    let i = r.pos;
    while (i < L) {
      const c = line[i];
      if (c === '\\') {
        if (i + 1 >= L) {
          // the character the escape applies to has not arrived yet: hold, unless this is the end
          if (!complete) break;
        } else if (line[i + 1] === '|') {
          if (r.cur === '' ) { r.cur = '|'; } else { r.cur += '|'; }
          r.tail = 0; i += 2; continue;
        }
      }
      if (c === '|') {
        if (r.pipe < 0) r.pipe = i;
        r.done.push(r.tail ? r.cur.slice(0, r.cur.length - r.tail) : r.cur);
        r.cur = ''; r.tail = 0; i++; continue;
      }
      if (r.cur === '' && isTrimWS(c)) { i++; continue; }          // leading whitespace of a cell
      r.cur += c;
      r.tail = isTrimWS(c) ? r.tail + 1 : 0;
      i++;
    }
    r.pos = i;
    this.debug.scanned += i - start;
    return { pipe: r.pipe };
  }

  /** The finished cell list of the open row - deep-equal to splitCells(line.slice(from)). */
  rowCells(/** @type {string} */ line, /** @type {number} */ from, /** @type {boolean} */ complete) {
    this.rowScan(line, from, complete);
    const r = this.rowState;
    const cells = r.done.concat([r.tail ? r.cur.slice(0, r.cur.length - r.tail) : r.cur]);
    if (cells.length > 1 && cells[0] === '') cells.shift();
    if (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
    return cells;
  }

  // ---- the line planner ----------------------------------------------------------------------
  /**
   * Decide what a line does, without touching state.
   * @param {string} line
   * @param {boolean} complete false while the line is still growing (the overlay)
   * @returns {any}
   */
  analyze(line, complete) {
    const L = line.length;
    const cont = this.containers;
    let ins = 0;

    let b = 0;
    while (b < L && isWS(line[b])) b++;
    ins += Math.min(b + 1, L + 1);
    const blank = b >= L;

    if (blank && this.fenceOpen()) {
      return { inspected: ins, keepDepth: cont.length, closeLeaf: false, opens: [], leaf: { kind: 'code', start: L } };
    }
    if (blank) return { inspected: ins, blank: true, keepDepth: 0, closeLeaf: true, opens: [], leaf: null };

    // 1. match the existing container prefixes
    let i = 0, col = 0, k = 0;
    for (; k < cont.length; k++) {
      const c = cont[k];
      if (c.kind === 'list') continue;
      if (c.kind === 'quote') {
        let j = i, cc = col, sp = 0;
        while (j < L && line[j] === ' ' && sp < 3) { j++; cc++; sp++; ins++; }
        if (line[j] === '>') {
          i = j + 1; col = cc + 1; ins++;
          if (line[i] === ' ') { i++; col++; ins++; }
          continue;
        }
        break;
      }
      let j = i, cc = col;
      while (j < L && cc < c.contentCol && isWS(line[j])) {
        cc += line[j] === '\t' ? TAB - (cc % TAB) : 1; j++; ins++;
      }
      if (cc >= c.contentCol) { i = j; col = cc; continue; }
      break;
    }

    // 2. an open fence swallows everything while its containers match
    if (this.fenceOpen()) {
      if (k === cont.length) {
        const close = this.matchFenceClose(line, i, complete);
        ins += close.inspected;
        if (close.pending) return { inspected: ins, pending: true };
        if (close.hit) return { inspected: ins, keepDepth: cont.length, closeLeaf: false, opens: [], leaf: { kind: 'fenceClose' } };
        return { inspected: ins, keepDepth: cont.length, closeLeaf: false, opens: [], leaf: { kind: 'code', start: i } };
      }
      return { inspected: ins, breakFence: true, keepDepth: k, closeLeaf: true, opens: [], leaf: null };
    }

    // 3. new containers (quotes, list items), then the leaf
    let keepDepth = k;
    let closeLeaf = k < cont.length;
    /** @type {any[]} */ const opens = [];
    let joinedList = false;
    // How far the leaf is indented past the innermost container's content column (0..3 - a 4th
    // space stops the loop below, so the line is never a fence). A fence carries this on, so its
    // content lines can be de-indented by the same amount, the way CommonMark does.
    let leadCols = 0;
    // A 'list' container only survives while one of its items is open: a line that is not a
    // sibling item closes the list too, even though the list itself consumes no prefix.
    const settle = () => {
      if (joinedList) return;
      while (keepDepth > 0 && cont[keepDepth - 1].kind === 'list') keepDepth--;
    };

    for (;;) {
      let j = i, cc = col, sp = 0;
      while (j < L && isWS(line[j]) && sp < 3) { cc += line[j] === '\t' ? TAB - (cc % TAB) : 1; j++; sp++; ins++; }
      leadCols = cc - col;
      if (j >= L) { i = j; col = cc; break; }
      const c = line[j];
      ins++;

      if (c === '>') {
        opens.push({ kind: 'quote' });
        closeLeaf = true;
        i = j + 1; col = cc + 1;
        if (line[i] === ' ') { i++; col++; ins++; }
        continue;
      }

      // hr outranks a list marker ("- - -" is an hr, not three items)
      if (c === '-' || c === '_' || c === '*') {
        const hr = hrScan(line, j);
        ins += hr.ins;
        if (!complete) {
          if (hr.possible) return { inspected: ins, pending: true };
        } else if (hr.ok) {
          settle();
          return { inspected: ins, keepDepth, closeLeaf: true, opens, leaf: { kind: 'hr' } };
        }
      }

      const m = (c === '-' || c === '+' || c === '*' || isDigit(c)) ? matchMarker(line, j, cc) : null;
      if (m) {
        if (!complete && m.eol) return { inspected: ins, pending: true };
        ins += m.contentStart - j;
        let d = keepDepth, joined = false;
        // only a line that has opened nothing yet can continue an existing list
        while (!opens.length && d > 0 && cont[d - 1].kind === 'list') {
          const list = cont[d - 1];
          if (list.ordered === m.ordered && list.marker === m.marker && cc >= list.markerCol) {
            keepDepth = d; joined = true; joinedList = true; break;
          }
          d--;
        }
        if (!joined) {
          if (!opens.length) while (d > 0 && cont[d - 1].kind === 'list') d--;
          keepDepth = d;
          opens.push({ kind: 'list', ordered: m.ordered, start: m.start, marker: m.marker, markerCol: cc });
        }
        closeLeaf = true;
        const task = matchTask(line, m.contentStart);
        if (task) ins += 4;
        const shift = task ? task.contentStart - m.contentStart : 0;
        opens.push({ kind: 'item', contentCol: m.contentCol + shift, task: task ? task.checked : null });
        i = task ? task.contentStart : m.contentStart;
        col = m.contentCol + shift;
        continue;
      }
      i = j; col = cc;
      break;
    }
    settle();
    if (keepDepth < k) closeLeaf = true;

    const openLeaf = (closeLeaf || opens.length) ? null : this.leaf;
    // a paragraph's content starts at the first non-space (there are no indented code blocks)
    const paraStart = (/** @type {number} */ from) => {
      let x = from;
      while (x < L && isWS(line[x])) { x++; ins++; }
      return x;
    };

    // fence start
    const fc = line[i];
    if (fc === '`' || fc === '~') {
      // A FOURTH refinement (P0 fix round), the same shape as the hr one: a run of more than
      // HR_LIMIT fence characters is ordinary paragraph text, never a fence. Without the cap every
      // feed re-counted the whole run, so one repeated backtick blew the work budget by 2,500x.
      let n = 0;
      while (line[i + n] === fc && n <= HR_LIMIT) n++;
      ins += n;
      if (n > HR_LIMIT) {
        // fall through to the paragraph leaf below - and, being a 'para' plan, the overlay caches it
      } else if (n >= 3) {
        const info = line.slice(i + n, i + n + INFO_MAX).trim();
        if (!(fc === '`' && info.indexOf('`') >= 0)) {
          const sp = info.search(/\s/);
          const lang = (sp >= 0 ? info.slice(0, sp) : info).toLowerCase();
          ins += Math.min(L - i - n, INFO_MAX);
          return { inspected: ins, keepDepth, closeLeaf: true, opens, leaf: { kind: 'fence', ch: fc, n, lang, indent: leadCols } };
        }
      } else if (!complete && i + n >= L) {
        return { inspected: ins, pending: true };
      }
    }

    // ATX heading
    if (line[i] === '#') {
      let n = 0;
      while (line[i + n] === '#' && n < 7) n++;
      ins += n + 1;
      if (n <= 6 && (i + n >= L || isWS(line[i + n]))) {
        if (!complete && i + n >= L) return { inspected: ins, pending: true };
        let text = line.slice(i + n).trim();
        const m2 = /(^|[ \t])#+$/.exec(text);
        if (m2) text = text.slice(0, m2.index).trim();
        return { inspected: ins, keepDepth, closeLeaf: true, opens, leaf: { kind: 'heading', level: n, text } };
      }
    }

    // a table delimiter row, right under a pipe row of the open paragraph
    if (!opens.length && !closeLeaf && openLeaf && openLeaf.type === 'paragraph') {
      const c0 = line[i];
      if (c0 === '|' || c0 === '-' || c0 === ':') {
        const dl = delimScan(line, i);
        ins += dl.ins;
        if (!complete) {
          if (dl.possible) return { inspected: ins, pending: true };
        } else {
          const align = dl.possible ? delimAlign(line.slice(i)) : null;
          if (align) {
            const text = openLeaf.text;
            const nl = text.lastIndexOf('\n');
            const headerLine = nl < 0 ? text : text.slice(nl + 1);
            ins += Math.min(headerLine.length, HR_LIMIT);
            if (headerLine.indexOf('|') >= 0) {
              const header = splitCells(headerLine);
              if (header.length === align.length) {
                return {
                  inspected: ins, keepDepth, closeLeaf: false, opens,
                  leaf: { kind: 'delim', align, header, keepText: nl < 0 ? null : text.slice(0, nl) },
                };
              }
            }
          }
        }
      }
    }

    // a row of the open table
    if (!opens.length && !closeLeaf && openLeaf && openLeaf.type === 'table') {
      // rowScan bills its own characters to debug.scanned (it is resumable, so `ins` - which is
      // recomputed on every call - cannot express what it did).
      const row = this.rowScan(line, i, complete);
      if (row.pipe < 0) {
        if (!complete) return { inspected: ins, pending: true };
        return { inspected: ins, keepDepth, closeLeaf: true, opens, leaf: { kind: 'para', start: paraStart(i) } };
      }
      return { inspected: ins, keepDepth, closeLeaf: false, opens, leaf: { kind: 'row', start: i } };
    }

    return {
      inspected: ins, keepDepth, opens,
      closeLeaf: closeLeaf || !(openLeaf && openLeaf.type === 'paragraph'),
      leaf: { kind: 'para', start: paraStart(i) },
    };
  }

  /**
   * Skip up to `cols` columns of leading whitespace in `line` at `from` (tab stops as elsewhere).
   * A tab that would be split is kept whole, which is CommonMark's rule too.
   */
  deIndent(/** @type {string} */ line, /** @type {number} */ from, /** @type {number} */ cols) {
    let x = from, left = cols, col = 0;
    while (left > 0 && x < line.length && isWS(line[x])) {
      const w = line[x] === '\t' ? TAB - (col % TAB) : 1;
      if (w > left) break;
      col += w; left -= w; x++;
    }
    return x;
  }

  /** Is the line (from i) the closing fence of the open code block? */
  matchFenceClose(/** @type {string} */ line, /** @type {number} */ i, /** @type {boolean} */ complete) {
    const L = line.length;
    const ch = this.li.ch;
    let j = i, sp = 0, ins = 0;
    while (j < L && line[j] === ' ' && sp < 3) { j++; sp++; ins++; }
    let n = 0;
    while (line[j + n] === ch && n <= HR_LIMIT) n++;
    ins += n + 1;
    if (n === 0) return { hit: false, pending: false, inspected: ins };
    // Same cap as the opener: a run this long is content, never a closing fence. Deterministic per
    // line, so the stream and parseBlocks still agree, and the 'code' plan stays cacheable.
    if (n > HR_LIMIT) return { hit: false, pending: false, inspected: ins };
    let e = j + n;
    while (e < L && isWS(line[e])) { e++; ins++; }
    const clean = e >= L;
    if (!complete) {
      // hold a line that is still nothing but fence characters out of the code text, so the open
      // block's text stays append-only.
      return { hit: false, pending: clean, inspected: ins };
    }
    return { hit: clean && n >= this.li.n, pending: false, inspected: ins };
  }

  // ---- execution -----------------------------------------------------------------------------
  /** @param {any} plan @param {string} line */
  execute(plan, line) {
    if (plan.blank) { this.closeTo(0, true); return; }
    this.closeTo(plan.keepDepth, plan.closeLeaf);

    for (const o of plan.opens) {
      if (o.kind === 'quote') {
        const block = { type: 'quote', blocks: [] };
        this.addBlock(block);
        this.containers.push({ kind: 'quote', block });
      } else if (o.kind === 'list') {
        const block = { type: 'list', ordered: o.ordered, start: o.start, items: [] };
        this.addBlock(block);
        this.containers.push({ kind: 'list', block, ordered: o.ordered, marker: o.marker, markerCol: o.markerCol });
      } else {
        const listC = this.containers[this.containers.length - 1];
        const item = { task: o.task, blocks: [] };
        this.mpush(listC.block.items, item);
        this.containers.push({ kind: 'item', list: listC.block, item, contentCol: o.contentCol });
      }
    }

    const lf = plan.leaf;
    if (!lf) { this.maybeCommit(); return; }
    switch (lf.kind) {
      case 'para': {
        const add = line.slice(lf.start);
        if (this.leaf && this.leaf.type === 'paragraph') {
          this.mset(this.leaf, 'text', this.leaf.text + '\n' + add);
        } else {
          const block = { type: 'paragraph', text: add };
          this.addBlock(block);
          this.leaf = block;
          this.li = { kind: 'para' };
        }
        break;
      }
      case 'heading':
        this.addBlock({ type: 'heading', level: lf.level, text: lf.text });
        break;
      case 'hr':
        this.addBlock({ type: 'hr' });
        break;
      case 'fence': {
        const block = { type: 'code', lang: lf.lang, code: '', fence: lf.ch, closed: false };
        this.addBlock(block);
        this.leaf = block;
        this.li = { kind: 'fence', ch: lf.ch, n: lf.n, lines: 0, indent: lf.indent || 0 };
        break;
      }
      case 'code': {
        // CommonMark strips up to the opener's own indentation from each content line. Without this
        // a fence that re-opens at top level still indented to a CLOSED list item's content column
        // (the "1. step", blank line, indented ``` shape models produce constantly) kept those
        // spaces in the code - and in whatever the copy button would put on the clipboard.
        const add = line.slice(this.deIndent(line, lf.start, this.li.indent || 0));
        this.mset(this.leaf, 'code', this.li.lines ? this.leaf.code + '\n' + add : add);
        this.mset(this.li, 'lines', this.li.lines + 1);
        break;
      }
      case 'fenceClose':
        this.mset(this.leaf, 'closed', true);
        this.closeLeaf();
        break;
      case 'delim': {
        const para = this.leaf;
        const arr = this.blocksHere();
        if (lf.keepText === null) {
          this.mpop(arr);
          if (this.openTop === para) this.openTop = null;
        } else {
          this.mset(para, 'text', lf.keepText);
        }
        this.closeLeaf();
        // the paragraph above the header row is finished: commit it before the table opens, or it
        // would never reach `committed` at all.
        this.maybeCommit();
        const block = { type: 'table', align: lf.align, header: lf.header, rows: [] };
        this.addBlock(block);
        this.leaf = block;
        this.li = { kind: 'table' };
        break;
      }
      case 'row': {
        const n = this.leaf.header.length;
        const cells = this.rowCells(line, lf.start, this.rowComplete).slice(0, n);
        while (cells.length < n) cells.push('');
        this.mpush(this.leaf.rows, cells);
        break;
      }
      default:
        break;
    }
    this.maybeCommit();
  }

  /** @param {string} line @param {boolean} complete */
  applyLine(line, complete) {
    this.rowComplete = complete;
    let plan = this.analyze(line, complete);
    this.debug.scanned += plan.inspected;
    if (plan.pending) return false;
    if (plan.breakFence) {
      // the containers holding the fence broke: close down to them, then re-read the line
      this.closeTo(plan.keepDepth, true);
      plan = this.analyze(line, complete);
      this.debug.scanned += plan.inspected;
      if (plan.pending) return false;
    }
    this.execute(plan, line);
    return true;
  }

  // ---- overlay (the partial line) --------------------------------------------------------------
  revert() {
    if (!this.snap) return;
    for (let k = this.undo.length - 1; k >= 0; k--) {
      const u = this.undo[k];
      if (u.a) { u.a.length = u.n; if ('restore' in u) u.a.push(u.restore); }
      else u.o[u.k] = u.v;
    }
    this.undo.length = 0;
    this.containers.length = this.snap.containers;
    this.leaf = this.snap.leaf;
    this.li = this.snap.li;
    this.openTop = this.snap.openTop;
    this.snap = null;
  }

  /** @param {string} line */
  applyOverlay(line) {
    // A plan whose structure cannot change as the line grows is reused on the next feed, so a long
    // line costs O(new chars) rather than O(line) per feed. Invalidated when the line completes.
    this.rowComplete = false;
    if (this.planCache) {
      if (this.planCache.skip) return;
      this.snap = { containers: this.containers.length, leaf: this.leaf, li: this.li, openTop: this.openTop };
      this.overlay = true;
      try { this.execute(this.planCache.plan, line); } finally { this.overlay = false; }
      return;
    }
    const plan = this.analyze(line, false);
    this.debug.scanned += plan.inspected;
    // A plan for a paragraph or fence-content line cannot change shape as the line grows, so its
    // verdict - applied or skipped - is cached for the rest of the line.
    const stable = !!plan.leaf && (plan.leaf.kind === 'para' || plan.leaf.kind === 'code' || plan.leaf.kind === 'row');
    const skip = (
      plan.pending || plan.blank || plan.breakFence
      // an incomplete line never closes, commits or re-shapes anything already open
      || (plan.closeLeaf && !!this.leaf)
      || plan.keepDepth < this.containers.length
      || (!!this.leaf && plan.opens.length > 0)
      || (!!plan.leaf && (plan.leaf.kind === 'fenceClose' || plan.leaf.kind === 'delim' || plan.leaf.kind === 'hr'))
    );
    if (stable) this.planCache = { plan, skip };
    if (skip) return;
    this.snap = { containers: this.containers.length, leaf: this.leaf, li: this.li, openTop: this.openTop };
    this.overlay = true;
    try { this.execute(plan, line); } finally { this.overlay = false; }
  }

  // ---- public API -------------------------------------------------------------------------------
  /**
   * @param {string} full the CUMULATIVE text so far
   * @returns {{committed: Block[], newlyCommitted: Block[], open: Block|null}}
   */
  feed(full) {
    this.revert();
    if (full.length < this.len) throw new Error('md-block: feed() text shrank');
    this.debug.scanned += full.length - this.len;
    this.newly = [];
    let search = Math.max(this.lineStart, this.len);
    for (;;) {
      const nl = full.indexOf('\n', search);
      if (nl < 0) break;
      let line = full.slice(this.lineStart, nl);
      if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
      this.applyLine(line, true);
      this.planCache = null;
      this.rowState = null;
      this.lineStart = nl + 1;
      search = this.lineStart;
    }
    this.len = full.length;
    let partial = '';
    if (this.lineStart < this.len) {
      partial = full.slice(this.lineStart);
      if (partial.charCodeAt(partial.length - 1) === 13) partial = partial.slice(0, -1);
    }
    this.pending = partial;
    if (partial) this.applyOverlay(partial);
    return { committed: this.committedArr, newlyCommitted: this.newly, open: this.openTop };
  }

  /**
   * Finish the stream. `full` (optional) is fed first, so parseBlocks is feed(t); end(t).
   * @param {string} [full]
   * @returns {Block[]}
   */
  end(full) {
    if (full !== undefined) this.feed(full);
    this.revert();
    this.newly = [];
    this.planCache = null;
    if (this.lineStart < this.len) {
      this.applyLine(this.pending, true);
      this.lineStart = this.len;
      this.pending = '';
    }
    this.closeTo(0, true);
    return this.doc;
  }
}

export function createStreamParser() {
  return new StreamParser();
}

/**
 * One-shot parse, implemented ON TOP of the stream parser so the two cannot drift.
 * @param {string} text
 * @returns {Block[]}
 */
export function parseBlocks(text) {
  const p = new StreamParser();
  p.feed(text);
  return p.end(text);
}
