// @ts-check
// The Home boxes (docs/HOME_ASSISTANT.md, 2026-10-09) in the real Computer, over the REAL homeAssistant.js and
// outputs.js (chat-harness/main.cjs wireHome):
//   1. With NO home linked: lessons 13 and 14 walked by clicking the Learn shelf (the Home box hands on the reading it
//      holds and says so; the Home command is a dry run that says no home is linked), the run bar's arming question
//      naming the Home command, and the three templates run whole on the mock farm.
//   2. Against a private Home Assistant (the demo home in WSL, docs/HOME_ASSISTANT.md "A private test home") — only
//      when LOL_HARNESS_HA names a JSON file {url, token}: Choose… lists the home, a live reading (states, forecast,
//      calendar, history), a command that stays a dry run until BOTH the outputs are armed and home commands allowed,
//      the never-list, Panic. It turns the light it lit back off.
import fs from 'node:fs';
import path from 'node:path';
import { FARM_ERRORS, open, openLesson, waitStep, play, part } from './k5-lessons.mjs';

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const box = (/** @type {string} */ id) => `#lolcomputer .graph-part[data-id="${id}"]`;
const faceText = (/** @type {any} */ h, /** @type {string} */ sel) => h.eval((s) => (document.querySelector(s) || {}).textContent || '', sel);
const OUTPUTS = '#lolcomputer .comp-run-outputs';

/** Arm the outputs from the run bar → the question's words. */
async function arm(/** @type {any} */ h) {
    await h.waitFor((sel) => (document.querySelector(sel) && !(/** @type {any} */ (document.querySelector(sel))).hidden ? true : null), { timeout: 5000, args: [OUTPUTS] });
    await h.input.click(OUTPUTS);
    const ask = await h.waitFor(() => {
        const d = document.querySelector('dialog.chat-dialog[open]');
        return d ? d.textContent : null;
    }, { timeout: 5000 });
    await h.input.click('dialog.chat-dialog[open] .chat-dialog-ok');
    await h.waitFor((sel) => (/live/i.test((document.querySelector(sel) || {}).textContent || '') ? true : null), { timeout: 5000, args: [OUTPUTS] });
    return String(ask);
}

/** Run everything and wait for the run to settle. */
async function runAll(/** @type {any} */ h) {
    const stamp = await h.eval(() => window.LolComputer.debug.computer.doc().updatedAt);
    await h.computer.run({});
    await h.waitFor((was) => {
        const dbg = window.LolComputer.debug.computer;
        return !dbg.running() && dbg.doc().updatedAt !== was ? true : null;
    }, { timeout: 120000, args: [stamp] });
    await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 120000 });
}

/** Open a template by clicking it on the Learn shelf. */
async function openTemplate(/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ title) {
    await h.computer.tutorial.openTemplate(id);
    await h.waitFor((t) => (window.LolComputer.debug.computer.doc().title === t ? true : null), { timeout: 15000, args: [title] });
}

