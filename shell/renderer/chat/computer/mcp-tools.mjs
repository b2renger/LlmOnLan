// @ts-check
// The Computer's MCP tools, run in the page (src/main/mcp.ts carries each call here and waits for the
// answer). They use the Computer's own doors — the SAME debug doors the harness drives — so this is not
// a second way to edit a graph: a tool call is what a person's click would have done.
//
// One rule no tool may break: the outputs. No tool arms them, and while a person has them armed NO tool
// may change or run a graph (critic B1, 2026-09-27: arming is global and a Send box reads its target at run
// time, so an edit under arming would retarget a live output the person never saw in the arming list).
// And what only a PERSON may choose stays theirs (critic S1): where a box reads from, which hosts an agent
// may read, which USB board, and a Sound box's Listen — a model's copy of those is dropped, and it is told.

import { mcpDoor, outputsDoor } from '../projects/bridge.mjs';
import { EXAMPLES } from './examples/index.mjs';
import { creativePresets } from '../graph/parts/creative.mjs';

/** @typedef {{text: string, isError?: boolean}} ToolOut */

const ok = (/** @type {any} */ v) => /** @type {ToolOut} */ ({ text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) });
const no = (/** @type {string} */ msg) => /** @type {ToolOut} */ ({ text: msg, isError: true });
const RUN_WAIT_MS = 10 * 60 * 1000;

function doors() {
  const L = /** @type {any} */ (window).LolComputer;
  return { comp: L && L.debug && L.debug.computer, lib: L && L.debug && L.debug.library };
}

/** A value, short enough for a model's context. @param {any} v */
function brief(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.kind === 'image') return '(a picture)';
  if (v.kind === 'file') return '(a file)';
  const s = typeof v.data === 'string' ? v.data : JSON.stringify(v.data);
  return s.length > 1500 ? `${s.slice(0, 1500)}… (${s.length} characters)` : s;
}

/** The open graph, as a model reads it. @param {any} comp */
function graphOf(comp) {
  const d = comp.doc();
  return {
    id: comp.docId(),
    title: d.title || '',
    boxes: d.parts.map((/** @type {any} */ p) => ({ id: p.id, type: p.type, settings: p.settings, state: p.state || null, value: brief(p.value), error: p.error || null })),
    arrows: d.wires.map((/** @type {any} */ w) => ({ from: w.from, to: w.to, port: w.port, label: w.label || '' })),
  };
}

/** The ＋ menu's entries a model can add: a type, or a preset of one (its settings ride along). */
function boxTypes() {
  const presets = new Map(creativePresets().map((p) => [p.id, p]));
  return EXAMPLES.map((ex) => {
    const pr = presets.get(ex.key);
    return { type: ex.key, box: pr ? pr.type : ex.key, title: ex.title, what: ex.what, inputs: ex.inputs.map(([port, words]) => `${port}: ${words}`), output: ex.output };
  });
}

/** Per box type, the settings only a person may set. */
export const PERSON_ONLY = Object.freeze({
  fetch: ['url'], opendata: ['link'], agent: ['hosts'], audio: ['listen'],
  send: ['serialPort', 'serialLabel'], receive: ['serialPort', 'serialLabel'],
});

/** PURE: a model's settings for a box of `type`, without what only a person may set. @param {string} type @param {any} settings */
export function modelSettings(type, settings) {
  const drop = /** @type {Record<string, string[]>} */ (PERSON_ONLY)[type] || [];
  /** @type {Record<string, any>} */ const kept = {};
  /** @type {string[]} */ const left = [];
  for (const [k, v] of Object.entries(settings && typeof settings === 'object' ? settings : {})) {
    if (drop.includes(k)) left.push(k); else kept[k] = v;
  }
  return { kept, left };
}

const LEFT_NOTE = 'left for a person to set in the Computer (only a person chooses where a box reads from, which web hosts an agent may read, a USB board, and Listen)';
const MUTATING = new Set(['open_graph', 'new_graph', 'add_box', 'connect_boxes', 'set_box', 'run_graph']);

/** Where a new box goes when the model gives no place: right of everything. @param {any} comp */
function freeSpot(comp) {
  const parts = comp.doc().parts;
  const right = parts.length ? Math.max(...parts.map((/** @type {any} */ p) => Number(p.x) + Number(p.w || 300))) : 0;
  return { x: right + 60, y: 80 };
}

/**
 * Run one tool. Never throws: a refusal is an `isError` answer the model reads.
 * @param {string} name @param {any} args @returns {Promise<ToolOut>}
 */
