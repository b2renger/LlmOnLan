# PLAN_FIRST_NEW_CHAT_PLAN: start a new chat with a plan

**Status: approved by the owner, 2026-11-23** ((a) and (b), the chat 12:11; one question below). Size **S + S**.
**Built after the v0.2.20 tag** (DECISIONS 2026-11-23): v0.2.20 is tagged (2026-11-23 17:41), so it may be built now.

**Built (night n° 16, 2026-11-25), unreleased:** (a) `ui/workbench.mjs` `onThreadSelected`: a created thread whose
previous chat was bound to a project, and that is not temporary, opens the Project panel and `setStudio({projectId})`,
as `bind()` does; (b) `ui/project-panel.mjs`: the switch shows wherever the coding agent is (`getDoor()`); in a chat
with no project it keeps a wish (`planWish`, forgotten at restart), opens the panel, whose note says
`project.planFirstNeedsProject`, and the wish becomes *Plan first* once the chat is bound (`takeWish`); with no chat yet,
pressing it makes one, as `bind()` does. *Plan first* stays off by default in a new chat (the question's default, taken
2026-11-24). Tests: `k24-plan-first-changes-nothing-until-go-ahead` (its plain chat now shows the switch, off; a new chat
from the project's chat is in it with the switch; a temporary chat and a new chat from a plain one are plain) and the new
`k24-plan-first-in-a-plain-chat` (the panel asks, a second press drops the wish, the project made there turns it on, the
first reply is a plan): 2/2 in the harness; `test:chat` 1989 and lint 0. The panel's debug `planFirst` now reads the open
chat, not the panel's last `thread`. Docs: client.md, LOLVIBE_IDE_GUIDE, HUMAN_TESTS G14 steps 6 and 7.

The owner, G14 on `0.2.19+n13`: *"In a new chat it looks like we cannot start with a plan ... we should be able to start
with a plan"*; then, on (b): *"it is good practice to elaborate a plan rather than start coding right away so yes it is
an important to plan first when start a new chat, new project"*.

## Why it cannot today

*Plan first* is a switch per chat, shown only in a chat bound to a project (`ui/project-panel.mjs`, its
`COMPOSER_ACTIONS` item: `visible: () => !!planThread && !!getDoor()`), because it fences the coding agent's writes in
that project. A new chat starts in no project, **even one opened from a project's chat**: `controller.newThread()`
emits `THREAD_SELECTED {created: true}`, and the workbench gives such a chat an empty studio and closes its panel
(`ui/workbench.mjs`, §2.6 AP.1). New chat comes from the button (`ui/composer.mjs`), Ctrl/⌘+Shift+O
(`ui/shortcuts.mjs`) and the sidebar's temporary chat (`ui/sidebar.mjs`, `ephemeral: true`).

## The steps

1. **(a) A new chat opened from a project's chat stays in that project (S).** When `THREAD_SELECTED` arrives with
   `created: true` and the chat open just before was bound to project P, the new chat is bound to P (the panel's own
   `bind(P)`, which writes `studio.projectId`) and the Project panel stays open: *Plan first* is beside the message box
   before the first message. A new chat from a plain chat stays plain; so does a temporary chat (`ephemeral`), whatever
   was open. Leaving the project stays where it is: **Other project** (`bind('')`). This changes AP.1 for one case only,
   a new chat from a project's chat.
2. **(b) Every new LOL Vibe chat offers *Plan first* (S).** In a chat with no project, the switch shows too (when the
   coding agent is there, `getDoor()`). Pressing it there opens the Project panel, whose status line says *Plan first
   works in a project: pick one, or make a new one*, and remembers the wish for that chat; once the chat is bound (the
   panel's `planSeen(id, true)`), *Plan first* is on for it. Pressing it again before then drops the wish. A new
   project made from that line starts with the switch on.
3. **Tests:** a `k24` harness scenario: a new chat from a project's chat is bound and shows the switch before any
   message; a new chat from a plain chat, and a temporary one, are plain; in a plain chat the switch opens the panel,
   and making a project turns it on; the agent's first reply is a plan (the mock quotes its prompt, as
   `k24-plan-first-changes-nothing-until-go-ahead` does). HUMAN_TESTS G14 gains two steps.
4. **Docs:** `docs/context/client.md` (Plan first, AP.1's exception), STUDENT_PLAN_MODE_PLAN, the line above the
   message box (`project.planFirstNote`) if its words change.

## The question

**Is *Plan first* on by default in a new chat?** The standing decision (2026-11-20, STUDENT_PLAN_MODE_PLAN's question
1): off by default, *"a teacher's default later, if classes ask"*. The owner's words above may change it.
*Recommended:* on in a new chat (steps 1 and 2: a new chat in a project, a new project), off in a chat that already has
messages; the switch is beside the message box to turn it off. *Default if no answer:* off, as decided on 2026-11-20.
