# WSL_PORTS_PLAN: the farm keeps its panel and beacon ports when its own boot starts WSL

**Status: approved by the owner, 2026-11-26** (summary n° 17, question 1: "yes", the chat 08:52; found and measured
night n° 17, not built; a bug a run reproduces, so approved in advance before that).
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
  app's window shows it) and no unicast answer, while chats on port 4000 still work. ~~The beacon's UDP 41998 is in the
  block too~~ **Corrected 2026-11-27:** the farm's beacon binds no fixed port (`beacon.js`: `socket.bind()` takes an
  ephemeral one and sends *to* 41998), so it is not exposed; only a coordinator's peer listener binds UDP 41998
  (`discoverPeers`, at boot), and a **client** binds it to hear beacons (`shell/src/main/discovery.ts:344`).
  The vLLM lifecycle suite hit exactly this tonight on its port 41897 (every step failed, then passed 182/182 once a
  WSL session held another block).
- **Not seen in production:** the PRO 6000's three boots since 2026-11-19 (`farm.log`) bound 41997. Likely WSL's VM was
  already running then, booted while something held a port in that block (the client's 41995, or another program).
  Not checked.

## The fix proposed (S)

1. `lol up` takes the panel's TCP port (~~and the beacon's UDP port~~: the beacon binds none, above) **on its first
   line, before any WSL call**, and hands it over where the real server starts (close, then the real `listen`/`bind` in the same tick). With the VM stopped,
   WSL then boots around them; with the VM already up on a block that covers them, the farm says so in one line naming
   WSL's block and the cure (quit the programs that use WSL, or restart the computer, then start the farm again: no
   command, an operator does everything from the app), instead of running blind.
2. A test: the order (the hold before the first `vllmMod` call, in the source, as the Farm app's tests check orders),
   and a scratch run with WSL's VM stopped first: the panel answers on its port.
3. ~~The vLLM lifecycle suite checks its five ports first and names WSL's block when one is taken~~ **done the same
   night** (`66a82c3`, a test fix approved in advance): checked failing on 41897 with WSL on 40525–44620.

## Built (night n° 18, 2026-11-27, DEVLOG 02:20)

- `farm/src/net.js` `holdPort` and `answers`; `up.js` holds `config.beacon.httpPort` on `config.proxy.host` right after
  the double-start check and releases it just before `startSelfServer`; a refused hold with nothing answering gets the
  Windows line. Tests: `farm/test/run.js` *holdPort keeps a port…* and *lol up holds the panel's port before any WSL
  call…*.
- **Measured cold, the panel on 41000:** the old code, its first WSL call booted the VM onto 37795–41890, the panel
  refused (`EADDRINUSE`); the fixed code, the VM onto 36430–40525, around the held port, the panel answering. The block
  is not fixed: it goes around what Windows holds at the VM's boot (OneDrive's `::1:42050` moved it tonight).
- **Done when, as met:** the scratch farm ran on the **Ollama engine with `vllm.root` set** (its stale-vLLM check is the
  first WSL call), not on the vLLM engine; vLLM's probe (`~805`) comes after the hold in the same function, which the
  order test checks.

## Not proposed

- New default ports (every installed client and its saved farms would lose the farm).
- `.wslconfig` changes (the owner's other project needs mirrored mode); a Windows port reservation (not measured).
- The client's 41995 (the Computer's MCP server, optional) and UDP 41998 (where it hears beacons; unicast and the
  saved farms still find the farm): only on a laptop that also runs WSL in mirrored mode; noted, not planned.
- A coordinator's UDP 41998 (its peer listener at boot): a fleet mode, not held.
