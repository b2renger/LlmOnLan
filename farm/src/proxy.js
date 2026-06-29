// Probe the running LiteLLM proxy via its HTTP surface.
//   GET /health/liveliness   fast, no auth — "is the server up?"
//   GET /v1/models           OpenAI-format catalog (what clients see)
// Uses global fetch (Node 18+). Refs: docs.litellm.ai (proxy health, /v1/models).

// Quick liveness check — resolves true once the proxy answers, else false.
async function proxyLive(baseUrl, timeoutMs = 2000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(`${baseUrl}/health/liveliness`, { signal: ctrl.signal });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(t);
    }
}

// Poll liveness until the proxy is up or we time out. Resolves true/false.
async function waitForProxy(baseUrl, { timeoutMs = 60000, intervalMs = 750 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await proxyLive(baseUrl, Math.min(intervalMs, 2000))) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

// List model ids the proxy serves (OpenAI /v1/models). Returns [] on failure.
async function listProxyModels(baseUrl, key = null, timeoutMs = 4000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const headers = key ? { authorization: `Bearer ${key}` } : {};
        const res = await fetch(`${baseUrl}/v1/models`, { headers, signal: ctrl.signal });
        if (!res.ok) return [];
        const json = await res.json();
        return Array.isArray(json.data) ? json.data.map((m) => m.id).filter(Boolean) : [];
    } catch {
        return [];
    } finally {
        clearTimeout(t);
    }
}

module.exports = { proxyLive, waitForProxy, listProxyModels };
