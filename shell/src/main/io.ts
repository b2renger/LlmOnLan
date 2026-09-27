// The Computer's Fetch box, main-process side (docs/ECOSYSTEM_PLAN.md v2 §4.2). One GET, run here
// rather than in the renderer so an open-data API that sends no CORS header still answers. Every
// rule below exists because a graph is a file anyone can hand you:
//   - http(s) only, no credentials in the URL (a graph carries no secrets);
//   - never this machine or a link-local address — checked on the literal host, AGAIN on every
//     address DNS gives back, and again on every redirect hop (a redirect is a new request);
//   - never the farm's own ports: the farm is reached through its proper doors (seat gate, OCR),
//     not by a box that can loop;
//   - at most FETCH_MAX_BYTES of text, in at most FETCH_TIMEOUT_MS.
// The answer is always {ok:true, …} or {ok:false, code, …}; it never throws across IPC.

import { lookup as dnsLookup } from 'dns/promises';
import * as net from 'net';

/** The largest value a Computer box may hold (renderer graph/serialize.mjs MAX_VALUE_BYTES). */
export const FETCH_MAX_BYTES = 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

// ponytail: the farm's well-known ports, not the ACTIVE farm's actual ones — a farm configured on
// other ports is not covered. Upgrade path: derive the list from discovery's snapshots.
export const FARM_PORTS: ReadonlySet<number> = new Set([4000, 4001, 41997, 11434, 8081, 8880, 8888, 8890, 8891]);

export type FetchCode = 'E_URL' | 'E_SCHEME' | 'E_CREDENTIALS' | 'E_FARM' | 'E_LOCAL' | 'E_DNS'
    | 'E_TIMEOUT' | 'E_SIZE' | 'E_TYPE' | 'E_HTTP' | 'E_REDIRECTS' | 'E_NET';
export type FetchAnswer =
    | { ok: true; url: string; status: number; contentType: string; text: string; bytes: number }
    | { ok: false; code: FetchCode; status?: number; message: string };

/** This machine, "any", or link-local — the addresses a graph may never reach. */
export function blockedAddress(ip: string): boolean {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 127 || a === 0 || (a === 169 && b === 254);
    }
    if (net.isIPv6(ip)) {
        const s = ip.toLowerCase();
        if (s === '::1' || s === '::') return true;
        if (/^fe[89ab]/.test(s)) return true;                          // fe80::/10
        const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        return mapped ? blockedAddress(mapped[1]) : false;
    }
    return true;
}

/** The checks that need no network. */
export function checkUrl(raw: unknown, allowLoopback = false): { ok: true; url: URL } | { ok: false; code: FetchCode } {
    let url: URL;
    try { url = new URL(String(raw ?? '').trim()); } catch { return { ok: false, code: 'E_URL' }; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, code: 'E_SCHEME' };
    if (url.username || url.password) return { ok: false, code: 'E_CREDENTIALS' };
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (FARM_PORTS.has(port)) return { ok: false, code: 'E_FARM' };
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!allowLoopback && (host === 'localhost' || host.endsWith('.localhost'))) return { ok: false, code: 'E_LOCAL' };
    if (!allowLoopback && net.isIP(host) && blockedAddress(host)) return { ok: false, code: 'E_LOCAL' };
    return { ok: true, url };
}

/** A content type this box can hand on as text. */
export function isTextType(ct: string): boolean {
    const t = ct.split(';')[0].trim().toLowerCase();
    return !t || t.startsWith('text/') || /(json|xml|csv|javascript|yaml|x-ndjson)/.test(t);
}

const fail = (code: FetchCode, message: string, status?: number): FetchAnswer => (
    status === undefined ? { ok: false, code, message } : { ok: false, code, message, status });

export interface FetchDeps {
    fetchImpl?: typeof fetch;
    lookup?: (host: string) => Promise<{ address: string }[]>;
    allowLoopback?: boolean;      // the test harness only: fixture servers live on 127.0.0.1
    timeoutMs?: number;
}

/** One GET, following up to MAX_REDIRECTS redirects, each hop re-checked. Never throws. */
export async function fetchText(raw: unknown, deps: FetchDeps = {}): Promise<FetchAnswer> {
    const doFetch = deps.fetchImpl || fetch;
    const lookup = deps.lookup || ((h: string) => dnsLookup(h, { all: true }));
    const allow = !!deps.allowLoopback;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), deps.timeoutMs || FETCH_TIMEOUT_MS);
    try {
        let next: unknown = raw;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const checked = checkUrl(next, allow);
            if (!checked.ok) return fail(checked.code, String(next));
            const url = checked.url;
            const host = url.hostname.replace(/^\[|\]$/g, '');
            if (!net.isIP(host)) {
                // ponytail: checked here, then resolved again by fetch — a DNS answer that changes
                // between the two (rebinding) is not caught. Upgrade path: pin the address with a
                // custom dispatcher once a real attack surface (inbound triggers) exists.
                let addrs: { address: string }[];
                try { addrs = await lookup(host); } catch { return fail('E_DNS', host); }
                if (!allow && addrs.some((a) => blockedAddress(a.address))) return fail('E_LOCAL', host);
            }
            let res: Response;
            try {
                res = await doFetch(url, {
                    redirect: 'manual', signal: ac.signal,
                    headers: { 'User-Agent': 'LlmOnLan-Computer', Accept: '*/*' },
                });
            } catch (e) {
                return ac.signal.aborted ? fail('E_TIMEOUT', url.href) : fail('E_NET', String((e as Error)?.message || e));
            }
            if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
                next = new URL(String(res.headers.get('location')), url).href;
                continue;
            }
            if (res.status >= 400) return fail('E_HTTP', url.href, res.status);
            const contentType = res.headers.get('content-type') || '';
            if (!isTextType(contentType)) return fail('E_TYPE', contentType);
            if (Number(res.headers.get('content-length')) > FETCH_MAX_BYTES) return fail('E_SIZE', url.href);
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            if (res.body) {
                const reader = res.body.getReader();
                for (;;) {
                    let r: ReadableStreamReadResult<Uint8Array>;
                    try { r = await reader.read(); } catch { return ac.signal.aborted ? fail('E_TIMEOUT', url.href) : fail('E_NET', url.href); }
                    if (r.done) break;
                    bytes += r.value.byteLength;
                    if (bytes > FETCH_MAX_BYTES) { ac.abort(); return fail('E_SIZE', url.href); }
                    chunks.push(r.value);
                }
            }
            const text = new TextDecoder().decode(Buffer.concat(chunks));
            return { ok: true, url: url.href, status: res.status, contentType, text, bytes };
        }
        return fail('E_REDIRECTS', String(raw));
    } finally {
        clearTimeout(timer);
    }
}
