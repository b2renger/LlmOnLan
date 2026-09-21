// @ts-check
/**
 * render/md-inline.mjs - inline tokens for the restricted grammar (plan section 3.8). PURE module:
 * no window / document / localStorage / indexedDB, at import time or in any export.
 *
 * Supported: code spans, ** / __ strong, * / _ em (an intraword _ stays literal), ~~ del,
 * [text](url), <https://...> autolinks, bare https:// and http:// autolinks, backslash escapes,
 * hard breaks (two trailing spaces or a trailing backslash) and, only with opts.citations, a
 * bare [n] citation marker.
 *
 * Invariants:
 *  - an opener whose closer is more than CAP (2,000) characters away is LITERAL, and so is an
 *    unclosed one - this is what bounds inline re-scanning in the streaming renderer;
 *  - a run of more than TICK_MAX (32) backticks never opens a code span: it is literal text,
 *    consumed in one step (P0 fix round - see the constant);
 *  - every delimiter-run counter is either capped or only reached on a path that then steps over
 *    the whole run, so no position of a run can re-count that run;
 *  - only http: and https: ever become links here; every other scheme stays text (render/dom.mjs
 *    enforces the same rule a second time, on the href).
 *
 * createInlineStream().feed(text) re-parses only the text after the last SAFE offset, so the inlines
 * it has already committed never change on a later feed. A safe offset is the start of a top-level
 * whitespace run with nothing open, OR the end of a SETTLED top-level node (see emit) - the second
 * rule is what lets a delimiter run, which holds no whitespace at all, commit anything.
 * `debug.scanned` counts the characters handed to tokenize(), summed over feeds.
 */

/** @typedef {{type:'text', text:string}} TextInline */
/** @typedef {{type:'code', text:string}} CodeInline */
/** @typedef {{type:'strong'|'em'|'del', children:Inline[]}} SpanInline */
/** @typedef {{type:'link', href:string, auto:boolean, children:Inline[]}} LinkInline */
/** @typedef {{type:'image', src:string, alt:string}} ImageInline */
/** @typedef {{type:'cite', n:number}} CiteInline */
/** @typedef {{type:'break'}} BreakInline */
/** @typedef {TextInline|CodeInline|SpanInline|LinkInline|ImageInline|CiteInline|BreakInline} Inline */

export const CAP = 2000;
const MAX_DEPTH = 6;
// A fourth documented refinement (P0 fix round): a run of MORE than TICK_MAX backticks never opens
// a code span - it is literal text, consumed whole. CommonMark agrees (a code-span opener is a
// MAXIMAL backtick run), and it is what stops a model repetition loop from costing O(run^2) per
// feed: every position inside a long run would otherwise re-count the whole run.
export const TICK_MAX = 32;
const PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

const isWSc = (/** @type {string} */ c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isAlnum = (/** @type {string} */ c) => !!c && /[0-9A-Za-z]/.test(c);

/** The length of the backtick run starting at i. Callers ALWAYS advance past it, so it is O(1) amortised. */
function tickRun(/** @type {string} */ s, /** @type {number} */ i) {
  let n = 0;
  while (s[i + n] === '`') n++;
  return n;
}

/**
 * Skip a code span starting at i (i points at the first backtick). Returns the index after it, or
 * `-run` (always negative, since s[i] is a backtick) when no span opens here - the caller uses that
 * run length to step over a literal run in ONE move instead of re-entering once per character.
 */
function skipCode(/** @type {string} */ s, /** @type {number} */ i, /** @type {number} */ end) {
  const n = tickRun(s, i);
  if (n > TICK_MAX) return -n;                                   // literal by the TICK_MAX refinement
  const limit = Math.min(end, i + CAP);
  for (let j = i + n; j < limit; j++) {
    if (s[j] !== '`') continue;
    // Capped at CAP: a run longer than that pushes j past `limit` either way, so the verdict is
    // unchanged and one iteration can no longer cost O(the whole run).
    let m = 0;
    while (s[j + m] === '`' && m <= CAP) m++;
    if (m === n) return j + n;
    j += m - 1;
  }
  return -n;
}

/**
 * The index of a closing delimiter `mark` for an opener at `from`, skipping code spans and
 * escapes, or -1. `single` means the delimiter must not be doubled.
 * `flags.openTick` comes back true when the scan stepped over a backtick run that has NOT closed
 * yet: a later backtick can turn that run into a code span which swallows this closer, so the span
 * resolved here is not final and the streaming parser must not commit it.
 */
function findCloser(/** @type {string} */ s, /** @type {number} */ from, /** @type {number} */ end,
  /** @type {string} */ mark, /** @type {boolean} */ single, /** @type {boolean} */ intraword,
  /** @type {{openTick: boolean}} */ flags) {
  const limit = Math.min(end, from + CAP);
  const ch = mark[0];
  // The delimiter run is counted ONLY on the paths that then step over it, so the scan stays O(1)
  // amortised per character; counting it up front made every position of a run re-count that run.
  const runLen = (/** @type {number} */ at) => { let n = 1; while (s[at + n] === ch) n++; return n; };
  for (let i = from; i < limit; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') {
      const j = skipCode(s, i, end);
      if (j > 0) { i = j - 1; continue; }
      if (-j > TICK_MAX) i += -j - 1;                             // a literal run: step over it whole
      else flags.openTick = true;                                  // still open: more text could close it
      continue;
    }
    if (c !== ch) continue;
    const dbl = s[i + 1] === ch;
    if (mark.length === 2) {
      if (!dbl) continue;                                         // run === 1: the old `i += run - 1` was a no-op
    } else if (single && dbl) {
      i += runLen(i) - 1; continue;                               // run !== 1
    }
    if (isWSc(s[i - 1])) { i += runLen(i) - 1; continue; }         // a closer is left-flanking
    if (intraword && isAlnum(s[i + mark.length])) { i += runLen(i) - 1; continue; }
    if (i + mark.length > limit) return -1;
    return i;
  }
  return -1;
}

