'use strict';

const { appendFileSync, readFileSync, statSync, renameSync, mkdirSync } = require('fs');
const { dirname } = require('path');

const LOG = process.env.TUBE_LOG || '/home/owner/share/tube/service.log';
const MAX_BYTES = 64 * 1024;

const state = { ready: false };

// mkdirSync's recursive option is newer than the runtime on some of these sets, and appending
// into a missing directory throws inside the catch below — so the log reads as empty, which
// looks exactly like a service that never ran.
const ensure = () => {
    if (state.ready) return;
    state.ready = true;

    const parts = dirname(LOG).split('/');

    for (let step = 2; step <= parts.length; step += 1) {
        try { mkdirSync(parts.slice(0, step).join('/')); } catch (e) { /* there, or not ours */ }
    }
};

// One shape for every error the service reports, so a log line always names the code.
const describe = (detail) => {
    if (!detail) return String(detail);
    if (typeof detail === 'string') return detail;

    const code = detail.code || detail.name || 'Error';

    if (detail.stack) return `${code}: ${detail.stack}`;
    if (detail.message) return `${code}: ${detail.message}`;

    return String(detail);
};

const note = (what, detail) => {
    try {
        ensure();
        try { if (statSync(LOG).size > MAX_BYTES) renameSync(LOG, `${LOG}.1`); } catch (e) { /* new */ }
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
    // Exit rather than linger: a dying process goes on holding the port, so every restart lands
    // on EADDRINUSE and the service never recovers. The log outlives it.
    process.on('uncaughtException', (error) => {
        note('uncaught', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (error) => note('unhandled rejection', error));
    process.on('exit', (code) => { if (code) note('exit', `code ${code}`); });

    note('started', `pid ${process.pid}, node ${process.version}`);
};

module.exports = { LOG, describe, note, read, watch };
