// @ts-check
// A line diff for the IDE's History tab (ui/project-panel.mjs): what one commit changed in a text file. The common
// first and last lines are trimmed; the middle gets an LCS table when it is small enough, else it reads as removed
// then added (a whole-file rewrite reads that way anyway). Pure: no DOM.

/** The LCS table's ceiling (cells): ~8 MB of Uint32. ponytail: a Myers diff if big files ever need a fine diff. */
export const MAX_CELLS = 2_000_000;

/** @typedef {{kind: ' '|'-'|'+'|'…', text: string}} Line */

/** @param {string|null|undefined} s @returns {string[]} */
function split(s) {
  if (s == null || s === '') return [];
  const lines = String(s).split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** @param {string[]} a @param {string[]} b @returns {Line[]} */
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  /** @type {Line[]} */ const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: ' ', text: a[i] }); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) out.push({ kind: '-', text: a[i++] });
    else out.push({ kind: '+', text: b[j++] });
  }
  while (i < n) out.push({ kind: '-', text: a[i++] });
  while (j < m) out.push({ kind: '+', text: b[j++] });
  return out;
}

/**
 * Every line of the two versions, tagged ' ' (kept), '-' (removed) or '+' (added).
 * @param {string|null|undefined} before @param {string|null|undefined} after @returns {Line[]}
 */
export function diffLines(before, after) {
  const a = split(before);
  const b = split(after);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const am = a.slice(s, a.length - e);
  const bm = b.slice(s, b.length - e);
  const mid = am.length * bm.length <= MAX_CELLS ? lcs(am, bm)
    : [...am.map((text) => ({ kind: /** @type {'-'} */ ('-'), text })), ...bm.map((text) => ({ kind: /** @type {'+'} */ ('+'), text }))];
  const keep = (/** @type {string[]} */ list) => list.map((text) => ({ kind: /** @type {' '} */ (' '), text }));
  return [...keep(a.slice(0, s)), ...mid, ...keep(a.slice(a.length - e))];
}

/**
 * Only the changes and `context` kept lines around each; a skipped run becomes one '…' line.
 * @param {Line[]} lines @param {number} [context] @returns {Line[]}
 */
export function hunks(lines, context = 3) {
  const near = new Uint8Array(lines.length);
  lines.forEach((l, i) => {
    if (l.kind === ' ') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) near[k] = 1;
  });
  /** @type {Line[]} */ const out = [];
  let skipped = false;
  lines.forEach((l, i) => {
    if (near[i]) { out.push(l); skipped = false; } else if (!skipped) { out.push({ kind: '…', text: '' }); skipped = true; }
  });
  return out;
}
