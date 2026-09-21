// @ts-check
// P1-U1 in the real browser: net/run.mjs driving net/sse.mjs + net/delta.mjs + net/errors.mjs
// against the mock farm, through the same CSP and the same fetch stack the shipped client uses.
//
// The unit tests prove the parsing; only these scenarios can prove the parts Node cannot fake: a
// real streaming Response body, a real AbortController cutting a socket mid-answer, a real 429 with
// its retry-after header, a socket the server destroys, and the two auth shapes (a farm reached
// with its key, and the SAME farm reached through app.js's fallback branch, which carries none).
//
// Nothing here touches the controller, the view or the repo: the scenarios import net/run.mjs
// directly in the page (§ P1-U1 acceptance) and read window.LolChat.app.farm for the endpoint and
// the headers, so a failure is this unit's code and nobody else's.

/** Import net/run.mjs in the page and run one generation. Runs entirely inside h.eval. */
const generate = (/** @type {any} */ h, /** @type {any} */ o) => h.eval(async (opt) => {
  const run = await import('../../renderer/chat/net/run.mjs');
  const req = await import('../../renderer/chat/net/request.mjs');
  const app = window.LolChat.app;
  const caps = app.farm.get();

  // The body comes from the REAL pure builders, so the scenario also proves they compose.
  const draft = req.draftFromPath(
    [{ id: 'u1', role: 'user', content: opt.text || 'hello', status: 'done', parts: [], pinned: false }],
    { model: opt.model, paramLayers: { call: opt.params || {} } },
  );
  draft.params = req.resolveParams(draft.paramLayers);
  const body = req.toOpenAIBody(draft, {});

  const counts = { firstToken: 0, tail: 0, checkpoint: 0 };
  let firstAt = null;
  const gen = run.startGeneration({
    url: caps.baseUrl + '/chat/completions',
    headers: app.farm.headers(),
    requiresKey: caps.requiresKey,
    body,
    onFirstToken: (info) => { counts.firstToken++; firstAt = info; },
    onTail: () => { counts.tail++; },
    onCheckpoint: () => { counts.checkpoint++; },
  });
  if (opt.abortAfterMs) setTimeout(() => gen.abort(opt.abortReason || 'user'), opt.abortAfterMs);
  const res = await gen.done;
  return {
    sentModel: body.model,
    sentKeys: Object.keys(body).sort(),
    authorization: (app.farm.headers().authorization || null),
    status: res.status,
    abortedBy: res.abortedBy,
    contentLen: res.content.length,
    contentHead: res.content.slice(0, 40),
    contentTail: res.content.slice(-40),
    reasoning: res.reasoning,
    reasoningLen: res.reasoning ? res.reasoning.length : 0,
    usage: res.usage,
    finishReason: res.finishReason,
    ttftMs: res.ttftMs,
    durationMs: res.durationMs,
    tokPerSec: res.tokPerSec,
    error: res.error,
    counts,
    firstAt,
  };
}, o);

/** Wait until the farm model has actually been given the published bridge. */
const farmReady = async (/** @type {any} */ h) => {
  await h.publishFarm();
  return h.waitFor(() => {
    const app = window.LolChat && window.LolChat.app;
    const caps = app && app.farm && app.farm.get();
    return caps && caps.present ? { baseUrl: caps.baseUrl, requiresKey: caps.requiresKey, hasKey: !!caps.apiKey } : null;
  }, { timeout: 15000 });
};

/** The one thing only the server can tell us: did the client really walk away mid-stream? */
const completions = (/** @type {any} */ h) => h.mock.log({ path: '/v1/chat/completions' });

