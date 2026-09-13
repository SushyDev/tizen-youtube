'use strict';

// Never transpiled, so kept to what node 4.4.3 parses: strict-mode const, arrows, template strings.

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.TUBE_PROXY_PORT) || 8398;
const DEADLINE = 20000;

const fail = (message) => {
    process.stderr.write(`FAIL  ${message}\n`);
    process.exit(1);
};

const pass = (message) => process.stdout.write(`PASS  ${message}\n`);

const readable = (body) => String(body).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const jsonOrNull = (text) => {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
};

const scratch = path.join(os.tmpdir(), `tube-smoke-${process.pid}-${Date.now()}`);
fs.mkdirSync(scratch);

process.on('exit', () => {
    (fs.rmSync || fs.rmdirSync)(scratch, { recursive: true, force: true });
});

process.env.TUBE_PROXY_PORT = String(PORT);
process.env.TUBE_CACHE_DIR = scratch;
process.env.TUBE_LOG = path.join(scratch, 'service.log');

// A closed loopback port, so the update check fails at once instead of reaching the network from CI.
process.env.TUBE_ORIGIN = 'http://127.0.0.1:1';

const entry = path.join(__dirname, '..', 'dist', 'index.js');

if (!fs.existsSync(entry)) fail(`no bundle at ${entry} — run \`npm run build\` first.`);

try {
    require(entry);
} catch (e) {
    fail(`the bundle would not load on ${process.version}: ${(e && e.stack) || e}`);
}

pass(`the bundle loads on ${process.version}`);

const get = (pathname, done) => {
    const request = http.get({ host: '127.0.0.1', port: PORT, path: pathname }, (response) => {
        const parts = [];
        response.on('data', (chunk) => parts.push(chunk));
        response.on('end', () => done(null, response.statusCode, parts.join('')));
    });

    request.on('error', (error) => done(error));
    request.setTimeout(4000, () => request.destroy());
};

// Local routes answer even when fetch is broken; only an upstream round trip proves it works.
const checkItCanFetchUpstream = () => {
    const upstream = http.createServer((request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('pong');
    });

    upstream.listen(0, '127.0.0.1', () => {
        const target = `http://127.0.0.1:${upstream.address().port}/ping`;

        get(`/cors-bypass/${target}`, (error, status, body) => {
            upstream.close();

            if (error) return fail(`the proxy could not reach a local upstream: ${error.message}`);

            if (status !== 200 || body !== 'pong') {
                return fail(`the proxy answered ${status} for an upstream it should have fetched: ${readable(body).slice(0, 200)}`);
            }

            pass('it can fetch upstream and hand the answer back');

            process.stdout.write(`\nSmoke passed on ${process.version}.\n`);
            return process.exit(0);
        });
    });
};

// A page line must come back from /__tube/log beside the service's own.
const checkThePageReachesTheJournal = () => {
    const line = `smoke: a page line on ${process.version}`;

    get(`/__tube/journal?m=${encodeURIComponent(line)}`, (error, status) => {
        if (error || status !== 204) {
            return fail(`/__tube/journal did not take a page line${error ? `: ${error.message}` : ` (status ${status})`}`);
        }

        return get('/__tube/log', (logError, logStatus, log) => {
            if (logError || logStatus !== 200) return fail('/__tube/log did not answer');
            if (log.indexOf(`page: ${line}`) === -1) return fail(`/__tube/log does not carry the page line: ${log.slice(-300)}`);
            if (log.indexOf('listening: ') === -1) return fail('/__tube/log does not carry the service start');

            pass('a page line lands in /__tube/log beside the service start');

            return checkItCanFetchUpstream();
        });
    });
};

const began = Date.now();

const waitForPort = () => get('/__tube/state', (error, status, body) => {
    // Up and answering badly is not something to wait out.
    if (!error && status !== 200) fail(`/__tube/state answered ${status} on ${process.version}: ${readable(body).slice(0, 300)}`);

    if (error) {
        if (Date.now() - began > DEADLINE) {
            fail(`the service never answered on port ${PORT} within ${DEADLINE / 1000}s (${error.message})`);
        }

        return setTimeout(waitForPort, 250);
    }

    const state = jsonOrNull(body);
    if (!state) return fail(`/__tube/state did not answer JSON: ${body.slice(0, 120)}`);

    pass(`/__tube/state answers on port ${PORT} after ${Date.now() - began}ms`);

    if (!state.script || typeof state.script.origin !== 'string') {
        return fail(`/__tube/state reports no userscript: ${JSON.stringify(state.script)}`);
    }

    pass(`it can serve the ${state.script.origin} userscript`);

    return get('/__tube/userScript.js', (scriptError, scriptStatus, script) => {
        if (scriptError || scriptStatus !== 200) {
            return fail(`/__tube/userScript.js did not answer${scriptError ? `: ${scriptError.message}` : ` (status ${scriptStatus})`}`);
        }

        if (script.length < 1000) return fail(`the userscript came back as ${script.length} bytes`);

        pass(`/__tube/userScript.js serves ${Math.round(script.length / 1024)}kB`);

        return checkThePageReachesTheJournal();
    });
});

waitForPort();