/** Trim the punctuation a bare autolink should not swallow. */
function trimUrl(/** @type {string} */ url) {
  let end = url.length;
  for (;;) {
    const c = url[end - 1];
    if (c === undefined) break;
    if ('.,;:!?\'"'.indexOf(c) >= 0) { end--; continue; }
    if (c === ')') {
      const body = url.slice(0, end);
      const opens = (body.match(/\(/g) || []).length;
      const closes = (body.match(/\)/g) || []).length;
      if (closes > opens) { end--; continue; }
    }
    if (c === ']' || c === '>') { end--; continue; }
    break;
  }
  return url.slice(0, end);
}

function isHttp(/** @type {string} */ u) {
  const s = u.toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://');
}

/**
 * Tokenise s[from, to) at the given depth.
 * @returns {{recs: {node: Inline, start: number, end: number}[], lastSafe: number, blocked: boolean}}
 */
function tokenize(/** @type {string} */ s, /** @type {number} */ from, /** @type {number} */ to,
  /** @type {any} */ opts, /** @type {number} */ depth) {
  /** @type {{node: Inline, start: number, end: number}[]} */
  const recs = [];
  let buf = '';
  let bufStart = from;
  let lastSafe = -1;

  const flush = (/** @type {number} */ at) => {
    if (!buf) { bufStart = at; return; }
    recs.push({ node: { type: 'text', text: buf }, start: bufStart, end: at });
    buf = '';
    bufStart = at;
  };
  // An opener that has not resolved yet may still resolve when more text arrives, so no offset
  // after it can be a safe commit point.
  let blocked = false;
  const block = () => { blocked = true; };
  const markSafe = (/** @type {number} */ at) => { if (depth === 0 && !blocked) lastSafe = at; };

  /**
   * `settled` says the node's extent can no longer change as text arrives. The default, `end < to`,
   * is exactly right for every fixed-extent node: each of them was decided by a character AT `end`
   * that is already present (the char after a code span's closing run is not a backtick, the char
   * after an intraword `_` closer is not alphanumeric, the char after a [n] citation is not `(`),
   * and a node ending at `to` has no such character yet. A BARE autolink passes its own verdict,
   * because it keeps growing until it meets whitespace.
   * A settled top-level node's end is a record boundary nothing can move - so it is a safe commit
   * point too, and that is what lets a delimiter run advance safeEnd at all: a run holds no
   * whitespace, so the whitespace rule below would never fire inside one.
   */
  const emit = (/** @type {Inline} */ node, /** @type {number} */ start, /** @type {number} */ end,
    /** @type {boolean} */ settled) => {
    flush(start);
    recs.push({ node, start, end });
    bufStart = end;
    if (settled === undefined ? end < to : settled) markSafe(end);
    else block();
  };

  let i = from;
  while (i < to) {
    const c = s[i];

    if (depth === 0 && !blocked && isWSc(c) && !isWSc(s[i - 1])) lastSafe = i;

    // backslash escape / hard break
    if (c === '\\') {
      if (s[i + 1] === '\n') { emit({ type: 'break' }, i, i + 2); i += 2; continue; }
      if (s[i + 1] !== undefined && PUNCT.indexOf(s[i + 1]) >= 0) { buf += s[i + 1]; i += 2; continue; }
      if (i + 1 >= to) block();
      buf += c; i++; continue;
    }

    // hard break: two or more spaces before a newline
    if (c === ' ' && s[i + 1] !== undefined) {
      let k = i;
      while (s[k] === ' ') k++;
      if (k - i >= 2 && s[k] === '\n' && k < to) { emit({ type: 'break' }, i, k + 1); i = k + 1; continue; }
    }

    // code span
    if (c === '`') {
      const j = skipCode(s, i, to);
      if (j > 0) {
        const n = tickRun(s, i);
        let inner = s.slice(i + n, j - n);
        if (inner.length > 2 && inner[0] === ' ' && inner[inner.length - 1] === ' ' && inner.trim() !== '') {
          inner = inner.slice(1, -1);
        }
        emit({ type: 'code', text: inner }, i, j);
        i = j; continue;
      }
      const run = -j;
      if (run > TICK_MAX) {
        // Literal by the TICK_MAX refinement, and it can never become anything else: take the whole
        // run in one step (re-entering per character is what made a stuck model freeze the renderer)
        // and treat its end as a safe commit point.
        buf += s.slice(i, i + run);
        i += run;
        // Safe only once the run is TERMINATED by a character that is already here: a run that ends
        // at `to` can still grow, and committing inside it would freeze a boundary the full parse
        // does not have (found by the adversarial inline fuzz).
        if (i < to) { flush(i); markSafe(i); }
        continue;
      }
      if (to - i <= CAP) block();
      buf += c; i++; continue;
    }

    // autolink in angle brackets
    if (c === '<') {
      const close = s.indexOf('>', i + 1);
      if (close < 0 && to - i <= CAP) block();
      if (close > 0 && close - i <= CAP && close < to) {
        const inner = s.slice(i + 1, close);
        if (isHttp(inner) && !/\s/.test(inner)) {
          emit({ type: 'link', href: inner, auto: true, children: [{ type: 'text', text: inner }] }, i, close + 1);
          i = close + 1; continue;
        }
      }
      buf += c; i++; continue;
    }

    // image / link / citation
    if ((c === '[' || (c === '!' && s[i + 1] === '[')) && depth < MAX_DEPTH) {
      const image = c === '!';
      const open = image ? i + 1 : i;
      let close = -1;
      let openTick = false;
      const limit = Math.min(to, open + CAP);
      for (let j = open + 1; j < limit; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s[j] === '`') {
          const k = skipCode(s, j, to);
          if (k > 0) { j = k - 1; } else if (-k > TICK_MAX) { j += -k - 1; } else { openTick = true; }
          continue;
        }
        if (s[j] === ']') { close = j; break; }
      }
      if (close < 0 && to - open <= CAP) block();
      if (close > 0) {
        const label = s.slice(open + 1, close);
        if (close + 1 >= to) block();
        if (s[close + 1] === '(') {
          let depthP = 1, k = close + 2;
          const lim2 = Math.min(to, close + CAP);
          while (k < lim2 && depthP > 0) {
            if (s[k] === '\\') { k += 2; continue; }
            if (s[k] === '(') depthP++;
            else if (s[k] === ')') depthP--;
            k++;
          }
          if (depthP !== 0 && to - close <= CAP) block();
          if (depthP === 0) {
            let dest = s.slice(close + 2, k - 1).trim();
            if (dest.startsWith('<') && dest.endsWith('>')) dest = dest.slice(1, -1);
            const sp = dest.search(/\s/);
            if (sp >= 0) dest = dest.slice(0, sp);
            const fixed = !openTick && k < to;
            if (image) {
              emit({ type: 'image', src: dest, alt: label }, i, k, fixed);
            } else {
              const kids = tokenize(s, open + 1, close, opts, depth + 1);
              if (kids.blocked) block();
              emit({ type: 'link', href: dest, auto: false, children: kids.recs.map((r) => r.node) }, i, k, fixed);
            }
            i = k; continue;
          }
        } else if (!image && opts && opts.citations && /^[0-9]{1,3}$/.test(label)) {
          emit({ type: 'cite', n: parseInt(label, 10) }, i, close + 1, !openTick && close + 1 < to);
          i = close + 1; continue;
        }
      }
      buf += c; i++; continue;
    }

    // bare autolink
    if ((c === 'h' || c === 'H') && !isAlnum(s[i - 1])) {
      const rest = s.slice(i, Math.min(to, i + CAP));
      const low = rest.toLowerCase();
      if (rest.length < 8 && ('https://'.startsWith(low) || 'http://'.startsWith(low))) block();
      if (isHttp(rest)) {
        let k = 0;
        while (k < rest.length && !isWSc(rest[k]) && rest[k] !== '<') k++;
        const url = trimUrl(rest.slice(0, k));
        if (url.length > 8) {
          // settled only when the scan actually stopped ON something (whitespace, '<', or the CAP
          // cut) rather than running out of text: more characters would otherwise extend the URL.
          emit({ type: 'link', href: url, auto: true, children: [{ type: 'text', text: url }] },
            i, i + url.length, i + k < to);
          i += url.length; continue;
        }
      }
      buf += c; i++; continue;
    }

    // emphasis
    if ((c === '*' || c === '_' || c === '~') && depth < MAX_DEPTH) {
      const dbl = s[i + 1] === c;
      const intraword = c === '_';
      const next = s[i + (dbl ? 2 : 1)];
      const leftOk = next !== undefined && !isWSc(next) && !(intraword && isAlnum(s[i - 1]));
      if (i + (dbl ? 2 : 1) >= to) block();
      if (leftOk && !(c === '~' && !dbl)) {
        const mark = dbl ? c + c : c;
        const flags = { openTick: false };
        const close = findCloser(s, i + mark.length, to, mark, !dbl, intraword, flags);
        if (close < 0 && to - i <= CAP) block();
        if (close > 0) {
          const type = c === '~' ? 'del' : dbl ? 'strong' : 'em';
          const kids = tokenize(s, i + mark.length, close, opts, depth + 1);
          if (kids.blocked) block();
          emit(
            { type: /** @type {'strong'|'em'|'del'} */ (type), children: kids.recs.map((r) => r.node) },
            i, close + mark.length, !flags.openTick && close + mark.length < to,
          );
          i = close + mark.length; continue;
        }
      }
      buf += c; i++; continue;
    }

    buf += c;
    i++;
  }
  flush(to);
  return { recs, lastSafe, blocked };
}

