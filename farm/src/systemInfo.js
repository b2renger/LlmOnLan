// Farm hardware + live GPU stats — for the discovery snapshot, `lol status`, and
// the client's farm cards. Dependency-free: RAM/CPU from os, GPU from nvidia-smi
// (GPU boxes are overwhelmingly NVIDIA). Degrades gracefully on non-NVIDIA boxes
// (gpu='Unknown GPU', live stats null) — swap in `systeminformation` if you need
// AMD/Apple GPU detection.

const os = require('os');
const { execFile } = require('child_process');

function execFileP(cmd, args, timeoutMs = 4000) {
    return new Promise((resolve) => {
        try {
            execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
                resolve(err ? null : String(stdout || '').trim());
            });
        } catch { resolve(null); }
    });
}

// Static hardware, detected once at boot: { gpu, vramGb, ramGb, cpuCores }.
async function detectHardware() {
    const ramGb = Math.round(os.totalmem() / (1024 ** 3));
    const cpuCores = (os.cpus() || []).length;
    let gpu = 'Unknown GPU';
    let vramGb = 0;
    const out = await execFileP('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
    if (out) {
        const [name, memMb] = (out.split(/\r?\n/)[0] || '').split(',').map((s) => (s || '').trim());
        if (name) { gpu = name; vramGb = Math.round((Number(memMb) || 0) / 1024); }
    }
    return { gpu, vramGb, ramGb, cpuCores };
}

// Live GPU stats (refreshed on the health timer): util% + VRAM used/total in GB.
// All null if nvidia-smi is unavailable.
async function gpuLiveStats() {
    const out = await execFileP(
        'nvidia-smi',
        ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
        3000
    );
    if (!out) return { gpuUtil: null, vramUsedGb: null, vramTotalGb: null };
    const [util, used, total] = (out.split(/\r?\n/)[0] || '').split(',').map((s) => Number((s || '').trim()));
    return {
        gpuUtil: Number.isFinite(util) ? util : null,
        vramUsedGb: Number.isFinite(used) ? Math.round((used / 1024) * 10) / 10 : null,
        vramTotalGb: Number.isFinite(total) ? Math.round(total / 1024) : null,
    };
}

module.exports = { detectHardware, gpuLiveStats };
