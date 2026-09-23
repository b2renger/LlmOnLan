// graph/bind.mjs (K2-U2): arrow labels as named parameters, and the prompt they assemble
// (COMPUTER_PLAN §5.2 the nine rules, §5.3 the exact prompt, §5.4 the budget).
//
// COMPUTER_PLAN §11 calls this "the most important test file in the build", and the reason is
// worth writing down: everything the Computer does that costs money goes through one function,
// and a 12B local model on the LAN follows STRUCTURE far better than it follows instructions
// about structure. So what is asserted here is the structure — the headings, their order, the
// `### n` joins, what is fenced, what rides in `images`, and what the budget cuts — rather than
// any sentence a model happened to produce.
//
// One case per rule. The frozen prompt of §5.3 is asserted whole against a golden file
// (fixtures/bind/graph-b.prompt.txt), because "frozen" means a diff has to be deliberate.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  labelKey, labelName, mentions, mentionAt,
  bindInputs, bindArrivals, assemblePrompt, planFor, fanOf,
  SYSTEM, FALLBACK, INLINE_MAX,
} from '../../../renderer/chat/graph/bind.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', 'fixtures', 'bind');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

// --- tiny builders ---------------------------------------------------------------------------
// A hand-built doc, on purpose: `bindInputs` reads exactly `partById` + `wiresInto`, and building
// through model.mjs would couple this file to K2-U1's `addWire(…, {label})`.

const text = (s, o) => valueOf('text', s, o);

/** @param {{id: string, value?: any, settings?: any}[]} sources */
function doc(sources, wires, settings) {
  return {
    id: 'g1',
    rev: 1,
    parts: [
      ...sources.map((s) => ({ id: s.id, type: 'note', state: 'done', value: s.value === undefined ? null : s.value, settings: s.settings || {} })),
      { id: 'ins', type: 'ask', state: 'stale', value: null, settings: settings || {} },
    ],
    wires: wires.map((w, i) => ({ id: `w${i + 1}`, from: w.from, to: 'ins', port: 'in', label: w.label || '' })),
  };
}

/** The RUN door, from a list of [label, value] arrivals. */
const arrive = (pairs, instruction) => bindArrivals({
  values: pairs.map((p) => p[1]),
  labels: pairs.map((p) => p[0]),
  instruction,
});

