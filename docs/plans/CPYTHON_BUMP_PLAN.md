# CPYTHON_BUMP_PLAN: a farm's bundled CPython moved to a newer 3.12, its venvs rebuilt

**Status: proposed, for the owner** (night n° 18, 2026-11-27; summary n° 17's queue 3b). **Not to build before** a
python-build-standalone release carries a CPython 3.12.x whose own expat is 2.11.0 or later on Windows, and the owner
says yes. Size **M**. The Farm app and the farm's install functions.

## Why

- RUNTIME_UPDATE_PLAN (built 2026-11-26) swaps the bundled Python for a newer python-build-standalone build of **the same
  CPython**, and leaves any other CPython alone. Its venvs' `pyvenv.cfg` point at that CPython, and a different version
  would break them.
- **The PRO 6000 runs CPython 3.12.14 with expat 2.8.3** (read 2026-11-26 03:08). On Windows, CPython builds its own
  expat, so a newer python-build-standalone does not reach it. Only a newer CPython does.
- No CPython release carries expat 2.10 or 2.11 yet: every 3.12, 3.13 and 3.14 tag has 2.9.0. The 3.12 and 3.13
  backports are pending (python/cpython#162493; summary n° 17, *Found*).
- **The exposure:** what a farm's Python parses with `xml.*` or `pyexpat` from outside, which is mostly SearXNG's engines.
  Web search is off for the class; libexpat does not say which versions the three CVEs reach.

## What would change

1. **The trigger:** the pin (`runtimeManager.ts` `RUNTIME_PINS`) moves to that release and its CPython. At the next
   app update, `pythonSwap` finds `other-cpython` and, instead of one line in `farm.log`, the farm's Python is due.
2. **When:** never during a start the class may need. The Farm app's window offers *Update the farm's Python* with how
   long it takes (measured first, step 4). It stops the farm, does the work, and starts it again. An operator does
   everything from the app (owner, 2026-10-07): no command.
3. **How:**
   - The new Python is extracted beside the old (`python.next`), as RUNTIME_UPDATE does.
   - Each venv is made again from the new one: LiteLLM's `.venv`, and the plugins' (OCR, document search, speech to
     text, Classify, SearXNG, the voice). Each install function's signature gains the CPython version
     (`depsSignature`: `classify.js`, `extract.js`, `stt.js`, …), so the existing "reinstall when the signature
     changed" path does the work.
   - The old Python and venvs are kept as `.prev` until the farm has started once on the new ones, then removed. A
     failure puts them back, with the reason in the window.
4. **Measured first, on a scratch copy and not on the PRO 6000's farm:** each venv's rebuild time and download (torch
   for Classify, about 0.9 GB; the CUDA wheels of speech to text), and the whole job's on the office network.
5. **Tests:** the swap decision with the new case, the signatures, the rollback (the Farm app's tests, as
   RUNTIME_UPDATE's), and a run on a scratch farm copy in WSL and on Windows.

## Not proposed

- Python 3.13: not measured against the plugins' wheels.
- Rebuilding the venvs silently at a start: a class could lose its plugins for many minutes.

## The question (when the trigger exists)

**Build this plan, its button in the Farm app's window, the venvs rebuilt?** *Recommended:* yes, once a 3.12.x with
expat 2.11.0 exists. *Default if no answer:* not built; the PRO 6000 keeps 3.12.14 and `farm.log` says so at each update.
