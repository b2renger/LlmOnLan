# Session review of 2026-11-24 (night n° 15)

*The third adversarial review (the skill `lol-review`). Scope: the 134 commits since the last review's
(`b0ecae8`, [SESSION_REVIEW_2026-11-19](SESSION_REVIEW_2026-11-19.md)), sessions n° 11 to n° 14 and the day work of
2026-11-23, **unreleased work first** (the farm: Qwen3.8's 16-bit state, 128k by default, the panel's bar and its
note, `serve.sh`'s kernel folders); then what v0.2.20 brought (released 2026-11-23: Plan first and its buttons, the page
beside its code, the document read once per chat, the Computer's lost wake-up). The area in depth, in rotation after
the farm: **the client shell and Open WebUI's contract**. Beside it, while the card was free: J19's measured parts and
FARM_START steps 3 and 4 measured (the owner's yes, 2026-11-23 12:11). The Farm app was off at 02:00 and stayed off.*

**How it ran:** (in progress)

## Findings, by severity

(in progress)

## Questions (suspicions not proved)

## Checked and found sound

- **Open WebUI's contract, the one change since the last review:** `configBridge.ts` adds one env var,
  `RAG_SYSTEM_CONTEXT` (follows `RAG_FULL_CONTEXT`); no new call into Open WebUI. The released sidecar's Open WebUI
  (0.13.3, v0.2.19's asset, the same as v0.2.20's manifest) reads it (`open_webui/env.py:362`, used in
  `utils/middleware.py:780, 4813`); `owui-contract.md:29` and INTEGRATION_BRIEF list it.
- **The panel's bar during a vLLM start** (FARM_START step 2), seen in a real panel (headless Edge, the test farm,
  02:02): *running for 43s · If vLLM writes nothing for 10 minutes, the farm stops it by itself.*, the phase *loading
  the model weights (1 of 3) · 33%* ([shot](shots-2026-11-24/panel-vllm-start.png)).
- **The test farm wrote nothing into the Ollama app's models folder** (the last review's M1): `gemma4:12b` there is
  the one of 2026-11-18; the start's output has no pull.
