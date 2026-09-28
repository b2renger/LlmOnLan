// @ts-check
// This computer's MICROPHONE and CAMERA, for the Sound and Image boxes (owner, 2026-09-28: "it should take input
// from the mic … we should also be able to take a picture for analysis from webcam"). The ONE door to them
// (chat-lint rule 16: `getUserMedia` and `MediaRecorder` appear in this file only).
//
// What they capture stays on this computer: a recording goes into the Sound box's own intake (takeSound: its size
// and length caps, the local file store) and a picture into the Image box's (readImage: its type, size and edge
// rules). A device is asked for only when a person presses the button, and let go as soon as the take ends — the
// camera light goes off, the microphone is released. Main grants the two only to the app's own page.

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
