// @ts-check
// What only a person chooses on a box. Two doors read this file: a model never sets these through
// the MCP tools (computer/mcp-tools.mjs), and a graph that came from a file lists them once before
// its first run (owner 2026-11-06; computer/host.mjs `start`). PURE: no DOM, no strings.

/** Per box type, the settings only a person may set. */
export const PERSON_ONLY = Object.freeze({
  fetch: ['url'], opendata: ['link'], agent: ['hosts'], audio: ['listen'],
  send: ['serialPort', 'serialLabel'], receive: ['serialPort', 'serialLabel'],
  // The home (docs/HOME_ASSISTANT.md): which devices a Home box reads, and the device, action and details of a Home command.
  home: ['entities', 'names'], 'home-command': ['entity', 'name', 'action', 'data'],
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

/** @param {any} s the board a box talks to, when it talks over USB */
const board = (s) => (s.transport === 'serial' ? [s.serialLabel, s.serialPort].filter(Boolean).join(' · ') : '');

/** What each box would reach. Listen is not here: an imported Sound box always opens with it off. */
const SHOWN = /** @type {Record<string, (s: any) => any>} */ ({
  fetch: (s) => s.url,
  opendata: (s) => s.link,
  agent: (s) => s.hosts,
  home: (s) => (Array.isArray(s.entities) ? s.entities.join(', ') : s.entities),
  'home-command': (s) => (s.entity ? [s.action, s.entity, s.data && JSON.stringify(s.data)].filter(Boolean).join(' · ') : ''),
  send: board,
  receive: board,
});

/**
 * PURE: what a graph would reach, one row per box. Whole, never cut short (the host a file wants to
 * hide would be the last one), and on one line: control and invisible characters go, so a value
 * cannot draw a list of its own inside the question.
 * @param {any} doc @returns {{type: string, what: string}[]}
 */
export function personChoices(doc) {
  const rows = [];
  for (const p of (doc && Array.isArray(doc.parts) ? doc.parts : [])) {
    const show = p && SHOWN[p.type];
    if (!show) continue;
    const what = String(show(p.settings || {}) || '').replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ').trim();
    if (what) rows.push({ type: p.type, what });
  }
  return rows;
}

/** PURE: does this graph still wait for a person's look before it runs? @param {any} doc */
export function handed(doc) {
  return !!(doc && doc.settings && doc.settings.handed) && personChoices(doc).length > 0;
}
