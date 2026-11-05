// `lol init` — scaffold a lol.config.json in the current directory.

const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('../log');
const { CONFIG_FILENAME, writeConfig } = require('../config');

function run(args) {
    const force = args.includes('--force') || args.includes('-f');
    const target = path.join(process.cwd(), CONFIG_FILENAME);

    // Only consider the target dir — NOT the loadConfig() cwd→farm fallback, or
    // `lol init` in a fresh dir would wrongly see the repo's farm/lol.config.json.
    if (fs.existsSync(target) && !force) {
        log.err(`${CONFIG_FILENAME} already exists. Re-run with --force to overwrite.`);
        return 1;
    }

    writeConfig(target, scaffold());
    log.ok(`Wrote ${log.paint.bold(target)}`);
    log.plain('');
    log.plain('  Next:');
    log.plain(`    1. Edit ${CONFIG_FILENAME} — add ${log.paint.bold('"ollama": { "hosts": [...] }')} if you have more than this box.`);
    log.plain(`       Every other key has a default (farm/README.md, Config): write only what you change.`);
    log.plain(`    2. Make sure Ollama is running on each host and LiteLLM is installed.`);
    log.plain(`    3. ${log.paint.cyan('lol up')}  — pull models, generate+run the proxy, start the beacon.`);
    log.plain('');
    log.plain(`  ${log.paint.grey('Context sizes itself per box ("auto"). The default preinstall stages a ~8.6 GB')}`);
    log.plain(`  ${log.paint.grey('Qwen3.8-27B: set "preinstall": [] before `lol install` to skip it.')}`);
    log.plain('');
    return 0;
}

// The file a scaffold writes: only what differs from the defaults (the name), as the Farm app writes its own. The full
// parsed default would freeze today's defaults into the file (configFile.js says why): a CLI farm scaffolded while
// vllm.version defaulted to 0.30.0 kept it, was never offered Update vLLM to 0.33.0, and could not use Flint
// (review 2026-11-05). `lol install` writes the same.
function scaffold() {
    return { name: `${os.hostname()} Farm` };
}

module.exports = { run, scaffold };
