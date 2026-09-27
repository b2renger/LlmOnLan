// net/errors.mjs (P1-U1): the farm's real refusal bodies → a kind the UI can act on.
// The bodies are fixtures copied from shell/test/mock/*, which are themselves copies of
// farm/src/seats.js and of what LiteLLM actually answers — so these assertions are about the real
// stack's wording, not an interpretation of it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyHttp, classifyStreamError, classifyThrown, describe } from '../../../renderer/chat/net/errors.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BODIES = path.join(HERE, '..', 'fixtures', 'net', 'bodies');
const body = (name) => fs.readFileSync(path.join(BODIES, name), 'utf8');

export default (test) => {
  test('the seat gate: 429 + lol_seats_full → seats_full with retryAfter from the header', () => {
    const e = classifyHttp({
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '30' },
      bodyText: body('seats-full.json'),
    });
    assert.equal(e.kind, 'seats_full');
    assert.equal(e.retryAfter, 30);
    assert.equal(e.code, 'lol_seats_full');
    assert.match(e.farmMessage, /^All 2 seats on this server are in use\./, 'the farm sentence is kept verbatim');
    assert.equal(e.message, e.farmMessage);
  });

  test('a Headers instance works as well as a plain object', () => {
    const headers = new Headers({ 'Retry-After': '12' });
    assert.equal(classifyHttp({ status: 429, headers, bodyText: body('seats-full.json') }).retryAfter, 12);
  });

  test('502 + lol_upstream_down → upstream_down', () => {
    const e = classifyHttp({ status: 502, headers: {}, bodyText: body('upstream-down.json') });
    assert.equal(e.kind, 'upstream_down');
    assert.equal(e.code, 'lol_upstream_down');
    assert.match(e.farmMessage, /not answering/);
  });

  test("LiteLLM's keyed refusal is a 400, and it classifies as auth", () => {
    const e = classifyHttp({ status: 400, headers: {}, bodyText: body('litellm-auth-400.json'), requiresKey: true });
    assert.equal(e.kind, 'auth');
    assert.equal(e.status, 400);
  });

  test('the fallback branch: the SAME 400 with requiresKey false is still auth', () => {
    // app.js's fallback bridge carries no requiresKey and no apiKey, so a keyed farm reached that
    // way sends no Bearer. Without this rule the user would get a bare "HTTP 400" and no hint that
    // a password is the problem (plan §6 note 14e, scenario p1-fallback-branch).
    const e = classifyHttp({ status: 400, headers: {}, bodyText: body('litellm-auth-400.json'), requiresKey: false });
    assert.equal(e.kind, 'auth');
  });

  test('401 and 403 with auth text are auth too', () => {
    assert.equal(classifyHttp({ status: 401, headers: {}, bodyText: '{"error":{"message":"Unauthorized"}}' }).kind, 'auth');
    assert.equal(classifyHttp({ status: 403, headers: {}, bodyText: 'forbidden: bad api-key' }).kind, 'auth');
  });

  test('a 500 mentioning a key is auth ONLY on a keyed farm', () => {
    const text = '{"error":{"message":"internal error validating the api key"}}';
    assert.equal(classifyHttp({ status: 500, headers: {}, bodyText: text, requiresKey: true }).kind, 'auth');
    assert.equal(classifyHttp({ status: 500, headers: {}, bodyText: text, requiresKey: false }).kind, 'http');
  });

  test('the context overflow is NOT read as an auth failure, though it says "tokens"', () => {
    const e = classifyHttp({ status: 400, headers: {}, bodyText: body('context-overflow-400.json'), requiresKey: true });
    assert.equal(e.kind, 'context_overflow', 'order matters: the context test runs before the auth test');
    assert.match(e.farmMessage, /maximum context length is 16384 tokens/);
  });

  test('a 400 about images is vision_unsupported', () => {
    assert.equal(classifyHttp({ status: 400, headers: {}, bodyText: body('vision-refusal-400.json') }).kind, 'vision_unsupported');
  });

  test('a 400 that means none of those is plain http, with the farm sentence kept', () => {
    const e = classifyHttp({ status: 400, headers: {}, bodyText: body('unknown-model-400.json') });
    assert.equal(e.kind, 'http');
    assert.match(e.message, /Invalid model name/);
  });

  test('a bare 429 with no farm code is still treated as a full farm', () => {
    const e = classifyHttp({ status: 429, headers: { 'retry-after': '5' }, bodyText: '' });
    assert.equal(e.kind, 'seats_full');
    assert.equal(e.retryAfter, 5);
  });

  test('a body that is not JSON does not throw', () => {
    const e = classifyHttp({ status: 500, headers: {}, bodyText: '<html>502 Bad Gateway</html>' });
    assert.equal(e.kind, 'http');
    assert.equal(e.farmMessage, null);
    assert.equal(e.message, 'HTTP 500');
  });

  test('503 and 504 fall back to upstream_down', () => {
    assert.equal(classifyHttp({ status: 503, headers: {}, bodyText: '' }).kind, 'upstream_down');
    assert.equal(classifyHttp({ status: 504, headers: {}, bodyText: '' }).kind, 'upstream_down');
  });

  test('an in-stream error object is stream_error', () => {
    const e = classifyStreamError({ error: { message: 'upstream exploded', type: 'api_error', code: 500 } });
    assert.equal(e.kind, 'stream_error');
    assert.equal(e.status, null);
    assert.equal(e.farmMessage, 'upstream exploded');
  });

  test('thrown: TypeError and a reset connection are network; AbortError is aborted', () => {
    assert.equal(classifyThrown(new TypeError('Failed to fetch')).kind, 'network');
    const reset = new Error('The connection was reset');
    assert.equal(classifyThrown(reset).kind, 'network');
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    assert.equal(classifyThrown(abort).kind, 'aborted');
    assert.equal(classifyThrown(new Error('something else entirely')).kind, 'http');
  });

  test('describe(): a farm that was busy at failure time gets the busy sentence, verbatim', () => {
    // chat.js:296-299 — the parity string, shared from core.en.mjs.
    const e = classifyThrown(new TypeError('Failed to fetch'));
    const d = describe(e, t, { busy: { label: 'switching to gemma4:12b', percent: 40 } });
    assert.equal(d.body, '⏳ The server is busy: switching to gemma4:12b. Try again in a moment.');
    assert.equal(d.title, 'The server is busy');
  });

  test('describe(): busy wins over every kind, including seats_full', () => {
    const e = classifyHttp({ status: 429, headers: {}, bodyText: body('seats-full.json') });
    const d = describe(e, t, { busy: { label: 'pulling a model' } });
    assert.match(d.body, /^⏳ The server is busy: pulling a model\./);
  });

  test('describe(): with no busy label the farm sentence is the body', () => {
    const e = classifyHttp({ status: 429, headers: { 'retry-after': '30' }, bodyText: body('seats-full.json') });
    const d = describe(e, t, { busy: null });
    assert.equal(d.title, 'The farm is full');
    assert.equal(d.body, e.farmMessage);
  });

  test('describe(): a refused password keeps OUR line — LiteLLM never says where to fix it', () => {
    const e = classifyHttp({ status: 400, headers: {}, bodyText: body('litellm-auth-400.json'), requiresKey: true });
    assert.equal(e.kind, 'auth');
    assert.ok(e.farmMessage, 'the farm did write a sentence');
    const d = describe(e, t, { busy: null });
    assert.equal(d.title, 'The farm refused the password');
    assert.match(d.body, /^The farm did not accept the password this client is sending\./);
    assert.match(d.body, /Preferences → Connection/, 'the only line that says how to fix it survives');
    assert.ok(d.body.includes(e.farmMessage), "the farm's own words are kept for whoever runs the farm");
  });

  test('describe(): a kind with no farm message falls back to our own string', () => {
    const d = describe(classifyThrown(new TypeError('Failed to fetch')), t, {});
    assert.equal(d.title, 'The farm is unreachable');
    assert.match(d.body, /No answer from the farm \(Failed to fetch\)/);
    assert.ok(!d.body.includes('{'), 'every placeholder was filled');
  });

  test('describe(): null and unknown kinds degrade to the http strings', () => {
    const d = describe(null, t, {});
    assert.equal(d.title, 'The farm refused the request');
    assert.ok(!d.title.startsWith('net.'), 'the string is registered, not echoed back as its key');
  });

  test('describe(): every kind has a registered title and body', () => {
    const kinds = ['seats_full', 'upstream_down', 'auth', 'key_missing', 'context_overflow',
      'vision_unsupported', 'stream_error', 'network', 'aborted', 'http'];
    for (const kind of kinds) {
      const d = describe({ kind, status: 400, code: null, message: 'x', farmMessage: null, retryAfter: 30 }, t, {});
      assert.ok(d.title && !d.title.includes('.'), `${kind}: title`);
      assert.ok(d.body && !d.body.includes('{'), `${kind}: body has no unfilled placeholder`);
    }
  });
};
