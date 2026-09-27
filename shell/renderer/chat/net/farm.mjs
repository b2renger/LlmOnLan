// @ts-check
// The farm, as the chat sees it: window.__lolFarm → FarmCaps, plus the model catalog. Plan §3.4,
// §3.9, §3.10. NOT pure (it fetches /models), but capsFromBridge is.
//
// `window.__lolFarm` is written by shell/renderer/app.js publishFarm() every 4 s (§2.6 H). It has
// TWO shapes and this module must survive both:
//   - the farm branch: the full FarmBridge of §3.3;
//   - the FALLBACK branch: {name:'farm', openaiBaseUrl, defaultModel:null} — no apiKey, no models,
//     no backend. It is what the renderer publishes when discovery found nothing and only the
//     sidecar's endpoint is known, and it is why a keyed farm reached that way sends no Bearer and
//     must come back as an auth error rather than a mystery (scenario p1-fallback-branch).
// …and `null`, when there is no farm at all.
//
// Two events, deliberately different (§3.9): FARM_TICK fires on EVERY publish so wall-clock rules
// ("farm silent", seat-wait give-up) have a heartbeat without any module starting its own timer;
// FARM_CHANGE fires only when a caps field actually changed, so the picker and the strip do not
// re-render four times a minute for nothing. The thread view listens to neither.

import { EV } from '../core/events.mjs';
import '../strings/net.en.mjs';

/** @typedef {import('../core/types.mjs').FarmCaps} FarmCaps */
/** @typedef {import('../core/types.mjs').FarmBridge} FarmBridge */

/** No advertised context → assume a comfortable window; §3.4 clamps the advertised one. */
const DEFAULT_BUDGET = 32768;
const MAX_BUDGET = 262144;

/** @param {any} v @returns {number|null} */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * PURE. The bridge object (or null) → the caps every component reads.
 * @param {FarmBridge|null|undefined} bridge
 * @returns {FarmCaps}
 */
export function capsFromBridge(bridge) {
  const b = /** @type {any} */ (bridge) || null;
  const baseUrl = b && typeof b.openaiBaseUrl === 'string' && b.openaiBaseUrl ? b.openaiBaseUrl : null;
  const present = !!baseUrl;
  const apiKey = (b && typeof b.apiKey === 'string' && b.apiKey) ? b.apiKey : null;
  const requiresKey = !!(b && b.requiresKey);
  const backend = (b && b.backend) || null;
  const capacity = (b && b.capacity) || null;
  const busyRaw = (b && b.busy) || null;

  const advertised = backend ? num(backend.contextPerSlot) : null;
  const tokens = Math.min(advertised == null ? DEFAULT_BUDGET : advertised, MAX_BUDGET);

  const models = b && Array.isArray(b.models)
    ? b.models
      .filter((/** @type {any} */ m) => m && typeof m.id === 'string')
      .map((/** @type {any} */ m) => ({ id: m.id, underlying: m.underlying || null, default: !!m.default }))
    : [];

  return /** @type {FarmCaps} */ ({
    present,
    id: (b && b.id) || null,
    name: (b && b.name) || null,
    baseUrl,
    // The admin surfaces (/lol/self, the panel) live one level up from the OpenAI base.
    proxyRoot: present ? String(baseUrl).replace(/\/v1\/?$/, '') : null,
    apiKey,
    requiresKey,
    keyMissing: requiresKey && !apiKey,
    healthy: !(b && b.healthy === false),
    stale: !!(b && b.stale),
    lastSeen: (b && num(b.lastSeen)) || null,
    defaultModel: (b && b.defaultModel) || null,
    models,
    engine: (backend && backend.engine) || null,
    budget: { tokens, advertised, source: advertised == null ? 'default' : 'advertised' },
    seats: capacity
      ? {
        used: num(capacity.seatsUsed) ?? 0,
        slots: num(capacity.slots) ?? 0,
        clients: num(capacity.clients) ?? 0,
        idleSec: num(capacity.seatIdleSec) ?? 900,
      }
      : null,
    busy: busyRaw && busyRaw.label ? { label: String(busyRaw.label), percent: num(busyRaw.percent) } : null,
    perf: (b && b.perf) || null,
    gpuUtil: (b && b.usage && num(b.usage.gpuUtil)) ?? null,
    search: b && b.searxngUrl ? { url: b.searxngUrl } : null,
    tts: b && b.ttsUrl ? { url: b.ttsUrl, voice: b.ttsVoice || null, model: b.ttsModel || null } : null,
    ocr: b && b.extract && b.extract.url ? { url: b.extract.url, key: b.extract.key || null } : null,
  });
}

