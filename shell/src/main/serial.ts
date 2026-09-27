// The Computer's USB serial (ecosystem plan v2 §8d, P3a-2): the browser's own Web Serial runs in the
// renderer (renderer/chat/net/serial.mjs); main answers the two questions Electron leaves to the app —
// may this window use serial, and WHICH port did the person pick. A person always picks: main forwards
// the port list to the page, which shows it next to the button that asked, and nothing is chosen for them.
//
// Sending stays behind the outputs choke point (outputs.ts): a Send box asks main before it writes a line,
// so a disarmed graph is a dry run over USB exactly as over the network.

import { ipcMain, Session, WebContents } from 'electron';

/** The port chooser's answer, while one is open. '' = cancelled. */
let pending: ((portId: string) => void) | null = null;

export interface SerialPortChoice { portId: string; name: string; vendorId?: string; productId?: string }

/** The pure part: Electron's port list → what the page shows. */
export function choicesOf(list: Array<{ portId: string; portName?: string; displayName?: string; vendorId?: string; productId?: string }>): SerialPortChoice[] {
    return (Array.isArray(list) ? list : []).map((p) => ({
        portId: String(p.portId),
        name: String(p.displayName || p.portName || p.portId),
        vendorId: p.vendorId, productId: p.productId,
    }));
}

/** Web Serial for the window's own session (DATA_DIR/lol-client), never the OWUI webview's. */
export function configureSerial(ses: Session): void {
    // The check handler is what `navigator.serial` consults. Serial: only the app's own page (file://) —
    // never the sandbox guest's opaque origin. Everything else: exactly Electron's default without a
    // handler (critic S4, 2026-09-27: `() => true` also granted deprecated-sync-clipboard-read).
    ses.setPermissionCheckHandler((_wc, permission, _origin, details) => {
        if (permission === 'serial') return String((details && details.securityOrigin) || '').startsWith('file://');
        return permission !== 'deprecated-sync-clipboard-read';
    });
    // NO device permission handler (critic S2): with one, every serial device of this computer counted as
    // granted, so an imported graph's Receive box opened — and reset — a matching board as it rendered, with
    // no pick. Without it a port is usable once a person picked it, for this session (reloads included);
    // after a restart the person picks the board again.
    ses.on('select-serial-port', (event, portList, webContents: WebContents, callback) => {
        event.preventDefault();
        if (pending) pending('');            // a chooser still open: that one is cancelled
        pending = callback;
        webContents.send('lol:serial:choose', choicesOf(portList as any));
    });
}

export function registerSerialIpc(): void {
    ipcMain.handle('lol:serial:chosen', (_e, portId: unknown) => {
        const cb = pending;
        pending = null;
        if (cb) cb(typeof portId === 'string' ? portId : '');
        return true;
    });
}
