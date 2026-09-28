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

// K7 (addendum KG): the additive `debugLog` property, the SAME shape as shell/src/preload/index.ts,
// present only when main.cjs wired the real writer (build/main/debugLog.js exists).
const HAS_DEBUGLOG = process.argv.includes('--lol-debuglog=1');
const debugLog = {};
for (const op of ['start', 'append', 'stop', 'mark', 'reveal', 'status']) debugLog[op] = (...args) => ipcRenderer.invoke(`lol:debugLog:${op}`, ...args);

const api = { getBlenderConnection: () => ipcRenderer.invoke('harness:blender') };
if (HAS_PROJECTS) api.projects = projects;
if (HAS_DEBUGLOG) api.debugLog = debugLog;
// Ecosystem plan v2 §4.2: the additive `io` property (the Fetch box), present only when main.cjs wired
// the real io.js (build/main/io.js exists).
if (process.argv.includes('--lol-io=1')) api.io = {
    get: (url, opts) => ipcRenderer.invoke('lol:io:fetch', url, opts),
    send: (req) => ipcRenderer.invoke('lol:io:send', req),
    arm: (on) => ipcRenderer.invoke('lol:io:arm', on),
    armed: () => ipcRenderer.invoke('lol:io:armed'),
    panic: () => ipcRenderer.invoke('lol:io:panic'),
};
// The IDE's coding agent (docs/IDE_PLAN.md), the SAME shape as shell/src/preload/index.ts, present only when
// main.cjs wired the real runner over the mock dsh (build/main/studio.js exists).
if (process.argv.includes('--lol-studio=1')) api.studio = {
    prompt: (o) => ipcRenderer.invoke('lol:studio:prompt', o),
    stop: () => ipcRenderer.invoke('lol:studio:stop'),
    status: () => ipcRenderer.invoke('lol:studio:status'),
    serve: (projectId) => ipcRenderer.invoke('lol:studio:serve', projectId),
    share: (projectId, on) => ipcRenderer.invoke('lol:studio:share', projectId, on),
    history: (projectId) => ipcRenderer.invoke('lol:studio:history', projectId),
    changes: (projectId, oid) => ipcRenderer.invoke('lol:studio:changes', projectId, oid),
    commit: (projectId, message) => ipcRenderer.invoke('lol:studio:commit', projectId, message),
    restore: (projectId, oid) => ipcRenderer.invoke('lol:studio:restore', projectId, oid),
    remote: (projectId, url) => ipcRenderer.invoke('lol:studio:remote', projectId, url),
    token: (projectId, token) => ipcRenderer.invoke('lol:studio:token', projectId, token),
    push: (projectId) => ipcRenderer.invoke('lol:studio:push', projectId),
    pull: (projectId) => ipcRenderer.invoke('lol:studio:pull', projectId),
    install: () => ipcRenderer.invoke('lol:studio:install'),
    onEvent: (fn) => { ipcRenderer.on('lol:studio:event', (_e, msg) => fn(msg)); },
};
contextBridge.exposeInMainWorld('lol', api);
