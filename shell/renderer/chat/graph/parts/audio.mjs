// @ts-check
// The Sound box (K6-U3, addendum KF-6). "Bring in" group.
//
// It HOLDS a sound file — the bytes stay on this computer (computer/media.mjs), the part keeps a
// MediaRef — and PLAYS it in the box through Web Audio (`decodeAudioData` + an
// AudioBufferSourceNode: the renderer's CSP has no `media-src`, so an <audio> element can play
// neither a `data:` nor a `blob:` URL; KF-1(e)). It never sends the sound: no verified path carries
// an `input_audio` part to a model on this farm (KF-1(b), graph/takes.mjs AUDIO_SEND). What flows
// on is TEXT — the file's name and length, and the sentence that says why the sound itself was not
// sent — so a downstream Instruction is told the truth instead of answering about nothing.
//
// Three doors bring a sound in — a drop ON the box, the picker behind its empty face, and a drop
// on the canvas (computer/drops.mjs) — and all three go through `takeSound()` below, so there is
// ONE size cap, ONE decode check, ONE length cap and one set of refusal sentences.
//
// Its LENGTH is read from the file's headers first (graph/sound-length.mjs), so a sound longer
// than AUDIO_MAX_SEC is refused BEFORE it is decoded: Chromium decodes at the file's own rate
// before it resamples, and a 25 MB one-hour MP3 would be ~1.2 GB of PCM in this renderer before
// "too long" could be said (K6 fix round). A format whose headers do not say (WebM) is judged by
// decoding a PROBE_BYTES prefix and scaling by size; one that cannot even be probed is refused.
// Only then is the file decoded ONCE, into an 8 kHz OfflineAudioContext, which measures its exact
// length and refuses what Chromium cannot decode. Playback decodes again at the output rate, on
// the first ▶, and keeps ONE decoded sound in memory (the last one played) until its box lets go
// of the file or goes away. One sound plays at a time: pressing ▶ on a second box stops the first.

import { t } from '../../core/i18n.mjs';
import { valueOf } from '../values.mjs';
import { partFail } from './common.mjs';
import { renderTakes } from '../takes-view.mjs';
import { takesFor, farmViewOf } from '../takes.mjs';
import { AUDIO_EXTS, classify } from '../drop-route.mjs';
import { soundLength } from '../sound-length.mjs';
import { sayOnlyOne } from './document.mjs';
import '../../strings/parts-audio.en.mjs';
// `parts.mediaMissing` is the file store's sentence (K6-U2's table); imported so it is registered
// wherever this box is.
import '../../strings/parts-document.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** The largest sound file a box keeps (frozen, KF-6). */
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
/** The longest sound a box keeps, in seconds (frozen, KF-6). */
export const AUDIO_MAX_SEC = 600;
/** What the picker offers. Extensions too: a Windows `.m4a` often arrives with no MIME type. */
export const AUDIO_ACCEPT = ['audio/*', ...AUDIO_EXTS.map((e) => `.${e}`)].join(',');
/** The rate the intake decodes at to MEASURE a sound. Duration survives resampling; memory does not
 * have to (a ten-minute stereo file: 600 s x 8000 x 2 x 4 B = 38 MB). */
export const MEASURE_RATE = 8000;
/** A sound whose headers do not state its length is judged by decoding this much of its start. */
export const PROBE_BYTES = 256 * 1024;
/** An ESTIMATED length (a CBR MP3, a probed prefix) refuses only past this margin over the cap; in
 * between, the full decode measures it exactly — and a sound under 1.25 × the cap is bounded. */
export const LENGTH_SLACK = 1.25;

/** How many WHOLE-file decodes the intake has done (for the tests: a refusal by header is none). */
let fullDecodes = 0;

