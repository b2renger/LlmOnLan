// Shared Python interpreter resolution.
//
// Honors $LOL_PYTHON — the desktop Farm app (farm-app/) points this at its bundled,
// relocatable CPython so a stray system `py -3.12` can NEVER win the venv builds
// (deterministic bundled runtime). When $LOL_PYTHON is unset, this walks a per-caller
// platform ladder exactly like the old inline findPython did, so a plain terminal
// `lol install` / `lol up` behaves identically.
//
// Each caller passes its OWN candidate list + accepted-version predicate (kokoro is
// pickier — it dislikes 3.13), so the shared helper doesn't flatten those differences.

const { execSync } = require('child_process');

function shCapture(cmd) {
    try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return null; }
}

// Quote an interpreter PATH for safe shell interpolation (a bundled path may contain
// spaces, e.g. "…\LlmOnLan Farm\…"); leave a bare multi-token command ("py -3.12") as-is.
function quoteInterpreter(cmd) {
    return /[\\/]/.test(cmd) && /\s/.test(cmd) ? `"${cmd}"` : cmd;
}

// Resolve a usable Python. `candidates`: shell commands to try in order.
// `accept(versionString)`: whether that interpreter's `--version` is acceptable.
// Returns { cmd, version } or null. $LOL_PYTHON, when set + acceptable, wins first.
function resolvePython(candidates, accept) {
    const forced = process.env.LOL_PYTHON;
    if (forced) {
        const q = quoteInterpreter(forced);
        const v = shCapture(`${q} --version`);
        if (v && accept(v)) return { cmd: q, version: v };
        // If the forced interpreter didn't answer/qualify, fall through to the ladder.
    }
    for (const c of candidates) {
        const v = shCapture(`${c} --version`);
        if (v && accept(v)) return { cmd: c, version: v };
    }
    return null;
}

module.exports = { resolvePython };
