// `lol init` — scaffold a lol.config.json in the current directory.

const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('../log');
const { CONFIG_FILENAME, defaultConfig, writeConfig } = require('../config');

function run(args) {
    const force = args.includes('--force') || args.includes('-f');
    const target = path.join(process.cwd(), CONFIG_FILENAME);

    // Only consider the target dir — NOT the loadConfig() cwd→farm fallback, or
    // `lol init` in a fresh dir would wrongly see the repo's farm/lol.config.json.
    if (fs.existsSync(target) && !force) {
        log.err(`${CONFIG_FILENAME} already exists. Re-run with --force to overwrite.`);
        return 1;
    }

    const config = defaultConfig();
    config.name = `${os.hostname()} Farm`;

    writeConfig(target, config);
    log.ok(`Wrote ${log.paint.bold(target)}`);
    log.plain('');
    log.plain('  Next:');
    log.plain(`    1. Edit ${CONFIG_FILENAME} — set ${log.paint.bold('ollama.hosts')} if you have more than this box.`);
    log.plain(`    2. Make sure Ollama is running on each host and LiteLLM is installed.`);
    log.plain(`    3. ${log.paint.cyan('lol up')}  — pull models, generate+run the proxy, start the beacon.`);
    log.plain('');
    log.plain(`  ${log.paint.grey('Context sizes itself per box ("auto"). The default preinstall stages a ~8.6 GB')}`);
    log.plain(`  ${log.paint.grey('Qwen3.8-27B: set "preinstall": [] before `lol install` to skip it.')}`);
    log.plain('');
    return 0;
}

module.exports = { run };
