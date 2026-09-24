// @ts-check
// The one door to the main process (studio plan §3.8.5, lint rule 10). NOTHING else in the chat
// tree may name `window.lol`, `lol.projects` or `ipcRenderer` — if a second module ever needs the
// main process, it goes through here or it does not happen.
//
// What this adds on top of the raw IPC:
//   - normalisation: every answer is {ok:true,...} or {ok:false, code, message}; a rejected invoke,
//     a missing handler and a garbled reply all become E_IO instead of a thrown error;
//   - degradation: with no `window.lol.projects` (an older shell binary, or the harness without the
//     compiled main output) the SAME interface is served from projects/memory.mjs, `kind()` says
//     'memory', and `notice()` hands every surface the one sentence it should show;
//   - explain(): a plain sentence per error code, so no panel prints a raw E_* at a person.
import { createMemoryProjects } from './memory.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/projects.en.mjs';

const OPS = Object.freeze([
  'root', 'list', 'create', 'meta', 'update', 'forget', 'listFiles', 'read', 'readBinary',
  'write', 'writeBinary', 'remove', 'reveal', 'open', 'path',
]);

// The error codes we know, and the string key each one shows. A literal map, so lint rule 5 can
// see that every key a person could read really exists in strings/projects.en.mjs.
const ERR_KEY = {
  E_ROOT: 'projects.err_E_ROOT',
  E_ID: 'projects.err_E_ID',
  E_PATH: 'projects.err_E_PATH',
  E_EXT: 'projects.err_E_EXT',
  E_SIZE: 'projects.err_E_SIZE',
  E_QUOTA: 'projects.err_E_QUOTA',
  E_RATE: 'projects.err_E_RATE',
  E_MISSING: 'projects.err_E_MISSING',
  E_LOCKED: 'projects.err_E_LOCKED',
  E_CONFLICT: 'projects.err_E_CONFLICT',
  E_IO: 'projects.err_E_IO',
};
const CODES = new Set(Object.keys(ERR_KEY));

/**
 * One property of the preload's `lol` object, or null on a build that predates it or lacks any of
 * `ops`. The ONLY place the rule-10 token is read.
 * @param {string} name @param {readonly string[]} ops
 */
function preloadProp(name, ops) {
  try {
    const api = typeof window !== 'undefined' && window.lol ? /** @type {any} */ (window.lol)[name] : null;
    if (!api || typeof api !== 'object') return null;
    for (const op of ops) if (typeof api[op] !== 'function') return null;
    return api;
  } catch {
    return null;   // a preload that throws on property access is a preload we do not have
  }
}

/** The preload's `projects` property, or null on a build that predates it. */
function door() {
  return preloadProp('projects', OPS);
}

/** What the Computer's debug log may ask of the main process (COMPUTER_PLAN addendum KG). */
const LOG_OPS = Object.freeze(['start', 'append', 'stop', 'mark', 'reveal', 'status']);

/**
 * The debug-log door (K7): the SAME rules as the projects door — every answer is {ok:true,...} or
 * {ok:false, code, message}, a rejected invoke becomes E_IO, and on a shell without the
 * `debugLog` property this returns null, so the Record switch is HIDDEN rather than dead.
 * @returns {null | {start(header: string): Promise<any>, append(text: string): Promise<any>,
 *   stop(footer?: string): Promise<any>, mark(): Promise<any>, reveal(): Promise<any>, status(): Promise<any>}}
 */
export function debugLogDoor() {
  const api = preloadProp('debugLog', LOG_OPS);
  if (!api) return null;
  /** @param {any} r */
  const shape = (r) => (r && typeof r === 'object' && (r.ok === true || typeof r.code === 'string')
    ? r : { ok: false, code: 'E_IO', message: 'no answer from the main process' });
  /** @param {string} op @param {any[]} args */
  const call = (op, args) => Promise.resolve()
    .then(() => api[op](...args))
    .then(shape, (/** @type {any} */ e) => ({ ok: false, code: 'E_IO', message: String(e && e.message ? e.message : e) }));
  return {
    start: (header) => call('start', [header]),
    append: (text) => call('append', [text]),
    stop: (footer) => call('stop', footer === undefined ? [] : [footer]),
    mark: () => call('mark', []),
    reveal: () => call('reveal', []),
    status: () => call('status', []),
  };
}

/** Whatever came back over IPC, shaped like an answer. @param {any} r */
function normalise(r) {
  if (!r || typeof r !== 'object') return { ok: false, code: 'E_IO', message: t('projects.err_E_IO') };
  if (r.ok === true) return r;
  const code = typeof r.code === 'string' && CODES.has(r.code) ? r.code : 'E_IO';
  const message = typeof r.message === 'string' && r.message ? r.message : t(ERR_KEY[code]);
  return { ok: false, code, message };
}

/** A plain sentence for a person. @param {any} err */
export function explain(err) {
  const code = err && typeof err.code === 'string' ? err.code : '';
  return t(ERR_KEY[code] || 'projects.err_unknown');
}

/**
 * Build the façade. Exported for the unit tests, which drive it with an injected door instead of
 * the real `window.lol` (the rule-10 token appears exactly once, in door() above).
 * @param {any} api the real backend, or null for the memory fallback
 * @param {any} [fallback] the memory backend to use when `api` is null (injectable for tests)
 */
export function createProjects(api, fallback) {
  const backend = api || fallback || createMemoryProjects();
  const real = !!api;

  /** @param {string} op */
  const call = (op) => async (/** @type {any[]} */ ...args) => {
    try {
      return normalise(await backend[op](...args));
    } catch (err) {
      // An IPC rejection is a bug on the other side, not a user error: say E_IO and keep going.
      console.warn(`[lolchat] projects.${op} failed`, err);
      return { ok: false, code: 'E_IO', message: t('projects.err_E_IO') };
    }
  };

  /** @type {any} */
  const out = {
    kind: () => (real ? 'real' : 'memory'),
    /** The one sentence a project surface shows when nothing is saved to disk (null when it is). */
    notice: () => (real ? null : t('projects.memoryNotice')),
    explain,
  };
  for (const op of OPS) out[op] = call(op);
  return out;
}

/**
 * Render the degradation sentence into `host` (and nothing at all when the folder is real).
 * @param {HTMLElement} host @param {any} projects @returns {HTMLElement|null}
 */
export function renderNotice(host, projects) {
  const text = projects && typeof projects.notice === 'function' ? projects.notice() : null;
  if (!host || !text) return null;
  const p = host.ownerDocument.createElement('p');
  p.className = 'chat-projects-notice';
  p.setAttribute('role', 'note');
  p.textContent = text;
  host.appendChild(p);
  return p;
}

/** @param {any} app */
export function install(app) {
  app.projects = createProjects(door());
  app.projects.renderNotice = (/** @type {HTMLElement} */ host) => renderNotice(host, app.projects);
}
