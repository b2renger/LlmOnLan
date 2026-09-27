// @ts-check
// Ecosystem plan v2 §3.5, P3a: the Computer's outputs to the world, against REAL sockets on this
// machine (ephemeral ports — the dev box runs a live farm).
//   1. A Send box on a DRY RUN (the default) shows what it would send, and nothing leaves.
//   2. The run bar's Outputs control asks first — listing every target — then arms; a live run lands a
//      real OSC packet on a UDP socket and a real MQTT PUBLISH on a broker.
//   3. Panic disarms; the next run is a dry run again.
import dgram from 'node:dgram';
import net from 'node:net';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}

async function runOne(/** @type {any} */ h, /** @type {string} */ id) {
    const stamp = (await h.computer.doc()).updatedAt;
    await h.computer.runFrom(id);
    await h.waitFor((pid, was) => {
        const dbg = window.LolComputer.debug.computer;
        const d = dbg.doc();
        const p = d.parts.find((x) => x.id === pid);
        return !dbg.running() && d.updatedAt !== was && p && (p.state === 'done' || p.state === 'error') ? true : null;
    }, { timeout: 30000, args: [id, stamp] });
    return (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === id);
}

/** A tiny MQTT broker: CONNACK every CONNECT, record every PUBLISH's topic and payload. */
function broker() {
    /** @type {{topic: string, payload: string}[]} */ const got = [];
    const server = net.createServer((sock) => {
        sock.on('data', (d) => {
            let i = 0;
            while (i < d.length) {
                const type = d[i] >> 4;
                let len = 0, mult = 1, j = i + 1;
                for (;;) { const b = d[j++]; len += (b & 0x7f) * mult; mult *= 128; if (!(b & 0x80)) break; }
                const body = d.subarray(j, j + len);
                if (type === 1) sock.write(Buffer.from([0x20, 0x02, 0x00, 0x00]));
                if (type === 3) { const tl = body.readUInt16BE(0); got.push({ topic: body.subarray(2, 2 + tl).toString(), payload: body.subarray(2 + tl).toString() }); }
                i = j + len;
            }
        });
        sock.on('error', () => {});
    });
    return { server, got };
}

export default [
    {
        name: 'k16-outputs-a-dry-run-by-default-arming-asks-and-lists-targets-live-lands-real-packets-panic-disarms',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            const udp = dgram.createSocket('udp4');
            /** @type {Buffer[]} */ const packets = [];
            udp.on('message', (m) => packets.push(m));
            await new Promise((r) => udp.bind(0, '127.0.0.1', () => r(null)));
            const udpPort = udp.address().port;
            const mq = broker();
            await new Promise((r) => mq.server.listen(0, '127.0.0.1', () => r(null)));
            const mqPort = /** @type {any} */ (mq.server.address()).port;
            try {
                await h.fresh();
                await open(h);
                const code = await h.computer.place('code', 60, 60);
                await h.computer.set(code, { code: 'return [0.5, 3];' });
                const osc = await h.computer.place('send', 460, 60);
                await h.computer.set(osc, { transport: 'osc', host: '127.0.0.1', port: udpPort, address: '/lol/level' });
                await h.computer.wire(code, osc, 'in');
                const mqtt = await h.computer.place('send', 460, 360);
                await h.computer.set(mqtt, { transport: 'mqtt', host: '127.0.0.1', port: mqPort, topic: 'lol/test' });
                await h.computer.wire(code, mqtt, 'in');

                // 1. Dry run: the box says what it would send; nothing leaves.
                let p = await runOne(h, code);
                p = (await h.computer.doc()).parts.find((/** @type {any} */ x) => x.id === osc);
                h.eq(p.state, 'done', `dry run: ${p.error}`);
                h.assert(/^Dry run — would send: OSC \/lol\/level \[0\.5,3\]/.test(String(p.value.data)), `says what it would send: ${p.value.data}`);
                await new Promise((r) => setTimeout(r, 300));
                h.eq(packets.length, 0, 'no UDP packet on a dry run');
                h.eq(mq.got.length, 0, 'no MQTT publish on a dry run');

                // 2. Arm: the run bar asks, and lists the targets.
                const btn = '#lolcomputer .comp-run-outputs';
                await h.waitFor((sel) => (document.querySelector(sel) && !(/** @type {any} */ (document.querySelector(sel))).hidden ? true : null), { timeout: 5000, args: [btn] });
                h.assert(/dry run/i.test(await h.eval((sel) => document.querySelector(sel).textContent, btn)), 'the control says: dry run');
                await h.input.click(btn);
                const ask = await h.waitFor(() => {
                    const d = document.querySelector('dialog.chat-dialog[open]');
                    return d ? d.textContent : null;
                }, { timeout: 5000 });
                h.assert(ask.includes(`127.0.0.1:${udpPort} /lol/level`) && ask.includes(`127.0.0.1:${mqPort} lol/test`), `the question lists every target: ${ask}`);
                await h.input.click('dialog.chat-dialog[open] .chat-dialog-ok');
                await h.waitFor((sel) => (/live/i.test((document.querySelector(sel) || {}).textContent || '') ? true : null), { timeout: 5000, args: [btn] });

                // A live run: a real OSC packet and a real MQTT PUBLISH.
                await runOne(h, code);
                await new Promise((r) => setTimeout(r, 400));
                h.eq(packets.length, 1, 'one OSC packet landed');
                h.eq(packets[0].subarray(0, 12).toString('latin1'), '/lol/level\0\0', 'addressed /lol/level');
                h.eq(mq.got.length, 1, 'one MQTT publish');
                h.eq(mq.got[0], { topic: 'lol/test', payload: '[0.5,3]' });
                p = (await h.computer.doc()).parts.find((/** @type {any} */ x) => x.id === osc);
                h.assert(/^Sent: OSC/.test(String(p.value.data)), `the box says it sent: ${p.value.data}`);

                // 3. Panic: disarmed, and the next run is a dry run again.
                await h.input.click('#lolcomputer .comp-run-panic');
                await h.waitFor((sel) => (/dry run/i.test((document.querySelector(sel) || {}).textContent || '') ? true : null), { timeout: 5000, args: [btn] });
                await runOne(h, code);
                await new Promise((r) => setTimeout(r, 300));
                h.eq(packets.length, 1, 'nothing more after Panic');
            } finally {
                udp.close();
                mq.server.close();
            }
        },
    },
];
