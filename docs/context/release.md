# The sidecar, packaging, releases and auto-update

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

- **`sidecar/`** — `build-sidecar` bundles a relocatable standalone CPython 3.12 + OWUI + `launcher.py`;
  `OPENWEBUI_VERSION` is the pin (**OWUI `0.11.4`** since 2026-09-27, Python 3.11/3.12; the bump notes, and what to check again at each bump, are in INTEGRATION_BRIEF); `BUNDLE_REV` is raised by hand when a fix must replace installed bundles of the same OWUI, and a packaged client downloads one by itself a minute after its start, applied at the next (`repairWanted`, owner 2026-11-09; another OWUI stays About's click; v0.2.16); the build caps PyAV below 19 and decodes a short recording. A packaged client runs
  `<userData>/sidecar/python launcher.py serve`; dev uses `sidecar/.venv`'s `open-webui serve`. NOT bundled
  into the installer — CI publishes it as `owui-sidecar-<platform>-<arch>.tar.gz` release assets and the
  packaged shell downloads it to `userData/sidecar` on first run (`sidecarManager.ts`); About ▸ "Check for
  chat-engine update" stages a newer one, applied on relaunch.
- **packaging** — electron-builder + electron-updater + a GitHub Actions release matrix; live
  auto-update verified across releases (v0.1.x series). Installers: windows-x64, mac-arm64 + mac-x64 (Intel,
  macOS 14+; the darwin-x64 sidecar substitutes onnxruntime 1.23.2), linux-x64 + linux-arm64; one
  `owui-sidecar-<platform>-<arch>.tar.gz` per platform, and, when it builds (never fatal), one
  `dsh-runtime-<platform>-<arch>.tar.gz` (the coding agent, fetched by Install the coding agent).

## Electron packaging & auto‑update (adopt ComfyQ's recipe verbatim)

Stack: **electron‑builder** (^26) + **electron‑updater** (^6) + Electron ^42, Node ≥20 (CI: Node 22). Self‑updating on
mac/win/linux from **GitHub Releases**, no paid certificates (ad‑hoc mac signing).

Release flow (in `shell/`):
- `npm run dist` → unsigned installer for the host OS only (local testing, no upload).
- `npm run release:patch|minor|major` → `scripts/release.mjs`: refuses off `main` or with any tracked
  change, runs `npm version <type> --no-git-tag-version`, commits only `package.json`/lock, makes the
  annotated tag `vX.Y.Z`, and pushes `origin main --follow-tags` (npm's built‑in tagging proved
  unreliable, so the git half is done by hand).
- Pushing the tag triggers CI.

`electron-builder.yml` (the real file, comments trimmed):
```yaml
appId: com.llmonlan.client
productName: LlmOnLan
files: [build/**/*, renderer/**/*, assets/**/*, package.json]   # NO sidecar bundled — downloaded on first run
directories: { output: dist, buildResources: assets }
afterPack: scripts/afterPack.cjs          # ad-hoc code-signs the macOS .app (no Apple cert)
publish:
  provider: github
  owner: b2renger
  repo: LlmOnLan
  releaseType: release                    # drafts are ignored by the updater
win:   { target: nsis, icon: assets/icon.png }
nsis:                                     # per-user → silent updates, no UAC prompt
  oneClick: true
  perMachine: false
  allowToChangeInstallationDirectory: false
  artifactName: ${productName}-Setup-${version}-windows-x64.${ext}   # no spaces: GitHub dots them
mac:
  category: public.app-category.productivity
  icon: assets/icon.png
  target:                                 # arm64 + x64. Intel needs ONE packaging substitution
    - { target: dmg, arch: [arm64, x64] } #   (darwin-x64 sidecar ships onnxruntime 1.23.2, the last
    - { target: zip, arch: [arm64, x64] } #   Intel wheel — owner decision 2026-08-28). Intel macs need
                                          #   macOS 14+. zip REQUIRED for latest-mac.yml.
  artifactName: ${productName}-${version}-mac-${arch}.${ext}
  identity: null                          # electron-builder skips signing; afterPack does ad-hoc
  hardenedRuntime: false                  # ad-hoc + hardened fails to launch
linux:
  target: AppImage
  icon: assets/icon.png
  category: Network
  artifactName: ${productName}-${version}-linux-${arch}.${ext}
```

CI `.github/workflows/release.yml`: on `v*` tag → matrix `windows-latest`, `macos-latest` (arm64 +
cross-packaged x64 installers), `ubuntu-latest` (linux-x64), `ubuntu-24.04-arm` (linux-arm64),
`macos-15-intel` (`sidecarOnly`: the darwin-x64 sidecar), `max-parallel: 1`; Node 22, Python 3.12 →
`npm ci` + `npm run build` in `shell/` → the release is **pre‑created with `gh release create`**,
built with `electron-builder --publish never`, and every artifact uploaded via
`gh release upload --clobber` — electron‑builder's own GitHub publisher raced its parallel uploads
(422 already_exists, dropped assets), so it's deliberately not used for publishing. The sidecar and coding-agent
tarballs ride the same release (a coding-agent build that fails is skipped, never fatal). Public repo → the updater needs no token.

`scripts/afterPack.cjs` (macOS only): `codesign --force --deep --sign - <App>.app` so Apple Silicon
doesn't report the unsigned app as "damaged"; not notarized → first‑launch shows the gentler
"unidentified developer" prompt (right‑click → Open bypass). Disable electron‑builder's own signing
(`identity: null`) so there's one signing step we control.

> **Future hardening (out of prototype scope):** a real Apple Developer cert + notarization and a Windows
> code‑signing cert remove the Gatekeeper/SmartScreen warnings. Fine to skip for an internal LAN tool.
