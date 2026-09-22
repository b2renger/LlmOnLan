// @ts-check
// The ask spine (S0-U2, studio plan §3.4): ONE reusable way for a panel to get a typed answer out
// of the farm. Feature module — `install(app)` publishes `app.ask` and nothing else.
//
// An ask is NOT a chat turn. It never writes to the repo, never appends a message row, never
// touches the thread view. It belongs to the panel that asked, which persists the result itself (a
// graph node, a token set, a finding list). That is the whole reason this is not
// `controller.generate` with a flag: the controller's job is the transcript, and half of these
// calls must leave no trace in it.
//
// What it is careful about, and why:
//   - ETIQUETTE. Every call goes through the SAME governor the reader's own Send uses
//     (holder `ask:<task>`), so a panel can never queue ahead of the person typing on a farm with
//     one slot. `priority:'background'` takes the governor's background lane instead, which is
//     allowed only while the farm advertises a free seat AND the foreground is idle, and which the
//     reader's next send aborts outright (net/governor.mjs). A graph run is background; a button
//     the reader just pressed is not.
//   - NEVER SILENT. `ok:false` always carries an `error` with a sentence (§1.2). A panel renders
//     that sentence with a Retry; an empty result that resolves quietly is a bug, not a state.
//   - THE LADDER (§3.4.2). schema → prompt → text, with the verdict remembered per
//     (farm, underlying) in `kv structuredMode:` so we stop paying for the discovery on every call.
//   - THE REASONING TRAP (F8). A model that put its JSON in `reasoning` and left `content` empty
//     has answered; only a reply with neither is empty.
//   - ONE REQUEST PER ANSWER where we can. When `response_format` was stripped upstream
//     (LiteLLM `drop_params`) the reply arrives as prose around a fenced object: that parses, so we
//     RETURN it as `mode:'prompt'` instead of spending a second seat asking again — and we count it
//     as a schema failure, so two of them flip the verdict to prompt mode for good.
//
// The cache is in-memory and per-window: identical (farm, model, system, prompt, images, schema)
// in, the same AskResult out, with `cached:true` added. Pass `cache:false` for anything a reader
// pressed Retry on — a Retry that replays a cached answer is a lie.

import { EV } from '../core/events.mjs';
import { KV_KEYS } from '../core/types.mjs';
import { draftFromPath, toOpenAIBody } from '../net/request.mjs';
import { startGeneration } from '../net/run.mjs';
import { t } from '../core/i18n.mjs';
import { extractJson, validate, coerce, promptFor, stableStringify, hashKey } from './json.mjs';
import '../strings/ask.en.mjs';

/** @typedef {import('../core/types.mjs').AskResult} AskResult */
/** @typedef {import('../core/types.mjs').QueueState} QueueState */

/** The floor of §3.4.1: no ask ever asks for less than this, whatever the caller passed. */
export const MIN_MAX_TOKENS = 512;
/** Two consecutive schema disappointments and we stop sending `response_format` to this model. */
export const SCHEMA_STRIKES = 2;
/** A queue item refused by the governor is retried on this many FARM_TICKs, then the batch stops. */
export const QUEUE_RETRIES = 5;
/** Default `pref:queueMax` (studio plan §3.5.4). */
export const DEFAULT_QUEUE_MAX = 4;
const LOG_CAP = 100;
const CACHE_CAP = 32;
/** The bus name a vision refusal travels on; app/caps.mjs listens and downgrades its verdict. */
export const NO_VISION_EVENT = 'caps:no-vision';
/** The bus name ui/queue.mjs renders the running batch from (studio plan §3.5.4). */
export const QUEUE_EVENT = 'ask:queue';
/**
 * The one door that stops a running batch from OUTSIDE the caller that started it. The chip in
 * ui/queue.mjs (S0-U3) owns the CANCEL_HANDLERS registration (§2.6 BB-3: one cancel door) and
 * reaches the batch by emitting this, because `app.ask.queue` is a function, not a handle anyone
 * else holds. The starter's own `cancel()` does exactly the same thing.
 */
export const QUEUE_CANCEL_EVENT = 'ask:queue:cancel';

/** @param {any} v */
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * @param {'busy'|'no_farm'|'no_vision'|'empty'|'invalid'|'aborted'|'farm'} kind
 * @param {string} message @param {{mode?: 'schema'|'prompt'|'text', raw?: string, ms?: number}} [o]
 * @returns {AskResult}
 */
