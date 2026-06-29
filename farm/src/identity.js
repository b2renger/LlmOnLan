// Stable farm identity — a UUID persisted once so a farm keeps the same id across
// restarts (the client de-dupes discovered farms by id, not by IP, since DHCP can
// move the IP). Dependency-free: crypto.randomUUID + a dotfile next to the config.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID_FILE = path.join(__dirname, '..', '.lol-id');

function farmId() {
    try {
        if (fs.existsSync(ID_FILE)) {
            const v = fs.readFileSync(ID_FILE, 'utf8').trim();
            if (v) return v;
        }
    } catch { /* fall through to (re)create */ }
    const id = crypto.randomUUID();
    try { fs.writeFileSync(ID_FILE, id + '\n', 'utf8'); } catch { /* non-fatal */ }
    return id;
}

module.exports = { farmId, ID_FILE };
