// @ts-check
// The memory backend for scratch projects (studio plan §3.8.5). PURE: no window, no document, no
// storage, no clock beyond the injected one — it must import cleanly in Node for chat-lint rule 4.
//
// Why it exists: an older shell binary (or the harness without the compiled main output) has no
// `window.lol.projects`. Rather than disabling every project surface, the bridge falls back to
// this: sketches still run, files still exist for the length of the session, and the UI says one
// honest sentence about what is missing. It MIRRORS the main-process validator
// (shell/src/main/projectsPath.ts) rule for rule, so a test can prove both backends refuse exactly
// the same paths — that mirror is the point of the file, not an implementation detail.

export const TEXT_EXT = Object.freeze([
  '.html', '.htm', '.js', '.mjs', '.css', '.json', '.md', '.txt', '.svg', '.ino', '.h', '.hpp',
  '.c', '.cpp', '.ini', '.yml', '.yaml', '.csv', '.glsl', '.frag', '.vert',
]);

export const BIN_EXT = Object.freeze([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.wav', '.mp3', '.ogg', '.ttf', '.otf', '.woff2',
]);

export const ALLOWED_DOTFILE = '.gitignore';
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}-[a-z0-9]{8}$/;

export const MAX_DEPTH = 4;
export const MAX_REL_LEN = 200;
export const MAX_SEGMENT_LEN = 64;

export const TEXT_MAX = 2 * 1024 * 1024;
export const BIN_MAX = 8 * 1024 * 1024;
export const MAX_FILES_PER_PROJECT = 512;
export const MAX_BYTES_PER_PROJECT = 200 * 1024 * 1024;
export const MAX_PROJECTS = 200;
export const WRITES_PER_SEC = 20;
export const WRITE_BURST = 40;

const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com0', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt0', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const KINDS = ['canvas', 'dom', 'three', 'p5', 'svg', 'board'];
/**
 * The metadata file the real backend keeps on disk. It is a normal .json path as far as
 * `validateRel` is concerned, so both backends have to RESERVE it by name: a write would flip
 * autoApply/autoFix on behind the reader's back, and a remove would make the project vanish from
 * list() (S0 review, finding 2). Reads stay allowed; only update()/forget() change it.
 */
const META_FILE = 'project.json';
/** @param {{segments: string[]}} v */
const isMetaRel = (v) => v.segments.length === 1 && v.segments[0] === META_FILE;
const metaRefusal = () => fail('E_PATH', `${META_FILE} belongs to the app — use update() or forget()`);
const POLICIES = ['auto', 'whole', 'anchored'];
const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f]');
const BACKSLASH = String.fromCharCode(92);

/** @param {string} code @param {string} message */
const fail = (code, message) => ({ ok: false, code, message });

/** @param {string} name */
export function extOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return '';
  return name.slice(i).toLowerCase();
}

/** @param {unknown} id */
export function validateId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return fail('E_ID', 'not a project id');
  return { ok: true, id };
}

/**
 * The §3.8.2 table, in order. Kept line-for-line comparable with projectsPath.ts.
 * @param {unknown} rel
 * @param {{maxDepth?: number, maxLen?: number, exts?: readonly string[]}} [o]
 */
export function validateRel(rel, o = {}) {
  const maxDepth = o.maxDepth ?? MAX_DEPTH;
  const maxLen = o.maxLen ?? MAX_REL_LEN;
  const exts = o.exts ?? [...TEXT_EXT, ...BIN_EXT];

  if (typeof rel !== 'string' || rel.length === 0) return fail('E_PATH', 'empty path');
  if (rel.length > maxLen) return fail('E_PATH', `path longer than ${maxLen} characters`);
  if (CONTROL_RE.test(rel)) return fail('E_PATH', 'control character in the path');

  if (rel.includes(BACKSLASH)) return fail('E_PATH', 'backslash in the path');

  if (rel.startsWith('//')) return fail('E_PATH', 'UNC path');
  if (rel.startsWith('/')) return fail('E_PATH', 'absolute path');
  if (/^[a-zA-Z]:/.test(rel)) return fail('E_PATH', 'drive letter');

  const segments = rel.split('/');
  for (const s of segments) {
    if (s === '') return fail('E_PATH', 'empty path segment');
    if (s === '.' || s === '..') return fail('E_PATH', 'relative segment');
  }
  if (segments.length > maxDepth) return fail('E_PATH', `deeper than ${maxDepth} segments`);
  for (const s of segments) {
    if (s.length > MAX_SEGMENT_LEN) return fail('E_PATH', `segment longer than ${MAX_SEGMENT_LEN} characters`);
  }
  for (const s of segments) {
    if (s.includes(':')) return fail('E_PATH', 'alternate data stream');
    if (/[*?"<>|]/.test(s)) return fail('E_PATH', 'illegal character in a segment');
    if (/[. ]$/.test(s)) return fail('E_PATH', 'segment ends with a dot or a space');
    const stem = s.includes('.') ? s.slice(0, s.indexOf('.')) : s;
    if (RESERVED.has(stem.toLowerCase())) return fail('E_PATH', 'reserved device name');
    if (s.startsWith('.') && s !== ALLOWED_DOTFILE) return fail('E_PATH', 'dotfile');
  }

  const name = segments[segments.length - 1];
  const ext = extOf(name);
  if (ext === '') {
    if (name !== ALLOWED_DOTFILE) return fail('E_EXT', 'no file extension');
  } else if (!exts.includes(ext)) {
    return fail('E_EXT', `${ext} is not an allowed extension here`);
  }
  return { ok: true, segments, ext };
}

/** @param {string} name @param {number} [max] */
export function slug(name, max = 48) {
  const s = String(name).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
  return s || 'project';
}

/** @param {number} n @param {() => number} rnd */
function rand36(n, rnd) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(rnd() * alphabet.length) % alphabet.length];
  return out;
}

