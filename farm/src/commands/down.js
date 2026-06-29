// `lol down` — stop a running farm (proxy + any Ollama we spawned + beacon).
//
// Reads .lol-runtime.json (written by `lol up`) and tree-kills the recorded pids.
// Killing the proxy also makes a foreground `lol up` notice and exit.

const log = require('../log');
const { readRuntime, clearRuntime, isAlive, killTree } = require('../proc');

async function run() {
    const rt = readRuntime();
    if (!rt) {
        log.warn('No running farm recorded (.lol-runtime.json not found).');
        return 0;
    }

    // Clear the runtime file FIRST: a foreground `lol up` watches for its
    // disappearance to tell an intentional stop from a real crash (so it exits
    // quietly instead of logging "exited unexpectedly").
    clearRuntime();

    let killed = 0;
    if (rt.litellmPid && isAlive(rt.litellmPid)) {
        log.step(`Stopping LiteLLM (pid ${rt.litellmPid}) …`);
        await killTree(rt.litellmPid);
        killed++;
    }
    for (const pid of rt.ollamaPids || []) {
        if (isAlive(pid)) {
            log.step(`Stopping Ollama we started (pid ${pid}) …`);
            await killTree(pid);
            killed++;
        }
    }
    if (killed) log.ok('Farm stopped.');
    else log.info('Recorded processes were already gone; cleared runtime state.');
    return 0;
}

module.exports = { run };
