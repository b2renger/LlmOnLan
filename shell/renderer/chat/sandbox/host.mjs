// @ts-check
// The sandbox HOST: the renderer side of the opaque-origin iframe. The ONE module in the chat tree
// allowed to create an iframe (lint rule 12) and to use setInterval (rule 13, the watchdog ping).
//
// It knows NOTHING about the graph: `compute` takes code and inputs and gives back JSON, `run` +
// `snapshot` take a sketch and give back a PNG. The Computer's Code/Render/File parts and the S2
// vibecode bench are two callers of the same object (API_KEYS.sandbox, frozen at the C3 kickoff).
//
// What this module is FOR, in one sentence: generated code runs where it can touch nothing —
// no network (connect-src 'none'), no disk (no 'self' in the runner CSP), no storage and no parent
// DOM (an opaque origin makes both a SecurityError), and no way to stall the client (its own
// process, so the watchdog can take five seconds to notice and the user never feels it).
//
// Studio plan §3.7. Every timeout, cap and CSP byte lives in ./protocol.mjs so the two sides
// cannot drift apart.
//
// K-9 (docs/COMPUTER_LIVE_PLAN.md): a SECOND guest, the live one — `live({mount, mode, code, size,
// inputs})` runs one box's sketch for real inside that box, with real input. Both guests come out
// of the same `makeFrame`, so "one module makes iframes" (rule 12) still holds, and what contains
// the live guest is exactly what contains the snapshot guest.

import {
  PROTOCOL_VERSION, LIMITS, TIMEOUTS, MAX_DROPPED, MAX_REBUILDS, REBUILD_WINDOW_MS, SANDBOX_ATTR,
  RUN_KINDS, command, readMessage, mintToken, clampText, guestSize,
} from './protocol.mjs';
import { loadLibs, LIB_NAMES } from './libs.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/sandbox.en.mjs';

/** @typedef {'idle'|'booting'|'ready'|'running'|'stalled'|'disabled'} SandboxState */

/** Which libraries a sketch of this kind needs before its first line runs. */
const KIND_LIBS = Object.freeze({ three: ['three'], p5: ['p5'] });

/** A failure shaped like the guest's own, so a caller has ONE error shape to show. */
const fail = (/** @type {string} */ message) => ({ message, stack: '', line: 0, col: 0 });

/**
 * @param {{app?: any, doc?: Document, win?: any, timeouts?: object, libSource?: (name: string) => Promise<string|null>}} [o]
 *   `win` is the message target (injected by the unit test), `libSource` a per-project override:
 *   given a library name it returns that project's own build, or null to use the vendored one.
 * @returns {any} a SandboxHost (API_KEYS.sandbox)
 */
