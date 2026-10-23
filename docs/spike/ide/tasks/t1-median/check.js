// node check.js <project dir> → exit 0 when the task is done right.
const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const dir = process.argv[2]; const seed = path.join(__dirname, 'seed');
const fails = [];
if (fs.readFileSync(path.join(dir, 'stats.test.js'), 'utf8') !== fs.readFileSync(path.join(seed, 'stats.test.js'), 'utf8')) fails.push('the tests were changed');
try { execFileSync(process.execPath, ['stats.test.js'], { cwd: dir, stdio: 'pipe', timeout: 10000 }); } catch (e) { fails.push('tests fail: ' + String(e.stderr || e.message).split('\n').find((l) => /AssertionError/.test(l))); }
console.log(JSON.stringify({ pass: fails.length === 0, fails }));
process.exit(fails.length ? 1 : 0);
