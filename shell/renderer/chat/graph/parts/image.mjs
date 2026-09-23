// @ts-check
// Image (K4-U2) — a picture on the canvas, and the only way one enters a graph.
// COMPUTER_PLAN §6.4.
//
// The box does two jobs and they must not be confused:
//   - it HOLDS a picture the person chose (click, drop, paste). That lives in `settings`, it is a
//     program edit, it is undoable, and it survives export.
//   - it PASSES ON a picture that arrived on its port. That is a VALUE (§6.2 revision 2): a run
//     adopts it and hands it downstream, and it never writes `settings`. Re-running a graph
//     therefore cannot destroy the picture someone dropped in, which is the same promise the Text
//     part's lock makes about typing.
// Nothing here decodes, resizes or reads bytes: `computer/intake.mjs` is the one door for that, so
// there is one size cap, one downscale, one EXIF strip and one refusal sentence.
//
// Vision itself was shipped in K2 (graph/bind.mjs `imagesOf` -> ask({images}), `parts.errNoVision`,
// app/ask.mjs `vision()`), so this file adds the picture and not the plumbing: an `image` value
// wired into an Instruction rides the request as an `image_url` part, and a farm that cannot see
// refuses BEFORE any request goes out.

import { valueOf, isValue } from '../values.mjs';
import { partFail, itemsOf } from './common.mjs';
import { MAX_VALUE_BYTES } from '../serialize.mjs';
import { isImageType, dataUrlBytes, mbOf, kbOf } from '../../computer/intake.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-image.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

/** The long side, in pixels, an intake downscales to (§6.4). The downscale is also what strips
 * EXIF, which is the privacy answer as well as the size one. */
export const MAX_EDGE = 1536;

/** The picture a part is SHOWING, and where it came from. PURE, so what the box draws is provable
 * without a canvas: an arriving value wins over the held one, and neither is invented.
 * @param {any} part @returns {{dataUrl: string, name: string, w: number, h: number, from: 'input'|'held'|'none'}} */
export function shownImage(part) {
  const p = part || {};
  const v = /** @type {any} */ (p.value);
  if (isValue(v) && v.kind === 'image' && v.data && v.data.dataUrl) {
    return {
      dataUrl: String(v.data.dataUrl),
      name: String(v.data.name || t('parts.imageUnnamed')),
      w: 0, h: 0,
      from: 'input',
    };
  }
  const s = p.settings || {};
  const url = String(s.dataUrl || '');
  if (!url) return { dataUrl: '', name: '', w: 0, h: 0, from: 'none' };
  return {
    dataUrl: url,
    name: String(s.name || t('parts.imageUnnamed')),
    w: Number(s.w) || 0,
    h: Number(s.h) || 0,
    from: 'held',
  };
}

/** `out/shot.png` -> `shot.png`. @param {string} path @returns {string} */
export function baseName(path) {
  const name = String(path || '').split('/').pop() || '';
  return name || t('parts.imageUnnamed');
}

/** The single arrival this box will adopt, or the sentence that says why it will not. PURE and
 * total: every refusal names the port's contents and an action that exists (§8.4).
 * @param {GraphValue[]} arrivals
 * @returns {{ok: true, value: any}|{ok: false, message: string}} */
export function arrivalOf(arrivals) {
  /** @type {any[]} */ const flat = [];
  for (const v of arrivals || []) {
    if (!isValue(v)) continue;
    if (/** @type {any} */ (v).kind === 'list') flat.push(...itemsOf(v));
    else flat.push(v);
  }
  if (!flat.length) return { ok: false, message: '' };
  if (flat.length > 1) return { ok: false, message: t('parts.imageOnePicture', { n: flat.length }) };
  const one = flat[0];
  if (one.kind === 'image' || one.kind === 'file') return { ok: true, value: one };
  return { ok: false, message: t('parts.imageWrongKind', { kind: String(one.kind) }) };
}

/** A `file` value that names a picture in this graph's folder, read through the projects bridge
 * and turned into the same `{dataUrl, name}` an intake produces. Throws the sentence on every
 * refusal, which is how a part fails (BG-5).
 * @param {any} value @param {any} app @returns {Promise<GraphValue>} */
