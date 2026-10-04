# Critic — `multiuser_implementation_plan.md` revision 2, weighed against the product vision (2026-10-04)

**Reviewer:** an adversarial critic agent, briefed to distrust the reviser. The same session wrote the
audit (`MULTIUSER_PLAN_AUDIT_2026-10-04.md`), revision 2 and its "bigger picture" framing. The review was
read-only: nothing was run against the live farm.

**Re-verification by the reviser:**

- **Confirmed in code:**
  - C1: bench measures engine concurrency today (`farm/src/seats.js:62-70`,
    `farm/src/commands/bench.js:106`).
  - A2: more slots shrink the per-person floor. Auto context stops at the native max
    (`farm/src/commands/up.js:525-527`), `contextPerSlot = ctx/slots` (`farm/src/snapshot.js:106`), and
    the RAG threshold is 24576 (`shell/src/main/configBridge.ts:91`).
  - C6: OWUI's full-context branch returns every collection item
    (`open_webui/retrieval/utils.py:1680-1683` in 0.11.4).
  - C7: the 2026-09-07 quote, which is at `docs/DEVLOG.md:3638-3639`, not 3627-3628.
  - Coordinator discovery sweeps local subnets only (`farm/src/peerListener.js:90-100`).
  - The `ollama.hosts` recommendation (`docs/GETTING_STARTED.md:499-502`).
  - Context sized from the local host (`up.js:585-590`).
  - MTP disables `--cache-reuse` (`farm/src/llamacpp.js:188`).
  - `.lol-id` (`farm/src/identity.js:9`).
  - The 3-user bench (`docs/DEVLOG.md:5911-5913`).
- **Narrowed:** "the flagship farm has no password". Only the **repo's** `farm/lol.config.json` has
  `masterKey: null`. The live Farm app runs from its own copy, and `/lol/self` did not answer during
  this session, so the live state is unchecked.
- **Not verified:**
  - That a peer's 429 trips LiteLLM's `allowed_fails`/cooldown.
  - That `localAddress` 127.0.0.x works for bench on Windows.
  - That OWUI's title and search-query calls carry `OPENAI_API_CONFIGS` headers.

---

## A. Vision fit

Revision 2 is far better grounded than v1, but it still reads as a 16–20 week infrastructure program built
on an **unmeasured** need. It keeps v1's skeleton (vLLM, overflow, planner, catalog, TLS) and labels the
doubtful parts DECISION instead of cutting them.

The real need is a class of 20–30 people starting together on one or a few boxes, plus a handful every
day. Nothing in the repo records a real 429 or an overloaded workshop. The only multi-user measurement is
3 users at ~132 tok/s each (DEVLOG 2026-07-02).

§1b's direction (measure, then scale) is right, but it misses four things:

1. **Model choice is a bigger lever than the engine.** A 3B-active MoE on llama.cpp batches very
   differently from a dense 27B at IQ2_S, and the dev box already has `nemotron-3.5-lightning`.
2. **"Seats are a click" is false.** Auto context stops at the native max whatever `parallel` is, so 16
   slots on the PRO 6000 means a 16k floor. That flips every client to top-k RAG (< 24576), reboots
   every OWUI, and stops the coding agent compacting under "Keep going".
3. **Scale-out omits `ollama.hosts`** (already recommended in GETTING_STARTED), and the PRO 6000 can't
   discover the 10.10.17.x fleet.
4. **Demand-side load is a lever as big as supply**: thinking length, and web-search pages injected
   whole on every message.

For a ponytail owner, the measured core is about 2 weeks. Everything else should wait for numbers.

## B. Scorecard

