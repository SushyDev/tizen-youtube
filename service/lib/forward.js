'use strict';

// Cobalt can be told to send everything through a proxy. It then speaks the forward-proxy form:
// an absolute URI on the request line for plain HTTP, and CONNECT for TLS. Answering both lets the
// container's own networking come through the service, with nothing in the page rewritten.

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const URL = require('url');

const journal = require('./journal.js');
const postmortem = require('./postmortem.js');

// Guarded for the same reason as in index.js: interception is an extra, and the tunnel has to work
// without it. A module that will not load here must cost the MITM, never the proxy.
let cobalt = null;
try {
    cobalt = require('./cobalt.js');
} catch (e) {
    postmortem.note('cobalt', `module would not load: ${(e && e.message) || e}`);
}

const ABSOLUTE = /^https?:\/\//i;

// The material is made on the television by cobalt.js rather than shipped, so it may not exist yet
// when the first connection arrives — key generation takes seconds on this hardware. Until it does,
// every host is tunnelled through untouched, which is a working television showing stock YouTube
// rather than a broken one. A `disabled` file beside the keys forces that state permanently.
function mitmConfig() {
    if (!cobalt) return null;

    try {
        if (fs.existsSync(`${cobalt.MITM_DIR}/disabled`)) return null;

        return cobalt.material();
    } catch (e) {
        return null;
    }
}

function mitmHost(host) {
    const name = String(host || '').split(':')[0].toLowerCase();
    return name === 'youtube.com' || name.endsWith('.youtube.com')
        || name === 'googleapis.com' || name.endsWith('.googleapis.com')
        || name === 'google.com' || name.endsWith('.google.com')
        || name === 'gstatic.com' || name.endsWith('.gstatic.com')
        || name === 'ggpht.com' || name.endsWith('.ggpht.com');
}

// The request line names us when the container is only reaching the service itself; those are
// served from the ordinary routes rather than forwarded back out.
function ourHosts(host, port) {
    // The bare host counts too. Cobalt drops the port when it rebuilds a URL out of
    // INNERTUBE_HOST_OVERRIDE, so those requests arrive naming us on port 80 — and forwarding them
    // there reaches nothing, which shows up as every innertube call retrying its preflight.
    return [`${host}:${port}`, host, `localhost:${port}`, `127.0.0.1:${port}`];
}

function absoluteTarget(url) {
    return ABSOLUTE.test(url) ? url : null;
}

// Turns "GET http://us:8099/tv" back into "GET /tv" so the routes see what they expect.
function normaliseSelf(req, host, port) {
    const target = absoluteTarget(req.url);
    if (!target) return false;

    const parsed = URL.parse(target);
    if (ourHosts(host, port).indexOf(parsed.host) === -1) return false;

    req.url = parsed.path || '/';
    return true;
}

function tunnel(server) {
    // The container never opens the dev bridge, so the in-memory journal is unreadable from
    // inside it and whether the handshake was accepted is the whole question. While the MITM is
    // switched on, put that one fact where Homebrew can read it; the log rolls at 64KB.
    // Deduplicated so a page load does not write fifty identical lines, but only for a minute —
    // long enough to collapse one launch, short enough that the next launch says so. Suppressing
    // repeats for the life of the process makes the log read as though nothing happened at all,
    // which is indistinguishable from the container never having connected.
    const seen = {};
    const QUIET = 60000;

    const record = (topic, detail) => {
        const key = `${topic} ${detail}`;
        const now = Date.now();
        if (seen[key] && now - seen[key] < QUIET) return;

        seen[key] = now;
        postmortem.note('mitm', key);
    };

    // Built on the first connection that could use it rather than at start-up, and rebuilt from
    // nothing if the material was still being made then. Two file reads, at most every few seconds.
    let mitm = null;
    let asked = 0;

    function interceptor() {
        if (mitm) return mitm;
        if (Date.now() - asked < 3000) return null;
        asked = Date.now();

        const config = mitmConfig();
        if (!config) return null;

        mitm = tls.createServer(config, (socket) => {
            // Feed decrypted HTTP into the existing Express application. The marker lets the
            // fallback preserve the original Host instead of assuming www.youtube.com.
            socket.__tubeMitm = true;
            if (journal.wanted()) journal.service('mitm', `secure ${socket.servername || '?'}`);
            record('accepted', socket.servername || '?');
            server.emit('connection', socket);
        });

        mitm.on('tlsClientError', (error, socket) => {
            if (journal.wanted()) journal.service('mitm', `tls error ${error.message}`);
            record('refused', error.message);
            socket.destroy();
        });

        return mitm;
    }

    server.on('connect', (req, client, head) => {
        const [host, port] = req.url.split(':');
        const watching = journal.wanted();
        let carried = 0;

        const secure = mitmHost(host) ? interceptor() : null;

        if (secure) {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) client.unshift(head);
            secure.emit('connection', client);
            if (watching) journal.service('mitm', `open ${req.url}`);
            client.on('close', () => {
                if (watching) journal.service('mitm', `shut ${req.url}`);
            });
            return;
        }

        const upstream = net.connect(Number(port) || 443, host, () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) upstream.write(head);
            upstream.pipe(client);
            client.pipe(upstream);
        });

        if (watching) {
            journal.service('tunnel', `open ${req.url}`);
            upstream.on('data', (chunk) => { carried += chunk.length; });
            client.on('close', () => journal.service('tunnel', `shut ${req.url} after ${carried}b`));
        }

        const drop = (e) => {
            if (watching && e) journal.service('tunnel', `broke ${req.url}: ${e.message}`);
            upstream.destroy();
            client.destroy();
        };
        upstream.on('error', drop);
        client.on('error', drop);
    });
}

module.exports = { absoluteTarget, normaliseSelf, tunnel };
