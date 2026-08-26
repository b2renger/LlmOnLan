// The Farm app's REAL log file: userData/farm.log.
//
// Every error screen in this app says "see the log" — and until this file existed,
// there was no log: the supervised `lol up` output went to console.log, which a
// packaged Windows app swallows, and Settings ▸ "Open data & logs folder" opened a
// directory with nothing to read. An operator whose farm won't start dead-ended
// with nothing to paste into a bug report. (Audit round 2, finding #1.)
//
// Deliberately simple: append-only, size-capped by truncation-on-open when huge.
// This is a diagnostic breadcrumb trail, not an observability system.

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const MAX_BYTES = 5 * 1024 * 1024;   // ~a week of chatty bootstraps; truncate beyond
let checked = false;

export function farmLogFile(): string {
    return path.join(app.getPath('userData'), 'farm.log');
}

export function appendFarmLog(text: string): void {
    try {
        const f = farmLogFile();
        if (!checked) {
            checked = true;
            try {
                if (fs.existsSync(f) && fs.statSync(f).size > MAX_BYTES) fs.truncateSync(f, 0);
            } catch { /* best-effort */ }
        }
        const stamp = new Date().toISOString();
        const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
        if (!lines.length) return;
        fs.appendFileSync(f, lines.map((l) => `${stamp} ${l}`).join('\n') + '\n', 'utf8');
    } catch { /* logging must never break the farm */ }
}
