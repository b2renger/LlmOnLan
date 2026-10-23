// node check.js <project dir> → wordfreq.js exists, the test file is unchanged and passes.
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const dir = process.argv[2];
const fails = [];
if (fs.readFileSync(path.join(dir, 'wordfreq.test.js'), 'utf8') !== fs.readFileSync(path.join(__dirname, 'seed', 'wordfreq.test.js'), 'utf8')) fails.push('the tests were changed');
if (!fs.existsSync(path.join(dir, 'wordfreq.js'))) fails.push('no wordfreq.js');
const r = spawnSync(process.execPath, ['wordfreq.test.js'], { cwd: dir, encoding: 'utf8', timeout: 10000 });
if (r.status !== 0) fails.push('tests fail: ' + (String(r.stderr).split('\n').find((l) => /AssertionError|Error/.test(l)) || '').trim().slice(0, 200));
console.log(JSON.stringify({ pass: fails.length === 0, fails }));
process.exit(fails.length ? 1 : 0);
