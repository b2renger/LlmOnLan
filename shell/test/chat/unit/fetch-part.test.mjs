// @ts-check
// The Fetch box's renderer half (ecosystem plan v2 §4.2): what an answer becomes, what a refusal
// says, and that the last copy covers ONLY a network failure. The GET itself — the refusals, the
// redirect re-check, the cap — is io.ts's, tested against the compiled main in shell-main.test.mjs.
import assert from 'node:assert/strict';
import { fetchPart, valueFromAnswer, fetchError } from '../../../renderer/chat/graph/parts/fetch.mjs';

/** Run the part with a fake window.lol.io door answering `answer`. */
async function runWith(answer, part) {
  const saved = globalThis.window;
  /** @type {any} */ (globalThis).window = { lol: { io: { get: async () => answer } } };
  try {
    return await fetchPart.run(/** @type {any} */ ({ part, inputs: {}, signal: new AbortController().signal }));
  } finally {
    /** @type {any} */ (globalThis).window = saved;
  }
}

export default (test) => {
  test('fetch: a JSON answer is a JSON value, a top-level array a list, HTML is tagged, the rest is text', () => {
    assert.deepEqual(valueFromAnswer({ text: '{"hits":[{"title":"a"}]}', contentType: 'application/json' }),
      { kind: 'json', data: { hits: [{ title: 'a' }] } });
    assert.equal(valueFromAnswer({ text: '[1,2,3]', contentType: 'text/plain' }).kind, 'list', 'JSON sniffed from text/plain');
    assert.deepEqual(valueFromAnswer({ text: '<p>hi</p>', contentType: 'text/html; charset=utf-8' }),
      { kind: 'text', data: '<p>hi</p>', format: 'html' });
    assert.deepEqual(valueFromAnswer({ text: '{broken', contentType: 'application/json' }), { kind: 'text', data: '{broken' },
      'a body that only claims to be JSON is handed on as text');
  });

  test('fetch: every refusal has its own sentence; an unknown code reads as a network failure', () => {
    assert.match(fetchError({ code: 'E_LOCAL' }), /this computer/);
    assert.match(fetchError({ code: 'E_HTTP', status: 503 }), /503/);
    assert.match(fetchError({ code: 'E_SIZE' }), /1 MB/);
    assert.match(fetchError({ code: 'E_WHAT', message: 'x' }), /could not be reached/);
  });

  test('fetch: offline keeps the last copy; a refusal or an HTTP error never does', async () => {
    const prev = { kind: 'json', data: { hits: [] } };
    const part = { id: 'f1', type: 'fetch', settings: { url: 'https://example.org/x.json' }, value: prev };
    assert.deepEqual(await runWith({ ok: false, code: 'E_NET', message: 'ENOTFOUND' }, part), prev, 'no network: the copy');
    assert.deepEqual(await runWith({ ok: false, code: 'E_TIMEOUT', message: '' }, part), prev);
    await assert.rejects(runWith({ ok: false, code: 'E_LOCAL', message: '' }, part), /this computer/);
    await assert.rejects(runWith({ ok: false, code: 'E_HTTP', status: 404, message: '' }, part), /404/);
    await assert.rejects(runWith({ ok: false, code: 'E_NET', message: 'x' }, { ...part, value: undefined }), /could not be reached/,
      'nothing to fall back on: the failure is reported');
    assert.deepEqual(await runWith({ ok: true, url: 'https://example.org/x.json', status: 200, contentType: 'application/json', text: '{"a":1}', bytes: 7 }, part),
      { kind: 'json', data: { a: 1 } });
    await assert.rejects(runWith({ ok: true }, { ...part, settings: { url: '  ' } }), /web address first/);
  });
};
