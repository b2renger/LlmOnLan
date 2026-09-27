// @ts-check
// The Open data box (owner, 2026-09-27): what a pasted data.gouv.fr link names, which file it reads, the
// columns as a person reads them, and EXACTLY which addresses it asks — data.gouv.fr's two hosts only,
// never a file's producer URL. The GET itself (refusals, redirects, the 1 MB cap) is io.ts's.
import assert from 'node:assert/strict';
import { parseLink, pickFile, columnsOf, cleanRow, readDataset, openDataPart, addresses, MAX_ROWS } from '../../../renderer/chat/graph/parts/opendata.mjs';

const RID = '47ac11c2-8a00-46a7-9fa8-9b802643f975';
const DSID = '5de8f397634f4164071119c5';
const TAB = `https://tabular-api.data.gouv.fr/api/resources/${RID}`;
const NOT_FOUND = { ok: false, code: 'E_HTTP', status: 404, message: '' };

/** A fake data.gouv.fr: answers by address, records every address asked. @param {Record<string, any>} over */
function farm(over = {}) {
  /** @type {string[]} */ const asked = [];
  const row = (/** @type {number} */ i) => ({ __id: i, '\uFEFFNom': `Festival ${i}`, Discipline: i % 2 ? 'Musique' : 'Livre' });
  /** @type {Record<string, any>} */ const answers = {
    [addresses.file(RID)]: { resource: { id: RID, title: 'festivals.csv', format: 'csv', url: 'https://producer.example/file.csv' }, dataset_id: DSID },
    [addresses.dataset('liste-des-festivals')]: { id: DSID, title: 'Liste des festivals', organization: { name: 'Ministère de la Culture' }, license: 'lov2', last_update: '2026-09-17T10:00:00', page: 'https://www.data.gouv.fr/datasets/liste-des-festivals', description: 'Les festivals.' },
    [addresses.dataset(DSID)]: { id: DSID, title: 'Liste des festivals', page: 'https://www.data.gouv.fr/datasets/liste-des-festivals' },
    [addresses.files(DSID)]: { data: [
      { id: 'aaaaaaaa-0000-0000-0000-000000000000', format: 'pdf', type: 'documentation', extras: {} },
      { id: RID, title: 'festivals.csv', format: 'csv', type: 'main', extras: { 'analysis:parsing:parsing_table': 'x' } },
    ] },
    [addresses.profile(RID)]: { profile: {
      header: ['\uFEFFNom', 'Discipline'],
      columns: { Nom: { format: 'string', python_type: 'string' }, Discipline: { format: 'string', python_type: 'string' } },
      profile: { Nom: { nb_distinct: 250, nb_missing_values: 0 }, Discipline: { nb_distinct: 2, nb_missing_values: 0, tops: [{ value: 'Musique', count: 125 }, { value: 'Livre', count: 125 }] } },
    } },
    ...over,
  };
  /** Any page of a 250-row table, unless a test answered that address itself. @param {string} url */
  const page = (url) => {
    const m = /\/data\/\?page=(\d+)&page_size=(\d+)$/.exec(url);
    if (!url.startsWith(`${TAB}/data/`) || !m) return undefined;
    const from = (Number(m[1]) - 1) * Number(m[2]);
    const n = Math.max(0, Math.min(Number(m[2]), 250 - from));
    return { data: Array.from({ length: n }, (_, i) => row(from + i + 1)), meta: { total: 250 }, links: { next: from + n < 250 ? 'more' : null } };
  };
  return {
    asked,
    get: async (/** @type {string} */ url) => {
      asked.push(url);
      const a = url in answers ? answers[url] : page(url);
      if (a && a.fail) return a.fail;
      return a ? { ok: true, url, status: 200, contentType: 'application/json', text: JSON.stringify(a), bytes: 10 } : { ok: false, code: 'E_HTTP', status: 404, message: '' };
    },
  };
}

/** Run the part itself with a fake window.lol.io door. @param {any} door @param {any} part */
async function runWith(door, part) {
  const saved = globalThis.window;
  /** @type {any} */ (globalThis).window = { lol: { io: { get: door.get } } };
  try {
    return await openDataPart.run(/** @type {any} */ ({ part, inputs: {}, signal: new AbortController().signal }));
  } finally {
    /** @type {any} */ (globalThis).window = saved;
  }
}

