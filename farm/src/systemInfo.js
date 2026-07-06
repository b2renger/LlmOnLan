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
    // Unified-memory GPUs (NVIDIA GB10/Grace-Blackwell in the DGX Spark, Jetson,
    // integrated) share system RAM and report memory.total as 0/[N/A] via nvidia-smi —
    // so a detected GPU with 0 "VRAM" really has the whole RAM pool available. Report
    // that instead of a misleading "0 GB". (Guarded on a real GPU name so a box with no
    // nvidia-smi still reports vramGb:0.)
    if (gpu !== 'Unknown GPU' && vramGb === 0) vramGb = ramGb;
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
    // Unified-memory GPUs report memory.total as 0 (see detectHardware) — fall back to
    // the system RAM pool so the card shows the real capacity, not "0 GB".
    const ramGb = Math.round(os.totalmem() / (1024 ** 3));
    const totalGb = Number.isFinite(total) && total > 0 ? Math.round(total / 1024) : ramGb;
    return {
        gpuUtil: Number.isFinite(util) ? util : null,
        vramUsedGb: Number.isFinite(used) ? Math.round((used / 1024) * 10) / 10 : null,
        vramTotalGb: totalGb,
    };
}

module.exports = { detectHardware, gpuLiveStats };
