// @ts-check
// Home Assistant (src/main/homeAssistant.ts), against the COMPILED main module and a fake Home Assistant on loopback:
// the address rules, linking (a refused token keeps nothing), the three tools, the dry run (no POST leaves), allowing
// exactly the listed devices, what a model may never do, the rate caps — and that the token is never in what a model
// or the page reads.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'build', 'main', 'homeAssistant.js');
const TOKEN = 'secret-long-lived-token-for-tests';

const STATES = () => [
  { entity_id: 'light.kitchen', state: 'off', attributes: { friendly_name: 'Kitchen Light', brightness: null } },
  { entity_id: 'lock.front_door', state: 'locked', attributes: { friendly_name: 'Front Door' } },
  { entity_id: 'cover.garage_door', state: 'closed', attributes: { friendly_name: 'Garage Door', device_class: 'garage' } },
  { entity_id: 'cover.hall_window', state: 'closed', attributes: { friendly_name: 'Hall Window' } },
  { entity_id: 'alarm_control_panel.security', state: 'armed_away', attributes: { friendly_name: 'Security' } },
  { entity_id: 'sensor.outside', state: '14.5', attributes: { friendly_name: 'Outside Temperature', unit_of_measurement: '°C' } },
  { entity_id: 'update.core', state: 'on', attributes: { friendly_name: 'Core update' } },
  { entity_id: 'script.good_morning', state: 'off', attributes: { friendly_name: 'Good morning' } },
  { entity_id: 'scene.movie', state: 'unknown', attributes: { friendly_name: 'Movie' } },
  { entity_id: 'media_player.living_room', state: 'playing', attributes: { friendly_name: 'Living Room' } },
  { entity_id: 'siren.hall', state: 'off', attributes: { friendly_name: 'Hall Siren' } },
];
const SERVICES = [
  { domain: 'light', services: { turn_on: { fields: { brightness_pct: {}, advanced_fields: { collapsed: true, fields: { transition: {} } } } }, turn_off: { fields: {} }, toggle: { fields: {} } } },
  { domain: 'lock', services: { lock: {}, unlock: {}, open: {} } },
  { domain: 'cover', services: { open_cover: {}, close_cover: {}, toggle: {}, set_cover_position: {} } },
  { domain: 'alarm_control_panel', services: { alarm_arm_away: {}, alarm_disarm: {}, alarm_trigger: {} } },
  { domain: 'update', services: { install: {} } },
  // Home Assistant registers one service PER SCRIPT beside turn_on (the review's blocker, 2026-09-30).
  { domain: 'script', services: { turn_on: {}, turn_off: {}, toggle: {}, reload: {}, unlock_front_door: {} } },
  { domain: 'scene', services: { turn_on: {}, apply: {}, create: {}, delete: {}, reload: {} } },
  { domain: 'media_player', services: { volume_set: { fields: { volume_level: {} } }, play_media: {}, media_pause: {} } },
  { domain: 'siren', services: { turn_on: {}, turn_off: {}, toggle: {} } },
];

/** A fake Home Assistant: the REST routes the module uses, a bearer check, and every POST recorded. */
function fakeHa() {
  const states = STATES();
  /** @type {{path: string, body: any}[]} */ const posts = [];
  const server = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'unauthorized' });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = String(req.url);
      if (req.method === 'GET' && url === '/api/config') return send(200, { location_name: 'Test Home', version: '2026.9.4' });
      if (req.method === 'GET' && url === '/api/states') return send(200, states);
      if (req.method === 'GET' && url.startsWith('/api/states/')) {
        const s = states.find((x) => x.entity_id === url.slice('/api/states/'.length));
        return s ? send(200, s) : send(404, { message: 'Entity not found.' });
      }
      if (req.method === 'GET' && url === '/api/services') return send(200, SERVICES);
      const m = /^\/api\/services\/([a-z_]+)\/([a-z_]+)$/.exec(url);
      if (req.method === 'POST' && m) {
        const body = JSON.parse(raw || '{}');
        posts.push({ path: url, body });
        const s = states.find((x) => x.entity_id === body.entity_id);
        if (s && m[2] === 'turn_on') s.state = 'on';
        if (s && m[2] === 'turn_off') s.state = 'off';
        return send(200, s ? [s] : []);
      }
      send(404, { message: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = /** @type {any} */ (server.address()).port;
    resolve({ url: `http://127.0.0.1:${port}`, posts, states, close: () => new Promise((r) => server.close(r)) });
  }));
}

