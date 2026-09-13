'use strict';

const { appendFileSync, readFileSync, statSync, renameSync, mkdirSync } = require('fs');
const { dirname } = require('path');

const LOG = process.env.TUBE_LOG || '/home/owner/share/tube/service.log';
const MAX_BYTES = 64 * 1024;

const state = { ready: false };

// appendFileSync fails when the directory is missing, and note() swallows that failure.
const ensure = () => {
    if (state.ready) return;
    state.ready = true;

    try { mkdirSync(dirname(LOG), { recursive: true }); } catch (e) { }
};

const describe = (detail) => {
    if (!detail) return String(detail);
    if (typeof detail === 'string') return detail;

    const code = detail.code || detail.name || 'Error';

    if (detail.stack) return detail.stack;
    if (detail.message) return `${code}: ${detail.message}`;

    return String(detail);
};

// Also kept in memory, numbered, for the boot screen to ask from.
const MOST_KEPT = 400;
const kept = { lines: [], next: 0 };

const remember = (what, text) => {
    kept.lines = kept.lines.concat([{ seq: kept.next, at: Date.now(), what, text }]).slice(-MOST_KEPT);
    kept.next += 1;
};

const note = (what, detail) => {
    const text = describe(detail);
    remember(what, text);

    try {
        ensure();
        try { if (statSync(LOG).size > MAX_BYTES) renameSync(LOG, `${LOG}.1`); } catch (e) { }
        appendFileSync(LOG, `${new Date().toISOString()}  ${what}: ${text}\n`);
    } catch (e) { /* logging must never be a reason to fail */ }
};

// A restarted service counts from 0 again, so asking past the end sends everything.
const since = (seq) => {
    const from = seq > kept.next ? 0 : seq;
    return { lines: kept.lines.filter((line) => line.seq >= from), next: kept.next };
};

const readOr = (file) => {
    try {
        return readFileSync(file, 'utf8');
    } catch (e) {
        return '';
    }
};

// The rotated file first, so the journal reads from the start.
const read = () => readOr(`${LOG}.1`) + readOr(LOG);

const watch = () => {
    process.on('uncaughtException', (error) => {
        note('uncaught', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (error) => note('unhandled rejection', error));
    process.on('exit', (code) => { if (code) note('exit', `code ${code}`); });

    note('started', `pid ${process.pid}, node ${process.version}`);
};

module.exports = { describe, note, read, remember, since, watch };
