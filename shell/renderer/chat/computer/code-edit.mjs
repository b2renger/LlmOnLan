// @ts-check
// The drawer's code editor, as TEXT (COMPUTER_LIVE_PLAN K-8). PURE: strings and numbers in,
// strings and numbers out — no DOM, no clock — so computer-code-edit.test.mjs pins every rule in
// Node, and computer/drawer.mjs only has to apply what these functions decide.
//
// What lives here:
//   - the line-number gutter's MODEL: how many rows, how wide, which one is the error line, and
//     the smallest change that turns the rows on screen into the rows the text needs;
//   - where the caret is, as the "Ln 12, Col 4" a person reads;
//   - what Tab, Shift+Tab and Enter do to the text: an EDIT {from, to, insert, selStart, selEnd}
//     that the drawer hands to the browser's own insertText, so Ctrl+Z still undoes it.
//
// Why an edit and not a new string: the browser's undo stack only survives changes made THROUGH
// the field. Assigning `value` wipes it, and a code editor where Ctrl+Z does not undo a Tab is
// worse than one without Tab. So each rule says which range to replace and with what, and
// `applyEdit` is the same rule as a plain string function, for the fallback and for the tests.

/** Two spaces: what the starters, the system messages and the models all indent with. */
export const INDENT = '  ';

/** @param {any} v @returns {string} */
const str = (v) => (v == null ? '' : String(v));

/** @param {number} n @param {number} lo @param {number} hi */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(Number(n) || 0)));

/**
 * How many lines `text` has. An empty text is one (empty) line, and a trailing newline starts a
 * line of its own — exactly what a textarea shows, so the gutter never runs one row short.
 * @param {any} text @returns {number}
 */
export function lineCount(text) {
  const s = str(text);
  let n = 1;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n += 1;
  return n;
}

/**
 * The gutter for `text`. `digits` is at least 2 so the column does not jump from 9 to 10 lines;
 * `error` is the line to mark, or 0 when there is none or it is past the end of the text.
 * @param {any} text @param {any} [errorLine]
 * @returns {{count: number, digits: number, error: number}}
 */
export function gutterModel(text, errorLine) {
  const count = lineCount(text);
  const e = Math.floor(Number(errorLine) || 0);
  return { count, digits: Math.max(2, String(count).length), error: e >= 1 && e <= count ? e : 0 };
}

/**
 * The smallest change from `have` gutter rows to `want`: the numbers to append, or how many to
 * drop from the end. Typing a character inside a line changes nothing, so it rebuilds nothing.
 * @param {number} have @param {number} want
 * @returns {{add: number[], drop: number}}
 */
export function gutterPatch(have, want) {
  const h = Math.max(0, Math.floor(Number(have) || 0));
  const w = Math.max(0, Math.floor(Number(want) || 0));
  /** @type {number[]} */ const add = [];
  for (let n = h + 1; n <= w; n++) add.push(n);
  return { add, drop: Math.max(0, h - w) };
}

/**
 * Where an offset sits, as a person counts: line and column from 1.
 * @param {any} text @param {any} offset @returns {{line: number, col: number}}
 */
export function caretAt(text, offset) {
  const s = str(text);
  const at = clamp(offset, 0, s.length);
  const before = s.slice(0, at);
  const nl = before.lastIndexOf('\n');
  return { line: lineCount(before), col: at - (nl + 1) + 1 };
}

/** The offset where the line holding `offset` starts. @param {string} s @param {number} offset */
function lineStart(s, offset) {
  return s.lastIndexOf('\n', Math.max(0, offset) - 1) + 1;
}

/** The offset where the line holding `offset` ends (its newline, or the end of the text).
 * @param {string} s @param {number} offset */
function lineEnd(s, offset) {
  const nl = s.indexOf('\n', offset);
  return nl < 0 ? s.length : nl;
}

/** @typedef {{from: number, to: number, insert: string, selStart: number, selEnd: number}} CodeEdit */

/**
 * `text` with one edit applied — the same rule the browser applies through insertText.
 * @param {any} text @param {CodeEdit} edit @returns {string}
 */
export function applyEdit(text, edit) {
  const s = str(text);
  const from = clamp(edit.from, 0, s.length);
  const to = clamp(edit.to, from, s.length);
  return s.slice(0, from) + str(edit.insert) + s.slice(to);
}

