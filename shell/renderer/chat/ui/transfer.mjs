// @ts-check
// Getting an export OUT of the app and an import IN (plan §4 P2-U4). The browser half of
// app/transfer-format.mjs, which owns the file format and stays pure.
//
//   download(filename, text, mime, {app})     → {mode: 'blob'|'data'|'clipboard'|'none', ok}
//   exportThreadFile(app, threadId, format)   → the … menu's two export items
//   exportAll(app)                            → settings → Export all chats
//   importFromText(app, text, {name})         → the whole write half, in ONE transaction
//   pickImportFile()                          → <input type=file> → {name, text} | null
//
// THE THREE WAYS OUT, in order (the plan's list, and the reason for each):
//   1. an object URL on a `<a download>` — the normal path, and the only one with no size limit;
//   2. a `data:` URL for payloads ≤ 10 MB — used when `flags.downloadMode === 'data'` (a harness
//      run) or when step 1 throws. Above 10 MB a data: URL is a memory trap, so it is skipped;
//   3. a "Copy to clipboard" dialog — the last resort. A packaged Electron renderer can refuse a
//      programmatic download outright; a person who can still select and copy their history is in a
//      much better place than one who gets a silent no-op.
// This is the ONE module allowed to name an object URL at all (chat-lint rule 2), and it uses it for
// nothing but handing the user their own bytes.
//
// IMPORT IS A COPY, NEVER A MERGE (see app/transfer-format.mjs): every id is re-minted, so importing
// the same file twice gives two conversations and importing your own export never overwrites the
// original. The records are written in ONE repo.runTx, so a failure leaves nothing half-imported.

import { t } from '../core/i18n.mjs';
import { EV } from '../core/events.mjs';
import { flags } from '../core/env.mjs';
import { newId } from '../core/ids.mjs';
import { exportThreads, parseImport, threadToMarkdown } from '../app/transfer-format.mjs';
import '../strings/library.en.mjs';

/** Above this a `data:` URL is a memory trap, so step 2 is skipped. */
const DATA_URL_LIMIT = 10 * 1024 * 1024;
/** Long enough for the browser to have read the object URL, short enough not to leak it. */
const REVOKE_MS = 60_000;

/** @param {string} tag @param {string} [cls] */
function h(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

/** UTF-8 bytes of a string. @param {string} s @returns {Uint8Array} */
function utf8(s) {
  return new TextEncoder().encode(s);
}

/** base64 of bytes, in chunks so a large export cannot blow the argument limit. @param {Uint8Array} bytes */
export function base64FromBytes(bytes) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, /** @type {any} */ ([...bytes.subarray(i, i + CHUNK)]));
  }
  return btoa(out);
}

