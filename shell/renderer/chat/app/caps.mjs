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
//
// K6-U1 (LOLCHAT_PLAN 2.6 KF-2): the same catalogue read now also keeps `audio` and `pdf` — from
// the explicit booleans `supports_audio_input` / `supports_pdf_input`, LiteLLM's own spelling in
// its cost map. The pinned proxy (1.97) never puts either field in a row (KF-1 a3), so on the real
// farm both stay 'unknown'; the resolver says so rather than guessing. Every verdict lives under
// KV_KEYS.cap(farmId, model, name) — `vision` is the very row S0 already wrote.

import { EV } from '../core/events.mjs';
import { KV_KEYS } from '../core/types.mjs';
import { NO_VISION_EVENT } from './ask.mjs';
import '../strings/ask.en.mjs';

/** K6 kickoff (addendum KF-2): the bus name a verdict change travels on — after a successful
 * catalogue read and after a downgrade — so a box's "takes:" line (graph/takes-view.mjs) can
 * repaint without polling. Payload `{farmId}`. Emitted by this module and by nothing else. */
export const CAPS_EVENT = 'caps:change';

/** How long a probe may take before we give up and stay honest about not knowing. */
const PROBE_TIMEOUT_MS = 5000;

/** @param {any} v */
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * The row field each capability is read from (KF-2). ONLY an explicit boolean is a verdict: a
 * row without the field says nothing, and nothing is concluded from that silence (build rule 7).
 * `vision` is the S0 contract that shipped (`false` → 'no', addendum KF-1 a5); `audio` and `pdf`
 * are LiteLLM's cost-map spellings, which the pinned proxy never reports (KF-1 a3).
 */
export const CAP_FIELDS = Object.freeze({
  vision: 'supports_vision',
  audio: 'supports_audio_input',
  pdf: 'supports_pdf_input',
});

/** @typedef {'vision'|'audio'|'pdf'} CapName */
const NAMES = /** @type {CapName[]} */ (Object.keys(CAP_FIELDS));

/** A `/model_group/info` row's name, or ''. @param {any} row */
const rowName = (row) => (row && typeof row === 'object' ? (str(row.model_group) || str(row.model_name) || str(row.id)) : '');

/**
 * PURE: LiteLLM's `/model_group/info` body → the verdicts we keep. Exported for the unit test,
 * because the shape is the one thing about the probe that can silently change under us. A row
 * carries a key ONLY for a capability it stated; a row that states none is not in the list.
 * @param {any} body
 * @returns {{underlying: string, vision?: 'yes'|'no', audio?: 'yes'|'no', pdf?: 'yes'|'no'}[]}
 */
export function readModelGroupInfo(body) {
  const rows = body && Array.isArray(body.data) ? body.data : [];
  /** @type {{underlying: string, vision?: 'yes'|'no', audio?: 'yes'|'no', pdf?: 'yes'|'no'}[]} */ const out = [];
  for (const row of rows) {
    const name = rowName(row);
    if (!name) continue;
    // Absent means absent: only an explicit boolean is a verdict (a farm that never mentions a
    // capability leaves us at 'unknown', not at 'no').
    /** @type {any} */ const v = { underlying: name };
    let stated = false;
    for (const cap of NAMES) {
      const field = row[CAP_FIELDS[cap]];
      if (typeof field !== 'boolean') continue;
      v[cap] = field ? 'yes' : 'no';
      stated = true;
    }
    if (stated) out.push(v);
  }
  return out;
}

/**
 * Buses OTHER than the installing App's that want CAPS_EVENT (K6-U1). The Computer shares the
 * chat's farm and therefore the chat's ONE caps install (computer/boot.mjs), but its bus is its
 * own, and the boot mirror carries only GOV/FARM events — so a catalogue read would repaint the
 * chat and leave every "takes:" line on the canvas saying '?' until the next edit. A line
 * registers its App's bus here (graph/takes-view.mjs); a bus is emitted on once, never twice.
 * @type {Set<any>}
 */
const relays = new Set();

/**
 * Also deliver CAPS_EVENT on `bus`. Idempotent; a surface registers its bus once for the life of
 * the window (there are two surfaces, so the set never grows past two).
 * @param {any} bus @returns {() => void} undo
 */
export function relayCapsTo(bus) {
  if (!bus || typeof bus.emit !== 'function') return () => {};
  relays.add(bus);
  return () => { relays.delete(bus); };
}

