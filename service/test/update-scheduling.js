'use strict';

const http = require('http');
const net = require('net');
const { mkdtempSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { spawn } = require('child_process');

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

let manifestRequests = 0;

const origin = http.createServer((req, res) => {
    if (req.url === '/latest.json') {
        manifestRequests++;
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ version: '0.0.0', bundles: {} }));
    }
    res.statusCode = 404;
    res.end('no');
});

function get(path) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port: 8099, path, timeout: 8000 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timed out')); });
    });
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Spawns the real service on the real port, so it cannot share a machine with a running
// `npm run dev` — the other service would answer every request here and the failure would
// read as "a launch triggers no update check".
function proxyPortIsFree() {
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => resolve(false));
        probe.once('listening', () => probe.close(() => resolve(true)));
        probe.listen(8099, '127.0.0.1');
    });
}

origin.listen(0, '127.0.0.1', async () => {
    const originUrl = `http://127.0.0.1:${origin.address().port}`;

    if (!await proxyPortIsFree()) {
        console.error('Something is already listening on 127.0.0.1:8099.');
        console.error('This suite starts the service on that port; stop `npm run dev` and run it again.');
        origin.close();
        process.exit(1);
    }

    const service = spawn(process.execPath, [join(__dirname, '..', 'index.js')], {
        env: Object.assign({}, process.env, {
            TUBE_ORIGIN: originUrl,
            TUBE_CACHE_DIR: mkdtempSync(join(tmpdir(), 'tube-sched-'))
        }),
        stdio: 'ignore'
    });

    function finish(code) {
        service.kill();
        origin.close();
        process.exit(code);
    }

    wait(1200)
        .then(() => get('/__tube/state'))
        .then((body) => {
            const state = JSON.parse(body);
            check('state reports which script this TV would run',
                !!state.script && typeof state.script.version === 'string',
                JSON.stringify(state.script));
            check('state reports the bundle variant',
                state.script.variant === 'modern',
                JSON.stringify(state.script));

            return wait(600);
        })
        .then(() => {
            check('a launch triggers an update check', manifestRequests >= 1, `${manifestRequests} requests`);
            const after = manifestRequests;

            return get('/__tube/state')
                .then(() => get('/__tube/state'))
                .then(() => get('/__tube/state'))
                .then(() => get('/__tube/state'))
                .then(() => get('/__tube/state'))
                .then(() => wait(600))
                .then(() => {
                    check('repeated launches do not re-hit the origin',
                        manifestRequests === after,
                        `${manifestRequests - after} extra requests`);
                });
        })
        .then(() => {
            const failed = results.filter((r) => !r).length;
            console.log(`\n${results.length - failed}/${results.length} checks passed.`);
            finish(failed ? 1 : 0);
        })
        .catch((err) => {
            console.error('Harness error:', err.message);
            finish(1);
        });
});
