# sidecar — the bundled, UNMODIFIED Open WebUI

This folder packages a **pinned, unmodified** [Open WebUI](https://github.com/open-webui/open-webui)
as a self-contained sidecar the shell spawns. **There is never edited Open WebUI source in here** —
that enforces prime‑directive invariant #1 structurally.

## The pin

[`OPENWEBUI_VERSION`](OPENWEBUI_VERSION) is the **single source of truth** — currently `0.10.1`
(Python 3.11/3.12; launched via the `open-webui serve` console entry, not `python -m`). The shell's
About panel reads this file.

## What the bundle is

A fully **relocatable standalone CPython** ([astral‑sh/python‑build‑standalone](https://github.com/astral-sh/python-build-standalone))
with `open-webui==<pin>` pip‑installed into it, plus [`launcher.py`](launcher.py). No system Python
dependency on the user's machine. Chosen over PyInstaller because OWUI ships a built SvelteKit frontend
+ many data files + heavy native deps (torch, chromadb, onnxruntime) that make a PyInstaller one‑file
build fragile; a real interpreter with the package installed "just works".

`launcher.py` drives OWUI's Typer app with argv (`open_webui:app`) so the invocation is
path‑independent (no pip console‑script shebang that breaks once the installer relocates the bundle).

## Build it

```bash
# from sidecar/
node build-sidecar.mjs          # or ./build-sidecar.sh  (mac/linux)  /  ./build-sidecar.ps1 (win)
```

Produces `sidecar/build/<platform>-<arch>/` = `python/` + `launcher.py`. electron‑builder's
`extraResources` copies that to `resources/sidecar/` in the packaged app; the shell then runs
`resources/sidecar/python(.exe) resources/sidecar/launcher.py serve --host 127.0.0.1 --port <free>`
([`shell/src/main/paths.ts`](../shell/src/main/paths.ts) `resolveSidecarCommand`).

> **Heavy:** a few GB (torch is the bulk) — inherent to local embeddings (invariant #3, documents never
> leave the device). The build runs on the build machine / CI, not the user's. First app run downloads
> the ~90 MB MiniLM embedding model once (to the user's HF cache).

## Dev (no bundle needed)

For development the shell uses the repo's `sidecar/.venv` console script directly — create it with:

```bash
py -3.12 -m venv sidecar/.venv
sidecar/.venv/Scripts/python -m pip install "open-webui==$(cat sidecar/OPENWEBUI_VERSION)"   # *nix: .venv/bin/python
```

`resolveSidecarCommand` finds `.venv` automatically in dev; `LOL_SIDECAR_CMD=<path>` overrides it.

## The upgrade test (prime‑directive guard)

Upgrading Open WebUI is a **version bump, not a merge**:

1. Edit `OPENWEBUI_VERSION` → the new pin.
2. Re‑run `build-sidecar`.
3. Run the smoke test (`LOL_SMOKE_SHOT`, see shell README).

**Pass = no LOL code changed and everything still works.** A failure means OWUI's public config surface
drifted — that's a separation defect to redesign, not patch (re‑verify the env/REST surface in
[`shell/src/main/configBridge.ts`](../shell/src/main/configBridge.ts)).
