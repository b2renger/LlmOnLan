// @ts-check
// Capability checks that cost no seat (S0-U2, studio plan §3.4.3). Feature module: `install(app)`
// wires the farm model's cap resolver and publishes NOTHING on `app` — a broken probe must never
// be able to take the ask spine down with it, which is why it is its own loader row (BD-2).
//
// The question is always the same: can THIS model read an image? Three ways to learn the answer,
// in descending order of politeness:
//   1. `GET {proxyRoot}/model_group/info` — LiteLLM's own catalogue, a GET, never counted by the
//      farm's seat gate (F15). One request per farm change, none per tick.
//   2. `kv cap:<farmId>:<underlying>:vision` — what we learned last time, which survives a reload
//      and a farm that is momentarily unreachable.
//   3. A 400 the farm answered with, classified `vision_unsupported` by net/errors.mjs. app/ask.mjs
//      emits NO_VISION_EVENT when it sees one; that is a HARD downgrade, because the engine has
//      just told us in the only language it has.
// A probe that fails leaves the verdict at 'unknown' — never at 'no'. "We could not ask" and "it
// cannot see" are different sentences, and only one of them should send a reader to the operator.
//
// This file owns the ONE network GET the renderer makes outside net/* (chat-lint rule 11's allow
// list names it). It never POSTs: an ask costs a seat, a capability check must not.

import { EV } from '../core/events.mjs';
import { KV_KEYS } from '../core/types.mjs';
import { NO_VISION_EVENT } from './ask.mjs';
import '../strings/ask.en.mjs';

/** How long a probe may take before we give up and stay honest about not knowing. */
const PROBE_TIMEOUT_MS = 5000;

/** @param {any} v */
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * PURE: LiteLLM's `/model_group/info` body → the verdicts we keep. Exported for the unit test,
 * because the shape is the one thing about the probe that can silently change under us.
 * @param {any} body
 * @returns {{underlying: string, vision: 'yes'|'no'}[]}
 */
export function readModelGroupInfo(body) {
  const rows = body && Array.isArray(body.data) ? body.data : [];
  /** @type {{underlying: string, vision: 'yes'|'no'}[]} */ const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const name = str(row.model_group) || str(row.model_name) || str(row.id);
    if (!name) continue;
    // Absent means absent: only an explicit boolean is a verdict, and `false` is the one that
    // matters (a farm that never mentions vision leaves us at 'unknown', not at 'no').
    if (typeof row.supports_vision !== 'boolean') continue;
    out.push({ underlying: name, vision: row.supports_vision ? 'yes' : 'no' });
  }
  return out;
}

