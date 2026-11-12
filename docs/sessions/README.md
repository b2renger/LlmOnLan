# Sessions: the thread the owner and Claude share

One file per work session, named by its date: `2026-11-12.md` (a second one the same day: `2026-11-12-2.md`).
A session starts by reading the **five last** files here, and ends by writing one.

**Owner:** edit any of these files. A line that starts with `> owner:` is an instruction or a comment for the next
session, and it outranks the summary's own "Next". Answer a question under "Questions for the owner" the same way.

## What a summary holds

```markdown
# Session 2026-11-12 (n° 1)

**Ran:** 02:00 to 06:55, by night. **Model:** Sonnet 5.5. **Branch:** main, abc1234 → def5678 (not pushed).

**RELEASE READY** (only when it is): what the unpushed work brings, and the HUMAN_TESTS to run before the tag.

## Done
- What changed, each with its evidence: the test that passed, the number measured, the commit.

## Not done, and why
- What was planned and dropped or left half-way, and what state it is in.

## Found
- Bugs, surprises, facts that contradict a doc. Each one fixed, or filed in docs/plans/README.md.

## Next
1. The next logical step, precise enough to start on without this conversation.

## Questions for the owner
- A decision only the owner takes. One per line, with the choice recommended.
```

Rules for the writer:
- **Facts with their evidence.** "Passed" names the command and the count; "measured" names the number and where the raw
  result is. What was not checked is said as such.
- **No secrets and nothing about a person:** no password, token, name of a student, text of a chat or a document.
- **Short:** the summary is read five at a time, every session. The detail goes to [the DEVLOG](../DEVLOG.md).
- **The session number** is the count of files here. Every fifth (5, 10, 15…) is an adversarial review (the skill
  `lol-review`); its findings go to `docs/reviews/`, and its summary says which ones are fixed.

The procedure itself: the skill `lol-session` (`.claude/skills/lol-session/SKILL.md`). The rules it runs under:
[CLAUDE.md](../../CLAUDE.md) ▸ *How we work*.
