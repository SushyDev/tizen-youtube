'use strict';

// Answers Cobalt's --proxy: absolute-URI requests for plain HTTP and CONNECT for TLS.

const net = require('net');
const URL = require('url');

const journal = require('./journal.js');
const postmortem = require('./postmortem.js');
const mitm = require('./mitm.js');

const ABSOLUTE = /^https?:\/\//i;

const QUIET = 60000;
const MOST_REMEMBERED = 200;

const absoluteTarget = (url) => (ABSOLUTE.test(url) ? url : null);

// Cobalt drops the port when it rebuilds a URL out of INNERTUBE_HOST_OVERRIDE, so requests arrive
// naming us on port 80; forwarding those reaches nothing.
const ourHosts = (host, port) => [
    `${host}:${port}`, host, 'localhost', `localhost:${port}`, '127.0.0.1', `127.0.0.1:${port}`
];

// Turns "GET http://us:8099/tv" back into "GET /tv" so the routes see what they expect.
const normaliseSelf = (req, host, port) => {
    const target = absoluteTarget(req.url);
    if (!target) return;

    const parsed = URL.parse(target);
    if (ourHosts(host, port).indexOf(parsed.host) === -1) return;

    req.url = parsed.path || '/';
};

const tunnel = (server) => {
    // Repeats are dropped for a minute, so one launch logs each outcome once.
    const seen = new Map();

    const record = (topic, detail) => {
        const key = `${topic} ${detail}`;
        const now = Date.now();

        if (seen.get(key) > now - QUIET) return;
        if (seen.size > MOST_REMEMBERED) seen.clear();

        seen.set(key, now);
        postmortem.note('mitm', key);
    };

    const interceptor = mitm.interceptor(server, record);

    server.on('connect', (req, client, head) => {
        const [host, port] = req.url.split(':');
        const secure = mitm.isIntercepted(host) ? interceptor() : null;

        if (secure) {
            client.on('error', () => client.destroy());
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) client.unshift(head);

            journal.service('mitm', `open ${req.url}`);
            secure.emit('connection', client);
            return;
        }

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
            client.on('close', () => journal.service('tunnel', `shut ${req.url} after ${upstream.bytesRead}b`));
        }

        upstream.on('error', drop);
        client.on('error', drop);
    });
};

module.exports = { absoluteTarget, normaliseSelf, tunnel };