/** @param {any} app */
export function createCaps(app) {
  /** @type {Map<string, 'yes'|'no'>} */ const vision = new Map();
  /** The (baseUrl|apiKey|models) signature we last probed, so a tick can never re-ask. */
  let probedFor = '';
  let probing = false;
  let probes = 0;

  const caps = () => (app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null);
  const repo = () => app.repo || null;

  /** @param {any} c */
  const signature = (c) => `${(c && c.baseUrl) || ''}|${(c && c.apiKey) || ''}|${JSON.stringify((c && c.models) || [])}`;

  /** @param {any} c @param {string} underlying @returns {string|null} */
  function kvKey(c, underlying) {
    const farmId = (c && c.id) || null;
    if (!farmId || !underlying) return null;
    return KV_KEYS.vision(farmId, underlying);
  }

  /** @param {string} underlying @param {'yes'|'no'} verdict @param {{persist?: boolean}} [o] */
  function remember(underlying, verdict, o) {
    if (!underlying) return;
    vision.set(underlying, verdict);
    if (o && o.persist === false) return;
    const r = repo();
    const key = kvKey(caps(), underlying);
    if (r && key && typeof r.kvSet === 'function') Promise.resolve(r.kvSet(key, verdict)).catch(() => {});
  }

  /** Pull what we already knew about the advertised models into memory (no network). */
  async function primeFromStore() {
    const c = caps();
    const r = repo();
    if (!c || !r || typeof r.kvGet !== 'function') return;
    for (const m of c.models || []) {
      const underlying = str(m.underlying) || str(m.id);
      const key = kvKey(c, underlying);
      if (!key || vision.has(underlying)) continue;
      try {
        const v = await r.kvGet(key, null);
        if ((v === 'yes' || v === 'no') && !vision.has(underlying)) vision.set(underlying, v);
      } catch { /* the store speaks through its own banner */ }
    }
  }

  /**
   * The one GET. `AbortSignal` keeps a farm that accepts the connection and then thinks about it
   * from leaving a request hanging for the life of the window.
   * @returns {Promise<boolean>} whether the catalogue was read
   */
  async function probe() {
    const c = caps();
    if (!c || !c.present || !c.proxyRoot || c.keyMissing) return false;
    // A farm that has not told us its models yet has nothing for us to ask about — and asking
    // anyway costs a whole extra round trip on every boot, because the first publish carries the
    // endpoint and the second carries the catalogue (measured in s0-ask-vision-cap: two GETs).
    if (!Array.isArray(c.models) || !c.models.length) return false;
    const sig = signature(c);
    if (probing || sig === probedFor) return false;
    probing = true;
    const ac = new AbortController();
    // A one-shot deadline on ONE request, not a wall-clock rule: §3.9 bans modules that keep their
    // own heartbeat, and this timer dies with the request it guards. Without it, a farm that
    // accepts the connection and then thinks about it forever leaks a probe per farm change.
    const timer = setTimeout(() => { try { ac.abort(); } catch { /* already gone */ } }, PROBE_TIMEOUT_MS);
    try {
      probes++;
      const res = await fetch(`${c.proxyRoot}/model_group/info`, {
        headers: (app.farm.headers && app.farm.headers()) || {},
        cache: 'no-store',
        signal: ac.signal,
      });
      if (!res.ok) return false;
      const body = await res.json();
      for (const row of readModelGroupInfo(body)) remember(row.underlying, row.vision);
      probedFor = sig;                      // only a SUCCESSFUL read stops us asking again
      return true;
    } catch {
      return false;                          // unknown stays unknown; the next farm change retries
    } finally {
      clearTimeout(timer);
      probing = false;
    }
  }

  /** The resolver net/farm.mjs calls from `app.farm.cap()`. Synchronous, cache-only, never fetches. */
  function resolver(underlying, name) {
    if (name !== 'vision') return 'unknown';
    return vision.get(str(underlying)) || 'unknown';
  }

  return {
    resolver,
    probe,
    primeFromStore,
    /** A 400 the engine answered with beats anything the catalogue said (§3.4.3). */
    downgrade(underlying) {
      const id = str(underlying);
      if (!id) return;
      remember(id, 'no');
    },
    debug: {
      probes: () => probes,
      verdicts: () => Object.fromEntries(vision),
    },
  };
}

/** @param {any} app */
export function install(app) {
  const caps = createCaps(app);
  if (app.farm && typeof app.farm.setCapResolver === 'function') app.farm.setCapResolver(caps.resolver);

  // SERIALISED, not just guarded. Two farm changes can land within a frame of each other (the
  // first publish fills `baseUrl`, the next one fills `models`), and both would sail past the
  // "already probed this farm" check while the first probe is still awaiting the store — two GETs
  // for one question. Chaining makes the second one see the first one's verdict and do nothing.
  /** @type {Promise<any>} */ let chain = Promise.resolve();
  const refresh = () => {
    chain = chain
      .then(() => caps.primeFromStore())
      .then(() => caps.probe())
      .catch((err) => console.warn('[lolchat] capability probe failed', err));
    return chain;
  };

  // FARM_CHANGE only, never FARM_TICK (§3.4.3): the tick fires every few seconds and a capability
  // catalogue does not move that fast. `probedFor` makes a repeated FARM_CHANGE on unrelated fields
  // (seat counts move constantly) cost nothing.
  app.bus.on(EV.FARM_CHANGE, (/** @type {any} */ p) => {
    const changed = (p && Array.isArray(p.changed) ? p.changed : []);
    if (!changed.some((k) => k === 'baseUrl' || k === 'apiKey' || k === 'models' || k === 'id' || k === 'keyMissing')) return;
    refresh();
  });

  app.bus.on(NO_VISION_EVENT, (/** @type {any} */ p) => {
    if (p && p.underlying) caps.downgrade(p.underlying);
  });

  // A farm may already be published by the time features install (main.mjs step 9 runs after, but
  // a reload with a warm `window.__lolFarm` fills caps during component construction).
  const c = app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null;
  if (c && c.present) refresh();

  const bag = typeof window !== 'undefined' && window.LolChat ? window.LolChat.debug : null;
  if (bag) bag.caps = caps.debug;

  return caps;
}
