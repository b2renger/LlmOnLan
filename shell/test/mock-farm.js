#!/usr/bin/env node
// Mock LOL farm — a thin CLI over shell/test/mock/ (plan §2.3, §2.6 A).
//
// An OpenAI-compatible proxy (open + optionally keyed), the farm snapshot on /lol/self,
// and a control API the harness drives (/mock/*). No GPU, no weights, no beacon.
//
//   node shell/test/mock-farm.js                         # slot 0: 4009 / 4010 / 4011 / 41987
//   node shell/test/mock-farm.js --slot 1                # slot 1: 4029 / 4030 / 4031 / 42007
//   node shell/test/mock-farm.js --port 4009 --keyed-port 4010 --key harness-pw \
//        --services-port 4011 --http-port 41987
//   node shell/test/mock-farm.js --coordinator           # snapshot flag only (see the beacon note)
//
// Flags: --slot n · --port · --keyed-port · --key · --services-port · --http-port ·
//        --beacon-port (default 41998) · --beacon-host · --no-beacon · --coordinator · --quiet
// A slot offsets the DEFAULT ports by 20n; an explicitly-passed port is used as given.
//
// THE BEACON IS OFF unless LOL_MOCK_BEACON_OK=1 is set AND --no-beacon is absent.
// NEVER set that variable on a machine running an LlmOnLan client: the client listens on
// 41998, prefers coordinators, and would switch itself to "Mock Farm" and restart Open
// WebUI under a real user. The legacy e2e.js flow (mock --coordinator + the real app)
// therefore runs only in CI or on a spare box. See shell/test/chat/README.md.
'use strict';

const { startMock, parseArgs, FORBIDDEN_PORTS } = require('./mock/index.js');

async function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h')) {
        // The header comment IS the help text; strip the comment markers.
        console.log(require('fs').readFileSync(__filename, 'utf8')
            .split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
        return 0;
    }
    const opts = parseArgs(argv, process.env);
    const mock = await startMock(opts);
    const stop = () => { mock.close().then(() => process.exit(0), () => process.exit(0)); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return null;   // keep the event loop alive: the servers are listening
}

main().catch((err) => {
    console.error(`[mock] ${err && err.message ? err.message : err}`);
    if (err && /forbidden port/.test(String(err.message))) {
        console.error(`[mock] forbidden: ${FORBIDDEN_PORTS.join(', ')} — pick a free --slot instead`);
    }
    process.exit(1);
});
