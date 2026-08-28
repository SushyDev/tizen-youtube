'use strict';

// Consistent terminal output for the build tools. Colour is disabled when NO_COLOR is
// set, when stdout is not a TTY, or when TERM says dumb.

const ESC = String.fromCharCode(27);

const enabled = !process.env.NO_COLOR &&
    process.env.TERM !== 'dumb' &&
    !!process.stdout.isTTY;

function paint(code) {
    return (text) => (enabled ? `${ESC}[${code}m${text}${ESC}[0m` : String(text));
}

const style = {
    bold: paint('1'),
    dim: paint('2'),
    red: paint('31'),
    green: paint('32'),
    yellow: paint('33'),
    blue: paint('34'),
    cyan: paint('36')
};

const SYMBOLS = { ok: '\u2713', fail: '\u2717', warn: '!', step: '\u25b8' };

function heading(text, subtitle) {
    process.stdout.write(`\n${style.bold(text)}${subtitle ? ` ${style.dim(subtitle)}` : ''}\n`);
}

function group(text) {
    process.stdout.write(`\n${style.blue(SYMBOLS.step)} ${style.bold(text)}\n`);
}

function ok(label, detail, ms) {
    const timing = ms === undefined ? '       ' : style.dim(`${(ms / 1000).toFixed(1)}s`.padStart(7));
    process.stdout.write(`  ${style.green(SYMBOLS.ok)} ${label.padEnd(32)}${timing}  ${detail ? style.dim(detail) : ''}\n`);
}

function fail(label, detail) {
    process.stdout.write(`  ${style.red(SYMBOLS.fail)} ${label.padEnd(32)}${detail ? `  ${detail}` : ''}\n`);
}

function warn(text) {
    process.stdout.write(`  ${style.yellow(SYMBOLS.warn)} ${text}\n`);
}

function info(label, value) {
    process.stdout.write(`  ${style.dim(label.padEnd(9))} ${value}\n`);
}

function note(text) {
    process.stdout.write(`${text}\n`);
}

function blank() {
    process.stdout.write('\n');
}

// Prints an error the way a person can act on it, not a stack trace.
function crash(err) {
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(`\n${style.red('Failed.')}\n\n`);
    message.split('\n').forEach((line) => process.stderr.write(`  ${line}\n`));
    if (err && err.stack && !err.isConfigError && !err.isFriendly) {
        process.stderr.write(`\n${style.dim(err.stack.split('\n').slice(1, 4).join('\n'))}\n`);
    }
    process.stderr.write('\n');
    process.exit(1);
}

function bytes(n) {
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
    return `${Math.round(n / 1024)}KB`;
}

module.exports = { style, heading, group, ok, fail, warn, info, note, blank, crash, bytes, enabled };
