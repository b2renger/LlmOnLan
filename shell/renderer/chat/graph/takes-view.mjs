// @ts-check
// The "takes:" line on a box that holds a file (K6-U1, addendum KF-3). NOT pure: it draws.
//
// A box appends `view.el` into its body and calls `view.refresh()` from its own `update()` — the
// canvas calls every part's `update()` on every document change, so wiring edits reach it for
// free. Farm and capability changes arrive on the bus (EV.FARM_CHANGE, app/caps.mjs CAPS_EVENT),
// which this module subscribes to itself and drops in `destroy()`.
//
// DOM probes, frozen: `.graph-takes[data-kind][data-state]` holding `.graph-takes-label` (always
// shown: "takes: PDF ✓") and `.graph-takes-why` (the SENTENCE, shown whenever the state is not
// `yes` — a refusal is visible words, never a tooltip). The Instruction's line is `.graph-ins-caps`
// (`modelCapsLine`, hosted by graph/parts/instruction.mjs).
//
// Repaints are signature-guarded: the line is touched only when what it says moved, so the canvas
// calling `refresh()` on every keystroke costs one resolver pass and no layout.

import { t } from '../core/i18n.mjs';
import { EV } from '../core/events.mjs';
import { CAPS_EVENT, relayCapsTo } from '../app/caps.mjs';
import { takesFor, farmViewOf, modelCaps } from './takes.mjs';
import '../strings/takes.en.mjs';

/** @typedef {import('../core/types.mjs').MediaKind} MediaKind */
/** @typedef {import('../core/types.mjs').TakeVerdict} TakeVerdict */

const KIND_KEY = { image: 'takes.kindImage', pdf: 'takes.kindPdf', audio: 'takes.kindAudio', text: 'takes.kindText' };
const MARK_KEY = { yes: 'takes.markYes', no: 'takes.markNo', unknown: 'takes.markUnknown', unwired: 'takes.markUnwired' };
/** The mark in words, for a screen reader and a hover (the SENTENCE is what carries the reason). */
const STATE_KEY = { yes: 'takes.stateYes', no: 'takes.stateNo', unknown: 'takes.stateUnknown', unwired: 'takes.stateUnwired' };

/** The open document and the catalogue, asked for at CALL time (the host publishes itself after
 * the parts load). @param {any} app */
function sessionOf(app) {
  const session = app && app.host && app.host.session;
  return session && typeof session.doc === 'function' ? session : null;
}

/** Make sure a catalogue read reaches THIS surface's bus (app/caps.mjs `relayCapsTo`): the
 * Computer shares the chat's caps install, but not its bus. @param {any} app */
function relay(app) {
  if (app && app.bus) relayCapsTo(app.bus);
}

/**
 * @param {{app: any, partId: string, kind: MediaKind, doc?: Document}} o
 * @returns {{el: HTMLElement, refresh(): void, verdict(): TakeVerdict|null, destroy(): void}}
 */
export function renderTakes(o) {
  const doc = o.doc || document;
  const app = o.app || null;
  const kind = o.kind;
  const el = doc.createElement('div');
  el.className = 'graph-takes';
  // setAttribute, not `dataset`: the probe is the ATTRIBUTE (h.computer.takes reads it).
  el.setAttribute('data-kind', kind);
  el.setAttribute('role', 'status');
  const label = doc.createElement('span');
  label.className = 'graph-takes-label';
  const why = doc.createElement('p');
  why.className = 'graph-takes-why';
  why.hidden = true;
  el.append(label, why);

  /** @type {TakeVerdict|null} */ let last = null;
  let sig = '';
  let gone = false;

  function refresh() {
    if (gone) return;
    const session = sessionOf(app);
    const d = session ? session.doc() : { parts: [], wires: [] };
    const specs = session && session.specs ? session.specs : new Map();
    const v = takesFor(d, o.partId, kind, farmViewOf(app), specs);
    last = v;
    const next = `${v.state}|${v.why}|${v.model || ''}|${v.reason || ''}`;
    if (next === sig) return;
    sig = next;
    el.setAttribute('data-state', v.state);
    const kindWord = t(KIND_KEY[/** @type {keyof typeof KIND_KEY} */ (kind)] || 'takes.kindText');
    label.textContent = t('takes.label', { kind: kindWord, mark: t(MARK_KEY[/** @type {keyof typeof MARK_KEY} */ (v.state)] || 'takes.markUnknown') });
    const words = t('takes.labelAria', { kind: kindWord, state: t(STATE_KEY[/** @type {keyof typeof STATE_KEY} */ (v.state)] || 'takes.stateUnknown') });
    label.setAttribute('aria-label', words);
    // A yes has nothing to refuse, so its sentence (e.g. "the farm reads this PDF when a run needs
    // it") is the hover; every other state SHOWS its sentence.
    label.setAttribute('title', v.state === 'yes' && v.reason ? v.reason : words);
    why.textContent = v.reason || '';
    why.hidden = v.state === 'yes' || !v.reason;
  }

  /** @type {Array<() => void>} */ const offs = [];
  const bus = app && app.bus;
  if (bus && typeof bus.on === 'function') {
    relay(app);
    for (const name of [EV.FARM_CHANGE, CAPS_EVENT]) {
      const off = bus.on(name, () => { try { refresh(); } catch (err) { console.warn('[lolcomputer] takes refresh failed', err); } });
      if (typeof off === 'function') offs.push(off);
    }
  }
  refresh();

  return {
    el,
    refresh,
    verdict: () => last,
    destroy() {
      gone = true;
      for (const off of offs.splice(0)) { try { off(); } catch { /* already gone */ } }
      el.remove();
    },
  };
}

/**
 * The Instruction's own line — what ITS model can take, as far as the farm has said. Shown only
 * while a box holding a picture or a sound is wired INTO this Instruction (`partId`), because that
 * is when it decides something; an Instruction with only text arriving stays the size it was
 * (k5-lessons measures that nothing grows into its neighbour). '' hides the line.
 * @param {any} app @param {string} model '' = the farm default @param {string} [partId]
 * @returns {string}
 */
export function modelCapsLine(app, model, partId) {
  // The wiring check first: it is what hides the line on almost every Instruction, and it runs on
  // every document change for every Instruction, so it must stay one pass over the wires.
  if (partId) {
    const session = sessionOf(app);
    const d = session ? session.doc() : null;
    const specs = session && session.specs ? session.specs : null;
    if (!d || !specs) return '';
    const fed = (d.wires || []).some((/** @type {any} */ w) => {
      if (!w || w.to !== partId) return false;
      const up = (d.parts || []).find((/** @type {any} */ p) => p && p.id === w.from);
      const spec = up && specs.get(up.type);
      const holds = spec && spec.holds;
      return holds === 'image' || holds === 'audio';
    });
    if (!fed) return '';
  }
  const view = farmViewOf(app);
  if (!view.present) return '';
  const caps = modelCaps(view, model);
  if (!caps.model) return '';
  // The Instruction subscribes to CAPS_EVENT on its own bus; make sure the catalogue read reaches it.
  relay(app);
  const mark = (/** @type {string} */ v) => t(MARK_KEY[/** @type {keyof typeof MARK_KEY} */ (v)] || 'takes.markUnknown');
  return t('takes.modelLine', { model: caps.model, vision: mark(caps.vision), audio: mark(caps.audio), pdf: mark(caps.pdf) });
}
