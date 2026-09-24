// @ts-check
// What KIND of file is this? (K6-U3, addendum KF-7) — PURE.
//
// The canvas drop router (computer/drops.mjs) asks this first, from the name, the MIME type and
// the size alone — no bytes are read to decide, so a 2 GB video is refused before anything loads
// it. The answer picks the box: image → Image, pdf → Document, audio → Sound, text → Text with the
// contents, graph → opened as a graph (today's behaviour), none → refused with a sentence.
//
// K6-U3 owns it and its unit test (test/chat/unit/computer-drops.test.mjs).

/** Extensions read as TEXT into a Text box (frozen, KF-7). `.json` is ALSO how a graph arrives:
 * the router peeks at a .json's text for `"lolgraph"` before deciding. */
export const TEXT_EXTS = Object.freeze(['txt', 'md', 'markdown', 'csv', 'tsv', 'json']);
/** Extensions of sound files Chromium's decoder reads (frozen, KF-6). */
export const AUDIO_EXTS = Object.freeze(['wav', 'mp3', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'webm']);
/** Extensions of pictures the intake reads (computer/intake.mjs ACCEPTED_TYPES). */
export const IMAGE_EXTS = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif']);
/** The largest text file read into a Text box (frozen, KF-7). */
export const TEXT_MAX_BYTES = 256 * 1024;
/** How many files one drop may place (the intake's own cap, computer/intake.mjs MAX_INTAKE_FILES). */
export const MAX_DROP_FILES = 8;

/** @param {string} name @returns {string} the lowercased extension, or '' */
export function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * @param {{name?: string, type?: string, size?: number}} file
 * @returns {{kind: 'graph'|'image'|'pdf'|'audio'|'text'|'none', ext: string, maybeGraph: boolean}}
 */
export function classify(file) {
  const name = String((file && file.name) || '');
  const type = String((file && file.type) || '').toLowerCase();
  const ext = extOf(name);
  if (/\.lolgraph\.json$/i.test(name)) return { kind: 'graph', ext, maybeGraph: true };
  if (type === 'application/pdf' || ext === 'pdf') return { kind: 'pdf', ext, maybeGraph: false };
  if (type.startsWith('image/') || IMAGE_EXTS.includes(ext)) return { kind: 'image', ext, maybeGraph: false };
  if (type.startsWith('audio/') || AUDIO_EXTS.includes(ext)) return { kind: 'audio', ext, maybeGraph: false };
  if (TEXT_EXTS.includes(ext) || type.startsWith('text/') || type === 'application/json') {
    return { kind: 'text', ext, maybeGraph: ext === 'json' || type === 'application/json' };
  }
  return { kind: 'none', ext, maybeGraph: false };
}

/** Does this text look like a graph file? A cheap, honest peek — the importer decides for real.
 * @param {string} text @returns {boolean} */
export function looksLikeGraph(text) {
  return /"lolgraph"\s*:/.test(String(text || '').slice(0, 4096));
}

/** The space between boxes placed by one drop, in world pixels. */
export const DROP_GAP = 24;
/** How many boxes one drop lays side by side before starting a new row. */
export const DROP_PER_ROW = 4;

/**
 * Where each box of one drop lands: left to right from the drop point, a gap between boxes,
 * a new row every perRow boxes — so eight files dropped at once never land on top of each other.
 * @param {{x: number, y: number}} at the world point of the drop (the first box's top-left)
 * @param {{w?: number, h?: number}[]} sizes each box's size, in drop order
 * @param {{gap?: number, perRow?: number}} [o]
 * @returns {{x: number, y: number}[]}
 */
export function slotsFor(at, sizes, o = {}) {
  const gap = Number.isFinite(o.gap) ? Number(o.gap) : DROP_GAP;
  const perRow = Math.max(1, Math.floor(Number(o.perRow) || DROP_PER_ROW));
  const x0 = Number(at && at.x) || 0;
  const y0 = Number(at && at.y) || 0;
  /** @type {{x: number, y: number}[]} */ const out = [];
  let x = x0;
  let y = y0;
  let rowH = 0;
  (sizes || []).forEach((s, i) => {
    if (i && i % perRow === 0) { x = x0; y += rowH + gap; rowH = 0; }
    out.push({ x, y });
    x += (Number(s && s.w) || 220) + gap;
    rowH = Math.max(rowH, Number(s && s.h) || 120);
  });
  return out;
}

/**
 * `slotsFor`, made to fit what the person can SEE: as many boxes to a row as the visible width
 * holds (at least one, at most `DROP_PER_ROW`), and the whole group slid left/up just enough to
 * sit inside the view. Without this the canvas pulls each box back into view on its own, and a
 * drop near the right edge stacks the boxes on top of each other.
 * @param {{x: number, y: number}} at the world point of the drop
 * @param {{w?: number, h?: number}[]} sizes
 * @param {{x: number, y: number, w: number, h: number, margin?: number}|null} bounds the visible
 *   world rectangle; null = no view known, plain `slotsFor`
 * @param {{gap?: number}} [o]
 * @returns {{x: number, y: number}[]}
 */
export function fitSlots(at, sizes, bounds, o = {}) {
  const list = sizes || [];
  if (!bounds || !(Number(bounds.w) > 0) || !(Number(bounds.h) > 0)) return slotsFor(at, list, o);
  const gap = Number.isFinite(o.gap) ? Number(o.gap) : DROP_GAP;
  const m = Number(bounds.margin) || 0;
  const room = Number(bounds.w) - 2 * m;
  const widthOf = (/** @type {any} */ s) => Number(s && s.w) || 220;
  /** The widest row `k` boxes to a row makes. @param {number} k */
  const widest = (k) => {
    let best = 0;
    for (let i = 0; i < list.length; i += k) {
      const row = list.slice(i, i + k);
      best = Math.max(best, row.reduce((sum, s) => sum + widthOf(s), 0) + gap * (row.length - 1));
    }
    return best;
  };
  let perRow = Math.max(1, Math.min(DROP_PER_ROW, list.length || 1));
  while (perRow > 1 && widest(perRow) > room) perRow -= 1;
  const slots = slotsFor(at, list, { gap, perRow });
  if (!slots.length) return slots;
  let right = -Infinity;
  let bottom = -Infinity;
  slots.forEach((p, i) => {
    right = Math.max(right, p.x + widthOf(list[i]));
    bottom = Math.max(bottom, p.y + (Number(list[i] && list[i].h) || 120));
  });
  const left = slots[0].x;
  const top = slots[0].y;
  // Slide back from the right/bottom edge, but never past the left/top one: a group bigger than
  // the view keeps its first box where the person can see it.
  let dx = Math.min(0, Number(bounds.x) + Number(bounds.w) - m - right);
  let dy = Math.min(0, Number(bounds.y) + Number(bounds.h) - m - bottom);
  dx = Math.max(dx, Number(bounds.x) + m - left);
  dy = Math.max(dy, Number(bounds.y) + m - top);
  return slots.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** How a refusal names a file's type: its MIME type, else its extension, else ''.
 * @param {{name?: string, type?: string}} file @returns {string} */
export function describeType(file) {
  const type = String((file && file.type) || '').trim();
  if (type) return type;
  const ext = extOf(String((file && file.name) || ''));
  return ext ? '.' + ext : '';
}

/** Is this text, or bytes that only decoded as text? A NUL in the first 8 KB means a binary
 * file wearing a text extension — a Text box full of replacement characters helps nobody.
 * @param {string} text @returns {boolean} */
export function looksLikeText(text) {
  return String(text || '').slice(0, 8192).indexOf('\u0000') < 0;
}
