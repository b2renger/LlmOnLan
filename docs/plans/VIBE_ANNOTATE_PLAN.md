# VIBE_ANNOTATE_PLAN: draw on LOL Vibe's preview, say what to change, the agent changes the code

**Status: proposed, for the owner** (the owner's ideas from Google AI Studio, the chat 2026-11-27 14:22: "we could
consider"; DECISIONS). Nothing here is built before the owner's yes. Size **M** for steps 1–2, more for what follows.
The client only. The privacy boundary gains one line (step 2), which needs the owner's yes first.

## What the owner listed

1. **Annotate mode:** draw rectangles, arrows, circles or freehand on the preview, add a short comment, send it; the
   annotated view goes to the model, which changes the code.
2. **Edit tool:** retouch or replace images, try fonts live, HTML/CSS design variations.
3. **DOM inspection:** adjust spacing, margins and colours on an element.
4. **Reference screenshots:** upload pictures to guide the styling.

## What exists (read 2026-11-27, the `search` explorer; the key lines checked)

- **The project's Preview** (the IDE, the coding agent's project): a page served on 127.0.0.1 by the project's own
  server (`shell/src/main/studio.ts` ~678). It shows in a **same-origin** frame
  (`servedFrame`, `renderer/chat/sandbox/host.mjs:40-46`; `ui/project-panel.mjs:670-675`), so the client can read and
  draw over it.
- **A page in a plain chat's answer** runs in the `allow-scripts`-only sandbox (`host.mjs:256-266`): the client cannot
  reach its document. The guest already has a `snapshot` command that returns the page as a picture
  (`sandbox/protocol.mjs:26`, `runner.html:798-830`); only the Computer uses it.
- **Taking a picture of a window part:** Electron's `webContents.capturePage(rect)` is already used by main, for the
  Computer's debug log (`index.ts:127-131`). No new dependency.
- **The agent cannot see a picture yet.**
  - A chat bound to a project sends the agent the message's text only (`app/controller.mjs:593-599`).
  - The agent's `read_image` refuses, because LOL Vibe declares its model text-only (`studio.ts` `buildPatch`).
  - [PICTURE_TO_PAGE_PLAN](PICTURE_TO_PAGE_PLAN.md) step 2 is the hand-over: a picture dropped in a project chat
    becomes `refs/<name>` in the project, the model is declared `input: [text, image]` when the farm says it sees
    pictures, and the message names the file. **That is the owner's idea 4, already planned, and the base of this
    one.** Its step 1, the measurement, is done: Qwen3.6 rebuilds a page from a screenshot, 16 of 18 samples
    (RESULTS ▸ *Pages from a picture*).
- **No picture can be attached to a LOL Vibe chat from its window today.**
  - What exists: the wire format (`net/request.mjs:153-155`).
  - What is missing: the explorer found no attach, paste or drop path (`ATTACH_HANDLERS` is declared but has no
    handler, and `ui/layout.mjs:124-125` cancels drops).
  - PICTURE_TO_PAGE says the plain chat "sends a picture with a message". That is to be checked before step 1, and its
    text corrected if the explorer is right.
- **The farm's models see pictures:** Qwen3.6 on the PRO 6000's vLLM (`vision: true`, `farm/src/config.js:454`). The
  client learns it from LiteLLM's `supports_vision` (`app/caps.mjs:194-224`).

## The change, in order

1. **PICTURE_TO_PAGE steps 2–4 (reference screenshots).** As that plan writes them: drop or paste a picture in a
   project chat; it is saved as `refs/<name>`, and the agent reads it with `read_image`. Steps 2 and 3 below need it.
2. **Annotate mode on the project's Preview.**
   - **The tools:** an *Annotate* button on the Preview's bar lays a drawing layer over the frame: rectangle, arrow,
     circle, freehand, one strong colour, undo and clear. A comment box and *Send to the agent* close the mode.
   - **The picture:** main takes it with `capturePage` of the frame's rectangle, so the page as shown and the marks
     come together in one picture. It is saved in the project as `refs/annotations/<time>.png` (through the projects
     API, inside the fence).
   - **The message:** the agent gets the comment, *"The marked screenshot of the page is
     refs/annotations/<time>.png; the red marks show what to change; read it with read_image"*, and the page's file
     name.
   - The marks stay on the layer until *Clear*, so a second comment can point at the same place.
   - **Privacy:** `docs/context/privacy.md` gains *LOL Vibe: a marked screenshot of the person's own project page,
     sent with a request to the coding agent* beside the Computer's Preview pixels, which it already lists. Nothing new
     is kept anywhere but the project folder.
3. **The same on a plain chat's page** (optional, after 2): the guest's `snapshot` gives the page's picture, the marks
   are drawn over it in the client, and the two go with the next message, once the chat can carry a picture (the gap
   above).
4. **Later, a plan of its own: DOM inspection, then fonts and design variations.** The same-origin Preview lets a click
   pick an element and show its margins, padding, colours and font, with values to try live. *Keep* sends the agent an
   exact change (*in `style.css`, `.hero h1`: `margin-top: 24px`*) or writes it. Design variations, the agent asked for
   two or three versions side by side, belong there too.
5. **Not planned: retouching or replacing pictures.** It needs a picture-making model, which the farm does not serve
   (ComfyUI on the PRO 6000 is not part of LlmOnLan). Replacing a picture by one the person drops is step 1's
   reference path.

## Tests (for steps 1–2)

- **Unit:** an annotation becomes a file in `refs/annotations/` and one sentence in the agent's message; the drawing
  layer's undo and clear.
- **Harness:** the mock dsh receives the message naming the file, and the file exists in the project.
- **Measured, without a person:** three marked screenshots of a known page ("remove this button", "make this blue",
  "move this under the title"), each sent to the agent on Qwen3.6, the change scored by eye.
- **HUMAN_TESTS:** a student's page, three marks, five minutes.

## Questions for the owner

1. **Build PICTURE_TO_PAGE steps 2–4 and this plan's step 2 (Annotate on the project's Preview)?**
   - *Recommended:* yes, in that order, after the three fixes that hold the release (COMPUTER_DOTS, BLENDER_LAB_MCP,
     PLUGIN_PROGRESS).
   - *Default if no answer:* nothing built.
2. **The privacy line in step 2** (a marked screenshot of a person's own project page goes to the farm's model with the
   request, kept only in the project)?
   - *Recommended:* yes.
   - *Default if no answer:* step 2 waits.
3. **DOM inspection (step 4) as the next plan after Annotate?**
   - *Recommended:* yes, written once step 2 is in people's hands.
   - *Default if no answer:* not written.