/** @param {any} app */
export function createCaps(app) {
  /** @type {Record<CapName, Map<string, 'yes'|'no'>>} */
  const known = { vision: new Map(), audio: new Map(), pdf: new Map() };
  const vision = known.vision;
  /** The (baseUrl|apiKey|models) signature we last probed, so a tick can never re-ask. */
  let probedFor = '';
  let probing = false;
  let probes = 0;

  const caps = () => (app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null);
  const repo = () => app.repo || null;

  /** Tell whoever draws a verdict that one may have moved (KF-2). Never throws into a probe. */
  function changed() {
    const payload = { farmId: (caps() || {}).id || null };
    const buses = new Set([app.bus, ...relays]);
    for (const bus of buses) {
      try {
        if (bus && typeof bus.emit === 'function') bus.emit(CAPS_EVENT, payload);
      } catch (err) { console.warn('[lolchat] a capability listener threw', err); }
    }
  }

  /** @param {any} c */
  const signature = (c) => `${(c && c.baseUrl) || ''}|${(c && c.apiKey) || ''}|${JSON.stringify((c && c.models) || [])}`;

  /** @param {any} c @param {string} model @param {CapName} name @returns {string|null} */
  function kvKey(c, model, name) {
    const farmId = (c && c.id) || null;
    if (!farmId || !model) return null;
    return KV_KEYS.cap(farmId, model, name);
  }

  /** @param {string} model @param {CapName} name @param {'yes'|'no'|null} verdict null = forget
   * @param {{persist?: boolean}} [o] */
  function remember(model, name, verdict, o) {
    if (!model || !known[name]) return;
    if (verdict) known[name].set(model, verdict);
    else known[name].delete(model);
    if (o && o.persist === false) return;
    const r = repo();
    const key = kvKey(caps(), model, name);
    // There is no kvDelete; a null row reads back as "no verdict" (primeFromStore keeps only
    // 'yes'/'no'), which is exactly what forgetting has to mean.
    if (r && key && typeof r.kvSet === 'function') Promise.resolve(r.kvSet(key, verdict)).catch(() => {});
  }

  /** Every name a served model is known under: the alias the catalogue is keyed by AND the
   * underlying model a verdict may have been learnt for. @param {any} c @returns {string[]} */
  function namesOf(c) {
    /** @type {string[]} */ const out = [];
    for (const m of (c && c.models) || []) {
      for (const n of [str(m && m.id), str(m && m.underlying)]) if (n && out.indexOf(n) < 0) out.push(n);
    }
    return out;
  }

  /** Pull what we already knew about the advertised models into memory (no network). Tells the
   * lines when it learnt anything, so a reload with a farm that is momentarily unreachable still
   * repaints from what the last window knew. */
  async function primeFromStore() {
    const c = caps();
    const r = repo();
    if (!c || !r || typeof r.kvGet !== 'function') return;
    let learnt = 0;
    for (const model of namesOf(c)) {
      for (const name of NAMES) {
        const key = kvKey(c, model, name);
        if (!key || known[name].has(model)) continue;
        try {
          const v = await r.kvGet(key, null);
          if ((v === 'yes' || v === 'no') && !known[name].has(model)) { known[name].set(model, v); learnt++; }
        } catch { /* the store speaks through its own banner */ }
      }
    }
    if (learnt) changed();
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
      const stated = readModelGroupInfo(body);
      for (const row of stated) {
        for (const name of NAMES) {
          const v = row[name];
          if (v) remember(row.underlying, name, v);
        }
      }
      // A model the catalogue LISTS but no longer states sound or PDF input for loses what an
      // older catalogue said: a remembered 'yes' the farm has stopped saying is a claim from
      // stale data (build rule 7). Vision keeps its S0 rule (a verdict stays until one replaces
      // it), because a 400 downgrade must outlive a catalogue that simply omits the field.
      const listed = (body && Array.isArray(body.data) ? body.data : []).map(rowName).filter(Boolean);
      for (const model of listed) {
        const row = stated.find((x) => x.underlying === model);
        for (const name of /** @type {CapName[]} */ (['audio', 'pdf'])) {
          if ((!row || !row[name]) && known[name].has(model)) remember(model, name, null);
        }
      }
      probedFor = sig;                      // only a SUCCESSFUL read stops us asking again
      changed();
      return true;
    } catch {
      return false;                          // unknown stays unknown; the next farm change retries
    } finally {
      clearTimeout(timer);
      probing = false;
    }
  }

  /** The resolver net/farm.mjs calls from `app.farm.cap()`. Synchronous, cache-only, never fetches.
   * Answers `vision`, `audio` and `pdf` (KF-2); any other name, and any model the farm has not
   * stated anything about, is 'unknown'. @param {string} underlying @param {string} name */
  function resolver(underlying, name) {
    const map = Object.prototype.hasOwnProperty.call(known, name) ? known[/** @type {CapName} */ (name)] : null;
    if (!map) return 'unknown';
    return map.get(str(underlying)) || 'unknown';
  }

  return {
    resolver,
    probe,
    primeFromStore,
    /** A 400 the engine answered with beats anything the catalogue said (§3.4.3). */
    downgrade(underlying) {
      const id = str(underlying);
      if (!id) return;
      remember(id, 'vision', 'no');
      changed();
    },
    debug: {
      probes: () => probes,
      verdicts: () => Object.fromEntries(vision),
      /** Every verdict held, by capability (K6). */
      all: () => ({
        vision: Object.fromEntries(known.vision),
        audio: Object.fromEntries(known.audio),
        pdf: Object.fromEntries(known.pdf),
      }),
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
