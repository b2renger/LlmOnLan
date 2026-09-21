// @ts-check
// File (C3-U2) — writes the value into THIS thread's scratch project (spec §3), e.g. `out/names.md`,
// and outputs a `file` value so another program can open it. The output of a graph that leaves the
// graph.
//
// Every path rule is enforced in the MAIN process (shell/src/main/projectsPath.ts): the renderer
// never sends an absolute path, never creates or removes a directory, and a `..` is refused THERE,
// not here. What this file decides is only which of the two doors to use — `write` (text) or
// `writeBinary` (a picture) — because that choice is about the VALUE, and a wrong guess would make
// a .png full of base64 instead of a refusal.
//
// A second run overwrites: one part, one path, one file. That is what makes a graph re-runnable
// without a folder full of `names (3).md`.

import { valueOf, isValue } from '../values.mjs';
import { partFail, textOf, itemsOf } from './common.mjs';
import { textField } from './fields.mjs';
import { BIN_EXT } from '../../projects/memory.mjs';
import { t } from '../../core/i18n.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

export const DEFAULT_PATH = 'out/value.md';

/**
 * The scratch project that belongs to this thread, created on first write. One project per thread,
 * mirrored in the repo's `projects` store so the next run finds the same folder (studio plan
 * §3.6.2). The mirror is queried by threadId and the row is checked again here: an id that no
 * longer resolves (the folder was deleted by hand) must mean a NEW project, not a dead write.
 * @param {any} app @param {any} thread @returns {Promise<{ok: boolean, id: string, message: string}>}
 */
export async function threadProject(app, thread) {
  if (!thread || !thread.id) return { ok: false, id: '', message: t('parts.errFileNoThread') };
  const projects = app && app.projects;
  if (!projects || typeof projects.create !== 'function') return { ok: false, id: '', message: t('parts.errFileNoProjects') };
  const refs = (await app.repo.listProjectRefs(thread.id)) || [];
  const mine = refs.find((/** @type {any} */ r) => r && r.threadId === thread.id);
  if (mine) {
    const meta = await projects.meta(mine.id);
    if (meta && meta.ok) return { ok: true, id: mine.id, message: '' };
  }
  const name = String(thread.title || t('parts.fileProjectFallback'));
  const made = await projects.create({ name, kind: 'dom' });
  if (!made || !made.ok) return { ok: false, id: '', message: String((made && made.message) || t('parts.errFileNoProjects')) };
  const now = app.now ? app.now() : Date.now();
  await app.repo.putProjectRef({ id: made.project.id, threadId: thread.id, name, kind: 'dom', createdAt: now, updatedAt: now });
  return { ok: true, id: made.project.id, message: '' };
}

