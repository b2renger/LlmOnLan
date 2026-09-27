// @ts-check
// The vendored-library loader. The ONE sanctioned `fetch` outside net/ (lint rule 11): it reads a
// file that ships INSIDE the app, over the URL the module itself resolves from import.meta.url —
// never the network, never a CDN, never a version manager (CLAUDE.md prime directive: LOCAL ONLY).
//
// Nothing is downloaded at runtime and nothing is bundled: the .js files sit in sandbox/lib/,
// byte-identical to their upstream builds, each with its licence file next to it, each a row in
// chat-lint.js's LIB_MANIFEST (path, sha256, version, upstream URL, licence file) — which is what
// makes "unmodified" a checkable fact rather than a promise (lint rule 14).
//
// THE GUEST NEVER LOADS ANYTHING ITSELF. This module reads the text on the renderer side and the
// host hands it over in a `libs` message; inside the iframe `default-src 'none'` means a
// `<script src>` or a `fetch` would be refused, whatever the generated code tries.
//
// Vendored at the C3 landing (owner decision: three.js + p5.js, plus matter.js as the small MIT
// companion). Measured sizes, which the lint's 2.0 MB budget is checked against:
//   three.min.js   654 KB   r160 (three@0.160.1, the last release line with a UMD build)
//   p5.min.js     1039 KB   p5@1.11.13 (LGPL-2.1 — shipped verbatim, replaceable, see lib/README.md)
//   matter.min.js   82 KB   matter-js@0.20.0
//   total         1774 KB of library text + 26 KB of licences.

/** name -> the file inside sandbox/lib/, the global it defines, its licence file and its pin. */
export const LIB_FILES = Object.freeze({
  three: Object.freeze({
    file: 'lib/three.min.js', global: 'THREE', licence: 'lib/three.LICENSE.txt',
    version: 'r160', spdx: 'MIT',
  }),
  p5: Object.freeze({
    file: 'lib/p5.min.js', global: 'p5', licence: 'lib/p5.LICENSE.txt',
    version: '1.11.13', spdx: 'LGPL-2.1',
  }),
  matter: Object.freeze({
    file: 'lib/matter.min.js', global: 'Matter', licence: 'lib/matter.LICENSE.txt',
    version: '0.20.0', spdx: 'MIT',
  }),
});

/** The set a caller may name. A fourth library needs an owner decision, not a new row. */
export const LIB_NAMES = Object.freeze(Object.keys(LIB_FILES));

/** Session cache: a library's text is read once per app run, then held. @type {Map<string, string>} */
const cache = new Map();

/** Forget the cached text (a project override changed, or a test wants a cold read). */
export function forgetLibs() { cache.clear(); }

/**
 * The text of one vendored library, ready to hand to the guest in a `libs` message.
 *
 * `override` is the per-project escape hatch (studio plan §3.7.5): given the library's name it
 * returns that project's own build as text, or null/undefined to use the one we ship. That override
 * IS the relink freedom p5's LGPL asks for — a user pins their own p5 by dropping it in the
 * project's lib/, with no version manager and no download.
 *
 * @param {string} name
 * @param {{override?: ((name: string) => Promise<string|null>|string|null)|null}} [o]
 * @returns {Promise<{ok: boolean, name: string, source: string, overridden: boolean, error: string|null}>}
 */
export async function loadLib(name, o = {}) {
  const row = /** @type {any} */ (LIB_FILES)[name];
  if (!row) return { ok: false, name, source: '', overridden: false, error: `no such library "${name}"` };
  if (o.override) {
    try {
      const own = await o.override(name);
      if (typeof own === 'string' && own.length > 0) {
        return { ok: true, name, source: own, overridden: true, error: null };
      }
    } catch (err) {
      // A broken override must not silently become "the shipped one": say so, then fall through,
      // so the panel can show WHICH build actually ran.
      return { ok: false, name, source: '', overridden: true, error: String((err && /** @type {any} */ (err).message) || err) };
    }
  }
  const hit = cache.get(name);
  if (hit !== undefined) return { ok: true, name, source: hit, overridden: false, error: null };
  try {
    const url = new URL(row.file, import.meta.url);
    const res = await fetch(url.href);
    // A file: URL answers status 0 with ok:false in some builds and 200 in others; the text is the
    // real verdict, so an empty body is the failure, not the status line.
    const text = res && typeof res.text === 'function' ? await res.text() : '';
    if (!text) return { ok: false, name, source: '', overridden: false, error: 'this build does not ship it' };
    cache.set(name, text);
    return { ok: true, name, source: text, overridden: false, error: null };
  } catch (err) {
    return { ok: false, name, source: '', overridden: false, error: String((err && /** @type {any} */ (err).message) || err) };
  }
}

/** Several, in the order given (three before a sketch that uses THREE). Libraries that are not in
 * this build are simply absent from the result — the host turns that into a visible row.
 * @param {string[]} names
 * @param {{override?: ((name: string) => Promise<string|null>|string|null)|null}} [o]
 * @returns {Promise<{name: string, source: string, overridden: boolean}[]>} */
export async function loadLibs(names, o = {}) {
  /** @type {{name: string, source: string, overridden: boolean}[]} */ const out = [];
  for (const name of Array.isArray(names) ? names : []) {
    const r = await loadLib(name, o);
    if (r.ok) out.push({ name: r.name, source: r.source, overridden: r.overridden });
  }
  return out;
}

/** Which of the declared libraries are actually present in this build, with the pin and the size —
 * for the About section and for a scenario that must skip when nothing is vendored.
 * @returns {Promise<Record<string, {present: boolean, version: string, spdx: string, bytes: number}>>} */
export async function libStatus() {
  /** @type {Record<string, any>} */ const out = {};
  for (const name of LIB_NAMES) {
    const row = /** @type {any} */ (LIB_FILES)[name];
    const r = await loadLib(name);
    out[name] = {
      present: r.ok && r.source.length > 0,
      version: row.version,
      spdx: row.spdx,
      bytes: r.ok ? r.source.length : 0,
    };
  }
  return out;
}