export function createSandbox(o = {}) {
  const doc = o.doc || document;
  const win = o.win || (typeof window !== 'undefined' ? window : null);
  const T = { ...TIMEOUTS, ...(o.timeouts || {}) };

  /** @type {any} */ let frame = null;
  /** @type {HTMLElement|null} */ let mountEl = null;
  /** @type {SandboxState} */ let state = 'idle';
  let tok = '';
  let dropped = 0;
  let seq = 0;
  let pingTimer = 0;
  let graceTimer = 0;
  let missed = 0;
  let disposed = false;
  let blocked = false;
  /** @type {number[]} */ let rebuilds = [];
  /** @type {Promise<boolean>|null} */ let booting = null;
  /** @type {Map<string, {resolve: Function, timer: any}>} */ const waiting = new Map();
  /** @type {Set<Function>} */ const listeners = new Set();
  /** @type {{level: string, text: string}[]} */ let logs = [];
  /** @type {any[]} */ let errors = [];
  /** @type {string[]} */ let wantedLibs = [];
  /** @type {Map<string, {ok: boolean, error: string|null}>} */ const libState = new Map();
  let libsInFrame = false;
  let runs = 0;
  let nextId = 0;
  // Bumped every time a frame goes away. A caller whose wait was cut short by SOMEONE ELSE'S
  // teardown (the watchdog, usually) must not report the same stall a second time and spend
  // another rung of the rebuild ladder for it.
  let gen = 0;

  const emit = (/** @type {any} */ ev) => {
    for (const fn of Array.from(listeners)) {
      try { fn(ev); } catch (err) { console.error('[lolchat] sandbox listener threw', err); }
    }
  };

  /** @param {SandboxState} next */
  function setState(next) {
    if (state === next) return;
    state = next;
    emit({ type: 'state', state });
  }

  /** One row the reader sees: the restart, the disable, a missing library. */
  function note(/** @type {string} */ text, /** @type {string} */ level) {
    emit({ type: 'note', level: level || 'info', text });
  }

  function post(/** @type {string} */ cmd, /** @type {object} */ payload) {
    if (!frame || !frame.contentWindow) return false;
    // '*' is mandatory: an opaque origin has no nameable target origin. The nonce is the control.
    frame.contentWindow.postMessage(command(cmd, tok, payload), '*');
    return true;
  }

  /** One request / one reply, with a timeout that RESOLVES (never rejects) so no caller hangs and
   * an optional AbortSignal that stops the guest as well as the wait.
   * @param {string} cmd @param {object} payload @param {number} ms @param {AbortSignal} [signal]
   * @returns {Promise<any>} */
  function ask(cmd, payload, ms, signal) {
    const id = `s${++nextId}`;
    return new Promise((resolve) => {
      let done = false;
      /** @type {any} */ let offAbort = null;
      const finish = (/** @type {any} */ value) => {
        if (done) return;
        done = true;
        if (offAbort) offAbort();
        waiting.delete(id);
        resolve(value);
      };
      const timer = setTimeout(() => finish({ ok: false, timeout: true, error: fail(t('sandbox.errTimeout')) }), ms);
      waiting.set(id, { resolve: (/** @type {any} */ v) => { clearTimeout(timer); finish(v); }, timer });
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          post('stop', {});
          finish({ ok: false, aborted: true, error: fail(t('sandbox.errAborted')) });
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          post('stop', {});
          finish({ ok: false, aborted: true, error: fail(t('sandbox.errAborted')) });
        };
        signal.addEventListener('abort', onAbort, { once: true });
        offAbort = () => { try { signal.removeEventListener('abort', onAbort); } catch { /* gone */ } };
      }
      if (!post(cmd, { ...payload, id })) {
        clearTimeout(timer);
        finish({ ok: false, error: fail(t('sandbox.errNoFrame')) });
      }
    });
  }

  /**
   * Settle every outstanding REQUEST as aborted. `stop`/`hide` post `stop` to the guest, whose
   * handler resets and answers NOTHING — so a request still in flight used to sit there until its
   * own timer fired, and the {timeout:true} that came back sent compute()/run() into onStall():
   * a torn-down frame, a "the preview was restarted" note to the reader, and one of the three
   * rungs of the rebuild ladder spent — for a stop the caller ASKED for. The abort-signal path in
   * ask() always got this right; these two did not.
   * `boot` and `libs` are deliberately skipped: they are the frame coming up, not the caller's
   * work, and a stop must not fail a boot that is still in progress.
   */
  function abortWaiting() {
    for (const id of Array.from(waiting.keys())) {
      if (id === 'boot' || id === 'libs') continue;
      settle(id, { ok: false, aborted: true, error: fail(t('sandbox.errAborted')) });
    }
  }

  function settle(/** @type {string} */ id, /** @type {any} */ value) {
    const w = waiting.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    waiting.delete(id);
    w.resolve(value);
  }

  function onMessage(/** @type {MessageEvent} */ ev) {
    if (!frame) return;
    const sameSource = ev.source === frame.contentWindow;
    const read = readMessage(ev.data, { tok, sameSource });
    if (!read.ok) {
      if (!sameSource) return;                       // not ours at all: not a drop, just not for us
      dropped++;
      emit({ type: 'dropped', why: read.why, n: dropped });
      if (dropped >= MAX_DROPPED) { note(t('sandbox.dropped'), 'error'); destroyFrame('dropped'); }
      return;
    }
    dropped = 0;
    const msg = read.msg;
    if (msg.kind === 'ready') { setState('ready'); settle('boot', { ok: true }); return; }
    if (msg.kind === 'pong') { missed = 0; return; }
    if (msg.kind === 'bye') { settle('dispose', { ok: true }); return; }
    if (msg.kind === 'log') { logs.push({ level: msg.level, text: msg.text }); emit({ type: 'log', log: msg }); return; }
    if (msg.kind === 'error') { errors.push(msg); emit({ type: 'error', error: msg }); return; }
    if (msg.kind === 'ran' || msg.kind === 'computed' || msg.kind === 'frame') { settle(msg.id, msg); return; }
    if (msg.kind === 'libsDone') { settle('libs', msg); }
  }

  function clearTimers() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = 0; }
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = 0; }
  }

  function destroyFrame(/** @type {string} */ why) {
    clearTimers();
    if (win) { try { win.removeEventListener('message', onMessage); } catch { /* torn down */ } }
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    frame = null;
    booting = null;
    gen++;
    libsInFrame = false;
    // A caller waiting on a frame that is being torn down because it STOPPED ANSWERING must hear
    // that, not a vaguer "it was restarted": from where the caller stands, its code never replied.
    const stalledWhy = why === 'ping' || /timeout$/.test(why);
    const reason = stalledWhy ? t('sandbox.errTimeout') : t('sandbox.errGone');
    for (const id of Array.from(waiting.keys())) settle(id, { ok: false, timeout: stalledWhy, error: fail(reason) });
    setState(why === 'dropped' || why === 'blocked' ? 'disabled' : 'idle');
    emit({ type: 'gone', why });
  }

  /** The watchdog. The ONE setInterval in the chat tree (lint rule 13): a watchdog IS a wall
   * clock, and two missed pongs mean the guest is not coming back on its own. */
  function armPing() {
    if (pingTimer || !frame) return;
    pingTimer = setInterval(() => {
      if (!frame) return;
      missed++;
      if (missed >= 2 && state !== 'stalled') { setState('stalled'); onStall('ping'); }
      post('ping', { seq: ++seq });
    }, T.ping);
  }

  /** THE iframe factory: both guests (the snapshot one and the live one, K-9) are made here, so
   * they cannot differ in what contains them — the same runner, the same `sandbox` attribute, the
   * same referrer policy, no delegated permission. The URL comes from import.meta.url, NEVER from
   * location: the harness page lives at a different depth than the shipped index.html.
   * @param {string} cls @param {string} title @returns {any} */
  function makeFrame(cls, title) {
    const url = new URL('./runner.html', import.meta.url);
    const fr = doc.createElement('iframe');
    fr.className = cls;
    fr.setAttribute('sandbox', SANDBOX_ATTR);
    fr.setAttribute('referrerpolicy', 'no-referrer');
    fr.setAttribute('allow', '');
    fr.setAttribute('title', title);
    fr.src = url.href;
    return fr;
  }

  /** Create the iframe and wait for `ready`.
   * @returns {Promise<boolean>} */
  function boot() {
    if (disposed || blocked || !mountEl || !win) return Promise.resolve(false);
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = 0; }   // a hide() in its grace period
    if (booting) return booting;                                    // NEVER answer "ready" mid-boot
    if (frame) { armPing(); return Promise.resolve(state !== 'disabled'); }
    booting = (async () => {
      setState('booting');
      tok = mintToken();
      logs = []; errors = []; dropped = 0; missed = 0;
      const fr = makeFrame('sandbox-frame', t('sandbox.frameTitle'));
      frame = fr;
      win.addEventListener('message', onMessage);
      mountEl.appendChild(fr);
      const ready = new Promise((resolve) => {
        const timer = setTimeout(() => { waiting.delete('boot'); resolve({ ok: false }); }, T.boot);
        waiting.set('boot', { resolve: (/** @type {any} */ v) => { clearTimeout(timer); resolve(v); }, timer });
      });
      await new Promise((r) => {
        let settled = false;
        const go = () => { if (!settled) { settled = true; r(null); } };
        try { fr.addEventListener('load', go, { once: true }); } catch { /* shim element */ }
        setTimeout(go, T.boot);
      });
      post('boot', {
        limits: {
          maxLogs: LIMITS.maxLogs, maxErrors: LIMITS.maxErrors,
          logBytes: LIMITS.logBytes, resultBytes: LIMITS.resultBytes, maxPx: LIMITS.maxPx,
        },
      });
      const out = /** @type {any} */ (await ready);
      if (!out || !out.ok) {
        note(t('sandbox.errBoot'), 'error');
        destroyFrame('boot-timeout');
        setState('disabled');
        return false;
      }
      armPing();
      // A rebuilt frame is a blank frame: everything it had loaded has to be sent again.
      if (wantedLibs.length) await sendLibs(wantedLibs);
      return true;
    })();
    const p = booting;
    p.finally(() => { if (booting === p) booting = null; }).catch(() => {});
    return p;
  }

  /** The guest stopped answering: tear the frame down (returns in ~1 ms even mid-loop, the whole
   * point of the opaque origin's own process), then build a fresh one — but NEVER re-run the
   * sketch, or an infinite loop would loop again. Three of these inside a minute and the sandbox
   * goes quiet until the next explicit call, so a broken sketch cannot become a rebuild storm. */
  async function onStall(/** @type {string} */ why) {
    setState('stalled');                  // the state the spec names, whoever noticed it first
    const now = Date.now();
    rebuilds = rebuilds.filter((ts) => now - ts < REBUILD_WINDOW_MS);
    rebuilds.push(now);
    destroyFrame(why);
    if (rebuilds.length >= MAX_REBUILDS) {
      blocked = true;
      setState('disabled');
      note(t('sandbox.disabled'), 'error');
      return;
    }
    note(t('sandbox.stalled'), 'warn');
    await boot();
  }

  /** An explicit call re-arms the ladder once its window has passed (or when the caller says the
   * human asked for this run). Nothing re-arms itself on a timer. */
  function rearmIfAllowed(/** @type {any} */ req) {
    if (!blocked) return;
    const last = rebuilds.length ? rebuilds[rebuilds.length - 1] : 0;
    if ((req && req.rearm === true) || Date.now() - last >= REBUILD_WINDOW_MS) {
      blocked = false;
      rebuilds = [];
      setState('idle');
    }
  }

  /** Send the library TEXT to the guest and remember the verdict per library. */
  async function sendLibs(/** @type {string[]} */ names) {
    const sources = await loadLibs(names, { override: o.libSource });
    for (const name of names) {
      if (!sources.some((s) => s.name === name)) {
        libState.set(name, { ok: false, error: 'missing' });
        note(t('sandbox.libMissing').replace('{name}', name), 'warn');
      } else if (sources.some((s) => s.name === name && s.overridden)) {
        note(t('sandbox.libUsingProject').replace('{name}', name), 'info');
      }
    }
    if (!sources.length) return;
    const waitLibs = new Promise((resolve) => {
      const timer = setTimeout(() => { waiting.delete('libs'); resolve({ results: [] }); }, T.run);
      waiting.set('libs', { resolve: (/** @type {any} */ v) => { clearTimeout(timer); resolve(v); }, timer });
    });
    post('libs', { libs: sources.map((s) => ({ name: s.name, source: s.source })) });
    const out = /** @type {any} */ (await waitLibs);
    for (const r of (out && out.results) || []) {
      libState.set(r.name, { ok: !!r.ok, error: r.error || null });
      if (!r.ok) note(t('sandbox.libFailed').replace('{name}', r.name), 'error');
    }
    libsInFrame = true;
  }

  /** K-4: the frame takes the run's size (or goes back to the mount's), and the parent lays it out
   * NOW — reading its box is what sends the new size on towards the guest before `run` does. The
   * guest still waits for it to arrive (runner.html `whenSized`), briefly.
   * @param {{w: number, h: number}|null} size */
  function sizeFrame(size) {
    if (!frame || !frame.style) return;
    frame.style.width = size ? `${size.w}px` : '';
    frame.style.height = size ? `${size.h}px` : '';
    try { if (typeof frame.getBoundingClientRect === 'function') frame.getBoundingClientRect(); } catch { /* a shim */ }
  }

  /** Make sure these libraries are in the live frame before the sketch's first line runs. */
  async function ensureLibs(/** @type {string[]} */ names) {
    const want = (Array.isArray(names) ? names : []).map(String).filter((n, i, a) => a.indexOf(n) === i);
    const fresh = want.filter((n) => !wantedLibs.includes(n));
    wantedLibs = wantedLibs.concat(fresh);
    if (fresh.length) await sendLibs(fresh);
    else if (wantedLibs.length && !libsInFrame) await sendLibs(wantedLibs);
  }

  // ---- K-9: the LIVE guest ------------------------------------------------------------------
  //
  // The snapshot guest above is a camera: it runs a sketch off-screen and hands back a PNG. The
  // live guest is the sketch itself, running for real inside ONE box's picture area — so the
  // person can orbit a three.js scene, move the mouse over a p5 sketch, type into it. Everything
  // that contains the snapshot guest contains this one too (`makeFrame`: the same runner, the same
  // CSP, the same `sandbox` attribute and referrer policy), with its own nonce, its own message
  // check and its own watchdog. What is different is WHERE it lives: inside the box (`mount`), so
  // it pans and zooms with the canvas for nothing, and input over it lands in ITS document, not
  // the canvas's. At most ONE exists: starting a second stops the first (§2.6 BJ becomes "one
  // snapshot guest, plus at most one live guest"). A live guest that stops answering is torn
  // down and NOT rebuilt — rebuilding would run the loop that hung it again.

  /** @type {any} */ let liveGuest = null;

  /** What a live run carries to the guest: a Preview's mode, in the host's own words.
   * `html` is the one mode whose code is markup: it goes as `html` on a `dom` run.
   * @param {any} req */
  function liveSpec(req) {
    const mode = String(req.mode || 'dom');
    const markup = mode === 'html';
    const kind = markup ? 'dom' : (RUN_KINDS.indexOf(mode) >= 0 ? mode : 'dom');
    return {
      markup,
      kind,
      code: markup ? '' : String(req.code || ''),
      html: markup ? String(req.code || '') : (req.html === undefined ? '' : String(req.html)),
      css: req.css === undefined ? '' : String(req.css),
      params: req.inputs && typeof req.inputs === 'object' ? req.inputs : {},
      libs: Array.isArray(req.libs) ? req.libs.map(String) : (/** @type {any} */ (KIND_LIBS)[kind] || []),
    };
  }

  /**
   * @param {{mount?: any, mode?: string, code?: string, html?: string, css?: string,
   *   size?: {w: number, h: number}, inputs?: object, libs?: string[]}} req
   */
  function makeLive(req) {
    const mount = req.mount || null;
    const spec = liveSpec(req);
    let size = guestSize(req.size);
    /** @type {'booting'|'running'|'error'|'stalled'|'stopped'} */ let lstate = 'booting';
    /** @type {any} */ let lframe = null;
    let ltok = '';
    let lping = 0;
    let lmissed = 0;
    let lseq = 0;
    let ldropped = 0;
    let lruns = 0;
    let lnext = 0;
    let ended = false;
    /** @type {{level: string, text: string}[]} */ let llogs = [];
    /** @type {any[]} */ let lerrs = [];
    /** @type {Set<Function>} */ const subs = new Set();
    /** @type {Map<string, {resolve: Function, timer: any}>} */ const lwait = new Map();

    const lemit = (/** @type {any} */ ev) => {
      for (const fn of Array.from(subs)) {
        try { fn(ev); } catch (err) { console.error('[lolchat] live sandbox listener threw', err); }
      }
    };
    const setL = (/** @type {any} */ next) => {
      if (lstate === next) return;
      lstate = next;
      lemit({ type: 'state', state: next });
    };
    const lpost = (/** @type {string} */ cmd, /** @type {object} */ payload) => {
      if (!lframe || !lframe.contentWindow) return false;
      lframe.contentWindow.postMessage(command(cmd, ltok, payload), '*');
      return true;
    };
    /** A wait that RESOLVES on timeout (never rejects), keyed by id. */
    const lwaitFor = (/** @type {string} */ id, /** @type {number} */ ms, /** @type {any} */ onTimeout) => new Promise((resolve) => {
      const timer = setTimeout(() => { lwait.delete(id); resolve(onTimeout); }, ms);
      lwait.set(id, { resolve: (/** @type {any} */ v) => { clearTimeout(timer); lwait.delete(id); resolve(v); }, timer });
    });
    const lsettle = (/** @type {string} */ id, /** @type {any} */ v) => { const w = lwait.get(id); if (w) w.resolve(v); };
    /** @param {string} cmd @param {object} payload @param {number} ms */
    const lask = (cmd, payload, ms) => {
      const id = `l${++lnext}`;
      const p = lwaitFor(id, ms, { ok: false, timeout: true, error: fail(t('sandbox.errTimeout')) });
      if (!lpost(cmd, { ...payload, id })) lsettle(id, { ok: false, error: fail(t('sandbox.errNoFrame')) });
      return p;
    };

    function onLiveMessage(/** @type {MessageEvent} */ ev) {
      if (!lframe || ev.source !== lframe.contentWindow) return;   // the snapshot guest's, or no one's
      const read = readMessage(ev.data, { tok: ltok, sameSource: true });
      if (!read.ok) {
        ldropped++;
        if (ldropped >= MAX_DROPPED) end('dropped');
        return;
      }
      ldropped = 0;
      const msg = read.msg;
      if (msg.kind === 'ready') { lsettle('boot', { ok: true }); return; }
      if (msg.kind === 'pong') { lmissed = 0; return; }
      if (msg.kind === 'libsDone') { lsettle('libs', msg); return; }
      if (msg.kind === 'ran' || msg.kind === 'frame') { lsettle(msg.id, msg); return; }
      if (msg.kind === 'log') {
        if (llogs.length < LIMITS.maxLogs) llogs.push({ level: msg.level, text: msg.text });
        lemit({ type: 'log', log: msg });
        return;
      }
      if (msg.kind === 'error') {
        if (lerrs.length < LIMITS.maxErrors) lerrs.push(msg);
        lemit({ type: 'error', error: msg });
        return;
      }
      if (msg.kind === 'release') lemit({ type: 'release', why: msg.why });
    }

    /** The frame takes the run's size exactly (K-4): `innerWidth`/`innerHeight` ARE the box's. */
    function sizeLive() {
      if (!lframe || !lframe.style) return;
      lframe.style.width = size ? `${size.w}px` : '';
      lframe.style.height = size ? `${size.h}px` : '';
    }

    /** Tear it down. Removing the frame ends every timer, listener, WebGL context and sound it
     * had, in one step, whatever the sketch was doing. @param {string} why */
    function end(why) {
      if (ended) return;
      ended = true;
      if (lping) { clearInterval(lping); lping = 0; }
      if (win) { try { win.removeEventListener('message', onLiveMessage); } catch { /* torn down */ } }
      if (lframe && lframe.parentNode) lframe.parentNode.removeChild(lframe);
      lframe = null;
      const stalledWhy = why === 'stalled' || /timeout$/.test(why);
      for (const id of Array.from(lwait.keys())) {
        lsettle(id, { ok: false, timeout: stalledWhy, aborted: !stalledWhy, error: fail(stalledWhy ? t('sandbox.errTimeout') : t('sandbox.errAborted')) });
      }
      setL(stalledWhy || why === 'dropped' ? 'stalled' : 'stopped');
      if (liveGuest === self) liveGuest = null;
      lemit({ type: 'stopped', why });
      subs.clear();
    }

    /** The watchdog, the live guest's own: two missed pongs and the frame goes — for good. */
    function armLivePing() {
      if (lping || !lframe) return;
      lping = setInterval(() => {
        if (!lframe) return;
        lmissed++;
        if (lmissed >= 2) { end('stalled'); return; }
        lpost('ping', { seq: ++lseq });
      }, T.ping);
    }

    async function runLive() {
      if (ended) return { ok: false, ms: 0, error: fail(t('sandbox.errNoFrame')) };
      llogs = []; lerrs = [];
      lruns++;
      sizeLive();
      const out = await lask('run', {
        code: spec.code, kind: spec.kind, params: spec.params, html: spec.html, css: spec.css, size,
      }, T.run);
      if (out && out.timeout && !ended) { end('run-timeout'); }
      if (ended) return { ok: false, ms: 0, timeout: !!(out && out.timeout), error: (out && out.error) || fail(t('sandbox.errGone')) };
      setL(out && out.ok ? 'running' : 'error');
      return { ok: !!(out && out.ok), ms: (out && out.ms) || 0, error: (out && out.error) || null };
    }

    async function bootLive() {
      if (disposed || !win || !mount || typeof mount.appendChild !== 'function') {
        end('no-mount');
        return { ok: false, ms: 0, error: fail(t('sandbox.errNoFrame')) };
      }
      ltok = mintToken();
      const fr = makeFrame('sandbox-frame sandbox-live-frame', t('sandbox.liveTitle'));
      lframe = fr;
      sizeLive();
      win.addEventListener('message', onLiveMessage);
      mount.appendChild(fr);
      const ready = lwaitFor('boot', T.boot, { ok: false });
      await new Promise((r) => {
        let settled = false;
        const go = () => { if (!settled) { settled = true; r(null); } };
        try { fr.addEventListener('load', go, { once: true }); } catch { /* shim element */ }
        setTimeout(go, T.boot);
      });
      if (ended) return { ok: false, ms: 0, error: fail(t('sandbox.errAborted')) };
      lpost('boot', {
        live: true,
        limits: {
          maxLogs: LIMITS.maxLogs, maxErrors: LIMITS.maxErrors,
          logBytes: LIMITS.logBytes, resultBytes: LIMITS.resultBytes, maxPx: LIMITS.maxPx,
        },
      });
      const out = /** @type {any} */ (await ready);
      if (ended) return { ok: false, ms: 0, error: fail(t('sandbox.errAborted')) };
      if (!out || !out.ok) { end('boot-timeout'); return { ok: false, ms: 0, error: fail(t('sandbox.errBoot')) }; }
      armLivePing();
      if (spec.libs.length) {
        const sources = await loadLibs(spec.libs, { override: o.libSource });
        if (ended) return { ok: false, ms: 0, error: fail(t('sandbox.errAborted')) };
        if (sources.length) {
          const done = lwaitFor('libs', T.run, { results: [] });
          lpost('libs', { libs: sources.map((s) => ({ name: s.name, source: s.source })) });
          await done;
        }
      }
      return runLive();
    }

    /** @type {Promise<any>} */ let chain = Promise.resolve(null);

    const handle = {
      /** Stop and remove the live frame. The owner hears `{type:'stopped', why:'stopped'}`. */
      stop() { end('stopped'); },
      /** Run new code (or the same, with `null`) in the SAME frame: the guest resets and runs.
       * `opts.size` re-sizes the frame first. @param {string|null} [code]
       * @param {{size?: {w: number, h: number}, inputs?: object}} [opts] */
      restart(code, opts) {
        if (ended) return Promise.resolve({ ok: false, ms: 0, error: fail(t('sandbox.errNoFrame')) });
        if (typeof code === 'string') {
          if (spec.markup) spec.html = code; else spec.code = code;
        }
        if (opts && opts.size) size = guestSize(opts.size);
        if (opts && opts.inputs && typeof opts.inputs === 'object') spec.params = opts.inputs;
        chain = chain.then(() => runLive(), () => runLive());
        return chain;
      },
      /** Give the sketch the keyboard (the person clicked into it, or asked from the box). */
      focus() { try { if (lframe && typeof lframe.focus === 'function') lframe.focus(); } catch { /* detached */ } },
      /** 'booting' | 'running' | 'error' (the sketch threw) | 'stalled' | 'stopped' */
      state: () => lstate,
      /** The first run's outcome, `{ok, ms, error}` (set below, once the boot has started). */
      /** @type {Promise<any>} */ ready: Promise.resolve(null),
      logs: () => llogs.slice(),
      errors: () => lerrs.slice(),
      /** A PNG of what the live sketch shows right now, or null — the debug door a test reads
       * pixels through (a WebGL scene needs `preserveDrawingBuffer`, which the three.js prelude sets).
       * @param {{maxPx?: number}} [req] */
      async snapshot(req = {}) {
        if (ended || !lframe) return null;
        const maxPx = Math.min(Number(req.maxPx) || LIMITS.maxPx, LIMITS.maxPx);
        const out = await lask('snapshot', { maxPx }, T.snapshot);
        if (!out || !out.dataUrl) return null;
        return { dataUrl: out.dataUrl, w: out.w || 0, h: out.h || 0 };
      },
      /** @param {(ev: any) => void} fn */
      on(fn) { subs.add(fn); return () => subs.delete(fn); },
      debug: () => ({ state: lstate, kind: spec.kind, runs: lruns, logs: llogs.length, errors: lerrs.length, framed: !!lframe, size }),
    };
    // The host's record of this guest: the public handle, and the teardown only the host calls
    // (`hide`, `destroy`, a second live guest).
    const self = { handle, end };
    // Every run of this guest goes through one chain, so a restart during the boot runs AFTER it.
    chain = bootLive();
    handle.ready = chain;
    Object.freeze(handle);
    return self;
  }

  return {
    /** @param {HTMLElement} el where the (visually inert) iframe lives */
    mount(el) { mountEl = el; },
    state: () => state,
    /** Boot on demand; resolves false when the sandbox is unavailable. */
    ready: () => boot(),
    logs: () => logs.slice(),
    errors: () => errors.slice(),
    runs: () => runs,

    /** Deterministic JavaScript that RETURNS a value (the `Code` part). The value crosses as a
     * JSON STRING so the host can cap the bytes before it parses anything.
     * @param {{code: string, inputs?: object, timeoutMs?: number, signal?: AbortSignal, rearm?: boolean}} req
     * @returns {Promise<{ok: boolean, ms: number, json: string|null, error: any}>} */
    async compute(req) {
      rearmIfAllowed(req);
      if (!(await boot())) return { ok: false, ms: 0, json: null, error: fail(t('sandbox.errDisabled')) };
      runs++;
      logs = []; errors = [];
      setState('running');
      const g = gen;
      const out = await ask('compute', { code: String(req.code || ''), inputs: req.inputs || {} }, req.timeoutMs || T.compute, req.signal);
      if (out && out.timeout && gen === g) await onStall('compute-timeout');
      else if (state !== 'disabled' && state !== 'booting') setState(frame ? 'ready' : 'idle');
      return { ok: !!out.ok, ms: out.ms || 0, json: out.json === undefined ? null : out.json, error: out.error || null };
    },

    /** A sketch that PAINTS (the `Render` part, and the S2 bench's preview).
     * K-4 (critic R1 A8): `size: {w, h}` sizes the guest frame before the run, so the sketch's
     * `innerWidth`/`innerHeight`, `lol.size` and the default canvas are exactly w x h. Without it
     * the frame is the mount's own size (640 x 480), as it always was.
     * @param {{code?: string, kind?: string, params?: object, html?: string, css?: string,
     *   libs?: string[], timeoutMs?: number, signal?: AbortSignal, rearm?: boolean,
     *   size?: {w: number, h: number}}} req
     * @returns {Promise<{ok: boolean, ms: number, error: any}>} */
    async run(req = {}) {
      rearmIfAllowed(req);
      if (!(await boot())) return { ok: false, ms: 0, error: fail(t('sandbox.errDisabled')) };
      const kind = String(req.kind || 'dom');
      await ensureLibs(req.libs || /** @type {any} */ (KIND_LIBS)[kind] || []);
      runs++;
      logs = []; errors = [];
      setState('running');
      const g = gen;
      const size = guestSize(req.size);
      sizeFrame(size);
      const out = await ask('run', {
        code: String(req.code || ''),
        kind,
        params: req.params || {},
        html: req.html === undefined ? '' : String(req.html),
        css: req.css === undefined ? '' : String(req.css),
        size,
      }, req.timeoutMs || T.run, req.signal);
      if (out && out.timeout && gen === g) await onStall('run-timeout');
      else if (state !== 'disabled' && state !== 'booting') setState(frame ? 'ready' : 'idle');
      return { ok: !!out.ok, ms: out.ms || 0, error: out.error || null };
    },

    /** A PNG of what the guest painted: the first canvas, or the root rasterised through an SVG
     * foreignObject when a sketch drew plain DOM. Null (never a throw) when there is no picture.
     * @param {{maxPx?: number, timeoutMs?: number, signal?: AbortSignal}} [req]
     * @returns {Promise<{dataUrl: string, w: number, h: number}|null>} */
    async snapshot(req = {}) {
      if (!frame || state === 'disabled') return null;
      const maxPx = Math.min(Number(req.maxPx) || LIMITS.maxPx, LIMITS.maxPx);
      const g = gen;
      const out = await ask('snapshot', { maxPx }, req.timeoutMs || T.snapshot, req.signal);
      if (out && out.timeout) { if (gen === g) await onStall('snapshot-timeout'); return null; }
      if (!out || !out.dataUrl) return null;
      return { dataUrl: out.dataUrl, w: out.w || 0, h: out.h || 0 };
    },

    /** Live knob values, no re-run. */
    params(values) { post('params', { values: values || {} }); },
    stop() { post('stop', {}); abortWaiting(); if (state === 'running') setState(frame ? 'ready' : 'idle'); },

    /**
     * K-9: run a sketch LIVE inside `mount` (a box's picture area), with real input. Starting a
     * second live guest stops the first (its owner hears `{type:'stopped', why:'replaced'}`).
     * Never throws: a guest that cannot start ends with state 'stopped'/'stalled' and its `ready`
     * resolves `{ok:false, error}`.
     * @param {{mount: any, mode: string, code: string, size?: {w: number, h: number},
     *   inputs?: object, html?: string, css?: string, libs?: string[]}} req
     *   `mode` is a Preview mode (`three`, `p5`, `html`) or a run kind; `code` is already shaped.
     * @returns {{stop(): void, restart(code?: string|null, opts?: object): Promise<any>,
     *   focus(): void, state(): string, ready: Promise<any>, logs(): any[], errors(): any[],
     *   snapshot(o?: object): Promise<any>, on(fn: Function): () => void, debug(): object}}
     */
    live(req) {
      if (liveGuest) liveGuest.end('replaced');
      const g = makeLive(req || /** @type {any} */ ({}));
      const st = g.handle.state();
      if (st !== 'stopped' && st !== 'stalled') liveGuest = g;
      return g.handle;
    },
    /** The live guest's handle, or null when no box is live. */
    liveNow: () => (liveGuest ? liveGuest.handle : null),

    /** Suspend: the sketch stops now, the watchdog stops now, and the frame itself goes after a
     * grace period — so flipping to another panel and back does not pay a rebuild. The LIVE
     * guest does not wait: a sketch nobody can see is stopped at once. */
    hide() {
      if (liveGuest) liveGuest.end('hidden');
      post('stop', {});
      abortWaiting();
      if (pingTimer) { clearInterval(pingTimer); pingTimer = 0; }
      if (state === 'running') setState('ready');
      if (graceTimer) clearTimeout(graceTimer);
      if (frame) graceTimer = setTimeout(() => { graceTimer = 0; destroyFrame('hide'); }, T.hideGrace);
    },

    destroy() {
      disposed = true;
      if (liveGuest) liveGuest.end('gone');
      post('dispose', {});
      destroyFrame('dispose');
      wantedLibs = [];
      libState.clear();
      listeners.clear();
    },

    /** @param {(ev: any) => void} fn */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    debug: () => ({
      v: PROTOCOL_VERSION,
      state,
      runs,
      logs: logs.length,
      errors: errors.length,
      dropped,
      framed: !!frame,
      blocked,
      rebuilds: rebuilds.length,
      libs: Array.from(libState.entries()).map(([name, s]) => ({ name, ok: s.ok, error: clampText(s.error, 200) })),
      known: LIB_NAMES.slice(),
      live: liveGuest ? liveGuest.handle.debug() : null,
    }),
  };
}
