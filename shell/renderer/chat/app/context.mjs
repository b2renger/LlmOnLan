// @ts-check
// The context budget, wired into the send pipeline (VISION F24–F27) — a FEATURE: it exports
// install(app), which main.mjs calls after every component exists (plan §2.6 AA).
//
// What it installs, and nothing else:
//   REQUEST_TRANSFORMS 'budget-trim' (order 800)  the LAST transform: it sees the final system
//                                                 prompt, every systemAppend, the resolved
//                                                 max_tokens and the allowances, so it is the only
//                                                 place where "does this fit" is a real question.
//   BEFORE_SEND 'cost-gate' (stage 'gate', 100)   above the threshold Send says what it costs and
//                                                 needs a second click; over the window it refuses.
//   STREAM_OBSERVERS 'context-calibrate'          every reply teaches the estimator (usage) and the
//                                                 cost gate (prompt tokens per second).
//   MESSAGE_ACTIONS 'pin' / 'unpin'               a pinned message is never trimmed.
//   SETTINGS_SECTIONS 'context'                   the gate threshold (kv `pref:gateThreshold`).
//   the meter in composer.region('meter')         the live picture of all of the above.
//
// Two facts this module is built around, both frozen at the P2 kickoff:
//   - §2.6 AM: controller.preview() already emits REQUEST_PREVIEW, so 'budget-trim' emits it only
//     for a REAL send. The meter therefore updates exactly once per preview and once per send.
//   - §2.6 AF: the composer's unlock() restores the pre-"Preparing…" Send label in its `finally`,
//     AFTER a gate's `null` has propagated. A label set synchronously (or in a microtask) is
//     overwritten on exactly the slow submits that need it — so the gate's label goes through
//     setTimeout(…, 0).

import { EV } from '../core/events.mjs';
import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { hash } from '../core/ids.mjs';
import { KV_KEYS } from '../core/types.mjs';
import { calibrate, estimateMessage, promptChars, DEFAULT_RATIO } from '../ctx/tokens.mjs';
import { trustedBudget, reserveFor, planTrim, gateVerdict, DEFAULT_GATE_THRESHOLD } from '../ctx/budget.mjs';
import { createMeter } from '../ui/meter.mjs';
import '../strings/context.en.mjs';
import '../strings/core.en.mjs';

/** Plan §3.6.3: the last transform in the chain. */
const TRIM_ORDER = 800;
/** Cheap, no network, runs before every other gate. */
const GATE_ORDER = 100;
/** How long a confirmed cost stays armed (plan §4 P2-U2). */
const ARM_MS = 10000;
/** The preview recompute is an INPUT debounce, not a wall-clock rule (§2.6 AK): setTimeout is fine. */
const PREVIEW_DEBOUNCE_MS = 250;
/**
 * Caps fields that change what the meter and the gate would SAY, and so are worth a full preview
 * (a thread read, a path read, the whole transform chain and a token estimate per message).
 *
 * `perf` is deliberately NOT one of them: it feeds only the gate's optional "about N seconds"
 * figure, which `rateNow()` reads live at submit time and which the meter never renders. On a
 * shared farm `perf.lastGenTokSec` moves whenever ANYONE on the box finishes a generation, so an
 * idle reader with a long thread open paid a full preview per stranger's reply (P2 review).
 */
const BUDGET_FIELDS = ['budget', 'engine', 'present', 'baseUrl', 'defaultModel', 'models'];
/** EMA weight for the prompt-tokens-per-second estimate. */
const RATE_ALPHA = 0.3;

// Lucide "pin" / "pin-off".
const PIN_ICON = 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';
const UNPIN_ICON = ['M12 17v5', 'M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89', 'M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11', 'M2 2l20 20'];

/** @param {any} v @param {number} dflt */
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

/**
 * A change signature for the armed draft. Deliberately NOT the composer's private fingerprint
 * formula: the arm/disarm comparison only has to be consistent with ITSELF, and the composer's
 * fingerprint (which the gate DOES compare on the second submit) is handed to us by the composer.
 * @param {any} draft
 */
function draftSignature(draft) {
  const d = draft || {};
  const parts = (Array.isArray(d.parts) ? d.parts : [])
    .map((/** @type {any} */ p) => `${p && p.type}:${(p && p.attId) || ''}`)
    .join('|');
  return hash([d.text || '', parts, d.model || '', d.recipeId || ''].join('\u0000'));
}

