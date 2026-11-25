# WSL_PORTS_PLAN: the farm keeps its panel and beacon ports when its own boot starts WSL

**Status: waiting on the owner** (night n° 17, 2026-11-26: found, measured, not built; summary n° 17's question 1).
Size **S**. Farm only (`farm/src/commands/up.js`).

## What happens (measured on the PRO 6000, 2026-11-26, DEVLOG 00:41 and the summary)

- This computer runs WSL in **mirrored networking** (`%USERPROFILE%\.wslconfig`, `networkingMode=mirrored`, set for
  another project). In that mode, **while WSL's VM runs, Windows reserves Linux's ephemeral port block, TCP and UDP**:
  no Windows program can bind a port in it, and nothing shows it (`netstat`, `Get-NetTCPConnection` and
  `netsh … excludedportrange` list nothing; WSL's `ss` lists no listener). The block is Linux's
  `net.ipv4.ip_local_port_range`, 4,096 ports, chosen **when the VM boots**, among ports free on Windows at that moment;
  it is released when the VM stops (`vmmemWSL` gone).
- Two true cold boots with nothing of ours holding a port (the VM's processes gone first, 00:43:09 and 00:44:37) both took
  **40525–44620**, as had tonight's first boots;
  a boot while a program held 41997 took 37795–41890. In 40525–44620 are the farm's **41997** (the panel and unicast
  discovery, TCP), **41998** (the beacon, UDP) and the client's **41995** (the Computer's MCP server): all three refused
  after those boots, all three free before.
- **The farm's own boot starts WSL before it binds them:** `lol up` asks WSL about a stale vLLM (`up.js` ~785, whenever
  `vllm.root` is set) and probes vLLM (`~803`) long before the panel binds (`~2001`, `startSelfServer`) and the beacon
  opens. With the VM stopped, that first WSL call boots it, the block lands on 41997/41998, and the farm runs with
  `[self] HTTP server error on :41997 — listen EADDRINUSE (unicast discovery + admin disabled)`: no panel (the Farm
  app's window shows it) and no unicast answer, while chats on port 4000 still work. The beacon's UDP 41998 is in the
  block too (a bind there was refused); what the beacon does then was not checked.
  The vLLM lifecycle suite hit exactly this tonight on its port 41897 (every step failed, then passed 182/182 once a
  WSL session held another block).
- **Not seen in production:** the PRO 6000's three boots since 2026-11-19 (`farm.log`) bound 41997. Likely WSL's VM was
  already running then, booted while something held a port in that block (the client's 41995, or another program).
  Not checked.

## The fix proposed (S)

1. `lol up` takes the panel's TCP port and the beacon's UDP port **on its first line, before any WSL call**, and hands
   them over where the real servers start (close, then the real `listen`/`bind` in the same tick). With the VM stopped,
   WSL then boots around them; with the VM already up on a block that covers them, the farm says so in one line naming
   WSL's block and the cure (quit WSL's other users, `wsl --shutdown`, start the farm again), instead of running blind.
2. A test: the order (the hold before the first `vllmMod` call, in the source, as the Farm app's tests check orders),
   and a scratch run with WSL's VM stopped first: the panel answers on its port.
3. The vLLM lifecycle suite checks its five ports first and names WSL's block when one is taken (a test fix, approved in
   advance; tonight cost half an hour).

## Not proposed

- New default ports (every installed client and its saved farms would lose the farm).
- `.wslconfig` changes (the owner's other project needs mirrored mode); a Windows port reservation (not measured).
- The client's 41995: only on a computer that also runs WSL in mirrored mode, and the Computer's MCP server is
  optional; noted, not planned.
