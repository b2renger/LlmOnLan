// @ts-check
// C2 — the small controls the fan-out parts share (Split, Repeat, Filter), and the one line that
// makes a list READABLE AT A GLANCE on the canvas.
//
// Why a file of its own rather than more of common.mjs: common.mjs is C1's part-facing contract
// (how a part fails, how a value becomes text) and every unit imports it; these are three DOM
// helpers with no contract value outside this family. Nothing here talks to the farm, the store or
// the clock — a control writes through PartCtx and nothing else.
//
// THE COUNT LINE. The canvas already paints `preview(value)` — the first items, joined and
// truncated. What it cannot say is HOW MANY there are, which is the number that decides whether a
// fan-out is about to spend three generations or forty. `itemsLine()` is that missing half: one
// muted line under the settings reading "40 items", and nothing at all when the part has no list.

import { t } from '../../core/i18n.mjs';
import { itemsOf } from '../values.mjs';

/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

/** A labelled text input. `onInput` fires per keystroke, `onCommit` closes the undo entry.
 * @param {string} label @param {string} value
 * @param {{onInput(v: string): void, onCommit(): void, placeholder?: string}} handlers
 * @returns {{node: any, input: any, update(v: string): void}}
 */
export function textField(label, value, handlers) {
  const node = document.createElement('label');
  node.className = 'graph-part-field';
  const caption = document.createElement('span');
  caption.className = 'graph-part-field-label';
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'graph-part-input';
  if (handlers.placeholder) input.placeholder = handlers.placeholder;
  input.value = String(value == null ? '' : value);
  input.addEventListener('input', () => handlers.onInput(input.value));
  input.addEventListener('change', () => handlers.onCommit());
  node.append(caption, input);
  return {
    node,
    input,
    // Never overwrite what the reader is typing into (the same rule the model picker follows).
    update(v) { if (document.activeElement !== input) input.value = String(v == null ? '' : v); },
  };
}

/** A labelled whole-number input, floored at `min` on every commit — an out-of-range number is
 * corrected in the box the reader can see, never silently behind it.
 * @param {string} label @param {number} value @param {number} min @param {(n: number) => void} onCommit
 * @param {number} [max]
 * @returns {{node: any, input: any, update(n: number): void}}
 */
export function numberField(label, value, min, onCommit, max) {
  const node = document.createElement('label');
  node.className = 'graph-part-field';
  const caption = document.createElement('span');
  caption.className = 'graph-part-field-label';
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'graph-part-input';
  input.min = String(min);
  if (Number.isFinite(max)) input.max = String(max);
  input.value = String(clamp(value, min, max));
  input.addEventListener('change', () => {
    const n = clamp(Number(input.value), min, max);
    input.value = String(n);
    onCommit(n);
  });
  node.append(caption, input);
  return {
    node,
    input,
    update(n) { if (document.activeElement !== input) input.value = String(clamp(n, min, max)); },
  };
}

/** A labelled checkbox.
 * @param {string} label @param {boolean} value @param {(on: boolean) => void} onChange
 * @returns {{node: any, input: any, update(on: boolean): void}}
 */
export function checkField(label, value, onChange) {
  const node = document.createElement('label');
  node.className = 'graph-part-field graph-part-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!value;
  input.addEventListener('change', () => onChange(!!input.checked));
  const caption = document.createElement('span');
  caption.className = 'graph-part-field-label';
  caption.textContent = label;
  node.append(input, caption);
  return { node, input, update(on) { input.checked = !!on; } };
}

/** The "40 items" line under a fan-out part's settings. Hidden until the part has a list value.
 * @returns {{node: any, update(value: GraphValue|null): void}} */
export function itemsLine() {
  const node = document.createElement('p');
  node.className = 'graph-part-items';
  node.hidden = true;
  return {
    node,
    update(value) {
      const text = countText(value);
      node.textContent = text;
      node.hidden = !text;
    },
  };
}

/** "1 item" / "40 items" / '' when the value is not a list. @param {GraphValue|null} value
 * @returns {string} */
export function countText(value) {
  const v = /** @type {any} */ (value);
  if (!v || v.kind !== 'list') return '';
  const n = itemsOf(v).length;
  return n === 1 ? t('parts.itemsOne') : t('parts.itemsCount', { n });
}

/** @param {any} n @param {number} min @param {number} [max] @returns {number} */
function clamp(n, min, max) {
  const v = Math.floor(Number(n) || 0);
  const lo = Math.max(min, v);
  return Number.isFinite(max) ? Math.min(/** @type {number} */ (max), lo) : lo;
}
