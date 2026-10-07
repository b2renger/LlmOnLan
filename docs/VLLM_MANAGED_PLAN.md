# vLLM, run by the farm — the plan

The fourth engine: the farm installs vLLM, starts it, sizes it, supervises it and stops it, on Windows (inside
WSL2) and on Linux x86_64 or arm64 with an NVIDIA GPU, operated entirely from the panel (the Farm app's window, or
`http://<box>:41997/lol/admin`). Written 2026-10-07 from the owner's request, after the production farm moved to
vLLM as an `external` engine:

> "I want to be able to switch from vllm to ollama or llama.cpp and back to vllm. I see the message 'Backend:
> Serving through an external OpenAI-compatible server at http://127.0.0.1:8100/v1. This farm routes to it and never
> starts, stops or configures it ... Set external.enabled=false and restart the farm to go back to the built-in
> engines.' And I do not want that: I want the farm operator to be able to do everything from the app. No config
> file etc. And what is this server: it should run from the farm, or at least the farm should control it (start it,
> stop it, configure it)."

This replaces the 2026-09-07 decision (the farm never installs, starts or restarts an external server) and the
2026-10-06 one (the `farm/vllm` recipe plus autostart, a managed engine deferred). `external` stays for servers the
farm cannot run (SGLang, TensorRT-LLM, another machine); the panel never pushes anyone toward it.

The design below went through a critic, whose critique found two blockers (a download that froze crash recovery,
and a Farm app launch that restarted vLLM) and fifteen other problems; every fix is folded in here. Owner rules that apply throughout: Open WebUI untouched, user data on
the client, local only, the ponytail ladder (reuse `llamacpp.js`'s shapes and the `farm/vllm` scripts), and plain
words in every text a person reads.

**The owner's four open questions, settled with these defaults (2026-10-07):**
- **(a) The take-over is one click by a person.** The farm never takes over a running vLLM by itself, even one its
  own scripts started: the panel offers "Let the farm run vLLM" (§9), and a person clicks it.
- **(b) Stop vLLM does not survive a farm restart.** After the operator's Stop, the next `lol up` starts vLLM again
  when vLLM is the engine.
- **(c) A card and model pair that was not measured says so**, with the Plan capacity link: "Not measured on this card
  with this model: start with fewer people and watch the Performance card. Plan capacity ↗ estimates it." (§7.1).
  The panel does not show the estimator's number as if it were measured.
- **(d) Installing WSL stays written instructions**, with no administrator button: the checklist says exactly what to
  run in an administrator PowerShell, and that the computer restarts (§7.2).

## Build status

Built in slices, each tested, logged in docs/DEVLOG.md and pushed on the `vllm-managed` branch (§12).
- **Slice A (2026-10-07): §12 items 1-3.** The scripts (`serve.sh` run by the farm with its marker, log rotation, `~`,
  logged refusals; `status.sh`; `stop.sh install` and its group-scoped report; `install.sh`'s steps, markers, uv,
  process group, link refusal and download errors; `start-windows.ps1`'s exit-0 line) with §11.2's tests in
  `farm/vllm/test_scripts.sh`; the `vllm` config block and library, `engineOf`, `serverRoute`, the names over four
  engines, the snapshot and the contract; `farm/src/vllm.js`'s pure functions with §11.1 items 1-14. Nothing starts
  vLLM yet: a config that selects it serves with Ollama, and the panel does not offer it.
- What the build changed in the design, so far:
  - `startPhase`'s kernels pattern is `torch.compile|Compiling|flashinfer.jit|JIT kernel|Autotuning|autotune with`:
    the design's `autotun` also matched the engine's configuration line (`enable_flashinfer_autotune=True`),
    which comes before the weights load.
  - On a DGX Spark, Automatic memory for conversations is 27 GiB, not 59 (§6): §3.2's own cap (what `maxNumSeqs`
    requests at once can hold, plus 10 %) applies after the 59, and 8 seats ask for 32 at once. 27 GiB still holds 36
    people's whole 64k windows, and the rest stays with the system the GPU shares.
  - `problemsFrom(probe, config, entry)` returns `{oks, problems, warnings}`: an older card and an older vLLM are
    said without blocking a start.
  - Small pure helpers the design's impure functions need, so they are tested now: `parseWslList` and
    `defaultDistro` (for `wslDistros`), `scriptCommand` (for `spawnScript`), `memOf`, `logOffset` (the
    rotation reset), `isOrphan` (the orphan rule), `argvFor`.
  - `status.sh` never creates the root (the design's `mkdir -p` before `df`): it measures the nearest folder that
    exists, so a check stays read-only.
  - `stop.sh` exits 1, and keeps its files, when something of the group survives the KILL, so the farm's retry (§3.2
    `stop`) still finds it.
- **Slice B (2026-10-07): §12 item 4.** `vllm.js`'s process half (the check, start, wait, stop, the log through
  `\\wsl.localhost`, install, folder removal) and `up.js`'s lifecycle: the boot that never waits for vLLM, adoption,
  health by phase (§1.5), the watch (three misses), `onVllmDown` with one restart then Ollama, the guard, the orphan
  rule, shutdown, the runtime record, document reading beside another engine (§1.4), Ollama evicted before vLLM and
  llama.cpp start; `lol down` (runtime file, else the config); `poolShortfall` in plain words; the gate's 503; the
  download slot; Stop on either slot. Tests: §11.1 item 16 and §11.3 items 1-11 (`farm/test/vllm-lifecycle.js`,
  opt-in `LOL_VLLM_FAKE=1`, a fake vLLM inside WSL and a fake Ollama).
- What slice B changed in the design:
  - Pulled forward from slices 5 and 6, because §11.3 items 4, 7, 8 and 9 drive them: `setBackend` over the four
    engines (§5.5), Apply's vLLM branch with its dry run (§5.6), and the controls and admin routes `vllm/check`,
    `vllm/start`, `vllm/stop`, `vllm/download` and `job/cancel`. No panel for them yet (slice 5).
  - The fallback to Ollama says healthy (and `failed`) only once LiteLLM routes to Ollama; §5.2's order said it
    before the proxy restart, and a client then met the gate's 502 (found by the lifecycle test).
  - `restartProxy`: when `lol down` ran from another shell during a proxy restart (the runtime file is gone), the
    farm stops, instead of living on with no proxy and holding its ports (found by the lifecycle test).
  - A download left running by a farm that crashed is stopped at boot (this run tracks none; Download continues it).
    The farm's own model download never blocks using another model (`problemsFrom`'s `installKind`).
  - The gate says "starting" during `stopping` too (a planned switch or Apply), "stopped" otherwise.
  - `makeJobs` (the job and download slots) moved to module level, so §11.1-16 tests it alone. A job body that has
    returned no longer counts as busy, so the restart `onVllmDown` queues from inside `serialize` is not refused.
  - Left for later slices: `ocrFits` and the panel (slice 5); Install and Update, the library's add, remove and
    Use this (slice 6; the plumbing exists); the take-over (slice 7). An Ollama pull still holds the job slot, so a
    vLLM crash during one waits for it.
- **Slice C (2026-10-07): §12 items 5-6.** The admin routes (§3.6: `vllm/install`, `vllm/library/add|remove`,
  `GET vllm/log`; model, memory and the dry run through `apply`); the panel (§7: the engine grid with Ollama,
  llama.cpp, vLLM and External only while configured; vLLM's line for each phase and its hero; its rows, trade line
  and Apply text, with the dry run; the vLLM card with the checklist, Install and Update, the list with Download, Use
  this and Remove, Add a model, folders found on disk, Start, Stop and the log; both bars with Stop; the document
  reading warning; the take-over card, empty until slice D); the D10 sweep; `ocrFits`; Install and Update in the
  download slot; the list's add and remove. Tests: §11.1 items 17-18 (the D10 check included) and lifecycle step 12
  (a switch away and back, Download then Use this, the list, the log, through the admin API).
- What slice C changed in the design:
  - Apply's decision is `vllm.js applyChange`, pure (the logic in vllm.js, §3.5), so §11.1-17 tests it alone. It also
    refuses a model whose window is shorter than the context per person, unless a context comes with it ("<model>
    reads at most N tokens: choose a context per person of N or less with it."): vLLM would refuse to start.
  - The vLLM button has a fourth subtitle before any check: "Many people at once on a big NVIDIA GPU. Press to check
    this computer." (§7.1's "Not set up on this computer yet" would be wrong on a box where vLLM is installed and not
    checked yet; the check runs on request only, §4.1).
  - Use this while another engine serves chooses the model a switch to vLLM serves (Apply with `model`, saved, nothing
    restarts); its row then says "chosen", and "serving" once vLLM is the engine.
  - Remove shows on every row that is not the chosen one and not downloading, downloaded or not (a model added by
    name and never downloaded must be removable); the second confirm, about the files, only when there are some. On
    Windows it names the drive that holds WSL's disk (`hostDrive`), not always C:.
  - The engine's Start and Stop have their own row ("Run vLLM"); the log row is always in the card; the card also
    shows after a start that fell back to Ollama, so "Show the log for details" has a log to show.
  - The checklist does not list the farm's own install or download as one "started earlier" (the download bar shows
    it, with Stop); a switch and a start still refuse during an install. "Stop it" on one started earlier runs
    `stop.sh install` (`job/cancel` with the download slot, when the farm runs none).
  - The D10 sweep went past §3.15's list: the "not saved" warnings (four places in up.js, now one `notSaved`, the
    reason in the farm's log), the name's result, llama.cpp's "no model chosen", and `ensureLlamacpp`'s message.
    Lines the farm only logs (the terminal and farm.log, for whoever runs `lol` by hand) keep their keys; the D10
    test reads every string the farm can hand the panel and the panel's own.
  - Install with a model that is a folder on disk (no repo) runs only the Python environment and vLLM steps.
  - The admin state reads Ollama's `/api/ps` with sizes (for `ocrFits`), where it read the names only.
  - Found by lifecycle step 12, and older than this work: the 10 s health tick recorded a probe that met a PLANNED
    LiteLLM restart, so after every switch, Apply or model start the farm could say unhealthy for up to 10 s, and
    clients leave (what D5 forbids). The tick now ignores a probe taken during a planned restart, and a restart that
    succeeds says up at once. Step 12 samples `/lol/self` every 200 ms through two switches: unhealthy in 3 runs of 3
    before, healthy throughout after.
