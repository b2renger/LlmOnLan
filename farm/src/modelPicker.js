// modelPicker — at `lol up`, choose which model(s) to serve from what's actually
// installed on the box's Ollama, instead of always serving the fixed config list.
//
// Selection order (first that applies wins):
//   1. --model <id[,id]> / -m <id>   explicit; no prompt (may pull if not present).
//   2. --no-pick / --yes / -y, or no TTY (scripts / CI) → config.models unchanged.
//   3. Interactive: list installed Ollama models (with sizes) and prompt.
//
// Returns the model catalog to serve as [{ id, default }]. Purely in-memory — the
// choice drives THIS run (beacon, LiteLLM routing, pulls); lol.config.json is left
// alone (change the persistent catalog with `lol models add/rm`).

const readline = require('readline');
const log = require('./log');
const ollama = require('./ollama');

// --model x,y | -m x | --model=x  → ['x','y']
function parseModelFlag(args = []) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--model' || a === '-m') {
            const v = args[i + 1];
            if (v && !v.startsWith('-')) { out.push(...v.split(',')); i++; }
        } else if (a.startsWith('--model=')) {
            out.push(...a.slice('--model='.length).split(','));
        }
    }
    return out.map((s) => s.trim()).filter(Boolean);
}

function wantsNoPick(args = []) {
    return args.includes('--no-pick') || args.includes('--yes') || args.includes('-y');
}

// Union of installed models across the reachable hosts, largest size wins, sorted.
async function installedModels(hosts) {
    const map = new Map(); // name → { size, paramSize }
    for (const h of hosts) {
        for (const m of await ollama.listModelsDetailed(h)) {
            const prev = map.get(m.name);
            if (!prev || m.size > prev.size) map.set(m.name, { size: m.size, paramSize: m.paramSize });
        }
    }
    return [...map.entries()]
        .map(([name, v]) => ({ name, size: v.size, paramSize: v.paramSize }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function prompt(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (ans) => { rl.close(); resolve(ans); });
    });
}

function gb(bytes) { return bytes ? `${(bytes / 1e9).toFixed(1)} GB` : ''; }

// Index of the config's default model within the installed list (tolerant of an
// implicit :latest), or 0.
function defaultIndex(installed, config) {
    const defId = (config.models.find((m) => m.default) || config.models[0] || {}).id;
    if (!defId) return 0;
    const idx = installed.findIndex((m) => m.name === defId || (!defId.includes(':') && m.name === `${defId}:latest`));
    return idx >= 0 ? idx : 0;
}

// Build a catalog entry for a picked model id, carrying over the config's per-id
// settings (alias, explicit vision flag) so a pick doesn't drop them — selectModels
// REPLACES config.models wholesale, so anything not copied here is lost. An explicit
// `id=alias` spec (from --model) wins over the config alias.
function toEntry(config, spec, isDefault) {
    const [id, alias] = String(spec).split('=').map((s) => s.trim());
    const cfg = config.models.find((m) => m.id === id);
    const entry = { id, default: isDefault };
    const a = alias || cfg?.alias;
    if (a) entry.alias = a;
    // Preserve an explicit vision:true/false (needed for models the tag-regex can't
    // infer — else images get silently dropped at the proxy).
    if (typeof cfg?.vision === 'boolean') entry.vision = cfg.vision;
    return entry;
}

// Resolve the models to serve. May prompt. `hosts` = reachable Ollama base URLs.
async function selectModels(config, hosts, args = []) {
    const explicit = parseModelFlag(args);
    if (explicit.length) {
        log.info(`Serving model(s) from --model: ${log.paint.bold(explicit.join(', '))}`);
        return explicit.map((spec, i) => toEntry(config, spec, i === 0));
    }
    if (wantsNoPick(args) || !process.stdin.isTTY) {
        return config.models; // non-interactive → keep the configured catalog
    }

    const installed = await installedModels(hosts);
    if (!installed.length) {
        log.warn('No models installed on Ollama yet — using the config catalog (will pull). Add more with `ollama pull` or `lol models pull`.');
        return config.models;
    }

    const defIdx = defaultIndex(installed, config);
    log.plain('');
    log.plain(log.paint.bold('  Models installed on Ollama:'));
    installed.forEach((m, i) => {
        const size = gb(m.size);
        const meta = [m.paramSize, size].filter(Boolean).join(' · ');
        const marker = i === defIdx ? log.paint.cyan('  ← default') : '';
        log.plain(`   ${String(i + 1).padStart(2)}) ${m.name.padEnd(28)} ${log.paint.grey(meta)}${marker}`);
    });
    const ans = (await prompt(`\n  Model(s) to serve [${defIdx + 1}] — number, or comma-separated: `)).trim();

    if (!ans) return [toEntry(config, installed[defIdx].name, true)];
    const picks = [...new Set(
        ans.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= installed.length)
    )];
    if (!picks.length) {
        log.warn(`No valid choice — serving the default (${installed[defIdx].name}).`);
        return [toEntry(config, installed[defIdx].name, true)];
    }
    const chosen = picks.map((n) => installed[n - 1].name);
    log.ok(`Serving: ${log.paint.bold(chosen.join(', '))}`);
    return chosen.map((id, i) => toEntry(config, id, i === 0));
}

module.exports = { selectModels, installedModels, parseModelFlag, wantsNoPick };
