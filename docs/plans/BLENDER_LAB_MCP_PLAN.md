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
       - `git ls-remote` reached the repository on 2026-11-27; the clone itself is not checked yet.
       - The site's web `raw/` route answers 403 to a script, but its API's raw route
         (`/api/v1/repos/lab/blender_mcp/raw/<path>?ref=<commit>`) answered on 2026-11-27. Its archive route may too.
       - If every route is refused, stop and ask.
     - The installer packs `shell/assets/**` (`electron-builder.yml`, `files`). The wheel goes there, committed, with
       Lab's licence file and a short note naming the repository and the commit. That is the GPL's source offer, and
       the wheel holds the Python source itself.
     - **`assets/` lands inside `app.asar`.** The yml sets no `asar` or `asarUnpack`, so the default packs it.
       Electron's own `fs` reads inside the archive; a spawned `pip` cannot.
       - The fix: `asarUnpack` for the wheel (one line in the yml), with the path taken from `app.asar.unpacked`, or
         a copy to the helper's folder before `pip install`.
       - The unit test installs from the path the packaged app would use, not the repo's, so a pass in development
         means a pass on a teacher's laptop.
     - If the wheel is too large to commit (above about 20 MB), stop and ask rather than choose another route.
     - The code pins the wheel's sha256 and installs it from that file. Its dependencies (`docutils`, `mcp[cli]`,
       `pyyaml`) still come from PyPI, as `mcpo`'s do today.
