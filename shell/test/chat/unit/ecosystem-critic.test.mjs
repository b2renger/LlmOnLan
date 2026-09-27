// @ts-check
// Critic P1P2 (docs/reviews/P1P2_CRITIC_2026-09-27.md), the renderer half: M4 (no model-written number
// on the news chart), S9 (an imported graph never arrives listening), S12 (voiceFor).
import assert from 'node:assert/strict';
import { templateById } from '../../../renderer/chat/computer/tutorial/registry.mjs';
import { toJson, fromJson } from '../../../renderer/chat/graph/serialize.mjs';
import { voiceFor } from '../../../renderer/chat/graph/parts/speak.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';

export default (test) => {
  test('read the news, DRAW: the model\'s title, subtitle and insight carry no digit; the bars keep the counted numbers (M4)', () => {
    const doc = /** @type {any} */ (templateById('read-the-news')).doc;
    const code = doc.parts.find((/** @type {any} */ p) => p.id === 'n_draw').settings.code;
    const draw = new Function('inputs', code);
    const counts = {
      byTopic: [{ topic: 'ai', stories: 12, points: 340, comments: 41 }, { topic: 'science', stories: 3, points: 90, comments: 7 }],
      unsure: [], total: 15, labelledBy: { laya: 11, model: 4 }, source: 'Hacker News',
    };
    const spec = { measure: 'stories', sort: 'largest first', highlight: 'ai',
      title: 'AI leads with 12 stories', subtitle: '80% of the front page', insight: 'AI has 12 stories, science 3.' };
    const svg = String(draw({ in: [counts, spec] }));
    const lines = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    assert.ok(lines.includes('AI leads with … stories'), lines.join(' | '));
    assert.ok(lines.includes('… of the front page'));
    assert.ok(lines.some((l) => l.startsWith('AI has … stories, science …')));
    assert.ok(lines.includes('12') && lines.includes('3'), 'the bars print the COUNTED numbers');
    assert.ok(lines.some((l) => /15 stories .* counts by the code/.test(l)), 'the footer is built by the code');
    const plain = String(draw({ in: [counts, { measure: 'stories' }] }));
    assert.match(plain, />What the front page talks about</, 'no title from the model: the code\'s own');
  });

  test('import: a Sound box arrives with Listen OFF, whatever the file says; its other settings stay (S9)', () => {
    const specs = specMap();
    const file = toJson(/** @type {any} */ ({
      id: 'g', title: 'shared', parts: [
        { id: 'a', type: 'audio', x: 0, y: 0, w: 300, h: 200, settings: { listen: true, name: 'take.wav' } },
        { id: 'b', type: 'note', x: 400, y: 0, w: 300, h: 200, settings: { text: 'listen: true' } },
      ], wires: [],
    }), { specs });
    let n = 0;
    const out = fromJson(JSON.parse(JSON.stringify(file)), { specs, newId: () => `n${++n}`, now: () => 1 });
    assert.ok(out.ok, String(out.errors));
    const parts = /** @type {any} */ (out.doc).parts;
    const audio = parts.find((/** @type {any} */ p) => p.type === 'audio');
    assert.equal(audio.settings.listen, false);
    assert.equal(audio.settings.name, 'take.wav');
    assert.equal(parts.find((/** @type {any} */ p) => p.type === 'note').settings.text, 'listen: true');
  });

  test('voiceFor: the setting wins when it can be honoured; Automatic prefers the farm, then this computer (S12)', () => {
    assert.equal(voiceFor('auto', true, true), 'farm');
    assert.equal(voiceFor('auto', false, true), 'local');
    assert.equal(voiceFor('auto', false, false), null);
    assert.equal(voiceFor('farm', true, true), 'farm');
    assert.equal(voiceFor('farm', false, true), null, 'asked for the farm voice: never a silent swap');
    assert.equal(voiceFor('local', true, true), 'local');
    assert.equal(voiceFor('local', true, false), null);
  });
};
