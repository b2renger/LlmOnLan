#!/usr/bin/env node
// lol — the LlmOnLan farm CLI. One declarative config; the CLI orchestrates
// Ollama + a generated LiteLLM proxy + a LAN discovery beacon.

const log = require('../src/log');
const { PKG_VERSION } = require('../src/snapshot');

const USAGE = `
${log.paint.bold('lol')} — the LlmOnLan farm CLI

  ${log.paint.cyan('lol install')}             One-time bootstrap on a fresh pull: install Ollama
                          + LiteLLM and pull the configured models.
  ${log.paint.cyan('lol init')} [--force]      Scaffold a lol.config.json here.
  ${log.paint.cyan('lol up')} | ${log.paint.cyan('serve')}        Ensure Ollama, pull models, generate+run the
                          LiteLLM proxy, start the discovery beacon (foreground).
                          ${log.paint.grey('--coordinator')}  aggregate LAN peer farms into one
                          balanced endpoint (clients prefer it).
  ${log.paint.cyan('lol down')}                Stop the proxy + beacon.
  ${log.paint.cyan('lol status')}              Health of each Ollama host + the proxy + loaded models.
  ${log.paint.cyan('lol fleet')}               Show every farm on the LAN (this box + peers): load,
                          VRAM, loaded models, roles.
  ${log.paint.cyan('lol models')} ls|add|rm|pull   Manage the served model catalog.

  -h, --help              Show this help.
  -v, --version           Show the version.

Config is ${log.paint.bold('lol.config.json')} (./ or ./farm/). Models are chosen there or via \`lol models add\`.
`;

async function main() {
    const argv = process.argv.slice(2);
    const cmd = argv[0];
    const rest = argv.slice(1);

    if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
        log.plain(USAGE);
        return 0;
    }
    if (cmd === '-v' || cmd === '--version' || cmd === 'version') {
        log.plain(PKG_VERSION);
        return 0;
    }

    try {
        switch (cmd) {
            case 'install':
            case 'setup':
                return await require('../src/commands/install').run(rest);
            case 'init':
                return require('../src/commands/init').run(rest);
            case 'up':
            case 'serve':
                return await require('../src/commands/up').run(rest);
            case 'down':
            case 'stop':
                return await require('../src/commands/down').run(rest);
            case 'status':
                return await require('../src/commands/status').run(rest);
            case 'fleet':
                return await require('../src/commands/fleet').run(rest);
            case 'models':
                return await require('../src/commands/models').run(rest);
            default:
                log.err(`Unknown command: ${cmd}`);
                log.plain(USAGE);
                return 1;
        }
    } catch (e) {
        log.err(e.message || String(e));
        if (process.env.LOL_DEBUG) console.error(e);
        return 1;
    }
}

main().then((code) => {
    if (typeof code === 'number' && code !== 0) process.exitCode = code;
}).catch((e) => {
    log.err(e.message || String(e));
    process.exitCode = 1;
});
