// @ts-check
// What can THIS box pass on, right now? (K6, addendum KF-3) — PURE.
//
// A box that holds a file is only useful if something can consume the file. That depends on three
// things, and this module is the one place they are put together:
//   1. the WIRING  — which parts downstream send what arrives to a model (`PartSpec.modelOf`);
//   2. the MODELS  — what the farm says each of those models can take (`app.farm.cap`, fed by
//                    app/caps.mjs from LiteLLM's /model_group/info). `unknown` stays unknown;
//   3. the FARM    — which services it advertises (the OCR extractor, `farm.ocr`) and which
//                    engine answers (`farm.engine`), because the engine decides what can travel.
//
// Nothing here fetches, touches the DOM or reads a global: the caller gathers a FarmView once
// (`farmViewOf(app)`) and hands it in, which is what lets computer-takes.test.mjs pin every
// sentence in Node. The sentences live in strings/takes.en.mjs (K6-U1).
//
// K6-U1 owns this file. The exports, their signatures, the `why` codes and the two constants
// below are frozen (addendum KF-3); a verdict is the WORST of the box's consumers, for pictures
// and for sound alike, because a run fails where any one of them cannot take the file.

import { t } from '../core/i18n.mjs';
import '../strings/takes.en.mjs';

/** @typedef {import('../core/types.mjs').Verdict} Verdict */
/** @typedef {import('../core/types.mjs').CapName} CapName */
/** @typedef {import('../core/types.mjs').ModelCaps} ModelCaps */
/** @typedef {import('../core/types.mjs').MediaKind} MediaKind */
/** @typedef {import('../core/types.mjs').FarmView} FarmView */
/** @typedef {import('../core/types.mjs').TakeVerdict} TakeVerdict */
/** @typedef {import('../core/types.mjs').TakeConsumer} TakeConsumer */

/** The file kinds a box can hold, in the order a "takes:" line lists them. Frozen. */
export const MEDIA_KINDS = Object.freeze(['image', 'pdf', 'audio', 'text']);

/** The capability names `app.farm.cap()` answers (KF-2). Frozen. */
export const CAP_NAMES = Object.freeze(['vision', 'audio', 'pdf']);

/**
 * KF-1(b): NO verified path carries an `input_audio` part from this client to a model on this
 * farm. LiteLLM's `ollama_chat` transform keeps only `text` and `image_url` parts and DROPS the
 * rest without a word, so audio sent to the default engine would vanish and the model would answer
 * as if nothing had been attached — the quiet loss this project bans. While this is false the
 * resolver never answers `yes` for sound and nothing ever builds an audio part. Flipping it is a
 * KICKOFF decision backed by a verified path, never a builder's.
 */
export const AUDIO_SEND = false;

/** KF-1(b): the same for a model's OWN PDF input (an OpenAI `file` part) — dropped by the same
 * transform. A PDF reaches a model as TEXT, extracted by the farm's OCR service. */
export const NATIVE_PDF_SEND = false;

/** The `why` codes, frozen (KF-3). One sentence each in strings/takes.en.mjs (WHY_KEY below). */
export const WHY = Object.freeze({
  noFarm: 'no-farm',                    // any kind: not connected, so nobody can say
  ocr: 'ocr',                           // pdf yes: the farm reads it when a run needs it
  noOcr: 'no-ocr',                      // pdf no: the farm advertises no extractor
  unwired: 'unwired',                   // image/audio: nothing downstream sends it to a model
  vision: 'vision',                     // image yes
  noVision: 'no-vision',                // image no: the farm does not list the model as seeing
  visionUnknown: 'vision-unknown',      // image unknown: the farm does not say
  engineNoAudio: 'engine-no-audio',     // audio no: the Ollama engine cannot carry sound at all
  noAudio: 'no-audio',                  // audio no: the farm says the model cannot listen
  audioUnreported: 'audio-unreported',  // audio no: the farm does not say the model listens (the common case)
  audioUnverified: 'audio-unverified',  // audio no: every model says it can, the path is unverified
  text: 'text',                         // text: always usable, nothing to check
});

