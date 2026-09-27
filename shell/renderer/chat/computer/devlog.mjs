// @ts-check
// The Computer's flight recorder (COMPUTER_PLAN addendum KG, owner request 2026-09-24): "when I
// explore and find a bug, I want everything recorded in a timestamped file you can fix it from".
//
// Two halves:
//   - ALWAYS ON, IN MEMORY: the last RING_MAX events, nothing written anywhere. That is what makes
//     "I just saw it — turn the switch on" useful: the recording starts with what led up to it,
//     each of those lines flagged `pre:1`.
//   - THE SWITCH (computer/recorder.mjs draws it): while on, the ring and every new event go to a
//     file the MAIN process owns, through projects/bridge.mjs's debugLogDoor(). The switch is
//     remembered, so a relaunch in the middle of chasing a bug keeps recording (into a new file).
//
// What it records — the key to the kinds is README in devlog-format.mjs, and it is the file's
// first line:
//   ui.*   what the person did while the Computer was on screen (clicks, keys, edits, drags,
//          wheel, drops, pastes; typed text is summarised per field, never per keystroke, and a
//          password field's value is never read), and the toasts and dialogs they were shown;
//   doc.*  the graph opened, each edit (what changed, part by part), selection and view;
//   run.*  the runner: start, every part's state change, the end report, caps and parks;
//   http.* every request the page makes, summarised (no headers, no keys), and its answer;
//   err.*  uncaught errors, unhandled rejections, failed resources, CSP violations;
//   con.*  console.error / warn / info / log;
//   sbx.*  the sandbox guest's state, errors and (throttled) console;
//   bus.*  farm, store and visibility changes;  perf.frame  a frame longer than LONG_FRAME_MS.
//
// Cost: an event is one small object pushed onto a ring. Serialising happens only while
// recording, in batches every FLUSH_MS. Fan-out `item` events are counted, never logged one by one.
//
// installDevlog() runs at the top of computer/main.mjs, before any Computer module loads, so a
// module that fails to load or throws while installing is already on the record. attach(app) then
// wires the host, runner, bus and dialogs once they exist.

import { EV } from '../core/events.mjs';
import { debugLogDoor } from '../projects/bridge.mjs';
import {
  README, clip, clockOf, describeTarget, docDelta, fmtArgs, frameOf, isEditable, isSecretField,
  keyOf, scrub, summarizeRequest, urlOf,
} from './devlog-format.mjs';

export const RING_MAX = 2000;
export const FLUSH_MS = 400;
export const LONG_FRAME_MS = 100;
/** localStorage: '1' while the switch is on. Read synchronously at boot, so a relaunch resumes. */
export const REC_KEY = 'lol:computer:recording';
/** One append stays well under main's 2 MB limit, counted in UTF-16 units (≤ 3 bytes each). */
const CHUNK_CHARS = 600 * 1024;
/** One line never exceeds this; a bigger event is shrunk (lineOf), never dropped. */
const LINE_MAX = CHUNK_CHARS - 1024;
/** A quiet GET (the farm poll) is logged again only after this long, unless it fails. */
const QUIET_GET_MS = 60000;
/** Guest console lines per second before the rest are only counted. */
const SBX_LOGS_PER_SEC = 20;
/** The same request, more than this many times in BURST_MS, is counted instead of written. */
const BURST_MAX = 20;
const BURST_MS = 10000;

/** The fields every line starts with; data never overwrites them. */
const ENVELOPE = new Set(['n', 'ts', 'ms', 'k']);
/** Kinds that carry a whole document or report: copied (bounded) when logged, not referenced. */
const HEAVY = new Set(['doc.open', 'snap', 'run.start', 'run.end']);
const HEAVY_SCRUB = { max: 4000, nodes: 30000, items: 1200, depth: 12 };

/** @type {any} */ let singleton = null;

/** @param {any} err */
const errText = (err) => (err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err));

/**
 * @param {{window?: any, door?: any, storage?: any}} [o] injectable for tests; defaults to the page
 */
