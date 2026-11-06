// A graph someone hands you lists what only a person chooses before its first run (owner 2026-11-06): one Run all on a
// stranger's file could read a linked home and hand it to an Agent whose hosts the file named. Review 2026-11-05, OLD-1
// and EGRESS-01.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toJson, fromJson } from '../../../renderer/chat/graph/serialize.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { handed, personChoices } from '../../../renderer/chat/graph/person-only.mjs';
import { createHandedGate, createSession } from '../../../renderer/chat/computer/host.mjs';
import { runTool, HANDED_NOTE } from '../../../renderer/chat/computer/mcp-tools.mjs';
import { ids, clock } from './graph-fixture.mjs';

const box = (id, type, settings) => ({ id, type, x: 0, y: 0, w: 300, h: 200, settings });
const stranger = () => ({
  id: 'g', title: 'a gift', wires: [], parts: [
    box('a', 'fetch', { url: 'http://192.168.1.50/cm?cmnd=Power%20Off' }),
    box('b', 'agent', { hosts: 'evil.example\nnotes.example' }),
    box('c', 'home', { entities: ['person.alex', 'alarm_control_panel.home'], names: {} }),
    box('d', 'opendata', { link: 'https://www.data.gouv.fr/fr/datasets/x/' }),
    box('e', 'send', { transport: 'serial', serialPort: 'usb:1', serialLabel: 'Arduino' }),
    box('f', 'home-command', { entity: 'light.hall', action: 'turn_on', data: { brightness: 255 } }),
  ],
});
const load = (doc, o = {}) => {
  const specs = specMap();
  let n = 0;
  return fromJson(JSON.parse(JSON.stringify(toJson(/** @type {any} */ (doc), { specs }))), { specs, newId: () => `n${++n}`, now: () => 1, ...o });
};

