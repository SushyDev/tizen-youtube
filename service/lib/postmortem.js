'use strict';

// Why the service stopped, written where it can be read back. Nothing collects stderr on a
// television, so a service that dies at startup is otherwise just a boot screen that times
// out.

const { appendFileSync, readFileSync, statSync, renameSync } = require('fs');

const LOG = process.env.TUBE_LOG || '/home/owner/share/tube/service.log';

// Small enough that it cannot fill a disk, large enough to hold a stack or two.
const MAX_BYTES = 64 * 1024;

function roll() {
    try {
        if (statSync(LOG).size > MAX_BYTES) renameSync(LOG, `${LOG}.1`);
    } catch (e) {
        // No log yet, or nowhere to put one. Either way there is nothing to roll.
    }
}

/** Writes one line. Never throws: a failure here must not become the failure. */
function note(what, detail) {
    try {
        roll();
        const said = (detail && detail.stack) || String(detail);
        appendFileSync(LOG, `${new Date().toISOString()}  ${what}: ${said}\n`);
    } catch (e) {
        // Nothing further can be done about it from here.
    }
}

/** What the log holds, for reading back over the diagnostics bridge. */
function read() {
    try {
        return readFileSync(LOG, 'utf8').slice(-MAX_BYTES);
    } catch (e) {
        return '';
    }
}

function watch() {
    process.on('uncaughtException', (error) => {
        note('uncaught', error);
        // Same as the default: an unhandled throw leaves the process in an unknown state.
        process.exit(1);
    });

    process.on('unhandledRejection', (error) => note('unhandled rejection', error));
    process.on('exit', (code) => { if (code) note('exit', `code ${code}`); });

    note('started', `pid ${process.pid}, node ${process.version}`);
}

module.exports = { LOG, note, read, watch };
