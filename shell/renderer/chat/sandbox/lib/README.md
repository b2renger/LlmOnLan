# Vendored libraries

Byte-identical upstream builds, shipped in-repo so a sketch works on a closed LAN with no CDN and
no download (CLAUDE.md prime directive: LOCAL ONLY).

Owner decision (C3): **three.js (MIT) · p5.js (LGPL-2.1) · matter.js (MIT)**. Four candidates were
considered and three shipped; a fourth needs an owner decision, not a new file.

## What is here, and where it came from

| File | Pin | Bytes | SPDX | Upstream artefact |
|---|---|---|---|---|
| `three.min.js` | r160 (`three@0.160.1`) | 669 884 | MIT | `three-0.160.1.tgz` → `package/build/three.min.js` |
| `p5.min.js` | `p5@1.11.13` | 1 063 246 | LGPL-2.1 | `p5-1.11.13.tgz` → `package/lib/p5.min.js` |
| `matter.min.js` | `matter-js@0.20.0` | 83 476 | MIT | `matter-js-0.20.0.tgz` → `package/build/matter.min.js` |
| licences | — | 26 653 | — | each tarball's own licence file, verbatim |

**Total: 1 816 606 bytes of library text (1.73 MB of the 2.0 MB budget) + 26 KB of licences**
(budget 40 KB). Measured at the C3 landing; the lint re-measures on every run, so going over is a
gate failure rather than a discovery at packaging time.

Why r160 and not a current three.js: r160 is the **last release line that ships a UMD build**
(`build/three.min.js`). Everything after it is ESM-only, and the guest cannot import a module from
disk — `default-src 'none'` in the runner CSP means it loads nothing at all; every library arrives
as TEXT over `postMessage` and is evaluated inline. A newer three.js would need a module that can
be evaluated from a `blob:` URL, which is a change to the containment story, not a version bump.

## Rules, enforced by `shell/test/chat-lint.js` rule 14

1. Every file here is a row in that file's `LIB_MANIFEST` — path, sha256, version, upstream URL,
   SPDX id, licence file. An undeclared file fails the gate.
2. The bytes must hash to the pin. **Never patch a vendored file**; pin a different upstream build.
3. The licence file ships beside it and is named in the same row.
4. Budget: ≤ 2.0 MB of library text and ≤ 40 KB of licences. Over budget, matter.js goes first.
5. Rules 1-8 of the lint SKIP this directory: it is upstream source we may not edit, so a finding
   here would have no fix that keeps prime directive #1.

p5.js is LGPL-2.1: shipped verbatim with its licence, listed in the About section, and replaceable
by the user through a project's own `lib/p5.js` — `sandbox/libs.mjs` takes a project override ahead
of the vendored build, and the panel says which one ran. That override *is* the relink freedom the
licence asks for. Recorded as a DISCUSS item for the packaging/licence page.

Nothing here is fetched from the network at runtime. `../libs.mjs` reads these files from inside
the app via `import.meta.url` and hands the TEXT to the sandbox guest over `postMessage`; the guest
itself can load nothing at all (`default-src 'none'`).
