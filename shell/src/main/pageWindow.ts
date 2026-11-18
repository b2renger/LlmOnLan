// The page's own window (VIBE_PAGE_PLAN step 2, owner 2026-11-18: LOL Vibe's page preview "should be detachable").
//
// A page from a LOL Vibe answer, its code beside it, in a window a person drags to another screen or a projector. It is
// a second window of the app's own page kind: our file:// page in its main frame, the sandbox's runner in a subframe,
// nothing else. index.ts builds it exactly as the main window (same preload, same session, WebRTC off, no menu) and
// guards its frames with `frameAllowed`, the rule the main window uses too. This file routes its messages:
//   main window ── page-window-open(target) ─▶ main ── page-window {type:'load'} ─▶ page window (once it is ready)
//   page window ── page-window-edits ─▶ main ── page-window {type:'edits'} ─▶ main window (which writes the store)
//   page window closed ─▶ main window hears {type:'closed'}
// Every message is checked: who sent it (only that window may), and its shape and size, before it is passed on.

import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { sameFileUrl } from './util';

/** The most a page may carry: blocks, and bytes of code (a model's answer is far smaller). */
export const PAGE_LIMITS = { fences: 64, bytes: 2 * 1024 * 1024, id: 128, lang: 32 };

export type PageTarget = {
    threadId: string; msgId: string; fences: { lang: string; code: string }[]; pageIndex: number;
    edits: Record<string, string>;
};

const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= PAGE_LIMITS.id && /^[\w.:-]+$/.test(v);

/** Edits as a page carries them: `{"<block index>": code}`, indexes inside the page. Null when not that. */
function cleanEdits(v: unknown, count: number): Record<string, string> | null {
    if (v === null || v === undefined) return {};
    if (typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, code] of Object.entries(v as Record<string, unknown>)) {
        if (!/^\d{1,3}$/.test(k) || Number(k) >= count || typeof code !== 'string') return null;
        out[k] = code;
    }
    return out;
}

/** A page the main window sends, or null. PURE. */
export function validPageTarget(v: unknown): PageTarget | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (!okId(o.threadId) || !okId(o.msgId) || !Array.isArray(o.fences)) return null;
    if (!o.fences.length || o.fences.length > PAGE_LIMITS.fences) return null;
    let bytes = 0;
    const fences: { lang: string; code: string }[] = [];
    for (const f of o.fences) {
        if (!f || typeof f !== 'object') return null;
        const lang = (f as Record<string, unknown>).lang;
        const code = (f as Record<string, unknown>).code;
        if (typeof lang !== 'string' || lang.length > PAGE_LIMITS.lang || typeof code !== 'string') return null;
        bytes += code.length;
        fences.push({ lang, code });
    }
    const pageIndex = o.pageIndex;
    if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= fences.length) return null;
    const edits = cleanEdits(o.edits, fences.length);
    if (!edits) return null;
    for (const code of Object.values(edits)) bytes += code.length;
    if (bytes > PAGE_LIMITS.bytes) return null;
    return { threadId: o.threadId, msgId: o.msgId, fences, pageIndex, edits };
}

/** Edits the page window sends back, or null. PURE. */
export function validPageEdits(v: unknown): { threadId: string; msgId: string; edits: Record<string, string> | null } | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (!okId(o.threadId) || !okId(o.msgId)) return null;
    if (o.edits === null) return { threadId: o.threadId, msgId: o.msgId, edits: null };
    const edits = cleanEdits(o.edits, PAGE_LIMITS.fences);
    if (!edits) return null;
    let bytes = 0;
    for (const code of Object.values(edits)) bytes += code.length;
    if (bytes > PAGE_LIMITS.bytes) return null;
    return { threadId: o.threadId, msgId: o.msgId, edits };
}

/**
 * May this frame of an app window load this address? PURE. The main frame stays on its own page (anywhere else would
 * run with the preload's door); a subframe may be only the sandbox's runner, or (the main window's IDE Preview) a
 * project the app serves on 127.0.0.1.
 */
export function frameAllowed(url: string, isMainFrame: boolean, pageUrl: string, runnerUrl: string, serves?: (u: string) => boolean): boolean {
    const u = String(url || '');
    if (isMainFrame) return sameFileUrl(u, pageUrl);
    if (sameFileUrl(u, runnerUrl)) return true;
    return !!(serves && serves(u));
}

type Deps = {
    ipc: Pick<IpcMain, 'handle' | 'on'>;
    mainWindow: () => BrowserWindow | null;
    /** A new page window, built and guarded (index.ts), not yet loaded with a page. */
    createWindow: () => BrowserWindow;
};

/** The page window's routes. Returns `close()` for the main window's own close. */
export function installPageWindow(d: Deps): { close: () => void; current: () => BrowserWindow | null } {
    let pageWin: BrowserWindow | null = null;
    let ready = false;
    let pending: PageTarget | null = null;
    // The answers this window was given in its life: edits for any other are dropped (review 2026-11-19 L5). Not only
    // the last: a switch of page flushes the previous page's typing after the new one arrives.
    const shown = new Set<string>();
    const keyOf = (threadId: string, msgId: string) => `${threadId}\n${msgId}`;

    const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed();
    const fromMain = (e: IpcMainEvent | IpcMainInvokeEvent) => { const m = d.mainWindow(); return alive(m) && e.sender === m.webContents; };
    const fromPage = (e: IpcMainEvent) => alive(pageWin) && e.sender === pageWin.webContents;
    const toMain = (ev: unknown) => { const m = d.mainWindow(); if (alive(m)) m.webContents.send('page-window', ev); };
    const deliver = () => {
        if (!alive(pageWin) || !ready || !pending) return;
        pageWin.webContents.send('page-window', { type: 'load', target: pending });
        shown.add(keyOf(pending.threadId, pending.msgId));
        pending = null;
    };

    d.ipc.handle('page-window-open', (e, raw) => {
        if (!fromMain(e)) return { ok: false, error: 'not the main window' };
        const target = validPageTarget(raw);
        if (!target) return { ok: false, error: 'not a page' };
        if (!alive(pageWin)) {
            ready = false;
            const w = d.createWindow();
            pageWin = w;
            w.on('closed', () => {
                if (pageWin === w) { pageWin = null; ready = false; pending = null; shown.clear(); }
                toMain({ type: 'closed' });
            });
            // A reload of the window (it has no menu, but a crash restarts the page) waits for its ready again.
            w.webContents.on('did-start-navigation', (n: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
                if (n && n.isMainFrame && !n.isSameDocument && pageWin === w) ready = false;
            });
        }
        pending = target;
        deliver();
        if (pageWin.isMinimized()) pageWin.restore();
        pageWin.show();
        pageWin.focus();
        return { ok: true };
    });
    d.ipc.on('page-window-ready', (e) => {
        if (!fromPage(e)) return;
        ready = true;
        deliver();
    });
    d.ipc.on('page-window-edits', (e, raw) => {
        if (!fromPage(e)) return;
        const edits = validPageEdits(raw);
        if (edits && shown.has(keyOf(edits.threadId, edits.msgId))) toMain({ type: 'edits', ...edits });
    });

    return {
        close: () => { if (alive(pageWin)) pageWin.close(); },
        current: () => (alive(pageWin) ? pageWin : null),
    };
}
