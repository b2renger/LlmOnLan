# Blender Lab's MCP server, as LlmOnLan ships it

`blender_mcp-1.0.2-py3-none-any.whl` is Blender Lab's MCP server, unchanged, built from its source:

- **Source:** https://projects.blender.org/lab/blender_mcp, commit `dbbf836ad4b1025f14a2b3b504c43903f39e0b04`
  ("Include GPL3+ license"), its `mcp/` folder.
- **Licence:** GPL-3.0-or-later, in `LICENSE` beside this file (the repository's own). The wheel holds the Python
  source itself.
- **Built** on 2026-11-28 (night n° 19):
  - `git clone https://projects.blender.org/lab/blender_mcp.git`, `git checkout dbbf836…`;
  - in a fresh Python 3.12 venv, `pip wheel --no-deps ./mcp -w out`;
  - 5,948,590 bytes, 4,674 files;
  - sha256 `c304518555427a29eb1be08f63601f94e4db0a0a4f4b43caaf76e8c14d93a7ff`, checked by the client before it installs
    it (`src/main/mcpoSupervisor.ts`).
- **Why it is shipped:** it is not on PyPI (the name `blender-mcp` there is another project's). The owner chose to ship
  it inside the client on 2026-11-27 ([BLENDER_LAB_MCP_PLAN](../../../docs/plans/BLENDER_LAB_MCP_PLAN.md)).
- **How it runs:** a separate program the client starts, in its own Python environment, behind `mcpo` on this computer
  only. It speaks to Blender Lab's **MCP** extension inside the person's Blender (5.1 or later).