export default (test) => {
  test('open data: a pasted link names a dataset, a file, or both — data.gouv.fr only', () => {
    assert.deepEqual(parseLink('https://www.data.gouv.fr/fr/datasets/liste-des-festivals/'), { dataset: 'liste-des-festivals' });
    assert.deepEqual(parseLink('  https://www.data.gouv.fr/datasets/liste-des-festivals  '), { dataset: 'liste-des-festivals' });
    assert.deepEqual(parseLink(`https://www.data.gouv.fr/fr/datasets/r/${RID}`), { resource: RID }, 'a file link');
    assert.deepEqual(parseLink(`https://www.data.gouv.fr/datasets/liste-des-festivals/#/resources/${RID}`), { dataset: 'liste-des-festivals', resource: RID });
    assert.deepEqual(parseLink(`https://www.data.gouv.fr/datasets/liste-des-festivals?resource_id=${RID.toUpperCase()}`), { dataset: 'liste-des-festivals', resource: RID });
    assert.deepEqual(parseLink(`https://www.data.gouv.fr/api/1/datasets/${DSID}/`), { dataset: DSID });
    assert.deepEqual(parseLink(`${TAB}/data/?page_size=20`), { resource: RID }, 'a tabular-API address');
    assert.deepEqual(parseLink(RID), { resource: RID });
    assert.deepEqual(parseLink(DSID), { dataset: DSID });
    for (const bad of ['', 'festivals', 'https://example.org/datasets/x', 'https://data.gouv.fr.evil.example/datasets/x', 'javascript:alert(1)', 'https://www.data.gouv.fr/fr/', 'ftp://www.data.gouv.fr/datasets/x']) {
      assert.equal(parseLink(bad), null, bad);
    }
  });

  test('open data: the file is the first table data.gouv.fr parsed, a main file first', () => {
    const t = (/** @type {string} */ id, /** @type {string} */ type, /** @type {boolean} */ parsed) => ({ id, type, extras: parsed ? { 'analysis:parsing:parsing_table': 'x' } : {} });
    assert.equal(pickFile([t('a', 'main', false), t('b', 'documentation', true), t('c', 'main', true)]).id, 'c');
    assert.equal(pickFile([t('a', 'main', false), t('b', 'documentation', true)]).id, 'b');
    assert.equal(pickFile([t('a', 'main', false)]), null);
    assert.equal(pickFile(undefined), null);
  });

  test('open data: columns in the file\'s order, names without the byte-order mark real CSVs carry', () => {
    const cols = columnsOf({ profile: {
      header: ['\uFEFFNom', 'N'],
      columns: { Nom: { format: 'string', python_type: 'string' }, N: { format: 'int', python_type: 'int' } },
      profile: { Nom: { nb_distinct: 3, nb_missing_values: 1, tops: Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, count: 12 - i })) }, N: { min: 1, max: 9, mean: 5, std: 2 } },
    } });
    assert.deepEqual(cols.map((c) => c.name), ['Nom', 'N']);
    assert.equal(cols[0].tops.length, 10, 'the ten most common');
    assert.deepEqual([cols[0].distinct, cols[0].missing, cols[1].min, cols[1].max, cols[1].type], [3, 1, 1, 9, 'int']);
    assert.deepEqual(columnsOf(null, { __id: 1, '\uFEFFa': 1, b: 2 }), [{ name: 'a' }, { name: 'b' }], 'no profile: the first row\'s names');
    assert.deepEqual(cleanRow({ __id: 7, '\uFEFFa': 1 }), { a: 1 });
  });

  test('open data: a dataset link asks exactly the dataset, its files, the profile and the pages — never the producer', async () => {
    const f = farm();
    const v = await readDataset(f, { dataset: 'liste-des-festivals' }, 250);
    assert.deepEqual(f.asked, [
      addresses.dataset('liste-des-festivals'), addresses.files(DSID), addresses.profile(RID),
      addresses.rows(RID, 1, 200), addresses.rows(RID, 2, 200),
    ]);
    assert.ok(f.asked.every((u) => /^https:\/\/(www|tabular-api)\.data\.gouv\.fr\//.test(u)), 'data.gouv.fr only');
    assert.equal(v.rows.length, 250);
    assert.deepEqual(v.rows[0], { Nom: 'Festival 1', Discipline: 'Musique' }, 'rows without __id and the BOM');
    assert.deepEqual([v.total, v.read, v.columns.length, v.file.id], [250, 250, 2, RID]);
    assert.deepEqual(v.dataset, { title: 'Liste des festivals', organization: 'Ministère de la Culture', licence: 'lov2', updated: '2026-09-17', page: 'https://www.data.gouv.fr/datasets/liste-des-festivals', description: 'Les festivals.' });
    const small = farm({ [addresses.rows(RID, 1, 20)]: { data: Array.from({ length: 20 }, (_, i) => ({ __id: i })), meta: { total: 250 }, links: { next: 'more' } } });
    assert.equal((await readDataset(small, { dataset: 'liste-des-festivals' }, 20)).read, 20, 'one page of exactly the rows asked');
    assert.equal(small.asked.filter((u) => u.includes('/data/')).length, 1);
  });

  test('open data: a file link finds its dataset; the failures read as sentences', async () => {
    const f = farm();
    const v = await readDataset(f, { resource: RID }, 10);
    assert.deepEqual(f.asked.slice(0, 3), [addresses.file(RID), addresses.dataset(DSID), addresses.profile(RID)], 'no files listing: the file is known');
    assert.equal(v.file.title, 'festivals.csv');
    await assert.rejects(readDataset(farm(), { dataset: 'nope' }, 10), /no dataset at that link/);
    await assert.rejects(readDataset(farm(), { resource: 'bbbbbbbb-0000-0000-0000-000000000000' }, 10), /no file at that link/);
    await assert.rejects(readDataset(farm({ [addresses.files(DSID)]: { data: [{ id: 'x', format: 'PDF', extras: {} }, { id: 'y', format: 'zip', extras: {} }] } }), { dataset: DSID }, 10),
      /files: pdf, zip/);
    await assert.rejects(readDataset(farm({ [addresses.rows(RID, 1, 10)]: { fail: NOT_FOUND }, [addresses.profile(RID)]: { fail: NOT_FOUND } }), { resource: RID }, 10), /not turned “festivals.csv” into a table/);
    const noProfile = await readDataset(farm({ [addresses.profile(RID)]: { fail: NOT_FOUND }, [addresses.rows(RID, 1, 10)]: { data: [{ __id: 1, a: 1 }], meta: { total: 1 }, links: {} } }), { resource: RID }, 10);
    assert.deepEqual(noProfile.columns, [{ name: 'a' }], 'no profile: the columns come from the rows');
  });

  test('open data: offline keeps the last copy and says so; a refusal never does; MAX_ROWS caps the ask', async () => {
    const prev = { kind: 'json', data: { rows: [] } };
    const part = { id: 'o1', type: 'opendata', settings: { link: 'https://www.data.gouv.fr/datasets/liste-des-festivals', rows: 5 }, value: prev };
    const offline = farm({ [addresses.dataset('liste-des-festivals')]: { fail: { ok: false, code: 'E_DNS', message: 'www.data.gouv.fr' } } });
    assert.deepEqual(await runWith(offline, part), prev);
    const down = farm({ [addresses.dataset('liste-des-festivals')]: { fail: { ok: false, code: 'E_HTTP', status: 503, message: '' } } });
    await assert.rejects(runWith(down, part), /503/);
    await assert.rejects(runWith(offline, { ...part, value: undefined }), /could not be found/, 'nothing to fall back on');
    await assert.rejects(runWith(farm(), { ...part, settings: { link: 'https://example.org/x' } }), /not a data.gouv.fr link/);
    await assert.rejects(runWith(farm(), { ...part, settings: { link: ' ' } }), /Paste the link/);
    const big = farm();
    await runWith(big, { ...part, settings: { link: `https://www.data.gouv.fr/datasets/r/${RID}`, rows: 99999 }, value: undefined });
    assert.ok(big.asked.includes(addresses.rows(RID, 1, 200)), 'pages of 200');
    assert.equal(MAX_ROWS, 1000);
    assert.deepEqual(openDataPart.inputs, [], 'no input port: only a person picks the dataset');
  });
};