/**
 * @param {import('../core/types.mjs').App} app
 * @returns {import('../core/types.mjs').FarmModel}
 */
export function createFarmModel(app) {
  let caps = capsFromBridge(null);
  /** @type {Record<string, string>} */
  let capsJson = snapshot(caps);
  /** @type {{key: string, result: any}|null} */ let modelCache = null;
  /** @type {Function|null} */ let capResolver = null;

  /** Per-field JSON so FARM_CHANGE can say WHICH fields moved. */
  function snapshot(c) {
    /** @type {any} */ const out = {};
    for (const k of Object.keys(/** @type {any} */ (c))) out[k] = JSON.stringify(/** @type {any} */ (c)[k]);
    return out;
  }

  function headers() {
    // Read at call time, never captured: the password can be entered or rotated between the
    // request being built and being sent.
    return caps.apiKey ? { authorization: `Bearer ${caps.apiKey}` } : {};
  }

  const api = {
    /** @param {FarmBridge|null} bridge */
    update(bridge) {
      const prev = caps;
      const next = capsFromBridge(bridge);
      const nextJson = snapshot(next);
      /** @type {string[]} */ const changed = [];
      for (const k of Object.keys(nextJson)) if (nextJson[k] !== capsJson[k]) changed.push(k);
      caps = next;
      capsJson = nextJson;
      if (changed.length) app.bus.emit(EV.FARM_CHANGE, { caps: next, prev, changed });
      app.bus.emit(EV.FARM_TICK, { caps: next, now: app.now ? app.now() : Date.now() });
    },

    get() { return caps; },
    headers,

    /**
     * §3.10: the picker's five states. A successful answer is cached per (endpoint, apiKey) — a
     * failure is not, so a farm that comes back self-heals on the next tick.
     * @param {{force?: boolean}} [o]
     */
    async fetchModels(o) {
      const force = !!(o && o.force);
      if (!caps.baseUrl) { modelCache = null; return { ids: [], state: 'no-farm' }; }
      const key = `${caps.baseUrl}|${caps.apiKey || ''}`;
      if (!force && modelCache && modelCache.key === key) return modelCache.result;
      try {
        const r = await fetch(`${caps.baseUrl}/models`, { headers: headers(), cache: 'no-store' });
        if (r.status === 400 || r.status === 401 || r.status === 403) {
          modelCache = null;
          return { ids: [], state: 'auth' };
        }
        if (!r.ok) { modelCache = null; return { ids: [], state: 'unreachable' }; }
        const j = await r.json();
        const ids = Array.isArray(j && j.data)
          ? j.data.map((/** @type {any} */ m) => m && m.id).filter((/** @type {any} */ id) => typeof id === 'string')
          : [];
        const result = { ids, state: ids.length ? 'ok' : 'no-models' };
        if (result.state === 'ok') modelCache = { key, result };
        return result;
      } catch {
        modelCache = null;
        return { ids: [], state: 'unreachable' };
      }
    },

    /** @param {string} id */
    modelInfo(id) { return caps.models.find((m) => m.id === id) || null; },

    /** P3 installs the vision probe here; until then every capability is honestly 'unknown'. */
    setCapResolver(fn) { capResolver = typeof fn === 'function' ? fn : null; },

    /** @param {string} underlying @param {string} name @returns {'yes'|'no'|'unknown'} */
    cap(underlying, name) {
      if (!capResolver) return 'unknown';
      try {
        const v = capResolver(underlying, name, caps);
        return v === 'yes' || v === 'no' ? v : 'unknown';
      } catch {
        return 'unknown';
      }
    },
  };
  return /** @type {any} */ (api);
}
