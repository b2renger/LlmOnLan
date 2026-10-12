// @ts-check
// Template — Voice persona (docs/COMPUTER_VOICE_PLAN.md §10, the owner's answers of 2026-10-12). DATA only.
// A persona (in French: a museum guide), a Converse box set to French with Kokoro's French voice, the Voice
// face p5 sketch to ▶ Live, and an Instruction that reads the conversation and says how to improve the
// persona. The app stays English; the persona is French. A conversation costs one generation per answered
// turn (12 at most here), and the Instruction one more: the shelf's "~13" is that most (plan §15.11).

import { STARTER } from '../../graph/parts/creative.mjs';

export default {
  id: 'voice-persona',
  title: 'Voice persona',
  subtitle: 'Design a voice bot: write its persona, give it a face, talk with it, and read where the conversation went wrong.',
  needsFarm: 'one',
  generations: 13,
  doc: {
    lolgraph: 2,
    title: 'Voice persona',
    view: { x: 16, y: 8, zoom: 0.5 },
    parts: [
      { id: 'v_title', type: 'title', x: 40, y: 24, w: 1100, h: 100, settings: { text: 'Voice persona', size: 'l' } },
      {
        id: 'v_how', type: 'sticky', x: 40, y: 140, w: 340, h: 640,
        settings: {
          colour: 'yellow',
          text: 'How it works\n\n1. Press ▶ Live on the Voice face (right): the box that is Live is the face.\n2. Press ● Start on Converse and allow the microphone. Talk: it answers out loud. Talk over it to interrupt it. ■ End stops it.\n3. Change the persona (French here: Converse listens in French and speaks with the farm’s French voice, ff_siwis), turn the knobs, start again and compare the “first sound” times.\n4. When it ends, the Instruction reads the conversation and suggests how to improve the persona.\n\nUse a headset: with loudspeakers the bot may hear itself. Or turn off “You can talk over it”.\n\nPrivacy: the microphone opens only when you press ● Start, and closes when the conversation ends or you leave the Computer. Your voice goes to the farm to be written down, and is dropped: nothing is recorded. The conversation’s text stays in the box, on this computer.',
        },
      },
      {
        id: 'v_persona', type: 'note', x: 420, y: 140, w: 320, h: 360,
        settings: {
          text: 'Tu es Margot, guide au musée des Arts décoratifs. Tu parles avec chaleur et curiosité, comme à un visiteur que tu accompagnes dans les salles.\n\nTrois règles :\n1. Deux phrases courtes au plus, puis une question.\n2. Tu ne récites pas de fiche : tu racontes l’histoire d’un objet.\n3. Si tu ne sais pas, tu le dis simplement et tu proposes autre chose.',
          locked: false,
        },
      },
      { id: 'v_converse', type: 'converse', x: 780, y: 140, w: 340, h: 460, settings: { language: 'fr', farmVoice: 'ff_siwis', voice: 'auto', interruptible: true } },
      { id: 'v_face', type: 'preview', x: 1160, y: 140, w: 380, h: 520, settings: { mode: 'p5', source: STARTER['voice-face'], w: 400, h: 300, locked: false } },
      { id: 'v_live', type: 'sticky', x: 1160, y: 680, w: 380, h: 120, settings: { colour: 'green', text: '▶ Live this first: then it reacts to the conversation. Its code is the face: change it.' } },
      { id: 'v_critic', type: 'ask', x: 1580, y: 140, w: 340, h: 300, settings: { instruction: 'Read this conversation between a person and a voice bot (its persona, its turns and how long each answer took). Where did the bot make the person wait, interrupt them, or misunderstand them? Give three short suggestions to improve its persona.' } },
      { id: 'v_view', type: 'preview', x: 1580, y: 480, w: 360, h: 300, settings: { mode: 'markdown' } },
    ],
    wires: [
      { from: 'v_persona', to: 'v_converse', port: 'persona' },
      { from: 'v_converse', to: 'v_critic', port: 'in', label: 'conversation' },
      { from: 'v_critic', to: 'v_view', port: 'content' },
    ],
  },
};
