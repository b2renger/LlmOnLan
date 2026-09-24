// @ts-check
// Text (C1's `note`, renamed at the K4 kickoff) — the box you type into AND the box an answer
// lands in. COMPUTER_PLAN §6.2 revision 2, amended by the K4 kickoff addendum KD-4 (the owner's
// requirement: "text boxes with input and output… render generated text from instruct or other
// boxes into those text boxes").
//
// THE TYPE ID IS STILL `note`. Every stored graph, every migration, the unit tests and the harness
// scenarios name it; a rename would be a migration bought to get a nicer word. The FILE and the
// LABEL are Text, which is what a reader sees and what tldraw calls it.
//
// THE FOUR RULES THIS FILE EXISTS TO KEEP
//
// 1. A RUN NEVER WRITES THE PROGRAM. An arriving value becomes the part's VALUE (the runner's
//    `session.patchPart`, runtime-only, not undoable, stales nothing). `settings.text` is changed
//    by the person typing and by nothing else. The body renders the VALUE when one exists and
//    falls back to `settings.text` when it does not — which is why this needs no new machinery
//    and why the §6.2 loop (Instruction → game-state Text → Toggle → …) behaves as drawn.
// 2. NOTHING WIRED IN ⇒ EXACTLY TODAY'S BEHAVIOUR. A literal. `thinks:false`, never a generation,
//    never a seat. That is what makes a Text box free to use as a comment.
// 3. MODEL TEXT BECOMES NODES THROUGH `render/dom.mjs` AND NOTHING ELSE. `parseBlocks()` +
//    `renderBlocks(blocks, domFactory(document))` — the same safe path the thread uses. No
//    innerHTML, no second parser, no sanitiser of its own.
// 4. IT MUST BE IMPOSSIBLE TO LOSE TYPING SILENTLY. Two guards, and the second is not optional:
//    the LOCK ("keep what I typed") and the open source editor. Either one makes a run keep the
//    person's words and say so quietly, instead of painting an answer over them.

import { valueOf, isValue, valueStamp } from '../values.mjs';
import { textOf } from './common.mjs';
import { parseBlocks } from '../../render/md-block.mjs';
import { domFactory, renderBlocks } from '../../render/dom.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-text.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphPart} GraphPart */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

// ---------------------------------------------------------------------------------------------
// Runtime registries. Keyed by part id, never persisted, never in the document — a run is not an
// edit of the program (rule 1), and none of these three facts belongs in a saved graph.
// ---------------------------------------------------------------------------------------------

/** Boxes whose source editor is open: a run must not paint over an edit in progress (rule 4). */
const EDITING = new Set();

/** Why the last run kept the person's words: `'locked'` or `'unsaved'`. Written by `run()`, read
 * by the box when the canvas repaints it — which the runner's own `patchPart` guarantees happens
 * right after, because the state moves to `done`. */
const REFUSED = new Map();

/** The `valueStamp` of an arrival the person dismissed with ↺ Clear. A re-run makes a NEW value
 * object with a new stamp, so a dismissal never outlives the thing it dismissed. */
const DISMISSED = new Map();

/** @param {any} id @returns {string} */
const key = (id) => String(id == null ? '' : id);

/** How much of a value the body renders. A text GraphValue may be MAX_VALUE_BYTES (1 MB) and the
 * port is `many`, so several wires are joined before this sees them; measured on this box, a
 * megabyte is ~0.44 s of parse+build on the main thread. The box is 320 px tall and scrolls: past
 * this much nobody was going to read it in here anyway, and the WHOLE value still travels on the
 * wire, is still saved and is still what Save… writes. */
export const MAX_RENDER_CHARS = 64 * 1024;

/** Is this box's source editor open? Read by `run()`. @param {any} id @returns {boolean} */
export function isEditing(id) { return EDITING.has(key(id)); }

/** Why the last run kept what was typed: `'locked'`, `'unsaved'` or `''`.
 * @param {any} id @returns {string} */
export function refusalOf(id) { return REFUSED.get(key(id)) || ''; }

/** Drop the arrival this box is showing and reveal the typed text again. View-level and runtime
 * only: the value on the wire is whatever the last run produced until the next run replaces it.
 * (A door that clears `part.value` from the document is a `canvas.mjs` conversation — filed as a
 * contract request, not invented here.) @param {any} id @param {GraphValue|null} value */
