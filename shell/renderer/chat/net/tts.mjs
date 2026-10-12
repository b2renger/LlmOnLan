// @ts-check
// The farm's voice (Kokoro, OpenAI's speech contract) — the ONE network door for it from the
// Computer (ecosystem plan v2 §3.3; chat-lint rule 11 allow-lists this file by name).
//
// POST {tts.url}/audio/speech  {model, voice, input, response_format: "mp3"}  → the encoded sound.
// `tts = {url, voice, model}` comes from the beacon snapshot (ttsUrl/ttsVoice/ttsModel), the same
// endpoint Open WebUI reads aloud with. The text goes to the trusted-LAN farm to be SPOKEN only; the
// sound comes back and plays here. Kokoro takes any bearer; we send the one Open WebUI sends.

export const TTS_TIMEOUT_MS = 2 * 60 * 1000;
/** What Kokoro reads in one call: longer text is refused before it is sent. */
export const TTS_MAX_CHARS = 4000;

/**
 * `speed` (Kokoro's 0.25–4; Converse sends 0.5–2) is sent only when it is not 1, so every request
 * the Speak box made before stays byte for byte the same.
 * @param {{url: string, voice?: string|null, model?: string|null, text: string, speed?: number, signal?: AbortSignal}} o
 * @returns {Promise<{bytes: ArrayBuffer}|{error: string, code: 'no-tts'|'too-long'|'farm'|'aborted'|'timeout'|'network', status?: number}>}
 */
export async function speakOnFarm(o) {
  if (!o || !o.url) return { error: 'no voice on this farm', code: 'no-tts' };
  if (String(o.text || '').length > TTS_MAX_CHARS) return { error: 'too long', code: 'too-long' };
  const ac = new AbortController();
  const outer = o.signal || null;
  const onAbort = () => { try { ac.abort(); } catch { /* already */ } };
  if (outer) { if (outer.aborted) return { error: 'aborted', code: 'aborted' }; outer.addEventListener('abort', onAbort, { once: true }); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; onAbort(); }, TTS_TIMEOUT_MS);
  try {
    const res = await fetch(`${String(o.url).replace(/\/+$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-lol-tts' },
      body: JSON.stringify({
        model: o.model || 'kokoro', voice: o.voice || 'af_heart', input: String(o.text || ''), response_format: 'mp3',
        ...(typeof o.speed === 'number' && Number.isFinite(o.speed) && o.speed !== 1 ? { speed: Math.min(4, Math.max(0.25, o.speed)) } : {}),
      }),
      signal: ac.signal,
    });
    if (!res.ok) return { error: `farm answered ${res.status}`, code: 'farm', status: res.status };
    return { bytes: await res.arrayBuffer() };
  } catch (e) {
    if (outer && outer.aborted) return { error: 'aborted', code: 'aborted' };
    if (timedOut) return { error: 'timeout', code: 'timeout' };
    return { error: String(/** @type {any} */ (e) && /** @type {any} */ (e).message || e), code: 'network' };
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onAbort);
  }
}

/**
 * The farm voice's voices (Converse's voice list, plan K-V6): GET {tts.url}/audio/voices. Kokoro-FastAPI
 * answers `{voices: [{id, name}]}` (v0.3+) or `{voices: [string]}`; anything else, or no answer within
 * 5 s, is an empty list — the box then keeps a plain text field. Nothing is sent but the request itself.
 * @param {{url: string, signal?: AbortSignal}} o @returns {Promise<string[]>}
 */
export async function listVoices(o) {
  if (!o || !o.url) return [];
  const ac = new AbortController();
  const timer = setTimeout(() => { try { ac.abort(); } catch { /* already */ } }, 5000);
  const onAbort = () => { try { ac.abort(); } catch { /* already */ } };
  if (o.signal) o.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(`${String(o.url).replace(/\/+$/, '')}/audio/voices`, { headers: { Authorization: 'Bearer sk-lol-tts' }, signal: ac.signal });
    if (!res.ok) return [];
    const body = await res.json();
    const list = body && Array.isArray(body.voices) ? body.voices : [];
    return list.map((/** @type {any} */ v) => String(v && typeof v === 'object' ? v.id || '' : v || ''))
      .filter((/** @type {string} */ id) => /^[\w+.-]{1,64}$/.test(id)).slice(0, 200);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    if (o.signal) o.signal.removeEventListener('abort', onAbort);
  }
}
