// Web search v2 (2026-10-05): "search and read". Open WebUI's search_web tool reaches it through OWUI's own
// external-search setting (WEB_SEARCH_ENGINE=external → POST /web/search on the Computer's loopback
// listener, mcp.ts) and gets evidence in one call instead of three search-engine snippets: the farm's
// SearXNG → the top pages, read here through io.ts (the public internet only) → their main text →
// passages → BM25 against the question → the best passages of each page, bounded in tokens.
// Measured end to end (OWUI 0.11.4, 12 questions on fresh facts): 2/12 right with OWUI's own SearXNG
// engine and the old engine set, 10/12 with this (tuned engines, Yandex still among them then), at 2.3
// generations per message — as cheap as web search off — and no fetch_url rounds. Per search here (median,
// p90): 50 / 160 ms of CPU, 1.4 / 4 MB of pages, 2.1 / 3.8 s. Nothing is kept between searches.

import { fetchText, FetchAnswer } from './io';

const PAGES = 6;                       // pages read per search
const PER_HOST = 2;                    // at most this many from one site
const SEARCH_MS = 6_000;               // the farm's SearXNG (its own engines stop at 5 s)
const SEARCH_MAX_BYTES = 4 * 1024 * 1024; // its JSON answer (~40 results: under 100 KB)
const PAGE_MS = 5_000;                 // one page, DNS to last byte
export const DEADLINE_MS = 10_000;     // the whole search: Open WebUI's external search waits with NO timeout
const PAGE_MAX_BYTES = 2 * 1024 * 1024;   // the top of a bigger page is kept (1 page in 12 measured was over 1 MB)
const PER_RESULT_TOKENS = 800;         // tuned on 24 questions: the answer in what the model reads 24/24,
const TOTAL_TOKENS = 3_000;            // ~2.1k tokens a search (OWUI's three snippets: ~0.3k, 15/24)
const FLOOR = 0.35;                    // passages under 35 % of the best one's score are left out
// A browser's User-Agent: many sites refuse or empty a page for an unknown client (the measured setup).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export interface SearxResult { url?: string; title?: string; content?: string; publishedDate?: string | null }
export interface Block { t: string; h: boolean }
/** A page's main text. `published` is what the model reads ("published …, updated …"); `newest` (YYYY-MM-DD)
 * is the later of its own published/updated metadata, for the recency rule — never a bare <time>. */
export interface Extracted { title: string; published: string; newest: string; description: string; blocks: Block[] }
export type Page = ({ ok: true; url: string } & Extracted) | { ok: false };
export interface WebResult { link: string; title: string; snippet: string }

// ---------------------------------------------------------------------------------------------
// Main-text extraction (no DOM): one pass of a tolerant tokenizer. Drops script/style/svg/…,
// nav/header/footer/aside/form and anything whose class/id/role says menu, cookie, share, …;
// prefers <main>/<article> when they hold enough text; turns table rows into "a | b | c" lines;
// drops blocks that are mostly link text.
// ---------------------------------------------------------------------------------------------
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë', oelig: 'œ', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—', euro: '€', copy: '©', reg: '®', deg: '°', middot: '·', bull: '•', times: '×', shy: '', zwj: '', zwnj: '', thinsp: ' ', ensp: ' ', emsp: ' ' };
function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);?/gi, (m, e: string) => {
        if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return ''; } }
        return ENT[e] !== undefined ? ENT[e] : m;
    });
}
const RAW = new Set(['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'math', 'canvas', 'object', 'select', 'textarea', 'button']);
const SKIP = new Set(['nav', 'header', 'footer', 'aside', 'form', 'dialog', 'menu']);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'table', 'tbody', 'thead', 'tr', 'figure', 'figcaption', 'br', 'hr', 'body', 'center', 'details', 'summary', 'caption', 'address']);
const JUNK = /(^|[\s_-])(cookies?|consent|gdpr|rgpd|banner|navbar|nav|menu|menus|footer|header|sidebar|side-bar|share|sharing|social|newsletter|subscribe|breadcrumbs?|comments?|related|promo|advert|ads?|adsbygoogle|pub|popup|modal|outbrain|taboola|skip|visually-hidden|sr-only|toolbar|pagination|tags|author-bio|signup|paywall)([\s_-]|$)/i;
const attr = (a: string, name: string): string | null => {
    const m = a.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};
const day = (x: string): string => (String(x).match(/\d{4}-\d{2}-\d{2}/) || [''])[0];

