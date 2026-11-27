# BLENDER_LAB_MCP_PLAN: the Blender tools speak to Blender Lab's official MCP extension

**Status: approved by the owner, 2026-11-27.**
- Day question 4, "yes", the chat 14:23.
- The owner's words, 14:22: "I think we should use the 'official' blender lab MCP rather than the community one".
- The timing, 14:23: "We should do all that before releasing new farm and new client".
- The design below is the session's. **Its two questions, answered** (the chat, 16:04, "1 wheel, 2 yes"; DECISIONS):
  - Step 1's install route: **the wheel**, shipped inside the client (option b).
  - Step 5's screenshot tools: **allowed**, with their privacy line.
- The plan is built **whole**: Lab's env and probe beside the community server would leave `main` half-switched.

Size **M**. The client only: `shell/src/main/mcpoSupervisor.ts`, the Test connection in `shell/src/main/index.ts`, the
wheel and its licence in `shell/assets/`, the Preferences text, GETTING_STARTED, the README, and `privacy.md`'s line
for the screenshot tools.

## Why (HUMAN_TESTS A31, 2026-11-27; DEVLOG 14:10)

- **What the client runs today:** `mcpo` wrapping the community `blender-mcp` from PyPI (ahujasid's; 1.6.4 is
  installed on the PRO 6000). It speaks only to the community **BlenderMCP** add-on, which comes as a file from GitHub
  and is installed by hand.
- **What Blender 5.1 offers:** Blender Lab's own **MCP** extension, in one click from *Get Extensions*. The owner
  installed it, as a teacher would, and every call failed. The two speak different messages on the same port 9876.
- **Unpinned today:** `PACKAGES = ['mcpo', 'blender-mcp']` (`mcpoSupervisor.ts:38`), so a fresh install takes
  whatever PyPI's `blender-mcp` is that day. A source read on 2026-11-27 (not checked by hand) says it is now
  ahujasid's 2.0.0.

**Lab's project** ([projects.blender.org/lab/blender_mcp](https://projects.blender.org/lab/blender_mcp), read
2026-11-27; the server's files fetched and read, the add-on read from the PRO 6000's Blender):

| | Blender Lab |
|---|---|
| server | `mcp/` in the repo: distribution `blender-mcp` 1.0.2, `requires-python >=3.10`, deps `docutils`, `mcp[cli]>=1.2.0,<2`, `pyyaml`, entry point `blender-mcp = "blmcp:main"`, stdio by default. **Not on PyPI** (that name is ahujasid's). |
| where it finds Blender | env `BLENDER_MCP_HOST` (default `localhost`), `BLENDER_MCP_PORT` (default 9876) (`tools_helpers/connection.py`). **Not** our `BLENDER_PORT`. |
| messages | `{"type": "execute", "code": …, "strict_json": …}` then a zero byte; the reply `{"status": "ok", "result": …}` or `{"status": "error", "message": …}`, then a zero byte. No ping: the add-on takes only `execute`. |
| add-on | extension id `mcp`, maintainer Blender Lab, **1.0.3** on the PRO 6000, `blender_version_min = "5.1.0"`. Starts its server only when Blender's **Allow Online Access** is on (`__init__.py:38, 80`). Auto Start is on by default. |
| tools | code in the open Blender, scene summaries, screenshots of an area or the window, renders to a file, Blender's own API and manual searched offline, plus `_for_cli` twins that run a background Blender (env `BLENDER_PATH`, else `blender` on the PATH) |
| licence | GPL-3.0-or-later (LlmOnLan is MIT) |
| refs | no PyPI release; tags `v0.1.0`, `v0.3.0`, `v1.0.0`, `26.04.10`; `main` at `dbbf836` |

## The change

1. **Install Lab's server, pinned, in place of the community one.** `PACKAGES` becomes `mcpo` (pinned too) plus Lab's
   server at one commit. The marker changes, so a client that had the old helper installs the new one once.
   How the files reach a person's laptop is **the owner's question**:
   - **(a) from Lab's site at the commit:** `pip install "blender-mcp @ <archive of dbbf836>#subdirectory=mcp"`.
     Nothing of theirs is shipped by us. But on 2026-11-27 the archive URL answered **403** to a script, and the git
     route needs `git`, which a teacher's laptop does not have. To be tried again at the build; if it is refused, stop
     and ask.
   - **(b) a wheel built once from the commit and shipped inside the client installer** beside its licence and a link
     to its source, then installed from that file. No download from Lab's site at a person's install. It means we
     distribute a GPL-3.0 program, as a separate program the client starts, which the GPL allows with its licence and
     source.
   - Recommended: (b). The wheel's size is measured first (it carries Blender's API and manual as text).
   - **The owner chose (b), 2026-11-27 16:04.** How, for the build:
     - The wheel is built once from a clone of Lab's repository at `dbbf836` (`pip wheel --no-deps` of its `mcp/`).
       `git ls-remote` reached the repository on 2026-11-27; the clone itself is not checked yet. If it is refused,
       stop and ask.
     - The installer packs `shell/assets/**` (`electron-builder.yml`, `files`). The wheel goes there, committed, with
       Lab's licence file and a short note naming the repository and the commit. That is the GPL's source offer, and
       the wheel holds the Python source itself.
     - If the wheel is too large to commit (above about 20 MB), stop and ask rather than choose another route.
     - The code pins the wheel's sha256 and installs it from that file. Its dependencies (`docutils`, `mcp[cli]`,
       `pyyaml`) still come from PyPI, as `mcpo`'s do today.