- **Slice D (2026-10-07): §12 item 7.** The take-over (§9): detection once the farm is public and at Check again
  (`vllm.takeOverProbe`, `vllm.takeOverPlan`), the card's offer and its result with Undo, `vllmTakeOverRun` (the copy
  of the file, the vllm block in and the external block out through `configFile.takeOverFile`, the marker through
  `vllm.setMarker`, then adoption with no proxy restart), Undo (`undoTakeOverFile`, the marker removed); the Farm
  app's supervisor (§3.12: `lol down` first, `keepEngine` for the share toggle, the crash restart reaps first,
  `reapStaleFarm` never stops vLLM) and Linux autostart (§3.13); the docs (farm/README "vLLM, run by the farm" and
  "External: a vLLM you run yourself", PRO6000_VLLM_SWITCH Part 2, CLAUDE.md, the multiuser plan's Phase 2 status).
  Tests: §11.1 items 15 and 19 (`farm-app/test/supervisor.test.js`), the take-over's plan and panel, §11.3 items 12-13
  (lifecycle steps 13 and 14).
- What slice D changed in the design:
  - Detection runs once the farm is public (and at Check again), not in the boot's step 0c-ter: the check can boot
    WSL's distribution (up to a minute), and D5 says the boot never waits for vLLM.
  - The offer is made only when `adoptable()` holds for the block it would write (checked, not assumed "by
    construction"): a server started with `--api-key` (the farm's route sends its own key), one without a flag the
    farm would add, a model outside `<root>/hf`, or a served name that cannot be a list id is not offered.
  - The block keeps a running server's memory, request cap and guard (`kvCacheGib`, `maxNumSeqs`, `minFreeGb`) and
    its other flags (`extraArgs`, in the order `adoptable` lists them). A server that does not run gets only what the
    external block declared (the name, the model, context, people); the rest stays the farm's own.
  - On a box whose GPU shares the memory, a running server without `LOL_VLLM_MIN_FREE_GB` gets `minFreeGb: 0`, not
    `'auto'` (which means 8 there), so it is adopted as it runs.
  - A list entry whose folder, presence penalty or vision differ from what runs is copied with them (same id) and a
    note; the routing then stays the external route apart from its key.
  - The take-over compares the routing before and after (keys aside) and restarts LiteLLM only when they differ; on
    production they do not (the golden test).
  - Undo is offered while vLLM still runs as it was adopted and the file is still the one the take-over wrote (no
    setting changed since); a take-over that started vLLM (nothing ran) has no Undo. Undo removes the copy once it
    is back.
  - The not-running take-over switches to vLLM as a boot does: the stand-in engine (llama.cpp) stops, LiteLLM routes
    to vLLM (the gate says "starting"), then the job "Starting vLLM". One still starting is waited for.
  - The Farm app's stop runs `lol down` only when there was a farm (a child, or a runtime file): a Quit after Stop
    does not run it again (it could boot WSL for nothing). `reapStaleFarm` now also reaps llama-server, Classify,
    speech to text and the bus (the share toggle's no-tree kill on Windows leaves them otherwise).
  - Launch at login on Linux is also re-applied at each start while it is on (an AppImage update can move it).
  - The lifecycle's step 13 also covers the not-running take-over; step 14 runs the whole farm from a copy in a
    folder whose name has a space (the scripts through `wsl.exe --cd "...\LlmOnLan Farm\farm\vllm"`).
- **Left:** §11.4, the live test with a real vLLM beside production (and A16, the code refresh over a running
  `serve.sh`, its step 10), then §11.5 / §9.6 with the owner (a release of the Farm app first).

## 0. Decisions

D1. vLLM becomes a fourth engine, `vllm`.
- The farm installs, starts, sizes, supervises and stops it, on Windows (inside WSL2) and on Linux x86_64 or arm64 with an NVIDIA GPU.
- It is operated entirely from the panel: the Farm app's window, or http://<box>:41997/lol/admin in any browser.
- This replaces the 2026-09-07 rule ("never runs an external server") and the 2026-10-06 recipe plus autostart.

D2. `external` stays, for servers the farm cannot run: SGLang, TensorRT-LLM, another machine.
- Its panel button shows only while the raw lol.config.json holds an `external` block, meaning a developer wrote one. It is never offered otherwise.
- Taking over a local vLLM deletes the block (a backup file keeps it).

D3. The farm drives the scripts in farm/vllm; it does not re-implement them.
- serve.sh launches (daemon mode, relay, CUDA shims, memory guard, pgid file), stop.sh stops, install.sh installs, and a new read-only status.sh reports.
- The farm owns the whole `vllm serve` argv (vllm.js planFor), as llamacpp.js does for llama-server.

D4. vLLM is not tied to the farm process.
- Intentional stops always run stop.sh: `lol down`, the Farm app's Quit and Stop, an engine switch, an Apply that changes the launch, the Stop button, a fallback.
- A crash of `lol up` or of the Farm app leaves vLLM running, and the next `lol up` adopts it.
- On Windows, the farm's wsl.exe child survives a `lol up` crash. Only a tree-kill (taskkill /T) ends it, and every Farm app path that tree-kills runs `lol down` first, or keeps the engine on purpose (§3.12).

D5. A farm whose engine is vLLM does not block its boot on vLLM.
- The proxy, gate, panel and beacon come up in seconds, and vLLM starts as an admin job, "Starting vLLM".
- A PLANNED start (boot, Start, switch, Apply, Use this) keeps the farm healthy and advertises `busy`, as today's llama.cpp switch does. Clients keep their farm, and v0.2.8 clients show amber "<farm> · Starting vLLM…".
- While nothing answers, the gate gives generation requests a 503 with a plain message.
- Only an unplanned death, the operator's Stop and the memory guard make the farm unhealthy, so clients fail over (today's contract).

D6. Moving from the operator recipe is one panel click, "Let the farm run vLLM".
- It keeps the same model, name and settings, adopts the running server, and restarts neither vLLM nor the proxy.
- The old launchers become harmless through a marker file, `<root>/run/managed-by-farm`, that serve.sh honours:
  - the Windows log-on task then only opens the Farm app;
  - lol-vllm.service starts nothing.
- No scheduled task and no systemd unit is changed.

D7. Downloads never interrupt serving and never block the farm.
- "Install vLLM", "Update vLLM" and "Download" run in a separate DOWNLOAD slot: one at a time, outside the admin job slot and outside `serialize`.
- They never appear in the snapshot's `busy`, and they can be cancelled and resumed.

D8. One engine at a time.
- Engine selection stays the existing booleans (`llamacpp.enabled`, `external.enabled`, plus the new `vllm.enabled`), resolved by one function, `engineOf(config)`, with the precedence external > vllm > llamacpp > ollama.
- setBackend always writes exactly one of them true.
- ponytail: no top-level `engine` key. The upgrade path is a single key with a one-time migration.

D9. Adoption and Apply compare SETTINGS, never numbers worked out again.
- An explicit setting must equal what the running server was launched with.
- An Automatic setting accepts the running value; it is worked out again at the next start.

D10. No text a person reads names a config file or key: not the panel, not an admin error, not a job result. The developer README still documents the keys.

## 1. Engine model

### 1.1 engineOf(config) lives in litellm.js, next to ollamaServes.
- It returns 'external' | 'vllm' | 'llamacpp' | 'ollama', and ollamaServes = (engineOf === 'ollama').
- Every exclusivity check goes through it:
  - buildLitellmConfig;
  - snapshot.js: the served model and backendInfo;
  - up.js: every `config.external.enabled` or `config.llamacpp.enabled` that means "this engine serves" (the ones that mean the setting stay as they are);
  - perf.shouldEvictOllama: `otherEngineOn: !ollamaServes(config)`.

### 1.2 The panel switch.
- Buttons: Ollama, llama.cpp, vLLM. "External server" shows only while the raw file holds an external block.
- POST /lol/admin/backend {engine} accepts 'ollama', 'llamacpp' and 'vllm', and 'external' only in that case.
- Switching away from external is allowed: it persists external.enabled=false and keeps the block. If its baseUrl is a loopback address and no take-over is offered (§9), the confirm reads: "The server at <url> keeps running and keeps its share of the GPU: <engine> gets only what is left (<n> GB free now)."
- Switching to vllm needs all of these:
  - a supported platform;
  - vLLM installed;
  - the selected model downloaded;
  - no install running;
  - a plan that fits (§5.2).
  Otherwise it refuses up front, with no job, with the §7.2 sentence.

### 1.3 Names. carryNameAcross(config, from, to) replaces (config, toLlamacpp), and its call sites are updated.
- servedNameOf(config, e):
  - ollama: the default entry's servedName (its own alias, else modelAlias, else the raw id); it is "raw" when it equals the underlying id;
  - llamacpp: llamacpp.alias;
  - vllm: vllm.alias;
  - external: external.alias.
- Moving to a named engine (llamacpp, vllm, external): if the current name is not a raw Ollama id and differs, the plan sets `<to>Alias = name`. Leaving Ollama with modelAlias set also gives modelAlias: null, today's rule that the serving engine holds the one name.
- Moving to Ollama: today's rule. The name goes onto the default entry's own alias if it has one, else into modelAlias, and is skipped when nameTakenByOther is true.
- applyNamePlan and persistNamePlan learn the keys vllmAlias and externalAlias.
- setBackend's restoreNames snapshots all of these, in memory AND in the raw file: llamacpp.alias, vllm.alias, external.alias, modelAlias, models. A failed switch puts them all back.
- fallbackNamePlan is unchanged.
- engineFallback(config, 'vllm') sets vllm.enabled=false and llamacpp.enabled=false IN MEMORY only, so Ollama serves; its plan is fallbackNamePlan(config, vllm.alias). The 'external' fallback falls to vLLM when vllm.enabled is true, as it falls to llama.cpp today.
- setModelAlias's guard becomes "while any non-Ollama engine serves", and its taken-name check adds vllm.alias.
- A rename on vLLM changes only LiteLLM's model_name: one proxy bounce, and vLLM keeps running. vLLM's own --served-model-name is the library id, which is stable.

### 1.4 The Ollama catalog and document reading while vLLM serves.
- The catalog is standby inventory, as under llama.cpp: not routed, not advertised, editable without a proxy bounce (standbyModels). The interactive picker is skipped.
- Document reading (OCR) still drives Ollama directly. Automatic sizing keeps vllm.ocrReserveGib (default 9) for it when ocr.enabled.
- resolveOcrModel(config) gains a rule: when engineOf is not 'ollama' and ocr.model is unset, prefer `gemma4:12b` if that tag is installed on a local host (/api/tags, read once at boot and after each pull or remove); otherwise keep today's choice. Production has it installed (7.6 GB), so this rule alone fixes it.
- getAdminState adds `ocrFits`: false when the OCR model's size exceeds the reserve. The size is its /api/ps size_vram when loaded, else its /api/tags size + 1 GiB. The panel then warns (§7.6).
- An engine switch that changes resolveOcrModel's answer restarts the OCR plugin (bringDown, then bringUp) inside the switch job.
- Before ANY vLLM or llama.cpp start, the job evicts every model loaded on local Ollama hosts (ollama.evictModel), then waits until free memory stops rising (measureVramFreeGb). Today's pressure eviction (at least 92 % used and idle) keeps working beside both engines.

### 1.5 Health and `busy`, by vLLM phase (the snapshot's `healthy` = proxy up && engineUp !== false):

| Phase | engineUp | Snapshot `busy` | Gate answer to a generation |
|---|---|---|---|
| starting (planned: boot, Start, switch, Apply, Use this, take-over) | unchanged; true at boot | the job | 503 "starting" |
| ready | true | none | normal |
| restarting after an unplanned stop | false | the job "Restarting vLLM after it stopped unexpectedly" | 503 "stopped" |
| stopped (the operator's Stop, or a cancelled start) | false | none | 503 "stopped" |
| guard | false | none | 503 "stopped" |
| failed (fell back to Ollama) | null, as on Ollama | none | normal (Ollama serves) |

## 2. Config (strict zod, farm/src/config.js)

Everything below is set by the panel and persisted by configFile.js patchSection('vllm', …) or patchConfigFile. Nobody edits the file.

```js
const VllmModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),                         // the key; vLLM's --served-model-name
  label: z.string(),
  repo: z.string().regex(/^[A-Za-z0-9][\w.-]*\/[\w.-]+$/).nullable().default(null), // null = a folder already on disk
  folder: z.string().regex(/^[\w.-]+$/).nullable().default(null),              // under <root>/hf; default = the repo's basename
  sizeGb: z.number().nullable().default(null),                                // download size
  weightsGib: z.number().nullable().default(null),                            // vLLM's "Model loading took X GiB"; null = the size on disk
  vision: z.boolean().nullable().default(null),                               // null = read from the checkpoint (vision_config)
  presencePenalty: z.number().min(-2).max(2).nullable().default(null),
  args: z.array(z.string()).default([]),                                      // model-specific vllm serve flags
  catalog: z.string().nullable().default(null),                               // farm/src/capacity/catalog.json id
  measured: z.string().nullable().default(null),                              // farm/src/capacity/measured.json key
  note: z.string().default(''),
}).strict();

const VllmSchema = z.object({
  enabled: z.boolean().default(false),
  root: z.string().regex(/^(~|(\/[\w.-]+)+|~(\/[\w.-]+)+)$/).nullable().default(null), // a Linux path, no "..";
       // null = the first install found (~/lol-vllm, then ~/lol-spike), else ~/lol-vllm. The resolved absolute
       // path is persisted after an install or a take-over.
  distro: z.string().regex(/^[\w.-]+$/).nullable().default(null),             // Windows; null = WSL's default (docker-desktop skipped)
  port: z.number().int().positive().default(8100),                            // the relay's 127.0.0.1 port (LOL_VLLM_PORT)
  alias: z.string().default('assistant'),
  model: z.string().default('qwen3.6-35b-a3b'),                               // a library id
  contextLength: z.number().int().min(4096).default(65536),                   // per person → --max-model-len
  parallel: z.union([z.literal('auto'), z.number().int().min(1).max(512)]).default('auto'),     // seats
  maxNumSeqs: z.union([z.literal('auto'), z.number().int().min(1).max(1024)]).default('auto'),  // auto = min(512, max(32, nextPow2(2 × seats)))
  kvCacheGib: z.union([z.literal('auto'), z.number().min(1)]).default('auto'),  // GiB → --kv-cache-memory-bytes = GiB × 2^30
  ocrReserveGib: z.number().min(0).default(9),
  marginPct: z.number().min(0).max(30).default(8),
  minFreeGb: z.union([z.literal('auto'), z.number().int().min(0)]).default('auto'), // the memory guard; auto = 8 on unified memory, else off
  version: z.string().default('0.30.0'),                                      // vLLM pinned in <root>/.venv
  extraArgs: z.array(z.string()).default([]),                                 // appended last; the take-over puts unknown running flags here
  library: z.array(VllmModelSchema).default([ /* the three entries below */ ]),
}).strict();
```

ConfigSchema gains `vllm: VllmSchema.default({})`.

- maxReplyTokens: proxy.maxReplyTokens is reused. On the managed engine it becomes `--override-generation-config {"max_new_tokens": N}` (null = no override), so changing it restarts vLLM. The key's comment changes to say: on managed vLLM it applies; on external, the server's own setting applies.
- presencePenalty comes from the selected library entry.
- Units are GiB throughout (nvidia-smi MiB / 1024; vLLM reports GiB). 50 GiB = exactly 53687091200 bytes.

Default library (commands from docs/spike/RESULTS.md "Exact install and launch commands"):
1. 'qwen3.6-35b-a3b'
   - label 'Qwen3.6 35B-A3B · NVFP4'; repo nvidia/Qwen3.6-35B-A3B-NVFP4; sizeGb 23.4; weightsGib 20.37; vision true; presencePenalty 1.5.
   - args ['--kv-cache-dtype','fp8','--enable-prefix-caching','--mamba-cache-mode','align','--reasoning-parser','qwen3','--enable-auto-tool-choice','--tool-call-parser','qwen3_xml'].
   - catalog 'qwen3.6-35b-a3b'; measured 'qwen36'.
   - note 'Default. Sees images. Measured: 48 people at 64k on an RTX PRO 6000, 8 on a DGX Spark.'
2. 'nemotron-3.5-lightning'
   - label 'Nemotron 3.5 Lightning 30B-A3B · NVFP4'; repo nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4; sizeGb 21.6; weightsGib 17.82; vision false; presencePenalty null.
   - args ['--kv-cache-dtype','fp8','--enable-prefix-caching','--mamba-cache-mode','align','--mamba-backend','flashinfer','--reasoning-parser','nemotron_v3','--enable-auto-tool-choice','--tool-call-parser','qwen3_coder'].
   - catalog 'nemotron-3.5-lightning-30b-a3b'; measured 'nemotron'.
   - note 'The most people at 32k (160 on an RTX PRO 6000, 16 on a DGX Spark). Does not see images.'
3. 'qwen3.8-27b-nvfp4'
   - label 'Qwen3.8 27B · NVFP4'; repo nvidia/Qwen3.8-27B-NVFP4; sizeGb 21.9; weightsGib 19.92; vision true; presencePenalty null.
   - args ['--kv-cache-dtype','fp8_e4m3','--enable-prefix-caching','--mamba-cache-mode','align','--reasoning-parser','qwen3','--enable-auto-tool-choice','--tool-call-parser','qwen3_coder'].
   - catalog 'qwen3.8-27b'; measured 'qwen38'.
   - note 'The best answers of the three and the fewest people (16 at 32k on an RTX PRO 6000). Too slow on a DGX Spark.'

FAMILY_ARGS (vllm.js), for a model the operator adds. It is a regex table matched against the repo or folder name:
- /qwen3\.[56]|qwen3-?next/i → entry 1's args.
- /qwen3\.8/i → entry 3's args.
- /nemotron/i → entry 2's args.
- /qwen3/i → ['--enable-prefix-caching','--reasoning-parser','qwen3','--enable-auto-tool-choice','--tool-call-parser','hermes'].
- anything else → ['--enable-prefix-caching'].
ponytail: a model the table does not know gets no thinking or tool parser, and the panel says so. The upgrade path is per-entry args.

## 3. Files and functions

### 3.1 farm/vllm/ (bash)

How the farm runs a script:
- Windows: `wsl.exe [-d <distro>] --cd <Windows path of farm\vllm> -e env K=V… bash ./<script>`.
- Linux: `bash ./<script>`, with cwd farm/vllm.
- Every call has a timeout. The spawn environment drops ELECTRON_RUN_AS_NODE, LOL_PYTHON, PYTHONHOME and PYTHONPATH.

serve.sh changes:
- a) `ROOT="${ROOT/#\~/$HOME}"` (also in stop.sh, install.sh and status.sh).
- b) Managed mode. When LOL_VLLM_ARGS_B64 is set: `mapfile -d '' -t X < <(printf %s "$LOL_VLLM_ARGS_B64" | base64 -d)` (the list is NUL-separated), then ARGS=(--uds "$SOCK" "${X[@]}"), with no built-in defaults and no "$@". Managed mode also writes the marker (`: > "$ROOT/run/managed-by-farm"`) after mkdir. The operator path (variable unset) is unchanged.
- c) The marker. If $ROOT/run/managed-by-farm exists and LOL_VLLM_ARGS_B64 is unset, print and log "The LlmOnLan farm runs this vLLM now (its panel starts and stops it): this start does nothing." and exit 0. This check comes before the setsid re-exec and before the "No vLLM" check.
- d) Rotation at start: if vllm.log is over 50 MB, `mv -f "$LOG" "$LOG.1"`.
- e) The early refusals ("No vLLM in", "relay could not listen", a bad LOL_VLLM_MIN_FREE_GB) also go to the log, so a launch whose stdout is gone still explains itself. mkdir logs first.
- Nothing else changes: daemon mode, the guard, the relay, the pgid leader check and the CUDA shims stay.

