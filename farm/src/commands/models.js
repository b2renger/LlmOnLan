// `lol models ls|add|rm|pull` — manage the served model catalog.
//
//   ls              list configured models + presence on each Ollama host
//   add <id>        add a model id to the config (then `lol up` to serve it)
//   rm  <id>        remove a model id from the config
//   pull            pull every configured model on every host (wraps /api/pull)

const log = require('../log');
const ollama = require('../ollama');
const { loadConfig, writeConfig } = require('../config');

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

function add(id) {
    if (!id) { log.err('Usage: lol models add <id>   e.g. lol models add gemma4:12b'); return 1; }
    const { config, path: p } = loadConfig();
    if (config.models.some((m) => m.id === id)) { log.warn(`${id} is already in the catalog.`); return 0; }
    config.models.push({ id });
    writeConfig(p, config);
    log.ok(`Added ${log.paint.bold(id)}. Run ${log.paint.cyan('lol up')} (or ${log.paint.cyan('lol models pull')}) to serve it.`);
    return 0;
}

function remove(id) {
    if (!id) { log.err('Usage: lol models rm <id>'); return 1; }
    const { config, path: p } = loadConfig();
    const before = config.models.length;
    config.models = config.models.filter((m) => m.id !== id);
    if (config.models.length === before) { log.warn(`${id} is not in the catalog.`); return 0; }
    if (config.models.length === 0) { log.err('Refusing to remove the last model — a farm must serve at least one.'); return 1; }
    writeConfig(p, config);
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
            if (ollama.hasModel(present, m.id)) { log.ok(`${label}: ${m.id} already present.`); continue; }
            log.step(`${label}: pulling ${log.paint.bold(m.id)} …`);
            try {
                let last = '';
                await ollama.pullModel(host, m.id, (s) => {
                    if (s !== last) { last = s; process.stdout.write(`\r${log.paint.grey(`[${label}]`)} ${s}            `); }
                });
                process.stdout.write('\n');
                log.ok(`${label}: ${m.id} pulled.`);
            } catch (e) {
                process.stdout.write('\n');
                log.err(`${label}: pull ${m.id} failed — ${e.message}`);
                failures++;
            }
        }
    }));

    return failures ? 1 : 0;
}

module.exports = { run };