const str = (/** @type {any} */ v) => (typeof v === 'string' ? v : '');

/**
 * Gather what the resolver may know, from the App, ONCE. Reads `app.farm` and nothing else.
 * @param {any} app @returns {FarmView}
 */
export function farmViewOf(app) {
  const farm = app && app.farm;
  const caps = farm && typeof farm.get === 'function' ? farm.get() : null;
  const models = caps && Array.isArray(caps.models) ? caps.models : [];
  return {
    present: !!(caps && caps.present),
    engine: (caps && caps.engine) || null,
    ocr: !!(caps && caps.ocr && caps.ocr.url),
    defaultModel: (caps && caps.defaultModel) || (models.find((/** @type {any} */ m) => m && m.default) || {}).id || null,
    models: models.map((/** @type {any} */ m) => str(m && m.id)).filter(Boolean),
    cap: (model, name) => {
      if (!farm || typeof farm.cap !== 'function') return 'unknown';
      const v = farm.cap(model, name);
      return v === 'yes' || v === 'no' ? v : 'unknown';
    },
    underlyingOf: (alias) => {
      const info = farm && typeof farm.modelInfo === 'function' ? farm.modelInfo(alias) : null;
      return str(info && info.underlying) || alias;
    },
  };
}

/**
 * One model's capabilities, asking under BOTH names in play — the served alias (what LiteLLM's
 * catalogue is keyed by) and the underlying model (what the store may have learnt). Either saying
 * `no` is the farm saying no (the Instruction's own rule); `yes` needs a yes and no no.
 * @param {FarmView} view @param {string} model '' = the farm default @returns {ModelCaps}
 */
export function modelCaps(view, model) {
  const alias = str(model) || str(view && view.defaultModel);
  const under = alias && view ? view.underlyingOf(alias) : '';
  const names = [alias, under].filter((n, i, a) => n && a.indexOf(n) === i);
  /** @param {CapName} name @returns {Verdict} */
  const one = (name) => {
    const vs = names.map((n) => view.cap(n, name));
    if (vs.includes('no')) return 'no';
    if (vs.includes('yes')) return 'yes';
    return 'unknown';
  };
  return { model: alias, vision: one('vision'), audio: one('audio'), pdf: one('pdf') };
}

/**
 * The parts directly downstream of `partId` that SEND what arrives to a model — declared by
 * `PartSpec.modelOf`, never by type name.
 * @param {{parts: any[], wires: any[]}} doc @param {string} partId @param {Map<string, any>} specs
 * @returns {{partId: string, model: string}[]}
 */
export function consumersOf(doc, partId, specs) {
  const parts = (doc && Array.isArray(doc.parts)) ? doc.parts : [];
  const wires = (doc && Array.isArray(doc.wires)) ? doc.wires : [];
  /** @type {{partId: string, model: string}[]} */ const out = [];
  const seen = new Set();
  for (const w of wires) {
    if (!w || w.from !== partId || seen.has(w.to)) continue;
    const part = parts.find((p) => p && p.id === w.to);
    const spec = part && specs && specs.get(part.type);
    if (!spec || typeof spec.modelOf !== 'function') continue;
    seen.add(w.to);
    out.push({ partId: w.to, model: str(spec.modelOf(part)) });
  }
  return out;
}

/**
 * THE question (KF-3): can the box `partId`, holding a file of `kind`, pass it to something that
 * can use it right now — and if not, the sentence that says why and what would make it work.
 * @param {{parts: any[], wires: any[]}} doc @param {string} partId @param {MediaKind} kind
 * @param {FarmView} view @param {Map<string, any>} specs @returns {TakeVerdict}
 */