2. **Point it at Blender.**
   - `BLENDER_MCP_HOST=127.0.0.1` and `BLENDER_MCP_PORT=<Preferences ▸ Blender port>`, in place of `BLENDER_PORT`.
   - **The `_for_cli` tools stay off, whatever the laptop's PATH holds.**
     - Why: they run Python in a background Blender the person never opened, which would skip today's consent (Blender
       open, its server started, Online Access on).
     - **Leaving `BLENDER_PATH` unset is not enough.** Lab's helper reads `os.environ.get("BLENDER_PATH", "blender")`
       (`mcp/blmcp/tools_helpers/blender_cli.py:31-32` at `dbbf836`, read 2026-11-27). A laptop with Blender on its
       PATH (winget, scoop, by hand) would run them.
     - So, two layers:
       - `BLENDER_PATH` is set to a path inside the helper's folder that never exists. The helper then raises its own
         `RuntimeError` on `FileNotFoundError` (`blender_cli.py:78-81`), with no fallback.
       - The tools are also kept out of the list the chat sees, if `mcpo` or Open WebUI's connection settings can
         filter them (the same check as step 5's). If neither can, the first layer holds alone, and that is written down.
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
   - **First, check what the farm receives** after a screenshot tool call through `mcpo` and Open WebUI 0.13.3: a scratch
     Blender, and the request read at the scratch farm's gate. The model's answer is not the test.
     - **If the picture arrives as an image part** of the request: `privacy.md` gains its line in the commit that ships
       the tools, beside the Computer's pixels: *the Blender tools, when switched on in Preferences: a screenshot of the
       person's own Blender window or one of its areas, taken when the model calls the tool, sent with the request to
       the farm's model; kept only in the chat on this computer*.
     - **If it arrives in any other form**, base64 inside the tool's text for one: the pixels would still leave, and
       would flood the context. The tools are kept out of the chat. How (mcpo or Open WebUI's connection settings) is
       checked then; if neither can, stop and ask. No privacy line is added, and that is written down.

Not changed: how the tools reach Open WebUI (BLENDER_TOOLS_ENV_PLAN's env entry), the helper's loopback bind and its
key, the switch in Preferences, and the farm's *Recommend* for Blender.

## Tests

- **Unit:**
  - `mcpoSupervisor`'s environment carries `BLENDER_MCP_HOST` and `BLENDER_MCP_PORT`, and no `BLENDER_PORT`.
  - Its `BLENDER_PATH` names a path that does not exist, even with a `blender` on the test's PATH. Where the tools
    are filtered, no `_for_cli` tool is in the list.
  - The package list is pinned, and the wheel is installed from the packaged app's path, its sha256 checked.
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

## Built (night n° 19, 2026-11-28)

- **The wheel** (step 1):
  - cloned from Lab's repository (the clone worked) at `dbbf836`;
  - built in a scratch venv: `blender_mcp-1.0.2-py3-none-any.whl`, 5,948,590 bytes, 4,674 files, sha256 `c3045185…93a7ff`;
  - in `shell/assets/blender-mcp/` with Lab's `LICENSE` (GPL-3.0) and `SOURCE.md`;
  - unpacked from `app.asar` (`asarUnpack`, `paths.ts` `unpackedPath`);
  - the client checks the sha256 before installing it.
- **The pins** (mcpo, FastAPI):
  - `mcpo==0.0.20` and **`fastapi==0.139.0`**, as they ran here together on 2026-11-27.
  - Found: mcpo 0.0.20 passes `ssl_certfile` to `FastAPI()`, and FastAPI 0.165.0 (2026-11-18) refuses it, so mcpo
    could not start at all in a fresh venv.
  - mcpo 0.0.21 (2026-11-25) dropped that argument; it is the upgrade path, once it has run here.
  - A venv from the community helper is rebuilt from nothing (the marker changed).
- **Step 2:** `BLENDER_MCP_HOST`/`BLENDER_MCP_PORT`. `BLENDER_PATH` names `<mcp-tools>/no-background-blender/blender`,
  which never exists.
- **Step 5, keeping tools out:** mcpo 0.0.20's config mode (`--config`) mounts the server at `/blender` and drops its
  `disabledTools` (`main.py:522-528`: never listed, never callable). The list: the six `_for_cli` tools.
- **The screenshot tools: checked, then on** (04:00–04:05, the plan's step 5 test):
  - **The rig:** a real Open WebUI 0.13.3 (the released sidecar) given the compiled `buildSidecarEnv` with the
    `/blender` address; the real mcpo; a windowed scratch Blender on 19876; a fake farm that asks for
    `tool_get_screenshot_of_window_as_image_post`.
  - **The request after the tool:** `user` text, `assistant` (the call), `tool` text (74 characters: *Image file read
    successfully.*), then a new `user` message with a text part and one `image_url` part, a
    `data:image/png;base64` URL: 175,342 characters with a 200 kB cap, 1,012,066 with none (a 759 KB PNG of the
    scratch window). No pixels in any text.
  - **Kept:** Open WebUI keeps a copy in DATA_DIR's `uploads` (`<id>_generated-image.png`). mcpo's log and Open
    WebUI's hold none of its pixels (0 `iVBOR`). The farm's gate pipes the body with no size limit
    (`seats.js:367`).
  - **So:** the image-part branch. `HIDDEN_TOOLS` drops them, and `privacy.md` gains its line, worded to what was
    seen (the copy in `uploads`).
  - `get_screenshot_of_area_as_image` returns the same `Image` type (read in its source); it was not run.
  - `get_screenshot_of_window_as_json` describes the window's layout, no pixels.
  - Lab's server reads only those three variables and sends nothing anywhere (its source read).
- **The tool server through Open WebUI** (the advisor's check of the new `/blender` address):
  - Open WebUI 0.13.3 lists `server:lol-blender`.
  - The farm was offered 18 Blender tools with the eight then hidden, none of them among them.
  - `tool_search_manual_docs_post` reached mcpo with the key (`POST /blender/search_manual_docs 200`), and its
    result came back to the farm as text (the manual's *Add Cube*).
  - The renderer selects the server by its id (`server:lol-blender`), so the new address leaves no stale
    selection.
- **Step 3, the probe:** `util.ts` `probeBlender`. It sends the request without its zero byte first (only the
  community add-on answers that), then the zero byte (Lab's extension answers JSON ending in one). Its answer is
  *lab*, *community*, *other* or *none*. `tcpProbe` is gone.
- **Step 4, the words:** Preferences, GETTING_STARTED, the README (which also still said the tools reached Open WebUI
  through the user-settings API: since 2026-11-27 it is the env), `context/client.md`; A31 rewritten.
- **Tests:**
  - `shell-main`: three new, 101 in the file.
    - the env (and no background Blender, even with Blender on the PATH);
    - the config with its eight hidden tools;
    - the pins;
    - the wheel's sha256, `LICENSE` and `SOURCE.md`;
    - `unpackedPath` for a packaged and a development path;
    - `asarUnpack`;
    - the probe against four stand-ins (Lab, community, silent, closed).
  - TST-15 unchanged and passing.
- **Run on the PRO 6000 without a person** (03:33–03:38):
  - a scratch Blender 5.1.1: `BLENDER_USER_RESOURCES` in scratch, the extension installed there from the clone's
    `addon/`, `blender -b --online-mode --command blender_mcp --port 19876`;
  - the probe said `lab`;
  - mcpo started from the compiled `helperConfig`/`helperEnv`, serving 18 tools at `/blender` ("Filtered out 8
    tool(s)" by name);
  - `execute_blender_code` added a cube: `['Camera', 'Cube', 'Cube.001', 'Light']`;
  - a hidden tool answered 404, no key answered 401;
  - all stopped. The owner's Blender, profile and port 9876, and the owner's helper (`mcp-tools`), were not touched.
- **The build for the owner:** `shell\dist\LlmOnLan-Setup-0.2.21+n19-windows-x64.exe` (05:08, from `2707705`; the
  wheel is in `app.asar.unpacked`, same sha256), for HUMAN_TESTS A31.
- **Found after, fixed** (`9f17683`, 04:52): a start during the first install (the port field, the switch off and on)
  removed the venv the first pip wrote into; `ensureInstalled` now shares the running install (`shell-main` tests it).
- **Found after, fixed** (`2707705`, 05:06): an installer run over a running client stops the app, not its helper,
  and Windows keeps a running `.exe`: removing the old venv failed half-way (EPERM, reproduced). Each set of packages
  now has a venv of its own (`venv-<8 hex of the marker>`); old folders go when nothing runs from them. Run for real
  beside a running old helper (27 s); `shell-main` tests it.