function memoryStore() {
  /** @type {any} */ let kept = null;
  return { kept: () => kept, load: () => kept, save: (/** @type {any} */ l) => { kept = l; return true; } };
}

export default (test) => {
  if (!fs.existsSync(BUILD)) {
    test('home: build/main/homeAssistant.js exists (run npm --prefix shell run build)', () => assert.fail('not built'));
    return;
  }
  const H = require(BUILD);

  test('home: an address is scheme://host[:port]; /api is forgiven; a path, credentials or another scheme is not', () => {
    assert.equal(H.normaliseUrl('http://homeassistant.local:8123'), 'http://homeassistant.local:8123');
    assert.equal(H.normaliseUrl(' https://ha.example:8443/ '), 'https://ha.example:8443');
    assert.equal(H.normaliseUrl('http://10.0.0.5:8123/api'), 'http://10.0.0.5:8123');
    for (const bad of ['ftp://ha:21', 'http://u:p@ha:8123', 'http://ha:8123/lovelace', 'homeassistant.local', '', 'javascript:alert(1)']) {
      assert.equal(H.normaliseUrl(bad), null, bad);
    }
  });

  test('home: never by a model — unlock/open a lock, disarm/trigger an alarm, open a door, gate or garage', () => {
    const lock = { entity_id: 'lock.front', attributes: {} };
    assert.ok(H.neverByModel(lock, 'unlock'));
    assert.ok(H.neverByModel(lock, 'open'));
    assert.equal(H.neverByModel(lock, 'lock'), null, 'locking is fine');
    const alarm = { entity_id: 'alarm_control_panel.x', attributes: {} };
    assert.ok(H.neverByModel(alarm, 'alarm_disarm'));
    assert.ok(H.neverByModel(alarm, 'alarm_trigger'));
    assert.equal(H.neverByModel(alarm, 'alarm_arm_away'), null, 'arming is fine');
    for (const dc of ['garage', 'door', 'gate']) {
      const c = { entity_id: 'cover.x', attributes: { device_class: dc } };
      for (const a of ['open_cover', 'toggle', 'set_cover_position']) assert.ok(H.neverByModel(c, a), `${dc} ${a}`);
      assert.equal(H.neverByModel(c, 'close_cover'), null, `closing a ${dc} is fine`);
    }
    assert.equal(H.neverByModel({ entity_id: 'cover.w', attributes: { device_class: 'window' } }, 'open_cover'), null, 'a window that says so opens');
    assert.equal(H.neverByModel({ entity_id: 'cover.b', attributes: { device_class: 'blind' } }, 'set_cover_position'), null, 'a blind moves');
    const bare = { entity_id: 'cover.gate_relay', attributes: {} };
    for (const a of ['open_cover', 'toggle', 'set_cover_position', 'stop_cover']) assert.ok(H.neverByModel(bare, a), `a cover that does not say what it is: ${a}`);
    assert.equal(H.neverByModel(bare, 'close_cover'), null, 'it closes');
    const siren = { entity_id: 'siren.x', attributes: {} };
    assert.ok(H.neverByModel(siren, 'turn_on'));
    assert.equal(H.neverByModel(siren, 'turn_off'), null, 'a model may silence a siren');
  });

  test('home: only the allowlisted actions — never a per-script service, scene.apply, play_media or an inherited name', () => {
    const st = (/** @type {string} */ id) => ({ entity_id: id, attributes: {} });
    assert.equal(H.allowedAction(st('script.good_morning'), 'turn_on'), true);
    for (const [id, a] of [['script.good_morning', 'unlock_front_door'], ['script.good_morning', 'reload'], ['scene.movie', 'apply'],
      ['scene.movie', 'create'], ['media_player.x', 'play_media'], ['remote.tv', 'send_command'], ['vacuum.v', 'send_command'],
      ['light.k', 'constructor'], ['light.k', 'toString'], ['sensor.t', 'turn_on'], ['update.core', 'install']]) {
      assert.equal(H.allowedAction(st(id), a), false, `${id} ${a}`);
    }
    assert.deepEqual([...H.COMMANDABLE].sort(), Object.keys(H.ACTIONS).sort(), 'a commandable domain is exactly one with an action list');
  });

  test('home: the arming list names the devices, one line per domain, and says how many more past 30', () => {
    const text = H.armingText([{ id: 'light.a', name: 'A' }, { id: 'light.b', name: 'B' }, { id: 'switch.c', name: 'C' }]);
    assert.equal(text, 'light (2): A, B\nswitch (1): C');
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `light.l${i}`, name: `Lamp ${i}` }));
    const line = H.armingText(many);
    assert.ok(line.startsWith('light (80): Lamp 0, Lamp 1'));
    assert.ok(line.endsWith('Lamp 29 and 50 more'), line.slice(-40));
  });

  test('home: linking tests first — a bad address or a refused token keeps nothing; a good one is kept', async () => {
    const ha = await fakeHa();
    try {
      const store = memoryStore();
      const home = H.createHome({ store });
      assert.equal((await home.setLink('not an address', TOKEN)).ok, false);
      const refused = await home.setLink(ha.url, 'wrong-token');
      assert.equal(refused.ok, false);
      assert.match(refused.message, /refused the token/);
      assert.equal(store.kept(), null, 'a refused token is not kept');
      assert.equal(home.linked(), false);
      assert.equal((await home.setLink(`${ha.url}/api`, TOKEN)).ok, true);
      assert.deepEqual(store.kept(), { url: ha.url, token: TOKEN });
      const st = home.status();
      assert.deepEqual([st.linked, st.url, st.name, st.version, st.armed], [true, ha.url, 'Test Home', '2026.9.4', 0]);
      assert.ok(!JSON.stringify(st).includes(TOKEN), 'the status the page reads never carries the token');
      const c = await home.check();
      assert.deepEqual([c.ok, c.entities, c.devices], [true, 11, 9]);
      await home.setLink('', '');
      assert.equal(store.kept(), null, 'forgetting clears the store');
      assert.equal(home.linked(), false);
      const out = await home.call('home_devices', {});
      assert.equal(out.isError, true);
      assert.match(out.text, /No Home Assistant is linked/);
    } finally { await ha.close(); }
  });

  test('home: home_devices lists and filters; home_state gives the actions a model may use', async () => {
    const ha = await fakeHa();
    try {
      const home = H.createHome({ store: memoryStore() });
      await home.setLink(ha.url, TOKEN);
      const all = await home.call('home_devices', {});
      assert.match(all.text, /Test Home: 11 of 11 entities/);
      assert.match(all.text, /sensor\.outside · Outside Temperature · 14\.5 °C/);
      assert.match(all.text, /a dry run/);
      const lights = await home.call('home_devices', { domain: 'light' });
      assert.match(lights.text, /1 of 11 entities match/);
      assert.ok(!/sensor\./.test(lights.text));
      const search = await home.call('home_devices', { search: 'garage DOOR' });
      assert.match(search.text, /cover\.garage_door/);
      assert.ok(!/front_door/.test(search.text));

      const light = JSON.parse((await home.call('home_state', { entity_id: 'light.kitchen' })).text);
      assert.deepEqual(light.actions.turn_on, ['brightness_pct', 'transition'], 'a collapsed section\'s fields are listed too');
      assert.match(light.commands, /dry run/);
      const lock = JSON.parse((await home.call('home_state', { entity_id: 'lock.front_door' })).text);
      assert.deepEqual(Object.keys(lock.actions), ['lock']);
      assert.deepEqual(lock.never_by_a_model, ['unlock', 'open']);
      const sensor = JSON.parse((await home.call('home_state', { entity_id: 'sensor.outside' })).text);
      assert.match(sensor.commands, /read-only/);
      assert.equal(sensor.actions, undefined);
      assert.equal((await home.call('home_state', { entity_id: 'light.nope' })).isError, true);
      assert.equal((await home.call('home_state', { entity_id: '../config' })).isError, true, 'an id is checked before it is a path');
    } finally { await ha.close(); }
  });

  test('home: a command is a DRY RUN until a person allows commands — nothing leaves', async () => {
    const ha = await fakeHa();
    try {
      const home = H.createHome({ store: memoryStore() });
      await home.setLink(ha.url, TOKEN);
      const dry = await home.call('home_command', { entity_id: 'light.kitchen', action: 'turn_on', data: { brightness_pct: 40 } });
      assert.equal(dry.isError, undefined);
      assert.match(dry.text, /^DRY RUN — nothing was switched\. It would be light\.turn_on on Kitchen Light \(light\.kitchen\) with \{"brightness_pct":40\}/);
      assert.match(dry.text, /Allow commands/);
      assert.equal(ha.posts.length, 0, 'no POST reached Home Assistant');
    } finally { await ha.close(); }
  });

  test('home: allowed — exactly the listed devices; targeting keys dropped; a later device refused; a new link forgets', async () => {
    const ha = await fakeHa();
    try {
      const home = H.createHome({ store: memoryStore() });
      await home.setLink(ha.url, TOKEN);
      const list = await home.armable();
      assert.equal(list.ok, true);
      assert.deepEqual(list.devices.map((/** @type {any} */ d) => d.id),
        ['alarm_control_panel.security', 'cover.garage_door', 'cover.hall_window', 'light.kitchen', 'lock.front_door',
          'media_player.living_room', 'scene.movie', 'script.good_morning', 'siren.hall'],
        'devices only: no sensor, no update');
      assert.equal(home.arm(list.devices, list.generation), 9);
      const done = await home.call('home_command', { entity_id: 'light.kitchen', action: 'light.turn_on', data: { brightness_pct: 40, area_id: 'everywhere', entity_id: 'light.other' } });
      assert.equal(done.isError, undefined, done.text);
      assert.match(done.text, /^Done: light\.turn_on on Kitchen Light .* Kitchen Light is now on\./);
      assert.deepEqual(ha.posts, [{ path: '/api/services/light/turn_on', body: { entity_id: 'light.kitchen', brightness_pct: 40 } }]);

      ha.states.push({ entity_id: 'light.new', state: 'off', attributes: { friendly_name: 'New Lamp' } });
      const late = await home.call('home_command', { entity_id: 'light.new', action: 'turn_on' });
      assert.equal(late.isError, true);
      assert.match(late.text, /not in the list the person allowed/);

      await home.setLink(ha.url, TOKEN);
      assert.equal(home.status().armed, 0, 'linking again forgets what was allowed');
      assert.match((await home.call('home_command', { entity_id: 'light.kitchen', action: 'turn_off' })).text, /^DRY RUN/);
      assert.equal(ha.posts.length, 1);
    } finally { await ha.close(); }
  });

  test('home: even allowed, never unlock, disarm or open a garage; never a read-only domain or an unknown action', async () => {
    const ha = await fakeHa();
    try {
      const home = H.createHome({ store: memoryStore() });
      await home.setLink(ha.url, TOKEN);
      const al = /** @type {any} */ (await home.armable());
      home.arm(al.devices, al.generation);
      const cases = [
        [{ entity_id: 'lock.front_door', action: 'unlock' }, /Never by a model: unlock/],
        [{ entity_id: 'alarm_control_panel.security', action: 'alarm_disarm' }, /Never by a model: disarm/],
        [{ entity_id: 'cover.garage_door', action: 'open_cover' }, /Never by a model: open a door/],
        [{ entity_id: 'update.core', action: 'install' }, /read-only for a model/],
        [{ entity_id: 'light.kitchen', action: 'explode' }, /"explode" is not an action a model may use on Kitchen Light \(light\.kitchen\)\. It may use: turn_on, turn_off, toggle\./],
        [{ entity_id: 'light.kitchen', action: 'constructor' }, /not an action a model may use/],
        [{ entity_id: 'script.good_morning', action: 'unlock_front_door' }, /not an action a model may use on Good morning .* It may use: turn_on, turn_off, toggle\./],
        [{ entity_id: 'scene.movie', action: 'apply', data: { entities: { 'lock.front_door': 'unlocked' } } }, /not an action a model may use/],
        [{ entity_id: 'media_player.living_room', action: 'play_media', data: { media_content_id: 'http://evil.example/?d=away' } }, /not an action a model may use/],
        [{ entity_id: 'siren.hall', action: 'turn_on' }, /Never by a model: sound a siren/],
        [{ entity_id: 'cover.hall_window', action: 'open_cover' }, /Never by a model: open a cover that does not say/],
        [{ entity_id: 'light.gone', action: 'turn_on' }, /No entity light\.gone/],
      ];
      for (const [args, re] of cases) {
        const out = await home.call('home_command', args);
        assert.equal(out.isError, true, JSON.stringify(args));
        assert.match(out.text, re);
      }
      assert.equal(ha.posts.length, 0, 'not one of them reached Home Assistant');
      assert.equal((await home.call('home_command', { entity_id: 'lock.front_door', action: 'lock' })).isError, undefined, 'locking is allowed');
    } finally { await ha.close(); }
  });

  test('home: an allow that raced a relink is refused — before the relink, or while its test runs', async () => {
    const ha = await fakeHa();
    try {
      const home = H.createHome({ store: memoryStore() });
      await home.setLink(ha.url, TOKEN);
      const before = /** @type {any} */ (await home.armable());
      const relink = home.setLink(ha.url, TOKEN);
      assert.equal(home.arm(before.devices, before.generation), -1, 'a list from before the relink is refused at once');
      const during = /** @type {any} */ (await home.armable());
      home.arm(during.devices, during.generation);
      assert.equal((await relink).ok, true);
      assert.equal(home.status().armed, 0, 'whatever was allowed while the relink ran is gone once it lands');
      const after = /** @type {any} */ (await home.armable());
      assert.equal(home.arm(after.devices, after.generation), 9, 'a fresh allow works');
      assert.equal(home.arm(null), 0, 'stop needs no generation');
    } finally { await ha.close(); }
  });

  test('home: one command a second per device, 30 a minute in all', async () => {
    const ha = await fakeHa();
    try {
      let t = 1_000_000;
      const home = H.createHome({ store: memoryStore(), now: () => t });
      await home.setLink(ha.url, TOKEN);
      const al = /** @type {any} */ (await home.armable());
      home.arm(al.devices, al.generation);
      assert.equal((await home.call('home_command', { entity_id: 'light.kitchen', action: 'toggle' })).isError, undefined);
      t += 400;
      const fast = await home.call('home_command', { entity_id: 'light.kitchen', action: 'toggle' });
      assert.equal(fast.isError, true);
      assert.match(fast.text, /one command a second per device\. Wait 600 ms/);
      for (let i = 1; i < H.PER_MINUTE; i++) { t += 1000; assert.equal((await home.call('home_command', { entity_id: 'light.kitchen', action: 'toggle' })).isError, undefined, `command ${i + 1}`); }
      t += 1000;
      const flood = await home.call('home_command', { entity_id: 'light.kitchen', action: 'toggle' });
      assert.match(flood.text, /at most 30 a minute/);
      assert.equal(ha.posts.length, H.PER_MINUTE);
      t += 60_000;
      assert.equal((await home.call('home_command', { entity_id: 'light.kitchen', action: 'toggle' })).isError, undefined, 'a minute later it flows again');
    } finally { await ha.close(); }
  });

  test('home: the token is in no tool answer, even an error', async () => {
    const ha = await fakeHa();
    try {
      const home = H.createHome({ store: memoryStore() });
      await home.setLink(ha.url, TOKEN);
      const outs = [
        await home.call('home_devices', {}),
        await home.call('home_state', { entity_id: 'light.kitchen' }),
        await home.call('home_command', { entity_id: 'light.kitchen', action: 'turn_on' }),
        await home.call('home_command', { entity_id: 'lock.front_door', action: 'unlock' }),
        await home.call('home_nothing', {}),
      ];
      await ha.close();
      outs.push(await home.call('home_devices', {}));
      assert.match(outs[outs.length - 1].text, /did not answer at http:\/\/127\.0\.0\.1:\d+\./);
      for (const o of outs) assert.ok(!o.text.includes(TOKEN), o.text);
      assert.deepEqual(H.HOME_TOOLS.map((/** @type {any} */ t) => t.name), ['home_devices', 'home_state', 'home_command']);
    } finally { await ha.close().catch(() => {}); }
  });
};
