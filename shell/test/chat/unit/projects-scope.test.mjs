// @ts-check
// The projects carve-out is a WIDENING of the scope gate, and a widening is only safe if it is
// exactly as wide as it says (studio plan §2.5). These tests drive chat-scope.js's pure checker
// with synthetic diffs: the four carved-out paths are allowed, and every other file under
// shell/src/** — including a plausible-looking neighbour — is still refused.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { checkScope } = require(path.join(HERE, '..', '..', 'chat-scope.js'));

const io = (over) => Object.assign({
  changed: [], readBase: () => null, readWork: () => null, diff: () => '',
}, over);

const flagged = (r) => r.violations.map((v) => `${v.path} ${v.message}`).join(' | ');

const PRELOAD = [
  "contextBridge.exposeInMainWorld('lol', {",            // 1
  '  relaunch: () => ipcRenderer.invoke("relaunch-app"),', // 2
  '  projects: {',                                        // 3
  "    root: () => ipcRenderer.invoke('lol:projects:root')," , // 4
  '  },',                                                 // 5
  '});',                                                  // 6
].join('\n');

const MAIN = [
  "import { app } from 'electron';",              // 1
  'function registerIpc() {',                     // 2
  '  // ---- LOL Studio (S0) ----',               // 3
  "  ipcMain.handle('lol:projects:root', () => projects().root());", // 4
  '  // ---- /LOL Studio ----',                   // 5
  '}',                                            // 6
].join('\n');

export default (test) => {
  test('the four carved-out paths are allowed', () => {
    const r = checkScope(io({
      changed: [
        'shell/src/main/projects.ts',
        'shell/src/main/projectsPath.ts',
        'shell/renderer/chat/projects/bridge.mjs',
        'shell/test/chat/unit/projects-api.test.mjs',
      ],
    }));
    assert.equal(r.violations.length, 0, flagged(r));
  });

  test('another file under shell/src is still out of scope', () => {
    for (const p of [
      'shell/src/main/sidecar.ts',
      'shell/src/main/projectsExtra.ts',
      'shell/src/main/projects/index.ts',
      'shell/src/preload/projects.ts',
      'shell/renderer/app.js.map',
      'farm/src/snapshot.js',
    ]) {
      const r = checkScope(io({ changed: [p], readWork: () => 'anything' }));
      assert.ok(r.violations.length > 0, `${p} slipped through the gate`);
    }
  });

  test('an index.ts hunk outside the marked region is refused', () => {
    const base = MAIN;
    const work = MAIN.replace('function registerIpc() {', 'function registerIpc() {\n  sneak();');
    const r = checkScope(io({
      changed: ['shell/src/main/index.ts'],
      readBase: () => base,
      readWork: () => work,
      diff: () => ['--- a', '+++ b', '@@ -2,0 +3 @@', '+  sneak();'].join('\n'),
    }));
    assert.ok(/OUTSIDE every LOL Studio/.test(flagged(r)), flagged(r));
  });

  test('a preload line outside the projects property is refused', () => {
    const r = checkScope(io({
      changed: ['shell/src/preload/index.ts'],
      readBase: () => PRELOAD,
      readWork: () => PRELOAD,
      diff: () => ['--- a', '+++ b', '@@ -1,0 +2 @@', "+  runAnything: (c) => ipcRenderer.invoke('exec', c),"].join('\n'),
    }));
    assert.ok(/outside the `projects` and `debugLog` properties/.test(flagged(r)), flagged(r));
  });

  test('a removal inside the carve-out is still a removal', () => {
    const r = checkScope(io({
      changed: ['shell/src/main/index.ts'],
      readBase: () => MAIN,
      readWork: () => MAIN,
      diff: () => ['--- a', '+++ b', '@@ -4 +4 @@',
        "-  ipcMain.handle('lol:projects:root', () => projects().root());",
        "+  ipcMain.handle('lol:projects:root', () => rootDir);"].join('\n'),
    }));
    assert.ok(/additive only/.test(flagged(r)), flagged(r));
  });
};