stop.sh changes:
- (a);
- the final check becomes `pgrep -g "$G"` (this group only);
- `stop.sh install` stops the group in $ROOT/run/install.pgid, with the same leader check (install.sh in its cmdline), TERM then KILL.

install.sh changes:
- (a), plus `export UV_PYTHON_PREFERENCE=only-managed`.
- It installs uv itself when missing (`curl -LsSf https://astral.sh/uv/install.sh | sh`, user-local, no sudo).
- It becomes a process-group leader (serve.sh's 3 lines) and writes $ROOT/run/install.pgid.
- LOL_VLLM_STEPS (default "venv,model"; "model" = download only). With "model" it never touches the venv.
- It REFUSES the venv steps when $ROOT/.venv is a symlink.
- It prints `[lol-step] uv|venv|vllm|cuda-pins|check|model <repo>|done` before each step.
- Download errors: it prints `[lol-error] gated|notfound|disk|network <text>` when hf's output matches 401/403/"gated", 404, "No space left", or anything else.

status.sh (NEW, read-only, about 40 lines) prints key=value lines.
- Env: LOL_VLLM_ROOT, LOL_VLLM_PORT, LOL_VLLM_ROOTS (more candidate roots, colon-separated). Every curl uses -m 5.
- Lines:
  - home=, arch=, root=, distro=$WSL_DISTRO_NAME, uv= (PATH or ~/.local/bin/uv), curl=
  - gpu=<name>,<MiB total>,<MiB free>,<compute_cap> (nvidia-smi; no line = not visible)
  - mem_total_kb=, mem_available_kb=
  - disk_free_kb= (df -Pk "$ROOT" after mkdir -p)
  - install=<root> <vllm version> (one per candidate root with .venv/bin/vllm; the version from the vllm-*.dist-info folder name) plus `venv_link=1` when .venv is a symlink
  - model=<folder> <kB> vision=<0|1> native=<max_position_embeddings> partial=<0|1> (each <root>/hf/*/ with a config.json; partial when *.incomplete files remain)
  - running=<pgid> (run/vllm.pgid's leader cmdline contains serve.sh), then:
    - env=LOL_VLLM_PORT=…, env=LOL_VLLM_MIN_FREE_GB=…, env=LOL_VLLM_ARGS_B64=… (from /proc/<pgid>/environ)
    - arg=<each element after "serve" of the oldest ' serve ' process in the group> (the first arg= is the model path)
    - ready=1 (curl --unix-socket run/vllm.sock /health)
  - found=<root> <port> <pgid> (every serve.sh process-group leader on the machine; root and port from its environ, defaulting to $HOME/lol-vllm and 8100)
  - guard=<the last [guard] line> (when run/vllm.guard exists)
  - installing=<pgid>
  - managed=1 (the marker exists)

relay.py: unchanged.

start-windows.ps1: when serve.sh exits 0 before vLLM answers, it logs "The farm runs vLLM now: opening the Farm app, which starts it." and still opens the Farm app (the existing branch). Its header comment says it is for an operator-run vLLM. lol-vllm.service: header comment only.

### 3.2 farm/src/vllm.js (NEW, shaped like llamacpp.js; the pure functions are exported for tests)

- supported() → {ok, why}: win32 x64 (through WSL), linux x64 or arm64; else {ok:false, why:'mac'|'platform'}.
- decodeWsl(buf): UTF-16LE (with or without BOM, detected by NUL bytes), else UTF-8.
- wslDistros() → [{name, state, version, isDefault}] or {error:'no-wsl'|'no-distro'|'timeout'}, from `wsl.exe -l -v` (15 s). It does not boot the VM. The default is the one marked *; when that is docker-desktop*, the first other WSL 2 distribution.
- spawnScript(config, script, env, {timeoutMs, onLine, detached}) → {code, out, err, timedOut}.
- parseStatus(text) → {home, arch, root, distro, uv, curl, gpu:{name,totalGib,freeGib,cap}|null, memTotalGib, memAvailableGib, diskFreeGb, installs:[{root,version,link}], models:[{folder,gb,vision,native,partial}], running:{pgid, port, minFreeGb, managedArgs, argv, ready}|null, found:[{root,port,pgid}], guardLine, installing, managed}.
- hostDiskFreeGb(distro) (Windows): the distribution's BasePath from `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss /s /v BasePath` (matched by DistributionName), else the drive of %LOCALAPPDATA%; then fs.statfsSync. Linux: null.
- probe(config, {roots}) → {at, platform, wsl, facts, hostDiskFreeGb}. One wsl.exe call with a 60 s timeout (it boots the distribution if stopped). Cached in up.js and never called per panel poll.
- problemsFrom(probe, entry) (pure) → {oks, problems}; the texts are in §7.2. Disk is the smaller of WSL's df and the host drive.
- resolveRoot(config, facts) (pure): the configured root; else the first install among ~/lol-vllm and ~/lol-spike; else ~/lol-vllm.
- facts(entry) (pure, catalog.json) → {kvBytesPerToken (the fp8 value, ×2 when the args have no fp8 KV dtype), stateBytes, nativeCtx}, or nulls.
- peopleFit(poolGib, ctx, f) (pure) = floor(poolGib × 2^30 / (ctx × kvB + state)), or null.
- seatsAuto(entry, gpuName, ctx, fit) (pure, measured.json).
  - box: /RTX PRO 6000 Blackwell(?!.*Max-Q)/ → 'pro6000', /GB10/ → 'spark', else null.
  - Measured: the 'every' label at ctx (or the nearest measured context above). "≥ N" → N, "< N" → max(1, N/2). Then min(that, fit) when fit is known.
  - Not measured: min(16, fit ?? 4).
  - Returns {seats, source:'measured'|'memory'|'default', label}.
- measuredFor(entry, gpuName) (pure) → {box, at:{32768:{every,steady},65536:{…},131072:{…}}} or null.
- maxNumSeqsAuto(seats) (pure) = min(512, max(32, nextPow2(2 × seats))): 48 → 128, 8 → 32, 96 → 256.
- poolGib({totalGib, freeGib, unified, memAvailableGib, weightsGib, ocrReserveGib, marginPct, minFreeGb, cap}) (pure) → {gib, why, ok, reason}.
  - Discrete GPU: floor(freeGib − marginPct % × totalGib − weightsGib − 4 − ocrReserve).
  - Unified memory: floor(memAvailableGib − marginPct % × totalGib − minFreeGb − weightsGib − 4 − ocrReserve).
  - Capped at maxNumSeqs × (ctx × kvB + state) × 1.1 when the facts are known.
  - ok is false under one person's window, or under 1 GiB.
  - (4 GiB of runtime: production measures 74.9 GiB used = 50 pool + 20.37 weights + ~1.4 desktop + ~3.)
- settingsOf(config) (pure) → the launch settings: {modelId, modelPath, ctx, seats, maxNumSeqs, kvCacheGib, maxReply, extraArgs, port, minFreeGb}, with 'auto' kept as 'auto'.
- planFor(config, probe, mem, {ocrEnabled}) (pure) → {ok, reason, entry, root, port, folderPath, seats, seatsSource, maxNumSeqs, kvGib, kvWhy, minFreeGb, env, argv, peopleFit, settings}.
  - argv = ['--served-model-name', entry.id, '--max-model-len', ctx, '--max-num-seqs', N, '--kv-cache-memory-bytes', String(kvGib × 2^30), ...entry.args, ...(maxReply ? ['--override-generation-config', JSON.stringify({max_new_tokens: maxReply})] : []), ...extraArgs].
  - env = {LOL_VLLM_DAEMON:1, LOL_VLLM_ROOT, LOL_VLLM_PORT, LOL_VLLM_MODEL: <root>/hf/<folder>, LOL_VLLM_ARGS_B64 (NUL-joined), [LOL_VLLM_MIN_FREE_GB], [MAX_JOBS=4 on unified memory]}.
- flagMap(argv) (pure): drops --uds X; a value flag keeps its last value; a boolean flag = true; the --override-generation-config value is parsed as JSON. Order-insensitive.
- adoptable(config, running) (pure) → {ok, resolved:{kvGib, maxNumSeqs, seats}, diff}.
  - Equal: model path, port, the entry's args, maxReply, extraArgs, ctx; and minFreeGb as an explicit value or 'auto' (8 on unified, off otherwise).
  - kvCacheGib: equal when explicit; when 'auto', the running --kv-cache-memory-bytes is accepted.
  - maxNumSeqs: equal when explicit; when 'auto', equal to maxNumSeqsAuto(resolved seats), where resolved seats comes from the running pool when seats are 'auto'.
- bootDecision({supported, problems, running, adopt}) (pure) → 'unavailable'(reason) | 'adopt' (running, ready, adoptable) | 'wait' (running, not ready, adoptable) | 'restart' (running, not adoptable) | 'start'.
- downDecision({guard, running, ready, portAnswers, lastRestartAt, now}) (pure) → 'guard' | 'none' (running && ready && portAnswers) | 'restart' | 'fallback' (a restart less than 5 min ago).
- startPhase(lines) (pure). It splits on /\r|\n/, and the "(EngineCore pid=N)" prefix is ignored. It returns {key, text, percent}:
  - "[serve]…pgid=" → 'starting', "starting vLLM"
  - "Resolved architecture" or "Using max model len" → 'reading', "reading the model"
  - "Loading safetensors checkpoint shards: P% … k/n" → 'weights', "loading the model weights (k of n)", percent P
  - "Model loading took X GiB" → weightsGib learned
  - /torch\.compile|Compiling|flashinfer\.jit|JIT kernel|autotun/i → 'kernels', "preparing the GPU (the first start takes a few minutes longer)"
  - "GPU KV cache size: N tokens, Maximum concurrency for C tokens per request: Fx" → poolTokens N, peopleFit floor(F)
  - "Capturing CUDA graphs" → 'graphs', "capturing GPU graphs"
  - "init engine" → 'almost', "almost ready"
  - "[serve] … ready:" → 'ready'
  - "[serve] … vLLM exited (status S)" → 'exited', S
- explainFailure(code, lines, ctx) (pure): the sentences in §7.5.
- start(config, plan): spawns serve.sh in daemon mode (the Windows host process is wsl.exe, the Linux one bash) with {detached:true, stdio:'ignore', windowsHide:true}. It records the log size first; the child's exit code is serve.sh's.
- waitReady(config, plan, {isDead, onPhase}):
  - every 3 s: GET http://127.0.0.1:<port>/v1/models (up.js externalAlive), and read the new log bytes (restart at 0 when the file is smaller than the offset);
  - fails fast when the child exits or the log says "vLLM exited";
  - stall: no new log byte for 10 min; cap: 30 min;
  - with no child (the boot's 'wait' case), isDead = status.sh shows no running group (checked every 30 s).
- stop(target): stop.sh (60 s timeout), repeated until status.sh shows no running group (at most 3 tries, 10 s apart), then until the port no longer answers (15 s). Returns {ok, error}.
- readLog(config, {fromByte|lastLines}). Windows: fs on \\wsl.localhost\<distro><root>\logs\vllm.log (no wsl.exe per poll); fallback `wsl … tail -n`. Linux: fs.
- install(config, {steps, repo, folder}, onProgress, isCancelled): runs install.sh and parses [lol-step] and [lol-error]. During the model step, every 5 s it sums the file sizes under <root>/hf/<folder> (*.incomplete included) against sizeGb, for the rate meter.
- removeFolder(config, folder): direct argv `rm -rf -- <root>/hf/<folder>`, with both the root and the folder validated by their regexes. Refused for the configured model, the running model, and a folder being downloaded.
- baseUrl(config) = `http://127.0.0.1:${port}/v1`.

### 3.3 farm/src/litellm.js
- engineOf; ollamaServes uses it.
- serverRoute(name, servedModel, apiBase, apiKey, {presencePenalty, vision}, peers) builds the `hosted_vllm/` entry plus the coordinator peers (moved out of today's external branch). Both external and vllm call it.
  - For vLLM: (vllm.alias, entry.id, baseUrl, 'sk-lol-vllm', {entry.presencePenalty, vision}).
  - No replyCap: vLLM enforces the limit through its own launch.
- carryNameAcross(config, from, to); applyNamePlan's new keys; engineFallback('vllm').

### 3.4 farm/src/snapshot.js
- backendInfo(vllm) → {engine:'vllm', alias, model: entry.label, contextLength: ctx, contextAuto:false, contextPerSlot: ctx, slots: config.vllm.parallelResolved ?? (number parallel) ?? 4, slotsVerified:true, mtp:false, kvCacheType: 'fp8' if the args say so, else 'auto'}.
- llamacppServedModel is renamed servedEngineModel and gains vLLM: {id: vllm.alias, underlying: entry.label, default:true}.
- `busy` is unchanged: downloads are not jobs.

### 3.5 farm/src/commands/up.js (glue only; the logic lives in vllm.js)

State:
- vllmProbe (cached), vllmBootError, vllmChild, vllmTakeOver;
- vllmState = {phase, text, percent, adopted, startedAt, poolTokens, peopleFit, weightsGib, lastRestartAt, launchSettings, misses}.

The DOWNLOAD slot (new; outside serialize, outside busy()):
- dl = {id, kind:'install'|'download', label, message, percent, bytes, total, bytesPerSec, etaSec, done, ok, error, cancel}, sharing makeRateMeter.
- runDownload(kind, label, fn) refuses a second download ("A download is already running: <label>.").
- jobView's twin is downloadView; the admin state carries `download`.
- Rules:
  - Install and Update are refused while vLLM runs from that root.
  - A switch to vLLM, Start and Use this are refused while an install (venv steps) runs: "vLLM is being installed: wait for it, or stop it."
  - Downloading model X never blocks using model Y.

Boot, step 0c-ter, after the external probe:
- a) Orphan rule. When supported, engineOf !== 'vllm', and a root is known (config.vllm.root, or the stale runtime's vllm), run status. If a group runs there AND managed=1, stop it and log "Stopped a vLLM left running from <root>: this farm serves with <engine> now." A group without the marker belongs to someone else and is left alone.
- b) When engineOf === 'vllm':
  - probe (on timeout or error → unavailable);
  - problemsFrom for the selected entry (not installed / not downloaded / partial / installing → unavailable);
  - unavailable → engineFallback(config,'vllm') with vllmBootError = the sentence;
  - otherwise bootDecision:
    - adopt → engineUp=true, phase 'ready', adopted, launchSettings from the running argv, parallelResolved etc. from adoptable().resolved;
    - wait, restart or start → phase 'starting', engineUp=true (planned), and the boot job is queued.
- c) When engine is external, its baseUrl is loopback and the platform is supported: probe with LOL_VLLM_ROOTS="~/lol-vllm:~/lol-spike" and the baseUrl's port, then fill vllmTakeOver (§9).

Step 2b: nothing blocks on vLLM. Step 3: routing from engineOf (the vLLM route even while it starts). End of run(), where onEngineDown(-1) sits today: `if (vllmBootJob) startVllmJob('Starting vLLM')`.

startVllm(progress) runs the §5.2 steps and returns {ok, message}. stopVllm() runs vllm.stop and returns {ok, error}: it nulls vllmChild before stop.sh (identity guard) and sets phase 'stopped'.

startVllmJob(label): runJob('engine', label, fn, {cancel}). The cancel runs vllm.stop.
- Failure, not cancelled: vllmBootError = explainFailure, then fallbackToOllama.
- Cancelled: phase 'stopped', engineUp=false; the farm stays on vLLM.

fallbackToOllama(reason):
- engineFallback(config,'vllm'), logging the names;
- vllm.stop (nothing half-alive keeps the GPU);
- resolveOllamaContext, restartProxy;
- phase 'failed', engineUp=null, beacon kick.

Supervision:
- The farm-spawned child's exit event:
  - 0 or 143 while vllmChild was nulled → ignore;
  - 3 → phase 'guard', engineUp=false;
  - otherwise → onVllmDown now.
- Health tick, when engineOf is 'vllm', phase 'ready' and no admin job: externalAlive(baseUrl, 10 s). Three misses in a row → onVllmDown.
- onVllmDown runs in serialize, which downloads never hold. Its steps:
  1. engineUp=false and a beacon kick;
  2. status;
  3. portAnswers = externalAlive(15 s);
  4. downDecision:
     - none: log "vLLM answered slowly", reset the misses;
     - guard: phase 'guard';
     - restart: lastRestartAt=now; runJob('engine','Restarting vLLM after it stopped unexpectedly'), stopping first when a group still runs; engineUp=true once ready;
     - fallback: reason "vLLM stopped twice in 5 minutes: <explain>".

Perf sampler: when engineOf is 'vllm' and phase 'ready', fetchMetrics(metricsUrlFor(vllm.baseUrl)) → vllmSample; totalSlots = seats; poolWarning = poolShortfall(seats, ctx, kvPoolTokens, 'vllm').

getAdminState adds `vllm`:
- enabled, supported, probe {oks, problems, at}, installed, version, pinned, root, distro, port;
- alias, model, library [{…entry, downloaded, partial, gbOnDisk, active}], foundFolders;
- contextLength, parallel, parallelResolved, seatsSource, maxNumSeqs, kvCacheGib, kvResolvedGib, kvWhy;
- phase, phaseText, percent, adopted, bootError, poolTokens, peopleFit, measured (measuredFor), takeOver, ocrFits, ocrModel.
It also adds `externalConfigured` = the raw file holds an external block, plus `download`.

writeRuntimeState adds `vllm: {root, distro, port, platform}` while the engine is vLLM or a download runs.

shutdown (SIGINT/SIGTERM) runs vllm.stop and `stop.sh install` when recorded. onProxyExit does NOT stop vLLM (the next `lol up` adopts it). The boot reaping of a stale runtime never touches vLLM, except through the orphan rule.

runJob gains {cancel}; jobView exposes `cancellable`; POST /lol/admin/job/cancel {slot:'job'|'download'}.

setBackend over the 4 engines (§5.5). applyFarmSettings gets a vLLM branch (§5.6). The legacy setSlots, setAdvertisedName and setContextLength call applyFarmSettings when engineOf is 'vllm'; their 1–16 bounds stay for the other engines.

New controls: vllmCheck, vllmInstall, vllmDownload(id), vllmLibraryAdd, vllmLibraryRemove, vllmStart, vllmStop, vllmLog(lines), vllmTakeOver, vllmUndoTakeOver, cancel.

externalRefusal's text is in §7.7.

### 3.6 farm/src/selfServer.js (all with the admin token)
- POST /lol/admin/vllm/check, /vllm/install, /vllm/download {id}, /vllm/library/add {repo|folder,label?}, /vllm/library/remove {id, deleteFiles?}, /vllm/start, /vllm/stop, /vllm/take-over, /vllm/take-over/undo, /lol/admin/job/cancel {slot}.
- GET /lol/admin/vllm/log?lines=200 → {lines}.
- /lol/admin/apply accepts model, kvCacheGib and dryRun. /lol/admin/backend accepts 'vllm', and 'external' when configured.

### 3.7 farm/src/commands/down.js: after today's kills, stop vLLM:
- the target = rt.vllm, else (loadConfig succeeds, engineOf(config)==='vllm' and supported) {config.vllm.root, distro, port};
- vllm.stop(target), then `stop.sh install`;
- it prints "Stopping vLLM (this frees its GPU memory) …".

### 3.8 farm/src/commands/install.js: no change (cut). The panel installs vLLM.

### 3.9 farm/src/perf.js: poolShortfall(slots, ctx, pool, engine), with no config keys in any wording.
- vllm: "The memory for conversations holds <fit> people at <ctx>, fewer than the <slots> this farm lets in at once: past <fit>, people wait. Lower People at once or Context per person, or give vLLM more GPU memory for conversations."
- external: "The server holds context memory for <fit> people at <ctx>, fewer than the <slots> this farm lets in at once: past <fit>, people wait."

### 3.10 farm/src/seats.js: a thunk `unavailable: () => string|null`, checked after the password and BEFORE a seat is claimed. A gated generation route then gets 503, Retry-After 60, {code:'lol_engine_starting', message}, while the vLLM phase is not 'ready'. The messages:
- starting: "This farm's model is starting: about 2 minutes. Try again then."
- otherwise: "This farm's model is stopped for now. Try again later."
/v1/models and the health routes stay open; the allowlist is unchanged.

### 3.11 Contract: snapshot.schema.json adds 'vllm' to backend.engine. farm/contract/examples.js gets 2 examples: managed vLLM starting (healthy true, busy {kind:'engine', label:'Starting vLLM'}) and serving.

### 3.12 farm-app/src/main/farmSupervisor.ts and index.ts:
- stop(opts = {keepState, keepEngine}):
  1. gen++, child=null;
  2. unless keepEngine: run `lol down` FIRST (process.execPath [lolEntry(), 'down'], ELECTRON_RUN_AS_NODE=1, the supervisor's env, cwd farmRoot, 120 s timeout); it stops LiteLLM, the plugins and vLLM, and `lol up` exits by itself;
  3. then killTree(child.pid) as a backstop;
  4. then reapStaleFarm() (today's pid sweep; it never stops vLLM).
  With keepEngine on Windows, kill `lol up`'s own pid without /T, so its wsl.exe child, and with it vLLM's WSL session, survives. reapStaleFarm then kills the recorded LiteLLM and plugins.
- Quit (before-quit) and the Stop button call stop() and so stop vLLM. The share toggle calls stop({keepState:true, keepEngine:true}), and the new `lol up` adopts (R14 gone).
- onChildExit (crash restart): `await reapStaleFarm()` before `this.start()`. This fixes the orphan LiteLLM that blocks a restart on Windows today; the new `lol up` adopts vLLM.
- startFarm is unchanged.

### 3.13 farm-app/src/main/index.ts: on Linux, `set-launch-at-login` writes or removes ~/.config/autostart/llmonlan-farm.desktop with Exec="$APPIMAGE" (about 10 lines; Electron's login item does nothing there).

### 3.14 Client: no code change. Only the doc comment in shell/renderer/chat/core/types.mjs changes (the engine union gains 'vllm').

### 3.15 Docs and text sweep:
- farm/README.md: a new "vLLM, run by the farm" section (prerequisites, what Install does, where files live, the log, take-over, rollback). The two recipe sections become "External: a vLLM you run yourself", trimmed.
- docs/PRO6000_VLLM_SWITCH.md: "Part 2: let the farm run it", with the rollback.
- A DEVLOG entry; the CLAUDE.md farm bullet (four engines; the 2026-09-07 rule replaced); the status in multiuser plan §5.
- The D10 sweep, every operator-facing config wording:
  - index.html 223-224, 262, 272, 588, 783;
  - up.js 2215;
  - perf.js 175;
  - llamacppBootError's "set llamacpp.binDir" becomes "Not available on this computer: there is no ready-made llama.cpp for it.";
  - the sub-line becomes "Changes apply to the running farm and are kept for the next start, except the plugin toggles and the Blender recommendation (this session only) and Ollama's people served at once (after a farm restart)."

## 4. Availability and install from the panel

### 4.1 Detection, cheapest first, never per panel poll:
- the platform, in memory at every boot;
- on Windows, `wsl.exe -l -v` (lazily, at the first getAdminState, async; 'checking' until then);
- the full probe (status.sh) runs only:
  - at boot, when the engine is vLLM or the orphan rule needs it;
  - for take-over detection;
  - on the first open of the vLLM card (the panel posts /vllm/check when probe is null) and on "Check again";
  - after an install, a download, a start or a stop.

### 4.2 Requirements (each one maps to a §7.2 sentence):
- Windows: WSL installed; a distribution present; WSL 2; the GPU visible inside it; x86_64.
- Linux: an NVIDIA GPU (nvidia-smi); x86_64 or aarch64; curl.
- Both:
  - disk: about 10 GB for the venv plus the model's sizeGb, and on Windows the smaller of WSL's df and the host drive;
  - GPU memory at least the smallest library weightsGib + 4 + 2;
  - compute capability below 12.0 gives a warning, not a block.
- uv and Python are not requirements: install.sh brings them.
- Installing WSL needs an administrator and a restart. The panel says exactly how and never tries it (open question (d)).

### 4.3 "Install vLLM": runDownload('install', 'Installing vLLM').
- It runs install.sh (steps venv,model; repo = the selected entry) into the resolved root, then persists the root.
- The messages are plain steps: "getting the installer (uv)", "creating the Python environment", "downloading vLLM 0.30.0 and its GPU libraries (about 8 GB)", "matching the CUDA compiler to the GPU libraries", "checking the GPU", "downloading <label> — 12.3 of 23.4 GB". The model step reports bytes and the total; the venv steps show elapsed time.
- It is resumable: run it again and it skips what is done.
- When status finds an install at a candidate root (here ~/lol-spike, 0.30.0), the card says so, Install is not offered, and that root is persisted the first time vLLM is used.
- A different version shows "Update vLLM": the same job, refused while vLLM runs from that root.

### 4.4 The library:
- Download {id}: runDownload('download', 'Downloading <label>') with steps=model. It runs while vLLM serves another model.
- Add a model {repo}: accepts "owner/name" or https://huggingface.co/owner/name[/…]. It creates {id: a slug of the name, label: the name, repo, args: FAMILY_ARGS}. Adding only remembers; nothing downloads.
- Folders in <root>/hf that are not in the library get "Add to the list" (folder set, repo null).
- Remove {id}: refused for the configured or running model. A second confirm offers to delete the files (removeFolder).
- Use this {id}: only when downloaded and not partial. It is an Apply with `model` (§5.6).

## 5. Lifecycle

### 5.1 The phases are in §1.5.

### 5.2 Start (startVllm). Each step refuses with its reason before anything is stopped, where it can:
1. Refuse while an install runs.
2. Evict the local Ollama models; wait until free memory stops rising.
3. If a group runs from the root and is not adoptable (or a restart was asked), stop it (vllm.stop). If the stop fails, return that error.
4. Measure memory: gpuFreeGb and the total, or /proc/meminfo MemAvailable on unified memory (gpuFreeGb null with a real GPU).
5. planFor; when !ok, return plan.reason.
6. vllm.start: daemon mode, the env, the base64 argv. serve.sh writes the marker.
7. waitReady, with progress from startPhase: the phases, poolTokens and peopleFit, and the [serve] lines and a failure's last error lines copied into farm.log (log.childPrefix('vllm')).
8. Set parallelResolved, maxNumSeqsResolved, kvResolvedGib and launchSettings (the settings plus the resolved numbers); phase 'ready'; engineUp=true; beacon kick.

### 5.3 Adopt: a group running from the configured root, on the configured port, with adoptable() true.
- Ready → used at once, with no job.
- Running but not ready → the boot job waits without spawning (a Farm app crash in the middle of a start lands here).
- Not adoptable → stopped, then started with the farm's settings.
- Ownership is the root's pgid file plus the marker; who started the server does not matter.

### 5.4 Stop: vllm.stop.
- Triggers: `lol down` (the CLI, and the Farm app's Quit and Stop through supervisor.stop); the SIGINT/SIGTERM shutdown; an engine switch away; an Apply with a launch change; the Stop button; a fallback; the orphan rule.
- A crash or kill of `lol up` does NOT stop it (adopt next time), and neither does the Farm app's share toggle (keepEngine).
- CLI note: "`lol down` stops vLLM; a farm that crashed leaves it running until the next `lol up` or `lol down`."

### 5.5 Engine switch (setBackend; job 'Switching to <engine>'; planned, so `busy`):
1. Snapshot the names and flags, in memory and on disk.
2. Stop the current engine, and RETURN ITS ERROR IF THE STOP FAILS, with nothing changed:
   - llama.cpp → stopLlamacpp;
   - Ollama → evict;
   - vLLM → stopVllm (its stop must succeed);
   - external → nothing (see the §1.2 confirm).
3. carryNameAcross(from, to); persist the flags so exactly one is true; apply and persist the names.
4. Start the target: vLLM → startVllm; llama.cpp → startLlamacpp (after the eviction); Ollama → resolveOllamaContext.
5. restartProxy; restart the OCR plugin if its model changed.
6. On failure at steps 4-5: restore the flags and names, start the previous engine again, restartProxy, and return the error. This is today's rollback, generalized.
Switching to vLLM refuses up front when it is not installed, the model is not downloaded, an install runs, or the plan cannot fit.

### 5.6 Apply (applyFarmSettings, vLLM branch). The fields: name, slots, context, kvCacheGib, model, password, seatIdleSec.
- Validation:
  - slots 1–512;
  - context from 4096 up to the model's native maximum (catalog, else the folder's native value);
  - kvCacheGib 'auto' or 1 up to the card's GiB;
  - the model downloaded;
  - the new plan fits one person's window;
  - today's rules for the name and the password.
- Effective new settings: 'auto' kv keeps the launch's resolved value (it is never worked out again while vLLM runs); maxNumSeqs 'auto' = maxNumSeqsAuto(new seats).
- restart = an effective model, ctx, kv, maxNumSeqs, maxReply or extraArgs differs from launchSettings. So 48 → 40 people does not restart, 48 → 80 does (128 → 256), a context change does, and a name change does not.
- dryRun returns {restart, changes} and does nothing; the panel confirms only when restart is true.
- No restart: persist. The seats apply live (the gate's capacity thunk reads backendInfo). A name, password, presencePenalty or vision change costs one restartProxy.
- Restart (job 'Applying the farm settings'): persist, stopVllm (abort on failure), startVllm(new), restartProxy. On failure, persist the previous settings and startVllm(previous); if that fails too, fallbackToOllama("<new error>; the previous settings did not come back either: <error>").
- seatIdleSec alone applies at once, as today.

### 5.7 Supervision: as in §3.5. One restart; a second within 5 minutes falls back to Ollama with the reason, as llama.cpp does today. The guard is never restarted and never falls back. A hung server (running, not ready) counts as a crash. A dead relay restarts.

### 5.8 The GB10 clock warning (perf.makeClockWatch) stays as it is.

## 6. Sizing and seats — worked numbers for the tests
- RTX PRO 6000: total 95.59 GiB; vLLM's own "Initial free memory 93.04 GiB" at 17:47. With Qwen3.6 and OCR on: 93.04 − 7.65 − 20.37 − 4 − 9 = 52.0, so 52 GiB. Production's 50 stays as a migrated, explicit number.
- With ComfyUI's ~45 GB resident: about 8 GiB, which holds 10 people at 64k, so the automatic seats become min(48, 10) = 10.
- With OCR off: +9.
- DGX Spark (unified memory; MemAvailable ≈ 110 of 119.2 GiB; guard 8): 110 − 9.5 − 8 − 20.4 − 4 − 9 = 59 GiB (the spike used 58). On unified memory, MAX_JOBS=4 and minFreeGb 8 come from "auto".
- People per pool = floor(pool × 2^30 / (ctx × kvB + state)). Qwen3.6: kvB 10240, state 128.8 MB. 50 GiB at 64k → 67 (vLLM's own log says 65.82×). After a start, vLLM's "Maximum concurrency … Fx" replaces the estimate.
- Automatic seats:
  - PRO 6000 + Qwen3.6: 96 at 32k, 48 at 64k, 32 at 128k (each capped by the pool);
  - Spark + Qwen3.6: 8, 8, 4;
  - Nemotron at 64k on a PRO 6000: 16;
  - not measured: min(16, fit or 4).
- maxNumSeqs auto: 48 → 128 (production's), 8 → 32 (the Spark unit's).
- The live test guard is in GiB: production uses 74.9 GiB (76,672 MiB).

## 7. Panel (farm/src/admin/index.html): layout and every sentence

### 7.0 The vLLM card's first line: "vLLM is an engine made for serving many people at once on a big NVIDIA GPU. On Windows it runs inside WSL, the Linux that comes with Windows. The farm installs it, starts it and stops it."

### 7.1 The Backend card.
- The engine grid: `repeat(auto-fit, minmax(170px, 1fr))`. Buttons and their subtitles:
  - Ollama: "The models below. Several to choose from, for a few people at once."
  - llama.cpp: today's text. When unavailable: "Not available on this computer: there is no ready-made llama.cpp for it."
  - vLLM:
    - ready to use: "Many people at once on a big NVIDIA GPU. One model; it takes about 2 minutes to start."
    - not set up: "Many people at once on a big NVIDIA GPU. Not set up on this computer yet: press to see how."
    - unsupported, disabled: "Not available on this computer: vLLM needs an NVIDIA GPU on Linux, or Windows with WSL."
  - External server (only while configured): "A server this farm does not run, set up by a developer."
- Clicking vLLM when it is not ready opens the vLLM card and runs Check, without switching.
- Switch confirms:
  - to vLLM: "Switch to vLLM? Chat stops for about 2 minutes while vLLM loads the model (longer the very first time, while it prepares the GPU)."
  - from vLLM: "Switch to <Ollama|llama.cpp>? vLLM stops and <engine> loads its model: about a minute, and anyone connected waits."
  - from a loopback external not offered for take-over: the §1.2 sentence.
- The hint under the buttons: "Switching stops the current engine and starts the other: about a minute for Ollama or llama.cpp, about 2 minutes for vLLM."
- Hero (vLLM): the name; "vLLM · <entry label>"; "<seats> people at once · <ctx>k of context each · <n> connected now".
- Status line by phase:
  - starting: "vLLM is starting: <phase text>. About 2 minutes, longer the first time. Until it is ready, people connected see “Starting vLLM”, and a message sent meanwhile is answered with “try again in a moment”."
  - ready and adopted (until the next restart): "vLLM was already running with these settings, so the farm kept it running."
  - stopped: "vLLM is stopped, so nobody can chat. Press Start vLLM below, or switch to another engine."
  - guard: "vLLM was stopped because this computer was running out of memory (<N> GB left; it stops below <M> GB, before the GPU gets stuck at a slow speed). Close what is using the memory, then press Start vLLM."
  - down: "vLLM is not answering. The farm is checking it."
  - the restart job's label: "Restarting vLLM after it stopped unexpectedly".
  - failed (warnline): "vLLM could not start: <reason>. The farm serves with Ollama for now. Fix the cause, then switch back to vLLM."
- Rows, all under the one Apply:
  - Name users see (vLLM too): "what appears in the model picker. Renaming takes a few seconds; vLLM keeps running."
  - People served at once (vLLM):
    - options: Automatic, 1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, and the current value;
    - Automatic reads "Automatic — <n>, measured on this card", "Automatic — <n>, what the memory holds" or "Automatic — 4 to start with";
    - meta: "people who can write to the model at the same time. They share the GPU, so each reply slows as more write at once; past this number a new message waits for a free seat."
  - Free an idle seat after, and Farm password: unchanged.
  - Context per person (vLLM):
    - options: 8k, 16k, 32k, 64k, 128k, 256k, and the model's maximum when larger, all at most the native window;
    - meta: "the longest conversation or document one person can use. A longer context means fewer people fit in the GPU's memory."
  - GPU memory for conversations (vLLM):
    - options: "Automatic — what the GPU has free, less the model, <9> GB for document reading and a safety margin (now <k> GB)", plus 16, 24, 32, 40, 50, 60, 70, 80 GB, keeping only those below the card's size;
    - meta: "memory vLLM keeps for everyone's conversations. Automatic is worked out again at each start.";
    - on unified memory: "…from what the computer has free, keeping <8> GB so it cannot run out."
- The trade line (tradeLine for 'vllm'):
  - "<After Apply, each|Each> person gets <ctx> of context."
  - "The memory for conversations holds <peopleFit> people at that size." (when known)
  - "Measured on this card with this model: <every> at <ctx> when everyone writes at once, <steady> in normal use." or "Not measured on this card with this model: start with fewer people and watch the Performance card. <a class=plan href=/lol/capacity>Plan capacity ↗</a> estimates it."
  - then today's document and coding-agent sentences (perPerson('vllm') = ctx).
  - Warnlines:
    - seats above the measured number: "More people than measured on this card: when everyone writes at once, replies may slow below a comfortable reading speed."
    - seats × ctx over the pool: "The memory holds only <n> people at <ctx>: past that, vLLM makes people wait. Lower the people or the context, or give it more memory."
- The Apply row (vLLM): "Changes above apply together. A new context, memory or model restarts vLLM: about 2 minutes during which nobody can chat. People at once, the name and the password apply in a few seconds." When the dry run says restart: "Apply now? vLLM restarts: about 2 minutes during which nobody can chat."

### 7.2 The vLLM card ("Model · vLLM"). It shows while vLLM is the engine, or after the operator clicked the vLLM button.
- A checklist: ✓ lines muted, ✗ lines as warnlines, then [Check again].
- ✓ lines:
  - "WSL is installed, with <Ubuntu> on WSL 2."
  - "<Ubuntu> sees the GPU: <name> (<n> GB)."
  - "GPU: <name> (<n> GB shared with the system)." (Linux, unified memory)
  - "<n> GB free for vLLM and its models."
  - "vLLM <v> is installed (in <root>)."
  - "Found an existing vLLM in <root>: the farm will use it."
- ✗ lines:
  - no WSL: "WSL is not installed. vLLM runs on Linux; on Windows it runs inside WSL, which an administrator installs once. Open PowerShell as administrator, run  wsl --install -d Ubuntu , and restart the computer. Then open Ubuntu from the Start menu once, to choose a user name and password, and press Check again."
  - no distribution: "WSL has no Ubuntu yet. In PowerShell, run  wsl --install -d Ubuntu , then open Ubuntu from the Start menu once to choose a user name and password, and press Check again."
  - WSL 1: "<Ubuntu> runs on WSL 1, which cannot use the GPU. In PowerShell, run  wsl --set-version <Ubuntu> 2  (a few minutes), then press Check again."
  - the GPU not visible: "<Ubuntu> cannot see the GPU. Install the latest NVIDIA driver for Windows (it also serves WSL), restart the computer, then press Check again."
  - WSL did not answer: "WSL did not answer within a minute. Restart the computer, then press Check again."
  - Linux without a GPU: "No NVIDIA GPU was found (nvidia-smi does not answer). vLLM needs an NVIDIA GPU and its driver."
  - curl: "curl is missing. In a terminal, run  sudo apt install curl , then press Check again."
  - architecture: "vLLM needs a 64-bit Intel, AMD or ARM processor."
  - disk: "Not enough free disk: vLLM and <model> need about <n> GB, and <m> GB are free.<Windows: Ubuntu's disk lives on drive <X>:.> Free some space, then press Check again."
  - small GPU: "This GPU has <n> GB: too little for any model in the vLLM list (the smallest needs about <m> GB). llama.cpp is the engine for this card."
  - an older card (a warning): "This GPU is older than the cards these models were measured on (RTX PRO 6000, DGX Spark): they may not load. If a start fails, llama.cpp is the engine for this card."
  - an older version: "vLLM <v> is installed; this farm was tested with <pin>." [Update vLLM]
  - an install already running: "A download started earlier is still running. Wait for it, or stop it here." [Stop it]
- [Install vLLM], with its hint: "Downloads vLLM <pin> (about 8 GB) and <model label> (<n> GB) into <Ubuntu>, in <root>. About 45 minutes on a typical connection. The farm keeps serving while it downloads; a stopped download continues where it left off."
- Library rows: label · "<size> GB" · note. Badges: "serving", "downloaded", "partly downloaded". Buttons: [Download] when not downloaded; [Use this] and [Remove] when downloaded and not active. An unknown family adds: "Not one of the measured models: answers work, but tools and thinking may not show until a developer adds its settings."
- Confirms:
  - Use this: "Serve <label>? vLLM restarts with it: about 2 minutes during which nobody can chat."
  - Remove: "Remove <label> from the list?", then "Also delete its files from this computer (<n> GB)?" On Windows that confirm adds: " The space goes back to Ubuntu; drive C: does not shrink."
- Add a model: an input with the placeholder "nvidia/Qwen3.6-35B-A3B-NVFP4" and [Add]. Meta: "the name of a model on Hugging Face (owner/name), made for vLLM. Adding only remembers it: press Download, then Use this."
- Found folders: "Also on this computer: <folder> (<n> GB)" [Add to the list].
- Engine controls, when vLLM is the engine:
  - [Stop vLLM], confirmed with "Stop vLLM? Nobody can chat until you start it again or switch engine.";
  - [Start vLLM];
  - [Show the log]: the last 200 lines in a <pre>, with [Refresh]. Meta: "vLLM's own log, for when something goes wrong. It does not record conversations, but an error line can quote a few words of a reply."

### 7.3 The job bar and the download bar.
- The admin job bar is as today, with [Stop] when cancellable. After a cancelled start: "Stopped. vLLM is not running: press Start vLLM."
- The download bar is separate and shows the same fields (step, GB of GB, speed, time left) with [Stop]. After a cancel: "Stopped. Press <Install vLLM|Download> again to continue where it left off."
- Download failures:
  - gated: "Hugging Face asks for an account to download this model. Pick another model."
  - not found: "There is no model named <repo> on Hugging Face. Check the name."
  - disk: "The disk is full. Free some space, then press Download again."
  - network: "The download stopped: <short reason>. Press Download again to continue where it left off."

### 7.4 The take-over card: §9.2.

### 7.5 Failure sentences (explainFailure):
- exit 3 or the guard: the §7.1 guard sentence.
- "CUDA out of memory", "OutOfMemoryError" or "No available memory for the cache blocks": "vLLM ran out of GPU memory while starting. Lower GPU memory for conversations or the context, or close other programs using the GPU (they use <n> GB now)."
- "is already running": "A vLLM from <root> is already running but does not answer. Press Stop vLLM, then Start vLLM."
- "relay could not listen": "Another program uses port <port>, maybe a vLLM started outside the farm. Stop it, then press Start vLLM."
- "No vLLM in": "vLLM is not installed in <root>. Press Install vLLM."
- "not a supported model architecture" or "failed to be inspected": "This vLLM version cannot load <label>. Pick another model."
- stall: "vLLM stopped making progress for 10 minutes. Show the log for details."
- cap: "vLLM was still not ready after 30 minutes. Show the log for details."
- otherwise: "vLLM stopped while starting. Its last error: <the last ERROR or Traceback line>."

### 7.6 The Performance card shows for 'vllm' as for an external vLLM. Its warnings:
- poolWarning (the §3.9 wording);
- "Also in GPU memory: …" (existing);
- when ocrFits is false: "Document reading uses <model> (<n> GB), which does not fit the <9> GB kept for it beside vLLM: documents will read slowly. Download gemma4:12b in the Ollama list below; the farm then uses it."

### 7.7 External (only while external serves):
- The card: "Serving through a server this farm does not run, at <url>. Its model, context and people at once are set where that server runs. To serve from this farm instead, pick Ollama, llama.cpp or vLLM above."
- externalRefusal: "This farm routes to a server it does not run, so its model, context and people at once are that server's own. To change them here, switch to Ollama, llama.cpp or vLLM."
- tradeLine: "…as that server was set up."

### 7.8 The Ollama list while vLLM serves: today's standby text, with engineName 'vLLM'.

## 8. Autostart
- Windows: the Farm app's "Launch at login", or, on a box migrated from the recipe, the existing log-on task, which now only opens the Farm app (the marker makes its serve.sh do nothing). Either way the farm comes up in seconds, and the boot job starts vLLM (WSL boots in about 5 s, then about 1.5 min). Both being on is harmless: the Farm app has a single-instance lock.
- Linux: the same through the §3.13 .desktop file, which needs a graphical login. A headless box keeps the external recipe for now (R4).
- Clients see the farm healthy and "Starting vLLM" (busy). The gate's 503 explains itself, and the panel shows the phases. The Farm app's health wait sees /lol/self early, so its 5-minute inactivity rule never meets a long engine start.

## 9. Migration: this box, and a Linux recipe farm

### 9.1 Detection (boot, and /vllm/check), when the engine is external with a loopback baseUrl and the platform is supported:
- run status with LOL_VLLM_ROOTS="~/lol-vllm:~/lol-spike" (ponytail: the second is this box's spike folder) and LOL_VLLM_PORT = the baseUrl's port;
- offer when a `found=` group listens on that port and its root has an install, or, when nothing runs, when a candidate root has an install and a folder whose library entry id equals external.model;
- vllmTakeOver = {root, distro, port, running, pgid, argv, env}.

### 9.2 The card: title "vLLM on this computer".
- Running: "The vLLM this farm routes to runs on this computer, from <root>. The farm can run it itself: then you change its model, people and context here, and it starts and stops with the farm. It keeps the same model, name and settings and keeps running: nobody is interrupted." [Let the farm run vLLM]
- Not running: the same, ending "…and starts it now: about 2 minutes, during which nobody can chat."

### 9.3 vllmTakeOver(). It is a quick serialized operation of a few seconds, or a start job when nothing runs.
- Build the `vllm` block from the facts:
  - root (absolute), distro (from status's distro=), port;
  - model = the library entry whose id equals the running --served-model-name; else a new entry {id: the served name, folder: basename(the model path), args: FAMILY_ARGS};
  - alias = external.alias; contextLength = --max-model-len (else external.contextLength); parallel = external.parallel;
  - kvCacheGib = --kv-cache-memory-bytes / 2^30 (else 'auto');
  - maxNumSeqs = 'auto' when maxNumSeqsAuto(parallel) equals the running value, else that number;
  - minFreeGb from the environment, else 'auto';
  - running flags that the entry does not produce go into extraArgs, so adoptable() holds by construction. A presence penalty that differs from the entry's gives a copied entry with a note.
- Copy lol.config.json to lol.config.json.before-managed-vllm.
- patchConfigFile: add the vllm block with enabled true, and DELETE the `external` block.
- Write the marker (`wsl … -e touch <root>/run/managed-by-farm`, direct argv; Linux: fs).
- In memory: engine vllm; adopt (phase 'ready', adopted, launchSettings from the running argv); writeLitellmConfig (the file only, NO proxy bounce: the routing is the same apart from api_key); writeRuntimeState; beacon kick. Nothing runs → startVllmJob instead.
- Clients see the same alias, Qwen3.6, and contextPerSlot 65536, so farmContext is unchanged and Open WebUI does not restart.
- Result texts:
  - "The farm now runs vLLM. Nothing was restarted."
  - Windows: "If this computer started vLLM at log on before, that now only opens the Farm app."
  - Linux: "The lol-vllm service stays installed but starts nothing now. To remove it: sudo systemctl disable lol-vllm."

### 9.4 Rollback.
- [Undo], until the next farm restart:
  - put the backup file back;
  - remove the marker;
  - in memory: external serves, vllm.enabled false;
  - writeLitellmConfig, with no bounce.
  - vLLM keeps running.
  - Text: "Back as before: the farm routes to vLLM without running it."
- By hand (docs/PRO6000_VLLM_SWITCH.md, Part 2):
  1. quit the Farm app (this stops vLLM);
  2. `Copy-Item "$cfg.before-managed-vllm" $cfg -Force`;
  3. `wsl -d Ubuntu -- rm -f /home/ateliernum/lol-spike/run/managed-by-farm`;
  4. `Start-ScheduledTask 'LlmOnLan vLLM'` (the task is still registered).
- Downgrade warning: farm-v0.0.42 refuses a config holding a `vllm` key (strict zod). Put the backup back before downgrading the Farm app.

### 9.5 The Spark recipe farm. The unit ran serve.sh's defaults plus `--kv-cache-memory-bytes 62277025792 --max-num-seqs 32`, with LOL_VLLM_MIN_FREE_GB=8 and MAX_JOBS=4.
- found= gives root ~/lol-vllm and port 8100.
- The take-over gives kvCacheGib 58, parallel 8 (so maxNumSeqs auto = 32), and minFreeGb 8 (= auto on unified memory).
- The last value wins for repeated flags, so it is adopted.
- After that, systemd's restarts hit the marker and exit 0 (counted as success, no loop); stop.sh's 143 already counted as success.

### 9.6 The production steps, at a moment the owner picks:
1. Quit Farm app v0.0.42. Its old code does not touch vLLM, which keeps serving.
2. Install the new release and open it.
3. Check that the code refresh landed (the farm code is copied over a running serve.sh, R3): the panel shows the vLLM button. If not, farm.log has "code refresh failed"; quit and reopen.
4. The panel offers the take-over. Click it. Check: pgid 401 unchanged, the LiteLLM pid unchanged, the client unchanged, the backup written, the marker present.
5. At the next log on: the task's serve.sh does nothing, it opens the Farm app, and the farm starts vLLM (about 1.5 min, "Starting vLLM" on clients, the farm healthy throughout).

## 10. Routing, seats, metrics: reused
- Routing: serverRoute (hosted_vllm/, the entry's presence penalty, supports_vision from the entry or the folder, coordinator peers, disable_cooldowns for a lone deployment).
- Seats: the gate's capacity = backendInfo.slots = the resolved seats; the allowlist is unchanged; the proxy.seatGate=false warning covers vLLM.
- Metrics: /metrics → vllmSample → perf, capacity.busy/queued, poolShortfall. The startup log adds poolTokens and peopleFit before the first scrape.

## 11. Tests

### 11.1 Unit tests (farm/test/run.js, no GPU):
1. Config:
   - the vllm defaults materialize;
   - strict rejects unknown keys (block and entry);
   - the id, folder and root regexes (root refuses "..");
   - parallel 'auto' or 1–512; kvCacheGib ≥ 1; context ≥ 4096.
2. engineOf: all 16 combinations; ollamaServes is false under vllm.
3. The LiteLLM vllm route:
   - hosted_vllm/qwen3.6-35b-a3b, api_base http://127.0.0.1:8100/v1;
   - presence_penalty 1.5 (absent for Nemotron); supports_vision as the entry says;
   - no max_tokens; no Ollama deployments; peers aggregated; disable_cooldowns when alone.
   - GOLDEN: the take-over plan's YAML equals production's external YAML apart from api_key. This test is what allows the take-over to skip the proxy bounce.
4. backendInfo and the snapshot for vllm:
   - engine, slots = the resolved seats, contextPerSlot = ctx, models = [alias];
   - healthy stays TRUE with busy = the job during a planned start;
   - healthy is false for stopped, guard and the unplanned restart.
   - Contract: the enum and the two new examples.
5. carryNameAcross over a 4 × 4 from/to table (a named and an unnamed Ollama default, a raw id, nameTakenByOther); the restoreNames round trip; engineFallback('vllm') in memory only.
6. planFor, argv and env:
   - the Windows wsl argv (-d, --cd with a space, -e env … bash ./serve.sh) and the Linux env;
   - the NUL-separated B64 decodes to the exact argv;
   - maxReplyTokens null → no override; extraArgs last;
   - unified memory → MIN_FREE 8 and MAX_JOBS 4.
7. GOLDEN ADOPTION:
   - adoptable(the take-over settings built from production's external block, kv 50, the argv parsed from serve.sh's own ARGS block) is true. The test reads farm/vllm/serve.sh, so the two cannot drift.
   - The same for lol-vllm.service's ExecStart.
   - kv 'auto' accepts any running pool; an explicit kv, ctx, model or port mismatch → false.
8. Sizing:
   - 52, 8, +9 with OCR off, 59 for the Spark;
   - the cap for a tiny model; too small → ok:false with the sentence;
   - 67 people at 64k with 50 GiB;
   - the maxNumSeqsAuto table;
   - seatsAuto 48, 8, 16, the "<" and "≥" labels, and the measured number capped by the pool (8 GiB → 10 at 64k).
9. flagMap: order-insensitive, --uds ignored, last value wins, JSON compared parsed.
10. The bootDecision, downDecision and orphan-rule tables, including:
    - guard → no restart;
    - slow but ready with the port answering → none;
    - socket ready with the port dead → restart;
    - a second crash within 5 min → fallback;
    - a marker plus a non-vLLM engine → stop; no marker → leave it.
11. startPhase over the real 0.30 log excerpt (2026-10-07 17:45-17:47, saved as farm/test/fixtures/vllm-start.log, \r updates included): the phases, percent 33/67/100, poolTokens 4313303, peopleFit 65, ready. Also the offset reset after rotation.
12. explainFailure, every §7.5 case.
13. problemsFrom, every ✗ sentence; on Windows, disk = min(WSL df, the host drive); a docker-desktop default is skipped; a timeout gives the WSL sentence.
14. decodeWsl; parseStatus over a recorded status.sh output (found=, venv_link=); wslDistros over the real `wsl -l -v` bytes.
15. configFile: the take-over patch keeps untouched keys and deletes `external`; the backup is written; Undo restores it byte for byte.
16. The download slot: a running download does not hold serialize, does not make busy() true, does not block a restart job or a switch to another engine, and refuses its §3.5 conflicts.
17. Apply dry run: 48 → 40 → restart false; 48 → 80 → true; context → true; name → false; kv 'auto' → 'auto' → false.
18. The panel (loadPanel + adminState):
    - 3 engine buttons, 4 only with externalConfigured;
    - each phase's line; the checklist; Install only when not installed; Download, Use this and Remove by state; the take-over offer and result;
    - the vLLM trade lines; the Apply text; both bars with Stop.
    - The D10 check: no rendered panel text and no admin error string contains "lol.config.json", "external.", "binDir", "enabled=" or ".parallel".
19. The Farm app (farmSupervisor with stubs):
    - stop() runs `lol down` before killTree;
    - keepEngine kills only `lol up`'s pid (no /T on Windows);
    - onChildExit reaps before restarting;
    - reapStaleFarm never runs `lol down`.

### 11.2 Script tests (farm/vllm/test_scripts.sh, on Linux or WSL with a fake vllm):
- managed mode: none of serve.sh's defaults in the fake's argv, and the marker written;
- marker without B64 → exit 0 with the line; marker with B64 → it runs;
- early refusals are logged; log rotation; "~" expansion;
- status.sh: running, ready, guard, a stale pgid, installing, managed, found= across two roots, venv_link;
- install.sh: STEPS=model with a fake hf, the step markers, [lol-error] classification, the symlink refusal, and `stop.sh install`;
- stop.sh's final line is scoped to its group;
- the 35 existing serve.sh checks still pass.

### 11.3 Lifecycle with a fake vLLM (farm/test/vllm-lifecycle.js, opt-in with LOL_VLLM_FAKE=1, on Linux and on Windows+WSL, no GPU).
- The fake goes into the repo as farm/test/fake-vllm/{vllm,fake_vllm.py}. On the socket it answers:
  - /v1/models with {id: --served-model-name, root, max_model_len};
  - /health;
  - /metrics, with cache_config_info kv_cache_size_tokens and counters;
  - a tiny /v1/chat/completions.
- Over FAKE_DELAY it prints the real phase lines, with \r bars. FAKE_EXIT and FAKE_OOM simulate failures; FAKE_SLOW_MODELS delays /v1/models by 12 s. The EngineCore child that ignores TERM is kept.
- farm/test/fake-ollama.js answers /api/version, tags, ps and generate.
- The scratch farm runs from the worktree: cwd is a temp directory with its own lol.config.json (proxy 4300/4301, httpPort 41897, beacon off, host 127.0.0.1, plugins off, ollama.hosts = the fake, litellm.command = an existing LiteLLM 1.97 venv); vllm.root = a fake root; port 8299.
- Checks:
  1. Boot: /lol/self in under 10 s, healthy true with busy "Starting vLLM", the gate's 503, the phases in the admin state; then a completion through the gate.
  2. Kill `lol up` alone (Windows: taskkill /F without /T): the fake survives; a restart adopts it (same pid, no job).
  3. Restart with another context → stop and start (new pid). Restart with kv 'auto' → adopted (D9).
  4. Apply name → same pid; Apply context → new pid; the dry run answers.
  5. FAKE_SLOW_MODELS under 3 misses → no restart (status ready). Kill the fake → one restart; again within 5 min → fallback to the fake Ollama, with the reason.
  6. MIN_FREE above RAM → the guard phase, no restart.
  7. Stop and Start; cancel a start in its first second → nothing left running.
  8. A download in the download slot while vLLM serves, a kill of the fake during it → the restart happens at once, not after the download.
  9. A switch to the fake Ollama with the vLLM stop forced to fail → the switch aborts and vLLM keeps serving.
  10. The orphan rule: set the engine to Ollama with the fake running and the marker present → the boot stops it.
  11. `lol down` → nothing left in the fake root; the runtime cleared. `lol down` with the runtime file deleted → still stops it (config fallback).
  12. Take-over: start the fake through serve.sh without B64, configure the scratch farm as external → the offer → click → same pid, same LiteLLM pid, the config rewritten without `external`, the backup, the marker → serve.sh without B64 now exits 0 → Undo restores the file and removes the marker.
  13. Windows only: the same through wsl.exe, from a copy of farm/vllm under a folder with a space in its name.

### 11.4 Live test on this box: a real vLLM with a tiny model, beside production, at a quiet hour.
- Guards before each step (abort on a miss):
  - `curl 127.0.0.1:4000/v1/models` lists Qwen3.6;
  - ~/lol-spike/run/vllm.pgid is still 401;
  - nvidia-smi free ≥ 12 GiB.
- Never touch ~/lol-spike/run, ports 4000/4001/41997/41998/8888/8100/11434, %APPDATA%\LlmOnLan Farm, or the "LlmOnLan vLLM" task.
- The scratch farm's runtime file is the worktree's farm/.lol-runtime.json; never run it from %APPDATA%.
- Agent shells carry ELECTRON_RUN_AS_NODE=1: harmless for node and wsl.exe; never launch an Electron app from them.
Steps:
1. Make /home/ateliernum/lol-test with `ln -s ~/lol-spike/.venv .venv` (install.sh now refuses venv steps there). Add Qwen/Qwen3-0.6B with Add a model and Download it (about 1.5 GB); cancel at about 50 %, then Download again.
2. The scratch farm as in §11.3, with vllm {root /home/ateliernum/lol-test, port 8199, model qwen3-0.6b, contextLength 8192, parallel 4, kvCacheGib 2, ocrReserveGib 0} and ollama.hosts = the fake.
3. Check this computer → the reuse is found (0.30.0 through the symlink), the GPU is visible, the model is downloaded.
4. Switch to vLLM → the phases, ready in about 1.5-3 min → a completion through 127.0.0.1:4300 → the Performance card → 4 seats.
5. taskkill /F (no /T) the scratch `lol up` → vLLM on 8199 still answers 60 s and 5 min later → restart the scratch farm → adopted in under 10 s.
   Measurement only: repeat with /T and record whether WSL keeps vLLM up with no wsl.exe attached (R1).
6. Apply name → no restart; Apply context 16384 → one restart of about 1.5 min.
7. `kill -9` the test EngineCore (pgrep -g of 8199's pgid; never pgid 401) → one restart; again within 5 min → fallback to the fake Ollama, with the reason on the panel.
8. Stop and Start; `lol down` → nvidia-smi back to production's level.
9. Take-over rehearsal:
   - start the test server the legacy way (a hidden wsl.exe running serve.sh without B64, with LOL_VLLM_MODEL and the tiny model's args);
   - configure the scratch farm as external on 8199 → the offer → click → same pid, the marker;
   - run start-windows.ps1 -Root /home/ateliernum/lol-test -Port 8199 -FarmApp C:\Windows\System32\whoami.exe -Log <scratch> → its log shows the marker no-op;
   - Undo.
10. The code refresh (R3): while the test serve.sh runs from a scratch copy of farm/vllm under a folder with a space, fs.cpSync a fresh farm/vllm over that folder from Node (the Farm app's own call) → the copy succeeds and the server is unaffected.
11. Clean up: stop.sh the test root; rm -rf /home/ateliernum/lol-test (this removes the symlink only, never its target); check the guards one last time.

### 11.5 Production (§9.6), then later, at a quiet moment, a reboot test: WSL boots, vLLM takes about 1.5 min, clients show "Starting vLLM" and the farm stays healthy.

## 12. Build order (each slice: tested → DEVLOG → commit and push on the branch)
1. Scripts: serve.sh (managed mode, the marker, rotation, ~, logged refusals); status.sh; stop.sh (install, group-scoped); install.sh (steps, markers, uv, pgid, the symlink refusal, errors); the start-windows.ps1 exit-0 line. Then §11.2.
2. Config, engineOf, serverRoute, names, snapshot, contract. Then §11.1 items 1-5.
3. vllm.js pure functions. Then §11.1 items 6-14.
4. vllm.js plumbing and the up.js lifecycle: the non-blocking boot job, the health semantics, the tick, the fallback, the orphan rule, shutdown, the runtime; down.js; perf; the seats 503; the download slot. Then §11.3 items 1-11 and §11.1 item 16.
5. The admin API and the panel (the Backend card, the vLLM card, both bars, the D10 sweep). Then §11.1 items 17-18.
6. setBackend over the 4 engines, Apply for vLLM, the library, install and download.
7. Take-over and Undo; the Farm app supervisor (§3.12) and Linux autostart; docs. Then §11.3 items 12-13 and §11.1 item 19.
8. §11.4 live, then §11.5 with the owner.

## 13. Risks and open questions
- R1. WSL lifetime with no wsl.exe attached (systemd=true here) is unmeasured. The design no longer depends on it:
  - a `lol up` crash leaves its wsl.exe running;
  - Quit and Stop stop vLLM on purpose;
  - the share toggle keeps the wsl.exe.
  Only an outside tree-kill (Task Manager) meets it. The worst case is a normal 2-minute start. Live step 5 measures it.
- R2. Quoting through `wsl.exe --cd` with a space, and the env elements. Base64 removes the argv risk; the path with a space is tested (§11.3-13).
- R3. A farm-code refresh over a running serve.sh: live step 10, plus the migration check.
- R4. A headless Linux box (no graphical login) does not get vLLM at boot once its unit is a no-op. Keep the external recipe there, or later run `lol up` as a systemd user service.
- R5. Strict zod: an older farm refuses a config holding `vllm`. A downgrade needs the backup put back (docs and release notes).
- R6. The library and FAMILY_ARGS pin vLLM 0.30.0 and NVFP4 checkpoints measured on Blackwell. Older cards get a warning, and a failed start falls back with vLLM's own error quoted. Custom models get generic args.
- R7. The shared caches (~/.cache/vllm, ~/.cache/flashinfer) during the live test. The keys differ by model, and production's kernels are already cached.
- R8. The live test's GPU headroom is thin (74.9 + up to 9 for OCR + about 5 of 95.6 GiB): hence the 12 GiB guard and kv 2 GiB; --enforce-eager through extraArgs is the fallback.
- R9. A failed Apply costs two starts (about 4-5 min). The pre-checks and the dry run reduce it, and the operator is warned before every restart.
- R10. vllm.log: vLLM 0.30 logs no prompts by default and the farm never passes --enable-log-requests, but parser errors can quote output (the panel says so). The log is admin-only, and rotation keeps it under 2 × 50 MB.
- R11. During a planned start the farm says healthy: a client connecting for the first time may pick it and get "try again in a moment" for about 2 minutes. That is the price of not scattering 48 people to slow farms.
- R12. Once the farm owns a root, starting serve.sh by hand from it does nothing until the marker is removed (Undo, or by hand). This is documented.
- R13. Production's document reading uses qwen3.8:latest today (17.7 GB on disk, over the reserve). The §1.4 rule switches it to the already-installed gemma4:12b at the next farm start. This is not caused by this design.

## Settled questions

The owner's four questions are settled with the defaults at the top of this document: (a) one click by a person,
(b) Stop does not survive a farm restart, (c) "not measured" with the Plan capacity link, (d) written WSL
instructions, no administrator button.
