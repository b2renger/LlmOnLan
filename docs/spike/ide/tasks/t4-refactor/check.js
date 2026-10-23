// node check.js <project dir> → money.js holds the two helpers, cart.js and invoice.js import them, check.js passes.
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const dir = process.argv[2];
const fails = [];
const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } };
if (read('check.js') !== fs.readFileSync(path.join(__dirname, 'seed', 'check.js'), 'utf8')) fails.push('check.js was changed');
const money = read('money.js');
if (!money) fails.push('no money.js');
else {
    try {
        const m = require(path.join(dir, 'money.js'));
        if (typeof m.computeTax !== 'function' || typeof m.formatMoney !== 'function') fails.push('money.js does not export computeTax and formatMoney');
        else if (m.computeTax(1847, 20) !== 369 || m.formatMoney(123456) !== '1,234.56 EUR') fails.push('money.js helpers behave differently');
    } catch (e) { fails.push('money.js throws: ' + e.message); }
}
const defines = /function\s+(computeTax|formatMoney)\b|(const|let|var)\s+(computeTax|formatMoney)\s*=\s*(\(|function|[a-zA-Z_]+\s*=>)/;
for (const f of ['cart.js', 'invoice.js']) {
    const s = read(f) || '';
    if (defines.test(s)) fails.push(`${f} still defines a helper`);
    if (!/require\(\s*['"]\.\/money(\.js)?['"]\s*\)|from\s+['"]\.\/money(\.js)?['"]/.test(s)) fails.push(`${f} does not import ./money`);
}
const r = spawnSync(process.execPath, ['check.js'], { cwd: dir, encoding: 'utf8', timeout: 10000 });
if (r.status !== 0) fails.push('node check.js fails: ' + String(r.stderr).split('\n').find((l) => /Error/.test(l)));
console.log(JSON.stringify({ pass: fails.length === 0, fails }));
process.exit(fails.length ? 1 : 0);
