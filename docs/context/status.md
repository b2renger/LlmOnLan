# Status: what is released, verified, and still to check

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

## Build status (2026-11-18) — released: client `v0.2.19` (OWUI `0.13.3`) · Farm app `farm-v0.0.54`

> What each release brought, from v0.2.0 on: the DEVLOG's release entries ([docs/DEVLOG.md](../../docs/DEVLOG.md), headed
> "Release …"; v0.2.5 is in its 2026-09-29 afternoon entry, farm-v0.0.47 and 0.0.48 in its 2026-10-13 ones).
> `origin/main` = the last release (client v0.2.19, 2026-11-18, cut by day on the owner's go; before it v0.2.18 and
> Farm app farm-v0.0.54, 2026-11-16, and v0.2.17 and farm-v0.0.53, 2026-11-12). Since that day the work is
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

**Unreleased on `main`** (since v0.2.19 and farm-v0.0.54; by 2026-11-22 06:18), each behind its human test and the
owner's go. **Client** (a local build for the tests: `shell/dist/LlmOnLan-Setup-0.2.19+n13-windows-x64.exe`, HUMAN_TESTS
G14): LOL Vibe's page beside its code and the pop-out window (VIBE_PAGE_PLAN, HUMAN_TESTS A29); *Plan first* beside the
message box, one per chat (G14); an attached document read once per chat (`RAG_SYSTEM_CONTEXT`, J16 step 6); a
Computer run no longer stands still up to a minute after a person answers a Dialog, a Confirm or a Timer (the run
loop's lost wake-up); a project's page keeps its saved data across a restart (the Preview's port); the coding
agent's session logs kept 30 days; dsh's own plan mode off; a chat tied to a project says the coding agent answers it
(not *press Project*); a coding-agent turn that did nothing, or only read, says so (it said the Changes tab showed what it
did). **Farm:** Qwen3.8 drafting ahead and keeping its state in 16 bits (J19); 128k of
context per person by default, Automatic 24 on the PRO 6000 (J16); a saved vLLM list running its built-ins with the
current flags; the panel's seat text. **Open WebUI stays at 0.13.3:** 0.13.4 would drop the Blender tools
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
