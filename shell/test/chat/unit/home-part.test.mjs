// @ts-check
// The Home boxes, renderer side (graph/parts/home.mjs; docs/HOME_ASSISTANT.md): what a reading hands on (and the
// saved copy only when there is no home or no answer), what a command says for each answer of main, the details a
// command carries, that the outputs' arming question names every Home command, that a model can never pick a box's
// devices (mcp-tools PERSON_ONLY), and that main — not the page — decides whether the outputs are armed.
// The rules themselves are main's: home-boxes.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeReadPart, homeCommandPart, commandData, entitiesOf, homeTarget } from '../../../renderer/chat/graph/parts/home.mjs';
import { targetsIn } from '../../../renderer/chat/graph/parts/send.mjs';
import { modelSettings, PERSON_ONLY } from '../../../renderer/chat/computer/mcp-tools.mjs';
import { STUDIO } from '../../../renderer/chat/computer/templates/home-readings.mjs';

const SHELL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Run `spec` with a fake window.lol.home answering through `home` (null = an app without the door). */
async function runWith(spec, home, part, inputs = {}) {
  const saved = globalThis.window;
  /** @type {any} */ (globalThis).window = home ? { lol: { home } } : { lol: {} };
  try {
    return await spec.run(/** @type {any} */ ({ part, inputs, signal: new AbortController().signal }));
  } finally {
    /** @type {any} */ (globalThis).window = saved;
  }
}
const door = (/** @type {any} */ over) => ({ read: async () => ({ ok: false, code: 'nolink' }), entities: async () => ({ ok: false }), actions: async () => ({ ok: false }), command: async () => ({ code: 'nolink' }), ...over });