export function dismiss(id, value) {
  const stamp = valueStamp(value);
  if (stamp) DISMISSED.set(key(id), stamp);
  REFUSED.delete(key(id));
}

/** Forget everything remembered about one box. @param {any} id */
export function forget(id) {
  EDITING.delete(key(id));
  REFUSED.delete(key(id));
  DISMISSED.delete(key(id));
}

// ---------------------------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------------------------

/** The text the person typed. @param {any} settings @returns {string} */
export function ownText(settings) {
  const s = settings || {};
  return String(s.text == null ? '' : s.text);
}

/** tldraw's 🔒: "keep what I typed". @param {any} settings @returns {boolean} */
export function isLocked(settings) {
  return !!(settings && /** @type {any} */ (settings).locked);
}

/**
 * What a run makes of what arrived. PURE.
 *
 * One text arrival passes through VERBATIM — facets and all — so a Code part's
 * `{format:'code', lang:'js'}` survives the box it landed in and the Instruction downstream still
 * fences it (§5.3). Anything else becomes text the honest way, through `textOf()`: a json is its
 * pretty printing, a list is its items one per line, several wires are separated by a blank line
 * so the markdown of one report never runs into the next.
 * @param {(GraphValue|null)[]} values @returns {GraphValue}
 */
export function adopt(values) {
  const list = (Array.isArray(values) ? values : []).filter(isValue);
  if (!list.length) return valueOf('text', '');
  if (list.length === 1 && /** @type {any} */ (list[0]).kind === 'text') return /** @type {any} */ (list[0]);
  return valueOf('text', list.map(textOf).join('\n\n'));
}

/**
 * What the body shows, and where it came from. PURE — the dismissal is passed in.
 *
 * `from:'input'` is the only case that earns the "from input" marker: a value that is WORD FOR
 * WORD what the person typed (a locked box, or a box with nothing wired in) came from them, and
 * saying otherwise would be a small lie told on every run.
 * @param {any} part @param {number} [dismissed] the stamp the person cleared, 0 for none
 * @returns {{text: string, from: 'own'|'input'}}
 */
export function bodyOf(part, dismissed) {
  const p = part || {};
  const own = ownText(p.settings);
  const value = p.value;
  if (!isValue(value)) return { text: own, from: 'own' };
  if (dismissed && valueStamp(value) === dismissed) return { text: own, from: 'own' };
  const text = textOf(value);
  if (text === own) return { text: own, from: 'own' };
  return { text, from: 'input' };
}

/** `bodyOf` against this box's live dismissal. @param {any} part
 * @returns {{text: string, from: 'own'|'input'}} */
export function shown(part) {
  return bodyOf(part, DISMISSED.get(key(part && part.id)) || 0);
}

// ---------------------------------------------------------------------------------------------
// The part
// ---------------------------------------------------------------------------------------------

/** @param {string} cls @param {string} label @param {string} title @param {() => void} onClick */
function iconButton(cls, label, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', (/** @type {any} */ ev) => {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    onClick();
  });
  return b;
}

