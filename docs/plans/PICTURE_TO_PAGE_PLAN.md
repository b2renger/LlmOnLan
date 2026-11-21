# PICTURE_TO_PAGE_PLAN: LOL Vibe builds a page from a picture, a Figma export or a scene

**Status: proposed, for the owner** (night n° 12, 2026-11-21; plans ▸ Next 18, the owner's ask of 2026-11-20). Step 1
is a measurement a session may run; steps 2–4 wait for the owner's yes. Size **M**.

## Why

The owner, 2026-11-20: "upload images of interfaces to be able to reproduce them with html css js - and even figma
files, or images of scenes to be able to reproduce them with threejs". And at 12:46: "You mentionned images, but not
figma". Figma comes in by its **export** (DECISIONS, default taken 2026-11-21: no connection to Figma's desktop MCP
server).

## What exists (read 2026-11-21)

- The farm's models see pictures: Qwen3.6, Qwen3.8 and Gemma 4 26B (`vision: true`, `farm/src/config.js`).
- LOL Vibe's plain chat sends a picture with a message (`renderer/chat/net/request.mjs`, `image_url`).
- **A chat bound to a project drops it.** Its turn goes to the coding agent with the message's text only
  (`app/controller.mjs:594-599`, `text: askedText`): an attached picture never reaches the agent.
- The agent has a `read_image` tool, inside the fence like `read` (`shell/src/main/studio.ts`, the matcher), **but it
  refuses today**: it asks dsh's model registry whether the model takes images (`dsh-tool-fs` `assertImageCapableRoute`),
  and dsh takes a declared model as text-only (`dsh-llm-pi-ai` `DEFAULT_INPUT = ["text"]`) unless its `input` is
  declared, which LOL Vibe's patch does not (`studio.ts` `buildPatch`: only `id` and `contextWindow`). Step 2 declares
  `input: [text, image]` when the farm says its model sees pictures.
- three.js r160 ships in the client for the Computer's sandbox (`renderer/chat/sandbox/libs.mjs`): a project page can
  use a local copy, with no network and no new dependency.

## What would change

1. **Step 1, a measurement (no product change; a session may run it).** Three kinds of input, each through Qwen3.6,
   Qwen3.8 and Gemma 4 26B. The model's own skill through the chat API, as LOL Vibe's plain chat sends a picture
   (`docs/spike/runs/picture_page.mjs`: the answer saved, checked and rendered); the agent's tasks
   (`docs/spike/ide/tasks/t6-ui-shot`, `t7-scene`) once step 2 lets it see:
   - **Interfaces:** three screenshots made here (the farm's panel, the capacity page, a LOL Vibe page), so the true
     page is known.
   - **Figma:** the same frame exported as **PNG and as SVG** (an SVG is text: positions, sizes, colours and text the
     model reads exactly). Needs two or three frames from the owner (a school Figma account), or made on Figma's free
     plan. Not checked: whether Figma's SVG keeps text as text or as outlines.
   - **Scenes:** three pictures rendered with three.js here (known objects, lights, camera), so what the model
     rebuilt can be compared with the scene that made the picture.
   Scored by eye on a fixed grid (layout, colours, text, objects), side by side, the pages and the scores in
   `docs/spike/results/` and RESULTS. *Done when* each model has a score per input kind.
   **First pass, 2026-11-21 (RESULTS ▸ *Pages from a picture*):** one interface and one scene, 3 samples each, through
   the chat API on vLLM 0.34.0: Qwen3.6 3/3 and 3/3 (the page near identical; the scene's shapes, colours and order
   right, the depth and camera off), Qwen3.8 2/3 and 3/3, slower. **The second half the same night** (two more
   interfaces, two more scenes): over the six inputs Qwen3.6 passes 16 of 18 samples and Qwen3.8 14 (with the check
   blind to spaces in a text), every miss one text or one colour; by eye a simple page comes out near identical, a denser one with a looser layout, a scene with
   its objects and colours right and its light and depth off; Qwen3.6 is the faster. Both are good enough to build on;
   the agent cannot see the picture yet (step 2). Still to run: Figma frames (question 2), Gemma 4 26B (not on this
   computer).
2. **Step 2, the hand-over (after the owner's yes):** a picture or an SVG dropped in a project chat is saved into the
   project (`refs/<name>`, through main's projects API, inside the fence), and the message the agent gets names it
   ("The picture is refs/x.png; read it with read_image"). One code path for the three kinds.
3. **Step 3, the help:** the Project panel's empty state and the IDE guide say how (drop a screenshot, a Figma frame
   exported as SVG or PNG, or a picture of a scene), and which model did best in step 1.
4. **Step 4, tests:** a unit test (a dropped picture becomes a file and a sentence), a harness scenario (the mock dsh
   sees the file), HUMAN_TESTS (a student's screenshot, five minutes).

## Questions for the owner

1. **Approve steps 2–4 after step 1's scores?** *Recommended:* yes, if the best model rebuilds a recognisable page from
   a screenshot. *Default if no answer:* step 1 only.
2. **Two or three Figma frames** exported as SVG and PNG, for step 1. *Default if no answer:* step 1 runs without
   Figma, and says so.
