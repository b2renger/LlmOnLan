// node check.js <project dir> → the agent's slugify.test.js passes on the real slugify.js, has ≥ 6 checks, and
// catches the mutants (each a copy of slugify.js with one behaviour broken).
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const os = require('os');
const dir = process.argv[2];
const fails = [];
const testFile = path.join(dir, 'slugify.test.js');
const seedSrc = fs.readFileSync(path.join(__dirname, 'seed', 'slugify.js'), 'utf8');
if (!fs.existsSync(testFile)) { console.log(JSON.stringify({ pass: false, fails: ['no slugify.test.js'] })); process.exit(1); }
if (fs.readFileSync(path.join(dir, 'slugify.js'), 'utf8') !== seedSrc) fails.push('slugify.js was changed');
const tests = fs.readFileSync(testFile, 'utf8');
// Any assertion call: assert.equal(, strict.equal(, a bare strictEqual( after destructuring, assert(.
const nChecks = (tests.match(/\b(?:\w+\.)?(?:strictEqual|deepStrictEqual|equal|deepEqual|notEqual|notStrictEqual|notDeepStrictEqual|ok|throws|doesNotThrow|match|doesNotMatch|rejects)\s*\(|\bassert\s*\(/g) || []).length;
const nTests = (tests.match(/\b(test|it)\s*\(/g) || []).length;
if (nChecks < 6) fails.push(`only ${nChecks} assertions`);
const runIn = (src) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 't3-'));
    fs.writeFileSync(path.join(d, 'slugify.js'), src);
    fs.copyFileSync(testFile, path.join(d, 'slugify.test.js'));
    const r = spawnSync(process.execPath, ['--test', 'slugify.test.js'], { cwd: d, encoding: 'utf8', timeout: 20000 });
    fs.rmSync(d, { recursive: true, force: true });
    return r.status === 0;
};
if (!runIn(seedSrc)) fails.push('the tests fail on the real slugify.js');
const mutants = {
    'no lowercase': seedSrc.replace('.toLowerCase()', ''),
    'accents kept': seedSrc.replace(".replace(/\\p{Diacritic}/gu, '')", ''),
    'no trimming': seedSrc.replace('while (s.startsWith(sep)) s = s.slice(sep.length);', '').replace('while (s.endsWith(sep)) s = s.slice(0, -sep.length);\n    if', 'if'),
    'separator option ignored': seedSrc.replace("options.separator ?? '-'", "'-'"),
    'maxLength ignored': seedSrc.replace('if (s.length > maxLength) {', 'if (false) {'),
};
const caught = [];
for (const [name, src] of Object.entries(mutants)) {
    if (src === seedSrc) { fails.push(`mutant "${name}" did not apply`); continue; }
    if (!runIn(src)) caught.push(name);
}
const missed = Object.keys(mutants).filter((n) => !caught.includes(n));
if (caught.length < 4) fails.push(`caught ${caught.length}/5 mutants (missed: ${missed.join(', ')})`);
console.log(JSON.stringify({ pass: fails.length === 0, fails, nTests, nChecks, caught: `${caught.length}/5`, missed }));
process.exit(fails.length ? 1 : 0);
