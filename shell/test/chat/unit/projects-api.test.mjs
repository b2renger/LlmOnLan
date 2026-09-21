// @ts-check
// The scratch-projects main-process API (studio plan §3.8) against the COMPILED output, a real
// temp root and a fake `shell` that only records. Everything here is the security boundary: the
// refusals, the symlink/junction stop, the quotas, the rate limit, the atomic write and the
// promise that `forget` deletes nothing. No Electron, no harness, no farm.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(HERE, '..', '..', '..');
const BUILT = path.join(SHELL, 'build', 'main', 'projects.js');
const SRC = path.join(SHELL, 'src', 'main', 'projects.ts');
const B = String.fromCharCode(92);

/** @type {string[]} */
const roots = [];
function tempRoot(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lol-projects-${name}-`));
  roots.push(dir);
  return dir;
}

/** A `shell` that records and opens nothing. */
function fakeShell() {
  const calls = [];
  return {
    calls,
    showItemInFolder: (p) => { calls.push({ call: 'showItemInFolder', path: p }); },
    openPath: async (p) => { calls.push({ call: 'openPath', path: p }); return ''; },
  };
}

const ok = (r, what) => { assert.equal(r.ok, true, `${what}: ${r.ok ? '' : `${r.code} ${r.message}`}`); return r; };
const err = (r, code, what) => {
  assert.equal(r.ok, false, `${what} should have been refused`);
  assert.equal(r.code, code, `${what}: expected ${code}, got ${r.code} (${r.message})`);
  return r;
};

export default (test) => {
  test('the compiled API is present and not stale', () => {
    assert.ok(fs.existsSync(BUILT), `missing ${BUILT} — run: npm --prefix shell run build`);
    assert.ok(
      fs.statSync(BUILT).mtimeMs >= fs.statSync(SRC).mtimeMs,
      'build/main/projects.js is older than projects.ts — run: npm --prefix shell run build',
    );
  });

  const { createProjectsApi } = require(BUILT);
  const make = (name, extra = {}) => {
    const shellApi = fakeShell();
    const rootDir = path.join(tempRoot(name), 'p');
    return { api: createProjectsApi({ rootDir, shellApi, ...extra }), shellApi, rootDir };
  };

  test('the happy path: create, write, read, list, reveal, path', async () => {
    const { api, shellApi, rootDir } = make('happy');

    const before = ok(await api.root(), 'root() before anything');
    assert.equal(before.exists, false, 'the root is created lazily, on the first create()');
    assert.equal(before.writable, false);
    assert.equal(before.path, path.resolve(rootDir));

    const created = ok(await api.create({ name: 'Bouncing Ball!', kind: 'p5' }), 'create');
    const id = created.project.id;
    assert.match(id, /^[a-z0-9][a-z0-9-]{0,47}-[a-z0-9]{8}$/, `minted id ${id}`);
    assert.match(id, /^bouncing-ball-/, 'the slug is what a human recognises in Explorer');
    assert.equal(created.project.kind, 'p5');
    assert.deepEqual(created.project.settings, { autoApply: false, autoFix: false, editPolicy: 'auto' },
      'auto-apply and auto-fix are OFF by default');

    const w = ok(await api.write(id, 'sketch.js', 'function setup(){}'), 'write');
    assert.equal(w.size, 18);
    ok(await api.write(id, 'lib/p5.js', '// vendored'), 'write into a subfolder');

    const r = ok(await api.read(id, 'sketch.js'), 'read');
    assert.equal(r.text, 'function setup(){}');
    assert.equal(r.mtime, w.mtime, 'the mtime a write reports is the one a read sees');

    const files = ok(await api.listFiles(id), 'listFiles');
    assert.deepEqual(files.files.map((f) => f.path), ['lib/p5.js', 'sketch.js'],
      'project.json is metadata, not one of the project files');

    assert.ok(fs.existsSync(path.join(rootDir, id, 'sketch.js')), 'the file is really on disk');
    assert.ok(fs.existsSync(path.join(rootDir, id, 'project.json')), 'and so is its metadata');

    const listed = ok(await api.list(), 'list');
    assert.deepEqual(listed.projects.map((p) => p.id), [id]);

    ok(await api.reveal(id), 'reveal');
    ok(await api.open(id), 'open');
    assert.deepEqual(shellApi.calls.map((c) => c.call), ['showItemInFolder', 'openPath']);
    assert.equal(shellApi.calls[0].path, path.join(rootDir, id), 'reveal points at the project folder');

    const p = ok(await api.path(id), 'path');
    assert.equal(p.path, path.join(rootDir, id), 'the absolute path, for "Copy path"');

    const after = ok(await api.root(), 'root() after create');
    assert.equal(after.exists, true);
    assert.equal(after.writable, true);
  });

  test('binary round-trip and the text/binary split', async () => {
    const { api } = make('binary');
    const id = ok(await api.create({ name: 'assets', kind: 'canvas' }), 'create').project.id;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]).toString('base64');
    ok(await api.writeBinary(id, 'assets/img/a.png', png), 'writeBinary');
    const back = ok(await api.readBinary(id, 'assets/img/a.png'), 'readBinary');
    assert.equal(back.base64, png);
    assert.equal(back.mime, 'image/png');
    err(await api.read(id, 'assets/img/a.png'), 'E_EXT', 'reading a png as text');
    err(await api.writeBinary(id, 'sketch.js', png), 'E_EXT', 'writing a script as binary');
    err(await api.write(id, 'x.exe', 'MZ'), 'E_EXT', 'writing an executable');
  });

  test('an id the renderer invented never resolves', async () => {
    const { api } = make('ids');
    ok(await api.create({ name: 'real', kind: 'dom' }), 'create');
    for (const id of ['', '..', 'nope', 'REAL-abcd1234'.toUpperCase(), 'a/b', '../../etc']) {
      err(await api.read(id, 'sketch.js'), 'E_ID', `read with id ${JSON.stringify(id)}`);
    }
    // A well-formed id for a project that does not exist is E_MISSING, not E_ID.
    err(await api.read('ghost-abcd1234', 'sketch.js'), 'E_MISSING', 'a well-formed but unknown id');
  });

  test('every escape attempt is refused, and refusals are counted', async () => {
    const { api, rootDir } = make('escape');
    const id = ok(await api.create({ name: 'esc', kind: 'dom' }), 'create').project.id;
    const outside = path.join(rootDir, 'outside.js');
    for (const rel of ['../outside.js', '../../outside.js', 'a/../../outside.js', '/etc/passwd',
      'C:/Windows/win.ini', 'a' + B + '..' + B + 'outside.js', '.git/config', 'con.js']) {
      const r = await api.write(id, rel, 'pwned');
      assert.equal(r.ok, false, `write accepted ${rel}`);
      assert.ok(r.code === 'E_PATH' || r.code === 'E_EXT', `${rel} -> ${r.code}`);
    }
    assert.ok(!fs.existsSync(outside), 'nothing was written outside the project folder');
    assert.ok(api.stats().refusedPaths >= 8, 'refused paths are counted as a bug signal');
  });

  test('a junction (or symlink) anywhere under the project stops the operation', async () => {
    const { api, rootDir } = make('links');
    const id = ok(await api.create({ name: 'links', kind: 'dom' }), 'create').project.id;
    const elsewhere = path.join(rootDir, '..', 'elsewhere');
    fs.mkdirSync(elsewhere, { recursive: true });
    const link = path.join(rootDir, id, 'lib');
    let made = '';
    try { fs.symlinkSync(elsewhere, link, 'junction'); made = 'junction'; } catch { /* try a symlink */ }
    if (!made) {
      try { fs.symlinkSync(elsewhere, link, 'dir'); made = 'symlink'; } catch { /* no privilege */ }
    }
    if (!made) {
      assert.ok(true, 'this box cannot create a junction or a symlink; the rig covers it');
      return;
    }
    err(await api.write(id, 'lib/x.js', 'nope'), 'E_PATH', `writing through a ${made}`);
    err(await api.read(id, 'lib/x.js'), 'E_PATH', `reading through a ${made}`);
    assert.equal(fs.readdirSync(elsewhere).length, 0, 'nothing was written through the link');
  });

  test('optimistic concurrency: a stale ifMtime is E_CONFLICT (disk wins)', async () => {
    const { api } = make('conflict');
    const id = ok(await api.create({ name: 'c', kind: 'dom' }), 'create').project.id;
    const first = ok(await api.write(id, 'a.js', 'one'), 'first write');
    ok(await api.write(id, 'a.js', 'two', { ifMtime: first.mtime }), 'a write with the mtime it read');
    err(await api.write(id, 'a.js', 'three', { ifMtime: first.mtime }), 'E_CONFLICT', 'a stale mtime');
    assert.equal(ok(await api.read(id, 'a.js'), 'read').text, 'two', 'the refused write changed nothing');
    err(await api.write(id, 'gone.js', 'x', { ifMtime: 123 }), 'E_CONFLICT', 'ifMtime on a file that is gone');
  });

  test('a failing rename leaves the original intact and cleans up the temp file', async () => {
    const root = path.join(tempRoot('atomic'), 'p');
    let breakRename = false;
    const fsApi = {
      ...fsp,
      rename: async (from, to) => {
        if (breakRename) { const e = new Error('nope'); e.code = 'EINVAL'; throw e; }
        return fsp.rename(from, to);
      },
    };
    const api = createProjectsApi({ rootDir: root, shellApi: fakeShell(), fsApi });
    const id = ok(await api.create({ name: 'atom', kind: 'dom' }), 'create').project.id;
    ok(await api.write(id, 'a.js', 'original'), 'the good write');

    breakRename = true;
    err(await api.write(id, 'a.js', 'replacement'), 'E_IO', 'a write whose rename fails');
    breakRename = false;

    assert.equal(ok(await api.read(id, 'a.js'), 'read').text, 'original',
      'a crash at rename never truncates a sketch');
    const left = fs.readdirSync(path.join(root, id)).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(left, [], 'the temp file was removed');
  });

  test('a file held open comes back as E_LOCKED after the retry ladder', async () => {
    const root = path.join(tempRoot('locked'), 'p');
    let lock = false;
    const fsApi = {
      ...fsp,
      rename: async (from, to) => {
        if (lock) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
        return fsp.rename(from, to);
      },
    };
    const api = createProjectsApi({ rootDir: root, shellApi: fakeShell(), fsApi });
    const id = ok(await api.create({ name: 'lock', kind: 'dom' }), 'create').project.id;
    lock = true;
    const r = err(await api.write(id, 'a.js', 'x'), 'E_LOCKED', 'a locked target');
    assert.match(r.message, /open in another program/);
    assert.equal(api.stats().renameRetries, 3, 'three retries at 50 ms before giving up');
    assert.equal(api.stats().lockedGiveUps, 1);
  });

  test('a full disk says so, and writes nothing', async () => {
    const root = path.join(tempRoot('nospc'), 'p');
    let full = false;
    const fsApi = {
      ...fsp,
      open: async (p, flags) => {
        if (full && String(p).endsWith('.tmp')) { const e = new Error('full'); e.code = 'ENOSPC'; throw e; }
        return fsp.open(p, flags);
      },
    };
    const api = createProjectsApi({ rootDir: root, shellApi: fakeShell(), fsApi });
    const id = ok(await api.create({ name: 'disk', kind: 'dom' }), 'create').project.id;
    full = true;
    const r = err(await api.write(id, 'a.js', 'x'), 'E_IO', 'a write with no space left');
    assert.match(r.message, /disk is full/);
  });

  test('quotas: files per project, bytes per project, projects, and file size', async () => {
    const root = path.join(tempRoot('quota'), 'p');
    const api = createProjectsApi({
      rootDir: root, shellApi: fakeShell(),
      limits: { files: 2, bytes: 18, textMax: 16, projects: 2 },
    });
    const id = ok(await api.create({ name: 'q', kind: 'dom' }), 'create').project.id;
    ok(await api.write(id, 'a.js', 'a'), 'file 1');
    ok(await api.write(id, 'b.js', 'b'), 'file 2');
    err(await api.write(id, 'c.js', 'c'), 'E_QUOTA', 'file 3 over the file quota');
    ok(await api.write(id, 'a.js', 'aaaa'), 'overwriting an existing file is not a new file');
    err(await api.write(id, 'a.js', 'x'.repeat(17)), 'E_SIZE', 'over the per-file cap');
    err(await api.write(id, 'b.js', 'y'.repeat(16)), 'E_QUOTA', 'over the per-project byte quota');

    ok(await api.create({ name: 'q2', kind: 'dom' }), 'the second project');
    err(await api.create({ name: 'q3', kind: 'dom' }), 'E_QUOTA', 'one project too many');
  });

  test('the write rate limit is a token bucket, and it refills', async () => {
    const root = path.join(tempRoot('rate'), 'p');
    let clock = 1_000_000;
    const api = createProjectsApi({ rootDir: root, shellApi: fakeShell(), now: () => clock });
    const id = ok(await api.create({ name: 'r', kind: 'dom' }), 'create').project.id;
    let refused = 0;
    for (let i = 0; i < 41; i++) {
      const r = await api.write(id, 'a.js', `x${i}`);
      if (!r.ok) { assert.equal(r.code, 'E_RATE'); refused += 1; }
    }
    assert.equal(refused, 1, 'burst 40, then the 41st write in the same millisecond is refused');
    clock += 1000;
    ok(await api.write(id, 'a.js', 'after a second'), 'the bucket refills at 20/s');
  });

  test('forget hides the project and deletes nothing', async () => {
    const { api, rootDir } = make('forget');
    const id = ok(await api.create({ name: 'keep me', kind: 'dom' }), 'create').project.id;
    ok(await api.write(id, 'sketch.js', 'precious'), 'write');
    ok(await api.forget(id), 'forget');

    assert.deepEqual(ok(await api.list(), 'list').projects, [], 'the row is gone from the list');
    assert.equal(ok(await api.read(id, 'sketch.js'), 'read').text, 'precious',
      'the file is still there and still readable');
    assert.equal(ok(await api.meta(id), 'meta').project.hidden, true);
    assert.ok(fs.existsSync(path.join(rootDir, id, 'sketch.js')), 'nothing was deleted on disk');
  });

  test('project.json is reserved: the file-writing path can never change or delete it', async () => {
    // S0 review, finding 2. `project.json` is an ordinary two-token .json path as far as the path
    // validator is concerned, so before the reservation a write flipped autoApply/autoFix on and a
    // remove made the project vanish from list() — through the very API a model-named target goes
    // through. The owner decision is "auto-apply/auto-fix OFF by default (opt-in per project)".
    const { api, rootDir } = make('meta-reserved');
    const id = ok(await api.create({ name: 'Probe', kind: 'p5' }), 'create').project.id;
    assert.equal(ok(await api.meta(id), 'meta').project.settings.autoApply, false);

    const pwn = JSON.stringify({
      lolproject: 1, id, name: 'PWNED', kind: 'p5', createdAt: 1, updatedAt: 1,
      settings: { autoApply: true, autoFix: true, editPolicy: 'whole' }, hidden: false,
    });
    err(await api.write(id, 'project.json', pwn), 'E_PATH', 'writing the metadata file');
    err(await api.write(id, './project.json', pwn), 'E_PATH', 'the same path spelled with a dot');
    ok(await api.writeBinary(id, 'project.png', 'AAAA'), 'a DIFFERENT name is not reserved');
    err(await api.remove(id, 'project.json'), 'E_PATH', 'removing the metadata file');

    const after = ok(await api.meta(id), 'meta again').project;
    assert.equal(after.name, 'Probe', 'the name was not rewritten');
    assert.equal(after.settings.autoApply, false, 'auto-apply is still off');
    assert.equal(after.settings.autoFix, false, 'and so is auto-fix');
    assert.equal(ok(await api.list(), 'list').projects.length, 1, 'the project is still listed');
    assert.ok(fs.existsSync(path.join(rootDir, id, 'project.json')), 'and the file is still on disk');
    // A nested file of the same name is NOT the metadata file, and stays writable.
    ok(await api.write(id, 'lib/project.json', '{"a":1}'), 'lib/project.json is an ordinary file');
  });

  test('remove takes files only, never a folder', async () => {
    const { api, rootDir } = make('remove');
    const id = ok(await api.create({ name: 'rm', kind: 'dom' }), 'create').project.id;
    ok(await api.write(id, 'lib/a.js', 'x'), 'write');
    fs.mkdirSync(path.join(rootDir, id, 'folder.js'));
    err(await api.remove(id, 'folder.js'), 'E_PATH', 'removing a directory');
    assert.ok(fs.existsSync(path.join(rootDir, id, 'folder.js')), 'the directory is still there');
    ok(await api.remove(id, 'lib/a.js'), 'removing a file');
    err(await api.remove(id, 'lib/a.js'), 'E_MISSING', 'removing it twice');
    assert.ok(fs.existsSync(path.join(rootDir, id, 'lib')), 'the folder it lived in is left alone');
  });

  test('list skips an unparsable project.json and counts it', async () => {
    const { api, rootDir } = make('broken');
    const good = ok(await api.create({ name: 'good', kind: 'dom' }), 'create').project.id;
    const bad = ok(await api.create({ name: 'bad', kind: 'dom' }), 'create').project.id;
    fs.writeFileSync(path.join(rootDir, bad, 'project.json'), '{not json');
    fs.mkdirSync(path.join(rootDir, 'not-a-project'));           // ignored: not an id
    const r = ok(await api.list(), 'list');
    assert.deepEqual(r.projects.map((p) => p.id), [good]);
    assert.equal(r.skipped, 1, 'the broken one is counted, not swallowed');
    err(await api.meta(bad), 'E_MISSING', 'its metadata');
  });

  test('a project folder deleted behind our back is E_MISSING, never re-created', async () => {
    const { api, rootDir } = make('vanish');
    const id = ok(await api.create({ name: 'gone', kind: 'dom' }), 'create').project.id;
    fs.rmSync(path.join(rootDir, id), { recursive: true, force: true });
    err(await api.write(id, 'a.js', 'x'), 'E_MISSING', 'writing into a folder that is gone');
    err(await api.listFiles(id), 'E_MISSING', 'listing it');
    err(await api.reveal(id), 'E_MISSING', 'revealing it');
    assert.ok(!fs.existsSync(path.join(rootDir, id)), 'the folder was NOT silently re-created');
  });

  test('a root that cannot be created is E_ROOT, with the path', async () => {
    const dir = tempRoot('noroot');
    const file = path.join(dir, 'blocker');
    fs.writeFileSync(file, 'i am a file, not a folder');
    const api = createProjectsApi({ rootDir: path.join(file, 'projects'), shellApi: fakeShell() });
    const r = err(await api.create({ name: 'x', kind: 'dom' }), 'E_ROOT', 'create under a file');
    assert.ok(r.message.includes('projects'), 'the message names the folder so the UI can be honest');
    const rootInfo = ok(await api.root(), 'root()');
    assert.equal(rootInfo.exists, false);
    assert.deepEqual(ok(await api.list(), 'list').projects, [], 'list stays empty rather than throwing');
  });

  test('a data folder that is too long is refused before anything is created', async () => {
    const deep = path.join(tempRoot('long'), 'x'.repeat(140));
    const api = createProjectsApi({ rootDir: deep, shellApi: fakeShell() });
    const r = err(await api.create({ name: 'x', kind: 'dom' }), 'E_PATH', 'create under a 150+ char root');
    assert.ok(r.message.includes(deep), 'the message names the data folder');
    assert.ok(!fs.existsSync(deep), 'and nothing was created');
  });

  test('bad input is an answer, never a throw', async () => {
    const { api } = make('input');
    err(await api.create({ name: '', kind: 'dom' }), 'E_PATH', 'a nameless project');
    err(await api.create({ name: 'x'.repeat(81), kind: 'dom' }), 'E_PATH', 'an 81-char name');
    err(await api.create({ name: 'x', kind: 'nope' }), 'E_PATH', 'an unknown kind');
    const id = ok(await api.create({ name: 'ok', kind: 'dom' }), 'create').project.id;
    err(await api.write(id, 'a.js', 42), 'E_PATH', 'text that is a number');
    err(await api.writeBinary(id, 'a.png', 'not base64!!'), 'E_PATH', 'base64 that is not base64');
    ok(await api.update(id, { settings: { autoApply: true, editPolicy: 'whole' } }), 'update');
    const m = ok(await api.meta(id), 'meta').project;
    assert.deepEqual(m.settings, { autoApply: true, autoFix: false, editPolicy: 'whole' });
    ok(await api.update(id, { settings: { editPolicy: 'nonsense' } }), 'an unknown policy is coerced');
    assert.equal(ok(await api.meta(id), 'meta').project.settings.editPolicy, 'whole');
  });

  test('cleanup', () => {
    for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ } }
    assert.ok(true);
  });
};
