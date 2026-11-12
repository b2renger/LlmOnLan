# Status: what is released, verified, and still to check

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

## Build status (2026-11-12) — released: client `v0.2.17` (OWUI `0.11.4`) · Farm app `farm-v0.0.53`

> What each release brought, from v0.2.0 on: the DEVLOG's release entries ([docs/DEVLOG.md](../../docs/DEVLOG.md), headed
> "Release …"; v0.2.5 is in its 2026-09-29 afternoon entry, farm-v0.0.47 and 0.0.48 in its 2026-10-13 ones).
> `origin/main` = the last release (client v0.2.17 and Farm app farm-v0.0.53, 2026-11-12). Since that day the work is
> committed on `main` in the owner's checkout and not pushed until a release (CLAUDE.md, *How we work*). The modules
> describe the code; a change from 2026-11-05 on names the release that brought it.

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
