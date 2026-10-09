# Test scenarios — LlmOnLan v0.2.x

> **Moved, 2026-10-09.** Every check of this list that a person still has to do is now in
> [HUMAN_TESTS.md](HUMAN_TESTS.md), grouped by setup, with the release-blocking ones marked ★. This file keeps each
> scenario's number and where it went, or where it was verified, so old references still lead somewhere. The steps
> as they were (v0.2.0 to v0.2.9, §1–§8) are in git: `git show 3b8c0c1:docs/TEST_SCENARIOS_v0.2.md`. No box here was
> ever ticked; the verifications below were recorded in the DEVLOG and the night logs.

"Done (dev)" means checked on a real farm by a dev or packaged client run by an agent; what only a person can add is
in the HUMAN_TESTS test named after it.

## 1. Install, update, data

| # | Scenario | Status |
|---|---|---|
| 1.1 | Client auto-update | → C1 (v0.2.9 → v0.2.10), C5 (from v0.1.45), E1, E3 |
| 1.2 | History survives the update | → C1, C5 |
| 1.3 | Farm app update (farm-v0.0.39) | superseded: the next update is K1 |
| 1.4 | The engine update (Open WebUI 0.11.4) | done (dev) 2026-09-27 (NIGHT_LOG); an installed client updates its engine only from About → C3, A1 |
| 1.5 | The name LOL Vibe, old exports import | → C5 |
| 1.6 | Web search off by default | live-checked 2026-10-05 against throwaway Open WebUI servers; merged with 7d.1 → C3 |

## 2. The farm

| # | Scenario | Status |
|---|---|---|
| 2.1 | New plugins off by default | → A8 (Document search is on by default since 2026-10-08) |
| 2.2 | Turning one on does not block the farm | done (dev farm, CLI) 2026-09-27; from the panel → A8 |
| 2.3 | Password → plugin keys | done (dev) 2026-09-27; the keys changed since (2026-10-04, 10-07) → D14 |
| 2.4 | Restart keeps working | rewritten: a panel plugin switch lasts only until a restart → D14 |

## 3. The Computer — the new boxes

| # | Scenario | Status |
|---|---|---|
| 3.1 | The ? on every box | done (dev, all 38 examples) 2026-09-28; the same graph again → A10 |
| 3.2 | Read the news | done (dev, Classify off) 2026-09-28; with Laya → A8 |
| 3.3 | Fetch | partly done (dev) 2026-09-27 → A9 |
| 3.4 | Classify directly | Laya measured (dev) 2026-09-27; the box → A8 |
| 3.5 | Write code | presets done (dev) 2026-09-28; the code port flow → A10 |
| 3.6 | See what it drew | → A10 |
| 3.7 | Listen | Whisper measured (dev) 2026-09-27 → F2 |
| 3.7b | Ask out loud | → F2 |
| 3.7c | Microphone and webcam | → F1 |
| 3.8 | Speak | → F2 |
| 3.9 | d3 | → A10 |
| 3.10 | Open data | done (dev, live data.gouv.fr) 2026-09-27; the face text changed (*N read as a sample*) → A9 |
| 3.11 | Analyse a dataset | done (dev, gemma4 and qwen3.8) 2026-09-27/28; the cross-check and offline → A9 |
| 3.12 | Different models | rewritten for Qwen3.6 and gemma4:12b → A15 |
| 3.13 | The Agent | (a) and (b) done (dev, three models) 2026-09-27/28; (c) and the number → A9 |
| 3.14 | Ask a dataset | done (dev) 2026-09-27/28; your own question → A9 |
| 3.15 | Lessons 5 and 6 | lesson 5 done (dev, real model) 2026-09-28; lesson 6 → A11 |
| 3.16 | Lessons 7–12 | 11 and 12 done (dev) 2026-09-28; 7–10 → F7 |

## 4. Acting on the world

| # | Scenario | Status |
|---|---|---|
| 4.1–4.3 | Dry run, arming, disarm on reload | → F3 |
| 4.4–4.5 | Panic, the DMX cap | → F4 |

## 5. A board on the USB cable

| # | Scenario | Status |
|---|---|---|
| 5.1–5.4 | The sketch, Receive, Talk to a board, busy port | → F5 |

## 6. Boards on Wi-Fi — the farm's message bus

| # | Scenario | Status |
|---|---|---|
| 6.1–6.7 | The bus, an ESP32, Receive, Trigger, OSC, A board on Wi-Fi | → F6 |

## 7. Open WebUI drives the Computer (MCP)

| # | Scenario | Status |
|---|---|---|
| 7.1, 7.2 | The tool is there; a model builds a graph | done (dev) 2026-09-27/30; the installed app → A1 |
| 7.3 | Never the outputs | the HTTP server checked 2026-09-28; in a chat → G8 |

## 7b. LOL Vibe's IDE

