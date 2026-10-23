// node check.js <project dir> → runs sketch.js against a p5 stub and checks the slider and the Reset button.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const dir = process.argv[2];
const fails = [];
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
if (!/p5(\.min)?\.js/.test(html) || !/sketch\.js/.test(html)) fails.push('index.html no longer loads p5 and sketch.js');
const src = fs.readFileSync(path.join(dir, 'sketch.js'), 'utf8');

function run() {
    const sliders = []; const buttons = []; let ball = null;
    const el = (rec) => new Proxy(rec, { get: (t, k) => (k in t ? t[k] : () => el(t)) });
    const ctx = {
        console, Math, width: 0, height: 0, frameCount: 0,
        createCanvas(w, h) { ctx.width = w; ctx.height = h; return el({}); },
        createSlider(min, max, val, step) { const s = el({ min, max, val: val ?? min, step, cbs: [], input(f) { this.cbs.push(f); return this; }, changed(f) { this.cbs.push(f); return this; }, value(v) { if (v !== undefined) { this.val = v; for (const f of this.cbs) f(); return this; } return this.val; } }); sliders.push(s); return s; },
        createButton(label) { const b = el({ label: String(label), fn: null, mousePressed(f) { this.fn = f; return this; }, mouseClicked(f) { this.fn = f; return this; } }); buttons.push(b); return b; },
        circle(x, y) { ball = [x, y]; }, ellipse(x, y) { ball = [x, y]; },
    };
    for (const f of ['background', 'fill', 'noFill', 'stroke', 'noStroke', 'strokeWeight', 'text', 'textSize', 'textAlign', 'rect', 'line', 'push', 'pop', 'translate', 'frameRate', 'createP', 'createDiv', 'createSpan', 'select', 'colorMode', 'smooth']) ctx[f] = () => el({});
    ctx.constrain = (n, a, b) => Math.max(a, Math.min(b, n));
    for (const f of ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'ceil', 'pow']) ctx[f] = Math[f];
    ctx.sq = (n) => n * n; ctx.map = (v, a, b, c, d) => c + ((v - a) * (d - c)) / (b - a); ctx.lerp = (a, b, t) => a + (b - a) * t;
    ctx.mag = (a, b) => Math.hypot(a, b); ctx.radians = (d) => (d * Math.PI) / 180; ctx.degrees = (r) => (r * 180) / Math.PI;
    let seed = 1; ctx.random = (a, b) => { seed = (seed * 16807) % 2147483647; const r = seed / 2147483647; if (Array.isArray(a)) return a[Math.floor(r * a.length)]; if (a === undefined) return r; if (b === undefined) return r * a; return a + r * (b - a); };
    ctx.int = (n) => Math.trunc(Number(n)); ctx.float = Number; ctx.str = String; ctx.millis = () => ctx.frameCount * 16.7; ctx.deltaTime = 16.7;
    ctx.PI = Math.PI; ctx.TWO_PI = 2 * Math.PI; ctx.HALF_PI = Math.PI / 2; ctx.QUARTER_PI = Math.PI / 4; ctx.mouseX = 0; ctx.mouseY = 0; ctx.keyIsDown = () => false;
    ctx.dist = (a, b, c, d) => Math.hypot(c - a, d - b);
    ctx.abs = Math.abs; ctx.sqrt = Math.sqrt; ctx.min = Math.min; ctx.max = Math.max; ctx.round = Math.round; ctx.floor = Math.floor; ctx.sign = Math.sign;
    ctx.createVector = (x = 0, y = 0) => ({ x, y, mag() { return Math.hypot(this.x, this.y); }, setMag(m) { const k = m / (Math.hypot(this.x, this.y) || 1); this.x *= k; this.y *= k; return this; }, normalize() { return this.setMag(1); }, mult(k) { this.x *= k; this.y *= k; return this; }, add(v) { this.x += v.x; this.y += v.y; return this; }, copy() { return ctx.createVector(this.x, this.y); }, set(a, b) { this.x = a; this.y = b; return this; } });
    ctx.LEFT = 'left'; ctx.CENTER = 'center'; ctx.RIGHT = 'right'; ctx.TOP = 'top';
    vm.createContext(ctx);
    vm.runInContext(src + '\n;globalThis.__setup = typeof setup === "function" ? setup : null; globalThis.__draw = typeof draw === "function" ? draw : null;', ctx, { timeout: 2000 });
    return { ctx, sliders, buttons, ball: () => ball };
}
try {
    const s = run();
    s.ctx.__setup();
    const slider = s.sliders.find((x) => Number(x.min) === 0 && Number(x.max) === 10);
    if (!slider) fails.push('no createSlider(0, 10, ...)');
    else if (Number(slider.value()) !== 3) fails.push(`the slider starts at ${slider.value()}, not 3`);
    const reset = s.buttons.find((b) => /reset/i.test(b.label));
    if (!reset) fails.push('no Reset button');
    else if (typeof reset.fn !== 'function') fails.push('the Reset button does nothing (no mousePressed)');
    const step = () => { const a = s.ball(); s.ctx.frameCount++; s.ctx.__draw(); const b = s.ball(); return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : null; };
    if (slider) {
        // From the centre, a few frames: no wall is hit at these speeds.
        step(); const d3 = step();
        slider.value(6); step(); const d6 = step();
        slider.value(0); step(); const d0 = step();
        if (!(d3 > 0)) fails.push(`the ball does not move at speed 3 (${d3})`);
        else if (!(d6 / d3 > 1.7 && d6 / d3 < 2.3)) fails.push(`speed 6 is not twice speed 3 (${d3?.toFixed(2)} vs ${d6?.toFixed(2)} px/frame)`);
        if (!(d0 < 1e-9)) fails.push(`the ball moves at speed 0 (${d0})`);
        slider.value(5);
        step(); const d5 = step();
        for (let i = 0; i < 30; i++) step();
        if (reset && reset.fn) {
            reset.fn();
            const b0 = s.ball();
            s.ctx.__draw();
            const b = s.ball();
            const off = Math.hypot(b[0] - 200, b[1] - 150);
            if (off > d5 + 0.5) fails.push(`after Reset the ball is ${off.toFixed(1)} px from the centre`);
        }
    }
} catch (e) { fails.push('the sketch throws: ' + e.message); }
console.log(JSON.stringify({ pass: fails.length === 0, fails }));
process.exit(fails.length ? 1 : 0);
