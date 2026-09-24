// @ts-check
// Button (K3-U2, COMPUTER_PLAN §6.6) — the manual gate. `manual:true` keeps it out of every
// Run-all active set, so the plan preview says `2 buttons not pressed` instead of quietly spending
// on a branch nobody asked for. Clicking its face IS `run({mode:'from', seeds:[id]})` — its face
// and its ▶ do the same thing, which is the whole point.
//
// THE RULE THAT MAKES AN EXPENSIVE BRANCH SAFE, and the only subtle thing in this file: a Button
// WITH inputs BARS unless it was pressed. An upstream wave arriving at an unpressed Button stops
// there, the box glows "ready — click to continue", and the value still flows (§4.5) so anything
// that runs for another reason reads straight through it. Press it and the wave carries on.
//
// How the part knows it was pressed, without reaching for the runner: the face records the press
// HERE, in this module, and `run()` CONSUMES it. The canvas separately routes the same click to
// `onPlay`, which starts the push run — two readers of one gesture, and neither part nor canvas
// has to be told what the other did. A press is consumed by the activation it authorised, so the
// next wave through the same Button waits for the next press.

import { valueOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { textField } from './fields.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** Presses waiting to be spent, by part id. Module state, like the park registry, because only
 * the Computer runs graphs and `render()` and `run()` are different calls on different objects.
 * @type {Set<string>} */
const presses = new Set();

/** Parts whose last activation BARRED — an upstream wave reached them unpressed. Read by the box's
 * own paint so it can say "ready — click to continue" in the place the reader is already looking.
 * @type {Set<string>} */
const ready = new Set();

/** Record a press. Exported so a test can press without a DOM. @param {string} partId */
export function notePress(partId) {
  const id = String(partId || '');
  if (!id) return;
  presses.add(id);
  ready.delete(id);
}

/** Spend a press, if there is one. @param {string} partId @returns {boolean} */
export function consumePress(partId) {
  const id = String(partId || '');
  const had = presses.has(id);
  presses.delete(id);
  return had;
}

/** Is this Button holding back a wave right now? @param {string} partId @returns {boolean} */
export function isReady(partId) {
  return ready.has(String(partId || ''));
}

/** Forget every press and every held wave — a document close, and the unit test between cases. */
export function clearPresses() {
  presses.clear();
  ready.clear();
}

/** @type {PartSpec} */
export const button = /** @type {any} */ ({
  type: 'button',
  // K6 fix round: what arrives goes on unchanged, so graph/takes.mjs looks THROUGH this box for the
  // model a picture or a sound is headed to.
  passes: true,
  order: 600,
  label: t('parts.btnLabel'),
  thinks: false,
  control: true,
  manual: true,
  size: { w: 200, h: 120 },
  inputs: [{ name: 'in', label: t('parts.ctlIn'), accepts: ['any'], many: true, required: false }],
  output: 'any',
  defaults: () => ({ text: '' }),

  render(host, part, ctx) {
    const face = document.createElement('button');
    face.type = 'button';
    face.className = 'graph-part-control graph-btn-face';
    face.dataset.action = 'press';
    face.dataset.part = part.id;
    const name = textField(t('parts.btnText'), String(part.settings.text || ''), {
      onInput: (v) => ctx.update({ text: v }),
      onCommit: () => ctx.commit(t('parts.btnText')),
    });
    const hint = document.createElement('p');
    hint.className = 'graph-part-hint graph-btn-hint';
    host.replaceChildren(face, name.node, hint);
    const paint = (/** @type {any} */ p) => {
      name.update(String(p.settings.text || ''));
      face.textContent = String(p.settings.text || '') || t('parts.btnPress');
      const held = isReady(p.id);
      face.dataset.ready = held ? 'true' : 'false';
      hint.textContent = held ? t('parts.btnReady') : t('parts.btnHint');
    };
    // The canvas (K3-U3) routes [data-action=press] to run({mode:'from', seeds:[partId]}). The
    // part does NOT call the runner itself: a part that starts runs is a second scheduler. What it
    // does do is remember that a human asked — see the header.
    face.addEventListener('click', () => { notePress(part.id); paint(ctx.part || part); });
    paint(part);
    return { update: paint, destroy() { host.replaceChildren(); } };
  },

  async run({ part, inputs }) {
    const list = (inputs && inputs.in) || [];
    const pressed = consumePress(part.id);
    ready.delete(part.id);
    // Unwired: the press itself is the value, so downstream has something to key on (§6.6), and
    // there is nothing to hold back — an unwired Button only ever runs because it was pressed.
    if (!list.length) return { value: valueOf('json', { pressed: true }), bar: false };
    // Fed: pressing it means "continue", so a press never bars. A wave that got here WITHOUT one
    // stops, and says so on the box.
    if (!pressed) ready.add(part.id);
    return { value: list[0], bar: !pressed };
  },
});
