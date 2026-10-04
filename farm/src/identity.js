// Stable farm identity — a UUID persisted once so a farm keeps the same id across
// restarts (the client de-dupes discovered farms by id, not by IP, since DHCP can
// move the IP). Dependency-free: crypto.randomUUID + a dotfile next to the config.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID_FILE = path.join(__dirname, '..', '.lol-id');
const SECRET_FILE = path.join(__dirname, '..', '.lol-secret');

// A one-line dotfile, read back or created once with make().
function persisted(file, make, mode) {
    try {
        const v = fs.readFileSync(file, 'utf8').trim();
        if (v) return v;
    } catch { /* fall through to (re)create */ }
    const v = make();
    try { fs.writeFileSync(file, v + '\n', { encoding: 'utf8', mode }); } catch { /* non-fatal */ }
    return v;
}

function farmId() {
    return persisted(ID_FILE, () => crypto.randomUUID());
}

// The Python plugins' bearer keys (OCR, Classify, speech to text), the SAME on every run
// (multi-user plan 0.3): the OCR key rides into every client's Open WebUI env, so a fresh key
// per start restarted every connected client's Open WebUI on every farm restart. One secret
// persisted next to .lol-id (owner-only where the OS has modes), one HMAC per plugin id.
// Deleting the file rotates them all at the next start.
function pluginKey(id, file = SECRET_FILE) {
    const secret = persisted(file, () => crypto.randomBytes(32).toString('hex'), 0o600);
    return crypto.createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 48);
}

module.exports = { farmId, pluginKey, ID_FILE, SECRET_FILE };
