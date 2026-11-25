# Status: what is released, verified, and still to check

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

## Build status (2026-11-25) — released: client `v0.2.21` (OWUI `0.13.3`, Electron 45) · Farm app `farm-v0.0.55`

> What each release brought, from v0.2.0 on: the DEVLOG's release entries ([docs/DEVLOG.md](../../docs/DEVLOG.md), headed
> "Release …"; v0.2.5 is in its 2026-09-29 afternoon entry, farm-v0.0.47 and 0.0.48 in its 2026-10-13 ones).
> `origin/main` = the last release (client v0.2.21 and Farm app farm-v0.0.55, 2026-11-25, cut by day on the owner's go;
> before them v0.2.20, 2026-11-23, v0.2.19, 2026-11-18, v0.2.18 and Farm app farm-v0.0.54, 2026-11-16, and v0.2.17 and
> farm-v0.0.53, 2026-11-12). Since 2026-11-12 the work is
> committed on `main` in the owner's checkout, backed up to the `night` branch, and pushed to `main` only at a release
> (CLAUDE.md, *How we work*). The modules
> describe the code; a change from 2026-11-05 on names the release that brought it.

**Deployed (owner, 2026-11-16 morning):** farm-v0.0.54 on the PRO 6000 (vLLM, Qwen3.6; it reads 0.0.54 at 10:31) and on
one of the two Sparks; client v0.2.18 on the PRO 6000 and a Windows laptop. The owner: "everything looks good". The
second Spark is not updated yet.

