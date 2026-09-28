// @ts-check
// K5-U2's strings: the ＋ menu (grouped, searchable) and the first-run offer on an empty canvas
// (addendum KE-2, KE-6). One strings file per K5 unit (KE-9).
//
// The `desc*` and `group*` keys are FROZEN BY NAME — graph/parts/index.mjs resolves them for the
// nineteen plain parts, so renaming one would blank a row of the menu. K5-U2 owns the WORDING.
// The `kw*` keys are search words for a plain part (graph/palette-menu.mjs `partKeywords`): comma
// separated, never shown, the words a person might type for that box when they are not its name.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('palette', {
  // the five groups, in menu order (COMPUTER_PLAN §6)
  groupBring: 'Bring in',
  groupThink: 'Think',
  groupShow: 'Show',
  groupControl: 'Control',
  groupAnnotate: 'Annotate',
  // one line per plain part: what it DOES, in the reader's words
  descNote: 'A box of text. Type into it, or let an answer land in it.',
  descImage: 'A picture: drop, paste or choose one, or take one with the camera. The model can look at it.',
  // K6 kickoff (addendum KF-8): the two boxes that hold a file. The box itself says what THIS farm
  // can do with it; the menu line never promises what the farm has not said.
  descDocument: 'A PDF: drop or choose one. The farm reads its text when a run needs it, and the text flows on.',
  descAudio: 'A sound: drop or choose a file, or record one with the microphone, and play it here. Turn on Listen and the farm writes down what is said.',
  descFile: 'Writes what arrives into a file in this graph’s own folder (LOL Studio Projects, in your data folder).',
  descSend: 'Sends what arrives to a device — OSC, DMX over Art-Net, MQTT, WebSocket, HTTP, USB serial or the farm’s message bus. A dry run until you arm the outputs in the run bar.',
  descSpeak: 'Says what arrives out loud — with this computer’s own voice (offline) or the farm’s voice — and passes the same text on.',
  descClassify: 'Laya on the farm answers one multiple-choice question for every item of a list, and says how sure it is. Fast, and it does not use up the Cap; the items it is unsure of are marked for a model or a person to check.',
  descReceive: 'What a board says over USB, or what arrives on the farm’s message bus: the latest message, or every new one. JSON flows on as data.',
  descTrigger: 'Starts a run by itself: on a message on the farm’s bus, or every few seconds. Only while the outputs are armed and the Computer is on screen.',
  descFetch: 'Reads a web address you type (an open API or a page) and hands on its JSON or text. Only that request leaves this computer.',
  descOpenData: 'Paste the link of a data.gouv.fr dataset: hands on its description, what data.gouv.fr counted in each column of the whole file, and a sample of its rows. Only requests to data.gouv.fr leave this computer.',
  descAgent: 'A model that works in steps with a few tools — code over what is wired in, the web hosts you allow, Laya — then answers, showing every step. It never sends to a device.',
  descAsk: 'Tells the model what to do with whatever is wired into it.',
  descSplit: 'Cuts text into a list, so the boxes after it run once for each item.',
  descFilter: 'Keeps only the items of a list that match.',
  descCollect: 'Joins a list back into one: a bullet or numbered list, a JSON array, or your own template per item.',
  descRepeat: 'Runs what comes after it several times, for variations.',
  descPreview: 'Shows whatever arrives, and picks how: markdown, SVG, a web page, three.js, p5.js or a graph from JSON. Hands on a picture of what it drew, so a model can look at it.',
  descCode: 'Plain JavaScript that runs in the sandbox on what arrives; what it returns flows on. A model can write it for you (Write code).',
  descButton: 'Nothing after it runs until you press it.',
  // Critic S1-12: ONE output — the value goes on only when the verdict matches the chosen branch.
  descCondition: 'Lets what arrives through when it reads as your chosen yes, no or maybe.',
  descConfirm: 'Stops and asks you OK or Cancel before going on.',
  descDialog: 'Stops and asks you a question; your answer flows on.',
  descToggle: 'A switch: while it is off, the boxes after it do not run.',
  descTimer: 'Waits a few seconds (once, or several times in a row), then lets what follows run.',
  descSticky: 'A coloured note for the reader. Never runs.',
  descSection: 'A labelled region to group the boxes of one idea. Never runs.',
  descTitle: 'Big words on the canvas. Never runs.',
  // search words for the plain parts (never shown)
  kwNote: 'text, words, write, paste, type, input, paragraph, topic',
  kwImage: 'picture, photo, png, jpg, reference, vision, look, see, camera, webcam, snapshot, capture, take a picture',
  kwDocument: 'pdf, document, paper, report, scan, ocr, read, file, upload',
  kwAudio: 'audio, sound, voice, recording, record, microphone, mic, mp3, wav, m4a, listen, music, upload, speech to text, transcribe, dictate, stt',
  kwFile: 'save, export, disk, folder, output, txt, write, json, markdown, png, project',
  kwSend: 'send, osc, dmx, artnet, art-net, mqtt, websocket, esp32, arduino, http, post, device, light, output, iot, usb, serial, board, bus, led, publish',
  kwSpeak: 'speak, say, voice, tts, read aloud, out loud, talk, speech, sound, kokoro',
  kwClassify: 'classify, label, category, sort, tag, laya, decide, choice, topic, triage',
  kwReceive: 'receive, usb, serial, arduino, esp32, board, sensor, microcontroller, read, input, listen, mqtt, bus, topic, subscribe, osc',
  kwTrigger: 'trigger, event, mqtt, bus, topic, schedule, every, cron, automatic, start, listen, button, sensor',
  kwFetch: 'fetch, web, url, http, api, download, json, data, source, internet, get',
  kwOpenData: 'open data, data.gouv.fr, datagouv, government, france, dataset, csv, table, statistics, public, gouv, données',
  kwAgent: 'agent, tools, steps, autonomous, research, find out, investigate, plan, analyse',
  kwAsk: 'prompt, model, llm, ai, generate, question, answer, gemma, chat, instruction',
  kwSplit: 'list, lines, items, divide, each, separate, map',
  kwFilter: 'keep, match, select, where, only, list',
  kwCollect: 'join, merge, combine, gather, reduce, list',
  kwRepeat: 'loop, again, variations, times, many, batch',
  kwPreview: 'render, renderer, view, viewer, display, show, output, visualise, visualize, graph, network, nodes, d3, png, screenshot',
  kwCode: 'javascript, js, script, function, program, transform, compute, calculate, count',
  kwButton: 'start, click, press, trigger, go, run',
  kwCondition: 'if, branch, yes, no, maybe, decide, boolean, switch',
  kwConfirm: 'ok, cancel, approve, check, pause',
  kwDialog: 'question, reply, input, form, user',
  kwToggle: 'switch, on, off, gate, enable',
  kwTimer: 'wait, delay, interval, seconds, clock, pause',
  kwSticky: 'note, comment, memo, annotation, postit',
  kwSection: 'group, frame, region, area',
  kwTitle: 'heading, header, label, big',
  // the menu's own chrome
  menuLabel: 'Add a box',
  searchPlaceholder: 'Search boxes — try “p5”, “picture”, “model”…',
  searchLabel: 'Search the boxes you can add',
  noMatch: 'No box matches “{query}”.',
  noMatchHint: 'Try a word for what it does: picture, list, model, code, wait.',
  footKeys: '↑ ↓ to choose · Enter to add · Esc to close',
  footTip: 'Tip: double-click or right-click the canvas to add a box right where you click.',
  // the strip at the top of the unsearched menu: the boxes that draw with code, no farm needed
  quickLabel: 'Draw with code — no farm needed',
  quickHint: 'Add a “{name}” box: {desc}',
  // the first-run offer (KE-6, COMPUTER_PLAN §10.4)
  welcomeTitle: 'The Computer',
  welcomeBody: 'A canvas where you wire boxes into small programs: text, pictures, sound, code and the model on your farm. Everything you make stays on this computer.',
  welcomeTour: 'Take the tour',
  // Docs review B-5: the same length the Learn shelf prints for the tour (`minutes: 2`).
  welcomeTourHint: 'about 2 minutes · no farm needed',
  welcomeTemplate: 'Open a template',
  welcomeTemplateHint: 'pick a working graph on the Learn shelf',
  welcomeAdd: 'Add your first box',
  welcomeAddHint: 'text, instructions, p5.js, SVG…',
  welcomePicks: 'Or start with',
  welcomePickHint: 'Put a new “{name}” box in the middle of the canvas',
  welcomeTip: 'Double-click or right-click anywhere on the canvas to add a box right there.',
});
