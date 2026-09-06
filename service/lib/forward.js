'use strict';

// Cobalt's --proxy speaks the forward-proxy form: an absolute URI on the request line for plain
// HTTP, and CONNECT for TLS. Answering both lets the container's networking come through the
// service with nothing in the page rewritten.

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const URL = require('url');

const journal = require('./journal.js');
const postmortem = require('./postmortem.js');

// Guarded for the same reason as in index.js: interception is an extra, and a module that will
// not load here must cost the MITM, never the tunnel.
function cobaltIfItLoads() {
    try {
        return require('./cobalt.js');
    } catch (e) {
        postmortem.note('cobalt', `module would not load: ${postmortem.describe(e)}`);
        return null;
    }
}

const cobalt = cobaltIfItLoads();

const ABSOLUTE = /^https?:\/\//i;

const INTERCEPTED = ['youtube.com', 'googleapis.com', 'google.com', 'gstatic.com', 'ggpht.com'];

const RETRY_MATERIAL_EVERY = 3000;
const QUIET = 60000;
const MOST_REMEMBERED = 200;

// The material is made on the set rather than shipped, so it may not exist when the first
// connection arrives — key generation takes seconds on this hardware. Until it does every host is
// tunnelled through untouched, which is a working television showing stock YouTube. A `disabled`
// file beside the keys forces that state permanently.
const mitmConfig = () => {
    if (!cobalt) return null;

    try {
        return fs.existsSync(`${cobalt.MITM_DIR}/disabled`) ? null : cobalt.material();
    } catch (e) {
        return null;
    }
};

const mitmHost = (host) => {
    const name = String(host || '').split(':')[0].toLowerCase();
    return INTERCEPTED.some((domain) => name === domain || name.endsWith(`.${domain}`));
};

const absoluteTarget = (url) => (ABSOLUTE.test(url) ? url : null);

// Cobalt drops the port when it rebuilds a URL out of INNERTUBE_HOST_OVERRIDE, so requests arrive
// naming us on port 80; forwarding those reaches nothing.
const ourHosts = (host, port) => [
    `${host}:${port}`, host, 'localhost', `localhost:${port}`, '127.0.0.1', `127.0.0.1:${port}`
];

// Turns "GET http://us:8099/tv" back into "GET /tv" so the routes see what they expect.
const normaliseSelf = (req, host, port) => {
    const target = absoluteTarget(req.url);
    if (!target) return false;

    const parsed = URL.parse(target);
    if (ourHosts(host, port).indexOf(parsed.host) === -1) return false;

    req.url = parsed.path || '/';
    return true;
};

const tunnel = (server) => {
    // The container never opens the dev bridge, so whether the handshake was accepted is the whole
    // question and the in-memory journal cannot answer it. Deduplicated for a minute — long enough
    // to collapse one launch, short enough that the next launch says so. Suppressing repeats for
    // the life of the process reads as though nothing happened at all.
    const seen = new Map();

    const record = (topic, detail) => {
        const key = `${topic} ${detail}`;
        const now = Date.now();

        if (seen.get(key) > now - QUIET) return;
        if (seen.size > MOST_REMEMBERED) seen.clear();

        seen.set(key, now);
        postmortem.note('mitm', key);
    };

    // Built on the first connection that could use it rather than at start-up, and retried if the
    // material was still being made then.
    const held = { mitm: null, asked: 0 };

    const interceptor = () => {
        if (held.mitm) return held.mitm;
        if (Date.now() - held.asked < RETRY_MATERIAL_EVERY) return null;
        held.asked = Date.now();

        const config = mitmConfig();
        if (!config) return null;

        const mitm = tls.createServer(config, (socket) => {
            // Feed decrypted HTTP into the existing Express application. The marker lets the
            // fallback preserve the original Host instead of assuming www.youtube.com.
            socket.__tubeMitm = true;
            journal.service('mitm', `secure ${socket.servername || '?'}`);
            record('accepted', socket.servername || '?');
            server.emit('connection', socket);
        });

        mitm.on('tlsClientError', (error, socket) => {
            journal.service('mitm', `tls error ${error.message}`);
            record('refused', error.message);
            socket.destroy();
        });

        mitm.on('error', (error) => record('listener', postmortem.describe(error)));

        held.mitm = mitm;
        return mitm;
    };

    server.on('connect', (req, client, head) => {
        const [host, port] = req.url.split(':');
        const secure = mitmHost(host) ? interceptor() : null;

        if (secure) {
            client.on('error', () => client.destroy());
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) client.unshift(head);

            journal.service('mitm', `open ${req.url}`);
            secure.emit('connection', client);
            return;
        }

        const carried = { bytes: 0 };

        const upstream = net.connect(Number(port) || 443, host, () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) upstream.write(head);

            upstream.pipe(client);
            client.pipe(upstream);
        });

        const drop = (error) => {
            if (error) {
                journal.service('tunnel', `broke ${req.url}: ${error.message}`);
                record('tunnel', `${req.url} ${error.code || error.message}`);
            }

            upstream.destroy();
            client.destroy();
        };

        if (journal.wanted()) {
            journal.service('tunnel', `open ${req.url}`);
            upstream.on('data', (chunk) => { carried.bytes += chunk.length; });
            client.on('close', () => journal.service('tunnel', `shut ${req.url} after ${carried.bytes}b`));
        }

        upstream.on('error', drop);
        client.on('error', drop);
    });
};

module.exports = { absoluteTarget, normaliseSelf, tunnel };
