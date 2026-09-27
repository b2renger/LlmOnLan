// @ts-check
// K1-U3: the drawer that hosts the value inspector, the run bar's pure readouts, and the legacy
// demotion of the two thread bridges (COMPUTER_PLAN §8.1, §8.3, §11 K1-U3).
//
// The acceptance this file answers, in the plan's own words: "`bodyText`/`headingText` unchanged
// against the existing fixtures". So the first three tests are the C2 fixtures from
// graph-inspect.test.mjs, re-asserted against the module AFTER the `host` argument landed — the
// point being that nothing about how a VALUE reads was allowed to move while its home did.
//
// Everything else here is about the frame: where a hosted inspector lands, that the drawer is the
// one thing that closes it, that Escape is consumed exactly once, and that a dragged width is
// clamped before it is remembered.

import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { createInspector, bodyText, headingText, INSPECT_CAP } from '../../../renderer/chat/graph/inspect.mjs';
import {
  install as installDrawer, clampDrawerWidth, DRAWER_MIN, DRAWER_MAX, DRAWER_DEFAULT, DRAWER_WIDTH_KEY,
} from '../../../renderer/chat/computer/drawer.mjs';
import { capMeter, partsLabel, generationsLabel, CAP_AMBER } from '../../../renderer/chat/computer/runbar.mjs';
import { DEFAULT_MAX_ITEMS } from '../../../renderer/chat/graph/runner.mjs';
import '../../../renderer/chat/strings/graph.en.mjs';
import '../../../renderer/chat/strings/computer.en.mjs';

/** Run `fn` with the unit runner's DOM shim installed as `globalThis.document`. */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  const hadWin = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prevWin = /** @type {any} */ (globalThis).window;
  // drawer.mjs listens on `window` while the grip is dragged. Nothing here drags, but install()
  // must not need a window to exist either.
  /** @type {any} */ (globalThis).window = { addEventListener() {}, removeEventListener() {} };
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
    if (hadWin) /** @type {any} */ (globalThis).window = prevWin;
    else delete (/** @type {any} */ (globalThis).window);
  }
}

/** A keydown as the shim dispatches one, recording what the handler did with it. */
function keydown(key) {
  const ev = /** @type {any} */ ({
    type: 'keydown', key, prevented: false, stopped: false,
    preventDefault() { ev.prevented = true; },
    stopPropagation() { ev.stopped = true; },
  });
  return ev;
}

/** A minimal kv-backed repo: what the drawer reads its width from and writes it back to. */
function fakeRepo(seed) {
  /** @type {Record<string, any>} */ const kv = Object.assign({}, seed || {});
  /** @type {{key: string, value: any}[]} */ const writes = [];
  return {
    kv,
    writes,
    async kvGet(key, fallback = null) { return Object.prototype.hasOwnProperty.call(kv, key) ? kv[key] : fallback; },
    async kvSet(key, value) { kv[key] = value; writes.push({ key, value }); },
  };
}

/** The Computer's skeleton, as computer/layout.mjs builds the parts the drawer touches. */
function surface(repo) {
  const root = document.createElement('div');
  root.id = 'lolcomputer';
  const drawer = document.createElement('div');
  drawer.className = 'comp-drawer';
  root.appendChild(drawer);
  const app = /** @type {any} */ ({ els: { root, drawer }, repo: repo || null, host: null });
  return { app, root, drawer };
}