export default [
  {
    name: 'p1-net-stream',
    needsMock: true,
    // The legacy stream: 100 reasoning deltas, 1000 content deltas, a usage chunk, [DONE].
    run: async (h) => {
      const farm = await farmReady(h);
      h.eq(farm.requiresKey, false, 'the open listener needs no password');
      const r = await generate(h, { model: 'assistant', text: 'what GPU?' });

      h.eq(r.status, 'done');
      h.eq(r.error, null);
      h.assert(r.reasoning && r.reasoning.startsWith('think0 '), 'reasoning_content became reasoning');
      h.assert(r.reasoning.includes('think99 '), 'all 100 reasoning deltas arrived');
      h.assert(r.contentHead.startsWith('tok0 '), 'content starts at the first token');
      h.assert(r.contentTail.includes('tok999'), 'and runs to the last');
      h.assert(r.contentLen > 5000, `the whole answer is there (${r.contentLen} chars)`);
      h.eq(r.usage.completion_tokens, 1000, 'the usage chunk was read');
      h.eq(r.finishReason, 'stop');
      h.assert(r.ttftMs != null && r.ttftMs >= 0, 'time to first token was measured');
      h.assert(r.tokPerSec > 150, `the mock paces above the real farm: ${r.tokPerSec.toFixed(1)} tok/s`);
      h.eq(r.counts.firstToken, 1, 'onFirstToken fires exactly once');
      h.eq(r.firstAt.kind, 'reasoning', 'the first token of this stream is a reasoning token');
      h.assert(r.counts.tail > 100, `onTail runs per chunk (${r.counts.tail})`);
      h.assert(r.counts.checkpoint >= 1 && r.counts.checkpoint < r.counts.tail / 10,
        `onCheckpoint is throttled to ~1/s (${r.counts.checkpoint} of ${r.counts.tail} chunks)`);

      const log = await completions(h);
      h.eq(log.length, 1, 'exactly one request');
      h.eq(log[0].model, 'assistant');
      h.eq(log[0].body.stream, true);
      h.eq(log[0].body.stream_options.include_usage, true);
      h.eq(log[0].headers.authorization, null, 'no Bearer on an open farm');
      h.assert(!JSON.stringify(log[0].body).includes('num_ctx'), 'the client never sizes the farm context');
      h.note(`${r.usage.completion_tokens} tok · ${r.tokPerSec.toFixed(1)} tok/s · first token ${(r.ttftMs / 1000).toFixed(2)}s`);
    },
  },

  {
    name: 'p1-net-think-tags',
    needsMock: true,
    // The other reasoning shape: <think>…</think> inside the content, with the tags split across
    // chunk boundaries by the mock on purpose.
    run: async (h) => {
      await farmReady(h);
      const r = await generate(h, { model: 'mock-think-tags' });
      h.eq(r.status, 'done');
      h.eq(r.reasoning, 'weighing the options carefully');
      h.eq(r.contentHead, 'Here is the answer: **42**.', 'no tag fragment leaked into the answer');
    },
  },

  {
    name: 'p1-net-abort',
    needsMock: true,
    // mock-slow takes 3 s before its first token. Aborting at 500 ms must reach the SERVER, not
    // just stop the promise: the mock records closedEarly when the client walks away.
    run: async (h) => {
      await farmReady(h);
      const r = await generate(h, { model: 'mock-slow', abortAfterMs: 500 });
      h.eq(r.status, 'aborted');
      h.eq(r.abortedBy, 'user');
      h.eq(r.error, null, 'an abort is not an error');
      h.assert(r.durationMs < 2500, `it stopped before the first token (${r.durationMs} ms)`);

      // The server-side record can land a beat after the client's promise settles.
      let log = await completions(h);
      for (let i = 0; i < 30 && !(log[0] && log[0].closedEarly); i++) { await h.sleep(100); log = await completions(h); }
      h.eq(log.length, 1);
      h.eq(log[0].closedEarly, true, 'the mock saw the client disconnect');
      h.note(`aborted after ${r.durationMs} ms, server saw closedEarly`);
    },
    allowConsoleErrors: [/Failed to load resource/, /net::ERR_(ABORTED|FAILED|CONNECTION_RESET)/],
  },

  {
    name: 'p1-net-abort-observer',
    needsMock: true,
    // The same abort, attributed to a STREAM_OBSERVER instead of the user (§3.6.2 onFirstChunk
    // returning 'abort'): the result must say who stopped it, because the controller restores the
    // partial answer differently.
    run: async (h) => {
      await farmReady(h);
      const r = await generate(h, { model: 'mock-slow', abortAfterMs: 400, abortReason: 'observer' });
      h.eq(r.status, 'aborted');
      h.eq(r.abortedBy, 'observer');
    },
    allowConsoleErrors: [/Failed to load resource/, /net::ERR_(ABORTED|FAILED|CONNECTION_RESET)/],
  },

  {
    name: 'p1-net-seats-full',
    needsMock: true,
    // The seat gate's real 429 (farm/src/seats.js, copied verbatim into the mock).
    run: async (h) => {
      await farmReady(h);
      const r = await generate(h, { model: 'mock-429' });
      h.eq(r.status, 'error');
      h.eq(r.error.kind, 'seats_full');
      h.eq(r.error.status, 429);
      h.eq(r.error.code, 'lol_seats_full');
      h.eq(r.error.retryAfter, 30, 'read from the retry-after header');
      h.assert(/seats on this server are in use/.test(r.error.farmMessage), 'the farm sentence is kept verbatim');
      h.eq(r.contentLen, 0);
    },
    allowConsoleErrors: [/Failed to load resource/],
  },

  {
    name: 'p1-net-upstream-down',
    needsMock: true,
    run: async (h) => {
      await farmReady(h);
      const r = await generate(h, { model: 'mock-502' });
      h.eq(r.status, 'error');
      h.eq(r.error.kind, 'upstream_down');
      h.eq(r.error.code, 'lol_upstream_down');
    },
    allowConsoleErrors: [/Failed to load resource/],
  },

  {
    name: 'p1-net-context-overflow',
    needsMock: true,
    // A 400 whose message says "…16384 tokens", which must NOT be read as a password problem.
    run: async (h) => {
      await farmReady(h);
      const r = await generate(h, { model: 'mock-context-overflow' });
      h.eq(r.status, 'error');
      h.eq(r.error.kind, 'context_overflow');
      h.assert(/maximum context length/.test(r.error.farmMessage), 'the farm explains the numbers');
    },
    allowConsoleErrors: [/Failed to load resource/],
  },

  {
    name: 'p1-net-reset',
    needsMock: true,
    // The farm's process dies mid-stream: the socket is destroyed with no [DONE] and no status.
    // fetch() surfaces that as a TypeError from the READ, after 50 tokens already arrived.
    run: async (h) => {
      await farmReady(h);
      const r = await generate(h, { model: 'mock-reset' });
      h.eq(r.status, 'error');
      h.eq(r.error.kind, 'network');
      h.assert(r.contentHead.startsWith('tok0 '), 'what arrived before the reset is kept');
      h.assert(r.contentLen > 100, `${r.contentLen} characters survived`);
    },
    allowConsoleErrors: [/Failed to load resource/, /net::ERR_(CONNECTION_RESET|EMPTY_RESPONSE|INCOMPLETE_CHUNKED_ENCODING|FAILED)/],
  },

  {
    name: 'p1-net-midstream-error',
    needsMock: true,
    // The politer failure: a 200 stream that ends with {error:{…}} instead of [DONE].
    run: async (h) => {
      await farmReady(h);
      const r = await generate(h, { model: 'mock-midstream-error' });
      h.eq(r.status, 'error');
      h.eq(r.error.kind, 'stream_error');
      h.eq(r.error.farmMessage, 'upstream exploded');
      h.assert(r.contentTail.includes('tok49'), 'all 50 tokens that did arrive are kept');
    },
  },

  {
    name: 'p1-net-usage-none',
    needsMock: true,
    // No usage chunk at all (some proxies): the token count falls back to the content deltas, so
    // the stats line still has a number instead of disappearing.
    run: async (h) => {
      await farmReady(h);
      const r = await generate(h, { model: 'mock-usage-none' });
      h.eq(r.status, 'done');
      h.eq(r.usage, null);
      h.assert(r.tokPerSec > 0, `tok/s from the delta count: ${r.tokPerSec.toFixed(1)}`);
    },
  },

  {
    name: 'p1-net-keyed',
    needsMock: true,
    // A password-protected farm, reached the way discovery hands it over: requiresKey + _key, so
    // farm.headers() carries the Bearer and the keyed listener answers 200.
    run: async (h) => {
      await h.reload({ farm: 'keyed' });
      const farm = await farmReady(h);
      h.eq(farm.requiresKey, true);
      h.eq(farm.hasKey, true);
      const r = await generate(h, { model: 'assistant' });
      h.eq(r.authorization, 'Bearer harness-pw', 'the key is read at request time');
      h.eq(r.status, 'done');
      h.eq(r.usage.completion_tokens, 1000);

      const log = await completions(h);
      h.eq(log[0].role, 'keyed', 'it really went to the keyed listener');
      h.eq(log[0].status, 200);
    },
  },

  {
    name: 'p1-net-fallback-branch',
    needsMock: true,
    // app.js's FALLBACK branch: discovery found nothing, so the renderer publishes only the
    // sidecar's endpoint — {name:'farm', openaiBaseUrl, defaultModel:null}, with no key. Pointed at
    // a keyed farm that is a 400 from LiteLLM, and the user must be told it is the PASSWORD, not a
    // mystery. This is the production hole plan §6 note 14(e) asked for.
    run: async (h) => {
      await h.reload({ farm: 'fallback-keyed' });
      const farm = await farmReady(h);
      h.eq(farm.requiresKey, false, 'the fallback bridge cannot know the farm is keyed');
      h.eq(farm.hasKey, false);
      const r = await generate(h, { model: 'assistant' });
      h.eq(r.authorization, null, 'no Bearer is sent at all');
      h.eq(r.status, 'error');
      h.eq(r.error.kind, 'auth', 'classified from the body, NOT from requiresKey');
      h.eq(r.error.status, 400, "LiteLLM's refusal is a 400, not a 401");

      const log = await completions(h);
      h.eq(log[0].status, 400);
      h.eq(log[0].headers.authorization, null);
    },
    allowConsoleErrors: [/Failed to load resource/],
  },

  {
    name: 'p1-net-no-farm',
    needsMock: true,
    // No farm published at all: caps are absent and fetchModels says so rather than throwing.
    run: async (h) => {
      await h.reload({ farm: 'none' });
      const state = await h.eval(async () => {
        const app = window.LolChat.app;
        const caps = app.farm.get();
        return { present: caps.present, baseUrl: caps.baseUrl, models: await app.farm.fetchModels() };
      });
      h.eq(state.present, false);
      h.eq(state.baseUrl, null);
      h.eq(state.models.state, 'no-farm');

      // ...and a send with no farm says so instead of building a request against `null/chat/
      // completions` (which resolves against file:// and was reported as a network failure, while
      // the picker right next to it correctly read "no farm").
      const since = Date.now();
      await h.submit('is anyone out there?');
      const note = await h.waitFor(() => {
        const row = [...document.querySelectorAll('.chat-msg.assistant')].pop();
        if (!row || row.getAttribute('data-status') === 'streaming') return null;
        const n = row.querySelector('.chat-msg-note');
        return n && n.textContent ? { status: row.getAttribute('data-status'), text: n.textContent } : null;
      }, { timeout: 15000 });
      h.eq(note.status, 'error');
      h.assert(/No farm yet/.test(note.text), `the note names the real problem: ${JSON.stringify(note.text)}`);
      h.assert(!/unreachable|Failed to fetch/i.test(note.text), 'and it does not blame the network');
      const posts = (await h.mock.log({ path: '/v1/chat/completions', since })).filter((e) => e.method === 'POST');
      h.eq(posts.length, 0, 'nothing was sent anywhere');
      h.note(`no farm: "${note.text}"`);
    },
  },

  {
    name: 'p1-net-fetch-models',
    needsMock: true,
    // The picker's data source (§3.10) against the real /v1/models, including the auth state a
    // keyed farm returns when the key is wrong.
    run: async (h) => {
      await farmReady(h);
      const ok = await h.eval(() => window.LolChat.app.farm.fetchModels());
      h.eq(ok.state, 'ok');
      h.assert(ok.ids.includes('assistant') && ok.ids.includes('gemma4:12b'), 'the catalog came back');

      await h.reload({ farm: 'keyed' });
      await farmReady(h);
      const keyed = await h.eval(() => window.LolChat.app.farm.fetchModels());
      h.eq(keyed.state, 'ok', 'with the right key it is a normal catalog');

      // Break the key the way a rotated farm password does, and ask again.
      await h.setFarm({ _key: 'wrong-pw' });
      const refused = await h.eval(() => window.LolChat.app.farm.fetchModels({ force: true }));
      h.eq(refused.state, 'auth');
      h.eq(refused.ids.length, 0);

      await h.setFarm({ _key: 'harness-pw' });
      const recovered = await h.eval(() => window.LolChat.app.farm.fetchModels());
      h.eq(recovered.state, 'ok', 'the failure was not cached, so putting the key back heals it');
    },
    allowConsoleErrors: [/Failed to load resource/],
  },

  {
    name: 'p1-net-governor',
    needsMock: true,
    // The governor in the page, against a REAL stream: a second send while one is running is
    // refused, and the slot comes back when the stream ends.
    run: async (h) => {
      await farmReady(h);
      const out = await h.eval(async () => {
        const run = await import('../../renderer/chat/net/run.mjs');
        const app = window.LolChat.app;
        const caps = app.farm.get();
        const body = { model: 'assistant', messages: [{ role: 'user', content: 'hi' }], stream: true, stream_options: { include_usage: true } };
        const release = app.gov.acquire('foreground', { holder: 'send' });
        const gen = run.startGeneration({ url: caps.baseUrl + '/chat/completions', headers: app.farm.headers(), body });
        const duringState = app.gov.state();
        const secondRefused = app.gov.acquire('foreground', { holder: 'regenerate' }) === null;
        await gen.done;
        release();
        return { duringState, secondRefused, afterState: app.gov.state(), acquiredAgain: !!app.gov.acquire('foreground', {}) };
      });
      h.eq(out.duringState, { foreground: 'streaming', holder: 'send' });
      h.eq(out.secondRefused, true, 'one foreground generation at a time');
      h.eq(out.afterState, { foreground: 'idle', holder: null });
      h.eq(out.acquiredAgain, true);
    },
  },

  {
    name: 'p1-net-error-body-cap',
    // No mock needed: a farm melting down can answer a 502 with a megabyte of HTML, and the chat
    // must classify it from the first pageful and HANG UP rather than buffer the whole thing. The
    // body here is a real ReadableStream that counts what it was asked for and records the cancel.
    run: async (h) => {
      const out = await h.eval(async () => {
        const run = await import('../../renderer/chat/net/run.mjs');
        const LIMIT = 64 * 1024;
        const CHUNK = 16 * 1024;
        const TOTAL = 1024 * 1024;
        const seen = { pushed: 0, cancelled: false };
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          pull(c) {
            if (seen.pushed >= TOTAL) { c.close(); return; }
            c.enqueue(enc.encode('x'.repeat(CHUNK)));
            seen.pushed += CHUNK;
          },
          cancel() { seen.cancelled = true; },
        });
        const res = new Response(stream, { status: 502, headers: { 'content-type': 'text/plain' } });
        const gen = run.startGeneration({
          url: 'http://127.0.0.1:1/v1/chat/completions',
          body: { model: 'assistant', messages: [] },
          fetchImpl: async () => res,
        });
        const r = await gen.done;
        return { seen, limit: LIMIT, chunk: CHUNK, total: TOTAL, status: r.status, kind: r.error && r.error.kind };
      });
      h.eq(out.status, 'error');
      h.eq(out.kind, 'upstream_down', 'a 502 with no farm code is still the model server being down');
      h.eq(out.seen.cancelled, true, 'the body stream was cancelled, not drained');
      h.assert(out.seen.pushed <= out.limit + out.chunk,
        `only ${out.seen.pushed} of ${out.total} bytes were ever pulled (cap ${out.limit})`);
      h.note(`pulled ${out.seen.pushed} B of a ${out.total} B error body, then hung up`);
    },
  },
];
