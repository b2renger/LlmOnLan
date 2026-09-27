// Generates the six perf fixtures next to this file. Deterministic (seeded mulberry32), so a
// regenerated fixture is byte-identical and the committed files stay stable.
//
//   node shell/test/chat/fixtures/md/perf/gen.mjs
//
// The shapes are what a farm model really streams, not synthetic worst cases: prose paragraphs are
// UNWRAPPED (one long line each), because that is how a model emits them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ('the farm serves one model at a time so every seat matters when a workshop starts and '
  + 'the context window is shared across slots which means a long document can push an older turn '
  + 'out of the request unless the budget gate stops it first and asks you to trim or pin something')
  .split(' ');

function sentence(rnd, min, max) {
  const n = min + Math.floor(rnd() * (max - min));
  const out = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(rnd() * WORDS.length)]);
  out[0] = out[0][0].toUpperCase() + out[0].slice(1);
  return out.join(' ') + '.';
}

function paragraph(rnd, chars) {
  let s = '';
  while (s.length < chars) s += (s ? ' ' : '') + sentence(rnd, 8, 20);
  return s;
}

function inlineSpice(rnd, s) {
  const words = s.split(' ');
  for (let i = 3; i < words.length; i += 11 + Math.floor(rnd() * 7)) {
    const pick = rnd();
    if (pick < 0.3) words[i] = '**' + words[i] + '**';
    else if (pick < 0.55) words[i] = '`' + words[i] + '`';
    else if (pick < 0.75) words[i] = '*' + words[i] + '*';
    else if (pick < 0.85) words[i] = '[' + words[i] + '](https://example.com/' + i + ')';
    else words[i] = words[i] + ' https://example.com/x' + i;
  }
  return words.join(' ');
}

function write(name, text) {
  const file = path.join(DIR, name + '.md');
  fs.writeFileSync(file, text.replace(/\r\n/g, '\n'), 'utf8');
  console.log(name.padEnd(16), text.length, 'chars');
}

// ---- mixed: a realistic assistant answer, every block type ------------------------------------
{
  const rnd = mulberry32(1001);
  const out = ['# Answer', ''];
  for (let s = 0; s < 6; s++) {
    out.push('## Section ' + (s + 1), '');
    out.push(inlineSpice(rnd, paragraph(rnd, 400 + Math.floor(rnd() * 500))), '');
    out.push('- ' + sentence(rnd, 6, 14));
    out.push('- ' + sentence(rnd, 6, 14));
    out.push('  - ' + sentence(rnd, 5, 10));
    out.push('- [ ] ' + sentence(rnd, 4, 9));
    out.push('');
    out.push('```python');
    for (let i = 0; i < 12; i++) out.push('    value_' + i + ' = compute(' + i + ')  # ' + sentence(rnd, 3, 7));
    out.push('```', '');
    out.push('| name | value | note |');
    out.push('|------|------:|:----:|');
    for (let i = 0; i < 6; i++) out.push('| row ' + i + ' | ' + i * 37 + ' | ' + sentence(rnd, 2, 5) + ' |');
    out.push('');
    out.push('> ' + sentence(rnd, 10, 20));
    out.push('');
  }
  write('mixed', out.join('\n') + '\n');
}

// ---- list-500 ---------------------------------------------------------------------------------
{
  const rnd = mulberry32(2002);
  const out = ['# A long list', ''];
  for (let i = 0; i < 500; i++) {
    out.push('- item ' + (i + 1) + ': ' + sentence(rnd, 6, 16));
    if (i % 7 === 3) out.push('  - ' + sentence(rnd, 4, 10));
  }
  out.push('');
  write('list-500', out.join('\n') + '\n');
}

// ---- table-300 --------------------------------------------------------------------------------
{
  const rnd = mulberry32(3003);
  const out = ['# A long table', '', '| n | name | value | note |', '|--:|------|------:|:-----|'];
  for (let i = 0; i < 300; i++) {
    out.push('| ' + i + ' | row ' + i + ' | ' + Math.floor(rnd() * 100000) + ' | ' + sentence(rnd, 3, 8) + ' |');
  }
  out.push('');
  write('table-300', out.join('\n') + '\n');
}

// ---- paragraph-20k: unwrapped prose, one long line per paragraph -------------------------------
{
  const rnd = mulberry32(4004);
  const out = [];
  let total = 0;
  while (total < 20000) {
    const p = inlineSpice(rnd, paragraph(rnd, 500 + Math.floor(rnd() * 900)));
    out.push(p, '');
    total += p.length + 2;
  }
  write('paragraph-20k', out.join('\n'));
}

// ---- nested-fence: fences in list items, in quotes, with inner backticks ------------------------
{
  const rnd = mulberry32(5005);
  const out = ['# Fences', ''];
  for (let i = 0; i < 20; i++) {
    out.push(sentence(rnd, 10, 20), '');
    out.push('- step ' + (i + 1));
    out.push('  ```bash');
    out.push('  lol up --config lol.config.json  # ' + sentence(rnd, 3, 6));
    out.push('');
    out.push('  echo "a blank line inside the fence does not end the item"');
    out.push('  ```');
    out.push('- after the fence', '');
    out.push('> ' + sentence(rnd, 6, 12));
    out.push('');
    out.push('````markdown');
    out.push('```js');
    out.push('const nested = "a fence inside a fence";');
    out.push('```');
    out.push('````', '');
    out.push('```svg');
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="' + (4 + i) + '"/></svg>');
    out.push('```', '');
  }
  write('nested-fence', out.join('\n'));
}

// ---- reasoning-40k: plain reasoning text (rendered as text, never markdown) ---------------------
{
  const rnd = mulberry32(6006);
  const out = [];
  let total = 0;
  while (total < 40000) {
    const p = paragraph(rnd, 300 + Math.floor(rnd() * 700));
    out.push(p, '');
    total += p.length + 2;
  }
  write('reasoning-40k', out.join('\n'));
}