/** @param {string} b64 @returns {Uint8Array} */
export function bytesFromBase64(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {any} blob @returns {Promise<string|null>} */
export async function blobToBase64(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') return null;
  try {
    return base64FromBytes(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// out
// ---------------------------------------------------------------------------------------------

/**
 * Hand `text` to the user as a file.
 * @param {string} filename
 * @param {string} text
 * @param {string} mime
 * @param {{app?: any}} [opts]
 * @returns {Promise<{mode: 'blob'|'data'|'clipboard'|'none', ok: boolean, filename: string}>}
 */
export async function download(filename, text, mime, opts = {}) {
  const app = opts.app || null;
  const bytes = utf8(text);
  const mode = String(flags.downloadMode || '');

  if (mode !== 'data' && mode !== 'clipboard') {
    try {
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      clickAnchor(url, filename);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* already gone */ } }, REVOKE_MS);
      return { mode: 'blob', ok: true, filename };
    } catch (err) {
      console.warn('[lolchat] the object-URL download failed, falling back', err);
    }
  }

  if (mode !== 'clipboard' && bytes.length <= DATA_URL_LIMIT) {
    try {
      clickAnchor(`data:${mime};base64,${base64FromBytes(bytes)}`, filename);
      return { mode: 'data', ok: true, filename };
    } catch (err) {
      console.warn('[lolchat] the data-URL download failed, falling back', err);
    }
  }

  const ok = await copyDialog(app, text);
  return { mode: 'clipboard', ok, filename };
}

/** @param {string} href @param {string} filename */
function clickAnchor(href, filename) {
  const a = /** @type {HTMLAnchorElement} */ (h('a'));
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
}

/** The last resort: offer the text to the clipboard. @param {any} app @param {string} text */
async function copyDialog(app, text) {
  if (!app || !app.dialogs) return false;
  const go = await app.dialogs.confirm({
    title: t('library.copyTitle'),
    body: t('library.copyBody'),
    ok: t('library.copyOk'),
  });
  if (!go) return false;
  try {
    await navigator.clipboard.writeText(text);
    app.dialogs.toast(t('library.copied'), { kind: 'success' });
    return true;
  } catch (err) {
    console.warn('[lolchat] writing the export to the clipboard failed', err);
    app.dialogs.toast(t('library.copyFailed'), { kind: 'error' });
    return false;
  }
}

/** `Rig notes` → `rig-notes`, so an export lands under a name a person recognises. @param {string} s */
export function slugify(s) {
  const base = String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'chat';
}

/** `2026-09-15` in local time (a UTC date on the file of an evening export reads as tomorrow). */
function stamp(app) {
  const d = new Date(app && typeof app.now === 'function' ? app.now() : Date.now());
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Read one thread out of the repo, with its messages and attachment bytes.
 * @param {any} app @param {string} threadId
 */
async function collectThread(app, threadId) {
  const repo = app.repo;
  const thread = await repo.getThread(threadId);
  if (!thread) return null;
  const messages = await repo.getMessages(threadId);
  const atts = await repo.listAttachments(threadId);
  /** @type {any[]} */
  const attachments = [];
  for (const att of atts || []) {
    const b64 = att && att.blob ? await blobToBase64(att.blob) : null;
    attachments.push(b64 ? { ...att, blobBase64: b64 } : { ...att });
  }
  return { thread, messages, attachments };
}

/**
 * The … menu's two export items.
 * @param {any} app @param {string} threadId @param {'markdown'|'json'} format
 */
export async function exportThreadFile(app, threadId, format) {
  const got = await collectThread(app, threadId);
  if (!got) return null;
  const { thread, messages, attachments } = got;
  const name = slugify(thread.title);

  if (format === 'markdown') {
    const path = await app.repo.getPath(threadId);
    const text = threadToMarkdown(thread, path.length ? path : messages);
    const r = await download(`${name}.md`, text, 'text/markdown', { app });
    if (r.ok && app.dialogs) app.dialogs.toast(t('library.exported', { name: r.filename }));
    return r;
  }

  const doc = exportThreads({ threads: [thread], messages, attachments, now: app.now });
  const r = await download(`${name}.lolchat.json`, JSON.stringify(doc, null, 2), 'application/json', { app });
  if (r.ok && app.dialogs) app.dialogs.toast(t('library.exported', { name: r.filename }));
  return r;
}

/**
 * Everything "Export all chats" would write, without writing it — the half a test can look at.
 * `doc` is null when there is nothing exportable; `skipped` counts the ephemeral chats left out.
 * @param {any} app @returns {Promise<{doc: any, skipped: number}>}
 */
export async function collectExportAll(app) {
  const all = await app.repo.listThreads();
  const threads = all.filter((/** @type {any} */ th) => !(th && th.ephemeral));
  const skipped = all.length - threads.length;
  if (!threads.length) return { doc: null, skipped };
  /** @type {any[]} */
  const messages = [];
  /** @type {any[]} */
  const attachments = [];
  for (const th of threads) {
    const got = await collectThread(app, th.id);
    if (!got) continue;
    messages.push(...got.messages);
    attachments.push(...got.attachments);
  }
  return { doc: exportThreads({ threads, messages, attachments, now: app.now }), skipped };
}

/**
 * Settings → Export all chats.
 *
 * EPHEMERAL THREADS ARE LEFT OUT. A temporary chat is the one the reader asked never to be written
 * down (F47: "sensitive one-offs … vanish on quit"); a bulk "export everything" button is not the
 * consent that reverses that, and the file would then re-import it as a permanent chat. The per
 * thread … menu still exports one, because THAT is an explicit choice about a named conversation.
 * The toast says how many were left out, so nothing is quietly missing.
 * @param {any} app
 */
export async function exportAll(app) {
  const { doc, skipped } = await collectExportAll(app);
  if (!doc) {
    if (app.dialogs) app.dialogs.toast(t('library.exportEmpty'));
    return null;
  }
  const r = await download(`lol-chat-${stamp(app)}.lolchat.json`, JSON.stringify(doc, null, 2), 'application/json', { app });
  if (r.ok && app.dialogs) {
    if (skipped === 0) app.dialogs.toast(t('library.exported', { name: r.filename }));
    else if (skipped === 1) app.dialogs.toast(t('library.exportedSkipped', { name: r.filename, count: skipped }));
    else app.dialogs.toast(t('library.exportedSkippedMany', { name: r.filename, count: skipped }));
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// in
// ---------------------------------------------------------------------------------------------

/**
 * Ask for a file. Resolves `null` when the picker is dismissed — `change` never fires then, so the
 * input is also dropped on the next window focus rather than left hanging in the document.
 * `maxBytes` refuses an oversize file BEFORE reading it (`{tooBig: true}`, no text): the caller
 * shows the refusal, and a few hundred megabytes never become a string.
 * @param {{maxBytes?: number}} [o]
 * @returns {Promise<{name: string, text: string, size?: number, tooBig?: boolean}|null>}
 */
export function pickImportFile(o = {}) {
  const maxBytes = Number(o && o.maxBytes) > 0 ? Number(o.maxBytes) : Infinity;
  return new Promise((resolve) => {
    const input = /** @type {HTMLInputElement} */ (h('input'));
    input.type = 'file';
    input.accept = '.json,.lolchat.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const done = (/** @type {{name: string, text: string}|null} */ value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(value);
    };
    const onFocus = () => { setTimeout(() => { if (!input.files || !input.files.length) done(null); }, 500); };

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) { done(null); return; }
      if (Number(file.size) > maxBytes) { done({ name: file.name, text: '', size: Number(file.size), tooBig: true }); return; }
      try {
        done({ name: file.name, text: await file.text(), size: Number(file.size) });
      } catch (err) {
        console.warn('[lolchat] reading the import file failed', err);
        done(null);
      }
    });
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

/**
 * Parse `text` and write it, in one transaction. Returns what happened; the caller does not have to
 * report it (this does the toast) but the harness reads the counts.
 *
 * @param {any} app
 * @param {string} text
 * @param {{name?: string, select?: boolean}} [opts]
 * @returns {Promise<{threads: number, messages: number, attachments: number, errors: string[], firstId: string|null}>}
 */
export async function importFromText(app, text, opts = {}) {
  const parsed = parseImport(text, { newId: () => newId({ now: app.now, rng: app.rng }) });
  const fail = { threads: 0, messages: 0, attachments: 0, errors: parsed.errors, firstId: null };

  if (!parsed.threads.length) {
    if (app.dialogs) {
      await app.dialogs.confirm({
        title: t('library.importFailedTitle'),
        body: parsed.errors[0] || t('library.importNothing'),
        ok: t('dialogs.ok'),
      });
    }
    return fail;
  }

  // Attachment bytes come back as base64; the store keeps Blobs (§3.3). A file with no bytes for an
  // attachment still imports — the record says what it was, and the text extraction travelled with it.
  const attachments = parsed.attachments.map((att) => {
    const { blobBase64, ...rest } = att;
    let blob = null;
    if (typeof blobBase64 === 'string' && blobBase64) {
      try { blob = new Blob([bytesFromBase64(blobBase64)], { type: rest.mime || 'application/octet-stream' }); } catch { blob = null; }
    }
    return { ...rest, blob };
  });

  try {
    await app.repo.runTx(['threads', 'messages', 'attachments'], 'readwrite', async (/** @type {any} */ tx) => {
      for (const th of parsed.threads) await tx.put('threads', th);
      for (const m of parsed.messages) await tx.put('messages', { ...m, parentId: m.parentId || '' });
      for (const a of attachments) await tx.put('attachments', a);
    });
  } catch (err) {
    console.warn('[lolchat] the import transaction failed', err);
    if (app.dialogs) {
      await app.dialogs.confirm({
        title: t('library.importFailedTitle'),
        body: t('library.importNothing'),
        ok: t('dialogs.ok'),
      });
    }
    return fail;
  }

  const ids = parsed.threads.map((th) => th.id);
  app.bus.emit(EV.THREADS_CHANGED, { reason: 'import', ids });
  if (app.dialogs) {
    app.dialogs.toast(t('library.imported', { n: parsed.threads.length }), { kind: 'success' });
    if (parsed.errors.length) app.dialogs.toast(t('library.importProblems', { n: parsed.errors.length }), { kind: 'error' });
  }
  if (app.sidebar) await app.sidebar.render();
  if (opts.select !== false && app.controller) {
    try { await app.controller.selectThread(ids[0]); } catch (err) { console.warn('[lolchat] selecting the imported chat failed', err); }
  }
  return {
    threads: parsed.threads.length,
    messages: parsed.messages.length,
    attachments: attachments.length,
    errors: parsed.errors,
    firstId: ids[0] || null,
  };
}

/** Settings → Import chats… : the picker, then the write. @param {any} app */
export async function importChats(app) {
  const file = await pickImportFile();
  if (!file) return null;
  return importFromText(app, file.text, { name: file.name });
}
