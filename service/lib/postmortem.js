'use strict';

const { appendFileSync, readFileSync, statSync, renameSync } = require('fs');

const LOG = process.env.TUBE_LOG || '/home/owner/share/tube/service.log';

const MAX_BYTES = 64 * 1024;

function roll() {
    try {
        if (statSync(LOG).size > MAX_BYTES) renameSync(LOG, `${LOG}.1`);
    } catch (e) {
    }
}

function note(what, detail) {
    try {
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
        process.exit(1);
    });

    process.on('unhandledRejection', (error) => note('unhandled rejection', error));
    process.on('exit', (code) => { if (code) note('exit', `code ${code}`); });

    note('started', `pid ${process.pid}, node ${process.version}`);
}

module.exports = { LOG, note, read, watch };
