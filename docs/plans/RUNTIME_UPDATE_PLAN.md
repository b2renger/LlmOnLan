# RUNTIME_UPDATE_PLAN: an installed farm gets its bundled Python's security fixes

**Status: proposed, for the owner** (night n° 16, 2026-11-25; summary n° 16, question 2). Size **S–M**. Farm app only.

## Why

python-build-standalone 20261124 carries expat 2.11.0, which fixes three vulnerabilities; one, an overread in the
decoder for unknown encodings, is reachable through Python's `pyexpat`, which the farm's services use when they parse
XML fetched from the web (SearXNG's engines) ([TOOL_UPDATES_2026-11-25](../research/TOOL_UPDATES_2026-11-25.md)). The
Farm app pins 20261110 (CPython 3.12.16, expat 2.10.0).

**A pin bump alone reaches new installs only.** `ensureRuntime` installs the bundled Python only when none is there
(`farm-app/src/main/runtimeManager.ts:275`, `if (!fs.existsSync(bundledPython()))`), so an installed farm, the PRO 6000's
included, keeps the first Python it got, and every library inside it, for good.

## The steps

1. **The pin it has (S).** `writeManifest` records the python-build-standalone release a runtime came from (`pbs:
   20261110`); a runtime with no record is the release the app pinned when it was installed (unknown: treated as older).
2. **A newer build of the same CPython, swapped while the farm is stopped (S–M).** In `refreshFarmCodeIfUpdated`'s
   place (before the farm starts, as the LiteLLM update after an app update does, HUMAN_TESTS J18): when the pin is newer
   and the **CPython version is the same** (3.12.16 here), download the new archive beside the old (`python.next`), check
   it runs, then rename: `python` → `python.prev`, `python.next` → `python`, and remove `python.prev` once the farm has
   started on it. The service venvs (`.venv`, `.searxng`, `.extract`, …) keep working, since on Windows a venv takes its
   standard library and native modules (`pyexpat` among them) from its base install: checked by step 3's test, not
   assumed. A download that fails, or a check that fails, leaves the old Python and says so in `farm.log`, as the LiteLLM
   update does. **A different CPython version is not swapped** (its venvs would need rebuilding): a plan of its own.
3. **Tests.** A unit test of the decision (same CPython and newer pin → swap; older or same pin → nothing; another CPython
   → nothing, said); a scratch run on a copy of a farm's runtime folder: after the swap, `import pyexpat;
   pyexpat.EXPAT_VERSION` in the LiteLLM and SearXNG venvs reads 2.11.0; a HUMAN_TESTS line in K1's shape (an update
   over the last Farm app keeps everything, and `farm.log` says the Python was updated).
4. **Docs:** `docs/context/farm.md` (the Farm app section), `docs/context/release.md`, the research note.

## Not proposed

Rebuilding the venvs at each update (minutes, and a network the school may cut); following Python's latest release
(a pin stays a pin: a session bumps it after reading what changed, as tonight).

## The question

**Approve this plan?** *Recommended:* yes, with the pin bump to 20261124, in the Farm app after farm-v0.0.55. *Default if
no answer:* not built; the finding stays in the research note.
