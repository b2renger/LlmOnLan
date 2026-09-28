// @ts-check
// Trigger (ecosystem plan v2 §8b, P3b) — a box that STARTS A RUN by itself: on each message on a topic of
// the farm's message bus, or every N seconds. An event is an automatic ▶ on this box (the same door the ▶
// uses), so what comes after it runs with the event's value. The rules (plan §8b):
//   1. it starts runs ONLY while a person has ARMED the outputs and the Computer is ON SCREEN — the same
//      arming as the Send box, and nothing stays armed after a reload or a quit;
//   2. LATEST WINS: at most one run every `gapSec`; the messages in between only update the value it hands
//      on, and the face counts them;
//   3. an HOURLY BUDGET of runs (`perHour`, default 60): past it, messages still update the value but start
//      nothing, and the face says why.
// Its value is the latest message ({topic, data}) or, on a schedule, {tick, at}.

import { valueOf } from '../values.mjs';
import { partFail } from './common.mjs';
import { listenBus } from './receive.mjs';
import { outputsDoor } from '../../projects/bridge.mjs';
import { textField, numberField } from './fields.mjs';
import { t } from '../../core/i18n.mjs';
import { EV } from '../../core/events.mjs';
import '../../strings/parts-trigger.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const SOURCES = Object.freeze(['bus', 'schedule']);
const SOURCE_KEY = { bus: 'parts.triggerSource_bus', schedule: 'parts.triggerSource_schedule' };
/** Why an event started no run (chat-lint rule 5: a literal map). */
const WHY_KEY = { unarmed: 'parts.triggerWhy_unarmed', hidden: 'parts.triggerWhy_hidden', budget: 'parts.triggerWhy_budget', gap: 'parts.triggerWhy_gap', nobus: 'parts.busErrNoBus' };
export const MIN_EVERY_SEC = 2;
export const MIN_GAP_SEC = 1;

/** partId -> { last: any, events, runs: number[] (start times), merged, tick } — a run's memory, never saved. */
const state = new Map();
const stateOf = (/** @type {string} */ id) => {
  if (!state.has(id)) state.set(id, { last: null, events: 0, runs: /** @type {number[]} */ ([]), merged: 0, tick: 0, why: '' });
  return state.get(id);
};

/**
 * PURE: may this event start a run? {go} or {go:false, why}. `runs` are the start times of the runs so far.
 * @param {{armed: boolean, shown: boolean, now: number, runs: number[], gapSec: number, perHour: number}} o
 * @returns {{go: boolean, why: 'unarmed'|'hidden'|'gap'|'budget'|''}}
 */
export function mayFire(o) {
  if (!o.armed) return { go: false, why: 'unarmed' };
  if (!o.shown) return { go: false, why: 'hidden' };
  const hour = o.runs.filter((ts) => o.now - ts < 3600_000);
  if (hour.length >= Math.max(1, o.perHour)) return { go: false, why: 'budget' };
  const last = o.runs.length ? o.runs[o.runs.length - 1] : -Infinity;
  if (o.now - last < Math.max(MIN_GAP_SEC, o.gapSec) * 1000) return { go: false, why: 'gap' };
  return { go: true, why: '' };
}

