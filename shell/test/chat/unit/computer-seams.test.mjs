// K5 kickoff (addendum KE): the SEAMS between the four K5 units, owned by the integrator. Each unit
// tests its own module; this file tests only what crosses a unit boundary — the catalogue the ＋
// menu reads, the preset contract, the Instruction's code answer, the demo flag's round trip, the
// lesson format a fork preserves — so a unit that breaks a seam goes red HERE, not at the landing.
import assert from 'node:assert/strict';

import { specMap, partSpecs, paletteCatalogue, PALETTE_GROUPS, groupLabel } from '../../../renderer/chat/graph/parts/index.mjs';
import { CREATIVE_PRESET_IDS, creativePresets, presetOf, presetTitle, STARTER } from '../../../renderer/chat/graph/parts/creative.mjs';
import { buildPalette, searchPalette, groupEntries, GROUP_ORDER } from '../../../renderer/chat/graph/palette.mjs';
import { unfence, codeValue, shapeForGuest, CODE_KINDS, CODE_FACETS } from '../../../renderer/chat/graph/unfence.mjs';
import { createDoc, addPart, patchPart, normaliseDoc } from '../../../renderer/chat/graph/model.mjs';
import { toJson, fromJson, FORMAT_VERSION } from '../../../renderer/chat/graph/serialize.mjs';
import { shownOf, modeFor } from '../../../renderer/chat/graph/parts/preview.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { CHECK_KINDS, evaluate, advance, tickManual, freshProgress, refsOf, cmp } from '../../../renderer/chat/computer/tutorial/check.mjs';
import { LESSONS, TEMPLATES, lessonById } from '../../../renderer/chat/computer/tutorial/registry.mjs';
import { API_KEYS, KV_KEYS } from '../../../renderer/chat/core/types.mjs';

const SPECS = specMap();
let n = 0;
const newId = () => `id${++n}`;

