'use strict';

// Starts a chii server and prints the TUBE_CHII address to build against.
//
//   npm run chii                     start it, and print what to build against
//   TUBE_CHII_PORT=9000 npm run chii

const { spawn } = require('child_process');
const { networkInterfaces } = require('os');

const ui = require('./report.js');
const { load } = require('./config.js');

// Pinned, so an install a year from now starts the inspector this was written against.
const CHII = 'chii@1.15.5';

const PORT = Number(process.env.TUBE_CHII_PORT) || load().ports.chii;

// The set reaches this across the LAN, so never localhost.
const lanAddresses = () => {
    const every = networkInterfaces();

    return Object.keys(every)
        .reduce((all, name) => all.concat(every[name] || []), [])
        .filter((entry) => entry && !entry.internal && (entry.family === 'IPv4' || entry.family === 4))
        .map((entry) => entry.address);
};

const main = () => {
    const addresses = lanAddresses();
    const candidates = addresses.length ? addresses : ['<this machine>'];

    ui.heading('chii', `remote inspector on :${PORT}`);

    if (!addresses.length) ui.warn('no LAN address on this machine — the set will have nothing to reach');

    ui.info('ui', `http://localhost:${PORT}`);
    candidates.forEach((address) => ui.info('build', `TUBE_CHII=${address}:${PORT} npm run deploy`));
    ui.info('arm', 'set tube.inspector in the page, then reopen the app — docs/DEVELOP.md');
    ui.blank();

    const child = spawn('npx', ['-y', CHII, 'start', '--port', String(PORT), '--host', '0.0.0.0'], {
        stdio: 'inherit'
    });

    child.on('error', (error) => ui.crash(error));
    child.on('exit', (code) => process.exit(code || 0));

    process.on('SIGINT', () => child.kill());
    process.on('SIGTERM', () => child.kill());
};

main();
