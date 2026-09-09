'use strict';

// The remote inspector's half of the pair that runs on this machine.
//
// The television carries chii's target script and opens the socket back; both are addressed to
// youtube.com, travel out through the proxy's TLS front, and are turned round towards here by
// service/dev/chii.js. Cobalt sends HTTP through --proxy but not WebSockets, which is why neither
// half may be addressed to this machine directly — a socket opened straight at the LAN closes 1006.
//
// So this end is an ordinary chii server and nothing more, and the one thing worth getting right is
// the address: it is baked into the widget at build time, and a set cannot be told a new one
// without another install.
//
//   npm run chii                     start it, and print what to build against
//   TUBE_CHII_PORT=9000 npm run chii
//
// Run through npx rather than added to devDependencies: it is a debugger a handful of sessions ever
// want, and every install of this repo would otherwise carry its frontend bundle.

const { spawn } = require('child_process');
const { networkInterfaces } = require('os');

const ui = require('./report.js');
const { load } = require('./config.js');

// Pinned, so an install a year from now starts the inspector this was written against.
const CHII = 'chii@1.15.5';

const PORT = Number(process.env.TUBE_CHII_PORT) || load().ports.chii;

// Never localhost. The socket is opened from inside the container on the television and has to
// cross the LAN to get here, so the address baked into the build has to be one the set can reach.
const lanAddress = () => {
    const every = networkInterfaces();

    const found = Object.keys(every)
        .reduce((all, name) => all.concat(every[name] || []), [])
        .filter((entry) => entry && !entry.internal && (entry.family === 'IPv4' || entry.family === 4));

    return found.length ? found[0].address : null;
};

const main = () => {
    const address = lanAddress();

    ui.heading('chii', `remote inspector on :${PORT}`);

    if (!address) ui.warn('no LAN address on this machine — the set will have nothing to reach');

    ui.info('ui', `http://localhost:${PORT}`);
    ui.info('build', `TUBE_CHII=${address || '<this machine>'}:${PORT} npm run deploy`);
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
