// @ts-check
// The IDE's project history (src/main/projectGit.ts; owner, 2026-09-28: isomorphic-git): a commit only when something
// changed; the log newest first; a commit's changes file by file (text or "binary"); going back = a NEW commit that
// makes the tracked files what they were, leaving a never-committed file alone; and the projects API never lists or
// counts the .git folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'build', 'main');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `lol-git-${name}-`));

export default (test) => {
  /** @type {any} */ const G = require(path.join(BUILD, 'projectGit.js'));

  test('project git: commits only a change, logs newest first, and says what each commit changed', async () => {
    const dir = tmp('log');
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>one</h1>\n');
    fs.writeFileSync(path.join(dir, 'old.txt'), 'bye\n');
    const first = await G.commitAll(dir, 'Agent: make a page', G.AGENT);
    assert.match(first, G.OID_RE);
    assert.equal(await G.commitAll(dir, 'nothing', G.PERSON), null, 'no change, no commit');

    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>two</h1>\n');
    fs.rmSync(path.join(dir, 'old.txt'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'console.log(1)\n');
    fs.writeFileSync(path.join(dir, 'pic.png'), Buffer.from([137, 80, 78, 71, 0, 0, 1]));
    const second = await G.commitAll(dir, 'You:   edit\n index.html', G.PERSON);
    assert.match(second, G.OID_RE);

    const log = await G.history(dir);
    assert.deepEqual(log.map((c) => c.message), ['You: edit index.html', 'Agent: make a page'], 'newest first, one line');
    assert.deepEqual(log.map((c) => c.author), ['You', 'LOL Vibe agent']);
    assert.ok(log[0].time > Date.now() - 60000);

    const files = await G.changes(dir, second);
    assert.deepEqual(files.map((f) => f.path), ['index.html', 'old.txt', 'pic.png', 'src/app.js']);
    assert.deepEqual(files[0], { path: 'index.html', before: '<h1>one</h1>\n', after: '<h1>two</h1>\n', binary: false });
    assert.deepEqual(files[1], { path: 'old.txt', before: 'bye\n', after: null, binary: false });
    assert.deepEqual(files[2], { path: 'pic.png', before: null, after: null, binary: true });
    assert.equal(files[3].before, null);
    assert.deepEqual((await G.changes(dir, first)).map((f) => f.path), ['index.html', 'old.txt'], 'the first commit adds everything');
    assert.deepEqual(await G.history(tmp('empty')), [], 'no repository yet: no history');
  });

  test('project git: going back is a new commit — tracked files as they were, a never-committed file untouched', async () => {
    const dir = tmp('back');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'A1');
    fs.writeFileSync(path.join(dir, 'gone.txt'), 'G');
    const v1 = await G.commitAll(dir, 'Agent: first', G.AGENT);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'A2');
    fs.rmSync(path.join(dir, 'gone.txt'));
    fs.writeFileSync(path.join(dir, 'new.txt'), 'N');
    await G.commitAll(dir, 'Agent: second', G.AGENT);
    fs.writeFileSync(path.join(dir, 'scratch.txt'), 'not committed');

    const back = await G.restore(dir, v1);
    assert.match(back, G.OID_RE);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'A1');
    assert.equal(fs.readFileSync(path.join(dir, 'gone.txt'), 'utf8'), 'G', 'a deleted file comes back');
    assert.equal(fs.existsSync(path.join(dir, 'new.txt')), false, 'a later file goes');
    const log = await G.history(dir);
    assert.equal(log.length, 3, 'nothing is rewritten: the reply is still in the history');
    assert.equal(log[0].message, 'Back to: Agent: first');
    assert.deepEqual((await G.changes(dir, log[0].oid)).map((f) => f.path).includes('scratch.txt'), true,
      'the new commit records the whole folder, the untouched scratch file included');
    assert.equal(fs.readFileSync(path.join(dir, 'scratch.txt'), 'utf8'), 'not committed', 'never deleted');
    assert.equal(await G.restore(dir, log[0].oid), null, 'already there: no commit');
  });

  test('project git: the projects API never lists or counts the .git folder', async () => {
    const { createProjectsApi } = require(path.join(BUILD, 'projects.js'));
    const root = tmp('api');
    const api = createProjectsApi({ rootDir: root, shellApi: { showItemInFolder() {}, openPath: async () => '' } });
    const made = await api.create({ name: 'hist', kind: 'dom' });
    assert.equal(made.ok, true);
    const dir = path.join(root, made.project.id);
    fs.writeFileSync(path.join(dir, 'index.html'), '<p>x</p>');
    await G.commitAll(dir, 'Agent: x', G.AGENT);
    assert.ok(fs.existsSync(path.join(dir, '.git')));
    const listed = await api.listFiles(made.project.id);
    assert.equal(listed.ok, true);
    assert.equal(listed.files.some((f) => f.path.startsWith('.git')), false, 'no .git entry');
    assert.ok(listed.files.some((f) => f.path === 'index.html'));
  });
};
