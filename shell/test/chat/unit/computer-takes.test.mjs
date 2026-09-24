// K6-U1 (LOLCHAT_PLAN 2.6 KF-2, KF-3): the capability model, in Node.
//   - app/caps.mjs: the catalogue read keeps vision, sound and PDF input — ONLY from an explicit
//     boolean — remembers each under KV_KEYS.cap, forgets a claim the farm stopped making, tells
//     the lines (CAPS_EVENT) on every bus that draws one;
//   - graph/takes.mjs: the pure resolver's whole table (KF-3), worst consumer first;
//   - graph/takes-view.mjs: the "takes:" line and the Instruction's model line, drawn with the
//     runner's DOM shim, repainting on a wiring edit, a farm change and a catalogue read;
//   - graph/parts/image.mjs: the Image box carries the line.
// The same paths a person takes run in the real browser in chat-harness/scenarios/k6-takes.mjs.
import assert from 'node:assert/strict';

import {
  readModelGroupInfo, createCaps, relayCapsTo, CAPS_EVENT, CAP_FIELDS,
} from '../../../renderer/chat/app/caps.mjs';
import {
  takesFor, farmViewOf, modelCaps, reasonFor, consumersOf, WHY, AUDIO_SEND,
} from '../../../renderer/chat/graph/takes.mjs';
import { renderTakes, modelCapsLine } from '../../../renderer/chat/graph/takes-view.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { createBus, EV } from '../../../renderer/chat/core/events.mjs';
import { KV_KEYS } from '../../../renderer/chat/core/types.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';

