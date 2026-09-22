// @ts-check
// The Computer's skeleton DOM (COMPUTER_PLAN §3.4). Integrator-owned; units NEVER edit this file.
// A LEAF with no loader row: computer/main.mjs static-imports it, so a typo here surfaces as the
// Computer failing to mount and not as a mystery.
//
// ui/layout.mjs's buildLayout() is the CHAT's skeleton (threads column, messages, composer) and is
// deliberately NOT reused — none of it exists here. installDropGuard(document) is the one thing
// shared, and computer/boot.mjs installs it once.
//
//   #lolcomputer
//   ├── .comp-side            the library sidebar (K1-U2; resizable, width in kv)
//   │   ├── .comp-side-head     [＋ New] [search]
//   │   ├── .comp-list          document cards
//   │   └── .comp-shelves       ▸ Lessons  ▸ Templates            (K5, collapsed)
//   ├── .comp-main
//   │   ├── .comp-runbar        Run all · Stop · counts · cap meter · zoom · ?   (K1-U3)
//   │   ├── .graph              the existing canvas — UNCHANGED markup, built by graph/canvas.mjs
//   │   └── .comp-rail          the tutorial step rail (K5)
//   └── .comp-drawer          the right-hand drawer (K1-U3), hidden
//
// `els` is frozen here: {root, side, sideHead, list, shelves, main, runbar, canvas, drawer, rail,
// banner}. A unit that needs another node creates it INSIDE its own element and says so.

/** @param {string} cls @param {HTMLElement} [parent] */
function div(cls, parent) {
  const el = document.createElement('div');
  el.className = cls;
  if (parent) parent.appendChild(el);
  return el;
}

/**
 * Build the Computer skeleton into `root` (replacing the static fallback paragraph).
 * @param {HTMLElement} root
 * @returns {{root: HTMLElement, side: HTMLElement, sideHead: HTMLElement, list: HTMLElement,
 *   shelves: HTMLElement, main: HTMLElement, runbar: HTMLElement, canvas: HTMLElement,
 *   drawer: HTMLElement, rail: HTMLElement, banner: HTMLElement}}
 */
export function buildComputerLayout(root) {
  root.replaceChildren();

  const banner = div('comp-banner', root);

  const side = div('comp-side', root);
  const sideHead = div('comp-side-head', side);
  const list = div('comp-list', side);
  list.setAttribute('role', 'list');
  const shelves = div('comp-shelves', side);
  shelves.classList.add('hidden');            // K5 fills it; until then it must not take space

  const main = div('comp-main', root);
  const runbar = div('comp-runbar', main);
  // The MOUNT, not the canvas. `createCanvas()` builds its own `.graph` root inside whatever it is
  // handed, and its markup is UNCHANGED from the panel — css/graph.css was re-scoped to
  // `:is(#lolchat, #lolcomputer) .graph …` at this kickoff, nothing else. Calling this box
  // `.graph` too put TWO `.graph` elements on the surface, one inside the other: every
  // `#lolcomputer .graph` rule and every scenario counting canvases saw double (caught at the K1
  // landing). It is `.comp-canvas`, and the real canvas is its only child.
  const canvas = div('comp-canvas', main);
  const rail = div('comp-rail', main);
  rail.classList.add('hidden');               // K5

  const drawer = div('comp-drawer', root);
  drawer.classList.add('hidden');             // K1-U3 opens it

  return { root, side, sideHead, list, shelves, main, runbar, canvas, drawer, rail, banner };
}
