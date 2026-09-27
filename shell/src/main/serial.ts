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
    // The check handler is what `navigator.serial` consults: allow serial here, keep Electron's default
    // (granted) for everything else this window already used before P3a-2.
    ses.setPermissionCheckHandler(() => true);
    // A board the person picked stays usable after a reload (getPorts). ponytail: every USB serial device
    // of this computer passes — they are local and the person still picks one per box. Upgrade path:
    // remember the granted device ids.
    ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
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
