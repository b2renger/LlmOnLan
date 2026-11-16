# Field notes: what happened when people used LlmOnLan

**The owner writes here; every session reads it first.** One line after a class, a workshop or a day of use is enough:
what someone tried, what went wrong or confused them, what they asked for. A note here **outranks a session's own
ideas**: the work exists for these people.

Write it the way it happened, not the way to fix it. **No names**, no student's work or text: the repository is public.

A session that acts on a note answers under it: `→ <date>: what was done, the commit` (or why not, and the plan line
it went to). A note with no answer is still open.

## Notes

- 2026-11-16, the owner's tests on a Windows laptop, client v0.2.18, the PRO 6000 on farm-v0.0.54: A25, A26, A27 and
  BEFORE_TUESDAY 3 pass. "If I have an agent running in LOL Vibe I cannot run the Computer boxes, it waits. It should
  all be parallel; what happens if everyone uses it at the same time?"
  → 2026-11-16 (read in the code, not changed): **by design, one request to the farm at a time per laptop.** LOL Vibe
  (a chat or the coding agent) takes the laptop's one foreground slot (`app/controller.mjs` → `gov.acquire('foreground')`);
  the Computer's boxes go in the background lane (`graph/runner.mjs`, `priority: 'background'`), which runs only while
  the foreground is idle, one box at a time, and which a Send cuts (`net/governor.mjs`: "the user always wins").
  The rule dates from farms with one llama.cpp slot, where a second request from the same laptop only slowed its own
  answer. **Across laptops everything runs at once:** each laptop holds one seat, the farm counts a seat per computer,
  and vLLM serves the 48 together; the class of 30 is 30 requests at a time, inside the 48. Letting one laptop run two
  at once makes a person count twice on the farm (30 people could ask 60 at a time against 48 places). Open: a
  choice for the owner, plans ▸ 4 ▸ *The client* (after the class).

- 2026-11-13, the owner's own tests before the class, PRO 6000: in LOL Vibe, asked for a small website and could not see
  the result right away: "the clients needs a way to run directly the result of a html js css project, or python
  script ... it should be rewarding right away" (in the app, as an artifact, or live in the browser). The live farm
  was on llama.cpp with 1 seat: vLLM "should be the default for this configuration". Preferences ▸ Usage report was not
  found on client 0.2.17 / farm 0.0.53 (it is in the unreleased v0.2.18).
  → 2026-11-14: vLLM as the default on big cards: the owner said yes; a plan after the class. The usage report ships with
  client v0.2.18, cut after night n° 4's engine tests (owner). **LOL Vibe running code: not built, still open.** What
  exists: a Project's Preview tab and *Open in browser* (a bouncing-ball page showed after 58 s, night n° 3); in a plain
  chat only an SVG answer gets a Preview, an HTML page shows as code; nothing runs Python. The owner was asked
  (2026-11-14) whether an HTML/JS/CSS Preview in the chat may be built by day before the client freeze (Monday 12:00).
  → 2026-11-14 11:56: the owner said yes (Python: never mind). **Built** (6c17a63, DEVLOG): an answer's html block has
  Preview, and the page runs there with the answer's CSS and JavaScript; the owner's own ask checked in the real app.
  Ships with client v0.2.18.

<!-- Newest first. Example:
- 2026-11-14, class of 24, PRO 6000: three students' PDF uploads failed with "file too large"; nobody found where to
  change the model in LOL Vibe; the Computer's tour was skipped by everyone.
  → 2026-11-15: …
-->