function fail(kind, message, o) {
  return /** @type {any} */ ({
    ok: false,
    value: null,
    mode: (o && o.mode) || 'text',
    raw: (o && o.raw) || '',
    usage: null,
    ms: (o && o.ms) || 0,
    error: { kind, message },
  });
}

/**
 * @param {any} app
 * @returns {{api: {json: Function, text: Function, queue: Function, mode: Function, vision: Function},
 *   debug: any}}  the API is EXACTLY the five keys of API_KEYS.ask; `debug` is published separately
 *   on `window.LolChat.debug.ask` so the harness door never widens the API itself.
 */
export function createAsk(app) {
  /** kv verdicts, mirrored in memory so `mode()` can answer synchronously (§3.4.1). */
  /** @type {Map<string, 'json'|'prompt'>} */ const verdicts = new Map();
  /** @type {Set<string>} */ const priming = new Set();
  /** @type {Set<string>} */ const primed = new Set();
  /** @type {Map<string, number>} */ const strikes = new Map();
  /** @type {Map<string, {key: string, result: AskResult}>} */ const cache = new Map();
  /** @type {{task: string, mode: string, ok: boolean, ms: number, model: string|null}[]} */ const log = [];
  const totals = { calls: 0, ok: 0, failed: 0, cached: 0, ms: 0, tokens: 0, posts: 0 };

  const caps = () => (app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null);
  const repo = () => app.repo || null;

  // ---- verdict cache -------------------------------------------------------------------------

  /** @param {string} underlying @returns {string|null} */
  function verdictKey(underlying) {
    const c = caps();
    const farmId = (c && c.id) || null;
    if (!farmId || !underlying) return null;
    return KV_KEYS.structuredMode(farmId, underlying);
  }

  /**
   * Fill `verdicts` from the store, ONCE per key, ever. Fire-and-forget, so `mode()` stays
   * synchronous. "There was nothing stored" is itself an answer worth remembering — otherwise
   * every `mode()` call on a fresh farm starts another store read, forever, and this module is the
   * only writer anyway (setVerdict updates the map in the same breath).
   */
  function prime(key) {
    if (!key || verdicts.has(key) || priming.has(key) || primed.has(key)) return;
    const r = repo();
    if (!r || typeof r.kvGet !== 'function') return;
    priming.add(key);
    Promise.resolve(r.kvGet(key, null))
      .then((v) => { if (v === 'json' || v === 'prompt') verdicts.set(key, v); })
      .catch(() => { /* a memory store speaks through its own banner */ })
      .then(() => { priming.delete(key); primed.add(key); });
  }

  /** @param {string|null} key @param {'json'|'prompt'} value */
  function setVerdict(key, value) {
    if (!key || verdicts.get(key) === value) return;
    verdicts.set(key, value);
    const r = repo();
    if (r && typeof r.kvSet === 'function') Promise.resolve(r.kvSet(key, value)).catch(() => {});
  }

  /** @param {string} underlying @returns {'schema'|'prompt'|'unknown'} */
  function mode(underlying) {
    const key = verdictKey(underlying);
    if (!key) return 'unknown';
    const v = verdicts.get(key);
    if (v === 'prompt') return 'prompt';
    if (v === 'json') return 'schema';
    prime(key);
    return 'unknown';
  }

  /** @param {string} underlying @returns {'yes'|'no'|'unknown'} */
  function vision(underlying) {
    if (!app.farm || typeof app.farm.cap !== 'function' || !underlying) return 'unknown';
    const v = app.farm.cap(underlying, 'vision');
    return v === 'yes' || v === 'no' ? v : 'unknown';
  }

  // ---- one request ---------------------------------------------------------------------------

  /** @param {any} o @returns {{model: string|null, underlying: string}} */
  function resolveModel(o) {
    const c = caps() || /** @type {any} */ ({});
    const thread = o.thread || null;
    const model = str(o.model)
      || (thread && thread.modelSource === 'user' && str(thread.model) ? thread.model : '')
      || str(c.defaultModel)
      || null;
    const info = model && app.farm && typeof app.farm.modelInfo === 'function' ? app.farm.modelInfo(model) : null;
    return { model, underlying: (info && info.underlying) || model || '' };
  }

  /**
   * The wire body, through the SAME pure pipeline a chat turn uses (net/request.mjs), so an ask can
   * never grow its own idea of what a request looks like.
   * @param {{model: string|null, system: string|null, prompt: string, images: string[],
   *          maxTokens: number, responseFormat: any}} o
   */
  function buildBody(o) {
    const req = draftFromPath(
      [/** @type {any} */ ({ id: 'ask', role: 'user', content: o.prompt, status: 'done' })],
      { model: o.model, system: o.system },
    );
    if (o.images.length) {
      const blocks = req.messages[0] ? req.messages[0].blocks : null;
      if (blocks) for (const url of o.images) blocks.push(/** @type {any} */ ({ type: 'image', dataUrl: url }));
    }
    /** @type {any} */ (req).params = { max_tokens: o.maxTokens };
    /** @type {any} */ (req).responseFormat = o.responseFormat || null;
    return toOpenAIBody(req);
  }

  /**
   * One generation, governor and all. Returns the RAW outcome; the ladder above decides what it
   * means. `null` for `refusal` means the request actually went out.
   * @param {any} o
   * @returns {Promise<{refusal: AskResult|null, content: string, reasoning: string, usage: any,
   *   error: any, ms: number, model: string|null, underlying: string}>}
   */
  async function once(o) {
    const started = app.now ? app.now() : Date.now();
    const { model, underlying } = resolveModel(o);
    const c = caps();
    /** @param {AskResult} r */
    const refuse = (r) => ({ refusal: r, content: '', reasoning: '', usage: null, error: null, ms: 0, model, underlying });

    if (!c || !c.present || !c.baseUrl) return refuse(fail('no_farm', t('ask.noFarm')));
    if (c.keyMissing) return refuse(fail('no_farm', t('ask.keyMissing')));
    // Hidden means idle (§3.9): a window nobody is looking at does not spend one of the farm's
    // seats, and the queue's FARM_TICK retry is what picks the work up again when it comes back.
    if (!(app.state.visible && app.state.pageVisible)) return refuse(fail('busy', t('ask.hidden')));
    if (o.images.length && vision(underlying) === 'no') return refuse(fail('no_vision', t('ask.noVision')));
    if (o.signal && o.signal.aborted) return refuse(fail('aborted', t('ask.aborted')));

    const kind = o.priority === 'background' ? 'background' : 'foreground';
    if (!app.gov || typeof app.gov.acquire !== 'function') return refuse(fail('busy', t('ask.busy')));
    if (!app.gov.canStart(kind)) return refuse(fail('busy', t('ask.busy')));

    /** @type {any} */ let generation = null;
    let abortedBySignal = false;
    /**
     * An abort can arrive BEFORE `startGeneration` has returned: the governor's background lane is
     * cut the instant the reader presses Send, and that can happen inside our own fetch call, one
     * frame before `generation` is assigned. Remember the reason and apply it the moment we can.
     * @type {string|null}
     */
    let pending = null;
    /** @param {string} reason */
    const stop = (reason) => { if (generation) generation.abort(reason); else pending = reason; };

    const release = app.gov.acquire(kind, { holder: `ask:${o.task}`, abort: () => stop('observer') });
    if (!release) return refuse(fail('busy', t('ask.busy')));

    const onAbort = () => { abortedBySignal = true; stop('user'); };
    if (o.signal) o.signal.addEventListener('abort', onAbort, { once: true });

    try {
      totals.posts++;
      generation = startGeneration({
        url: `${c.baseUrl}/chat/completions`,
        headers: { 'content-type': 'application/json', ...((app.farm.headers && app.farm.headers()) || {}) },
        body: buildBody({
          model, system: o.system, prompt: o.prompt, images: o.images,
          maxTokens: o.maxTokens, responseFormat: o.responseFormat,
        }),
        requiresKey: !!c.requiresKey,
      });
      if (pending) generation.abort(pending);
      const result = await generation.done;
      const ms = Math.round((app.now ? app.now() : Date.now()) - started);
      if (result.status === 'aborted' || abortedBySignal) {
        return { refusal: fail('aborted', t('ask.aborted'), { ms }), content: '', reasoning: '', usage: null, error: null, ms, model, underlying };
      }
      return {
        refusal: null,
        content: str(result.content),
        reasoning: str(result.reasoning),
        usage: result.usage || null,
        error: result.error || null,
        ms,
        model,
        underlying,
      };
    } finally {
      if (o.signal) o.signal.removeEventListener('abort', onAbort);
      release();
    }
  }

  // ---- the ladder ------------------------------------------------------------------------------

  /** @param {any} o @returns {any} */
  function normalise(o) {
    const opts = o || {};
    const images = Array.isArray(opts.images) ? opts.images.filter((/** @type {any} */ u) => typeof u === 'string' && u) : [];
    return {
      task: str(opts.task) || 'ask',
      schema: opts.schema || null,
      example: opts.example,
      prompt: str(opts.prompt),
      system: opts.system === null || opts.system === undefined ? null : str(opts.system),
      images,
      model: opts.model || null,
      thread: opts.thread || null,
      maxTokens: Number(opts.maxTokens) || 0,
      holder: str(opts.holder) || null,
      signal: opts.signal || null,
      priority: opts.priority === 'background' ? 'background' : 'foreground',
      cache: opts.cache !== false,
      // C2 kickoff (§2.6 BH-5): a caller that MEANS to ask the same question twice — the four
      // variants of a Repeat fan-out — says so with a salt. It changes the cache key and nothing
      // else: same prompt, same model, same governor lane, a second real generation.
      cacheSalt: opts.cacheSalt === undefined || opts.cacheSalt === null ? null : String(opts.cacheSalt),
    };
  }

  /**
   * §3.4.1: `max_tokens = max(512, 4 × the expected JSON size estimate)`. The estimate is the
   * schema's own serialised length: an instance of a schema is the same order of magnitude as the
   * schema text, ~4 characters make a token, so 4 × (chars/4) is that length in tokens. A caller
   * may raise this; nobody may go under the floor.
   * @param {any} schema @param {number} asked
   */
  function maxTokensFor(schema, asked) {
    const estimate = schema ? stableStringify(schema).length : 0;
    return Math.max(MIN_MAX_TOKENS, estimate, asked || 0);
  }

  /** @param {any} o @param {string} lane @returns {string} */
  function cacheKey(o, lane) {
    const c = caps();
    return stableStringify({
      farm: (c && c.id) || null,
      base: (c && c.baseUrl) || null,
      model: o.model,
      thread: o.thread ? o.thread.model || null : null,
      lane,
      system: o.system,
      prompt: o.prompt,
      images: o.images.map((/** @type {string} */ u) => `${u.length}:${hashKey(u)}`),
      schema: o.schema ? stableStringify(o.schema) : null,
      maxTokens: o.maxTokens,
      salt: o.cacheSalt || null,
    });
  }

  /** @param {string} key @returns {AskResult|null} */
  function cacheGet(key) {
    const hit = cache.get(hashKey(key));
    return hit && hit.key === key ? hit.result : null;
  }

  /** @param {string} key @param {AskResult} result */
  function cachePut(key, result) {
    cache.set(hashKey(key), { key, result });
    while (cache.size > CACHE_CAP) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  /** @param {string} task @param {AskResult} r @param {string|null} model */
  function record(task, r, model) {
    log.push({ task, mode: r.mode, ok: !!r.ok, ms: r.ms, model: model || null });
    while (log.length > LOG_CAP) log.shift();
    totals.calls++;
    if (r.ok) totals.ok++; else totals.failed++;
    if (/** @type {any} */ (r).cached) totals.cached++;
    totals.ms += r.ms || 0;
    const usage = /** @type {any} */ (r).usage;
    if (usage && Number(usage.total_tokens)) totals.tokens += Number(usage.total_tokens);
    return r;
  }

  /**
   * A farm-level failure that a panel must be able to READ, plus the one farm error that is really
   * a capability verdict: a 400 about images downgrades this model's vision cap for good.
   * @param {any} error @param {string} underlying @param {number} ms
   */
  function farmFailure(error, underlying, ms) {
    if (error && error.kind === 'vision_unsupported') {
      app.bus.emit(NO_VISION_EVENT, { underlying, farmId: (caps() || {}).id || null });
      return fail('no_vision', t('ask.noVision'), { ms });
    }
    return fail('farm', t('ask.farmError', { message: str(error && error.message) }), { ms });
  }

  /** @param {string} content @param {string} reasoning */
  const rawOf = (content, reasoning) => (content.trim() ? content : reasoning);

  /**
   * @param {any} o @param {'schema'|'prompt'} lane
   * @returns {Promise<{result: AskResult, degraded: boolean, hard: boolean}>}
   *   `degraded`  the schema rode out but the answer came back wrapped in prose — the proxy or the
   *               engine dropped `response_format`, and two of those flip the verdict.
   *   `hard`      nothing usable at all; the caller may try the next rung.
   */
  async function attempt(o, lane) {
    const useSchema = lane === 'schema';
    const system = useSchema
      ? o.system
      : [o.system, promptFor(o.schema, { example: o.example })].filter(Boolean).join('\n\n');
    const responseFormat = useSchema
      ? { type: 'json_schema', json_schema: { name: o.task.replace(/[^a-zA-Z0-9_-]/g, '_') || 'answer', strict: true, schema: o.schema } }
      : null;

    const out = await once({ ...o, system, responseFormat });
    if (out.refusal) return { result: out.refusal, degraded: false, hard: false };
    if (out.error) return { result: farmFailure(out.error, out.underlying, out.ms), degraded: false, hard: false };

    const raw = rawOf(out.content, out.reasoning);
    if (!raw.trim()) {
      return { result: fail('empty', t('ask.empty'), { mode: lane, raw: '', ms: out.ms }), degraded: false, hard: true };
    }

    const found = extractJson(raw);
    if (!found.ok) {
      return { result: fail('invalid', t('ask.invalid'), { mode: lane, raw, ms: out.ms }), degraded: useSchema, hard: true };
    }

    const value = coerce(found.value, o.schema);
    const verdict = validate(value, o.schema);
    if (!verdict.ok) {
      const bad = fail('invalid', t('ask.invalid'), { mode: lane, raw, ms: out.ms });
      /** @type {any} */ (bad).errors = verdict.errors;
      return { result: bad, degraded: useSchema, hard: true };
    }

    // The schema lane answering in prose means the format never reached the engine. The ANSWER is
    // fine, so we keep it (one seat, one answer) and report the mode we actually got.
    const degraded = useSchema && found.how !== 'body';
    return {
      result: /** @type {any} */ ({
        ok: true,
        value,
        mode: degraded ? 'prompt' : lane,
        raw,
        usage: out.usage,
        ms: out.ms,
        error: null,
      }),
      degraded,
      hard: false,
    };
  }

  /** @param {any} opts @returns {Promise<AskResult>} */
  async function json(opts) {
    const o = normalise(opts);
    if (!o.schema) return record(o.task, fail('invalid', t('ask.invalid')), null);
    o.maxTokens = maxTokensFor(o.schema, o.maxTokens);

    const { model: resolved, underlying } = resolveModel(o);
    const key = o.cache ? cacheKey(o, 'json') : '';
    if (key) {
      const hit = cacheGet(key);
      if (hit) return record(o.task, /** @type {any} */ ({ ...hit, cached: true }), resolved);
    }

    const vKey = verdictKey(underlying);
    if (vKey) prime(vKey);
    const start = mode(underlying) === 'prompt' ? 'prompt' : 'schema';

    let out = await attempt(o, start);
    if (start === 'schema' && vKey) {
      // An EMPTY reply says nothing about response_format, so it never moves the verdict: only a
      // reply that came back unparseable, or wrapped in prose, is evidence the schema did not ride.
      const evidence = out.degraded || (out.hard && out.result.error && out.result.error.kind === 'invalid');
      if (out.result.ok && !out.degraded) {
        strikes.set(vKey, 0);
        setVerdict(vKey, 'json');
      } else if (evidence) {
        const n = (strikes.get(vKey) || 0) + 1;
        strikes.set(vKey, n);
        if (n >= SCHEMA_STRIKES) setVerdict(vKey, 'prompt');
      }
    }
    // A hard failure earns the second rung; a degraded-but-valid answer does not need one.
    if (start === 'schema' && !out.result.ok && out.hard) out = await attempt(o, 'prompt');

    // Rung three (§3.4.2): both structured attempts failed, so the honest answer is "here is the
    // text, it is not what you asked for". The panel renders it with a Retry — never nothing.
    if (!out.result.ok && out.hard) out.result = /** @type {any} */ ({ ...out.result, mode: 'text' });

    if (out.result.ok && key) cachePut(key, out.result);
    return record(o.task, out.result, resolved);
  }

  /** @param {any} opts @returns {Promise<AskResult>} */
  async function text(opts) {
    const o = normalise(opts);
    o.schema = null;
    o.maxTokens = Math.max(MIN_MAX_TOKENS, o.maxTokens || 0);

    const key = o.cache ? cacheKey(o, 'text') : '';
    if (key) {
      const hit = cacheGet(key);
      if (hit) return record(o.task, /** @type {any} */ ({ ...hit, cached: true }), resolveModel(o).model);
    }

    const out = await once({ ...o, system: o.system, responseFormat: null });
    if (out.refusal) return record(o.task, out.refusal, out.model);
    if (out.error) return record(o.task, farmFailure(out.error, out.underlying, out.ms), out.model);

    const raw = rawOf(out.content, out.reasoning);
    if (!raw.trim()) return record(o.task, fail('empty', t('ask.empty'), { mode: 'text', ms: out.ms }), out.model);

    const result = /** @type {AskResult} */ ({
      ok: true, value: raw, mode: 'text', raw, usage: out.usage, ms: out.ms, error: null,
    });
    if (key) cachePut(key, result);
    return record(o.task, result, out.model);
  }

  // ---- the batch queue -------------------------------------------------------------------------

  /**
   * The batch is per-window and serial, so its state is module-level — but a HANDLE is not: a
   * finished batch's `cancel()` used to kill the NEXT batch, and its `state()` used to report the
   * next batch's progress as its own (S0 review, finding 4). Every batch gets an EPOCH; a handle
   * carries the epoch it was minted for and both of its methods compare before acting. A stale
   * cancel() is a no-op; a stale state() answers with the frozen final state of ITS batch.
   */
  /** @type {{label: string, i: number, n: number, running: boolean, cancelled: boolean, truncated: number}} */
  let qState = { label: '', i: 0, n: 0, running: false, cancelled: false, truncated: 0 };
  /** @type {AbortController|null} */ let qAbort = null;
  let qEpoch = 0;

  const queueState = () => ({ ...qState });

  /** @param {number} epoch @param {{state: any}} frozen */
  const handleState = (epoch, frozen) => () => (epoch === qEpoch ? { ...qState } : { ...frozen.state });

  /** @param {string} phase */
  function emitQueue(phase) {
    app.bus.emit(QUEUE_EVENT, { ...qState, phase });
  }

  /** One FARM_TICK, or the batch being cancelled — whichever comes first. No timers (§3.9). */
  function nextTick() {
    return new Promise((resolve) => {
      /** @type {Function[]} */ const offs = [];
      const done = () => { for (const off of offs) off(); resolve(undefined); };
      offs.push(app.bus.on(EV.FARM_TICK, done));
      offs.push(app.bus.on(QUEUE_EVENT, () => { if (qState.cancelled) done(); }));
      if (qState.cancelled) done();
    });
  }

  /** @param {any} res */
  const refusedByGovernor = (res) => !!(res && res.ok === false && res.error && res.error.kind === 'busy');

  /**
   * @param {{label?: string, items?: any[], run?: Function, onProgress?: Function, max?: number}} opts
   * @returns {{promise: Promise<{done: number, results: any[], cancelled: boolean, refused?: boolean, stalled?: boolean}>,
   *   cancel: () => void, state: () => QueueState}}
   */
  function queue(opts) {
    const o = opts || {};
    const items = Array.isArray(o.items) ? o.items.slice() : [];
    const label = str(o.label);
    const run = typeof o.run === 'function' ? o.run : null;

    // One batch at a time, per window (§3.4.1). A second caller is told so; it is never silently
    // interleaved, because two batches on a one-slot farm is just a slower single batch.
    if (qState.running || !run) {
      const refusedState = { label, i: 0, n: items.length, running: false, cancelled: true, truncated: 0 };
      return {
        promise: Promise.resolve({ done: 0, results: [], cancelled: true, refused: true, truncated: 0 }),
        cancel: () => {},
        state: () => ({ ...refusedState }),
      };
    }

    const ac = new AbortController();
    qAbort = ac;
    const epoch = ++qEpoch;
    /** The last state THIS batch ever had, handed to a stale handle instead of the next batch's. */
    const frozen = { state: { label, i: 0, n: items.length, running: true, cancelled: false, truncated: 0 } };
    qState = { ...frozen.state };

    const promise = (async () => {
      /** @type {any[]} */ const results = [];
      let stalled = false;
      try {
        // The cap. `pref:queueMax` is the READER's ceiling for the batches the app starts on its
        // own; a caller that knows how many items it means to run (C2's Computer, whose own cap is
        // `pref:computeMaxItems`) passes `max` and is capped by THAT instead — the preference is a
        // default, not a silent ceiling on someone else's explicit number (§2.6 BH-5).
        let max = DEFAULT_QUEUE_MAX;
        if (Number(o.max) > 0) {
          max = Math.floor(Number(o.max));
        } else {
          const r = repo();
          if (r && typeof r.kvGet === 'function') {
            try {
              const v = await r.kvGet(KV_KEYS.prefQueueMax, DEFAULT_QUEUE_MAX);
              if (Number(v) > 0) max = Math.floor(Number(v));
            } catch { /* the store speaks through its own banner */ }
          }
        }
        // A cap the caller cannot see is a silent loss (S0 review, finding 6): `truncated` says how
        // many items never ran, and rides in the QueueState, the bus event and the result.
        const list = items.slice(0, max);
        qState.n = list.length;
        qState.truncated = items.length - list.length;
        emitQueue('start');

        for (let i = 0; i < list.length; i++) {
          if (qState.cancelled) break;
          qState.i = i;
          emitQueue('progress');
          let attempts = 0;
          for (;;) {
            if (qState.cancelled) break;
            let res;
            try {
              res = await run(list[i], i, ac.signal);
            } catch (err) {
              res = fail('farm', t('ask.farmError', { message: str(err && /** @type {any} */ (err).message) }));
            }
            if (refusedByGovernor(res) && !qState.cancelled) {
              if (attempts >= QUEUE_RETRIES) { stalled = true; break; }
              attempts++;
              await nextTick();                 // the farm snapshot is the only clock
              continue;
            }
            results.push(res);
            break;
          }
          if (stalled) break;
          qState.i = i + 1;
          if (typeof o.onProgress === 'function') {
            try { o.onProgress({ ...qState }, results[results.length - 1]); } catch (err) { console.error('[lolchat] queue onProgress threw', err); }
          }
          emitQueue('progress');
        }
        return { done: results.length, results, cancelled: qState.cancelled, stalled, truncated: qState.truncated };
      } finally {
        qState = { ...qState, running: false };
        frozen.state = { ...qState };
        qAbort = null;
        emitQueue('end');
      }
    })();

    return {
      promise,
      cancel: () => { if (epoch === qEpoch) cancelCurrent(); },
      state: handleState(epoch, frozen),
    };
  }

  /** Stop the running batch: the starter's own cancel(), and the QUEUE_CANCEL_EVENT door. */
  function cancelCurrent() {
    if (!qState.running || qState.cancelled) return;
    qState.cancelled = true;
    if (qAbort) { try { qAbort.abort(); } catch { /* already gone */ } }
    emitQueue('cancel');
  }
  app.bus.on(QUEUE_CANCEL_EVENT, cancelCurrent);

  /** The harness door (BD-9): `window.LolChat.debug.ask.log()`. */
  const debug = {
    log: () => log.map((e) => ({ ...e })),
    stats: () => ({ ...totals }),
    queue: queueState,
    cancelQueue: () => { cancelCurrent(); return queueState(); },
    verdicts: () => Object.fromEntries(verdicts),
    cacheSize: () => cache.size,
    clearCache: () => { cache.clear(); return true; },
  };

  return { api: { json, text, queue, mode, vision }, debug };
}

/** @param {any} app */
export function install(app) {
  const { api, debug } = createAsk(app);
  app.ask = api;

  // `app.LolChat` is not reachable from here: the debug bag main.mjs published is the door (BD-9).
  //
  // K1 (COMPUTER_PLAN §2.3): there are now TWO surfaces and each installs its OWN ask, so that
  // `ask` reads its own app's `state.visible`. Publish into the bag of the surface that owns THIS
  // app — matched by identity, not by name — or the Computer's install silently replaces the
  // chat's door with an empty log (it did: c1-run-three-parts and s0-ask-schema both went to
  // "the ask spine saw one call: got 0" the moment the third surface mounted).
  const g = typeof window !== 'undefined'
    ? ((window.LolComputer && window.LolComputer.app === app) ? window.LolComputer : window.LolChat)
    : null;
  const bag = g ? g.debug : null;
  if (bag) bag.ask = debug;

  return api;
}
