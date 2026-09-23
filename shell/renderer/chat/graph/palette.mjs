// @ts-check
// K5-U2 (addendum KE-2): the ＋ menu's MODEL — which rows exist, in what order, and which ones a
// typed query finds. PURE (in PURE_MODULES): it is handed the catalogue as data and never imports
// the part files, so it runs in Node with the DOM trapped.
//
// FROZEN: `GROUP_ORDER`, `buildPalette`, `searchPalette`, `groupEntries` and their shapes. Added
// by K5-U2: `words`, `osa`, `scoreEntry` (the search, exposed so its unit test can say WHY a row
// ranks where it does) and `STOP_WORDS`.
//
// The search is FUZZY, because a person types what they remember, not what we called it:
//   - by NAME, KEYWORD and DESCRIPTION, weighted in that order (3 · 2 · 1), plus the entry id and
//     part type as keywords (`ask` finds the Instruction, `p5` the sketch);
//   - a query word matches a word of the row exactly, as its start (typing in progress), inside it
//     (3+ letters), with a typo (one edit up to six letters, two from seven — a swapped pair of
//     letters is ONE edit, so `skecth` finds the sketch), or as its letters in order from the same
//     first letter (`skch`);
//   - the whole query also matches the name run together (`threejs`, `p5js`, `writesvg`);
//   - every query word must match somewhere, except the little words (`a`, `the`, …) which only
//     help — "make a picture" is not refused for its "a";
//   - best first; a tie goes to the shorter name (the more of it the query covers), then to
//     reading order.
//
// The caller is graph/palette-menu.mjs:
//   buildPalette(paletteCatalogue(), session.specs)   — graph/parts/index.mjs owns the catalogue

/** @typedef {import('../core/types.mjs').PaletteEntry} PaletteEntry */
/** @typedef {import('../core/types.mjs').PartPreset} PartPreset */

/** The five groups, in menu order. The same frozen list as graph/parts/index.mjs PALETTE_GROUPS
 * (a copy, because this module may not import the part files). */
export const GROUP_ORDER = Object.freeze(['bring', 'think', 'show', 'control', 'annotate']);

/** Query words that never have to match (they still score when they do). */
export const STOP_WORDS = Object.freeze(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'for', 'in', 'on', 'with', 'my', 'some', 'box']);

/**
 * Every row of the menu, in reading order: by group, then `order`, then label. Rows whose part
 * type the session cannot load are dropped (a unit test hands a partial `specs`).
 * @param {{parts: {type: string, label: string, group: string, order: number, glyph: string, desc: string, keywords?: string[], size?: any}[],
 *   presets: PartPreset[]}} cat
 * @param {Map<string, any>|null} [specs]
 * @returns {PaletteEntry[]}
 */
