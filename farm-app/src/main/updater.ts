// Update check — MANUAL, not electron-updater. The farm app shares its GitHub repo
// with the client, so electron-updater's /releases/latest resolution can't be used
// (a farm release would either be "latest" and break the client, or be a prerelease
// and be invisible to the updater — see DEVLOG 2026-07-06 b). Instead we query the
// GitHub API for the newest `farm-v*` release (prereleases included), compare versions,
// and point the operator at the download page. There is no in-place install — the
// operator downloads the new installer.

import { app } from 'electron';
import * as https from 'https';

const REPO = process.env.LOL_RELEASE_REPO || 'b2renger/LlmOnLan';
const TAG_PREFIX = 'farm-v';
const UA = 'LlmOnLan-Farm-app';

export interface UpdateInfo { version: string; url: string }
export interface UpdateCheck { current: string; latest?: string; updateAvailable: boolean; url?: string; error?: string }

let onAvailable: ((info: UpdateInfo) => void) | null = null;
let checked = false;

export function setUpdateNotifier(cb: (info: UpdateInfo) => void): void { onAvailable = cb; }

// --- GitHub JSON (redirect-following) ---------------------------------------

function ghJson(apiPath: string, redirects = 0): Promise<any> {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('too many redirects'));
        https.get(`https://api.github.com${apiPath}`, { headers: { 'user-agent': UA, accept: 'application/vnd.github+json' } }, (res) => {
            const loc = res.headers.location;
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
                res.resume();
                // location may be an absolute URL; strip the origin for the recursive call.
                const path = loc.replace(/^https:\/\/api\.github\.com/, '');
                return ghJson(path, redirects + 1).then(resolve, reject);
            }
            let buf = '';
            res.on('data', (c) => { buf += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`GitHub API ${res.statusCode}`));
                try { resolve(JSON.parse(buf)); } catch (e) { reject(e as Error); }
            });
        }).on('error', reject);
    });
}

// --- version helpers --------------------------------------------------------

function parseVer(s: string): [number, number, number] | null {
    const m = s.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function cmp(a: [number, number, number], b: [number, number, number]): number {
    for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
    return 0;
}

// --- public API -------------------------------------------------------------

// Query the newest farm-v* release (prereleases included) and compare to this app.
export async function checkFarmUpdate(): Promise<UpdateCheck> {
    const current = app.getVersion();
    const cur = parseVer(current) || [0, 0, 0];
    try {
        const releases = await ghJson(`/repos/${REPO}/releases?per_page=30`);
        let best: { v: [number, number, number]; tag: string; url: string } | null = null;
        for (const r of releases || []) {
            const tag: string = r.tag_name || '';
            if (!tag.startsWith(TAG_PREFIX)) continue;
            const v = parseVer(tag);
            if (!v) continue;
            if (!best || cmp(v, best.v) > 0) best = { v, tag, url: r.html_url };
        }
        if (!best) return { current, updateAvailable: false };
        return { current, latest: best.tag.slice(TAG_PREFIX.length), updateAvailable: cmp(best.v, cur) > 0, url: best.url };
    } catch (e: any) {
        return { current, updateAvailable: false, error: e?.message || String(e) };
    }
}

// On launch (packaged only), check once and notify the renderer if newer.
export function initUpdateCheck(enabled: boolean): void {
    if (checked || !enabled || !app.isPackaged) return;
    checked = true;
    checkFarmUpdate().then((r) => {
        if (r.updateAvailable && r.latest && r.url) onAvailable?.({ version: r.latest, url: r.url });
    }).catch(() => { /* offline / rate-limited — silent */ });
}
