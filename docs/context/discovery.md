# Discovery: the UDP beacon and the farm choice

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

## Discovery (ComfyQ‑style UDP beacon — not mDNS)

Adapted from ComfyQ's `beacon.js`. The **farm** broadcasts; the **client** listens. Chosen over
mDNS because ComfyQ proved multicast alone is flaky across consumer APs, and this is dependency‑free
(Node `dgram`).

- **Farm side (`lol` CLI):** every `intervalSec` (default 5s), plus an immediate kick on every change, send
  a small JSON snapshot (`farm/src/snapshot.js` `buildSnapshot`, the same object `GET /lol/self` serves; every field
  and who reads it: `farm/contract/snapshot.schema.json`; `GET /lol/self` adds `capacity.mine` for the caller) to
  **(a)** a multicast group, **(b)** each
  interface's **directed broadcast** (e.g. `10.10.16.255`), and **(c)** the limited broadcast
  `255.255.255.255`, deduped. `setBroadcast(true)`, `setMulticastTTL(4)`. Directed broadcast is what
  makes same‑subnet clients actually see the farm.
- **Use a multicast group/port distinct from ComfyQ's** (ComfyQ uses `239.255.42.99:41999`) so the two
  tools coexist on one LAN — e.g. LOL default `239.255.43.10:41998`.
- **Client side** (`discovery.ts`, `index.ts` `chooseActive`): beacons on `239.255.43.10:41998` + broadcast;
  a unicast `/lol/self` sweep of the **search range** (default: the first non-internal IPv4's subnet; every
  60 s, 48 parallel, 1.5 s timeout, ≤4096 hosts); manual `host[:httpPort]` peers (default 41997, kept even
  when stale). The active farm is re-polled every 2 s; stale after 12 s, dropped after 120 s. Choice
  (pure rules in `farmSelect.ts`; `index.ts` `connectTo()` saves the whole farm context, password included): the pinned
  farm → the current one (sticky) → last session's endpoint → the least-loaded healthy farm (coordinators
  first; load = clients/slots, else GPU%; ties within 15 points picked at random). Clicking a farm card pins
  it; the popover's "Automatic — least busy farm" row removes the pin; entering a password does not pin. A
  farm seen under two addresses keeps the one it was first reached at while that one answers (it moves
  only after 12 s of silence). The least-busy pick skips a password-protected farm
  without a verified stored password (re-checked ≤1/min); a pinned, current or last-session farm is used
  anyway, and after a rotated password main drops the stale key and the farm card asks again. A 502–504 (the farm's
  gate while LiteLLM restarts) says nothing about the password, so the stored one is kept (`farmSelect.ts`
  `passwordVerdict`; 2026-11-05, v0.2.16). What a farm says is not taken on trust (2026-11-06, not released
  yet): every plugin address takes the host the farm was reached at (`discovery.ts` `onHost` in `getFarms`); a beacon that
  crossed the network is filed under its source address; another host repeating an id changes nothing while the recorded
  host answers; a password stays at the address it was typed for (`storedFarmKey`, `farmKeyHosts`), and a farm this client
  trusts (`knownFarms`: the first it used, or one a person clicked or typed a password for) comes before any stranger.
  `LOL_ENDPOINT` pins an endpoint (dev); `LOL_FED_GROUP/PORT/HTTP_PORT` override the group and ports.
- **Fallbacks (mirror ComfyQ's controls):** manual add‑by‑address and the subnet sweep ("search range") —
  unicast crosses subnets that block broadcast. There is no baked-in address.
