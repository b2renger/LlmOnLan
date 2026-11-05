# LlmOnLan's documents — the map

*Sorted on 2026-11-05: plans apart from documentation, and what is done in the archive.*

**Start here:** [GETTING_STARTED.md](GETTING_STARTED.md) — install the client, run a farm, the Farm app.

## For people who use or run LlmOnLan

| Document | For | What it is |
|---|---|---|
| [GETTING_STARTED.md](GETTING_STARTED.md) | everyone | Install, first chat, running a farm, troubleshooting |
| [LOLCHAT_COMPUTER_TUTORIAL.md](LOLCHAT_COMPUTER_TUTORIAL.md) | Computer users | The Computer, box by box, with the lessons |
| [LOLVIBE_IDE_GUIDE.md](LOLVIBE_IDE_GUIDE.md) | LOL Vibe users | The IDE: projects, the coding agent, history, sharing |
| [HOME_ASSISTANT.md](HOME_ASSISTANT.md) | people who link a home | Linking Home Assistant, what a model may do with it |
| [COMPUTER_DEBUG_LOG.md](COMPUTER_DEBUG_LOG.md) | bug reporters | Recording a Computer session for whoever fixes a bug |
| [../farm/README.md](../farm/README.md) | operators, developers | The farm: engines, the panel, every config key |
| [../farm-app/README.md](../farm-app/README.md) | operators | The Farm app |

## For the people who build it

| Document | What it is |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | The project's rules, the Open WebUI contract and the map of the code |
| [DEVLOG.md](DEVLOG.md) | The dated build log: what changed, why, how it was tested, every release |
| [HUMAN_TESTS.md](HUMAN_TESTS.md) | What a person must still check on real machines; ★ = before the next release |
| [plans/](plans/) | **Open plans only**, and [plans/README.md](plans/README.md): the next work, in order |
| [INTEGRATION_BRIEF.md](INTEGRATION_BRIEF.md) | Open WebUI's version-specific facts (a dated snapshot, plus the notes of each pin bump) |
| [../shell/README.md](../shell/README.md), [../sidecar/README.md](../sidecar/README.md) | The client and the Open WebUI bundle |
| [../shell/test/chat/README.md](../shell/test/chat/README.md) | The client's test suites and how to run them |

## Folders

- **[plans/](plans/)** — plans still being worked on. When a plan's work is done, it moves to the archive and its
  few leftovers go to [plans/README.md](plans/README.md), so nothing open is hidden there.
- **[archive/](archive/)** — kept for history, not kept up to date. Each file starts with a note saying what
  replaced it. `archive/plans/` holds the executed or replaced plans, visions, specs and studies; `archive/testing/`
  the four checklists HUMAN_TESTS replaced on 2026-10-09; `archive/logs/` the night logs; the rest are dated reports
  and runbooks.
- **[reviews/](reviews/)** — critic and consistency reports, dated. Tests cite some of them.
- **[research/](research/)** — dated research and spikes for the Computer and the coding agent.
- **[spike/](spike/)** — the capacity measurements (vLLM and llama.cpp, PRO 6000 and DGX Spark). The farm's
  capacity page and its estimator are built from them, so these paths stay put.
- **[examples/](examples/)** — example graphs and Arduino sketches. Tests and a template generator read them.
- **[img/](img/)** — screenshots for the DEVLOG's early entries.