export async function runTool(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  const { comp, lib } = doors();
  if (!comp || !lib) return no('The Computer is still starting. Try again in a moment.');
  if (MUTATING.has(name)) {
    const door = outputsDoor();
    if (door && await door.armed()) return no('The outputs are armed: a person is working with live devices, so no graph can be changed or run from here until they disarm. Reading still works.');
  }
  switch (name) {
    case 'list_graphs': {
      // The open graph is counted live: the library row lags behind the debounced save, and a model that
      // just added boxes must see them.
      const openId = comp.docId();
      const live = openId ? comp.doc().parts.length : 0;
      return ok(lib.list().map((/** @type {any} */ r) => ({ id: r.id, title: r.id === openId ? (comp.doc().title || r.title) : r.title, boxes: r.id === openId ? live : r.parts, open: r.id === openId })));
    }
    case 'open_graph': {
      if (!lib.list().some((/** @type {any} */ r) => r.id === a.id)) return no(`No graph with the id ${a.id}. list_graphs gives the ids.`);
      await lib.open(String(a.id));
      return ok(graphOf(comp));
    }
    case 'new_graph': {
      const id = await lib.create(String(a.title || 'New graph').slice(0, 120));
      return id ? ok({ id, title: comp.doc().title }) : no('The graph could not be created.');
    }
    case 'read_graph':
      return comp.docId() ? ok(graphOf(comp)) : no('No graph is open. Use open_graph or new_graph.');
    case 'list_box_types':
      return ok(boxTypes());
    case 'add_box': {
      if (!comp.docId()) return no('No graph is open. Use open_graph or new_graph.');
      const key = String(a.type || '');
      const entry = boxTypes().find((b) => b.type === key);
      if (!entry) return no(`No box type ${key}. list_box_types gives them.`);
      const spot = Number.isFinite(a.x) && Number.isFinite(a.y) ? { x: Number(a.x), y: Number(a.y) } : freeSpot(comp);
      const id = comp.place(entry.box, spot.x, spot.y);
      if (!id) return no(`The ${key} box could not be placed.`);
      const preset = creativePresets().find((p) => p.id === key);
      if (preset) comp.setSettings(id, preset.settings);
      const { kept, left } = modelSettings(entry.box, a.settings);
      if (Object.keys(kept).length) comp.setSettings(id, kept);
      return ok({ id, type: entry.box, preset: preset ? key : null, ...(left.length ? { left_for_a_person: left, note: LEFT_NOTE } : {}) });
    }
    case 'connect_boxes': {
      const d = comp.doc();
      const to = d.parts.find((/** @type {any} */ p) => p.id === a.to);
      if (!to || !d.parts.some((/** @type {any} */ p) => p.id === a.from)) return no('Both boxes must be in the open graph (read_graph gives the ids).');
      const spec = comp.session().specs.get(to.type);
      const port = String(a.port || (spec && spec.inputs && spec.inputs[0] ? spec.inputs[0].name : 'in'));
      const w = comp.wire(String(a.from), String(a.to), port);
      if (!w || !w.ok) {
        // Say what would fit, so the model can fix the arrow (a bare "unknown-port" sent weaker models round in circles:
        // nemotron tried eight arrows in the P5-L spike; qwen3.8 guessed right the second time).
        const from = d.parts.find((/** @type {any} */ p) => p.id === a.from);
        const fromSpec = comp.session().specs.get(from.type);
        const ins = spec && Array.isArray(spec.inputs) ? spec.inputs : [];
        const takes = ins.length
          ? `a ${to.type} box takes: ${ins.map((/** @type {any} */ p) => `${p.name} (${(p.accepts || []).join(' or ')})`).join(', ')}`
          : `a ${to.type} box takes no input — it brings something in`;
        return no(`The arrow was refused (${(w && w.reason) || 'unknown'}): ${takes}; the ${from.type} box gives ${(fromSpec && fromSpec.output) || 'a value'}.`);
      }
      if (a.label) comp.label(w.id, String(a.label));
      return ok({ id: w.id, from: a.from, to: a.to, port, label: a.label || '' });
    }
    case 'set_box': {
      const box = comp.doc().parts.find((/** @type {any} */ p) => p.id === a.id);
      if (!box) return no(`No box ${a.id} in the open graph.`);
      if (!a.settings || typeof a.settings !== 'object') return no('settings must be an object.');
      const { kept, left } = modelSettings(box.type, a.settings);
      if (Object.keys(kept).length) comp.setSettings(String(a.id), kept);
      return ok({ id: a.id, settings: comp.doc().parts.find((/** @type {any} */ p) => p.id === a.id).settings, ...(left.length ? { left_for_a_person: left, note: LEFT_NOTE } : {}) });
    }
    case 'run_graph': {
      if (!comp.docId()) return no('No graph is open. Use open_graph or new_graph.');
      if (a.from && !comp.doc().parts.some((/** @type {any} */ p) => p.id === a.from)) return no(`No box ${a.from} in the open graph.`);
      await comp.run(a.from ? { mode: 'from', seeds: [String(a.from)] } : {});
      const until = Date.now() + RUN_WAIT_MS;
      while (comp.running() && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
      return ok(graphOf(comp));
    }
    default:
      return no(`No tool named ${name}.`);
  }
}

/** Answer main's calls (the page side of src/main/mcp.ts). */
export function installMcpTools() {
  const door = mcpDoor();
  if (!door) return false;
  door.onCall(async (/** @type {any} */ msg) => {
    let out;
    try { out = await runTool(String(msg && msg.name), msg && msg.args); } catch (e) { out = no(String(/** @type {any} */ (e)?.message || e)); }
    void door.answer(String(msg && msg.id), out);
  });
  return true;
}