export function takesFor(doc, partId, kind, view, specs) {
  if (kind === 'text') return verdict(kind, 'yes', WHY.text, null, []);
  if (kind === 'pdf') {
    // A PDF reaches a model as TEXT, extracted by the farm (the sanctioned OCR flow). The text
    // flows on to anything that takes text, so wiring does not decide it — the farm does.
    if (!view || !view.present) return verdict(kind, 'unknown', WHY.noFarm, null, []);
    if (!view.ocr) return verdict(kind, 'no', WHY.noOcr, null, []);
    return verdict(kind, 'yes', WHY.ocr, null, []);
  }
  const found = consumersOf(doc, partId, specs);
  if (!found.length) return verdict(kind, 'unwired', WHY.unwired, null, []);
  if (!view || !view.present) {
    return verdict(kind, 'unknown', WHY.noFarm, null, found.map((c) => ({ ...c, state: /** @type {'unknown'} */ ('unknown') })));
  }
  if (kind === 'image') {
    const consumers = found.map((c) => {
      const caps = modelCaps(view, c.model);
      return { partId: c.partId, model: caps.model, state: caps.vision };
    });
    // The box's answer is the WORST of its consumers: a run fails where any one of them is blind,
    // and that is what the person needs to know before pressing ▶.
    const blind = consumers.find((c) => c.state === 'no');
    if (blind) return verdict(kind, 'no', WHY.noVision, blind.model, consumers);
    const unsure = consumers.find((c) => c.state === 'unknown');
    if (unsure) return verdict(kind, 'unknown', WHY.visionUnknown, unsure.model, consumers);
    return verdict(kind, 'yes', WHY.vision, consumers[0].model, consumers);
  }
  // audio
  const consumers = found.map((c) => {
    const caps = modelCaps(view, c.model);
    return { partId: c.partId, model: caps.model, state: caps.audio };
  });
  const first = consumers[0];
  const noSend = consumers.map((c) => ({ ...c, state: /** @type {'no'} */ ('no') }));
  if (view.engine === 'ollama') return verdict(kind, 'no', WHY.engineNoAudio, first.model, noSend);
  const refuses = consumers.find((c) => c.state === 'no');
  if (refuses) return verdict(kind, 'no', WHY.noAudio, refuses.model, noSend);
  // Worst consumer wins here too: sound goes out only if EVERY model it reaches said it listens.
  const unsure = consumers.find((c) => c.state !== 'yes');
  if (unsure) return verdict(kind, 'no', WHY.audioUnreported, unsure.model, noSend);
  // Every consumer said yes. While no path is verified (AUDIO_SEND false) that is still a no, and
  // the sentence says it is LOL's caution, not the model's limit. Were it ever flipped, the box
  // would say yes with nothing to explain — the "not sent yet" sentence would then be a lie.
  if (!AUDIO_SEND) return verdict(kind, 'no', WHY.audioUnverified, first.model, noSend);
  return { kind, state: 'yes', why: WHY.audioUnverified, model: first.model, consumers, reason: null };
}

/**
 * @param {MediaKind} kind @param {'yes'|'no'|'unknown'|'unwired'} state @param {string} why
 * @param {string|null} model @param {TakeConsumer[]} consumers @returns {TakeVerdict}
 */
function verdict(kind, state, why, model, consumers) {
  return { kind, state, why, model, consumers, reason: reasonFor(why, model) };
}

/** Each `why` code's sentence key (strings/takes.en.mjs). A literal map, so chat-lint rule 5 can
 * check every key exists. */
const WHY_KEY = {
  'no-farm': 'takes.whyNoFarm',
  ocr: 'takes.whyOcr',
  'no-ocr': 'takes.whyNoOcr',
  unwired: 'takes.whyUnwired',
  vision: 'takes.whyVision',
  'no-vision': 'takes.whyNoVision',
  'vision-unknown': 'takes.whyVisionUnknown',
  'engine-no-audio': 'takes.whyEngineNoAudio',
  'no-audio': 'takes.whyNoAudio',
  'audio-unreported': 'takes.whyAudioUnreported',
  'audio-unverified': 'takes.whyAudioUnverified',
};

/** The sentence for a `why` code. @param {string} why @param {string|null} model @returns {string|null} */
export function reasonFor(why, model) {
  if (!Object.prototype.hasOwnProperty.call(WHY_KEY, why)) return null;
  return t(WHY_KEY[/** @type {keyof typeof WHY_KEY} */ (why)], { model: model || t('takes.theModel') });
}
