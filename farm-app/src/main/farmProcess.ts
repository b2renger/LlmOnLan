// Reap a previous farm run's leftover processes.
//
// `lol up` records its child PIDs in <farm>/.lol-runtime.json (LiteLLM, the SearXNG/
// Kokoro/OCR plugins, any Ollama it started). Those plugins spawn DETACHED (their own
// process group), so a group-kill of `lol up` — or the app being force-quit / Ctrl-C'd
// in a terminal — can orphan them still holding their ports. On the next launch a fresh
// app process has no handle to them, and if the old LiteLLM is still alive `lol up`
// refuses to start ("already running"). So before (re)starting we read the recorded PIDs
// and kill whatever's still alive, then drop the stale runtime file. Combined with
// ensurePluginPorts(), this keeps restarts clean even after an ungraceful exit.

import * as fs from 'fs';
import * as path from 'path';
import { farmRoot } from './paths';
import { killTree } from './util';

function isAlive(pid: number): boolean {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === 'EPERM'; }
}

export async function reapStaleFarm(): Promise<void> {
    const rt = path.join(farmRoot(), '.lol-runtime.json');
    let state: any;
    try { state = JSON.parse(fs.readFileSync(rt, 'utf8')); } catch { return; } // no stale run
    const pids: number[] = [
        state.litellmPid, state.searxngPid, state.kokoroPid, state.extractPid,
        ...(Array.isArray(state.ollamaPids) ? state.ollamaPids : []),
    ].filter((p) => typeof p === 'number' && p > 0);
    for (const pid of pids) {
        if (isAlive(pid)) { try { await killTree(pid); } catch { /* best-effort */ } }
    }
    try { fs.unlinkSync(rt); } catch { /* already gone */ }
}