/** The settings a box is placed with for one stored sound (KF-4 `adopt`). @param {any} ref */
function adopt(ref) {
  const r = ref || {};
  return {
    fileId: String(r.fileId || ''),
    name: String(r.name || ''),
    mime: String(r.mime || ''),
    size: Number(r.size) || 0,
    sha256: String(r.sha256 || ''),
    durationSec: Number(r.durationSec) || 0,
  };
}

const EMPTY = () => ({ fileId: '', name: '', mime: '', size: 0, sha256: '', durationSec: 0 });

/** `2:14` for 134 s. @param {number} sec @returns {string} */
export function clock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** @param {number} bytes @returns {string} */
const mbOf = (bytes) => ((Number(bytes) || 0) / (1024 * 1024)).toFixed(1);

/**
 * Seconds of sound in these bytes; throws when this Chromium cannot decode them. The buffer is
 * DETACHED by `decodeAudioData`, so a caller that still needs the bytes passes a copy.
 * @param {ArrayBuffer} buf @returns {Promise<number>}
 */
export async function measureSound(buf) {
  const g = /** @type {any} */ (globalThis);
  const Offline = g.OfflineAudioContext || g.webkitOfflineAudioContext;
  if (typeof Offline !== 'function') throw new Error('no audio decoder in this window');
  const ac = new Offline(1, 1, MEASURE_RATE);
  const decoded = await ac.decodeAudioData(buf);
  return Number(decoded && decoded.duration);
}

/**
 * THE sound intake: check, decode, measure, keep. Every door a sound comes in by calls this, so
 * the caps and the sentences are the same whichever way it arrived. Never throws: a refusal is
 * `{error: sentence}`.
 * @param {any} app needs `app.media` (computer/media.mjs)
 * @param {any} file a File (name, type, size, arrayBuffer())
 * @param {{measure?: (buf: ArrayBuffer) => Promise<number>}} [env] a test's decoder
 * @returns {Promise<{fileId: string, name: string, mime: string, size: number, sha256: string, durationSec: number}|{error: string}>}
 */
export async function takeSound(app, file, env) {
  const name = String((file && file.name) || t('parts.audioUnnamed'));
  const size = Number(file && file.size) || 0;
  // Refused BEFORE a byte is read: a 2 GB recording is the cost we are avoiding.
  if (size > AUDIO_MAX_BYTES) {
    return { error: t('parts.audioTooBig', { name, mb: mbOf(size), capMb: mbOf(AUDIO_MAX_BYTES) }) };
  }
  if (!size) return { error: t('parts.audioEmptyFile', { name }) };
  const media = app && app.media;
  if (!media || typeof media.put !== 'function') return { error: t('parts.audioNoStore') };
  /** @type {ArrayBuffer} */ let buf;
  try { buf = await file.arrayBuffer(); } catch { return { error: t('parts.mediaUnreadable', { name }) }; }
  const measure = (env && typeof env.measure === 'function') ? env.measure : measureSound;
  // 1. What the headers say, before anything is decoded (K6 fix round).
  const stated = soundLength(buf);
  if (stated && stated.sec > AUDIO_MAX_SEC * (stated.exact ? 1 : LENGTH_SLACK)) {
    const vars = { name, duration: clock(stated.sec), cap: clock(AUDIO_MAX_SEC) };
    return { error: stated.exact ? t('parts.audioTooLong', vars) : t('parts.audioTooLongAbout', vars) };
  }
  // 2. Headers that do not say, on a file big enough to matter: decode its start, scale by size.
  if (!stated && buf.byteLength > PROBE_BYTES) {
    let head = NaN;
    try { head = Number(await measure(buf.slice(0, PROBE_BYTES))); } catch { head = NaN; }
    if (!Number.isFinite(head) || head <= 0) return { error: t('parts.audioLengthUnknown', { name }) };
    const guess = head * (buf.byteLength / PROBE_BYTES);
    if (guess > AUDIO_MAX_SEC * LENGTH_SLACK) {
      return { error: t('parts.audioTooLongAbout', { name, duration: clock(guess), cap: clock(AUDIO_MAX_SEC) }) };
    }
  }
  // 3. Known to be near or under the cap: decode it whole, once, at 8 kHz — the exact length.
  let sec = NaN;
  fullDecodes += 1;
  try { sec = Number(await measure(buf.slice(0))); } catch { sec = NaN; }
  if (!Number.isFinite(sec) || sec <= 0) return { error: t('parts.audioUndecodable', { name }) };
  if (sec > AUDIO_MAX_SEC) {
    return { error: t('parts.audioTooLong', { name, duration: clock(sec), cap: clock(AUDIO_MAX_SEC) }) };
  }
  /** @type {any} */ let ref = null;
  try { ref = await media.put(file, { maxBytes: AUDIO_MAX_BYTES, kind: 'audio' }); } catch { ref = null; }
  if (!ref || ref.error || !ref.fileId) return { error: String((ref && ref.error) || t('parts.mediaUnreadable', { name })) };
  return {
    fileId: String(ref.fileId),
    name: String(ref.name || name),
    mime: String(ref.mime || (file && file.type) || ''),
    size: Number(ref.size) || size,
    sha256: String(ref.sha256 || ''),
    durationSec: Math.round(sec * 10) / 10,
  };
}

