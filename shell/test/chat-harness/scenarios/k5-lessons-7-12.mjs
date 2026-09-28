// @ts-check
// Lessons 7–12 (2026-09-28), walked in the real browser against the mock farm with no GPU and no hardware: the
// lesson opened by CLICKING it on the Learn shelf, a box's ▶ clicked in its title bar, the rail's Got it and saved
// answer clicked; typing into a box and dragging a wire go through the debug doors, as in k5-lessons. What stands in
// for hardware is what the capability's own scenario uses: Chromium's fake microphone and camera (k23), a UDP socket
// on an ephemeral port for OSC (k16), the mock farm's speech to text (k15) and scripted agent (k22), and data.gouv.fr
// sent to a port nothing listens on (k21's h.io.map), so the Open data box hands on the copy it holds.
import dgram from 'node:dgram';
import { FARM_ERRORS, open, openLesson, waitStep, play, part, wireId, useSaved, noFarm, picture, completions } from './k5-lessons.mjs';

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const box = (/** @type {string} */ id) => `#lolcomputer .graph-part[data-id="${id}"]`;
const click = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ sel) => h.eval((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    /** @type {any} */ (el).click();
    return true;
}, `${box(id)} ${sel}`);
const faceText = (/** @type {any} */ h, /** @type {string} */ sel) => h.eval((s) => (document.querySelector(s) || {}).textContent || '', sel);
/** What an SVG box shows once it has drawn `needle` (or, after 10 s, whatever it shows). */
async function drawnWith(/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ needle) {
    for (let i = 0; i < 40; i++) {
        const now = await picture(h, id);
        if (now.includes(needle)) return now;
        await sleep(250);
    }
    return picture(h, id);
}

/** An OSC listener on an ephemeral loopback port (the dev box runs a live farm: never a fixed port). */
async function oscListener() {
    const udp = dgram.createSocket('udp4');
    /** @type {Buffer[]} */ const packets = [];
    udp.on('message', (m) => packets.push(m));
    await new Promise((r) => udp.bind(0, '127.0.0.1', () => r(null)));
    return { udp, packets, port: udp.address().port };
}

/** The run bar's Outputs control: arm it (the dialog lists the targets; OK) → the dialog's words. */
async function arm(/** @type {any} */ h) {
    const btn = '#lolcomputer .comp-run-outputs';
    await h.waitFor((sel) => (document.querySelector(sel) && !(/** @type {any} */ (document.querySelector(sel))).hidden ? true : null), { timeout: 5000, args: [btn] });
    h.assert(/dry run/i.test(await faceText(h, btn)), 'the control says: dry run');
    await h.input.click(btn);
    const ask = await h.waitFor(() => {
        const d = document.querySelector('dialog.chat-dialog[open]');
        return d ? d.textContent : null;
    }, { timeout: 5000 });
    await h.input.click('dialog.chat-dialog[open] .chat-dialog-ok');
    await h.waitFor((sel) => (/live/i.test((document.querySelector(sel) || {}).textContent || '') ? true : null), { timeout: 5000, args: [btn] });
    return String(ask);
}

/** ● Record → ~1.6 s of Chromium's fake microphone → ■ Stop. → the Sound box's settings. */
async function record(/** @type {any} */ h, /** @type {string} */ id) {
    h.eq(await click(h, id, '.graph-audio-record'), true, 'the Sound box has ● Record');
    await h.waitFor((sel) => (/Stop/.test((document.querySelector(sel) || {}).textContent || '') ? true : null), { timeout: 10000, args: [`${box(id)} .graph-audio-record`] });
    await sleep(1600);
    await click(h, id, '.graph-audio-record');
    return h.waitFor((pid) => {
        const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
        return p && p.settings && p.settings.fileId ? p.settings : null;
    }, { timeout: 15000, args: [id] });
}

