// @ts-check
// The Computer's Home boxes, main side (src/main/homeAssistant.ts `read`, `entities`, `actionsOf`, `command` with
// `outputsArmed`; docs/HOME_ASSISTANT.md), against the COMPILED module and a fake Home Assistant on loopback:
//   - reading: only the devices asked for, never a coordinate or a camera token, a weather's forecast and a calendar's
//     events, history thinned, and nothing POSTed but the read-only forecast;
//   - a box's command: a DRY RUN unless the outputs are armed AND home commands are allowed (and the device listed);
//     the never-list, the allowlist and the read-only domains hold for a box exactly as for a model; the rate is shared;
//   - the token is in no answer.
// The renderer half (the boxes, what a model may set, the arming list) is home-part.test.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'build', 'main', 'homeAssistant.js');
const TOKEN = 'box-test-token-never-shown';

const STATES = () => [
  { entity_id: 'sensor.co2', state: '1180', attributes: { friendly_name: 'Studio CO2', unit_of_measurement: 'ppm', device_class: 'carbon_dioxide' }, last_changed: '2026-10-09T07:00:00+00:00' },
  { entity_id: 'sensor.mode', state: 'eco', attributes: { friendly_name: 'Mode' } },
  { entity_id: 'light.ceiling', state: 'off', attributes: { friendly_name: 'Ceiling' } },
  { entity_id: 'switch.fan_plug', state: 'off', attributes: { friendly_name: 'Fan plug' } },
  { entity_id: 'lock.front_door', state: 'locked', attributes: { friendly_name: 'Front Door' } },
  { entity_id: 'cover.garage', state: 'closed', attributes: { friendly_name: 'Garage', device_class: 'garage' } },
  { entity_id: 'valve.water', state: 'closed', attributes: { friendly_name: 'Water main', device_class: 'water' } },
  { entity_id: 'person.anne', state: 'not_home', attributes: { friendly_name: 'Anne', latitude: 48.8566, longitude: 2.3522, gps_accuracy: 12 } },
  { entity_id: 'camera.porch', state: 'idle', attributes: { friendly_name: 'Porch', access_token: 'cam-secret', entity_picture: '/api/camera_proxy/camera.porch?token=cam-secret' } },
  { entity_id: 'weather.forecast_home', state: 'cloudy', attributes: { friendly_name: 'Forecast Home', temperature: 11.7 } },
  { entity_id: 'calendar.studio', state: 'off', attributes: { friendly_name: 'Studio' } },
];
const SERVICES = [
  { domain: 'light', services: { turn_on: { fields: { brightness_pct: {} } }, turn_off: {}, toggle: {} } },
  { domain: 'switch', services: { turn_on: {}, turn_off: {}, toggle: {} } },
  { domain: 'lock', services: { lock: {}, unlock: {}, open: {} } },
  { domain: 'cover', services: { open_cover: {}, close_cover: {}, toggle: {} } },
  { domain: 'valve', services: { open_valve: {}, close_valve: {} } },
  { domain: 'weather', services: { get_forecasts: {} } },
];

