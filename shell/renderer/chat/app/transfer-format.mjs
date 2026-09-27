// @ts-check
// The export/import FILE FORMAT (plan §4 P2-U4). PURE: no window, no document, no storage, no
// network — it turns records into a plain object and a string back into records, and nothing else.
// The browser half (picking a file, handing bytes to the user, writing records) is ui/transfer.mjs.
//
//   exportThreads({threads, messages, attachments, includeBlobs}) → LolChatExport
//   threadToMarkdown(thread, path)                                → string
//   parseImport(text, {maxBytes, newId})                          → {threads, messages, attachments, errors}
//
// THE FILE. `.lolchat.json`, one JSON object:
//   {lolchat: 1, exportedAt, app: 'LlmOnLan LOL Chat', threads: [], messages: [], attachments: []}
// `lolchat` is the format version and the ONLY thing that gates a read: a file that says anything
// but 1 is refused whole rather than guessed at.
//
// WHY IMPORT REMAPS EVERY ID. An import is a COPY, never a merge: the same file imported twice gives
// two independent conversations, and importing a file exported from this very machine never
// overwrites the original. So thread, message and attachment ids are all re-minted and every
// reference (message.threadId, message.parentId, thread.headId, part.attId, attachment.threadId) is
// rewritten. `legacyId`/`legacyHash` are DROPPED on the way in: they are the v1 migration's
// "I already have this one" key (§3.7), and an imported copy must never claim to be a migrated
// original — a later migrateV1 would then consider the real v1 thread already brought over.
//
// WHY IMPORT WHITELISTS FIELDS. The text comes from a file a person picked; it is untrusted input.
// Unknown fields are ignored by copying only the fields §3.3 defines, so nothing a future — or
// hostile — file carries can reach the store. That includes message PARTS, per part type
// (PART_FIELDS below): they were the one hole in the promise, copied whole until the P2 review. This module never produces a node, only data; model
// text becomes DOM in exactly one place in the app (render/dom.mjs), as §1.2 requires.

/** The format version this module reads and writes. */
export const LOLCHAT_FORMAT = 1;
/** The default refusal size for parseImport (plan §4 P2-U4). */
export const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

const APP_NAME = 'LlmOnLan LOL Chat';

const THREAD_FIELDS = [
  'id', 'title', 'titleSource', 'createdAt', 'updatedAt', 'headId', 'pinned', 'ephemeral',
  'recipeId', 'systemOverride', 'params', 'model', 'modelSource', 'farmId', 'draft',
];
const MESSAGE_FIELDS = [
  'id', 'threadId', 'parentId', 'role', 'createdAt', 'updatedAt', 'parts', 'content', 'reasoning',
  'reasoningMs', 'sawToolCalls', 'model', 'underlying', 'farmName', 'farmId', 'params', 'recipeId',
  'vars', 'stats', 'status', 'error', 'pinned', 'structuredState',
];
const ATTACHMENT_FIELDS = [
  'id', 'threadId', 'name', 'mime', 'size', 'sha256', 'width', 'height', 'thumbDataUrl', 'text',
  'pages', 'extractEngine', 'status', 'error', 'blobBase64',
];

/** Fields that must never survive a round trip: they are machine-local bookkeeping. */
const NEVER_EXPORT = ['blob', 'legacyId', 'legacyHash'];

/**
 * The statuses a message may carry once it is at rest in the store. Anything else in a file — a
 * hand-written 'waiting' or 'streaming', a typo, a missing field — describes a message with a LIVE
 * process behind it, and an import has no process. Importing one verbatim planted a row with the
 * seat-wait's Try now / Cancel and nothing behind either (the §2.6 AU.3 defect, through the import
 * door), or a row that never settled until the next launch. Coerced on the way in, exactly the way
 * repo.recoverInterrupted coerces the same two statuses at boot.
 */
const SETTLED_STATUS = new Set(['done', 'error', 'aborted', 'interrupted', 'local']);

/** @param {any} raw @param {any} out the message being built (its content/error are already set) */
function importStatus(raw, out) {
  const s = typeof raw === 'string' ? raw : '';
  if (SETTLED_STATUS.has(s)) return s;
  if (s === 'waiting' || s === 'streaming') return 'interrupted';
  // No status at all (or nonsense): a finished turn unless the file also carried an error.
  return out && out.error ? 'error' : 'done';
}

