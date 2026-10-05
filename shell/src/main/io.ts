// The Computer's Fetch box, main-process side (docs/ECOSYSTEM_PLAN.md v2 §4.2). One GET, run here
// rather than in the renderer so an open-data API that sends no CORS header still answers. Every
// rule below exists because a graph is a file anyone can hand you:
//   - http(s) only, no credentials in the URL (a graph carries no secrets);
//   - never this machine (loopback, or any of its own addresses) or a link-local address — checked on
//     the literal host (an IPv4 carried inside an IPv6 literal included), AGAIN on every address DNS
//     gives back — and the connection goes to exactly those addresses — and again on every redirect hop
//     (a redirect is a new request);
//   - never the farm's own ports: the farm is reached through its proper doors (seat gate, OCR),
//     not by a box that can loop;
//   - at most FETCH_MAX_BYTES of text, in at most FETCH_TIMEOUT_MS.
// Web search (webSearch.ts) reads its pages through the same door, with `publicOnly`: the public internet
// only, never the LAN.
// The answer is always {ok:true, …} or {ok:false, code, …}; it never throws across IPC.

import { lookup as dnsLookup } from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as os from 'os';
import * as zlib from 'zlib';
import { pipeline, Readable } from 'stream';

/** The largest value a Computer box may hold (renderer graph/serialize.mjs MAX_VALUE_BYTES). */
export const FETCH_MAX_BYTES = 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

// ponytail: the farm's well-known ports, not the ACTIVE farm's actual ones — a farm configured on
// other ports is not covered. Upgrade path: derive the list from discovery's snapshots.
export const FARM_PORTS: ReadonlySet<number> = new Set([4000, 4001, 41997, 11434, 8081, 8880, 8888, 8890, 8891, 8892]);

export type FetchCode = 'E_URL' | 'E_SCHEME' | 'E_CREDENTIALS' | 'E_FARM' | 'E_LOCAL' | 'E_DNS'
    | 'E_TIMEOUT' | 'E_SIZE' | 'E_TYPE' | 'E_HTTP' | 'E_REDIRECTS' | 'E_NET' | 'E_HOST';
export type FetchAnswer =
    | { ok: true; url: string; status: number; contentType: string; text: string; bytes: number; truncated?: true }
    | { ok: false; code: FetchCode; status?: number; message: string; detail?: string };

/** An IPv6 literal as its eight 16-bit groups (a trailing dotted quad included), or null. */
export function ipv6Groups(ip: string): number[] | null {
    let s = String(ip).toLowerCase();
    const quad = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (quad) {
        const p = quad.slice(1).map(Number);
        if (p.some((n) => n > 255)) return null;
        s = s.slice(0, -quad[0].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
    }
    const halves = s.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
    const groups = tail === null ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
    if (groups.length !== 8) return null;
    const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
    return nums.every(Number.isFinite) ? nums : null;
}

/** The IPv4 address an IPv6 literal carries — IPv4-mapped (::ffff:a.b.c.d, in dotted OR hex form, which is
 * what `new URL` canonicalises it to), IPv4-compatible (::a.b.c.d) or NAT64 (64:ff9b::/96) — or null. */
export function embeddedIpv4(ip: string): string | null {
    const g = ipv6Groups(ip);
    if (!g) return null;
    const v4 = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    const zeros = (from: number, to: number) => g.slice(from, to).every((n) => n === 0);
    if (zeros(0, 5) && (g[5] === 0xffff || (g[5] === 0 && (g[6] !== 0 || g[7] > 1)))) return v4();
    if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return v4();
    return null;
}

// This machine's own addresses (every interface), read once: a graph may not reach this computer by
// its LAN address either. ponytail: read at first use — an address that arrives later (a new Wi-Fi)
// is not in the list until the app restarts. Upgrade path: re-read on each check if that matters.
let ownAddresses: Set<string> | null = null;
function ownAddress(ip: string): boolean {
    if (!ownAddresses) {
        ownAddresses = new Set();
        for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) ownAddresses.add(String(a.address).toLowerCase().replace(/%.*$/, ''));
    }
    return ownAddresses.has(ip.toLowerCase());
}

