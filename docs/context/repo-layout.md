# Repo layout

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

## Repo layout

```
LlmOnLan/
  shell/                 # Electron + TypeScript — first-party client code
    src/main/            #   index (boot/IPC/selection), sidecar, sidecarManager, configBridge, discovery,
                         #   store, paths, util, types, dataMigration, clientData (the window's session
                         #   in DATA_DIR/lol-client), updater, mcpoSupervisor,
                         #   farmSelect (pure farm choice), clientMode.ts; projects/projectsPath/debugLog = the Computer's;
                         #   studio + projectGit (the IDE's agent and history), mcp + comfyqPrompts + homeAssistant +
                         #   webSearch (the MCP listener on 127.0.0.1:41995), io + outputs + serial (the Computer's doors)
    src/preload/
    renderer/            #   index.html + app.js (topbar, webview host, prefs); tokens.css (ComfyQ palette)
      chat/              #   LOL Vibe + the Computer — ES modules, no build; IndexedDB `lol-chat` (in DATA_DIR/lol-client)
        main.mjs         #     LOL Vibe entry (+ app/ core/ ctx/ net/ render/ state/ ui/ strings/ css/)
        computer/        #     the Computer surface: layout, library, run bar, drawer (+ code editor),
                         #     host (session/runner/canvas), drops/intake/media, devlog + recorder,
                         #     tutorial/ (Learn shelf, rail, lessons), templates/
        graph/           #     engine + canvas: model, topo, runner, bind, undo, serialize, canvas.mjs,
                         #     wires, palette, parts/ (one file per box type)
        sandbox/         #     host.mjs (the ONLY iframe maker), runner.html (opaque-origin guest,
                         #     lol.orbit), protocol.mjs, lib/ (vendored three / p5 / matter / d3)
        projects/        #     the IDE: agent, bridge, models, schedule, memory, linediff
        design/          #     svg-sanitize.mjs
    test/                #   unit.js, chat-unit.js (+chat/unit), chat-lint.js, chat-scope.js (not a gate), asar-probe.js,
                         #   chat-harness/ (chat-only Electron over CDP), mock-farm.js (+mock/), e2e.js (legacy)
    assets/              #   icon.png / icon.svg
    scripts/             #   release.mjs, afterPack.cjs (adapted from ComfyQ), gen-board-templates.cjs,
                         #   gen-comfyq-prompts.cjs (ComfyQ's workflow bundles → src/main/comfyqPrompts.json)
    dsh/                 #   the coding agent's runtime: build-runtime.mjs + a committed lockfile
                         #   (CI's dsh-runtime-<platform>-<arch>.tar.gz)
    electron-builder.yml
  farm-app/              # the operator-facing Farm app (Electron) — installs + supervises `lol`
    src/main/            #   installer (setup wizard) + copyTree (the update's copy), farmSupervisor + farmProcess (lol down, the reap), runtimeManager, updater
    test/                #   supervisor.test.js (npm test: lol down before the kill, keepEngine, the reap, the Linux autostart entry),
                         #   copytree.test.js (the update's copy over a held file, run under Electron's own Node)
    renderer/            #   status chrome + Settings + the admin panel in a <webview>
    electron-builder.yml #   ships `../farm` as an extraResource, without what a dev checkout's `lol up` wrote there
                         #   (venvs, models, the config and its backups: the list is installer.ts FARM_COPY_SKIP's,
                         #   checked by supervisor.test.js; 2026-11-05, farm-v0.0.52); tags are `farm-v*`
  sidecar/               # packaging of the pinned, UNMODIFIED Open WebUI
    OPENWEBUI_VERSION    #   single source of truth for the pin
    build-sidecar.*      #   fetches OWUI at the pin + bundles a self-contained executable
  farm/                  # the `lol` CLI (Node) + beacon — the backend, NOT shipped to clients
    bin/lol.js           #   CLI entry
    src/                 #   beacon.js, selfServer.js (+ admin/ panel page, capacity/ the Plan capacity page), snapshot.js, seats.js,
                         #   plugins/ (registry), pysvc/ (the OCR, Classify and speech-to-text services), extract.js,
                         #   embed.js (document search), stt.js, classify.js, kokoro.js, searxng.js, bus.js,
                         #   llamacpp.js/gguf.js, vllm.js, storage.js (where the models are; Move here), ollamaApp.js (the
                         #   Ollama app's Model location), presets.js, proxy.js, systemInfo.js,
                         #   litellm.js/ollama.js, config.js (every default), configFile.js, commands/ (up/down/install/...)
    contract/            #   snapshot.schema.json — the beacon / GET /lol/self shape; farm + shell tests check it
    vllm/                #   the vLLM scripts the farm drives (serve/stop/install/status.sh, relay.py, test_scripts.sh) —
                         #   also the operator recipe (start-windows.ps1, lol-vllm.service)
    test/                #   run.js (npm test: the unit suite), litellm-cancel.js (Stop reaches the engine, a real
                         #   LiteLLM), vllm-lifecycle.js (LOL_VLLM_FAKE=1), fake-ollama.js, fake-vllm/ (stands in for
                         #   vLLM), fixtures/
    bench/               #   Ollama Modelfiles of the Qwen3.8-27B quants measured for the preinstall pick (the method
                         #   and data: the bench/quant-ladder branch)
    litellm/             #   generated config.generated.yaml lives here at runtime
    README.md            #   prereqs (Ollama, LiteLLM) + usage + the full config reference
  docs/                  # README (the map), the living docs: DEVLOG (dated build log), HUMAN_TESTS, GETTING_STARTED,
                         # INTEGRATION_BRIEF, the guides (LOLCHAT_COMPUTER_TUTORIAL, LOLVIBE_IDE_GUIDE, HOME_ASSISTANT,
                         # COMPUTER_DEBUG_LOG)
    plans/               #   open plans only, and README (the next work, in order)
    archive/             #   what is done, not kept up to date: plans/ (executed plans, visions, specs, studies),
                         #   testing/ (the checklists HUMAN_TESTS replaced), logs/ (night logs), dated reports,
                         #   DEVLOG_2026-06_to_09.md (the DEVLOG's entries before 2026-10-01)
    reviews/             #   critic and consistency reports, dated
    research/            #   dated research and spikes (the Computer, the coding agent)
    spike/               #   the capacity measurements the capacity page is built from (paths stay put)
    examples/            #   example graphs and Arduino sketches (tests and a template generator read them)
    img/                 #   screenshots for the DEVLOG's early entries
  .github/workflows/release.yml              # client, on `v*` tags
  .github/workflows/release-farm.yml         # Farm app, on `farm-v*` tags
  .github/workflows/build-llamacpp-arm64.yml # the Spark's llama-server tarball (on a pin bump)
  .github/workflows/build-dsh-runtime.yml    # a dry run of the coding agent's runtime on every platform (publishes
                                             # nothing; release.yml builds it)
  .claude/               # how Claude Code works here: agents/ (the Haiku explorers search, grep, docs), skills/
                         # (lol-session, lol-review, lol-scratch-farm), settings.json (Sonnet runs, Opus advises)
  CLAUDE.md, README.md, LICENSE
```

Since 2026-11-12, under `docs/`: `context/` (these modules, split out of CLAUDE.md) and `sessions/` (one dated summary per
work session, the thread the owner and Claude share).
`sidecar/` must never contain edited Open WebUI source — that enforces invariant #1 structurally.
