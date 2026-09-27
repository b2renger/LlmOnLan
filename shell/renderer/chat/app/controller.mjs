// @ts-check
// The controller: threads, the send pipeline and one generation at a time (plan §3.4, §3.6.2).
//
// Contract (plan §3.4):
//   createController(app) → {
//     newThread(init?) → Thread /* SYNC */, selectThread(id), current() → {thread, path},
//     send(draft), generate(opts) → GenerationResult|null, preview(opts) → RequestDraft,
//     stop(), isStreaming(), refreshView(),
//     abortThread(id) /* additive (fix round 2): stop + settle the reply of a thread being deleted */ }
//
// It is the ONLY module that talks to net/run.mjs, and it owns the order of §3.6.2:
//   gov.acquire → farm busy? (local note, no request) → key missing? (local note, no request) →
//   draftFromPath → REQUEST_TRANSFORMS → toOpenAIBody → startGeneration → first-chunk observers →
//   paint + checkpoint → stats/notes → STREAM_OBSERVERS.onDone → repo.finalize → release.
//
// Parity with v0.1.45 (chat.js) that the harness pins:
//   - the farm-busy answer is a LOCAL assistant message, never a request (chat.js:184-196);
//   - a failure while the farm is busy says the busy sentence instead of the raw error
//     (chat.js:296-299);
//   - stats read `N tok · X.X tok/s · first token Y.YYs` (one decimal, then TWO — chat.js:293);
//   - no usage in the stream → one token per content delta.
//
// This module deliberately touches no DOM global (it drives app.view / app.composer instead), so
// shell/test/chat/unit/controller.test.mjs can run the real thing in Node against fakes.

import { EV } from '../core/events.mjs';
import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { draftFromPath, resolveParams, toOpenAIBody } from '../net/request.mjs';
import { startGeneration } from '../net/run.mjs';
import { classifyThrown, describe } from '../net/errors.mjs';
import '../strings/composer.en.mjs';

/** The §3.6.2 first-chunk trigger: the observers see the answer's opening, not a stray token. */
const FIRST_CHUNK_CHARS = 40;
/** Params the farm is allowed to hear about (plan §3.6.3). Applied by the `params-resolve`
 *  transform this module registers at order 250. */
const PARAMS_TRANSFORM_ORDER = 250;
const TITLE_MAX = 60;
/** How many deleted thread ids the controller remembers (enough for any in-flight write). */
const DEAD_KEPT = 50;

/** The first sentence of the first user message, whitespace collapsed, ≤ 60 chars. */
export function titleFrom(text) {
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const sentence = /^[\s\S]*?[.!?](?:\s|$)/.exec(flat);
  let title = (sentence ? sentence[0] : flat).trim();
  if (title.length > TITLE_MAX) title = title.slice(0, TITLE_MAX).trim();
  return title || null;
}

/** @param {string} previous @param {string} next */
function joinReasoning(previous, next) {
  const a = previous || '';
  const b = next || '';
  if (a && b) return `${a}\n\n${b}`;
  return a || b;
}

/**
 * @param {import('../core/types.mjs').App} app
 */