/** This machine (loopback or any of its own addresses), "any", or link-local — never reachable. */
export function blockedAddress(ip: string): boolean {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 127 || a === 0 || (a === 169 && b === 254) || ownAddress(ip);
    }
    if (net.isIPv6(ip)) {
        const g = ipv6Groups(ip);
        if (!g) return true;
        if (g.slice(0, 7).every((n) => n === 0) && (g[7] === 0 || g[7] === 1)) return true;   // :: and ::1
        if ((g[0] & 0xffc0) === 0xfe80) return true;                                            // fe80::/10
        const v4 = embeddedIpv4(ip);
        if (v4) return blockedAddress(v4);
        return ownAddress(ip);
    }
    return true;
}

/** Not the public internet (web search reads only that, so a page a search engine hands back never reaches
 * a printer or a router): loopback, the LAN (RFC 1918, CGNAT 100.64/10, IPv6 ULA), link-local, multicast,
 * and the reserved 0/8, 192.0.0/24, 192.0.2/24, 198.18/15, 240/4 and 2001:db8::/32 — an IPv4 inside an IPv6
 * (mapped, compatible, NAT64) by the same rule. NOT all of 192.0/16: a real site answered from 192.0.66.31. */
export function privateAddress(ip: string): boolean {
    if (net.isIPv4(ip)) {
        const [a, b, c] = ip.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2))
            || (a === 198 && (b === 18 || b === 19)) || a >= 224;
    }
    const g = ipv6Groups(ip);
    if (!g) return true;
    const v4 = embeddedIpv4(ip);
    if (v4) return privateAddress(v4);
    return (g.slice(0, 7).every((n) => n === 0) && g[7] <= 1)                                    // :: and ::1
        || (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00   // ULA, link-local, multicast
        || (g[0] === 0x2001 && g[1] === 0x0db8);                                                  // documentation
}

/** The checks that need no network. */
export function checkUrl(raw: unknown, allowLoopback = false, publicOnly = false): { ok: true; url: URL } | { ok: false; code: FetchCode } {
    let url: URL;
    try { url = new URL(String(raw ?? '').trim()); } catch { return { ok: false, code: 'E_URL' }; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, code: 'E_SCHEME' };
    if (url.username || url.password) return { ok: false, code: 'E_CREDENTIALS' };
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (FARM_PORTS.has(port)) return { ok: false, code: 'E_FARM' };
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!allowLoopback && (host === 'localhost' || host.endsWith('.localhost'))) return { ok: false, code: 'E_LOCAL' };
    if (!allowLoopback && net.isIP(host) && (blockedAddress(host) || (publicOnly && privateAddress(host)))) return { ok: false, code: 'E_LOCAL' };
    return { ok: true, url };
}

/** A content type this box can hand on as text. */
export function isTextType(ct: string): boolean {
    const t = ct.split(';')[0].trim().toLowerCase();
    return !t || t.startsWith('text/') || /(json|xml|csv|javascript|yaml|x-ndjson)/.test(t);
}

const fail = (code: FetchCode, message: string, status?: number): FetchAnswer => (
    status === undefined ? { ok: false, code, message } : { ok: false, code, message, status });