async function imageFromFile(value, app) {
  const data = (value && value.data) || {};
  const path = String(data.path || '');
  const project = String(data.project || '');
  if (!project) throw partFail(t('parts.imageNoProject'), 'invalid');
  const projects = app && app.projects;
  if (!projects || typeof projects.readBinary !== 'function') {
    throw partFail(t('parts.imageFileUnreadable', { path }), 'part');
  }
  const out = await projects.readBinary(project, path);
  if (!out || !out.ok) throw partFail(t('parts.imageFileUnreadable', { path }), 'part');
  const type = String(out.mime || '').toLowerCase();
  if (!isImageType(type)) {
    throw partFail(t('parts.imageFileNotAPicture', { path, type: type || t('parts.imageTypeUnknown') }), 'part');
  }
  const dataUrl = `data:${type};base64,${String(out.base64 || '')}`;
  const bytes = dataUrlBytes(dataUrl);
  if (!String(out.base64 || '')) throw partFail(t('parts.imageFileUnreadable', { path }), 'part');
  if (bytes > MAX_VALUE_BYTES) {
    throw partFail(t('parts.imageFileTooBig', { path, mb: mbOf(bytes), capMb: mbOf(MAX_VALUE_BYTES) }), 'part');
  }
  return valueOf('image', { dataUrl, name: baseName(path) });
}