/** @param {any} app */
export function install(app) {
  /** @type {Map<string, number>} */
  const ratios = new Map();
  /** @type {{fingerprint: string, sig: string, at: number}|null} */
  let armed = null;
  /** @type {{chars: number, model: string|null, underlying: string|null}|null} */
  let lastSent = null;
  let threshold = DEFAULT_GATE_THRESHOLD;
  /** @type {number|null} */
  let promptTokSec = null;
  /** @type {any} */
  let debounceTimer = null;
  let previewSeq = 0;
  /** Every Send label this module has written, so it only ever takes back its own. */
  const myLabels = new Set();

  const repo = () => app.repo;
  const caps = () => {
    try { return app.farm ? app.farm.get() : null; } catch { return null; }
  };

  const meter = createMeter(app);

  /** Fire-and-forget kv write: nothing in this module is worth failing a reply over. */
  const write = (/** @type {string} */ key, /** @type {any} */ value) => {
    if (!repo()) return;
    Promise.resolve(repo().kvSet(key, value)).catch((err) => console.warn(`[lolchat] kv ${key} write failed`, err));
  };

  // ------------------------------------------------------------------ kv (ratios, rate, threshold)

  /** @param {string|null} model @returns {string|null} */
  function underlyingOf(model) {
    if (!model) return null;
    try {
      const info = app.farm && app.farm.modelInfo ? app.farm.modelInfo(model) : null;
      if (info && info.underlying) return info.underlying;
    } catch { /* no farm model yet */ }
    return model;
  }

  /** @param {string|null} underlying @returns {Promise<number>} */
  async function ratioFor(underlying) {
    const key = underlying || '';
    if (!key) return DEFAULT_RATIO;
    if (ratios.has(key)) return /** @type {number} */ (ratios.get(key));
    let value = DEFAULT_RATIO;
    try {
      const stored = repo() ? await repo().kvGet(KV_KEYS.tokRatio(key), null) : null;
      if (num(stored, 0) > 0) value = Number(stored);
    } catch (err) {
      console.warn('[lolchat] token ratio read failed', err);
    }
    ratios.set(key, value);
    return value;
  }

  async function loadPrefs() {
    if (!repo()) return;
    try {
      const stored = await repo().kvGet(KV_KEYS.prefGateThreshold, null);
      if (num(stored, 0) > 0) threshold = Number(stored);
    } catch (err) {
      console.warn('[lolchat] gate threshold read failed', err);
    }
    await loadRate();
  }

  async function loadRate() {
    const id = (caps() || {}).id;
    if (!id || !repo()) return;
    try {
      const stored = await repo().kvGet(KV_KEYS.promptTokSec(id), null);
      promptTokSec = num(stored, 0) > 0 ? Number(stored) : null;
    } catch (err) {
      console.warn('[lolchat] prompt rate read failed', err);
    }
  }

  /** `perf.lastPromptTokSec` first (the farm measured it), then our own EMA, then nothing. */
  function rateNow() {
    const perf = (caps() || {}).perf || null;
    const advertised = perf ? num(perf.lastPromptTokSec, 0) : 0;
    if (advertised > 0) return advertised;
    return num(promptTokSec, 0) > 0 ? /** @type {number} */ (promptTokSec) : null;
  }

  // ------------------------------------------------------------------------- the trim transform

  app.registry.add(SLOTS.REQUEST_TRANSFORMS, {
    id: 'budget-trim',
    order: TRIM_ORDER,
    /** @param {any} req @param {any} ctx */
    async apply(req, ctx) {
      const c = (ctx && ctx.caps) || caps();
      const model = req.model || (c && c.defaultModel) || null;
      const underlying = underlyingOf(model);
      const ratio = await ratioFor(underlying);
      const budget = num(req.meta && req.meta.budget, 0) > 0 ? Number(req.meta.budget) : trustedBudget(c);
      const reserve = reserveFor(req.params);
      const plan = planTrim(req, {
        budget,
        reserve,
        estimate: (/** @type {any} */ entry) => estimateMessage(entry, ratio),
      });

      if (plan.droppedIds.length) {
        const drop = new Set(plan.droppedIds);
        req.messages = req.messages.filter((/** @type {any} */ m) => !(m && m.msgId != null && drop.has(m.msgId)));
      }

      req.meta.budget = budget;
      req.meta.estimate = plan.total;
      req.meta.trimmedIds = plan.droppedIds;
      req.meta.newTurnEstimate = plan.newTurn;
      // Additive meta the meter and the gate read back (the §3.3 shape keeps its five fields).
      req.meta.reserve = reserve;
      req.meta.over = plan.over;
      req.meta.ratio = ratio;

      if (!ctx || ctx.preview !== true) {
        // A REAL send: remember what we put on the wire so the reply's usage can calibrate, and
        // publish the numbers ourselves — controller.preview() is the only other emitter (§2.6 AM).
        lastSent = { chars: promptChars(req), model, underlying };
        app.bus.emit(EV.REQUEST_PREVIEW, { request: req });
      }
    },
  });

  // ------------------------------------------------------------------------------ the cost gate

  /** @param {any} req @returns {{kind: 'ok'|'confirm'|'block', seconds: number|null}} */
  function verdictFor(req) {
    const meta = (req && req.meta) || {};
    const budget = num(meta.budget, 0) > 0 ? Number(meta.budget) : trustedBudget(caps());
    const reserve = Number.isFinite(meta.reserve) ? Number(meta.reserve) : reserveFor(req && req.params);
    return gateVerdict({
      total: num(meta.estimate, 0),
      newTurn: num(meta.newTurnEstimate, 0),
      budget,
      reserve,
      threshold,
      promptTokSec: rateNow(),
    });
  }

  /** @param {any} req @param {{seconds: number|null}} verdict */
  function costLabel(req, verdict) {
    const tokens = Math.round(num(req && req.meta && req.meta.estimate, 0));
    return verdict.seconds
      ? t('context.sendCostSeconds', { tokens, seconds: verdict.seconds })
      : t('context.sendCost', { tokens });
  }

  /** @param {string} label @param {boolean} isArmed */
  function setSendLabel(label, isArmed) {
    if (!app.composer) return;
    myLabels.add(label);
    try { app.composer.setSendState({ label, armed: isArmed }); } catch (err) { console.warn('[lolchat] send label', err); }
  }

  /**
   * Put the resting label back — but ONLY if the button is still wearing one of OURS. Other
   * features borrow the same button (a seat wait, a recipe run), and the composer itself swaps in
   * "Preparing…" while it is locked; stamping `core.send` over any of those would be a lie.
   */
  function restoreSendLabel() {
    if (!app.composer || !app.els || !app.els.send) return;
    if (!myLabels.has(app.els.send.textContent || '')) return;
    try { app.composer.setSendState({ label: t('core.send'), armed: false }); } catch (err) { console.warn('[lolchat] send label', err); }
  }

  function disarm() {
    armed = null;
    restoreSendLabel();
  }

  app.registry.add(SLOTS.BEFORE_SEND, {
    id: 'cost-gate',
    order: GATE_ORDER,
    stage: 'gate',
    /** @param {any} draft @param {any} _app @param {{fingerprint: string}} info */
    async run(draft, _app, info) {
      const fingerprint = (info && info.fingerprint) || '';
      if (armed && armed.fingerprint === fingerprint && app.now() - armed.at <= ARM_MS) {
        armed = null;                                   // the second click: send it, label restored
        setTimeout(restoreSendLabel, 0);
        return draft;
      }
      if (!app.controller || typeof app.controller.preview !== 'function') return draft;

      let req = null;
      try {
        req = await app.controller.preview({ draft });
      } catch (err) {
        console.warn('[lolchat] cost gate preview failed', err);
        return draft;                                    // never block a send because we cannot count
      }
      const verdict = verdictFor(req);
      if (verdict.kind === 'ok') {
        armed = null;
        return draft;
      }

      const blocked = verdict.kind === 'block';
      armed = blocked ? null : { fingerprint, sig: draftSignature(draft), at: app.now() };
      const label = blocked ? t('context.tooLong') : costLabel(req, verdict);
      // §2.6 AF: a macrotask, because unlock() restores the label after this null propagates.
      setTimeout(() => {
        setSendLabel(label, !blocked);
        if (blocked) meter.open();
      }, 0);
      return null;
    },
  });

  // ------------------------------------------------------------------------------- calibration

  app.registry.add(SLOTS.STREAM_OBSERVERS, {
    id: 'context-calibrate',
    /** @param {any} msg @param {any} result */
    onDone(msg, result) {
      // Deliberately NOT returned: the controller AWAITS every onDone before it finalizes the
      // message and repaints the row, and two kv writes have no business sitting between the last
      // token and the finished reply. The in-memory ratio is updated synchronously, so the next
      // estimate already uses it whether or not the write has landed.
      calibrateFrom(msg, result);
    },
  });

  /** @param {any} msg @param {any} result */
  function calibrateFrom(msg, result) {
    const sent = lastSent;
    lastSent = null;
    const usage = (result && result.usage) || null;
    const promptTokens = usage ? num(usage.prompt_tokens, 0) : 0;
    if (promptTokens > 0) {
      const underlying = (msg && msg.underlying) || (sent && sent.underlying) || null;
      const chars = sent ? sent.chars : 0;
      if (underlying && chars > 0) {
        const next = calibrate(ratios.get(underlying) ?? DEFAULT_RATIO, chars, promptTokens);
        ratios.set(underlying, next);
        write(KV_KEYS.tokRatio(underlying), next);
      }
      // The gate's "seconds" is PREFILL time: prompt tokens over the time to the first token.
      const ttftMs = num(result && result.ttftMs, 0);
      const farmId = (caps() || {}).id;
      if (farmId && ttftMs > 0) {
        const observed = promptTokens / (ttftMs / 1000);
        const next = num(promptTokSec, 0) > 0
          ? /** @type {number} */ (promptTokSec) * (1 - RATE_ALPHA) + observed * RATE_ALPHA
          : observed;
        promptTokSec = next;
        write(KV_KEYS.promptTokSec(farmId), next);
      }
    }
    schedulePreview(0);
  }

  // ------------------------------------------------------------------------------ pin / unpin

  /** @param {any} msg @param {boolean} pinned */
  async function setPinned(msg, pinned) {
    if (!msg || !repo()) return;
    const next = { ...msg, pinned, updatedAt: app.now() };
    try {
      await repo().putMessage(next);
    } catch (err) {
      console.warn('[lolchat] pin write failed', err);
      return;
    }
    if (app.view && typeof app.view.upsert === 'function') app.view.upsert(next);
    schedulePreview(0);
  }

  app.registry.add(SLOTS.MESSAGE_ACTIONS, {
    id: 'pin',
    order: 300,
    icon: PIN_ICON,
    label: t('context.pin'),
    visible: (/** @type {any} */ msg) => !!msg && !msg.pinned && msg.status !== 'streaming' && msg.status !== 'waiting',
    run: (/** @type {any} */ msg) => setPinned(msg, true),
  });
  app.registry.add(SLOTS.MESSAGE_ACTIONS, {
    id: 'unpin',
    order: 300,
    icon: UNPIN_ICON,
    label: t('context.unpin'),
    visible: (/** @type {any} */ msg) => !!(msg && msg.pinned),
    run: (/** @type {any} */ msg) => setPinned(msg, false),
  });

  // ------------------------------------------------------------------------ the live recompute

  /** @param {number} [delay] */
  function schedulePreview(delay) {
    const ms = delay === undefined ? PREVIEW_DEBOUNCE_MS : delay;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void recompute();
    }, ms);
  }

  async function recompute() {
    if (!app.controller || typeof app.controller.preview !== 'function') return;
    const c = caps();
    meter.setCaps(c);
    if (!c || !c.present) {
      // No farm, no budget, nothing outside it: a row left dimmed would claim a trim that is not
      // happening any more.
      previewSeq++;
      if (app.view && typeof app.view.setOutsideContext === 'function') app.view.setOutsideContext(new Set());
      return;
    }
    const seq = ++previewSeq;
    let req = null;
    try {
      const draft = app.composer && typeof app.composer.getDraft === 'function' ? app.composer.getDraft() : null;
      // An EMPTY composer is not a message: passing it anyway made the meter charge the 4-token
      // role envelope of a message nobody is about to send ("~4 / 16.4k" on an empty chat).
      const writing = !!(draft && (draft.text || (Array.isArray(draft.parts) && draft.parts.length)));
      req = await app.controller.preview(writing ? { draft } : {});
    } catch (err) {
      console.warn('[lolchat] context preview failed', err);
      return;
    }
    if (seq !== previewSeq) return;                     // a newer recompute already ran
    if (app.view && typeof app.view.setOutsideContext === 'function') {
      app.view.setOutsideContext(new Set((req.meta && req.meta.trimmedIds) || []));
    }
  }

  // ----------------------------------------------------------------------------------- the bus

  app.bus.on(EV.REQUEST_PREVIEW, (/** @type {any} */ p) => {
    if (p && p.request) meter.update(p.request);
  });

  app.bus.on(EV.DRAFT_CHANGE, (/** @type {any} */ draft) => {
    if (armed && draftSignature(draft) !== armed.sig) armed = null;
    // Not only when it was armed: a BLOCKED send leaves "Too long for this farm" on the button, and
    // shortening the message has to take it back off.
    if (!armed) restoreSendLabel();
    schedulePreview();
  });

  app.bus.on(EV.THREAD_SELECTED, () => {
    disarm();
    schedulePreview(0);
  });

  app.bus.on(EV.STREAM_END, () => {
    // The composer's unlock() restores the label it captured before "Preparing…" appeared, which on
    // the second click of an armed send is the COST label. By STREAM_END it has unlocked, so this is
    // where the button goes back to "Send".
    restoreSendLabel();
    // And the calibration sample dies with the generation it belonged to. onDone consumes it on the
    // happy path, but a pipeline that THREW never runs the observers (controller's own catch still
    // emits STREAM_END) — and a surviving `lastSent` then calibrated the NEXT reply's usage against
    // the PREVIOUS request's character count, writing a wrong tokRatio (P2 review).
    lastSent = null;
    schedulePreview(0);
  });

  app.bus.on(EV.FARM_CHANGE, (/** @type {any} */ p) => {
    const changed = (p && Array.isArray(p.changed) ? p.changed : []);
    meter.setCaps(caps());
    if (changed.includes('id')) void loadRate();
    if (!changed.length || changed.some((/** @type {string} */ f) => BUDGET_FIELDS.includes(f))) schedulePreview(0);
  });

  // The 10 s arming window is a WALL-CLOCK rule, so it expires on the farm tick (§2.6 AK / §3.9):
  // no module of this chat starts its own polling timer.
  app.bus.on(EV.FARM_TICK, () => {
    if (armed && app.now() - armed.at > ARM_MS) disarm();
  });

  // --------------------------------------------------------------------------------- settings

  app.registry.add(SLOTS.SETTINGS_SECTIONS, {
    id: 'context',
    order: 300,
    title: t('context.settingsTitle'),
    /** @param {HTMLElement} el */
    render(el) {
      if (!el || typeof document === 'undefined') return;
      const wrap = document.createElement('label');
      wrap.className = 'chat-ctx-row';
      const label = document.createElement('span');
      label.className = 'chat-ctx-label';
      label.textContent = t('context.gateThresholdLabel');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1000';
      input.step = '1000';
      input.className = 'chat-ctx-input';
      input.value = String(Math.round(threshold));
      const unit = document.createElement('span');
      unit.className = 'chat-ctx-unit';
      unit.textContent = t('context.gateThresholdUnit');
      const help = document.createElement('p');
      help.className = 'chat-ctx-help';
      help.textContent = t('context.gateThresholdHelp');
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (!Number.isFinite(v) || v <= 0) { input.value = String(Math.round(threshold)); return; }
        threshold = Math.round(v);
        write(KV_KEYS.prefGateThreshold, threshold);
        disarm();
      });
      wrap.append(label, input, unit);
      el.append(wrap, help);
    },
  });

  // ------------------------------------------------------------------------------------ start

  meter.setCaps(caps());
  void loadPrefs().then(() => schedulePreview(0));

  // A small handle for the harness and the console. Nothing here re-arms the gate.
  app.context = {
    threshold: () => threshold,
    setThreshold: (/** @type {number} */ v) => {
      if (num(v, 0) > 0) {
        threshold = Math.round(v);
        write(KV_KEYS.prefGateThreshold, threshold);
      }
    },
    ratio: (/** @type {string} */ underlying) => ratios.get(underlying) ?? null,
    isArmed: () => !!armed,
    meter,
    recompute: () => recompute(),
  };
}
