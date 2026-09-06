'use strict';

const { appendFileSync, readFileSync, statSync, renameSync, mkdirSync } = require('fs');
const { dirname } = require('path');

const LOG = process.env.TUBE_LOG || '/home/owner/share/tube/service.log';

const MAX_BYTES = 64 * 1024;

// The directory is not there on a set where nothing has created it yet, and appending into a
// missing one throws — inside the catch below, so every line written on such a set went nowhere
// and the log simply appeared to be empty. That is worse than no logging at all: it reads as
// evidence that the service never ran. Make the directory once, by hand rather than with a
// recursive mkdir, because the option is newer than the runtime on some of these televisions.
let ready = false;

function ensure() {
    if (ready) return;
    ready = true;

    const directory = dirname(LOG);
    const parts = directory.split('/');

    for (let i = 2; i <= parts.length; i += 1) {
        try {
            mkdirSync(parts.slice(0, i).join('/'));
        } catch (e) { /* already there, or not ours to make */ }
    }
}

function roll() {
    try {
        if (statSync(LOG).size > MAX_BYTES) renameSync(LOG, `${LOG}.1`);
    } catch (e) {
    }
}

function note(what, detail) {
    try {
        ensure();
        roll();
        const said = (detail && detail.stack) || String(detail);
        appendFileSync(LOG, `${new Date().toISOString()}  ${what}: ${said}\n`);
    } catch (e) {
    }
}

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

        // Exit, and let auto-restart have its turn. Staying alive to keep a diagnostic port open
        // was tried and is worse than the problem: the dying process goes on holding the port, so
        // every restart lands on EADDRINUSE and the service never recovers. The log is on disk and
        // outlives the process, which is what makes lingering unnecessary.
        process.exit(1);
    });

    process.on('unhandledRejection', (error) => note('unhandled rejection', error));
    process.on('exit', (code) => { if (code) note('exit', `code ${code}`); });

    note('started', `pid ${process.pid}, node ${process.version}`);
}

module.exports = { LOG, note, read, watch };
