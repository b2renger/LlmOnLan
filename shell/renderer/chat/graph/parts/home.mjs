// @ts-check
// The Home boxes (docs/HOME_ASSISTANT.md, 2026-10-09): a graph's way to the Home Assistant a person linked in
// Preferences. Both reach main's homeAssistant.ts through ONE door (projects/bridge.mjs homeDoor), where every rule
// lives: the token never comes to the page, and no rule is copied here.
//
//   Home (bring)          reads the devices a PERSON picked (Choose… — no input port, so no wire and no model chooses
//                         what is read): states, a weather's forecast, a calendar's next 24 hours, and their history.
//                         With NO home linked it hands on the copy it holds (a lesson's, a template's, or its last
//                         reading) and says so; a linked home that does not answer, or lacks the devices, is an error.
//   Home command (show)   ONE action on ONE device, both a PERSON's pick. What arrives is only the go signal; the
//                         details are the box's own "With", a person's too. Main makes it a dry run unless the outputs are armed AND home commands
//                         are allowed, and refuses what no one in LlmOnLan may do (locks, alarms, sirens, valves…).
//
// The faces' status lines are render HINTS (BG-5: a part writes only value/state/error/stats/fanout): a module map.

import { valueOf, isValue } from '../values.mjs';
import { partFail } from './common.mjs';
import { numberField, textField } from './fields.mjs';
import { homeDoor } from '../../projects/bridge.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-home.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const MAX_DEVICES = 30;
export const MAX_HOURS = 168;
const LIST_MAX = 200;

/** Why a reading failed (chat-lint rule 5: literal maps). `nolink` and `offline` may hand on the saved copy. */
const READ_ERR = { empty: 'parts.homeErr_empty', nolink: 'parts.homeErr_nolink', offline: 'parts.homeErr_offline', refused: 'parts.homeErr_refused', toomuch: 'parts.homeErr_refused', busy: 'parts.homeErr_refused' };
/** The saved copy is handed on ONLY when no home is linked: then a Home command is a dry run too. A linked home that
 * answers without the devices, or does not answer, is an error — a template's made-up reading must never drive a real
 * device (the security review, 2026-10-09). */
const SAVED_OK = new Set(['nolink']);
/** A command's outcome codes (src/main/homeAssistant.ts `command`) → what the box says. */
const CMD_ERR = {
  missing: 'parts.homeCmdErr_missing', readonly: 'parts.homeCmdErr_readonly', never: 'parts.homeCmdErr_never',
  action: 'parts.homeCmdErr_action', 'too-big': 'parts.homeCmdErr_tooBig', 'not-listed': 'parts.homeCmdErr_notListed',
  rate: 'parts.homeCmdErr_rate', unconfirmed: 'parts.homeCmdErr_unconfirmed', error: 'parts.homeCmdErr_error', offline: 'parts.homeCmdErr_error',
};

/** partId -> {text, offline} for the faces. Never persisted. */
const notes = new Map();

/** PURE: the device ids a box's settings name — clean, unique, at most MAX_DEVICES. @param {any} s @returns {string[]} */
export function entitiesOf(s) {
  const raw = s && Array.isArray(s.entities) ? s.entities : [];
  return [...new Set(raw.map((/** @type {any} */ x) => String(x).trim()).filter((/** @type {string} */ x) => /^[a-z0-9_]+\.[a-z0-9_]+$/.test(x)))].slice(0, MAX_DEVICES);
}

/**
 * PURE: what a Home command sends with its action: the box's own "With" (JSON text), which only a person sets. What
 * arrives is only the go signal — never the details (the security review, 2026-10-09: a model could otherwise set them
 * through a wired box, and a Condition passing a reading on would send the reading as details). {data} or {bad:true}.
 * @param {any} settings
 */
export function commandData(settings) {
  const own = String((settings && settings.data) || '').trim();
  if (!own) return { data: undefined };
  try {
    const v = JSON.parse(own);
    return v && typeof v === 'object' && !Array.isArray(v) ? { data: v } : { bad: true };
  } catch { return { bad: true }; }
}

/** PURE: the arming question's line for a Home command box, or '' when it names no device: the device id FIRST, then the
 * name a graph gave it (no control character, ≤ 60 characters), then its details. @param {any} part */
