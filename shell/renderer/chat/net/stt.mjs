// @ts-check
// The farm's speech-to-text service — the ONE network door for it (ecosystem plan v2 §3.3; chat-lint
// rule 11 allow-lists this file by name, like net/extract.mjs and net/classify.mjs).
//
// The contract is OpenAI's, as the farm serves it (farm/src/pysvc/stt_server.py):
//   POST {stt.url}/v1/audio/transcriptions
//     Authorization  Bearer {stt.key}
//     body           multipart/form-data: file (the recording), language (optional)
//   → 200 {"text", "language", "duration", "ms"}
//     401 wrong key · 400 unreadable · 413 too big · 429 busy (Retry-After) · 503 loading
// The URL and key come from the beacon snapshot's `stt`, published to the renderer as
// `app.farm.get().stt = {url, key}`. The recording goes to the trusted-LAN farm to be WRITTEN DOWN
// only: the farm reads it into memory, transcribes it and drops it — it never logs or keeps it.
//
// Error codes (the Sound box has a sentence per code):
//   no-stt · unauthorized · busy · too-big · warming · unreadable · farm · aborted · timeout · network

/** A 10-minute recording takes ~3 minutes on a CPU farm with the "small" model. */
export const STT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Transcribe one recording.
 * @param {{url: string, key: string|null, bytes: ArrayBuffer|Uint8Array, name: string, mime: string,
 *   language?: string|null, signal?: AbortSignal, timeoutMs?: number}} o
 * @returns {Promise<{text: string, language: string, duration: number, ms: number}
 *   | {error: string, code: 'no-stt'|'unauthorized'|'busy'|'too-big'|'warming'|'unreadable'|'farm'|'aborted'|'timeout'|'network', status?: number}>}
 */
export async function transcribe(o) {
  if (!o || !o.url) return { error: 'no speech-to-text service', code: 'no-stt' };
  const ac = new AbortController();
  const outer = o.signal || null;
  const onAbort = () => { try { ac.abort(); } catch { /* already */ } };
  if (outer) { if (outer.aborted) return { error: 'aborted', code: 'aborted' }; outer.addEventListener('abort', onAbort, { once: true }); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; onAbort(); }, Number(o.timeoutMs) || STT_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append('file', new Blob([o.bytes], { type: o.mime || 'application/octet-stream' }), o.name || 'recording');
    if (o.language) form.append('language', String(o.language));
    /** @type {Record<string, string>} */ const headers = {};
    if (o.key) headers.Authorization = `Bearer ${o.key}`;
    const res = await fetch(`${String(o.url).replace(/\/+$/, '')}/v1/audio/transcriptions`, {
      method: 'POST', headers, body: form, signal: ac.signal,
    });
    if (res.status === 401) return { error: 'unauthorized', code: 'unauthorized', status: 401 };
    if (res.status === 429) return { error: 'busy', code: 'busy', status: 429 };
    if (res.status === 413) return { error: 'too big', code: 'too-big', status: 413 };
    if (res.status === 503) return { error: 'loading', code: 'warming', status: 503 };
    if (res.status === 400) return { error: 'unreadable', code: 'unreadable', status: 400 };
    if (!res.ok) return { error: `farm answered ${res.status}`, code: 'farm', status: res.status };
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!body || typeof body.text !== 'string') return { error: 'not the transcription contract', code: 'farm', status: res.status };
    return { text: body.text, language: String(body.language || ''), duration: Number(body.duration) || 0, ms: Number(body.ms) || 0 };
  } catch (e) {
    if (outer && outer.aborted) return { error: 'aborted', code: 'aborted' };
    if (timedOut) return { error: 'timeout', code: 'timeout' };
    return { error: String(/** @type {any} */ (e) && /** @type {any} */ (e).message || e), code: 'network' };
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onAbort);
  }
}
