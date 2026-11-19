# CLASS_REHEARSAL_PLAN: a class, rehearsed on this computer every night

**Status: approved by the owner, 2026-11-18** ("ok", in the chat, to: *a rehearsal of the class, run every night: about
20 scripted clients, two farms sending beacons, a lossy network, and fresh first starts, measuring time to the first
chat and the slowness seen with ten people*). Part of the work sessions may do without asking (CLAUDE.md). Nothing is
built yet. Size **M**, in steps; each step is useful alone.

## Why

The sessions test what one fast desktop on a quiet network can test. The class of 2026-11-17 failed on what only a room
has: many fresh first starts at once, a Wi-Fi that drops beacons, two farms answering, ten people chatting at once
([OWUI_START_PLAN](OWUI_START_PLAN.md)). The owner also found the app sluggish with ten people on the farm, and nothing
measures that today. A rehearsal that fails the way the class did, on v0.2.18, and passes on v0.2.19, is the proof that
was missing, and it keeps that proof for every later change.

## What it reports

One command (`node test/rehearsal/run.js`, from `shell/`), one result file in `docs/spike/results/`, a few lines:
- per client: seconds from launch to the first answered chat; every state it went through (`starting`, `restarting`,
  `error`, `ready`); how many times it moved farm; whether it ever showed *keeps exiting*;
- the room: the slowest and the median first chat; then, with 10 and 20 people chatting at once, the time to the first
  word and the words a second each person gets.

## The pieces

1. **Two scratch farms** (the skill `lol-scratch-farm`), a small model, their own ports. **Their beacons never reach the
   office network**: a real client in the building must never see a rehearsal farm. The first step decides how
   (beacons on loopback only, or a test door in the client's discovery that is fed the beacons in-process), and checks
   it with a capture before anything runs.
2. **N clients without windows**: the client's own compiled code (discovery, the farm choice, the Open WebUI
   supervisor), as the night of 2026-11-18 drove it, each with a fresh data folder and the released Open WebUI. Start
   with 2, then 5, 10, 20, measuring memory: each Open WebUI is a Python process of its own.
3. **A lossy network**: drop a share of the beacons and add delay between a client and its farm, in the rehearsal's
   own code (no change to the system's network).
4. **The load**: scripted chats through each client's Open WebUI, or through the farm's seat gate as a client sends
   them, at 10 and 20 at once.

## Steps

1. **Two clients, two farms, lost beacons, a fresh first start.** Expect on v0.2.18 (the released code, from its
   tag): farm moves during the first start, and *keeps exiting* in some runs. On v0.2.19: no move until Open WebUI
   is healthy, never *keeps exiting*. This step is the regression test of the class.
2. **Scale to 10, then 20 clients**, first starts at once. Measure; find what breaks first.
3. **The slowness with ten**: time to the first word and words a second at 10 and 20 chats, on the farm alone and
   through the clients. Where the time goes is a finding, filed in the plans.
4. **Every night**: once step 1 runs in minutes, a session runs it at its start or end and says the numbers in its
   summary; a run worse than the last is a finding.

## Limits, said up front

- Not a Mac, not a real Wi-Fi; the GPU is shared with the live farm (a number taken while its users are on it says so).
- The farm people use is never touched; the rehearsal's farms and clients are scratch, stopped at the end.
- No change to the client's behaviour comes from this plan: what the rehearsal finds becomes a fix (with its test) or a
  plan.

## Built

**Step 1** (night n° 10, 2026-11-19, DEVLOG 01:56): `shell/test/rehearsal/run.js` and `client.cjs`.
- **The beacons stay on this computer**, decided as the plan asked: the farms' own beacons are **off**; a relay in
  `run.js` reads each farm's `/lol/self` every 5 s (a farm's default) and sends it by **UDP unicast to 127.0.0.1**, to
  each client on its own rehearsal port (42101+, group 239.255.43.99, never the office's 239.255.43.10:41998); every
  address a snapshot advertises is rewritten to 127.0.0.1, and the clients' 2 s polls go through a lossy proxy. Checked
  on each run: a listener on the office group heard nothing of the rehearsal (`sealHeard: 0`), and every connection the
  clients and their Open WebUIs held was to 127.0.0.1.
- **The clients** run the client's compiled `discovery.js`, `farmSelect.js` (`chooseActive`, `farmContext`,
  `connectPlan`) and `sidecar.js` (the Open WebUI supervisor) in plain Node, Electron stubbed, each with a fresh data
  folder and the released Open WebUI 0.13.3 sidecar (v0.2.19's asset, through a junction as `userData/sidecar`). **Not
  run, mirrored:** `index.ts`'s wiring (wait up to 4.5 s for a farm, start Open WebUI on it or on none; on each farms
  event choose and repoint when `connectPlan` says so), without pins, passwords or plugin keys. The first chat is a
  question through the chosen farm's gate, not a chat in Open WebUI. The rehearsal holds 127.0.0.1:8080, Open WebUI's
  preferred port: clients on ONE machine raced for it (`findFreePort` checks, Open WebUI binds ~10 s later), which a
  laptop with one Open WebUI never does.