/** A fake Home Assistant: states, services, history, calendars, the forecast — a bearer check, every POST recorded. */
function fakeHa() {
  const states = STATES();
  /** @type {{path: string, body: any}[]} */ const posts = [];
  /** @type {string[]} */ const gets = [];
  const server = http.createServer((req, res) => {
    const send = (/** @type {number} */ code, /** @type {any} */ body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'unauthorized' });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = String(req.url);
      if (req.method === 'GET') gets.push(url);
      if (req.method === 'GET' && url === '/api/config') return send(200, { location_name: 'Studio', version: '2026.10.1', latitude: 48.85, longitude: 2.35 });
      if (req.method === 'GET' && url === '/api/states') return send(200, states);
      if (req.method === 'GET' && url.startsWith('/api/states/')) {
        const s = states.find((x) => x.entity_id === url.slice('/api/states/'.length));
        return s ? send(200, s) : send(404, { message: 'Entity not found.' });
      }
      if (req.method === 'GET' && url === '/api/services') return send(200, SERVICES);
      if (req.method === 'GET' && url.startsWith('/api/history/period/')) {
        const ids = new URL(url, 'http://x').searchParams.get('filter_entity_id').split(',');
        return send(200, ids.map((id) => Array.from({ length: id === 'sensor.co2' ? 1000 : 3 }, (_, i) => ({
          ...(i === 0 ? { entity_id: id } : {}), state: id === 'sensor.co2' ? String(400 + i) : (i % 2 ? 'on' : 'off'), last_changed: new Date(Date.UTC(2026, 9, 8) + i * 60_000).toISOString(),
        }))));
      }
      if (req.method === 'GET' && url.startsWith('/api/calendars/calendar.studio?')) {
        return send(200, [{ summary: 'Crit', start: { dateTime: '2026-10-09T10:00:00+02:00' }, end: { dateTime: '2026-10-09T12:00:00+02:00' }, location: 'B12', description: 'x'.repeat(900) }]);
      }
      if (req.method === 'POST') {
        posts.push({ path: url, body: JSON.parse(raw || '{}') });
        if (url === '/api/services/weather/get_forecasts?return_response') {
          return send(200, { changed_states: [], service_response: { 'weather.forecast_home': { forecast: [{ datetime: '2026-10-09T10:00:00+00:00', condition: 'cloudy', temperature: 16.5, templow: 11.7, wind_bearing: 203, uv_index: 3 }] } } });
        }
        const m = /^\/api\/services\/([a-z_]+)\/([a-z_]+)$/.exec(url);
        const body = posts[posts.length - 1].body;
        const s = m && states.find((x) => x.entity_id === body.entity_id);
        if (s && m[2] === 'turn_on') s.state = 'on';
        return send(200, s ? [s] : []);
      }
      send(404, { message: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = /** @type {any} */ (server.address()).port;
    resolve({ url: `http://127.0.0.1:${port}`, posts, gets, states, close: () => new Promise((r) => server.close(r)) });
  }));
}

function memoryStore() {
  /** @type {any} */ let kept = null;
  return { load: () => kept, save: (/** @type {any} */ l) => { kept = l; return true; } };
}

/** A linked home with `devices` allowed (or none). @param {any} H @param {any} ha @param {string[]|null} allow */
async function linked(H, ha, allow, extra = {}) {
  const home = H.createHome({ store: memoryStore(), ...extra });
  assert.equal((await home.setLink(ha.url, TOKEN)).ok, true);
  if (allow) {
    const list = await home.armable();
    assert.ok(home.arm(list.devices.filter((/** @type {any} */ d) => allow.includes(d.id)), list.generation) > 0);
  }
  return home;
}