2. **Point it at Blender.**
   - `BLENDER_MCP_HOST=127.0.0.1` and `BLENDER_MCP_PORT=<Preferences ▸ Blender port>`, in place of `BLENDER_PORT`.
   - **`BLENDER_PATH` stays unset**, so the `_for_cli` tools fail with their own message.
     - Why: they run Python in a background Blender the person never opened, which would skip today's consent (Blender
       open, its server started, Online Access on).
     - Turning them on would be a question for the owner, not a session's choice.
   - `DISABLE_TELEMETRY` stays harmless. Lab's server is read for any call outside the laptop before it is pinned (one
     pass over `mcp/blmcp/`).
3. **Test connection speaks to the add-on.**
   - It sends Lab's `execute` with empty code. A `{"status": "ok"…}` reply ended by a zero byte means *Blender's MCP
     extension ✓*.
   - Anything else names what it found: *the community BlenderMCP add-on (LlmOnLan now uses Blender's own MCP
     extension)*, *something else on port 9876*, or *nothing listening*.
   - This replaces the port-only check (`index.ts:1057`), the bug the owner's A31 reproduced.
4. **The words.** This replaces the hint written on 2026-11-27 (`5932690`, "not Blender's own MCP extension"), which
   the owner's decision reverses. The Preferences hint, GETTING_STARTED ▸ *Control Blender from the chat* and the
   README now say:
   - Blender **5.1 or later**; *Edit ▸ Preferences ▸ Get Extensions*, search **MCP** (Blender Lab), install;
     *System ▸ Network ▸ Allow Online Access* on (the extension asks for it); its server starts by itself.
   - What is lost: Blender before 5.1 is no longer supported.
5. **Tools Open WebUI shows.** Lab's tools replace the community ones in the chat's list (the server's own names).
   - **The screenshot tools: allowed by the owner, 2026-11-27 16:04**, with a privacy line. They send pixels of the
     person's Blender window to the farm's model. `docs/context/privacy.md` lists only the Computer's Image and Preview
     pixels today.
   - **First, check that their picture reaches the model** through `mcpo` and Open WebUI 0.13.3 (a scratch Blender, a
     screenshot tool call, the model asked what it sees).
     - If it does: `privacy.md` gains its line in the commit that ships the tools, beside the Computer's pixels: *the
       Blender tools, when switched on in Preferences: a screenshot of the person's own Blender window or one of its
       areas, taken when the model calls the tool, sent with the request to the farm's model; kept only in the chat on
       this computer*.
     - If it does not reach the model: the tools are kept out of the chat. How (mcpo or Open WebUI's connection
       settings) is checked then; if neither can, stop and ask. No privacy line is added, and that is written down.

Not changed: how the tools reach Open WebUI (BLENDER_TOOLS_ENV_PLAN's env entry), the helper's loopback bind and its
key, the switch in Preferences, and the farm's *Recommend* for Blender.

## Tests

- **Unit:**
  - `mcpoSupervisor`'s environment carries `BLENDER_MCP_HOST` and `BLENDER_MCP_PORT`, and no `BLENDER_PORT`.
  - The package list is pinned.
- **Unit, the Test connection probe** against three stand-in sockets on loopback:
  - Lab's reply (zero-byte JSON);
  - the community add-on's (bare JSON to `execute`);
  - a port that accepts and says nothing.

  Each gives its sentence.
- **On the PRO 6000, without a person:**
  - **A scratch Blender:** the session starts a Blender of its own, with a scratch user profile (its own config and
    extensions folders, the extension installed there from the repo's `addon/` at the pinned commit) and another
    port.
  - **Never the owner's:** not the owner's Blender, profile or port 9876.
  - **The check:** wrap Lab's server in `mcpo` as the client does, list the tools, and run `execute_blender_code`
    with *add a cube*.
  - If a scratch profile cannot start the extension's server, that is written down, and the check waits for A31.
- **HUMAN_TESTS A31 rewritten** for the extension, about 10 minutes:
  - Get Extensions ▸ MCP, Allow Online Access, Test connection: *Blender's MCP extension ✓*.
  - *Add a red cube and a sun lamp*: both appear.
  - The screenshot tools (allowed, step 5), if their picture reaches the model: *What do you see in the viewport?*
    The answer names the cube and the lamp.

## Done when

The unit tests pass, the run on the PRO 6000 adds a cube through `mcpo`, the screenshot check is written down (with
`privacy.md`'s line if the picture reaches the model), the words are changed in the three places, A31 is rewritten,
and the plan's built section names the build the owner tests.