/** @type {PartSpec} */
export const triggerPart = /** @type {any} */ ({
  type: 'trigger',
  order: 620,
  label: t('parts.triggerLabel'),
  thinks: false,
  size: { w: 320, h: 250 },
  inputs: [],
  output: 'json',
  defaults: () => ({ source: 'bus', topic: 'lol/#', every: 10, gapSec: 2, perHour: 60 }),

  render(host, part, ctx) {
    const id = String(part.id);
    const wrap = document.createElement('div');
    wrap.className = 'graph-trigger';
    wrap.title = t('parts.triggerHint');
    const source = document.createElement('select');
    source.className = 'graph-receive-take';
    source.setAttribute('aria-label', t('parts.triggerSource'));
    source.title = t('parts.triggerSourceHint');
    for (const k of SOURCES) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = t(/** @type {any} */ (SOURCE_KEY)[k]);
      source.appendChild(o);
    }
    source.addEventListener('change', () => { ctx.update({ source: source.value }); ctx.commit(t('parts.triggerSource')); });
    const topicF = textField(t('parts.receiveTopic'), part.settings.topic, { onInput: (v) => ctx.update({ topic: v }), onCommit: () => ctx.commit(t('parts.receiveTopic')), placeholder: 'lol/+/button' });
    const everyF = numberField(t('parts.triggerEvery'), Number(part.settings.every) || 10, MIN_EVERY_SEC, (n) => { ctx.update({ every: n }); ctx.commit(t('parts.triggerEvery')); }, 86400);
    const gapF = numberField(t('parts.triggerGap'), Number(part.settings.gapSec) || 2, MIN_GAP_SEC, (n) => { ctx.update({ gapSec: n }); ctx.commit(t('parts.triggerGap')); }, 3600);
    const perHourF = numberField(t('parts.triggerPerHour'), Number(part.settings.perHour) || 60, 1, (n) => { ctx.update({ perHour: n }); ctx.commit(t('parts.triggerPerHour')); }, 3600);
    topicF.node.title = t('parts.triggerTopicHint');
    everyF.node.title = t('parts.triggerEveryHint');
    gapF.node.title = t('parts.triggerGapHint');
    perHourF.node.title = t('parts.triggerPerHourHint');
    const status = document.createElement('p');
    status.className = 'graph-receive-live';
    wrap.append(source, topicF.node, everyF.node, gapF.node, perHourF.node, status);
    host.replaceChildren(wrap);

    const st = stateOf(id);
    const shown = () => {
      const root = ctx.app && ctx.app.root;
      return (!root || !root.classList || !root.classList.contains('hidden')) && (typeof document === 'undefined' || document.visibilityState !== 'hidden');
    };
    const paintStatus = () => {
      const hour = st.runs.filter((ts) => Date.now() - ts < 3600_000).length;
      const counts = t('parts.triggerCounts', { events: st.events, runs: hour, merged: st.merged });
      const why = st.why ? t(/** @type {any} */ (WHY_KEY)[st.why] || WHY_KEY.gap) : '';
      status.textContent = why ? `${counts} · ${why}` : counts;
    };
    /** One event: remember it, then start a run if the rules allow. @param {any} value */
    const onEvent = async (value) => {
      st.last = value;
      st.events += 1;
      const door = outputsDoor();
      const armed = door ? !!(await door.armed()) : false;
      const verdict = mayFire({ armed, shown: shown(), now: Date.now(), runs: st.runs, gapSec: Number(ctx.part.settings.gapSec) || 2, perHour: Number(ctx.part.settings.perHour) || 60 });
      st.why = verdict.why;
      if (!verdict.go) {
        if (verdict.why === 'gap' || verdict.why === 'budget') st.merged += 1;
        paintStatus();
        return;
      }
      st.runs.push(Date.now());
      if (st.runs.length > 5000) st.runs.splice(0, st.runs.length - 5000);
      paintStatus();
      const hostApi = ctx.app && ctx.app.host && ctx.app.host.debug;
      if (hostApi && typeof hostApi.run === 'function') void hostApi.run({ mode: 'from', seeds: [id] });
    };

    let off = () => {};
    let key = '';
    /** @param {any} s */
    const arm = (s) => {
      const src = SOURCES.includes(String(s.source)) ? String(s.source) : 'bus';
      const caps = ctx.app && ctx.app.farm && typeof ctx.app.farm.get === 'function' ? ctx.app.farm.get() : null;
      // The bus's own address is part of the key: a Trigger drawn before the farm (or its bus) was known used to keep
      // its key and never listen until a setting changed (found by the in-app review, 2026-09-28).
      const next = src === 'bus' ? `bus:${s.topic}|${caps && caps.bus ? caps.bus.ws : ''}` : `schedule:${s.every}`;
      if (next === key) return;
      off(); off = () => {};
      key = next;
      if (st.why === 'nobus') st.why = '';
      if (src === 'bus') {
        const filter = String(s.topic || '').trim();
        // A farm without a bus would leave this face counting zeros for ever: say why instead.
        if (caps && !caps.bus) st.why = 'nobus';
        if (!filter || !caps || !caps.bus) return;
        const e = listenBus(`trigger:${id}`, caps, filter);
        const fn = (/** @type {string} */ topic, /** @type {any} */ data) => { void onEvent({ topic, data }); };
        e.listeners.add(fn);
        off = () => e.listeners.delete(fn);
        return;
      }
      // setTimeout, re-armed after each tick (chat-lint rule 13: no setInterval).
      let timer = /** @type {any} */ (null);
      const everyMs = Math.max(MIN_EVERY_SEC, Number(s.every) || 10) * 1000;
      const tick = () => {
        st.tick += 1;
        void onEvent({ tick: st.tick, at: new Date().toISOString() });
        timer = setTimeout(tick, everyMs);
      };
      timer = setTimeout(tick, everyMs);
      off = () => clearTimeout(timer);
    };
    // The farm (or its bus) can arrive or change without the box being repainted (the canvas repaints on a catalogue
    // change only): re-arm on every farm change, with the settings the box has now.
    let current = part;
    const offFarm = ctx.app && ctx.app.bus && typeof ctx.app.bus.on === 'function'
      ? ctx.app.bus.on(EV.FARM_CHANGE, () => { arm(current.settings || {}); paintStatus(); })
      : () => {};
    /** @param {any} p */
    const paint = (p) => {
      current = p;
      const s = p.settings || {};
      const src = SOURCES.includes(String(s.source)) ? String(s.source) : 'bus';
      if (document.activeElement !== source) source.value = src;
      topicF.node.hidden = src !== 'bus';
      everyF.node.hidden = src !== 'schedule';
      topicF.update(s.topic);
      everyF.update(Number(s.every) || 10);
      gapF.update(Number(s.gapSec) || 2);
      perHourF.update(Number(s.perHour) || 60);
      arm(s);
      paintStatus();
    };
    paint(part);
    return { update: paint, destroy() { off(); offFarm(); wrap.remove(); } };
  },

  async run(input) {
    const st = stateOf(String(input.part.id));
    if (st.last == null) throw partFail(t('parts.triggerNothingYet'), 'empty');
    return valueOf('json', st.last);
  },
});

/** Tests: forget every trigger's memory. */
export function resetTriggers() { state.clear(); }
