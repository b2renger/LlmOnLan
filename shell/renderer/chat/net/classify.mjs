// @ts-check
// The farm's Laya service — the ONE network door for it (ecosystem plan v2 §3.2; chat-lint rule 11
// allow-lists this file by name, like net/extract.mjs).
//
// The contract is the farm's own (farm/src/pysvc/classify_server.py):
//   POST {classify.url}/classify
//     Authorization  Bearer {classify.key}
//     body           {"items": [string | object, …], "question": {"instructions": str, "options": [str, …]}}
//   → 200 {"answers": [{"choice", "confidence", "probabilities"}], "ms", "model"}
//     401 wrong key · 400 bad body · 413 too many items · 429 busy (Retry-After) · 503 warming up
// The URL and key come from the beacon snapshot's `classify` (farm/src/snapshot.js), published to
// the renderer as `app.farm.get().classify = {url, key}`. The items go to the trusted-LAN farm for
// ONE forward pass each; the farm stores and logs nothing. It costs no seat and no generation.
//
// The error table (the Classify box has a sentence per code):
//   no-classify   no URL on this farm — nothing was sent
//   unauthorized  401            busy     429 (retryAfter in seconds)
//   too-many      413            warming  503
//   farm          any other non-2xx, or a body that is not the contract
//   aborted       the caller's signal (Stop)      timeout / network

/** One call may classify up to 200 items at ~0.2 s each on a CPU farm. */
export const CLASSIFY_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * PURE: the service's body → one answer per item, in order; null when it is not the contract.
 * @param {any} body @param {number} n
 * @returns {{choice: string|null, confidence: number}[] | null}
 */
export function readAnswers(body, n) {
  const rows = body && Array.isArray(body.answers) ? body.answers : null;
  if (!rows || rows.length !== n) return null;
  return rows.map((r) => ({
    choice: r && typeof r.choice === 'string' ? r.choice : null,
    confidence: r && Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : 0,
  }));
}

/**
 * Classify `items` with ONE choice question.
 * @param {{url: string, key: string|null, items: any[], instructions: string, options: string[],
 *   signal?: AbortSignal, timeoutMs?: number}} o
 * @returns {Promise<{answers: {choice: string|null, confidence: number}[], ms: number, model: string}
 *   | {error: string, code: 'no-classify'|'unauthorized'|'busy'|'too-many'|'warming'|'farm'|'aborted'|'timeout'|'network', retryAfter?: number, status?: number}>}
 */
export async function classifyItems(o) {
  if (!o || !o.url) return { error: 'no classify service', code: 'no-classify' };
  const ac = new AbortController();
  const outer = o.signal || null;
  const onAbort = () => { try { ac.abort(); } catch { /* already */ } };
  if (outer) { if (outer.aborted) return { error: 'aborted', code: 'aborted' }; outer.addEventListener('abort', onAbort, { once: true }); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; onAbort(); }, Number(o.timeoutMs) || CLASSIFY_TIMEOUT_MS);
  try {
    /** @type {Record<string, string>} */ const headers = { 'Content-Type': 'application/json' };
    if (o.key) headers.Authorization = `Bearer ${o.key}`;
    const res = await fetch(`${String(o.url).replace(/\/+$/, '')}/classify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: o.items, question: { instructions: o.instructions, options: o.options } }),
      signal: ac.signal,
    });
    if (res.status === 401) return { error: 'unauthorized', code: 'unauthorized', status: 401 };
    if (res.status === 429) return { error: 'busy', code: 'busy', status: 429, retryAfter: Number(res.headers.get('retry-after')) || 2 };
    if (res.status === 413) return { error: 'too many items', code: 'too-many', status: 413 };
    if (res.status === 503) return { error: 'warming up', code: 'warming', status: 503 };
    if (!res.ok) return { error: `farm answered ${res.status}`, code: 'farm', status: res.status };
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    const answers = readAnswers(body, o.items.length);
    if (!answers) return { error: 'not the classify contract', code: 'farm', status: res.status };
    return { answers, ms: Number(body.ms) || 0, model: String(body.model || 'laya') };
  } catch (e) {
    if (outer && outer.aborted) return { error: 'aborted', code: 'aborted' };
    if (timedOut) return { error: 'timeout', code: 'timeout' };
    return { error: String(/** @type {any} */ (e) && /** @type {any} */ (e).message || e), code: 'network' };
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onAbort);
  }
}
