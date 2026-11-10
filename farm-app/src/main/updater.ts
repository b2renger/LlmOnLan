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

// --- GitHub (redirect-following) --------------------------------------------

export type Get = (url: string) => Promise<{ status: number; body: string }>;

function httpGet(url: string, redirects = 0): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('too many redirects'));
        https.get(url, { headers: { 'user-agent': UA, accept: 'application/vnd.github+json, application/atom+xml' } }, (res) => {
            const loc = res.headers.location;
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
                res.resume();
                return httpGet(new URL(loc, url).toString(), redirects + 1).then(resolve, reject);
            }
            let buf = '';
            res.on('data', (c) => { buf += c; });
            res.on('end', () => resolve({ status: res.statusCode || 0, body: buf }));
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

// The newest farm-v* release (prereleases included), compared to this app. First from the releases' Atom feed, a page of
// github.com that lists the 10 newest releases: the GitHub API allows 60 requests an hour to everything behind one public
// address, a school's whole network, and on 2026-11-10 the check said "GitHub API 403" all morning. The API is asked only
// when the feed holds no farm release (ponytail: ten client releases in a row would push it out).
export async function checkFarmUpdate(get: Get = httpGet): Promise<UpdateCheck> {
    const current = app.getVersion();
    const cur = parseVer(current) || [0, 0, 0];
    try {
        const feed = await get(`https://github.com/${REPO}/releases.atom`).catch(() => ({ status: 0, body: '' }));
        // Only the entries' own links: a release note's link to another release is escaped (&quot;) in the feed.
        let tags = feed.status === 200 ? [...feed.body.matchAll(/\/releases\/tag\/([\w.-]+)"/g)].map((m) => m[1]) : [];
        if (!tags.some((t) => t.startsWith(TAG_PREFIX))) {
            const api = await get(`https://api.github.com/repos/${REPO}/releases?per_page=30`);
            if (api.status !== 200) throw new Error(`GitHub API ${api.status}`);
            tags = (JSON.parse(api.body) || []).map((r: any) => String(r.tag_name || ''));
        }
        let best: { v: [number, number, number]; tag: string } | null = null;
        for (const tag of tags) {
            if (!tag.startsWith(TAG_PREFIX)) continue;
            const v = parseVer(tag);
            if (!v) continue;
            if (!best || cmp(v, best.v) > 0) best = { v, tag };
        }
        if (!best) return { current, updateAvailable: false };
        return { current, latest: best.tag.slice(TAG_PREFIX.length), updateAvailable: cmp(best.v, cur) > 0, url: `https://github.com/${REPO}/releases/tag/${best.tag}` };
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