export function createController(app) {
  /** @type {{thread: any, path: any[]}} */
  let cur = { thread: null, path: [] };
  /** @type {{generation: any, msgId: string, threadId: string, dead: boolean}|null} */
  let active = null;
  /** Resolves when the running generate() has finished (its finally has run). */
  /** @type {{promise: Promise<void>, done: () => void}|null} */
  let inflight = null;

  const repo = () => app.repo;
  const caps = () => (app.farm ? app.farm.get() : null);
  const list = (/** @type {string} */ slot) => app.registry.list(slot);

  // A thread deleted UNDER a running generation (the sidebar's ×, or anything else): the farm must
  // stop generating — it is holding a seat for an answer nobody will ever read — and nothing may be
  // written back into the thread that no longer exists. The id is remembered (the last DEAD_KEPT),
  // so checkpoint and finalize are no-ops even when the delete lands in the last microtasks of the
  // generation, after `active` was cleared: a resurrected message would be an orphan row the next
  // boot's recoverInterrupted turns into an "interrupted" reply in a thread with no sidebar entry.
  /** @type {string[]} */
  const deadThreads = [];
  const isDead = (/** @type {string|null} */ id) => !!id && deadThreads.indexOf(id) >= 0;

  // §2.6 AU.4: a feature that paints a message the reader may have navigated away from guards its
  // view write. generate() is one of them — the seat wait resends into the thread the wait belongs
  // to, which is NOT necessarily the thread on screen — so every view write below asks this first.
  // Without it a freed seat streamed another conversation's answer into whatever chat was open,
  // including a brand-new empty one, until the post-stream refreshView() rebuilt the path.
  const onScreen = (/** @type {string|null} */ id) => !id || id === app.state.threadId;
  app.bus.on(EV.THREADS_CHANGED, (/** @type {any} */ p) => {
    if (!p || p.reason !== 'delete') return;
    const ids = Array.isArray(p.ids) ? p.ids : [];
    for (const id of ids) {
      if (typeof id !== 'string' || isDead(id)) continue;
      deadThreads.push(id);
      if (deadThreads.length > DEAD_KEPT) deadThreads.shift();
    }
    if (!active || !ids.includes(active.threadId)) return;
    active.dead = true;
    try { active.generation.abort('user'); } catch (err) { console.warn('[lolchat] abort threw', err); }
  });

  /** @param {string} text */
  function toast(text) {
    if (app.dialogs) app.dialogs.toast(text, { kind: 'info' });
    else if (app.els && app.els.live) app.els.live.textContent = text;
  }

  // The one transform this unit owns (plan §3.6.3, order 250): call > thread > recipe.
  app.registry.add(SLOTS.REQUEST_TRANSFORMS, {
    id: 'params-resolve',
    order: PARAMS_TRANSFORM_ORDER,
    apply(req) {
      req.params = resolveParams(req.paramLayers);
    },
  });

  /** SIBLINGS is empty until P2-U3; `showPath` still wants a Map. */
  async function siblingsFor(thread, path) {
    const provider = app.registry.first(SLOTS.SIBLINGS);
    if (!provider) return new Map();
    try {
      return (await provider.provide(thread, path)) || new Map();
    } catch (err) {
      console.warn('[lolchat] siblings provider threw', err);
      return new Map();
    }
  }

  /** @param {any} thread @param {any[]} path */
  async function show(thread, path) {
    cur = { thread: thread || null, path: path || [] };
    if (!app.view) return;
    app.view.showPath(thread || null, path || [], { siblings: await siblingsFor(thread, path) });
  }

  /**
   * Build the RequestDraft for a path: draftFromPath, then every REQUEST_TRANSFORMS item in order.
   * @param {{thread: any, path: any[], mode: 'new'|'continue', model: string|null, params: any,
   *          draft: any, preview: boolean, extraBlocks?: any[], extraTurns?: any[], noImages?: boolean}} o
   */
  async function buildRequest(o) {
    const c = caps();
    const req = draftFromPath(o.path, {
      model: o.model,
      mode: o.mode,
      engine: c ? c.engine : null,
      // §3.3/§3.6.3: meta.budget is the NUMBER of tokens (FarmCaps.budget is the {tokens,
      // advertised, source} object; the meter reads `source` off the caps, not off the draft).
      budget: c && c.budget ? c.budget.tokens : null,
      paramLayers: {
        recipe: {},
        thread: (o.thread && o.thread.params) || {},
        call: o.params || {},
      },
    });
    if (Array.isArray(o.extraBlocks) && o.extraBlocks.length && req.messages.length) {
      req.messages[req.messages.length - 1].blocks.push(...o.extraBlocks);
    }
    // extraTurns (P2 kickoff contract change, plan §2.6 AC): whole EXTRA WIRE TURNS appended after
    // the path, request-only and never stored. `extraBlocks` can only grow the LAST message, and
    // the continue fallback needs a trailing USER turn after the assistant prefill ("Continue
    // exactly where you stopped…"), which no block on the assistant can be. msgId is null, which is
    // what tells budget-trim (P2-U2) never to drop it.
    if (Array.isArray(o.extraTurns)) {
      for (const turn of o.extraTurns) {
        const blocks = turn && Array.isArray(turn.blocks) ? turn.blocks.filter(Boolean) : [];
        if (!blocks.length) continue;
        req.messages.push({
          msgId: null,
          role: turn.role === 'assistant' ? 'assistant' : 'user',
          pinned: false,
          blocks,
        });
      }
    }
    const ctx = {
      app,
      thread: o.thread || null,
      draft: o.draft || null,
      attachments: (/** @type {string} */ id) => (repo() ? repo().getAttachment(id) : Promise.resolve(null)),
      caps: c,
      preview: !!o.preview,
    };
    for (const transform of list(SLOTS.REQUEST_TRANSFORMS)) {
      await transform.apply(req, ctx);
    }
    if (o.noImages) {
      for (const m of req.messages) m.blocks = m.blocks.filter((/** @type {any} */ b) => b.type !== 'image');
    }
    return req;
  }

  /** The readable note for a failed generation (parity: the busy sentence wins). */
  function noteFor(err, busy) {
    let text = '';
    try {
      const d = describe(err, t, { busy });
      const title = (d && d.title) ? String(d.title) : '';
      const body = (d && d.body) ? String(d.body) : '';
      // The busy body is a whole sentence that already contains the title ("The server is busy"
      // vs "⏳ The server is busy: {label}. Try again in a moment."), and the Set only dedupes
      // byte-identical bits - so joining them read the same sentence twice in a row.
      text = (title && body && body.includes(title))
        ? body
        : [...new Set([title, body].filter(Boolean))].join(' — ');
    } catch (e) {
      console.warn('[lolchat] describe() threw', e);
    }
    if (!text) text = t('core.errorNote', { message: (err && (err.message || err.kind)) || '' });
    // With a busy farm the sentence IS the answer (chat.js:296-299) — nothing else is appended.
    const busyLabel = busy && busy.label;
    if (!busyLabel && err && err.farmMessage && !text.includes(err.farmMessage)) {
      text = `${text} — ${err.farmMessage}`;
    }
    return text;
  }

  /** @param {any} result @param {number} deltas the content-delta count (the no-usage fallback) */
  function statsFrom(result, deltas) {
    const usage = (result && result.usage) || null;
    const completion = usage && usage.completion_tokens != null ? Number(usage.completion_tokens) : null;
    const tokens = completion != null && completion > 0 ? completion : deltas;
    if (!tokens) return null;
    const ttftMs = Number(result && result.ttftMs) || 0;
    let tokPerSec = Number(result && result.tokPerSec);
    if (!Number.isFinite(tokPerSec) || tokPerSec <= 0 || completion == null) {
      const genSec = Math.max(0.001, ((Number(result && result.durationMs) || 0) - ttftMs) / 1000);
      tokPerSec = tokens / genSec;
    }
    return {
      promptTokens: usage && usage.prompt_tokens != null ? Number(usage.prompt_tokens) : null,
      completionTokens: tokens,
      ttftMs: ttftMs || null,
      tokPerSec,
      finishReason: (result && result.finishReason) || null,
      text: t('core.stats', {
        tokens,
        tokPerSec: tokPerSec.toFixed(1),
        ttft: (ttftMs / 1000).toFixed(2),
      }),
    };
  }

  /** A local answer (busy / missing password): finalize, show, never a request. */
  async function localNote(target, { status, content, error }) {
    target.status = status;
    if (content != null) target.content = content;
    if (error !== undefined) target.error = error;
    target.updatedAt = app.now();
    if (!target.reasoning) target.reasoning = null;
    await repo().finalize(target);
    if (app.view && onScreen(target.threadId)) app.view.upsert(target);
    return null;
  }

  const api = {
    /** SYNCHRONOUS (plan §4 P1-U2): the record, the selection and the empty view, no awaits.
     * @param {any} [init] */
    newThread(init) {
      if (!repo()) return null;
      const thread = repo().createThread(init || {});
      cur = { thread, path: [] };
      // `created:true` tells the model picker this selection is a thread nobody has used yet, so
      // a held pick may be written onto it (a sidebar click carries no `created` and never is).
      app.bus.emit(EV.THREAD_SELECTED, { threadId: thread.id, created: true });
      if (app.view) app.view.showPath(thread, [], { siblings: new Map() });
      if (app.sidebar) app.sidebar.render();
      return thread;
    },

    /** @param {string|null} id */
    async selectThread(id) {
      app.bus.emit(EV.THREAD_SELECTED, { threadId: id || null });
      if (!id || !repo()) {
        await show(null, []);
        return null;
      }
      const thread = await repo().getThread(id);
      const path = thread ? await repo().getPath(id) : [];
      await show(thread, path);
      return thread;
    },

    current() {
      return { thread: cur.thread, path: cur.path.slice() };
    },

    /** @param {import('../core/types.mjs').Draft} draft */
    async send(draft) {
      if (!repo()) return;
      const d = draft || /** @type {any} */ ({});
      const text = typeof d.text === 'string' ? d.text.trim() : '';
      const extraParts = Array.isArray(d.parts) ? d.parts.slice() : [];
      if (!text && !extraParts.length) return;

      let thread = null;
      if (app.state.threadId) thread = await repo().getThread(app.state.threadId);
      if (!thread) thread = api.newThread();
      if (!thread) return;

      const firstTurn = !thread.headId;
      /** @type {any[]} */
      const parts = text ? [{ type: 'text', text }, ...extraParts] : extraParts;
      const user = repo().appendMessage(thread.id, {
        role: 'user',
        content: text,
        parts,
        recipeId: d.recipeId || null,
        status: 'done',
        ...(d.vars ? { vars: d.vars } : {}),
      });
      cur.thread = thread;
      cur.path = [...cur.path, user];
      if (app.view) app.view.upsert(user);

      if (firstTurn && thread.titleSource === 'auto') {
        const title = titleFrom(text);
        if (title) {
          thread.title = title;
          await repo().updateThread(thread.id, { title });
        }
      }
      if (app.sidebar) app.sidebar.render();

      await api.generate({
        threadId: thread.id,
        parentId: user.id,
        model: d.model || null,
        params: d.params || null,
        recipeId: d.recipeId || null,
        draft: d,
        mode: 'new',
      });
      if (app.sidebar) app.sidebar.render();
    },

    /**
     * One generation, start to finish (plan §3.6.2).
     * @param {any} [opts]
     * @returns {Promise<any|null>}
     */
    async generate(opts) {
      const o = opts || {};
      if (!repo() || !app.farm) return null;
      const threadId = o.threadId || app.state.threadId;
      if (!threadId) return null;
      const thread = await repo().getThread(threadId);
      if (!thread) return null;

      const holder = o.holder || 'send';
      const release = app.gov
        ? app.gov.acquire('foreground', { holder, abort: () => api.stop() })
        : () => {};
      if (!release) {
        toast(t('core.alreadyRunning'));
        return null;
      }

      // EVERYTHING after acquire() runs inside the try whose finally releases the slot. It used
      // to start below the placeholder write, so a throw from caps()/modelInfo()/appendMessage()
      // escaped with the foreground slot still held: the composer then refused every later send
      // ("A reply is already running") until the window was reloaded, and stop() could not clear
      // it either because `active` was never set.
      /** @type {any} */
      let target = null;
      /** Hoisted: the catch below has to be able to END the stream it opened, or the row stays
       *  `streaming` for ever and thread-view's ensureRow() short-circuits every later repaint. */
      /** @type {any} */
      let stream = null;
      let settle = () => {};
      inflight = { promise: new Promise((res) => { settle = () => res(); }), done: () => settle() };
      try {
        const c = caps() || /** @type {any} */ ({});
        const mode = o.mode === 'continue' ? 'continue' : 'new';
        const model = o.model
          || (thread.modelSource === 'user' && thread.model ? thread.model : null)
          || c.defaultModel
          || null;
        const info = model && app.farm.modelInfo ? app.farm.modelInfo(model) : null;

        target = o.into || null;
        if (!target) {
          target = repo().appendMessage(threadId, {
            role: 'assistant',
            parentId: o.parentId === undefined ? (thread.headId || null) : o.parentId,
            status: 'streaming',
            model,
            underlying: info ? info.underlying || null : null,
            farmName: c.name || null,
            farmId: c.id || null,
          });
          cur.path = [...cur.path, target];
        }
        // The farm is switching model/backend: answer with the reason instead of a network error.
        if (c.busy && c.busy.label) {
          const percent = c.busy.percent != null ? t('core.busyPercent', { percent: c.busy.percent }) : '';
          return await localNote(target, {
            status: 'local',
            content: t('core.busyNote', { label: c.busy.label, percent }),
            error: null,
          });
        }
        if (c.keyMissing) {
          return await localNote(target, {
            status: 'error',
            content: '',
            error: { kind: 'key_missing', code: null, message: t('composer.keyMissingNote'), retryAfter: null },
          });
        }
        // No farm at all: say so. Without this the pipeline ran on to `${null}/chat/completions`,
        // which resolves against file:// and fails — the row then blamed the network while the
        // picker, correctly, read "no farm".
        if (!c.present || !c.baseUrl) {
          return await localNote(target, {
            status: 'error',
            content: '',
            error: { kind: 'network', code: null, message: t('composer.noFarmNote'), retryAfter: null },
          });
        }

        const head = mode === 'continue'
          ? target.id
          : (o.parentId === undefined ? target.parentId : o.parentId);
        const path = await repo().getPath(threadId, head || null);
        const req = await buildRequest({
          thread, path, mode, model, params: o.params || null, draft: o.draft || null,
          preview: false, extraBlocks: o.extraBlocks, extraTurns: o.extraTurns, noImages: !!o.noImages,
        });
        target.params = req.params || null;
        // Image blocks carry their own dataUrl by then (P3-U1's transform sets it).
        const body = toOpenAIBody(req, {});

        const baseContent = mode === 'continue' ? (target.content || '') : '';
        const baseReasoning = mode === 'continue' ? (target.reasoning || '') : '';
        const baseReasoningMs = mode === 'continue' ? (target.reasoningMs || 0) : 0;
        if (mode !== 'continue') { target.content = ''; target.reasoning = null; }
        target.status = 'streaming';

        // Painted ONLY into the thread the reader is looking at (§2.6 AU.4). Elsewhere `stream`
        // stays null and the tail below upserts nothing: the store is still written on every
        // checkpoint, so coming back to that thread shows the answer.
        if (app.view && onScreen(threadId)) {
          app.view.upsert(target);
          stream = app.view.beginStream(target.id);
        }
        if (app.composer) app.composer.setBusy(true);
        app.bus.emit(EV.STREAM_START, { message: target });
        for (const obs of list(SLOTS.STREAM_OBSERVERS)) {
          if (typeof obs.onStart !== 'function') continue;
          try { obs.onStart(target, app); } catch (err) { console.warn(`[lolchat] observer "${obs.id}" onStart threw`, err); }
        }

        /** @type {any} */
        let lastState = null;
        let deltas = 0;
        let seen = 0;
        // 'go' paints as it streams; continue mode holds the brush until the observers decide.
        let decision = mode === 'continue' && list(SLOTS.STREAM_OBSERVERS).some((x) => typeof x.onFirstChunk === 'function')
          ? 'pending'
          : 'go';
        let asked = false;
        /** @type {Promise<any>} */
        let decided = Promise.resolve();
        /** @type {any} */
        let generation = null;

        const paint = () => {
          if (!stream || decision !== 'go') return;
          const st = lastState || { content: '', reasoning: '' };
          stream.paint(baseContent + (st.content || ''), joinReasoning(baseReasoning, st.reasoning || '') || null);
        };

        const maybeFirstChunk = (/** @type {boolean} */ finished) => {
          if (asked) return;
          const text = (lastState && lastState.content) || '';
          if (!finished && text.length < FIRST_CHUNK_CHARS && !text.includes('\n')) return;
          asked = true;
          const observers = list(SLOTS.STREAM_OBSERVERS).filter((x) => typeof x.onFirstChunk === 'function');
          if (!observers.length) { decision = 'go'; return; }
          decided = (async () => {
            for (const obs of observers) {
              let verdict = null;
              try {
                verdict = await obs.onFirstChunk({ msg: target, text, mode, partial: baseContent }, app);
              } catch (err) {
                console.warn(`[lolchat] observer "${obs.id}" onFirstChunk threw`, err);
              }
              if (verdict === 'abort') {
                decision = 'abort';
                if (generation) generation.abort('observer');
                return;
              }
            }
            decision = 'go';
            paint();
          })();
        };

        generation = startGeneration({
          url: `${c.baseUrl}/chat/completions`,
          headers: { 'content-type': 'application/json', ...(app.farm.headers() || {}) },
          body,
          requiresKey: !!c.requiresKey,
          onFirstToken: () => {},
          onTail: (/** @type {any} */ state) => {
            lastState = state;
            const len = (state && state.content && state.content.length) || 0;
            if (len > seen) { deltas += 1; seen = len; }
            maybeFirstChunk(false);
            paint();
          },
          onCheckpoint: (/** @type {any} */ state) => {
            lastState = state || lastState;
            if (decision === 'abort') return;
            if ((active && active.dead) || isDead(threadId)) return;   // deleted: never write it back
            target.content = baseContent + ((lastState && lastState.content) || '');
            target.reasoning = joinReasoning(baseReasoning, (lastState && lastState.reasoning) || '') || null;
            repo().checkpoint(target);
          },
        });
        active = { generation, msgId: target.id, threadId, dead: false };

        const result = await generation.done;
        maybeFirstChunk(true);
        await decided;
        const dead = !!(active && active.dead) || isDead(threadId);
        active = null;

        // The thread this was writing into was deleted mid-stream: the generation is already
        // aborted, there is nothing to finalize and nothing to paint.
        if (dead) {
          if (stream) stream.end(target);
          return { status: 'aborted', abortedBy: 'user', content: '', reasoning: null, reasoningMs: null, usage: null, finishReason: null, ttftMs: null, durationMs: null, tokPerSec: null, error: null };
        }

        const st = lastState || {};
        const newContent = result && result.content != null ? result.content : (st.content || '');
        const newReasoning = result && result.reasoning != null ? result.reasoning : (st.reasoning || '');
        const aborted = decision === 'abort';

        target.content = aborted ? baseContent : baseContent + newContent;
        target.reasoning = (aborted ? baseReasoning : joinReasoning(baseReasoning, newReasoning)) || null;
        const reasoningMs = baseReasoningMs + (Number(result && result.reasoningMs) || 0);
        target.reasoningMs = reasoningMs || null;
        target.sawToolCalls = !!(st.sawToolCalls || (result && result.sawToolCalls));
        target.updatedAt = app.now();

        const stats = statsFrom(result, Number(st.contentDeltas) || deltas);
        const busyAtFailure = (caps() || {}).busy || null;
        /** @type {any} */
        const out = {
          status: result ? result.status : 'error',
          abortedBy: aborted ? 'observer' : (result ? result.abortedBy : null),
          content: target.content,
          reasoning: target.reasoning,
          reasoningMs: target.reasoningMs,
          usage: (result && result.usage) || null,
          finishReason: (result && result.finishReason) || null,
          ttftMs: (result && result.ttftMs) || null,
          durationMs: (result && result.durationMs) || null,
          tokPerSec: stats ? stats.tokPerSec : null,
          error: (result && result.error) || null,
        };

        if (out.status === 'error' && out.error) {
          let handled = false;
          for (const handler of list(SLOTS.ERROR_HANDLERS)) {
            try {
              if (await handler.handle(out.error, target, app)) { handled = true; break; }
            } catch (err) {
              console.warn(`[lolchat] error handler "${handler.id}" threw`, err);
            }
          }
          if (!handled) {
            target.status = 'error';
            target.error = {
              kind: out.error.kind || 'http',
              code: out.error.code == null ? null : out.error.code,
              message: noteFor(out.error, busyAtFailure),
              retryAfter: out.error.retryAfter == null ? null : out.error.retryAfter,
            };
            if (stats) target.stats = stats;
          }
        } else if (out.status === 'aborted' || aborted) {
          target.status = aborted && baseContent ? 'done' : 'aborted';
          target.error = null;
          if (stats) target.stats = stats;
        } else {
          target.status = 'done';
          target.error = null;
          target.stats = stats;
          // The farm answered with a tool call we can neither run nor show.
          if (target.sawToolCalls && !String(target.content || '').trim()) {
            target.status = 'error';
            target.error = { kind: 'tool_calls', code: null, message: t('composer.toolCallsNote'), retryAfter: null };
          }
        }

        for (const obs of list(SLOTS.STREAM_OBSERVERS)) {
          if (typeof obs.onDone !== 'function') continue;
          try { await obs.onDone(target, out, app); } catch (err) { console.warn(`[lolchat] observer "${obs.id}" onDone threw`, err); }
        }
        if (!isDead(threadId)) await repo().finalize(target);
        if (stream) stream.end(target);
        else if (app.view && onScreen(threadId)) app.view.upsert(target);
        app.bus.emit(EV.STREAM_END, { message: target, result: out });
        if (app.registry.first(SLOTS.SIBLINGS)) await api.refreshView();
        return out;
      } catch (err) {
        // Anything the pipeline itself threw (a transform, a bad body): keep the partial, say why.
        const classified = classifyThrown(err);
        if (!target) {
          // The throw beat the placeholder (a repo write that rejected, a farm shim that threw):
          // there is nothing to annotate, but the slot below is still released.
          console.error('[lolchat] generate() failed before the reply row existed', err);
          toast(noteFor(classified, (caps() || {}).busy || null));
          return { status: 'error', abortedBy: null, content: '', reasoning: null, reasoningMs: null, usage: null, finishReason: null, ttftMs: null, durationMs: null, tokPerSec: null, error: classified };
        }
        target.status = 'error';
        target.error = {
          kind: (classified && classified.kind) || 'http',
          code: (classified && classified.code) || null,
          message: noteFor(classified, (caps() || {}).busy || null),
          retryAfter: null,
        };
        target.updatedAt = app.now();
        // The store is ALSO what may have thrown us in here: its rejection must not escape a second
        // time, or generate() rejects, the stream below is never ended and the row is stuck.
        if (!isDead(threadId)) {
          try { await repo().finalize(target); } catch (e) { console.warn('[lolchat] finalize failed on the error path', e); }
        }
        // The row has to LEAVE the streaming state here or it is stuck for ever: ensureRow()
        // short-circuits on a row a stream owns, so every later upsert/showPath would skip it.
        if (stream) stream.end(target);
        else if (app.view && onScreen(threadId)) app.view.upsert(target);
        app.bus.emit(EV.STREAM_END, { message: target, result: { status: 'error', error: classified } });
        return { status: 'error', abortedBy: null, content: target.content, reasoning: target.reasoning, reasoningMs: target.reasoningMs, usage: null, finishReason: null, ttftMs: null, durationMs: null, tokPerSec: null, error: classified };
      } finally {
        active = null;
        release();
        // DERIVED, never asserted (§3.6.2: "a hold placed by a handler survives"). A handler that
        // re-armed a hold during the stream leaves the governor busy on purpose; forcing Send back
        // then offered a button whose own doSubmit refuses, with Stop hidden.
        if (app.composer) {
          app.composer.setBusy(app.gov ? app.gov.state().foreground !== 'idle' : false);
          app.composer.focus();
        }
        if (inflight) { const f = inflight; inflight = null; f.done(); }
      }
    },

    /** The request the next send WOULD make: transforms with ctx.preview, no network, no writes. */
    async preview(opts) {
      const o = opts || {};
      const threadId = o.threadId || app.state.threadId || null;
      const thread = threadId && repo() ? await repo().getThread(threadId) : null;
      const mode = o.mode === 'continue' ? 'continue' : 'new';
      /** @type {any[]} */
      let path = [];
      if (threadId && repo()) path = await repo().getPath(threadId, o.parentId === undefined ? undefined : o.parentId);
      if (o.draft) {
        const text = typeof o.draft.text === 'string' ? o.draft.text : '';
        path = [...path, {
          id: 'draft', threadId: threadId || 'draft', parentId: path.length ? path[path.length - 1].id : null,
          role: 'user', createdAt: app.now(), updatedAt: app.now(),
          parts: text ? [{ type: 'text', text }, ...(o.draft.parts || [])] : (o.draft.parts || []),
          content: text, reasoning: null, reasoningMs: null, sawToolCalls: false,
          model: null, underlying: null, farmName: null, farmId: null, params: null,
          recipeId: o.draft.recipeId || null, stats: null, status: 'done', error: null, pinned: false,
        }];
      }
      const c = caps() || /** @type {any} */ ({});
      const model = (o.draft && o.draft.model)
        || (thread && thread.modelSource === 'user' && thread.model ? thread.model : null)
        || c.defaultModel || null;
      const req = await buildRequest({
        thread, path, mode, model, params: (o.draft && o.draft.params) || o.params || null,
        draft: o.draft || null, preview: true, extraBlocks: o.extraBlocks, extraTurns: o.extraTurns,
        noImages: !!o.noImages,
      });
      app.bus.emit(EV.REQUEST_PREVIEW, { request: req });
      return req;
    },

    /** Abort the stream; with nothing streaming, the first active CANCEL_HANDLERS item. */
    stop() {
      if (active && active.generation) {
        try { active.generation.abort('user'); } catch (err) { console.warn('[lolchat] abort threw', err); }
        return true;
      }
      for (const handler of list(SLOTS.CANCEL_HANDLERS)) {
        let isActive = false;
        try { isActive = !!handler.active(app); } catch (err) { console.warn(`[lolchat] cancel handler "${handler.id}" threw`, err); }
        if (!isActive) continue;
        try { handler.cancel(app); } catch (err) { console.warn(`[lolchat] cancel handler "${handler.id}" threw`, err); }
        return true;
      }
      return false;
    },

    isStreaming() {
      return !!active;
    },

    /**
     * Abort the generation streaming into `threadId` and WAIT for it to settle. Deleting a thread
     * uses it: without the abort the farm keeps generating (and keeps the seat it gave this client)
     * for an answer nobody will ever read, and the governor stays busy so every later send is
     * refused. Awaiting the settle also means the delete cascade runs after the last write.
     * @param {string|null} threadId
     * @returns {Promise<boolean>} whether anything was aborted
     */
    async abortThread(threadId) {
      if (!threadId || !active || active.threadId !== threadId) return false;
      api.stop();
      const wait = inflight ? inflight.promise : null;
      if (wait) await wait;
      return true;
    },

    async refreshView() {
      const threadId = app.state.threadId;
      if (!threadId || !repo()) {
        await show(null, []);
        return;
      }
      const thread = await repo().getThread(threadId);
      const path = thread ? await repo().getPath(threadId) : [];
      await show(thread, path);
    },
  };

  return api;
}
