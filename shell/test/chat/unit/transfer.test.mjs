// @ts-check
// The export/import FILE FORMAT (P2-U4, app/transfer-format.mjs). Pure module, so it is tested
// directly in Node against real-shaped fixtures.
//
// What these protect:
//   - a ROUND TRIP: export → import keeps the text, the tree shape (a real branch: two assistant
//     replies under one user turn) and the attachment bytes, while every id changes and no legacy
//     field survives — an import must never be able to pass itself off as a v1 migration (§3.7);
//   - a bad file writes NOTHING: half a JSON document, a version this build does not read, or a
//     file whose chats are all unusable all come back as errors with no records;
//   - Markdown keeps its role headers and its fences verbatim (an escaped fence is a useless export);
//   - unknown fields are ignored rather than carried into the store.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  exportThreads, parseImport, threadToMarkdown, LOLCHAT_FORMAT,
} from '../../../renderer/chat/app/transfer-format.mjs';

const FIXTURES = new URL('../fixtures/transfer/', import.meta.url);
const fixture = (/** @type {string} */ name) => readFileSync(new URL(name, FIXTURES), 'utf8');

/** Deterministic ids, so a round trip is readable in a failure message. */
function minter(prefix = 'new') {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

const byId = (/** @type {any[]} */ rows) => new Map(rows.map((r) => [r.id, r]));

export default (test) => {
  // ------------------------------------------------------------------ round trip
  test('transfer: export → import keeps content, tree shape and attachment bytes', async () => {
    const file = JSON.parse(fixture('two-threads.lolchat.json'));
    const first = parseImport(JSON.stringify(file), { newId: minter('a') });
    assert.deepEqual(first.errors, [], 'the fixture imports cleanly');
    assert.equal(first.threads.length, 2);
    assert.equal(first.messages.length, 5);
    assert.equal(first.attachments.length, 1);

    // Export what we just imported, then import THAT: the second generation must be identical in
    // everything but ids.
    const doc = exportThreads({
      threads: first.threads,
      messages: first.messages,
      attachments: first.attachments,
      now: 1_789_200_000_000,
    });
    assert.equal(doc.lolchat, LOLCHAT_FORMAT);
    assert.equal(doc.app, 'LlmOnLan LOL Chat');
    assert.equal(doc.exportedAt, new Date(1_789_200_000_000).toISOString());

    const second = parseImport(JSON.stringify(doc), { newId: minter('b') });
    assert.deepEqual(second.errors, []);

    // content
    const contentOf = (/** @type {any} */ r) => r.messages.map((/** @type {any} */ m) => m.content).sort();
    assert.deepEqual(contentOf(second), contentOf(first), 'every message body survived');
    assert.deepEqual(
      second.threads.map((t) => t.title).sort(),
      ['Rig notes', 'Éléphant'],
      'titles survived, accents and all',
    );
    assert.equal(second.attachments[0].blobBase64, 'TE9MIQ==', 'the attachment bytes are byte-identical');

    // tree shape: the same parent/child relation, expressed in the new ids
    const shape = (/** @type {any} */ r) => {
      const msgs = byId(r.messages);
      const threads = byId(r.threads);
      return r.messages
        .map((/** @type {any} */ m) => [
          threads.get(m.threadId).title,
          m.role,
          m.parentId ? msgs.get(m.parentId).content.slice(0, 12) : null,
        ])
        .sort();
    };
    assert.deepEqual(shape(second), shape(first), 'the branch (two replies under one user turn) is intact');
    const rig = second.threads.find((t) => t.title === 'Rig notes');
    const head = byId(second.messages).get(rig.headId);
    assert.ok(head && head.content.startsWith('Second try'), 'headId points at the same message it did');

    // ids
    const ids = (/** @type {any} */ r) => [
      ...r.threads.map((/** @type {any} */ x) => x.id),
      ...r.messages.map((/** @type {any} */ x) => x.id),
      ...r.attachments.map((/** @type {any} */ x) => x.id),
    ];
    const before = new Set(ids(first));
    for (const id of ids(second)) assert.ok(!before.has(id), `id ${id} was re-minted`);
    for (const id of ids(second)) assert.ok(!String(id).startsWith('th-') && !String(id).startsWith('m-'), 'no original id leaked');

    // an attachment reference followed the remap
    const withImage = second.messages.find((/** @type {any} */ m) => (m.parts || []).some((/** @type {any} */ p) => p.type === 'image'));
    const imagePart = withImage.parts.find((/** @type {any} */ p) => p.type === 'image');
    assert.equal(imagePart.attId, second.attachments[0].id, 'the image part points at the re-minted attachment');
  });

  test('transfer: an import is never a migration — legacy fields are dropped, imported is set', async () => {
    const first = parseImport(fixture('two-threads.lolchat.json'), { newId: minter('a') });
    const rig = first.threads.find((t) => t.title === 'Rig notes');
    assert.equal(rig.legacyId, undefined, 'legacyId cannot survive an import');
    assert.equal(rig.legacyHash, undefined, 'legacyHash cannot survive an import');
    assert.equal(rig.imported, true);
    // And an export of it carries neither, so a second machine cannot get them either.
    const doc = exportThreads({ threads: [{ ...rig, legacyId: 'x', legacyHash: 'y' }], messages: [] });
    assert.equal(doc.threads[0].legacyId, undefined);
    assert.equal(doc.threads[0].legacyHash, undefined);
  });

  test('transfer: an ephemeral chat imports as a normal, saved one', async () => {
    const r = parseImport(fixture('two-threads.lolchat.json'), { newId: minter('a') });
    const ele = r.threads.find((t) => t.title === 'Éléphant');
    assert.equal(ele.ephemeral, false, 'a chat someone chose to export is a chat they want kept');
    assert.equal(ele.pinned, false);
    const rig = r.threads.find((t) => t.title === 'Rig notes');
    assert.equal(rig.pinned, true, 'pinning is part of the file');
  });

  test('transfer: an unsettled status never survives an import (no waiter, no stream)', async () => {
    // P2 review, major: MESSAGE_FIELDS copied `status` verbatim, so a hand-written file could plant
    // a 'waiting' row — which renders the seat-wait's Try now / Cancel with NOTHING behind either
    // (the §2.6 AU.3 defect, through the import door) — or a 'streaming' row that never settles
    // until the next launch runs recoverInterrupted.
    const doc = {
      lolchat: LOLCHAT_FORMAT,
      threads: [{ id: 't1', title: 'planted' }],
      messages: [
        { id: 'm1', threadId: 't1', role: 'user', content: 'hi', status: 'done' },
        { id: 'm2', threadId: 't1', role: 'assistant', content: 'a', status: 'waiting' },
        { id: 'm3', threadId: 't1', role: 'assistant', content: 'b', status: 'streaming' },
        { id: 'm4', threadId: 't1', role: 'assistant', content: 'c' },
        { id: 'm5', threadId: 't1', role: 'assistant', content: '', error: { kind: 'http', message: 'boom' } },
        { id: 'm6', threadId: 't1', role: 'assistant', content: 'd', status: 'nonsense-from-the-future' },
        { id: 'm7', threadId: 't1', role: 'assistant', content: 'e', status: 'aborted' },
        { id: 'm8', threadId: 't1', role: 'assistant', content: 'f', status: 'local' },
      ],
    };
    const r = parseImport(JSON.stringify(doc), { newId: minter('s') });
    const got = r.messages.map((m) => m.status);
    assert.deepEqual(got, ['done', 'interrupted', 'interrupted', 'done', 'error', 'done', 'aborted', 'local']);
    assert.ok(!got.includes('waiting'), 'no row can arrive with a seat wait behind it');
    assert.ok(!got.includes('streaming'), 'and none can arrive mid-stream');
    for (const m of r.messages) {
      assert.equal(typeof m.status, 'string', `every imported row has a status: ${JSON.stringify(m)}`);
    }
  });

  // P2 review, major: the id maps were keyed by the FILE's id and minted once per distinct key, so
  // a file carrying the same id twice — a hand-merged or concatenated export — resolved both
  // records to one new id. The second overwrote the first in the store: a message disappeared, the
  // survivor was re-parented onto the wrong turn, and the toast still said everything imported.
  test('transfer: a repeated id imports as a separate copy, and is reported', async () => {
    const doc = {
      lolchat: LOLCHAT_FORMAT,
      threads: [{ id: 't1', title: 'Merged', createdAt: 1, updatedAt: 2, headId: 'm4' }],
      messages: [
        { id: 'm1', threadId: 't1', parentId: null, role: 'user', content: 'FIRST QUESTION', createdAt: 1 },
        { id: 'm2', threadId: 't1', parentId: 'm1', role: 'assistant', content: 'FIRST ANSWER', createdAt: 2 },
        { id: 'm1', threadId: 't1', parentId: null, role: 'user', content: 'SECOND QUESTION', createdAt: 3 },
        { id: 'm4', threadId: 't1', parentId: 'm1', role: 'assistant', content: 'SECOND ANSWER', createdAt: 4 },
      ],
    };
    const r = parseImport(JSON.stringify(doc), { newId: minter('d') });
    assert.equal(r.messages.length, 4, 'every record survives as its own message');
    assert.equal(new Set(r.messages.map((m) => m.id)).size, 4, 'with four DIFFERENT ids');
    assert.deepEqual(
      r.messages.map((m) => m.content),
      ['FIRST QUESTION', 'FIRST ANSWER', 'SECOND QUESTION', 'SECOND ANSWER'],
      'and nothing was silently dropped',
    );
    assert.equal(r.errors.length, 1, `the reader is told: ${JSON.stringify(r.errors)}`);
    assert.match(r.errors[0], /message #3 repeats the id "m1"/);
    // First-wins for the references: a parentId can only ever mean one record.
    const first = r.messages[0];
    assert.equal(r.messages[1].parentId, first.id, 'FIRST ANSWER still hangs off the FIRST question');
    assert.equal(r.messages[3].parentId, first.id);
  });

  // P2 review, minor: threads, messages and attachments went through a field whitelist but PARTS
  // were copied whole, so a file could plant any field (a dataUrl, an src, a future key) on a part
  // that P3's image and doc renderers will read.
  test('transfer: a part carries only the fields its type defines, and an unknown kind is dropped', async () => {
    const doc = {
      lolchat: LOLCHAT_FORMAT,
      threads: [{ id: 't1', title: 'Parts', createdAt: 1, updatedAt: 1, headId: 'm1' }],
      messages: [{
        id: 'm1',
        threadId: 't1',
        parentId: null,
        role: 'user',
        content: 'look',
        createdAt: 1,
        parts: [
          { type: 'text', text: 'look', dataUrl: 'data:text/html,<script>', src: 'http://evil/', onclick: 'x()' },
          { type: 'image', attId: 'a1', dataUrl: 'data:image/png;base64,AAA', width: 9 },
          { type: 'iframe', src: 'http://evil/' },
        ],
      }],
      attachments: [{ id: 'a1', threadId: 't1', name: 'p.png', mime: 'image/png' }],
    };
    const r = parseImport(JSON.stringify(doc), { newId: minter('p') });
    const parts = r.messages[0].parts;
    assert.equal(parts.length, 2, 'the unknown kind never reaches the store');
    assert.deepEqual(Object.keys(parts[0]).sort(), ['text', 'type']);
    assert.deepEqual(Object.keys(parts[1]).sort(), ['attId', 'type']);
    assert.equal(parts[1].attId, r.attachments[0].id, 'and the reference is still remapped');
    assert.ok(r.errors.some((e) => /unknown kind \("iframe"\)/.test(e)), JSON.stringify(r.errors));
  });

  test('transfer: unknown fields are ignored, known ones are kept', async () => {
    const r = parseImport(fixture('two-threads.lolchat.json'), { newId: minter('a') });
    const ele = r.threads.find((t) => t.title === 'Éléphant');
    assert.equal(ele.somethingFromTheFuture, undefined, 'nothing unknown reaches the store');
    const rig = r.threads.find((t) => t.title === 'Rig notes');
    assert.equal(rig.systemOverride, 'Answer like a rigger.');
    assert.deepEqual(rig.params, { temperature: 0.2 });
    assert.equal(rig.model, 'assistant');
    const reply = r.messages.find((m) => m.reasoning);
    assert.equal(reply.reasoning, 'weights are symmetric here');
    assert.equal(reply.stats.completionTokens, 40);
    assert.equal(reply.underlying, 'Qwen3.8-27B-UD-Q2_K_XL');
  });

  test('transfer: the live Blob handle is never exported', async () => {
    const doc = exportThreads({
      threads: [{ id: 't', title: 'x' }],
      messages: [],
      attachments: [{ id: 'a', threadId: 't', name: 'f.png', blob: { fake: true }, blobBase64: 'AAA=' }],
    });
    assert.equal(doc.attachments[0].blob, undefined);
    assert.equal(doc.attachments[0].blobBase64, 'AAA=');
    const without = exportThreads({
      threads: [{ id: 't', title: 'x' }],
      messages: [],
      attachments: [{ id: 'a', threadId: 't', blobBase64: 'AAA=' }],
      includeBlobs: false,
    });
    assert.equal(without.attachments[0].blobBase64, undefined, 'includeBlobs:false leaves the record, drops the bytes');
  });

  // ------------------------------------------------------------------ bad files
  test('transfer: a malformed file gives errors and no records', async () => {
    const r = parseImport(fixture('malformed.json'), { newId: minter('a') });
    assert.deepEqual(r.threads, []);
    assert.deepEqual(r.messages, []);
    assert.deepEqual(r.attachments, []);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /not a LOL Chat export/);
  });

  test('transfer: a version this build does not read is refused whole', async () => {
    const r = parseImport(fixture('wrong-version.lolchat.json'), { newId: minter('a') });
    assert.deepEqual(r.threads, []);
    assert.match(r.errors[0], /unsupported export version: 2/);
  });

  test('transfer: a file whose chats are all unusable writes nothing', async () => {
    const r = parseImport(fixture('no-usable-threads.lolchat.json'), { newId: minter('a') });
    assert.deepEqual(r.threads, []);
    assert.deepEqual(r.messages, [], 'not even the orphan message');
    assert.ok(r.errors.length >= 2, 'each unusable chat is reported');
  });

  test('transfer: empty text, a non-object, and an oversized file all fail safely', async () => {
    for (const bad of ['', '   ', 'null', '[]', '"a string"']) {
      const r = parseImport(bad, { newId: minter('a') });
      assert.deepEqual(r.threads, [], `"${bad}" imported nothing`);
      assert.ok(r.errors.length, `"${bad}" said why`);
    }
    const big = parseImport(fixture('two-threads.lolchat.json'), { maxBytes: 16, newId: minter('a') });
    assert.deepEqual(big.threads, []);
    assert.match(big.errors[0], /too large/);
  });

  test('transfer: parseImport never throws, whatever it is handed', async () => {
    for (const bad of [undefined, null, 42, {}, '{"lolchat":1,"threads":{}}', '{"lolchat":1,"threads":[],"messages":7}']) {
      const r = parseImport(/** @type {any} */ (bad), { newId: minter('a') });
      assert.ok(Array.isArray(r.errors) && r.errors.length, `${JSON.stringify(bad)} gave a reason instead of a throw`);
    }
  });

  test('transfer: a dangling parent or attachment reference is reported, not followed', async () => {
    const text = JSON.stringify({
      lolchat: 1,
      threads: [{ id: 't1', title: 'Broken', headId: 'gone' }],
      messages: [{ id: 'm1', threadId: 't1', parentId: 'nowhere', role: 'user', content: 'hi', parts: [{ type: 'doc', attId: 'missing', pages: null }] }],
      attachments: [],
    });
    const r = parseImport(text, { newId: minter('a') });
    assert.equal(r.threads.length, 1);
    assert.equal(r.threads[0].headId, null, 'a head nobody exported becomes null');
    assert.equal(r.messages[0].parentId, null, 'so does a parent');
    assert.equal(r.messages[0].parts[0].attId, null, 'and an attachment reference');
    assert.equal(r.errors.length, 3, 'all three are reported');
  });

  // ------------------------------------------------------------------ markdown
  test('transfer: Markdown keeps role headers and fences', async () => {
    const file = JSON.parse(fixture('two-threads.lolchat.json'));
    const thread = file.threads[0];
    const path = ['m-rig-1', 'm-rig-2'].map((id) => file.messages.find((/** @type {any} */ m) => m.id === id));
    const md = threadToMarkdown(thread, path);

    assert.match(md, /^# Rig notes\n/, 'the title is the H1');
    assert.match(md, /\n## You\n/, 'the user turn has a role header');
    assert.match(md, /\n## Assistant \(assistant\)\n/, 'so does the reply, with its model');
    assert.ok(md.includes('```python\nbpy.ops.object.modifier_add(type=\'MIRROR\')\n```'), 'the fence is verbatim');
    assert.ok(md.includes('how do I mirror weights?'), 'the user text came from its text part');
    assert.match(md, /\*Attached: image\*/, 'an attachment is named, not inlined');
    assert.ok(md.endsWith('\n'), 'the file ends with exactly one newline');
  });

  test('transfer: Markdown of an empty thread is still a valid document', async () => {
    const md = threadToMarkdown({ title: '', updatedAt: 0 }, []);
    assert.equal(md, '# New chat\n');
  });

  test('transfer: an error note travels with the message it belongs to', async () => {
    const md = threadToMarkdown({ title: 'T', updatedAt: 0 }, [
      { role: 'assistant', content: 'partial', error: { message: 'the farm went quiet' } },
    ]);
    assert.match(md, /partial/);
    assert.match(md, /> the farm went quiet/);
  });
};