export function installDevlog(o = {}) {
  if (singleton) return singleton;
  const win = o.window || (typeof window !== 'undefined' ? window : null);
  if (!win) return null;
  const doc = win.document;
  const perf = win.performance || { now: () => Date.now() };
  const door = o.door !== undefined ? o.door : debugLogDoor();
  const storage = o.storage !== undefined ? o.storage : (() => { try { return win.localStorage; } catch { return null; } })();

  /** @type {any[]} */ const ring = [];
  let head = 0;
  let seq = 0;
  /** @type {Set<Function>} */ const listeners = new Set();
  /** @type {null | {name: string, path: string, queue: any[], timer: any, chain: Promise<any>, since: number, events: number, bytes: number, failures: number, full: boolean, stopping?: Promise<any>}} */
  let rec = null;
  let starting = false;
  /** @type {any} */ let app = null;
  let marks = 0;
  /** True while the Computer's runner is executing: its requests are the only ones whose text is kept. */
  let runnerActive = false;
  /** @type {null | {name: string, path: string, why: string}} */ let lastStop = null;

  // ---- the ring ------------------------------------------------------------------------------

  /** @param {string} k @param {Record<string, any>} [data] */
  function log(k, data) {
    // The envelope comes FIRST, so a line reads "what, when" at a glance, and a data field can never
    // overwrite it. Data fields that are durations are called `took`, counts `count` — never `ms`/`n`.
    /** @type {Record<string, any>} */
    const ev = { n: ++seq, ts: clockOf(new Date()), ms: Math.round(perf.now() * 10) / 10, k };
    // Events that carry a whole document are copied down NOW: the ring must not keep old graphs —
    // pictures and all — alive for as long as it remembers them.
    const body = data && HEAVY.has(k) ? scrub(data, HEAVY_SCRUB) : data;
    if (body) for (const key of Object.keys(body)) if (!ENVELOPE.has(key)) ev[key] = body[key];
    if (ring.length < RING_MAX) ring.push(ev);
    else { ring[head] = ev; head = (head + 1) % RING_MAX; }
    if (rec) { rec.queue.push(ev); rec.events++; schedule(); }
    return ev;
  }

  const ringInOrder = () => (ring.length < RING_MAX ? ring.slice() : ring.slice(head).concat(ring.slice(0, head)));

  /**
   * One event as one line that FITS in an append. A big snapshot (a mark on a 200-part graph) is
   * shrunk step by step rather than dropped — the mark's note and screenshot are the reason the
   * file exists. The last resort keeps the envelope and the small fields a reader needs.
   * @param {any} ev
   */
  function lineOf(ev) {
    const budgets = [
      { max: 4000, nodes: 30000, items: 1200, depth: 12 },
      { max: 600, nodes: 8000, items: 200, depth: 10 },
      { max: 200, nodes: 2000, items: 40, depth: 8 },
    ];
    try {
      for (const b of budgets) {
        const line = JSON.stringify(scrub(ev, b));
        if (line.length <= LINE_MAX) return line;
      }
    } catch (err) {
      return JSON.stringify({ n: ev && ev.n, ts: ev && ev.ts, ms: ev && ev.ms, k: ev && ev.k, unserializable: errText(err) });
    }
    /** @type {Record<string, any>} */
    const stub = { n: ev.n, ts: ev.ts, ms: ev.ms, k: ev.k, shrunk: true };
    for (const key of ['i', 'note', 'png', 'why', 'pre', 'id', 'state', 'label']) if (ev[key] !== undefined) stub[key] = scrub(ev[key], { max: 2000, nodes: 20 });
    return JSON.stringify(stub);
  }

  const notify = () => {
    const s = status();
    for (const fn of Array.from(listeners)) { try { fn(s); } catch { /* a painter must not stop the recorder */ } }
  };

  // ---- the file ------------------------------------------------------------------------------

  function schedule() {
    if (!rec || rec.timer) return;
    rec.timer = setTimeout(() => { void flush(); }, FLUSH_MS);
  }

  /** Write everything queued, in order. @returns {Promise<void>} */
  function flush() {
    const r = rec;
    if (!r) return Promise.resolve();
    if (r.timer) { clearTimeout(r.timer); r.timer = 0; }
    if (!r.queue.length) return r.chain;
    const lines = r.queue.map(lineOf);
    r.queue = [];
    /** @type {string[]} */ const chunks = [];
    let cur = '';
    for (const line of lines) {
      if (cur && cur.length + line.length + 1 > CHUNK_CHARS) { chunks.push(cur); cur = ''; }
      cur += `${line}\n`;
    }
    if (cur) chunks.push(cur);
    for (const text of chunks) {
      r.chain = r.chain.then(() => (r.full ? null : door.append(text))).then((res) => {
        if (!res) return;
        if (res.ok) { r.bytes = Number(res.bytes) || r.bytes; return; }
        if (res.code === 'E_FULL') { r.full = true; return; }
        r.failures++;
      }, () => { r.failures++; });
    }
    r.chain = r.chain.then(() => {
      notify();
      if (r.full && rec === r && !r.stopping) void stop('full');
    });
    return r.chain;
  }

  function env() {
    const nav = win.navigator || {};
    const root = doc && doc.documentElement;
    const comp = doc && doc.getElementById('lolcomputer');
    return {
      computer: win.LolComputer ? win.LolComputer.version : null,
      ua: nav.userAgent, lang: nav.language,
      screen: win.screen ? [win.screen.width, win.screen.height] : null,
      window: [win.innerWidth, win.innerHeight], dpr: win.devicePixelRatio,
      theme: root ? String(root.className || '') : null,
      view: comp ? (comp.classList.contains('hidden') ? 'not-computer' : 'computer') : null,
    };
  }

  /** Everything worth knowing right now, for the start of a file and for a mark. @param {string} why */
  function snapshot(why) {
    /** @type {Record<string, any>} */
    const out = { why, env: env() };
    const g = win.LolComputer;
    if (g) out.failed = g.failed;
    const a = app;
    if (a) {
      try { out.farm = a.farm && typeof a.farm.get === 'function' ? a.farm.get() : null; } catch (err) { out.farm = errText(err); }
      try { out.gov = a.gov && typeof a.gov.state === 'function' ? a.gov.state() : null; } catch { /* optional */ }
      out.store = a.repo ? a.repo.mode : null;
      const dbg = a.host && a.host.debug;
      if (dbg) {
        try {
          const st = dbg.state();
          out.state = { ...st, parts: undefined, wires: undefined };
        } catch (err) { out.state = errText(err); }
        try { out.doc = dbg.doc(); } catch (err) { out.doc = errText(err); }
        try { out.sandbox = dbg.sandbox(); } catch (err) { out.sandbox = errText(err); }
        try { out.waits = dbg.waits(); } catch { /* optional */ }
      }
    }
    return out;
  }

  /** @param {boolean} on */
  function remember(on) {
    try { if (storage) storage.setItem(REC_KEY, on ? '1' : '0'); } catch { /* private window: the switch just won't survive a relaunch */ }
  }

  function wanted() {
    try { return !!storage && storage.getItem(REC_KEY) === '1'; } catch { return false; }
  }

  /** Turn the switch on. @param {string} [why] */
  async function start(why = 'switch') {
    if (!door) return { ok: false, code: 'E_NONE', message: 'this build cannot write logs' };
    if (rec) return { ok: true, name: rec.name, path: rec.path, already: true };
    if (starting) return { ok: false, code: 'E_BUSY', message: 'already starting' };
    starting = true;
    const now = new Date();
    const header = JSON.stringify({
      k: 'log.start', v: 1, why, readme: README, date: now.toISOString(),
      local: `${now.toDateString()} ${clockOf(now)}`, tzMinutes: -now.getTimezoneOffset(), ...env(),
    });
    let res;
    try { res = await door.start(header); } catch (err) { res = { ok: false, code: 'E_IO', message: errText(err) }; }
    starting = false;
    if (!res || !res.ok) {
      log('log.error', { op: 'start', code: res && res.code, message: res && res.message });
      notify();
      return res;
    }
    const backlog = ringInOrder();
    rec = { name: res.name, path: res.path, queue: backlog.map((ev) => ({ ...ev, pre: 1 })), timer: 0, chain: Promise.resolve(), since: Date.now(), events: 0, bytes: 0, failures: 0, full: false };
    marks = 0;
    watchFrames(true);
    log('log.live', { why, backlog: backlog.length, path: res.path });
    log('snap', snapshot('start'));
    if (why === 'switch') remember(true);
    notify();
    return res;
  }

  /** Turn the switch off (or close the file for another reason). @param {string} [why] */
  async function stop(why = 'switch') {
    const r = rec;
    if (!r) { if (why === 'switch') remember(false); return { ok: true, name: null }; }
    // Re-entrant: a second stop (the size limit tripping inside the first's flush) joins it.
    if (r.stopping) return r.stopping;
    r.stopping = (async () => {
      log('log.stop', { why, events: r.events });
      // Events logged while the last flush is in flight still belong in THIS file: flush until
      // the queue stays empty, then close in the same microtask, leaving no gap.
      for (let guard = 0; guard < 8; guard++) {
        await flush();
        if (!r.queue.length) break;
      }
      if (rec === r) { rec = null; watchFrames(false); }
      let res;
      try { res = await door.stop(); } catch (err) { res = { ok: false, code: 'E_IO', message: errText(err) }; }
      if (why === 'switch' || why === 'full') remember(false);
      lastStop = { name: r.name, path: r.path, why };
      notify();
      return { ...(res || {}), name: r.name, path: r.path, why, failures: r.failures };
    })();
    return r.stopping;
  }

  /**
   * The moment Mark bug is PRESSED: the state and the screenshot, both taken before the question
   * about them is asked, so neither shows the dialog or what changed while someone typed.
   * @returns {Promise<null | {png: string|null, snap: Record<string, any>}>}
   */
  async function shot() {
    if (!rec || !door) return null;
    const snap = scrub(snapshot('mark'), HEAVY_SCRUB);
    await flush();
    /** @type {string|null} */ let png = null;
    try {
      const res = await door.mark();
      png = res && res.ok ? res.png || null : null;
    } catch { png = null; }
    const dbg = app && app.host && app.host.debug;
    if (dbg && typeof dbg.journal === 'function') {
      try {
        const runs = await dbg.journal();
        snap.lastRun = Array.isArray(runs) && runs.length ? scrub(runs[runs.length - 1], HEAVY_SCRUB) : null;
      } catch (err) { snap.lastRun = errText(err); }
    }
    return { png, snap };
  }

  /**
   * "The bug is HERE": a numbered marker with the person's note, the screenshot and the state taken
   * when Mark bug was pressed, and the last stored run. A cancelled note saves no marker — one short
   * line says so, so the screenshot already on disk is not a mystery.
   * @param {{note?: string|null, png?: string|null, snap?: Record<string, any>|null, cancelled?: boolean}} [m]
   * @returns {Promise<null | {ok: boolean, i: number}>}
   */
  async function mark(m = {}) {
    if (!rec) return null;
    if (m.cancelled) {
      log('mark.cancelled', { png: m.png || null });
      await flush();
      return null;
    }
    const r = rec;
    const failedBefore = r.failures;
    marks++;
    const i = marks;
    log('mark', { i, note: m.note ? clip(m.note, 2000) : null, png: m.png || null, ...(m.snap || scrub(snapshot('mark'), HEAVY_SCRUB)) });
    await flush();
    notify();
    return { ok: r.failures === failedBefore && !r.full, i };
  }

  function status() {
    return {
      available: !!door,
      recording: !!rec,
      starting,
      name: rec ? rec.name : null,
      path: rec ? rec.path : null,
      since: rec ? rec.since : null,
      events: rec ? rec.events : 0,
      bytes: rec ? rec.bytes : 0,
      failures: rec ? rec.failures : 0,
      marks,
      lastStop,
    };
  }

  // ---- capture: errors, console, network, long frames ------------------------------------------

  win.addEventListener('error', (/** @type {any} */ e) => {
    const t = e && e.target;
    if (t && t !== win && typeof t.tagName === 'string') {
      log('err.resource', { tag: t.tagName.toLowerCase(), url: urlOf(String(t.src || t.href || '')) });
      return;
    }
    const where = e.filename ? `${String(e.filename).split('/').slice(-3).join('/')}:${e.lineno}:${e.colno}` : null;
    log('err.uncaught', { message: clip(String(e.message || ''), 2000), where, error: e.error ? scrub(e.error) : null });
  }, true);

  win.addEventListener('unhandledrejection', (/** @type {any} */ e) => {
    log('err.rejection', { reason: scrub(e && e.reason) });
  });

  if (doc) {
    doc.addEventListener('securitypolicyviolation', (/** @type {any} */ e) => {
      log('err.csp', { directive: e.violatedDirective, blocked: urlOf(String(e.blockedURI || '')), where: `${String(e.sourceFile || '').split('/').slice(-2).join('/')}:${e.lineNumber}` });
    });
  }

  const con = win.console;
  if (con) {
    for (const level of ['error', 'warn', 'info', 'log']) {
      const orig = con[level];
      if (typeof orig !== 'function' || orig.__lolDevlog) continue;
      const wrapped = function (/** @type {any[]} */ ...args) {
        try { log(`con.${level}`, { text: fmtArgs(args) }); } catch { /* never break the console */ }
        return orig.apply(con, args);
      };
      /** @type {any} */ (wrapped).__lolDevlog = true;
      con[level] = wrapped;
    }
  }

  // The network: every request the PAGE makes, observed — the wrapper adds no request of its own.
  // A GET that keeps succeeding on the same URL (the farm's model poll) is logged once a minute.
  const origFetch = win.fetch;
  if (typeof origFetch === 'function' && !origFetch.__lolDevlog) {
    let netSeq = 0;
    /** @type {Map<string, number>} */ const quietSeen = new Map();
    // A fan-out of 10 000 items makes 10 000 identical-looking requests: the first BURST_MAX per
    // (method, url, model) in each BURST_MS window are written, the rest only counted — and every
    // failure is written whatever the count, because the failure is what someone is chasing.
    /** @type {Map<string, {start: number, n: number, quiet: number}>} */ const bursts = new Map();
    const burstQuiet = (/** @type {any} */ info) => {
      const key = `${info.method} ${info.url} ${info.model || ''}`;
      const now = Date.now();
      let b = bursts.get(key);
      if (!b || now - b.start > BURST_MS) {
        if (b && b.quiet) log('http.quieted', { url: info.url, model: info.model, count: b.quiet });
        b = { start: now, n: 0, quiet: 0 };
        bursts.set(key, b);
      }
      if (++b.n <= BURST_MAX) return false;
      b.quiet++;
      return true;
    };
    const wrapped = function (/** @type {any} */ input, /** @type {any} */ init) {
      const id = ++netSeq;
      /** @type {any} */ let info = null;
      let quiet = false;
      try {
        // Message text is kept only for the Computer's OWN requests: a run executing while the
        // Computer is on screen. LOL Chat's requests are method, URL and size — never parsed.
        info = summarizeRequest(input, init, { deep: runnerActive && shown() });
        if (info.method === 'GET') {
          const lastAt = quietSeen.get(info.url) || 0;
          quiet = Date.now() - lastAt < QUIET_GET_MS;
          if (!quiet) quietSeen.set(info.url, Date.now());
        } else {
          quiet = burstQuiet(info);
        }
        if (!quiet) log('http.req', { id, ...info });
      } catch { /* a summary that fails is not a reason to fail the request */ }
      const t0 = perf.now();
      const p = origFetch.call(win, input, init);
      Promise.resolve(p).then((/** @type {any} */ res) => {
        const ms = Math.round(perf.now() - t0);
        if (quiet && res && res.ok) return;
        const out = { id, status: res ? res.status : null, took: ms, type: res && res.headers ? res.headers.get('content-type') : null };
        log('http.res', quiet ? { ...out, req: info } : out);
        if (res && !res.ok && typeof res.clone === 'function') {
          res.clone().text().then((/** @type {string} */ text) => log('http.body', { id, text: clip(text, 1500) }), () => { /* a body we cannot read */ });
        }
      }, (/** @type {any} */ err) => {
        log('http.fail', { id, req: quiet ? info : undefined, name: err && err.name, message: clip(errText(err), 500), took: Math.round(perf.now() - t0) });
      });
      return p;
    };
    /** @type {any} */ (wrapped).__lolDevlog = true;
    win.fetch = wrapped;
  }

  // Long frames are watched ONLY WHILE RECORDING. An observer makes Chromium attribute every frame's
  // scripts, a small cost on every frame — measured on perf-graph-500's pan, where the idle recorder
  // must cost nothing. So `perf.frame` is never in the pre-switch backlog; that is the trade.
  const PO = win.PerformanceObserver;
  /** @type {any} */ let frameObserver = null;
  /** @param {boolean} on */
  function watchFrames(on) {
    if (!on) {
      if (frameObserver) { try { frameObserver.disconnect(); } catch { /* already gone */ } }
      frameObserver = null;
      return;
    }
    if (frameObserver || typeof PO !== 'function') return;
    try {
      const types = PO.supportedEntryTypes || [];
      const type = types.includes('long-animation-frame') ? 'long-animation-frame' : (types.includes('longtask') ? 'longtask' : null);
      if (!type) return;
      frameObserver = new PO((/** @type {any} */ list) => {
        for (const e of list.getEntries()) if (e.duration >= LONG_FRAME_MS) log('perf.frame', frameOf(e));
      });
      frameObserver.observe({ type, buffered: false });
    } catch { frameObserver = null; /* no long-frame timing in this engine */ }
  }

  // ---- capture: what the person does -----------------------------------------------------------
  // Only while the Computer is the surface on screen: the chat has its own life, and a log full of
  // someone else's typing is not a bug report.

  const shown = () => {
    const c = doc && doc.getElementById('lolcomputer');
    return !!c && !c.classList.contains('hidden');
  };
  const mods = (/** @type {any} */ e) => {
    const m = [e.ctrlKey && 'ctrl', e.metaKey && 'meta', e.altKey && 'alt', e.shiftKey && 'shift'].filter(Boolean);
    return m.length ? m.join('+') : undefined;
  };

  /** @type {null | {x: number, y: number, t: number, target: any}} */ let down = null;
  /** @type {null | {el: any, n: number, timer: any}} */ let editing = null;
  /** @type {null | {dx: number, dy: number, n: number, ctrl: boolean, target: any, timer: any}} */ let wheel = null;

  function flushEdit() {
    const e = editing;
    if (!e) return;
    editing = null;
    clearTimeout(e.timer);
    const el = e.el;
    const secret = isSecretField(el);
    const value = el ? (typeof el.value === 'string' ? el.value : String(el.textContent || '')) : '';
    log('ui.edit', secret
      ? { target: describeTarget(el), value: '[hidden]' }
      : { target: describeTarget(el), inputs: e.n, len: value.length, value: clip(value, 600) });
  }

  if (doc) {
    const opts = { capture: true, passive: true };
    doc.addEventListener('pointerdown', (/** @type {any} */ e) => {
      if (!shown()) return;
      down = { x: e.clientX, y: e.clientY, t: perf.now(), target: describeTarget(e.target) };
    }, opts);
    doc.addEventListener('pointerup', (/** @type {any} */ e) => {
      const d = down;
      down = null;
      if (!d || !shown()) return;
      const dx = e.clientX - d.x; const dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 4) {
        log('ui.drag', { from: [Math.round(d.x), Math.round(d.y)], to: [Math.round(e.clientX), Math.round(e.clientY)], took: Math.round(perf.now() - d.t), start: d.target, end: describeTarget(e.target), mods: mods(e) });
      }
    }, opts);
    for (const [type, k] of [['click', 'ui.click'], ['dblclick', 'ui.dblclick'], ['contextmenu', 'ui.menu'], ['auxclick', 'ui.auxclick']]) {
      doc.addEventListener(type, (/** @type {any} */ e) => {
        if (!shown()) return;
        if (type === 'auxclick' && e.button === 2) return;       // the context menu already said it
        log(k, { x: Math.round(e.clientX), y: Math.round(e.clientY), b: e.button || undefined, mods: mods(e), target: describeTarget(e.target) });
      }, opts);
    }
    doc.addEventListener('keydown', (/** @type {any} */ e) => {
      if (!shown() || e.repeat) return;
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Process', 'Unidentified'].includes(e.key)) return;
      const editable = isEditable(e.target);
      if (isSecretField(e.target) && !['Enter', 'Tab', 'Escape'].includes(e.key)) return;   // never a password's keys
      const altGr = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
      const chord = !altGr && (e.ctrlKey || e.metaKey || e.altKey);
      if (editable && !chord && String(e.key || '').length === 1) return;   // typing: summarised by ui.edit
      if (editable && (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape')) flushEdit();
      log('ui.key', { combo: keyOf(e), editable: editable || undefined, composing: e.isComposing || undefined, target: describeTarget(e.target) });
    }, opts);
    doc.addEventListener('input', (/** @type {any} */ e) => {
      if (!shown()) return;
      const el = e.target;
      if (editing && editing.el !== el) flushEdit();
      if (!editing) editing = { el, n: 0, timer: 0 };
      editing.n++;
      clearTimeout(editing.timer);
      editing.timer = setTimeout(flushEdit, 1500);
    }, opts);
    doc.addEventListener('focusout', (/** @type {any} */ e) => { if (editing && editing.el === e.target) flushEdit(); }, opts);
    doc.addEventListener('change', (/** @type {any} */ e) => {
      if (!shown()) return;
      const el = e.target;
      if (!el || (isEditable(el) && el.tagName !== 'SELECT')) return;    // text fields: ui.edit
      const value = el.type === 'checkbox' || el.type === 'radio' ? !!el.checked : (el.type === 'file' ? undefined : clip(String(el.value || ''), 200));
      log('ui.change', { target: describeTarget(el), value });
    }, opts);
    doc.addEventListener('wheel', (/** @type {any} */ e) => {
      if (!shown()) return;
      if (!wheel) wheel = { dx: 0, dy: 0, n: 0, ctrl: false, target: describeTarget(e.target), timer: 0 };
      wheel.dx += e.deltaX; wheel.dy += e.deltaY; wheel.n++; wheel.ctrl = wheel.ctrl || !!e.ctrlKey;
      clearTimeout(wheel.timer);
      wheel.timer = setTimeout(() => {
        const w = wheel;
        wheel = null;
        if (w) log('ui.wheel', { dx: Math.round(w.dx), dy: Math.round(w.dy), events: w.n, zoom: w.ctrl || undefined, target: w.target });
      }, 300);
    }, opts);
    /** @param {any} dt */
    const filesOf = (dt) => {
      const files = dt && dt.files ? Array.from(dt.files) : [];
      return files.slice(0, 20).map((/** @type {any} */ f) => ({ name: clip(f.name, 120), type: f.type, bytes: f.size }));
    };
    doc.addEventListener('drop', (/** @type {any} */ e) => {
      if (!shown()) return;
      log('ui.drop', { x: Math.round(e.clientX), y: Math.round(e.clientY), types: e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [], files: filesOf(e.dataTransfer), target: describeTarget(e.target) });
    }, opts);
    doc.addEventListener('paste', (/** @type {any} */ e) => {
      if (!shown()) return;
      const cd = e.clipboardData;
      const text = cd && typeof cd.getData === 'function' ? cd.getData('text/plain') : '';
      const secret = isSecretField(e.target);
      log('ui.paste', { types: cd ? Array.from(cd.types || []) : [], len: secret ? undefined : text.length, text: secret ? '[hidden]' : clip(text, 300), files: filesOf(cd), target: describeTarget(e.target) });
    }, opts);
  }

  win.addEventListener('pagehide', () => {
    const r = rec;
    if (!r) return;
    log('log.pagehide', {});
    // SYNCHRONOUSLY, not through the flush chain: an unloading page never hears the replies the
    // chain waits on, but an invoke SENT now is still delivered to main, in order. The switch stays
    // remembered, so the next page load starts a new file.
    if (r.timer) { clearTimeout(r.timer); r.timer = 0; }
    const lines = r.queue.map(lineOf);
    r.queue = [];
    rec = null;
    watchFrames(false);
    try {
      for (let i = 0; i < lines.length;) {
        let text = '';
        while (i < lines.length && (!text || text.length + lines[i].length < CHUNK_CHARS)) text += `${lines[i++]}\n`;
        void door.append(text);
      }
      void door.stop();
    } catch { /* the page is going; main closes the file on the next start or on quit */ }
  });

  // ---- attach: the Computer's own doors ----------------------------------------------------------

  /** @param {any} theApp */
  function attach(theApp) {
    if (app || !theApp) return;
    app = theApp;
    const host = app.host;
    const session = host && host.session;
    const runner = host && host.runner;

    if (session && typeof session.on === 'function') {
      /** @type {any} */ let prev = session.doc();
      /** @type {any} */ let viewTimer = 0;
      /** @type {any} */ let lastSandbox = null;
      let sbxSecond = 0; let sbxCount = 0; let sbxDropped = 0;
      const hookSandbox = () => {
        const s = typeof session.sandboxNow === 'function' ? session.sandboxNow() : null;
        if (!s || s === lastSandbox || typeof s.on !== 'function') return;
        lastSandbox = s;
        s.on((/** @type {any} */ ev) => {
          if (!ev || !ev.type) return;
          if (ev.type === 'log') {
            const sec = Math.floor(Date.now() / 1000);
            if (sec !== sbxSecond) {
              if (sbxDropped) log('sbx.log-dropped', { lines: sbxDropped });
              sbxSecond = sec; sbxCount = 0; sbxDropped = 0;
            }
            if (++sbxCount > SBX_LOGS_PER_SEC) { sbxDropped++; return; }
            log('sbx.log', { level: ev.log && ev.log.level, text: clip(String(ev.log && ev.log.text || ''), 1000) });
            return;
          }
          if (ev.type === 'error') { log('sbx.error', { error: scrub(ev.error, { max: 2000, nodes: 80 }) }); return; }
          log(`sbx.${ev.type}`, { state: ev.state, why: ev.why, dropped: ev.n });
        });
      };
      session.on((/** @type {any} */ ev) => {
        if (!ev) return;
        hookSandbox();
        if (ev.type === 'doc') {
          const next = ev.doc;
          if (ev.loaded || !prev || !next || prev.id !== next.id) {
            log('doc.open', { id: next && next.id, title: next && next.title, parts: next && next.parts ? next.parts.length : 0, wires: next && next.wires ? next.wires.length : 0, dropped: ev.dropped, doc: next });
          } else {
            const delta = docDelta(prev, next);
            if (ev.label || Object.keys(delta).length) log('doc.edit', { label: ev.label || undefined, ...delta });
          }
          prev = next;
        } else if (ev.type === 'select') {
          log('doc.select', { ids: (ev.ids || []).slice(0, 50) });
        } else if (ev.type === 'view') {
          prev = ev.doc || prev;
          clearTimeout(viewTimer);
          viewTimer = setTimeout(() => {
            const v = session.doc() && session.doc().view;
            log('doc.view', v ? { x: Math.round(v.x), y: Math.round(v.y), zoom: v.zoom } : {});
          }, 800);
        } else if (ev.type === 'part') {
          prev = ev.doc || prev;     // runtime fields only: the runner's own events say what happened
        }
      });
    }

    if (runner && typeof runner.on === 'function') {
      /** @type {Map<string, string>} */ let types = new Map();
      let items = 0;
      const small = () => types.size <= 60;
      const partOf = (/** @type {string} */ id) => {
        const d = session && session.doc();
        return d && Array.isArray(d.parts) ? d.parts.find((/** @type {any} */ p) => p.id === id) : null;
      };
      runner.on((/** @type {any} */ ev) => {
        if (!ev || !ev.type) return;
        switch (ev.type) {
          case 'start': {
            runnerActive = true;
            const d = session && session.doc();
            types = new Map(d && Array.isArray(d.parts) ? d.parts.map((/** @type {any} */ p) => [p.id, p.type]) : []);
            items = 0;
            log('run.start', { count: ev.n, mode: ev.mode, cycle: ev.cycle || undefined, plan: scrub(ev.plan, { max: 200, nodes: 200 }) });
            return;
          }
          case 'part': {
            /** @type {Record<string, any>} */
            const out = { id: ev.partId, type: types.get(ev.partId), state: ev.state, i: ev.i, of: ev.n };
            if (ev.yielded) out.yielded = true;
            if (ev.park) out.park = scrub(ev.park, { max: 300, nodes: 60 });
            if (ev.state === 'error') {
              const p = partOf(ev.partId);
              out.error = p ? scrub(p.error, { max: 2000, nodes: 60 }) : null;
            } else if (ev.state === 'done' && small()) {
              const p = partOf(ev.partId);
              if (p) out.value = scrub(p.value, { max: 300, nodes: 60, items: 10 });
            }
            log('run.part', out);
            return;
          }
          case 'item':
            items++;
            return;
          case 'done':
            runnerActive = false;
            log('run.end', { items: items || undefined, report: scrub(ev.report, { max: 500, nodes: 400 }) });
            return;
          default:
            {
              const { type, n, ...rest } = ev;
              log(`run.${type}`, scrub({ ...rest, count: n }, { max: 300, nodes: 100 }));
            }
        }
      });
    }

    const bus = app.bus;
    if (bus && typeof bus.on === 'function') {
      bus.on(EV.GOV_CHANGE, (/** @type {any} */ p) => log('bus.gov', { foreground: p && p.foreground, holder: p && p.holder }));
      bus.on(EV.FARM_CHANGE, (/** @type {any} */ p) => log('bus.farm', { changed: p && p.changed, caps: p && p.caps }));
      bus.on(EV.VISIBLE, (/** @type {any} */ p) => log('bus.visible', { visible: p && p.visible, pageVisible: p && p.pageVisible }));
      bus.on(EV.STORE_MODE, (/** @type {any} */ p) => log('bus.store', { mode: p }));
      bus.on(EV.STORE_ERROR, (/** @type {any} */ p) => log('err.store', { op: p && p.op, error: scrub(p && p.error) }));
    }

    // What the person was TOLD: every toast, and every question a dialog asked with its answer.
    const dialogs = app.dialogs;
    if (dialogs) {
      for (const fn of ['toast', 'confirm', 'prompt']) {
        const orig = dialogs[fn];
        if (typeof orig !== 'function' || orig.__lolDevlog) continue;
        const wrapped = function (/** @type {any[]} */ ...args) {
          const a = args[0];
          if (fn === 'toast') log('ui.toast', { kind: (args[1] && args[1].kind) || 'info', text: clip(String(a), 500) });
          else log(`ui.${fn}`, { title: a && clip(String(a.title || ''), 200), body: a && clip(String(a.body || ''), 500) });
          const out = orig.apply(dialogs, args);
          if (fn !== 'toast' && out && typeof out.then === 'function') {
            out.then((/** @type {any} */ v) => log(`ui.${fn}.answer`, { value: typeof v === 'string' ? clip(v, 300) : v }), () => { /* the dialog reports its own failure */ });
          }
          return out;
        };
        /** @type {any} */ (wrapped).__lolDevlog = true;
        try { dialogs[fn] = wrapped; } catch { /* a frozen dialogs object: its toasts go unrecorded */ }
      }
    }

    log('log.attached', { host: !!host, runner: !!runner, failed: win.LolComputer ? Object.keys(win.LolComputer.failed || {}) : [] });
    if (rec) log('snap', snapshot('attached'));
    else if (!starting && wanted()) void start('resume');
  }

  // A remembered switch resumes NOW, not at attach(): if the spine or the layout throws, mount()
  // never reaches attach, and that failure is exactly what the file is for. start() snapshots
  // whatever exists by the time main answers; attach() adds a full snapshot if it comes later.
  if (door && wanted()) void start('resume');

  singleton = {
    log, attach, start, stop, mark, shot, flush, status,
    /** @param {(s: any) => void} fn */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** The ring, oldest first (the debug door and the unit test). */
    events: () => ringInOrder(),
    wanted,
    reveal: () => (door ? door.reveal() : Promise.resolve({ ok: false, code: 'E_NONE' })),
  };
  return singleton;
}

/** The recorder, once installed (null before, and in Node). */
export function devlog() {
  return singleton;
}
