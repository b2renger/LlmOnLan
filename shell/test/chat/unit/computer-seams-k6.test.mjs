// K6 kickoff (LOLCHAT_PLAN 2.6 KF): the SEAMS between the three K6 units, owned by the integrator.
// Each unit tests its own module; this file pins only what crosses a unit boundary — the catalogue
// rows and the three PartSpec declarations (modelOf / holds / adopt), the resolver's frozen answers
// and codes, the drop classifier the router and the canvas share, the extractor's wire contract
// against the mock farm, and the mock's capability rows — so a unit that breaks a seam goes red
// HERE, not at the landing.
import assert from 'node:assert/strict';

import { specMap, partSpecs, paletteCatalogue, holderOf } from '../../../renderer/chat/graph/parts/index.mjs';
import { MEDIA_KINDS, CAP_NAMES, AUDIO_SEND, NATIVE_PDF_SEND, WHY, takesFor, modelCaps, consumersOf, reasonFor } from '../../../renderer/chat/graph/takes.mjs';
import { classify, looksLikeGraph, TEXT_EXTS } from '../../../renderer/chat/graph/drop-route.mjs';
import { readPages, extractDoc } from '../../../renderer/chat/net/extract.mjs';
import { readModelGroupInfo, CAPS_EVENT } from '../../../renderer/chat/app/caps.mjs';
import { MEDIA_OWNER } from '../../../renderer/chat/computer/media.mjs';
import { DOC_MAX_BYTES, DOC_MAX_PAGES, DOC_MAX_CHARS } from '../../../renderer/chat/graph/parts/document.mjs';
import { AUDIO_MAX_BYTES, AUDIO_MAX_SEC } from '../../../renderer/chat/graph/parts/audio.mjs';
import { API_KEYS, KV_KEYS } from '../../../renderer/chat/core/types.mjs';
import { hasKey } from '../../../renderer/chat/core/i18n.mjs';
import '../../../renderer/chat/strings/drops.en.mjs';
import { startMock } from '../../mock/index.js';
import { modelGroupInfo } from '../../mock/scenario-models.js';

const SPECS = specMap();

/** A FarmView a test can dial: `caps[model][name]` → verdict, anything absent → unknown. */
function view(o = {}) {
  const caps = o.caps || {};
  return {
    present: o.present !== false,
    engine: o.engine === undefined ? 'ollama' : o.engine,
    ocr: !!o.ocr,
    defaultModel: o.defaultModel || 'gemma4:12b',
    models: Object.keys(caps),
    cap: (/** @type {string} */ m, /** @type {string} */ n) => (caps[m] && caps[m][n]) || 'unknown',
    underlyingOf: (/** @type {string} */ a) => a,
  };
}

/** image/sound box `src` wired into Instructions asking `models`. */
function graph(srcType, models) {
  const parts = [{ id: 'src', type: srcType, settings: {} }];
  const wires = [];
  models.forEach((m, i) => {
    parts.push({ id: `ask${i}`, type: 'ask', settings: { model: m } });
    wires.push({ id: `w${i}`, from: 'src', to: `ask${i}`, port: 'in' });
  });
  return { parts, wires };
}

