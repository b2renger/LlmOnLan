# The tools we pin, against their releases since 2026-11-14 (2026-11-20)

The owner's standing ask (2026-11-14): each session's research covers the updates of the tools we pin. The previous
pass: [TOOL_UPDATES_2026-11-14](TOOL_UPDATES_2026-11-14.md). Read by the `docs` explorer from the release pages, through
a summariser; **the vLLM 0.34.0 and Open WebUI 0.13.4 lines quoted below were read verbatim** with `gh api` (release
bodies and issue #34257). The pins were checked in the repo.

| Tool | Our pin | Newer (date) | For us |
|---|---|---|---|
| vLLM | 0.33.0 | **0.34.0** (2026-11-16) | Worth a trial: GDN speed for the Qwen3.5 line; two changed defaults (below) |
| Open WebUI | 0.13.3 | **0.13.4** (2026-11-17) | Worth the pin bump's smoke tests: repeated context lists no longer pile up (below) |
| LiteLLM | 1.106.9 | 1.106.12 … 1.110.2 (2026-11-19/20) | A `/key/info` fix for per-user keys, which the farm does not use; nothing to do |
| Ollama | v0.40.16 | v0.40.17-rc2 (pre-release) | Vulkan and MLX only; nothing for CUDA |
| llama.cpp | b12377 | up to b12559 (2026-11-20) | Not read past the visible notes (OpenCL); nothing seen for us |
| Electron | ^42.5.0 | 45.3.3 … 45.4.1, 46 alphas | 42 is past its end of life (2026-10-20, the schedule page); 45 stays plans ▸ Next 14 |
| python-build-standalone | 20261110 | none | Current |

## vLLM 0.34.0 (published 2026-11-16 23:22 UTC)

Verbatim from the release body:
- "Default `--block-size` is 64 (was 16) | Pass `--block-size 16` to keep the old behavior." For the hybrid Qwens vLLM
  sets the block from the recurrent state's page anyway (2,176 tokens on Qwen3.6, measured 2026-11-19); a trial says
  whether anything moves.
- "**Still deprecated:** `--mamba-cache-mode` has no effect; its removal was postponed (#64838)." The farm still passes
  `--mamba-cache-mode align` (`QWEN36_ARGS`, `QWEN38_ARGS`); it must drop it before a vLLM that refuses it
  (DEVLOG 2026-11-14 already said so).
- "GDN prefill state gather/scatter fused for Qwen3-Next/Qwen3.5 and Kimi KDA, 1.16–1.50× (#66064)"; "Faster GDN
  spec-decode updates (#64829)"; "Qwen3.5: breakable CUDA graphs instead of torch.compile (#51012)" with "3.0–8.8%
  lower decode ITL". Qwen3.6 and Qwen3.8 are Gated DeltaNet models; whether these paths cover them is for a trial to show.
- "**KV offload**: SimpleCPUOffload with one host buffer per rank and opt-in HugeTLB pages (#60130)". A tier in system
  memory for cached context; the flag that turns it on was not found in the notes (the docs page returned 404). A lead
  for long chats a class comes back to, not checked.
  > **Found 2026-11-21 (night n° 12), read in the installed 0.34.0 (`~/lol-vllm-034`):** `vllm serve
  > --kv-offloading-size <GiB>` turns it on (`engine/arg_utils.py:1472`; off while unset, `config/vllm.py:1078`), with
  > `--kv-offloading-backend native` (the default; `lmcache` the other) becoming the `OffloadingConnector` with
  > `cpu_bytes_to_use` = the size in bytes (`config/vllm.py:1088-1095`). Recurrent (Mamba / linear-attention) groups are
  > handled (`offloading/config.py:79`: "Mamba depends on a single state"), and hybrid models need
  > `--enable-prefix-caching` (`:117`), which `QWEN36_ARGS` and `QWEN38_ARGS` carry. vLLM's docs (the 0.34.0 usage
  > guide, read by an explorer, not checked here): hits in the CPU tier come back to the GPU on demand. **Not tried.**
  > For a class it would keep conversations evicted from the GPU's pool in the PRO 6000's system memory (94 GB) instead
  > of recomputing them: a trial (the replace and append runs at 128k past the pool, with and without it) before any
  > plan.

**Worth a trial** (a measurement, no farm change): a second trial root, Qwen3.6 and Qwen3.8 with the farm's flags, the
same suite as 2026-11-19/20 (one person, 30 people, 30 deep, quality, seats). Then a plan for the bump if it wins.

## Open WebUI 0.13.4 (published 2026-11-17 14:46 UTC)

Verbatim: "**Fewer repeated context lists.** With native function calling, the list of available skills and the
attached knowledge are no longer added to the chat again before every reply, only when they changed or after
compaction, and recalled memories already in the chat are not sent again, so long chats use fewer tokens and need
compaction later. [#34257]". The issue (#34257, closed) explains that in 0.13.1–0.13.3 these lists are synthetic tool
calls (`list_available_skills`, `list_attached_knowledge`, `recall_memories`) "added before every reply … and saved
with that reply. Every later request replays all of the saved copies": on a 128k window, its example reaches 120,000
tokens of repeated lists after 40 turns. **It is about those lists, not the whole-document text** that
`RAG_FULL_CONTEXT` puts into the newest user message (`utils/middleware.py:634-645` in 0.13.3), so it does not replace
CONTEXT_128K_PLAN's step 3. Whether our chats carry such lists on 0.13.3 is shown by that step's logging relay
(2026-11-20).

**Worth the pin bump** (invariant 5: one pin, rebuild, smoke tests, no LOL code change) once the relay shows what our
chats send; the rest of 0.13.4 is terminals, folders and coding-agent chats, which LlmOnLan does not use.

> **Corrected 2026-11-21 (night n° 12): wrong, the bump is blocked.** 0.13.4's own CHANGELOG, *Changed*: "**Direct
> connections move to Tether.** Settings > Connections and Settings > Tools are gone together with the Direct
> Connections and Direct Integrations switches … and the 'ENABLE_DIRECT_CONNECTIONS', 'ENABLE_DIRECT_INTEGRATIONS' and
> 'USER_PERMISSIONS_FEATURES_DIRECT_TOOL_SERVERS' settings, so models, tool servers and terminals that users added in
> their own settings no longer appear. Users add them in the Tether app … instead". Checked in the code (0.13.3 and
> 0.13.4 installed side by side): 0.13.3's `utils/middleware.py` reads `metadata['tool_servers']` (a person's own
> servers, lines 2432–2723) and `config.py:225` reads `ENABLE_DIRECT_INTEGRATIONS`; 0.13.4 has neither. LlmOnLan's
> opt-in **Blender tools** are such a server (the renderer writes `ui.toolServers` through the user-settings API), kept
> working on 0.13.3 by `ENABLE_DIRECT_INTEGRATIONS=true` at the owner's request (2026-11-14). On 0.13.4 they would
> vanish from chats without an error. The rest of the surface holds: of the 61 env names `configBridge.ts` sets, every
> other one is read the same in both (four are read by libraries, not Open WebUI, in both); `TOOL_SERVER_CONNECTIONS`
> (the Computer's) is read from env (`config.py:363`); `/user/settings/update` is there (`routers/users.py:502`);
> `owui_doc_check.sh` gives **PASS** (the document in the system message, one hash on all three turns). The image
> settings becoming connections does not touch us (the client sets no image env). **A question for the owner** (the
> session summary): stay on 0.13.3, or a plan to give Blender's server through `TOOL_SERVER_CONNECTIONS` (env, as the
> Computer's) before the bump.

## Not read

vLLM 0.34.0's KV-offload flag; the Open WebUI 0.13.3 security advisory's text; llama.cpp b12378–b12557; Electron's
release notes (only version metadata); LiteLLM 1.110.1's full body.
