# BLENDER_LAB_MCP_PLAN: the Blender tools speak to Blender Lab's official MCP extension

**Status: approved by the owner, 2026-11-27.**
- Day question 4, "yes", the chat 14:23.
- The owner's words, 14:22: "I think we should use the 'official' blender lab MCP rather than the community one".
- The timing, 14:23: "We should do all that before releasing new farm and new client".
- The design below is the session's. **Step 1's install route is a question for the owner** (it ships GPL code, or
  depends on a download a script may be refused). The rest may be built once it is answered.

Size **M**. The client only: `shell/src/main/mcpoSupervisor.ts`, the Test connection in `shell/src/main/index.ts`, the
Preferences text, GETTING_STARTED and the README.

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
2. **Point it at Blender.**
   - `BLENDER_MCP_HOST=127.0.0.1` and `BLENDER_MCP_PORT=<Preferences ▸ Blender port>`, in place of `BLENDER_PORT`.
   - `BLENDER_PATH` set to the `blender.exe` found in the usual places (`Program Files\Blender Foundation\*`), else left
     unset, so the background tools fail with their own message.
   - `DISABLE_TELEMETRY` stays harmless. Lab's server is read for any call outside the laptop before it is pinned (one
     pass over `mcp/blmcp/`).
3. **Test connection speaks to the add-on.**
   - It sends Lab's `execute` with empty code. A `{"status": "ok"…}` reply ended by a zero byte means *Blender's MCP
     extension ✓*.
   - Anything else names what it found: *the community BlenderMCP add-on (LlmOnLan now uses Blender's own MCP
     extension)*, *something else on port 9876*, or *nothing listening*.
   - This replaces the port-only check (`index.ts:1057`), the bug the owner's A31 reproduced.
4. **The words.** The Preferences hint, GETTING_STARTED ▸ *Control Blender from the chat* and the README now say:
   - Blender **5.1 or later**; *Edit ▸ Preferences ▸ Get Extensions*, search **MCP** (Blender Lab), install;
     *System ▸ Network ▸ Allow Online Access* on (the extension asks for it); its server starts by itself.
   - What is lost: Blender before 5.1 is no longer supported.
5. **Tools Open WebUI shows.** Lab's tools replace the community ones in the chat's list (the server's own names).
   - Whether a screenshot tool's image reaches the model through `mcpo` and Open WebUI 0.13.3 is checked at the build.
   - If the image does not come through, the tool stays and its result is text, and that is written down.

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
- **On the PRO 6000, without a person:** Blender 5.1.1 with the extension is installed here. The session may start a
  Blender of its own (a background `blender.exe` with the extension's server; never the owner's open Blender, and
  only if Blender allows a second instance with the add-on), wrap Lab's server in `mcpo` as the client does, list the
  tools, and run `execute_blender_code` with *add a cube*.
- **HUMAN_TESTS A31 rewritten** for the extension, about 10 minutes:
  - Get Extensions ▸ MCP, Allow Online Access, Test connection: *Blender's MCP extension ✓*.
  - *Add a red cube and a sun lamp*: both appear.
  - A screenshot tool: the model describes the viewport, or the plan says why not.

## Done when

The unit tests pass, the run on the PRO 6000 adds a cube through `mcpo`, the words are changed in the three places,
A31 is rewritten, and the plan's built section names the build the owner tests.