export function homeTarget(part) {
  const s = (part && part.settings) || {};
  if (!s.entity) return '';
  const raw = String(s.name || '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim();
  const name = raw && raw !== s.entity ? ` “${raw.length > 60 ? `${raw.slice(0, 59)}…` : raw}”` : '';
  const data = String(s.data || '').trim();
  return t('parts.homeCmdTarget', { action: String(s.action || '?'), name: `${s.entity}${name}${data ? ` ${t('parts.homeCmdWith', { data: data.slice(0, 120) })}` : ''}` });
}

/**
 * The person's picker: a search field and the home's list under `anchor`. `many` ticks several; otherwise one click
 * picks. `pick` gets the chosen ids (and their names).
 * @param {any} ctx @param {HTMLElement} anchor @param {{many: boolean, chosen: string[], only?: (e: any) => boolean,
 *   pick: (ids: string[], names: Record<string, string>) => void, note: HTMLElement}} o
 */
async function choose(ctx, anchor, o) {
  const door = homeDoor();
  o.note.hidden = true;
  const r = door ? await door.entities() : { ok: false, code: 'nolink' };
  if (!r || r.ok !== true) {
    const code = r && Object.prototype.hasOwnProperty.call(READ_ERR, r.code) ? r.code : 'offline';
    o.note.textContent = door ? t(/** @type {any} */ (READ_ERR)[code], { message: String((r && r.message) || '') }) : t('parts.homeNoDoor');
    o.note.hidden = false;
    return;
  }
  const all = (Array.isArray(r.list) ? r.list : []).filter((/** @type {any} */ e) => !o.only || o.only(e));
  const dialogs = ctx.app && ctx.app.dialogs;
  if (!dialogs || typeof dialogs.popover !== 'function') return;
  const picked = new Set(o.chosen);
  /** @type {Record<string, string>} */ const names = {};
  for (const e of all) names[e.id] = e.name;
  dialogs.popover(anchor, (/** @type {HTMLElement} */ el, /** @type {() => void} */ close) => {
    el.classList.add('graph-board-list', 'graph-home-list');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'graph-part-input';
    search.placeholder = t('parts.homeSearch');
    search.setAttribute('aria-label', t('parts.homeSearch'));
    const rows = document.createElement('div');
    rows.className = 'graph-home-rows';
    const fill = () => {
      const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = all.filter((/** @type {any} */ e) => words.every((w) => `${e.id} ${e.name}`.toLowerCase().includes(w)));
      const items = hits.slice(0, LIST_MAX).map((/** @type {any} */ e) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'graph-home-row';
        b.setAttribute('aria-pressed', String(picked.has(e.id)));
        b.textContent = `${o.many ? (picked.has(e.id) ? '☑ ' : '☐ ') : ''}${e.name} · ${e.state}`;
        b.title = e.id;
        b.addEventListener('click', () => {
          if (!o.many) { o.pick([e.id], names); close(); return; }
          if (picked.has(e.id)) picked.delete(e.id);
          else if (picked.size < MAX_DEVICES) picked.add(e.id);
          fill();
        });
        return b;
      });
      const tail = document.createElement('p');
      tail.className = 'graph-board-note';
      tail.textContent = !hits.length ? t('parts.homeNoMatch') : hits.length > LIST_MAX ? t('parts.homeListMore', { n: hits.length - LIST_MAX }) : '';
      rows.replaceChildren(...items, ...(tail.textContent ? [tail] : []));
    };
    search.addEventListener('input', fill);
    el.append(search, rows);
    if (o.many) {
      const done = document.createElement('button');
      done.type = 'button';
      done.textContent = t('parts.homeDone');
      done.addEventListener('click', () => { o.pick([...picked], names); close(); });
      el.append(done);
    }
    fill();
    search.focus();
  });
}

/** A "Choose…" row: a line saying what is picked, the button, and a note for a failure. */
function chooseRow() {
  const row = document.createElement('div');
  row.className = 'graph-board';
  const line = document.createElement('div');
  line.className = 'graph-board-line';
  const name = document.createElement('span');
  name.className = 'graph-board-name';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'graph-board-choose';
  btn.textContent = t('parts.homeChoose');
  const note = document.createElement('p');
  note.className = 'graph-board-note';
  note.hidden = true;
  line.append(name, btn);
  row.append(line, note);
  return { row, name, btn, note };
}

