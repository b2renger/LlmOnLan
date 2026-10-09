# LOL Chat vNext: rig checklist (a human on real machines)

This checklist covered what the automated harness cannot prove, for LOL Chat vNext (P0–P2, S0, C1–C3, K3–K7). LOL
Chat is **LOL Vibe** since 2026-09-27.

> **Moved, 2026-10-09.** None of its 200 boxes was ever ticked. Every item a person still has to do is now in
> [HUMAN_TESTS.md](HUMAN_TESTS.md), with today's names (LOL Chat → LOL Vibe, Note → Text, Ask → Instruction, Render →
> Preview, the value popover → the drawer on the right, Reveal → Show folder, F1 → any Ollama farm, F2 → a llama.cpp
> farm with a password). Below, each section says where its items went, which were verified, and which no longer
> apply. The full old text, with every expected result as first written: `git show 3b8c0c1:docs/LOLCHAT_RIG_CHECKLIST.md`.

| § | Section | Where it went |
|---|---|---|
| 0 | Before you start | versions → write them on each HUMAN_TESTS test; v1 history and its backup → **C5**; switch threads mid-stream, relaunch reopens the chat → **A2**; `e2e.js` on a box with no client: a developer's check, never run since 2026-09-23 |
| 1 | Upgrade and migration | → **C5** (v0.1.45 → today: threads, no duplicates, Storage, uninstall/reinstall, a corrupt v1 key); fresh install → **B1**; the packaged build loads the modules → **A1** (the packaged `--dir` build was run 2026-09-28). **No longer apply** (history moved into the data folder, 2026-09-27; the import runs once): the rollback to v0.1.45, the rollback-new/rollback-appended merge, Remove bringing rollback chats over, "a data-folder move leaves history untouched" |
| 2.1 | Ollama farm | → **A2** (and E3 on Mac and Linux); reasoning panel → **A3** |
| 2.2 | llama.cpp farm with a password | → **D13** |
| 2.3 | External engine | → **A2** (the strip says `vllm` for the farm's own vLLM) |
| 3 | A shared farm, two laptops | seats → **D1**; Stop frees the engine, delete mid-stream, busy farm, renamed model → **D2** (the engines' Stop was measured on 2026-10-05); wrong password → **D13**; export on A, import on B → **D12**; Open WebUI + LOL Vibe on one seat → **D1**; think tags, a cut Thought → **A3** |
| 4 | Context | 100k paste, too long, 300+ messages → **A3**; 40+ turns on 16k, kill llama-server → **D13**; low-end laptop → **A17** |
| 5 | Images, documents, search | **Never built** (P3) and left to Open WebUI; drop outside the chat → **A6** |
| 6 | Blender | **Never built** in LOL Vibe (P3-U4); Blender stays Open WebUI's, Preferences ▸ Assistant tools |
| 7 | Offline, failures, quitting | quit, kill, temporary chat, offline LAN → **A5**; farm powered off, Wi-Fi roaming → **D8** |
| 8 | History tools | → **A4**; export all → import on B → **D12** |
| 9 | Recipes and structured output | **Never built** (P4) |
| 10 | Appearance, input, accessibility, platforms | → **A6** (and A2 for numbered steps, links, a stuck model); macOS and Linux → **E3**; Read aloud **never built** |
| 11 | Privacy and data locality | nothing on the farm disk → **A7**. **No longer apply:** "zero `/v1/embeddings`" (document search sends document text to the farm since 2026-10-08: **I3**), "history does not move" (it moves, 2026-09-27) |
| 12, 12.1 | Studio rails | the workbench, testable again through the Project panel → **A7**; vision probe → **A7**; v1 → v2 database on a real profile → **C5**; background lane → **D15**; OneDrive and Show folder → **A7**. **No longer apply:** projects left behind by a move (everything moves), the queue chip (nothing calls it). A developer's: the ask spine's rung, the strict harness flake. **Flag:** `project.json` is refused by the projects API but not by the coding agent's fence (read from the code, HUMAN_TESTS "Questions for the owner" 6) |
| 13 | The Computer (C1) | **Verified:** a program on the first try (the owner, 2026-09-23). The rest → **A11** (a typo, Stop, it survives the app, undo, the farm arriving late, a long answer, a big graph), **A13** (canvas size, keyboard, trackpad), **D15** (the seat belongs to the human) |
| 14 | The Computer, fanned out (C2) | → **A12**; a colleague's chat → **D15**; a slow machine → **A17**. **No longer apply:** From thread / To thread, the value inspector beside the conversation |
| 15, 15b | Code, pictures, files, sharing (C3) | **Verified:** Code on a real graph (every ? example on qwen3.8, NIGHT_LOG 2026-09-28 00:36). The rest → **A10**, **A11** (refusals, Tidy, export), **D12** (two machines), **A17** (a laptop GPU). **No longer apply:** Send a model's code to the Computer, a file dropped beside the composer, an export from a From thread part |
| 16 | Control flow (K3) | → **A11** (expect the resume banner too: built 2026-09-28) |
| 17 | The debug log (K7) | **Verified:** the file where the guide says (NIGHT_REPORT 2026-09-25). The rest → **A16** |
| 18 | After K4 | → **A13** (Live, Edit code, view keys), **A10** (a paused sandbox) |
