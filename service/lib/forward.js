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

const ABSOLUTE = /^https?:\/\//i;
const MITM_DIR = process.env.TUBE_MITM_DIR || '/home/owner/share/tube/mitm';

// An environment variable cannot reach this process on the television: the platform starts the
// service itself, so `TUBE_MITM=1` only ever worked off-TV and this branch was dead on the set.
// The switch is therefore a marker file beside the key material — one Homebrew `writeFileSync` and
// a relaunch, no rebuild — and a shipping package has neither the marker nor the keys.
function mitmConfig() {
    try {
        if (process.env.TUBE_MITM !== '1' && !fs.existsSync(`${MITM_DIR}/enabled`)) return null;

        return {
            key: fs.readFileSync(`${MITM_DIR}/leaf.key`),
            cert: fs.readFileSync(`${MITM_DIR}/leaf-chain.crt`)
        };
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
    const config = mitmConfig();

    // The container never opens the dev bridge, so the in-memory journal is unreadable from
    // inside it and whether the handshake was accepted is the whole question. While the MITM is
    // switched on, put that one fact where Homebrew can read it; the log rolls at 64KB.
    const seen = {};
    const record = (topic, detail) => {
        const key = `${topic} ${detail}`;
        if (seen[key]) return;
        seen[key] = true;
        postmortem.note('mitm', key);
    };

    const mitm = config ? tls.createServer(config, (socket) => {
        // Feed decrypted HTTP into the existing Express application. The marker lets the fallback
        // preserve the original Host instead of assuming www.youtube.com.
        socket.__tubeMitm = true;
        if (journal.wanted()) journal.service('mitm', `secure ${socket.servername || '?'}`);
        record('accepted', socket.servername || '?');
        server.emit('connection', socket);
    }) : null;

    if (mitm) mitm.on('tlsClientError', (error, socket) => {
        if (journal.wanted()) journal.service('mitm', `tls error ${error.message}`);
        record('refused', error.message);
        socket.destroy();
    });

    server.on('connect', (req, client, head) => {
        const [host, port] = req.url.split(':');
        const watching = journal.wanted();
        let carried = 0;

        if (mitm && mitmHost(host)) {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) client.unshift(head);
            mitm.emit('connection', client);
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
