// @ts-check
// Open data (owner, 2026-09-27: "paste a dataset link and do an analysis of the data") — a dataset of
// data.gouv.fr, the French government's open-data portal, read through its PUBLIC APIs (the ones the
// datagouv-client Python library wraps; no key, no library): the dataset's description, the whole
// file's column profile computed by data.gouv.fr, and a sample of its rows.
//
// Like Fetch, the box has NO input port: the dataset is the one a PERSON pasted, and every address the
// box asks is derived from it on data.gouv.fr's own two hosts (never a file's producer URL). Each GET is
// one capped request through main (projects/bridge.mjs ioDoor → src/main/io.ts). A run that cannot reach
// the network hands on the copy the box already holds and says so.
//
//   the link → [a file? api/2/datasets/resources/<id>] → api/2/datasets/<dataset> → [its files, the first
//   table data.gouv.fr parsed] → tabular-api …/profile/ → tabular-api …/data/ (pages of 200 rows)

import { valueOf, isValue } from '../values.mjs';
import { partFail } from './common.mjs';
import { numberField } from './fields.mjs';
import { fetchError } from './fetch.mjs';
import { ioDoor } from '../../projects/bridge.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-opendata.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

const SITE = 'https://www.data.gouv.fr';
const TABULAR = 'https://tabular-api.data.gouv.fr';
const HOSTS = new Set(['data.gouv.fr', 'www.data.gouv.fr', 'tabular-api.data.gouv.fr']);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export const DEFAULT_ROWS = 200;
// ponytail: a SAMPLE, not the file — 5 pages of 200 stay under a box's comfort; data.gouv.fr's profile
// already covers the whole file. A bigger read belongs to the tabular API's own filters (plan P4, Agent).
export const MAX_ROWS = 1000;
const PAGE = 200;
const OFFLINE = new Set(['E_NET', 'E_DNS', 'E_TIMEOUT']);

/** partId -> {text, offline} for the face. Never persisted (a render hint, like Fetch's). */
const notes = new Map();

/**
 * PURE: what a pasted link names — a dataset (slug or id), a file (resource id), or both — or null when
 * it is not data.gouv.fr. Takes a dataset page (`/fr/datasets/<slug>/`), a file link (`/datasets/r/<id>`,
 * `#/resources/<id>`, `?resource_id=`), an API address, or a bare id.
 * @param {unknown} raw @returns {{dataset?: string, resource?: string} | null}
 */
