// Persisting admin-panel changes back into lol.config.json.
//
// Everything the panel could change used to be EPHEMERAL on purpose: serve a model
// for this session, bounce the proxy, done — restart and the file wins again. That
// is still right for "start/stop this model for the next hour", but it is wrong for
// the settings an operator sets ONCE and expects to survive a reboot: which backend
// runs, which .gguf it serves, the name users read in the picker, how many people it
// serves at a time. Those now round-trip through here.
//
// Two rules keep this safe:
//   • We patch the RAW file, never re-serialize the parsed config. The parsed object
//     is the schema's *output* — every default is materialized in it, so writing it
//     back would freeze today's defaults into the operator's file and silently opt
//     them out of future ones. Patching raw JSON touches only the keys we set.
//   • We write via a temp file + rename, so a crash mid-write cannot leave a farm
//     with a truncated config it will refuse to boot from.

const fs = require('fs');
const path = require('path');

// Read the on-disk config as raw JSON (NOT schema-parsed). Returns null if it is
// missing or unreadable — callers treat that as "cannot persist", never as {}.
function readRawConfig(configPath) {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch { return null; }
}

// Apply `mutate(raw)` to the on-disk config and write it back. `mutate` may return a
// replacement object or mutate in place. Best-effort by design: a farm whose config
// lives on a read-only volume still works for the session, it just cannot remember —
// so callers apply the change in memory FIRST and treat a false here as a warning.
function patchConfigFile(configPath, mutate) {
    if (!configPath) return { ok: false, error: 'no config path' };
    const raw = readRawConfig(configPath);
    if (!raw) return { ok: false, error: 'config file missing or unreadable' };
    let next;
    try { next = mutate(raw) || raw; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    const tmp = path.join(path.dirname(configPath), `.lol.config.${process.pid}.tmp`);
    try {
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
        fs.renameSync(tmp, configPath);
        return { ok: true };
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
        return { ok: false, error: String((e && e.message) || e) };
    }
}

// Merge a patch into one top-level section (`llamacpp`, `ollama`, …) without
// disturbing its other keys. Deleting is explicit: a value of `undefined` removes
// the key, which is how "back to the farm default" is expressed — writing null
// would pin null, and for a field like `llamacpp.alias` null is not the default.
function patchSection(configPath, section, patch) {
    return patchConfigFile(configPath, (raw) => {
        const cur = { ...(raw[section] || {}) };
        for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete cur[k]; else cur[k] = v;
        }
        raw[section] = cur;
        return raw;
    });
}

module.exports = { readRawConfig, patchConfigFile, patchSection };
