// @ts-check
// The Computer's door to the farm's MESSAGE BUS (ecosystem plan v2 §8d, P3b): ONE WebSocket to the farm's
// hub (farm/src/bus.js), where boards on MQTT, tools on OSC and other Computers meet in one topic space —
// the farm bridges them, so the Computer needs this one protocol. Subscribe to a topic filter (MQTT
// wildcards + and #), publish a value. The farm password, when the farm has one, rides as ?key= (the hub
// refuses the upgrade otherwise). The connection comes back on its own after a drop.
//
// The ONE file allowed to open a WebSocket (chat-lint rule 11). Sending still asks main's outputs choke
// point first (a Send box does that before calling `publish`), so a disarmed graph never publishes.

/** Waits between reconnection attempts (the last one repeats). */
const RETRY_MS = [1000, 2000, 5000, 10000];
const OPEN_WAIT_MS = 4000;

/** PURE: does an MQTT-style filter match a topic? `+` is one level, `#` the rest. @param {string} filter @param {string} topic */
export function topicMatches(filter, topic) {
  const f = String(filter).split('/');
  const t = String(topic).split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/** PURE: the hub's address for these farm caps, the password in it when the bus asks for one; '' = no bus. @param {any} caps */
export function hubUrl(caps) {
  const bus = caps && caps.bus;
  if (!bus || !bus.ws) return '';
  const key = bus.auth && caps.apiKey ? `?key=${encodeURIComponent(String(caps.apiKey))}` : '';
  return `${String(bus.ws).replace(/\/+$/, '')}/${key}`;
}

/** @type {null | {url: string, ws: any, open: boolean, subs: Map<string, Set<(topic: string, data: any) => void>>, retry: number, timer: any, closed: boolean}} */
let conn = null;

function socket() { return /** @type {any} */ (globalThis).WebSocket; }

/** @param {string} url */
function connect(url) {
  if (conn && conn.url === url && !conn.closed) return conn;
  const subs = conn ? conn.subs : new Map();
  if (conn) close();
  const WS = socket();
  const c = { url, ws: null, open: false, subs, retry: 0, timer: null, closed: false };
  conn = c;
  if (typeof WS !== 'function') return c;
  const dial = () => {
    if (c.closed) return;
    let ws;
    try { ws = new WS(url); } catch { schedule(); return; }
    c.ws = ws;
    ws.onopen = () => {
      c.open = true;
      c.retry = 0;
      for (const filter of c.subs.keys()) ws.send(JSON.stringify({ sub: filter }));
    };
    ws.onmessage = (/** @type {any} */ ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (!m || typeof m.topic !== 'string') return;   // {subscribed}, {error}: nothing to hand on
      for (const [filter, fns] of c.subs) {
        if (!topicMatches(filter, m.topic)) continue;
        for (const fn of fns) { try { fn(m.topic, m.data); } catch { /* a listener's own problem */ } }
      }
    };
    ws.onclose = () => { c.open = false; c.ws = null; schedule(); };
    ws.onerror = () => { /* onclose follows */ };
  };
  const schedule = () => {
    if (c.closed || conn !== c) return;
    const wait = RETRY_MS[Math.min(c.retry, RETRY_MS.length - 1)];
    c.retry += 1;
    c.timer = setTimeout(dial, wait);
  };
  dial();
  return c;
}

/**
 * Hear every message whose topic matches `filter`. Returns the way to stop.
 * @param {any} caps the farm caps (app.farm.get()) @param {string} filter
 * @param {(topic: string, data: any) => void} fn @returns {() => void}
 */
export function subscribe(caps, filter, fn) {
  const url = hubUrl(caps);
  if (!url || !filter) return () => {};
  const c = connect(url);
  const first = !c.subs.has(filter);
  if (first) c.subs.set(filter, new Set());
  /** @type {Set<any>} */ (c.subs.get(filter)).add(fn);
  if (first && c.open && c.ws) c.ws.send(JSON.stringify({ sub: filter }));
  return () => {
    const fns = c.subs.get(filter);
    if (!fns) return;
    fns.delete(fn);
    if (!fns.size) {
      c.subs.delete(filter);
      if (c.open && c.ws) { try { c.ws.send(JSON.stringify({ unsub: filter })); } catch { /* closing */ } }
    }
  };
}

/**
 * Publish one value on a topic. Waits a moment for the hub when the connection is still opening.
 * @param {any} caps @param {string} topic @param {any} data
 * @returns {Promise<{ok: true}|{ok: false, code: 'no-bus'|'offline'}>}
 */
export async function publish(caps, topic, data) {
  const url = hubUrl(caps);
  if (!url) return { ok: false, code: 'no-bus' };
  const c = connect(url);
  const until = Date.now() + OPEN_WAIT_MS;
  while (!c.open && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  if (!c.open || !c.ws) return { ok: false, code: 'offline' };
  c.ws.send(JSON.stringify({ pub: String(topic), data }));
  return { ok: true };
}

/** Is the hub connection up right now? */
export function busOnline() { return !!(conn && conn.open); }

/** Let the hub go (tests, a farm switch). */
export function close() {
  const c = conn;
  conn = null;
  if (!c) return;
  c.closed = true;
  clearTimeout(c.timer);
  try { if (c.ws) c.ws.close(); } catch { /* closed */ }
}