export function buildPalette(cat, specs) {
  const has = (/** @type {string} */ type) => !(specs instanceof Map) || specs.has(type);
  const kw = (/** @type {any} */ k) => (Array.isArray(k) ? k.map(String) : []);
  /** @type {PaletteEntry[]} */ const out = [];
  /** @type {Set<string>} */ const seen = new Set();
  for (const p of (cat && Array.isArray(cat.parts) ? cat.parts : [])) {
    if (!p || !p.type || !has(p.type) || seen.has(p.type)) continue;
    seen.add(p.type);
    out.push(/** @type {any} */ ({
      entry: p.type, type: p.type, preset: null, group: p.group, label: String(p.label || p.type), desc: p.desc || '',
      glyph: p.glyph || '', keywords: kw(p.keywords), order: Number(p.order) || 0, settings: {}, size: null,
    }));
  }
  for (const p of (cat && Array.isArray(cat.presets) ? cat.presets : [])) {
    if (!p || !p.id || !has(p.type) || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(/** @type {any} */ ({
      entry: p.id, type: p.type, preset: p.id, group: p.group, label: String(p.label || p.id), desc: p.desc || '',
      glyph: p.glyph || '', keywords: kw(p.keywords),
      order: Number(p.order) || 0, settings: { ...(p.settings || {}) }, size: p.size ? { ...p.size } : null,
    }));
  }
  const gi = (/** @type {string} */ g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; };
  return out.sort((a, b) => gi(a.group) - gi(b.group) || a.order - b.order || a.label.localeCompare(b.label));
}

/**
 * The words of a text, lower-cased, accents folded, split on anything that is not a letter or a
 * digit: "p5.js sketch" → ['p5', 'js', 'sketch'].
 * @param {any} s @returns {string[]}
 */
export function words(s) {
  return fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** @param {any} s @returns {string} */
function fold(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** @param {any} s @returns {string} the letters and digits only: "three.js scene" → "threejsscene" */
function compact(s) {
  return words(s).join('');
}

/**
 * Optimal-string-alignment distance (Levenshtein + adjacent transposition), giving up past `max`.
 * @param {string} a @param {string} b @param {number} [max] @returns {number} (max+1 when over)
 */
export function osa(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  /** @type {number[][]} */ const d = [];
  for (let i = 0; i <= a.length; i++) d.push([i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  const r = d[a.length][b.length];
  return r > max ? max + 1 : r;
}

/** @param {string} tok @param {string} word */
function isSubsequence(tok, word) {
  let i = 0;
  for (let j = 0; j < word.length && i < tok.length; j++) if (word[j] === tok[i]) i++;
  return i === tok.length;
}

/**
 * How well ONE query word matches ONE word of a row, 0..1.
 * @param {string} tok @param {string} word @param {boolean} fuzzy typo tolerance allowed here
 * @returns {number}
 */
function wordScore(tok, word, fuzzy) {
  if (word === tok) return 1;
  if (word.startsWith(tok)) return 0.9;
  if (tok.length >= 3 && word.includes(tok)) return 0.6;
  if (fuzzy && tok.length >= 4) {
    const max = tok.length >= 7 ? 2 : 1;
    if (osa(tok, word, max) <= max) return 0.5;
    if (word.length > tok.length && osa(tok, word.slice(0, tok.length), max) <= max) return 0.45;
  }
  if (tok.length >= 3 && tok[0] === word[0] && word.length > tok.length && isSubsequence(tok, word)) return 0.35;
  return 0;
}

/** @param {string} tok @param {string[]} list @param {boolean} fuzzy */
function bestIn(tok, list, fuzzy) {
  let best = 0;
  for (const w of list) {
    const s = wordScore(tok, w, fuzzy);
    if (s > best) { best = s; if (best === 1) break; }
  }
  return best;
}

/**
 * The score of one row for one query, 0 when the row is not a match. Exposed for the unit test.
 * @param {PaletteEntry} e @param {string} query @returns {number}
 */
export function scoreEntry(e, query) {
  const q = fold(query).trim();
  const toks = words(q);
  if (!toks.length) return 0;
  const label = words(e.label);
  const id = words(e.entry);
  // A preset's underlying type is a weak hint (`ask` should find the Instruction before the
  // Write-… boxes); a plain part's type IS its entry id.
  const type = e.preset ? words(e.type) : [];
  const keys = [...new Set((e.keywords || []).flatMap((k) => words(k)))];
  const desc = words(e.desc);
  const required = toks.some((tk) => !STOP_WORDS.includes(tk)) ? toks.filter((tk) => !STOP_WORDS.includes(tk)) : toks;

  let total = 0;
  let matched = 0;
  for (const tok of toks) {
    const s = Math.max(
      3 * bestIn(tok, label, true),
      2.5 * bestIn(tok, id, false),
      2 * bestIn(tok, keys, true),
      1.5 * bestIn(tok, type, false),
      1 * bestIn(tok, desc, tok.length >= 5),
    );
    if (s > 0 && required.includes(tok)) matched++;
    total += s;
  }

  // The whole query against the name run together: "threejs", "p5js", "writean" (typing in
  // progress).
  const cq = compact(q);
  const cl = compact(e.label);
  let phrase = 0;
  if (cq && cl === cq) phrase = 5;
  else if (cq && cl.startsWith(cq)) phrase = 3;
  else if (cq.length >= 2 && cl.includes(cq)) phrase = 1.5;

  if (matched < required.length) {
    // A query that ran its words together matches no single word, but the run-together name
    // still finds the row.
    if (phrase > 0 && cq.length >= 3) return 3 * 0.8 + phrase;
    // A sentence ("make a picture", "draw a spinning cube") may say more than any one box does:
    // up to half of its words may miss, and the row pays for each one it misses.
    if (matched === 0 || required.length - matched > Math.floor(required.length / 2)) return 0;
    return (total + phrase) * (matched / required.length);
  }
  return total + phrase;
}

/**
 * The rows a query finds, best first. An empty query is every row in reading order.
 * @param {PaletteEntry[]} entries @param {string} query @returns {PaletteEntry[]}
 */
export function searchPalette(entries, query) {
  const list = Array.isArray(entries) ? entries : [];
  if (!words(query).length) return list.slice();
  /** @type {{e: PaletteEntry, score: number, i: number}[]} */ const hits = [];
  list.forEach((e, i) => {
    const score = scoreEntry(e, String(query));
    if (score > 0) hits.push({ e, score, i });
  });
  return hits
    .sort((a, b) => b.score - a.score || a.e.label.length - b.e.label.length || a.i - b.i)
    .map((h) => h.e);
}

/**
 * Rows grouped for drawing, groups in menu order, empty groups left out.
 * @param {PaletteEntry[]} entries @returns {{group: string, entries: PaletteEntry[]}[]}
 */
export function groupEntries(entries) {
  return GROUP_ORDER
    .map((group) => ({ group, entries: (entries || []).filter((e) => e.group === group) }))
    .filter((g) => g.entries.length > 0);
}
