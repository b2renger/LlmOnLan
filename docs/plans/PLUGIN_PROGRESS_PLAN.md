# PLUGIN_PROGRESS_PLAN: the panel says what a plugin downloads, and how far it has got

**Status: approved by the owner, 2026-11-27.**
- The ask (the chat, 14:06, after HUMAN_TESTS J21 step 1): "we probably need some feedback about what is happening in
  the download and give the farm operator proper information (including the download progress)".
- The timing (14:23): "We should do all that before releasing new farm and new client".
- The design below is the session's. The owner may overturn it before the build.

Size **S–M**. The farm only: `farm/src/commands/up.js`, `farm/src/plugins/registry.js`, the plugin modules and the
panel's page. No new dependency, nothing new leaves the farm.

## Why

Turning **Classify (Laya)** on for the first time fetched about 1.7 GB on the PRO 6000, and for minutes the panel showed
only `…` on the button:
- torch for the CPU, 0.9 GB;
- Laya's packages;
- Laya's weights, 0.8 GB, at its first start.

What the farm does today:
- `pluginAct` in `farm/src/admin/index.html:1794` sends `POST /lol/admin/plugin/<id>/enable`, and the request stays
  open for the whole install, because `setPlugin` in `up.js:2750` awaits `bringUp`.
- The steps go only to `farm.log` (`classify.js:82-87`, `pip install -q`).
- The weights are fetched by the service itself at its first start, with no report at all.

The same holds for the other plugins that install on first use: Voice (Kokoro, several GB), Document OCR, Speech to
text, Document search.

The panel already shows long work well. Its job bar (`barOf`, `index.html:975`) gives a label, a step, the bytes against
a total, the speed, the time left, and *running for …* when there are no bytes. vLLM's install and the model downloads
use it through `runJob` / `runDownload` (`up.js:363-393`). The plugins do not.

## The change

1. **A plugin that is not installed turns on as a panel job.**
   - `setPlugin(id, true)` checks `svc.installed(config)`. If it is not installed, the work runs in
     `runJob('plugin', 'Turning on <label>', …)`, and the request returns at once with `{ok, started, job}`.
   - The panel shows the job bar it already draws, and the button reads *Installing…* until the job ends.
   - An installed plugin turns on as today, in seconds, and turning one off is unchanged.
   - The job takes the farm's one job slot. That is right, since an install and an engine switch should not run
     together: `busy()` refuses the second, as it does today.
2. **Each install reports its steps and its bytes.** `ensure(config, ctx, progress)` passes an optional `progress`
   into each plugin's ensure.
   - Steps become the job's message, for example: *Creating its Python environment* → *Installing torch (CPU build,
     ~0.9 GB)* → *Installing Laya 0.3.20* → *Downloading Laya's weights (~0.8 GB)* → *Starting Classify*.
   - The bytes are the plugin's folder growing on disk (its venv during `pip`, its Hugging Face cache during the
     weights), read every 2 s, against an expected size per step. These sizes are measured once on a scratch farm and
     kept as constants. The bar stops at 99 % until the step ends.
   - `ponytail:` the sizes are measured on Windows and will drift with each pin. The upgrade path is pip's
     `--report`, or a `HEAD` of each wheel.
   - `pip -q` stays: pip's own bars are written for a terminal.
3. **Classify's weights download in the install, not at the first start.** The install runs a one-line
   `huggingface_hub.snapshot_download` with the cache the service uses (`storage.js`: the farm's model folder, else
   the shared cache), so the bar covers them. The first start then only loads them (13.7 s on the dev box's CPU). The
   same applies to Speech to text's Whisper model where its install already fetches it (`stt.modelOnDisk`).
4. **The end says what happened.**
   - On success: *Classify up — the Computer's Classify box works on this farm* (the plugin's own health line), and
     the toast as today.
   - On failure: the job ends red with the step that failed (*Installing torch failed: …*) and *see the farm log*.
     The plugin stays off, as today.
5. **No Stop button in this plan.** Stopping `pip` halfway leaves a half-built venv, which the next install has to clean
   up. A later plan can add it, with that clean-up.

Not changed:
- The boot path. A plugin installing at a farm's start keeps its log lines, and the start bar already says the farm is
  starting.
- The client.
- What a plugin installs, and from where.

## Tests

- `farm/test/run.js`:
  - A stand-in plugin whose `installed()` is false and whose ensure reports two steps with bytes: `setPlugin` answers
    `{started: true}` at once, and the job's view carries the label, each step's message and the bytes against the
    total, then ends `ok`.
  - An installed plugin turns on without a job.
  - A failing ensure ends the job with its step's error, and the plugin off in the config.
- The sizes: measured on a scratch farm from the repo's `farm/` (the plugin folders are `farm/.classify`, `farm/.kokoro`,
  … beside the code, so the Farm app's own copy is not touched): one install of each plugin, its folder's size at each
  step, written in the DEVLOG.
- **HUMAN_TESTS J22**, the PRO 6000, about 5 minutes:
  - Turn on a plugin that has never been installed there (*Speech to text*, off today).
  - Expected: the job bar names each step, the bytes grow towards the total, it ends with the plugin's *up* line, and
    chats go on meanwhile.

## Done when

The three `run.js` tests pass, the farm suite is whole, the sizes are measured, J22 is written, and the plan's built
section names the build the owner tests.