/** @type {PartSpec} */
export const homeReadPart = /** @type {any} */ ({
  type: 'home',
  order: 36,
  label: t('parts.homeLabel'),
  thinks: false,
  size: { w: 340, h: 170 },
  inputs: [],
  output: 'json',
  defaults: () => ({ entities: [], names: {}, hours: 0 }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-fetch';
    wrap.title = t('parts.homeHint');
    const c = chooseRow();
    c.btn.title = t('parts.homeChooseHint');
    let current = part;
    c.btn.addEventListener('click', (e) => {
      e.preventDefault();
      void choose(ctx, c.btn, {
        many: true,
        chosen: entitiesOf(current.settings),
        note: c.note,
        pick: (ids, names) => {
          const keep = /** @type {Record<string, string>} */ ({});
          for (const id of ids) keep[id] = names[id] || id;
          ctx.update({ entities: ids, names: keep });
          ctx.commit(t('parts.homeChoose'));
        },
      });
    });
    const hoursF = numberField(t('parts.homeHours'), Number(part.settings.hours) || 0, 0, (n) => { ctx.update({ hours: n }); ctx.commit(t('parts.homeHours')); }, MAX_HOURS);
    hoursF.input.title = t('parts.homeHoursHint');
    const status = document.createElement('div');
    status.className = 'graph-fetch-status';
    wrap.append(c.row, hoursF.node, status);
    host.replaceChildren(wrap);

    /** @param {any} p */
    const paint = (p) => {
      current = p;
      const ids = entitiesOf(p.settings);
      const names = (p.settings && p.settings.names) || {};
      c.name.textContent = ids.length ? t('parts.homeSome', { n: ids.length, names: ids.map((id) => names[id] || id).join(', ') }) : t('parts.homeNone');
      c.name.title = ids.join('\n');
      hoursF.update(Number(p.settings.hours) || 0);
      const note = notes.get(String(p.id));
      status.textContent = note ? note.text : '';
      status.classList.toggle('offline', !!(note && note.offline));
    };
    paint(part);
    return { update: paint, destroy() { wrap.remove(); } };
  },

  async run(input) {
    const id = String(input.part.id);
    const ids = entitiesOf(input.part.settings);
    if (!ids.length) throw partFail(t('parts.homeErr_empty'), 'empty');
    const door = homeDoor();
    const r = door ? await door.read(ids, Number(input.part.settings.hours) || 0) : { ok: false, code: 'nolink', message: '' };
    const prev = input.part.value;
    /** Hand on the copy the box holds, saying why. @param {string} why */
    const saved = (why) => { notes.set(id, { text: t('parts.homeSaved', { why }), offline: true }); return prev; };
    if (r && r.ok === true) {
      const v = r.value || {};
      const got = Array.isArray(v.devices) ? v.devices.length : 0;
      const missing = Array.isArray(v.missing) ? v.missing : [];
      if (!got) {
        notes.delete(id);
        throw partFail(t('parts.homeErr_notHere', { ids: missing.join(', ') }), 'part');
      }
      let time = '';
      try { time = new Date(String(v.at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { /* no clock: leave it out */ }
      const line = t('parts.homeRead', { n: got, home: String(v.home || ''), time });
      notes.set(id, { text: missing.length ? `${line} · ${t('parts.homeMissing', { ids: missing.join(', ') })}` : line, offline: false });
      return valueOf('json', v);
    }
    if (!door) {
      if (isValue(prev)) return saved(t('parts.homeNoDoor'));
      throw partFail(t('parts.homeNoDoor'), 'part');
    }
    const code = r && Object.prototype.hasOwnProperty.call(READ_ERR, r.code) ? r.code : 'offline';
    const message = t(/** @type {any} */ (READ_ERR)[code], { message: String((r && r.message) || '') });
    if (SAVED_OK.has(code) && isValue(prev)) return saved(message);
    notes.delete(id);
    throw partFail(message, code === 'empty' ? 'empty' : 'part');
  },
});

/** @type {PartSpec} */
export const homeCommandPart = /** @type {any} */ ({
  type: 'home-command',
  order: 897,
  label: t('parts.homeCmdLabel'),
  thinks: false,
  size: { w: 320, h: 220 },
  inputs: [{ name: 'in', label: t('parts.homeCmdIn'), accepts: ['text', 'json', 'list'] }],
  output: 'text',
  defaults: () => ({ entity: '', name: '', action: '', data: '' }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-send';
    wrap.title = t('parts.homeCmdHint');
    const c = chooseRow();
    c.btn.title = t('parts.homeCmdChooseHint');
    const action = document.createElement('select');
    action.className = 'graph-send-transport';
    action.setAttribute('aria-label', t('parts.homeCmdAction'));
    action.title = t('parts.homeCmdActionHint');
    action.addEventListener('change', () => { ctx.update({ action: action.value }); ctx.commit(t('parts.homeCmdAction')); });
    const dataF = textField(t('parts.homeCmdData'), part.settings.data, { onInput: (v) => ctx.update({ data: v }), onCommit: () => ctx.commit(t('parts.homeCmdData')), placeholder: '{"brightness_pct": 40}' });
    dataF.node.title = t('parts.homeCmdDataHint');
    const status = document.createElement('p');
    status.className = 'graph-send-status';
    wrap.append(c.row, action, dataF.node, status);
    host.replaceChildren(wrap);

    let current = part;
    /** The actions main allows for the device, asked once per device. */
    let offered = { entity: '', list: /** @type {string[]} */ ([]) };
    let drawn = '';
    const fillActions = (/** @type {any} */ s) => {
      const list = offered.entity === s.entity ? offered.list : [];
      const want = [...new Set([...(s.action ? [String(s.action)] : []), ...list])];
      const opts = want.length ? want : [''];
      if (drawn !== opts.join('|')) {
        drawn = opts.join('|');
        action.replaceChildren(...opts.map((v) => {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = v || t('parts.homeCmdActionNone');
          return o;
        }));
      }
      if (document.activeElement !== action) action.value = String(s.action || '');
    };
    const askActions = async (/** @type {string} */ entity) => {
      const door = homeDoor();
      if (!door || !entity) return;
      const r = await door.actions(entity);
      offered = { entity, list: r && r.ok === true && Array.isArray(r.actions) ? r.actions.map(String) : [] };
      fillActions(current.settings || {});
    };
    c.btn.addEventListener('click', (e) => {
      e.preventDefault();
      void choose(ctx, c.btn, {
        many: false,
        chosen: current.settings.entity ? [String(current.settings.entity)] : [],
        only: (en) => !!en.commandable,
        note: c.note,
        pick: (ids, names) => {
          const entity = ids[0] || '';
          ctx.update({ entity, name: names[entity] || entity, action: '' });
          ctx.commit(t('parts.homeCmdDevice'));
          void askActions(entity);
        },
      });
    });

    /** @param {any} p */
    const paint = (p) => {
      current = p;
      const s = p.settings || {};
      c.name.textContent = s.entity ? t('parts.homeCmdIs', { name: String(s.name || s.entity), id: String(s.entity) }) : t('parts.homeCmdNone');
      fillActions(s);
      dataF.update(s.data);
      status.textContent = notes.has(String(p.id)) ? notes.get(String(p.id)).text : '';
      if (s.entity && offered.entity !== s.entity) { offered = { entity: s.entity, list: [] }; void askActions(String(s.entity)); }
    };
    paint(part);
    return { update: paint, destroy() { wrap.remove(); } };
  },

  async run(input) {
    const id = String(input.part.id);
    const s = input.part.settings || {};
    const arrived = ((input.inputs && input.inputs.in) || [])[0];
    if (!arrived) throw partFail(t('parts.homeCmdEmpty'), 'empty');
    const entity = String(s.entity || '').trim();
    const action = String(s.action || '').trim();
    if (!entity || !action) throw partFail(t('parts.homeCmdNoTarget'), 'empty');
    const d = commandData(s);
    if (d.bad) throw partFail(t('parts.homeCmdDataBad'), 'part');
    const door = homeDoor();
    const r = door ? await door.command({ entity_id: entity, action, ...(d.data ? { data: d.data } : {}) }) : { code: 'nolink' };
    const code = String((r && r.code) || 'error');
    const what = String((r && r.what) || '');
    /** @param {string} line */
    const said = (line) => { notes.set(id, { text: line }); return valueOf('text', line); };
    if (code === 'done') return said(t('parts.homeCmdDone', { what, now: String(r.now || '') }));
    if (code === 'dry-outputs') return said(t('parts.homeCmdDryOutputs', { what }));
    if (code === 'dry-home') return said(t('parts.homeCmdDryHome', { what }));
    if (code === 'nolink') return said(t('parts.homeCmdDryNoHome', { action, name: String(s.name || entity) }));
    notes.delete(id);
    const k = Object.prototype.hasOwnProperty.call(CMD_ERR, code) ? code : 'error';
    throw partFail(t(/** @type {any} */ (CMD_ERR)[k], { what, id: entity, domain: entity.split('.')[0], message: String((r && (r.text || r.message)) || '') }), 'part');
  },
});
