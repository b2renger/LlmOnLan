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