/** @type {PartSpec} */
export const image = /** @type {any} */ ({
  type: 'image',
  order: 120,
  label: t('parts.imageLabel'),
  thinks: false,
  size: { w: 240, h: 200 },
  // Optional, so an Image box is useful the moment it is placed. An arrival is ADOPTED as the
  // VALUE and passed on; the picture the person dropped in stays in `settings`, untouched.
  inputs: [{ name: 'file', label: t('parts.imageLabel'), accepts: ['file', 'image'], required: false }],
  output: 'image',
  // `w`/`h` are the BOX's own sizing and never travel on a wire — the image VALUE stays exactly
  // `{dataUrl, name}`, the shape values.mjs already normalises (§6.4).
  defaults: () => ({ dataUrl: '', name: '', w: 0, h: 0 }),

  render(host, part, ctx) {
    const app = (ctx && ctx.app) || null;
    let working = false;
    /** @type {string} */ let problem = '';
    let destroyed = false;

    const figure = document.createElement('div');
    figure.className = 'graph-image-figure';
    const img = document.createElement('img');
    img.className = 'graph-image-shot';
    img.alt = '';
    const badge = document.createElement('span');
    badge.className = 'graph-image-badge';
    badge.textContent = t('parts.imageFromInput');
    figure.append(img, badge);

    const empty = document.createElement('button');
    empty.type = 'button';
    empty.className = 'graph-image-empty';
    const emptyText = document.createElement('span');
    emptyText.textContent = t('parts.imageEmpty');
    empty.appendChild(emptyText);

    const foot = document.createElement('div');
    foot.className = 'graph-image-foot';
    const caption = document.createElement('span');
    caption.className = 'graph-image-caption';
    const actions = document.createElement('span');
    actions.className = 'graph-image-actions';
    const replace = document.createElement('button');
    replace.type = 'button';
    replace.className = 'graph-part-control graph-image-btn';
    replace.textContent = t('parts.imageReplace');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'graph-part-control graph-image-btn';
    remove.textContent = t('parts.imageRemove');
    actions.append(replace, remove);
    foot.append(caption, actions);

    const note = document.createElement('p');
    note.className = 'graph-image-note';
    note.setAttribute('role', 'status');

    host.classList.add('graph-image');
    host.replaceChildren(figure, empty, foot, note);

    /** @param {any} p */
    function paint(p) {
      const shown = shownImage(p);
      const has = !!shown.dataUrl;
      if (has && img.getAttribute('src') !== shown.dataUrl) img.setAttribute('src', shown.dataUrl);
      if (!has) img.removeAttribute('src');
      figure.hidden = !has;
      empty.hidden = has;
      foot.hidden = !has;
      badge.hidden = shown.from !== 'input';
      // A picture that arrived has no sizing of its own (the box's `w`/`h` never travel on a
      // wire), so it is described by name rather than by two question marks.
      img.alt = has && shown.w && shown.h
        ? t('parts.imageAria', { name: shown.name, w: shown.w, h: shown.h })
        : (has ? shown.name : '');
      caption.textContent = has && shown.w && shown.h
        ? t('parts.imageSize', { w: shown.w, h: shown.h, kb: kbOf(dataUrlBytes(shown.dataUrl)) })
        : shown.name;
      // A picture that ARRIVED is not the box's to replace or remove: those two edit `settings`,
      // and `settings` is only ever the person's own.
      const held = shown.from !== 'input';
      replace.hidden = !held;
      remove.hidden = !held;
      note.textContent = working ? t('parts.imageWorking') : problem;
      note.hidden = !note.textContent;
      note.classList.toggle('is-error', !working && !!problem);
    }

    /** The one place a result from the intake becomes a settings edit. @param {any} out */
    function take(out) {
      if (destroyed) return;
      working = false;
      if (!out) { paint(ctx.part || part); return; }
      if (out.error) { problem = String(out.error); paint(ctx.part || part); return; }
      problem = '';
      ctx.update({ dataUrl: out.dataUrl, name: out.name, w: out.w, h: out.h });
      ctx.commit(t('parts.imageLabel'));
      paint(ctx.part || part);
    }

    function choose() {
      const intake = app && app.intake;
      if (!intake || typeof intake.pick !== 'function') { problem = t('parts.imageUnreadable'); paint(ctx.part || part); return; }
      problem = '';
      working = true;
      paint(ctx.part || part);
      Promise.resolve(intake.pick()).then(take, () => take({ error: t('parts.imageUnreadable') }));
    }

    /** @param {any} ev */
    function onDragOver(ev) {
      const dt = ev && ev.dataTransfer;
      const types = dt && dt.types ? Array.from(dt.types) : [];
      if (types.indexOf('Files') < 0) return;
      ev.preventDefault();
      if (dt) dt.dropEffect = 'copy';
      host.classList.add('is-over');
    }

    function onDragLeave() { host.classList.remove('is-over'); }

    /** @param {any} ev */
    function onDrop(ev) {
      const intake = app && app.intake;
      const dt = ev && ev.dataTransfer;
      const types = dt && dt.types ? Array.from(dt.types) : [];
      host.classList.remove('is-over');
      if (types.indexOf('Files') < 0 || !intake || typeof intake.fromDataTransfer !== 'function') return;
      ev.preventDefault();
      // The canvas treats a dropped file as a GRAPH file, so a picture that reached this box must
      // stop here — otherwise the graph importer gets a JPEG and says it is unreadable.
      ev.stopPropagation();
      problem = '';
      working = true;
      paint(ctx.part || part);
      Promise.resolve(intake.fromDataTransfer(dt)).then((results) => {
        const list = Array.isArray(results) ? results : [];
        if (!list.length) { take({ error: t('parts.imageNotAnImage', { type: t('parts.imageTypeUnknown') }) }); return; }
        take(list[0]);
      }, () => take({ error: t('parts.imageUnreadable') }));
    }

    empty.addEventListener('click', choose);
    replace.addEventListener('click', choose);
    remove.addEventListener('click', () => {
      problem = '';
      ctx.update({ dataUrl: '', name: '', w: 0, h: 0 });
      ctx.commit(t('parts.imageRemove'));
      paint(ctx.part || part);
    });
    host.addEventListener('dragover', onDragOver);
    host.addEventListener('dragleave', onDragLeave);
    host.addEventListener('drop', onDrop);

    paint(part);
    return {
      update(next) { paint(next); },
      destroy() {
        destroyed = true;
        host.removeEventListener('dragover', onDragOver);
        host.removeEventListener('dragleave', onDragLeave);
        host.removeEventListener('drop', onDrop);
        host.classList.remove('graph-image', 'is-over');
        host.replaceChildren();
      },
    };
  },

  async run(input) {
    const arrivals = (input.inputs && input.inputs.file) || [];
    const arrival = arrivalOf(arrivals);
    if (!arrival.ok && arrival.message) throw partFail(arrival.message, 'invalid');
    if (arrival.ok) {
      const v = /** @type {any} */ (arrival.value);
      if (v.kind === 'file') return imageFromFile(v, input.app);
      const url = String((v.data && v.data.dataUrl) || '');
      if (!url) throw partFail(t('parts.imageUnreadable'), 'invalid');
      return valueOf('image', { dataUrl: url, name: String((v.data && v.data.name) || t('parts.imageUnnamed')) });
    }
    const s = input.part.settings || {};
    const url = String(s.dataUrl || '');
    if (!url) throw partFail(t('parts.imageEmpty'), 'empty');
    return valueOf('image', { dataUrl: url, name: String(s.name || t('parts.imageUnnamed')) });
  },
});
