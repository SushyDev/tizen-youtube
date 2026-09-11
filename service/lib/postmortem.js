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

const note = (what, detail) => {
    try {
        ensure();
        try { if (statSync(LOG).size > MAX_BYTES) renameSync(LOG, `${LOG}.1`); } catch (e) { }
        appendFileSync(LOG, `${new Date().toISOString()}  ${what}: ${describe(detail)}\n`);
    } catch (e) { /* logging must never be a reason to fail */ }
};

const read = () => {
    try {
        return readFileSync(LOG, 'utf8').slice(-MAX_BYTES);
    } catch (e) {
        return '';
    }
};

const watch = () => {
    process.on('uncaughtException', (error) => {
        note('uncaught', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (error) => note('unhandled rejection', error));
    process.on('exit', (code) => { if (code) note('exit', `code ${code}`); });

    note('started', `pid ${process.pid}, node ${process.version}`);
};

module.exports = { describe, note, read, watch };
