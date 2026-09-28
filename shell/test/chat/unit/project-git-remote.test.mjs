// @ts-check
// The IDE's push and pull (src/main/projectGit.ts) against a REAL git server on loopback — `git http-backend` behind a
// few lines of Node that demand the token as Basic auth, the way GitHub does — never GitHub itself. Skipped when this
// machine has no Git (the app itself never needs one: isomorphic-git).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'build', 'main');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `lol-remote-${name}-`));
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const CRLF2 = Buffer.from([13, 10, 13, 10]);
const LF2 = Buffer.from([10, 10]);

/** Smart HTTP over `git http-backend` (CGI), with a token check. @param {string} root @param {string} token */
function gitServer(root, token) {
  const want = `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  return http.createServer((req, res) => {
    if (req.headers.authorization !== want) { res.writeHead(401, { 'www-authenticate': 'Basic realm="test"' }).end(); return; }
    const u = new URL(req.url || '/', 'http://x');
    const child = spawn('git', ['http-backend'], {
      env: {
        ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: u.pathname, REQUEST_METHOD: req.method,
        QUERY_STRING: u.search.slice(1), CONTENT_TYPE: String(req.headers['content-type'] || ''), REMOTE_USER: 'tester', REMOTE_ADDR: '127.0.0.1',
      },
    });
    req.pipe(child.stdin);
    let head = Buffer.alloc(0);
    let started = false;
    child.stdout.on('data', (chunk) => {
      if (started) { res.write(chunk); return; }
      head = Buffer.concat([head, chunk]);
      let at = head.indexOf(CRLF2);
      let sep = 4;
      if (at < 0) { at = head.indexOf(LF2); sep = 2; }
      if (at < 0) return;
      /** @type {Record<string, string>} */ const headers = {};
      let status = 200;
      for (const line of head.subarray(0, at).toString('utf8').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i < 0) continue;
        const k = line.slice(0, i).trim().toLowerCase();
        const v = line.slice(i + 1).trim();
        if (k === 'status') status = parseInt(v, 10); else headers[k] = v;
      }
      res.writeHead(status, headers);
      res.write(head.subarray(at + sep));
      started = true;
    });
    child.stdout.on('end', () => res.end());
  });
}

export default (test) => {
  /** @type {any} */ const G = require(path.join(BUILD, 'projectGit.js'));

  (HAS_GIT ? test : test.skip)('project git remote: push with the token, a wrong token refused; pull fast-forwards and refuses a split', async () => {
    const root = tmp('server');
    spawnSync('git', ['init', '--bare', '-b', 'main', path.join(root, 'site.git')]);
    const server = gitServer(root, 'good-token');
    await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
    const url = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/site.git`;
    try {
      const a = tmp('a');
      fs.writeFileSync(path.join(a, 'index.html'), '<h1>v1</h1>');
      await G.commitAll(a, 'Agent: v1', G.AGENT);
      await G.setRemote(a, url);
      assert.equal(await G.getRemote(a), url);
      await assert.rejects(G.push(a, 'wrong-token'), 'a wrong token is refused, never retried');
      await assert.rejects(G.push(a, null), 'no token, no push');
      await G.push(a, 'good-token');
      const onServer = spawnSync('git', ['--git-dir', path.join(root, 'site.git'), 'log', '--format=%s', 'main'], { encoding: 'utf8' }).stdout.trim();
      assert.equal(onServer, 'Agent: v1', 'the commit is on the server');

      // An empty project takes the remote's work.
      const b = tmp('b');
      await G.setRemote(b, url);
      await G.pull(b, 'good-token');
      assert.equal(fs.readFileSync(path.join(b, 'index.html'), 'utf8'), '<h1>v1</h1>');

      // A newer commit from `a` fast-forwards `b`; `b`'s own uncommitted edit is committed first, so the pull is a
      // split history and is refused — nothing is lost.
      fs.writeFileSync(path.join(a, 'index.html'), '<h1>v2</h1>');
      await G.commitAll(a, 'Agent: v2', G.AGENT);
      await G.push(a, 'good-token');
      await G.pull(b, 'good-token');
      assert.equal(fs.readFileSync(path.join(b, 'index.html'), 'utf8'), '<h1>v2</h1>', 'fast-forwarded');
      fs.writeFileSync(path.join(a, 'index.html'), '<h1>v3 from a</h1>');
      await G.push(a, 'good-token');   // push commits the edit first ("You: before pushing")
      fs.writeFileSync(path.join(b, 'index.html'), '<h1>my own edit in b</h1>');
      await assert.rejects(G.pull(b, 'good-token'), 'a split history is refused (fast-forward only)');
      assert.equal(fs.readFileSync(path.join(b, 'index.html'), 'utf8'), '<h1>my own edit in b</h1>', 'b keeps its edit');
      assert.equal((await G.history(b))[0].message, 'You: before pulling', 'and it is committed');
    } finally {
      server.close();
    }
  });
};