export default (test) => {
  if (!fs.existsSync(BUILD)) {
    test('home boxes: build/main/homeAssistant.js exists (run npm --prefix shell run build)', () => assert.fail('not built'));
    return;
  }
  const H = require(BUILD);

  test('home boxes: thin keeps at most N points, evenly, the first and the last', () => {
    const list = Array.from({ length: 1000 }, (_, i) => i);
    const out = H.thin(list, 240);
    assert.equal(out.length, 240);
    assert.equal(out[0], 0);
    assert.equal(out[239], 999);
    assert.deepEqual(H.thin([1, 2, 3], 240), [1, 2, 3]);
  });

  test('home boxes: a reading is the devices asked for — no coordinate, no camera token, numbers as numbers, the missing named', async () => {
    const ha = await fakeHa();
    try {
      const home = await linked(H, ha, null);
      const r = await home.read(['sensor.co2', 'person.anne', 'camera.porch', 'sensor.mode', 'sensor.gone', 'not an id', 'sensor.co2'], 0);
      assert.equal(r.ok, true);
      const v = r.value;
      assert.equal(v.home, 'Studio');
      assert.deepEqual(v.devices.map((/** @type {any} */ d) => d.id), ['sensor.co2', 'person.anne', 'camera.porch', 'sensor.mode'], 'only what was asked, once, in order');
      assert.deepEqual(v.missing, ['sensor.gone']);
      const co2 = v.devices[0];
      assert.deepEqual([co2.name, co2.state, co2.value, co2.unit, co2.attributes.device_class], ['Studio CO2', '1180', 1180, 'ppm', 'carbon_dioxide']);
      assert.equal(v.devices[3].value, undefined, 'a word is not a number');
      const all = JSON.stringify(r);
      for (const secret of ['latitude', 'longitude', 'gps_accuracy', '48.8566', 'cam-secret', 'access_token', TOKEN]) assert.ok(!all.includes(secret), `no ${secret} in a reading`);
      assert.equal(ha.posts.length, 0, 'reading POSTs nothing');
    } finally { await ha.close(); }
  });

  test('home boxes: a weather brings its forecast, a calendar its next 24 hours, History its past values (thinned)', async () => {
    const ha = await fakeHa();
    try {
      const home = await linked(H, ha, null);
      const r = await home.read(['weather.forecast_home', 'calendar.studio', 'sensor.co2', 'light.ceiling'], 24);
      assert.equal(r.ok, true);
      const [w, c, co2, light] = r.value.devices;
      assert.deepEqual(w.forecast, [{ datetime: '2026-10-09T10:00:00+00:00', condition: 'cloudy', temperature: 16.5, templow: 11.7 }], 'the forecast, only the fields worth reading');
      assert.deepEqual(ha.posts.map((p) => p.path), ['/api/services/weather/get_forecasts?return_response'], 'the one POST is the read-only forecast');
      assert.deepEqual(ha.posts[0].body, { entity_id: 'weather.forecast_home', type: 'daily' });
      assert.equal(c.events.length, 1);
      assert.equal(c.events[0].summary, 'Crit');
      assert.equal(c.events[0].start, '2026-10-09T10:00:00+02:00');
      assert.equal(c.events[0].description.length, 300, 'a long description is cut');
      assert.equal(co2.history.length, H.MAX_POINTS, 'a long history is thinned');
      assert.deepEqual(co2.history[0], { at: '2026-10-08T00:00:00.000Z', value: 400 });
      assert.deepEqual(light.history.map((/** @type {any} */ p) => p.state), ['off', 'on', 'off'], 'a state that is not a number stays a word');
      const hist = ha.gets.find((g) => g.startsWith('/api/history/period/'));
      assert.ok(hist && /minimal_response/.test(hist) && /no_attributes/.test(hist), 'history asks for the light shape');
    } finally { await ha.close(); }
  });

  test('home boxes: History is capped — device-hours, one read every 5 s, the answer\'s size — and never people\'s past (review finding 4, 7)', async () => {
    const ha = await fakeHa();
    try {
      let t = 5_000_000;
      const home = await linked(H, ha, null, { now: () => t });
      const many = Array.from({ length: 5 }, (_, i) => `sensor.s${i}`);
      const big = await home.read(many, 168);
      assert.equal(big.code, 'toomuch', '5 devices × 168 h is over 720 device-hours');
      assert.ok(!ha.gets.some((g) => g.startsWith('/api/history')), 'refused before asking Home Assistant');
      assert.equal((await home.read(['sensor.co2', 'person.anne'], 168)).ok, true, 'a person does not count: their past is never read');
      const asked = ha.gets.filter((g) => g.startsWith('/api/history'));
      assert.equal(asked.length, 1);
      assert.ok(!/person\.anne/.test(asked[0]), 'no history of where a person was');
      t += 1000;
      assert.equal((await home.read(['sensor.co2'], 1)).code, 'busy', 'one history read every 5 s');
      assert.equal((await home.read(['sensor.co2'], 0)).ok, true, 'a reading without history is never held back');
      t += 5000;
      assert.equal((await home.read(['sensor.co2'], 1)).ok, true);
      const r = await home.read(['calendar.studio'], 0);
      assert.ok(!('location' in r.value.devices[0].events[0]), 'an event\'s place is left out');
    } finally { await ha.close(); }
  });

  test('home boxes: attributes hidden without case — a phone\'s Location, a speaker\'s local picture token (review finding 8)', () => {
    const a = H.cleanAttrs({ entity_id: 'sensor.phone_geocoded', state: '1 Main St', attributes: { Location: [48.85, 2.35], entity_picture_local: '/api/media_player_proxy/x?token=t', Latitude: 1, unit: 'x' } });
    assert.deepEqual(a, { unit: 'x' });
  });

  test('home boxes: a history answer past its byte cap is refused, not held in main', async () => {
    let t = 9_000_000;
    const huge = { ok: true, status: 200, body: new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); } }), json: async () => [] };
    const states = [{ entity_id: 'sensor.co2', state: '1', attributes: {} }];
    const fake = async (/** @type {string} */ url) => {
      if (url.includes('/api/history/')) return huge;
      if (url.endsWith('/api/config')) return { ok: true, status: 200, json: async () => ({ location_name: 'X' }) };
      return { ok: true, status: 200, json: async () => states };
    };
    const home = H.createHome({ store: { load: () => ({ url: 'http://ha.test', token: TOKEN }), save: () => true }, fetch: /** @type {any} */ (fake), now: () => t });
    const r = await home.read(['sensor.co2'], 24);
    assert.equal(r.code, 'toomuch');
    assert.match(r.message, /larger than 8 MB/);
  });

  test('home boxes: a reading says why it failed — nothing chosen, no link, no answer, a refused token', async () => {
    const ha = await fakeHa();
    try {
      assert.equal((await H.createHome({ store: memoryStore() }).read(['sensor.co2'], 0)).code, 'nolink');
      const home = await linked(H, ha, null);
      assert.equal((await home.read([], 0)).code, 'empty');
      assert.equal((await home.read(Array.from({ length: 31 }, (_, i) => `sensor.s${i}`), 0)).code, 'empty', 'at most 30');
      const bad = H.createHome({ store: { load: () => ({ url: ha.url, token: 'wrong' }), save: () => true } });
      const refused = await bad.read(['sensor.co2'], 0);
      assert.equal(refused.code, 'refused');
      assert.ok(!JSON.stringify(refused).includes('wrong'), 'not even a wrong token comes back');
    } finally { await ha.close(); }
    const gone = H.createHome({ store: { load: () => ({ url: ha.url, token: TOKEN }), save: () => true } });
    assert.equal((await gone.read(['sensor.co2'], 0)).code, 'offline', 'the home does not answer: offline (the box may hand on its copy)');
  });

  test('home boxes: Choose… lists the home with what a command may name; a device offers only the allowed actions', async () => {
    const ha = await fakeHa();
    try {
      const home = await linked(H, ha, null);
      const e = await home.entities();
      assert.equal(e.ok, true);
      const by = Object.fromEntries(e.list.map((/** @type {any} */ x) => [x.id, x]));
      assert.equal(by['light.ceiling'].commandable, true);
      assert.equal(by['sensor.co2'].commandable, false);
      assert.equal(by['sensor.co2'].state, '1180 ppm');
      assert.deepEqual((await home.actionsOf('lock.front_door')).actions, ['lock'], 'never unlock or open');
      assert.deepEqual((await home.actionsOf('cover.garage')).actions, ['close_cover'], 'a garage only closes');
      assert.deepEqual((await home.actionsOf('valve.water')).actions, ['close_valve']);
      assert.deepEqual((await home.actionsOf('light.ceiling')).actions, ['toggle', 'turn_off', 'turn_on']);
      assert.deepEqual((await home.actionsOf('sensor.co2')).actions, [], 'a sensor has none');
      assert.equal((await home.actionsOf('light.nope')).code, 'missing');
    } finally { await ha.close(); }
  });

  test('home boxes: a box\'s command is a DRY RUN unless the outputs are armed AND home commands are allowed — nothing leaves', async () => {
    const ha = await fakeHa();
    try {
      const req = { entity_id: 'light.ceiling', action: 'turn_on', data: { brightness_pct: 40 } };
      const none = await linked(H, ha, null);
      const a = await none.command(req, { outputsArmed: false });
      assert.equal(a.code, 'dry-outputs');
      assert.match(a.what, /light\.turn_on on Ceiling \(light\.ceiling\) with \{"brightness_pct":40\}/);
      assert.equal((await none.command(req, { outputsArmed: true })).code, 'dry-home', 'armed outputs alone are not enough');
      const allowed = await linked(H, ha, ['light.ceiling', 'switch.fan_plug']);
      assert.equal((await allowed.command(req, { outputsArmed: false })).code, 'dry-outputs', 'allowed home commands alone are not enough for a box');
      assert.equal(ha.posts.length, 0, 'no dry run reached Home Assistant');
      const done = await allowed.command(req, { outputsArmed: true });
      assert.equal(done.code, 'done');
      assert.equal(done.now, 'on');
      assert.deepEqual(ha.posts, [{ path: '/api/services/light/turn_on', body: { entity_id: 'light.ceiling', brightness_pct: 40 } }]);
      // An MCP model's command never needed the outputs (it has its own door): unchanged.
      const mcp = await allowed.call('home_command', { entity_id: 'switch.fan_plug', action: 'turn_on' });
      assert.match(mcp.text, /^Done:/);
    } finally { await ha.close(); }
  });

  test('home boxes: even armed and allowed, a box never unlocks, opens a garage or a valve, commands a sensor, or names another target', async () => {
    const ha = await fakeHa();
    try {
      const home = await linked(H, ha, ['lock.front_door', 'cover.garage', 'valve.water', 'light.ceiling']);
      const on = { outputsArmed: true };
      const never = await home.command({ entity_id: 'lock.front_door', action: 'unlock' }, on);
      assert.equal(never.code, 'never');
      assert.match(never.text, /^Never from LlmOnLan/);
      assert.equal((await home.command({ entity_id: 'cover.garage', action: 'open_cover' }, on)).code, 'never');
      assert.equal((await home.command({ entity_id: 'valve.water', action: 'open_valve' }, on)).code, 'never');
      assert.equal((await home.command({ entity_id: 'sensor.co2', action: 'turn_on' }, on)).code, 'readonly');
      assert.equal((await home.command({ entity_id: 'light.ceiling', action: 'light.blink_forever' }, on)).code, 'action');
      assert.equal((await home.command({ entity_id: 'switch.fan_plug', action: 'turn_on' }, on)).code, 'not-listed', 'a device not on the allowed list');
      assert.equal(ha.posts.length, 0, 'none of those reached Home Assistant');
      const sneaky = await home.command({ entity_id: 'light.ceiling', action: 'turn_on', data: { entity_id: 'lock.front_door', area_id: 'house', brightness_pct: 10 } }, on);
      assert.equal(sneaky.code, 'done');
      assert.deepEqual(ha.posts[0].body, { entity_id: 'light.ceiling', brightness_pct: 10 }, 'targets in the details are dropped');
    } finally { await ha.close(); }
  });

  test('home boxes: one command a second per device, shared with the models\' door', async () => {
    const ha = await fakeHa();
    try {
      let t = 1_000_000;
      const home = await linked(H, ha, ['light.ceiling'], { now: () => t });
      assert.match((await home.call('home_command', { entity_id: 'light.ceiling', action: 'turn_on' })).text, /^Done/);
      t += 300;
      assert.equal((await home.command({ entity_id: 'light.ceiling', action: 'turn_off' }, { outputsArmed: true })).code, 'rate', 'a box right after a model waits');
      t += 1000;
      assert.equal((await home.command({ entity_id: 'light.ceiling', action: 'turn_off' }, { outputsArmed: true })).code, 'done');
    } finally { await ha.close(); }
  });
};
