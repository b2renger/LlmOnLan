// PICTURE_TO_PAGE_PLAN step 1: can a farm model rebuild a page from a picture? The picture goes with the prompt in one
// chat request, as LOL Vibe's plain chat sends it (image_url, a data URL); the answer's ```html block is saved, checked
// with the agent task's own check.js (docs/spike/ide/tasks/t6-ui-shot, t7-scene) and rendered beside the picture.
// The coding agent is left out on purpose: tonight it cannot see pictures (dsh takes a model as text-only unless its
// input is declared, and LOL Vibe declares none; PICTURE_TO_PAGE_PLAN).
//   node picture_page.mjs <base /v1 URL> <model> <ui|scene> <label> [samples=3] [thinking=off|on]
// Writes docs/spike/results/<label>-<kind>-<n>/{index.html,shot.png} and docs/spike/results/<label>-<kind>.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
// <task>: `ui` (t6-ui-shot), `scene` (t7-scene), or a task folder of docs/spike/ide/tasks with a truth.json naming its
// picture and its kind (page or scene).
const [base, model, task, label, samplesArg = '3', thinking = 'off'] = process.argv.slice(2);
const TASKS = path.join(ROOT, 'docs', 'spike', 'ide', 'tasks');
const taskDir = { ui: 't6-ui-shot', scene: 't7-scene' }[task] || task;
const truthFile = path.join(TASKS, String(taskDir), 'truth.json');
const truth = fs.existsSync(truthFile) ? JSON.parse(fs.readFileSync(truthFile, 'utf8')) : task === 'ui' ? { kind: 'page', picture: 'ui.png' } : task === 'scene' ? { kind: 'scene', picture: 'scene.png' } : null;
if (!base || !model || !truth || !label) {
    console.log('usage: node picture_page.mjs <base /v1 URL> <model> <ui|scene|task folder with a truth.json> <label> [samples=3] [thinking=off|on]');
    process.exit(2);
}
const kind = truth.kind === 'page' ? 'ui' : 'scene';
const TASK = path.join(TASKS, taskDir);
const picture = path.join(TASK, 'seed', truth.picture);
const tag = { ui: 'ui', scene: 'scene' }[task] || taskDir;   // the result folders' name: t6/t7 keep theirs
const THREE = path.join(ROOT, 'shell', 'renderer', 'chat', 'sandbox', 'lib', 'three.min.js');
const ASK = {
    ui: 'This picture is a screenshot of a web page. Make an index.html that reproduces it as closely as you can: the same layout, colours, texts and form fields. Plain HTML and CSS in one file, no framework, nothing loaded from the internet. Answer with the whole file in one ```html block.',
    scene: 'This picture shows a 3D scene. Make an index.html that rebuilds it with three.js: load three.min.js from the same folder with a plain script tag (it defines the global THREE; nothing from the internet), and give the scene the same objects, colours, positions, lights and camera view as closely as you can. Render it once to a 1024 x 640 canvas, then set window.__rendered = true. Answer with the whole file in one ```html block.',
}[kind];
const RES = path.join(ROOT, 'docs', 'spike', 'results');
const electron = path.join(ROOT, 'shell', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const render = path.join(ROOT, 'docs', 'spike', 'ide', 'pictures', 'render.js');
const dataUrl = `data:image/png;base64,${fs.readFileSync(picture).toString('base64')}`;

const out = { label, model, kind, task: taskDir, base, thinking, picture: path.relative(ROOT, picture), samples: [] };
for (let i = 1; i <= Number(samplesArg); i++) {
    const t0 = Date.now();
    // One retry on a dropped connection (a reset once in six requests through serve.sh's relay, 2026-11-21).
    const post = (body) => fetch(`${base}/chat/completions`, body).catch(() => fetch(`${base}/chat/completions`, body));
    const r = await post({
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(process.env.LOL_FARM_KEY ? { authorization: `Bearer ${process.env.LOL_FARM_KEY}` } : {}) },
        body: JSON.stringify({
            model, temperature: 0.6, top_p: 0.95, max_tokens: 8192,
            ...(thinking === 'off' ? { chat_template_kwargs: { enable_thinking: false } } : {}),
            messages: [{ role: 'user', content: [{ type: 'text', text: ASK }, { type: 'image_url', image_url: { url: dataUrl } }] }],
        }),
    });
    const j = await r.json().catch(() => ({}));
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const m = /```html\s*([\s\S]*?)```/i.exec(text) || /(<!doctype html[\s\S]*<\/html>)/i.exec(text);
    const dir = path.join(RES, `${label}-${tag}-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    const s = { n: i, status: r.status, secs: +((Date.now() - t0) / 1000).toFixed(1), completionTokens: j.usage ? j.usage.completion_tokens : null, html: !!m };
    if (m) {
        fs.writeFileSync(path.join(dir, 'index.html'), m[1]);
        if (kind === 'scene') fs.copyFileSync(THREE, path.join(dir, 'three.min.js'));
        const chk = spawnSync(process.execPath, [path.join(TASK, 'check.js'), dir], { encoding: 'utf8', timeout: 60000 });
        try { s.check = JSON.parse(chk.stdout.trim().split('\n').pop()); } catch { s.check = { pass: false, raw: chk.stdout + chk.stderr }; }
        const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
        const shot = spawnSync(electron, [render, path.join(dir, 'index.html'), path.join(dir, 'shot.png'), '1024', '640'], { encoding: 'utf8', timeout: 60000, env });
        s.shot = fs.existsSync(path.join(dir, 'shot.png'));
        if (kind === 'scene') fs.rmSync(path.join(dir, 'three.min.js'), { force: true });   // the client's copy; not kept twice
        if (!s.shot) s.shotError = (shot.stderr || shot.stdout || '').slice(-300);
    } else s.answer = text.slice(0, 400) || JSON.stringify(j).slice(0, 400);
    out.samples.push(s);
    console.log(`[${label}] ${tag} ${i}: ${s.status} ${s.secs}s html=${s.html} check=${s.check ? JSON.stringify(s.check) : '-'} shot=${s.shot}`);
}
fs.writeFileSync(path.join(RES, `${label}-${tag}.json`), JSON.stringify(out, null, 1) + '\n');
console.log(`[${label}] ${tag}: ${out.samples.filter((x) => x.check && x.check.pass).length}/${out.samples.length} pass the check → ${path.join(RES, `${label}-${tag}.json`)}`);
