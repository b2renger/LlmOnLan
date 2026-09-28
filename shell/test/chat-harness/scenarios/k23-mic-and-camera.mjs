// @ts-check
// Owner, 2026-09-28: "it should take input from the mic … take a picture for analysis from webcam". In the real
// page with Chromium's fake devices (the harness main turns them on: a tone, a test pattern):
//   1. The Sound box's ● Record records the microphone, ■ Stop keeps it through the box's own intake — the box then
//      HOLDS a sound, with its length, stored on this computer.
//   2. The Image box's Take a picture shows the camera in the box; Capture keeps one frame through the picture
//      intake (a JPEG within the 1536 px edge) and the live view closes.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}
const click = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ sel) => h.eval((pid, s) => {
    const el = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] ${s}`);
    if (!el) return false;
    /** @type {any} */ (el).click();
    return true;
}, id, sel);

export default [
    {
        name: 'k23-the-sound-box-records-the-microphone-and-the-image-box-takes-a-webcam-picture',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            // 1. ● Record → ■ Stop.
            const snd = await h.computer.place('audio', 40, 60);
            h.eq(await click(h, snd, '.graph-audio-record'), true, 'the Sound box has ● Record');
            const recording = await h.waitFor((id) => {
                const b = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-audio-record`);
                return b && /Stop/.test(b.textContent || '') ? b.textContent : null;
            }, { timeout: 10000, args: [snd] });
            h.assert(/■ Stop · 0:0/.test(recording), `the button says it records, and for how long: ${recording}`);
            await sleep(1600);
            await click(h, snd, '.graph-audio-record');
            const held = await h.waitFor((id) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === id);
                return p && p.settings && p.settings.fileId ? p.settings : null;
            }, { timeout: 15000, args: [snd] });
            h.assert(/^recording .+\.webm$/.test(held.name), `the box holds the recording: ${held.name}`);
            h.assert(held.durationSec >= 1 && held.durationSec <= 4, `about as long as it was recorded: ${held.durationSec} s`);

            // 2. Take a picture → Capture.
            const img = await h.computer.place('image', 420, 60);
            h.eq(await click(h, img, '.graph-image-camera'), true, 'the Image box has Take a picture');
            await h.waitFor((id) => {
                const v = /** @type {any} */ (document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-image-live video`));
                return v && v.videoWidth > 0 ? true : null;
            }, { timeout: 10000, args: [img] });
            await click(h, img, '.graph-image-camera-btn');   // Capture is the first of the two
            const pic = await h.waitFor((id) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === id);
                return p && p.settings && p.settings.dataUrl ? p.settings : null;
            }, { timeout: 15000, args: [img] });
            h.assert(/^data:image\/jpeg;base64,/.test(pic.dataUrl), 'a JPEG, as the picture intake keeps it');
            h.assert(pic.w > 0 && pic.w <= 1536 && pic.h > 0, `within the intake's edge: ${pic.w}×${pic.h}`);
            h.assert(/^camera .+\.jpg$/.test(pic.name), `named for the camera: ${pic.name}`);
            const live = await h.eval((id) => {
                const v = /** @type {any} */ (document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-image-live video`));
                return { hidden: /** @type {any} */ (document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-image-live`)).hidden, stream: !!(v && v.srcObject) };
            }, img);
            h.eq(live, { hidden: true, stream: false }, 'the live view closed and the camera was let go');
        },
    },
];
