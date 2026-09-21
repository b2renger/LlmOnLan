'use strict';
// The harness preload exposes EXACTLY the shape the shell's preload gives LOL Chat and nothing
// else: window.lol.getBlenderConnection() → {url, apiKey} | null (h0-no-real-lol asserts the key
// list). The value comes from <userData>/blender.json, which h.blender.set() writes.
const { contextBridge, ipcRenderer } = require('electron');

// S0 kickoff: the additive `projects` property, in the SAME shape as shell/src/preload/index.ts
// (studio plan 3.8.5) — thin ipcRenderer.invoke wrappers, no event channels, no watcher. It is
// present only when main.cjs wired the real API (build/main/projects.js exists); its ABSENCE is
// exactly what an un-upgraded client looks like, which app.projects must degrade to (memory).
const HAS_PROJECTS = process.argv.includes('--lol-projects=1');
const OPS = [
    'root', 'list', 'create', 'meta', 'update', 'forget', 'listFiles', 'read', 'readBinary',
    'write', 'writeBinary', 'remove', 'reveal', 'open', 'path',
];
const projects = {};
for (const op of OPS) projects[op] = (...args) => ipcRenderer.invoke(`lol:projects:${op}`, ...args);

const api = { getBlenderConnection: () => ipcRenderer.invoke('harness:blender') };
if (HAS_PROJECTS) api.projects = projects;
contextBridge.exposeInMainWorld('lol', api);
