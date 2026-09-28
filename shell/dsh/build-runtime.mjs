#!/usr/bin/env node
// Builds the IDE's coding-agent runtime for THIS machine's platform (docs/IDE_PLAN.md slice 5), the way
// sidecar/build-sidecar.mjs builds the chat engine:
//   shell/dsh/build/dsh-runtime/
//     node/            an official Node (NODE_VERSION, checked against nodejs.org's SHASUMS256.txt) — dsh's native
//                      addon refuses Electron 42's Node, so the agent brings its own
//     node_modules/    `npm ci` of shell/dsh/package-lock.json (the pinned @deepseek-ai/dsh, every package hashed)
//     RUNTIME.json     what is inside
// then dsh-runtime-<platform>-<arch>.tar.gz in the current folder. CI runs it on every release job; the client
// downloads the tarball when a person installs the agent from the Project panel (src/main/studio.ts resolves it).
//
//   node shell/dsh/build-runtime.mjs [--no-tar]
import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NODE_VERSION = '24.14.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'build', 'dsh-runtime');
const WIN = process.platform === 'win32';
const plat = `${process.platform}-${process.arch}`;

/** GET a URL into a Buffer, following redirects. @param {string} url @returns {Promise<Buffer>} */
function get(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'user-agent': 'LlmOnLan-build' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(res.headers.location, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** tar with paths relative to `cwd` (GNU tar on Windows reads "C:\…" as a remote host). */
function tar(args, cwd) {
  execFileSync(WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar', args, { cwd, stdio: 'inherit' });
}

async function addNode() {
  const nodeArch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null;
  if (!nodeArch) throw new Error(`no official Node build for ${plat}`);
  const os = WIN ? 'win' : process.platform;
  const dist = `node-v${NODE_VERSION}-${os}-${nodeArch}`;
  const file = `${dist}.${WIN ? 'zip' : 'tar.gz'}`;
  const base = `https://nodejs.org/dist/v${NODE_VERSION}/`;
  const sums = (await get(base + 'SHASUMS256.txt')).toString('utf8');
  const want = (sums.split('\n').find((l) => l.trim().endsWith(`  ${file}`)) || '').split(/\s+/)[0];
  if (!want) throw new Error(`${file} is not in SHASUMS256.txt`);
  const archive = await get(base + file);
  const got = crypto.createHash('sha256').update(archive).digest('hex');
  if (got !== want) throw new Error(`${file}: sha256 ${got} is not ${want}`);
  const tmp = path.join(HERE, 'build', 'node-dl');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, file), archive);
  tar(['-xf', file], tmp);   // Windows' own tar (bsdtar) reads the .zip too
  const dest = path.join(OUT, 'node');
  if (WIN) {
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(tmp, dist, 'node.exe'), path.join(dest, 'node.exe'));
  } else {
    fs.mkdirSync(path.join(dest, 'bin'), { recursive: true });
    fs.copyFileSync(path.join(tmp, dist, 'bin', 'node'), path.join(dest, 'bin', 'node'));
    fs.chmodSync(path.join(dest, 'bin', 'node'), 0o755);
  }
  fs.copyFileSync(path.join(tmp, dist, 'LICENSE'), path.join(dest, 'LICENSE'));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`[dsh-runtime] Node ${NODE_VERSION} (${file}, sha256 ok)`);
}

function installDsh() {
  for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(HERE, f), path.join(OUT, f));
  execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: OUT, stdio: 'inherit' });   // a fixed string: npm.cmd needs a shell on Windows
  // ponytail: the office-to-PDF tool's LibreOffice build (188 MB on win-x64) is never used — the profile keeps the
  // office skill off — and dsh runs without it (probe 2026-09-28). Put it back if the IDE ever turns that skill on.
  const scoped = path.join(OUT, 'node_modules', '@deepseek-ai');
  for (const d of fs.readdirSync(scoped)) if (/^libreoffice-kit-/.test(d)) fs.rmSync(path.join(scoped, d), { recursive: true, force: true });
  const lock = JSON.parse(fs.readFileSync(path.join(HERE, 'package-lock.json'), 'utf8'));
  return lock.packages['node_modules/@deepseek-ai/dsh'].version;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const dsh = installDsh();
await addNode();
fs.writeFileSync(path.join(OUT, 'RUNTIME.json'), JSON.stringify({ dsh, node: NODE_VERSION, platform: plat, builtAt: new Date().toISOString() }, null, 2) + '\n');
if (!process.argv.includes('--no-tar')) {
  const name = `dsh-runtime-${plat}.tar.gz`;
  const target = path.resolve(name);
  tar(['-czf', path.relative(OUT, target).split(path.sep).join('/'), '.'], OUT);
  console.log(`[dsh-runtime] ${name}: ${(fs.statSync(target).size / 1e6).toFixed(0)} MB`);
}
