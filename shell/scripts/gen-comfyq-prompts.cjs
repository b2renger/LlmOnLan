// node scripts/gen-comfyq-prompts.cjs <path to a ComfyQ checkout>   (from shell/)
//
// Writes src/main/comfyqPrompts.json: for each ComfyQ workflow that takes a text prompt, what a chat model needs to
// write that prompt (comfyqPrompts.ts serves it as two MCP tools). Read ONLY from the checkout's
// workflows/<id>/<id>.meta.json (ComfyQ's server/config/schemas.js is their schema) and `git rev-parse HEAD`; nothing
// is added that the bundles do not say. Re-run it whenever ComfyQ's workflows change; a unit test keeps the committed
// file equal to this script's output for the commit it names (comfyq-prompts.test.mjs).
//
// required by the test: module.exports.build(dir) returns the file's text without writing anything.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'src', 'main', 'comfyqPrompts.json');

// ComfyQ's own user-facing taxonomy, in its order (client/src/components/WorkflowSelector.jsx GROUPS and
// CATEGORY_GROUP): a meta category maps to exactly one group; an unknown category is "other", as there.
const KINDS = [
    ['3d', '3D'], ['audio', 'Audio'], ['description', 'Description'], ['image', 'Image generation'],
    ['image-edit', 'Image editing'], ['video', 'Video generation'], ['video-edit', 'Video editing'],
    ['utility', 'Utilities'], ['other', 'Other'],
];
const KIND_OF = {
    '3d': '3d', audio: 'audio', description: 'description', t2i: 'image', 'image-edit': 'image-edit',
    i2v: 'video', 'video-edit': 'video-edit', i2i: 'utility', preprocessor: 'utility', other: 'other',
};

const TEXT = new Set(['text', 'textarea']);
const MEDIA = new Set(['image', 'video', 'audio', 'mask', 'model3d', 'camera']);
// Number fields that shape what the prompt should describe: the picture's size and shape, a clip's length, its frames.
const LIMIT = /width|height|megapixel|resolution|\bsize\b|duration|seconds|length|frames|fps|frame rate|steps/i;
const NOT_LIMIT = /batch|seed|strength|threshold|people|guidance|cfg|temperature/i;
// Checkboxes that change what happens to the prompt (an AI rewrite of it, say).
const PROMPT_SWITCH = /prompt|instruction|rewrite/i;
// schemas.js: `format: 'ideogram4-caption'` — "Ideogram 4's structured JSON prompt: the booking form adds the visual
// composer and a format check".
const FORMATS = { 'ideogram4-caption': "Ideogram 4's structured JSON prompt (ComfyQ's form checks the format)" };

/** "used only when X is on", from a param's disabledWhen ({param, equals}: greyed out when that param equals it). */
function onlyWhen(p, params) {
    if (!p.disabledWhen) return undefined;
    const gate = params.find((q) => q.key === p.disabledWhen.param);
    const name = gate ? gate.label : p.disabledWhen.param;
    const eq = p.disabledWhen.equals;
    if (typeof eq === 'boolean') return `${name} is ${eq ? 'off' : 'on'}`;
    return `${name} is not ${JSON.stringify(eq)}`;
}