const headings = (prompt) => prompt.split('\n').filter((l) => /^#{1,6} /.test(l));

export default (test) => {
  // -------------------------------------------------------------------------------------------
  // §5.1 — the two normalisations
  // -------------------------------------------------------------------------------------------

  test('§5.1 key() casefolds and collapses; name() keeps the reader\'s own spelling', () => {
    assert.equal(labelKey('  Societal   Research '), 'societal research');
    assert.equal(labelName('  Societal   Research '), 'Societal Research');
    assert.equal(labelKey(''), '');
    assert.equal(labelKey(null), '');
    assert.equal(labelName(undefined), '');
    // A 65+ character label is ACCEPTED whole: truncation is the UI's business, never the model's.
    const long = 'a'.repeat(80);
    assert.equal(labelName(long).length, 80);
  });

  // -------------------------------------------------------------------------------------------
  // §5.2 — the nine rules, one case each
  // -------------------------------------------------------------------------------------------

  test('rule 1 — an unlabelled arrow is positional: ## Input 1, ## Input 2', () => {
    const b = arrive([['', text('one')], ['', text('two')]], 'do something');
    assert.deepEqual(b.params.map((p) => p.name), ['Input 1', 'Input 2']);
    assert.ok(b.params.every((p) => p.unlabelled));
    const out = assemblePrompt(b, 'do something', {});
    assert.deepEqual(headings(out.prompt), ['# Inputs', '## Input 1', '## Input 2', '# Instruction']);
  });

  test('rule 2 — two arrows with the SAME label join into one parameter, in wire order', () => {
    const b = arrive([
      ['research', text('first')],
      ['research', text('second')],
    ], 'use the research');
    assert.equal(b.params.length, 1, 'one parameter, never two');
    assert.deepEqual(b.params[0].values.map((v) => v.data), ['first', 'second'], 'wire order, never last-wins');
    const out = assemblePrompt(b, 'use the research', {});
    assert.deepEqual(headings(out.prompt), ['# Inputs', '## research', '### 1', '### 2', '# Instruction']);
    assert.ok(out.prompt.includes('### 1\nfirst'));
    assert.ok(out.prompt.includes('### 2\nsecond'));
  });

  test('rule 2 — six reports are six sub-blocks: nothing is discarded, ever', () => {
    const six = Array.from({ length: 6 }, (_, i) => ['report', text(`body ${i + 1}`)]);
    const b = arrive(six, 'summarise the report');
    assert.equal(b.params[0].values.length, 6);
    const out = assemblePrompt(b, 'summarise the report', {});
    for (let i = 1; i <= 6; i++) assert.ok(out.prompt.includes(`### ${i}\nbody ${i}`), `sub-block ${i}`);
  });

  test('rule 3 — a duplicated label is a JOIN, never a MAP: it does not fan', () => {
    const b = arrive([['research', text('a')], ['research', text('b')]], 'x');
    // A fan would be two parameters (or two runs); a join is one parameter holding two values.
    assert.equal(b.params.length, 1);
    assert.equal(b.params[0].values.length, 2);
    assert.equal(b.params[0].unlabelled, false);
    // And a value that IS a list stays one value — bind never unwraps it either.
    const l = arrive([['items', listOf([text('x'), text('y')])]], 'x');
    assert.equal(l.params[0].values.length, 1);
    assert.equal(l.params[0].values[0].kind, 'list');
  });

  test('rule 4 — a label the instruction never mentions is still supplied, LAST, and reported', () => {
    const b = arrive([
      ['country', text('France')],
      ['topic', text('museums')],
    ], 'write about the topic');
    assert.deepEqual(b.params.map((p) => p.name), ['topic', 'country'], 'mentioned first, unmentioned after');
    assert.deepEqual(b.unused, ['country']);
    const out = assemblePrompt(b, 'write about the topic', {});
    assert.ok(out.prompt.indexOf('## topic') < out.prompt.indexOf('## country'));
    assert.ok(out.prompt.includes('France'), 'supplied, not dropped — rule 4 is a chip, not a filter');
  });

  test('rule 5 — a name mentioned with no arrow is reported and is NOT an error', () => {
    const b = arrive([['topic', text('museums')]], 'write about {topic} within {budget}');
    assert.deepEqual(b.unwired, ['budget']);
    assert.deepEqual(b.unused, []);
    const plan = planFor({ part: { id: 'ins', settings: { instruction: 'write about {topic} within {budget}' } }, bind: b });
    assert.equal(plan.error, null, 'a warning chip, never a refusal');
  });

  test('rule 6 — spaces are normal, and matching is by phrase, not by identifier', () => {
    assert.equal(mentions('take the societal research into account', 'societal research'), true);
    assert.equal(mentions('Societal  Research matters', 'societal research'), true);
    assert.equal(mentions('ask the researcher', 'research'), false, 'not inside a longer word');
    assert.equal(mentions('research2 is different', 'research'), false, 'a digit is a word character too');
    assert.equal(mentions('the research, then', 'research'), true, 'punctuation is a boundary');
    assert.equal(mentions('use {research} now', 'research'), true);
    assert.equal(mentions('use $research now', 'research'), true);
    assert.equal(mentions('nothing here', ''), false);
    // §5.1 collapses whitespace on BOTH sides of the match: a label wrapped across a line break in
    // the instruction still names its parameter.
    assert.equal(mentions('societal\nresearch says', 'societal research'), true);
  });

  test('rule 7 — labels and ports are different namespaces: every wire into the part is an arrival', () => {
    // Two wires on the SAME declared port, distinguished only by their labels.
    const d = doc(
      [{ id: 'a', value: text('alpha') }, { id: 'b', value: text('beta') }],
      [{ from: 'a', label: 'first' }, { from: 'b', label: 'second' }],
      { instruction: 'use first and second' },
    );
    const b = bindInputs(d, 'ins');
    assert.deepEqual(b.params.map((p) => p.name), ['first', 'second']);
  });

  test('rule 8 — a label that normalises to empty IS an unlabelled arrow', () => {
    const b = arrive([['   ', text('ghost')], ['topic', text('museums')]], 'about the topic');
    assert.deepEqual(b.params.map((p) => p.name), ['topic', 'Input 1']);
    assert.equal(b.params[1].unlabelled, true);
    assert.equal(b.params[1].key, '');
  });

  test('rule 9 — order is first-mention, then unmentioned in wire order, then unlabelled', () => {
    const b = arrive([
      ['country', text('France')],                 // never mentioned
      ['', text('loose')],                         // unlabelled
      ['environmental research', text('env')],     // mentioned SECOND
      ['topic', text('museums')],                  // mentioned FIRST
      ['era', text('1970s')],                      // never mentioned, after `country`
    ], 'the topic, then environmental research');
    assert.deepEqual(
      b.params.map((p) => p.name),
      ['topic', 'environmental research', 'country', 'era', 'Input 1'],
    );
  });

  // -------------------------------------------------------------------------------------------
  // §5.3 — the exact prompt
  // -------------------------------------------------------------------------------------------

  test('§5.3 — the owner\'s Graph B assembles EXACTLY the frozen prompt', () => {
    const b = arrive([
      ['topic', text('accessibility in museums for autistic persons')],
      ['societal research', text(fixture('societal.md').trimEnd(), { format: 'markdown' })],
      ['environmental research', text(fixture('environmental-1.md').trimEnd(), { format: 'markdown' })],
      ['environmental research', text(fixture('environmental-2.md').trimEnd(), { format: 'markdown' })],
      ['', text('a loose note nobody named')],
    ], INSTRUCTION);
    const out = assemblePrompt(b, INSTRUCTION, {});
    assert.equal(out.system, SYSTEM);
    assert.equal(`${out.prompt}\n`, fixture('graph-b.prompt.txt'));
  });

  test('§5.3 — the instruction is ALWAYS last, and an empty one becomes the fallback sentence', () => {
    const b = arrive([['topic', text('museums')]], '');
    const out = assemblePrompt(b, '', {});
    assert.ok(out.prompt.endsWith(`# Instruction\n${FALLBACK}`));
    assert.ok(out.prompt.indexOf('# Inputs') < out.prompt.indexOf('# Instruction'));
  });

  test('§5.3 — an EMPTY value still gets its heading, with *(empty)* beneath', () => {
    const b = arrive([['topic', text('')], ['other', text('kept')]], 'use the topic');
    const out = assemblePrompt(b, 'use the topic', {});
    assert.ok(out.prompt.includes('## topic\n*(empty)*'), out.prompt);
    assert.ok(out.prompt.includes('## other\nkept'));
  });

  test('§5.3 — {topic} and $topic are replaced by the bare word before sending', () => {
    const b = arrive([['topic', text('museums')]], 'write about {topic} and only {topic}');
    const out = assemblePrompt(b, 'write about {topic} and only {topic}', {});
    assert.ok(!out.prompt.includes('{topic}'), 'braces invite a model to echo the template');
    assert.ok(out.prompt.includes('write about topic and only topic'));

    const d = arrive([['topic', text('museums')]], 'write about $topic');
    const dollar = assemblePrompt(d, 'write about $topic', {});
    assert.ok(dollar.prompt.includes('write about topic'));
    assert.ok(!dollar.prompt.includes('$topic'));

    // A name NO arrow supplies keeps its braces: it is reported as `— not wired`, and quietly
    // un-bracing it would hide the one signal that says why the answer is missing something.
    const u = arrive([['topic', text('museums')]], 'about {topic} within {budget}');
    const kept = assemblePrompt(u, 'about {topic} within {budget}', {});
    assert.ok(kept.prompt.includes('{budget}'));
  });

  test('§5.3 — the reader\'s own casing survives into the heading', () => {
    const b = arrive([['Societal   Research', text('body')]], 'use Societal Research');
    const out = assemblePrompt(b, 'use Societal Research', {});
    assert.ok(out.prompt.includes('## Societal Research'), out.prompt);
  });

  // -------------------------------------------------------------------------------------------
  // §5.3 / §6.8 — value rendering, kind by kind and facet by facet
  // -------------------------------------------------------------------------------------------

  test('§5.3 — each kind and format renders the way the table says', () => {
    const body = (v) => {
      const out = assemblePrompt(arrive([['x', v]], 'use x'), 'use x', {});
      return out.prompt.split('## x\n')[1].split('\n\n# Instruction')[0];
    };
    assert.equal(body(text('plain words')), 'plain words');
    assert.equal(body(text('# a heading', { format: 'markdown' })), '# a heading', 'markdown is verbatim');
    assert.equal(body(valueOf('text', 'print(1)', { format: 'code', lang: 'python' })), '```python\nprint(1)\n```');
    assert.equal(body(valueOf('text', '<svg/>', { format: 'svg' })), '```svg\n<svg/>\n```');
    assert.equal(body(valueOf('text', '<p>x</p>', { format: 'html' })), '```html\n<p>x</p>\n```');
    assert.equal(body(valueOf('json', { a: 1 })), '```json\n{\n  "a": 1\n}\n```');
    assert.equal(body(listOf([text('one'), text('two')])), '- one\n- two');
    assert.equal(body(valueOf('file', { path: 'notes/a.txt', project: 'p', size: 3 })), 'notes/a.txt');
  });

  test('§5.3 — a multi-line list item keeps its bullet readable', () => {
    const out = assemblePrompt(arrive([['x', listOf([text('one\ntwo')])]], 'use x'), 'use x', {});
    assert.ok(out.prompt.includes('- one\n  two'), out.prompt);
  });

  test('§6.8 — a file with text already attached is fenced by its extension, up to 64 KB', () => {
    const small = valueOf('file', { path: 'a/b.py', text: 'print(1)' });
    const out = assemblePrompt(arrive([['x', small]], 'use x'), 'use x', {});
    assert.ok(out.prompt.includes('a/b.py\n```py\nprint(1)\n```'), out.prompt);
    const huge = valueOf('file', { path: 'a/b.py', text: 'x'.repeat(64 * 1024 + 1) });
    const big = assemblePrompt(arrive([['x', huge]], 'use x'), 'use x', {});
    assert.ok(big.prompt.includes('## x\na/b.py'));
    assert.ok(!big.prompt.includes('```'), 'over 64 KB it is a path, not a paste');
  });

  test('§5.3 — an image is NOT in the text and IS in images', () => {
    const img = valueOf('image', { dataUrl: 'data:image/jpeg;base64,AAAA', name: 'plan.jpg' });
    const out = assemblePrompt(arrive([['plan', img], ['topic', text('museums')]], 'read the plan'), 'read the plan', {});
    assert.deepEqual(out.images, ['data:image/jpeg;base64,AAAA']);
    assert.ok(!out.prompt.includes('data:image'), 'the bytes never go in the text');
    assert.ok(out.prompt.includes('## plan (image, attached)'), out.prompt);
  });

  test('§5.3 — an image-only graph still has a prompt: the fallback sentence', () => {
    const img = valueOf('image', { dataUrl: 'data:image/png;base64,BBBB', name: 'x.png' });
    const out = assemblePrompt(arrive([['plan', img]], ''), '', {});
    assert.equal(out.images.length, 1);
    assert.ok(out.prompt.includes(FALLBACK));
  });

  // -------------------------------------------------------------------------------------------
  // §5.3 — inline substitution (opt-in, default off)
  // -------------------------------------------------------------------------------------------

  test('§5.3 — inline OFF is the default: the value stays under its heading', () => {
    const b = arrive([['topic', text('museums')]], 'write about the topic');
    const out = assemblePrompt(b, 'write about the topic', {});
    assert.ok(out.prompt.includes('## topic\nmuseums'));
    assert.ok(out.prompt.includes('write about the topic'));
  });

  test('§5.3 — inline ON substitutes a short text value in place and does NOT repeat it', () => {
    const say = 'write about topic using report';
    const b = arrive([['topic', text('museums')], ['report', text('a long report')]], say);
    const out = assemblePrompt(b, say, { inline: true });
    assert.ok(out.prompt.includes('write about museums using a long report'), out.prompt);
    assert.ok(!out.prompt.includes('## topic'), 'substituted in place means not repeated');
    assert.ok(!out.prompt.includes('## report'));
    assert.ok(!out.prompt.includes('# Inputs'), 'nothing left to head');
  });

  test('§5.3 — inline ON substitutes a BARE phrase too, article and all: the plan says in place', () => {
    // Pinned deliberately. "write about the topic" becomes "write about the museums", which reads
    // oddly and is still the plan's rule: the owner's own labels are phrases, not `{braces}`, and
    // a toggle that silently did nothing for them would be worse than an article out of place.
    const say = 'write about the topic';
    const out = assemblePrompt(arrive([['topic', text('museums')]], say), say, { inline: true });
    assert.equal(out.prompt, '# Instruction\nwrite about the museums');
  });

  test('§5.3 — inline ON leaves a LONG value under its heading', () => {
    const long = 'x'.repeat(INLINE_MAX + 1);
    const b = arrive([['report', text(long)]], 'summarise the report');
    const out = assemblePrompt(b, 'summarise the report', { inline: true });
    assert.ok(out.prompt.includes('## report'), 'over 200 characters it stays where it can be seen');
    assert.ok(out.prompt.includes('summarise the report'), 'and its name is still in the instruction');
  });

  test('§5.3 — inline ON never substitutes an unmentioned label, an image or a join', () => {
    const img = valueOf('image', { dataUrl: 'data:image/png;base64,CCCC', name: 'x.png' });
    const b = arrive([
      ['country', text('France')],                         // not mentioned: nowhere to put it
      ['plan', img],                                       // an image is never text
      ['research', text('a')], ['research', text('b')],     // a join is two values
    ], 'use the plan and the research');
    const out = assemblePrompt(b, 'use the plan and the research', { inline: true });
    assert.ok(out.prompt.includes('## country'));
    assert.ok(out.prompt.includes('## plan (image, attached)'));
    assert.ok(out.prompt.includes('## research'));
    assert.equal(out.images.length, 1);
  });

  // -------------------------------------------------------------------------------------------
  // §5.4 — the budget
  // -------------------------------------------------------------------------------------------

  test('§5.4 — under budget, nothing is cut and `truncated` is null', () => {
    const out = assemblePrompt(arrive([['x', text('short')]], 'use x'), 'use x', { budget: 10000 });
    assert.equal(out.truncated, null);
    assert.ok(out.prompt.includes('short'));
  });

  test('§5.4 — over budget: middle-out per input, marked inline, and it FITS', () => {
    const big = 'A'.repeat(4000) + 'MIDDLE' + 'Z'.repeat(4000);
    const b = arrive([['report', text(big)]], 'summarise the report');
    const out = assemblePrompt(b, 'summarise the report', { budget: 1200 });
    assert.ok(out.truncated, 'the badge has numbers to show');
    assert.ok(out.prompt.length <= 1200, `assembled ${out.prompt.length} characters into a 1200 budget`);
    assert.ok(out.prompt.includes('## report'), 'the heading ALWAYS survives');
    assert.ok(out.prompt.startsWith('# Inputs'));
    assert.ok(out.prompt.includes('characters omitted'), 'the cut is marked where it happened');
    assert.ok(out.prompt.includes('AAA') && out.prompt.includes('ZZZ'), 'middle-out keeps both ends');
    assert.ok(!out.prompt.includes('MIDDLE'), 'and the middle is what went');
    assert.equal(out.truncated.of, 8006 + '# Inputs\n\n## report\n\n\n# Instruction\nsummarise the report'.length);
    assert.equal(out.truncated.params.length, 1);
    assert.equal(out.truncated.params[0].name, 'report');
    // `cut` is MEASURED, not intended (fix pass, finding 3): the prompt as it was, minus the
    // prompt as it is. It differs from the block's `omitted` by exactly the marker that replaced
    // the omission, and the badge that prints it is now printing a fact.
    assert.equal(out.truncated.cut, out.truncated.of - out.prompt.length);
    assert.ok(out.truncated.cut < out.truncated.params[0].omitted);
  });

  test('§5.4 — the cut is PROPORTIONAL: a big input loses more than a small one, and neither is dropped', () => {
    const b = arrive([
      ['big', text('B'.repeat(9000))],
      ['small', text('s'.repeat(1000))],
    ], 'use big and small');
    const out = assemblePrompt(b, 'use big and small', { budget: 2000 });
    assert.ok(out.prompt.length <= 2000);
    const cut = Object.fromEntries(out.truncated.params.map((p) => [p.name, p.omitted]));
    assert.ok(cut.big > cut.small, `big lost ${cut.big}, small lost ${cut.small}`);
    assert.ok(out.prompt.includes('## big') && out.prompt.includes('## small'), 'never a silently dropped input');
    // Proportional means the SURVIVORS are in roughly the original ratio, not equal shares.
    const kept = (name) => (9000 + 1000) && out.prompt.split(`## ${name}\n`)[1].split('\n\n')[0].length;
    assert.ok(kept('big') > kept('small'), 'the bigger input keeps the bigger share');
  });

  test('§5.4 — a budget so small that only the headings fit still names every input', () => {
    const b = arrive([['a', text('x'.repeat(500))], ['b', text('y'.repeat(500))]], 'go');
    const out = assemblePrompt(b, 'go', { budget: 80 });
    assert.ok(out.prompt.includes('## a') && out.prompt.includes('## b'));
    assert.equal(out.truncated.params.length, 2);
    assert.ok(out.truncated.cut >= 900);
  });

  // The three cases that used to make `trim()` produce a LONGER prompt than it was given (fix
  // pass, finding 3): the marker costs ~25 characters however short the block was, so cutting a
  // ten-character note used to grow it, and a prompt of many small inputs came back bigger AND
  // still over budget, with a `cut` number the badge printed as fact.
  test('§5.4 — cutting never makes the prompt LONGER: many tiny inputs, a tiny budget', () => {
    const pairs = [];
    for (let i = 0; i < 12; i++) pairs.push([`p${i}`, text('ab')]);
    const b = arrive(pairs, 'x'.repeat(300));
    const whole = assemblePrompt(b, 'x'.repeat(300), {});
    const out = assemblePrompt(b, 'x'.repeat(300), { budget: 200 });
    assert.ok(out.prompt.length <= whole.prompt.length,
      `cutting grew the prompt: ${whole.prompt.length} -> ${out.prompt.length}`);
    // Nothing could be cut — every body is shorter than the marker that would replace it — so
    // there is no badge to show. A badge reading `0 characters cut` would be a lie of a kind.
    assert.equal(out.truncated, null);
    for (let i = 0; i < 12; i++) assert.ok(out.prompt.includes(`## p${i}\nab`), `p${i} is intact`);
  });

  test('§5.4 — a mixed prompt FITS its budget, and the cut lands on the block that is big', () => {
    const b = arrive([
      ['note', text('a short note')],
      ['code', text('C'.repeat(4000), { format: 'code', lang: 'js' })],
      ['tag', text('x')],
    ], 'use the note, the code and the tag');
    const out = assemblePrompt(b, 'use the note, the code and the tag', { budget: 600 });
    assert.ok(out.prompt.length <= 600, `assembled ${out.prompt.length} into a 600 budget`);
    assert.ok(out.prompt.includes('a short note'), 'the small note is left exactly as it was');
    assert.ok(out.prompt.includes('## tag\nx'));
    assert.deepEqual(out.truncated.params.map((q) => q.name), ['code'], 'only the big one paid');
    assert.equal(out.truncated.cut, out.truncated.of - out.prompt.length);
  });

  test('§5.4 — when only the headings fit, the prompt still never grows and the badge is honest', () => {
    const b = arrive([['a', text('x'.repeat(500))], ['b', text('y'.repeat(500))]], 'go');
    const whole = assemblePrompt(b, 'go', {});
    const out = assemblePrompt(b, 'go', { budget: 80 });
    assert.ok(out.prompt.length < whole.prompt.length);
    assert.equal(out.truncated.cut, out.truncated.of - out.prompt.length);
    assert.equal(out.truncated.of, whole.prompt.length);
  });

  test('§5.4 — a budget of 0 or nonsense means "do not cut", never "cut everything"', () => {
    const b = arrive([['x', text('x'.repeat(5000))]], 'go');
    for (const budget of [0, -1, NaN, undefined, null]) {
      const out = assemblePrompt(b, 'go', { budget });
      assert.equal(out.truncated, null, `budget ${String(budget)}`);
      assert.ok(out.prompt.length > 5000);
    }
  });

  // -------------------------------------------------------------------------------------------
  // The two doors, and the identity that makes §8.1 true
  // -------------------------------------------------------------------------------------------

  test('§8.1 — the PRE-RUN door names an upstream that has not run yet, and does not invent a value', () => {
    const d = doc(
      [{ id: 'a', value: text('ready') }, { id: 'b' }],
      [{ from: 'a', label: 'topic' }, { from: 'b', label: 'research' }],
      { instruction: 'use the topic and the research' },
    );
    const b = bindInputs(d, 'ins');
    assert.deepEqual(b.params.map((p) => p.name), ['topic', 'research']);
    assert.equal(b.params[1].pending, true);
    assert.equal(b.params[1].values.length, 0);
    const out = assemblePrompt(b, 'use the topic and the research', {});
    assert.ok(out.prompt.includes('## research\n⟨research — has not run yet⟩'), out.prompt);
  });

  // -------------------------------------------------------------------------------------------
  // The BLOCKS — the structure the transcript reads instead of re-parsing the bytes
  // -------------------------------------------------------------------------------------------

  test('§5.3 — the assembly reports the blocks it built, one per parameter, with its own param', () => {
    const b = arrive([
      ['topic', text('museums')],
      ['notes', text('# Instruction\n## Findings\nbody', { format: 'markdown' })],
    ], 'write about the topic using the notes');
    const out = assemblePrompt(b, 'write about the topic using the notes', {});
    assert.deepEqual(out.blocks.map((x) => x.name), ['topic', 'notes'],
      'TWO blocks — a `##` heading inside the reader\'s own note is text, not structure');
    assert.equal(out.blocks[1].body, '# Instruction\n## Findings\nbody',
      'and the body is the value VERBATIM, headings and all');
    assert.equal(out.blocks[0].param, b.params[0], 'each block carries the parameter it came from');
    assert.equal(out.blocks[1].param, b.params[1]);
    assert.equal(out.instruction, 'write about the topic using the notes');
  });

  test('§5.3 — an image block is named `(image, attached)`, and an inlined one has no block at all', () => {
    const img = valueOf('image', { dataUrl: 'data:image/png;base64,AAAA', name: 'p.png' });
    const b = arrive([['photo', img], ['topic', text('museums')]], 'describe the photo about the topic');
    const out = assemblePrompt(b, 'describe the photo about the topic', { inline: true });
    assert.deepEqual(out.blocks.map((x) => x.name), ['photo (image, attached)'],
      'the short text was substituted in place, so it is not under # Inputs any more');
    assert.equal(out.blocks[0].param.values[0].kind, 'image', 'the tint comes from the right value');
  });

  test('§5.3 — the blocks are the CUT bodies, so what is read is what is sent', () => {
    const b = arrive([['report', text('A'.repeat(4000))]], 'summarise the report');
    const out = assemblePrompt(b, 'summarise the report', { budget: 900 });
    assert.equal(out.blocks.length, 1);
    assert.ok(out.prompt.includes(out.blocks[0].body), 'the block IS the text in the prompt');
    assert.ok(out.blocks[0].body.includes('characters omitted'));
  });

  // -------------------------------------------------------------------------------------------
  // §4.7 — the fan the runner will plan, seen before it runs
  // -------------------------------------------------------------------------------------------

  test('§4.7 — a list at the port is N generations: the plan assembles generation 1 and says so', () => {
    const items = listOf([text('alpha'), text('beta'), text('gamma')]);
    const d = doc([{ id: 'a', value: items }], [{ from: 'a', label: 'item' }], { instruction: 'translate the item' });
    const plan = planFor({ part: d.parts[1], bind: bindInputs(d, 'ins'), budget: { chars: 0, tokens: 0, assumed: true } });
    assert.deepEqual(plan.fan, { n: 3, index: 0 });
    assert.ok(plan.assembled.prompt.includes('## item\nalpha'),
      `generation 1 sends ONE item, not the whole list:\n${plan.assembled.prompt}`);
    assert.equal(plan.assembled.prompt.includes('beta'), false);
    // and the RUN door, which is handed one item, agrees with it byte for byte.
    const run = planFor({
      part: d.parts[1],
      bind: bindArrivals({ values: [text('alpha')], labels: ['item'], instruction: 'translate the item' }),
      budget: { chars: 0, tokens: 0, assumed: true },
    });
    assert.equal(run.fan, null, 'the run door is past the fan and must never fan again');
    assert.equal(run.assembled.prompt, plan.assembled.prompt);
  });

  test('§4.7 — no fan to show: no list, two lists (the runner refuses), an empty list', () => {
    const one = listOf([text('a')]);
    assert.equal(fanOf([{ values: [text('x')] }]), null, 'nothing fans');
    assert.equal(fanOf([{ values: [one] }, { values: [listOf([text('b')])] }]), null,
      'two lists is the runner\'s refusal — there is no generation 1 to preview');
    assert.equal(fanOf([{ values: [listOf([])] }]), null, 'an empty list runs zero times');
    assert.deepEqual(fanOf([{ values: [text('x')] }, { values: [one] }]), { param: 1, at: 0, n: 1 });
  });

  test('§8.1 — the two doors agree: the same arrivals assemble the same prompt', () => {
    const d = doc(
      [{ id: 'a', value: text('museums') }, { id: 'b', value: text('body') }, { id: 'c', value: text('loose') }],
      [{ from: 'a', label: 'topic' }, { from: 'b', label: 'societal research' }, { from: 'c', label: '' }],
      { instruction: 'about the topic and the societal research' },
    );
    const fromDoc = bindInputs(d, 'ins');
    const fromRun = arrive(
      [['topic', text('museums')], ['societal research', text('body')], ['', text('loose')]],
      'about the topic and the societal research',
    );
    const a = assemblePrompt(fromDoc, 'about the topic and the societal research', { budget: 5000 });
    const c = assemblePrompt(fromRun, 'about the topic and the societal research', { budget: 5000 });
    assert.equal(a.prompt, c.prompt);
    assert.equal(a.system, c.system);
    assert.deepEqual(a.images, c.images);
  });

  test('bindInputs on a missing part is empty, not a throw', () => {
    assert.deepEqual(bindInputs(doc([], [], {}), 'nope'), { params: [], unused: [], unwired: [] });
    assert.deepEqual(bindInputs(null, 'ins'), { params: [], unused: [], unwired: [] });
  });

  test('mentionAt is the ORDERING key: it answers the index of the FIRST mention', () => {
    const s = 'first the environmental research, then the societal research';
    assert.equal(mentionAt(s, 'environmental research') < mentionAt(s, 'societal research'), true);
    assert.equal(mentionAt(s, 'nothing'), -1);
    assert.equal(mentionAt('{topic} and topic', 'topic'), 0, 'the braced form counts, and it is first');
  });

  // -------------------------------------------------------------------------------------------
  // planFor — what the part will send, assembled once
  // -------------------------------------------------------------------------------------------

  test('planFor carries the call the part will really make', () => {
    const part = { id: 'ins', settings: { instruction: 'go', shape: 'json', schema: '{"type":"object"}', model: 'gemma4:12b' } };
    const plan = planFor({ part, bind: arrive([['x', text('v')]], 'go'), budget: { chars: 9999, tokens: 2777, assumed: false } });
    assert.equal(plan.call.shape, 'json');
    assert.equal(plan.call.schema, '{"type":"object"}');
    assert.equal(plan.call.model, 'gemma4:12b');
    assert.equal(plan.call.priority, 'background', 'a human typing always takes the seat first');
    assert.equal(plan.call.maxTokens, null);
    assert.equal(plan.error, null);
    assert.equal(plan.fallback, false);
    assert.equal(plan.assembled.system, SYSTEM);
  });

  test('planFor: no instruction AND no inputs is the one real error; no instruction alone is the fallback', () => {
    const empty = planFor({ part: { id: 'ins', settings: {} }, bind: { params: [], unused: [], unwired: [] } });
    assert.equal(empty.error, 'no-instruction');
    const only = planFor({ part: { id: 'ins', settings: {} }, bind: arrive([['x', text('v')]], '') });
    assert.equal(only.error, null);
    assert.equal(only.fallback, true);
    assert.ok(only.assembled.prompt.includes(FALLBACK));
  });

  test('planFor reads the inline toggle off the part, and the budget off its argument', () => {
    const part = { id: 'ins', settings: { instruction: 'about topic', inlineVars: true } };
    const bind = arrive([['topic', text('museums')]], 'about topic');
    const on = planFor({ part, bind, budget: { chars: 5000, tokens: 1388, assumed: true } });
    assert.ok(on.assembled.prompt.includes('about museums'));
    const off = planFor({ part: { ...part, settings: { ...part.settings, inlineVars: false } }, bind });
    assert.ok(off.assembled.prompt.includes('## topic'));
    assert.equal(on.budget.assumed, true, 'the badge must be able to say "assumed"');
  });
};

/** The instruction of the §5.3 worked example — the owner's own Graph B, in miniature. */
const INSTRUCTION = 'write a problematic about the topic taking into account: societal research, '
  + 'environmental research';