function defaultSettings() {
  // Auto-apply and auto-fix are OFF by default (owner decision): opt-in, per project.
  return { autoApply: false, autoFix: false, editPolicy: 'auto' };
}

/** @param {any} patch @param {any} base */
function cleanSettings(patch, base) {
  const p = patch && typeof patch === 'object' ? patch : {};
  return {
    autoApply: typeof p.autoApply === 'boolean' ? p.autoApply : base.autoApply,
    autoFix: typeof p.autoFix === 'boolean' ? p.autoFix : base.autoFix,
    editPolicy: POLICIES.includes(p.editPolicy) ? p.editPolicy : base.editPolicy,
  };
}

/** UTF-8 byte length without TextEncoder (which a pure Node import also has, but this is exact). */
function byteLength(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i);
    if (c > 0xffff) { n += 4; i++; } else if (c > 0x7ff) n += 3;
    else if (c > 0x7f) n += 2;
    else n += 1;
  }
  return n;
}

/**
 * A whole projects backend in memory, with the same interface as the real one.
 * @param {{now?: () => number, random?: () => number}} [opts]
 */
export function createMemoryProjects(opts = {}) {
  const clock = opts.now || (() => Date.now());
  const rnd = opts.random || Math.random;
  /** @type {Map<string, {meta: any, files: Map<string, {text?: string, base64?: string, size: number, mtime: number}>}>} */
  const projects = new Map();
  /** @type {Map<string, {tokens: number, ts: number}>} */
  const buckets = new Map();

  const project = (id) => {
    const v = validateId(id);
    if (!v.ok) return v;
    const p = projects.get(v.id);
    if (!p) return fail('E_MISSING', 'that project is not there any more');
    return { ok: true, id: v.id, p };
  };

  function takeToken(id) {
    const now = clock();
    const b = buckets.get(id) || { tokens: WRITE_BURST, ts: now };
    const refill = ((now - b.ts) / 1000) * WRITES_PER_SEC;
    b.tokens = Math.min(WRITE_BURST, b.tokens + refill);
    b.ts = now;
    if (b.tokens < 1) { buckets.set(id, b); return false; }
    b.tokens -= 1;
    buckets.set(id, b);
    return true;
  }

  function usage(p) {
    let bytes = 0;
    for (const f of p.files.values()) bytes += f.size;
    return { files: p.files.size, bytes };
  }

  function put(id, p, rel, size, payload, ifMtime) {
    if (!takeToken(id)) return fail('E_RATE', 'too many writes at once');
    const before = p.files.get(rel);
    if (typeof ifMtime === 'number') {
      if (!before) return fail('E_CONFLICT', 'that file is gone; reload it before saving');
      if (before.mtime !== ifMtime) return fail('E_CONFLICT', 'that file changed; reload it before saving');
    }
    const u = usage(p);
    if (!before && u.files + 1 > MAX_FILES_PER_PROJECT) {
      return fail('E_QUOTA', `a project holds at most ${MAX_FILES_PER_PROJECT} files`);
    }
    if (u.bytes - (before ? before.size : 0) + size > MAX_BYTES_PER_PROJECT) {
      return fail('E_QUOTA', 'this project has reached its size limit');
    }
    const mtime = clock();
    p.files.set(rel, { ...payload, size, mtime });
    p.meta.updatedAt = mtime;
    return { ok: true, size, mtime };
  }

  return {
    kind: () => 'memory',

    async root() {
      return { ok: true, path: '', exists: false, writable: false };
    },

    async list() {
      const out = [];
      for (const { meta } of projects.values()) if (!meta.hidden) out.push({ ...meta });
      out.sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, projects: out, skipped: 0 };
    },

    async create(input) {
      const name = input && typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 80) return fail('E_PATH', 'a project needs a name');
      if (!KINDS.includes(input && input.kind)) return fail('E_PATH', 'unknown project kind');
      if (projects.size >= MAX_PROJECTS) return fail('E_QUOTA', `there are already ${MAX_PROJECTS} projects`);
      let id = '';
      for (let attempt = 0; attempt < 5 && !id; attempt++) {
        const candidate = `${slug(name)}-${rand36(8, rnd)}`;
        if (ID_RE.test(candidate) && !projects.has(candidate)) id = candidate;
      }
      if (!id) return fail('E_IO', 'a free project name could not be found');
      const t = clock();
      const meta = {
        id, name, kind: input.kind, createdAt: t, updatedAt: t,
        settings: cleanSettings(input && input.settings, defaultSettings()), hidden: false,
      };
      projects.set(id, { meta, files: new Map() });
      return { ok: true, project: { ...meta } };
    },

    async meta(id) {
      const r = project(id);
      if (!r.ok) return r;
      return { ok: true, project: { ...r.p.meta } };
    },

    async update(id, patch) {
      const r = project(id);
      if (!r.ok) return r;
      const name = patch && typeof patch.name === 'string' ? patch.name.trim() : '';
      if (patch && 'name' in patch && (!name || name.length > 80)) {
        return fail('E_PATH', 'a project needs a name');
      }
      r.p.meta = {
        ...r.p.meta,
        name: name || r.p.meta.name,
        settings: cleanSettings(patch && patch.settings, r.p.meta.settings),
        updatedAt: clock(),
      };
      return { ok: true, project: { ...r.p.meta } };
    },

    // Hides the row. DELETES NOTHING — same promise as the real backend.
    async forget(id) {
      const r = project(id);
      if (!r.ok) return r;
      r.p.meta = { ...r.p.meta, hidden: true, updatedAt: clock() };
      return { ok: true };
    },

    async listFiles(id) {
      const r = project(id);
      if (!r.ok) return r;
      const files = [...r.p.files.entries()]
        .map(([rel, f]) => ({ path: rel, size: f.size, mtime: f.mtime }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return { ok: true, files };
    },

    async read(id, rel) {
      const r = project(id);
      if (!r.ok) return r;
      const v = validateRel(rel, { exts: TEXT_EXT });
      if (!v.ok) return v;
      const f = r.p.files.get(v.segments.join('/'));
      if (!f || typeof f.text !== 'string') return fail('E_MISSING', 'that file is not there');
      return { ok: true, text: f.text, size: f.size, mtime: f.mtime };
    },

    async readBinary(id, rel) {
      const r = project(id);
      if (!r.ok) return r;
      const v = validateRel(rel, { exts: BIN_EXT });
      if (!v.ok) return v;
      const f = r.p.files.get(v.segments.join('/'));
      if (!f || typeof f.base64 !== 'string') return fail('E_MISSING', 'that file is not there');
      return { ok: true, base64: f.base64, size: f.size, mime: 'application/octet-stream' };
    },

    async write(id, rel, text, o) {
      if (typeof text !== 'string') return fail('E_PATH', 'the text to write must be a string');
      const r = project(id);
      if (!r.ok) return r;
      const v = validateRel(rel, { exts: TEXT_EXT });
      if (!v.ok) return v;
      if (isMetaRel(v)) return metaRefusal();
      const size = byteLength(text);
      if (size > TEXT_MAX) return fail('E_SIZE', 'that file is too big to save here');
      return put(r.id, r.p, v.segments.join('/'), size, { text }, o && typeof o.ifMtime === 'number' ? o.ifMtime : undefined);
    },

    async writeBinary(id, rel, base64) {
      if (typeof base64 !== 'string') return fail('E_PATH', 'the data to write must be a string');
      const r = project(id);
      if (!r.ok) return r;
      const v = validateRel(rel, { exts: BIN_EXT });
      if (!v.ok) return v;
      if (isMetaRel(v)) return metaRefusal();
      const size = Math.floor((base64.replace(/[^A-Za-z0-9+/]/g, '').length * 3) / 4);
      if (size > BIN_MAX) return fail('E_SIZE', 'that file is too big to save here');
      const w = put(r.id, r.p, v.segments.join('/'), size, { base64 }, undefined);
      return w.ok ? { ok: true, size: w.size } : w;
    },

    async remove(id, rel) {
      const r = project(id);
      if (!r.ok) return r;
      const v = validateRel(rel, { exts: [...TEXT_EXT, ...BIN_EXT] });
      if (!v.ok) return v;
      if (isMetaRel(v)) return metaRefusal();
      if (!takeToken(r.id)) return fail('E_RATE', 'too many writes at once');
      const key = v.segments.join('/');
      if (!r.p.files.has(key)) return fail('E_MISSING', 'that file is not there');
      r.p.files.delete(key);
      return { ok: true };
    },

    // There is no folder in this build, so there is nothing to reveal, open or copy.
    async reveal(id) { const r = project(id); return r.ok ? fail('E_ROOT', 'there is no projects folder in this build') : r; },
    async open(id) { const r = project(id); return r.ok ? fail('E_ROOT', 'there is no projects folder in this build') : r; },
    async path(id) { const r = project(id); return r.ok ? fail('E_ROOT', 'there is no projects folder in this build') : r; },
  };
}