| # | Scenario | Status |
|---|---|---|
| 7b.1 | Install | done from the v0.2.3 release (dev) 2026-09-29; the installed client → G1 |
| 7b.2–7b.4 | A project, it builds, it edits | done (qwen3.8) 2026-09-28; on Qwen3.6 → G2 |
| 7b.5 | You edit | → G3 |
| 7b.6 | Stop | → G4 |
| 7b.7 | Another model | nemotron is no longer served → G5 |
| 7b.8 | Nothing else leaves (password) | → G7 |
| 7b.9 | It stays in its project | done on Windows 2026-09-28 and 09-30; macOS/Linux → E4 |
| 7b.10 | History | Go back done 2026-09-28; the Save line → G3 |
| 7b.11 | Share on the LAN | → D12 |
| 7b.12 | GitHub | → G9 |
| 7b.13 | graphify | graph.json done (real runtime) 2026-09-28; the drawing → G10 |
| 7b.14, 7b.15 | Keep going, On a schedule | the runs done (qwen3.8) 2026-09-29; Stop and restart → G6 |
| 7b.16 | Use the Computer | the build done (qwen3.8) 2026-09-29; the dry run and the armed refusal → G8 |
| 7b.17 | An agent page | done (qwen3.8) 2026-09-30; Stop and a password → G7 |

## 7c. Home Assistant

| # | Scenario | Status |
|---|---|---|
| 7c.1 | Link | done on the demo home 2026-09-30 (the wrong token by unit test) → H1 on a real home |
| 7c.2–7c.4 | Ask, a dry run, allow | done on the demo home 2026-09-30 (DEVLOG "Verified on the rig") → H1 on a real home |
| 7c.5, 7c.5b, 7c.6 | Never; web search off; Stop | partly done 2026-09-30 → H1 |
| 7c.7 | An agent acts | done on the demo home 2026-09-30 → H2 on a real home |

## 7d. v0.2.8 and farm-v0.0.42

| # | Scenario | Status |
|---|---|---|
| 7d.1, 7d.2 | Web search off once; the date line | → C3 |
| 7d.3, 7d.4 | Web search reads the pages; its port taken | → C4, E4 |
| 7d.5 | The queue in the pill | → J6 |
| 7d.6 | Think all | → A15 |
| 7d.7 | An agent page waits for a seat | → D1 |
| 7d.8 | An agent page and a wrong password | → G7 |
| 7d.9 | The Farm app update (0.0.41 → 0.0.42) | superseded by the next update → K1 (its SearXNG check kept) |
| 7d.10 | The seat gate's answers | → D1 |
| 7d.11 | Only the routes clients use | raw-byte check done 2026-10-07 17:48 (operator-run vLLM) → J7 |
| 7d.12 | Seats against context, before Apply | → D13 |
| 7d.13 | The workshop setting | → D1 |
| 7d.14 | The reply limit | → J8 |
| 7d.15 | Plugin keys | → D14 |
| 7d.16 | vLLM on the Windows PRO 6000 (operator-run) | done 2026-10-07 17:48, then superseded by vLLM run by the farm → J |
| 7d.17, 7d.18 | vLLM on a DGX Spark; the GB10 clock | → L2 |

## 7e. v0.2.9 and farm-v0.0.43

| # | Scenario | Status |
|---|---|---|
| 7e.1 | The Farm app update | → K1 (now 0.0.43 → 0.0.44) |
| 7e.2 | A card too small | → K5 |
| 7e.3 | vLLM from nothing, on Windows | → K6; on the PRO 6000 → J1 |
| 7e.4 | Switch to vLLM and back | → J2 |
| 7e.5 | Its settings | → J3 |
| 7e.6 | Stop, Start, Quit, Share | → J5 |
| 7e.7 | Launch at login | → M1 |
| 7e.8 | The production take-over (PRO 6000) | superseded: the clean-state run (DEVLOG 2026-10-08 14:05) removed the operator-run vLLM; rehearsed with a scratch farm 2026-10-08 02:24; the reboot → M1 |
| 7e.9 | A DGX Spark | → L2, M2 |
| 7e.10 | Open WebUI starts once | → C2, B2 |
| 7e.11–7e.13 | No huggingface.co; a proxy; a download cut off | simulated end to end 2026-10-08 03:10 → B3, B4, B5 |

## 7f. Document search on the farm

| # | Scenario | Status |
|---|---|---|
| 7f.1 | It is on by itself | → K4 |
| 7f.2–7f.6 | A laptop with documents; a new one; nothing stays; a farm without it; a password | → I1, I2, I3, I4, I6 |
| 7f.7 | Beside vLLM | → J4 |
| 7f.8 | Many uploads | → I7 |

## 8. After testing

Now the closing note of [HUMAN_TESTS.md](HUMAN_TESTS.md) (turn off the plugins you do not want on for users).