| Item | Value | Cost | Risk | Fits rules | Evidence | Verdict | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.1 password before seat | L | ½ d | low | yes | code | KEEP (small) | Correctness, not capacity |
| 0.2 per-seat cap / ungated paths / Retry-After | M | 1–2 d | **high** | partly | code | RESHAPE | Fix Retry-After and refuse ungated paths now. A cap throttles coordinator peers and shared-IP PCs, and breaks today's bench |
| 0.3 persist plugin keys | M | ½ d | low | yes | code chain | KEEP | `registry.js:73` → `configBridge.ts:313` → sidecar repoint |
| 0.4 OCR cap | H | 1 d | a 429 = a failed upload | yes | code | RESHAPE | A semaphore with a wait queue on vision calls; text pages free; no filename log |
| 0.5 bench simulates people | M | ½–1 d | low | yes | assumption | RESHAPE | `localAddress` per user + realistic load; no header, no gate hook |
| 0.6 baseline | H | 2–3 d | live box | yes | — | KEEP, now | Today's bench already measures engine concurrency. Ollama `numParallel` on the dev box means restarting the shared Ollama: use a maintenance window or a spare 4080 |
| 1.1 identity | L | 3 d–1 wk | header = seat exhaustion; one OWUI reboot per client | yes | parsing verified, end-to-end not | DEFER | No shared-IP case observed |
| 1.2 fair queue | M | 1–2 wk | high | partial reversal | assumption | DEFER | Engine FIFO already queues admitted requests; count 429s first |
| 1.3 verify cancel + pin LiteLLM | H | ½–1 d | low | yes | `install.js:166` | KEEP #1 | Unpinned LiteLLM is fleet drift |
| 1.4 background tasks | M–H | ½ d for (c) | low | yes | OWUI code | RESHAPE | Measure, then (c) is one env line. (a) needs a queue; (b) isn't served beside non-Ollama engines |
| 1.5 OCR reserve | L | 2–3 d | reverses 08-26 | no | — | CUT | Moot on ≥ 48 GB |
| 1.6 client fixes | M–H | 2–3 d | low | yes | code reading | KEEP | Independent bugs, near one-liners |
| Phase 2 step 1 (measure) | H | merged | live box | yes | — | KEEP inside 0.6 | Also try pool = min(VRAM budget, native × slots) when unified |
| Phase 2 step 2 (managed vLLM) | L | 3–4 wk | WSL2 lifetimes | reverses 09-07 | measured elsewhere | CUT | Keep `external` |
| 3.0 fleet path | H | 1 wk | med | yes | code | RESHAPE | Peer slot sum, static peers across subnets, peer-429 cooldown, weigh `ollama.hosts` |
| 3.1 cache affinity | L | 1 wk | duplicates LiteLLM routing (kept 09-04) | weak | assumption | DEFER | |
| 3.2 overflow tier | L | 1 wk | high | breaks one engine at a time | assumption | CUT | |
| 3.3 metrics | M | 1–2 d minimal | per-install labels | partly | — | RESHAPE | 429 count, peak seats and TTFT p95 in the existing snapshot and panel |
| 3.4 workshop bench | M | in 0.5 | replay = an activity record | no | — | RESHAPE | Fold into 0.5; cut replay |
| 4.1 LAN model copy | L–M | 1–2 wk | couples us to Ollama's store format | yes | — | DEFER | One-off saving per box; document a manual copy |
| 4.2 QVAC plugins | L | — | — | — | measured negative | CUT | |
| 4.3 on-device fallback | L | — | — | violates CLAUDE.md | — | CUT | |
| 4.4 contract/schema | L | 1–2 d | low | new dir | snapshot already tested (`farm/test/run.js:856`) | DEFER | |
| Phase 5 planner + §9 catalog | L | 2–3 wk + upkeep | web numbers mislead | GitHub fetch borderline | measured elsewhere | CUT | Replace with a measured table from 0.6 |
| Security: revocation | L | 1 wk | — | — | — | CUT | Only exists with tokens |
| Security: TLS | L | 1 wk+ | DHCP vs certificate addresses, four trust stores | — | env verified | CUT | |
| §11 templates | M if rewritten | — | pasting breaks boot (strict schema) | — | — | RESHAPE | Keep only templates that run today on 4070, 4080, PRO 6000 and Spark; vLLM recipes go to an "external" appendix |

