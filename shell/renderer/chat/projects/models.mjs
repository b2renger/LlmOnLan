// @ts-check
// How much to trust a model with the IDE's edits (docs/IDE_PLAN.md §2; owner: "it should adapt to several models, new
// models will appear"). Measured by the P5-0 spike's edit task (docs/research/p5-spike/run.mjs --task edit): "add a
// speed slider to this page; change nothing else", 3 runs each. A model no one has measured is `unknown`, not bad.
// Pure: no DOM, no store.

/** @typedef {{edits: 'good'|'weak'|'unknown', maxTokens: number, measured: string}} ModelProfile */

/** First match wins; ids are matched on the name the farm serves (an alias hides the model, so it is `unknown`). */
const KNOWN = [
  { re: /^qwen3\.8/i, edits: 'good', maxTokens: 8192, measured: '3/3 edits, 2026-09-28' },
  { re: /^nemotron/i, edits: 'good', maxTokens: 8192, measured: '3/3 edits, 2026-09-28' },
  { re: /^ornith/i, edits: 'unknown', maxTokens: 8192, measured: '2/3 edits, 2026-09-28' },
  { re: /^gemma4/i, edits: 'weak', maxTokens: 4096, measured: '1/3 edits: it thinks itself out of budget, 2026-09-28' },
];

/**
 * The model a project chat should start on: the current one when a person chose it on this thread or it is good at
 * edits; otherwise the first model the farm serves that is (judged on the model behind an alias); otherwise the
 * current one. A person's own pick is never overridden — the panel's model line says what it is.
 * @param {string} current the model on screen @param {Array<{id: string, underlying?: string|null}>} catalog
 * @param {boolean} chosen a person picked `current` on this thread
 * @returns {string}
 */
export function pickEditor(current, catalog, chosen) {
  const list = Array.isArray(catalog) ? catalog : [];
  const good = (/** @type {any} */ m) => profileFor((m && m.underlying) || (m && m.id)).edits === 'good';
  if (chosen && current) return current;
  if (current && good(list.find((m) => m.id === current) || { id: current })) return current;
  const alt = list.find(good);
  return alt ? alt.id : current;
}

/** @param {string|null|undefined} model @returns {ModelProfile} */
export function profileFor(model) {
  const id = String(model || '');
  const hit = KNOWN.find((k) => k.re.test(id));
  return hit
    ? { edits: /** @type {any} */ (hit.edits), maxTokens: hit.maxTokens, measured: hit.measured }
    : { edits: 'unknown', maxTokens: 8192, measured: '' };
}
