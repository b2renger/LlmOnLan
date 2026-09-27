// @ts-check
// P3b: the Computer on the farm's MESSAGE BUS, against a REAL farm/src/bus.js started here on ephemeral
// loopback ports (the mock farm advertises it). A Node WebSocket client plays the board:
//   1. Receive (bus, lol/+/light) shows a board's reading live and hands it on as {topic, data}.
//   2. A Trigger on lol/+/button: DISARMED it only counts; ARMED a press starts a run — Code decides and
//      Send (the farm's bus) publishes "led 1" back, which the board receives.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const FARM_BUS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'farm', 'src', 'bus.js');
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}

/** The board: a WebSocket on the hub that publishes and records what it hears. @param {number} port */
async function board(port) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    /** @type {{topic: string, data: any}[]} */ const heard = [];
    ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m && m.topic) heard.push(m); };
    ws.send(JSON.stringify({ sub: 'lol/+/led' }));
    return { heard, pub: (/** @type {string} */ topic, /** @type {any} */ data) => ws.send(JSON.stringify({ pub: topic, data })), close: () => ws.close() };
}

export default [
    {
        name: 'k20-farm-bus-receive-live-a-trigger-counts-disarmed-and-armed-closes-the-loop-back-to-the-board',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            const { startBus } = require(FARM_BUS);
            const bus = startBus({ host: '127.0.0.1', mqttPort: 0, wsPort: 0, oscPort: 0, key: null, log: () => {} });
            const ports = await bus.ready;
            const b = await board(ports.ws);
            try {
                await h.fresh();
                await h.computer.bus({ ws: `ws://127.0.0.1:${ports.ws}`, mqtt: `mqtt://127.0.0.1:${ports.mqtt}`, osc: `udp://127.0.0.1:${ports.osc}`, auth: false });
                await open(h);

                // 1. Receive, live.
                const recv = await h.computer.place('receive', 40, 60);
                await h.computer.set(recv, { transport: 'bus', topic: 'lol/+/light', take: 'latest' });
                await sleep(500);   // the page's subscription reaches the hub
                b.pub('lol/b1/light', { light: 321 });
                const face = await h.waitFor((id) => {
                    const el = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-receive-live`);
                    return el && /321/.test(el.textContent || '') ? el.textContent : null;
                }, { timeout: 10000, args: [recv] });
                h.assert(/lol\/b1\/light/.test(face), `the face shows the message live: ${face}`);
                await h.computer.runFrom(recv);
                const got = await h.waitFor((id) => {
                    const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === id);
                    return p && p.state === 'done' ? p.value : null;
                }, { timeout: 15000, args: [recv] });
                h.eq(got, { kind: 'json', data: { topic: 'lol/b1/light', data: { light: 321 } } }, 'handed on as {topic, data}');

                // 2. The Trigger closes the loop.
                const trig = await h.computer.place('trigger', 40, 360);
                await h.computer.set(trig, { source: 'bus', topic: 'lol/+/button', gapSec: 1, perHour: 60 });
                const decide = await h.computer.place('code', 420, 360);
                await h.computer.set(decide, { code: 'const e = inputs.in[0] || {};\nreturn e.data && e.data.pressed ? "led 1" : "led 0";' });
                await h.computer.wire(trig, decide, 'in');
                const send = await h.computer.place('send', 800, 360);
                await h.computer.set(send, { transport: 'bus', topic: 'lol/b1/led' });
                await h.computer.wire(decide, send, 'in');
                await sleep(500);

                b.pub('lol/b1/button', { pressed: true });
                const unarmed = await h.waitFor((id) => {
                    const el = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-receive-live`);
                    return el && /not armed/.test(el.textContent || '') ? el.textContent : null;
                }, { timeout: 10000, args: [trig] });
                h.assert(/1 events · 0 runs/.test(unarmed), `disarmed, it only counts: ${unarmed}`);
                const codeState = await h.eval((id) => window.LolComputer.debug.computer.doc().parts.find((x) => x.id === id).state, decide);
                h.assert(codeState !== 'done', 'no run started');

                await h.eval(() => window.lol.io.arm(true));
                b.pub('lol/b1/button', { pressed: true });
                const end = Date.now() + 15000;
                while (!b.heard.length && Date.now() < end) await sleep(100);
                await h.eval(() => window.lol.io.arm(false));
                h.eq(b.heard.map((m) => [m.topic, m.data]), [['lol/b1/led', 'led 1']], 'armed: the press started a run, and the answer reached the board');
            } finally {
                b.close();
                await bus.close();
                await h.computer.bus(null);
            }
        },
    },
];