**The class of 2026-11-17 failed on Open WebUI** (FIELD_NOTES): farm switches killed its first start and broke its
database (*keeps exiting (code 1)*). **The fix is released in client v0.2.19** (2026-11-18, CI green on all 5 builds, 28 files, the update feeds at 0.2.19; [OWUI_START_PLAN](../plans/OWUI_START_PLAN.md),
DEVLOG 2026-11-17), with a **Repair Open WebUI's database** button for the laptops the class broke
([OWUI_REPAIR_PLAN](../plans/OWUI_REPAIR_PLAN.md), approved 2026-11-18). Next: HUMAN_TESTS A28 on the release. On v0.2.18
and before, those laptops need the manual repair (A28's last lines).

**Client v0.2.20** (2026-11-23, by day, on the owner's go after G14's re-check on `0.2.19+n14`: tag 17:41 from
`5cf6743`'s `shell/`, CI green on all 5 builds at 18:19, 27 files as v0.2.19, the four update feeds at 0.2.20, the
sidecar manifest unchanged, Open WebUI 0.13.3 bundle rev 2, so an update downloads no Open WebUI): LOL Vibe's page
beside its code and the pop-out window (VIBE_PAGE_PLAN, HUMAN_TESTS A29); *Plan first* beside the message box, one per
chat, its *Go ahead* and *Change the plan* shown without a hover on the newest plan (G14); an attached document read
once per chat (`RAG_SYSTEM_CONTEXT`, J16 step 6); a Computer run no longer stands still up to a minute after a person
answers a Dialog, a Confirm or a Timer (the run loop's lost wake-up); a project's page keeps its saved data across a
restart (the Preview's port); the coding agent's session logs kept 30 days; dsh's own plan mode off; a chat tied to a
project says the coding agent answers it (not *press Project*); a coding-agent turn that did nothing, or only read,
says so (it said the Changes tab showed what it did).

**Client v0.2.21 and Farm app farm-v0.0.55** (2026-11-25, by day, on the owner's go of 08:51, *"cut a release for
testing"*: the owner tests on the released installers, HUMAN_TESTS J16's 10-minute check, J17, J19, J16 steps 1 and 6,
G14 steps 6 and 7, A30; the same code as the local builds `0.2.20+n16` and `0.0.54+n16`, since them only tests and one
comment in `install.sh`). **Client:** a new chat opened from a project's chat stays in that project, and *Plan first*
is offered in a chat with no project too, asking for one (PLAN_FIRST_NEW_CHAT, G14 steps 6 and 7); Electron 45.5.0 (42
is past its end of life; the full harness 424/424 on both; macOS 13 Ventura and later, the owner: no Macs on Monterey,
A30); Open WebUI unchanged (0.13.3, bundle rev 2), so an update downloads no Open WebUI. **Farm:** Qwen3.8 drafting ahead and keeping its state in 16 bits (J19); 128k of
context per person by default, Automatic 24 on the PRO 6000 (J16); a saved vLLM list running its built-ins with the
current flags; the panel's seat text; a finished job's bar that leaves the panel's top after 5 minutes (a failed one
stays); every vLLM root but production's builds FlashInfer's kernels in its own folder (`serve.sh`); a vLLM start's
bar says the farm stops a stuck one by itself, and its kernel phase says *several minutes the first time with a model, or
after vLLM is installed or updated*, as *Use this* does (FARM_START step 2, review 2026-11-24 M1); Qwen3.8's note says
what passed everyone deep (32 at 32k, 21 at 64k, 11 at 128k; review L5); a model folder filled by hand with a stale
download temp file no longer reads *partly downloaded* (`status.sh`, review M2, low: the panel's Download already
cleaned it); Install and Update vLLM put in FlashInfer's precompiled kernels on a 12.x card, a first start ~3½ minutes
shorter (FARM_START step 3); the built-ins read their weights with `prefetch`, ~16 s off a cold start (step 4); vLLM's
start begins before LiteLLM and the other plugins, ~10 s sooner (step 1). **Open WebUI stays at 0.13.3:** 0.13.4 would drop the Blender tools
([BLENDER_TOOLS_ENV_PLAN](../plans/BLENDER_TOOLS_ENV_PLAN.md), for the owner).

The full plan is built, released and in multi-user testing. Where to look: the map of the docs,
[docs/README.md](../../docs/README.md); the dated build log with how each piece was tested, [docs/DEVLOG.md](../../docs/DEVLOG.md);
what a person must still check, [docs/HUMAN_TESTS.md](../../docs/HUMAN_TESTS.md) (★ = before the next release; its Part 4
holds what was verified on real machines, the ticked lines of the archived RIG_CHECKLIST included); the next work in
order, [docs/plans/README.md](../../docs/plans/README.md) (the open plans: [IDE_PLAN](../../docs/plans/IDE_PLAN.md), and
[CLOUD_SOURCES_PLAN](../../docs/plans/CLOUD_SOURCES_PLAN.md), documents from Microsoft 365, Google and synced folders, nothing
built); the version‑specific integration facts, [docs/INTEGRATION_BRIEF.md](../../docs/INTEGRATION_BRIEF.md) (a dated
snapshot of 2026-06-29 on 0.10.1, with each pin bump's notes and what to check again at the next). The last full
consistency pass (code ↔ in‑app text ↔ these docs) is `docs/reviews/DOCS_REVIEW_2026-09-27_{FARM,SHELL,COMPUTER}.md`;
the review of 2026-11-05 (code, docs, plans, tests) is [docs/reviews/PROJECT_REVIEW_2026-11-05.md](../../docs/reviews/PROJECT_REVIEW_2026-11-05.md),
and its next work goes to docs/plans/README.md. Snapshot:


**Verified on the live stack (single box, 2026-06-30):** a **full chat through the OWUI UI** (Playwright →
streamed gemma4 reply); **document‑locality** (a doc embedded into the local Chroma with **zero
`/v1/embeddings`** to the farm; since document search, 2026-10-08, this holds only for a data folder still on MiniLM:
with the farm's document search the farm computes the vectors and the laptop keeps them); **load‑balancing + transparent failover** across two Ollama hosts
(killing one → 10/10 completions still succeed, after tuning the router).

**Still needs a person** (two machines, installers, real devices, reboots): one list, grouped by setup; ★ = must pass
before the next release (the ★ list proposed 2026-11-05, to be agreed with the owner) —
[docs/HUMAN_TESTS.md](../../docs/HUMAN_TESTS.md) (gathered 2026-10-09, set again on 2026-11-05; the older lists, archived in
`docs/archive/testing/`, point into it).
