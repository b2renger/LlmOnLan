'use strict';
// The harness's microphone (docs/COMPUTER_VOICE_PLAN.md §11): Chromium's fake audio capture reads a WAV
// (`--use-file-for-fake-audio-capture`, chat-harness/main.cjs) and loops it. This writes that WAV:
// 1 s of silence, 1.5 s of something speech-like (a 140 Hz voice with its harmonics, in syllables of
// a quarter second), 2 s of silence — 4.5 s, looped. Generated at each run, so no binary is committed.
// A Converse box hears one turn per loop; the Sound box's ● Record (k23) records it like any sound.

const fs = require('fs');

const RATE = 48000;

/** @param {number} seconds @returns {Float32Array} */
function speechLike(seconds) {
    const n = Math.round(seconds * RATE);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / RATE;
        const f0 = 140 + 15 * Math.sin(2 * Math.PI * 0.7 * t);           // a voice's pitch moves
        let v = 0;
        for (let k = 1; k <= 12; k++) v += Math.sin(2 * Math.PI * f0 * k * t) / k;
        const syllables = 0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * 2 * t));   // four a second
        const edge = Math.min(1, t / 0.03, (seconds - t) / 0.03);           // no click at either end
        out[i] = 0.32 * v * syllables * Math.max(0, edge);
    }
    return out;
}

/** The fixture as WAV bytes (48 kHz, 16-bit, mono). @returns {Buffer} */
function micFixture() {
    const parts = [new Float32Array(RATE * 1), speechLike(1.5), new Float32Array(RATE * 2)];
    const n = parts.reduce((s, p) => s + p.length, 0);
    const b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii');
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24);
    b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(n * 2, 40);
    let at = 44;
    for (const p of parts) for (let i = 0; i < p.length; i++, at += 2) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, p[i])) * 32767), at);
    return b;
}

/** Write the fixture to `file` and return its path. @param {string} file */
function writeMicFixture(file) {
    fs.writeFileSync(file, micFixture());
    return file;
}

module.exports = { micFixture, writeMicFixture, RATE };
