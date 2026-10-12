// @ts-check
// This computer's MICROPHONE and CAMERA, for the Sound and Image boxes (owner, 2026-09-28: "it should take input
// from the mic … we should also be able to take a picture for analysis from webcam"). The ONE door to them
// (chat-lint rule 16: `getUserMedia` and `MediaRecorder` appear in this file only).
//
// What they capture stays on this computer: a recording goes into the Sound box's own intake (takeSound: its size
// and length caps, the local file store) and a picture into the Image box's (readImage: its type, size and edge
// rules). A device is asked for only when a person presses the button, and let go as soon as the take ends — the
// camera light goes off, the microphone is released. Main grants the two only to the app's own page.
// Converse (2026-10-12) holds the microphone for a whole conversation through `openListening`, here too: still one
// door, still opened only by a person's press, and let go at the conversation's end.

/** @returns {any} */
const devices = () => (typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
  ? navigator.mediaDevices : null);

/** Stop every track of a stream (the device is let go). @param {any} stream */
function release(stream) {
  try { for (const tr of stream.getTracks()) tr.stop(); } catch { /* already stopped */ }
}

/** A name for a take: its kind and the time, no characters a file system refuses. @param {string} what @param {string} ext */
export function takeName(what, ext, now = new Date()) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${what} ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}.${ext}`;
}

/**
 * Record from the microphone until `stop()`, `cancel()` or `maxSec`. Throws (a sentence-ready Error with `.code`)
 * when there is no microphone, or permission is refused.
 * @param {{maxSec: number, onEnd?: () => void}} o `onEnd` fires when maxSec ended the take by itself
 * @returns {Promise<{stop(): Promise<File|null>, cancel(): void, startedAt: number}>}
 */
export async function startRecording(o) {
  const md = devices();
  const Rec = /** @type {any} */ (globalThis).MediaRecorder;
  if (!md || typeof Rec !== 'function') throw Object.assign(new Error('no microphone here'), { code: 'no-device' });
  /** @type {any} */ let stream;
  try { stream = await md.getUserMedia({ audio: true }); } catch (e) {
    throw Object.assign(new Error(String((e && /** @type {any} */ (e).message) || e)), { code: (e && /** @type {any} */ (e).name) === 'NotAllowedError' ? 'refused' : 'no-device' });
  }
  const mime = typeof Rec.isTypeSupported === 'function' && Rec.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const rec = new Rec(stream, mime ? { mimeType: mime } : undefined);
  /** @type {any[]} */ const chunks = [];
  rec.ondataavailable = (/** @type {any} */ e) => { if (e.data && e.data.size) chunks.push(e.data); };
  let ended = false;
  /** @type {Promise<File|null>|null} */ let stopping = null;
  const stop = () => {
    if (stopping) return stopping;
    stopping = new Promise((resolve) => {
      rec.onstop = () => {
        release(stream);
        resolve(chunks.length ? new File(chunks, takeName('recording', 'webm'), { type: 'audio/webm' }) : null);
      };
      try { rec.stop(); } catch { release(stream); resolve(null); }
    });
    return stopping;
  };
  const cap = setTimeout(() => { if (!ended) { ended = true; void stop(); if (o.onEnd) o.onEnd(); } }, Math.max(1, o.maxSec) * 1000);
  rec.start(1000);
  return {
    startedAt: Date.now(),
    stop: () => { ended = true; clearTimeout(cap); return stop(); },
    cancel: () => { ended = true; clearTimeout(cap); rec.onstop = null; try { rec.stop(); } catch { /* not recording */ } release(stream); },
  };
}

/**
 * Converse (docs/COMPUTER_VOICE_PLAN.md K-V3): the microphone held open for a conversation, until
 * `close()`. A person's ● Start on a Converse box is the only caller; the box closes it at ■ End,
 * Stop, an error, a limit, and when the Computer or the window is no longer shown.
 *
 * `level()` is the RMS of the newest block, read from an AnalyserNode on the window's ONE
 * AudioContext, connected to nothing else (no feedback, nothing heard twice). Takes are
 * MediaRecorder recordings of the same stream: `startTake()` begins a new one (dropping the one
 * running) and returns its start on the `performance.now()` clock — the same clock the level is
 * read on, so a turn can be cut out of the take (graph/voice.mjs takeWindow); `takeStart()` is
 * corrected to the recorder's own `onstart`. `endTake()` hands the running take over and stops it,
 * so the next `startTake()` can begin at once (two recorders on one stream: no gap between turns).
 * A take lives only in memory, for one turn: the box decodes and trims it, sends it to the farm to
 * be written down, and drops it. `close()` stops every take and every track and lets the device go.
 * @param {{echoCancellation?: boolean, audioContext?: () => any}} [o]
 * @returns {Promise<{level(): number, startTake(): number, takeStart(): number, endTake(): Promise<File|null>,
 *   dropTake(): void, close(): void, closed(): boolean}>}
 */
export async function openListening(o = {}) {
  const md = devices();
  const Rec = /** @type {any} */ (globalThis).MediaRecorder;
  if (!md || typeof Rec !== 'function') throw Object.assign(new Error('no microphone here'), { code: 'no-device' });
  /** @type {any} */ let stream;
  try {
    stream = await md.getUserMedia({ audio: { echoCancellation: o.echoCancellation !== false, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    throw Object.assign(new Error(String((e && /** @type {any} */ (e).message) || e)), { code: (e && /** @type {any} */ (e).name) === 'NotAllowedError' ? 'refused' : 'no-device' });
  }
  const ac = typeof o.audioContext === 'function' ? o.audioContext() : null;
  /** @type {any} */ let source = null;
  /** @type {any} */ let meter = null;
  /** @type {Float32Array|null} */ let block = null;
  try {
    if (ac && typeof ac.createMediaStreamSource === 'function') {
      source = ac.createMediaStreamSource(stream);
      meter = ac.createAnalyser();
      meter.fftSize = 2048;
      source.connect(meter);
      block = new Float32Array(meter.fftSize);
      if (ac.state === 'suspended' && typeof ac.resume === 'function') { const r = ac.resume(); if (r && r.catch) r.catch(() => {}); }
    }
  } catch { source = null; meter = null; block = null; }
  // Without a meter nothing can hear the turns: the device is let go at once rather than held open deaf.
  if (!meter) {
    release(stream);
    throw Object.assign(new Error('this window cannot measure the microphone'), { code: 'no-device' });
  }
  const mime = typeof Rec.isTypeSupported === 'function' && Rec.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let shut = false;
  /** @type {{rec: any, chunks: any[], at: number}|null} */ let current = null;

  /** Stop one take, keeping what it recorded. @param {{rec: any, chunks: any[]}} take @returns {Promise<File|null>} */
  const stopTake = (take) => new Promise((resolve) => {
    take.rec.onstop = () => resolve(take.chunks.length ? new File(take.chunks, takeName('turn', 'webm'), { type: 'audio/webm' }) : null);
    try { take.rec.stop(); } catch { resolve(null); }
  });
  /** Stop one take, keeping nothing. @param {{rec: any, chunks: any[]}} take */
  const dropIt = (take) => {
    take.rec.ondataavailable = null;
    take.rec.onstop = null;
    try { take.rec.stop(); } catch { /* not recording */ }
    take.chunks.length = 0;
  };

  const handle = {
    level() {
      if (shut || !meter || !block) return 0;
      meter.getFloatTimeDomainData(block);
      let sum = 0;
      for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
      return Math.sqrt(sum / block.length);
    },
    startTake() {
      if (shut) return now();
      if (current) dropIt(current);
      const rec = new Rec(stream, mime ? { mimeType: mime } : undefined);
      const take = { rec, chunks: /** @type {any[]} */ ([]), at: now() };
      rec.ondataavailable = (/** @type {any} */ e) => { if (e.data && e.data.size) take.chunks.push(e.data); };
      rec.onstart = () => { take.at = now(); };
      current = take;
      rec.start();
      return take.at;
    },
    takeStart: () => (current ? current.at : now()),
    endTake() {
      const take = current;
      current = null;
      return take ? stopTake(take) : Promise.resolve(null);
    },
    dropTake() {
      if (current) dropIt(current);
      current = null;
    },
    close() {
      if (shut) return;
      shut = true;
      if (current) dropIt(current);
      current = null;
      try { if (source) source.disconnect(); } catch { /* gone */ }
      try { if (meter) meter.disconnect(); } catch { /* gone */ }
      release(stream);
    },
    closed: () => shut,
  };
  return handle;
}

/**
 * Show the camera in `video` until `snap()` or `close()`. Throws like startRecording.
 * @param {any} video an HTMLVideoElement (fed by srcObject — no URL, so no CSP media-src question)
 * @returns {Promise<{snap(): Promise<File|null>, close(): void}>}
 */
export async function openCamera(video) {
  const md = devices();
  if (!md) throw Object.assign(new Error('no camera here'), { code: 'no-device' });
  /** @type {any} */ let stream;
  try { stream = await md.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); } catch (e) {
    throw Object.assign(new Error(String((e && /** @type {any} */ (e).message) || e)), { code: (e && /** @type {any} */ (e).name) === 'NotAllowedError' ? 'refused' : 'no-device' });
  }
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try { await video.play(); } catch { /* it shows once the stream starts */ }
  const close = () => { release(stream); video.srcObject = null; };
  return {
    close,
    async snap() {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      if (!w || !h) return null;
      const canvas = video.ownerDocument.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      close();
      return blob ? new File([/** @type {any} */ (blob)], takeName('camera', 'jpg'), { type: 'image/jpeg' }) : null;
    },
  };
}
