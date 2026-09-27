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
 * @param {{url: string, voice?: string|null, model?: string|null, text: string, signal?: AbortSignal}} o
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
      body: JSON.stringify({ model: o.model || 'kokoro', voice: o.voice || 'af_heart', input: String(o.text || ''), response_format: 'mp3' }),
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