/** @type {PartSpec} */
export const textPart = /** @type {any} */ ({
  type: 'note',
  order: 100,
  label: t('parts.textLabel'),
  thinks: false,
  // It draws its own value as markdown, so the canvas must not print the same words a second time
  // in the foot strip (KD-3: `quiet` is read in graph/canvas.mjs syncBox() and nowhere else).
  quiet: true,
  size: { w: 260, h: 170 },
  // K6 kickoff (addendum KF-4): a .txt/.md/.csv/.json dropped on the canvas becomes a Text box
  // holding the file's contents, typed-text-equivalent (the person's own words, undoable).
  holds: 'text',
  adopt: (/** @type {any} */ p) => ({ text: String((p && p.text) || '') }),
  // The honest minimum (KD-4). `image` and `file` are deliberately absent: there is no honest
  // text for either (values.mjs has no `text <- image` row at all), so the wire refusal names the
  // port and says what to do instead rather than a box quietly showing the word "image".
  // A `list` is ACCEPTED, which is what stops a forty-item list fanning this box into forty runs:
  // a Text box shows the whole report, it does not multiply.
  inputs: [{ name: 'in', label: t('parts.textIn'), accepts: ['text', 'json', 'list'], many: true }],
  output: 'text',
  defaults: () => ({ text: '', locked: false }),

  render(host, part, ctx) {
    const id = key(part.id);
    /** The part as the canvas last painted it — `ctx.part` is the one handed in at render time. */
    let live = part;
    /** Is the source editor open? While it is, a run keeps the person's words (rule 4). */
    let editing = false;
    /** Has this edit typed anything yet? The first keystroke is what claims an arrival. */
    let editingOwn = false;
    /** The text the rendered body was last built from, so panning and re-runs never re-parse. */
    let parsedFor = /** @type {string|null} */ (null);

    const wrap = document.createElement('div');
    wrap.className = 'graph-text';

    // ---- the head: where the content came from, and the two controls that decide that ---------
    const head = document.createElement('div');
    head.className = 'graph-text-head';
    const from = document.createElement('span');
    from.className = 'graph-text-from';
    from.hidden = true;
    const clear = iconButton('graph-text-clear', t('parts.textClear'), t('parts.textClearHint'), () => {
      dismiss(id, live.value);
      parsedFor = null;
      paint();
    });
    clear.hidden = true;
    const lock = iconButton('graph-text-lock', t('parts.textLock'), t('parts.textLockOff'), () => {
      const next = !isLocked(live.settings);
      ctx.update({ locked: next });
      ctx.commit(t('parts.textLock'));
      if (next) REFUSED.delete(id);
      // The canvas will hand the edited part back through `update()`; until it does, the control
      // shows what was just pressed rather than what it was pressed away from.
      live = { ...live, settings: { ...(live.settings || {}), locked: next } };
      paintHead();
    });
    lock.dataset.part = id;
    head.append(from, clear, lock);

    // ---- the body: the value as markdown, through the one safe path -------------------------
    const body = document.createElement('div');
    body.className = 'graph-text-body';
    body.dataset.part = id;
    body.hidden = true;
    body.addEventListener('click', (/** @type {any} */ ev) => {
      // A link in a rendered answer is a link, not an invitation to edit.
      const target = ev && ev.target;
      if (target && typeof target.closest === 'function' && target.closest('a')) return;
      startEdit();
    });

    // ---- the source: exactly the textarea C1 shipped, and it still behaves that way ----------
    const area = document.createElement('textarea');
    area.className = 'graph-note-text graph-text-source';
    area.setAttribute('aria-label', t('parts.textLabel'));
    area.placeholder = t('parts.textPlaceholder');
    area.value = ownText(part.settings);
    // Typing is live (so a wired Instruction's preview updates); committing is what enters undo —
    // one history entry per edit, not one per keystroke.
    area.addEventListener('input', () => {
      // TAKE THE EDITING LOCK FIRST, and take the INSTANCE one too. `ctx.update()` below reaches
      // the document, and the canvas hands the edited part straight back to `update()` on the same
      // turn — which repaints. With only the module-level `EDITING` set, `editing` was still false
      // there, `paintBody()` saw a box with text and hid the textarea the person was typing into:
      // the first keystroke landed and the second went nowhere. `false` = do not re-seed the
      // field, because what it holds is what was just typed.
      beginEdit(false);
      // The first keystroke on a box that was showing an ARRIVAL makes the words yours: the
      // dismissal is what stops the answer snapping back over your edit the moment you click
      // away. Opening the editor and closing it again without typing changes nothing.
      if (!editingOwn) { editingOwn = true; dismiss(id, live.value); }
      ctx.update({ text: area.value });
    });
    // Focus is the other way in: a fresh box shows its textarea directly (no body to click), and
    // tabbing or clicking into it must take the same lock a body click takes.
    area.addEventListener('focus', () => startEdit());
    area.addEventListener('change', () => closeEdit());
    area.addEventListener('blur', () => closeEdit());

    // ---- the quiet line that says a run kept your words --------------------------------------
    const notice = document.createElement('p');
    notice.className = 'graph-text-notice';
    notice.hidden = true;

    wrap.append(head, body, area, notice);
    host.replaceChildren(wrap);

    /**
     * Take the editing lock. ONE function, because two ways in must leave the box in one state:
     * the module-level `EDITING` (which `run()` reads) and the instance `editing` (which the paint
     * reads) are either both taken or neither is.
     * @param {boolean} seed re-seed the field from what is SHOWN and put the caret in it — true
     *   when the reader opened the editor (a body click), false when they are already typing in
     *   it, where re-seeding would overwrite the keystroke that got us here.
     */
    function beginEdit(seed) {
      if (editing) return;
      editing = true;
      editingOwn = false;
      EDITING.add(id);
      REFUSED.delete(id);
      if (seed) area.value = shown(live).text;
      paint();
      // A detached box cannot take focus, and nothing here depends on it.
      if (seed) { try { area.focus(); } catch { /* not in the document yet */ } }
    }

    /** Open the source on what is currently SHOWN: editing an answer is how an answer becomes
     * yours, and the first keystroke is what writes it to `settings.text`. */
    function startEdit() { beginEdit(true); }

    /** Blur or change: the edit is over. `ctx.commit` is idempotent, so both may fire, and the
     * repaint is what puts the rendered body back. */
    function closeEdit() {
      EDITING.delete(id);
      ctx.commit(t('parts.textLabel'));
      if (!editing) return;
      editing = false;
      parsedFor = null;
      paint();
    }

    function paintHead() {
      const s = shown(live);
      const locked = isLocked(live.settings);
      lock.setAttribute('aria-pressed', locked ? 'true' : 'false');
      lock.title = locked ? t('parts.textLockOn') : t('parts.textLockOff');
      const mark = editing ? t('parts.textEditing')
        : locked ? t('parts.textLocked')
          : s.from === 'input' ? t('parts.textFromInput') : '';
      from.textContent = mark;
      from.hidden = !mark;
      from.dataset.from = editing ? 'editing' : locked ? 'locked' : s.from;
      clear.hidden = editing || s.from !== 'input';
      const why = REFUSED.get(id) || '';
      const said = why === 'locked' ? t('parts.textRefused')
        : why === 'unsaved' ? t('parts.textRefusedUnsaved') : '';
      notice.textContent = said;
      notice.hidden = !said;
      notice.dataset.why = why;
    }

    function paintBody() {
      const s = shown(live);
      // An empty box is a textarea, exactly as it has always been: a fresh Text box must still be
      // something you can type into without first clicking it. `editing` — taken by a body click,
      // by focus AND by the first keystroke — is what guarantees the field the caret is in is
      // never the thing this hides.
      const source = editing || !s.text;
      area.hidden = !source;
      body.hidden = source;
      if (source) {
        if (!editing && document.activeElement !== area) area.value = ownText(live.settings);
        parsedFor = null;
        return;
      }
      if (parsedFor === s.text) return;
      parsedFor = s.text;
      // A CEILING on what is parsed and built. A text value may be up to MAX_VALUE_BYTES, and a
      // Collect of forty answers lands in ONE box: a megabyte of markdown is ~0.4 s of main-thread
      // work, on every new value and on every loop turn. The box is 320 px tall and scrolls, so
      // the tail below the cut was never reachable anyway — we render the head and say so.
      const whole = s.text;
      const cut = whole.length > MAX_RENDER_CHARS;
      const upTo = cut ? whole.slice(0, MAX_RENDER_CHARS) : whole;
      const node = renderBlocks(parseBlocks(upTo), domFactory(document));
      if (!cut) { body.replaceChildren(node); return; }
      const more = document.createElement('p');
      more.className = 'graph-text-notice';
      more.dataset.why = 'long';
      more.textContent = t('parts.textTruncated', { kb: Math.round(MAX_RENDER_CHARS / 1024) });
      body.replaceChildren(node, more);
    }

    function paint() {
      paintBody();
      paintHead();
    }

    paint();

    return {
      /** @param {any} next */
      update(next) {
        live = next;
        // Rule 4: an arrival never paints over an open editor. The head still updates, so the box
        // can say the run kept your words while you were typing.
        if (editing) { paintHead(); return; }
        paint();
      },
      destroy() {
        forget(id);
        wrap.remove();
      },
    };
  },

  async run(input) {
    const part = input.part || /** @type {any} */ ({});
    const id = key(part.id);
    const own = ownText(part.settings);
    const arrivals = (input.inputs && input.inputs.in) || [];

    // Nothing wired in: the literal C1 shipped, and not one byte more.
    if (!arrivals.length) { REFUSED.delete(id); return valueOf('text', own); }

    // "Keep what I typed" — and still pass it on downstream, so a locked box is a constant in a
    // loop rather than a hole in it.
    if (isLocked(part.settings)) { REFUSED.set(id, 'locked'); return valueOf('text', own); }

    // Stronger than the lock and not optional: the source editor is open, so the answer waits.
    if (isEditing(id)) { REFUSED.set(id, 'unsaved'); return valueOf('text', own); }

    REFUSED.delete(id);
    DISMISSED.delete(id);
    return adopt(arrivals);
  },
});