- **Results** (2 clients, 5 min, farm A silent 20 s every 60 s, the same farms and Open WebUI; `docs/spike/results/
  rehearsal-2026-11-19*`): **v0.2.18** (built from its tag in a worktree, `REH_BUILD`): each client moved farm **10
  times**, every move a restart of Open WebUI, one killing a start mid-way: the class's Mac (30 switches in 20 min) at
  a smaller scale. **v0.2.19**: **no move**; the client that missed the first beacon started on no farm and its repoint
  waited for the start to end (ready on its farm at 30.7 s), the other ready at 16.4 s; first chats at 26.1 and 23.9 s.
  No *keeps exiting* in either: on this desktop a first start's migrations end in ~14 s, before the first switch (the
  class's Mac took 137 s); a slow first start is not rehearsed yet.
- **A farm that blips** (`--blip S`: farm A says it is unhealthy from S s after the clients launch, for 15 s; a client
  leaves an unhealthy farm at once, so the switch lands inside Open WebUI's first start), 4 clients: **v0.2.18** killed
  each first start **three times in its first 20 s** (at 0.3 s, at the blip, at the return to A), with the blip at 6 s
  and again at 10 s; no *keeps exiting* (the night of 2026-11-17 found that only some interrupted migrations break the
  database). **v0.2.19**: the choice still follows the blip, but **no start was cut**: each repoint waited for the
  running start to end; the cost is time, ready on the final farm at 45 s against 19.5 s for a client the blip missed.

**Step 2** (the same night, DEVLOG 02:33): `run.js` samples each client's process tree's memory every 30 s.
- **10 clients** (v0.2.19, 6 min, farm A silent 20 s every 60 s): no move, no *keeps exiting*; ready in 14.5–32.1 s,
  first chats 16.6–29.3 s; the room split itself 5 and 5; **794 MiB a client** (its Node and its Open WebUI), 7.9 GB.
- **20 clients**: all ready (median 17.2 s, at most 33.1 s), all first chats answered (median 33.6 s, at most 61.7 s:
  queued, as each scratch farm's Ollama answers 2 at a time and the gate gives the 20 clients, all on 127.0.0.1, one
  seat), no move, no *keeps exiting*; **793 MiB a client**, 15.9 GB, 92 GB still free; split 7 on the lossy farm, 13 on
  the steady one. Nothing broke first at 20 on this computer.
- **Next (step 3 and after):** the slowness with ten and twenty against a real model and seats per address (the
  clients could take 127.0.0.2… as `lol bench --people` does); a first start slow enough that a switch interrupts its
  migrations every time, to rehearse *keeps exiting* itself; and step 4, the nightly run.
