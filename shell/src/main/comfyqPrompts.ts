// Prompts for ComfyQ (owner, 2026-11-02): two tools of the Computer's MCP server (mcp.ts) that help Open WebUI's model
// write a prompt for one of ComfyQ's workflows (https://github.com/b2renger/ComfyQ — the studio's ComfyUI booking app).
// Writing only: nothing here reaches ComfyQ or looks for a machine. The person copies the text into ComfyQ's form.
//
//   - PURE DATA: comfyqPrompts.json, GENERATED from a ComfyQ checkout's workflow bundles by
//     scripts/gen-comfyq-prompts.cjs (re-run it when ComfyQ's workflows change). No network, and nothing about the
//     person is read or kept: the tools answer from that file, here in main.
//   - Facts only: each workflow's own prompt guides (official links + a one-line tip), its form's text fields with the
//     text ComfyQ ships in them, and the sizes and lengths its form offers. A workflow without a guide gets none.
//   - A name that matches several workflows is answered with the candidates, never guessed.

import type { McpTool } from './mcp';
import DATA from './comfyqPrompts.json';

type Out = { text: string; isError?: boolean };
interface Input { type: string; label: string; required: boolean; onlyWhen?: string }
interface Field { label: string; required: boolean; negative?: boolean; format?: string; onlyWhen?: string; example?: string }
interface Workflow {
    id: string; name: string; category: string; kind: string; description: string; tags?: string[]; experimental?: boolean;
    inputs: Input[]; promptGuides: { label: string; url: string; tip?: string }[]; fields: Field[];
    switches?: { label: string; default: boolean; onlyWhen?: string }[];
    choices?: { label: string; options?: string[]; fromBox?: boolean; default?: unknown; onlyWhen?: string }[];
    limits?: { label: string; min?: number; max?: number; step?: number; default?: unknown; onlyWhen?: string }[];
}
interface NoPrompt { id: string; name: string; kind: string; inputs: Input[] }
interface Data { comfyq: { repo: string; commit: string | null; date: string | null }; kinds: { id: string; label: string }[]; workflows: Workflow[]; noPrompt: NoPrompt[] }

const D = DATA as unknown as Data;
const MAX_CANDIDATES = 15;

export const COMFYQ_TOOLS: McpTool[] = [
    {
        name: 'comfyq_models',
        description: 'List the image, video, audio and 3D generation models of ComfyQ (the studio\'s ComfyUI app), as workflows grouped by kind: id, name, what the person uploads besides the prompt, and whether it has a prompt guide. Call it when someone asks which models ComfyQ has, or wants a prompt for an image, video or sound generator without naming one. kind (optional): image, image-edit, video, video-edit, audio, description, utility, 3d. Reads a list bundled with this app: nothing is sent anywhere.',
        inputSchema: { type: 'object', properties: { kind: { type: 'string', description: 'Only this kind of workflow, e.g. image or video.' } } },
    },
    {
        name: 'comfyq_prompt_guide',
        description: 'Call this BEFORE writing a prompt for an image, video, music, sound or 3D generation model (FLUX.2 Klein, Qwen Image, Krea 2, Ideogram 4, LTX 2.5, MiniMax H3, Wan, Stable Audio 3, YuE2…) or for ComfyQ. model = a workflow id from comfyq_models, or a model name. It returns that ComfyQ workflow\'s official prompt guide and tip, the text fields of its form with the example ComfyQ ships, whether it has a negative prompt, and the sizes and durations to pick; then write the prompt following it, ready for the person to paste into ComfyQ. A name that matches several workflows returns the candidates. Nothing is sent anywhere.',
        inputSchema: { type: 'object', properties: { model: { type: 'string', description: 'A workflow id (e.g. image_flux2_klein_9b_t2i) or a model name (e.g. LTX 2.5 image to video).' } }, required: ['model'] },
    },
];
export const COMFYQ_TOOL_NAMES: ReadonlySet<string> = new Set(COMFYQ_TOOLS.map((t) => t.name));

const KIND_LABEL = new Map(D.kinds.map((k) => [k.id, k.label]));
const WORDS: Record<string, [string, string]> = {
    image: ['picture', 'pictures'], mask: ['picture to paint on', 'pictures to paint on'], video: ['video', 'videos'],
    audio: ['sound file', 'sound files'], model3d: ['3D model', '3D models'], camera: ['camera position', 'camera positions'],
};
const counted = (inputs: Input[]) => {
    const n = new Map<string, number>();
    for (const i of inputs) n.set(i.type, (n.get(i.type) || 0) + 1);
    return [...n].map(([t, c]) => { const w = WORDS[t] || [t, `${t}s`]; return c === 1 ? `a ${w[0]}` : `${c} ${w[1]}`; }).join(' and ');
};
/** "text only" / "needs a picture" / "needs a video; optional: 16 pictures". */
function needs(inputs: Input[]): string {
    const req = inputs.filter((i) => i.required);
    const opt = inputs.filter((i) => !i.required);
    if (!inputs.length) return 'text only';
    return [req.length ? `needs ${counted(req)}` : '', opt.length ? `optional: ${counted(opt)}` : ''].filter(Boolean).join('; ');
}
const line = (w: Workflow | NoPrompt) => `- ${w.id} · ${w.name} · ${needs(w.inputs)}${'fields' in w ? (w.promptGuides.length ? ' · prompt guide' : ' · no prompt guide') : ''}`;
const source = () => `ComfyQ ${D.comfyq.commit ? D.comfyq.commit.slice(0, 7) : '(unknown version)'}${D.comfyq.date ? `, ${D.comfyq.date}` : ''}`;