export default (test) => {
  test('every person-only choice a file carries is listed, on its own box', () => {
    const rows = personChoices(stranger());
    assert.deepEqual(rows.map((r) => r.type), ['fetch', 'agent', 'home', 'opendata', 'send', 'home-command']);
    assert.ok(rows[0].what.includes('192.168.1.50'));
    assert.equal(rows[2].what, 'person.alex, alarm_control_panel.home');
    assert.equal(rows[4].what, 'Arduino · usb:1');
    assert.equal(rows[5].what, 'turn_on · light.hall · {"brightness":255}');
  });

  test('a value cannot hide from the list, or draw one of its own', () => {
    const many = Array.from({ length: 400 }, (_, i) => `h${i}.example`).join(' ');
    assert.ok(personChoices({ parts: [box('a', 'agent', { hosts: `${many} evil.example` })] })[0].what.endsWith('evil.example'), 'never cut short');
    const [row] = personChoices({ parts: [box('a', 'fetch', { url: 'http://a.example\n• nothing else‮​' })] });
    assert.equal(row.what, 'http://a.example • nothing else', 'one line, no control or invisible characters');
    assert.deepEqual(personChoices({ parts: [box('a', 'send', { transport: 'osc', serialPort: 'usb:1' }), box('b', 'fetch', { url: '  ' })] }), [], 'nothing that would not be reached');
  });

  test('a file is marked; a graph we ship is not; and a file cannot unmark itself', () => {
    assert.equal(handed(load(stranger(), { handed: true }).doc), true);
    assert.equal(handed(load(stranger()).doc), false, 'templates and examples keep theirs and run');
    const plain = { id: 'g', title: '', wires: [], parts: [box('a', 'text', { text: 'hello' })] };
    assert.equal(/** @type {any} */ (load(plain, { handed: true }).doc).settings.handed, undefined, 'nothing to list, no mark');
    const specs = specMap();
    const file = JSON.parse(JSON.stringify(toJson(/** @type {any} */ (stranger()), { specs })));
    let n = 0;
    const out = fromJson({ ...file, settings: { handed: false } }, { specs, newId: () => `n${++n}`, now: () => 1, handed: true });
    assert.equal(handed(out.doc), true, 'its own word about itself decides nothing');
    const shipped = fromJson({ ...file, settings: { handed: true } }, { specs, newId: () => `n${++n}`, now: () => 1 });
    assert.equal(handed(shipped.doc), false);
  });

  test('the gate: no answer, no run; yes runs and is not asked again; a second press does not stack a question', async () => {
    const repo = { getGraph: async () => null, putGraph: async () => {}, listGraphs: async () => [] };
    const asked = [];
    /** @type {(v: boolean) => void} */ let answer = () => {};
    const app = {
      repo, now: clock(), newId: ids('g'),
      dialogs: { confirm: (o) => { asked.push(o); return new Promise((r) => { answer = r; }); } },
    };
    const session = createSession(app, null);
    session.apply(load(stranger(), { handed: true }).doc, { label: 'import' });
    const gate = createHandedGate(session, app);
    const first = gate();
    assert.equal(await gate(), false, 'a second press while the question is open');
    assert.equal(asked.length, 1);
    assert.match(asked[0].body, /evil\.example/);
    assert.match(asked[0].body, /192\.168\.1\.50/);
    assert.equal(asked[0].danger, true, 'Cancel has the focus');
    answer(false);
    assert.equal(await first, false, 'Cancel: nothing runs');
    assert.equal(handed(session.doc()), true, 'and the question stays');
    const second = gate();
    answer(true);
    assert.equal(await second, true);
    assert.equal(handed(session.doc()), false);
    assert.equal(await gate(), true);
    assert.equal(asked.length, 2, 'asked once for a yes');
  });

  test('the gate: no dialog, no run; a graph with nothing to list asks nothing', async () => {
    const app = { repo: { putGraph: async () => {} }, now: clock(), newId: ids('g') };
    const session = createSession(app, null);
    session.apply(load(stranger(), { handed: true }).doc, { label: 'import' });
    assert.equal(await createHandedGate(session, app)(), false);
    session.apply({ ...session.doc(), parts: [] }, { label: 'emptied' });
    assert.equal(await createHandedGate(session, app)(), true);
  });

  test('a model cannot run a graph no person looked at', async () => {
    const g = /** @type {any} */ (globalThis);
    const saved = g.window;
    let ran = 0;
    const comp = { docId: () => 'g1', doc: () => load(stranger(), { handed: true }).doc, run: async () => { ran++; return {}; }, running: () => false };
    g.window = { lol: {}, LolComputer: { debug: { computer: comp, library: { list: () => [] } } } };
    try {
      const out = await runTool('run_graph', {});
      assert.equal(out.isError, true);
      assert.equal(out.text, HANDED_NOTE);
      assert.equal(ran, 0);
    } finally { g.window = saved; }
  });

  test('every door: both imports mark a file, the shipped ones say so, a paste from elsewhere is a file, one run door', () => {
    const src = (p) => fs.readFileSync(new URL('../../../renderer/chat/' + p, import.meta.url), 'utf8');
    assert.ok(src('computer/library.mjs').includes('values: true, handed: !o.shipped,'));
    const canvas = src('graph/canvas.mjs');
    assert.ok(canvas.includes('values: true, handed: !o.shipped,'), 'Replace from file…');
    assert.ok(canvas.includes('const foreign = String(text) !== copied;'), 'what this window copied stays as it was');
    assert.ok(canvas.includes("foreign && p.type === 'audio' ? { ...p.settings, listen: false } : p.settings"), 'Listen, as in a file');
    assert.ok(canvas.includes('if (foreign && personChoices(payload).length) doc = { ...doc, settings: { ...doc.settings, handed: true } };'));
    const rail = src('computer/tutorial/rail.mjs');
    assert.equal((rail.match(/shipped: true/g) || []).length, 2, 'a template and an example');
    assert.ok(src('computer/host.mjs').includes("if (!(await handedOk())) { clearPresses(); canvas.announce(t('computer.handedNo')); return null; }"));
  });
};