export default (test) => {
  test('home part: the devices a box names are clean ids, once each, at most 30', () => {
    assert.deepEqual(entitiesOf({ entities: ['sensor.a', ' sensor.a ', 'Not An Id', 'light.b', 42] }), ['sensor.a', 'light.b']);
    assert.equal(entitiesOf({ entities: Array.from({ length: 40 }, (_, i) => `sensor.s${i}`) }).length, 30);
    assert.deepEqual(entitiesOf({}), []);
  });

  test('home part: a reading is handed on; its saved copy ONLY with no home linked — never for a linked home that lacks the devices or does not answer', async () => {
    const part = { id: 'h1', type: 'home', settings: { entities: ['sensor.studio_co2'], hours: 0 }, value: { kind: 'json', data: STUDIO } };
    const live = { home: 'Studio', at: '2026-10-09T08:00:00Z', devices: [{ id: 'sensor.studio_co2', state: '700', value: 700 }], missing: [] };
    /** @type {any[]} */ const asked = [];
    assert.deepEqual(await runWith(homeReadPart, door({ read: async (ids, h) => { asked.push([ids, h]); return { ok: true, value: live }; } }), { ...part, settings: { ...part.settings, hours: 24 } }), { kind: 'json', data: live });
    assert.deepEqual(asked, [[['sensor.studio_co2'], 24]], 'the box asks for exactly its devices and hours');
    assert.deepEqual(await runWith(homeReadPart, door({}), part), part.value, 'no home linked: the copy');
    assert.deepEqual(await runWith(homeReadPart, null, part), part.value, 'an app without the door: the copy');
    // A linked home: a made-up reading must never reach a Condition that switches a real fan (security review, 2026-10-09).
    await assert.rejects(runWith(homeReadPart, door({ read: async () => ({ ok: false, code: 'offline', message: 'ETIMEDOUT' }) }), part), /did not answer: ETIMEDOUT/, 'no answer from a linked home: an error, not the copy');
    await assert.rejects(runWith(homeReadPart, door({ read: async () => ({ ok: true, value: { ...live, devices: [], missing: ['sensor.studio_co2'] } }) }), part), /None of these devices is in your home \(sensor\.studio_co2\)/, 'none of its devices in the linked home: an error, not the copy');
    await assert.rejects(runWith(homeReadPart, door({ read: async () => ({ ok: false, code: 'toomuch', message: 'History of 30 devices over 168 hours is too much' }) }), part), /too much/);
    await assert.rejects(runWith(homeReadPart, door({ read: async () => ({ ok: false, code: 'refused', message: 'Home Assistant refused the token' }) }), part), /refused the token/, 'a refusal is never covered');
    await assert.rejects(runWith(homeReadPart, door({}), { ...part, value: undefined }), /No Home Assistant is linked/, 'nothing to fall back on');
    await assert.rejects(runWith(homeReadPart, door({}), { ...part, settings: { entities: [] } }), /Choose the devices/);
  });

  test('home part: a command\'s details are only the box\'s own "With"', () => {
    assert.deepEqual(commandData({ data: '{"percentage": 50}' }), { data: { percentage: 50 } });
    assert.deepEqual(commandData({}), { data: undefined });
    assert.deepEqual(commandData({ data: '{not json' }), { bad: true });
    assert.deepEqual(commandData({ data: '[1,2]' }), { bad: true });
  });

  test('home part: each answer of main has its words — dry runs are done, refusals are errors; the device is the box\'s', async () => {
    const part = { id: 'c1', type: 'home-command', settings: { entity: 'light.ceiling', name: 'Ceiling', action: 'turn_on', data: '' } };
    /** @type {any[]} */ const sent = [];
    const answer = (/** @type {any} */ r) => door({ command: async (req) => { sent.push(req); return r; } });
    const go = { in: [{ kind: 'json', data: { brightness_pct: 40, entity_id: 'lock.front_door' } }] };
    const dry = await runWith(homeCommandPart, answer({ code: 'dry-outputs', what: 'light.turn_on on Ceiling (light.ceiling)' }), part, go);
    assert.match(dry.data, /^Dry run — would do light\.turn_on on Ceiling.*Arm the outputs/);
    assert.equal(sent[0].entity_id, 'light.ceiling', 'the device is the box\'s setting, never what arrived');
    assert.equal(sent[0].action, 'turn_on');
    assert.equal(sent[0].data, undefined, 'what arrived is only the go signal, never the details (review findings 3 and 5)');
    await runWith(homeCommandPart, answer({ code: 'dry-outputs', what: 'x' }), { ...part, settings: { ...part.settings, data: '{"brightness_pct": 30}' } }, go);
    assert.deepEqual(sent[1].data, { brightness_pct: 30 }, 'the details are the box\'s own');
    await assert.rejects(runWith(homeCommandPart, answer({ code: 'done' }), { ...part, settings: { ...part.settings, data: '{oops' } }, go), /is not JSON/);
    assert.match((await runWith(homeCommandPart, answer({ code: 'dry-home', what: 'x' }), part, go)).data, /Allow home commands in Preferences/);
    assert.match((await runWith(homeCommandPart, answer({ code: 'done', what: 'x', now: 'on' }), part, go)).data, /^Done: x\. It is now on\./);
    assert.match((await runWith(homeCommandPart, null, part, go)).data, /^Dry run — no Home Assistant is linked/, 'no door: nothing can leave');
    assert.match((await runWith(homeCommandPart, answer({ code: 'nolink' }), part, go)).data, /no Home Assistant is linked/);
    await assert.rejects(runWith(homeCommandPart, answer({ code: 'never', what: 'unlock or open a lock' }), part, go), /Never from LlmOnLan: unlock or open a lock/);
    await assert.rejects(runWith(homeCommandPart, answer({ code: 'not-listed' }), part, go), /not in the list you allowed/);
    await assert.rejects(runWith(homeCommandPart, answer({ code: 'rate' }), part, go), /one command a second/);
    await assert.rejects(runWith(homeCommandPart, answer({ code: 'weird' }), part, go), /Home Assistant/);
    await assert.rejects(runWith(homeCommandPart, answer({ code: 'done' }), part, {}), /Nothing arrived/);
    await assert.rejects(runWith(homeCommandPart, answer({ code: 'done' }), { ...part, settings: { entity: '', action: '' } }, go), /Choose the device and the action/);
  });

  test('home part: arming the outputs names every Home command — its device id, whatever name the graph gave it', () => {
    const doc = { parts: [
      { id: 'a', type: 'home-command', settings: { entity: 'switch.gate_relay', name: `Desk lamp\n\n\n${'x'.repeat(200)}`, action: 'turn_on', data: '{"brightness_pct": 40}' } },
      { id: 'b', type: 'home-command', settings: { entity: 'light.ceiling', name: 'light.ceiling', action: 'turn_off' } },
      { id: 'c', type: 'home-command', settings: { entity: '', action: '' } },
      { id: 'd', type: 'send', settings: { transport: 'osc', host: '127.0.0.1', port: 9000, address: '/x' } },
    ] };
    const list = targetsIn(doc);
    assert.equal(list[0], `Home Assistant → turn_on on switch.gate_relay “Desk lamp ${'x'.repeat(49)}…” with {"brightness_pct": 40}`,
      'the device id first, the name a graph gave it on one short line, the details shown (review finding 6)');
    assert.equal(list[1], 'Home Assistant → turn_off on light.ceiling');
    assert.equal(list.length, 3, 'an unset box names nothing; the Send target is still there');
    assert.equal(homeTarget({ settings: {} }), '');
  });

  test('home part: a model never picks what a Home box reads or what a Home command switches', () => {
    assert.deepEqual(PERSON_ONLY.home, ['entities', 'names']);
    const r = modelSettings('home', { entities: ['lock.front_door'], names: {}, hours: 24 });
    assert.deepEqual(r.kept, { hours: 24 });
    assert.deepEqual(r.left, ['entities', 'names']);
    const c = modelSettings('home-command', { entity: 'lock.front_door', name: 'Lamp', action: 'unlock', data: '{"code":"1234"}' });
    assert.deepEqual(c.kept, {});
    assert.deepEqual(c.left.sort(), ['action', 'data', 'entity', 'name']);
  });

  test('home part: main decides whether the outputs are armed — the page\'s request carries no such flag', () => {
    const src = fs.readFileSync(path.join(SHELL, 'src', 'main', 'index.ts'), 'utf8');
    const at = src.indexOf("ipcMain.handle('lol:home:command'");
    assert.ok(at > 0, 'the command handler exists');
    const body = src.slice(at, src.indexOf('});', at));
    assert.match(body, /outputsArmed: outputsArmed\(\)/, 'main reads its own arming (outputs.ts)');
    assert.match(body, /entity_id: r\.entity_id, action: r\.action, data: r\.data/, 'only the device, the action and the details are taken from the page');
  });
};
