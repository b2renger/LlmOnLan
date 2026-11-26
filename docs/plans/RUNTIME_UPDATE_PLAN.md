# RUNTIME_UPDATE_PLAN: an installed farm gets its bundled Python's security fixes

**Status: approved by the owner, 2026-11-25** (the chat, 08:51: "2 yes"; proposed night n° 16, summary n° 16's question
2), with the pin bump to 20261124, in the Farm app after farm-v0.0.55. Size **S–M**. Farm app only.

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

## Built (night n° 17, 2026-11-26), and two facts the plan had wrong

- **Built** (`farm-app/src/main/runtimeManager.ts` `updateBundledPython`, `pythonSwap`, `builtOn`; `installer.ts`
  `farmVenvPythons`; the pin `20261124`): after an app update, before the farm starts and before LiteLLM's pip runs, a
  runtime with no `pbs` record or an older one, whose interpreter is CPython 3.12.16, gets the pinned build unpacked as
  `python.next`, checked, renamed into place (`python.prev` kept until every venv built on it, by its `pyvenv.cfg`'s
  `home`, has run `import pyexpat`), then the record `pbs: 20261124`. Anything that fails puts the old folder back and
  leaves `farmCodeVersion` as it was (tried again at the next start). A fresh install records its pin.
- **Tested:** `npm test` 13 + 3 (the decision, which venvs are checked, the order before pip); a scratch run of the
  compiled code on a 20261110 runtime with a venv: swapped in 6.2 s, `pbs` recorded, nothing left over, a second start
  does nothing; with a broken venv built on it, the old folder came back (its `pyexpat.pyd` hash = 20261110's).
- **On Linux, run for real** (03:01, WSL, Node 22, the compiled code on a pbs 20261110 x86_64 runtime with a venv):
  expat **2.10.0 → 2.11.0** in the base and the venv, 6.7 s, `pbs` recorded, a second start a no-op. The pbs 20261124
  files the swap asks for exist for linux-arm64 (the Spark), linux-x64 and both macOS (HEAD 200 each). **Not checked:**
  the Spark's vLLM venv (`~/lol-vllm/.venv`, made by `uv venv --python 3.12`, which on a Farm app likely finds the
  bundled Python first on PATH) sits outside the farm folder, so the swap does not check it; it keeps the same CPython
  at the same path, so it should keep running. A Spark's first start after the update says.
- **Wrong 1: Windows.** CPython's Windows build compiles its own expat: **2.9.0 in 20261110 and in 20261124 alike**
  (`pyexpat.EXPAT_VERSION`, both archives, 2026-11-26). Only the Linux (and likely macOS) builds take expat from pbs:
  Linux x64 **2.10.0 → 2.11.0**. So the swap brings expat 2.11.0 to Linux farms (the Spark's Farm app) only; on Windows
  only a newer CPython changes it.
- **Wrong 2: the PRO 6000 is CPython 3.12.14**, not 3.12.16 (its `python.exe --version`, its four venvs' `pyvenv.cfg`):
  it was installed under an older pin. The swap leaves another CPython alone (its venvs would need rebuilding), and says
  so once in `farm.log`. So on the PRO 6000 this plan changes nothing; a CPython bump there (3.12.14 → a 3.12 with a newer
  vendored expat, every venv rebuilt) would be a plan of its own: summary n° 17's question.

## Not proposed

Rebuilding the venvs at each update (minutes, and a network the school may cut); following Python's latest release
(a pin stays a pin: a session bumps it after reading what changed, as tonight).

## The question

**Approve this plan?** *Recommended:* yes, with the pin bump to 20261124, in the Farm app after farm-v0.0.55. *Default if
no answer:* not built; the finding stays in the research note. → **The owner, 2026-11-25 08:51: "yes".**
