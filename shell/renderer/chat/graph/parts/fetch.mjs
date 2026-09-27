// @ts-check
// Fetch (docs/ECOSYSTEM_PLAN.md v2 §4.2) — the Computer's way in for data: ONE GET of an address a
// PERSON typed (the box has no input port, so a model can never choose where it reads from). The
// request runs in the main process (projects/bridge.mjs ioDoor → src/main/io.ts), which refuses
// this machine, link-local addresses and the farm's ports, and caps the answer at 1 MB of text.
//
// What comes out: a JSON answer becomes a JSON value (a top-level array becomes a list, which fans
// out like any list); anything else is text, tagged html when the source says so.
//
// Offline: a run that cannot reach the network (no route, DNS, timeout) hands on the value the box
// already holds — the last copy it read, or the one a template shipped with — and SAYS so on its
// face. A refusal or an HTTP error never falls back: those are the reader's to fix.
//
// Like the Code box's line chip, the face's status line is a render HINT, not document state
// (a part may only write value/state/error/stats/fanout, BG-5): a module-level map keyed by part id.

import { fromPlain, valueOf, isValue } from '../values.mjs';
import { partFail } from './common.mjs';
import { ioDoor } from '../../projects/bridge.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-fetch.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** A literal map, so lint rule 5 can see every key a person may read. */
const ERR_KEY = {
  E_URL: 'parts.fetchErr_E_URL',
  E_SCHEME: 'parts.fetchErr_E_SCHEME',
  E_CREDENTIALS: 'parts.fetchErr_E_CREDENTIALS',
  E_FARM: 'parts.fetchErr_E_FARM',
  E_LOCAL: 'parts.fetchErr_E_LOCAL',
  E_DNS: 'parts.fetchErr_E_DNS',
  E_TIMEOUT: 'parts.fetchErr_E_TIMEOUT',
  E_SIZE: 'parts.fetchErr_E_SIZE',
  E_TYPE: 'parts.fetchErr_E_TYPE',
  E_HTTP: 'parts.fetchErr_E_HTTP',
  E_REDIRECTS: 'parts.fetchErr_E_REDIRECTS',
  E_NET: 'parts.fetchErr_E_NET',
  E_HOST: 'parts.fetchErr_E_HOST',
};

/** The failures that mean "no network right now" — the only ones the last copy may cover. */
const OFFLINE = new Set(['E_NET', 'E_DNS', 'E_TIMEOUT']);

/** partId -> {text, offline} for the face. Never persisted. */
const notes = new Map();

/** The sentence for a failed answer. @param {any} r @returns {string} */
export function fetchError(r) {
  const code = r && Object.prototype.hasOwnProperty.call(ERR_KEY, r.code) ? r.code : 'E_NET';
  return t(/** @type {any} */ (ERR_KEY)[code], { status: r && r.status != null ? r.status : '', message: String((r && r.message) || '') });
}

/**
 * PURE: an answer's text → the value the box hands on.
 * @param {{text: string, contentType: string}} r @returns {import('../../core/types.mjs').GraphValue}
 */
export function valueFromAnswer(r) {
  const text = String(r.text || '');
  const ct = String(r.contentType || '').toLowerCase();
  const head = text.trimStart()[0];
  if (/json/.test(ct) || ((head === '{' || head === '[') && !/html|xml/.test(ct))) {
    try {
      const v = fromPlain(JSON.parse(text));
      if (v) return v;
    } catch { /* not JSON after all: hand it on as text */ }
  }
  return valueOf('text', text, /html/.test(ct) ? { format: 'html' } : undefined);
}

/** @type {PartSpec} */
export const fetchPart = /** @type {any} */ ({
  type: 'fetch',
  order: 32,
  label: t('parts.fetchLabel'),
  thinks: false,
  size: { w: 320, h: 130 },
  inputs: [],
  output: 'json',
  defaults: () => ({ url: '' }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-fetch';
    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'graph-fetch-url';
    input.spellcheck = false;
    input.placeholder = t('parts.fetchUrlPlaceholder');
    input.title = t('parts.fetchUrlHint');
    input.setAttribute('aria-label', t('parts.fetchUrl'));
    input.value = String(part.settings.url || '');
    input.addEventListener('input', () => ctx.update({ url: input.value }));
    input.addEventListener('change', () => ctx.commit(t('parts.fetchUrl')));
    const status = document.createElement('div');
    status.className = 'graph-fetch-status';
    wrap.append(input, status);
    host.replaceChildren(wrap);

    /** @param {any} p */
    const paint = (p) => {
      const note = notes.get(String(p.id));
      status.textContent = note ? note.text : '';
      status.classList.toggle('offline', !!(note && note.offline));
    };
    paint(part);
    return {
      update(next) {
        if (document.activeElement !== input) input.value = String(next.settings.url || '');
        paint(next);
      },
      destroy() { wrap.remove(); },
    };
  },

  async run(input) {
    const id = String(input.part.id);
    const url = String(input.part.settings.url || '').trim();
    if (!url) throw partFail(t('parts.fetchNoUrl'), 'empty');
    const door = ioDoor();
    if (!door) throw partFail(t('parts.fetchNoDoor'), 'part');
    const r = await door.get(url);
    if (!r || r.ok !== true) {
      const message = fetchError(r);
      const prev = input.part.value;
      if (r && OFFLINE.has(r.code) && isValue(prev)) {
        notes.set(id, { text: t('parts.fetchOffline', { message }), offline: true });
        return prev;
      }
      notes.delete(id);
      throw partFail(message, 'part');
    }
    let hostName = '';
    try { hostName = new URL(r.url).host; } catch { /* the main side sent a URL; keep going */ }
    notes.set(id, {
      text: t('parts.fetchStatus', { status: r.status, kb: Math.max(1, Math.round(Number(r.bytes || 0) / 1024)), host: hostName }),
      offline: false,
    });
    return valueFromAnswer(r);
  },
});