export function extract(html: string, classes = true): Extracted {
    const lower = html.toLowerCase();
    const out: Extracted = { title: '', published: '', newest: '', description: '', blocks: [] };
    const dates = { pub: '', mod: '', time: '' };
    type Raw = { t: string; h: boolean; link: number };
    const all: Raw[] = []; const mainBlocks: Raw[] = [];
    let inMain = 0; let sawMain = false;
    let skipTag: string | null = null; let skipDepth = 0;
    let cur = ''; let curLink = 0; let inA = 0; let heading = 0; let inTitle = false;
    const flush = () => {
        const t = cur.replace(/\s+/g, ' ').trim();
        if (t) {
            const b = { t, h: heading > 0, link: curLink / t.length };
            all.push(b); if (inMain) mainBlocks.push(b);
        }
        cur = ''; curLink = 0;
    };
    // Linear on any input (a page is untrusted, and this runs on the main process): no rule scans across a '<'
    // outside quotes, a tag name is matched whole (it cannot trade characters with the attributes), and a
    // comment or CDATA jumps to its end with indexOf. Before (critic, 2026-10-05): 64 KB of "<a" took 1.9 s.
    // A tag that does not close before the next '<' (a stray quote, a cut page) ends there, as a tag — never as text.
    const re = /<!--|<!\[CDATA\[|<\?[^<>]*>|<!doctype[^<>]*>|<\/?([a-zA-Z][\w:-]*)(?![\w:-])(?:((?:[^<>"']|"[^"]*"|'[^']*')*)>|([^<>]*)>?)|[^<]+|</gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
        const tok = m[0];
        if (m[1] === undefined) {                       // text, comment, doctype, stray '<'
            if (tok === '<!--' || tok.startsWith('<![')) {   // to the end of the comment / CDATA, or of the page
                const end = html.indexOf(tok === '<!--' ? '-->' : ']]>', re.lastIndex);
                re.lastIndex = end < 0 ? html.length : end + 3;
                continue;
            }
            if (tok[0] === '<' && tok.length > 1) continue;
            if (inTitle) { out.title += tok; continue; }
            if (skipTag) continue;
            const text = decodeEntities(tok);
            cur += text; if (inA) curLink += text.replace(/\s+/g, ' ').length;
            continue;
        }
        const name = m[1].toLowerCase(); const close = tok[1] === '/'; const a = m[2] ?? m[3] ?? '';
        if (!close && RAW.has(name)) {                  // skip its raw content entirely
            if (name === 'script' && /application\/ld\+json/i.test(a)) {
                const end = lower.indexOf('</script', re.lastIndex);
                const body = html.slice(re.lastIndex, end < 0 ? html.length : end);
                const dp = body.match(/"date(?:Published|Created)"\s*:\s*"([^"]{8,40})"/); if (dp && !dates.pub) dates.pub = dp[1];
                const dm = body.match(/"dateModified"\s*:\s*"([^"]{8,40})"/); if (dm && !dates.mod) dates.mod = dm[1];
            }
            const end = lower.indexOf(`</${name}`, re.lastIndex);
            re.lastIndex = end < 0 ? html.length : end;
            continue;
        }
        if (name === 'title') { inTitle = !close && !out.title; continue; }
        if (name === 'meta' && !close) {
            const p = (attr(a, 'property') || attr(a, 'name') || attr(a, 'itemprop') || '').toLowerCase();
            const c = attr(a, 'content');
            if (c) {
                if (!dates.pub && /(article:published_time|datepublished|^date|dc\.date|pubdate)$/.test(p)) dates.pub = c;
                if (!dates.mod && /(article:modified_time|datemodified|og:updated_time|last-modified)$/.test(p)) dates.mod = c;
                if (!out.description && /^(description|og:description)$/.test(p)) out.description = decodeEntities(c);
                if (/^og:title$/.test(p) && !out.title) out.title = c;
            }
            continue;
        }
        if (name === 'time' && !close && !dates.time) { const d = attr(a, 'datetime'); if (d) dates.time = d; }
        if (skipTag) {                                  // inside a dropped element: count nesting of its own tag only
            if (name === skipTag && !VOID.has(name)) { if (close) { if (--skipDepth === 0) skipTag = null; } else skipDepth++; }
            continue;
        }
        if (!close && !VOID.has(name)) {
            const cls = `${attr(a, 'class') || ''} ${attr(a, 'id') || ''}`;
            const role = (attr(a, 'role') || '').toLowerCase();
            if (SKIP.has(name) || (classes && JUNK.test(cls)) || /^(navigation|banner|contentinfo|complementary|dialog|alertdialog|menu|menubar|search)$/.test(role)
                || /\baria-hidden\s*=\s*["']?true/i.test(a) || /\shidden(\s|=|$)/i.test(a) || /display\s*:\s*none/i.test(attr(a, 'style') || '')) {
                if (name !== 'html' && name !== 'body' && name !== 'main' && name !== 'article') { flush(); skipTag = name; skipDepth = 1; continue; }
            }
        }
        if (name === 'a') { inA += close ? (inA > 0 ? -1 : 0) : 1; continue; }
        if (name === 'td' || name === 'th') { if (!close) cur += ' | '; continue; }
        if (BLOCK.has(name) || name === 'tr') {
            flush();
            if (/^h[1-6]$/.test(name)) heading += close ? (heading > 0 ? -1 : 0) : 1;
            if (name === 'main' || name === 'article') { if (close) inMain = Math.max(0, inMain - 1); else { inMain++; sawMain = true; } }
        }
    }
    flush();
    out.title = decodeEntities(out.title).replace(/\s+/g, ' ').trim();
    // "published …, updated …" from the page's own metadata; a bare <time> only when it has none
    // (Wikipedia's first <time> is the tower's 1889 opening).
    const pub = day(dates.pub); const mod = day(dates.mod);
    out.published = [pub && `published ${pub}`, mod && mod !== pub && `updated ${mod}`].filter(Boolean).join(', ')
        || (day(dates.time) ? `dated ${day(dates.time)}` : '');
    out.newest = pub > mod ? pub : mod;
    const good = (bs: Raw[]) => bs.filter((b) => !(b.link > 0.5 && b.t.length < 400) && (b.h || b.t.length >= 25 || /\d/.test(b.t)));
    const main = good(mainBlocks);
    const mainChars = main.reduce((n, b) => n + b.t.length, 0);
    out.blocks = (sawMain && mainChars >= 400 ? main : good(all)).map((b) => ({ t: b.t.replace(/^\|\s*/, ''), h: b.h }));
    // A page whose whole wrapper carries a junk-looking class ("header-fixed") comes out nearly empty:
    // try again on tag names only, and keep whichever kept more text.
    const chars = (e: Extracted) => e.blocks.reduce((n, b) => n + b.t.length, 0);
    if (classes && chars(out) < 300) {
        const again = extract(html, false);
        if (chars(again) > chars(out)) return again;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Passages + BM25.
// ---------------------------------------------------------------------------------------------
const STOP = new Set(('a an and are as at be by for from has have how i in is it its of on or that the this to was were what when where which who why will with ' +
    'au aux avec ce ces cette dans de des du elle en est et il ils je la le les leur lui mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y ' +
    'quel quelle quels quelles comment combien quand est-ce sont ete etre fait faire plus tres').split(' '));
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function terms(s: string): string[] {
    return fold(s).split(/[^a-z0-9]+/)
        .filter((w) => w && (w.length > 1 || /\d/.test(w)) && !STOP.has(w))
        .map((w) => (w.length > 4 && /[sx]$/.test(w) && !/\d/.test(w) ? w.slice(0, -1) : w));
}
export const tokensOf = (s: string): number => Math.ceil(s.length / 3.5);   // ponytail: chars/3.5, conservative for FR and EN; no tokenizer

export function passages(blocks: Block[], maxWords = 160, minWords = 60): { text: string; head: string }[] {
    const out: { text: string; head: string }[] = []; let cur: string[] = []; let words = 0; let head = '';
    const push = () => { if (cur.length) out.push({ text: cur.join('\n'), head }); cur = []; words = 0; };
    for (const b of blocks) {
        if (b.h) { push(); head = b.t.slice(0, 160); continue; }
        const w = b.t.split(/\s+/).length;
        if (w > maxWords) {                                  // a long block: cut at sentence ends
            push();
            // n = part.split(/\s+/).length, kept as sentences are added (each counted once, not the growing part again):
            // joining with a space adds the sentence's count, less one for each side that already ends in a space.
            let part = ''; let n = 1;
            const joined = (s: string, sn: number) => n + sn - (/\s/.test(part.slice(-1)) ? 1 : 0) - (/\s/.test(s.slice(0, 1)) ? 1 : 0);
            for (const s of b.t.split(/(?<=[.!?…])\s+/)) {
                const sn = s.split(/\s+/).length;
                if (joined(s, sn) > maxWords && part) { out.push({ text: part.trim(), head }); part = ''; n = 1; }
                n = joined(s, sn); part += ' ' + s;
            }
            if (part.trim()) out.push({ text: part.trim().slice(0, maxWords * 12), head });
            continue;
        }
        cur.push(b.t); words += w;
        if (words >= minWords) push();
    }
    push();
    return out;
}

type Tf = { map: Map<string, number>; len: number };
function tf(words: string[]): Tf { const map = new Map<string, number>(); for (const w of words) map.set(w, (map.get(w) || 0) + 1); return { map, len: words.length }; }
function bm25(docs: { tf: Tf }[], q: string[], k1 = 1.2, b = 0.75): number[] {
    const qt = [...new Set(q)];
    const N = docs.length || 1;
    const avg = docs.reduce((n, d) => n + d.tf.len, 0) / N || 1;
    const df = new Map(qt.map((t) => [t, docs.filter((d) => d.tf.map.has(t)).length]));
    return docs.map((d) => qt.reduce((s, t) => {
        const f = d.tf.map.get(t) || 0; if (!f) return s;
        const idf = Math.log(1 + (N - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
        return s + idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.tf.len / avg));
    }, 0));
}
const jaccard = (a: Set<string>, b: Set<string>) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };

// Dictionary, translation and spelling pages say what a WORD means, never the answer: a question's "qui", "quel",
// "combien" or "latest" put one among what the model read in 14 of the 54 searches the re-check replayed
// (2026-10-05), and up to six in one search's results. A whole host label or path segment names them
// (larousse.fr/dictionnaires/…, dictionnaire.lerobert.com, …/definition/…, www.linguee.fr): Larousse's encyclopedia
// is not its dictionary, and a slug like "translation-ai-startup" is not a translator.
const DICTIONARY = /(^|[./])(dictionnaires?|dictionary|definitions?|traductions?|translate|translator|translation|conjugaison|orthographe|regles-orthographe|linguee|wordreference|reverso|deepl|wiktionary|collinsdictionary|le-dictionnaire|dictionnaire-academie)([./]|$)/i;
const dictionary = (r: SearxResult): boolean => { try { const u = new URL(String(r.url)); return DICTIONARY.test(u.hostname + u.pathname); } catch { return false; } };

/** SearXNG's order, at most PER_HOST pages from one site, PAGES in all; dictionary pages after every other
 * result, so they are read only when nothing else came back (a question about a word). */
export function pickPages(results: SearxResult[]): SearxResult[] {
    const perHost = new Map<string, number>(); const picked: SearxResult[] = [];
    for (const r of [...results.filter((x) => !dictionary(x)), ...results.filter(dictionary)]) {
        if (!r.url || picked.length >= PAGES) continue;
        let host: string; try { host = new URL(r.url).hostname; } catch { continue; }
        if ((perHost.get(host) || 0) >= PER_HOST) continue;
        perHost.set(host, (perHost.get(host) || 0) + 1);
        picked.push(r);
    }
    return picked;
}

// A question about the latest / current / now (English and French).
const RECENT = /\b(latest|newest|current|currently|now|today|recent|recently|this (week|month|year)|derniere?s?|actuel(le)?s?|actuellement|aujourd'?hui|maintenant|en ce moment|recente?s?|cette (semaine|annee))\b/;
// Its adverbs of "now" ("latest", "current", "dernière" stay terms: they label versions and release lines).
const NOW_WORDS = /\b(now|today|currently|this (week|month|year)|actuellement|aujourd'?hui|maintenant|en ce moment|cette (semaine|annee))\b/g;
// A question about a version or a release ("latest stable version of Blender", "dernière version LTS de Node.js"),
// and a passage holding a version number within 40 characters of a word that marks the newest one ("Blender 5.2
// LTS (current stable release)", "Latest Node.js version: 24.19.0"): such a passage counts double (see the floor
// in rank). Not "version" or "release" alone: on Wikipedia's Blender page they lifted history ("with the release
// of version 2.80") into what the model reads (2026-10-06 replay).
const VERSION_Q = /\b(versions?|releases?|lts)\b/;
const VERSION_LINE = /\b(lts|stable|current|latest|newest|derniere|actuelle)\b.{0,40}?\bv?\d+\.\d+(\.\d+)?\b|\bv?\d+\.\d+(\.\d+)?\b.{0,40}?\b(lts|stable|current|latest|newest|derniere|actuelle)\b/s;

/** PURE: the question, the picked search results and their read pages → Open WebUI's [{link, title, snippet}].
 * Every passage of every page competes (the engine's own snippet too: it often states the answer); a page's
 * title counts in each of its passages; the top of a page and SearXNG's order weigh a little. */
export function rank(query: string, picked: SearxResult[], pages: Page[], count: number, opt: { now?: number } = {}): { out: WebResult[]; passages: number; chosen: number; tokens: number } {
    // The "now" words say WHEN, not WHAT: the recency rule reads them, the ranking does not (as terms, with the
    // dictionaries gone, "aujourd'hui" put a TV show called "Ça commence aujourd'hui" above the minister's own page).
    const what = terms(fold(query).replace(NOW_WORDS, ' '));
    const q = what.length ? what : terms(query);
    const recent = RECENT.test(fold(query));
    const versions = VERSION_Q.test(fold(query));
    const now = opt.now ?? Date.now();
    type Doc = { page: number; pos: number; text: string; head: string; tf?: Tf; set?: Set<string>; tokens?: number; plain?: number; score?: number };
    const docs: Doc[] = [];
    pages.forEach((p, i) => {
        const r = picked[i];
        if (r.content) docs.push({ page: i, pos: -1, text: r.content.replace(/\s+/g, ' ').trim(), head: '' });
        if (p.ok) passages(p.blocks).forEach((ps, k) => docs.push({ page: i, pos: k, text: ps.text, head: ps.head }));
    });
    // The recency rule (the measured miss: a page last updated over a year ago ranked above current ones): when
    // the question asks for the latest / current / now, a page whose own date is more than a year old is STALE —
    // its passages count half (so it no longer sets the floor that keeps the others out) and it comes after
    // every other page. Recent and undated pages are left as they are.
    const stale = pages.map((p, i) => {
        const date = (p.ok && p.newest) || day(String(picked[i].publishedDate || ''));
        return recent && !!date && now - Date.parse(date) > 365 * 864e5;
    });
    for (const d of docs) {
        const title = d.pos >= 0 ? (picked[d.page].title || (pages[d.page] as Extracted).title || '') : '';
        const own = terms(`${d.head} ${d.text}`);
        d.tf = tf(title ? [...terms(title), ...own] : own); d.set = new Set(own); d.tokens = tokensOf(d.text) + tokensOf(d.head) + 2;
    }
    const scores = bm25(docs as { tf: Tf }[], q);
    docs.forEach((d, i) => {
        d.plain = scores[i] * (1 + 0.15 * (1 - d.page / Math.max(1, picked.length)))
            * (d.pos >= 0 ? 1 + 0.3 / (1 + d.pos) : 1) * (stale[d.page] ? 0.5 : 1);
        d.score = d.plain * (versions && VERSION_LINE.test(fold(d.text)) ? 2 : 1);
    });
    const order = docs.filter((d) => d.score! > 0).sort((a, b) => b.score! - a.score!);
    // The floor follows the best passage WITHOUT the version factor: a version line passes it twice as easily and
    // is chosen first, every other passage passes it as before.
    const top = order.reduce((best, d) => Math.max(best, d.plain!), 0);
    const used = new Map<number, number>(); let total = 0; const chosen: Doc[] = [];
    for (const d of order) {
        if (d.score! < FLOOR * top) break;
        if (total + d.tokens! > TOTAL_TOKENS) continue;
        if ((used.get(d.page) || 0) + d.tokens! > PER_RESULT_TOKENS) continue;
        if (chosen.some((c) => jaccard(c.set!, d.set!) > 0.6)) continue;
        chosen.push(d); used.set(d.page, (used.get(d.page) || 0) + d.tokens!); total += d.tokens!;
    }
    // Results: pages ordered by their best chosen passage (a stale one last); passages in document order. A page
    // with no evidence is noise and is dropped (the first result is always kept, so a search never comes back empty).
    const best = new Map<number, number>();
    for (const d of chosen) best.set(d.page, Math.max(best.get(d.page) || 0, d.score!));
    const pageOrder = [...picked.keys()].sort((a, b) => Number(stale[a]) - Number(stale[b]) || (best.get(b) || 0) - (best.get(a) || 0) || a - b);
    const out: WebResult[] = [];
    for (const i of pageOrder) {
        if (out.length >= count) break;
        const r = picked[i]; const p = pages[i];
        const mine = chosen.filter((d) => d.page === i).sort((a, b) => a.pos - b.pos);
        if (!mine.length && out.length) continue;
        const date = (p.ok && p.published) || (r.publishedDate ? `published ${String(r.publishedDate).slice(0, 10)}` : '');
        const lines: string[] = [];
        if (date) lines.push(`(${date})`);
        if (!mine.length) lines.push((r.content || '').trim() || '(no text could be read from this page)');
        for (const d of mine) lines.push(d.pos < 0 ? d.text : `${d.head && !d.text.startsWith(d.head) ? d.head + ' — ' : ''}${d.text}`);
        out.push({ link: p.ok ? p.url : String(r.url), title: (r.title || (p.ok ? p.title : '') || '').trim(), snippet: lines.join('\n\n') });
    }
    return { out, passages: docs.length, chosen: chosen.length, tokens: total };
}

/** The language to ask pages in: French when the question looks French. */
function langHeader(query: string): string {
    return /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|des|du|est|quel|quelle|comment|pour|en|de)\b/i.test(query)
        ? 'fr-FR,fr;q=0.9,en;q=0.6' : 'en-US,en;q=0.9,fr;q=0.5';
}

function readPage(r: FetchAnswer): Page {
    if (!r.ok) return { ok: false };
    const ex = /text\/plain/i.test(r.contentType)
        ? { title: '', published: '', newest: '', description: '', blocks: r.text.split(/\n\s*\n/).map((t) => ({ t: t.replace(/\s+/g, ' ').trim(), h: false })).filter((b) => b.t) }
        : extract(r.text);
    return { ok: true, url: r.url, ...ex };
}

/** One search: the farm's SearXNG, the top pages read in parallel, ranked. Answers within `deadlineMs`
 * (Open WebUI waits as long as this takes); a page that is not read in time keeps its engine snippet.
 * Throws when the farm's search engine cannot be asked. `allowLoopback` is for tests only.
 * ponytail: pages are read directly, never through a proxy (Node's http ignores the system's and HTTP(S)_PROXY):
 * on a network that reaches the web only through a proxy every page fails within PAGE_MS and the model gets the
 * engines' snippets — the old quality, not an error. Upgrade path: a CONNECT tunnel to a configured proxy in
 * io.ts's pinnedGet (the address check then moves to the proxy). */
export async function searchAndRead(query: string, count: number, opts: { searxngUrl: string | null; deadlineMs?: number; allowLoopback?: boolean }): Promise<WebResult[]> {
    if (!opts.searxngUrl) throw new Error('this farm has no search engine');
    const deadline = Date.now() + (opts.deadlineMs || DEADLINE_MS);
    const left = () => Math.max(1, deadline - Date.now());
    const u = `${opts.searxngUrl.replace(/\/+$/, '')}/search?${new URLSearchParams({ q: query, format: 'json', language: 'auto', safesearch: '1' })}`;
    const res = await fetch(u, { signal: AbortSignal.timeout(Math.min(SEARCH_MS, left())) });
    if (!res.ok) throw new Error(`the farm's search engine answered ${res.status}`);
    let results: SearxResult[];
    try {
        // At most SEARCH_MAX_BYTES read: whatever answers on that port, main never holds more.
        const reader = res.body!.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
        for (let r = await reader.read(); !r.done; r = await reader.read()) {
            bytes += r.value.byteLength;
            if (bytes > SEARCH_MAX_BYTES) { reader.cancel().catch(() => { /* already closed */ }); throw new Error('too big'); }
            chunks.push(r.value);
        }
        results = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { results?: SearxResult[] }).results || [];
    } catch { throw new Error('the farm\'s search engine did not answer in JSON in time'); }
    const picked = pickPages(results);
    const headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': langHeader(query) };
    const read = await Promise.all(picked.map((r) => fetchText(r.url, {
        publicOnly: true, truncate: true, maxBytes: PAGE_MAX_BYTES, timeoutMs: Math.min(PAGE_MS, left()), headers, allowLoopback: opts.allowLoopback,
    })));
    // Extraction is synchronous (~4 ms a page, 30–70 ms for a 2 MB one, measured on 126 real pages): one page per
    // turn of the event loop, so the window and IPC never wait long on the main process.
    const pages: Page[] = [];
    for (const r of read) { pages.push(readPage(r)); await new Promise((done) => setImmediate(done)); }
    return rank(query, picked, pages, count).out;
}