/** The start of an error answer's text, one line, ≤ 300 characters — or '' (not text, empty, unreadable). */
async function errorText(res: Response): Promise<string> {
    if (!isTextType(res.headers.get('content-type') || '') || !res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (bytes < 2048) {
            const r = await reader.read();
            if (r.done) break;
            chunks.push(r.value);
            bytes += r.value.byteLength;
        }
    } catch { /* what arrived is enough */ }
    try { await reader.cancel(); } catch { /* already closed */ }
    const text = Buffer.concat(chunks).toString('utf8').replace(/\s+/g, ' ').trim();
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export interface FetchDeps {
    fetchImpl?: typeof fetch;
    lookup?: (host: string) => Promise<{ address: string }[]>;
    allowLoopback?: boolean;      // the test harness only: fixture servers live on 127.0.0.1
    timeoutMs?: number;
    // Only these hosts (`host[:port]`, lower case), for EVERY hop — a redirect included — before any request
    // goes out (critic S3: an Agent's person-listed hosts, Open data's two data.gouv.fr hosts). None: any.
    hosts?: string[];
    publicOnly?: boolean;         // web search: the public internet only (privateAddress), on every hop
    maxBytes?: number;            // FETCH_MAX_BYTES unless said
    truncate?: boolean;           // over maxBytes: keep what arrived (`truncated`) instead of E_SIZE
    headers?: Record<string, string>;   // over the defaults: an Accept-Language, a page reader's User-Agent
}

/** The bytes as text, in the charset the answer declares — its Content-Type, else an HTML page's own
 * <meta> — and UTF-8 when it declares none (or one this runtime does not know). */
export function decodeText(buf: Buffer, contentType: string): string {
    let charset = (contentType.match(/charset\s*=\s*["']?([\w.:-]+)/i) || [])[1];
    if (!charset && (!contentType || /html/i.test(contentType))) {
        charset = (buf.subarray(0, 4096).toString('latin1').match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i) || [])[1];
    }
    try { return new TextDecoder(charset || 'utf-8').decode(buf); } catch { return new TextDecoder().decode(buf); }
}

type Pinned = { address: string; family: number }[];

/** The transport when no fetchImpl is given: one GET over Node's http(s) that connects ONLY to `pinned`, the
 * addresses fetchText has just checked — a DNS answer that changes in between (rebinding) is never used —
 * handed back as a fetch Response, so fetchText reads it like any other. No connection pool: a socket kept
 * for one caller's rules must not serve another's. Decompresses what it asks for, as fetch does. */
function pinnedGet(url: URL, signal: AbortSignal, headers: Record<string, string>, pinned: Pinned | null): Promise<Response> {
    return new Promise((resolve, reject) => {
        const lookup: net.LookupFunction = (_host, o, cb) => process.nextTick(() => (
            o && o.all ? cb(null, pinned!) : cb(null, pinned![0].address, pinned![0].family)));
        const req = (url.protocol === 'https:' ? https : http).get(url, {
            agent: false, signal, headers: { ...headers, 'Accept-Encoding': 'gzip, deflate, br' }, ...(pinned ? { lookup } : {}),
        }, (res) => {
            const enc = String(res.headers['content-encoding'] || '').trim().toLowerCase();
            const z = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };   // lenient, as fetch is
            const unzip = enc === 'gzip' || enc === 'x-gzip' ? zlib.createGunzip(z) : enc === 'deflate' ? zlib.createInflate(z)
                : enc === 'br' ? zlib.createBrotliDecompress({ flush: zlib.constants.BROTLI_OPERATION_FLUSH, finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH }) : null;
            const body = unzip ? pipeline(res, unzip, () => { /* an error reaches the reader */ }) : res;
            try {
                const h = new Headers();
                for (let i = 0; i < res.rawHeaders.length; i += 2) h.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
                const status = res.statusCode || 0;
                resolve(new Response([204, 205, 304].includes(status) ? null : Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>, { status, headers: h }));
            } catch (e) { res.destroy(); reject(e); }
        });
        req.on('error', reject);
    });
}

/** One GET, following up to MAX_REDIRECTS redirects, each hop re-checked. Never throws. */
export async function fetchText(raw: unknown, deps: FetchDeps = {}): Promise<FetchAnswer> {
    const lookup = deps.lookup || ((h: string) => dnsLookup(h, { all: true }));
    const allow = !!deps.allowLoopback;
    const refused = (ip: string) => blockedAddress(ip) || (!!deps.publicOnly && privateAddress(ip));
    const maxBytes = deps.maxBytes || FETCH_MAX_BYTES;
    const headers = { 'User-Agent': 'LlmOnLan-Computer', Accept: '*/*', ...deps.headers };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), deps.timeoutMs || FETCH_TIMEOUT_MS);
    // The time limit covers the DNS lookup too (a resolver can take longer than the whole budget).
    const timedOut = new Promise<never>((_, reject) => ac.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }));
    timedOut.catch(() => { /* read through the race below */ });
    try {
        let next: unknown = raw;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const checked = checkUrl(next, allow, deps.publicOnly);
            if (!checked.ok) return fail(checked.code, String(next));
            const url = checked.url;
            if (deps.hosts && !deps.hosts.includes(url.host.toLowerCase())) return fail('E_HOST', url.host);
            const host = url.hostname.replace(/^\[|\]$/g, '');
            let pinned: Pinned | null = null;
            if (!net.isIP(host)) {
                // Checked here, and pinnedGet connects to exactly these addresses: no second DNS answer.
                let addrs: { address: string }[];
                try { addrs = await Promise.race([lookup(host), timedOut]); } catch { return ac.signal.aborted ? fail('E_TIMEOUT', host) : fail('E_DNS', host); }
                if (!addrs.length) return fail('E_DNS', host);
                if (!allow && addrs.some((a) => refused(a.address))) return fail('E_LOCAL', host);
                pinned = addrs.map((a) => ({ address: a.address, family: net.isIP(a.address) }));
            }
            let res: Response;
            try {
                res = deps.fetchImpl
                    ? await deps.fetchImpl(url, { redirect: 'manual', signal: ac.signal, headers })
                    : await pinnedGet(url, ac.signal, headers, pinned);
            } catch (e) {
                return ac.signal.aborted ? fail('E_TIMEOUT', url.href) : fail('E_NET', String((e as Error)?.message || e));
            }
            if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
                try { await res.body?.cancel(); } catch { /* nothing to drain */ }
                try { next = new URL(String(res.headers.get('location')), url).href; } catch { return fail('E_URL', String(res.headers.get('location'))); }
                continue;
            }
            if (res.status >= 400) {
                // What the site SAID, briefly (the rig: "Page size exceeds allowed maximum: 200" — an agent
                // shown only "400" retried blind five times). At most 2 KB read, 300 characters kept.
                const detail = await errorText(res);
                return detail ? { ok: false, code: 'E_HTTP', message: url.href, status: res.status, detail } : fail('E_HTTP', url.href, res.status);
            }
            const contentType = res.headers.get('content-type') || '';
            if (!isTextType(contentType)) return fail('E_TYPE', contentType);
            if (!deps.truncate && Number(res.headers.get('content-length')) > maxBytes) return fail('E_SIZE', url.href);
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            let truncated = false;
            if (res.body) {
                const reader = res.body.getReader();
                for (;;) {
                    let r: ReadableStreamReadResult<Uint8Array>;
                    try { r = await reader.read(); } catch { return ac.signal.aborted ? fail('E_TIMEOUT', url.href) : fail('E_NET', url.href); }
                    if (r.done) break;
                    if (bytes + r.value.byteLength > maxBytes) {
                        if (!deps.truncate) { ac.abort(); return fail('E_SIZE', url.href); }
                        chunks.push(r.value.subarray(0, maxBytes - bytes));
                        bytes = maxBytes;
                        truncated = true;
                        break;   // the finally below stops the download
                    }
                    bytes += r.value.byteLength;
                    chunks.push(r.value);
                }
            }
            const text = decodeText(Buffer.concat(chunks), contentType);
            return { ok: true, url: url.href, status: res.status, contentType, text, bytes, ...(truncated ? { truncated: true as const } : {}) };
        }
        return fail('E_REDIRECTS', String(raw));
    } finally {
        clearTimeout(timer);
        ac.abort();   // an early return (E_HTTP, E_TYPE, E_SIZE) must not leave a download running
    }
}
