'use strict';

// Never transpiled, so kept to what node 4.4.3 parses: strict-mode const, arrows, template strings.

const http = require('http');
const net = require('net');
const tls = require('tls');
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
    try {
        (fs.rmSync || fs.rmdirSync)(scratch, { recursive: true, force: true });
    } catch (e) {
        // rmdir cannot recurse below node 12.10.
    }
});

process.env.TUBE_PROXY_PORT = String(PORT);
process.env.TUBE_CACHE_DIR = scratch;
process.env.TUBE_LOG = path.join(scratch, 'service.log');

// A closed loopback port, so the update check fails at once instead of reaching the network from CI.
process.env.TUBE_ORIGIN = 'http://127.0.0.1:1';

// A test CA that is never packaged, so the intercepted path runs; node 4 used to abort on it.
process.env.TUBE_MITM_DIR = path.join(__dirname, 'fixtures', 'mitm');

const entry = process.env.TUBE_SMOKE_ENTRY
    ? path.resolve(process.env.TUBE_SMOKE_ENTRY)
    : path.join(__dirname, '..', 'dist', 'index.js');

if (!fs.existsSync(entry)) fail(`no bundle at ${entry} — run \`npm run build\` first.`);

try {
    require(entry);
} catch (e) {
    fail(`the bundle would not load on ${process.version}: ${(e && e.stack) || e}`);
}

pass(`the bundle loads on ${process.version}`);

const collect = (stream, done) => {
    const parts = [];
    stream.on('data', (chunk) => parts.push(chunk));
    stream.on('end', () => done(parts.join('')));
};

const get = (pathname, done) => {
    const request = http.get({ host: '127.0.0.1', port: PORT, path: pathname }, (response) => {
        collect(response, (body) => done(null, response.statusCode, body));
    });

    request.on('error', (error) => done(error));
    request.setTimeout(4000, () => request.destroy());
};

const post = (pathname, payload, done) => {
    const request = http.request({
        host: '127.0.0.1',
        port: PORT,
        path: pathname,
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(payload) }
    }, (response) => collect(response, (body) => done(null, response.statusCode, body)));

    request.on('error', (error) => done(error));
    request.setTimeout(4000, () => request.abort());
    request.end(payload);
};

// The container's whole route, and a path no plain GET touches. Answered locally, so no network.
const checkItInterceptsTls = () => {
    const socket = net.connect(PORT, '127.0.0.1', () => {
        socket.write('CONNECT www.youtube.com:443 HTTP/1.1\r\nHost: www.youtube.com:443\r\n\r\n');
    });

    socket.setTimeout(8000, () => fail('the intercepted CONNECT never finished'));
    socket.on('error', (error) => fail(`the intercepted CONNECT broke: ${error.message}`));

    socket.once('data', (reply) => {
        if (String(reply).indexOf(' 200 ') === -1) return fail(`CONNECT answered ${String(reply).split('\r\n')[0]}`);

        const held = { issuer: null };

        const secure = tls.connect({ socket, servername: 'www.youtube.com', rejectUnauthorized: false }, () => {
            held.issuer = secure.getPeerCertificate().issuer.CN;
            secure.write('GET /__tube/state HTTP/1.1\r\nHost: www.youtube.com\r\nConnection: close\r\n\r\n');
        });

        secure.on('error', (error) => fail(`TLS through the interception broke: ${error.message}`));

        return collect(secure, (answer) => {
            if (held.issuer !== 'Tube Smoke Test CA') return fail(`www.youtube.com was not intercepted (issuer ${held.issuer})`);
            if (answer.indexOf('HTTP/1.1 200') !== 0) return fail(`the intercepted request answered ${answer.split('\r\n')[0]}`);

            pass('it intercepts TLS and answers through it');

            process.stdout.write(`\nSmoke passed on ${process.version}.\n`);
            return process.exit(0);
        });
    });
};

// The player drops media requests all the time, and node below 8 has no stream destroy: it crashed.
const checkItSurvivesADroppedStream = () => {
    const chunk = 'x'.repeat(65536);

    const upstream = http.createServer((request, response) => {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.write(chunk);

        const timer = setInterval(() => response.write(chunk), 20);
        response.on('close', () => clearInterval(timer));
        setTimeout(() => {
            clearInterval(timer);
            response.end();
        }, 3000);
    });

    upstream.listen(0, '127.0.0.1', () => {
        const target = `http://127.0.0.1:${upstream.address().port}/media`;

        const request = http.get({ host: '127.0.0.1', port: PORT, path: `/cors-bypass/${target}` }, (response) => {
            response.once('data', () => {
                request.abort();

                setTimeout(() => get('/__tube/state', (error, status) => {
                    upstream.close();

                    if (error || status !== 200) {
                        return fail(`the service did not survive a dropped media stream${error ? `: ${error.message}` : ` (status ${status})`}`);
                    }

                    pass('it survives a media stream the page drops');

                    return checkItInterceptsTls();
                }), 300);
            });
        });

        request.on('error', () => undefined);
    });
};

// Every innertube call is a POST, and node below 8 once refused them all.
const checkItCanPost = (upstream, target) => post(`/cors-bypass/${target}`, 'ping', (postError, postStatus, echoed) => {
    upstream.close();

    if (postError) return fail(`a POST through the proxy broke: ${postError.message}`);

    if (postStatus !== 200 || echoed !== 'posted ping') {
        return fail(`a POST through the proxy answered ${postStatus}: ${readable(echoed).slice(0, 200)}`);
    }

    pass('it can send a request body upstream');

    return checkItSurvivesADroppedStream();
});

// Below node 14, node-fetch tied a close listener to a kept-alive socket for every request.
const REUSES = 12;

// One kept-alive socket, as Cobalt holds them, so the service's own socket upstream is reused.
const KEPT_ALIVE = new http.Agent({ keepAlive: true, maxSockets: 1 });

const fetchRepeatedly = (target, left, done) => {
    if (!left) return done();

    const request = http.get({ host: '127.0.0.1', port: PORT, path: `/cors-bypass/${target}`, agent: KEPT_ALIVE },
        (response) => collect(response, () => fetchRepeatedly(target, left - 1, done)));

    request.on('error', (error) => fail(`a repeated fetch broke: ${error.message}`));
    return undefined;
};

const checkSocketsStayClean = (target, next) => fetchRepeatedly(target, REUSES, () => get('/__tube/log', (error, status, log) => {
    if (error || status !== 200) return fail('/__tube/log did not answer');
    if (/memory leak/i.test(log)) return fail('a kept-alive socket collects a listener per request');

    pass(`${REUSES} requests over kept-alive sockets leave no listener behind`);

    return next();
}));

// Local routes answer even when fetch is broken; only an upstream round trip proves it works.
const checkItCanFetchUpstream = () => {
    const upstream = http.createServer((request, response) => {
        collect(request, (received) => {
            response.writeHead(200, { 'content-type': 'text/plain' });
            response.end(request.method === 'POST' ? `posted ${received}` : 'pong');
        });
    });

    upstream.listen(0, '127.0.0.1', () => {
        const target = `http://127.0.0.1:${upstream.address().port}/ping`;

        get(`/cors-bypass/${target}`, (error, status, body) => {
            if (error) return fail(`the proxy could not reach a local upstream: ${error.message}`);

            if (status !== 200 || body !== 'pong') {
                return fail(`the proxy answered ${status} for an upstream it should have fetched: ${readable(body).slice(0, 200)}`);
            }

            pass('it can fetch upstream and hand the answer back');

            return checkSocketsStayClean(target, () => checkItCanPost(upstream, target));
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