const isObj = (/** @type {any} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (/** @type {any} */ v) => (typeof v === 'string' ? v : '');

/** A copy that cannot bring functions or prototypes along. @param {any} v */
function plain(v) {
  if (v === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return undefined;
  }
}

/** Copy only `fields`, dropping `undefined`. @param {any} rec @param {string[]} fields */
function pick(rec, fields) {
  /** @type {any} */
  const out = {};
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(rec, f)) continue;
    const v = plain(rec[f]);
    if (v !== undefined) out[f] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------------------------

/**
 * Build the export object. Attachment BYTES travel as `blobBase64` (base64 of the bytes, prepared
 * by the caller — reading a Blob needs the browser and this module has none); the live `blob`
 * handle is always dropped.
 *
 * @param {{threads: any[], messages: any[], attachments?: any[], includeBlobs?: boolean, now?: number | (() => number)}} opts
 * @returns {{lolchat: number, exportedAt: string, app: string, threads: any[], messages: any[], attachments: any[]}}
 */
export function exportThreads({ threads, messages, attachments = [], includeBlobs = true, now }) {
  const ts = typeof now === 'function' ? now() : (typeof now === 'number' ? now : Date.now());
  /** @param {any} rec */
  const clean = (rec) => {
    const out = plain(rec) || {};
    for (const f of NEVER_EXPORT) delete out[f];
    return out;
  };
  return {
    lolchat: LOLCHAT_FORMAT,
    exportedAt: new Date(ts).toISOString(),
    app: APP_NAME,
    threads: (threads || []).filter(isObj).map(clean),
    messages: (messages || []).filter(isObj).map(clean),
    attachments: (attachments || []).filter(isObj).map((att) => {
      const out = clean(att);
      if (!includeBlobs) delete out.blobBase64;
      return out;
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// markdown
// ---------------------------------------------------------------------------------------------

/** The text of a message: its content, or the text parts a user turn carries. @param {any} msg */
function messageText(msg) {
  const content = str(msg && msg.content);
  if (content) return content;
  const parts = Array.isArray(msg && msg.parts) ? msg.parts : [];
  return parts.filter((p) => p && p.type === 'text').map((p) => str(p.text)).filter(Boolean).join('\n\n');
}

/**
 * One conversation as Markdown, for reading outside LOL Chat. Message text is copied VERBATIM —
 * fences, tables and all — under a heading per turn, so a code block survives the trip unescaped
 * (escaping it would be the one thing that makes the export useless for the code people export it
 * for). Attachments are named, never inlined.
 *
 * @param {any} thread
 * @param {any[]} path  root → head, as repo.getPath returns it
 * @returns {string}
 */
export function threadToMarkdown(thread, path) {
  const title = str(thread && thread.title) || 'New chat';
  /** @type {string[]} */
  const out = [`# ${title}`, ''];
  const when = Number(thread && thread.updatedAt) || 0;
  if (when) out.push(`*${new Date(when).toISOString()}*`, '');

  for (const msg of Array.isArray(path) ? path : []) {
    if (!isObj(msg)) continue;
    const model = str(msg.model);
    const head = msg.role === 'assistant' ? `Assistant${model ? ` (${model})` : ''}` : 'You';
    out.push(`## ${head}`, '');

    const named = (Array.isArray(msg.parts) ? msg.parts : [])
      .filter((p) => p && (p.type === 'image' || p.type === 'doc' || p.type === 'blender'))
      .map((p) => String(p.type));
    if (named.length) out.push(`*Attached: ${named.join(', ')}*`, '');

    const text = messageText(msg);
    if (text) out.push(text, '');
    const note = msg.error && str(msg.error.message);
    if (note) out.push(`> ${note}`, '');
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

// ---------------------------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------------------------

/**
 * Read an export file. NEVER throws: a file it cannot use comes back as `errors` with no records,
 * so a caller can always show the reason and write nothing.
 *
 * @param {string} text
 * @param {{maxBytes?: number, newId?: () => string}} [opts]
 * @returns {{threads: any[], messages: any[], attachments: any[], errors: string[]}}
 */
export function parseImport(text, opts = {}) {
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : MAX_IMPORT_BYTES;
  const mint = typeof opts.newId === 'function' ? opts.newId : null;
  /** @type {string[]} */
  const errors = [];
  const nothing = () => ({ threads: [], messages: [], attachments: [], errors });

  const raw = typeof text === 'string' ? text : '';
  if (!raw.trim()) { errors.push('the file is empty'); return nothing(); }
  // Bytes, not characters: a file of astral-plane text is longer in UTF-8 than this string is.
  const bytes = utf8Length(raw);
  if (bytes > maxBytes) { errors.push(`the file is too large (${bytes} bytes, limit ${maxBytes})`); return nothing(); }

  /** @type {any} */
  let doc = null;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    const why = err && /** @type {any} */ (err).message ? String(/** @type {any} */ (err).message) : 'unreadable JSON';
    errors.push(`this is not a LOL Chat export: ${why}`);
    return nothing();
  }
  if (!isObj(doc)) { errors.push('this is not a LOL Chat export: the file is not an object'); return nothing(); }
  if (doc.lolchat !== LOLCHAT_FORMAT) {
    errors.push(`unsupported export version: ${JSON.stringify(doc.lolchat)} (this build reads ${LOLCHAT_FORMAT})`);
    return nothing();
  }
  if (!Array.isArray(doc.threads)) { errors.push('the export has no threads array'); return nothing(); }
  if (doc.messages !== undefined && !Array.isArray(doc.messages)) { errors.push('the messages field is not an array'); return nothing(); }
  if (doc.attachments !== undefined && !Array.isArray(doc.attachments)) { errors.push('the attachments field is not an array'); return nothing(); }

  let counter = 0;
  const nextId = () => (mint ? mint() : `import-${Date.now().toString(36)}-${(counter += 1)}`);

  // ONE new id PER RECORD, not per distinct id. A file with a repeated id — the shape a
  // hand-merged or concatenated export has — used to resolve both occurrences to the SAME new id,
  // so the second record overwrote the first in the store: a message vanished, the survivors were
  // re-parented onto the wrong turn, and the toast still reported every record imported (P2
  // review). References stay FIRST-WINS (a parentId can only mean one record) and every repeat is
  // reported, so the reader is told the file was not what it claimed.
  /** @type {Map<string, string>} */
  const threadIds = new Map();
  /** @type {Map<string, string>} */
  const messageIds = new Map();
  /** @type {Map<string, string>} */
  const attIds = new Map();

  /**
   * @param {any[]} list @param {Map<string, string>} refs @param {string} what
   * @returns {(string|null)[]} the new id of each record, BY INDEX (null = the record has no id)
   */
  const mintIds = (list, refs, what) => list.map((rec, i) => {
    if (!isObj(rec) || !str(rec.id)) return null;
    const id = nextId();
    if (refs.has(rec.id)) {
      errors.push(`${what} #${i + 1} repeats the id ${JSON.stringify(rec.id)} and was imported as a separate copy`);
    } else refs.set(rec.id, id);
    return id;
  });

  const threadNew = mintIds(doc.threads, threadIds, 'chat');
  const messageNew = mintIds(doc.messages || [], messageIds, 'message');
  const attNew = mintIds(doc.attachments || [], attIds, 'attachment');

  /** @type {any[]} */
  const threads = [];
  doc.threads.forEach((/** @type {any} */ th, /** @type {number} */ i) => {
    if (!isObj(th) || !str(th.id)) { errors.push(`chat #${i + 1} has no id and was skipped`); return; }
    const out = pick(th, THREAD_FIELDS);
    out.id = /** @type {string} */ (threadNew[i]);
    out.title = str(out.title) || 'New chat';
    out.titleSource = out.titleSource === 'user' ? 'user' : 'auto';
    out.createdAt = Number(out.createdAt) || 0;
    out.updatedAt = Number(out.updatedAt) || out.createdAt;
    out.pinned = !!out.pinned;
    // An imported copy is written to the real store, so it is never ephemeral, and it is flagged
    // `imported` so nothing later mistakes it for history this machine lived through.
    out.ephemeral = false;
    out.imported = true;
    if (str(out.headId)) {
      const head = messageIds.get(out.headId);
      if (!head) errors.push(`chat #${i + 1} points at a head message the file does not contain`);
      out.headId = head || null;
    } else out.headId = null;
    threads.push(out);
  });

  /** @type {any[]} */
  const messages = [];
  (doc.messages || []).forEach((/** @type {any} */ m, /** @type {number} */ i) => {
    if (!isObj(m) || !str(m.id)) { errors.push(`message #${i + 1} has no id and was skipped`); return; }
    const threadId = threadIds.get(str(m.threadId));
    if (!threadId) { errors.push(`message #${i + 1} belongs to a chat the file does not contain and was skipped`); return; }
    const out = pick(m, MESSAGE_FIELDS);
    out.id = /** @type {string} */ (messageNew[i]);
    out.threadId = threadId;
    out.role = out.role === 'assistant' ? 'assistant' : 'user';
    out.content = str(out.content);
    out.createdAt = Number(out.createdAt) || 0;
    out.updatedAt = Number(out.updatedAt) || out.createdAt;
    out.pinned = !!out.pinned;
    if (str(out.parentId)) {
      const parent = messageIds.get(out.parentId);
      if (!parent) errors.push(`message #${i + 1} points at a parent the file does not contain`);
      out.parentId = parent || null;
    } else out.parentId = null;
    out.parts = remapParts(out.parts, attIds, errors, i + 1);
    out.status = importStatus(out.status, out);
    messages.push(out);
  });

  /** @type {any[]} */
  const attachments = [];
  (doc.attachments || []).forEach((/** @type {any} */ a, /** @type {number} */ i) => {
    if (!isObj(a) || !str(a.id)) { errors.push(`attachment #${i + 1} has no id and was skipped`); return; }
    const threadId = threadIds.get(str(a.threadId));
    if (!threadId) { errors.push(`attachment #${i + 1} belongs to a chat the file does not contain and was skipped`); return; }
    const out = pick(a, ATTACHMENT_FIELDS);
    out.id = /** @type {string} */ (attNew[i]);
    out.threadId = threadId;
    out.status = out.status === 'extracting' || out.status === 'error' ? out.status : 'ready';
    attachments.push(out);
  });

  // A file that named chats but produced none is a failed import, not an empty one.
  if (!threads.length && doc.threads.length) return nothing();
  if (!threads.length) errors.push('the export contains no chats');

  return { threads, messages, attachments, errors };
}

/**
 * The fields each PART TYPE of §3.3 may carry into the store. Parts used to be copied whole (only
 * `attId` was touched), which quietly contradicted this module's own whitelist promise: a file
 * could plant any field — a `dataUrl`, an `src`, a future key — on a part, and P3's image and doc
 * renderers read part fields (P2 review). A part whose `type` is not in here is dropped.
 * A new part type is added HERE as well as in PART_RENDERERS; there is deliberately no fallthrough.
 */
const PART_FIELDS = {
  text: ['type', 'text'],
  image: ['type', 'attId'],
  doc: ['type', 'attId', 'pages'],
  search: ['type', 'query', 'results', 'error'],
  blender: ['type', 'kind', 'attId'],
};

/** The fields ONE search result may carry (the only nested shape in the Part union). */
const SEARCH_RESULT_FIELDS = ['n', 'title', 'url', 'snippet'];

/** @param {any} parts @param {Map<string, string>} attIds @param {string[]} errors @param {number} n */
function remapParts(parts, attIds, errors, n) {
  if (!Array.isArray(parts)) return [];
  /** @type {any[]} */
  const out = [];
  for (const part of parts) {
    if (!isObj(part) || typeof part.type !== 'string') continue;
    const fields = /** @type {any} */ (PART_FIELDS)[part.type];
    if (!fields) {
      errors.push(`message #${n} carries a part of an unknown kind (${JSON.stringify(part.type)}) and it was dropped`);
      continue;
    }
    const p = pick(part, fields);
    p.type = part.type;
    if (p.type === 'search') {
      p.results = Array.isArray(p.results)
        ? p.results.filter(isObj).map((/** @type {any} */ r) => pick(r, SEARCH_RESULT_FIELDS))
        : [];
    }
    if (Object.prototype.hasOwnProperty.call(part, 'attId')) {
      const mapped = typeof part.attId === 'string' ? attIds.get(part.attId) : null;
      if (!mapped) errors.push(`message #${n} refers to an attachment the file does not contain`);
      p.attId = mapped || null;
    }
    out.push(p);
  }
  return out;
}

/** UTF-8 byte length, without TextEncoder (not every host a pure module runs in has one). */
function utf8Length(/** @type {string} */ s) {
  let bytes = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { bytes += 4; i += 1; }
    else bytes += 3;
  }
  return bytes;
}