export default [
    {
        name: 'k5-lessons-listen-and-speak-records-the-mic-listens-through-the-farm-and-speaks',
        needsMock: true,
        timeoutMs: 150000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);   // open() resets the mock: its state is set after it
            await h.computer.stt(true);
            await h.mock.state({ verdicts: ['Blue light scatters most in the air.'] });
            await openLesson(h, 'l07-listen-and-speak');
            // Setup, not under test: a model with a SHORT answer, so Speak says a sentence (the default mock says 1000 tokens).
            await h.computer.set('p_ask', { model: 'mock-verdict' });

            const held = await record(h, 'p_snd');
            h.assert(/^recording .+\.webm$/.test(held.name), `the box holds the recording: ${held.name}`);
            await waitStep(h, 1, 'a recording ticks step 1');
            await h.input.click(`${box('p_snd')} .graph-audio-listen-box`);
            await waitStep(h, 2, 'Listen ticks step 2');
            h.eq((await h.mock.log({ path: '/stt/v1/audio/transcriptions' })).length, 0, 'nothing has left yet: Listen sends on a run');

            h.eq((await h.computer.wire('p_snd', 'p_ask', 'in')).ok, true);
            await play(h, 'p_ask');
            const snd = await part(h, 'p_snd');
            h.assert(snd.state === 'done' && /Mock transcript of recording/.test(String(snd.value.data)), `the farm wrote the recording down: ${snd.error || snd.value.data}`);
            h.eq((await h.mock.log({ path: '/stt/v1/audio/transcriptions' })).length, 1, 'one upload, on the run');
            const asked = (await completions(h)).map((/** @type {any} */ e) => JSON.stringify(e.body)).pop() || '';
            h.assert(asked.includes('Mock transcript of recording'), 'the model was asked the WORDS, not the sound');
            await h.waitFor(() => {
                const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === 'p_speak');
                return p && p.state === 'done' ? true : null;
            }, { timeout: 30000 });
            h.assert(/Blue light scatters/.test(String((await part(h, 'p_speak')).value.data)), 'Speak said the answer and passed it on');
            await waitStep(h, 3, 'the question written down, answered and said ticks step 3');

            await h.computer.set('p_speak', { voice: 'local' });
            await play(h, 'p_speak');
            const said = await faceText(h, `${box('p_speak')} .graph-speak-said`);
            h.assert(/this computer’s voice/.test(said), `the face says which voice: ${said}`);
            await waitStep(h, 'done', 'this computer’s voice finishes the lesson');
            h.eq((await h.mock.log({ path: '/tts/v1/audio/speech' })).length, 0, 'the farm’s voice was never asked');
            h.eq((await completions(h)).length, 1, 'one generation');
        },
    },

    {
        // Most farms ship with speech to text OFF: the saved transcript flows into a REAL generation.
        name: 'k5-lessons-listen-and-speak-on-a-farm-that-cannot-listen-continues-on-the-saved-transcript',
        needsMock: true,
        timeoutMs: 150000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await h.computer.stt(false);
            await h.mock.state({ verdicts: ['Because blue light scatters the most.'] });
            await openLesson(h, 'l07-listen-and-speak');
            await h.computer.set('p_ask', { model: 'mock-verdict' });
            await record(h, 'p_snd');
            await h.input.click(`${box('p_snd')} .graph-audio-listen-box`);
            await waitStep(h, 2, 'recorded and Listen on');
            await h.computer.wire('p_snd', 'p_ask', 'in');
            await play(h, 'p_ask');
            const snd = await part(h, 'p_snd');
            h.assert(snd.state === 'error' && /cannot listen/.test(String(snd.error)), `the farm says it cannot listen: ${snd.error}`);
            h.eq(await useSaved(h), 'p_snd', 'the rail offers the saved transcript');
            await play(h, 'p_ask');
            h.eq((await part(h, 'p_ask')).state, 'done', 'a real answer, to the saved question');
            const asked = (await completions(h)).map((/** @type {any} */ e) => JSON.stringify(e.body)).pop() || '';
            h.assert(asked.includes('Why is the sky blue?'), 'the model was asked the saved transcript');
            if ((await part(h, 'p_speak')).state !== 'done') await play(h, 'p_speak');
            await waitStep(h, 3, 'transcript saved, answer real, said');
            h.eq((await h.mock.log({ path: '/stt/v1/audio/transcriptions' })).length, 0, 'the recording never left: the farm cannot listen');
        },
    },

    {
        name: 'k5-lessons-a-picture-to-a-model-takes-a-webcam-frame-and-asks-a-seeing-model-twice',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await openLesson(h, 'l08-a-picture-to-a-model');
            // Setup, not under test: the mock's default model cannot see; this one says what arrived.
            await h.computer.set('p_look', { model: 'mock-vision-echo' });

            h.eq(await click(h, 'p_img', '.graph-image-camera'), true, 'the Image box has Take a picture');
            await h.waitFor((sel) => {
                const v = /** @type {any} */ (document.querySelector(sel));
                return v && v.videoWidth > 0 ? true : null;
            }, { timeout: 10000, args: [`${box('p_img')} .graph-image-live video`] });
            await click(h, 'p_img', '.graph-image-camera-btn');   // Capture is the first of the two
            const pic = await h.waitFor(() => {
                const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === 'p_img');
                return p && p.settings && p.settings.dataUrl ? p.settings : null;
            }, { timeout: 15000 });
            h.assert(/^data:image\/jpeg;base64,/.test(pic.dataUrl) && /^camera /.test(pic.name), `one webcam frame, kept: ${pic.name}`);
            await waitStep(h, 1, 'the picture ticks step 1');
            h.eq((await completions(h)).length, 0, 'taking a picture sends nothing');

            h.eq((await h.computer.wire('p_img', 'p_look', 'in')).ok, true);
            await play(h, 'p_look');
            const look = await part(h, 'p_look');
            h.assert(look.state === 'done' && /images: 1/.test(String(look.value.data)) && /mimes: image\/jpeg/.test(String(look.value.data)),
                `the picture rode the request: ${look.error || look.value.data}`);
            await waitStep(h, 2, 'the seeing model answered');

            await h.computer.set('p_look', { instruction: 'What is the mood of this picture?' });
            await play(h, 'p_look');
            await waitStep(h, 'done', 'a new question about the same picture');
            h.eq((await completions(h)).length, 2, 'two generations');
        },
    },

    {
        name: 'k5-lessons-act-on-the-world-a-dry-run-then-armed-a-real-osc-packet-then-panic-with-no-farm',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            const osc = await oscListener();
            try {
                await h.fresh();
                await open(h);
                await noFarm(h);
                await openLesson(h, 'l09-act-on-the-world');
                // Setup, not under test: the lesson sends to port 9000 of this computer; here, to our listener.
                await h.computer.set('p_send', { port: osc.port });

                h.eq((await h.computer.wire('p_level', 'p_send', 'in')).ok, true);
                await waitStep(h, 1, 'the wire ticks step 1');
                await play(h, 'p_send');
                h.assert(/^Dry run — would send: OSC \/lol\/level 0\.75/.test(String((await part(h, 'p_send')).value.data)), 'the box says what it would send');
                await sleep(300);
                h.eq(osc.packets.length, 0, 'a dry run sends nothing');
                await waitStep(h, 2, 'the dry run ticks step 2');

                h.assert((await h.computer.tutorial.rail()).gotIt, 'arming is a dialog no check can see: the rail offers Got it');
                const ask = await arm(h);
                h.assert(ask.includes(`127.0.0.1:${osc.port} /lol/level`) && ask.includes('this computer'), `the question lists the target, on this computer: ${ask}`);
                await h.computer.tutorial.press('got');
                await waitStep(h, 3, 'Got it after arming');

                await h.computer.set('p_level', { text: '0.2' });
                await play(h, 'p_level');
                h.assert(/^Sent: OSC \/lol\/level 0\.2/.test(String((await part(h, 'p_send')).value.data)), 'the box says it sent');
                await sleep(300);
                h.eq(osc.packets.length, 1, 'one real OSC packet landed');
                h.eq(osc.packets[0].subarray(0, 12).toString('latin1'), '/lol/level\0\0', 'addressed /lol/level');
                await waitStep(h, 4, 'the new level, sent, ticks step 4');

                await h.input.click('#lolcomputer .comp-run-panic');
                await h.waitFor(() => (/dry run/i.test((document.querySelector('#lolcomputer .comp-run-outputs') || {}).textContent || '') ? true : null), { timeout: 5000 });
                await h.computer.tutorial.press('got');
                await waitStep(h, 'done', 'Panic, then Got it');
                await h.computer.set('p_level', { text: '1' });
                await play(h, 'p_level');
                await sleep(300);
                h.eq(osc.packets.length, 1, 'after Panic the next run is a dry run again');
                h.eq((await completions(h)).length, 0, 'no farm was asked anything');
            } finally {
                osc.udp.close();
            }
        },
    },

    {
        name: 'k5-lessons-hear-the-world-a-trigger-runs-the-graph-by-itself-only-while-armed-with-no-farm',
        needsMock: true,
        timeoutMs: 150000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            const osc = await oscListener();
            try {
                await h.fresh();
                await open(h);
                await noFarm(h);
                await openLesson(h, 'l10-hear-the-world');
                await h.computer.set('p_send', { port: osc.port });   // setup: our listener, not port 9000
                const status = `${box('p_trig')} .graph-receive-live`;

                h.eq((await h.computer.wire('p_trig', 'p_heard', 'in')).ok, true);
                await waitStep(h, 1, 'the wire ticks step 1');
                await h.waitFor((sel) => (/not armed/.test((document.querySelector(sel) || {}).textContent || '') ? true : null), { timeout: 10000, args: [status] });
                h.eq((await part(h, 'p_heard')).state === 'done', false, 'disarmed, a tick starts no run');
                h.eq(osc.packets.length, 0);

                await arm(h);
                const heard = await h.waitFor(() => {
                    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === 'p_heard');
                    return p && p.state === 'done' && p.value ? String(p.value.data) : null;
                }, { timeout: 15000 });
                h.assert(/^Tick \d+, heard at /.test(heard), `the Trigger pressed ▶: ${heard}`);
                await waitStep(h, 2, 'a run the Trigger started ticks step 2');
                for (let i = 0; i < 20 && !osc.packets.length; i++) await sleep(250);
                h.assert(osc.packets.length >= 1, 'armed, the Send box sent the tick');

                await h.computer.set('p_trig', { gapSec: 6 });
                await waitStep(h, 3, 'the next run after the new gap ticks step 3');
                await h.waitFor((sel) => {
                    const m = /(\d+) merged/.exec((document.querySelector(sel) || {}).textContent || '');
                    return m && Number(m[1]) >= 1 ? true : null;
                }, { timeout: 20000, args: [status] });

                await h.input.click('#lolcomputer .comp-run-outputs');   // LIVE → dry run: disarm
                await h.waitFor(() => (/dry run/i.test((document.querySelector('#lolcomputer .comp-run-outputs') || {}).textContent || '') ? true : null), { timeout: 5000 });
                await h.computer.tutorial.press('got');
                await waitStep(h, 'done', 'disarmed, Got it');
                const sent = osc.packets.length;
                await sleep(7000);
                h.eq(osc.packets.length, sent, 'disarmed: the clock ticks on, and no run starts');
                h.assert(/not armed/.test(await faceText(h, status)), 'and the face says why');
                h.eq((await completions(h)).length, 0, 'no farm was asked anything');
            } finally {
                osc.udp.close();
            }
        },
    },

    {
        name: 'k5-lessons-an-agent-with-tools-runs-code-in-the-sandbox-shows-its-steps-and-answers-inside-its-brake',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await h.mock.state({ agentSteps: [
                { tool: 'run_code', why: 'the average and the largest', code: 'const r = JSON.parse(inputs.readings); return { average: r.reduce((a, b) => a + b, 0) / r.length, largest: Math.max(...r) };', answer: '' },
                { tool: 'answer', why: 'done', code: '', answer: 'The average is about 14.7; the largest is 30.' },
            ] });
            await openLesson(h, 'l11-an-agent-with-tools');
            await h.computer.set('p_agent', { model: 'mock-agent' });   // setup: the scripted agent

            h.eq((await h.computer.wire('p_data', 'p_agent', 'in')).ok, true);
            await h.computer.label(await wireId(h, 'p_data', 'p_agent'), 'readings');
            await waitStep(h, 1, 'the named arrow ticks step 1');
            await play(h, 'p_agent');
            const agent = await part(h, 'p_agent');
            h.eq(agent.state, 'done', `the agent answered: ${agent.error}`);
            h.assert(/1\. \*\*run_code\*\* — the average and the largest\n {3}→ \{"average":14\.714285714285714,"largest":30\}/.test(String(agent.value.data)),
                `the step, with the number the SANDBOX computed: ${agent.value.data}`);
            h.eq((await part(h, 'p_view')).state, 'done', '▶ on the Agent pushed its answer into the Preview');
            await waitStep(h, 3, 'the answer and the Preview tick steps 2 and 3');
            h.eq((await completions(h)).length, 2, 'one generation per step');

            await h.computer.set('p_agent', { maxSteps: 2 });
            await play(h, 'p_agent');
            const face = await faceText(h, `${box('p_agent')} .graph-fetch-status`);
            h.assert(/Answered after 2 steps/.test(face), `inside its brake, it answered by its second step: ${face}`);
            await waitStep(h, 'done', 'the brake, and a run inside it, finish the lesson');
            h.eq((await completions(h)).length, 4, 'two more generations: one per step');
        },
    },

    {
        name: 'k5-lessons-an-agent-with-tools-with-the-farm-absent-shows-the-saved-report',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await noFarm(h);
            await openLesson(h, 'l11-an-agent-with-tools');
            await h.computer.wire('p_data', 'p_agent', 'in');
            await h.computer.label(await wireId(h, 'p_data', 'p_agent'), 'readings');
            await play(h, 'p_agent');
            h.eq((await part(h, 'p_agent')).state, 'error', 'no farm: the agent cannot think');
            h.eq(await useSaved(h), 'p_agent', 'the rail offers the saved report');
            await waitStep(h, 2, 'the saved report ticks step 2');
            await play(h, 'p_view');
            await waitStep(h, 3, '▶ on the Preview shows it');
            const shown = await faceText(h, box('p_view'));
            h.assert(/How it got there/.test(shown), `the Preview shows the steps: ${shown.slice(0, 200)}`);
            h.eq((await completions(h)).length, 0, 'nothing was sent anywhere');
        },
    },

    {
        name: 'k5-lessons-open-data-offline-the-copy-a-chart-in-code-a-seeing-model-then-another-column',
        needsMock: true,
        timeoutMs: 150000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            try {
                await h.fresh();
                // No web: data.gouv.fr is sent to a port nothing listens on — the Open data box hands on its copy.
                h.io.map({ 'https://www.data.gouv.fr/': 'http://127.0.0.1:9/', 'https://tabular-api.data.gouv.fr/': 'http://127.0.0.1:9/' });
                await open(h);
                await openLesson(h, 'l12-open-data');
                await h.computer.set('p_ask', { model: 'mock-vision-echo' });   // setup: a model that can see

                await play(h, 'p_data');
                const data = await part(h, 'p_data');
                h.assert(data.state === 'done' && data.value.data.total === 7283, `offline, the box handed on its copy: ${data.error || data.value.data.total}`);
                await waitStep(h, 1, 'the dataset ticks step 1');

                h.eq((await h.computer.wire('p_data', 'p_draw', 'in')).ok, true);
                await play(h, 'p_chart');
                let drawn = await drawnWith(h, 'p_chart', '>3229<');
                h.assert(drawn.includes('Musique') && drawn.includes('>3229<'), `the chart: data.gouv.fr’s count of music festivals, drawn by code: ${drawn.slice(0, 160)}`);
                await waitStep(h, 2, 'the chart ticks step 2');

                h.eq((await h.computer.wire('p_chart', 'p_ask', 'in')).ok, true);
                await play(h, 'p_ask');
                const ask = await part(h, 'p_ask');
                h.assert(ask.state === 'done' && /images: 1/.test(String(ask.value.data)) && /mimes: image\/png/.test(String(ask.value.data)),
                    `the model was shown the chart as a picture: ${ask.error || ask.value.data}`);
                await waitStep(h, 3, 'the model looked at the chart');

                await h.computer.set('p_col', { text: 'Région principale de déroulement' });
                await play(h, 'p_col');
                drawn = await drawnWith(h, 'p_chart', 'Auvergne');
                h.assert(drawn.includes('Auvergne-Rhône-Alpes') && drawn.includes('>947<'), 'another column, another chart');
                if ((await part(h, 'p_ask')).state !== 'done') await play(h, 'p_ask');
                await waitStep(h, 'done', 'the chart and the words followed the data');
                h.eq((await completions(h)).length, 2, 'two generations: the numbers came from the data and the code');
            } finally {
                h.io.map(null);
            }
        },
    },
];