// ---- playback: one context, one decoded sound, one sound playing ---------------------------------

/** @type {any} */ let sharedCtx = null;
/** The ONE decoded sound kept for replay (the last one played). */
let cached = { fileId: '', buffer: /** @type {any} */ (null) };
/** The ONE sound playing, across every box: `{fileId, stop()}`. */
/** @type {any} */ let current = null;
let plays = 0;

/** @returns {any} the window's AudioContext, made on first use; null where there is none */
function audioCtx() {
  if (sharedCtx) return sharedCtx;
  const g = /** @type {any} */ (globalThis);
  const AC = g.AudioContext || g.webkitAudioContext;
  if (typeof AC !== 'function') return null;
  try { sharedCtx = new AC(); } catch { sharedCtx = null; }
  return sharedCtx;
}

/** What the player is doing, for tests: never a handle, only facts. */
export function soundDebug() {
  return { plays, playing: current ? String(current.fileId) : null, cached: cached.fileId || null, decodes: fullDecodes };
}

/** Let go of the decoded copy of a file a box no longer holds (up to ~230 MB for a ten-minute
 * stereo sound at 48 kHz). @param {string} fileId */
function forget(fileId) {
  if (fileId && cached.fileId === fileId) cached = { fileId: '', buffer: null };
}

/**
 * The decoded sound for a stored file, from the one-slot cache or decoded now.
 * @param {any} app @param {string} fileId @param {string} name
 * @returns {Promise<{buffer: any}|{error: string, missing?: boolean}>}
 */
async function bufferFor(app, fileId, name) {
  if (cached.fileId === fileId && cached.buffer) return { buffer: cached.buffer };
  const media = app && app.media;
  /** @type {ArrayBuffer|null} */ let bytes = null;
  try { bytes = media && typeof media.bytes === 'function' ? await media.bytes(fileId) : null; } catch { bytes = null; }
  if (!bytes) return { error: t('parts.mediaMissing'), missing: true };
  const ac = audioCtx();
  if (!ac) return { error: t('parts.audioNoPlayer') };
  try {
    const buffer = await ac.decodeAudioData(bytes);
    cached = { fileId, buffer };
    return { buffer };
  } catch {
    return { error: t('parts.audioUndecodable', { name }) };
  }
}

/** @param {() => void} fn @returns {number} */
const nextFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0);
/** @param {number} id */
const cancelFrame = (id) => { if (id && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); };

