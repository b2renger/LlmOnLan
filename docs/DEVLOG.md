# DEVLOG — LlmOnLan

A running, dated log of what was built, how it was tested, and decisions taken. Newest first.
Each milestone lands as one (or a few) granular commits; an entry here is written **before** the
commit so the history records that a feature was tested + documented before it was pushed.

---

## 2026-09-02 b — mac auto-update deadlocked by keep-warm ("the button does nothing")

Owner report from an Apple Silicon client: "Restart and reinstall" does nothing. Root cause
is an interaction shipped in v0.1.38: macOS Squirrel's `quitAndInstall()` **closes all
windows first** and only calls `app.quit()` once they are closed — but the keep-warm close
handler intercepts window close (the `quitting` flag is only set in `before-quit`, which
never fires here) and hides to tray instead. The window "closes" into the tray, Squirrel
waits forever, the install never runs. Windows/Linux were unaffected (their updater path
goes through `app.quit()` directly).

Fix: an `installingUpdate` flag set in the install IPC BEFORE `quitAndInstall()`, consulted
by the close handler alongside `quitting`. Deliberately a separate flag — presetting
`quitting` would have skipped the before-quit sidecar/mcpo cleanup. Never reset: if the
install errors, the next window close quits fully, the safe direction. v0.1.42.

Caveat flagged to the owner: this fixes the deadlock; whether Squirrel then accepts the
AD-HOC signature end-to-end is exactly what their retest verifies (the recipe's claim, never
rig-verified on mac until now — RIG_CHECKLIST has carried this item since the start).

---

## 2026-09-02 — the Spark as a client (linux-arm64), platform-tagged installers, live search

Three owner reports:

- **"Exec format error" running the client on the DGX Spark** — correct diagnosis: the only
  Linux client build was x86_64. New `ubuntu-24.04-arm` matrix job builds the linux-arm64
  client AND the linux-arm64 OWUI sidecar natively (electron-builder and build-sidecar both
  target their host arch; electron-updater on arm64 reads its own latest-linux-arm64.yml).
- **Platform-tagged artifact names** (v0.1.41 on): `-windows-x64.exe`, `-mac-arm64.dmg`
  (Apple Silicon), `-mac-x64.dmg` (Intel, macOS 14+), `-linux-x64.AppImage`,
  `-linux-arm64.AppImage`. Safe for the updater because names come from electron-builder
  templates, so every latest*.yml references the new names consistently; the release body
  now carries a which-file-for-which-machine table.
- **"Web search does not work"** — it answered HTTP 200 with ONE Wikipedia hit: on a busy
  single-IP box the stock SearXNG engine set had DDG (CAPTCHA), Startpage (CAPTCHA) and
  Brave (too many requests) suspended AT ONCE. The generated settings.yml now also enables
  the scrape-tolerant engines (mojeek — own crawler, qwant, bing) so suspensions of the
  defaults never zero out results, with a `lol-settings v2` marker + upgrade path that
  rewrites only OUR generated file (a hand-edited settings.yml is untouched; the secret is
  preserved). Suspended engines self-heal on their own cooldown.

95 farm tests. Farm side ships as farm-v0.0.31; client side as v0.1.41.

---

## 2026-08-31 c — Rename that renames, one Apply for the settings block

Two owner reports from the panel on the live box:

- **"Rename doesn't do anything."** It called `window.prompt()` — which Electron does not
  support (throws), and the panel lives inside the Farm app's Electron window. Worked in a
  browser tab, silently died in the app. Replaced with an inline editor (the name cell
  becomes an input with Save/Cancel, Enter/Escape bound). Also resolved the conceptual
  clash the owner named: the global "Name users see" row now renders ONLY on the llama.cpp
  engine (where it is that engine's one served alias); on Ollama, names live on the model
  rows — one place, per model.
- **One Apply for the settings block.** Name / slots / password / context each had their own
  Apply, each with its own restart — four restarts to change four things. New
  `POST /lol/admin/apply` (`applyFarmSettings`): validates the whole change set up front,
  applies it in ONE job with ONE restart chain (llama.cpp: a single engine reload carries
  alias+slots+context and the proxy bounce carries the password; Ollama: a single proxy
  bounce carries everything, with the auto-context re-probe inline when asked), full revert
  on failure. The panel collects edits (poll no longer re-renders over a dirty form), sends
  only what changed, and keeps the oversized-context confirm. Password: empty field in the
  batch means "unchanged" — clearing stays its own confirmed Remove button. The individual
  routes remain for API compatibility.
- Also fixed on sight: the context row claimed "shared across N slots" on the Ollama engine
  — that is llama.cpp's split; Ollama gives every request the full window, and now says so.

95 farm tests (the /lol/admin/apply route + payload pass-through covered). farm-v0.0.30.

---

## 2026-08-31 b — "the download hangs" (it didn't) + Make-default now re-probes auto context

Owner report: the nemotron pull "hangs" in the panel. It didn't — `ollama list` showed the
25 GB model installed and LiteLLM serving it; the tail of a big pull is Ollama's sha256
verify (byte counter sits still for a minute+), and the panel had gone stale after. But
walking their NEXT click found a real gap: **setDefaultModel did not re-run the auto-context
probe.** The probe verdict is cached per model, so a new default served at the PREVIOUS
model's num_ctx until the next farm restart — nemotron's 1M experiment would have silently
run at gemma's 262144. Make-default under auto context is now a job: re-probe (which warms
the new model), re-route, report "context sized to N tokens on this box".

95 farm tests. Ships as farm-v0.0.29.

---

## 2026-08-31 — the context dropdown follows the model (1M-native models, un-capped)

Owner is trying `nemotron-3.5-lightning:30b` (1M-native) and asked that the context dropdown
adapt to the selected model and always offer its max. The 262144 assumption lived in THREE
places, each of which would have silently halved-or-worse a long-context model:

- **The probe ceiling** (`resolveOllamaContext`): aimed at min(native, budget, **262144**) —
  now min(native, budget); the budget line + verify-load keep refereeing, so "auto" on a
  1M-native model can resolve to whatever the VRAM actually holds.
- **The apply validation** (`setContextLength`): hard-refused anything above 262144 — the
  dropdown could never have applied 1M. Upper bound is now the serving model's own native
  max when known (llama.cpp: from the GGUF fit; Ollama: a lazily-memoized `/api/show` probe
  exposed as `adminState.ollama.nativeMax`), else a generous typo-catcher (4M).
- **The panel list** (`ctxOptions`): hardcoded presets ending at 262144 — now adapts BOTH
  ways: extends past 262144 by doubling up to the model's max and always offers the max
  itself ("everything this model can read", fmtK renders 1M); a 32k-native model stops at
  32k instead of offering windows it cannot read. VRAM advisories unchanged (flag, never
  disable). The native max is fetched off the panel poll, memoized per model.

95 farm tests (the panel functions are now extracted from the HTML and exercised directly:
1M offers 512k+1M, 32k stops at 32k, advisory flags intact). Ships as farm-v0.0.28.

---

## 2026-08-30 b — KV cache as a first-class concern, both engines, all models

Follow-up owner directive: "improve KV cache support server side for llama.cpp and ollama
with all models — we need to work on bigger things with more context." Three changes:

- **llama.cpp: `--cache-ram` sized from the box** (`llamacpp.cacheRam`, default 'auto' =
  RAM/4 clamped to 8–32 GiB; 0 disables, −1 unlimited). llama-server's RAM prompt-cache
  (default 8 GiB ≈ three 100k-token chats at q4_0) snapshots evicted slot KV to system RAM
  and restores it when that chat returns — the difference between a returning code chat
  answering immediately and it re-processing its whole history first. b10670 also defaults
  to 32 context checkpoints/slot, which is what makes restore work on SWA/hybrid models
  (gemma's sliding window, qwen4exp's linear layers) — left at upstream defaults.
- **Ollama: `OLLAMA_KV_CACHE_TYPE=q8_0` by default** (`ollama.kvCacheType`; f16/q8_0/q4_0,
  gated on flashAttention, only reaches an Ollama the farm starts — the already-running-
  daemon advice line now includes it). Halves KV vs f16 near-losslessly → every model holds
  ~twice the context in the same VRAM, and the auto-context probe MEASURES the bigger
  window rather than trusting the math — its cache key now includes kvCacheType so a
  verdict probed under one cache type is never served under another.
- **Live box**: context set back to Automatic via the admin API (was hand-pinned 131072 →
  65536/user with 37 GiB idle); auto resolves to the model's native 262144 → 131072/user.

94 farm tests. Ships as farm-v0.0.27 with 2026-08-30 a.

---

## 2026-08-30 — code chats want context: the window was a panel click, the speed was a flag

Owner report: "I lack context for code" on the client. Diagnosis on the live 96 GB box:
Qwen Flash serving with **131072 pinned manually** (halved to 65536/user across 2 slots) while
**37 GiB of VRAM sat free** — and the model's header says native 262144 with only 2 KV heads
(~0.45 GB per 16k at q4_0, so the FULL native window costs ~7 GB). Automatic would pick
262144 → 131072/user. The fix for the window is a panel action, not code.

The code change is the other half of the ask — **context caching**:
- `--cache-reuse 256` added to the llama-server argv (skipped under MTP, which conflicts with
  cache shifting). llama-server's default reuses a slot's KV only on an EXACT prefix match, and
  interleaved OWUI chats break that constantly — every follow-up turn reprocessed the entire
  history (a 100k-token code chat = tens of seconds of prompt work per turn). With chunked
  reuse + the default similarity slot routing, a returning chat lands on the slot that still
  holds its cache and only the new tail is processed.
- `kvGbPer16k` documented as a KNOWN over-estimate on hybrid linear-attention models
  (qwen4exp): it prices every layer as full attention. Deliberately left conservative — for
  the fleet's model it still clears native max on 96 GB, and erring small never spills.

93 farm tests (argv asserts cache-reuse present, and absent under MTP).

Owner asked for an Intel-mac client build. The recorded blocker: OWUI pins
`onnxruntime==1.26.0`, whose last macOS-x86_64 wheel is **1.23.2** — the macos-15-intel CI
job tried at v0.1.27 died exactly there, and the repo concluded "must NOT ship". Re-audited
before accepting that: ALL 110 of OWUI 0.10.2's direct pins were checked against PyPI for
Intel-mac wheels (onnxruntime is the only true blocker — brotlicffi builds from sdist,
mariadb is extras-gated), and a full cross-platform resolution (`uv pip compile
--python-platform x86_64-apple-darwin`, macOS 14 baseline) succeeds with onnxruntime
overridden to 1.23.2: torch lands on 2.2.2 (the last Intel torch — satisfies
sentence-transformers 5.5.1 / accelerate 1.13.0 on its own), ctranslate2 4.8.1, opencv's
Intel wheel is tagged macosx_14_0 (→ Intel macs need Sonoma+).

**Owner decision (2026-08-28, explicit):** ship Intel with the substitution, ONLY on Intel —
every other platform keeps OWUI's exact pin set, byte-for-byte the same build as before.
Implementation: `build-sidecar.mjs` grows a darwin-x64-only branch (open-webui `--no-deps`,
then its own Requires-Dist with the one pin rewritten — with a hard `die()` if the rewrite
ever finds nothing to rewrite); the `macos-15-intel` sidecarOnly matrix job is re-enabled
(builds only `owui-sidecar-darwin-x64.tar.gz`); electron-builder's mac arch list gains x64
(the Intel installers cross-package on the arm64 runner; latest-mac.yml carries both zips and
electron-updater picks by arch). The shell needed zero changes — it already requests
`owui-sidecar-<platform>-<arch>` from its own release tag. Blast radius of the substitution
in our config: rapidocr OCR fallback + chroma's unused ONNX embedder; embeddings are torch,
STT is ctranslate2, extraction is the farm OCR.

Verification pending the release build: the Intel job's pip install is the real test, and a
human boot on an actual Intel mac is the acceptance.

**First run (v0.1.39) found the one flagged risk for real:** brotlicffi (no Intel wheel) built
from sdist, compiled every object, then died archiving — the standalone CPython's sysconfig
bakes `AR=<pbs build path>/llvm-ar`, a path that only existed on python-build-standalone's own
build machine. Fix: `AR=ar` in the darwin-x64 install env (distutils honors the override), so
brotlicffi stays at OWUI's exact pinned version, built with the system archiver. v0.1.39 still
shipped complete for win/arm64-mac/linux — including the Intel *installers* and a
latest-mac.yml listing both arches — only the Intel sidecar tarball was missing; v0.1.40
closes the set.

---

## 2026-08-28 e — Qwen Flash needs a llama.cpp born yesterday (pin b10516 → b10670)

