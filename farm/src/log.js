// Tiny logger — dependency-free ANSI, auto-disabled when not a TTY or NO_COLOR.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

const paint = {
    dim: c('2'),
    bold: c('1'),
    red: c('31'),
    green: c('32'),
    yellow: c('33'),
    blue: c('34'),
    cyan: c('36'),
    grey: c('90'),
};

const TAG = paint.bold(paint.cyan('lol'));

function info(msg) { console.log(`${TAG} ${msg}`); }
function step(msg) { console.log(`${TAG} ${paint.blue('›')} ${msg}`); }
function ok(msg) { console.log(`${TAG} ${paint.green('✓')} ${msg}`); }
function warn(msg) { console.warn(`${TAG} ${paint.yellow('!')} ${msg}`); }
function err(msg) { console.error(`${TAG} ${paint.red('✗')} ${msg}`); }
function plain(msg) { console.log(msg); }

// Prefix a child process's lines so its logs are distinguishable in `lol up`.
function childPrefix(name) {
    const tag = paint.grey(`[${name}]`);
    return (chunk) => {
        const text = chunk.toString();
        for (const line of text.split(/\r?\n/)) {
            if (line.length) console.log(`${tag} ${line}`);
        }
    };
}

module.exports = { info, step, ok, warn, err, plain, childPrefix, paint };