const SPECS = specMap();
const FARM_ID = 'farm-k6';
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` with the unit runner's DOM shim installed as `globalThis.document`. */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = 'document' in globalThis;
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete /** @type {any} */ (globalThis).document;
  }
}

/** A FarmView a test can dial: `caps[model][name]` → verdict, anything absent → unknown. */
function view(o = {}) {
  const caps = o.caps || {};
  const under = o.under || {};
  return {
    present: o.present !== false,
    engine: o.engine === undefined ? 'llama.cpp' : o.engine,
    ocr: !!o.ocr,
    defaultModel: o.defaultModel === undefined ? 'assistant' : o.defaultModel,
    models: Object.keys(caps),
    cap: (/** @type {string} */ m, /** @type {string} */ n) => (caps[m] && caps[m][n]) || 'unknown',
    underlyingOf: (/** @type {string} */ a) => under[a] || a,
  };
}

/** `src` (a box of `srcType`) wired into one Instruction per entry of `models`. */
function graph(srcType, models) {
  const parts = [{ id: 'src', type: srcType, settings: {} }];
  const wires = [];
  models.forEach((m, i) => {
    parts.push({ id: `ask${i}`, type: 'ask', settings: { model: m } });
    wires.push({ id: `w${i}`, from: 'src', to: `ask${i}`, port: 'in' });
  });
  return { parts, wires };
}

/** An App with a real bus, a kv map, a farm whose caps can be swapped, and (optionally) a host
 * session holding `doc`. `farm.cap` goes through the resolver a test installs, like net/farm.mjs. */
function stubApp(o = {}) {
  const bus = createBus();
  /** @type {Map<string, any>} */ const kv = new Map();
  let farmCaps = {
    present: true, id: FARM_ID, baseUrl: 'http://10.0.0.5:4000/v1', proxyRoot: 'http://10.0.0.5:4000',
    apiKey: 'pw', keyMissing: false, defaultModel: 'assistant', engine: 'llama.cpp', ocr: null,
    models: [
      { id: 'assistant', underlying: 'Qwen3.8-27B', default: true },
      { id: 'gemma4:12b', underlying: 'gemma4:12b', default: false },
    ],
    ...(o.caps || {}),
  };
  /** @type {Function|null} */ let resolver = null;
  let doc = o.doc || { parts: [], wires: [] };
  const app = /** @type {any} */ ({
    bus,
    repo: {
      kvGet: async (/** @type {string} */ k, /** @type {any} */ d) => (kv.has(k) ? kv.get(k) : d),
      kvSet: async (/** @type {string} */ k, /** @type {any} */ v) => { kv.set(k, v); },
    },
    farm: {
      get: () => farmCaps,
      headers: () => ({ authorization: 'Bearer pw' }),
      modelInfo: (/** @type {string} */ id) => farmCaps.models.find((m) => m.id === id) || null,
      setCapResolver: (/** @type {Function} */ fn) => { resolver = fn; },
      cap: (/** @type {string} */ m, /** @type {string} */ n) => {
        const v = resolver ? resolver(m, n) : 'unknown';
        return v === 'yes' || v === 'no' ? v : 'unknown';
      },
    },
    host: { session: { doc: () => doc, specs: SPECS } },
  });
  return {
    app, bus, kv,
    setFarm: (/** @type {any} */ patch) => { farmCaps = { ...farmCaps, ...patch }; bus.emit(EV.FARM_CHANGE, { caps: farmCaps, changed: Object.keys(patch) }); },
    setDoc: (/** @type {any} */ d) => { doc = d; },
    useResolver: (/** @type {Function} */ fn) => { resolver = fn; },
  };
}

/** Replace fetch with a catalogue answer for the length of `fn`. */
async function withCatalogue(rows, fn) {
  const real = globalThis.fetch;
  let gets = 0;
  globalThis.fetch = async () => { gets++; return new Response(JSON.stringify({ data: typeof rows === 'function' ? rows() : rows }), { status: 200 }); };
  try { return await fn(() => gets); } finally { globalThis.fetch = real; }
}

/** Count CAPS_EVENTs on a bus. */
function countCaps(bus) {
  const seen = [];
  const off = bus.on(CAPS_EVENT, (p) => seen.push(p));
  return { seen, off };
}

export default (test) => {
  // ---- app/caps.mjs: the catalogue ---------------------------------------------------------

  test('readModelGroupInfo keeps sound and PDF input only from an explicit boolean, and never adds a key a row did not state', () => {
    const rows = readModelGroupInfo({
      data: [
        { model_group: 'gemma4:12b', supports_vision: true },
        { model_group: 'hears', supports_vision: false, supports_audio_input: true },
        { model_group: 'reads', supports_pdf_input: false },
        { model_group: 'strings', supports_vision: 'true', supports_audio_input: 'yes', supports_pdf_input: 1 },
        { model_group: 'nulls', supports_vision: null, supports_audio_input: null },
        { model_group: 'silent' },
      ],
    });
    assert.deepEqual(rows, [
      { underlying: 'gemma4:12b', vision: 'yes' },
      { underlying: 'hears', vision: 'no', audio: 'yes' },
      { underlying: 'reads', pdf: 'no' },
    ], 'a string, a number or a null is not a verdict; a row that states nothing is not listed');
    assert.deepEqual({ ...CAP_FIELDS }, { vision: 'supports_vision', audio: 'supports_audio_input', pdf: 'supports_pdf_input' });
  });

  test('one GET teaches all three capabilities; each is remembered under KV_KEYS.cap and announced once', async () => {
    const { app, bus, kv } = stubApp();
    const events = countCaps(bus);
    await withCatalogue([
      { model_group: 'assistant', supports_vision: false, supports_audio_input: true },
      { model_group: 'gemma4:12b', supports_vision: true, supports_pdf_input: true },
    ], async (gets) => {
      const caps = createCaps(app);
      assert.equal(await caps.probe(), true);
      assert.equal(gets(), 1, 'one catalogue read answers every capability');
      assert.equal(caps.resolver('assistant', 'audio'), 'yes');
      assert.equal(caps.resolver('assistant', 'pdf'), 'unknown', 'not stated → unknown, never no');
      assert.equal(caps.resolver('gemma4:12b', 'pdf'), 'yes');
      assert.equal(caps.resolver('gemma4:12b', 'audio'), 'unknown');
      assert.equal(caps.resolver('gemma4:12b', 'vision'), 'yes');
      assert.equal(caps.resolver('gemma4:12b', 'tools'), 'unknown', 'a name it does not keep is unknown');
      assert.equal(caps.resolver('gemma4:12b', 'constructor'), 'unknown', 'and an object key is not a capability');
      await tick();
      assert.equal(kv.get(KV_KEYS.cap(FARM_ID, 'assistant', 'audio')), 'yes');
      assert.equal(kv.get(KV_KEYS.cap(FARM_ID, 'gemma4:12b', 'pdf')), 'yes');
      assert.equal(kv.get(KV_KEYS.vision(FARM_ID, 'gemma4:12b')), 'yes', 'vision is the same row S0 wrote');
      assert.equal(kv.has(KV_KEYS.cap(FARM_ID, 'assistant', 'pdf')), false, 'nothing is written for what was not said');
      assert.equal(events.seen.length, 1, 'one successful read → one CAPS_EVENT');
      assert.deepEqual(events.seen[0], { farmId: FARM_ID });
      assert.deepEqual(caps.debug.all().audio, { assistant: 'yes' });
    });
  });

  test('a failed read announces nothing and leaves every capability unknown', async () => {
    const { app, bus } = stubApp();
    const events = countCaps(bus);
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response('nope', { status: 502 });
    try {
      const caps = createCaps(app);
      assert.equal(await caps.probe(), false);
      for (const name of ['vision', 'audio', 'pdf']) assert.equal(caps.resolver('assistant', name), 'unknown');
      assert.equal(events.seen.length, 0);
    } finally { globalThis.fetch = real; }
  });

  test('a farm that STOPS saying a model listens or reads PDFs loses the old yes — memory and store', async () => {
    const { app, kv, setFarm } = stubApp();
    let rows = [{ model_group: 'assistant', supports_vision: true, supports_audio_input: true, supports_pdf_input: true }];
    await withCatalogue(() => rows, async (gets) => {
      const caps = createCaps(app);
      await caps.probe();
      assert.equal(caps.resolver('assistant', 'audio'), 'yes');
      await tick();
      assert.equal(kv.get(KV_KEYS.cap(FARM_ID, 'assistant', 'audio')), 'yes');

      rows = [{ model_group: 'assistant', supports_vision: true }];
      setFarm({ models: [{ id: 'assistant', underlying: 'Qwen3.8-27B', default: true }] }); // a new signature
      assert.equal(await caps.probe(), true);
      assert.equal(gets(), 2);
      assert.equal(caps.resolver('assistant', 'audio'), 'unknown', 'the farm no longer says it — so we do not either');
      assert.equal(caps.resolver('assistant', 'pdf'), 'unknown');
      assert.equal(caps.resolver('assistant', 'vision'), 'yes');
      await tick();
      assert.equal(kv.get(KV_KEYS.cap(FARM_ID, 'assistant', 'audio')), null, 'the stored row is cleared, not left to come back on reload');

      // A fresh window with that store knows nothing about sound.
      const next = createCaps(app);
      await next.primeFromStore();
      assert.equal(next.resolver('assistant', 'audio'), 'unknown');
    });
  });

  test('primeFromStore reads all three verdicts under the alias AND the underlying model, and repaints only when it learnt something', async () => {
    const { app, bus, kv } = stubApp();
    kv.set(KV_KEYS.cap(FARM_ID, 'assistant', 'audio'), 'no');
    kv.set(KV_KEYS.cap(FARM_ID, 'Qwen3.8-27B', 'vision'), 'yes');
    kv.set(KV_KEYS.cap(FARM_ID, 'gemma4:12b', 'pdf'), 'maybe');   // junk is not a verdict
    const events = countCaps(bus);
    const caps = createCaps(app);
    await caps.primeFromStore();
    assert.equal(caps.resolver('assistant', 'audio'), 'no');
    assert.equal(caps.resolver('Qwen3.8-27B', 'vision'), 'yes');
    assert.equal(caps.resolver('gemma4:12b', 'pdf'), 'unknown');
    assert.equal(caps.debug.probes(), 0, 'no network');
    assert.equal(events.seen.length, 1, 'what the last window knew repaints the lines, even with the farm unreachable');
    await caps.primeFromStore();
    assert.equal(events.seen.length, 1, 'a prime that learnt nothing new says nothing');
  });

  test('CAPS_EVENT reaches every surface bus once: the installing App, and a bus relayed to it', async () => {
    const { app, bus } = stubApp();
    const other = createBus();
    const mine = countCaps(bus);
    const theirs = countCaps(other);
    const undoOther = relayCapsTo(other);
    const undoSame = relayCapsTo(bus);          // the Computer booted alone: its bus IS the caps bus
    try {
      await withCatalogue([{ model_group: 'assistant', supports_vision: false }], async () => {
        const caps = createCaps(app);
        await caps.probe();
        assert.equal(mine.seen.length, 1, 'the installing bus hears it once, not twice');
        assert.equal(theirs.seen.length, 1, 'the other surface hears it too');
        caps.downgrade('gemma4:12b');
        assert.equal(mine.seen.length, 2);
        assert.equal(theirs.seen.length, 2, 'a downgrade is announced everywhere as well');
      });
    } finally { undoOther(); undoSame(); }
    assert.equal(relayCapsTo(null)(), undefined, 'a missing bus is a no-op');
  });

  // ---- graph/takes.mjs: the resolver -----------------------------------------------------------

  test('farmViewOf reads app.farm only, and turns anything but yes/no into unknown', () => {
    const { app, useResolver } = stubApp({ caps: { defaultModel: null, ocr: { url: 'http://10.0.0.5:5055', key: 'k' } } });
    useResolver((/** @type {string} */ m, /** @type {string} */ n) => (m === 'assistant' && n === 'vision' ? 'no' : 'perhaps'));
    const v = farmViewOf(app);
    assert.equal(v.present, true);
    assert.equal(v.engine, 'llama.cpp');
    assert.equal(v.ocr, true);
    assert.equal(v.defaultModel, 'assistant', 'no defaultModel → the catalogue row marked default');
    assert.deepEqual(v.models, ['assistant', 'gemma4:12b']);
    assert.equal(v.cap('assistant', 'vision'), 'no');
    assert.equal(v.cap('assistant', 'audio'), 'unknown', 'a resolver answering nonsense is unknown');
    assert.equal(v.underlyingOf('assistant'), 'Qwen3.8-27B');
    assert.equal(v.underlyingOf('elsewhere'), 'elsewhere');

    const none = farmViewOf({});
    assert.equal(none.present, false);
    assert.equal(none.ocr, false);
    assert.equal(none.cap('x', 'vision'), 'unknown');
    assert.equal(farmViewOf(null).present, false);
  });

  test('modelCaps asks the alias AND the underlying model: a no from either is no, a yes needs no no', () => {
    const v = view({
      under: { assistant: 'Qwen' },
      caps: { assistant: { vision: 'yes', audio: 'yes' }, Qwen: { vision: 'no', pdf: 'yes' } },
    });
    assert.deepEqual(modelCaps(v, 'assistant'), { model: 'assistant', vision: 'no', audio: 'yes', pdf: 'yes' });
    assert.deepEqual(modelCaps(v, ''), { model: 'assistant', vision: 'no', audio: 'yes', pdf: 'yes' }, "'' is the farm default");
    assert.deepEqual(modelCaps(view({ defaultModel: null }), ''), { model: '', vision: 'unknown', audio: 'unknown', pdf: 'unknown' });
  });

  test('KF-3 text and PDF: text always passes; a PDF is the FARM\'s question, whatever the wiring', () => {
    const text = takesFor(graph('note', []), 'src', 'text', view(), SPECS);
    assert.equal(text.state, 'yes');
    assert.equal(text.reason, null, 'nothing to say');
    for (const wired of [[], ['assistant']]) {
      const d = graph('document', wired);
      assert.equal(takesFor(d, 'src', 'pdf', view({ present: false }), SPECS).why, WHY.noFarm);
      assert.equal(takesFor(d, 'src', 'pdf', view({ present: false }), SPECS).state, 'unknown', 'no farm is not a no');
      assert.equal(takesFor(d, 'src', 'pdf', view({ ocr: false }), SPECS).state, 'no');
      const yes = takesFor(d, 'src', 'pdf', view({ ocr: true, caps: { assistant: { pdf: 'no' } } }), SPECS);
      assert.equal(yes.state, 'yes', 'a model\'s own PDF input does not matter: the farm reads it into text');
      assert.equal(yes.why, WHY.ocr);
    }
  });

  test('KF-3 pictures: unwired, no farm, and the worst consumer — no before unknown before yes', () => {
    const caps = { seer: { vision: 'yes' }, blind: { vision: 'no' } };
    const unwired = takesFor(graph('image', []), 'src', 'image', view({ caps }), SPECS);
    assert.equal(unwired.state, 'unwired');
    assert.match(unwired.reason, /Wire it into an Instruction/);

    const away = takesFor(graph('image', ['seer']), 'src', 'image', view({ present: false, caps }), SPECS);
    assert.equal(away.state, 'unknown');
    assert.equal(away.why, WHY.noFarm);
    assert.deepEqual(away.consumers, [{ partId: 'ask0', model: 'seer', state: 'unknown' }], 'with no farm nobody knows — not even about "seer"');

    const all = takesFor(graph('image', ['seer', 'mystery', 'blind']), 'src', 'image', view({ caps }), SPECS);
    assert.equal(all.state, 'no');
    assert.equal(all.model, 'blind');
    assert.deepEqual(all.consumers.map((c) => c.state), ['yes', 'unknown', 'no']);

    const unsure = takesFor(graph('image', ['seer', 'mystery']), 'src', 'image', view({ caps }), SPECS);
    assert.equal(unsure.state, 'unknown');
    assert.equal(unsure.model, 'mystery', 'the sentence names the model nobody vouched for');

    const yes = takesFor(graph('image', ['seer', 'seer']), 'src', 'image', view({ caps }), SPECS);
    assert.equal(yes.state, 'yes');
    assert.equal(yes.why, WHY.vision);
  });

  test('build rule 7, exhaustively: a picture is never refused on silence, and sound is never sent', () => {
    const verdicts = ['yes', 'no', 'unknown'];
    for (const a of verdicts) {
      for (const b of verdicts) {
        const caps = { m1: { vision: a, audio: a }, m2: { vision: b, audio: b } };
        const pic = takesFor(graph('image', ['m1', 'm2']), 'src', 'image', view({ caps }), SPECS);
        if (a !== 'no' && b !== 'no') assert.notEqual(pic.state, 'no', `vision ${a}/${b} must not be refused`);
        else assert.equal(pic.state, 'no');
        for (const engine of ['ollama', 'llama.cpp', 'external', null]) {
          const snd = takesFor(graph('audio', ['m1', 'm2']), 'src', 'audio', view({ engine, caps }), SPECS);
          assert.equal(AUDIO_SEND, false);
          assert.equal(snd.state, 'no', `sound ${a}/${b} on ${engine}: never sent this phase`);
          assert.ok(snd.reason && /not sent/.test(snd.reason), `and it says so: ${snd.reason}`);
          assert.ok(snd.consumers.every((c) => c.state === 'no'), 'no consumer is told it will get the sound');
        }
      }
    }
  });

  test('KF-3 sound: the engine first, then the models — and the sentence names the TRUE reason', () => {
    const caps = { hears: { audio: 'yes' }, deaf: { audio: 'no' } };
    const ollama = takesFor(graph('audio', ['hears']), 'src', 'audio', view({ engine: 'ollama', caps }), SPECS);
    assert.equal(ollama.why, WHY.engineNoAudio, 'Ollama drops the part whatever the model says (KF-1 b1)');
    assert.match(ollama.reason, /Ollama/);

    const refused = takesFor(graph('audio', ['hears', 'deaf']), 'src', 'audio', view({ caps }), SPECS);
    assert.equal(refused.why, WHY.noAudio);
    assert.equal(refused.model, 'deaf');

    const mixed = takesFor(graph('audio', ['hears', 'mystery']), 'src', 'audio', view({ engine: 'external', caps }), SPECS);
    assert.equal(mixed.why, WHY.audioUnreported, 'one model saying yes does not vouch for the other');
    assert.equal(mixed.model, 'mystery');
    assert.match(mixed.reason, /does not say mystery can listen/);

    const says = takesFor(graph('audio', ['hears']), 'src', 'audio', view({ caps }), SPECS);
    assert.equal(says.why, WHY.audioUnverified);
    assert.match(says.reason, /hears says it can listen/);
    assert.match(says.reason, /not yet verified/, 'the caution is LOL\'s, and the sentence says so');

    assert.equal(takesFor(graph('audio', []), 'src', 'audio', view({ caps }), SPECS).state, 'unwired');
    assert.equal(takesFor(graph('audio', ['hears']), 'src', 'audio', view({ present: false }), SPECS).why, WHY.noFarm);
  });

  test('the sentences: a no about seeing is the FARM\'s declaration; every refusal names its model and a way out', () => {
    const noVision = reasonFor(WHY.noVision, 'assistant');
    assert.match(noVision, /does not list assistant as able to see/);
    assert.doesNotMatch(noVision, /cannot see|can't see|is blind/, 'never claims more than the farm said');
    assert.match(noVision, /Pick a model that can see/);
    assert.match(reasonFor(WHY.noOcr, null), /Document OCR/, 'says who can switch it on, and where');
    assert.match(reasonFor(WHY.visionUnknown, null), /the model/, 'no model name → "the model", never "null"');
    for (const why of [WHY.noVision, WHY.visionUnknown, WHY.noAudio, WHY.audioUnreported, WHY.audioUnverified]) {
      assert.match(reasonFor(why, 'm-17'), /m-17/, `${why} names the model`);
    }
    assert.equal(reasonFor('not-a-code', 'm'), null);
    assert.deepEqual(consumersOf({ parts: [], wires: [{ from: 'src', to: 'ghost' }] }, 'src', SPECS), [], 'a wire to nothing is not a consumer');
  });

  // ---- graph/takes-view.mjs: the line -------------------------------------------------------

  test('renderTakes draws the frozen probes and follows the wiring, the farm and a catalogue read', async () => {
    await withDom(async (doc) => {
      const box = { id: 'pic', type: 'image', settings: {} };
      const ins = { id: 'ins', type: 'ask', settings: { model: 'assistant' } };
      const { app, bus, setDoc, setFarm, useResolver } = stubApp({ doc: { parts: [box, ins], wires: [] } });
      let verdicts = /** @type {Record<string, string>} */ ({});
      useResolver((/** @type {string} */ m, /** @type {string} */ n) => verdicts[`${m}:${n}`] || 'unknown');

      const line = renderTakes({ app, partId: 'pic', kind: 'image', doc });
      const el = line.el;
      const label = el.querySelector('.graph-takes-label');
      const why = el.querySelector('.graph-takes-why');
      assert.equal(el.getAttribute('data-kind'), 'image');
      assert.equal(el.getAttribute('data-state'), 'unwired');
      assert.equal(label.textContent, t('takes.label', { kind: t('takes.kindImage'), mark: t('takes.markUnwired') }));
      assert.equal(why.hidden, false, 'a state that is not yes SHOWS its sentence');
      assert.equal(why.textContent, t('takes.whyUnwired'));
      assert.match(label.getAttribute('aria-label'), /not wired/, 'the mark in words for a screen reader');

      // Wired into an Instruction the farm has said nothing about → unknown, named.
      setDoc({ parts: [box, ins], wires: [{ id: 'w', from: 'pic', to: 'ins', port: 'in' }] });
      line.refresh();
      assert.equal(el.getAttribute('data-state'), 'unknown');
      assert.match(why.textContent, /does not say whether assistant can see/);

      // The catalogue arrives (CAPS_EVENT) → no, with no refresh() call from the box.
      verdicts = { 'assistant:vision': 'no' };
      bus.emit(CAPS_EVENT, { farmId: FARM_ID });
      assert.equal(el.getAttribute('data-state'), 'no');
      assert.match(why.textContent, /does not list assistant as able to see/);

      // The farm moves (FARM_CHANGE): the default model changes under an Instruction on "auto".
      setDoc({ parts: [box, { ...ins, settings: { model: '' } }], wires: [{ id: 'w', from: 'pic', to: 'ins', port: 'in' }] });
      verdicts = { 'assistant:vision': 'no', 'gemma4:12b:vision': 'yes' };
      setFarm({ defaultModel: 'gemma4:12b' });
      assert.equal(el.getAttribute('data-state'), 'yes');
      assert.equal(why.hidden, true, 'a yes has nothing to explain on screen');
      assert.match(label.getAttribute('title'), /gemma4:12b can look at pictures/, 'but says it on hover');
      assert.equal(line.verdict().model, 'gemma4:12b');

      // Signature-guarded: a refresh that changes nothing touches nothing.
      const before = label.firstChild;
      line.refresh();
      bus.emit(EV.FARM_CHANGE, { changed: ['seats'] });
      assert.equal(label.firstChild, before, 'no repaint when nothing it says moved');

      // destroy() unsubscribes and removes the element.
      const host = doc.createElement('div');
      host.appendChild(el);
      line.destroy();
      assert.equal(host.childNodes.length, 0);
      verdicts = {};
      bus.emit(CAPS_EVENT, {});
      assert.equal(el.getAttribute('data-state'), 'yes', 'a destroyed line never repaints');
    });
  });

  test('renderTakes with no farm and no session is honest and quiet: unknown, or unwired', async () => {
    await withDom(async (doc) => {
      const pdf = renderTakes({ app: null, partId: 'x', kind: 'pdf', doc });
      assert.equal(pdf.el.getAttribute('data-state'), 'unknown');
      assert.match(pdf.el.querySelector('.graph-takes-why').textContent, /No farm is connected/);
      pdf.destroy();
      const snd = renderTakes({ app: {}, partId: 'x', kind: 'audio', doc });
      assert.equal(snd.el.getAttribute('data-state'), 'unwired');
      snd.destroy();
    });
  });

  test('modelCapsLine: shown only while a picture or a sound is wired in, and it says ? for what nobody said', () => {
    const img = { id: 'pic', type: 'image', settings: {} };
    const note = { id: 'n', type: 'note', settings: {} };
    const ins = { id: 'ins', type: 'ask', settings: { model: '' } };
    const { app, setDoc, useResolver, setFarm } = stubApp({ doc: { parts: [img, note, ins], wires: [{ from: 'n', to: 'ins', port: 'in' }] } });
    useResolver((/** @type {string} */ m, /** @type {string} */ n) => (m === 'assistant' && n === 'vision' ? 'no' : (m === 'assistant' && n === 'audio' ? 'yes' : 'unknown')));
    assert.equal(modelCapsLine(app, '', 'ins'), '', 'only text arrives: the Instruction stays the size it was');
    setDoc({ parts: [img, note, ins], wires: [{ from: 'n', to: 'ins', port: 'in' }, { from: 'pic', to: 'ins', port: 'in' }] });
    const line = modelCapsLine(app, '', 'ins');
    assert.equal(line, t('takes.modelLine', { model: 'assistant', vision: t('takes.markNo'), audio: t('takes.markYes'), pdf: t('takes.markUnknown') }));
    assert.equal(modelCapsLine(app, 'gemma4:12b'), t('takes.modelLine', { model: 'gemma4:12b', vision: '?', audio: '?', pdf: '?' }), 'no partId: the line for that model');
    setFarm({ present: false });
    assert.equal(modelCapsLine(app, '', 'ins'), '', 'no farm, nothing honest to say');
    assert.equal(modelCapsLine({}, '', 'ins'), '', 'no session yet');
  });

  // ---- graph/parts/image.mjs: the Image box carries the line --------------------------------

  test('the Image box shows "takes: picture", refreshes it on every update, and drops it on destroy', async () => {
    await withDom(async (doc) => {
      const part = { id: 'pic', type: 'image', settings: SPECS.get('image').defaults(), value: null, state: 'idle' };
      const ins = { id: 'ins', type: 'ask', settings: { model: 'gemma4:12b' } };
      const { app, bus, setDoc, useResolver } = stubApp({ doc: { parts: [part, ins], wires: [] } });
      useResolver((/** @type {string} */ m, /** @type {string} */ n) => (m === 'gemma4:12b' && n === 'vision' ? 'yes' : 'unknown'));
      const host = doc.createElement('div');
      const view = SPECS.get('image').render(host, part, { update: () => {}, commit: () => {}, open: () => {}, app, part });
      const line = host.querySelector('.graph-takes');
      assert.ok(line, 'the Image box has a takes line');
      assert.equal(line.getAttribute('data-kind'), 'image');
      assert.equal(line.getAttribute('data-state'), 'unwired');

      setDoc({ parts: [part, ins], wires: [{ id: 'w', from: 'pic', to: 'ins', port: 'in' }] });
      view.update(part);
      assert.equal(line.getAttribute('data-state'), 'yes', 'a wiring edit reaches the line through update()');

      view.destroy();
      assert.equal(host.childNodes.length, 0);
      bus.emit(CAPS_EVENT, {});   // must not throw into a destroyed box
    });
  });
};