The owner's 72.5 GB Qwen Flash download completed, llama-server refused it, and the panel
blamed... MTP, on a config where MTP is off. The farm log had the truth:
`unknown model architecture: 'qwen4exp'` — support for Qwen3.8-Flash-Next landed in llama.cpp
**the day before** (ggml-org PR #27742, 2026-08-27); our pin b10516 predates it. The rollback
machinery worked exactly as designed (the box came back serving the previous model), but the
error message was a guess presented as a diagnosis. Two fixes:

- **Pin bump b10516 → b10670** (first build verified to carry `qwen4exp`) — checked against the
  tag before bumping: the `win-cuda-13.3` assets exist under the names `assetsFor()` expects, and
  every flag `argsFor()` passes is still in `common/arg.cpp` (including `--spec-type` and the
  deprecated-but-accepted `--no-webui`). `LLAMACPP_BUILD` in `build-llamacpp-arm64.yml` bumped in
  lockstep; pushing the pin auto-triggers the Spark tarball rebuild (the workflow watches
  `farm/src/llamacpp.js`). On an installed farm the binary upgrade is automatic: `.installed-build`
  mismatches the new pin → re-download; `.models`/`.llamacpp` live outside the app-update copy, so
  the 72.5 GB already on the box survives.
- **Engine failures now quote llama-server's dying breath.** `startLlamacpp` keeps the child's
  last 80 output lines; `explainEngineFailure` (llamacpp.js, unit-tested) names an unknown
  architecture ("newer than the farm's llama.cpp build — needs a farm update"), keeps the targeted
  MTP explanation for actual MTP deaths, and otherwise quotes the last real `E`-lines verbatim.
  The always-MTP canned message is gone.

92 farm tests. Ships as farm-v0.0.26 (with 2026-08-28 d).

---

## 2026-08-28 d — the download progress nobody could see

Owner ran the Qwen Flash split download on the live box (farm 0.0.25) and reported **no feedback**
— while `/lol/self` showed the job running fine (`model part 2/3 … 8%`). The progress existed; it
was just invisible. Two causes, both fixed:

- **The job bar rendered off-screen.** It sits at the top of the panel page, but the operator is
  scrolled down at the model library — the card whose *Use this* button started the job. The bar is
  now `position: sticky`, so it pins to the viewport top from anywhere on the page.
- **llama.cpp downloads reported a bare per-part percent** — the bar restarted at 0% three times
  with no byte counts (the Ollama pull path got bytes in 0.0.25; this path didn't). `downloadGguf`
  now passes `(pct, seenBytes, totalBytes)` through, and `ensureModel` prices the whole shard set
  up front with one HEAD per part (verified live against the Qwen repo: 0.01 + 50.0 + 22.5 =
  72.5 GB — shard 1 is 10.9 MB of metadata), so the job reads as ONE download:
  `model part 2/3 — 31.2 / 72.5 GB` with an overall percent that never restarts. HEADs are skipped
  when every shard is already cached — on a closed LAN they'd stall every boot for their timeout.

91 farm tests still green. Ships as farm-v0.0.26.

---

## 2026-08-28 c — split GGUFs, visible downloads, and the pull dead-end signposted

Owner tried Qwen3.8-Flash-Next (UD-IQ1_S — a 72.5 GB, three-part split GGUF) and hit two walls:
no visible download progress, and Ollama's registry refusing the repo outright
(`pull model manifest: 400 … sharded GGUF`).

- **Split GGUF support in the llama.cpp library.** Paste ANY part's URL into *Add a model* — the
  farm normalizes to the full shard set (`shardUrls`/`normalizeModelUrl`), downloads every part with
  per-part progress (`model part 2/3 … 41%`), and points llama-server at shard 1, which assembles
  its siblings natively (no merge step). The VRAM budget now sums ALL shards on disk
  (`weightsBytesFor`) — shard 1 of a split model can be 10 MB of metadata while 72 GB of tensors sit
  in its siblings, and statting only shard 1 would have wrecked the fit math. The advertised name
  drops the `-00001-of-00003` suffix.
- **Ollama pulls now show bytes, not just a bar** (`downloading 4.2 / 72.5 GB`) — the difference
  between "is anything happening?" and watching it happen. And when a pull fails BECAUSE the repo is
  sharded, the error now says where to go: *use Model · llama.cpp ▸ Add a model — the farm fetches
  all parts*. (The owner's pull died at the manifest stage, before any bytes moved — that's why
  there was "no progress" to show.)
- **Bug found on the way:** `pullOllamaModel`'s post-download warm-up still passed
  `config.ollama.contextLength` — the string `'auto'` since 0.0.24 — as `num_ctx`, so every
  panel-downloaded model's warm-up silently failed (best-effort catch). Now `ollamaCtxNum()`.

91 farm tests (split-model suite added: any-part normalization, shard-sum weights, name cosmetics).

---

## 2026-08-28 b — reopening the client is instant: the chat engine stays warm

Owner report: ~20 s to the OWUI interface on a laptop. The floor is OWUI's own Python boot
(~10 s on a fast desktop, worse on laptops with active AV) — invariant #1 forbids touching it, and
v0.1.37 already stripped everything the shell added on top. So the remaining win is **not paying that
boot on every open**:

- **Keep-warm (default on).** Closing the window now hides the app to a tray icon instead of
  quitting; the OWUI sidecar keeps running, so reopening — from the tray, the taskbar, or launching
  the app again (single-instance surfaces the hidden window) — is **instant**. The tray's
  *Quit (stops the chat engine)* is the real exit; `app.quit()` sets the quitting flag in
  `before-quit` before any window-close event fires, so real quits (updater restart, relaunch)
  pass the close-handler untouched. Preferences ▸ Startup gains the toggle; off = classic
  close-means-quit.
- **Launch at login now registers with `--hidden`** (honored only while keep-warm is on): the engine
  boots silently at login, so the FIRST open of the day is instant too.

The cold boot itself still costs what OWUI costs — one boot per login instead of one per open is the
deal. (Ops note for slow laptops: an antivirus exclusion for the app's sidecar folder is the last
big lever; ~27k Python files get scanned per cold start.)

Verified: shell tsc clean; close/quit paths traced (close→hide gated on !quitting + keepEngineWarm;
window-all-closed guarded for destroy paths; activate/second-instance re-show the hidden window).
The CDP e2e cannot run on this box (owner's client holds the packaged instance; documented practice),
so the tray flow needs one manual pass on a test machine: close window → tray present → reopen
instant → tray Quit really stops the engine.

---

## 2026-08-28 — the admin outranks the guardrails: advisory context + per-model names

Two owner calls from testing farm-v0.0.24:

- **Oversized context is advised against, never blocked.** The panel's selector used to DISABLE
  sizes past the VRAM budget, `setContextLength` refused them, and the boot CLAMPED a persisted
  over-size (and saved the clamp — silently undoing the admin's choice). All three are now advisory:
  the option reads "more than this 12 GB GPU holds (slows to a crawl)" but stays selectable, Apply
  asks for one confirmation, the applied result spells out the trade (`⚠ 262144 tokens needs ~20 GB —
  this GPU has 12 GB…`), and boot honors an explicitly configured over-size with a loud warning
  instead of clamping. The AN-VR-01 lesson stays encoded in the warnings; the decision belongs to
  whoever runs the farm.
- **Every downloaded model gets its own name.** Each served row in *Models · Ollama* has a
  **Rename** button: models default to their checkpoint id, the admin overrides per model
  (`setModelAlias`, `POST /lol/admin/model/alias`), empty restores the checkpoint name. Uniqueness is
  enforced — the name IS the id clients request, so a duplicate would silently merge two routes.
  Precedence made deterministic: per-model alias > global `modelAlias`, and the Backend card's big
  "Name users see" now clears a per-model override on the default model so the most recent rename
  always wins. On the llama.cpp engine renames persist without bouncing the proxy (standby catalog —
  nothing routed to interrupt).

Live-verified on an isolated farm: rename `gemma4:12b` → `tutor` (snapshot + `/v1/models` + a
completion under the new name), `servedAs` in the panel state, busy-guard during a pull job, empty
alias → checkpoint name restored and the override gone from disk. ctxOptions render harness: oversized
options flagged `data-over`, zero `disabled` attributes. 90 farm tests (route + precedence added).

---

## 2026-08-27 b — gemma4:12b on Ollama at 262k is the new default, and the client boots leaner

Owner calls: **serve gemma4:12b by default on Ollama with a 256k window**, and **cut the client's
OWUI load time**.

### The default flip (`llamacpp.enabled` now defaults false)

The attach matrix earlier today surfaced the reason this is right: gemma4's sliding-window attention
holds its **native 262144 context in ~10 GB total** (probed live, fully in VRAM), it is vision-native,
and one model covers chat AND the OCR plugin — where the llama.cpp Qwen3.8-27B setup caps at ~36k on a
4070. Max context is what thinking models + whole-document RAG want; llama.cpp stays one panel click
away as the speed engine. Because fleet configs mostly omit `llamacpp.enabled`, the next farm update
flips them to the new default — intended: that IS the rollout. `lol install` already skips the
llama.cpp build + weights when the engine is off, so a fresh install drops from ~28 GB to ~18 GB.

The tier-ladder probe from this morning would have left small cards at 16384, so it became a
**two-point measurement**: load the model at 16k and 32k, take the per-token KV slope from `/api/ps`
(sliding-window layers are saturated well before 16k, so the tail is linear), aim at
min(native, VRAM−8%, 262144), and VERIFY with one more load — Ollama's own memory placement is always
the referee, never the arithmetic. Below-floor cards walk down 8192→4096 instead of spilling. Verified
out-of-the-box on this box with a minimal config (nothing but name/ports/token): `measuring at 16k →
measuring at 32k → verifying 262144 → auto → 262144`, snapshot advertising
`engine ollama, gemma4:12b, contextPerSlot 262144, slots 2` — and a 24k-token prompt with the sentinel
on its FIRST line answered correctly (the exact thing a small window truncates away first). The
adaptive-RAG client sees 262144 ≥ 24576 and keeps whole-document mode everywhere the default lands.

### Client boot time

Profiled the sidecar cold: **~11 s warm, 27 s+ semi-cold** to the first HTTP 200 — dominated by OWUI's
own Python import chain (~10 s: langchain → sentence-transformers → transformers), which invariant #1
forbids touching. What the shell owns, it now does:

- **`repoint` restarts only when the effective launch env differs** — it builds the old and new env and
  compares, instead of comparing inputs. The farm growing its context 65k→131k (or any input churn that
  lands on the same env) no longer costs a full OWUI reboot mid-session.
- **`sidecarManager` precompiles the freshly-unpacked tree to bytecode** (background, lowest priority)
  after the first-run download AND after staging an update — a fresh install otherwise pays
  parse+compile for ~27k files on its very first boot, which is exactly the launch new users judge.
  (.pyc validation is mtime/size-based, so the pending→live rename keeps them valid.)
- **`HF_HUB_OFFLINE=1` once MiniLM + whisper-base are cached** — OWUI otherwise asks huggingface.co for
  the embedding model's revision on EVERY boot (boot-profiled): a wasted round trip online, a hang on a
  closed LAN. Until both are cached the flag stays off (first downloads must work) and
  `HF_HUB_ETAG_TIMEOUT=2` caps the stall instead. Offline boot verified live: 10.3 s, zero
  huggingface.co requests, embeddings loaded from cache.
- **Health polling 1000 ms → 300 ms** — the coarse interval added its own tail to every boot.

### Verified

All-defaults farm live on this box (engine, name, probe, long-context completion, teardown clean, live
farm untouched); 89 farm tests (7 rewritten for the new default, all green); shell + farm-app tsc
clean; offline sidecar boot clean.

---

## 2026-08-27 — the attach matrix: every OWUI attach feature, live, on BOTH engines

Owner ask: "we need more context by default", and verify that **attach webpage / attach files /
attach images / attach notes / attach knowledge / reference chat / upload files** work on both
backends. Built a live rig on the dev box (isolated verify-farm on :4091/:41991 + a real OWUI 0.10.2
sidecar on :8090 launched with the exact configBridge env, driven through OWUI's own REST API with
sentinel-fact assets: txt/md/docx/pdf/png/oversized log) and ran a 15-test matrix per engine.

### What the matrix caught

- **CRITICAL — the Ollama engine could not chat at all.** Every completion failed with
  `time: missing unit in duration "-1"`: the per-deployment `keep_alive` I added for keep-warm
  (farm-v0.0.22) ships the config string `'-1'` into JSON, and Ollama's `api.Duration` accepts that
  spelling only from the ENV var, not a request. `warmModel` had the same bug — keep-warm had been
  silently failing (best-effort catch) since it shipped. Nothing noticed because the default engine is
  llama.cpp and the old test only asserted the KEY existed. Fixed with `keepAliveValue()` (numeric
  strings → numbers, real durations pass through) at both edges + a routing-level regression test;
  proven live both ways against the daemon (string → error, number → completion).
- **Attach webpage refused every LAN page** on both engines: OWUI's SSRF guard
  (`ENABLE_LOCAL_WEB_FETCH`, default false) blocks private IPs — on a LAN-first product, the farm
  panel, the wiki, the dashboards are all private IPs. Client now sets it true (single-user app,
  OWUI bound to 127.0.0.1, trusted-LAN posture).
- **An oversized attachment hard-errored on llama.cpp** (raw `litellm.ContextWindowExceededError`
  toast at 41k tokens into a 16k window) **and silently beheaded the prompt on Ollama** (kept the
  tail, dropped the front — answered the final-line question, would have lost the system prompt).
- **Every file-attached chat cost a hidden second LLM call**: OWUI's retrieval query generation
  (default on) runs before the real answer — 13 farm completions for 7 chats — and full-context mode
  never uses its output. On the fleet's single-slot llama-server that is pure TTFT.

### The fixes

- **Farm — `ollama.contextLength: "auto"` is the new default** ("more context by default", now on
  both engines). llama.cpp keeps its GGUF-math auto; for Ollama the math is a trap — Gemma's
  sliding-window layers make the naive KV estimate several times too high — so the farm **probes**:
  load the default model at a VRAM-tiered candidate, read `/api/ps`, step down if `size_vram < size`,
  cache per (model, VRAM, parallel) next to the weights (floor = the measured-safe 16384; the probe
  doubles as the warm-up). Live: gemma4:12b on the 96 GB box probed straight to its **native 262144,
  fully in VRAM** — the panel's Automatic option now works on both engines, and a cached probe makes
  the next boot/switch instant.
- **Client — adaptive RAG from the beacon**: `backend.contextPerSlot` now threads through discovery →
  settings persistence → configBridge. ≥ 24576 (or an old farm that doesn't advertise it) →
  whole-document mode as before; below → `RAG_FULL_CONTEXT=false` + `RAG_TOP_K=8`, so a small-context
  farm answers from the best passages instead of erroring. Plus `ENABLE_LOCAL_WEB_FETCH=true` and
  `ENABLE_RETRIEVAL_QUERY_GENERATION=false` (search query generation stays on — web search needs it).

### Verified

Final matrix **15/15 on llama.cpp and 15/15 on Ollama** (was 13/15 and 7/15): LAN + public webpage
attach, all five upload types extracted (including PNG → farm OCR "ZEBRA CODE 9481" and a text-layer
PDF), file/note/knowledge/reference-chat answers with the right sentinel facts, images answered by
BOTH engines (the default llama.cpp model ships its mmproj; gemma4 is vision-native), and the 41k-token
attachment answering via retrieval where it used to 400. Attached-chat latency dropped from 5–9 s to
1.1–2.7 s with the hidden query-gen call gone. 89 farm unit tests green (4 new: keep_alive coercion at
the routing level, num_ctx floor under unresolved auto, snapshot never leaking the 'auto' string,
schema round-trip), both tsc projects clean. Teardown verified: live farm healthy throughout, runtime
file restored, probe model evicted.

One honest nuance, documented in GETTING_STARTED: in retrieval mode a "what's on the LAST line of
this huge file" question depends on the retriever surfacing that chunk — graceful, not guaranteed.
Whole-document quality needs context, which is exactly why the farm now maximizes it per box.

---

## 2026-08-26 c — v1: three blind audit rounds to READY, and the features that make it a cluster

Owner call: the POC is good — audit code + UX with an agnostic critic loop until it is satisfied, and
fold in four requirements: **maximum context per model per box**, **llama.cpp on the DGX Spark with
nothing to build**, **a ComfyQ-style farm password**, and **load spreading without users picking boxes**.

### The features (built first, so the critics could audit them)

- **Auto-max context** (`llamacpp.contextLength: "auto"`, the new default): at every model load the farm
  reads the model's **native maximum and KV-cache geometry from the .gguf header itself**
  (`farm/src/gguf.js` — ~60 lines of GGUF parsing; the computed rate for Qwen3.8-27B is 1.208 GB/16k,
  matching the fleet's measured 1.2 exactly) and serves min(native, VRAM budget). A 4070 lands ~36k, a
  4080 ~78k, the Spark the full 262k — live-verified: `auto → 262144 (model max 262144, budget for
  96 GB)`. Fit refusals and the boot clamp now use per-model geometry instead of one measured constant.
- **The Spark, out of the box**: ggml-org ships no linux-arm64 CUDA build, so **our CI builds one**
  (`build-llamacpp-arm64.yml`: GitHub's free arm64 runners + the CUDA 13 sbsa toolchain, sm_121,
  self-contained tarball with cudart/cublas and RPATH `$ORIGIN`). Green on the first run (14m33s);
  published as `llamacpp-b10516/llama-b10516-bin-linux-cuda-arm64.tar.gz`; `assetsFor()` downloads
  exactly that name on linux-arm64. A missing/broken tarball still degrades to the Ollama fallback.
- **Farm password** (ComfyQ model): panel ▸ Backend ▸ *Farm password* → LiteLLM `master_key` (live, with
  rollback); the beacon advertises `requiresKey`; the client shows a 🔒 card, **verifies the typed
  password against the real endpoint before storing it**, remembers it per farm, threads it into OWUI's
  env and LOL Chat's fetches, and excludes locked farms from auto-connect. Live-verified: keyless and
  wrong-key refused, correct key 200, clear/set round-trip. (LiteLLM without a DB rejects wrong keys
  with 400/500, not clean 401s — the client treats "answered but not OK" as not-accepted.)
- **Selection by slots**: `farmLoad` prefers slot occupancy (clients/slots) over GPU%, and the round-2
  exclusivity bug that made a **llama.cpp coordinator aggregate zero peers** (the peer loop lived inside
  the skipped Ollama loop) is fixed with a test.
- **Reproducible installs**: the Farm app's Ollama + Python are version-pinned (latest-fallback logged).

### The loop

**Round 1 — code & architecture (blind).** Verdict NOT READY, and it earned it: a **CRITICAL regression
I had shipped an hour earlier** — the `unzip`→`extract` rename left two `zipPath` references, so every
FRESH Windows install of llama.cpp threw and silently fell back to Ollama; the cached `.llamacpp/` on
this box masked it. Also: llama-server had **no crash supervision** (a mid-run death left LiteLLM routing
chats into a dead port while the beacon said healthy) and the job routes **bypassed the mutation lock**
their own comment warned about. Everything CRITICAL/HIGH/MEDIUM was fixed: `extract()` is exported and
exercised by a real-zip test; llama-server has an exit handler → healthy:false + one rate-limited
restart → Ollama fallback (live-verified: killed the verify farm's llama-server, recovered in ~7 s,
completion 200 after); one serialize chain covers jobs AND quick ops; startup failures fail in seconds
not five minutes; downloads verify content-length before the cache rename; keep-warm rides the LiteLLM
routing per-request (a fallback farm no longer reloads the model after every pause). The fix round
itself shipped a TDZ crash (`liveHealth` from `startLlamacpp` at boot) — caught by the live test, fixed
with a late-bound box.

**Round 2 — fix verification + UX (blind).** Confirmed round 1 holds ("could not construct a concurrent
restartProxy"); called the farm side v1-shippable; then took apart the **password's client edges** — the
popover rebuilt itself per beacon (~3×/s on a fleet), wiping the password mid-typing; a data-folder move
dropped the key (round 1 had patched a lookalike handler); rotation was never detected on the active
farm; a passworded-only LAN read "No server" — and the **Farm app's failure story**: every error said
"see the log" and **no log file existed** (packaged apps swallow console.log); the wizard's phase 5 was
a blind spinner while gigabytes downloaded; a stalled socket froze the installer forever; the error
overlay could mask a live farm whose only button killed it. All seven HIGH+ fixed (`farm.log` under
userData; give-up keeps watching and self-clears; 60 s stall timeout; typing guard; verify-on-every-
beacon; "Server needs a password — click here" pill; Stop confirms; panel webview retries; the admin
token visible in Settings), plus the cheap MEDIUMs (select-guard, de-secure confirm, engine-switch
confirm, toast collisions, Automatic gated to llama.cpp) and **twelve documentation self-contradictions**
deleted — several still described pre-exclusivity behavior or denied features that ship.

**Round 3 — acceptance (blind).** All round-2 fixes verified holding (including the subtle ones: the
late-recovery watcher's gen-guards, the boot-window pickup no-op'ing after an Ollama fallback). New
findings: nothing that loses data or strands a farm — four ship-with notes, now documented in
GETTING_STARTED ▸ *Known rough edges (v1)*. Scorecard: **8/8 requirements MET**. Verdict:
**READY WITH NOTES**, with the workshop topology guidance (a passworded fleet should run as one farm or
coordinator + open peers).

### Owner questions, answered in the report

DeepSeek-style serving is datacenter-scale MoE machinery — the per-box equivalents (speculative
decoding, KV quantization, right-sized context, slots) are already in; DeepSeek *models* are a
paste-a-URL experiment on the Spark now that the library takes any .gguf. Load sharing without choosing:
already the default (least-loaded auto-selection, now slot-aware) — one shared alias + a coordinator
makes the fleet one endpoint. Password: shipped, above.

### Verified

87 farm unit tests (16 added across the loop), both tsc projects clean, 31/31 doc anchors, the panel and
client render harnesses green across engine/locked/busy/degraded states, and live on this box: auto
context resolution, the password round-trip, and the llama-server kill → auto-recovery. The Spark
tarball's exact download URL answers 200 with a valid gzip magic.

---

## 2026-08-26 b — one engine at a time, a performance monitor, and two fleet incidents fixed at the root

First multi-machine test of farm-v0.0.21 came back with five reports: the llama.cpp/Ollama split reads
as *both running* in the panel; the farm needs a real performance monitor; clients need feedback while
the farm switches models; **AN-VR-01 is "back to too slow"**; and **the DGX Spark farm does not launch
at all**.

### The two incidents, diagnosed live before touching code

- **AN-VR-01** answered `/lol/self` from here: `contextLength: 262144` — someone had picked **256k on
  the 12 GB card** from the new context selector, and the box sat at **11.6/12 GB VRAM at idle**
  (gpuUtil 0). llama-server does not refuse a shape that overflows VRAM: Windows WDDM overcommits into
  system RAM, so it "works" while paging every token over PCIe. The selector offered 256k with no
  warning, and the value persisted.
- **DGX Spark** is linux-arm64: `assetsFor()` has no prebuilt llama.cpp there, and with
  `llamacpp.enabled` defaulting true, `lol up` hit `return 1` — the farm *exited* because an optional
  accelerator was unavailable. That is "does not launch at all".

### One engine at a time (owner decision)

`buildLitellmConfig` emits **no local Ollama deployments while llama.cpp is enabled** (peers still
aggregate — exclusivity is about this box's two engines, not the fleet), and the snapshot advertises
**only the llama.cpp alias**. The catalog becomes *standby inventory*: greyed in the panel with
Download/Delete only, ready for an engine switch, and still backing document OCR (which talks raw
Ollama, never the proxy). This also closes an overcommit hole: a client picking gemma4:12b next to a
resident llama-server was the other way a 12 GB card ended up paging. `carryNameAcross` keeps the
advertised name across the switch, verified live in both directions.

### The VRAM budget (`farm/src/perf.js` · `fitBudget`)

Weights (statted from the real `.gguf` on disk) + measured KV rate (q4_0 ≈ 1.2 GB per 16k total
context) + overhead vs detected VRAM. Three enforcement points: the panel **disables** context options
that cannot fit ("won't fit (12 GB GPU)"), `setContextLength` **refuses** with the largest size that
does, and boot **clamps a persisted size that no longer fits — and saves the clamp** (the broken value
came from the panel; leaving it re-bites every boot). Unknown VRAM (unified memory — the DGX; no
nvidia-smi) → no verdict, never a false refusal. Unit-tested against AN-VR-01's exact numbers: 256k =
~28 GB on a card with 12; max ≈ 36k. **AN-VR-01 heals itself on update**: boot clamps 262144 → ~36k.

### The performance monitor

llama-server now runs with `--metrics`; the health timer derives **true tok/s while generating** —
delta tokens over the engine's own generating-seconds counter, not wall clock, which averages in idle
time and lies low. The panel's **Performance card** shows the sticky last-active rate, slots busy,
requests waiting, KV usage, VRAM/GPU, a sparkline, and plain-language warnings for the two silent
failure modes: *VRAM nearly full at idle* (context too large — the AN-VR-01 signature) and *generating
far below hardware speed*. Counter resets (a model swap restarts llama-server) are detected, not
reported as negative rates. Also under pressure: with llama.cpp serving and the GPU idle+full, a loaded
Ollama model (OCR's, kept alive) is **auto-evicted**, and the spawned Ollama's keep-alive drops from
`-1` to `5m` while llama.cpp is the engine — a vision model pinned forever next to llama-server was
plausibly the *other* AN-VR-01 slowdown.

### "Switching models" is now a state clients understand

The in-flight admin job rides the snapshot as `busy` (a live thunk — every beacon tick sees fresh
progress; kicked the moment a job *starts*). The client pill shows "*{farm} · Loading Qwen3.8 27B…*"
instead of flipping to broken while the proxy bounces, the farm card carries the job + percent, and LOL
Chat answers a send with "⏳ the server is busy: … try again in a moment" — both pre-send and when a
stream dies mid-switch — instead of `[error: Failed to fetch]`.

### The DGX fix

Any llama.cpp boot failure — unsupported platform (pre-checked before Ollama even spawns), failed
download, weights that will not load — logs the reason, **falls back to the Ollama engine for the run**,
and surfaces why on the panel's Backend card (button disabled with the reason when the platform can
never do it). In-memory only: the config keeps `llamacpp.enabled`, so a transient failure heals on the
next boot and a hand-built `binDir` re-enables the fast engine. Verified live by pointing `binDir` at a
nonexistent directory: the farm came up healthy on Ollama with the reason in the panel — the exact
shape that previously exited.

### Verified

78 farm unit tests (10 new/updated). Live, against an isolated second farm on this box (llama.cpp
engine, real weights): exclusivity on `/v1/models` and the snapshot; a real completion appearing in the
perf monitor (~sticky tok/s + sparkline history); `busy` visible mid-job and gone after; engine switch
Ollama→llama.cpp→back with name continuity; the DGX fallback booting healthy. The panel rendered from
the live admin state in four shapes (llama.cpp, the 12 GB oversized-context shape with all three
warnings firing, the DGX shape, mid-download job bar); the client card rendered with busy/capacity/
old-farm fallbacks. Both tsc projects clean; 30/30 doc anchors resolve.

---

## 2026-08-26 — the farm becomes operable: backend, models and capacity move into the panel

Owner feedback after running the fleet: *"the separation between the ollama backend and the llama.cpp
backend is not clear in the farm UI"* — plus five specifics (no advertised-name setting to be found, no
README answer for downloading a new llama.cpp model, no way to see or switch the running backend, no way
to add/remove models, no multi-user support) and one client-side ask: **show how many people are on each
box, out of how many it can serve** — *"1 of 2 slots is occupied"*.

The root cause behind most of it was the same: **the panel was an Ollama console** — installed tags,
served flags, a context selector — on a farm whose default model is served by **llama.cpp** and appears
in none of those lists. And what little existed was split across two surfaces that disagreed.

### What the panel is now

It opens on a **Backend** card: the name users see, the engine behind it, the real `.gguf`, and
`N slots · M tokens of context each`. Under that: llama.cpp ↔ Ollama as two buttons, a **model library**
you add `.gguf` URLs to (**Use this** downloads and serves, with progress), the **advertised name**,
**People served at once**, and a context window that targets whichever engine is serving. The Ollama card
gained **Download** / **Delete**. `farm/src/configFile.js` writes every one of them back to
`lol.config.json` — patching *raw* JSON, never the parsed config, so the operator's file doesn't get
today's schema defaults frozen into it.

Long fetches run as a **single job** (`runJob`): the route returns at once with a job id and the panel —
already polling `/lol/admin/state` — renders progress, polling at 1 s instead of 5 s while one runs.
Strictly one at a time, refused rather than queued, because two model reloads racing is how a farm ends
up with no backend.

### Three bugs found on the way, each worse than the missing feature

1. **A failed model swap bricked the farm.** Verified live: point `llamacpp.model` at a 404 and
   `downloadGguf` *rejects* rather than returning, so it escaped `startLlamacpp`'s `{ ok, message }`
   contract, blew past the rollback, and left llama.cpp enabled with no `llama-server` and a dead URL
   persisted. Fixed at the root (`startLlamacpp` catches) plus a `try/catch` around the swap's reload —
   a farm bricked by a typo is unrecoverable *from the panel*, because the panel is served by the farm.
   Re-verified: the swap now fails, says `download HTTP 401`, reloads the previous weights, and clients
   keep being served.
2. **The Farm app overwrote the panel on every launch.** `app.whenReady` re-applied `setContextLength`
   and `setModelName` from the *app's own store*, so a rename done in the panel came back wrong after the
   next app restart. Removed; `lol.config.json` is the single source of truth.
3. **The advertised name did not survive a backend switch.** The two engines keep it on different keys
   (`llamacpp.alias` vs the global `modelAlias`) and the name IS the model id clients bind to — so
   switching silently renamed the model and would have asked every open chat to re-pick.
   `carryNameAcross()` moves it, and clears `modelAlias` when going *to* llama.cpp, because a colliding
   Ollama deployment is skipped in the generated routing and that model would vanish from the picker
   unannounced.

### Two inert controls, fixed rather than documented

The previous docs pass flagged both as "worth fixing in code later":

- **The context window** wrote `ollama.contextLength` only — nothing on a default farm. It now routes to
  the serving engine, and the panel states the arithmetic (llama.cpp **splits** `--ctx-size` across
  slots, so 2 slots of 16384 means 8192 each).
- **"Make default"** couldn't change what clients auto-select while llama.cpp owns the alias. The button
  is now hidden in that mode instead of lying.

### Capacity, on both ends

`capacity: { slots, clients }` rides the beacon (`llamacpp.parallel`, or `numParallel × reachable hosts`
for Ollama). The panel's Clients card and every farm card in the desktop client read *"1 of 2 slots in
use"*, amber when full, and the topbar pill shows `2/2` — which beats `100% GPU` for the question a
person is actually asking, since 100% GPU is just what a healthy box looks like mid-answer. Deliberately
**advisory**: nothing refuses a client past `slots`, so a full box means "expect to wait", and the point
of showing it is that the next person picks another box.

### The Farm app stopped competing

Its Settings drawer had half-versions of Model name and Context window — which is *why* the owner
couldn't find the naming field: two places, neither findable. Both rows (and their IPC, preload and
installer paths) are gone; Settings holds app-level things only and points at the panel, which is the
app's own main window.

### Verified

- **73 farm unit tests** (9 new: backend/capacity advertisement, the ctx-split arithmetic per engine, the
  library schema, `configFile` round-trip preserving unknown keys and *not* materializing defaults, and
  every new admin route being token-gated).
- **A live farm.** Ran a second, isolated farm (own ports, beacon off, plugins off) alongside the one
  actually serving users on this box, and drove the real HTTP API: state shape → rename → `/v1/models`
  shows it → persisted; library add/remove incl. refusing a non-`.gguf` and a duplicate; slots; **live
  backend switch to llama.cpp and back**; context window reaching `llamacpp.contextLength`; the bad-URL
  rollback; and name continuity across a switch in both directions. All green.
- **The panel itself rendered** against that farm's real `/lol/admin/state` in a DOM stub, in both engine
  modes, asserting every control is present and that no `undefined`/`NaN` leaks into the page.
- Both TypeScript projects clean; the example config validates against the real schema; 30/30
  cross-document anchors resolve.

---

## 2026-08-25 g — documentation brought back to the code, via a blind fact-checking loop

The docs had drifted a full product generation behind (v0.1.25 / gemma4-on-Ollama era) while the code
moved to a two-engine farm, an OWUI client with LOL Chat, and an owner-settable model name. Owner ask:
document **the new backend, multi-user management, and how to add models**, and iterate against an
agnostic critic until the docs match the codebase.

**Method.** Three rounds of subagent critics with **no context from me** — each read the *code* as
ground truth and was told the docs are not authoritative. Round 1: two fact-checkers (farm side /
client side). Round 2: an adversarial checker that **executed** the documented recipes against the real
modules, plus a usability reviewer reading as three personas. Round 3: a final acceptance audit.
Scores moved **6/10 → 8/10 → 8.5/10 accuracy**, ending at *"trustworthy to follow unsupervised"*, 5/5
operator tasks succeeding from the docs alone.

**What the loop caught that a self-review would not have** (each verified in code before fixing):

- **A config example that silently deletes a model.** `farm/README.md` showed `modelAlias: "assistant"`,
  which collides with `llamacpp.alias`: `litellm.js:88` skips the Ollama deployment and `snapshot.js`
  drops it, so `gemma4:12b` vanished from routing *and* the beacon with no warning. Round 2 then showed
  the same silent loss via a **per-model `alias`** — the warning now covers both, with a table.
- **The documented way to add a model didn't serve it.** `lol models add X` then plain `lol up`:
  the picker **replaces** the catalog (`up.js:284` + `modelPicker.js:112`), so pressing Enter serves
  only the default and drops the addition. Docs now say `--no-pick`; the CLI's own hint said the wrong
  thing too and was fixed at the source (`models.js`).
- **A "safe shapes" VRAM table that wasn't.** Farm OCR loads `gemma4:12b` (~7.6 GB) onto the same GPU on
  the first document upload, so on a 12 GB card *no* row also fits it. Now stated with four remedies,
  in both the farm README and — the round-3 top fix — attached to GETTING_STARTED's capacity table,
  where it connects to §7's "it got slow and stayed slow" symptom.
- **Three docs and two code comments named the wrong API.** The Blender tool server registers via
  `POST /api/v1/users/user/settings/update` (`app.js:378`), never `/api/v1/configs/tool_servers`. And the
  "one non-env exception" is **two**: the client also silently sets OWUI's web search to *always*.
- **The Farm app was called "self-updating"** in the root README while `farm-app/src/main/updater.ts` is
  explicitly manual — the failure mode being farms drifting behind an auto-updating client fleet.
- **Prerequisites lied.** `farm/README.md` claimed Node was the *only* prerequisite; without Python,
  `lol install` stops at "Bootstrap incomplete" and there is no proxy.
- **`farm/.llamacpp/` was not gitignored** — a few hundred MB of CUDA runtime one `git add -A` away.
- **Download budget was wrong everywhere** (~20 GB). The `preinstall` default (~8.6 GB) applies even to
  configs that omit the key — verified — so the real figure is **~28 GB**, now one table both routes cite.

**New documentation** (the three asked-for topics): `farm/README.md` gained **Backends** (which engine
owns which model_name, the quant↔`mtp` rule), **Adding or changing models** (llama.cpp path, Ollama
path, admin-panel path, and what each *cannot* do), and **Multiple users & capacity** — including the
empirically verified fact that llama.cpp **splits `--ctx-size` across `--parallel` slots**
(`--ctx-size 16384 --parallel 2` → `n_ctx_slot = 8192`, read off the pinned binary), a VRAM budget
table, and the honest framing that "multi-user" here is capacity, not accounts. `GETTING_STARTED` was
restructured into **two labelled routes** (the Farm app — whose download link existed nowhere — and the
CLI), and gained a group-capacity callout, an **"If it's slow"** triage section, a **glossary**, and a
**"farm won't start"** symptom table.

**Also documented honestly rather than hidden:** with the llama.cpp backend on (the default), the admin
panel's *"Make default"* and both context-window controls (panel and Farm app) do **not** affect the
model clients actually chat with — they are Ollama-side. Worth fixing in code later; the docs say so now.

**Verified after every round:** 64 farm tests, the example config validates against the real zod schema,
both TypeScript projects compile, `lol --help` parses, and a link-checker confirms **30/30**
cross-document anchors resolve.

---

## 2026-08-25 f — icons v2, forged by a blind-critic loop

Owner ask: iterate the icons against an agnostic critic agent until (1) client vs farm is clear
and (2) the product reads as an AI chat app over a LAN — both inferred from the icons alone.

**Protocol:** fresh subagent critics with zero design context, neutral file names (no
"client"/"farm" in paths), A/B order swapped between critics to cancel position bias. Each round:
blind product guess → role assignment with confidence → scores → minimal fixes.

**Round 1 (the (e) beacon pair, hue-only split): FAIL.** The two critics *split* on which app was
which (one said green=server, the other green=client, low confidence — "the pair encodes no role
information"), and both read the product as a casting/hotspot tool: the mark was pixel-for-pixel
the stock OS broadcast glyph. Convergent fixes: an ownable center element; separate by tile
LUMINANCE, not stroke hue.

**Revision:** shared mark = chat bubble with a four-point AI sparkle knocked out, flanked by two
signal arcs (chat + AI + LAN in one glyph); **client** = white mark on a SOLID emerald tile (the
messaging-app costume — the one you'd open to chat), **farm** = emerald mark on the dark
machine-room tile.

**Round 2 (two fresh critics, orders swapped): PASS.** Both guessed, first try, "a self-hosted /
local-network AI chat assistant — a client you chat in plus a server broadcasting the AI service
on the LAN," and both assigned roles correctly (medium / medium-high confidence). Applied their
nits: sparkle arms opened + bubble enlarged (48 px counterform), farm tile lifted off dark
taskbars (lighter top stop + stronger keyline), tail shortened clear of the left arc.

**Round 3 (final fresh critic): SHIP** — same correct product + role reads, tell-apart 8/10
including a value-contrast (colorblind-safe) pass; one flag: the bright green + white bubble sat
"uncomfortably close to WhatsApp's parking spot" at 48 px → client field deepened to dark emerald
(#0ea371→#064e3b), clearly off WhatsApp's leaf green.

Suggestions deliberately NOT taken (they break the one-shared-mark / palette constraints):
per-role inner glyphs, arcs only on the server, amber/cyan server hues. Files:
`shell/assets/icon.{svg,png}`, `farm-app/assets/icon.{svg,png}` — same install surfaces as (e).

---

## 2026-08-25 e — new app icons: one beacon mark, client in zinc, farm in emerald

Owner ask: modern/elegant/simple icons, and the client and farm apps must be distinguishable at a
glance (both shipped a byte-identical icon).

New mark: a **live LAN broadcast** — a center node with two arcs radiating each side, ((•)) — the
UDP beacon that defines the product, replacing the busier chat-bubble + node-graph. Hand-authored
SVG (1024 viewBox), soft vertical tile gradient + a faint inner rim, round-capped strokes.
One geometry, two colorways: **client** = zinc-white mark on the ComfyQ dark tile; **farm** =
emerald (#4ade80→#059669, the palette's "serving" green) on a subtly green-tinted tile, so the
two also separate at 16 px where stroke hue alone wouldn't. First beacon-arc draft read as the
RSS logo (dot + corner arcs) — scrapped for the symmetric form.

Rendered to 1024-px PNGs with sharp (scratch tooling, not a repo dep) and visually checked at 512
and 48 px. Files: `shell/assets/icon.{svg,png}` (SVG doubles as the topbar logo) and
`farm-app/assets/icon.{svg,png}` (PNG doubles as the app's welcome/topbar logo); electron-builder
derives ico/icns from the 1024 PNGs at package time, so the installers and taskbar/dock pick the
split up on the next release of each app.

---

## 2026-08-25 d — the advertised model name is the owner's choice (farm-app Settings)

Owner ask: the name users see in the model picker should be a hand-chosen string — not
"assistant"/"reasoning" and not a checkpoint id like `Qwen3.8-27B-UD-IQ2_S`.

The wire mechanism already existed (the served ALIAS — `llamacpp.alias`, per-model `alias`,
global `modelAlias`); what was missing was an owner-facing control. Over an OpenAI connection the
id from `/v1/models` IS what pickers display, so renaming the alias is the only clean lever —
there is no separate display-name channel to an unmodified OWUI.

**Farm app**: a **Model name** field in Settings (mirrors the context-window pattern exactly):
`set-model-name` IPC → persisted in farm-settings → `setModelName()` patches `lol.config.json`
(`llamacpp.alias` when the llama.cpp backend is on — the default — else `modelAlias`, so the
string survives a backend switch) → farm restart; enforced on every boot like the share toggle
and context window. Empty clears back to the farm default. Sanitized (control chars stripped,
48-char cap); unicode fine (« Génie du studio » asserted). The checkpoint remains visible to
clients as the snapshot's `underlying`, so "what actually runs" is not hidden — only the label is
friendly. Caveat stated in the UI: renaming changes the model id, so existing chats ask to
re-select the model; new chats are unaffected.

**Verified offline against the farm's own chain** (scratch harness): patched config → zod parses
→ LiteLLM `model_name` carries the custom string → snapshot advertises it as the default with the
gguf basename as `underlying`; clearing restores 'assistant'; the llamacpp-off path lands on
`modelAlias`. farm-app tsc clean; farm suite 64 pass. No client change needed — the name rides
the beacon into DEFAULT_MODELS and both pickers (client v0.1.31's repoint applies it).

---

## 2026-08-25 c — UD-IQ2_S as the served quant · OWUI client back, boots ONCE, TTFT unblocked

Owner asks after testing the new farm: (1) richer startup feedback (what IS it doing, so a hang is
distinguishable), and the served quant changed to **UD-IQ2_S**; (2) the client back to **Open
WebUI** for its features, but with better launch time and time-to-first-token. Shipped as client
v0.1.31 + farm-v0.0.17.

**Farm — quant** ([config.js](../farm/src/config.js)): `llamacpp.model` default is now
`Qwen3.8-27B-UD-IQ2_S.gguf` (7.8 GB, HEAD-verified) — the owner's pick after A/B-ing Unsloth
Studio on this exact quant; 91% on the graded suite (tied with Q2_K_XL) and fully resident on
12 GB with real headroom. Consequence: Unsloth STRIPS the MTP head below UD-Q2_K_XL, so
**`mtp` now defaults false** (llama-server exits "model doesn't contain MTP layers" otherwise);
it stays an opt-in for Q2_K_XL-and-above. **Live-validated on the dev box** with the exact
shipped argv: healthy start, **109.3 tok/s generation, 310 tok/s prompt, 0.23 s TTFT** (RTX PRO
6000; fleet 4070s will be lower but far above the old 4.4).

**Farm — startup feedback** ([farmSupervisor.ts](../farm-app/src/main/farmSupervisor.ts)): the
overlay now mirrors `lol up`'s own narration — step lines ("Starting LiteLLM …") when quiet,
download-progress lines ("[llama.cpp] model weights — 43%", ollama pulls, draft modules) when
active — so a working bootstrap and a hang look different. (Builds on entry (b)'s activity-aware
health wait.)

**Client — OWUI restored** ([clientMode.ts](../shell/src/main/clientMode.ts) `OWUI_ENABLED=true`
+ renderer `NO_OWUI=false`): all OWUI features return; LOL Chat stays behind the topbar toggle
(studio-build behavior, incl. `allowpopups` back on the webview).

**Client — launch time**: on nearly every cold launch OWUI booted **TWICE** — the boot started
the sidecar with model/searxng/tts/extract = null (beacon not yet received), then the first
beacon differed → repoint → full second boot. Two changes: the farm context persists in settings
alongside `lastEndpoint` and seeds the boot; and `chooseActive` now stays with last session's
farm at cold boot while it's healthy (on a multi-farm LAN the load-scatter re-roll used to pick a
different box → guaranteed repoint; spreading still applies to first connects and failover).
**Verified in dev**: run 1 = spawn → repoint → spawn (the old pathology, then it persists
context); run 2 = **exactly one spawn, zero repoints**.

**Client — TTFT** ([configBridge.ts](../shell/src/main/configBridge.ts)): OWUI runs extra LLM
calls against the same farm endpoint, and llama-server has ONE slot (`parallel=1`) — any of them
in flight queues the user's completion. In the pinned 0.10.2, follow-up-question and tag
generation are default-ON and fire after EVERY response, exactly when the user types their next
message → `ENABLE_FOLLOW_UP_GENERATION=false`, `ENABLE_TAGS_GENERATION=false`, and
`ENABLE_AUTOCOMPLETE_GENERATION` pinned false (already 0.10.2's default; a pin bump must not
silently re-enable per-keystroke completions). Title generation stays on (once per chat, names
the sidebar). Env names verified in the installed sidecar's `config.py`.

**Harness** ([shell/test/e2e.js](../shell/test/e2e.js)): updated for the OWUI build — clicks the
toggle to reach LOL Chat, and the client is pinned to the mock via `LOL_ENDPOINT` (the new
cold-boot stickiness beats even a coordinator mock, by design). Green: farm discovered, models
fetched, `assistant` preselected, 1000 tokens at 287.7 tok/s. Farm suite 64 pass; both tscs clean.

---

## 2026-08-25 b — farm-v0.0.15 "does not start": first-boot bootstrap vs a 3-minute health timeout

Owner report, both on a 4070 box and on the dev box: the updated Farm app "does not start".

**What was actually happening** (read live off the dev box while it was "broken"): the update had
refreshed the farm code, `lol up` was running fine, and it was **~15 minutes into downloading the
llama.cpp backend** — the pinned build + CUDA runtime (~0.5 GB) and the UD-Q2_K_XL weights
(~10.6 GB at ~13 MB/s) — which all has to land before the proxy can exist. Meanwhile
[farmSupervisor.ts](../farm-app/src/main/farmSupervisor.ts) gave `/lol/self` a fixed **180 s** to
answer, declared "The farm did not become healthy in time", and the overlay showed Error while the
child kept downloading behind it. Worse, the overlay's "Start the farm" button calls `start()`,
which **kills the child and restarts the whole download from zero** (the downloader is atomic but
has no resume). So the failure was pure UX: a silent multi-GB bootstrap presented as a dead farm.

Three changes:

1. **Supervisor health-wait is now ACTIVITY-aware** — keep waiting as long as the child produces
   output (downloads print per-percent lines); fail only after 5 *silent* minutes, or a 2 h hard
   cap. A genuinely wedged farm still errors; a busy one no longer does.
2. **Bootstrap progress reaches the overlay** — the supervisor parses the child's
   `[llama.cpp] <what> <pct>%` lines (ANSI/`\r` stripped) into `state.message`, and the renderer
   shows it while starting: "First start: fetching model weights — 43%" instead of a bare
   "Starting the farm…".
3. **`lol install` pre-fetches the llama.cpp backend** ([install.js](../farm/src/commands/install.js),
   mirroring the SearXNG/OCR pre-install pattern, idempotent + non-fatal) — so on a FRESH install
   the wizard's deps phase absorbs the download instead of the first `lol up`.

**Verified**: farm suite 64 pass; farm-app tsc clean. The dev box's stuck-looking install was left
untouched and completed on its own once the download finished — confirming the farm itself was
never broken (see the live health check in this entry's release). Driver note for the fleet: the
pinned llama.cpp build is `cuda-13.3` — boxes need an NVIDIA driver new enough for the CUDA 13.x
runtime (the dev box's 596.36 is fine; check `nvidia-smi` on the 4070 boxes if llama-server fails
to init CUDA after the download).

---

## 2026-08-25 — v0.1.29 "unreachable": CSP blocked LOL Chat entirely + the farm advertised the wrong default

Owner report on the studio fleet: the v0.1.29 client shows the model dropdown as **"unreachable"**
and every send fails with **"[error: Failed to fetch]"** — while the pill happily shows the farm
connected. And inference through LOL "is not really usable" versus Unsloth Studio running
`UD-IQ2_S` on the same class of box.

**Root causes (three independent ones stacked):**

1. **The renderer CSP had no `connect-src`** ([index.html](../shell/renderer/index.html)), so
   `connect-src` fell back to `default-src 'self'` — and a `file://` page's `'self'` never matches
   `http://<farm>:4000`. Every `fetch()` LOL Chat makes was blocked by Chromium before it left the
   process. This never bit before because the OWUI build's traffic goes sidecar-side; LOL Chat is
   the first renderer code to call the farm directly, and the pill stays green because the UDP
   beacon arrives in the MAIN process. Fix: `connect-src 'self' http: https:` (the farm address is
   discovered at runtime, so it cannot be listed literally). CORS is fine once CSP allows the
   request — the pinned LiteLLM defaults to `allow_origins ["*"]` (verified in the venv source).

2. **The snapshot advertised the wrong default model when llamacpp is enabled**
   ([snapshot.js](../farm/src/snapshot.js)). `buildSnapshot` only mapped `config.models`, so the
   default advertised to clients stayed `gemma4:12b`-via-Ollama while the llama.cpp backend served
   `assistant` — the ONLY configuration measured fast on 12 GB (154.8 tok/s). Worse than a wrong
   label: a client following the advertised default loads a SECOND model into a card llama-server
   already fills (~10.6 GB), guaranteeing spill. Now the llamacpp alias is advertised first and
   default (underlying = the GGUF basename), Ollama models stay selectable but never default; the
   shell publishes `defaultModel` through `window.__lolFarm` and the picker preselects it. New
   test pins the contract (64 pass).

3. **The chat surface re-rendered the ENTIRE thread on every streamed token**
   ([chat.js](../shell/renderer/chat.js)) — O(thread) DOM rebuild per delta, on the same thread as
   the stream reader, so at 100+ tok/s the renderer throttles the stream it is displaying. Now the
   thread renders once per send and only the live row's bodies update, at most once per animation
   frame; auto-scroll only when already at the bottom; the 4-second `publishFarm` tick no longer
   rebuilds the DOM mid-stream (it used to orphan the streaming row) and no longer resets the model
   dropdown (models refetch only when the endpoint changes or the last fetch failed).

Plus two no-OWUI-build bugs found while verifying: **repoint still booted the OWUI sidecar** (on a
machine upgraded from ≤0.1.28 the sidecar is installed, so v0.1.29 silently ran a whole Python+OWUI
stack nothing uses) — `sidecar.pointTo()` now records the endpoint state-only; and the **overlay
could stick over a working chat** (it is farm-driven in this build but was only re-evaluated on
sidecar events) — `publishFarm`/`onFarms` now re-evaluate it.

**Tested** with a new dependency-free E2E harness ([shell/test/](../shell/test/)): `mock-farm.js`
(UDP beacon + OpenAI streaming endpoint, `--coordinator` to outrank real LAN farms) +
`e2e.js` (drives the real Electron app over CDP). Full chain green: discovery → overlay clears →
models fetched → `assistant` preselected → **1000 tokens streamed at 286 tok/s, TTFT 0.03 s**,
stats row rendered. The render path is no longer the bottleneck at any speed the farm can produce.

**Measured live against the real farm** (AN-VR-01, farm-v0.0.14 line, Ollama serving
`hf.co/…:UD-IQ2_XXS` + the separate draft module): the fixed client connected and streamed fine —
at **4.4 tok/s with a 17.4 s first token**. That is the farm-side config the config comments
already predict spills on 12 GB (`IQ2_XXS + draft ≈ 11.0 GB > ~10.7 GB usable`). So the
"Unsloth Studio is fast, LOL is not" gap is the FARM build, not the client: AN-VR-01 needs the
farm-v0.0.15 line (llama.cpp backend, UD-Q2_K_XL + q4_0 KV + MTP ≈ 10.6 GB resident,
154.8 tok/s / 0.13 s TTFT measured) with fix #2 above so clients actually land on it.

Dev note: VS Code's integrated shell exports `ELECTRON_RUN_AS_NODE`; unset it before
`npx electron .` or the app dies at `app.setName` running as plain Node.

---

## 2026-08-19 b — The fastapi pin broke FRESH installs (my bug) — corrected bound

Entry (g)'s `fastapi<0.116` pin fixed the *symptom* on an already-built venv but **broke
every fresh install**. Reported from a clean Windows box: `lol install` ran, then pip spent
minutes backtracking through litellm versions and finally tried to **compile litellm 1.93.0
from source** → `Rust not found` → install failed.

Root cause (my error): **`litellm[proxy]` 1.97.0 itself declares `fastapi<1.0,>=0.136.3`.**
`<0.116` contradicts that floor, so the resolver had no solution with the newest litellm and
walked backwards until it hit a version with no Windows wheel. My original "fix" only worked
because I applied it to an *existing* venv in a second pip call, where pip permits the
downgrade with a warning — it never had to solve both constraints at once.

Corrected by finding the bound empirically (script: download each fastapi in litellm's range,
unzip, grep `dependencies/utils.py` for the symbol): **`get_flat_dependant` was removed in
fastapi 0.140.7**, so the newest compatible bound is **`fastapi>=0.136.3,<0.140.7`** — inside
litellm's declared range, so the resolver has a solution. Verified in a clean venv built with
the bundled Python:

    pip install "litellm[proxy]" "fastapi>=0.136.3,<0.140.7"   → exit 0, no backtracking
    litellm 1.97.0 · fastapi 0.140.6 · starlette 1.6.0
    import litellm.proxy.proxy_server                          → OK

The lower bound is load-bearing for **repair** too: with a bare `<0.140.7` the fix is a no-op
on a venv stuck at the old 0.115.6 (already satisfied), leaving it functional-but-fragile —
below litellm's floor with a stale starlette that breaks `sse-starlette`. With the floor, the
repair actively upgrades: verified on the dev box 0.115.6 → 0.140.6 (starlette 0.41.3 → 1.6.0),
and `pip check` went from conflicts to **"No broken requirements found"**.

Both sites updated (`install.js` FASTAPI_PIN + farm-app `repairLitellmVenv`), so an app update
heals an existing box and fresh installs resolve first time. **farm-v0.0.9 / v0.0.10 ship the
broken pin and cannot complete a fresh install — use 0.0.11+.**

---

## 2026-08-19 — Max context for RAG (measured) + Intel-Mac client builds

**1. Context window raised — with real numbers, not a guess.** The project's point is RAG
through OWUI, so the context window is the lever that matters. Measured on the dev box
(RTX PRO 6000, Ollama 0.32) by loading each model at increasing `num_ctx` and reading
`/api/ps size_vram` — Ollama **preallocates the whole KV cache at load**, confirmed by then
filling 77k real tokens and seeing **zero** further growth:

| model | 8k | 32k | 128k | 256k |
|---|---|---|---|---|
| `gemma4:12b` | 7.8 GB | 7.8 GB | 8.8 GB | **9.3 GB** |
| `qwen3.8` (27B) | 16.2 GB | 16.3 GB | 17.2 GB | **17.6 GB** |

i.e. going from 8k to the **full 256k costs ~1.5 GB** — the old "KV grows linearly with
context" intuition doesn't hold for these architectures (sliding-window on gemma4, grouped
KV `head_count_kv:4` on qwen3.x). Both report `context_length = 262144` as their native max,
which is also `setContextLength`'s server-side cap. Changes:
- Farm default `ollama.contextLength` **16384 → 65536** ([config.js](../farm/src/config.js)),
  with the measurements recorded inline. Two tests asserted the old default — updated (54 pass).
- Admin panel `CTX_OPTS` gained **131072 + 262144** — the UI previously capped at 65536, so
  the models' max wasn't even reachable ([admin/index.html](../farm/src/admin/index.html)).
- Farm app: a **persistent** Context window selector (Settings). The admin panel's change is
  deliberately ephemeral (resets on `lol up`); this writes `ollama.contextLength` into
  `lol.config.json` (`setContextLength`, enforced on boot like the share toggle) and restarts
  the farm. Verified the whole chain: patcher → zod validates → generated LiteLLM routing
  carries `num_ctx: 262144` (it rides the routing, so it applies on **every** host regardless
  of who started Ollama).

**2. Intel-Mac (x64) client builds — ATTEMPTED, BLOCKED UPSTREAM, reverted.** Some users are
on pre-Apple-Silicon Macs. The old x64 exclusion blamed the *bundled* sidecar — that reason
was **stale** (the sidecar is downloaded per platform-arch now, so the real requirement is
just publishing `owui-sidecar-darwin-x64.tar.gz`). Pre-flight against PyPI cleared the risk I
expected — PyTorch's last macOS-x86_64 wheel is 2.2.2, but OWUI doesn't pin torch directly and
`sentence-transformers` accepts `torch>=1.11.0`, with a cp312 x86_64 wheel available.

So it was implemented (mac arch `[arm64, x64]` + a `macos-15-intel` sidecar-only CI job;
`macos-13` is retired) and released as v0.1.27 — where the Intel job **failed on a dependency
I hadn't checked**:

```
ERROR: Could not find a version that satisfies the requirement onnxruntime==1.26.0
       (from versions: 1.17.0 … 1.23.2)
```

**OWUI 0.10.2 pins `onnxruntime==1.26.0` exactly, and onnxruntime's last macOS-x86_64 wheel
was 1.23.2** (arm64 is at 1.29.0). `pip install open-webui==0.10.2` therefore cannot resolve
on any Intel Mac. Not fixable on our side: patching OWUI's dependency metadata would violate
prime directive #1 (vendored + **UNMODIFIED**), and pinning OWUI back to a release old enough
to want onnxruntime ≤1.23.2 would downgrade every other client.

**Reverted** to mac `arm64` only + the Intel CI job removed (the `sidecarOnly` flag and its
step guards are KEPT, so re-enabling is a two-line change if OWUI ever relaxes the pin).
Critically, v0.1.27 had already published an **x64 dmg/zip with no matching x64 sidecar** —
an Intel user installing `LlmOnLan-0.1.27.dmg` (the un-suffixed name they'd click first) would
hit the very "Could not download the chat engine" dead end this release was meant to fix. Those
four x64 assets were **deleted from the release**; the arm64/win/linux assets (which carry the
`/var`-symlink tar fix from entry (h)) are untouched and working.

---

## 2026-07-06 h — CLIENT: sidecar download failed on macOS (/var symlink vs relative tar)

The client shell's first-run download failed on macOS with *"Could not download the chat
engine"*:
`tar: could not chdir to '../../../../../Users/<user>/Library/Application Support/LlmOnLan/sidecar.stage'`.

Root cause: `installFrom` ([sidecarManager.ts](../shell/src/main/sidecarManager.ts)) extracted
with **relative** paths — a deliberate WINDOWS workaround (GNU tar, often first on PATH via
Git, reads an absolute `C:\…` as a remote `host:path` → "Cannot connect to C:"). But macOS's
temp dir lives under **`/var`, a symlink to `/private/var`**: `path.relative()` computes the
traversal **lexically** from `/var/folders/…`, while tar resolves its cwd to the **real**
`/private/var/folders/…` — so the `../../../../..` hops land one level short, at `/private`,
producing the nonexistent `/private/Users/…`. Linux was unaffected (no symlinked temp
prefix); Windows was fine (short traversal within the same drive).

Fix: split by platform — RELATIVE on `win32` (the workaround is genuinely needed there),
**ABSOLUTE everywhere else**. Verified with a real tar harness: on Windows the absolute form
fails with `Cannot connect to C:` (proving the relative branch must stay) while the relative
form extracts; and the macOS path math reproduces exactly — relative resolves to
`/private/Users/…` ≠ the intended dest. The identical latent pattern in the farm app's
`extractArchive` ([runtimeManager.ts](../farm-app/src/main/runtimeManager.ts)) was fixed the
same way (currently safe there — its tarball sits inside userData, so no `/var` straddle —
but it was one path change from the same trap).

---

## 2026-07-06 g — LiteLLM venv broke on Windows (fastapi too new) — pin + repair

The Farm app on Windows "didn't start". Captured the farm boot from source (the packaged
GUI swallows console): the app + main process start fine, but **`lol up`'s LiteLLM crashes
on startup**:
`ImportError: cannot import name 'get_flat_dependant' from 'fastapi.dependencies.utils'`.
Not a 0.0.8 bug — the venv has **litellm 1.97.0 + fastapi 0.141.1**, and litellm 1.97.0
imports `get_flat_dependant`, which fastapi ≥0.116 removed. litellm's fastapi range is too
loose, so `pip install litellm[proxy]` (unpinned, in `install.js`) let pip pull the newer
fastapi. The DGX escaped it only by installing when an older fastapi was still latest.
Confirmed the fix live on the box: `pip install "fastapi==0.115.6"` → LiteLLM imports →
`/lol/self` 200 → a real `/v1/chat/completions` returns 200.

Two-part durable fix:
- **Prevent (farm [install.js](../farm/src/commands/install.js) `ensureLitellm`):** install
  `litellm[proxy]` with `fastapi<0.116`, and — since the venv is built once — **also enforce
  the pin on an existing venv** when `lol install` re-runs (idempotent/best-effort).
- **Reach installed boxes (farm-app [installer.ts](../farm-app/src/main/installer.ts)):** the
  venv is never touched by a code refresh, so `refreshFarmCodeIfUpdated` now also runs
  `repairLitellmVenv()` (`<venv python> -m pip install fastapi<0.116`) on an app update —
  so updating the app fixes a drifted venv without a full re-install. Fast no-op when satisfied.

So updating to 0.0.9 repairs any box with the bad combo; fresh installs get the pin. (This
is the venv analogue of entry (e)'s code-propagation — farm-side pip fixes now reach installed
farms on update, not just fresh setups.)

---

## 2026-07-06 f — copyFarm choked on node_modules/.bin symlinks (blocked (e))

The propagation from (e) silently failed on the DGX: the boot log showed
`[farm] code refresh failed: ENOENT: no such file or directory, stat
'.../farm/node_modules/.bin/js-yaml'`. `refreshFarmCodeIfUpdated` fired correctly, but
`copyFarm`'s `fs.cpSync` **throws re-copying the `node_modules/.bin` CLI symlinks over an
existing tree** (npm makes those symlinks on Linux; a dereferencing copy stat-follows a
now-dangling one). So the version was never stamped and the farm code never refreshed —
`NVIDIA GB10 · 0GB VRAM` persisted through the 0.0.7 update even though the fix was in the
bundle. (The earlier local test missed it because it copied into a *fresh* dest, not over
an existing install — fixed the test too.)

Fix ([installer.ts](../farm-app/src/main/installer.ts) `copyFarm`): **skip
`node_modules/.bin`** (CLI symlinks the farm never uses — it `require()`s the packages
directly) + `verbatimSymlinks: true` + explicit `force: true`. Verified with a re-copy test
over a pre-populated dest: no throw, `systemInfo.js` refreshes, `.venv`/config preserved,
`js-yaml` package still copied. So on the 0.0.8 update the DGX's farm code finally refreshes
and VRAM reads the unified 122 GB. (Good news from the same log: the free-port fix works —
SearXNG bound 38989, OCR 43989, both healthy.)

---

## 2026-07-06 e — Farm-code updates now reach an already-installed farm

Caught while shipping (d): the setup wizard copies the bundled farm → `userData/farm`
**once**, and subsequent launches skip setup — so a **farm-side fix in an app update would
never reach an installed farm** (only the app's own compiled main process updates). That
would have made (d)'s VRAM + reap fixes (and the earlier `resolvePython`/plugin fixes)
dead-on-arrival for anyone updating rather than reinstalling.

Fix: `refreshFarmCodeIfUpdated(appVersion)` ([installer.ts](../farm-app/src/main/installer.ts))
runs on the installed-boot path — if the app version differs from the `farmCodeVersion`
recorded in settings, it re-runs `copyFarm()` (whose skip-list preserves the built venvs,
`lol.config.json`, and runtime state, so ONLY `src`/`bin`/`node_modules` refresh) and stamps
the new version. A fresh setup stamps the version too, so there's no redundant first-boot
copy. Net: updating the Farm app now propagates farm-side fixes to `userData/farm` on next
launch. (So the DGX gets the VRAM + reap fixes just by updating to this build.)

---

## 2026-07-06 d — GB10 unified-memory VRAM + orphaned-plugin reaping

The two follow-ups from entry (c), after web search was confirmed working on the Spark.

**(1) GB10 "0GB VRAM".** `nvidia-smi --query-gpu=memory.total` returns 0/[N/A] on the
DGX Spark's GB10 (Grace-Blackwell unified memory — no dedicated VRAM), so the card showed
"0GB VRAM". Fix ([systemInfo.js](../farm/src/systemInfo.js)): a detected GPU reporting 0
memory is treated as unified and reports the **system RAM pool** as its usable memory
(`detectHardware` static + `gpuLiveStats` live total). Guarded on a real GPU name, so a
box with no nvidia-smi still reports `vramGb:0` (the CI test stays green). GB10 now shows
~122 GB.

**(2) Orphaned plugins.** The SearXNG/Kokoro/OCR plugins spawn `detached: !IS_WIN` (own
process group), so a group-kill of `lol up` — or the app being force-quit / Ctrl-C'd in a
terminal — orphans them still holding their ports (8888/8890), which then blocks the next
run (and was compounding the DGX port clash). Two fixes:
- **Farm ([up.js](../farm/src/commands/up.js)):** when clearing a *stale* runtime (its
  LiteLLM is gone), reap the recorded plugin/Ollama PIDs that outlived it before starting.
  Helps CLI users + is defense-in-depth.
- **Farm app (new [farmProcess.ts](../farm-app/src/main/farmProcess.ts) `reapStaleFarm()`):**
  before every start (in `startFarm`, ahead of `ensurePluginPorts`) AND after `supervisor.stop()`,
  read `<farm>/.lol-runtime.json` and kill any still-alive recorded PIDs — including a live
  LiteLLM (so a fresh app process doesn't hit `lol up`'s "already running" refuse → crash-loop).
  Reaping before `ensurePluginPorts` frees ports the orphans held, so the defaults can be kept.

Verified: farm-app tsc clean, 54 farm tests green, `findFreePort`/reap logic exercised,
app boots clean.

---

## 2026-07-06 c — Farm app: auto-pick free ports for SearXNG/OCR (DGX port clash)

On the DGX Spark, web search + document OCR never came up: the client showed no Web
Search toggle. Diagnosed from the farm's terminal log (`./LlmOnLan-Farm-*.AppImage`
run in a shell): **not an arm64 issue** — both plugins install + start fine, but fail
to BIND their ports: SearXNG `Address already in use ... Port 8888`, OCR `[Errno 98] ...
('0.0.0.0', 8890): address already in use`. **8888 is JupyterLab's default port**, which
the NVIDIA DGX stack runs; 8890 was likely a leftover from an earlier run. The farm then
disables a plugin that dies during startup (SearXNG → snapshot `enabled:false`) or marks
it unhealthy if it dies just after (OCR → `enabled:true, healthy:false`) — which is
exactly the state `/lol/self` reported. Chat was unaffected (Ollama/LiteLLM on 11434/4000).

Fix (farm-app, no farm-side change): new `ensurePluginPorts()` runs before every farm
start — it checks `websearch.port` (8888) and `ocr.port` (8890) with `findFreePort()`
(added to util.ts; binds-tests on 0.0.0.0 so a conflict on any interface is caught) and,
if taken, patches `lol.config.json` to a free port. The client adapts automatically since
the port rides in the beacon snapshot (`searxngUrl`/`extract.url`). Wired into all start
paths via a `startFarm()` helper (boot, setup launch, Start button, share toggle). No-op
when the defaults are free. Verified: `findFreePort(occupied)` reroutes, `findFreePort(free)`
keeps. **Follow-ups noted:** plugin child-process cleanup (orphans can accumulate on repeated
restarts — a free port sidesteps but doesn't reap them) and the GB10 "0GB VRAM" detection.

---

## 2026-07-06 b — Farm releases broke the CLIENT's auto-update (shared release page)

Publishing the farm to the SAME GitHub repo as the client broke the **client's**
auto-update. Root cause: electron-updater (default `allowPrerelease:false`) resolves
updates via GitHub's **`/releases/latest`**, which returns the newest **non-prerelease**
release. Once `farm-v0.0.3` shipped it became GitHub's "Latest" — so a client updater hit
the farm release, looked for its `latest.yml` there, found only `farm.yml`, and 404'd.
It's a see-saw: whichever app released most recently owns "latest" and the other breaks.
The `channel: farm` vs `latest` split controls the FILE NAME but NOT which release
`/releases/latest` returns, so it doesn't prevent the collision. (Verified via
`gh api repos/b2renger/LlmOnLan/releases/latest` → `farm-v0.0.3`.)

**Immediate fix (done):** marked `farm-v0.0.1/2/3` as **prereleases** → `/releases/latest`
reverts to `v0.1.25` (client's, which has `latest.yml`) → client auto-update restored.
**CI hardened:** `release-farm.yml` now creates farm releases with `--prerelease` so a
future `farm-v*` can't re-take "latest". Consequence: while the farm shares this repo, the
**farm app's own auto-update is off** (its updater also uses `/releases/latest` → the
client release → no `farm.yml`), so farm updates are manual for now.

**Durable fix (needs a decision + a GitHub action):** give the farm its **own releases
repo** (e.g. `b2renger/LlmOnLan-Farm`) so each app's `/releases/latest` is unambiguous.
Requires a new repo + a PAT secret for cross-repo publishing from Actions (GITHUB_TOKEN is
scoped to the workflow's repo). A one-repo auto-update for the farm isn't achievable
cleanly: electron-updater parses the git TAG as semver, so the farm's `farm-v*` tags are
unparseable on the prerelease/atom path, and a shared `v*` namespace would collide with the
client. Separate repo is the standard resolution (the Phase-F plan pre-identified it as the
fallback).

**Owner's call: manual farm updates (zero new infra).** So electron-updater is now dead
weight for the farm (it can't resolve in the shared repo) — **removed as a dependency**
(farm-app runtime deps are now empty). `updater.ts` rewritten to a MANUAL check: a plain
GitHub-API query for the newest `farm-v*` release (prereleases included), semver-compared
to `app.getVersion()`; if newer, the renderer shows a non-silent notice and the "Check for
updates" button flips to **"Download vX"** which opens the release page (`shell.openExternal`)
— the operator downloads the new installer. Checked once on launch (when notifications are on)
+ on demand. IPC `install-app-update`/`onAppUpdateDownloaded` removed; `check-app-update` now
returns `{current, latest, updateAvailable, url}`. If the farm later gets its own releases
repo, restoring true auto-update is a small change (re-add electron-updater + point `publish`
at the new repo).

---

## 2026-07-06 a — Farm app hotfix: ship the farm's node_modules (js-yaml/zod)

**Critical packaging bug — every packaged build (farm-v0.0.1/0.0.2, all OSes) failed
the setup wizard's "deps" phase** with `Cannot find module 'js-yaml'`. Surfaced on the
DGX Spark first, but platform-independent. Root cause: **electron-builder HARD-EXCLUDES
any directory named `node_modules` while walking an `extraResources` `from` dir** — a
documented behavior (it assumes node_modules is handled via the app's own dependency
mechanism). Proven locally: with the filter removed entirely, electron-builder still
copied `.extract/venv/**` but never `node_modules`. So the bundled `resources/farm` had
`src/`/`bin/` but no `node_modules`, `copyFarm` faithfully copied that, and `lol` (which
`require`s js-yaml/zod) crashed. Dev (`npm run dev`) was unaffected because it reads the
real `farm/node_modules`, which is why it wasn't caught pre-release.

Fix: a **second `extraResources` entry** with `from: ../farm/node_modules` →
`to: farm/node_modules`. When `node_modules` is the walk ROOT (not a subdir encountered
mid-walk) the exclusion doesn't apply, so it copies. Verified by a local `--dir` pack:
`resources/farm/node_modules` now contains `js-yaml` + `zod` + `argparse` (js-yaml's
transitive dep). CI's `npm ci --omit=dev` in `farm/` already populates node_modules
before packaging, so this ships correctly. No other farm deps exist (package.json lists
only those two), so this fully unblocks the deps phase.

---

## 2026-07-05 i — Farm app: private by default + a "share compute" toggle

The Farm app now defaults to **fully private** and makes sharing compute an explicit
opt-in — an operator serving models for their own machine shouldn't have strangers
spending their GPU. New `FarmSettings.shareWithNetwork` (default **false**):

- **Private (default):** `writeFarmConfig` pins `proxy.host:"127.0.0.1"` +
  `beacon.enabled:false`, so the LiteLLM proxy + `/lol/self` bind localhost only and no
  beacon is sent. Other machines can't reach OR use the farm — critically, **not even by
  subnet scan** (the LlmOnLan client auto-probes `/lol/self`, so merely silencing the
  beacon would NOT have protected the compute; the localhost bind is what actually does).
- **Shared (toggle on):** rebinds `0.0.0.0` + `beacon.enabled:true` → advertises as a
  compute box; clients discover + use it.

Wiring: a **Share compute with the network** toggle in the app's Settings drawer +
a privacy line in the chrome (🔒 private vs. the shared endpoint). Flipping it rewrites
`lol.config.json` (`setShareMode`, a minimal beacon/proxy patch that preserves the rest)
and **restarts the farm** (bind address + beacon are read at `lol up` boot). Boot also
enforces the persisted posture via `setShareMode`, which **migrates** an older
0.0.0.0/beacon-on config to private on upgrade. No farm-side code change — it drives the
CLI's existing `proxy.host` + `beacon.enabled`, so terminal users get the same control.

Verified: tsc clean, renderer boots with no console errors. (This flips the app's
previous default from shared → private; farm-v0.0.1 shipped shared.)

---

## 2026-07-05 h — LlmOnLan Farm app: a self-installing desktop installer for the GPU box

A new **`farm-app/`** Electron workspace — a downloadable, self-updating installer that
turns any target GPU box into a running farm with **zero terminal, zero prerequisites**.
Sibling of the client `shell/`: same electron-builder / electron-updater / ad-hoc-mac-sign
recipe, but its process supervisor points at `lol up` instead of the OWUI sidecar. Targets
**Windows + NVIDIA (x64)**, **macOS Apple Silicon (arm64, ≥16 GB)**, and the **NVIDIA DGX
Spark (linux arm64)**.

**Architecture.** Small installer (~100 MB); the heavy runtime downloads on first run.
A setup wizard runs five idempotent/resumable phases (`src/main/installer.ts`):
1. **runtime** (`runtimeManager.ts`) — downloads a relocatable standalone **CPython**
   (python-build-standalone, same triples as `sidecar/build-sidecar.mjs`, incl.
   `aarch64-unknown-linux-gnu` for the DGX) + the **Ollama** archive for this OS/arch, into
   `userData/farm-runtime/`. Ollama asset names verified against ollama/ollama v0.31.1
   (`ollama-windows-amd64.zip`, `ollama-darwin.tgz`, `ollama-linux-arm64.tar.zst`); the
   resolved binary paths are recorded in `farm-runtime/runtime.json` (paths.ts reads it) so
   per-platform archive-layout differences don't matter.
2. **farm** — copies the bundled farm code (an electron-builder `extraResources` bundle) to a
   **writable** `userData/farm` (the farm writes its `.venv`/`.searxng`/`.extract`/
   `.lol-runtime.json` inside its own dir, which read-only app resources forbid) + writes
   `lol.config.json` (gemma4:12b default, a pinned random admin token).
3. **model** — `ollama pull gemma4:12b` (~8 GB) with a **real % bar** (own NDJSON reader off
   `completed/total`; the farm's `ollama.js` only forwards status text), under an app-owned
   Ollama that is **stopped before launch** so `lol up` owns Ollama with the right 16k-context
   env (a reused bare Ollama would default to a 4096 context that truncates documents).
4. **deps** — `lol install` (spawned as an Electron-as-Node child) builds the LiteLLM/SearXNG/
   OCR venvs; it reuses the pulled model (skips a re-pull) and the bundled Python.
5. **launch** — `FarmSupervisor` (`farmSupervisor.ts`, the SidecarSupervisor pattern) spawns
   `lol up --no-pick` as an Electron-as-Node child with the bundled python+ollama on `PATH` +
   `$LOL_PYTHON` set; health-waits `http://127.0.0.1:41997/lol/self`; bounded crash-restart;
   killTree on quit.

**Steady state:** the window IS the farm **admin panel** — `/lol/admin` in a `<webview>`, the
pinned token seeded into `localStorage` via a webview preload that reads it from the URL hash
(no prompt). Thin chrome: status dot, Start/Stop, the LAN endpoint (`http://<ip>:4000/v1`,
copyable), settings (theme / launch-at-login / auto-update), self-update. 2nd+ launch skips the
wizard and auto-starts.

**Farm-side change (small, shared):** a new `farm/src/python.js` `resolvePython()` honors
`$LOL_PYTHON` so the bundled interpreter is chosen **deterministically** (a stray system
`py -3.12` can't win the venv builds); wired into the four `findPython` sites (`commands/
install.js`, `searxng.js`, `kokoro.js`, `extract.js`). Behavior is byte-identical when
`$LOL_PYTHON` is unset — each site keeps its own ladder + accepted-version test. All **54 farm
tests still pass**.

**Packaging + CI:** `electron-builder.yml` (`appId com.llmonlan.farm`, the farm `extraResources`
bundle, `publish.channel: farm` → `farm.yml`/`farm-mac.yml`/`farm-linux.yml` so it never
collides with the client's `latest.yml`, win NSIS one-click, mac dmg+zip arm64 ad-hoc-signed,
**linux AppImage arm64** for the DGX). New `.github/workflows/release-farm.yml` triggers on
**`farm-v*`** tags, matrix `windows-latest` + `macos-latest` + **`ubuntu-24.04-arm`** (free
public-repo arm64 runner, native — no cross-compile), `npm ci` in `farm/` first so its pure-JS
node_modules ride along. `scripts/release.mjs` tags `farm-vX.Y.Z`.

**Verified (this box):** `npm install` (0 vulnerabilities), `tsc` build clean, `node --check` on
the renderer/preload + the four edited farm modules, `resolvePython` unit-checked (ladder
fallback / bogus-forced fallback / valid-forced wins), 54 farm tests green, and a real **Electron
boot** — the window opens to the welcome screen with no crashes/errors (only the benign
allowpopups warning, since removed).

**Residual risk (validate on release #1):** electron-updater channel resolution in a shared repo
— confirm the farm updater reads the newest `farm-v*` release's `farm.yml` and ignores the
client's `v*`/`latest.yml`. **Not yet run:** the packaged installers, a clean-box first-run wizard
(no system Python/Ollama), and the DGX arm64 build. See RIG_CHECKLIST → "Farm app install".

---

## 2026-07-05 g — Documentation audit: every doc verified against the code (48 fixes)

Wrap-up pass: a 9-agent audit checked every claim in every doc file against the
current source; 48 confirmed discrepancies fixed across README.md, farm/README.md,
shell/README.md, sidecar/README.md, CLAUDE.md, implementation_plan.md,
GETTING_STARTED.md, RIG_CHECKLIST.md and INTEGRATION_BRIEF.md. The load-bearing ones:

- **Two copy-paste-breaking config snippets**: `"ocr": { "model": null }` fails zod
  validation (the schema is `.optional()`, not `.nullable()` — the key must be
  omitted); farm/README's shape block still showed `ocr.enabled:false`.
- **Blender sections taught the pre-opt-in behavior** (README + GETTING_STARTED:
  "on by default", helper installs "on first launch", only an opt-OUT instruction) —
  rewritten for the v0.1.24 opt-in default, including the farm-recommendation path.
- **The whole admin panel was undocumented** outside farm/README — added to README's
  Status list, GETTING_STARTED's operator walkthrough, CLAUDE.md's build status, and
  implementation_plan's shipped roadmap; RIG_CHECKLIST gained Admin/Plugins/Presence
  test sections.
- **CLAUDE.md's integration contract described the road not taken** (env-seed +
  admin-REST reconcile; "documents never leave the device"; snapshot/env lists at
  half their real size; `server/README`; electron-builder ^25/Node 22) — rewritten
  to the shipped env-authoritative strategy, the real net/privacy boundary (farm OCR
  receives upload bytes for extraction only), the full env surface, and current pins.
- **sidecar/README + RIG_CHECKLIST described the abandoned extraResources bundling**
  — now: CI publishes owui-sidecar tarball assets, the app downloads to
  userData/sidecar on first run; mac builds are arm64-only.
- **Stale versions everywhere**: v0.1.16/v0.1.8 → v0.1.25; OWUI 0.10.1 → 0.10.2
  (INTEGRATION_BRIEF, a dated snapshot, got superseded-notes instead of rewrites —
  incl. the --publish-always CI recipe that release.yml deliberately abandoned).
- Two stale **code comments** fixed along the way: install.js's "OCR off by default"
  and release.yml's "--publish always" header.

## 2026-07-05 f — Admin panel: Clients section moved below Models/Plugins, collapsible

Owner feedback: the Clients list is monitoring, not control — it now sits LAST
(Farm → Models → Plugins → Clients) and is a `<details>` collapsible, default
collapsed, with the count still visible in the summary ("Clients (3)"). The 5s
poll rebuilds the DOM, so the open/closed state lives in a JS variable +
localStorage (`lolClientsOpen`) and is re-applied on every render — a naive
`<details>` would snap shut at each refresh.

## 2026-07-05 e — Admin panel: default model + live context window; OCR on by default

Rig-feedback round 3, all farm-side (`git pull` only, no client release):

- **Context window is now a real server-side setting.** `ollama.contextLength`
  additionally rides the generated LiteLLM routing as a per-deployment `num_ctx`
  ([litellm.js](../farm/src/litellm.js)) — **empirically verified** against the
  pinned LiteLLM (`get_optional_params(..., num_ctx=16384, drop_params=True)`
  keeps it; the ollama_chat transform puts optional_params into `options`). That
  makes it apply on EVERY host (the `OLLAMA_CONTEXT_LENGTH` env only reaches
  Ollamas the CLI starts, and stays as the belt for direct-Ollama callers), and
  makes it live-changeable: the admin panel's Farm card gets a **Context window**
  preset selector (4k–64k) → `POST /lol/admin/context {tokens}` →
  `control.setContextLength` (validated 2048–262144, serialized, restartProxy
  with rollback, re-warms the default model at the new size — Ollama reloads a
  model when num_ctx changes, and `warmModel` now passes `options.num_ctx` so
  the warm instance matches what LiteLLM will request).
- **Default model from the panel.** "Make default" on any served model →
  `POST /lol/admin/model/default {id}` → `control.setDefaultModel`: flips the
  `default` flag immutably; bounces the proxy ONLY in global-alias mode (the
  alias binds to the default's underlying — otherwise the routing is unchanged
  and only the beacon kicks). Clients pick it up via `models[].default` →
  `DEFAULT_MODELS` (OWUI restarts, auto-selects the new default).
- **OCR is ON by default** (owner call after rig testing — document upload is a
  core workshop flow): `OcrSchema.enabled` true, example config + READMEs +
  tests updated. First `lol up` installs the torch-free venv; opt out per box
  with `ocr.enabled:false` / `--no-ocr`. TTS was already off by default (the
  test box has it enabled in its own lol.config.json — config, not code).
- Panel changes remain ephemeral (restart reverts to lol.config.json) — persist
  real decisions there. Tests: 54 (litellm num_ctx injection, both new routes'
  auth + dispatch, registry/config default flips).

## 2026-07-05 d — Whole-document answers: RAG full-context + Ollama context window

The definitive OCR-"missing content" diagnosis, from a real rig transcript: a
6-page Amazon invoice, "list ALL items purchased" → the answer listed 4 of ~9
products yet quoted content from pages 1, 2, 5 AND 6. Extraction was therefore
complete (all pages indexed) — **retrieval** was the bottleneck: OWUI sends only
the RAG_TOP_K (default **3**) best-matching chunks to the model, and a
whole-document ask deterministically misses whatever chunks don't match the
query. No extraction improvement can ever fix that class of question.

- **Client ([configBridge.ts](../shell/src/main/configBridge.ts)):**
  `RAG_FULL_CONTEXT=true` — verified in the pinned 0.10.2 source
  (retrieval/utils.py): full_context swaps the top-k query for
  `get_all_items_from_collections`, i.e. the model receives the ENTIRE extracted
  document. Right default for a workshop (small docs, whole-doc questions
  dominate). Known trade-off: a large attached knowledge collection is injected
  whole too — revisit if workshops grow big knowledge bases.
- **Farm ([config.js](../farm/src/config.js) / [up.js](../farm/src/commands/up.js)):**
  new `ollama.contextLength` (default **16384**) → `OLLAMA_CONTEXT_LENGTH` on
  Ollamas the CLI starts + added to the recommended-env note for external ones.
  Without it, Ollama's 4096-token default **silently truncates** the injected
  document and re-creates the exact same "missed half my PDF" symptom with a
  different cause. Lower it on small-VRAM GPUs (KV cache ∝ context × numParallel).
- Both halves are needed together: full context without the window = truncation;
  the window without full context = top-3 chunks.

## 2026-07-05 c — Blender opt-in + [Page N] markers (rig feedback round 2)

- **Blender assistant tools are now OPT-IN** (owner call): `blenderMcp` defaults to
  `false` ([store.ts](../shell/src/main/store.ts)). One-time migration in
  [index.ts](../shell/src/main/index.ts): an install carrying the old on-by-default
  WITHOUT an explicit user choice (`blenderMcpUserSet=false`) adopts the new
  default; an explicit toggle is kept either way. A farm *recommendation* can still
  enable it for non-explicit users (that path is unchanged — it's now the way an
  operator turns Blender on fleet-wide). No stale OWUI tool-server risk: the
  tool_servers list is PersistentConfig and we run ENABLE_PERSISTENT_CONFIG=false,
  so it resets every OWUI boot and only re-seeds while mcpo is actually up.
- **TTS**: nothing to change in code — farm Kokoro (`tts.enabled`) has always
  defaulted to false; the test box simply has it enabled in its lol.config.json.
  With no farm TTS, OWUI's read-aloud button remains with the browser/OS voice:
  AUDIO_TTS_ENGINE has no "off" value in 0.10.2 (checked config.py + routers/audio.py
  — '' selects the client-side Web Speech engine) and the button is OWUI frontend
  behavior we don't modify (invariant #1).
- **OCR multi-page**: extraction loops every page (proven locally), but pages
  carried no visible/matchable label — one text blob in OWUI's preview, and
  "what's on page 5?" had nothing for RAG to retrieve. Multi-page PDFs now prefix
  each page with **`[Page N]`** ([server.py](../farm/src/pysvc/server.py)); the
  `[extract]` log line's "N page(s)" count is the ground truth when a document
  still looks under-analysed (if the count is right and answers still miss
  content, that's RAG top-k retrieval, not extraction).

## 2026-07-05 b — OCR: hybrid PDF extraction + per-document logging (rig feedback)

First rig test surfaced two OCR problems: "I can't tell if I'm using the farm OCR
or OWUI's built-in one", and "it clearly missed a lot of elements in my pdf".

- **Root cause of the missing content:** `auto` routed any page with a text layer
  to text-layer-only extraction (`use_vision = not text`) — so a design-style PDF
  (text + big images/figures) kept its paragraphs but silently dropped everything
  drawn inside the images. Only fully image-only pages ever reached the vision model.
- **Fix — hybrid `auto` ([server.py](../farm/src/pysvc/server.py) `_extract_pdf`):**
  per page, `auto` now routes three ways: `< 32` text-layer chars → **vision**
  (scanned); a real text layer with **raster images covering ≥ 20 %** of the page
  (`page.get_image_info()` bbox areas) → **hybrid** — the text layer PLUS a vision
  pass appended under a `[Page image content]` marker (`engine: "text+vision"`);
  else **text** (born-digital stays fast, no vision calls). A hybrid vision failure
  degrades to the text layer with a log line (a pure-vision page failing still 502s —
  no silent empty pages). Caveat: vector-drawn charts aren't raster images and aren't
  detected — `"pdfEngine": "vision"` covers those. Safe on the OWUI side: its
  ExternalDocumentLoader `requests.put` has **no timeout** (verified in the pinned
  0.10.2 source), so slow multi-page hybrid docs can't get cut off mid-extraction.
- **Fix — visibility:** every processed document now logs ONE summary line on the
  farm console: `[extract] deck.pdf: 12 page(s) → 4 text + 8 text+vision · 9k chars
  · 41.3s` — the operator's proof that OWUI is routed to the farm at all, and the
  first thing to read when an extraction looks incomplete (shows per-page routing).
- **Verified** against the real service in the local `.extract` venv (Ollama call
  mocked): a synthetic 3-page PDF (pure text / text+large image / image-only) routes
  `text / text+vision / vision`; the hybrid page carries BOTH the text layer and the
  vision output; vision failure degrades hybrid but 502s pure-vision.
- Farm-side only — clients need nothing (`git pull` + restart `lol up` on the box).

## 2026-07-05 — Admin panel: connected-clients presence (count, idle time, versions)

The panel now answers "who's actually using this farm right now?". The farm's Node
process never sees chat traffic (LiteLLM proxies it), so presence comes from the
clients: a **heartbeat**, mirroring ComfyQ's `usersConnected`/`idleSec` usage block.

- **Client → farm heartbeat.** Every 10 s the shell fire-and-forget POSTs
  `/lol/client-ping` on its ACTIVE farm's `httpPort` with `{ id, name, platform,
  version, idleSec }` ([index.ts](../shell/src/main/index.ts) `startClientHeartbeat`):
  `id` is a stable per-install UUID persisted in settings (`clientId`); `idleSec` is
  Electron `powerMonitor.getSystemIdleTime()` — machine-wide input idle, i.e. "is a
  human at that seat", not just "is the app open". 3 s abort timeout, `unref`'d timer,
  never throws; farms without `httpPort` are skipped, an old farm 404s harmlessly.
- **Farm side.** `POST /lol/client-ping` is an **open** route ([selfServer.js](../farm/src/selfServer.js))
  like `/lol/self` — clients don't hold the admin token; the handler
  ([up.js](../farm/src/commands/up.js) `onClientPing`) length-caps every field,
  bounds the map at 200 entries, and normalizes the `::ffff:` IPv4-mapped remote IP.
  Entries are **TTL-filtered at read time** (fresh = seen ≤ 30 s ago, no sweeper);
  a closed client vanishes within ~30 s. `getAdminState` returns the full list
  (sorted most-active first); `liveHealth.clientsConnected` (updated per ping + each
  health tick so it decays) rides the snapshot as **`usage.clients`**.
- **UI.** The admin page gets a **Clients (N)** card — hostname, IP · platform ·
  version, and an "active now" (input < 60 s ago) vs "idle 12m" badge; the fleet
  popover's live line adds "N clients". Old-farm/old-client combos degrade to
  null/absent everywhere.
- **Tests** (54): the ping route is open + forwards body/remote-IP + 400s malformed
  JSON without reaching the handler; `usage.clients` mirrors `clientsConnected` and
  is null on the old-farm shape.

## 2026-07-04 — Farm admin, Phase 4: the client honors the farm's plugin world

Closes the plan — the desktop client now consumes what the farm advertises, and the
Blender *recommend* toggle (inert since P3) does something.

- **Farm advertises its admin port.** `snapshot.js` adds `httpPort` (`config.beacon.httpPort`),
  so a client can build the admin URL `http://<host>:<httpPort>/lol/admin` (the snapshot only had
  `proxyPort` before).
- **"Manage this farm" button.** [app.js](../shell/renderer/app.js) `renderPopover` gives each
  discovered farm (that advertises `httpPort`) a button that `openExternal`s its admin page — the
  desktop app gets an admin entry with **zero UI rebuild** (it just opens the farm-served page). The
  button `stopPropagation`s so it doesn't also trigger the row's select-farm.
- **Unified plugin surfacing.** Each farm row now shows its **on** plugins (search / voice / OCR, from
  `snapshot.plugins`) and its **recommendations** (`recommendedClientPlugins`, e.g. "recommends: Blender
  tools"). Farm plugins + the client's own Blender toggle (in Preferences, `[this PC]`) are the two
  halves of the unified model.
- **Client auto-applies recommendations.** New `applyFarmRecommendations(farm)` in
  [index.ts](../shell/src/main/index.ts) (called from `onFarms`, independent of the endpoint
  change-check): if the active farm recommends `blender` **and** the user hasn't made an explicit choice
  (`blenderMcpUserSet`) **and** mcpo isn't already on → enable it. It only ever turns a client plugin ON
  and never auto-disables (the user may rely on it); `set-blender-enabled` now records
  `blenderMcpUserSet:true` so a manual choice always wins. New `ShellSettings.blenderMcpUserSet`
  ([store.ts](../shell/src/main/store.ts), default false). Since Blender is on-by-default, this is a
  no-op today in practice — it's the correct, future-proof mechanism (and the surfacing is the visible
  win). `FarmSnapshot` gained `httpPort`/`plugins`/`recommendedClientPlugins` ([types.ts](../shell/src/main/types.ts)).

**Verified:** 52 farm tests pass (snapshot now asserts `httpPort`); `tsc --noEmit` clean; renderer
`node --check` clean. **Whole 4-phase plan now built** (admin control API + live model start/stop; farm-
plugin registry + live plugin toggles; the admin page; client integration). **Pending rig test** of P4
(open a client → fleet popover shows the farm's plugins + "Manage this farm"; recommend Blender in the
admin page → confirm a client with no explicit Blender choice honors it). Needs the farm on the new code
(`git pull` + `lol up`) so it advertises `httpPort`/`plugins`/`recommendedClientPlugins`, and a client
rebuild. Not released.

## 2026-07-04 — Farm admin, Phase 2+3: a farm-plugin registry + live plugin toggles in the page

Turned the three copy-pasted farm-service boot blocks (SearXNG / Kokoro / lol-extract) into a **plugin registry**
and wired the admin panel to **toggle plugins on/off live**, reflected on clients.

**Registry ([farm/src/plugins/registry.js](../farm/src/plugins/registry.js)).** A `FarmService` descriptor per
service that **delegates to the unchanged `searxng.js`/`kokoro.js`/`extract.js`** — the install/spawn/health
internals (rig-verified) are untouched; only the *orchestration* is unified. Each instance owns its child +
up-state + per-run ctx (the OCR bearer key). `start()` returns a `{ok, level, message}` the caller logs, so the
exact per-service wording is preserved. One `child.on('exit')` does double duty: flags a startup death, and
(once up) fires `onDown` (advertise-off). [up.js](../farm/src/commands/up.js) now iterates the registry for
boot, the health-timer re-probe, teardown (both shutdown paths), and the runtime pid record — the ~12
per-service touch-points collapsed to one descriptor. Snapshot back-compat is exact: the bespoke
`searxngUrl`/`ttsUrl`/`extract` fields still come from the same named `liveHealth` flags (set from
`svcById.<id>.up`), so [snapshot.js](../farm/src/snapshot.js) is unchanged there; it just **adds** a generic
`plugins: {id:{label,runsOn,enabled,healthy}}` map + `recommendedClientPlugins`.

**Live toggles.** `control.setPlugin(id, on)` spawns/kills a service child at runtime (`bringUp`/`bringDown`,
sharing the boot wiring), flips `config.<id>.enabled` (ephemeral, like model changes), and kicks the beacon so
clients pick up the change — a **new OCR toggle mints a fresh bearer key** so clients repoint. `setPlugin` is
serialized on the same `mutating` chain as `startModel`/`stopModel` (no racing a proxy restart).
`control.recommendClientPlugin('blender', on)` sets `config.recommendedClientPlugins` — the farm can't run a
per-client plugin, only advertise it. New routes in [selfServer.js](../farm/src/selfServer.js):
`POST /lol/admin/plugin/<id>/{enable,disable}` + `POST /lol/admin/plugin/recommend` (token-gated).

**Admin page ([farm/src/admin/index.html](../farm/src/admin/index.html)).** A **Plugins** card: each farm
plugin (Web search / Voice / OCR) has an Enable/Disable button + live status; Blender shows a **Recommend to
fleet** toggle labeled `[client]` (it runs on each user's machine — the farm only recommends it). One mental
model, honest about who executes what.

**Verified:** 52 farm tests pass — adds registry ids/gating, a `FarmService` lifecycle test (start→up, probe
reflects alive, child-exit fires onDown), `recommendedClientPlugins` default + snapshot advertisement, and the
plugin-toggle/recommend routes reaching a mock control (token-gated). `node --check` on every touched module +
the admin page's inline script. An **adversarial review** of the boot refactor caught 3 real defects (all
fixed): (1) a **self-heal regression** — the health timer guarded on `svc.pid`, which is null after a child
dies, so a plugin that crashed in the boot window (between the sync liveHealth capture and `onDown` being
wired, across the `detectHardware`/`gpuLiveStats` awaits) would be advertised dead forever; now guards on
`svc.wasUp` so `probe()` re-flips it (the old code self-healed because its guard was a never-nulled child ref);
(2) `setPlugin` turning a plugin ON that came up **alive-but-unhealthy** (SearXNG JSON off / Kokoro synth fail)
left the child orphaned → now tears it down + rolls back; (3) OCR `makeCtx` built the Ollama URL from raw
`config.ollama.hosts` instead of the normalized/reachable list. The exit-listener double-duty, TDZ/ordering,
`setPlugin` serialization, and snapshot parity were reviewed and **confirmed correct**. **Deferred to Phase
4 (client):** the desktop app auto-applying a farm's Blender *recommendation*, a unified plugins view, and a
"Manage this farm" button opening the admin page — so today the farm plugin toggles (search/voice/OCR) work
end-to-end, but the Blender *recommend* toggle is inert until P4 lands. Not released.

## 2026-07-04 — Startup-log noise triage (surfaced during admin-panel rig testing)

Rig test of the admin panel confirmed **everything works** (LiteLLM serving, SearXNG JSON 200, Kokoro healthy,
admin start/stop of `qwen3.6:35b` verified live) — but `lol up` prints a wall of `[litellm]`/`[searxng]`/
`[kokoro]` child-process log lines, one an alarming full traceback. Triaged all of it; **zero critical** — every
service is healthy. Fixed the two that were genuinely worth it:
- **SearXNG `ModuleNotFoundError: tzdata` traceback.** Windows Python's `zoneinfo` ships no IANA tz DB, so the
  `bilibili` engine's `ZoneInfo("Asia/Shanghai")` throws + dumps a full traceback at boot. New `ensureTzdata()`
  in [searxng.js](../farm/src/searxng.js) pip-installs `tzdata` (marker-guarded `.tzdata-ok`, so it applies once
  to an already-installed `.searxng/` without a full reinstall). Same class of Windows gotcha as the existing
  `import pwd` shim.
- **Kokoro logging at DEBUG** (per-request path scans + audio-chunk shapes = most of the volume). Set
  `API_LOG_LEVEL=WARNING` in `spawnKokoro` env ([kokoro.js](../farm/src/kokoro.js)) — confirmed the env name
  against the vendored `main.py:26` (`os.getenv("API_LOG_LEVEL", "DEBUG")`). Applies on the next `lol up`.
- **SearXNG onion engines** (`ahmia`, `torch`) error at boot because they need a Tor proxy we don't run —
  disabled them in the generated `settings.yml` ([buildSettingsYaml](../farm/src/searxng.js)); takes effect on a
  settings regen (`del farm\.searxng\settings.yml`).
**Assessed as benign, left alone:** LiteLLM cost-map warning (no $ tracking on a LAN) + its banner/access logs;
Kokoro's pydub-ffmpeg + torch deprecation warnings (synthesis works); SearXNG `limiter.toml missing` +
per-request `X-Forwarded-For` (limiter is off — trusted LAN). 49 farm tests pass (adds an onion-engines-disabled
assertion to the settings test).

## 2026-07-04 — Farm admin panel, Phase 1: live model start/stop over a token-gated control API

First slice of a planned farm **admin panel** (start/stop models + toggle plugins, reflected on clients). Today
the farm is read-only — `GET /lol/self` + a one-way UDP beacon — so this is a **net-new authenticated control
API living inside the long-lived `lol up` process** (the only holder of live state). Delivered: **start/stop a
served model from a farm-served web page, reflected on every connected client within ~5s.**

**Decision that shaped it — LiteLLM has no live model API here.** Verified against the installed **litellm
1.90.0**: `POST /model/new` does `if prisma_client is None: raise HTTPException(500, "No DB Connected")`
([model_management_endpoints.py:1344](../farm/.venv/Lib/site-packages/litellm/proxy/management_endpoints/model_management_endpoints.py)) — the runtime add/delete-model routes **require a Postgres/Prisma DB**, which the config-only workshop farm
deliberately doesn't run. So changing the served set = **regenerate `config.generated.yaml` + bounce the
LiteLLM child in place** (`restartProxy`). Brief blip (in-flight requests drop for the few seconds it restarts)
— acceptable for an infrequent admin action; documented.

**Farm side.** New `AdminSchema` (`admin.token`, [config.js](../farm/src/config.js)) — null → `lol up`
generates an ephemeral token per run and prints it in the banner. [selfServer.js](../farm/src/selfServer.js)
grew from "only `GET /lol/self`" into a small router: `GET /lol/admin` serves a **self-contained static admin
page** ([farm/src/admin/index.html](../farm/src/admin/index.html), zinc-themed, no bundler); `GET
/lol/admin/state` + the `POST /lol/admin/model/{start,stop}` routes require `Authorization: Bearer <token>`
(constant-time compare, length-checked); `GET /lol/self` stays open. [up.js](../farm/src/commands/up.js) builds
a `control` closure (`getAdminState`/`startModel`/`stopModel`) bound to the live `config`/`liveHealth`/`child`/
`beacon` and hands it to selfServer. **The restart is crash-safe:** `child` became a `let`, the proxy-exit
handler is a named `onProxyExit(c, code)` guarded by `restartingProxy` (deliberate bounce) + identity (`c !==
child`, a superseded old child) so a control-triggered restart never triggers the farm-teardown path;
`writeRuntimeState()` re-records the NEW pid so `lol down` from another shell still targets the live proxy.
"Start" = add to the in-memory catalog + `warmModel` (Ollama `/api/generate keep_alive:-1`); "stop" = remove +
`evictModel` (`keep_alive:0`) — new helpers in [ollama.js](../farm/src/ollama.js). Guards: can't stop the last
model; stopping the default promotes a new one; start validates the model is installed on a reachable host.
Catalog changes are **ephemeral** (in-memory, matching the `lol up` picker which deliberately never persists).
Every change ends with `beacon.kick()` → the snapshot already advertises `servedEntries(config)`, so clients
repoint and OWUI's `/v1/models` reflects it with zero client code.

**Verified:** 49 farm tests pass (adds: admin token default + strict-reject; an **integration test** that spins
up selfServer with a mock control and asserts `/lol/self` is open, the admin page serves, and every
`/lol/admin/*` route is 401 without/with a wrong token and only reaches `control` with the right one);
`node --check` on all touched modules. An **adversarial review** of the restart state-machine caught 5 real
bugs (all fixed): a failed restart could leave a **zombie proxy** + stale pid → now `applyModels` rolls back
to the last-good set and `restartProxy` kills a proxy that never came up; the child-**identity guard was dead
code** (a bare `onProxyExit(child,…)` reads the `let` at call time) → now `bindProxyExit(c)` captures the
instance; a **SIGINT mid-restart** could orphan a fresh proxy → `restartProxy` checks `stopping` before spawn +
after health-wait; the runtime **pid was recorded too late** for a concurrent `lol down` → now written
immediately after spawn; and **concurrent admin calls** could race the shared `restartingProxy` and tear the
farm down → start/stop are **serialized** on one in-flight chain. Auth + the empty-`control` startup window
were reviewed and confirmed safe. **Pending rig test** (`lol up` → open `http://<box>:41997/lol/admin`,
enter the token → Start a model → it appears in a client's OWUI picker + `ollama ps` shows it warmed → Stop →
gone + evicted, without tearing the farm down). **Next phases (planned, not built):** P2 farm-plugin registry +
live plugin toggles; P3 the full page (plugin toggles + fleet); P4 client honors farm plugin *recommendations*
(e.g. Blender) + a unified plugins view. Not released.

## 2026-07-04 — Document OCR: one shared farm-side extraction service (Ollama-OCR + optional Docling)

Added **OCR / document extraction** as a shared farm service, discovered + wired exactly like SearXNG and
Kokoro (beacon → client env, zero client setup). **Why this shape:** an adversarial source-check against
**OWUI v0.10.2** proved the tempting "Ollama-OCR as a tool the model calls" design is **impossible** — external
OpenAPI tool servers receive **only the model's JSON args**, never the uploaded file bytes
(`utils/tools.py` `execute_tool_server` sends `params=kwargs`, `extra_params={}`; only *native* tools get
`__files__` via `middleware.py:2680`). The **only** OWUI surface that receives an uploaded file is the
**content-extraction engine**, and there's exactly **one** slot. So both goals the owner asked for
("searchable scanned docs" **and** "vision-model OCR transcripts") funnel through **one** farm service that
OWUI sees as `CONTENT_EXTRACTION_ENGINE=external` and which **routes internally**.

**Farm side** — new `farm/src/extract.js` (clone of `searxng.js`: own venv under `.extract/`, `ensureExtract`
/`spawnExtract`/`waitForExtract`/`extractAlive`) runs `farm/src/pysvc/server.py`, a small **FastAPI**
implementing OWUI's **verified** External Document Loader contract: `PUT /process` with the **raw file bytes**
as the body, `Authorization: Bearer <key>`, `X-Filename`, → returns a JSON **list** of
`{page_content, metadata:{page}}`. Router: **images + scanned/image-only PDF pages → Ollama-OCR** (a vision
model on the farm's **local** Ollama `/api/generate`); **born-digital PDFs / docx / text/html → fast local
extraction** (PyMuPDF/python-docx); **office formats via Docling** when `ocr.docling:true`. Ollama-OCR's
`OCRProcessor` is **vendored** into `farm/src/pysvc/ocr_processor.py` (MIT, see `LICENSE-ollama-ocr`; debug
prints stripped) rather than `pip install ollama-ocr` — that package pulls `python-magic` (native libmagic; a
Windows landmine) + streamlit + transformers, none of which the core path needs. Default install is
**torch-free** (fastapi/uvicorn/requests/pymupdf/opencv-headless/numpy/python-docx/tqdm) and **reuses the
farm's already-loaded vision model** (no new 8 GB pull) — the OCR model defaults to the served default vision
model's real Ollama tag via `resolveOcrModel` (config `ocr.model` overrides). Docling is the heavy opt-in
(torch + models). Lifecycle mirrors SearXNG/Kokoro exactly: `OcrSchema` in `config.js` (**off by default** — it
reroutes all of OWUI's document ingestion through the farm), `--ocr/--no-ocr` run-flags, per-run bearer key
(`crypto.randomBytes`) advertised in the snapshot only when `enabled && extractUp && extractKey`, `extractPid`
recorded + tree-killed in both `up.js` shutdown paths and `down.js`, health-timer re-probe + advertise-off on
exit, `depsSignature` install marker (a docling toggle forces reinstall), and `lol install` pre-installs only
when enabled.

**Client side is pure env** (no renderer seeding, unlike Blender): `extract:{url,key}` threaded through
`types.ts` → `index.ts` (`farmExtract`, `onFarms`/`select-farm`/`set-data-dir`/`restart`/boot) → `sidecar.ts`
(start/repoint change-check/setDataDir/crash-restart) → `configBridge.ts`, which sets
`CONTENT_EXTRACTION_ENGINE=external` + `EXTERNAL_DOCUMENT_LOADER_URL` (loader **base**; OWUI appends `/process`)
+ `EXTERNAL_DOCUMENT_LOADER_API_KEY`. Absent farm OCR → nothing set → OWUI's built-in default extractor,
byte-for-byte as before. The raw file transits to the trusted-LAN farm for extraction (that's where the GPU is,
same boundary as SearXNG receiving queries); embedding still happens locally (`RAG_EMBEDDING_ENGINE` stays
unset).

**Trade-off (documented):** with `external` engine on, ALL uploads route through our service; the light path
covers images/PDF/docx/pptx/xlsx/text/html, and only legacy binary Office (`.doc`/`.ppt`/`.xls`) +
`.odt`/`.epub`/`.rtf` `415` unless `ocr.docling` is on. **Two robustness fixes from an adversarial review**
(4 dimensions × verify): (1) the vendored Ollama-OCR `requests.post` had **no timeout** — a stalled Ollama
would hold a Starlette threadpool worker forever and, at enough concurrency, stall all `/process` uploads;
added `request_timeout=(10, 600)` (env `OCR_HTTP_TIMEOUT`) so a hang surfaces as a 502 and frees the worker.
(2) office formats OWUI extracted natively would `415` under the external engine — added light `python-pptx`
/`openpyxl` extractors so `.pptx`/`.xlsx` keep working without Docling. **Verified:** farm tests **46 pass**
(config defaults, strict-enum reject, snapshot advertise/omit, `resolveOcrModel`, depsSignature); `tsc
--noEmit` clean; `py_compile` clean; all edited modules load. **Pending live rig test** (`lol up --ocr` →
`/health` 200 → hand-crafted `PUT /process` with a JPG/scanned-PDF/docx → OWUI upload E2E). Not yet released.

## 2026-07-03 — MCP marked experimental · model-per-box in the fleet view · OWUI clipboard fix

Three small UX items:
- **OWUI copy buttons now reach the system clipboard.** In the Electron webview,
  `navigator.clipboard.writeText` requests the `clipboard-sanitized-write` permission,
  which our `persist:owui` handlers were denying (they only allowed media/mic — so
  copy silently failed). Added `clipboard-read` + `clipboard-sanitized-write` to
  `OWUI_ALLOWED_PERMS` ([index.ts](../shell/src/main/index.ts); both the request and
  check handlers already share the set, which Electron requires for clipboard).
- **Fleet view shows the real model per box.** The snapshot's `models` advertised only
  the SERVED name — the alias (e.g. "assistant"), identical on every box. Added
  `underlying` (the real Ollama model behind the alias, from `servedEntries`) to each
  `models` entry ([snapshot.js](../farm/src/snapshot.js)); the connection popover now
  renders "assistant (qwen3.6:30b) ★" ([app.js](../shell/renderer/app.js)). Backward
  compatible (falls back to the served id if `underlying` is absent). Needs the farm
  updated (git pull + `lol up`) to populate it.
- **Blender assistant tools labelled "experimental"** in Settings (badge + hint) — its
  reliability depends on the model and the user's Blender setup.

Client ships **v0.1.21**; the model-per-box display lights up once the farm is on the
new snapshot (git pull). farm tests 41 pass; tsc clean.

## 2026-07-03 — Blender tools: the ACTUAL fix — select the tool server (ui.tools), not just register it

An adversarial multi-agent audit of v0.1.19 against OWUI v0.10.2 source (5 agents, one per claim) caught a
**blocking bug before the rig test**: writing `settings.toolServers` makes a tool server **available** but
never **selected**, and OWUI only sends **selected** direct servers to the model. Cited: `Chat.svelte:157` +
`447-453` (a new chat's `selectedToolIds` seeds from `$settings.tools` == `ui.tools`, **never** from
`ui.toolServers`), `Chat.svelte:2521-2569` (the request's `tool_servers` is filtered to selected ids),
`middleware.py:2715` (backend registers only servers present in the payload). So the completion's
`tool_servers` was empty → the model got zero Blender tools → *"which 3D software are you using?"*.

**Fix:** the seed now also writes the **selection** — appends `'direct_server:<idx>'` to `ui.tools` (idx =
position among `config.enable` tool servers), which OWUI uses to seed each new chat. `unseed` prunes it
(shifting higher indices down). **Dropped** the `function_calling='native'` write — the audit proved native
is OWUI's **default** (the mode gate is `!= 'legacy'`), so it was a no-op; and if native tool-calls prove
unreliable for qwen3 via LiteLLM→Ollama, the fallback is **`legacy`** (prompt injection), *not* native.

Audit **CONFIRMED** (no change): the connection shape (gate is `config.enable`; no top-level `type`;
leading-slash `path`), and that `ui.{toolServers,tools,params}` persist (WEBUI_AUTH=false → admin bypasses
the `settings.interface` / `features.direct_tool_servers` gates that would otherwise strip `toolServers`). It
also flagged that **Test connection verifies availability plumbing only** — it can't see selection, call-time
bearer auth (`/openapi.json` is public, so the key isn't checked at test time), or the function_calling mode.
Ships as v0.1.20.

## 2026-07-03 — Blender tools: register as a USER tool server (auto-attach) + Test button

Rig report: tools "installed" but the model had **none** — it replied "which 3D software are you using?".
Root cause, confirmed from OWUI docs + [issue #18074](https://github.com/open-webui/open-webui/issues/18074):
I registered the server via the **global/admin** config (`POST /api/v1/configs/tool_servers`). **Global tool
servers are hidden behind the chat "+" menu and must be toggled on per-chat** — they don't auto-attach.
**User** tool servers (`settings.toolServers`) attach to every chat automatically. I seeded it in the wrong
place.

**Fix:** seed the connection into the user's `settings.toolServers` instead — via
`/api/v1/users/user/settings/update` (the same authed-webview path as `seedWebSearchDefault`), shape per the
v0.10.2 frontend (`{ url, auth_type:'bearer', key, path:'/openapi.json', config:{enable:true},
info:{id:'lol-blender'} }`). Also default the model's **Function Calling to `native`**
(`ui.params.function_calling`, only if unset) — needed for a model to actually emit tool calls for external
tools. Applied once per session; the old global registration self-clears (env-authoritative → not reloaded).

**Also — the requested "Test connection" button** (Settings ▸ Assistant tools). It probes **both hops**:
GET the local mcpo `/openapi.json` (helper up + tool count) and a **TCP connect to 127.0.0.1:BLENDER_PORT**
(is the add-on actually listening?), so a failure reads as "helper ✗" vs "Blender ✗ on port N" at a glance.
New `test-blender-connection` IPC + `tcpProbe()` util. Verified headless: `tcpProbe` returns true on a
listening port, false on a closed one; tsc clean; `node --check app.js`. Ships as v0.1.19.

## 2026-07-03 — Blender tools: make the add-on socket port (BLENDER_PORT) configurable

Rig feedback: the tools were now visible (checkbox present, add-on installed) but still **"could not
connect" to Blender**. Root cause is the *second* port in the chain. There are two: (1) **mcpo's OpenAPI
port** (OWUI ↔ proxy — auto-assigned, internal, never touched); (2) **BLENDER_PORT** — blender-mcp ↔ the
BlenderMCP add-on socket, default **9876**, and exactly the number the add-on panel shows. I'd hardcoded
(2), so if the add-on runs on any other port, blender-mcp (stuck on 9876) never reaches it.

**Fix:** a **Blender port** setting (Settings ▸ Assistant tools; `shell-settings.blenderPort`, default
9876). `mcpoSupervisor` now spawns blender-mcp with `BLENDER_HOST=127.0.0.1` + `BLENDER_PORT=<setting>`;
`setBlenderPort()` restarts mcpo when it changes (env is fixed at spawn), and the renderer re-registers the
tool server if the proxy port shifted on restart (`blenderSeeded` resets on any non-ready transition). New
`set-blender-port` IPC + preload; `get-blender-state`/`get-prefs` carry the port; a number input in the
settings panel.

**Verified end-to-end (not on faith):** drove the real mcpo+blender-mcp with `BLENDER_PORT=9999` against a
dummy TCP listener — blender-mcp logged `Connected to Blender at 127.0.0.1:9999` (not 9876), and the dummy
saw the connection, proving the env threads supervisor → mcpo → the blender-mcp subprocess (mcpo does pass
its env down). Also confirms blender-mcp connects at **startup**, so once the add-on is running on the
matching port it links immediately. tsc clean; `node --check app.js`. Ships as v0.1.18.

## 2026-07-03 — Blender tools: fix the OWUI wiring + make it default-on

Field report from the rig: the Blender tools **didn't show up in OWUI**, and the Settings toggle was
friction the owner didn't want — it should be **on by default**, with OWUI configured automatically so the
user only starts Blender. Both were real; the first was my mistake.

**Root cause (verified against OWUI's own source, not guessed).** I wired the tool server via the
`TOOL_SERVER_CONNECTIONS` **env var**. That's a *PersistentConfig*, and OWUI does **not** reliably surface
env-configured tool servers — an OWUI maintainer says so outright in
[issue #18140](https://github.com/open-webui/open-webui/issues/18140) ("editing directly is not a supported
method"). So the connection never became usable tools. The **supported** path is the one the admin UI's
*verify & save* uses: `POST /api/v1/configs/tool_servers` with `{ TOOL_SERVER_CONNECTIONS: [...] }`
(confirmed by reading the v0.10.2 SPA's own `setToolServerConnections` in `src/lib/apis/configs`).

**Fix.** Register the tool server through that API from the **authed webview**, mirroring the existing
`seedWebSearchDefault()` (reads `localStorage.token`, POSTs with `Authorization: Bearer`). New
`seedBlenderToolServer()` / `unseedBlenderToolServer()` / `maybeSeedBlender()` in
[app.js](../shell/renderer/app.js): once per session, keyed by `info.id === 'lol-blender'` (idempotent,
leaves any other tool servers untouched), fired when the webview is authed **and** the local mcpo reports
`ready` (on first launch mcpo installs for ~1 min, so it's usually the mcpo-ready push that seeds), then a
one-shot webview reload surfaces the tools. Removed on disable. **Dropped the env approach entirely** —
`configBridge` no longer emits `TOOL_SERVER_CONNECTIONS`, and the `mcpo` threading through the sidecar
start/repoint was reverted (toggling Blender no longer restarts OWUI — the tool server is added/removed via
the live API). New `get-blender-connection` IPC gives the renderer mcpo's url + bearer key.

**Default-on.** `blenderMcp` now defaults `true` ([store.ts](../shell/src/main/store.ts)); boot brings mcpo
up in the background. The Settings toggle stays as an **off** switch.

**Auth chain verified from source (the thing most likely to 401 silently):** OWUI sends `auth_type:'bearer'`
+ `key`; mcpo's `get_verify_api_key` uses `HTTPBearer` and checks `token == api_key` — so
`Authorization: Bearer <key>` matches. Without `--strict-auth`, tool routes are key-protected (per-route
`Depends`) while `/openapi.json` stays public, so OWUI can fetch the spec unauthenticated and authorize the
calls. **Verified headless:** tsc clean; `node --check app.js`; endpoint + body shape match the v0.10.2 SPA;
mcpo bearer check read from its source. **Rig-check:** the actual OWUI round-trip (tools appear + a cube
lands) — still needs the GUI + Blender, but the wiring is now OWUI's supported path, not the unsupported env.
Ships as v0.1.17.

## 2026-07-03 — Control Blender from the chat (local MCP tools, opt-in)

Let the assistant drive **Blender running on the user's own machine** — create objects, run Python in
Blender, inspect the scene — while keeping the invariants: **OWUI stays unmodified** (pure env wiring) and
**nothing is exposed to the network** (localhost only). The user owns the Blender side (install the
BlenderMCP add-on + Start its server); we make OWUI turnkey — one toggle in Settings.

**How it works.** OWUI added native MCP (streamable-HTTP) support, and it also consumes **OpenAPI tool
servers** via `TOOL_SERVER_CONNECTIONS`. The Blender MCP server (`blender-mcp`) is stdio, so we front it
with OWUI's own **`mcpo`** proxy (stdio→OpenAPI). A new **client-side supervisor**
([shell/src/main/mcpoSupervisor.ts](../shell/src/main/mcpoSupervisor.ts), mirroring the OWUI
SidecarSupervisor) installs both into a **dedicated venv** under `userData/mcp-tools/` (reusing the
sidecar's bundled standalone CPython — it ships pip — so no new runtime; kept out of the OWUI env so it
can't perturb it) **on first activation** (opt-in, like the farm's SearXNG/Kokoro), then runs
`mcpo --host 127.0.0.1 --api-key <random> -- blender-mcp` and health-waits `/openapi.json`.
[configBridge.ts](../shell/src/main/configBridge.ts) injects `TOOL_SERVER_CONNECTIONS` pointing at it
(`ENABLE_PERSISTENT_CONFIG=false` keeps env authoritative every launch); the mcpo connection is threaded
through the sidecar exactly like the farm's SearXNG/TTS (all six start/repoint sites) so a farm change
never drops the tool server. Toggle + status live in **Settings → Assistant tools**
([index.ts](../shell/src/main/index.ts) IPC `get/set-blender-enabled` + a `blender-state` push;
[preload](../shell/src/preload/index.ts); [renderer](../shell/renderer/app.js)); persisted as
`blenderMcp` in shell-settings.

**A live spike before writing a line hardened the design + caught two things a "ship on faith" path would
have missed** (all re-verified against the compiled supervisor end-to-end):
- **mcpo defaults to bind `0.0.0.0`.** Since `execute_blender_code` is arbitrary code execution, we bind
  **`127.0.0.1` + a random `--api-key`** (this machine drives its own Blender; OWUI sends the key via the
  connection). Confirmed: mcpo logs "API Key: Provided", server reachable only on loopback.
- **blender-mcp phones home** — it POSTs telemetry to a Supabase endpoint. Source-verified the opt-out and
  set **`DISABLE_TELEMETRY=true`** in the child env; the run now logs
  `Telemetry disabled via environment variable` and makes no such POST. Honors the privacy invariant.
- **The tool schema serves even with Blender down** (blender-mcp connects per-call, lazily) → the tool
  server registers immediately, so the user can flip the toggle first and Start Blender whenever.

**Verified (headless, on this box):** `tsc` clean; a stubbed-electron unit check that `configBridge` emits
`TOOL_SERVER_CONNECTIONS` **only** when mcpo is present, with the exact OWUI shape; and a full drive of the
**real compiled `McpoSupervisor`** — venv create → pip install mcpo+blender-mcp → spawn (localhost+key+
telemetry-off, all confirmed in the log) → `GET /openapi.json` 200 → `getConnection()` → `stop()` cleans
up. **Rig-checks (need a GUI / Blender):** (1) the Blender tools actually appear + are callable in an OWUI
chat via env-injected `TOOL_SERVER_CONNECTIONS` (watch for OWUI's "verify & save" quirk — should be moot
with persistent-config off); (2) a real round-trip with Blender + the BlenderMCP add-on running; (3)
**tool-calling model** — `gemma4:12b` is weak at tools; serve a tool-capable model (Qwen2.5/3, Llama 3.x)
for usable results. Not released yet — dev-run (`cd shell && npm run dev`) to try it.

## 2026-07-03 — Web search is now ON by default (set up at farm install)

Owner call: a fresh farm should give clients web search with **no config editing** — the same way it already
auto-pulls `gemma4:12b`. Two changes make "on the farm install, download the model **and** activate web search"
literally true:

1. **`websearch.enabled` now defaults to `true`** ([farm/src/config.js](../farm/src/config.js)). The scaffold
   `lol install` writes (from `defaultConfig()`) therefore shows `websearch:{enabled:true,port:8888}` explicitly,
   and any config that omits the block inherits on. Opt out with `"websearch":{"enabled":false}` or
   `lol up --no-websearch`. (TTS stays **off** by default — its torch install is multi-GB and the owner only
   asked for web search on.)
2. **SearXNG is pre-installed at `lol install`**, not lazily on first `lol up`
   ([farm/src/commands/install.js](../farm/src/commands/install.js) → new `ensureWebsearch(config)` step). It's
   the existing idempotent `ensureSearxng()`, gated on the now-default-on flag and **non-fatal** (auxiliary — a
   hiccup just warns and `lol up` retries; chat still serves). So the first `lol up` starts instantly instead of
   stalling on a first-run source-tarball + venv + pip install.

**Verified:** `node farm/test/run.js` green (the `websearch config defaults` test now asserts `enabled===true`;
the snapshot gating test still toggles explicitly, unaffected). Example config + [GETTING_STARTED.md](GETTING_STARTED.md)
+ [farm/README.md](../farm/README.md) updated so the docs no longer read "optionally flip on web search." No client
change — the client already auto-wires web search whenever the farm advertises `searxngUrl`.

## 2026-07-03 — Neural TTS: shared Kokoro on the farm (the "nicer voices" upgrade)

Replaced OWUI's robotic Web-Speech voices with **Kokoro-82M** neural TTS, hosted once on the farm box and
auto-wired into every client — same beacon pattern as SearXNG (STT stays client-local via Whisper; TTS only
re-synthesizes the farm-generated response, so farm-hosting leaks nothing new and gets GPU speed with zero
per-client weight). Off by default (heavy install).

**Design (a Plan agent researched it; the decisive call is GPU-agnostic):** use **Kokoro-FastAPI (PyTorch)**,
NOT the ONNX path — `onnxruntime-gpu` has no Blackwell sm_120 kernels, so it would run the flagship box on CPU,
whereas **`torch==2.8.0+cu128` carries BOTH Ada (sm_89: 4070/4090) AND Blackwell (sm_120) in one wheel** →
"install once, runs on the whole fleet" (and CPU-torch fallback for GPU-less boxes). espeak-ng needs **no
native install**: the `espeakng-loader` pip dep ships the shared library; we point `PHONEMIZER_ESPEAK_LIBRARY`
at it.

**Live-proven on the box, every link:** installed Kokoro-FastAPI v0.5.0 from a source tarball into its own
venv (torch cu128 auto-selected via `nvidia-smi`, model .pth from the stable v0.1.4 asset, 67 voices ship in
the tarball) → `torch.cuda.is_available()` **True on the Blackwell** → the server boots on native Windows and
`POST /v1/audio/speech` returns a **valid 23 KB MP3 on GPU**. Then `lol up` with the new wiring spawns it and
`/lol/self` advertises `ttsUrl=…:8880/v1` + `ttsVoice`/`ttsModel`. Finally, a standalone OWUI given the exact
client env (`AUDIO_TTS_ENGINE=openai` + that base URL) **proxied read-aloud to Kokoro — 28 KB MP3 via OWUI**.
So farm advertises → client sets `AUDIO_TTS_*` → OWUI plays Kokoro audio, confirmed end-to-end.

**Farm** ([farm/src/kokoro.js](../farm/src/kokoro.js), new — mirrors searxng.js with the SearXNG-review
idempotence lessons baked in: `.installed-tag`/`.src-tag` markers, GPU auto-detect + a post-install
`cuda.is_available()` check that falls back to `USE_GPU=false`): `ensureKokoro`/`spawnKokoro`/`waitForKokoro`
(health + a real synthesis probe)/`kokoroAlive`. Wired into [up.js](../farm/src/commands/up.js) as a sibling
child (health-wait, pid in `.lol-runtime.json`, `child.on('exit')` clears `ttsUp` + kicks the beacon, health
timer re-probes, killTree on shutdown + in [down.js](../farm/src/commands/down.js)); config `tts:{enabled,
port:8880, voice:'af_heart', model:'kokoro'}` + `lol up --tts/--no-tts`; snapshot advertises
`ttsUrl`/`ttsVoice`/`ttsModel` gated on `enabled && ttsUp`; `lol fleet` shows it.

**Client** — thread the farm's TTS through the sidecar exactly like `searxngUrl` (a `{url,voice,model}` object
through start/repoint/setDataDir/crash-restart + the repoint change-check + **all six** index.ts call sites —
the two the last review caught for searxng included). [configBridge](../shell/src/main/configBridge.ts) sets
`AUDIO_TTS_ENGINE=openai` + base URL + model + voice when the farm has TTS (overriding the empty client-side
default); no farm TTS → unchanged (Web Speech).

**Tested:** farm suite 41 pass (tts config defaults + snapshot gating); shell `tsc` clean; the full live chain
above. Enabled on the dev box; `farm/.kokoro/` gitignored. Farm-side reaches boxes via `git pull` + the
first-run install; client ships in the next release. GPU-agnostic claim: Blackwell proven live; the same cu128
wheel officially carries Ada sm_89, so 4090/4070 are covered (a real-box smoke is still worth doing).

---

## 2026-07-02 (c) — Web search ON by default

Web search was available but off — students had to find the toggle each chat. Making it default-on is a
per-user setting, not an env: OWUI stores `settings.ui.webSearch = 'always'` (PR #9370; confirmed by grepping
the installed frontend — `webSearch === 'always'` gates each message), and there is deliberately **no env
var** for it (open feature request; a maintainer only offered a `/?web-search=true` URL param).

**Fix** ([shell/renderer/app.js](../shell/renderer/app.js)): the auth-bootstrap already runs JS in the authed
webview to validate the token; it now also **seeds the web-search default** from inside OWUI via its own API —
`GET /api/config`, and if `features.enable_web_search` is true (which the client sets from the beacon's
`searxngUrl`), `POST /api/v1/users/user/settings/update` with `{ ui: { …, webSearch: 'always',
lolWebSearchSeeded: true } }`. Three properties: (1) **gated** on the farm actually hosting search, so we
never force it on with no engine; (2) **one-time** via the `lolWebSearchSeeded` marker (`UserSettings.ui` is
an `extra='allow'` dict, so the marker persists) — after the first seed we never touch it again, so a user
who turns it off stays off; (3) if just set, one webview reload so the SPA's already-loaded `$settings` picks
it up.

**Verified end-to-end (not on faith):** ran the real client against the live farm, then read OWUI's SQLite
directly — `user.settings.ui.webSearch = "always"` and `lolWebSearchSeeded = true`. That the seed fired at all
proves `config.features.enable_web_search` was true (the exact flag name) and the settings API round-tripped.
Renderer-only; ships in v0.1.14.

---

## 2026-07-02 (b) — Adversarial review of the web-search batch → 5 fixes

Ran a multi-agent adversarial review over the whole batch diff (4 review dimensions → each finding refuted by
an independent verifier). It **refuted 4** plausible-but-wrong findings (bench SSE parser drops the last
frame — no, LiteLLM SSE always ends with a blank line; percentile off-by-one — a convention, not a bug;
tokens/s clamp poisons the median — median is outlier-robust; alias-collision misrouting — not reachable on a
realistic config) and **confirmed 5**, now fixed:

- **HIGH — [index.ts](../shell/src/main/index.ts) `set-data-dir`**: changing the data folder called
  `sidecar.start()` without `defaultModel`/`searxngUrl`, so both reset to null → **web search + the default
  model silently died** with no self-heal (the module globals stayed set, so `onFarms`' change-check never
  repointed to restore them). Now threads both; same fix applied to `install-sidecar` (same class).
- **MED — [index.ts](../shell/src/main/index.ts) `select-farm`**: pinning a farm called
  `repoint(endpoint, null)` and never updated `currentModel`/`currentSearxng`, so it dropped `DEFAULT_MODELS`
  (re-introducing the every-message model re-pick) with no recovery. Now passes the pinned farm's model +
  SearXNG and updates the globals.
- **MED — [searxng.js](../farm/src/searxng.js)** SHA-pin idempotence: the source re-fetch was guarded on the
  src tree merely *existing*, while `.installed-sha` was stamped with `PINNED_SHA` unconditionally — so
  **bumping the pin silently kept running the old commit** (and the master fallback lied that the pin was
  satisfied). Now a `.src-sha` marker records what's actually extracted (re-fetch when it ≠ the pin), and
  `.installed-sha` records what's actually installed (a master fallback stores `master`, which never
  satisfies the pin, so a later run re-attempts it). Bumping is now just "change the constant + re-run".
- **LOW — [up.js](../farm/src/commands/up.js)** SearXNG staleness: `searxngUp` was captured once at boot and
  never refreshed, so a SearXNG that crashed mid-session kept being advertised (clients' web search then
  fails silently). Now the health timer re-probes `/healthz` (new `searxngAlive()`), and a `child.on('exit')`
  flips it off immediately + kicks the beacon.
- **LOW — [modelPicker.js](../farm/src/modelPicker.js)** `toEntry` carried a picked model's config `alias`
  but not its explicit `vision` flag; since `selectModels` REPLACES `config.models`, picking a model with
  `vision:true` (id the tag-regex can't infer) dropped it → images silently stripped at the proxy. Now
  carried (with a regression test).

**Verified:** farm suite **39 pass** (+ the vision-flag regression); shell `tsc` clean; `ensureSearxng()`
idempotent on the live install (40 ms, no reinstall). Shell fixes ship in v0.1.13; farm fixes reach boxes via
`git pull`.

---

## 2026-07-02 — Web search on every client + fleet view + workshop tooling + multi-model aliases

The batch completing the approved plan (SearXNG was the farm half, previous entry). Four pieces:

**1. Client web search (ships in v0.1.12).** The client reads `searxngUrl` from the discovered farm and
threads it through the sidecar exactly like `defaultModel` (start/repoint/setDataDir/crash-restart + the
repoint change-check, so a farm toggling websearch repoints clients live). [configBridge](../shell/src/main/configBridge.ts)
sets `ENABLE_WEB_SEARCH` / `WEB_SEARCH_ENGINE=searxng` / `SEARXNG_QUERY_URL=<url>/search?q=<query>` and adds
the **`web_search` capability** to `DEFAULT_MODEL_METADATA` (same mechanism as the vision fix — it gates
OWUI's per-message web-search toggle). No farm SearXNG → no env → feature hidden, exactly as before.

**2. Fleet view in the client (v0.1.12).** Renderer-only: the connection popover's farm rows now show
badges (source / **coordinator** / **web search**), the default-model star, and a live line (GPU% ·
VRAM used/total · loaded models · backends · hosts up); the topbar pill appends the active farm's live GPU
load ("Dev Box Farm · 1% GPU").

**Proof for 1+2 (smoke screenshot against the live farm):** `[sidecar] repoint … (model null → assistant,
search null → http://10.10.16.58:8888)` in the log — the real app picked BOTH up from the beacon — and the
`LOL_SMOKE_POPOVER` capture shows the pill with live load + the farm card with BEACON/WEB SEARCH badges,
`assistant ★`, `1% GPU · 15.7/96GB VRAM · loaded: gemma4:12b`, and the hardware line.

**3. Workshop tooling (farm).** `ollama.keepAlive` (default **`-1`**) → `OLLAMA_KEEP_ALIVE` on any Ollama
the CLI starts, so the model stays in VRAM instead of unloading after Ollama's 5-min default (the first
student after a pause otherwise eats a ~30-60s 35B reload); advisory log for externally-started Ollamas.
New **`lol bench`**: N concurrent **streaming** completions per round → per-request first-token latency
(the perceived wait), tokens/s, aggregate + p50/p95. Live run on the box: 3 concurrent users → TTFT
5.6-7.5s (cold), ~132 tok/s per user, 3/3 ok.

**4. Multi-model aliases (farm).** `servedEntries()` no longer collapses to one model: every picked model
serves, named by its per-model **`alias`** (role names: "coder"), else the global `modelAlias` (default
model only), else the raw id. The **snapshot now derives from the same `servedEntries()`** as the LiteLLM
generator, so routing and advertising can't drift. Picker syntax `--model id=alias,id2` attaches aliases;
interactive picks keep config aliases. Docs refreshed (farm README commands/flags/config walkthrough, main
README status, plan roadmap).

**Tested:** farm suite **38 pass** (websearch defaults + settings gotchas, searxngUrl advertising, keepAlive
default, multi-alias servedEntries/litellm/snapshot alignment, `id=alias` parsing); shell `tsc` clean;
`lol bench` live; the smoke screenshot above. The farm on the box is running the full stack (assistant alias
+ SearXNG) right now.

---

## 2026-07-01 (i) — Web search: one shared SearXNG on the farm, zero-setup for clients (farm half)

Owner's top ask: **web search available by default in every client, via SearXNG**. Architecture: the search
*feature* runs client-side (each OWUI queries the engine and fetches/embeds result pages locally — the
local-data invariant holds), but **SearXNG itself is ONE shared instance on the farm box**, orchestrated by
`lol` and advertised through the beacon (`snapshot.searxngUrl`) so clients auto-configure with zero setup.

**Farm implementation** (new [farm/src/searxng.js](../farm/src/searxng.js)): config block
`websearch: { enabled (default false), port (8888) }` + `lol up --websearch/--no-websearch`. First run
installs SearXNG: **source tarball at a pinned commit SHA** (the repo has no tags) → own venv (SearXNG
`==`-pins httpx/flask/jinja2, which would fight LiteLLM in the shared venv) → `pip install -r
requirements.txt` **then** the editable install → generated `settings.yml` (random secret — the webapp
refuses the default; `formats: [html, json]` — OWUI 403s without json; `limiter: false` — skips the Valkey
dependency on a trusted LAN). Runs as a sibling child of LiteLLM (`<venv python> -m searx.webapp`, bound
0.0.0.0), health-waited on `/healthz` + a one-shot `format=json` probe, pid in `.lol-runtime.json`, killed by
`lol down`/shutdown. **Auxiliary by design**: any install/boot failure warns and the farm still comes up.
`lol fleet` shows the search URL.

**Three real Windows walls hit live, all fixed:**
1. **Git can't check out the searxng repo on NTFS at all** — it ships uwsgi/nginx templates named
   `searxng.conf:socket` (colons are invalid on Windows). Sparse checkout didn't dodge it either. Fix: fetch
   the **GitHub tarball** and extract with `--exclude "*/utils/*"` — the bad files are never written, and the
   git prerequisite disappears entirely.
2. **pip metadata generation crashed** (`ModuleNotFoundError: msgspec`): SearXNG's `setup.py` imports
   `searx/__init__.py` at build time, so `requirements.txt` must be installed **before** the package.
3. **`import pwd` crash at boot** — `searx/valkeydb.py` imports the POSIX-only `pwd` module top-level, though
   it's only used in a valkey-error log line (a path we never exercise: no valkey, limiter off). Fix:
   `patchWindowsCompat()` rewrites it to a conditional import after extraction (editable install → live);
   idempotent, no-op if upstream fixes it.

**Verified on the box**: install completes; `python -m searx.webapp` boots on native Windows; `/healthz` 200;
`/search?q=…&format=json` 200 with **16 real results** for a test query. Farm suite **34 pass** (websearch
defaults, settings.yml content incl. the json-format gotcha, `searxngUrl` advertised only when enabled AND
healthy). Enabled in the dev box's `lol.config.json`; `farm/.searxng/` gitignored.

**Client half** (next commit): read `searxngUrl` from the discovered farm → OWUI env
(`ENABLE_WEB_SEARCH`/`WEB_SEARCH_ENGINE=searxng`/`SEARXNG_QUERY_URL`) + the `web_search` model capability.

---

## 2026-07-01 (h) — Default the UI language to English

The app came up in French because OWUI's i18n detector reads the webview's
`navigator.language`, which is the OS locale. Set Chromium's locale to **en-US** via
`app.commandLine.appendSwitch('lang', 'en-US')` ([index.ts](../shell/src/main/index.ts), before app
`ready`) — that's what the frontend detector actually reads — plus `DEFAULT_LOCALE=en-US`
([configBridge.ts](../shell/src/main/configBridge.ts)) as the backend fallback. It's a **default, not a
lock**: a user who picks another language in OWUI's settings still wins (that choice caches in localStorage,
which beats navigator). tsc clean; ships in the next client release. Note: an existing install that already
cached French in localStorage keeps it until changed once in OWUI → Settings → General → Language.

---

## 2026-07-01 (g) — Stable model alias: switch models without breaking OWUI chats

**The (f) DEFAULT_MODELS fix didn't cure it — so I stopped guessing and tested the component directly.** A
chat completion through the proxy for the model OWUI had (`ornith:35b`) returned **`Invalid model name`**,
while `/v1/models` and `/lol/self` now showed a *different* model, **`qwen3.6:35b`** (which chatted fine). So
the real cause, proven not inferred: **the operator switching the served model (via the picker) invalidates
every OWUI chat pinned to the previous model id** — OWUI sends `model=<old id>` on each message, LiteLLM
rejects it, OWUI makes you re-pick. DEFAULT_MODELS helps *new* chats but can't save a chat bound to a
now-removed model.

**Fix (owner chose "stable alias"): decouple the client-facing id from the Ollama tag.** New nullable config
`modelAlias` ([config.js](../farm/src/config.js)); when set, the farm exposes **ONE fixed `model_name`** (e.g.
`assistant`) backed by the default picked model — `servedEntries()` in [litellm.js](../farm/src/litellm.js)
emits `model_name: assistant → ollama_chat/<real model>`, and [snapshot.js](../farm/src/snapshot.js) advertises
`assistant` as the id. So OWUI chats bind to `assistant`, which never changes; **swap the underlying model with
the `lol up` picker anytime and no chat breaks, no one re-picks.** Off by default (null → real names, unchanged
for other setups); enable with `modelAlias` in config or `lol up --alias <name>` / `--no-alias`. Coordinator
peer-matching keys on the served name too, so an aliased fleet shares the alias.

**Client:** none needed — the v0.1.10 client already feeds the advertised default (now `assistant`) into OWUI's
`DEFAULT_MODELS`, so it auto-selects the alias and follows it across restarts. Farm-only → reaches the box via
`git pull` + restart.

**Tested:** farm suite **31 pass** (alias collapses to one stable id backed by the default model; LiteLLM
exposes the alias routed to the real model; snapshot advertises the alias and keeps it constant when the
underlying model changes). Live preview off the box config: `model_name: assistant → ollama_chat/gemma4:12b`,
beacon `[{id:"assistant",default:true}]`. **On-box:** `lol down` + `lol up`, pick a model, then start a **new**
chat (old chats bound to `ornith`/`qwen3.6` real names stay broken — a one-time transition).

---

## 2026-07-01 (f) — OWUI auto-selects the farm's model (fix: re-picking the model every message)

**Symptom (reported):** after switching the served model (gemma4 → `ornith:35b` via the new picker), OWUI made
the user pick the model on every message. Their hunch was a box-side signalling bug.

**Investigation (box ruled out with evidence):** on the box, `/v1/models` returned `ornith:35b` on every poll
(no flap), `/lol/self` showed `healthy=true`, one model, one IP, steady over 6 polls, and `lol fleet` found
**one** farm on the LAN — so no model-list instability and no multi-farm switching by the v0.1.9 least-loaded
client. The client also never told OWUI a model (a grep found only `DEFAULT_MODEL_METADATA`). So the model
*signals* fine; what changed was *which* model.

**Root cause:** OWUI had **no default model** over its OpenAI connection. With one steady model it happened to
keep working; once the served model changed, OWUI's remembered selection went stale with nothing to fall back
to → it prompts for a model. The box does advertise its default in the beacon (`models:[{id,default}]`), but
the client wasn't using it.

**Fix (client feeds the farm's model to OWUI):** the client now reads the active farm's advertised default
model (`farmDefaultModel` in [index.ts](../shell/src/main/index.ts)) and sets OWUI's **`DEFAULT_MODELS`** via
[configBridge](../shell/src/main/configBridge.ts), so OWUI auto-selects whatever the farm serves. Threaded
through the sidecar supervisor ([sidecar.ts](../shell/src/main/sidecar.ts)): `start`/`repoint`/`setDataDir`/
crash-restart all carry `defaultModel`, and it's part of `repoint`'s change-check so **switching the served
model (same endpoint) still restarts OWUI to re-default it**. Env-authoritative each launch
(`ENABLE_PERSISTENT_CONFIG=false`), so it tracks the farm with zero clicks. tsc clean.

**Ships in the next client release; needs on-box confirmation** — I couldn't reproduce OWUI's UI from here, so
if re-picking persists after updating, the next thing to check is whether a *new* chat also starts model-less
(vs only pre-existing chats that stored the old model id).

---

## 2026-07-01 (e) — Choose the served model at `lol up` (installed-Ollama picker)

`lol up` always served the fixed `config.models`. Now the operator can **pick which installed Ollama model(s)
to serve at startup**, from what's actually on the box.

- **New [farm/src/modelPicker.js](../farm/src/modelPicker.js)** — `selectModels(config, hosts, args)` resolves
  the run's catalog: (1) `--model <id[,id]>` / `-m` → serve those, no prompt (pulls if absent); (2) `--no-pick`
  / `--yes` / **no TTY** (scripts, CI, `npm run`) → `config.models` unchanged, so nothing existing breaks;
  (3) otherwise an **interactive picker** — lists installed models with param + disk size (via new
  `ollama.listModelsDetailed`, off `/api/tags`), defaulting to the config's default, Enter to accept, or a
  number / comma-separated list.
- **Wired into [up.js](../farm/src/commands/up.js)** right after Ollama is confirmed reachable and before the
  pull/config steps: the choice replaces `config.models` **in memory** for this run, so it flows through the
  pull, the generated LiteLLM routing, the beacon snapshot, and (coordinator) peer matching. `lol.config.json`
  is left untouched — the persistent catalog is still managed with `lol models add/rm`.
- Purely farm-side (no client change) → reaches the boxes via `git pull`, no release.

**Tested:** farm suite 27 pass (`parseModelFlag` for `--model`/`-m`/`--model=`/comma-lists + not swallowing a
following flag; `selectModels` honours `--model`, `--no-pick`, and the no-reachable-models/non-interactive
fallback). Live: `installedModels` against the box's Ollama listed `gemma4:12b` (11.9B/7.6 GB),
`gemma4:latest` (8.0B/9.6 GB), `ornith:9b` (9.0B/5.6 GB) with sizes.

---

## 2026-07-01 (d) — Multi-box load balancing: least-loaded selection, coordinator farm, `lol fleet`

Closed the Layer-2 gap from the plan (several GPU boxes + several clients → no automatic spreading). Three
pieces, one design that unifies two deployment styles:

- **#1 Least-loaded client selection** ([shell/src/main/index.ts](../shell/src/main/index.ts)) — `chooseActive`
  no longer picks "first healthy"; a new `pickLeastLoaded` sorts by the GPU utilisation the beacon **already**
  broadcasts (`usage.gpuUtil`; unknown → treated as mid-load) and **scatters ties randomly** within a 15-point
  band so a fleet booting at once (all boxes idle) doesn't stampede one box. It runs **only when choosing** —
  first connect / failover — so a healthy current farm stays sticky and we never repoint OWUI mid-session over
  a load blip. Zero new infra: it turns N independent farms into a self-balancing pool.
- **Peer discovery for the CLI** ([farm/src/peerListener.js](../farm/src/peerListener.js)) — the farm can now
  *hear* other farms (it only sent beacons before). Mirrors the shell's discovery: UDP multicast + directed/
  limited broadcast, **plus** a unicast `/lol/self` subnet sweep for broadcast-blocked Wi-Fi; peer registry
  keyed by farm id, self excluded. Shared by the next two.
- **#2 Coordinator farm** (`lol up --coordinator`, or `coordinator:true` in config) — at boot it discovers peer
  farms and folds each into the generated LiteLLM config as an `openai/<model>` deployment of the same
  `model_name` ([farm/src/litellm.js](../farm/src/litellm.js) `buildLitellmConfig(config, peers)`), so **one
  endpoint shuffle-balances across the whole fleet** (each peer proxy then balances its own Ollama) with the
  same failover. It advertises `coordinator:true` in its beacon; the client's `pickLeastLoaded` **prefers a
  coordinator when one exists** — so with no coordinator clients balance client-side (#1), and with one present
  they route through it (#2). Static at boot (a box added later → restart the coordinator); dynamic add is a
  noted follow-up (a proxy restart mid-flight is disruptive, and live `/model/new` needs a master key that
  would force keys on clients).
- **#3 `lol fleet`** ([farm/src/commands/fleet.js](../farm/src/commands/fleet.js)) — listens + sweeps for ~7 s
  and prints every farm on the LAN (this box + peers): health, GPU %, VRAM, hosts up, backends, loaded models,
  model catalog, coordinator role, last-seen. The telemetry was already in the beacon; this renders it.

**Capacity reminder unchanged:** one Ollama serves `OLLAMA_NUM_PARALLEL` (default 2) concurrent generations —
size the fleet by in-flight generations, not headcount.

**Tested:** farm suite 23 pass (peer aggregation adds openai deployments + preserves `supports_vision`; skips a
peer that doesn't serve the model; coordinator config default false; snapshot carries `coordinator`/
`deployments`). Shell `tsc` clean. `lol fleet` smoke-run on the box renders self correctly (hardware, 0% GPU,
loaded/idle) and reports no peers on a single-farm LAN. Client change ships in the next release; the farm
changes reach the boxes via `git pull`.

---

## 2026-07-01 (c) — Multimodal verified + OWUI update procedure (the misleading toast)

**Multimodal confirmed working on the box.** Proved the vision chain layer-by-layer with live tests on the
dev/GPU box: `gemma4:12b` reports `vision` capability and describes a test image directly via Ollama; the
*running* proxy (old `gemma4`, no flag) DROPPED the image ("Please provide the image"); a throwaway proxy on
the regenerated config (`gemma4:12b` + `supports_vision`) DESCRIBED it ("a blue circle… on a red field").
After `lol up` + updating a client to v0.1.7, **image description and webcam work by default** — the
`DEFAULT_MODEL_METADATA` vision baseline flips OWUI on with no per-model toggle (owner-confirmed). Also
pinned the farm to `gemma4:12b` (was `gemma4` → `:latest`) so the 12B multimodal build that fits the 4070 is
what's served. Voice was already confirmed live.

**The misleading OWUI update toast.** On startup OWUI popped "a new version (v0.10.2) is available" while our
own **About → Check for chat-engine update** said "up to date (v0.10.1)." Both were right from their own
vantage: the toast is OWUI's **built-in upstream check** (it queries the OWUI GitHub), whereas our button
compares the installed sidecar to the OWUI version in **our latest release's** `owui-sidecar-manifest.json`
(0.10.1, the sidecar we built + shipped). We manage OWUI by pinning + repackaging it as a sidecar tarball and
updating through the app (sidecarManager: check → download to `.pending` → apply on next launch), so OWUI's
own toast advertises versions we haven't packaged yet — contradicting our button.

**Fix (two parts):**
- **Single source of truth** ([configBridge.ts](../shell/src/main/configBridge.ts)): set
  `ENABLE_VERSION_UPDATE_CHECK=false` so OWUI stops its upstream check/toast. The app's own update flow is now
  the only OWUI-version signal the user sees.
- **Bump the pin + prove the pipeline** ([sidecar/OPENWEBUI_VERSION](../sidecar/OPENWEBUI_VERSION)):
  0.10.1 → **0.10.2** (verified on PyPI as latest; `requires_python >=3.11,<3.13` satisfied by our sidecar's
  Python 3.12). Cutting the release rebuilds the sidecar tarball + manifest at 0.10.2, so existing clients'
  **Check for chat-engine update** will see 0.10.2 > 0.10.1, download it, and apply it on restart — which
  exercises the whole in-app OWUI update procedure end-to-end.

---

## 2026-07-01 (b) — Vision, take 2: OWUI defaulted models to vision-OFF

**Field report after v0.1.6:** voice mode worked (mic fix confirmed live), but attaching an image still got
"my interaction mode does not include vision processing capabilities," AND the **webcam** couldn't be
accessed in call mode.

**Root cause (the webcam clue nailed it):** the LiteLLM `supports_vision` fix (take 1) was necessary but
not sufficient — it stops the *proxy* dropping images, but **OWUI wasn't sending them in the first place**.
Over an OpenAI-style connection OWUI can't introspect a model's capabilities (the farm's `/v1/models`
returns names only), so it defaults **vision OFF**, and a vision-off model means OWUI neither sends attached
images inline NOR enables camera/webcam vision input. The mic worked because STT is capability-independent —
which is exactly why voice was fine but *both* image and webcam failed. One gate, two symptoms.

**Fix** ([configBridge.ts](../shell/src/main/configBridge.ts)): set OWUI's official
`DEFAULT_MODEL_METADATA={"capabilities":{"vision":true}}` (a v0.10.0+ env; we pin 0.10.1). It's a baseline
that flips vision on for every model, env-authoritative every launch (`ENABLE_PERSISTENT_CONFIG=false`), so
it's **zero-config across all clients** — no per-model toggle to click on each machine. Harmless for
text-only models: OWUI sends the image, but the farm's per-model `supports_vision` still gates whether
LiteLLM forwards it to Ollama, so a text-only model just has its image dropped at the proxy.

**Full working chain now:** OWUI (vision on → sends image_url + enables camera) → LiteLLM (supports_vision →
forwards image) → Ollama (gemma4, multimodal → describes it). tsc clean. Needs a client release; the farm
half still needs `lol up` on the box to regenerate the proxy config.

---

## 2026-07-01 — Multimodal: image understanding + voice mode (STT/TTS)

**Symptoms (reported):** attaching an image to a chat produced no description, and voice mode did nothing.

**Root causes (traced through the stack, farm → LiteLLM → Ollama, and shell → webview → OWUI):**

1. **Images silently dropped by the LiteLLM proxy.** The farm serves `gemma4`, which *is* natively
   multimodal — so the model was never the problem. But the generated LiteLLM config
   ([farm/src/litellm.js](../farm/src/litellm.js)) declared each model with only `model_name` +
   `litellm_params` and **no `model_info`**, and `litellm_settings.drop_params: true` is on. LiteLLM's cost
   map doesn't know our Ollama tags, so it treats the model as text-only and, with `drop_params`, **strips
   the `image_url` content before forwarding to Ollama**. OWUI sent the picture; the proxy threw it away.
   (This is the well-known OWUI + LiteLLM + Ollama "image attached but ignored" issue.)

2. **Microphone never granted to the webview.** The Electron main process
   ([shell/src/main/index.ts](../shell/src/main/index.ts)) created the OWUI `<webview>` (partition
   `persist:owui`) but installed **no permission handler**. Electron denies camera/mic by default, so voice
   mode's `getUserMedia()` was silently refused. (The origin itself is fine — OWUI loads from `127.0.0.1`,
   a secure context, so the only block was the missing grant.)

3. **No local speech engine configured.** [configBridge.ts](../shell/src/main/configBridge.ts) set no audio
   env, so STT/TTS fell to OWUI defaults that expect a cloud key — dead on a closed LAN.

**Fixes:**

- **Vision passthrough** ([farm/src/litellm.js](../farm/src/litellm.js)): infer image support from the tag
  (`gemma-4|llava|*-vl|*-vision|minicpm-v|moondream|…`, overridable by an explicit `vision:` on the model)
  and emit `model_info: { supports_vision: true }` for those deployments. LiteLLM then keeps the images
  *and* advertises the capability on `/v1/models` (so OWUI lights up the image UI). Added an optional
  `vision` field to the model schema ([farm/src/config.js](../farm/src/config.js)). **Needs `lol up` on the
  GPU box** to regenerate the config — it's derived, never hand-edited.
- **Mic permission** ([shell/src/main/index.ts](../shell/src/main/index.ts)):
  `configureWebviewPermissions()` sets a request + check handler on the `persist:owui` session that grants
  **only** `media`/`audioCapture`/`videoCapture` (scoped to the OWUI partition, nothing app-wide).
- **Local voice engines** ([configBridge.ts](../shell/src/main/configBridge.ts)): `AUDIO_STT_ENGINE=''` →
  OWUI's built-in **faster-whisper on the client CPU** (offline; `WHISPER_MODEL=base` keeps the one-time
  download ~150 MB); `AUDIO_TTS_ENGINE=''` → **client-side Web-Speech voices** (offline, zero bundle cost).
  These are env-authoritative every launch (`ENABLE_PERSISTENT_CONFIG=false`), so they can't be un-set by a
  stale persisted setting.
- **Ship the STT dep** ([sidecar/build-sidecar.mjs](../sidecar/build-sidecar.mjs)): explicitly
  `pip install faster-whisper` after OWUI (CTranslate2, not torch → no CUDA weight; a no-op if OWUI already
  bundles it) so voice works even if OWUI makes audio an optional extra.

**Tested:** farm unit tests extended (19 pass) — vision inferred from tag, explicit flag overrides,
`supports_vision` present for `gemma4` and absent for `qwen2.5-coder`; shell `tsc --noEmit` clean. **Still to
verify on the GPU box + a client build** (I can't reach the rig from here): (a) `lol up`, then attach an
image and ask "describe this" → expect a real description; (b) a fresh client build → voice mode records
(mic prompt), transcribes locally, and speaks the reply.

**Note:** vision needs a client that talks to a farm running the regenerated config; voice needs a new
client release (shell + sidecar changes). Both are LAN-local — no cloud, no farm audio load (STT/TTS run on
the client).

---

## 2026-06-30 — Fix: OWUI cramped at the top with a black bar (webview not filling)

**Symptom (reported, with a screenshot):** OWUI rendered squished into the top of the window with a large
black area below — model picker + greeting + input crammed together, input not at the bottom.

**Root cause (reproduced + measured):** the embedded `<webview>` was sized with `width/height:100%`. A
harness that loads OWUI and resizes the window showed the precise failure: the **webview *element*** fills
`.main` correctly (e.g. 745px → 355px on resize), but the **embedded guest's viewport stays stuck at its
intrinsic 150px** — so OWUI lays out in a 150px-tall page and the element's background shows below it
(the black bar). Percentage height on an Electron `<webview>` doesn't propagate to the guest viewport and
never re-tracks a window resize; `position:absolute;inset:0` had the same flaw.

**Fix** ([shell/renderer/styles.css](../shell/renderer/styles.css)): size the webview by **flex** instead
— `.main { display:flex }` + `webview { flex:1 1 auto; align-self:stretch; min-width:0 }` (no
width/height). With flex stretch the guest viewport tracks the element at every size (harness: guest
innerHeight 745 → 355 = fills). The absolute overlay (`inset:0`) is out of flex flow, so it's unaffected.

**Tested:** the resize harness goes from a 150px guest (black bar) to a fully-filling guest with flex; and
a real packaged app launched + resized to a short window (added a `LOL_SMOKE_RESIZE` smoke option) renders
OWUI filling the whole window, no black bar. Shipping as the next patch.

---

## 2026-06-30 — Small installer: download Open WebUI on first run + in-app updates

The bundled-OWUI installer was ~740 MB (Win) / ~1.3 GB (Linux). Switched to a **small installer
(~120 MB) that downloads the OWUI sidecar on first run**, plus in-app update buttons for both the app and
the chat engine.

- **Installer** ([shell/electron-builder.yml](../shell/electron-builder.yml)) — dropped `extraResources`
  (the sidecar). win-unpacked fell from ~1.5 GB to **357 MB** (→ ~120 MB NSIS). Also set
  `nsis.artifactName: ${productName}-Setup-${version}.${ext}` — electron-builder's default name has spaces
  that GitHub turns into dots on upload (`LlmOnLan.Setup.0.1.3.exe`), which breaks electron-updater's
  filename match in `latest.yml`.
- **Sidecar as a release asset** ([.github/workflows/release.yml](../.github/workflows/release.yml)) — CI
  still builds the per-OS sidecar, then packs it as `owui-sidecar-<platform>-<arch>.tar.gz` (+ a tiny
  `owui-sidecar-manifest.json` with the OWUI version) and uploads it via `gh release upload`. (Bonus: this
  also sidesteps the 2 GB asset limit that the bundled Linux AppImage kept hitting — the small AppImage and
  the sidecar tarball are each well under it.)
- **Download on first run** ([shell/src/main/sidecarManager.ts](../shell/src/main/sidecarManager.ts)) — a
  packaged app with no `userData/sidecar` downloads the matching tarball (redirect-following `https`, byte
  progress), extracts it with the system `tar` (relative paths to dodge the Windows drive-colon bug), and
  swaps it into place. [paths.ts](../shell/src/main/paths.ts) `resolveSidecarCommand` now points at
  `userData/sidecar` (packaged); the renderer shows a "Setting up the chat engine (~700 MB, one-time)"
  progress overlay with a Retry on failure.
- **In-app updates** ([Preferences](../shell/renderer/index.html)) — **Check for app updates**
  ([updater.ts](../shell/src/main/updater.ts) `checkForAppUpdate`/`quitAndInstallUpdate`; downloads in the
  background, "Restart & install" when ready) and **Check for chat-engine update** (compares the installed
  OWUI version to the latest release's manifest; downloads a newer sidecar to `userData/sidecar.pending`,
  applied on the next launch by `applyPendingSidecar()` so a running OWUI isn't disturbed — "Restart to
  apply").

**Tested:** tsc + renderer clean; the small `--dir` build has no `resources/sidecar` (357 MB). End-to-end
first-run download verified against a real release asset — a fresh-userData small build downloaded the
778 MB sidecar, extracted it, ran OWUI from `userData/sidecar`, and reached the authenticated chat.
**Shipped as v0.1.4** (single clean release, all 4 jobs green): installers `LlmOnLan-Setup-0.1.4.exe`
**97 MB** / `…-arm64.dmg` 111 MB / `….AppImage` 120 MB (down from ~740 MB / ~1.3 GB), the per-OS
`owui-sidecar-*.tar.gz` (777/702/1231 MB) + manifest, and `latest*.yml` whose `path` matches the
hyphenated installer name (so electron-updater resolves it).

---

## 2026-06-30 — Farm bootstrap: `lol install` (one command to set up, one to run)

A fresh checkout on a GPU box was a multi-step manual setup (install Ollama, `pip install litellm`, point
the config at the venv, pull models). Collapsed that into **one command to install, one to run**, the way
the desktop client is one installer.

- **`lol install`** ([farm/src/commands/install.js](../farm/src/commands/install.js)) — idempotent
  bootstrap: (1) scaffold `lol.config.json` if absent; (2) install **Ollama** if missing —
  `winget install Ollama.Ollama` on Windows, `brew install ollama` on macOS, the official `install.sh`
  on Linux (detected as "present" if the CLI is on PATH or a local daemon answers, so it never reinstalls);
  (3) create `farm/.venv` with the operator's Python 3.9–3.13 and `pip install "litellm[proxy]"`;
  (4) pull every configured model over Ollama's HTTP API. Each step is skipped if already satisfied, and a
  missing auto-installer (no winget/brew/curl/Python) prints the exact manual step instead of failing.
- **`farm/.venv` is auto-used** ([farm/src/proc.js](../farm/src/proc.js) `resolveLitellmCommand`): with the
  default `litellm.command:"litellm"`, the farm prefers `farm/.venv`'s litellm if `lol install` made one,
  else falls back to PATH — so a fresh pull needs **no config editing**. An explicit absolute command still
  wins.
- **Wrapper scripts** for the literal two commands: [farm/install.ps1](../farm/install.ps1) /
  [install.sh](../farm/install.sh) (`npm install` + `lol install`) and [farm/run.ps1](../farm/run.ps1) /
  [run.sh](../farm/run.sh) (`lol up`). So a fresh GPU box is: `cd farm; ./install.ps1; ./run.ps1`.

**Tested:** `lol install` on the dev box runs the full happy path idempotently (detects Ollama, the venv,
and the pulled model — exit 0); `where`/`py -3.12` probes resolve (winget + Python 3.12 present); 16/16
farm unit tests pass incl. two new ones for `resolveLitellmCommand` (explicit path wins; default →
`.venv`-or-PATH). The actual installer invocations follow each tool's official method; the model-pull
reuses the existing HTTP `pullModel`. Docs: [farm/README.md](../farm/README.md) gains a "Quick start
(fresh pull) — two commands" section + a `lol install` breakdown.

---

## 2026-06-30 — M5 release: published to GitHub Releases (v0.1.1 → v0.1.3, validated)

First real packaged release — the "streamline testing with several clients + one GPU box" goal: install
the client on each machine, all pointing at the one farm, with **auto-update** from GitHub Releases.

**Two build fixes were needed before the first release could be trusted:**
- **`OPENWEBUI_VERSION` wasn't staged into the bundle** — `paths.bundledOwuiVersion()` reads
  `resources/sidecar/OPENWEBUI_VERSION` (About panel), but `build-sidecar` only copied `launcher.py` +
  `python/`. Now copies the pin too.
- **`tar` Windows drive-colon** — GNU/MSYS `tar` reads `C:\…\python.tar.gz` as a remote `host:path`
  ("Cannot connect to C:"), so extraction failed wherever GNU tar is first on PATH (a CI windows-latest
  risk too, since Git ships GNU tar). `build-sidecar` now runs `tar` from `workDir` with **relative**
  paths, which both GNU tar and Windows' bundled bsdtar handle.

**Validated locally before tagging (so the first public release isn't broken):**
1. Built the full `win32-x64` sidecar — standalone CPython (python-build-standalone) + `open-webui==0.10.1`
   (torch/chromadb/transformers, ~1.5 GB).
2. Ran the bundle directly: `python launcher.py serve` → `/health 200`, `/api/config` `v0.10.1`.
3. `electron-builder --dir` pack → launched the **packaged** `LlmOnLan.exe`: it resolved the bundled
   sidecar (`[sidecar] spawning (packaged): …/resources/sidecar/python/python.exe …launcher.py serve`),
   booted OWUI, and rendered the **authenticated** UI — the "What's new in Open WebUI" modal + full
   sidebar (signed-in admin), confirming the auth-reveal fix in a real packaged build
   ([docs/img/packaged-app.png](img/packaged-app.png)). (`app-update.yml ENOENT` in a `--dir` pack is
   expected — that file is emitted by the NSIS target in CI, not `--dir` — and the updater catches it.)

**Release flow:** `npm run release:patch` → bumps `shell/package.json`, tags `vX.Y.Z`, pushes →
`.github/workflows/release.yml` matrix (windows/macos/ubuntu) each builds its own sidecar then
`electron-builder --publish always` to the GitHub Release. Clients with auto-update on (default) pull the
next version from there. The chat-auth fix above ships in this release.

**The real CI run then surfaced four more bugs (fixed; the local `--dir` pack couldn't catch any of them):**
- **`release.mjs` ENOENT on Windows** — `execFileSync('npm', …)` can't spawn `npm.cmd` without a shell;
  pass `shell:true` (git is a real `.exe`, unaffected).
- **CI never compiled TypeScript** — the workflow ran `electron-builder` directly, not the `dist` script
  that chains `npm run build`, so the app.asar shipped without `build/main/index.js` and every OS failed
  the packager's entry-file sanity check. Added an explicit `npm run build` step. *(After this, Windows
  built + published a working 741 MB installer + `latest.yml`.)*
- **Linux AppImage > 2 GB** — on Linux the PyPI `torch` is the **CUDA** build, which pulls **~3–4 GB of
  `nvidia-*`/`cuda-toolkit` wheels** (cudnn, nccl, cublas, …) as dependencies, blowing past GitHub's 2 GB
  asset limit (Windows/mac get CPU torch by default). v0.1.2's first attempt swapped the torch *binary* for
  the CPU wheel but `--no-deps` left the multi-GB nvidia packages behind — still > 2 GB. **v0.1.3** fixes it
  for real: swap torch → CPU **and** `pip uninstall` the orphaned `nvidia-*`/`cuda-*` packages (CPU torch
  never loads them). The client only needs CPU embeddings; the GPU box runs the farm.
- **electron-builder's GitHub publisher is unusable across a matrix** — it uploads a release's assets in
  parallel and each upload that finds no release creates its own, which (a) 422'd `already_exists`, dropping
  assets, and (b) it *ignores a pre-made published release* and makes its own draft → **two non-draft v0.1.3
  releases with assets split between them**. `max-parallel:1` (cross-job) and a `create-release` pre-make job
  both helped but neither cured it. **Final fix: stop publishing via electron-builder.** Build with
  `--publish never` (which still emits the `latest*.yml` manifests + blockmaps in `dist/`), then upload with
  `gh release upload "$TAG" … --clobber` to the release the `create-release` job pre-made. `gh` doesn't
  create-race, `--clobber` makes re-runs idempotent, and `max-parallel:1` keeps uploads from overlapping.
  Also dropped the mac **x64** target — the sidecar is built for the runner's arch (arm64), so an Intel dmg
  would ship an arm64 Python (re-add once `build-sidecar` emits both arch bundles).

So **v0.1.1** was the Windows-only first attempt; **v0.1.2** got Windows (NSIS) + macOS (arm64 dmg+zip)
clean (the serialize fix landed the mac assets) but Linux still 2 GB; **v0.1.3** is the fully-green
release — Windows, macOS, and Linux (AppImage) all published with their auto-update manifests.

---

## 2026-06-30 — Fix: embedded OWUI rendered unauthenticated (no chat stream, sparse features)

**Symptom (reported):** the shell connects to a farm and the model is selectable, but **chat answers
never stream back** and **many Open WebUI features are missing**.

**Root cause (found via systematic debugging, evidence at every boundary):** the whole stack was
healthy — the farm streams (`curl` to `:4000` ✅), and OWUI→farm→Ollama works end‑to‑end in a normal
browser (Playwright drove a full streamed reply with all features ✅). The break was **webview‑specific
and timing‑based**:
- OWUI's SvelteKit SPA fetches `GET /api/config` and **first‑paints before** the `WEBUI_AUTH=false`
  auto‑login writes its token. Unauthenticated, `/api/config` returns the **sparse** feature set
  (7 keys vs 37) → "features missing", and any chat `POST /api/chat/completions` **401s** → "no answer".
  Once the token lands, a single reload re‑bootstraps the SPA fully authenticated.
- It bites **nearly every launch**, not just the first: `localStorage` is keyed by origin, and the
  sidecar takes a **fresh ephemeral port** whenever its preferred `8080` is busy ([util.ts](../shell/src/main/util.ts)
  `findFreePort`), so each boot is a new origin with empty storage that loses the race again. (A normal
  browser happened to win the race, which is why it only reproduced inside the `<webview>`.)

Proven with a minimal Electron `<webview>` harness: probe at first paint → `hasToken:false`, 7 features,
chat `401`; after waiting for the token + **one reload** → `hasToken:true`, 37 features, chat `200` with
streamed chunks.

**Fix** ([shell/renderer/app.js](../shell/renderer/app.js)): keep the "Starting your local chat…" overlay
up until OWUI is authenticated, never flashing the degraded UI. On the webview's `did-finish-load`,
`ensureAuthenticated()` checks `localStorage.token`; if absent it waits (≤20 s) for the auto‑login token,
then **reloads once**. A `webviewAuthed` gate drives the reveal and `authReloadPending` prevents reload
loops; both reset when the OWUI origin changes (repoint / new port), so every fresh origin re‑bootstraps
cleanly.

**Tested:** the `<webview>` harness goes sparse→full + chat `200` after the reload; an isolated real‑app
instance (own `--user-data-dir`, fresh partition → exercises the race) boots straight to the **full,
authenticated** OWUI — "Bonjour, User", model picker, sidebar (chats/search/notes/workspace), voice — with
no stuck overlay ([docs/img/owui-auth-fixed.png](img/owui-auth-fixed.png)). Renderer‑only change; no `tsc`.

---

## 2026-06-30 — M6: farm health indicators (GPU/VRAM/RAM + live util)

Richer health surfaced from the farm all the way to the client — the M6 "connection/health indicators +
richer `lol status`" goal.
- **Farm** ([systemInfo.js](../farm/src/systemInfo.js)) — dependency‑free hardware detection: RAM/CPU
  from `os`, GPU/VRAM from `nvidia-smi` (degrades to `Unknown GPU` on non‑NVIDIA boxes; swap in
  `systeminformation` if AMD/Apple detection is ever needed). `detectHardware()` runs once at boot;
  `gpuLiveStats()` (util% + VRAM used/total) is refreshed on the health timer.
- **Snapshot** ([snapshot.js](../farm/src/snapshot.js)) now carries `host` `{gpu, vramGb, ramGb, cpuCores}`
  + `usage` `{gpuUtil, vramUsedGb, vramTotalGb, loaded}` — flowing through the beacon + `/lol/self` to the
  client with no schema migration (older farms simply omit them; the client treats them as optional).
- **`lol status`** ([status.js](../farm/src/commands/status.js)) prints a Hardware line:
  *NVIDIA RTX PRO 6000 Blackwell · 96GB VRAM · 126GB RAM · 32 cores · 1% util · 2/96GB VRAM used*.
- **Shell** — the farm popover row shows the live busy indicator on the meta line (`gemma4 · 1% GPU`) +
  the GPU name/VRAM beneath ([docs/img/m6-farm-health.png](img/m6-farm-health.png)). `FarmSnapshot` type
  extended with optional `host`/`usage`.

**Tested:** 14/14 farm unit tests (added snapshot host/usage + systemInfo tests; the runner now awaits
async tests); `lol status` + `/lol/self` show the real hardware on the rig; the shell capture shows the
farm card with `1% GPU` + the GPU name. Shell `tsc` clean.

---

## 2026-06-30 — Failover verified + LiteLLM router tuned for transparent failover

Stood up a **two‑Ollama** farm to test load‑balancing + failover (the rig had a 96 GB GPU, so a second
`ollama serve` on `:11435` held a second copy of `gemma4` easily).
- **Load‑balancing:** the generated config produced two `gemma4` deployments (one per host); 8/8 chat
  completions succeeded and **both** hosts loaded the model — LiteLLM's `simple-shuffle` spread the
  traffic.
- **Failover (first pass) found a real gap:** killing `:11435` mid‑operation gave **7/8** — one request
  (and its retries) hit the dead host before the circuit‑breaker cooled it out, surfacing an
  `APIConnectionError` to the caller. Not transparent enough.
- **Fix → re‑verified:** tuned the generated `router_settings`
  ([litellm.js](../farm/src/litellm.js)) — `num_retries 2→3`, `allowed_fails 2→1` (cool a dead host out
  after a *single* failure), `cooldown_time 30→60`. Re‑ran the same kill‑a‑host test: **10/10
  completions succeeded** — failover is now transparent (a node death is invisible to the user). 10/10
  unit tests still pass.

Ticks the RIG_CHECKLIST failover item.

---

## 2026-06-30 — Rig verification: full chat E2E + document-locality (Playwright)

Two of the biggest open [RIG_CHECKLIST](RIG_CHECKLIST.md) items, verified on the live stack by driving
a real OWUI instance (pointed at a running `lol up` farm) with Playwright.

**Full chat end-to-end** ([docs/img/e2e-chat.png](img/e2e-chat.png)) — drove the actual OWUI UI:
auto‑signed‑in under `WEBUI_AUTH=false`; OWUI's `/api/models` returned **`gemma4`** (fetched from the
farm's `/v1/models`); selected the model, typed *"what does LAN stand for?"*, and got a **real streamed
response from gemma4: "LAN stands for Local Area Network."** Since `ENABLE_OLLAMA_API=false`, the farm
(LiteLLM→Ollama) is OWUI's *only* possible inference path, so this is a definitive
**OWUI → farm → gemma4** round‑trip through the real chat surface.

**Document-locality (invariant #3)** — uploaded a doc containing a unique canary phrase
(`ZQX-PINEAPPLE-42`) via OWUI's API, then checked both ends:
- **Local:** the file landed in `DATA_DIR/uploads/`, and the **canary phrase is present in the local
  `vector_db/chroma.sqlite3`** — the document was embedded + stored on the device.
- **Farm:** the farm's LiteLLM access log shows **ZERO `/v1/embeddings` requests** (only the 4
  chat/completions from the chat above). The embedding ran on the **local MiniLM** (loaded in‑process at
  OWUI startup) — the document text never left the machine. Exactly the privacy promise: documents embed
  locally; only chat context reaches the farm at request time.

Checklist items ticked: "a full chat in the embedded webview end‑to‑end" and "document‑locality RAG test".

---

## 2026-06-29 — Adversarial review pass (correctness fixes)

A fresh-eyes adversarial review of the highest-logic code (shell main process + farm CLI) surfaced
real bugs; the genuine ones are fixed (the reviewer's "reviewed-OK / not-a-bug" items were left alone):
- **Sidecar restart races (HIGH)** — a crash auto‑restart could race a `repoint()`/`stop()` and orphan
  or duplicate an OWUI process. [sidecar.ts](../shell/src/main/sidecar.ts) now uses a **generation
  counter** (every `start()`/`stop()` bumps it; an in‑flight `start()` aborts at its awaits when
  superseded) + **child‑identity** comparison in the exit handler (only the current child's unexpected
  exit restarts), and `start()` reaps any existing child before spawning.
- **`lol down` orphaned a spawned Ollama (HIGH)** — [up.js](../farm/src/commands/up.js)'s child‑exit
  handler killed `oll.spawnedPids` **without awaiting** before `process.exit`. Now it awaits the kills
  and also tears down the health timer + beacon + self‑server first.
- **Dead `requiresKey ? null : null` ternary** — [index.ts](../shell/src/main/index.js) cleaned up;
  documented that keyed farms need a key‑entry UX we haven't built (so we don't send a wrong placeholder).
- **Discovery kept working after `stop()`** — [discovery.ts](../shell/src/main/discovery.js) added a
  `stopped` flag (checked in `sweep`/`pollKnown`/socket message) and tracks the socket‑reconnect timer so
  a stopped Discovery can't re‑emit or leak a bound socket.
- **No‑farm boot could reach public OpenAI** — [configBridge.ts](../shell/src/main/configBridge.js) now
  sets `ENABLE_OPENAI_API=false` when there's no farm endpoint (privacy intent: only the farm).
- **Stale webview after a same‑port repoint** — [app.js](../shell/renderer/app.js) forces a webview
  reload on the restarting→ready transition even when the URL is unchanged.
- **Overlapping health ticks** — up.js's health interval now skips a tick if the previous probe round is
  still running.

**Tested:** shell `tsc` clean; farm 10/10 unit tests; data‑migration 9/9; and a fresh smoke launch shows
**no regression** — discovery → OWUI spawned at the discovered endpoint → ready, pill reads "Dev Box
Farm" (active‑farm match intact after the lifecycle rewrite).

---

## 2026-06-29 — M5: packaging + auto-update (electron-builder + GitHub Releases)

**What:** The self‑updating, one‑click install path (ComfyQ recipe, with the brief's §6 corrections).
- [`electron-builder.yml`](../shell/electron-builder.yml) — `com.llmonlan.client` / **LlmOnLan**; the
  bundled sidecar rides via **`extraResources`** (`../sidecar/build/sidecar` → `resources/sidecar/`,
  outside `app.asar` so it's executable); **win** NSIS `oneClick` + `perMachine:false` (silent per‑user
  updates, no UAC); **mac** `dmg` **+** `zip` for both arches (zip is required for Squirrel.Mac
  auto‑update) with ad‑hoc signing (`identity:null`, `hardenedRuntime:false`); **linux** AppImage;
  `publish: github b2renger/LlmOnLan releaseType:release`.
- [`scripts/afterPack.cjs`](../shell/scripts/afterPack.cjs) — macOS ad‑hoc `codesign --sign -` so the
  app isn't flagged "damaged" (no‑op elsewhere).
- [`scripts/release.mjs`](../shell/scripts/release.mjs) — `npm version --no-git-tag-version`, then commits
  ONLY the version files, makes an annotated `vX.Y.Z` tag, and pushes `--follow-tags` (the npm‑tagging‑is‑
  unreliable workaround); guarded to `main` + a clean tree. `release:patch|minor|major` scripts.
- [`updater.ts`](../shell/src/main/updater.js) — **electron‑updater 6.8.9** (a real runtime dep), wired
  in `index.ts`: checks on launch when enabled + packaged, downloads in the background, installs on quit;
  a no‑op in dev. The Preferences auto‑update toggle starts a check when flipped on.
- [`.github/workflows/release.yml`](../.github/workflows/release.yml) — on a `v*` tag, matrix
  `[windows, macos, ubuntu]` each builds the OWUI sidecar for its OS then runs
  `electron-builder --publish always` (`contents: write`, `CSC_IDENTITY_AUTO_DISCOVERY=false`).

**Tested:** `electron-updater@6.8.9` + `electron-builder@26.15.3` install clean (0 vulnerabilities); tsc
builds with the updater wiring. **`electron-builder --dir`** (against a stub sidecar) **packaged a real
`dist/win-unpacked/LlmOnLan.exe`** — confirming the config parses, the app packages, `afterPack` runs,
and `extraResources` places the sidecar at exactly `resources/sidecar/{launcher.py, python/}` where
`resolveSidecarCommand()` looks. `release.mjs`/`afterPack.cjs`/`build-sidecar.mjs` syntax‑check clean;
`release.yml` is valid YAML. The full installer (NSIS/dmg/AppImage) + the publish‑to‑Releases +
auto‑update cycle run in CI on a version tag — that's the upgrade test, not a single‑session step.

---

## 2026-06-29 — M0 (sidecar packaging): bundle the pinned OWUI

**What:** The build path that turns the pin into a self‑contained, shippable sidecar.
- [`OPENWEBUI_VERSION`](../sidecar/OPENWEBUI_VERSION) `= 0.10.1` — the single source of truth.
- [`launcher.py`](../sidecar/launcher.py) — drives OWUI's Typer app (`open_webui:app`) via argv, so the
  invocation is **path‑independent** (no pip console‑script shebang that breaks once the installer
  relocates the bundle). There is **no `python -m open_webui`** in 0.10.1, hence the launcher.
- [`build-sidecar.mjs`](../sidecar/build-sidecar.mjs) (+ `.sh`/`.ps1` wrappers) — downloads a relocatable
  **standalone CPython** (astral‑sh/python‑build‑standalone, latest release matched via the GitHub API
  so no tag rots), `pip install open-webui==<pin>` into it, drops in `launcher.py`, and stages
  `sidecar/build/sidecar/` (fixed name → same `extraResources from` on every OS). Chosen over PyInstaller
  because OWUI's built SvelteKit frontend + data files + torch/chromadb make a one‑file build fragile;
  a real interpreter with the package installed is the reliable path.
- [`resolveSidecarCommand`](../shell/src/main/paths.ts) updated: packaged runs
  `resources/sidecar/python(.exe) resources/sidecar/launcher.py serve --host --port`; dev keeps the
  `.venv` console script.
- [`sidecar/README.md`](../sidecar/README.md) documents the approach + the **upgrade test** (bump the
  pin → re‑build → smoke; pass = no LOL code changed).

**Tested:** the load‑bearing mechanism — **`python launcher.py serve` boots OWUI** (`/health` →
`{"status":true}`) against the existing self‑contained Python — is verified. The full multi‑GB
standalone‑Python bundle build (download + `pip install torch/…`) is heavy and runs on **CI / the build
machine**, not in this session; the script is written to be CI‑run (it's exercised by the release
workflow). This is the milestone the plan explicitly flags as a packaging spike.

---

## 2026-06-29 — M4: Preferences (data folder + connection + startup/updates + about)

**What:** A LOL‑owned, ComfyQ‑styled Preferences modal (the gear), with the four sections the plan
calls for.
- **Data location** — shows the current `DATA_DIR` (with a "(default)" tag), "Change folder…" via the
  native `dialog.showOpenDialog`. On change, if the old folder has data, the user chooses **Move my
  data** or **Start fresh**; the sidecar is stopped, the data copied (then the old removed), settings
  updated, and the sidecar restarts pointed at the new folder.
- **Connection** — auto‑search toggle, Rescan, a **subnet search‑range editor** (base + 3rd/4th octet
  from–to, defaulting to the machine's own subnet), Add‑by‑address, and removable manual‑peer chips —
  the richer counterpart to the topbar popover, all driving the M3 discovery module.
- **Startup & updates** — launch‑at‑login (`app.setLoginItemSettings`), an auto‑update toggle (the
  updater itself lands in M5), and version display.
- **About** — LlmOnLan version (`app.getVersion()`) + bundled Open WebUI version (read from
  `sidecar/OPENWEBUI_VERSION`, the single source of truth) + a "Powered by Open WebUI" link.
- Main: new module [dataMigration.ts](../shell/src/main/dataMigration.ts) (transactional copy‑then‑remove,
  reversible on failure, with self‑containment guards), `bundledOwuiVersion()` in paths, and IPC
  `get-prefs`/`choose-data-dir`/`set-data-dir`/`set-launch-at-login`/`set-auto-update`.

**Tested:** the modal renders all four sections (see [docs/img/m4-prefs.png](img/m4-prefs.png)) with the
data path, the search range **auto‑detected as `10.10.16–17.1–254`** (correctly spanning this /23 LAN),
versions (`v0.1.0` / `v0.10.1`), and the connected farm still shown in the pill. The data‑migration
helper has a focused unit test — **9/9** covering copy‑to‑dest, nested files, src‑removed‑after‑move,
copy‑leaves‑src, the refuse‑dest‑inside‑src guard, and empty‑src. (The folder *pick* itself is a native
dialog, a manual interaction; the migration core that moves the data is what's unit‑tested.)

---

## 2026-06-29 — M3 (client half): LAN discovery + connection UX (no URL typed)

**What:** The shell now finds the farm itself and points OWUI at it — zero config.
- **Discovery module** ([discovery.ts](../shell/src/main/discovery.ts), ported from ComfyQ's desktop
  discovery) — merges three sources into one farm map: (1) **UDP beacons** on `239.255.43.10:41998`,
  (2) **subnet sweep** probing `GET /lol/self` (the broadcast‑blocked‑LAN fallback), (3) **manual
  add‑by‑address**. Per‑farm staleness/TTL; de‑duped by farm `id` (survives DHCP IP changes).
- **Auto‑connect** ([index.ts](../shell/src/main/index.js)) — on first run, OWUI's boot waits a short
  grace period for discovery to surface a farm, then boots **pointed at the reachable LAN address**
  (`http://<reach-host>:<proxyPort>/v1`); `onFarms` keeps it repointed as the LAN changes. Pick logic
  is sticky (pinned choice → current‑if‑good → first healthy) to avoid flapping between equivalents.
- **Connection UX** ([renderer](../shell/renderer/)) — the topbar status pill shows the connected farm
  name (green) and opens a **connection popover**: the discovered‑servers list (health dot · source tag ·
  `host:port · models` · active checkmark, click to switch), an **Add by address** field, an
  **Auto‑search the subnet** toggle, and **Rescan** — mirroring ComfyQ's controls.
- IPC + persistence: `get-farms`/`select-farm`/`add|remove-manual-peer`/`set-auto-scan`/`set-scan-range`/
  `rescan`; manual peers, auto‑scan, scan range, and the pinned farm persist to shell settings;
  `lastEndpoint` is remembered as the pre‑discovery fallback.

**Tested — the actual app (see [docs/img/m3-discovery.png](img/m3-discovery.png)):** launched with **no
`LOL_ENDPOINT`**. Logs show `[discovery] listening 239.255.43.10:41998` and the sidecar spawning with
`endpoint=http://10.10.16.58:4000/v1` — i.e. it **discovered the farm and auto‑pointed OWUI at the LAN
address** with nothing typed. The capture shows the pill reading **"Dev Box Farm"** and the popover
listing it (BEACON source, `10.10.16.58:4000 · gemma4`, active ✓) with the add/rescan fallbacks. The
sweep + manual‑add paths reuse the same `/lol/self` fetch verified in the M3 farm half.

---

## 2026-06-29 — M0 + M1: Electron shell skeleton + config‑bridge (OWUI runs in the shell)

**What:** Built the client shell (`shell/`, Electron + TypeScript) and proved the prime‑directive
separation: an **unmodified** Open WebUI runs inside our chrome, pointed at the farm purely through
env vars.
- **Sidecar supervisor** ([sidecar.ts](../shell/src/main/sidecar.ts)) — spawns
  `open-webui serve --host 127.0.0.1 --port <free>` with the config‑bridge env, health‑waits on
  `/health`, auto‑restarts on crash (bounded), and `repoint()`s by restarting with a new endpoint.
- **config‑bridge** ([configBridge.ts](../shell/src/main/configBridge.ts)) — the ONLY module that
  knows OWUI's surface (M1). Strategy: **env‑authoritative** (`ENABLE_PERSISTENT_CONFIG=false`) so a
  changed farm URL is honored every launch with no stale persisted URL winning; `ENABLE_OLLAMA_API=false`;
  `DATA_DIR` local; default local embeddings (RAG engine unset); `WEBUI_AUTH=false`; telemetry off;
  branding untouched. *(HF model cache left at its default `~/.cache/huggingface` — shared across data
  folders so changing DATA_DIR doesn't re‑download the embedding model; still 100% local.)*
- **Shell chrome** — `renderer/` topbar (logo + connection‑status pill + theme toggle + gear) over a
  `<webview>` of the local OWUI, with a connection overlay until the sidecar is `ready`. ComfyQ
  `tokens.css` (verbatim) + light/dark via `nativeTheme`. New LOL logo ([icon.svg](../shell/assets/icon.svg)
  → `icon.png`, rendered via a headless‑Chromium screenshot): a chat bubble holding a LAN node‑graph.
- **store.ts / paths.ts / util.ts** — JSON settings store, dev‑venv‑vs‑packaged sidecar resolution,
  free‑port / tree‑kill / health‑poll helpers.

**Tested — the actual app, end to end (see [docs/img/m0-shell.png](img/m0-shell.png)):** `tsc` builds
clean; launched via a new `LOL_SMOKE_SHOT` hook (boot → wait for OWUI → capture the window → quit).
The capture shows the LOL topbar (green **Ready** pill) over **Open WebUI 0.10.1 running unmodified in
the webview**, its own branding intact. Logs confirm OWUI auto‑provisioned `admin@localhost`
(`WEBUI_AUTH=false`), served its SvelteKit frontend, and ran `get_all_models()` against the configured
farm endpoint. The earlier sidecar spike confirmed all user data (webui.db, `vector_db/chroma.sqlite3`,
uploads) lands under the local `DATA_DIR` and embeddings load **locally** (MiniLM in‑process) —
invariant #3.

**M0 sidecar spike result:** `open-webui==0.10.1` installs on Python 3.12; the launch command is the
console script `open-webui serve --host --port` (NOT `python -m open_webui`, which 0.10.1 doesn't
expose; and `--port`, not a `PORT` env). It boots with the privacy env to `/health → {"status":true}`.

**Bugs/gotchas fixed:**
- **`ELECTRON_RUN_AS_NODE=1`** in this session's environment made Electron run as plain Node →
  `require('electron')` returns a path string → `app` undefined. Launch with `env -u ELECTRON_RUN_AS_NODE`
  (documented in the shell README).
- Forced `PYTHONUTF8=1` for the OWUI child too (same Windows cp1252 class of bug as LiteLLM).

**Decision — combined commit.** M0 (skeleton) and M1 (config‑bridge) ship together: the shell can't
boot OWUI without the bridge providing its env, so splitting would leave a non‑functional intermediate.
Both milestones' acceptance criteria are documented above.

---

## 2026-06-29 — M3 (farm half): UDP discovery beacon + `/lol/self`

**What:** The farm now announces itself on the LAN two ways, both fed by the one
`buildSnapshot()` so they can't drift (mirroring ComfyQ).
- **UDP beacon** ([beacon.js](../farm/src/beacon.js)) — adapted from ComfyQ's `beacon.js`. Every
  `intervalSec` it sends the snapshot to the multicast group on each interface **+** each interface's
  directed broadcast **+** the limited broadcast `255.255.255.255` (deduped), with
  `setBroadcast(true)` + `setMulticastTTL(4)`. Group `239.255.43.10:41998` — distinct from ComfyQ.
- **Unicast `/lol/self`** ([selfServer.js](../farm/src/selfServer.js)) — a tiny `http` server on
  `41997` returning the snapshot JSON (CORS‑open). This is the fallback for managed/school Wi‑Fi that
  blocks broadcast+multicast between clients (where the UDP beacon never arrives but unicast works) —
  the shell's subnet sweep / "add by address" will probe it.
- Wired both into `lol up` ([up.js](../farm/src/commands/up.js)): a shared `getSnapshot()` closure
  over a `liveHealth` object that a 15s timer re‑probes (proxy liveness + per‑host reachability +
  loaded models), then re‑kicks the beacon — so advertised health stays honest. `shutdown` stops the
  beacon + self‑server + timer.

**Tested:** built [tools/listen.js](../farm/tools/listen.js) (a standalone listener that also doubles
as the reference for the shell's M3 client half). With `lol up` running: `GET /lol/self` returned the
snapshot, and the UDP listener **received the beacon** from `10.10.16.58` with the full snapshot
(`models=gemma4 healthy=true hostsUp=1/1`). Syntax‑checked all new modules; 10/10 unit tests still green.

**Still pending for M3:** the client half (beacon listener + connection UX) lives in the shell, built
alongside M0/M1.

---

## 2026-06-29 — M2: the `lol` farm CLI (+ integration research)

**What:** Built the whole farm backend (`farm/`) — a dependency‑light Node CLI that turns one
declarative `lol.config.json` into a running, OpenAI‑compatible, load‑balanced inference farm.
- **Config** ([config.js](../farm/src/config.js)) — a strict `zod` schema with materialized defaults;
  beacon group defaults to `239.255.43.10` (distinct from ComfyQ's `239.255.42.99`, per the spec).
- **LiteLLM generation** ([litellm.js](../farm/src/litellm.js)) — emits `model_list` as
  *models × hosts*, so every Ollama host is a deployment of the same `model_name` →
  LiteLLM's router load‑balances + fails over. Routing is **derived, never hand‑authored**.
- **Ollama client** ([ollama.js](../farm/src/ollama.js)) — `/api/version|tags|ps|pull` over plain
  HTTP, no SDK. `hasModel` tolerates an implicit `:latest`.
- **Commands** — `init`, `up`/`serve`, `down`, `status`, `models ls|add|rm|pull`. `up` runs in the
  foreground and writes `.lol-runtime.json` so `status`/`down` work from another shell; `down` clears
  that file *before* killing so a foreground `up` recognizes an intentional stop and exits 0 quietly.
- **Snapshot** ([snapshot.js](../farm/src/snapshot.js)) — the discovery contract built once
  (shared by the M3 beacon + `/lol/self`), `v:1 { id, name, proxyPort, ips, openaiBaseUrl, models,
  healthy, … }`. The beacon itself is **deferred to M3** per the plan (M2 only logs it).

**Tested — end‑to‑end on the dev box, real inference:**
- `npm test` → 10/10 unit tests (config validation, models×hosts generation, snapshot, helpers).
- `lol init` scaffolds a config in a fresh dir (and refuses to clobber an existing one).
- `lol up` → Ollama detected, `gemma4` present (no pull), LiteLLM config generated, proxy healthy,
  `/v1/models` lists `gemma4`. **`POST /v1/chat/completions` returned a real completion** routed
  LiteLLM → Ollama → gemma4. `lol status` (separate shell) shows the live proxy + loaded model;
  `lol down` stops it cleanly and `up` exits 0.

**Bug fixed (Windows):** LiteLLM crashed on startup with `UnicodeEncodeError` — its box‑drawing
banner can't encode on a cp1252 Windows console. Fix: spawn the proxy with `PYTHONUTF8=1` /
`PYTHONIOENCODING=utf-8` ([proc.js](../farm/src/proc.js)). This is a real, load‑bearing fix for any
Windows operator.

**Research landed:** a multi‑agent web‑research + fact‑check workflow produced
[docs/INTEGRATION_BRIEF.md](INTEGRATION_BRIEF.md). Headline facts the later milestones depend on:
- **Pin `open-webui==0.10.1`** (Python 3.11/3.12 only; run `open-webui serve --host --port` — the
  `PORT` env is *not* honored). Branding kept → license rider imposes nothing at any scale.
- **Config gotcha**: OWUI's `OPENAI_*` are PersistentConfig — env seeds only the *first* boot, then
  the DB wins. Decision for M1: **bake env + `ENABLE_PERSISTENT_CONFIG=false`** so env is always
  authoritative (the kiosk move), and set `ENABLE_OLLAMA_API=false`. Admin REST `POST /openai/config/update`
  exists but still needs an admin token even under `WEBUI_AUTH=false`, and only sticks while persistent
  config is on — so env‑authoritative is simpler and matches invariant #4.

**Decision — beacon group `239.255.43.10:41998`** (UDP) + `httpPort 41997` for the unicast `/lol/self`
fallback, all distinct from ComfyQ so both tools coexist on one LAN.

---

## 2026-06-29 — Scaffold (repo structure + tooling)

**What:** Bootstrapped the empty repo into the layout `CLAUDE.md` prescribes.
- `.gitignore` — excludes `node_modules`, build output, Python venvs, the generated LiteLLM
  config, the `lol.config.json` runtime file (example is kept), and — critically — any local
  `DATA_DIR` / `*.db` / `*.sqlite` so OWUI user data can **never** be committed (invariant #3).
- Root `README.md` — project overview, the three pieces, the prime directive, quick starts.
- `docs/DEVLOG.md` (this file) — the running build log.

**Environment confirmed on the dev box (Windows 11):**
- Node 24.14, npm 11.9 · Ollama 0.30.11 running on `127.0.0.1:11434` with `gemma4:latest` (9.6 GB).
- Python 3.12.10 available (used for LiteLLM + the OWUI sidecar; 3.14 is too new for OWUI).
- `gh` 2.92 authed to `b2renger/LlmOnLan`.

**Decision — work on `main`, granular commits.** This is a greenfield bootstrap, so per the
owner's "do everything in one path" direction the build proceeds on `main` with one tested +
documented commit per milestone (rather than per-feature PRs), so `git log` reads as the
milestone history.

**Tested:** structure only; nothing executable yet.

---
