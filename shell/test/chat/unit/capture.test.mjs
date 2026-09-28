// @ts-check
// The microphone and camera door (graph/parts/capture.mjs; owner, 2026-09-28), against fake devices: a take
// becomes a File the boxes' own intakes read, the device is let go when the take ends, a refusal says so, and
// no API means "no device" — never a throw the box cannot word.
import assert from 'node:assert/strict';
import { startRecording, openCamera, takeName } from '../../../renderer/chat/graph/parts/capture.mjs';

/** A fake stream whose tracks remember being stopped. */
function stream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { tracks, getTracks: () => tracks };
}

/** Install fake devices for one test. @param {any} o */
function withDevices(o, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const savedRec = /** @type {any} */ (globalThis).MediaRecorder;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: o.navigator });
  /** @type {any} */ (globalThis).MediaRecorder = o.MediaRecorder;
  return Promise.resolve().then(fn).finally(() => {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete /** @type {any} */ (globalThis).navigator;
    /** @type {any} */ (globalThis).MediaRecorder = savedRec;
  });
}

/** A MediaRecorder that hands back two chunks when it stops. */
class FakeRecorder {
  /** @param {any} s @param {any} opts */
  constructor(s, opts) { this.s = s; this.opts = opts; this.ondataavailable = null; this.onstop = null; }
  static isTypeSupported() { return true; }
  start() { this.started = true; }
  stop() {
    this.ondataavailable({ data: new Blob(['ab']) });
    this.ondataavailable({ data: new Blob(['cd']) });
    this.onstop();
  }
}

export default (test) => {
  test('capture: a take is named by what and when, with nothing a file system refuses', () => {
    assert.equal(takeName('recording', 'webm', new Date(2026, 8, 28, 9, 5, 7)), 'recording 2026-09-28 09-05-07.webm');
  });

  test('capture: the microphone records into a webm File and is let go when the take stops', async () => {
    const s = stream();
    await withDevices({ navigator: { mediaDevices: { getUserMedia: async (/** @type {any} */ c) => { assert.deepEqual(c, { audio: true }); return s; } } }, MediaRecorder: FakeRecorder }, async () => {
      const rec = await startRecording({ maxSec: 60 });
      const file = await rec.stop();
      assert.ok(file instanceof File);
      assert.match(file.name, /^recording .+\.webm$/);
      assert.equal(file.type, 'audio/webm');
      assert.equal(await file.text(), 'abcd', 'every chunk, in order');
      assert.equal(s.tracks[0].stopped, true, 'the microphone is released');
      assert.equal(await rec.stop(), file, 'a second stop is the same take');
    });
  });

  test('capture: the length cap ends a take by itself; cancel keeps nothing and still releases the device', async () => {
    const s = stream();
    let ended = false;
    await withDevices({ navigator: { mediaDevices: { getUserMedia: async () => s } }, MediaRecorder: FakeRecorder }, async () => {
      await startRecording({ maxSec: 0.05, onEnd: () => { ended = true; } });
      await new Promise((r) => setTimeout(r, 1100));
      assert.equal(ended, true, 'maxSec ended it');
      assert.equal(s.tracks[0].stopped, true);
      const s2 = stream();
      /** @type {any} */ (globalThis.navigator).mediaDevices.getUserMedia = async () => s2;
      const rec = await startRecording({ maxSec: 60 });
      rec.cancel();
      assert.equal(s2.tracks[0].stopped, true, 'cancel releases it too');
    });
  });

  test('capture: a refused or missing device is a code the box can word, never a crash', async () => {
    await withDevices({ navigator: { mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } } }, MediaRecorder: FakeRecorder }, async () => {
      await assert.rejects(startRecording({ maxSec: 5 }), (/** @type {any} */ e) => e.code === 'refused');
      await assert.rejects(openCamera({}), (/** @type {any} */ e) => e.code === 'refused');
    });
    await withDevices({ navigator: {}, MediaRecorder: undefined }, async () => {
      await assert.rejects(startRecording({ maxSec: 5 }), (/** @type {any} */ e) => e.code === 'no-device');
      await assert.rejects(openCamera({}), (/** @type {any} */ e) => e.code === 'no-device');
    });
  });

  test('capture: the camera shows in the video, one frame becomes a JPEG File, and the camera closes', async () => {
    const s = stream();
    /** @type {any} */ const drawn = [];
    const video = {
      videoWidth: 640, videoHeight: 480, srcObject: null, muted: false, playsInline: false,
      play: async () => {},
      ownerDocument: {
        createElement: () => ({
          width: 0, height: 0,
          getContext: () => ({ drawImage: (/** @type {any[]} */ ...a) => drawn.push(a) }),
          toBlob: (/** @type {any} */ cb, /** @type {string} */ type) => cb(new Blob(['jpeg-bytes'], { type })),
        }),
      },
    };
    await withDevices({ navigator: { mediaDevices: { getUserMedia: async (/** @type {any} */ c) => { assert.equal(c.audio, false); return s; } } }, MediaRecorder: FakeRecorder }, async () => {
      const cam = await openCamera(video);
      assert.equal(video.srcObject, s, 'the live view is the stream itself (no URL)');
      const file = await cam.snap();
      assert.ok(file instanceof File);
      assert.match(file.name, /^camera .+\.jpg$/);
      assert.equal(file.type, 'image/jpeg');
      assert.equal(drawn.length, 1, 'one frame');
      assert.equal(s.tracks[0].stopped, true, 'the camera light goes off after the capture');
      assert.equal(video.srcObject, null);
    });
  });
};
