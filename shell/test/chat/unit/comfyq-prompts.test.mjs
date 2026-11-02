// @ts-check
// Prompts for ComfyQ (src/main/comfyqPrompts.ts + the generated comfyqPrompts.json), against the COMPILED main modules:
// the two tools through the MCP server's handleRpc, answered in main and never by the page; the listing grouped by
// ComfyQ's own kinds; a workflow's guide, a name matching several (the candidates, never a guess), an unknown name;
// the data file's shape; and the generator re-run on a ComfyQ checkout giving the committed file byte for byte.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SHELL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BUILD = path.join(SHELL, 'build', 'main');
const DATA_FILE = path.join(SHELL, 'src', 'main', 'comfyqPrompts.json');
const GEN = path.join(SHELL, 'scripts', 'gen-comfyq-prompts.cjs');
// The owner's ComfyQ checkout (read only); another one with LOL_COMFYQ_DIR.
const COMFYQ = process.env.LOL_COMFYQ_DIR || 'E:/ComfyQ';

const rpc = async (/** @type {any} */ M, /** @type {any} */ deps, /** @type {string} */ name, /** @type {object} */ args) =>
  /** @type {any} */ (await M.handleRpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }, deps)).result;

export default async (test) => {
  const M = require(path.join(BUILD, 'mcp.js'));
  const C = require(path.join(BUILD, 'comfyqPrompts.js'));
  const DATA = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  /** @type {string[]} */ const toPage = [];
  const deps = { token: 't', version: '0', ...C.withComfyq({ tools: () => M.TOOLS, call: async (/** @type {string} */ n) => { toPage.push(n); return { text: 'page' }; } }) };

  test('comfyq: both tools are listed beside the Computer\'s, with a schema, and answered in main — never by the page', async () => {
    const list = /** @type {any} */ (await M.handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, deps)).result.tools;
    const names = list.map((/** @type {any} */ t) => t.name);
    assert.ok(names.includes('read_graph'), 'the page\'s tools stay');
    assert.deepEqual(names.filter((/** @type {string} */ n) => n.startsWith('comfyq_')), ['comfyq_models', 'comfyq_prompt_guide']);
    const guide = list.find((/** @type {any} */ t) => t.name === 'comfyq_prompt_guide');
    assert.deepEqual(guide.inputSchema.required, ['model']);
    assert.match(guide.description, /BEFORE writing a prompt for an image, video/);
    assert.match(guide.description, /Nothing is sent anywhere/);
    await rpc(M, deps, 'comfyq_models', {});
    await rpc(M, deps, 'comfyq_prompt_guide', { model: 'ltx 2.5 t2v' });
    await rpc(M, deps, 'read_graph', {});
    assert.deepEqual(toPage, ['read_graph'], 'the page answered its own tool only');
  });

  test('comfyq_models: every workflow with a prompt once, under its kind, in ComfyQ\'s order; a kind filter; an unknown kind', async () => {
    const r = await rpc(M, deps, 'comfyq_models', {});
    assert.equal(r.isError, false);
    const text = r.content[0].text;
    assert.match(text, new RegExp(`from ComfyQ ${DATA.comfyq.commit.slice(0, 7)}`));
    // Each "## <label> (n)" heading, then n lines; together exactly the workflows of that kind.
    const sections = text.split('\n## ').slice(1).map((/** @type {string} */ s) => s.split('\n\n')[0].split('\n'));
    const labels = sections.map((/** @type {string[]} */ s) => s[0].replace(/ \(\d+\)$/, ''));
    const order = DATA.kinds.map((/** @type {any} */ k) => k.label);
    assert.deepEqual(labels, order.filter((/** @type {string} */ l) => labels.includes(l)), 'ComfyQ\'s order');
    let lines = 0;
    for (const s of sections) {
      const kind = DATA.kinds.find((/** @type {any} */ k) => k.label === s[0].replace(/ \(\d+\)$/, '')).id;
      const ids = s.slice(1).filter((/** @type {string} */ l) => l.startsWith('- ')).map((/** @type {string} */ l) => l.slice(2).split(' · ')[0]);
      assert.deepEqual(ids, DATA.workflows.filter((/** @type {any} */ w) => w.kind === kind).map((/** @type {any} */ w) => w.id), kind);
      assert.equal(Number(/\((\d+)\)$/.exec(s[0])?.[1]), ids.length);
      lines += ids.length;
    }
    assert.equal(lines, DATA.workflows.length);
    assert.match(text, /- image_flux2_klein_9b_t2i · Flux2 Klein 9B — text to image · text only · prompt guide/);
    assert.match(text, /- video_ltx2_5_i2v · LTX 2\.5 — image to video \+ audio · needs a picture · prompt guide/);
    assert.match(text, /no text prompt to write.*SeedVR2 — image upscale to 4K/s, 'the workflows with nothing to write are named, not listed as prompts');

    const video = (await rpc(M, deps, 'comfyq_models', { kind: 'video' })).content[0].text;
    assert.match(video, /## Video generation/);
    assert.doesNotMatch(video, /## Image|## Video editing/);
    assert.equal((await rpc(M, deps, 'comfyq_models', { kind: 'i2v' })).content[0].text, video, 'ComfyQ\'s category names its kind');
    assert.equal((await rpc(M, deps, 'comfyq_models', { kind: 'Video generation' })).content[0].text, video, 'and so does the label');
    const bad = await rpc(M, deps, 'comfyq_models', { kind: 'holograms' });
    assert.equal(bad.isError, false);
    assert.match(bad.content[0].text, /^ComfyQ has no kind "holograms"\. Kinds: 3d \(3D\), audio/);
  });

  test('comfyq_prompt_guide: FLUX.2 Klein text to image — its guide, tip, fields, example and sizes, then what to write', async () => {
    for (const model of ['image_flux2_klein_9b_t2i', 'Flux2 Klein 9B — text to image', 'IMAGE_FLUX2_KLEIN_9B_T2I', 'flux.2 klein t2i']) {
      const r = await rpc(M, deps, 'comfyq_prompt_guide', { model });
      assert.equal(r.isError, false, model);
      const text = r.content[0].text;
      assert.match(text, /^ComfyQ workflow: Flux2 Klein 9B — text to image\nid: image_flux2_klein_9b_t2i · Image generation/, model);
      assert.match(text, /- FLUX\.2 prompting guide — Black Forest Labs: https:\/\/docs\.bfl\.ai\/guides\/prompting_guide_flux2/);
      assert.ok(text.includes('Tip: Write full sentences, not keyword lists: subject first, then action, style and setting (30–80 words).'), 'the tip, in ComfyQ\'s own words');
      assert.match(text, /- "Prompt" \(required\)\n {2}The text ComfyQ ships in it, as an example \(where it differs from the guide, follow the guide\):\n {2}A vintage motorcycle parked/);
      assert.match(text, /- "Negative prompt" \(optional; a negative prompt: what to keep out\)\n {2}Empty by default\./);
      assert.match(text, /- Width: 256 to 2048, step 8, default 1024/);
      assert.match(text, /- nothing: text only\./);
      assert.match(text, /Now write the text for this workflow, following the guide's tips to the letter.*ready to paste into ComfyQ's form.*Nothing is sent to ComfyQ from here/s);
    }
  });

  test('comfyq_prompt_guide: no guide in the bundle → none invented; choices, switches and a field used only when a switch is on', async () => {
    const bernini = (await rpc(M, deps, 'comfyq_prompt_guide', { model: 'image_edit_bernini_r_image_editing' })).content[0].text;
    assert.match(bernini, /No prompt guide in ComfyQ for this workflow: go by its description above and the example below/);
    assert.doesNotMatch(bernini, /https:\/\//, 'no link of anyone\'s choosing');
    assert.match(bernini, /- Edit type: Image Editing \| Default \(default Image Editing\)/);
    assert.match(bernini, /No negative prompt field/);
    const real = (await rpc(M, deps, 'comfyq_prompt_guide', { model: 'video_edit_ltx2_3_3dreal_vid2vid' })).content[0].text;
    assert.match(real, /- "Prompt \(AI-enhanced\)" \(optional; used only when Enhance prompt with AI is on\)/);
    assert.match(real, /- "Prompt \(used as-is\)" \(optional; used only when Enhance prompt with AI is off\)/);
    assert.match(real, /- "Enhance prompt with AI": off by default/);
    const ideogram = (await rpc(M, deps, 'comfyq_prompt_guide', { model: 'ideogram 4' })).content[0].text;
    assert.match(ideogram, /\(required; Ideogram 4's structured JSON prompt \(ComfyQ's form checks the format\)\)/);
    assert.match(ideogram, /- Aspect ratio: 1:1 \(Square\) \|.*\(default 9:16 \(Portrait Widescreen\)\)/);
  });

  test('comfyq_prompt_guide: a name matching several → the candidates, never a guess; an unknown name and no name → a plain sentence', async () => {
    for (const model of ['FLUX.2 Klein', 'flux 2 klein', 'the Flux2 Klein model']) {
      const r = await rpc(M, deps, 'comfyq_prompt_guide', { model });
      const text = r.content[0].text;
      assert.equal(r.isError, false);
      assert.match(text, /^".+" matches 6 ComfyQ workflows\. Call comfyq_prompt_guide again with one id, or ask the person which one they will use:/, model);
      assert.match(text, /- image_flux2_klein_9b_t2i · Flux2 Klein 9B — text to image · text only · prompt guide/);
      assert.match(text, /- image_edit_flux2_klein_inpaint_prompt · /);
      assert.doesNotMatch(text, /Tip:|flux3/, 'no guide handed out, and FLUX.3 is another model');
    }
    const many = (await rpc(M, deps, 'comfyq_prompt_guide', { model: 'video' })).content[0].text;
    assert.match(many, /…and \d+ more: use more of the name\./, 'a long list is cut, and says so');
    assert.equal((await rpc(M, deps, 'comfyq_prompt_guide', { model: 'Stable Audio' })).content[0].text.split('\n')[0], 'ComfyQ workflow: Stable Audio 3 Medium — text to audio', 'one match is the answer');
    const none = await rpc(M, deps, 'comfyq_prompt_guide', { model: 'Midjourney v7' });
    assert.deepEqual(none, { content: [{ type: 'text', text: 'No ComfyQ workflow matches "Midjourney v7". comfyq_models lists them, with their ids.' }], isError: false });
    assert.match((await rpc(M, deps, 'comfyq_prompt_guide', {})).content[0].text, /^Say which model or workflow/);
    const upscale = (await rpc(M, deps, 'comfyq_prompt_guide', { model: 'utility_seedvr2_4k_upscale' })).content[0].text;
    assert.match(upscale, /^SeedVR2 — image upscale to 4K \(utility_seedvr2_4k_upscale\) takes no text prompt in ComfyQ: there is nothing to write\. It needs a picture/);
  });

  test('comfyq data: every entry has id, name, category, kind and text fields; every guide is https; the counts add up', () => {
    const kinds = new Set(DATA.kinds.map((/** @type {any} */ k) => k.id));
    assert.match(DATA.comfyq.commit, /^[0-9a-f]{40}/);
    assert.match(DATA.comfyq.date, /^\d{4}-\d\d-\d\d$/);
    const ids = new Set();
    for (const w of DATA.workflows) {
      for (const k of ['id', 'name', 'category', 'kind', 'description']) assert.equal(typeof w[k], 'string', `${w.id}.${k}`);
      assert.ok(w.id && w.name && kinds.has(w.kind), w.id);
      assert.ok(Array.isArray(w.fields) && w.fields.length, `${w.id} has text fields`);
      for (const f of w.fields) assert.ok(typeof f.label === 'string' && f.label && typeof f.required === 'boolean', `${w.id}: ${f.label}`);
      for (const g of w.promptGuides) {
        assert.ok(g.label && new URL(g.url).protocol === 'https:', `${w.id}: ${g.url}`);
        assert.ok(g.tip === undefined || (typeof g.tip === 'string' && g.tip.length), `${w.id}: tip`);
      }
      assert.ok(!ids.has(w.id), `${w.id} once`); ids.add(w.id);
    }
    for (const w of DATA.noPrompt) { assert.ok(w.id && w.name && kinds.has(w.kind), w.id); assert.ok(!ids.has(w.id)); ids.add(w.id); }
    assert.ok(DATA.workflows.length >= 50 && DATA.noPrompt.length >= 1, `${DATA.workflows.length} + ${DATA.noPrompt.length}`);
    assert.ok(DATA.workflows.filter((/** @type {any} */ w) => w.promptGuides.length).length >= 30);
    assert.ok(fs.readFileSync(DATA_FILE, 'utf8').includes('—'), 'UTF-8 kept as such');
  });

  // The committed file is the generator's output for the commit it names. A checkout at another commit (or with local
  // changes in its workflows) is not a failure: it says the file is due to be generated again.
  let gen = null, why = '';
  if (!fs.existsSync(path.join(COMFYQ, 'workflows'))) why = `${COMFYQ} is absent (set LOL_COMFYQ_DIR to a ComfyQ checkout)`;
  else {
    try { gen = require(GEN).build(COMFYQ); } catch (e) { why = `the generator failed on ${COMFYQ}: ${/** @type {Error} */ (e).message}`; }
    const at = gen && JSON.parse(gen).comfyq.commit;
    if (gen && at !== DATA.comfyq.commit) {
      why = `${COMFYQ} is at ${at}, the committed file at ${DATA.comfyq.commit}: re-run node scripts/gen-comfyq-prompts.cjs ${COMFYQ}`;
      gen = null;
    }
  }
  if (gen) {
    const text = gen;
    test('comfyq generator: re-run on the ComfyQ checkout, it gives the committed file byte for byte', () => {
      assert.ok(Buffer.from(text, 'utf8').equals(fs.readFileSync(DATA_FILE)), 'run: node scripts/gen-comfyq-prompts.cjs <ComfyQ>');
    });
  } else test.skip(`comfyq generator byte for byte: skipped — ${why}`);
};
