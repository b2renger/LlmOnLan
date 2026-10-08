// Reap a previous farm run's leftover processes, and run `lol down`.
//
// `lol up` records its child PIDs in <farm>/.lol-runtime.json (LiteLLM, the plugins, llama-server, any Ollama it
// started). The plugins spawn DETACHED (their own process group), so a group-kill of `lol up` — or the app being
// force-quit / Ctrl-C'd in a terminal — can orphan them still holding their ports. On the next launch a fresh app
// process has no handle to them, and if the old LiteLLM is still alive `lol up` refuses to start ("already
// running"). So before (re)starting we read the recorded PIDs and kill whatever's still alive, then drop the stale
// runtime file. Combined with ensurePluginPorts(), this keeps restarts clean even after an ungraceful exit.
//
// It never stops vLLM (docs/VLLM_MANAGED_PLAN.md §3.12): the runtime file records where vLLM lives, not a pid, and the
// next `lol up` keeps a vLLM that still runs. Only `lol down` stops it (the Stop button and Quit, through the
// supervisor's stop()).

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { farmRoot, lolEntry } from './paths';
import { killTree } from './util';
import { appendFarmLog } from './farmLog';

function isAlive(pid: number): boolean {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === 'EPERM'; }
}

export function runtimeFile(): string { return path.join(farmRoot(), '.lol-runtime.json'); }

export async function reapStaleFarm(): Promise<void> {
    const rt = runtimeFile();
    let state: any;
    try { state = JSON.parse(fs.readFileSync(rt, 'utf8')); } catch { return; } // no stale run
    const pids: number[] = [
        state.litellmPid, state.searxngPid, state.kokoroPid, state.extractPid,
        state.classifyPid, state.sttPid, state.busPid, state.llamacppPid,
        ...(Array.isArray(state.ollamaPids) ? state.ollamaPids : []),
    ].filter((p) => typeof p === 'number' && p > 0);
    for (const pid of pids) {
        if (isAlive(pid)) { try { await killTree(pid); } catch { /* best-effort */ } }
    }
    try { fs.unlinkSync(rt); } catch { /* already gone */ }
}

// `lol down`: the farm's own stop — LiteLLM, the plugins and the vLLM it runs — after which `lol up` exits by itself.
// Waits for it, at most 2 minutes (vLLM's stop.sh gives its processes up to 40 s). Its output goes to farm.log.
export function lolDown(env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve) => {
        execFile(process.execPath, [lolEntry(), 'down'], { cwd: farmRoot(), env, timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
            appendFarmLog(`lol down${err ? ` (${err.message.split('\n')[0]})` : ''}\n${stdout || ''}${stderr || ''}`);
            resolve();
        });
    });
}