export default [
    {
        name: 'k26-home-lessons-13-14-and-the-templates-walk-with-no-home',
        needsMock: true,
        timeoutMs: 240000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            try { fs.rmSync(path.join(h.tmpDir, 'home-link.json'), { force: true }); } catch { /* none */ }
            await h.fresh();
            await open(h);
            await h.mock.state({ verdicts: ['The room is warm and getting stuffy: open a window for ten minutes.'] });

            // Lesson 13: the reading it holds, a model's words, Speak.
            await openLesson(h, 'l13-read-the-room');
            await h.computer.set('p_ask', { model: 'mock-verdict' });   // setup: a short answer for Speak
            h.eq(await play(h, 'p_home'), 'done', 'with no home the Home box still hands something on');
            const home = await part(h, 'p_home');
            h.eq(home.value.data.devices.map((/** @type {any} */ d) => d.value), [23.8, 41, 1180], 'the reading it holds');
            h.assert(/Saved copy — No Home Assistant is linked/.test(await faceText(h, `${box('p_home')} .graph-fetch-status`)), 'the face says it is the saved copy, and why');
            await waitStep(h, 1, 'the reading ticks step 1');
            h.eq((await h.computer.wire('p_home', 'p_ask', 'in')).ok, true);
            h.eq(await play(h, 'p_ask'), 'done');
            const asked = await h.mock.log({ path: '/v1/chat/completions' });
            h.assert(asked.length >= 1 && JSON.stringify(asked[asked.length - 1]).includes('1180'), 'the reading went to the model inside the Instruction');
            await waitStep(h, 2, 'the Instruction ticks step 2');
            h.eq((await h.computer.wire('p_ask', 'p_speak', 'in')).ok, true);
            await h.computer.set('p_speak', { voice: 'local' });
            await play(h, 'p_speak');
            await waitStep(h, 3, 'Speak ticks step 3');
            h.assert((await h.computer.tutorial.rail()).gotIt, 'picking your own sensors is a manual step');
            await h.computer.tutorial.press('got');
            await waitStep(h, 'done', 'Got it ends lesson 13');

            // Lesson 14: a dry run that says no home is linked; the arming question names the Home command.
            await openLesson(h, 'l14-switch-the-home');
            h.eq((await h.computer.wire('p_how', 'p_cmd', 'in')).ok, true);
            await waitStep(h, 1, 'the wire ticks step 1');
            h.eq(await play(h, 'p_cmd'), 'done', 'a dry run is not a failure');
            h.eq(String((await part(h, 'p_cmd')).value.data), 'Dry run — no Home Assistant is linked. It would do turn_on on Studio ceiling.');
            await waitStep(h, 2, 'the dry run ticks step 2');
            await h.computer.tutorial.press('got');
            await waitStep(h, 3, 'Got it (allow commands)');
            const ask = await arm(h);
            h.assert(ask.includes('Home Assistant → turn_on on light.studio_ceiling “Studio ceiling” with {"brightness_pct": 40}'), `the arming question names the Home command: ${ask}`);
            h.assert(ask.includes('Home command boxes switch your home'), 'and says what arming means for the home');
            await h.computer.tutorial.press('got');
            await waitStep(h, 4, 'Got it (armed)');
            await h.computer.set('p_cmd', { data: '{"brightness_pct": 100}' });
            await play(h, 'p_how');
            h.eq(String((await part(h, 'p_cmd')).value.data), 'Dry run — no Home Assistant is linked. It would do turn_on on Studio ceiling.', 'armed, still nothing without a home');
            await waitStep(h, 5, 'the new brightness ticks step 5');
            h.eq(await h.eval(() => !(/** @type {any} */ (document.querySelector('#lolcomputer .comp-run-panic'))).hidden), true, 'Panic shows with a Home command');
            await h.input.click('#lolcomputer .comp-run-panic');
            await h.waitFor((sel) => (/dry run/i.test((document.querySelector(sel) || {}).textContent || '') ? true : null), { timeout: 5000, args: [OUTPUTS] });
            await h.computer.tutorial.press('got');
            await waitStep(h, 'done', 'Panic, then Got it');

            // Arming is refused while a run is going (the security review, 2026-10-09): a run never turns live half-way.
            const tick = await h.computer.place('note', 60, 800);
            await h.computer.set(tick, { text: 'go' });
            const wait = await h.computer.place('timer', 400, 800);
            await h.computer.set(wait, { seconds: 4 });
            h.eq((await h.computer.wire(tick, wait, 'in')).ok, true);
            h.eq((await h.computer.wire(wait, 'p_cmd', 'in')).ok, true);
            await h.eval((id) => { void window.LolComputer.debug.computer.runFrom(id, {}); return true; }, tick);   // not awaited: the run is still going
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? true : null), { timeout: 5000 });
            await h.input.click(OUTPUTS);
            await sleep(300);
            h.eq(await h.eval(() => !!document.querySelector('dialog.chat-dialog[open]')), false, 'no arming question while a run is going');
            h.assert(/dry run/i.test(await faceText(h, OUTPUTS)), 'still a dry run');
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 20000 });

            // The three templates, run whole on the mock farm with no home. A template opens as a new library graph
            // with new ids: its boxes are found by kind.
            const find = async (/** @type {string} */ type, /** @type {(p: any) => boolean} */ pick = () => true) => (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.type === type && pick(p));
            await openTemplate(h, 'morning-briefing', 'Morning briefing');
            await h.computer.set((await find('ask')).id, { model: 'mock-verdict' });
            await h.computer.set((await find('speak')).id, { voice: 'local' });
            await runAll(h);
            h.eq((await find('home')).state, 'done', 'Morning briefing: the reading it holds');
            h.eq((await find('ask')).state, 'done', 'Morning briefing: the words');
            const last = (await h.mock.log({ path: '/v1/chat/completions' })).pop();
            h.assert(/Crit — 2nd-year typography/.test(JSON.stringify(last)) && /partlycloudy/.test(JSON.stringify(last)), 'the forecast and the calendar reached the model');

            await openTemplate(h, 'comfort-advisor', 'Comfort advisor');
            await h.computer.set((await find('ask')).id, { model: 'mock-verdict' });
            await h.computer.set((await find('speak')).id, { voice: 'local' });
            await runAll(h);
            const check = await find('code', (p) => /^Decides/.test(p.settings.about));
            const stuffy = await find('code', (p) => /^Is the air/.test(p.settings.about));
            const fan = await find('home-command');
            h.eq(check.state, 'done', 'code decided: ' + check.error);
            h.eq(String(check.value.data), '- CO2 1180 ppm: getting stuffy\n- Temperature 23.8 °C: comfortable\n- Humidity 41 %: comfortable', 'code decides from the numbers');
            h.eq(stuffy.value.data, true, 'over 1000 ppm: stuffy');
            h.eq(fan.state, 'done', "the fan's command ran (a dry run): " + fan.error);
            h.eq(String(fan.value.data), 'Dry run — no Home Assistant is linked. It would do turn_on on Studio fan plug.');
            h.eq((await find('ask')).state, 'done');

            await openTemplate(h, 'energy-report', 'Energy report');
            await h.computer.set((await find('ask')).id, { model: 'mock-vision-echo' });   // setup: a model that can see
            await runAll(h);
            const chart = await find('code');
            h.eq(chart.state, 'done', 'the chart code ran: ' + chart.error);
            const svg = String(chart.value.data);
            h.assert(svg.includes('Laser cutter plug power') && /peak 4\d\d W/.test(svg) && /used \d+\.\d\d kWh/.test(svg), 'the chart carries the numbers: ' + svg.slice(0, 400));
            const looked = await find('ask');
            h.assert(looked.state === 'done' && /mimes: image\/png/.test(String(looked.value.data)), 'the model was shown the chart as a picture: ' + (looked.error || looked.value.data));
        },
    },
    {
        name: 'k26-home-against-a-private-home-assistant-dry-run-until-armed-and-allowed',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            const credsFile = process.env.LOL_HARNESS_HA || '';
            if (!credsFile || !fs.existsSync(credsFile)) { console.log('    (skipped: LOL_HARNESS_HA names no {url, token} file — the demo home is not up)'); return; }
            const { url, token } = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
            const ha = async (/** @type {string} */ p, /** @type {any} */ body) => {
                const r = await fetch(url + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
                return r.json();
            };
            await ha('/api/services/light/turn_off', { entity_id: 'light.bed_light' });
            const linkFile = path.join(h.tmpDir, 'home-link.json');
            const allowFile = path.join(h.tmpDir, 'home-allow.json');
            fs.rmSync(allowFile, { force: true });
            fs.writeFileSync(linkFile, JSON.stringify({ url, token }));
            try {
                await h.fresh();
                await open(h);
                // A linked home that lacks the lesson's devices: an error that says to choose — never the lesson's made-up reading.
                await openLesson(h, 'l13-read-the-room');
                h.eq(await play(h, 'p_home'), 'error', 'the lesson’s ids are not in this home');
                h.assert(/None of these devices is in your home/.test(String((await part(h, 'p_home')).error)), String((await part(h, 'p_home')).error));
                await h.eval(async () => { await window.LolComputer.debug.library.create('Home live'); return true; });
                await h.waitFor(() => (window.LolComputer.debug.computer.doc().title === 'Home live' ? true : null), { timeout: 10000 });
                const reader = await h.computer.place('home', 60, 60);

                // Choose…: the home's own list, searched, ticked, Done.
                await h.eval((sel) => /** @type {any} */ (document.querySelector(sel)).click(), `${box(reader)} .graph-board-choose`);
                await h.waitFor(() => (document.querySelector('.graph-home-list .graph-home-row') ? true : null), { timeout: 10000 });
                await h.eval(() => {
                    const s = /** @type {any} */ (document.querySelector('.graph-home-list input[type="search"]'));
                    s.value = 'carbon dioxide';
                    s.dispatchEvent(new Event('input'));
                });
                const rows = await h.eval(() => [...document.querySelectorAll('.graph-home-list .graph-home-row')].map((b) => b.getAttribute('title')));
                h.assert(rows.includes('sensor.carbon_dioxide'), `the search finds the CO2 sensor: ${rows}`);
                await h.eval(() => /** @type {any} */ ([...document.querySelectorAll('.graph-home-list .graph-home-row')].find((b) => b.getAttribute('title') === 'sensor.carbon_dioxide')).click());
                await h.eval(() => /** @type {any} */ ([...document.querySelectorAll('.graph-home-list button')].find((b) => b.textContent === 'Done')).click());
                await h.waitFor((pid) => {
                    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
                    return p && p.settings.entities && p.settings.entities.length === 1 ? true : null;
                }, { timeout: 5000, args: [reader] });
                h.eq((await part(h, reader)).settings.names, { 'sensor.carbon_dioxide': 'Carbon dioxide' }, 'the person\'s pick, with its name');

                // A live reading: states, the forecast, a calendar, an hour of history.
                await h.computer.set(reader, { entities: ['sensor.carbon_dioxide', 'sensor.outside_temperature', 'weather.forecast_lol_test_home', 'calendar.calendar_1', 'person.lol'], hours: 1 });
                h.eq(await play(h, reader), 'done');
                const v = (await part(h, reader)).value.data;
                const by = Object.fromEntries(v.devices.map((/** @type {any} */ d) => [d.id, d]));
                h.eq(v.home, 'LOL Test Home');
                h.eq(by['sensor.outside_temperature'].unit, '°C');
                h.eq(typeof by['sensor.outside_temperature'].value, 'number');
                h.assert(Array.isArray(by['weather.forecast_lol_test_home'].forecast) && by['weather.forecast_lol_test_home'].forecast.length > 0, 'the forecast came with the weather');
                h.assert(Array.isArray(by['calendar.calendar_1'].events), 'the calendar brought its events');
                h.assert(Array.isArray(by['sensor.carbon_dioxide'].history) && by['sensor.carbon_dioxide'].history.length >= 1, 'an hour of history');
                h.assert(!/latitude|longitude|gps_accuracy/.test(JSON.stringify(v)), 'no coordinate in a reading');
                h.assert(/^Read [45] from LOL Test Home/.test(await faceText(h, `${box(reader)} .graph-fetch-status`)), 'the face says what it read');

                // A command: the person's device and action; a dry run until BOTH gates are open.
                const go = await h.computer.place('note', 60, 400);
                await h.computer.set(go, { text: '{"brightness_pct": 100, "entity_id": "lock.front_door"}' });   // only the go signal: never the details
                const cmd = await h.computer.place('home-command', 460, 400);
                await h.computer.set(cmd, { entity: 'light.bed_light', name: 'Bed Light', action: 'turn_on', data: '{"brightness_pct": 30}' });
                h.eq((await h.computer.wire(go, cmd, 'in')).ok, true);
                await play(h, go);
                h.assert(/^Dry run — would do light\.turn_on on Bed Light \(light\.bed_light\) with \{"brightness_pct":30\}\. Arm the outputs/.test(String((await part(h, cmd)).value.data)), `not armed: ${(await part(h, cmd)).value.data}`);
                const ask = await arm(h);
                h.assert(ask.includes('Home Assistant → turn_on on light.bed_light “Bed Light” with {"brightness_pct": 30}'), `the question names it: ${ask}`);
                await play(h, go);
                h.assert(/Allow home commands in Preferences/.test(String((await part(h, cmd)).value.data)), `armed, not allowed: ${(await part(h, cmd)).value.data}`);
                h.eq((await ha('/api/states/light.bed_light')).state, 'off', 'two dry runs: the light is still off');

                fs.writeFileSync(allowFile, JSON.stringify({ allow: true }));   // stands in for the person's click on main's native dialog
                await sleep(1100);
                await play(h, go);
                h.assert(/^Done: light\.turn_on on Bed Light .* It is now on\.$/.test(String((await part(h, cmd)).value.data)), `armed and allowed: ${(await part(h, cmd)).value.data}`);
                const lit = await ha('/api/states/light.bed_light');
                h.eq(lit.state, 'on', 'the real light is on');
                h.assert(Math.abs(lit.attributes.brightness - 0.3 * 255) <= 1, `at 30 %: ${lit.attributes.brightness}`);

                // The never-list holds even now.
                await h.computer.set(cmd, { entity: 'lock.front_door', name: 'Front Door', action: 'unlock' });
                await play(h, go);
                const refused = await part(h, cmd);
                h.eq(refused.state, 'error');
                h.assert(/^Never from LlmOnLan: unlock or open a lock/.test(String(refused.error)), `refused: ${refused.error}`);
                h.eq((await ha('/api/states/lock.front_door')).state, 'locked', 'the door stays locked');

                // Panic: a dry run again.
                await h.computer.set(cmd, { entity: 'light.bed_light', name: 'Bed Light', action: 'turn_off' });
                await h.input.click('#lolcomputer .comp-run-panic');
                await h.waitFor((sel) => (/dry run/i.test((document.querySelector(sel) || {}).textContent || '') ? true : null), { timeout: 5000, args: [OUTPUTS] });
                await sleep(1100);
                await play(h, go);
                h.assert(/^Dry run/.test(String((await part(h, cmd)).value.data)), 'after Panic: a dry run');
                h.eq((await ha('/api/states/light.bed_light')).state, 'on', 'nothing switched after Panic');
            } finally {
                await ha('/api/services/light/turn_off', { entity_id: 'light.bed_light' });
                fs.rmSync(linkFile, { force: true });
                fs.rmSync(allowFile, { force: true });
            }
        },
    },
];
