#!/usr/bin/env node
// release — bump the shell version, tag, and push, so CI builds + publishes.
//
// npm's built-in `npm version` git tagging proved unreliable, so we do the git
// half by hand: `npm version <type> --no-git-tag-version`, then explicitly commit
// ONLY the version files (so a dirty working tree doesn't ride along), make an
// annotated tag vX.Y.Z, and push --follow-tags. Pushing the tag triggers
// .github/workflows/release.yml. Guard: only release from `main`.
//
//   npm run release:patch | release:minor | release:major

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shellDir = path.join(__dirname, '..');

const type = process.argv[2];
if (!['patch', 'minor', 'major'].includes(type)) {
    console.error('usage: node scripts/release.mjs <patch|minor|major>');
    process.exit(1);
}

const git = (args, opts = {}) => execFileSync('git', args, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

// 1. Guard: must be on main and clean (ignoring untracked).
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') { console.error(`Refusing to release from '${branch}' — switch to main.`); process.exit(1); }
const dirty = git(['status', '--porcelain', '--untracked-files=no']);
if (dirty) { console.error('Working tree has tracked changes — commit or stash first:\n' + dirty); process.exit(1); }

// 2. Bump version in shell/package.json (no git tag — we do it by hand).
run('npm', ['version', type, '--no-git-tag-version'], { cwd: shellDir });
const pkg = JSON.parse(fs.readFileSync(path.join(shellDir, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
console.log(`\nReleasing ${tag}\n`);

// 3. Commit ONLY the version files (stage explicitly so nothing else rides along).
const lock = path.join(shellDir, 'package-lock.json');
const toAdd = [path.join(shellDir, 'package.json')];
if (fs.existsSync(lock)) toAdd.push(lock);
run('git', ['add', ...toAdd]);
run('git', ['commit', '-m', `release: ${tag}`]);

// 4. Annotated tag + push with the tag.
run('git', ['tag', '-a', tag, '-m', tag]);
run('git', ['push', '--follow-tags', 'origin', 'main']);

console.log(`\nPushed ${tag}. CI (.github/workflows/release.yml) will build + publish the installers.`);
