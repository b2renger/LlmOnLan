// K5-U4 (COMPUTER_PLAN §10; addendum KE-4, KE-5): the lessons and templates this build ships.
//
// A lesson is a program that must OPEN, must be WALKABLE and must never pre-tick: every test
// below drives the real model (graph/model.mjs) the way the canvas does — the same setSettings /
// addWire / setWireLabel / addPart a person's gestures end in, and patchPart for what a run
// writes — and asks the real checker (computer/tutorial/check.mjs) after each action. Each lesson
// is walked TWICE: with the farm answering, and with the farm absent, where every generation is
// replaced by the lesson's saved answer (the rail's "Continue with the saved answer?" writes
// exactly `{value, state:'done', error:null, demo:true}`, KE-6/KE-7). §10.2: the harness — here,
// Node — walks every lesson in demo mode and asserts every checkpoint can be satisfied.
import assert from 'node:assert/strict';

import { LESSONS, TEMPLATES, lessonById, templateById } from '../../../renderer/chat/computer/tutorial/registry.mjs';
import { evaluate, advance, tickManual, freshProgress, refsOf } from '../../../renderer/chat/computer/tutorial/check.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { creativePresets, presetOf } from '../../../renderer/chat/graph/parts/creative.mjs';
import { normaliseDoc, addPart, addWire, setSettings, setWireLabel, patchPart, partById } from '../../../renderer/chat/graph/model.mjs';
import { toJson, fromJson } from '../../../renderer/chat/graph/serialize.mjs';
import { bindInputs, mentions, labelKey, planFor } from '../../../renderer/chat/graph/bind.mjs';
import { isValue } from '../../../renderer/chat/graph/values.mjs';
import { unfence, codeValue } from '../../../renderer/chat/graph/unfence.mjs';
import { reportOf } from '../../../renderer/chat/graph/parts/agent.mjs';
import { parseLink } from '../../../renderer/chat/graph/parts/opendata.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import '../../../renderer/chat/strings/lessons.en.mjs';

const SPECS = specMap();
const PRESETS = new Map(creativePresets().map((p) => [p.id, p]));
const MINE = ['l01-hello-farm', 'l02-wires', 'l03-labels', 'l04-draw', 'l05-code-counts', 'l06-a-loop-that-stops',
  'l07-listen-and-speak', 'l08-a-picture-to-a-model', 'l09-act-on-the-world', 'l10-hear-the-world', 'l11-an-agent-with-tools', 'l12-open-data'];

/** The ONE rail-shaped corner of the canvas (COMPUTER_PLAN §10.1 mechanism 2: bottom-left,
 * ~300 px), in screen px, and the canvas the harness window gives the Computer (1280×860 minus
 * the sidebar and the run bar). A lesson is authored so the rail never covers a box a step is
 * about, and so it opens framed. */
const RAIL = { w: 330, top: 400 };
const CANVAS = { w: 1000, h: 705 };

let seq = 0;
const newId = () => `u${++seq}`;
const now = () => 1000;

/**
 * A learner at the canvas: the lesson forked exactly as app.tutorial forks it (normaliseDoc, never
 * fromJson — the AUTHORED ids survive), then the gestures, then the checker after each one.
 * @param {any} lesson
 */
function learner(lesson) {
  const fork = normaliseDoc({ ...lesson.doc, id: 'fork', threadId: null, title: lesson.doc.title }, { specs: SPECS, now });
  assert.deepEqual(fork.dropped, [], `${lesson.id} opens whole`);
  const s = {
    doc: fork.doc,
    prog: freshProgress(),
    /** Re-evaluate, as the rail does on every session and run event. → the current step index. */
    tick() {
      s.prog = advance(lesson, s.prog, { doc: s.doc, report: null, now: 5 });
      return s.prog.step;
    },
    /** Typing into a box / flipping a toggle: an undoable settings edit (marks it + downstream stale). */
    set(id, patch) { s.doc = setSettings(s.doc, id, patch, { now }); return s.tick(); },
    /** Dragging a wire. */
    wire(from, to, port) {
      const out = addWire(s.doc, { from, to, port }, { specs: SPECS, newId, now });
      assert.equal(out.ok, true, `wire ${from} → ${to}.${port}: ${out.ok ? '' : out.reason}`);
      s.doc = out.doc;
      return s.tick();
    },
    /** Naming the wire from → to (the label pill). */
    label(from, to, text) {
      const w = s.doc.wires.find((x) => x.from === from && x.to === to);
      assert.ok(w, `a wire ${from} → ${to}`);
      s.doc = setWireLabel(s.doc, w.id, text, { now });
      return s.tick();
    },
    /** Picking a preset row in the ＋ menu (canvas.placeEntry → addPart with the preset's size). */
    add(presetId) {
      const p = PRESETS.get(presetId);
      assert.ok(p, `preset ${presetId} exists`);
      const want = /** @type {any} */ ({ type: p.type, x: 480, y: 340, settings: p.settings });
      if (p.size) { want.w = p.size.w; want.h = p.size.h; }
      const out = addPart(s.doc, want, { specs: SPECS, newId, now });
      assert.ok(out.part, `${presetId} placed`);
      s.doc = out.doc;
      s.tick();
      return out.part.id;
    },
    /** A run that the farm answered: each part goes done with a fresh value (no demo flag). */
    ran(...ids) {
      for (const id of ids) s.doc = patchPart(s.doc, id, { state: 'done', error: null, value: { kind: 'text', data: `answer of ${id}` } }, { now });
      return s.tick();
    },
    /** A run with the farm ABSENT: the part fails… */
    failed(...ids) {
      for (const id of ids) s.doc = patchPart(s.doc, id, { state: 'error', error: 'No farm is connected.' }, { now });
      return s.tick();
    },
    /** …and the rail's saved-answer offer is taken: by part id, or `@<preset>` (KE-4). */
    demo(id) {
      const part = partById(s.doc, id);
      const key = lesson.demo && lesson.demo[id] ? id : `@${presetOf(part)}`;
      const value = lesson.demo && lesson.demo[key];
      assert.ok(value, `${lesson.id} has a saved answer for ${id} (${key})`);
      s.doc = patchPart(s.doc, id, { value, state: 'done', error: null, demo: true }, { now });
      return s.tick();
    },
    /** The Got it button of a manual step. */
    /** A run finished on this document with this report (the rail hands the runner's report to the checks). */
    finished(report) { s.prog = advance(lesson, s.prog, { doc: s.doc, report, now: 5 }); return s; },
    got(stepId) { s.prog = tickManual(lesson, s.prog, stepId); return s.tick(); },
    /** The current step's id, or 'done'. */
    at() { return s.prog.step >= lesson.steps.length ? 'done' : lesson.steps[s.prog.step].id; },
  };
  s.tick();
  return s;
}

