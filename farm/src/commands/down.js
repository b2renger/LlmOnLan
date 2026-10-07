// `lol down` — stop a running farm (proxy + any Ollama we spawned + beacon), and the
// vLLM it runs.
//
// Reads .lol-runtime.json (written by `lol up`) and tree-kills the recorded pids.
// Killing the proxy also makes a foreground `lol up` notice and exit. vLLM is not one
// of those pids: it outlives a crashed farm on purpose (the next `lol up` adopts it,
// docs/VLLM_MANAGED_PLAN.md D4), so it is stopped here through its own stop.sh — from
// the runtime file, or, when that file is gone, from the config.

const log = require('../log');
const { readRuntime, clearRuntime, isAlive, killTree } = require('../proc');
const vllm = require('../vllm');
const { engineOf } = require('../litellm');
const { loadConfig } = require('../config');

// Where the farm's vLLM lives: what the runtime file recorded, else the config's choice when it is vLLM.
async function vllmTarget(rt) {
    if (rt && rt.vllm && rt.vllm.root) return rt.vllm;
    if (!vllm.supported().ok) return null;
    let config;
    try { ({ config } = loadConfig()); } catch { return null; }
    if (engineOf(config) !== 'vllm') return null;
    if (config.vllm.root) return { platform: process.platform, distro: config.vllm.distro, root: config.vllm.root, port: config.vllm.port };
    // No root saved yet: the one the farm would use (an install in the candidate roots).
    return vllm.targetOf(config, await vllm.probe(config));
}

async function run() {
    const rt = readRuntime();
    let killed = 0;
    if (!rt) {
        log.warn('No running farm recorded (.lol-runtime.json not found).');
    } else {
        // Clear the runtime file FIRST: a foreground `lol up` watches for its
        // disappearance to tell an intentional stop from a real crash (so it exits
        // quietly instead of logging "exited unexpectedly").
        clearRuntime();

        if (rt.litellmPid && isAlive(rt.litellmPid)) {
            log.step(`Stopping LiteLLM (pid ${rt.litellmPid}) …`);
            await killTree(rt.litellmPid);
            killed++;
        }
        if (rt.searxngPid && isAlive(rt.searxngPid)) {
            log.step(`Stopping SearXNG (pid ${rt.searxngPid}) …`);
            await killTree(rt.searxngPid);
            killed++;
        }
        if (rt.kokoroPid && isAlive(rt.kokoroPid)) {
            log.step(`Stopping Kokoro TTS (pid ${rt.kokoroPid}) …`);
            await killTree(rt.kokoroPid);
            killed++;
        }
        if (rt.extractPid && isAlive(rt.extractPid)) {
            log.step(`Stopping OCR service (pid ${rt.extractPid}) …`);
            await killTree(rt.extractPid);
            killed++;
        }
        for (const [pid, label] of [[rt.classifyPid, 'Classify'], [rt.sttPid, 'speech to text'], [rt.busPid, 'the message bus']]) {
            if (pid && isAlive(pid)) {
                log.step(`Stopping ${label} (pid ${pid}) …`);
                await killTree(pid);
            }
        }
        if (rt.llamacppPid && isAlive(rt.llamacppPid)) {
            log.step(`Stopping llama.cpp backend (pid ${rt.llamacppPid}) …`);
            await killTree(rt.llamacppPid);
            killed++;
        }
        for (const pid of rt.ollamaPids || []) {
            if (isAlive(pid)) {
                log.step(`Stopping Ollama we started (pid ${pid}) …`);
                await killTree(pid);
                killed++;
            }
        }
    }

    const t = await vllmTarget(rt).catch(() => null);
    if (t) {
        const s = await vllm.status(t);
        if (s.st && (s.st.running || s.st.installing)) {
            if (s.st.running) {
                log.step('Stopping vLLM (this frees its GPU memory) …');
                const r = await vllm.stop({ ...t, root: s.st.root }, { alive: () => vllm.answers(`http://127.0.0.1:${t.port}/v1`, 2000) });
                if (r.ok) { log.ok('vLLM stopped.'); killed++; } else log.err(r.error);
            }
            if (s.st.installing) {
                log.step('Stopping the vLLM download (it continues where it left off next time) …');
                await vllm.stopInstall({ ...t, root: s.st.root });
            }
        }
    }
    if (killed) log.ok('Farm stopped.');
    else if (rt) log.info('Recorded processes were already gone; cleared runtime state.');
    return 0;
}

module.exports = { run };
