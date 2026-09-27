// @ts-check
// The farm strip: one honest line under the topline (plan §4 P2-U1, §3.5, §3.9). A FEATURE.
//
// What it is for: on a shared farm the answer to "why is this slow / why did it change model /
// can I even send" is public information the snapshot already carries. v0.1.45 showed none of it,
// so every question came to the operator.
//
// Rules this file obeys, and the reason for each:
//   - NEVER a dash for a missing value. A farm that advertises no GPU usage must simply not have a
//     GPU field — "GPU —" reads as a broken farm.
//   - one line, ellipsised (css/strip.css), with the FULL list in the title attribute, so a narrow
//     window loses nothing.
//   - it repaints on EV.FARM_TICK and EV.FARM_CHANGE only (§3.9): the "farm silent" verdict is a
//     wall-clock rule and must be evaluated on the farm's own heartbeat, never on a timer of ours.
//   - els.strip is this module's region (§2.6 AE): nothing else writes into it.

import { EV } from '../core/events.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/etiquette.en.mjs';
import '../strings/core.en.mjs';

/** §3.9: a snapshot older than this (or flagged _stale by discovery) means the farm went quiet. */
export const SILENT_AFTER_MS = 15000;

/**
 * PURE. The fields of the strip, in order, from what is actually known.
 * @param {{caps: any, model: string|null, now: number}} o
 * @returns {{id: string, text: string}[]}
 */
export function stripFields({ caps, model, now }) {
  /** @type {{id: string, text: string}[]} */
  const out = [];
  if (!caps || !caps.present) return out;

  const silent = !!caps.stale || (caps.lastSeen != null && now - caps.lastSeen > SILENT_AFTER_MS);
  if (silent) out.push({ id: 'silent', text: t('etiquette.stripSilent') });
  if (caps.keyMissing) out.push({ id: 'key', text: t('etiquette.stripPasswordNeeded') });

  if (model) {
    const info = (caps.models || []).find((/** @type {any} */ m) => m && m.id === model) || null;
    const underlying = info && info.underlying ? String(info.underlying) : null;
    out.push({
      id: 'model',
      text: underlying && underlying !== model ? t('etiquette.stripModelUnderlying', { model, underlying }) : model,
    });
  }
  if (caps.engine) out.push({ id: 'engine', text: String(caps.engine) });
  if (caps.seats) out.push({ id: 'seats', text: t('etiquette.stripSeats', { used: caps.seats.used, slots: caps.seats.slots }) });
  if (caps.gpuUtil != null) out.push({ id: 'gpu', text: t('etiquette.stripGpu', { percent: Math.round(caps.gpuUtil) }) });

  const tokSec = caps.perf && Number.isFinite(Number(caps.perf.lastGenTokSec)) ? Number(caps.perf.lastGenTokSec) : null;
  if (tokSec != null) out.push({ id: 'tokSec', text: t('etiquette.stripTokSec', { tokPerSec: Math.round(tokSec) }) });

  if (caps.busy && caps.busy.label) {
    const percent = caps.busy.percent != null ? t('core.busyPercent', { percent: caps.busy.percent }) : '';
    out.push({ id: 'busy', text: t('etiquette.stripBusy', { label: caps.busy.label, percent }) });
  }
  return out;
}

/** @param {any} app */
export function install(app) {
  const el = app.els && app.els.strip;
  if (!el) return;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', t('etiquette.stripLabel'));

  let lastKey = null;

  /** The model the next send would use, as the picker has it. Never throws the strip down. */
  function modelId() {
    try {
      const v = app.picker && typeof app.picker.value === 'function' ? app.picker.value() : null;
      return v || null;
    } catch {
      return null;
    }
  }

  function render() {
    const caps = app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null;
    const fields = stripFields({ caps, model: modelId(), now: app.now() });
    const key = JSON.stringify(fields);
    if (key === lastKey) return;
    lastKey = key;

    // Own region, so a wholesale rebuild is allowed here and nowhere else (§2.6 AE).
    el.replaceChildren();
    for (const f of fields) {
      const span = document.createElement('span');
      span.className = 'chat-strip-field';
      span.setAttribute('data-field', f.id);
      span.textContent = f.text;
      el.appendChild(span);
    }
    // The full list, one per line: the single line above may be ellipsised to nothing on a narrow
    // window, and the strip is the only place some of this is ever shown.
    if (fields.length) el.title = fields.map((f) => f.text).join('\n');
    else el.removeAttribute('title');
  }

  render();
  app.bus.on(EV.FARM_TICK, render);
  app.bus.on(EV.FARM_CHANGE, render);
  // The model is the one field that is NOT a farm value: it comes from the picker beside the strip.
  // Bound only to the farm's clock, it lagged a deliberate model switch by a whole publish interval
  // (4 s in production), so the strip and the picker disagreed on screen (P2 review). `lastKey`
  // makes a render that changes nothing free, so these two are cheap.
  if (app.els && app.els.model) {
    app.els.model.addEventListener('change', render);
    // …and a PROGRAMMATIC pick fires no 'change': the picker announces those itself (boot, the
    // farm's catalog landing, §3.10 re-applying a thread's pick). Without this the strip's most
    // read field was simply missing for up to a publish interval after every launch (P2 review).
    app.els.model.addEventListener('lolchat:model', render);
  }
  app.bus.on(EV.THREAD_SELECTED, render);
  // Debug surface for the harness and for a future "why does the strip say that" question.
  app.strip = { render, fields: () => stripFields({ caps: app.farm ? app.farm.get() : null, model: modelId(), now: app.now() }) };
}