**Do these first:**

1. Pin LiteLLM and prove cancel reaches the engine.
2. Measure now: llama.cpp `parallel` 4/8/16, dense vs 3B-active MoE, realistic prompts, and generations
   and prefill per OWUI message.
3. Persisted plugin keys and the OCR semaphore.
4. The 1.6 client fixes.
5. A workshop preset (a short `seatIdleSec`, slots from the measurements) plus 3.0 reshaped.

## C. Load-bearing claims

1. **"Bench is one seat, so 8–16 can't be measured."** A wrong inference: one seat admits unlimited
   parallel streams. Only gate admission is unmeasurable. (0.2's cap would make it true.)
2. **"llama.cpp at 8–16 might be enough on the PRO 6000."** An assumption, with two caveats: the 16k
   floor, and IQ2_S being the wrong quant to batch on 96 GB. Falsified if TTFT p95 > 5 s or per-user
   < 15 tok/s at the real head count.
3. **"Seat leaks are a real capacity problem."** Weak. The keyless leak needs a passworded farm. The
   unlimited in-flight per seat is real, but it is also what keeps coordinators and bench working.
4. **"The client never fails over."** Verified (`farmSelect.ts:63-66`, load at `:18-25`). Use
   max(clients, seatsUsed)/slots.
5. **"Every farm restart reboots every client's OWUI."** Verified, on open and keyed farms alike
   (`farmSelect.ts:146` `keyId` refetch). How often farms restart is unknown.
6. **"Search-query generation on every message."** Verified, but the smaller cost: under
   `RAG_FULL_CONTEXT` the web pages are injected whole.
7. **"The fair queue reverses 2026-09-04."** Partly. The ask was about idlers; 2026-09-07 favours engine
   FIFO.
8. **"Header identity works through `OPENAI_API_CONFIGS`."** Parsing verified; per-call headers verified.
   Not shown: title and query calls carry it, or LiteLLM forwards it to peers. It makes seat exhaustion a
   curl flag without a per-IP cap.
9. **"The coordinator is the restart-free scale-out."** Plausible, but traffic is gated twice and the
   peer-429 cooldown is unverified. `ollama.hosts` has one gate but sizes context from the local host.

All of revision 2's spot-checked code citations were correct, except `python.js:28` → `:29`. One
omission: MTP turns off `--cache-reuse`.

## D. Internal consistency (all fixed in the plan after this review)

- 0.2's cap vs 0.5/0.6, and vs 3.0 (it throttles coordinator peers).
- 0.5 depended on 1.1, which was scheduled later.
- 1.4(a) needs a queue (1.2).
- Items scheduled as if decided: 1.4 in "cheap levers", 3.2 "in parallel".
- §11 carried 1.2 keys and an undefined `seatKey`.
- 3.1 needs `{{CHAT_ID}}` under Option B as well.
- The Security row tied TLS to tokens.
- 1.5 was missing from the Order list.
- §2's effort was understated against §12.
- Stale v1 text: §3's heading and intro, §11's `gpuMemoryUtilization`, §5.2's slider, §8's "prototyped
  in chat".

## E. What's missing

Recorded in the plan's §13b: per-surface waiting UX; the workshop operator flow; the slots-vs-context
trade; thinking control; web search `always` with full-context injection; subnets and shared
workstations; identity privacy at a school; mixed-version rollout and cloned `.lol-id`.

## F. Recommendations on the 8 decisions

1. **Target:** the PRO 6000 first, for one class, with the owner giving the real class size.
2. **Queue:** keep 429, add a workshop idle preset, fix each surface's wait message.
3. **Identity:** neither for now.
4. **Search query:** measure, then turn it off via env if it costs more than ~15 % of slot time.
5. **Managed vLLM:** no; keep 2026-09-07.
6. **OCR reserve:** no.
7. **Cuts:** 4.2 and 4.3, plus 3.2, Phase 5/§9 and managed vLLM.
8. **TLS:** no.