/** `out/names.md` -> `.md`. Lower-case, and '' when there is none. @param {string} rel */
export function extOf(rel) {
  const name = String(rel || '').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** @param {string} rel @returns {boolean} */
export function isBinaryPath(rel) {
  return BIN_EXT.indexOf(extOf(rel)) >= 0;
}

/** The single image value behind these inputs, if that is all there is. One picture is a picture;
 * a picture plus a caption is a document, and a document is text.
 * @param {GraphValue[]} values @returns {any|null} */
function loneImage(values) {
  const flat = [];
  for (const v of values || []) {
    if (!isValue(v)) continue;
    if (/** @type {any} */ (v).kind === 'list') flat.push(...itemsOf(v));
    else flat.push(v);
  }
  if (flat.length !== 1) return null;
  const one = /** @type {any} */ (flat[0]);
  return one.kind === 'image' && one.data && one.data.dataUrl ? one.data : null;
}

/**
 * What to write, and through which door. Never throws; an impossible pairing is a `why` the part
 * turns into a sentence.
 *   a picture into .png/.jpg/…  -> the bytes, base64, via writeBinary
 *   a picture into .svg         -> the SVG source itself, as text
 *   anything else into text     -> textOf(), the same rendering every other part uses
 *   anything else into .png     -> refused: base64 in a .png is a broken file, not a file
 * @param {GraphValue[]} values @param {string} rel
 * @returns {{ok: true, binary: boolean, data: string}|{ok: false, why: 'empty'|'image-ext'|'binary'}}
 */
export function payloadFor(values, rel) {
  const image = loneImage(values);
  const binaryPath = isBinaryPath(rel);
  if (image) {
    const url = String(image.dataUrl || '');
    const comma = url.indexOf(',');
    const head = comma >= 0 ? url.slice(0, comma) : '';
    const body = comma >= 0 ? url.slice(comma + 1) : '';
    if (/;base64$/i.test(head)) {
      if (!binaryPath) return { ok: false, why: 'image-ext' };
      return body ? { ok: true, binary: true, data: body } : { ok: false, why: 'empty' };
    }
    // A vector picture is text (Render's svg mode encodes it itself, never base64).
    if (binaryPath) return { ok: false, why: 'binary' };
    let svg = '';
    try { svg = decodeURIComponent(body); } catch { svg = body; }
    const text = svg || String(image.source || '');
    return text ? { ok: true, binary: false, data: text } : { ok: false, why: 'empty' };
  }
  if (binaryPath) return { ok: false, why: 'binary' };
  const text = (values || []).map(textOf).join('\n');
  return text ? { ok: true, binary: false, data: text } : { ok: false, why: 'empty' };
}

/** The sentence for a payload that cannot be written. @param {string} why */
function payloadMessage(why) {
  if (why === 'image-ext') return t('parts.errFileImageExt');
  if (why === 'binary') return t('parts.errFileBinary');
  return t('parts.errFileEmpty');
}

/** @type {PartSpec} */
export const file = /** @type {any} */ ({
  type: 'file',
  order: 820,
  label: t('parts.fileLabel'),
  thinks: false,
  size: { w: 260, h: 170 },
  // Takes the whole value, like Code and Render (BJ-9): forty items are one file, not forty.
  inputs: [{ name: 'in', label: t('parts.fileIn'), accepts: ['text', 'json', 'list', 'image', 'file'], many: true, required: true }],
  output: 'file',
  defaults: () => ({ path: DEFAULT_PATH }),

  render(host, part, ctx) {
    let live = part;
    const wrap = document.createElement('div');
    wrap.className = 'graph-file';

    const field = textField(t('parts.filePath'), String(part.settings.path || DEFAULT_PATH), {
      onInput: (v) => ctx.update({ path: v }),
      onCommit: () => ctx.commit(t('parts.fileLabel')),
      placeholder: DEFAULT_PATH,
    });
    field.input.classList.add('graph-file-path');

    const wrote = document.createElement('p');
    wrote.className = 'graph-part-note graph-file-wrote';
    wrote.hidden = true;

    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'graph-file-reveal';
    reveal.textContent = t('parts.fileReveal');
    reveal.hidden = true;
    reveal.addEventListener('click', (e) => {
      e.preventDefault();
      const data = live.value && live.value.kind === 'file' ? live.value.data : null;
      const projects = ctx.app && ctx.app.projects;
      if (!data || !data.project || !projects || typeof projects.reveal !== 'function') return;
      void Promise.resolve(projects.reveal(data.project)).then((out) => {
        if ((!out || !out.ok) && ctx.app.dialogs && typeof ctx.app.dialogs.toast === 'function') {
          ctx.app.dialogs.toast(String((out && out.message) || t('parts.errFileNoProjects')), { kind: 'error' });
        }
      });
    });

    wrap.append(field.node, wrote, reveal);
    host.replaceChildren(wrap);

    /** @param {any} p */
    const paint = (p) => {
      live = p;
      field.update(String(p.settings.path || DEFAULT_PATH));
      const data = p.value && p.value.kind === 'file' ? p.value.data : null;
      const written = !!(data && data.path);
      wrote.hidden = !written;
      reveal.hidden = !written;
      if (written) wrote.textContent = t('parts.fileWrote', { path: String(data.path) });
    };
    paint(part);

    return {
      update(next) { paint(next); },
      destroy() { wrap.remove(); },
    };
  },

  async run(input) {
    const values = input.inputs.in || [];
    const rel = String(input.part.settings.path || DEFAULT_PATH).trim();
    if (!rel) throw partFail(t('parts.errFileNoPath'), 'invalid');

    const payload = payloadFor(values, rel);
    if (!payload.ok) throw partFail(payloadMessage(payload.why), payload.why === 'empty' ? 'empty' : 'invalid');

    const project = await threadProject(input.app, input.thread);
    if (!project.ok) throw partFail(project.message, 'part');

    const projects = input.app.projects;
    // The path goes across EXACTLY as the reader typed it. A `..` is refused by the main process,
    // which is the only boundary that counts — a renderer that silently rewrote the path would be
    // hiding the refusal the reader needs to see.
    const out = payload.binary
      ? await projects.writeBinary(project.id, rel, payload.data)
      : await projects.write(project.id, rel, payload.data);
    if (!out || !out.ok) {
      throw partFail(t('parts.errFileWrite', { message: String((out && out.message) || '') }), 'part');
    }
    return valueOf('file', { path: rel, project: project.id, size: Number(out.size) || 0 });
  },
});
