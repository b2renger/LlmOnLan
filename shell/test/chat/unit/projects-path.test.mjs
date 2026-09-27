// @ts-check
// The scratch-projects path validator (studio plan §3.8.2), table-driven against the COMPILED main
// output — the same file the shell and the harness load, so a rule that only exists in the .ts is
// not a rule. Pure: no fs, no temp folders, no Electron.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ACCEPTED, REJECTED, WRONG_LIST } from '../fixtures/project-paths.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(HERE, '..', '..', '..');
const BUILT = path.join(SHELL, 'build', 'main', 'projectsPath.js');
const SRC = path.join(SHELL, 'src', 'main', 'projectsPath.ts');

const B = String.fromCharCode(92);
const ID = 'sketch-abcd1234';

export default (test) => {
  test('the compiled validator is present and not stale', () => {
    assert.ok(fs.existsSync(BUILT), `missing ${BUILT} — run: npm --prefix shell run build`);
    assert.ok(
      fs.statSync(BUILT).mtimeMs >= fs.statSync(SRC).mtimeMs,
      'build/main/projectsPath.js is older than projectsPath.ts — run: npm --prefix shell run build',
    );
  });

  const P = require(BUILT);

  test('validateId accepts only what create() mints', () => {
    for (const id of ['sketch-abcd1234', 'a-00000000', 'my-long-name-here-zzzz9999']) {
      assert.equal(P.validateId(id).ok, true, id);
    }
    for (const id of ['', '..', '.', 'sketch', 'Sketch-abcd1234', 'sketch-ABCD1234', '-x-abcd1234',
      'sketch-abcd123', 'sketch-abcd12345', 'sketch/abcd1234', 'sketch-abcd1234/..',
      'x'.repeat(60) + '-abcd1234', null, 42, {}]) {
      const r = P.validateId(id);
      assert.equal(r.ok, false, `${String(id)} must not be an id`);
      assert.equal(r.code, 'E_ID');
    }
  });

  test(`validateRel refuses all ${REJECTED.length} table rows, with the stated code`, () => {
    for (const row of REJECTED) {
      const r = P.validateRel(row.rel);
      assert.equal(r.ok, false, `accepted ${JSON.stringify(row.rel)} (${row.why})`);
      assert.equal(r.code, row.code, `${JSON.stringify(row.rel)} (${row.why})`);
    }
  });

  test('validateRel accepts the real ones and reports their segments', () => {
    for (const row of ACCEPTED) {
      const r = P.validateRel(row.rel);
      assert.equal(r.ok, true, `refused ${row.rel} (${row.why})`);
      assert.deepEqual(r.segments, row.rel.split('/'));
    }
  });

  test('the TEXT/BIN split is per call, not per file', () => {
    for (const row of WRONG_LIST) {
      const exts = row.call === 'text' ? P.TEXT_EXT : P.BIN_EXT;
      const r = P.validateRel(row.rel, { exts });
      assert.equal(r.ok, false, `${row.rel} (${row.why})`);
      assert.equal(r.code, row.code);
    }
    assert.equal(P.validateRel('sketch.js', { exts: P.TEXT_EXT }).ok, true);
    assert.equal(P.validateRel('a.png', { exts: P.BIN_EXT }).ok, true);
  });

  test('resolveIn is the mechanical backstop: nothing lands outside <root>/<id>', () => {
    const root = path.resolve('/tmp/lol-projects-root');
    const ok = P.resolveIn(root, ID, 'lib/p5.js');
    assert.equal(ok.ok, true);
    assert.equal(ok.abs, path.join(root, ID, 'lib', 'p5.js'));

    for (const rel of ['../x.js', '../../x.js', 'a/../../x.js', '/x.js', 'C:/x.js', 'a' + B + 'b.js']) {
      const r = P.resolveIn(root, ID, rel);
      assert.equal(r.ok, false, `resolveIn accepted ${rel}`);
      assert.equal(r.code, 'E_PATH');
    }
    // A bad id never resolves, whatever the path says.
    const badId = P.resolveIn(root, '../../etc', 'sketch.js');
    assert.equal(badId.ok, false);
    assert.equal(badId.code, 'E_ID');
  });

  test('resolveIn refuses an over-long resolved path before the call', () => {
    const root = path.resolve('/tmp/lol-projects-root');
    const deep = P.resolveIn(path.join(root, 'x'.repeat(220)), ID, 'sketch.js');
    assert.equal(deep.ok, false, 'a resolved path over 240 chars is refused before the call');
    assert.equal(deep.code, 'E_PATH');
  });

  test('the extension lists are the ones the sandbox and the OCR/binary calls rely on', () => {
    for (const e of ['.js', '.mjs', '.html', '.css', '.json', '.md', '.ino', '.cpp', '.frag']) {
      assert.ok(P.TEXT_EXT.includes(e), `${e} must be writable as text`);
    }
    for (const e of ['.png', '.jpg', '.wav', '.woff2']) {
      assert.ok(P.BIN_EXT.includes(e), `${e} must be writable as binary`);
    }
    for (const e of ['.exe', '.bat', '.ps1', '.lnk', '.dll', '.sh']) {
      assert.ok(!P.TEXT_EXT.includes(e) && !P.BIN_EXT.includes(e), `${e} must never be writable`);
    }
  });
};