export default (test) => {
  // ---- the pure renderers, unchanged (the plan's acceptance) ---------------------------------

  test('bodyText is byte-for-byte what C2 fixed, after inspect.mjs gained its host argument', () => {
    assert.equal(bodyText(valueOf('text', 'line one\nline two')), 'line one\nline two');
    assert.equal(bodyText(listOf([valueOf('text', 'a'), valueOf('text', 'b')])), '1. a\n2. b');
    assert.equal(bodyText(listOf([])), '');
    assert.equal(bodyText(valueOf('json', { a: 1 })), '{\n  "a": 1\n}');
    assert.equal(bodyText(null), '');

    const huge = 'x'.repeat(INSPECT_CAP + 500);
    const shown = bodyText(valueOf('text', huge));
    assert.ok(shown.length < huge.length, 'the drawer is not asked to paint megabytes either');
    assert.ok(shown.includes(t('graph.valueMore', { n: 500 })), 'and still says what was cut');
  });

  test('headingText is unchanged too', () => {
    assert.equal(headingText({}), t('graph.inspectTitle'));
    assert.equal(headingText({ partLabel: 'Ask' }), t('graph.inspectFrom', { part: 'Ask' }));
    assert.ok(headingText({ partLabel: 'Ask', item: { i: 2, n: 7 } }).includes(t('graph.inspectItem', { i: 3, n: 7 })));
  });

  // ---- the hosted inspector ------------------------------------------------------------------

  test('a hosted inspector renders into the host, with no close button and no Escape of its own', async () => {
    await withDom(() => {
      const mount = document.createElement('div');
      let closed = 0;
      const ins = createInspector({ els: {} }, { el: mount, onClose: () => { closed++; } });

      const el = ins.show(valueOf('text', 'the whole answer'), { partLabel: 'Ask' });
      assert.ok(el, 'it opened even though there is no conversation column anywhere');
      assert.equal(el.parentNode, mount, 'into the host it was given');
      assert.equal(el.className, 'graph-inspect', 'the same section css/graph.css already styles');
      assert.equal(el.querySelector('.graph-inspect-body').textContent, 'the whole answer');
      assert.equal(el.querySelector('.graph-inspect-head h3').textContent, headingText({ partLabel: 'Ask' }));
      assert.equal(el.querySelectorAll('button').length, 0,
        'no close button: the drawer supplies exactly one, and two would be two ways to shut it');

      const esc = keydown('Escape');
      el.dispatchEvent(esc);
      assert.equal(ins.open(), true, 'the section does not consume Escape in hosted mode');
      assert.equal(esc.stopped, false, 'so the drawer sees it — one handler for the key, not two');
    });
  });

  test('a hosted inspector shows one value at a time, and tells the host only when it really closed', async () => {
    await withDom(() => {
      const mount = document.createElement('div');
      let closed = 0;
      const ins = createInspector({ els: {} }, { el: mount, onClose: () => { closed++; } });

      ins.show(valueOf('text', 'first'));
      ins.show(valueOf('text', 'second'));
      assert.equal(mount.querySelectorAll('.graph-inspect').length, 1, 'the second opening replaced the first');
      assert.equal(mount.querySelector('.graph-inspect-body').textContent, 'second');
      assert.equal(closed, 0, 'replacing a value is not closing the drawer on the reader');

      assert.equal(ins.close(), true);
      assert.equal(closed, 1, 'THAT is a close, and the host hears about it');
      assert.equal(mount.querySelectorAll('.graph-inspect').length, 0);
      assert.equal(ins.close(), false, 'closing twice is a no-op, not a throw');
      assert.equal(closed, 1);
    });
  });

  test('a host that is not there refuses to half-open', async () => {
    await withDom(() => {
      const nowhere = createInspector({ els: {} }, { el: null });
      assert.equal(nowhere.show(valueOf('text', 'x')), null);
      assert.equal(nowhere.open(), false, 'no element was left dangling');
    });
  });

  // ---- the drawer itself ---------------------------------------------------------------------

  test('a dragged width is clamped before it is believed', () => {
    assert.equal(clampDrawerWidth(440), 440);
    assert.equal(clampDrawerWidth(10), DRAWER_MIN, 'a drawer you cannot read is not a drawer');
    assert.equal(clampDrawerWidth(5000), DRAWER_MAX, 'and one that eats the canvas is not either');
    assert.equal(clampDrawerWidth('not a number'), DRAWER_DEFAULT, 'a corrupt kv row falls back, it does not NaN');
    assert.equal(clampDrawerWidth(null), DRAWER_DEFAULT);
    assert.equal(clampDrawerWidth(399.6), 400, 'sub-pixel drags are rounded, not accumulated');
  });

  test('the drawer starts closed, opens on a value, and closes on its own button', async () => {
    await withDom(() => {
      const s = surface(fakeRepo());
      installDrawer(s.app);

      assert.equal(s.drawer.classList.contains('hidden'), true, 'nothing is being read yet');
      assert.equal(s.app.drawer.isOpen(), false);
      assert.ok(s.drawer.querySelector('.comp-drawer-grip'), 'the resize grip is there from the start');
      assert.equal(s.drawer.querySelector('.comp-drawer-close').textContent, t('computer.drawerClose'));
      assert.equal(s.drawer.querySelector('.comp-drawer-empty').textContent, t('computer.drawerEmpty'),
        'a blank column is indistinguishable from a broken one, so it says what it is for');

      const node = s.app.drawer.open(valueOf('text', 'a long answer'));
      assert.ok(node, 'the value rendered');
      assert.equal(s.app.drawer.isOpen(), true);
      assert.equal(s.drawer.classList.contains('hidden'), false);
      assert.equal(s.drawer.querySelector('.comp-drawer-mount .graph-inspect-body').textContent, 'a long answer');
      assert.equal(s.drawer.querySelector('.comp-drawer-empty').classList.contains('hidden'), true);

      s.drawer.querySelector('.comp-drawer-close').dispatchEvent({ type: 'click' });
      assert.equal(s.app.drawer.isOpen(), false, 'the one close button closed it');
      assert.equal(s.drawer.querySelectorAll('.graph-inspect').length, 0, 'and took the value with it');
    });
  });

  test('Escape closes the drawer and is consumed, so the run never hears it', async () => {
    await withDom(() => {
      const s = surface(fakeRepo());
      installDrawer(s.app);

      const closedWhileShut = keydown('Escape');
      s.drawer.dispatchEvent(closedWhileShut);
      assert.equal(closedWhileShut.prevented, false,
        'a closed drawer does not swallow Escape — it belongs to whatever is open in front of it');

      s.app.drawer.open(valueOf('text', 'reading this'));
      const other = keydown('a');
      s.drawer.dispatchEvent(other);
      assert.equal(s.app.drawer.isOpen(), true, 'an ordinary key changes nothing');
      assert.equal(other.stopped, false);

      const esc = keydown('Escape');
      s.drawer.dispatchEvent(esc);
      assert.equal(s.app.drawer.isOpen(), false, 'Escape closed the drawer');
      assert.equal(esc.prevented, true);
      assert.equal(esc.stopped, true, 'and stopped there: ui/shortcuts.mjs never reads it as "stop the run"');
    });
  });

  test('the canvas\'s value chip reaches the drawer through host.mjs\'s session.inspect', async () => {
    await withDom(() => {
      const s = surface(fakeRepo());
      // computer/host.mjs's session, as it forwards: it looks `app.drawer` up at CALL time, which
      // is what lets the two modules ignore each other and the install order.
      s.app.host = {
        session: {
          inspect: (v, o) => {
            const d = s.app.drawer;
            return d && typeof d.inspect === 'function' ? d.inspect(v, o || {}) : null;
          },
        },
      };
      installDrawer(s.app);

      // graph/canvas.mjs:926 — the click handler on a part's value chip, unchanged since C2.
      const node = s.app.host.session.inspect(valueOf('text', 'what the part produced'));
      assert.ok(node, 'the chip got an element back, as it has always done');
      assert.equal(s.app.drawer.isOpen(), true);
      assert.equal(s.drawer.querySelector('.graph-inspect-body').textContent, 'what the part produced');
    });
  });

  test('the drawer remembers how wide you dragged it, and survives a repo that has nothing to say', async () => {
    await withDom(async () => {
      const repo = fakeRepo({ [DRAWER_WIDTH_KEY]: 5000 });
      const s = surface(repo);
      installDrawer(s.app);
      assert.equal(s.app.drawer.width(), DRAWER_DEFAULT, 'the frame is up before the store answers');
      await Promise.resolve(); await Promise.resolve();
      assert.equal(s.app.drawer.width(), DRAWER_MAX, 'the stored width came back — and was clamped on the way in');
      assert.equal(s.drawer.style.width, `${DRAWER_MAX}px`);

      const bare = surface(null);
      installDrawer(bare.app);
      assert.equal(bare.app.drawer.width(), DRAWER_DEFAULT, 'no repo is not a crash');
      assert.equal(bare.app.drawer.open(valueOf('text', 'x')) !== null, true, 'and the drawer still works');
    });
  });

  test('a surface with no drawer element still installs an API nobody has to null-check', async () => {
    await withDom(() => {
      const app = /** @type {any} */ ({ els: {} });
      installDrawer(app);
      assert.equal(app.drawer.isOpen(), false);
      assert.equal(app.drawer.open(valueOf('text', 'x')), null);
      assert.equal(app.drawer.close(), false);
    });
  });

  // ---- the run bar's readouts ----------------------------------------------------------------

  test('the cap meter says spent over limit, and only warns when it is nearly gone', () => {
    assert.equal(capMeter(0, 50).text, '0 / 50');
    assert.equal(capMeter(0, 50).amber, false);
    assert.equal(capMeter(39, 50).amber, false, 'under 80 % is not worth a colour');
    assert.equal(capMeter(40, 50).amber, true, `${CAP_AMBER * 100} % is where it turns`);
    assert.equal(capMeter(50, 50).text, '50 / 50');
    assert.equal(capMeter(50, 50).amber, true);
    assert.equal(capMeter(1, 0).text, `1 / ${DEFAULT_MAX_ITEMS}`, 'a nonsense cap falls back to the runner\'s own');
    assert.equal(capMeter(-4, 50).text, '0 / 50', 'and a nonsense count reads as none');
  });

  test('the counts are written in the reader\'s grammar, not in {n}', () => {
    assert.equal(partsLabel(3), t('computer.runParts', { n: 3 }));
    assert.equal(partsLabel(1), t('computer.runPartsOne'));
    assert.equal(partsLabel(0), t('computer.runParts', { n: 0 }));
    assert.equal(generationsLabel(4), t('computer.runGenerations', { n: 4 }));
    assert.equal(generationsLabel(1), t('computer.runGenerationsOne'));
    assert.ok(partsLabel(3).includes('3'), 'and the number the reader cares about is in it');
  });
};
