// `lol models ls|add|rm|pull` — manage the served model catalog.
//
//   ls              list configured models + presence on each Ollama host
//   add <id>        add a model id to the config (then `lol up --no-pick` to serve it)
//   rm  <id>        remove a model id from the config
//   pull            pull every configured model on every host (wraps /api/pull)

const log = require('../log');
const ollama = require('../ollama');
const { loadConfig } = require('../config');
const { patchConfigFile } = require('../configFile');

async function run(args) {
    const sub = args[0];
    switch (sub) {
        case undefined:
        case 'ls':
        case 'list':
            return await list();
        case 'add':
            return add(args[1]);
        case 'rm':
        case 'remove':
            return remove(args[1]);
        case 'pull':
            return await pull();
        default:
            log.err(`Unknown: lol models ${sub}. Try: ls | add <id> | rm <id> | pull`);
            return 1;
    }
}

async function list() {
    const { config } = loadConfig();
    log.info(`Configured models (${config.models.length}):`);
    // Gather presence per host in parallel.
    const hosts = config.ollama.hosts.map(ollama.normalizeHost);
    const present = await Promise.all(hosts.map((h) => ollama.listModels(h)));
    for (const m of config.models) {
        const tags = present.map((list, i) =>
            ollama.hasModel(list, m.id) ? log.paint.green(hostLabel(hosts[i])) : log.paint.grey(`${hostLabel(hosts[i])}✗`)
        );
        const def = m.default ? log.paint.cyan(' (default)') : '';
        log.plain(`  • ${log.paint.bold(m.id)}${def}   ${tags.join('  ')}`);
    }
    log.plain('');
    log.plain(`  ${log.paint.green('host')} = present · ${log.paint.grey('host✗')} = missing (run ${log.paint.cyan('lol models pull')})`);
    return 0;
}

function hostLabel(h) {
    try { return new URL(h).host; } catch { return h; }
}

// add/rm patch ONLY `models` in the raw file (configFile.js): writing the
// schema-parsed config back froze every default into the operator's file and
// silently opted them out of future ones. `configPath` is for tests.
function add(id, configPath) {
    if (!id) { log.err('Usage: lol models add <id>   e.g. lol models add gemma4:12b'); return 1; }
    const { config, path: p } = loadConfig(configPath);
    if (config.models.some((m) => m.id === id)) { log.warn(`${id} is already in the catalog.`); return 0; }
    // config.models is the file's list when it has one, else the default catalog —
    // either way the file must end up with the whole list, not just the new id.
    const next = config.models.concat([{ id }]);
    const r = patchConfigFile(p, (raw) => { raw.models = next; return raw; });
    if (!r.ok) { log.err(`Could not save ${p}: ${r.error}`); return 1; }
    log.ok(`Added ${log.paint.bold(id)}. Run ${log.paint.cyan('lol up --no-pick')} to serve it \n     ${log.paint.grey('(plain `lol up` prompts, and Enter serves only the default — dropping this one).')}`);
    return 0;
}

function remove(id, configPath) {
    if (!id) { log.err('Usage: lol models rm <id>'); return 1; }
    const { config, path: p } = loadConfig(configPath);
    const next = config.models.filter((m) => m.id !== id);
    if (next.length === config.models.length) { log.warn(`${id} is not in the catalog.`); return 0; }
    if (next.length === 0) { log.err('Refusing to remove the last model — a farm must serve at least one.'); return 1; }
    const r = patchConfigFile(p, (raw) => { raw.models = next; return raw; });
    if (!r.ok) { log.err(`Could not save ${p}: ${r.error}`); return 1; }
    log.ok(`Removed ${log.paint.bold(id)}.`);
    return 0;
}

// Pull every configured model on every host. Sequential per host (Ollama pulls
// one at a time anyway) but hosts run in parallel.
async function pull() {
    const { config } = loadConfig();
    const hosts = config.ollama.hosts.map(ollama.normalizeHost);
    let failures = 0;

    await Promise.all(hosts.map(async (host) => {
        const label = hostLabel(host);
        const up = await ollama.version(host);
        if (!up) { log.err(`${label} unreachable — skipping.`); failures++; return; }
        const present = await ollama.listModels(host);
        for (const m of config.models) {
            // A derived model is pulled by its UPSTREAM tag: `m.id` is the local name
            // `lol up` creates from it and exists on no registry (a pull 404s).
            const upstream = m.source || m.id;
            if (ollama.hasModel(present, upstream)) { log.ok(`${label}: ${upstream} already present.`); continue; }
            log.step(`${label}: pulling ${log.paint.bold(upstream)} …`);
            try {
                let last = ''; let lastAt = 0;
                await ollama.pullModel(host, upstream, (o) => {
                    // pullModel emits the PARSED object now, so format it here — and
                    // throttle: with byte counts the text changes on every chunk.
                    const s = ollama.pullProgressText(o);
                    const now = Date.now();
                    if (s !== last && now - lastAt >= 400) {
                        last = s; lastAt = now;
                        process.stdout.write(`\r${log.paint.grey(`[${label}]`)} ${s}            `);
                    }
                });
                process.stdout.write('\n');
                log.ok(`${label}: ${upstream} pulled${m.source ? ` (lol up derives ${m.id} from it)` : ''}.`);
            } catch (e) {
                process.stdout.write('\n');
                log.err(`${label}: pull ${upstream} failed — ${e.message}`);
                failures++;
            }
        }
    }));

    return failures ? 1 : 0;
}

module.exports = { run, add, remove };
