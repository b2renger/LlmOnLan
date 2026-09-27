// @ts-check
// Speak (docs/ECOSYSTEM_PLAN.md v2 §3.3) — says what arrives, out loud, and passes the same text on.
//
// Two voices, the person picks (or Automatic):
//   - this computer's own: `speechSynthesis` (a platform feature — the OS voices, offline, nothing
//     leaves the laptop);
//   - the farm's: Kokoro, when the farm advertises it (net/tts.mjs, the ONE door), played through the
//     window's one AudioContext (graph/parts/audio.mjs playBytes — no <audio> element, lint).
// Stop stops the voice. The run waits until the sentence is said, so "then do the next thing" works.

import { valueOf } from '../values.mjs';
import { partFail, textOf } from './common.mjs';
import { playBytes } from './audio.mjs';
import { speakOnFarm, TTS_MAX_CHARS } from '../../net/tts.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-speak.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const SPEAK_VOICES = Object.freeze(['auto', 'farm', 'local']);
/** A literal map, so lint rule 5 can see every key a person may read. */
const VOICE_KEY = { auto: 'parts.speakVoiceAuto', farm: 'parts.speakVoiceFarm', local: 'parts.speakVoiceLocal' };

/** partId -> the face's last line. Never persisted (a render hint). */
const notes = new Map();

/**
 * PURE: which voice to use. @param {string} setting @param {boolean} farmHasVoice @param {boolean} localHasVoice
 * @returns {'farm'|'local'|null}
 */
export function voiceFor(setting, farmHasVoice, localHasVoice) {
  if (setting === 'farm') return farmHasVoice ? 'farm' : null;
  if (setting === 'local') return localHasVoice ? 'local' : null;
  if (farmHasVoice) return 'farm';
  return localHasVoice ? 'local' : null;
}

/** Say `text` with this computer's voice; resolves when it is said, or stopped. The OS does not
 * always fire `end` (no voice installed, a muted device), so a ceiling from the text's length ends
 * the wait. @param {string} text @param {AbortSignal} [signal] */
function sayLocally(text, signal) {
  const synth = /** @type {any} */ (globalThis).speechSynthesis;
  const Utterance = /** @type {any} */ (globalThis).SpeechSynthesisUtterance;
  return new Promise((resolve) => {
    let over = false;
    const finish = () => { if (!over) { over = true; clearTimeout(timer); resolve(true); } };
    const timer = setTimeout(finish, 4000 + text.length * 120);
    const u = new Utterance(text);
    u.onend = finish;
    u.onerror = finish;
    if (signal) signal.addEventListener('abort', () => { try { synth.cancel(); } catch { /* nothing to cancel */ } finish(); }, { once: true });
    synth.speak(u);
  });
}

/** @type {PartSpec} */
export const speakPart = /** @type {any} */ ({
  type: 'speak',
  order: 890,
  label: t('parts.speakLabel'),
  thinks: false,
  size: { w: 300, h: 150 },
  inputs: [{ name: 'in', label: t('parts.speakIn'), accepts: ['text', 'json', 'list'], many: true }],
  output: 'text',
  defaults: () => ({ voice: 'auto' }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-speak';
    wrap.title = t('parts.speakHint');
    const select = document.createElement('select');
    select.className = 'graph-speak-voice';
    select.setAttribute('aria-label', t('parts.speakVoice'));
    for (const v of SPEAK_VOICES) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t(/** @type {any} */ (VOICE_KEY)[v]);
      select.appendChild(o);
    }
    select.value = SPEAK_VOICES.includes(String(part.settings.voice)) ? String(part.settings.voice) : 'auto';
    select.addEventListener('change', () => { ctx.update({ voice: select.value }); ctx.commit(t('parts.speakVoice')); });
    const said = document.createElement('p');
    said.className = 'graph-speak-said';
    wrap.append(select, said);
    host.replaceChildren(wrap);
    /** @param {any} p */
    const paint = (p) => { said.textContent = notes.get(String(p.id)) || ''; };
    paint(part);
    return {
      update(next) {
        if (document.activeElement !== select) select.value = SPEAK_VOICES.includes(String(next.settings.voice)) ? String(next.settings.voice) : 'auto';
        paint(next);
      },
      destroy() { wrap.remove(); },
    };
  },

  async run(input) {
    const id = String(input.part.id);
    const text = ((input.inputs && input.inputs.in) || []).map(textOf).join('\n').trim();
    if (!text) throw partFail(t('parts.speakEmpty'), 'empty');
    if (text.length > TTS_MAX_CHARS) throw partFail(t('parts.speakTooLong', { n: text.length, max: TTS_MAX_CHARS }), 'part');
    const farm = input.app && input.app.farm && typeof input.app.farm.get === 'function' ? input.app.farm.get() : null;
    const tts = farm && farm.tts && farm.tts.url ? farm.tts : null;
    const localVoice = typeof globalThis !== 'undefined' && !!(/** @type {any} */ (globalThis).speechSynthesis) && typeof (/** @type {any} */ (globalThis).SpeechSynthesisUtterance) === 'function';
    const setting = String((input.part.settings && input.part.settings.voice) || 'auto');
    const voice = voiceFor(setting, !!tts, localVoice);
    if (!voice) throw partFail(setting === 'farm' ? t('parts.speakNoFarmVoice') : t('parts.speakNoVoice'), 'part');

    if (voice === 'farm') {
      const out = await speakOnFarm({ url: /** @type {any} */ (tts).url, voice: /** @type {any} */ (tts).voice, model: /** @type {any} */ (tts).model, text, signal: input.signal });
      if ('error' in out) {
        if (out.code === 'aborted') throw partFail(t('parts.speakErr', { message: 'stopped' }), 'aborted');
        throw partFail(t('parts.speakErr', { message: out.error }), 'part');
      }
      const played = await playBytes(out.bytes, input.signal);
      if (!played.ok) throw partFail(played.error, 'part');
    } else {
      await sayLocally(text, input.signal);
    }
    notes.set(id, t('parts.speakSaid', { voice: voice === 'farm' ? t('parts.speakWithFarm') : t('parts.speakWithLocal'), text: text.slice(0, 80) }));
    return valueOf('text', text);
  },
});
