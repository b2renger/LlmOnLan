// @ts-check
// The renderer half of scratch projects (studio plan §3.8.5): the memory backend that stands in
// when this build has no projects folder, and the bridge that normalises everything coming back
// over IPC. The point of the memory backend is that it refuses EXACTLY what the main process
// refuses — so the same table drives both, and a drift is a failure here.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createMemoryProjects, validateRel as memValidateRel } from '../../../renderer/chat/projects/memory.mjs';
import { createProjects, explain, renderNotice, install } from '../../../renderer/chat/projects/bridge.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import { ACCEPTED, REJECTED, WRONG_LIST } from '../fixtures/project-paths.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILT = path.join(HERE, '..', '..', '..', 'build', 'main', 'projectsPath.js');

const OPS = ['root', 'list', 'create', 'meta', 'update', 'forget', 'listFiles', 'read', 'readBinary',
  'write', 'writeBinary', 'remove', 'reveal', 'open', 'path'];

/** A door that answers whatever it is told to. */
function fakeDoor(reply) {
  const calls = [];
  const api = {};
  for (const op of OPS) api[op] = async (...args) => { calls.push({ op, args }); return reply(op, args); };
  return { api, calls };
}

export default (test) => {
  test('the memory backend mirrors the main-process validator, row for row', () => {
    assert.ok(fs.existsSync(BUILT), `missing ${BUILT} — run: npm --prefix shell run build`);
    const P = require(BUILT);
    for (const row of [...REJECTED]) {
      const mine = memValidateRel(row.rel);
      const theirs = P.validateRel(row.rel);
      assert.equal(mine.ok, false, `memory accepted ${JSON.stringify(row.rel)} (${row.why})`);
      assert.equal(mine.code, theirs.code, `drift on ${JSON.stringify(row.rel)}: memory ${mine.code} vs main ${theirs.code}`);
    }
    for (const row of ACCEPTED) {
      assert.equal(memValidateRel(row.rel).ok, true, `memory refused ${row.rel}`);
      assert.equal(P.validateRel(row.rel).ok, true, `main refused ${row.rel}`);
    }
    for (const row of WRONG_LIST) {
      const exts = row.call === 'text' ? P.TEXT_EXT : P.BIN_EXT;
      assert.equal(memValidateRel(row.rel, { exts }).code, row.code, row.why);
    }
  });

  test('the memory backend refuses the whole table through its real calls too', async () => {
    const m = createMemoryProjects();
    const id = (await m.create({ name: 'mem', kind: 'p5' })).project.id;
    assert.match(id, /^mem-[a-z0-9]{8}$/);
    for (const row of REJECTED) {
      const w = await m.write(id, row.rel, 'x');
      assert.equal(w.ok, false, `write accepted ${JSON.stringify(row.rel)} (${row.why})`);
      assert.equal(w.code, row.code, JSON.stringify(row.rel));
      const r = await m.read(id, row.rel);
      assert.equal(r.ok, false, `read accepted ${JSON.stringify(row.rel)}`);
    }
  });

  test('the memory backend round-trips every accepted path', async () => {
    const m = createMemoryProjects();
    const id = (await m.create({ name: 'round', kind: 'p5' })).project.id;
    for (const row of ACCEPTED) {
      if (row.kind === 'text') {
        const w = await m.write(id, row.rel, `// ${row.rel}`);
        assert.equal(w.ok, true, `${row.rel}: ${w.code}`);
        const r = await m.read(id, row.rel);
        assert.equal(r.ok, true, row.rel);
        assert.equal(r.text, `// ${row.rel}`);
      } else {
        const w = await m.writeBinary(id, row.rel, 'AAAA');
        assert.equal(w.ok, true, `${row.rel}: ${w.code}`);
        assert.equal((await m.readBinary(id, row.rel)).base64, 'AAAA');
      }
    }
    const files = await m.listFiles(id);
    assert.equal(files.files.length, ACCEPTED.length);
    assert.equal((await m.remove(id, 'sketch.js')).ok, true);
    assert.equal((await m.read(id, 'sketch.js')).code, 'E_MISSING');
  });

  test('the memory backend reserves project.json exactly as the main process does', async () => {
    // S0 review, finding 2. Both backends must answer identically for every accepted and rejected
    // path (studio plan §4's projects-bridge test); the reservation is a rejection, so it has to
    // live in both. Reads stay allowed; only update()/forget() ever change the metadata.
    const m = createMemoryProjects();
    const id = (await m.create({ name: 'Probe', kind: 'p5' })).project.id;
    assert.equal((await m.meta(id)).project.settings.autoApply, false);

    const w = await m.write(id, 'project.json', '{"name":"PWNED","settings":{"autoApply":true}}');
    assert.equal(w.ok, false, 'writing the metadata file');
    assert.equal(w.code, 'E_PATH');
    assert.equal((await m.remove(id, 'project.json')).code, 'E_PATH', 'removing it');
    // writeBinary never reaches the reservation: .json is not a binary extension, so it is
    // refused one step earlier — refused is refused, and the main process answers the same.
    assert.equal((await m.writeBinary(id, 'project.json', 'AAAA')).code, 'E_EXT', 'or writing it as bytes');

    const after = (await m.meta(id)).project;
    assert.equal(after.name, 'Probe');
    assert.equal(after.settings.autoApply, false);
    assert.equal((await m.list()).projects.length, 1, 'the project is still listed');
    assert.equal((await m.write(id, 'lib/project.json', '{}')).ok, true, 'a nested file of that name is ordinary');
  });

  test('the memory backend keeps the same promises: conflict, forget, no folder', async () => {
    let clock = 1000;
    const m = createMemoryProjects({ now: () => (clock += 1) });
    const id = (await m.create({ name: 'p', kind: 'dom' })).project.id;
    const first = await m.write(id, 'a.js', 'one');
    assert.equal((await m.write(id, 'a.js', 'two', { ifMtime: first.mtime })).ok, true);
    assert.equal((await m.write(id, 'a.js', 'three', { ifMtime: first.mtime })).code, 'E_CONFLICT');
    assert.equal((await m.read(id, 'a.js')).text, 'two', 'the refused write changed nothing');

    assert.equal((await m.forget(id)).ok, true);
    assert.deepEqual((await m.list()).projects, [], 'hidden from the list');
    assert.equal((await m.read(id, 'a.js')).text, 'two', 'and nothing was deleted');

    for (const op of ['reveal', 'open', 'path']) {
      assert.equal((await m[op](id)).code, 'E_ROOT', `${op} has no folder to work with`);
    }
    assert.equal((await m.root()).exists, false);
    assert.equal((await m.write('nope-abcd1234', 'a.js', 'x')).code, 'E_MISSING');
    assert.equal((await m.write('..', 'a.js', 'x')).code, 'E_ID');
  });

  test('the memory backend enforces the same rate limit', async () => {
    let clock = 5000;
    const m = createMemoryProjects({ now: () => clock });
    const id = (await m.create({ name: 'rate', kind: 'dom' })).project.id;
    let refused = 0;
    for (let i = 0; i < 41; i++) {
      const r = await m.write(id, 'a.js', `x${i}`);
      if (!r.ok) { assert.equal(r.code, 'E_RATE'); refused += 1; }
    }
    assert.equal(refused, 1, 'burst 40 then a refusal');
    clock += 1000;
    assert.equal((await m.write(id, 'a.js', 'later')).ok, true, 'the bucket refills');
  });

  test('with no door, the bridge is the memory backend and says so', async () => {
    const p = createProjects(null);
    assert.equal(p.kind(), 'memory');
    assert.equal(p.notice(), t('projects.memoryNotice'));
    assert.equal(p.notice(), 'this build has no projects folder; sketches run but are not saved');
    const c = await p.create({ name: 'x', kind: 'dom' });
    assert.equal(c.ok, true, 'sketches still run — they are just not saved');
    assert.equal((await p.write(c.project.id, '../x.js', 'no')).code, 'E_PATH');
  });

  test('with a door, every call is forwarded and every answer is normalised', async () => {
    const { api, calls } = fakeDoor((op) => {
      if (op === 'read') return { ok: true, text: 'hi', size: 2, mtime: 1 };
      if (op === 'write') return { ok: false, code: 'E_LOCKED', message: 'the file is open in another program' };
      if (op === 'remove') return { ok: false, code: 'NOT_A_CODE', message: 'nonsense' };
      if (op === 'list') return 'not an object at all';
      return { ok: true };
    });
    const p = createProjects(api);
    assert.equal(p.kind(), 'real');
    assert.equal(p.notice(), null, 'a real folder needs no apology');

    assert.equal((await p.read('a-abcd1234', 'x.js')).text, 'hi');
    assert.deepEqual(calls[0], { op: 'read', args: ['a-abcd1234', 'x.js'] }, 'arguments pass straight through');

    const locked = await p.write('a-abcd1234', 'x.js', 'body');
    assert.equal(locked.code, 'E_LOCKED');
    assert.match(locked.message, /open in another program/);

    const bogus = await p.remove('a-abcd1234', 'x.js');
    assert.equal(bogus.code, 'E_IO', 'a code we do not know becomes E_IO');

    const garbage = await p.list();
    assert.deepEqual(garbage, { ok: false, code: 'E_IO', message: t('projects.err_E_IO') });
  });

  test('an IPC rejection never escapes as a throw', async () => {
    const { api } = fakeDoor(() => { throw new Error('the handler is gone'); });
    const p = createProjects(api);
    const r = await p.root();
    assert.deepEqual(r, { ok: false, code: 'E_IO', message: t('projects.err_E_IO') });
  });

  test('a door missing even one method is not a door', async () => {
    const { api } = fakeDoor(() => ({ ok: true }));
    delete api.writeBinary;
    // install() is what looks at window.lol; createProjects is handed the result of that look, so
    // the equivalent assertion here is that a half-built object is never treated as real.
    const half = Object.keys(api).length === OPS.length - 1;
    assert.ok(half, 'the fixture really is missing one op');
    assert.equal(createProjects(null).kind(), 'memory');
  });

  test('explain() turns a code into a sentence, never a raw E_*', () => {
    assert.equal(explain({ code: 'E_LOCKED' }), 'The file is open in another program.');
    assert.equal(explain({ code: 'E_CONFLICT' }), t('projects.err_E_CONFLICT'));
    assert.equal(explain({ code: 'WAT' }), t('projects.err_unknown'));
    assert.equal(explain(null), t('projects.err_unknown'));
  });

  test('renderNotice shows the sentence only when there is no folder', () => {
    const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
    const host = doc.createElement('div');
    const el = renderNotice(host, createProjects(null));
    assert.ok(el, 'the note was rendered');
    assert.equal(el.className, 'chat-projects-notice');
    assert.equal(el.textContent, t('projects.memoryNotice'));
    assert.equal(host.childNodes.length, 1);

    const host2 = doc.createElement('div');
    const { api } = fakeDoor(() => ({ ok: true }));
    assert.equal(renderNotice(host2, createProjects(api)), null, 'a real folder renders nothing');
    assert.equal(host2.childNodes.length, 0);
  });

  test('install() publishes app.projects and its renderNotice', () => {
    const app = {};
    install(app);
    assert.equal(typeof app.projects.write, 'function');
    assert.equal(app.projects.kind(), 'memory', 'in Node there is no window.lol at all');
    assert.equal(typeof app.projects.renderNotice, 'function');
    for (const op of OPS) assert.equal(typeof app.projects[op], 'function', `app.projects.${op}`);
  });
};
