// @ts-check
// The "Board" row shared by the Send box (USB serial) and the Receive box (P3a-2): which board, a
// "Choose…" button that lists the plugged-in boards next to itself, and the speed (baud). The person
// always picks: the list comes from main (src/main/serial.ts) through net/serial.mjs.

import { choosePort, DEFAULT_BAUD, hasSerial } from '../../net/serial.mjs';
import { numberField } from './fields.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-receive.en.mjs';

/** chat-lint rule 5: a literal map for the three ways choosing can fail. */
const CHOOSE_ERR = {
  'no-serial': 'parts.boardErrNoSerial',
  'none-found': 'parts.boardErrNone',
  cancelled: 'parts.boardErrCancelled',
};

/**
 * @param {any} ctx the box's PartCtx @param {any} part
 * @returns {{node: HTMLElement, update: (p: any) => void}}
 */
export function boardRow(ctx, part) {
  const row = document.createElement('div');
  row.className = 'graph-board';
  const name = document.createElement('span');
  name.className = 'graph-board-name';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'graph-board-choose';
  pick.textContent = t('parts.boardChoose');
  pick.title = t('parts.boardChooseHint');
  const note = document.createElement('p');
  note.className = 'graph-board-note';
  note.hidden = true;
  const baud = numberField(t('parts.boardBaud'), Number(part.settings.baud) || DEFAULT_BAUD, 300, (n) => {
    ctx.update({ baud: n });
    ctx.commit(t('parts.boardBaud'));
  }, 2000000);

  pick.addEventListener('click', async (e) => {
    e.preventDefault();
    note.hidden = true;
    const dialogs = ctx.app && ctx.app.dialogs;
    const out = await choosePort({
      show: (list, choose) => {
        let done = false;
        const answer = (/** @type {string} */ id) => { if (!done) { done = true; choose(id); } };
        if (!dialogs || typeof dialogs.popover !== 'function') { answer(list.length === 1 ? list[0].portId : ''); return; }
        const pop = dialogs.popover(pick, (/** @type {HTMLElement} */ el, /** @type {() => void} */ close) => {
          el.classList.add('graph-board-list');
          for (const p of list) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = String(p.name || p.portId);
            b.addEventListener('click', () => { answer(String(p.portId)); close(); });
            el.appendChild(b);
          }
        });
        pop.el.addEventListener('toggle', (/** @type {any} */ ev) => { if (ev && ev.newState === 'closed') answer(''); });
      },
    });
    if ('error' in out) {
      note.textContent = t(/** @type {any} */ (CHOOSE_ERR)[out.error] || CHOOSE_ERR.cancelled);
      note.hidden = false;
      return;
    }
    ctx.update({ serialPort: out.identity, serialLabel: out.name });
    ctx.commit(t('parts.boardChoose'));
  });

  const line = document.createElement('div');
  line.className = 'graph-board-line';
  line.append(name, pick);
  row.append(line, baud.node, note);

  /** @param {any} p */
  const update = (p) => {
    const s = p.settings || {};
    name.textContent = s.serialPort ? t('parts.boardIs', { name: String(s.serialLabel || s.serialPort) }) : t('parts.boardNone');
    pick.disabled = !hasSerial();
    baud.update(Number(s.baud) || DEFAULT_BAUD);
  };
  update(part);
  return { node: row, update };
}