const nonEmpty = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function entry(m) {
    const params = [...(m.exposedParameters || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const kind = KIND_OF[m.category] || 'other';
    const inputs = params.filter((p) => MEDIA.has(p.type)).map((p) => nonEmpty({
        type: p.type, label: p.label, required: !!p.required, onlyWhen: onlyWhen(p, params),
    }));
    const fields = params.filter((p) => TEXT.has(p.type)).map((p) => nonEmpty({
        label: p.label,
        required: !!p.required,
        negative: /negative/i.test(p.label) || undefined,
        format: p.format ? (FORMATS[p.format] || p.format) : undefined,
        onlyWhen: onlyWhen(p, params),
        example: typeof p.default === 'string' && p.default.trim() ? p.default : undefined,
    }));
    const switches = params.filter((p) => p.type === 'checkbox' && PROMPT_SWITCH.test(p.label)).map((p) => nonEmpty({
        label: p.label, default: !!p.default, onlyWhen: onlyWhen(p, params),
    }));
    const choices = params.filter((p) => p.type === 'select' || p.type === 'lora').map((p) => nonEmpty({
        label: p.label,
        options: p.type === 'select' ? (p.options || []) : undefined,
        fromBox: p.type === 'lora' || undefined,     // the list comes from the ComfyQ box's own files
        default: p.default === undefined || p.default === '' ? undefined : p.default,
        onlyWhen: onlyWhen(p, params),
    }));
    const limits = params.filter((p) => p.type === 'number' && LIMIT.test(p.label) && !NOT_LIMIT.test(p.label)).map((p) => nonEmpty({
        label: p.label, min: p.min, max: p.max, step: p.step, default: p.default, onlyWhen: onlyWhen(p, params),
    }));
    return {
        fields,
        data: nonEmpty({
            id: m.id,
            name: m.name,
            category: m.category || 'other',
            kind,
            description: m.description || '',
            tags: m.tags && m.tags.length ? m.tags : undefined,
            experimental: m.experimental ? true : undefined,
            inputs,
            promptGuides: (m.promptGuides || []).map((g) => nonEmpty({ label: g.label, url: g.url, tip: g.tip || undefined })),
            fields,
            switches: switches.length ? switches : undefined,
            choices: choices.length ? choices : undefined,
            limits: limits.length ? limits : undefined,
        }),
    };
}

function gitOf(dir) {
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    try {
        const commit = git('rev-parse', 'HEAD');
        const date = git('log', '-1', '--format=%cs');
        const dirty = git('status', '--porcelain', '--', 'workflows') !== '';
        return { commit: dirty ? `${commit}+local changes` : commit, date };
    } catch { return { commit: null, date: null }; }
}

function build(dir) {
    const root = path.join(dir, 'workflows');
    if (!fs.existsSync(root)) throw new Error(`${root} does not exist: pass the path of a ComfyQ checkout`);
    const ids = fs.readdirSync(root).filter((d) => !d.startsWith('_') && fs.statSync(path.join(root, d)).isDirectory()).sort();
    const workflows = [];
    const noPrompt = [];
    for (const d of ids) {
        for (const f of fs.readdirSync(path.join(root, d)).filter((x) => x.endsWith('.meta.json')).sort()) {
            const m = JSON.parse(fs.readFileSync(path.join(root, d, f), 'utf8'));
            if (m.schemaVersion !== 1 || !m.id || !m.name) throw new Error(`${d}/${f}: not a ComfyQ workflow meta (schemaVersion 1, id, name)`);
            const { fields, data } = entry(m);
            if (fields.length) workflows.push(data);
            else noPrompt.push(nonEmpty({ id: data.id, name: data.name, kind: data.kind, inputs: data.inputs }));
        }
    }
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const out = {
        about: 'GENERATED by shell/scripts/gen-comfyq-prompts.cjs from a ComfyQ checkout (workflows/*/*.meta.json). Do not edit: re-run it when ComfyQ\'s workflows change.',
        comfyq: { repo: 'https://github.com/b2renger/ComfyQ', ...gitOf(dir) },
        kinds: KINDS.map(([id, label]) => ({ id, label })),
        workflows: workflows.sort(byId),
        noPrompt: noPrompt.sort(byId),
    };
    const text = JSON.stringify(out, null, 2) + '\n';
    // The metas carry non-ASCII (—, ×, ’, 光影溶图): kept as UTF-8, and the text must read back as the same data.
    if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(out)) throw new Error('the JSON does not read back the same');
    return text;
}

module.exports = { build, OUT };

if (require.main === module) {
    const dir = process.argv[2];
    if (!dir) { console.error('usage: node scripts/gen-comfyq-prompts.cjs <path to a ComfyQ checkout>'); process.exit(2); }
    const text = build(path.resolve(dir));
    fs.writeFileSync(OUT, text, 'utf8');
    const data = JSON.parse(text);
    const guides = data.workflows.filter((w) => w.promptGuides.length).length;
    console.log(`${OUT}: ${data.workflows.length} workflows with a text prompt (${guides} with a prompt guide), ` +
        `${data.noPrompt.length} without one, from ComfyQ ${data.comfyq.commit || '(no git)'} (${data.comfyq.date || '?'}).`);
}