const squash = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
/** Words that never tell one workflow from another, whatever names happen to contain them. */
const FILLER = new Set(['the', 'a', 'an', 'of', 'for', 'me', 'please', 'model', 'models', 'workflow', 'workflows', 'comfyq']);
/** Words of a query; a version glued back to its name ("FLUX.2" / "flux 2" → flux2, "LTX 2.5" → ltx25). */
const tokens = (q: string) => q.toLowerCase().replace(/([a-z])[\s._-]+(?=\d)/g, '$1').split(/\s+/).map(squash).filter((t) => t && !FILLER.has(t));
const hay = (w: Workflow | NoPrompt) => squash([w.id, w.name, ...('tags' in w && w.tags ? w.tags : [])].join(' '));
const ALL: (Workflow | NoPrompt)[] = [...D.workflows, ...D.noPrompt];

/** One workflow, the candidates, or nothing. Exact id or name first; else every word of the query that names
 * something in the list must be in the workflow's id, name or tags (a word that names nothing, like "model", is
 * left out). */
export function findWorkflow(q: string): { hit?: Workflow | NoPrompt; candidates?: (Workflow | NoPrompt)[] } {
    const s = squash(q);
    if (!s) return {};
    const exact = ALL.find((w) => squash(w.id) === s || squash(w.name) === s);
    if (exact) return { hit: exact };
    const useful = tokens(q).filter((t) => ALL.some((w) => hay(w).includes(t)));
    if (!useful.length) return {};
    const found = ALL.filter((w) => useful.every((t) => hay(w).includes(t)));
    if (found.length === 1) return { hit: found[0] };
    return found.length ? { candidates: found } : {};
}

function kindOf(k: string): string | null {
    const s = squash(k);
    const hit = D.kinds.find((x) => squash(x.id) === s || squash(x.label) === s);
    if (hit) return hit.id;
    const byCategory = D.workflows.find((w) => squash(w.category) === s);
    return byCategory ? byCategory.kind : null;
}

function models(args: Record<string, unknown>): Out {
    const asked = typeof args.kind === 'string' && args.kind.trim() ? args.kind.trim() : '';
    const kind = asked ? kindOf(asked) : null;
    if (asked && !kind) return { text: `ComfyQ has no kind "${asked}". Kinds: ${D.kinds.map((k) => `${k.id} (${k.label})`).join(', ')}.` };
    const out = [`ComfyQ's workflows that take a text prompt (from ${source()}). Before writing a prompt for one, call comfyq_prompt_guide with its id.`];
    for (const k of D.kinds) {
        if (kind && k.id !== kind) continue;
        const ws = D.workflows.filter((w) => w.kind === k.id);
        if (ws.length) out.push('', `## ${k.label} (${ws.length})`, ...ws.map(line));
    }
    const none = D.noPrompt.filter((w) => !kind || w.kind === kind);
    if (none.length) out.push('', `Also in ComfyQ, with no text prompt to write (the pictures, video or settings do it): ${none.map((w) => w.name).join('; ')}.`);
    if (kind && out.length === 1) out.push('', `None of kind ${kind}.`);
    return { text: out.join('\n') };
}

const quoted = (s: string) => `"${s}"`;
const range = (l: NonNullable<Workflow['limits']>[number]) => {
    const parts: string[] = [];
    if (l.min !== undefined || l.max !== undefined) parts.push(`${l.min ?? '?'} to ${l.max ?? '?'}`);
    if (l.step !== undefined) parts.push(`step ${l.step}`);
    if (l.default !== undefined) parts.push(`default ${l.default}`);
    return parts.join(', ');
};
const when = (o: { onlyWhen?: string }) => (o.onlyWhen ? `; used only when ${o.onlyWhen}` : '');

