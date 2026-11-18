// A test farm from this checkout, for HUMAN_TESTS J19 (VLLM_DRAFT_PLAN, night n° 10): Qwen3.8 drafting with its MTP
// layer, served on the studio's PRO 6000 in place of the Farm app for the length of a test. It never touches the Farm
// app, its config or production's vLLM (~/lol-vllm): its own folder (%USERPROFILE%\lol-test-farm), its own vLLM root
// (~/lol-vllm-033, vLLM 0.33.0, whose hf/ is a link to production's: do not Download or Remove models from its panel),
// its own Ollama port (11500: the Ollama app keeps 11434). Same ports and beacon as the Farm app, so laptops find it.
//   node docs/spike/runs/draft_test_farm.mjs start    the farm, in this window (stop it with the line below)
//   node docs/spike/runs/draft_test_farm.mjs stop     lol down in its folder
// Env: LOL_TEST_FARM_DIR (another folder), LOL_TEST_FARM_SCRATCH=1 (its own ports 4290/41990 and no beacon: a dry run
// that laptops do not see).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOL = path.join(REPO, 'farm', 'bin', 'lol.js');
const DIR = process.env.LOL_TEST_FARM_DIR || path.join(os.homedir(), 'lol-test-farm');
const SCRATCH = process.env.LOL_TEST_FARM_SCRATCH === '1';
const LIVE = path.join(process.env.APPDATA || '', 'LlmOnLan Farm', 'farm', 'lol.config.json');
const what = process.argv[2];
const answers = async (port) => { try { await fetch(`http://127.0.0.1:${port}/lol/self`, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } };
const lol = (args) => spawnSync(process.execPath, [LOL, ...args], { cwd: DIR, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }).status ?? 1;

if (what === 'stop') process.exit(lol(['down']));
if (what !== 'start') { console.log('usage: node docs/spike/runs/draft_test_farm.mjs start|stop'); process.exit(2); }

const httpPort = SCRATCH ? 41990 : 41997;
if (await answers(httpPort)) {
    console.log(`A farm already answers on port ${httpPort}: quit the Farm app first (its tray icon, Quit), then run this again.`);
    process.exit(1);
}
// Quitting the Farm app runs `lol down`, which stops its vLLM; a vLLM still on the GPU (a quit that did not finish)
// would leave the test farm no memory. The desktop and an idle ComfyUI hold ~1–2 GB.
const used = Number(String(spawnSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).stdout || '').trim().split('\n')[0]);
if (used > 10000) {
    console.log(`The GPU holds ${Math.round(used / 1024)} GB: is the Farm app's vLLM still running? Quit the Farm app (it stops vLLM), wait a minute, run this again.`);
    process.exit(1);
}
fs.mkdirSync(DIR, { recursive: true });
const cfgFile = path.join(DIR, 'lol.config.json');
if (!fs.existsSync(cfgFile)) {
    let live = {};
    try { live = JSON.parse(fs.readFileSync(LIVE, 'utf8')); } catch { /* no Farm app config: defaults */ }
    const root = String((live.vllm && live.vllm.root) || '/home/ateliernum/lol-vllm').replace(/\/+$/, '') + '-033';
    const cfg = {
        name: `${live.name || os.hostname()} (test: drafting)`,
        beacon: SCRATCH ? { enabled: false, httpPort } : { enabled: true },
        proxy: SCRATCH ? { port: 4290, host: '127.0.0.1', internalPort: 4291 } : { host: '0.0.0.0', seatIdleSec: (live.proxy && live.proxy.seatIdleSec) || 900 },
        models: [{ id: 'gemma4:12b', default: true }],
        preinstall: [],
        ollama: { hosts: ['http://127.0.0.1:11500'] },
        llamacpp: { enabled: false },
        vllm: { enabled: true, root, port: 8190, model: 'qwen3.8-27b-nvfp4', contextLength: 32768, parallel: 'auto' },
        websearch: { enabled: false }, ocr: { enabled: false }, tts: { enabled: false }, classify: { enabled: false },
        stt: { enabled: false }, bus: { enabled: false }, embed: { enabled: false },
        // The Farm app's own panel password, so the panel opens the same way (this file stays on this computer).
        admin: { token: (live.admin && live.admin.token) || crypto.randomBytes(16).toString('hex') },
    };
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`Wrote ${cfgFile}: "${cfg.name}", vLLM from ${root}, Qwen3.8 at 32k, web search and the other plugins off.`);
}
console.log('Starting the test farm here (the first start takes about 10 minutes: vLLM compiles). Stop it with:');
console.log('  node docs/spike/runs/draft_test_farm.mjs stop');
process.exit(lol(['up', '--no-pick']));