export default (test) => {
  test('KE-2: every palette part has a group, a glyph and a one-line description', () => {
    const cat = paletteCatalogue();
    assert.deepEqual(cat.parts.map((p) => p.type), partSpecs().map((s) => s.type), 'the catalogue IS the palette');
    for (const p of cat.parts) {
      assert.ok(PALETTE_GROUPS.includes(p.group), `${p.type} is in a real group`);
      assert.notEqual(p.order, 9000, `${p.type} has a meta row (not the fallback)`);
      assert.ok(p.glyph && p.glyph.length <= 3, `${p.type} has a short glyph`);
      assert.ok(p.desc && p.desc.length > 10, `${p.type} says what it does`);
    }
    assert.deepEqual([...PALETTE_GROUPS], [...GROUP_ORDER], 'palette.mjs keeps the same frozen group order');
    for (const g of PALETTE_GROUPS) assert.notEqual(groupLabel(g), g, `group ${g} has words`);
  });

  test('KE-2: the presets — frozen ids, real types, keys the spec declares, a title', () => {
    const presets = creativePresets();
    assert.deepEqual(presets.map((p) => p.id), [...CREATIVE_PRESET_IDS]);
    const types = new Set(SPECS.keys());
    for (const p of presets) {
      assert.ok(SPECS.has(p.type), `${p.id} places a loadable type`);
      assert.ok(!types.has(p.id), `${p.id} does not collide with a part type`);
      assert.ok(PALETTE_GROUPS.includes(p.group));
      const declared = Object.keys(SPECS.get(p.type).defaults());
      for (const k of Object.keys(p.settings)) assert.ok(declared.includes(k), `${p.id}.${k} is in ${p.type}.defaults(), or export would drop it`);
      for (const k of Object.keys(p.match)) assert.ok(k in p.settings, `${p.id} matches on a key it sets`);
      assert.ok(p.label && p.title && p.desc);
      const placed = { type: p.type, settings: { ...SPECS.get(p.type).defaults(), ...p.settings } };
      assert.equal(presetOf(placed), p.id, `a part placed as ${p.id} is recognised as ${p.id}`);
      assert.equal(SPECS.get(p.type).titleOf(placed), p.title, `and the box is titled "${p.title}"`);
    }
    assert.equal(presetOf({ type: 'preview', settings: { mode: 'auto' } }), null, 'a plain Preview is no preset');
    assert.equal(presetTitle({ type: 'ask', settings: { code: '' } }), null, 'a plain Instruction keeps its label');
    for (const k of ['p5', 'three', 'svg', 'html', 'markdown']) assert.ok(String(STARTER[k]).trim(), `${k} ships starter code`);
  });

  test('KE-2: the menu model — legacy parts never offered, presets in their groups, search finds them', () => {
    const rows = buildPalette(paletteCatalogue(), SPECS);
    const entries = rows.map((r) => r.entry);
    assert.equal(new Set(entries).size, entries.length, 'entry ids are unique');
    for (const legacy of ['from-thread', 'to-thread', 'render']) assert.ok(!rows.some((r) => r.type === legacy), `${legacy} is not offered`);
    const show = rows.filter((r) => r.group === 'show').map((r) => r.entry);
    for (const id of ['p5', 'three', 'svg', 'html', 'markdown', 'preview', 'code']) assert.ok(show.includes(id), `${id} is in Show`);
    const think = rows.filter((r) => r.group === 'think').map((r) => r.entry);
    for (const id of ['ask', 'write-p5', 'write-three', 'write-svg', 'write-html']) assert.ok(think.includes(id), `${id} is in Think`);
    assert.deepEqual(groupEntries(rows).map((g) => g.group), [...GROUP_ORDER]);
    const svg = searchPalette(rows, 'svg').map((r) => r.entry);
    assert.ok(svg.includes('svg') && svg.includes('write-svg'), `"svg" finds both SVG rows: ${svg}`);
    assert.equal(searchPalette(rows, 'p5')[0].entry, 'p5', '"p5" finds the sketch first');
    assert.deepEqual(searchPalette(rows, '').map((r) => r.entry), entries, 'no query is every row');
    // a partial specs map (a unit test's) drops rows it cannot load
    assert.ok(!buildPalette(paletteCatalogue(), new Map([['note', SPECS.get('note')]])).some((r) => r.type !== 'note'));
  });

  test('KE-2: addPart places a preset with its settings AND its size', () => {
    const doc = createDoc({ id: 'd', now: () => 1 });
    const p5 = creativePresets().find((p) => p.id === 'p5');
    const out = addPart(doc, { type: 'preview', x: 10, y: 20, settings: p5.settings, w: p5.size.w, h: p5.size.h }, { specs: SPECS, newId, now: () => 2 });
    assert.equal(out.part.w, p5.size.w);
    assert.equal(out.part.h, p5.size.h);
    assert.equal(out.part.settings.mode, 'p5');
    assert.equal(out.part.settings.source, STARTER.p5);
    const plain = addPart(doc, { type: 'preview', x: 0, y: 0 }, { specs: SPECS, newId, now: () => 2 });
    assert.equal(plain.part.w, SPECS.get('preview').size.w, 'no size given → the spec size, as before');
  });

  test('KE-3: an Instruction answering in CODE lands unfenced, with the facet a Preview reads', async () => {
    assert.deepEqual([...CODE_KINDS], ['p5', 'three', 'svg', 'html']);
    const fenced = 'Here is your picture:\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n```\n\nEnjoy.';
    assert.deepEqual(codeValue(fenced, 'svg'), { kind: 'text', data: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', format: 'svg' });
    assert.deepEqual(codeValue('plain words', ''), { kind: 'text', data: 'plain words' }, 'no code kind → the old text value');
    assert.equal(unfence('no fence').fenced, false);
    for (const k of CODE_KINDS) assert.equal(modeFor('auto', codeValue('x', k)), k, `auto reads ${k} from the facet`);
    assert.deepEqual(CODE_FACETS.p5, { format: 'js', lang: 'p5' });

    const ask = SPECS.get('ask');
    assert.equal(ask.defaults().code, '', 'the Instruction declares `code` (or export would drop it)');
    const part = { id: 'a1', type: 'ask', settings: { ...ask.defaults(), instruction: 'Draw a sun.', code: 'svg' } };
    const value = await ask.run({
      part, inputs: { in: [] }, labels: { in: [] }, app: { now: () => 1 }, signal: new AbortController().signal,
      ask: { text: async () => ({ ok: true, value: fenced }), json: async () => ({ ok: false }) },
    });
    assert.equal(value.data, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    assert.equal(value.format, 'svg');
  });

  test('KE-3: a creative box draws its OWN source with nothing wired in, and adopts what arrives', async () => {
    const preview = SPECS.get('preview');
    const svg = creativePresets().find((p) => p.id === 'svg');
    const own = { id: 'pv1', type: 'preview', settings: { ...preview.defaults(), ...svg.settings } };
    const input = (part, content) => ({ part, inputs: { content }, labels: { content: content.map(() => '') }, app: { now: () => 1 }, signal: new AbortController().signal, sandbox: null });
    await preview.run(input(own, []));
    assert.equal(shownOf('pv1').mode, 'svg');
    assert.ok(shownOf('pv1').svg.includes('<circle'), 'the starter SVG was drawn with no farm');
    const arrived = { ...own, id: 'pv2' };
    await preview.run(input(arrived, [codeValue('```svg\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>\n```', 'svg')]));
    assert.ok(shownOf('pv2').svg.includes('<rect') && !shownOf('pv2').svg.includes('<circle'), 'an arrival wins over the source');
    const locked = { ...own, id: 'pv3', settings: { ...own.settings, locked: true } };
    await preview.run(input(locked, [valueOf('text', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')]));
    assert.ok(shownOf('pv3').svg.includes('<circle'), 'a locked box keeps its own code');
    assert.ok(shapeForGuest('p5', STARTER.p5).includes('window.draw = typeof draw'), 'p5 global mode is handed to window');
  });

  test('KE-7: the demo flag — set only when said, cleared by any other value, round-trips as v4', () => {
    const doc0 = createDoc({ id: 'd', now: () => 1 });
    const { doc: d1, part } = addPart(doc0, { type: 'note', x: 0, y: 0 }, { specs: SPECS, newId, now: () => 1 });
    const d2 = patchPart(d1, part.id, { value: valueOf('text', 'recorded'), state: 'done', demo: true });
    assert.equal(d2.parts[0].demo, true);
    const d3 = patchPart(d2, part.id, { state: 'stale' });
    assert.equal(d3.parts[0].demo, true, 'a patch that does not touch the value keeps the badge');
    const d4 = patchPart(d2, part.id, { value: valueOf('text', 'generated') });
    assert.equal(d4.parts[0].demo, false, 'a new value is never a demo unless it says so');

    const file = toJson(d2, { values: true, specs: SPECS });
    assert.equal(file.lolgraph, 4);
    assert.equal(FORMAT_VERSION, 4);
    assert.equal(file.parts[0].demo, true);
    assert.equal(toJson(d4, { values: true, specs: SPECS }).lolgraph, 1, 'no demo → the stamp follows the content');
    assert.equal(toJson(d2, { values: false, specs: SPECS }).parts[0].demo, undefined, 'no value exported → no badge exported');
    const back = fromJson(file, { specs: SPECS, newId, values: true });
    assert.ok(back.ok);
    assert.equal(back.doc.parts[0].demo, true, 'the badge survives import with its value');
    const dry = fromJson(file, { specs: SPECS, newId, values: false });
    assert.equal(dry.doc.parts[0].demo, undefined, 'imported without the value, the badge has nothing to describe');
  });

  test('KE-4/KE-5: every shipped lesson forks with its AUTHORED ids and walks with check.mjs', () => {
    assert.ok(LESSONS.length >= 5 && TEMPLATES.length >= 2);
    for (const lesson of LESSONS) {
      const { doc, dropped } = normaliseDoc({ ...lesson.doc, id: 'fork', threadId: null }, { specs: SPECS, now: () => 1 });
      assert.deepEqual(dropped, [], `${lesson.id} opens whole`);
      assert.deepEqual(doc.parts.map((p) => p.id), lesson.doc.parts.map((p) => p.id), `${lesson.id} keeps its part ids`);
      const p = advance(lesson, freshProgress(), { doc, report: null, now: 5 });
      assert.ok(p.step < lesson.steps.length, `${lesson.id} is not already finished the moment it opens`);
      for (const s of lesson.steps) for (const k of refsOf(s.check).kinds) assert.ok(CHECK_KINDS.includes(k));
    }
    assert.equal(lessonById('l00-tour').n, 0);
    assert.equal(lessonById('nope'), null);
  });

  test('KE-5: checkpoints latch, a manual step needs its button, presets are matchable', () => {
    const lesson = lessonById('l04-draw');
    const { doc } = normaliseDoc({ ...lesson.doc, id: 'f', threadId: null }, { specs: SPECS, now: () => 1 });
    let p = advance(lesson, freshProgress(), { doc });
    assert.equal(p.step, 0);
    const ran = { ...doc, parts: doc.parts.map((x) => (x.id === 'p_svg' ? { ...x, state: 'done' } : x)) };
    p = advance(lesson, p, { doc: ran });
    assert.deepEqual(p.ticks, ['s1']);
    p = advance(lesson, p, { doc });   // the box goes stale again: the tick stays
    assert.deepEqual(p.ticks, ['s1'], 'a latched tick never un-ticks');
    const withWrite = { ...doc, parts: [...doc.parts, { id: 'w', type: 'ask', settings: { code: 'svg' }, state: 'idle' }] };
    assert.equal(evaluate({ has: { preset: 'write-svg' } }, { doc: withWrite }), true);
    assert.equal(evaluate({ has: { preset: 'write-p5' } }, { doc: withWrite }), false);
    assert.equal(cmp(2, '>=2'), true);
    assert.equal(cmp(0, '==0'), true);
    assert.equal(cmp(3, 'lots'), false);
    const l2 = lessonById('l02-wires');
    const manual = l2.steps.find((s) => 'manual' in s.check);
    const at = { ...freshProgress(), step: l2.steps.indexOf(manual) };
    assert.equal(advance(l2, at, { doc }).step, at.step, 'a manual step is never ticked by a predicate');
    assert.equal(tickManual(l2, at, manual.id).step, at.step + 1, 'its button ticks it');
  });

  test('KE-6: the frozen API key lists and the progress kv key', () => {
    assert.deepEqual([...API_KEYS.tutorial], ['has', 'lessons', 'templates', 'open', 'openTemplate', 'active', 'reset', 'showShelf', 'explain', 'debug']);
    assert.deepEqual([...API_KEYS.palette], ['el', 'open', 'close', 'isOpen', 'destroy']);
    assert.deepEqual([...API_KEYS.welcome], ['shown', 'refresh', 'debug']);
    assert.equal(KV_KEYS.computerTutorial, 'computer:tutorial');
  });
};