/** @type {PartSpec} */
export const audioPart = /** @type {any} */ ({
  type: 'audio',
  order: 130,
  label: t('parts.audioLabel'),
  thinks: false,
  size: { w: 280, h: 220 },
  holds: 'audio',
  adopt,
  inputs: [],
  output: 'text',
  defaults: EMPTY,

  render(host, part, ctx) {
    const doc = host.ownerDocument || document;
    const app = (ctx && ctx.app) || null;
    let live = part;
    let destroyed = false;
    let working = false;      // an intake is reading/decoding/keeping a file
    let loading = false;      // ▶ is decoding the stored file
    let problem = '';         // the last refusal, shown until the next attempt
    let missing = false;      // the stored bytes are gone from this computer
    let checkedFor = '';      // the fileId whose presence was last checked
    /** @type {any} */ let handle = null;   // this box's playing sound
    let frame = 0;
    let shownSec = -1;

    /** @param {string} tag @param {string} cls */
    const make = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e; };

    const empty = /** @type {HTMLButtonElement} */ (make('button', 'graph-audio-empty'));
    empty.type = 'button';
    empty.textContent = t('parts.audioEmpty');

    const player = make('div', 'graph-audio-player');
    const row = make('div', 'graph-audio-row');
    const play = /** @type {HTMLButtonElement} */ (make('button', 'graph-part-control graph-audio-play'));
    play.type = 'button';
    const name = make('p', 'graph-audio-name');
    row.append(play, name);
    const bar = make('div', 'graph-audio-bar');
    const fill = make('span', 'graph-audio-fill');
    bar.appendChild(fill);
    bar.setAttribute('aria-hidden', 'true');
    const foot = make('div', 'graph-audio-foot');
    const time = make('span', 'graph-audio-time');
    const replace = /** @type {HTMLButtonElement} */ (make('button', 'graph-part-control graph-audio-btn graph-audio-replace'));
    replace.type = 'button';
    replace.textContent = t('parts.audioReplace');
    const remove = /** @type {HTMLButtonElement} */ (make('button', 'graph-part-control graph-audio-btn graph-audio-remove'));
    remove.type = 'button';
    remove.textContent = t('parts.audioRemove');
    foot.append(time, replace, remove);
    player.append(row, bar, foot);

    const note = make('p', 'graph-audio-note');
    note.setAttribute('role', 'status');

    const takes = renderTakes({ app, partId: part.id, kind: 'audio', doc });
    host.classList.add('graph-audio');
    host.replaceChildren(empty, player, note, takes.el);

    const settingsOf = (/** @type {any} */ p) => (p && p.settings) || {};

    /** The one-line time readout: where the playhead is, the length, the size. */
    function paintTime() {
      const s = settingsOf(live);
      const at = handle ? Math.min(handle.elapsed(), Number(s.durationSec) || handle.duration || 0) : 0;
      const whole = Math.floor(at);
      if (whole !== shownSec || !handle) {
        shownSec = whole;
        time.textContent = t('parts.audioTime', { at: clock(at), duration: clock(s.durationSec), mb: mbOf(s.size) });
      }
      const total = Number(s.durationSec) || (handle && handle.duration) || 0;
      const ratio = handle && total > 0 ? Math.max(0, Math.min(1, at / total)) : 0;
      /** @type {any} */ (fill).style.transform = `scaleX(${ratio.toFixed(4)})`;
    }

    /** Is the stored file still here? Asked once per fileId, never on every repaint. */
    function checkPresent() {
      const s = settingsOf(live);
      const id = String(s.fileId || '');
      if (id === checkedFor) return;
      checkedFor = id;
      missing = false;
      const media = app && app.media;
      if (!id || !media || typeof media.get !== 'function') return;
      Promise.resolve(media.get(id)).then((rec) => {
        if (destroyed || checkedFor !== id) return;
        if (!rec) { missing = true; paint(live); }
      }, () => { /* unknown is not missing */ });
    }

    /** @param {any} p */
    function paint(p) {
      live = p || live;
      const s = settingsOf(live);
      const has = !!s.fileId;
      checkPresent();
      empty.hidden = has;
      player.hidden = !has;
      empty.disabled = working;
      name.textContent = has ? String(s.name || t('parts.audioUnnamed')) : '';
      name.title = name.textContent;
      const on = !!handle;
      play.textContent = on ? t('parts.audioStop') : t('parts.audioPlay');
      play.setAttribute('aria-pressed', on ? 'true' : 'false');
      play.setAttribute('aria-label', on
        ? t('parts.audioStopAria', { name: String(s.name || '') })
        : t('parts.audioPlayAria', { name: String(s.name || '') }));
      play.disabled = loading || working || missing;
      replace.disabled = working;
      host.dataset.playing = on ? 'true' : 'false';
      paintTime();
      const say = working ? t('parts.audioReading')
        : loading ? t('parts.audioLoading')
          : (has && missing) ? t('parts.mediaMissing')
            : problem;
      if (note.textContent !== say) note.textContent = say;
      note.hidden = !say;
      note.classList.toggle('is-error', !working && !loading && !!say);
      takes.refresh();
    }

    function tick() {
      frame = nextFrame(() => {
        frame = 0;
        if (destroyed || !handle) return;
        paintTime();
        tick();
      });
    }

    function stopMine() { if (handle) handle.stop(); }

    async function toggle() {
      if (handle) { handle.stop(); return; }
      const s = settingsOf(live);
      const id = String(s.fileId || '');
      if (!id || loading) return;
      loading = true;
      problem = '';
      paint(live);
      const out = await bufferFor(app, id, String(s.name || ''));
      loading = false;
      if (destroyed) return;
      if ('error' in out) {
        if (/** @type {any} */ (out).missing) missing = true;
        else problem = out.error;
        paint(live);
        return;
      }
      // The file changed while it was decoding (Replace, Remove, undo): play nothing stale.
      if (String(settingsOf(live).fileId || '') !== id) { paint(live); return; }
      const ac = audioCtx();
      if (!ac) { problem = t('parts.audioNoPlayer'); paint(live); return; }
      if (current) current.stop();
      const src = ac.createBufferSource();
      src.buffer = out.buffer;
      src.connect(ac.destination);
      const startedAt = ac.currentTime;
      /** @type {any} */ const h = {
        fileId: id,
        duration: Number(out.buffer && out.buffer.duration) || 0,
        done: false,
        elapsed: () => Math.max(0, ac.currentTime - startedAt),
        stop() {
          if (h.done) return;
          h.done = true;
          src.onended = null;
          try { src.stop(); } catch { /* never started, or already ended */ }
          try { src.disconnect(); } catch { /* already disconnected */ }
          if (current === h) current = null;
          if (handle === h) handle = null;
          cancelFrame(frame);
          frame = 0;
          if (!destroyed) paint(live);
        },
      };
      src.onended = () => h.stop();
      handle = h;
      current = h;
      plays += 1;
      // Electron plays without a gesture; a context that starts suspended is resumed here, and a
      // refusal to resume is not an error worth a sentence — the ■ still stops it.
      try { const r = ac.resume(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* ignore */ }
      src.start();
      paint(live);
      tick();
    }

    /** The one place a result from the intake becomes a settings edit. @param {any} file */
    async function takeFile(file) {
      if (!file || destroyed) return;
      if (classify(file).kind !== 'audio') {
        problem = t('parts.audioNotSound', { name: String(file.name || t('parts.audioUnnamed')) });
        paint(live);
        return;
      }
      working = true;
      problem = '';
      paint(live);
      const out = await takeSound(app, file);
      working = false;
      if (destroyed) return;
      if ('error' in out) { problem = out.error; paint(live); return; }
      stopMine();
      const before = String(settingsOf(live).fileId || '');
      if (before !== out.fileId) forget(before);
      missing = false;
      checkedFor = out.fileId;
      ctx.update(adopt(out));
      ctx.commit(t('parts.audioLabel'));
      paint(ctx.part || live);
    }

    function choose() {
      if (working || typeof doc.createElement !== 'function') return;
      const input = /** @type {HTMLInputElement} */ (doc.createElement('input'));
      input.type = 'file';
      input.accept = AUDIO_ACCEPT;
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) void takeFile(file);
      });
      if (typeof input.click === 'function') input.click();
    }

    /** @param {any} ev */
    const hasFiles = (ev) => {
      const dt = ev && ev.dataTransfer;
      const types = dt && dt.types ? Array.from(/** @type {ArrayLike<string>} */ (dt.types)) : [];
      return types.indexOf('Files') >= 0;
    };
    /** @param {any} ev */
    function onDragOver(ev) {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      host.classList.add('is-over');
    }
    function onDragLeave() { host.classList.remove('is-over'); }
    /** @param {any} ev */
    function onDrop(ev) {
      host.classList.remove('is-over');
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      // A file dropped ON this box is this box's: the canvas would otherwise place a new box for it.
      ev.stopPropagation();
      const files = ev.dataTransfer && ev.dataTransfer.files ? Array.from(/** @type {ArrayLike<any>} */ (ev.dataTransfer.files)) : [];
      // A box holds ONE sound: the first sound dropped (else the first file, so the refusal names
      // it), and the others are named rather than dropped silently (build rule 6).
      const file = files.find((f) => classify(f).kind === 'audio') || files[0];
      if (file && files.length > 1) sayOnlyOne(app, String(file.name || ''), files.length - 1);
      void takeFile(file);
    }

    empty.addEventListener('click', choose);
    replace.addEventListener('click', choose);
    play.addEventListener('click', () => { void toggle(); });
    remove.addEventListener('click', () => {
      stopMine();
      forget(String(settingsOf(live).fileId || ''));
      problem = '';
      ctx.update(EMPTY());
      ctx.commit(t('parts.audioRemove'));
      paint(ctx.part || live);
    });
    host.addEventListener('dragover', onDragOver);
    host.addEventListener('dragleave', onDragLeave);
    host.addEventListener('drop', onDrop);

    paint(part);
    return {
      update(next) {
        // Replace, Remove, undo or an import changed the file under a playing sound: stop it.
        if (handle && String(settingsOf(next).fileId || '') !== handle.fileId) handle.stop();
        paint(next);
      },
      destroy() {
        destroyed = true;
        stopMine();
        forget(String(settingsOf(live).fileId || ''));
        cancelFrame(frame);
        host.removeEventListener('dragover', onDragOver);
        host.removeEventListener('dragleave', onDragLeave);
        host.removeEventListener('drop', onDrop);
        takes.destroy();
        host.classList.remove('graph-audio', 'is-over');
        delete host.dataset.playing;
        host.replaceChildren();
      },
    };
  },

  async run(input) {
    const s = (input.part && input.part.settings) || {};
    if (!s.fileId) throw partFail(t('parts.audioEmpty'), 'empty');
    const app = input.app || null;
    // A box whose file is gone says so, rather than describing a sound this computer no longer has.
    const media = app && app.media;
    if (media && typeof media.get === 'function') {
      let rec = null;
      try { rec = await media.get(String(s.fileId)); } catch { rec = null; }
      if (!rec) throw partFail(t('parts.mediaMissing'), 'part');
    }
    const session = app && app.host && app.host.session;
    const docNow = session && typeof session.doc === 'function' ? session.doc() : { parts: [], wires: [] };
    const specs = session && session.specs ? session.specs : new Map();
    const v = takesFor(docNow, input.part.id, 'audio', farmViewOf(app), specs);
    // TEXT, always: while graph/takes.mjs AUDIO_SEND is false nothing here, or anywhere, builds a
    // sound part for a request (KF-6).
    return valueOf('text', t('parts.audioValue', {
      name: String(s.name || t('parts.audioUnnamed')),
      duration: clock(s.durationSec),
      mb: mbOf(s.size),
      why: v.reason || '',
    }));
  },
});