/** Everything a model needs to write one workflow's prompt, and what to do with it. */
export function guideText(w: Workflow): string {
    const out = [
        `ComfyQ workflow: ${w.name}`,
        `id: ${w.id} · ${KIND_LABEL.get(w.kind) || w.kind} (ComfyQ category ${w.category})${w.experimental ? ' · marked experimental in ComfyQ' : ''} · from ${source()}`,
        '', 'What the workflow says about itself:', w.description || '(no description)',
        '', 'What the person gives besides the text, in ComfyQ\'s form:',
        ...(w.inputs.length ? w.inputs.map((i) => `- ${i.label} (${(WORDS[i.type] || [i.type])[0]}, ${i.required ? 'required' : 'optional'}${when(i)})`) : ['- nothing: text only.']),
        '',
    ];
    if (w.promptGuides.length) {
        out.push('Prompt guide (linked by ComfyQ for this workflow):');
        for (const g of w.promptGuides) out.push(`- ${g.label}: ${g.url}`, ...(g.tip ? [`  Tip: ${g.tip}`] : []));
    } else out.push('No prompt guide in ComfyQ for this workflow: go by its description above and the example below, and tell the person there is no guide.');
    out.push('', 'Text fields of ComfyQ\'s form:');
    for (const f of w.fields) {
        out.push(`- ${quoted(f.label)} (${f.required ? 'required' : 'optional'}${f.negative ? '; a negative prompt: what to keep out' : ''}${f.format ? `; ${f.format}` : ''}${when(f)})`);
        out.push(f.example ? `  The text ComfyQ ships in it, as an example (where it differs from the guide, follow the guide):\n  ${f.example.replace(/\n/g, '\n  ')}` : '  Empty by default.');
    }
    if (!w.fields.some((f) => f.negative)) out.push('- No negative prompt field: say what you want, not what to avoid.');
    if (w.switches?.length) {
        out.push('', 'Switches on the form that change what happens to the text:');
        for (const s of w.switches) out.push(`- ${quoted(s.label)}: ${s.default ? 'on' : 'off'} by default${when(s)}`);
    }
    if (w.choices?.length) {
        out.push('', 'Choices on the form:');
        for (const c of w.choices) {
            const opts = c.fromBox ? 'a list of the ComfyQ box\'s own files' : (c.options || []).join(' | ');
            out.push(`- ${c.label}: ${opts}${c.default !== undefined ? ` (default ${c.default})` : ''}${when(c)}`);
        }
    }
    if (w.limits?.length) {
        out.push('', 'Size, length and steps on the form:');
        for (const l of w.limits) out.push(`- ${l.label}: ${range(l)}${when(l)}`);
    }
    out.push('', 'Now write the text for this workflow, following the guide\'s tips to the letter (with no guide: its description and example). '
        + 'Write in English unless the guide or the description says the model reads another language; words to show in the picture or to sing keep the language the person wants. '
        + 'Give it ready to paste into ComfyQ\'s form: one block per text field, under that field\'s name (leave out an optional field that is not needed), '
        + 'then say which size or aspect ratio and which duration to choose there. Nothing is sent to ComfyQ from here: the person copies the text into its form.');
    return out.join('\n');
}

function guide(args: Record<string, unknown>): Out {
    const q = typeof args.model === 'string' ? args.model.trim() : '';
    if (!q) return { text: 'Say which model or workflow: comfyq_models lists ComfyQ\'s workflows with their ids.' };
    const { hit, candidates } = findWorkflow(q);
    if (hit && 'fields' in hit) return { text: guideText(hit) };
    if (hit) return { text: `${hit.name} (${hit.id}) takes no text prompt in ComfyQ: there is nothing to write. It ${needs(hit.inputs)} and its settings, chosen in ComfyQ's form.` };
    if (candidates) {
        const more = candidates.length > MAX_CANDIDATES ? [`…and ${candidates.length - MAX_CANDIDATES} more: use more of the name.`] : [];
        return { text: [`"${q}" matches ${candidates.length} ComfyQ workflows. Call comfyq_prompt_guide again with one id, or ask the person which one they will use:`,
            ...candidates.slice(0, MAX_CANDIDATES).map(line), ...more].join('\n') };
    }
    return { text: `No ComfyQ workflow matches "${q}". comfyq_models lists them, with their ids.` };
}

/** PURE: one ComfyQ tool call → its text. */
export function comfyqCall(name: string, args: Record<string, unknown>): Out {
    if (name === 'comfyq_models') return models(args || {});
    if (name === 'comfyq_prompt_guide') return guide(args || {});
    return { text: `no tool named ${name}`, isError: true };
}

/** The MCP server's tools and calls with ComfyQ's two in them, answered HERE, in main — never carried to the page. */
export function withComfyq(base: { tools: () => McpTool[]; call: (name: string, args: Record<string, unknown>) => Promise<Out> }) {
    return {
        tools: () => [...base.tools(), ...COMFYQ_TOOLS],
        call: (name: string, args: Record<string, unknown>) => (COMFYQ_TOOL_NAMES.has(name) ? Promise.resolve(comfyqCall(name, args)) : base.call(name, args)),
    };
}