/**
 * @param {string} text
 * @param {{citations?: boolean}} [opts]
 * @returns {Inline[]}
 */
export function parseInline(text, opts) {
  return tokenize(text, 0, text.length, opts || {}, 0).recs.map((r) => r.node);
}

/**
 * Incremental inline parsing for an open paragraph.
 * `feed(text)` takes the CUMULATIVE text of the block and returns
 * `{safeEnd, committed, open}`: `committed` holds the inlines before `safeEnd` and never changes,
 * `open` is the re-parsed tail. Concatenating them (merging adjacent text inlines) equals
 * `parseInline(text)`.
 * @param {{citations?: boolean}} [opts]
 */
export function createInlineStream(opts) {
  const o = opts || {};
  /** @type {Inline[]} */ let committed = [];
  let safeEnd = 0;
  // Characters handed to tokenize(), summed over every feed - the work counter the streaming gate
  // measures, the inline twin of the block parser's debug.scanned. Bounded per feed by the UNSAFE
  // tail, which is what safeEnd exists to keep short.
  const debug = { scanned: 0 };

  return {
    debug,
    /** @param {string} text */
    feed(text) {
      debug.scanned += text.length - safeEnd;
      const { recs, lastSafe } = tokenize(text, safeEnd, text.length, o, 0);
      if (lastSafe > safeEnd) {
        debug.scanned += (text.length - safeEnd);
        // Re-tokenise [safeEnd, lastSafe) on its own: nothing open crosses a safe point, so this is
        // exactly the prefix of the full parse - and unlike slicing raw text it keeps escapes right.
        const head = tokenize(text, safeEnd, lastSafe, o, 0).recs.map((r) => r.node);
        committed = committed.concat(head);
        safeEnd = lastSafe;
        const tail = tokenize(text, safeEnd, text.length, o, 0).recs.map((r) => r.node);
        return { safeEnd, committed, open: tail };
      }
      return { safeEnd, committed, open: recs.map((r) => r.node) };
    },
    get safeEnd() { return safeEnd; },
  };
}

/** Merge adjacent text inlines (what the DOM does anyway); used to compare a stream to parseInline. */
export function mergeText(/** @type {Inline[]} */ inlines) {
  /** @type {Inline[]} */ const out = [];
  for (const n of inlines) {
    const prev = out[out.length - 1];
    if (n.type === 'text' && prev && prev.type === 'text') out[out.length - 1] = { type: 'text', text: prev.text + n.text };
    else out.push(n);
  }
  return out;
}