/** Screen rectangle of a part at the doc's own view. */
function screenRect(doc, p) {
  const v = doc.view || { x: 0, y: 0, zoom: 1 };
  const z = v.zoom || 1;
  return { x: p.x * z + v.x, y: p.y * z + v.y, w: p.w * z, h: p.h * z };
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The value that lands in a creative box, from a Write-… answer the way a model often sends it. */
const fenced = (lang, code) => `Here you go:\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`;

export default (test) => {
  // ---- the shelf ------------------------------------------------------------------------------

  test('the shelf: the Tour then lessons 1–12 in order, each pointing at the next, and the templates', () => {
    assert.deepEqual(LESSONS.map((l) => l.id), ['l00-tour', ...MINE]);
    assert.deepEqual(LESSONS.map((l) => l.n), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'n is the shelf number');
    for (let i = 0; i < LESSONS.length - 1; i++) assert.equal(LESSONS[i].next, LESSONS[i + 1].id, `${LESSONS[i].id} → next`);
    assert.equal(LESSONS[LESSONS.length - 1].next, undefined, 'the last lesson ends the shelf');
    assert.deepEqual(TEMPLATES.map((x) => x.id), ['research-problematic', 'creative-coding', 'read-the-news', 'analyse-a-dataset', 'ask-a-dataset', 'ask-out-loud', 'talk-to-a-board', 'board-on-wifi']);
    for (const id of MINE) assert.equal(lessonById(id).id, id);
    assert.equal(templateById('creative-coding').title, 'Creative coding');
    assert.equal(templateById('nope'), null);
    assert.equal(lessonById('l05-nope'), null);
  });

  test('every lesson I ship says what it is, how long, and whether it needs the farm', () => {
    for (const id of MINE) {
      const l = lessonById(id);
      for (const k of ['title', 'subtitle', 'idea']) assert.ok(typeof l[k] === 'string' && l[k].trim().length > 5, `${id}.${k}`);
      assert.ok(Number.isInteger(l.minutes) && l.minutes >= 2 && l.minutes <= 10, `${id} takes minutes, not an hour`);
      // 'no' (the offline chip) only for a lesson with no thinking box — the chip must never lie (lesson 6).
      // A thinking box in the doc, or one a step has the learner add (lesson 4's Write an SVG).
      const thinks = l.doc.parts.some((/** @type {any} */ p) => SPECS.get(p.type).thinks)
        || l.steps.some((/** @type {any} */ st) => refsOf(st.check).presets.some((/** @type {string} */ pr) => SPECS.get(PRESETS.get(pr).type).thinks));
      assert.equal(l.needsFarm, thinks ? 'one' : 'no', `${id}: needsFarm says whether it asks the farm`);
      assert.ok(l.steps.length >= 3 && l.steps.length <= 6, `${id}: a handful of steps, one sentence each`);
      for (const s of l.steps) {
        assert.ok(s.text.length <= 170, `${id} ${s.id}: one sentence (${s.text.length} chars)`);
        assert.ok(!/\n/.test(s.text), `${id} ${s.id}: one line`);
        if (!('manual' in s.check)) assert.ok(s.show, `${id} ${s.id}: a step you must DO has a Show me`);
      }
    }
  });

  test('strings about the shelf', () => {
    const note = t('lessons.shelfNote', { lessons: LESSONS.length, templates: TEMPLATES.length });
    assert.ok(note.includes(String(LESSONS.length)) && note.includes(String(TEMPLATES.length)), note);
    assert.equal(t('lessons.templateCost', { n: 8 }), 'about 8 generations');
    assert.ok(t('lessons.lessonsBlurb').length > 20 && t('lessons.templatesBlurb').length > 20);
  });

  // ---- the lessons open, and never pre-tick ---------------------------------------------------

  test('each lesson opens with its authored ids, and NO step is already satisfied by the shipped doc', () => {
    for (const id of MINE) {
      const lesson = lessonById(id);
      const s = learner(lesson);
      assert.deepEqual(s.doc.parts.map((p) => p.id), lesson.doc.parts.map((p) => p.id), `${id} keeps its part ids`);
      assert.equal(s.doc.wires.length, lesson.doc.wires.length, `${id} keeps its wires`);
      assert.equal(s.at(), 's1', `${id} opens on step 1`);
      for (const step of lesson.steps) {
        if ('manual' in step.check) continue;
        assert.equal(evaluate(step.check, { doc: s.doc, report: null, base: lesson.doc }), false,
          `${id} ${step.id} cannot be ticked by opening the lesson — a tick you did not earn teaches nothing`);
      }
    }
  });

  test('a lesson doc IS a canvas export: every setting survives Export with the value it was authored with', () => {
    for (const lesson of [...LESSONS.filter((l) => MINE.includes(l.id)), ...TEMPLATES]) {
      const { doc } = normaliseDoc({ ...lesson.doc, id: 'x', threadId: null }, { specs: SPECS, now });
      const out = toJson(doc, { specs: SPECS });
      for (const raw of lesson.doc.parts) {
        const got = out.parts.find((p) => p.id === raw.id);
        assert.ok(got, `${lesson.id} ${raw.id} exports`);
        for (const [k, v] of Object.entries(raw.settings || {})) {
          assert.deepEqual(got.settings[k], v, `${lesson.id} ${raw.id}.${k} is a declared setting (export would drop a typo)`);
        }
      }
      if (lesson.doc.view) assert.deepEqual(out.view, lesson.doc.view, `${lesson.id} opens framed where it was authored`);
    }
  });

  test('layout: no two boxes overlap, the rail covers no box a step is about, and the lesson opens framed', () => {
    for (const lesson of [...LESSONS.filter((l) => MINE.includes(l.id)), ...TEMPLATES]) {
      const { doc } = normaliseDoc({ ...lesson.doc, id: 'x', threadId: null }, { specs: SPECS, now });
      for (let i = 0; i < doc.parts.length; i++) {
        for (let j = i + 1; j < doc.parts.length; j++) {
          assert.ok(!overlap(doc.parts[i], doc.parts[j]), `${lesson.id}: ${doc.parts[i].id} and ${doc.parts[j].id} overlap`);
        }
      }
      for (const p of doc.parts) {
        const r = screenRect(doc, p);
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= CANVAS.w && r.y + r.h <= CANVAS.h,
          `${lesson.id}: ${p.id} is on screen when it opens (${Math.round(r.x + r.w)}×${Math.round(r.y + r.h)})`);
      }
      const named = new Set();
      for (const step of lesson.steps || []) {
        for (const id of refsOf(step.check).parts) named.add(id);
        if (step.show && step.show.partId) named.add(step.show.partId);
      }
      for (const id of named) {
        const r = screenRect(doc, partById(doc, id));
        assert.ok(!(r.x < RAIL.w && r.y + r.h > RAIL.top), `${lesson.id}: the rail would cover ${id}`);
      }
    }
  });

  test('the demo pack: every generation a lesson can ask for has a saved answer, and each is a real value', () => {
    for (const id of MINE) {
      const lesson = lessonById(id);
      const thinking = lesson.doc.parts.filter((p) => SPECS.get(p.type).thinks);
      for (const p of thinking) assert.ok(lesson.demo && isValue(lesson.demo[p.id]), `${id}: ${p.id} has a saved answer`);
      for (const step of lesson.steps) {
        for (const pr of refsOf(step.check).presets) {
          if (!SPECS.get(PRESETS.get(pr).type).thinks) continue;
          assert.ok(isValue(lesson.demo[`@${pr}`]), `${id}: the ${pr} the learner adds has a saved answer, keyed @${pr}`);
        }
      }
      for (const [k, v] of Object.entries(lesson.demo || {})) {
        assert.ok(isValue(v), `${id} demo ${k} is a value`);
        assert.ok(String(v.data).trim().length > 10, `${id} demo ${k} says something`);
      }
    }
  });

  // ---- lesson 1 -------------------------------------------------------------------------------

  test('lesson 1 walks to done with the farm answering', () => {
    const s = learner(lessonById('l01-hello-farm'));
    s.ran('p_answer');
    assert.equal(s.at(), 's1', 'running the Text box does not skip typing the instruction');
    s.set('p_ask', { instruction: 'Write a haiku about the sea.' });
    assert.equal(s.at(), 's2');
    s.ran('p_ask', 'p_answer');        // ▶ on the Instruction PUSHES: the Text box below runs too
    assert.equal(s.at(), 's4', 'the answer arriving in the Text box ticks step 3 with step 2');
    s.set('p_answer', { locked: true });
    assert.equal(s.at(), 'done');
    assert.ok(s.prog.doneAt, 'the lesson is complete');
    assert.deepEqual(s.prog.ticks, ['s1', 's2', 's3', 's4']);
  });

  test('lesson 1 walks to done with the farm absent, on the saved answer', () => {
    const s = learner(lessonById('l01-hello-farm'));
    s.set('p_ask', { instruction: 'Write a haiku about the sea.' });
    s.failed('p_ask');
    assert.equal(s.at(), 's2', 'a failed run ticks nothing');
    s.demo('p_ask');
    assert.equal(s.at(), 's3', 'a saved answer counts, and is flagged as one');
    assert.equal(partById(s.doc, 'p_ask').demo, true);
    s.ran('p_answer');                 // ▶ on the Text box: it adopts what arrived
    s.set('p_answer', { locked: true });
    assert.equal(s.at(), 'done');
  });

  // ---- lesson 2 -------------------------------------------------------------------------------

  test('lesson 2: wire, read what is sent, pull the story through the title, then push an edit', () => {
    const s = learner(lessonById('l02-wires'));
    s.ran('p_story');
    assert.equal(s.at(), 's1', 'running before wiring does not tick the wire step');
    s.wire('p_note', 'p_story', 'in');
    assert.equal(s.at(), 's2');
    assert.equal(partById(s.doc, 'p_story').state, 'stale', 'the new wire staled the story');
    s.tick();
    assert.equal(s.at(), 's2', 'reading the prompt cannot be detected — only Got it ticks it');
    s.got('s2');
    assert.equal(s.at(), 's3');
    s.ran('p_story');
    assert.equal(s.at(), 's3', 'the story alone is not the title');
    s.ran('p_title');
    assert.equal(s.at(), 's4');
    // s4: nothing ticks until the note is CHANGED and everything below it has run again.
    s.set('p_note', { text: 'A beekeeper who has never been stung.' });
    assert.equal(partById(s.doc, 'p_story').state, 'stale');
    assert.equal(partById(s.doc, 'p_title').state, 'stale', 'the edit staled everything downstream');
    assert.equal(s.at(), 's4');
    s.ran('p_note', 'p_story');
    assert.equal(s.at(), 's4', 'half the push is not the push');
    s.ran('p_title');
    assert.equal(s.at(), 'done');
  });

  test('lesson 2 with the farm absent: both generations continue on saved answers', () => {
    const s = learner(lessonById('l02-wires'));
    s.wire('p_note', 'p_story', 'in');
    s.got('s2');
    s.failed('p_story');
    s.demo('p_story');
    s.failed('p_title');
    assert.equal(s.at(), 's3');
    s.demo('p_title');
    assert.equal(s.at(), 's4');
    s.set('p_note', { text: 'A beekeeper who has never been stung.' });
    s.failed('p_story', 'p_title');
    s.demo('p_story');
    s.demo('p_title');
    assert.equal(s.at(), 'done');
  });

  test('lesson 2 out of order: an edit made BEFORE step 4 asked for it does not tick step 4', () => {
    // The reviewer's walk: the Text box invites typing, so the learner changes the character
    // first, then wires, Got it, and ONE ▶ on the title. Step 4 must still be open — the lesson is
    // about seeing the re-run after a change, and that has not happened yet.
    const s = learner(lessonById('l02-wires'));
    s.set('p_note', { text: 'A beekeeper who has never been stung.' });
    s.wire('p_note', 'p_story', 'in');
    s.got('s2');
    s.ran('p_note', 'p_story', 'p_title');
    assert.equal(s.at(), 's4', 'the early edit is not the edit step 4 asks for');
    assert.equal(s.prog.doneAt, null);
    s.ran('p_note', 'p_story', 'p_title');
    assert.equal(s.at(), 's4', 'running again without a change is not step 4');
    // Resume: the step's mark survives the kv round trip.
    s.prog = JSON.parse(JSON.stringify(s.prog));
    s.tick();
    assert.equal(s.at(), 's4', 'a resumed lesson still waits for the change');
    s.set('p_note', { text: 'A clockmaker who is always late.' });
    assert.equal(s.at(), 's4', 'the change alone is not the re-run');
    s.ran('p_note', 'p_story', 'p_title');
    assert.equal(s.at(), 'done', 'a change after the step asked, then the re-run, finishes the lesson');
  });

  test('lesson 4 out of order: code changed before step 2 asked does not tick step 2', () => {
    const s = learner(lessonById('l04-draw'));
    s.set('p_svg', { source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' });
    s.ran('p_svg');
    assert.equal(s.at(), 's2', 'the run ticks step 1, and the earlier edit does not tick step 2');
    s.set('p_svg', { source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4" cx="5" cy="5" fill="#2e86ab"/></svg>' });
    assert.equal(s.at(), 's3', 'an edit after the step asked ticks it');
  });

  // ---- lesson 3 -------------------------------------------------------------------------------

  test('lesson 3: nothing the lesson itself says invites naming the arrows before the blank run', () => {
    // The fix pass: the sticky beside the Instruction used to say "Click an arrow to name it"
    // while step 1 wants the arrows BLANK — a learner who obeyed it could not tick step 1 by
    // running. Every sticky that talks about naming an arrow must defer it to after the first ▶,
    // and step 1 must say how to get back.
    const lesson = lessonById('l03-labels');
    for (const p of lesson.doc.parts.filter((x) => x.type === 'sticky')) {
      const words = String(p.settings.text || '');
      if (/name (it|them|the arrows?)/i.test(words)) assert.match(words, /after your first ▶/i, `${p.id}: "${words}"`);
    }
    assert.match(lesson.steps[0].text, /clear the names/i, 'step 1 tells a learner who named them how to get back');
  });

  test('lesson 3: blank arrows arrive as Input 1 / Input 2; named, as before / after; swapped, reversed', () => {
    const lesson = lessonById('l03-labels');
    const s = learner(lesson);
    s.ran('p_cars', 'p_trees');
    const cars = partById(s.doc, 'p_cars').value.data;
    const trees = partById(s.doc, 'p_trees').value.data;
    const params = () => bindInputs(s.doc, 'p_ask').params.map((p) => [p.name, p.values.map((v) => v.data).join('')]);

    assert.deepEqual(params(), [['Input 1', cars], ['Input 2', trees]], 'unnamed: the model cannot tell which is before');
    s.ran('p_ask');
    assert.equal(s.at(), 's2', 'the blank run ticks step 1');

    s.label('p_cars', 'p_ask', 'before');
    assert.equal(s.at(), 's2', 'one name is half the step');
    s.label('p_trees', 'p_ask', 'after');
    assert.equal(s.at(), 's3');
    assert.deepEqual(params(), [['before', cars], ['after', trees]], 'named, in the order the instruction mentions them');
    assert.deepEqual(bindInputs(s.doc, 'p_ask').unused, [], 'both names are in the instruction — no unused chip');
    assert.equal(partById(s.doc, 'p_ask').state, 'stale', 'renaming staled the answer');
    s.got('s3');
    assert.equal(s.at(), 's4', 'the stale answer does not tick the re-run');
    s.ran('p_ask');
    assert.equal(s.at(), 's5');

    s.label('p_trees', 'p_ask', 'Before');   // casefold: a label is compared as the prompt binds it
    s.label('p_cars', 'p_ask', 'after');
    assert.deepEqual(params(), [['Before', trees], ['after', cars]], 'swapped: the same boxes, the story reversed');
    assert.equal(s.at(), 's5', 'swapping without running is not the lesson');
    s.ran('p_ask');
    assert.equal(s.at(), 'done');
  });

  test('lesson 3 cannot be skipped by naming first: the blank run is the point', () => {
    const s = learner(lessonById('l03-labels'));
    s.label('p_cars', 'p_ask', 'before');
    s.label('p_trees', 'p_ask', 'after');
    s.ran('p_ask');
    assert.equal(s.at(), 's1', 'named arrows do not tick "run it blank"');
    s.label('p_cars', 'p_ask', '');
    s.label('p_trees', 'p_ask', '   ');
    s.failed('p_ask');
    s.demo('p_ask');
    assert.equal(s.at(), 's2', 'cleared names + the saved answer tick it, farm or no farm');
  });

  // ---- lesson 4 -------------------------------------------------------------------------------

  test('lesson 4: draw, edit, add "Write an SVG" from the menu, wire, run, lock — with the farm', () => {
    const s = learner(lessonById('l04-draw'));
    s.ran('p_svg');
    assert.equal(s.at(), 's2', 'the SVG box draws its own code with no farm');
    s.set('p_svg', { source: partById(s.doc, 'p_svg').settings.source.replace('#e4572e', '#2e86ab') });
    assert.equal(s.at(), 's3');
    const plain = s.add('write-html');
    assert.equal(s.at(), 's3', 'the wrong Write-… box does not tick "add Write an SVG"');
    assert.equal(presetOf(partById(s.doc, plain)), 'write-html');
    const write = s.add('write-svg');
    assert.equal(s.at(), 's4');
    s.set(write, { instruction: 'Draw a lighthouse at night.' });
    assert.equal(presetOf(partById(s.doc, write)), 'write-svg', 'rewriting the ask keeps it a Write an SVG');
    s.wire(plain, 'p_svg', 'content');
    assert.equal(s.at(), 's4', 'wiring the HTML writer is not wiring the SVG writer');
    s.wire(write, 'p_svg', 'content');
    assert.equal(s.at(), 's5');
    s.ran(write);
    assert.equal(s.at(), 's5', 'the picture has not been drawn yet');
    s.ran('p_svg');
    assert.equal(s.at(), 's6');
    s.set('p_svg', { locked: true });
    assert.equal(s.at(), 'done');
  });

  test('lesson 4 with the farm absent: the learner-added box continues on the @write-svg answer', () => {
    const lesson = lessonById('l04-draw');
    const s = learner(lesson);
    s.ran('p_svg');
    s.set('p_svg', { source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>' });
    const write = s.add('write-svg');
    s.wire(write, 'p_svg', 'content');
    s.failed(write, 'p_svg');
    assert.equal(s.at(), 's5');
    s.demo(write);
    assert.equal(partById(s.doc, write).demo, true);
    assert.equal(partById(s.doc, write).value.format, 'svg', 'the saved answer is stamped as an SVG, like a real one');
    s.ran('p_svg');
    s.set('p_svg', { locked: true });
    assert.equal(s.at(), 'done');
  });

  test('lesson 4: the saved SVG is exactly what a real Write an SVG answer becomes', () => {
    const saved = lessonById('l04-draw').demo['@write-svg'];
    assert.match(saved.data, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox=/);
    assert.match(saved.data, /<\/svg>$/);
    const real = codeValue(fenced('svg', saved.data), 'svg');
    assert.equal(real.data, saved.data, 'unfenced, the model\'s answer is the saved answer byte for byte');
    assert.equal(real.format, saved.format);
    assert.equal(unfence(saved.data).code, saved.data, 'the saved answer carries no fence to strip');
    const svg = lessonById('l04-draw').doc.parts.find((p) => p.id === 'p_svg');
    assert.equal(presetOf(svg), 'svg', 'the box the lesson ships IS the ＋ menu\'s "SVG"');
    assert.ok(svg.settings.source.includes('#e4572e'), 'step 2 names a colour that is really in the code');
  });

  // ---- lesson 5 -------------------------------------------------------------------------------

  test('lesson 5: the table → code adds it up → the model answers in words; an edit re-counts', () => {
    const lesson = lessonById('l05-code-counts');
    const s = learner(lesson);
    s.ran('p_code');
    assert.equal(s.at(), 's1', 'running the Code box before the table is wired ticks nothing');
    s.wire('p_data', 'p_code', 'in');
    assert.equal(s.at(), 's2');
    s.ran('p_code');
    assert.equal(s.at(), 's3');
    s.wire('p_code', 'p_say', 'in');
    assert.equal(s.at(), 's3', 'the wire alone is half of step 3');
    s.ran('p_say');
    assert.equal(s.at(), 's4');
    s.set('p_data', { text: 'fruit,crates\napples,12\nplums,40' });
    s.ran('p_data', 'p_code', 'p_say');
    assert.equal(s.at(), 'done');
    // The program the lesson ships really counts — the numbers the learner sees are the table's.
    const code = lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_code').settings.code;
    const table = lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_data').settings.text;
    assert.deepEqual(new Function('inputs', code)({ in: [table] }), { apples: 17, pears: 10, plums: 9 });
    assert.deepEqual(new Function('inputs', code)({ in: ['fruit,crates\napples,12\nplums,40'] }), { apples: 12, plums: 40 });
    assert.match(lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_say').settings.instruction, /never write a number/);
  });

  test('lesson 5 walks to done with the farm absent: the code still counts, the sentence is the saved one', () => {
    const s = learner(lessonById('l05-code-counts'));
    s.wire('p_data', 'p_code', 'in');
    s.ran('p_code');
    s.wire('p_code', 'p_say', 'in');
    s.failed('p_say');
    assert.equal(s.at(), 's3', 'a failed run ticks nothing');
    s.demo('p_say');
    assert.equal(s.at(), 's4', 'a saved answer counts');
    s.set('p_data', { text: 'fruit,crates\nplums,40' });
    s.ran('p_data', 'p_code');
    s.demo('p_say');
    assert.equal(s.at(), 'done');
  });

  // ---- lesson 6 -------------------------------------------------------------------------------

  test('lesson 6: close the ring, the ceiling stops the run, the Toggle is the brake — no farm, no generation', () => {
    const lesson = lessonById('l06-a-loop-that-stops');
    const s = learner(lesson);
    // The reports are what a real run gave (harness probe, 2026-09-28): on → ran 16, limited by maxIterations 8;
    // off → ran 2.
    const roundAndRound = { ran: 16, generations: 0, errors: [], limited: { ceiling: 'maxIterations', limit: 8 } };
    s.finished(roundAndRound);
    assert.equal(s.at(), 's1', 'a report before the ring is closed ticks nothing');
    s.wire('p_tog', 'p_count', 'in');
    assert.equal(s.at(), 's2', 'the ring is legal: the Toggle is a gate');
    s.finished({ ran: 2, generations: 0, errors: [] });
    assert.equal(s.at(), 's2', 'a run that did not go round does not show the ceiling');
    s.finished(roundAndRound);
    assert.equal(s.at(), 's3');
    s.finished({ ran: 2, generations: 0, errors: [] });
    assert.equal(s.at(), 's3', 'one pass with the Toggle still ON is not the brake');
    s.set('p_tog', { on: false });
    s.ran('p_count');
    s.finished({ ran: 2, generations: 0, errors: [] });
    assert.equal(s.at(), 'done');
    assert.equal(lesson.needsFarm, 'no');
    assert.equal(lesson.doc.parts.filter((/** @type {any} */ p) => SPECS.get(p.type).thinks).length, 0, 'not one generation');
  });

  // ---- lessons 7–12 (2026-09-28: one lesson per capability built since lesson 6) ---------------

  /** What ● Record → ■ Stop (or a dropped file) writes into a Sound box: the box HOLDS a recording. */
  const RECORDING = { fileId: 'take-1', name: 'recording 21-40-02.webm', mime: 'audio/webm', size: 24000, durationSec: 3 };

  test('lesson 7: record, Listen, wire, the answer is said — then this computer’s own voice', () => {
    const s = learner(lessonById('l07-listen-and-speak'));
    s.ran('p_ask', 'p_speak');
    assert.equal(s.at(), 's1', 'answering with no recording ticks nothing');
    s.set('p_snd', RECORDING);
    assert.equal(s.at(), 's2');
    s.ran('p_snd', 'p_ask', 'p_speak');
    assert.equal(s.at(), 's2', 'a run with Listen off is not Listen');
    s.set('p_snd', { listen: true });
    assert.equal(s.at(), 's3');
    s.ran('p_snd', 'p_ask', 'p_speak');
    assert.equal(s.at(), 's3', 'the Instruction has not heard the recording until it is wired');
    s.wire('p_snd', 'p_ask', 'in');
    assert.equal(s.at(), 's3', 'the new wire staled the answer');
    s.ran('p_snd', 'p_ask', 'p_speak');   // ▶ on the Instruction: pulls the Sound box, pushes Speak
    assert.equal(s.at(), 's4');
    s.set('p_speak', { voice: 'farm' });
    s.ran('p_speak');
    assert.equal(s.at(), 's4', 'the farm’s voice is not this computer’s');
    s.set('p_speak', { voice: 'local' });
    assert.equal(s.at(), 's4', 'picking the voice is half: it has to speak');
    s.ran('p_speak');
    assert.equal(s.at(), 'done');
  });

  test('lesson 7 with a farm that cannot listen (or none): a saved transcript, a saved answer, this computer’s voice', () => {
    const lesson = lessonById('l07-listen-and-speak');
    const s = learner(lesson);
    s.set('p_snd', RECORDING);
    s.set('p_snd', { listen: true });
    s.wire('p_snd', 'p_ask', 'in');
    s.failed('p_snd');                   // "This farm cannot listen: its Speech to text plugin is off."
    assert.equal(s.at(), 's3');
    s.demo('p_snd');
    assert.equal(partById(s.doc, 'p_snd').value.data, 'Why is the sky blue?', 'the saved transcript is words, as Listen hands on');
    s.failed('p_ask');
    s.demo('p_ask');
    assert.equal(s.at(), 's3', 'Speak has not said it yet');
    s.ran('p_speak');
    assert.equal(s.at(), 's4');
    s.set('p_speak', { voice: 'local' });
    s.ran('p_speak');
    assert.equal(s.at(), 'done');
    const snd = lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_snd');
    assert.equal(normaliseDoc({ ...lesson.doc, id: 'x', threadId: null }, { specs: SPECS, now }).doc.parts.find((p) => p.id === 'p_snd').settings.listen, false,
      'the Sound box ships with Listen OFF: a recording leaves only when a person turns it on');
    assert.deepEqual(snd.settings, {}, 'and with no recording in it');
  });

  test('lesson 8: a webcam picture, wired into an Instruction, then another question about the same picture', () => {
    const s = learner(lessonById('l08-a-picture-to-a-model'));
    s.ran('p_look');
    assert.equal(s.at(), 's1', 'an answer with no picture ticks nothing');
    s.set('p_img', { dataUrl: 'data:image/jpeg;base64,/9j/AAAA', name: 'camera 21-40-02.jpg', w: 640, h: 480 });
    assert.equal(s.at(), 's2', 'the answer from before the picture is not the answer about it');
    s.wire('p_img', 'p_look', 'in');
    assert.equal(partById(s.doc, 'p_look').state, 'stale', 'the wire staled the old answer');
    assert.equal(s.at(), 's2');
    s.ran('p_img', 'p_look');
    assert.equal(s.at(), 's3');
    s.ran('p_look');
    assert.equal(s.at(), 's3', 'running again without a new question is not step 3');
    s.set('p_look', { instruction: 'What is the mood of this picture?' });
    s.ran('p_look');
    assert.equal(s.at(), 'done');
  });

  test('lesson 8 with the farm absent: the saved description says it did not see the picture', () => {
    const lesson = lessonById('l08-a-picture-to-a-model');
    const s = learner(lesson);
    s.set('p_img', { dataUrl: 'data:image/jpeg;base64,/9j/AAAA', name: 'camera.jpg', w: 640, h: 480 });
    s.wire('p_img', 'p_look', 'in');
    s.failed('p_look');
    s.demo('p_look');
    assert.equal(s.at(), 's3');
    s.set('p_look', { instruction: 'What is missing from this picture?' });
    s.failed('p_look');
    s.demo('p_look');
    assert.equal(s.at(), 'done');
    assert.match(lesson.demo.p_look.data, /did not see your picture/, 'a saved description never pretends it looked');
  });

  test('lesson 9: a dry run, arming is a person’s Got it, a new level goes out, then Panic — no farm, no hardware', () => {
    const lesson = lessonById('l09-act-on-the-world');
    const s = learner(lesson);
    s.failed('p_send');                  // ▶ on an unwired Send: "Nothing to send"
    assert.equal(s.at(), 's1');
    s.wire('p_level', 'p_send', 'in');
    assert.equal(s.at(), 's2');
    s.ran('p_send');                     // "Dry run — would send: OSC /lol/level 0.75"
    assert.equal(s.at(), 's3');
    s.set('p_level', { text: '0.2' });   // changed BEFORE step 4 asked
    s.ran('p_level', 'p_send');
    assert.equal(s.at(), 's3', 'arming is a dialog no check can see: only Got it passes it');
    s.got('s3');
    assert.equal(s.at(), 's4', 'the edit made before step 4 asked does not count');
    s.set('p_level', { text: '0.4' });
    s.ran('p_level', 'p_send');
    assert.equal(s.at(), 's5');
    s.got('s5');
    assert.equal(s.at(), 'done');
    const send = lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_send');
    assert.deepEqual([send.settings.transport, send.settings.host, send.settings.port], ['osc', '127.0.0.1', 9000], 'it sends to THIS computer, never a farm port');
  });

  test('lesson 10: the Trigger runs the graph by itself once armed, is slowed by its gap, and rests when disarmed', () => {
    const lesson = lessonById('l10-hear-the-world');
    const s = learner(lesson);
    s.ran('p_heard', 'p_send');          // ▶ on the unwired Code box: "Tick undefined…"
    assert.equal(s.at(), 's1');
    s.wire('p_trig', 'p_heard', 'in');
    assert.equal(s.at(), 's2', 'the wire staled what ran before it');
    s.ran('p_trig', 'p_heard', 'p_send'); // a tick, armed: the Trigger's own run
    assert.equal(s.at(), 's3');
    s.set('p_trig', { gapSec: 6 });
    assert.equal(s.at(), 's3', 'the new gap staled the Code box: the next tick has to run it');
    s.ran('p_trig', 'p_heard', 'p_send');
    assert.equal(s.at(), 's4');
    s.got('s4');
    assert.equal(s.at(), 'done');
    const trig = lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_trig');
    assert.equal(trig.settings.source, 'schedule', 'a clock: the one source that works with no farm');
    assert.ok(lesson.doc.parts.some((/** @type {any} */ p) => p.type === 'send'), 'a Send box: the run bar shows the Outputs control only with one');
    // The Code box's program reads a real tick.
    const code = lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_heard').settings.code;
    assert.match(new Function('inputs', code)({ in: [{ tick: 4, at: '2026-09-28T19:40:02.000Z' }] }), /^Tick 4, heard at /);
  });

  test('lesson 11: wire and name, the Agent’s steps, read them, then its brake', () => {
    const s = learner(lessonById('l11-an-agent-with-tools'));
    s.wire('p_data', 'p_agent', 'in');
    assert.equal(s.at(), 's1', 'an unnamed arrow reaches the Agent as input1: name it');
    s.label('p_data', 'p_agent', 'Readings');
    assert.equal(s.at(), 's2', 'a name is compared as the Agent binds it');
    s.ran('p_agent', 'p_view');          // ▶ on the Agent pushes the Preview
    assert.equal(s.at(), 's4');
    s.set('p_agent', { maxSteps: 3 });
    s.ran('p_agent', 'p_view');
    assert.equal(s.at(), 's4', 'three steps is not the brake step 4 asks for');
    s.set('p_agent', { maxSteps: 2 });
    assert.equal(s.at(), 's4', 'the new brake staled the answer: run it');
    s.ran('p_agent', 'p_view');
    assert.equal(s.at(), 'done');
  });

  test('lesson 11 with the farm absent: the saved answer is the report the Agent box itself writes', () => {
    const lesson = lessonById('l11-an-agent-with-tools');
    const s = learner(lesson);
    s.wire('p_data', 'p_agent', 'in');
    s.label('p_data', 'p_agent', 'readings');
    s.failed('p_agent');
    s.demo('p_agent');
    assert.equal(s.at(), 's3', 'the Preview has not shown it yet');
    s.ran('p_view');
    s.set('p_agent', { maxSteps: 2 });
    s.failed('p_agent');
    s.demo('p_agent');
    assert.equal(s.at(), 'done');
    // The saved answer, byte for byte what agent.mjs reportOf writes for those two steps, with the numbers the
    // readings really give.
    const readings = JSON.parse(lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_data').settings.text);
    const stats = { average: readings.reduce((a, b) => a + b, 0) / readings.length, largest: Math.max(...readings) };
    const report = reportOf('The average of the seven readings is about 14.7, and the largest is 30.', [
      { tool: 'run_code', why: 'read the readings as a list of numbers', result: { ok: true, value: readings } },
      { tool: 'run_code', why: 'add them up, divide by how many there are, and take the largest', result: { ok: true, value: stats } },
    ]);
    assert.equal(lesson.demo.p_agent.data, report);
    assert.equal(stats.largest, 30);
    assert.equal(Math.round(stats.average * 10) / 10, 14.7);
    const agent = lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_agent');
    assert.equal(agent.settings.hosts, '', 'no web host is listed: it cannot read the web');
    assert.equal(SPECS.get('agent').mostGenerations(agent), 4, 'at most four generations as shipped');
  });

  test('lesson 12: the dataset, a chart drawn by code, the model names it, another column', () => {
    const lesson = lessonById('l12-open-data');
    const s = learner(lesson);
    s.ran('p_data');                     // offline: the copy it holds
    assert.equal(s.at(), 's2');
    s.ran('p_draw', 'p_chart');
    assert.equal(s.at(), 's2', 'a chart of nothing is not the chart');
    s.wire('p_data', 'p_draw', 'in');
    s.ran('p_draw', 'p_chart');
    assert.equal(s.at(), 's3');
    s.wire('p_chart', 'p_ask', 'in');
    s.ran('p_ask');
    assert.equal(s.at(), 's4');
    s.set('p_col', { text: 'Région principale de déroulement' });
    s.ran('p_col', 'p_draw', 'p_chart');
    assert.equal(s.at(), 's4', 'the words have not followed yet');
    s.ran('p_ask');
    assert.equal(s.at(), 'done');
  });

  test('lesson 12 with the farm absent and no web: the copy, the chart in code, the saved words', () => {
    const lesson = lessonById('l12-open-data');
    const s = learner(lesson);
    s.ran('p_data');
    s.wire('p_data', 'p_draw', 'in');
    s.ran('p_draw', 'p_chart');
    s.wire('p_chart', 'p_ask', 'in');
    s.failed('p_ask');
    s.demo('p_ask');
    assert.equal(s.at(), 's4');
    s.set('p_col', { text: 'Région principale de déroulement' });
    s.ran('p_col', 'p_draw', 'p_chart');
    s.failed('p_ask');
    s.demo('p_ask');
    assert.equal(s.at(), 'done');
    assert.doesNotMatch(lesson.demo.p_ask.data, /[0-9]/, 'the saved words carry no number either');
  });

  test('lesson 12: the chart’s numbers are data.gouv.fr’s, drawn by the code the lesson ships', () => {
    const lesson = lessonById('l12-open-data');
    const data = lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_data');
    assert.ok(parseLink(data.settings.link) && parseLink(data.settings.link).dataset, 'the link is a data.gouv.fr dataset');
    assert.ok(isValue(data.value) && Array.isArray(data.value.data.columns), 'the box holds a copy, so it runs offline');
    const draw = new Function('inputs', lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_draw').settings.code);
    const col = lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_col').settings.text;
    const chart = draw({ in: [col, data.value.data] });
    assert.match(chart, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    const tops = data.value.data.columns.find((/** @type {any} */ c) => c.name === col).tops;
    for (const t of tops.slice(0, 6)) {
      assert.ok(chart.includes(`>${t.count}</text>`), `the bar for ${t.value} says ${t.count}, data.gouv.fr’s count`);
    }
    assert.match(chart, new RegExp(`counted over all ${data.value.data.total} rows`));
    const regions = draw({ in: [data.value.data, '  région principale de déroulement '] });
    assert.ok(regions.includes('Auvergne-Rhône-Alpes') && regions.includes('>947</text>'), 'step 4’s column, whatever the case and spaces');
    assert.match(draw({ in: [data.value.data, 'Colour'] }), /No column named “colour”[\s\S]*Try one of these/, 'a wrong name is said, with columns to try');
    assert.match(lesson.doc.parts.find((/** @type {any} */ p) => p.id === 'p_ask').settings.instruction, /never write a number/);
  });

  // ---- the templates --------------------------------------------------------------------------

  test('templates open through the library import (fromJson) whole, with fresh ids', () => {
    for (const tpl of TEMPLATES) {
      assert.ok(tpl.title && tpl.subtitle && ['no', 'one', 'few'].includes(tpl.needsFarm), `${tpl.id} says what it is`);
      const out = fromJson(JSON.parse(JSON.stringify(tpl.doc)), { specs: SPECS, newId, now });
      assert.equal(out.ok, true, `${tpl.id} opens`);
      assert.deepEqual(out.errors, [], `${tpl.id} opens with nothing dropped`);
      assert.equal(out.doc.parts.length, tpl.doc.parts.length);
      assert.equal(out.doc.wires.length, tpl.doc.wires.length);
      assert.equal(out.doc.wires.filter((w) => w.label).length, tpl.doc.wires.filter((w) => w.label).length, `${tpl.id} keeps its labels`);
      assert.ok(!out.doc.parts.some((p) => tpl.doc.parts.some((q) => q.id === p.id)), 'the ids are fresh');
    }
  });

  test('templates: the declared cost is the real number of generations, inside the cap, and every box has its inputs', () => {
    for (const tpl of TEMPLATES) {
      const thinking = tpl.doc.parts.filter((p) => SPECS.get(p.type).thinks);
      // One per thinking box — or a box's most, when it may ask more than once (the Agent: one per step).
      const most = thinking.reduce((n, p) => n + (typeof SPECS.get(p.type).mostGenerations === 'function' ? SPECS.get(p.type).mostGenerations(p) : 1), 0);
      assert.equal(tpl.generations, most, `${tpl.id}: one generation per thinking box (an agent: one per step)`);
      assert.ok(tpl.generations <= 50, `${tpl.id} is inside the 50-generation cap`);
      for (const p of thinking) assert.ok(tpl.doc.wires.some((w) => w.to === p.id), `${tpl.id}: ${p.id} is fed`);
    }
  });

  test('templates: every label is a name the instruction it feeds actually uses', () => {
    for (const tpl of TEMPLATES) {
      const { doc } = normaliseDoc({ ...tpl.doc, id: 'x', threadId: null }, { specs: SPECS, now });
      for (const p of doc.parts.filter((x) => x.type === 'ask')) {
        const bind = bindInputs(doc, p.id);
        assert.deepEqual(bind.unused, [], `${tpl.id} ${p.id}: no label is left unmentioned`);
        assert.ok(bind.params.every((x) => !x.unlabelled), `${tpl.id} ${p.id}: every arrow into it is named`);
        for (const w of doc.wires.filter((x) => x.to === p.id)) {
          assert.ok(mentions(p.settings.instruction, labelKey(w.label)), `${tpl.id}: "${w.label}" is in ${p.id}'s instruction`);
        }
      }
    }
  });

  test('research → problematic is the owner\'s graph: one topic, five named researches, one problematic, two concepts', () => {
    const tpl = templateById('research-problematic');
    const { doc } = normaliseDoc({ ...tpl.doc, id: 'x', threadId: null }, { specs: SPECS, now });
    const topic = doc.parts.find((p) => p.type === 'note');
    const out = doc.wires.filter((w) => w.from === topic.id);
    assert.equal(out.length, 6, 'the topic fans out to five researches and the problematic');
    assert.ok(out.every((w) => w.label === 'topic'), 'every one of those arrows is named topic');
    const prob = doc.parts.find((p) => /problematic about the topic/.test(p.settings.instruction || ''));
    assert.ok(prob, 'there is a "write a problematic"');
    const into = doc.wires.filter((w) => w.to === prob.id).map((w) => w.label).sort();
    assert.deepEqual(into, ['business research', 'environmental research', 'existing initiatives', 'societal research', 'technological research', 'topic']);
    const names = bindInputs(doc, prob.id).params.map((p) => p.name);
    assert.deepEqual(names, ['topic', 'societal research', 'environmental research', 'technological research', 'business research', 'existing initiatives'],
      'the prompt carries one heading per research, in the order the instruction names them');
    const concepts = doc.wires.filter((w) => w.from === prob.id);
    assert.equal(concepts.length, 2);
    assert.ok(concepts.every((w) => w.label === 'problematic'));
    const json = doc.parts.find((p) => p.settings.shape === 'json');
    const schema = JSON.parse(json.settings.schema);
    assert.deepEqual(schema.required, ['title', 'problem', 'solutions', 'visualRepresentation'], 'the owner\'s concept shape');
  });

  test('creative coding: a brief → Write a p5.js sketch → p5.js sketch (KE-4), and the sketch box draws on its own too', () => {
    const tpl = templateById('creative-coding');
    const { doc } = normaliseDoc({ ...tpl.doc, id: 'x', threadId: null }, { specs: SPECS, now });
    const byPreset = (id) => doc.parts.filter((p) => presetOf(p) === id);
    assert.equal(byPreset('write-p5').length, 1, 'one Write a p5.js sketch');
    assert.equal(byPreset('p5').length, 1, 'one p5.js sketch box');
    const write = byPreset('write-p5')[0];
    const sketch = byPreset('p5')[0];
    const brief = doc.parts.find((p) => p.type === 'note');
    assert.ok(doc.wires.some((w) => w.from === brief.id && w.to === write.id && w.label === 'brief'), 'the brief arrives named');
    assert.ok(doc.wires.some((w) => w.from === write.id && w.to === sketch.id && w.port === 'content'), 'the sketch is fed by the writer');
    // Critic R1 A8: the instruction is the TASK only; code-only and the canvas size ride the p5
    // system message, which sizes the canvas from the guest (windowWidth × windowHeight).
    assert.match(write.settings.instruction, /the brief/, 'about the brief');
    assert.equal(write.settings.code, 'p5');
    const sent = planFor({ part: write, bind: bindInputs(doc, write.id) });
    assert.match(sent.assembled.system, /Reply with exactly one ```javascript code block/, 'it asks for code only');
    assert.match(sent.assembled.system, /createCanvas\(windowWidth, windowHeight\)/, 'for the canvas the box shows');
    const landed = codeValue(fenced('javascript', 'function setup() {}'), 'p5');
    assert.equal(landed.data, 'function setup() {}', 'a fenced p5 answer lands clean');
    assert.equal(landed.lang, 'p5');
    assert.match(sketch.settings.source, /function setup\(\)/);
    assert.match(sketch.settings.source, /function draw\(\)/);
    assert.match(sketch.settings.source, /createCanvas\(lol\.size\.w, lol\.size\.h\)/, 'sized by the box, not a guess');
    const next = doc.parts.find((p) => p.type === 'sticky' && /Write an SVG/.test(p.settings.text));
    assert.ok(next, 'a sticky points at the ＋ menu for the next picture');
    for (const name of ['write-svg', 'svg']) assert.ok(PRESETS.has(name), `…and ${name} is a real ＋ menu row`);
  });
};
