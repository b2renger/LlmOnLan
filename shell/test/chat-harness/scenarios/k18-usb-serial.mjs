// @ts-check
// Ecosystem plan v2 §8d, P3a-2: USB serial both ways, against a FAKE board injected into the page's Web
// Serial (a port whose readable stream says lines, whose writable stream records what was sent) — the
// harness has no USB, and the real chooser (main's select-serial-port) is exercised on the rig.
//   1. Receive shows the board's last line live, and hands it on as data.
//   2. The round trip: Receive → Code (dark? "led 1") → Send by USB: a DRY RUN writes nothing; armed, the
//      line reaches the board.
//   3. The "Talk to a board" template opens whole.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}

async function runOne(/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ last) {
    const stamp = (await h.computer.doc()).updatedAt;
    await h.computer.runFrom(id);
    await h.waitFor((pid, was) => {
        const dbg = window.LolComputer.debug.computer;
        const d = dbg.doc();
        const p = d.parts.find((x) => x.id === pid);
        return !dbg.running() && d.updatedAt !== was && p && (p.state === 'done' || p.state === 'error') ? true : null;
    }, { timeout: 30000, args: [last, stamp] });
    return h.computer.doc();
}

export default [
    {
        name: 'k18-usb-serial-receive-live-the-round-trip-dry-then-armed-and-the-template',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            // A fake Uno on the page's Web Serial.
            await h.eval(() => {
                let ctl = null;
                const board = { written: [], opened: 0, say: (s) => ctl.enqueue(new TextEncoder().encode(s)) };
                const port = {
                    getInfo: () => ({ usbVendorId: 0x2341, usbProductId: 0x0043 }),
                    open: async () => { board.opened += 1; },
                    close: async () => {},
                    readable: new ReadableStream({ start(c) { ctl = c; } }),
                    writable: new WritableStream({ write(chunk) { board.written.push(new TextDecoder().decode(chunk)); } }),
                };
                Object.defineProperty(navigator, 'serial', { configurable: true, value: { getPorts: async () => [port], requestPort: async () => port } });
                window.__board = board;
                return true;
            });
            const board = { serialPort: 'usb:2341:0043', serialLabel: 'Arduino Uno', baud: 115200 };

            const recv = await h.computer.place('receive', 40, 60);
            await h.computer.set(recv, { ...board, take: 'latest' });
            await h.waitFor(() => (window.__board.opened ? true : null), { timeout: 10000 });
            await h.eval(() => { window.__board.say('{"light":321,"ms":10}\n'); return true; });
            const face = await h.waitFor((id) => {
                const el = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-receive-live`);
                return el && /321/.test(el.textContent || '') ? el.textContent : null;
            }, { timeout: 10000, args: [recv] });
            h.assert(/Last line: \{"light":321/.test(face), `the face shows the board's last line live: ${face}`);

            const decide = await h.computer.place('code', 420, 60);
            await h.computer.set(decide, { code: 'const r = inputs.in[0] || {};\nreturn Number(r.light) < 400 ? "led 1" : "led 0";', about: 'Dark → LED on' });
            await h.computer.wire(recv, decide, 'in');
            const send = await h.computer.place('send', 800, 60);
            await h.computer.set(send, { transport: 'serial', ...board });
            await h.computer.wire(decide, send, 'in');

            let doc = await runOne(h, recv, send);
            const byId = (/** @type {string} */ id) => doc.parts.find((/** @type {any} */ p) => p.id === id);
            h.eq(byId(recv).value, { kind: 'json', data: { light: 321, ms: 10 } }, 'a JSON line flows on as data');
            h.eq(byId(decide).value.data, 'led 1', 'the round trip decides from the reading');
            h.eq(byId(send).state, 'done', `the Send ran: ${byId(send).error}`);
            h.assert(/Dry run — would send: USB ← led 1/.test(byId(send).value.data), `disarmed, it is a dry run: ${byId(send).value.data}`);
            h.eq(await h.eval(() => window.__board.written), [], 'and nothing reached the board');

            await h.eval(() => window.lol.io.arm(true));
            doc = await runOne(h, recv, send);
            h.assert(/Sent: USB ← led 1/.test(byId(send).value.data), `armed, it is sent: ${byId(send).value.data}`);
            h.eq(await h.eval(() => window.__board.written), ['led 1\n'], 'the line reached the board, one line');
            await h.eval(() => window.lol.io.arm(false));

            // The template opens whole, with the sketch students copy.
            const before = await h.computer.call('docId');
            await h.computer.tutorial.openTemplate('talk-to-a-board');
            await h.waitFor((was) => {
                const id = window.LolComputer.debug.computer.docId();
                const d = window.LolComputer.debug.computer.doc();
                return id && id !== was && d && d.parts.some((p) => p.type === 'receive') ? id : null;
            }, { timeout: 15000, args: [before] });
            doc = await h.computer.doc();
            h.eq(doc.parts.length, 10, 'every box of the template');
            h.assert(doc.parts.some((/** @type {any} */ p) => p.type === 'note' && /void loop\(\)/.test(p.settings.text)), 'the Arduino sketch rides along in a Text box');
        },
    },
];