export default (test) => {
  test('KF-4: Document and Sound sit in "bring in" after Image, with words, glyphs and search words', () => {
    const types = partSpecs().map((s) => s.type);
    assert.equal(types.indexOf('document'), types.indexOf('image') + 1);
    assert.equal(types.indexOf('audio'), types.indexOf('document') + 1);
    const rows = paletteCatalogue().parts.filter((p) => p.type === 'document' || p.type === 'audio');
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.group, 'bring', `${r.type} is under Bring in`);
      assert.ok(r.desc.length > 10 && r.keywords.length >= 3, `${r.type} says what it does and is findable`);
    }
    assert.ok(rows.find((r) => r.type === 'document').keywords.includes('pdf'));
    assert.ok(rows.find((r) => r.type === 'audio').keywords.includes('audio'));
  });

  test('KF-4: holds/adopt/modelOf — declared, never known by type name elsewhere', () => {
    assert.equal(holderOf('image'), 'image');
    assert.equal(holderOf('pdf'), 'document');
    assert.equal(holderOf('audio'), 'audio');
    assert.equal(holderOf('text'), 'note');
    assert.equal(holderOf('video'), null);
    assert.deepEqual(partSpecs().filter((s) => typeof s.modelOf === 'function').map((s) => s.type), ['ask'],
      'only the Instruction sends what arrives to a model');
    const payloads = {
      text: { text: 'hello', name: 'a.txt' },
      image: { dataUrl: 'data:image/png;base64,AA', name: 'p.png', w: 2, h: 3 },
      pdf: { fileId: 'f1', name: 'a.pdf', mime: 'application/pdf', size: 10, sha256: 'ab' },
      audio: { fileId: 'f2', name: 'a.wav', mime: 'audio/wav', size: 10, sha256: 'cd', durationSec: 2 },
    };
    for (const kind of Object.keys(payloads)) {
      const spec = SPECS.get(holderOf(kind));
      assert.equal(typeof spec.adopt, 'function', `${spec.type} adopts a dropped ${kind}`);
      const settings = spec.adopt(payloads[kind]);
      const keys = Object.keys(spec.defaults());
      for (const k of Object.keys(settings)) assert.ok(keys.includes(k), `${spec.type}.adopt → '${k}' is a settings key, so it survives export`);
    }
    assert.equal(SPECS.get('ask').modelOf({ settings: { model: 'mock-hears' } }), 'mock-hears');
    assert.equal(SPECS.get('ask').modelOf({ settings: {} }), '');
  });

  test('KF-5/KF-6: the frozen caps and the file store owner', () => {
    assert.equal(MEDIA_OWNER, 'computer:media');
    assert.equal(DOC_MAX_BYTES, 32 * 1024 * 1024);
    assert.equal(DOC_MAX_PAGES, 60);
    assert.equal(DOC_MAX_CHARS, 200000);
    assert.equal(AUDIO_MAX_BYTES, 25 * 1024 * 1024);
    assert.equal(AUDIO_MAX_SEC, 600);
    assert.deepEqual([...API_KEYS.media], ['put', 'get', 'bytes', 'patch', 'sweep', 'debug']);
    assert.deepEqual([...API_KEYS.drops], ['route', 'hint', 'debug']);
    assert.equal(KV_KEYS.cap('f', 'm', 'audio'), 'cap:f:m:audio');
    assert.equal(KV_KEYS.cap('f', 'm', 'vision'), KV_KEYS.vision('f', 'm'), 'one row shape for every capability');
  });

  test('KF-2: audio and native PDF are NOT sent this phase; the capability names are frozen', () => {
    assert.equal(AUDIO_SEND, false);
    assert.equal(NATIVE_PDF_SEND, false);
    assert.deepEqual([...CAP_NAMES], ['vision', 'audio', 'pdf']);
    assert.deepEqual([...MEDIA_KINDS], ['image', 'pdf', 'audio', 'text']);
    assert.equal(CAPS_EVENT, 'caps:change');
  });

  test('KF-3: a PDF is decided by the FARM (its extractor), not by the wiring', () => {
    const d = { parts: [{ id: 'src', type: 'document', settings: {} }], wires: [] };
    assert.equal(takesFor(d, 'src', 'pdf', view({ present: false }), SPECS).state, 'unknown');
    const off = takesFor(d, 'src', 'pdf', view({ ocr: false }), SPECS);
    assert.equal(off.state, 'no');
    assert.equal(off.why, WHY.noOcr);
    assert.match(off.reason, /document reading/i);
    const on = takesFor(d, 'src', 'pdf', view({ ocr: true }), SPECS);
    assert.equal(on.state, 'yes');
    assert.equal(on.why, WHY.ocr);
  });

  test('KF-3: a picture is decided by the models it is wired to — the worst one wins', () => {
    const v = view({ caps: { seer: { vision: 'yes' }, blind: { vision: 'no' } } });
    assert.equal(takesFor(graph('image', []), 'src', 'image', v, SPECS).state, 'unwired');
    assert.equal(takesFor(graph('image', ['seer']), 'src', 'image', v, SPECS).state, 'yes');
    const unsure = takesFor(graph('image', ['mystery']), 'src', 'image', v, SPECS);
    assert.equal(unsure.state, 'unknown', 'absent is UNKNOWN, never no (build rule 7)');
    assert.equal(unsure.why, WHY.visionUnknown);
    const mixed = takesFor(graph('image', ['seer', 'blind']), 'src', 'image', v, SPECS);
    assert.equal(mixed.state, 'no');
    assert.equal(mixed.model, 'blind');
    assert.match(mixed.reason, /blind/);
    assert.deepEqual(mixed.consumers.map((c) => c.state), ['yes', 'no']);
    // '' is the farm default
    assert.equal(takesFor(graph('image', ['']), 'src', 'image', view({ defaultModel: 'seer', caps: { seer: { vision: 'yes' } } }), SPECS).model, 'seer');
  });

  test('KF-3: sound is never sent this phase — and the sentence says the TRUE reason', () => {
    const d = graph('audio', ['gemma4:12b']);
    const ollama = takesFor(d, 'src', 'audio', view({ engine: 'ollama' }), SPECS);
    assert.equal(ollama.state, 'no');
    assert.equal(ollama.why, WHY.engineNoAudio, 'the Ollama engine drops sound whatever the model says');
    const llama = takesFor(d, 'src', 'audio', view({ engine: 'llama.cpp' }), SPECS);
    assert.equal(llama.why, WHY.audioUnreported, 'nobody said it can listen — not "it cannot"');
    const says = takesFor(graph('audio', ['mock-hears']), 'src', 'audio', view({ engine: 'llama.cpp', caps: { 'mock-hears': { audio: 'yes' } } }), SPECS);
    assert.equal(says.state, 'no');
    assert.equal(says.why, WHY.audioUnverified);
    assert.match(says.reason, /mock-hears/);
    assert.equal(takesFor(graph('audio', []), 'src', 'audio', view({}), SPECS).state, 'unwired');
  });

  test('KF-3: every why code has a real sentence; consumersOf reads the declaration only', () => {
    for (const why of Object.values(WHY)) {
      const r = reasonFor(why, 'm1');
      if (why === WHY.text) { assert.equal(r, null); continue; }
      assert.ok(r && r.length > 20 && !r.startsWith('takes.'), `${why} → a sentence, not a key: ${r}`);
    }
    for (const k of ['takes.label', 'takes.modelLine', 'drops.hint', 'drops.refusedKind', 'drops.refusedNoDoc',
      'parts.docLabel', 'parts.docEmpty', 'parts.audioLabel', 'parts.audioEmpty', 'parts.audioValue',
      'parts.mediaTooBig', 'parts.mediaUnreadable', 'parts.mediaMissing']) assert.ok(hasKey(k), `${k} is registered`);
    const d = { parts: [{ id: 'a', type: 'image' }, { id: 'b', type: 'note' }, { id: 'c', type: 'ask', settings: { model: 'x' } }],
      wires: [{ from: 'a', to: 'b', port: 'in' }, { from: 'a', to: 'c', port: 'in' }, { from: 'a', to: 'c', port: 'in' }] };
    assert.deepEqual(consumersOf(d, 'a', SPECS), [{ partId: 'c', model: 'x' }], 'a Text box is not a model; a doubled wire counts once');
    assert.deepEqual(modelCaps(view({ caps: { x: { vision: 'yes' } } }), 'x'), { model: 'x', vision: 'yes', audio: 'unknown', pdf: 'unknown' });
  });

  test('KF-7: the drop classifier picks the box from name and type alone', () => {
    const k = (name, type) => classify({ name, type, size: 10 }).kind;
    assert.equal(k('paper.pdf', ''), 'pdf');
    assert.equal(k('scan', 'application/pdf'), 'pdf');
    assert.equal(k('a.png', 'image/png'), 'image');
    assert.equal(k('talk.m4a', ''), 'audio');
    assert.equal(k('talk.bin', 'audio/mpeg'), 'audio');
    for (const ext of TEXT_EXTS) assert.equal(k(`notes.${ext}`, ''), 'text', ext);
    assert.equal(k('my.lolgraph.json', 'application/json'), 'graph');
    assert.equal(classify({ name: 'x.json', type: '' }).maybeGraph, true);
    assert.equal(k('setup.exe', 'application/x-msdownload'), 'none');
    assert.equal(k('archive.zip', 'application/zip'), 'none');
    assert.equal(looksLikeGraph('{"lolgraph": 4, "parts": []}'), true);
    assert.equal(looksLikeGraph('{"rows": []}'), false);
  });

  test('KF-1(a): the capability catalogue — only an explicit boolean is a verdict; the mock has a row per answer', () => {
    const rows = modelGroupInfo({ state: {} }).data;
    const row = (id) => rows.find((r) => r.model_group === id);
    assert.equal(row('mock-hears').supports_audio_input, true);
    assert.equal(row('mock-reads-pdf').supports_pdf_input, true);
    assert.deepEqual(row('mock-nocaps'), { model_group: 'mock-nocaps' }, 'a row that says nothing');
    const verdicts = readModelGroupInfo({ data: rows });
    assert.equal(verdicts.find((v) => v.underlying === 'mock-nocaps'), undefined, 'silence is not a verdict');
    assert.equal(verdicts.find((v) => v.underlying === 'gemma4:12b').vision, 'yes');
  });

  test('KF-5: the extractor contract, end to end against the mock farm (PUT /process, Bearer, X-Filename)', async () => {
    const mock = await startMock({ port: 0, keyedPort: 0, servicesPort: 0, httpPort: 0, quiet: true });
    try {
      await fetch(`${mock.urls.services}/mock/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ocrDelayMs: 0 }) });
      const url = `${mock.urls.services}/ocr`;
      const bytes = new TextEncoder().encode('%PDF-1.4 mock bytes').buffer;
      const ok = await extractDoc({ url, key: 'mock-extract-key', bytes, name: 'pages-3.pdf', mime: 'application/pdf' });
      assert.ok('pages' in ok, JSON.stringify(ok));
      assert.deepEqual(ok.pages.map((p) => p.page), [1, 2, 3]);
      assert.match(ok.pages[1].text, /Page 2 of pages-3\.pdf/);
      const bad = await extractDoc({ url, key: 'wrong', bytes, name: 'a.pdf', mime: 'application/pdf' });
      assert.equal(bad.code, 'unauthorized');
      const odd = await extractDoc({ url, key: 'mock-extract-key', bytes, name: 'a.wav', mime: 'audio/wav' });
      assert.equal(odd.code, 'unsupported');
      assert.equal((await extractDoc({ url: '', key: null, bytes, name: 'a.pdf', mime: 'application/pdf' })).code, 'no-ocr');
      const log = await (await fetch(`${mock.urls.services}/mock/log?path=/ocr/process`)).json();
      assert.equal(log.length, 3);
      assert.equal(log[0].headers.authorization, 'Bearer mock-extract-key');
      assert.equal(log[0].headers['x-filename'], 'pages-3.pdf');
      assert.equal(log[0].bytes, bytes.byteLength);
    } finally {
      await mock.close();
      // Windows + Node 24: exiting while undici is still closing a keep-alive socket to a server we
      // just closed trips a libuv assertion (src/win/async.c:76) AFTER every test passed. A short
      // settle lets the sockets finish closing; measured: 0 ms crashes, 20 ms does not.
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.deepEqual(readPages([{ page_content: 'b', metadata: { page: 2, engine: 'ocr' } }, { page_content: 'x' }]),
      [{ page: 2, text: 'b', engine: 'ocr' }, { page: 2, text: 'x', engine: '?' }]);
  });
};