export function parseLink(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  if (new RegExp(`^${UUID.source}$`, 'i').test(s)) return { resource: s.toLowerCase() };
  if (/^[0-9a-f]{24}$/i.test(s)) return { dataset: s.toLowerCase() };
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !HOSTS.has(u.hostname.toLowerCase())) return null;
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep it encoded */ }
  const file = /\/datasets\/r\/([0-9a-f-]{36})/i.exec(path) || /\/resources\/([0-9a-f-]{36})/i.exec(path)
    || UUID.exec(u.hash) || UUID.exec(u.searchParams.get('resource_id') || '');
  const ds = /\/datasets\/([^/?#]+)/i.exec(path);
  const dataset = ds && ds[1] !== 'r' && ds[1] !== 'resources' ? ds[1] : '';
  const resource = file ? String(file[1] || file[0]).toLowerCase() : '';
  if (!dataset && !resource) return null;
  return { ...(dataset ? { dataset } : {}), ...(resource ? { resource } : {}) };
}

/** Every address the box asks — data.gouv.fr's hosts only. */
export const addresses = Object.freeze({
  /** @param {string} id */ file: (id) => `${SITE}/api/2/datasets/resources/${id}/`,
  /** @param {string} ds */ dataset: (ds) => `${SITE}/api/2/datasets/${encodeURIComponent(ds)}/`,
  /** @param {string} ds */ files: (ds) => `${SITE}/api/2/datasets/${encodeURIComponent(ds)}/resources/?page_size=100`,
  /** @param {string} id */ profile: (id) => `${TABULAR}/api/resources/${id}/profile/`,
  /** @param {string} id @param {number} page @param {number} size */
  rows: (id, page, size) => `${TABULAR}/api/resources/${id}/data/?page=${page}&page_size=${size}`,
});

/** PURE: the dataset's first file data.gouv.fr turned into a table (a main file first), or null. @param {any} files */
export function pickFile(files) {
  const list = Array.isArray(files) ? files : [];
  const table = (/** @type {any} */ f) => !!(f && f.extras && f.extras['analysis:parsing:parsing_table']);
  return list.find((f) => table(f) && f.type === 'main') || list.find(table) || null;
}

/** A column name as a person reads it: no byte-order mark (real CSVs carry one), no edge spaces. @param {unknown} s */
const cleanName = (s) => String(s).replace(/^\uFEFF/, '').trim();

/** PURE: one row as the table has it, minus the API's own row number. @param {any} row */
export function cleanRow(row) {
  /** @type {Record<string, any>} */ const out = {};
  for (const [k, v] of Object.entries(row && typeof row === 'object' ? row : {})) if (k !== '__id') out[cleanName(k)] = v;
  return out;
}

/**
 * PURE: the columns, in the file's order, with what data.gouv.fr counted over the WHOLE file (distinct,
 * missing, min/max/mean/std, the ten most common values). Without a profile: the names of the first row.
 * @param {any} answer the profile endpoint's answer @param {any} [firstRow]
 */
export function columnsOf(answer, firstRow) {
  const p = answer && answer.profile;
  if (!p || !Array.isArray(p.header)) return Object.keys(cleanRow(firstRow)).map((name) => ({ name }));
  const types = p.columns || {};
  const stats = p.profile || {};
  return p.header.map((/** @type {any} */ raw) => {
    const name = cleanName(raw);
    const c = types[name] || types[raw] || {};
    const s = stats[name] || stats[raw] || {};
    /** @type {Record<string, any>} */ const col = { name };
    if (c.format) col.format = c.format;
    if (c.python_type) col.type = c.python_type;
    for (const [k, from] of [['distinct', 'nb_distinct'], ['missing', 'nb_missing_values'], ['min', 'min'], ['max', 'max'], ['mean', 'mean'], ['std', 'std']]) {
      if (s[from] != null) col[k] = s[from];
    }
    if (Array.isArray(s.tops)) col.tops = s.tops.slice(0, 10).map((/** @type {any} */ x) => ({ value: x.value, count: x.count }));
    return col;
  });
}

/** A failed GET as an Error a person can act on; `offline` marks the ones the last copy may cover. @param {any} r */
function failure(r) {
  const err = /** @type {any} */ (new Error(fetchError(r)));
  err.offline = !!(r && OFFLINE.has(r.code));
  err.status = r && r.code === 'E_HTTP' ? Number(r.status) : 0;
  return err;
}

/**
 * The whole read, through `door.get` (the io door). Throws an Error whose message is for a person.
 * @param {{get(url: string): Promise<any>}} door @param {{dataset?: string, resource?: string}} where
 * @param {number} want rows to read @param {AbortSignal} [signal]
 */
export async function readDataset(door, where, want, signal) {
  const get = async (/** @type {string} */ url) => {
    if (signal && signal.aborted) throw partFail(t('parts.openDataStopped'), 'part');
    const r = await door.get(url);
    if (!r || r.ok !== true) throw failure(r);
    try { return JSON.parse(String(r.text || '')); } catch { throw new Error(t('parts.openDataBadAnswer')); }
  };
  let file = null;
  let dataset = where.dataset || '';
  if (where.resource) {
    let a;
    try { a = await get(addresses.file(where.resource)); } catch (e) { throw (/** @type {any} */ (e)).status === 404 ? new Error(t('parts.openDataNoFile')) : e; }
    file = a && a.resource;
    dataset = dataset || String((a && a.dataset_id) || '');
  }
  let meta;
  try { meta = await get(addresses.dataset(dataset)); } catch (e) { throw (/** @type {any} */ (e)).status === 404 ? new Error(t('parts.openDataNoDataset')) : e; }
  if (!file) {
    const files = await get(addresses.files(String(meta.id || dataset)));
    file = pickFile(files && files.data);
    if (!file) {
      const formats = [...new Set(((files && files.data) || []).map((/** @type {any} */ f) => String(f.format || '?').toLowerCase()))].join(', ');
      throw new Error(t('parts.openDataNoTable', { formats: formats || '—' }));
    }
  }
  let profile = null;
  try { profile = await get(addresses.profile(file.id)); } catch (e) { if ((/** @type {any} */ (e)).offline) throw e; /* no profile: the columns come from the rows */ }
  /** @type {any[]} */ const rows = [];
  let total = null;
  const size = Math.min(PAGE, want);
  for (let page = 1; rows.length < want; page += 1) {
    let a;
    try { a = await get(addresses.rows(file.id, page, size)); } catch (e) {
      if (page === 1 && (/** @type {any} */ (e)).status === 404) throw new Error(t('parts.openDataNotTable', { file: String(file.title || file.id) }));
      throw e;
    }
    const got = Array.isArray(a && a.data) ? a.data : [];
    if (a && a.meta && Number.isFinite(a.meta.total)) total = a.meta.total;
    rows.push(...got.map(cleanRow));
    if (got.length < size || !(a.links && a.links.next)) break;
  }
  rows.length = Math.min(rows.length, want);
  const org = meta.organization && meta.organization.name;
  return {
    source: 'data.gouv.fr',
    dataset: {
      title: String(meta.title || dataset),
      organization: org ? String(org) : null,
      licence: meta.license ? String(meta.license) : null,
      updated: meta.last_update ? String(meta.last_update).slice(0, 10) : null,
      page: String(meta.page || `${SITE}/datasets/${dataset}`),
      description: String(meta.description_short || meta.description || '').slice(0, 1500),
    },
    file: { id: String(file.id), title: String(file.title || ''), format: String(file.format || '') },
    total: total != null ? total : rows.length,
    read: rows.length,
    columns: columnsOf(profile, rows[0]),
    rows,
  };
}

/** @type {PartSpec} */
export const openDataPart = /** @type {any} */ ({
  type: 'opendata',
  order: 33,
  label: t('parts.openDataLabel'),
  thinks: false,
  size: { w: 340, h: 180 },
  inputs: [],
  output: 'json',
  defaults: () => ({ link: '', rows: DEFAULT_ROWS }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-fetch';
    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'graph-fetch-url';
    input.spellcheck = false;
    input.placeholder = t('parts.openDataPlaceholder');
    input.title = t('parts.openDataHint');
    input.setAttribute('aria-label', t('parts.openDataLink'));
    input.value = String(part.settings.link || '');
    input.addEventListener('input', () => ctx.update({ link: input.value }));
    input.addEventListener('change', () => ctx.commit(t('parts.openDataLink')));
    const rowsF = numberField(t('parts.openDataRows'), Number(part.settings.rows) || DEFAULT_ROWS, 1,
      (n) => { ctx.update({ rows: n }); ctx.commit(t('parts.openDataRows')); }, MAX_ROWS);
    const status = document.createElement('div');
    status.className = 'graph-fetch-status';
    wrap.append(input, rowsF.node, status);
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
        if (document.activeElement !== input) input.value = String(next.settings.link || '');
        rowsF.update(Number(next.settings.rows) || DEFAULT_ROWS);
        paint(next);
      },
      destroy() { wrap.remove(); },
    };
  },

  async run(input) {
    const id = String(input.part.id);
    const link = String(input.part.settings.link || '').trim();
    if (!link) throw partFail(t('parts.openDataNoLink'), 'empty');
    const where = parseLink(link);
    if (!where) throw partFail(t('parts.openDataNotALink'), 'part');
    const door = ioDoor();
    if (!door) throw partFail(t('parts.fetchNoDoor'), 'part');
    const want = Math.max(1, Math.min(MAX_ROWS, Math.floor(Number(input.part.settings.rows) || DEFAULT_ROWS)));
    try {
      const data = await readDataset(door, where, want, input.signal);
      notes.set(id, {
        text: t('parts.openDataStatus', { title: data.dataset.title, total: data.total, columns: data.columns.length, read: data.read }),
        offline: false,
      });
      return valueOf('json', data);
    } catch (e) {
      const err = /** @type {any} */ (e);
      const message = String((err && err.message) || err);
      if (err && err.offline && isValue(input.part.value)) {
        notes.set(id, { text: t('parts.fetchOffline', { message }), offline: true });
        return input.part.value;
      }
      notes.delete(id);
      throw err && err.reason ? err : partFail(message, 'part');
    }
  },
});