/**
 * What Tab (or Shift+Tab, `outdent`) does.
 *   - A caret, or a selection inside one line: Tab types spaces up to the next indent stop,
 *     replacing the selection, exactly as if they had been typed.
 *   - A selection across lines: Tab indents every line it touches (an empty line stays empty) and
 *     leaves those whole lines selected, so a second Tab indents them again.
 *   - Shift+Tab takes up to one indent (or one tab character) off the start of every line the
 *     caret or selection touches. A caret stays on the same character.
 * A selection that ends at the very start of a line does not touch that line — the line a person
 * sees as "not selected" is not moved.
 * @param {any} text @param {any} selStart @param {any} selEnd @param {boolean} [outdent]
 * @returns {CodeEdit|null} null when there is nothing to do (Shift+Tab on an unindented line)
 */
export function tabEdit(text, selStart, selEnd, outdent) {
  const s = str(text);
  let a = clamp(selStart, 0, s.length);
  let b = clamp(selEnd, 0, s.length);
  if (b < a) { const t = a; a = b; b = t; }
  const multi = s.slice(a, b).indexOf('\n') >= 0;
  if (!outdent && !multi) {
    const col = a - lineStart(s, a);
    const pad = INDENT.length - (col % INDENT.length);
    const insert = ' '.repeat(pad);
    return { from: a, to: b, insert, selStart: a + pad, selEnd: a + pad };
  }
  const first = lineStart(s, a);
  // A selection that ends at column 1 of a line has not really reached that line.
  const lastAt = b > a && b === lineStart(s, b) ? b - 1 : b;
  const last = lineEnd(s, lastAt);
  const lines = s.slice(first, last).split('\n');
  let removedFirst = 0;
  let changed = false;
  const out = lines.map((line, i) => {
    if (!outdent) {
      if (!line) return line;
      changed = true;
      return INDENT + line;
    }
    let cut = 0;
    if (line[0] === '\t') cut = 1;
    else while (cut < INDENT.length && line[cut] === ' ') cut += 1;
    if (cut) changed = true;
    if (i === 0) removedFirst = cut;
    return line.slice(cut);
  });
  if (!changed) return null;
  const insert = out.join('\n');
  if (!multi) {
    // Shift+Tab with a caret (or a selection on one line): the caret keeps its character, and
    // never moves back past the start of the line.
    const ns = Math.max(first, a - removedFirst);
    const ne = Math.max(first, b - removedFirst);
    return { from: first, to: last, insert, selStart: ns, selEnd: ne };
  }
  return { from: first, to: last, insert, selStart: first, selEnd: first + insert.length };
}

/** An opener after which the next line goes one indent deeper. */
const OPENERS = '{[(';

/**
 * What Enter does: a new line that keeps the current line's indentation, one indent deeper after
 * an opening bracket (`function draw() {` ⏎ lands inside the block). The selection, if any, is
 * replaced, as a typed newline would replace it.
 * @param {any} text @param {any} selStart @param {any} selEnd @returns {CodeEdit}
 */
export function newlineEdit(text, selStart, selEnd) {
  const s = str(text);
  let a = clamp(selStart, 0, s.length);
  let b = clamp(selEnd, 0, s.length);
  if (b < a) { const t = a; a = b; b = t; }
  const start = lineStart(s, a);
  const lead = /^[ \t]*/.exec(s.slice(start, a));
  const indent = lead ? lead[0] : '';
  const before = s.slice(start, a).replace(/\s+$/, '');
  const deeper = before && OPENERS.indexOf(before[before.length - 1]) >= 0 ? INDENT : '';
  const insert = `\n${indent}${deeper}`;
  return { from: a, to: b, insert, selStart: a + insert.length, selEnd: a + insert.length };
}

/**
 * How far to scroll a field so `line` is comfortably in view, or null when it already is.
 * `pad` is the field's top padding; everything is in CSS pixels.
 * @param {{line: number, lineHeight: number, pad: number, scrollTop: number, height: number}} o
 * @returns {number|null}
 */
export function scrollForLine(o) {
  const lh = Math.max(1, Number(o.lineHeight) || 1);
  const top = (Math.max(1, Math.floor(Number(o.line) || 1)) - 1) * lh + (Number(o.pad) || 0);
  const view = Math.max(lh, Number(o.height) || 0);
  const at = Math.max(0, Number(o.scrollTop) || 0);
  if (top >= at && top + lh <= at + view) return null;
  return Math.max(0, Math.round(top - view / 3));
}
