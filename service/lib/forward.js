'use strict';

// Answers Cobalt's --proxy: absolute-URI requests for plain HTTP and CONNECT for TLS.

const net = require('net');
const URL = require('url');

const dev = require('../dev/index.js');
const postmortem = require('./postmortem.js');
const mitm = require('./mitm.js');
const carrier = require('./carrier.js');
const containerAgent = require('./containerAgent.js');

// A cobalt.js that fails to load costs the served stamp, never the tunnel.
const cobalt = require('./cobaltIfItLoads.js')();

const ABSOLUTE = /^https?:\/\//i;

const QUIET = 60000;
const MOST_REMEMBERED = 200;

const absoluteTarget = (url) => (ABSOLUTE.test(url) ? url : null);

// Cobalt drops the port when it rebuilds a URL out of INNERTUBE_HOST_OVERRIDE, so requests arrive
// naming us on port 80.
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

    // The first hosts tunnelled after a start, which is what the page loaded before anything failed.
    const CONNECTS_TRACED = 40;
    const connects = { count: 0 };

    server.on('connect', (req, client, head) => {
        if (cobalt) cobalt.served();

        if (connects.count < CONNECTS_TRACED) {
            connects.count += 1;
            postmortem.note('connect', req.url);
        }

        const agent = req.headers['user-agent'];
        if (containerAgent.remember(agent)) postmortem.note('cobalt', `agent: ${agent}`);

        const [host, port] = req.url.split(':');
        const secure = mitm.isIntercepted(host) ? interceptor() : null;

        if (secure) {
            client.on('error', () => client.destroy());
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) client.unshift(head);

            dev.journal.service('mitm', `open ${req.url}`);
            secure.emit('connection', carrier(client));
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
                dev.journal.service('tunnel', `broke ${req.url}: ${error.message}`);

                // A reset after data flowed is how a finished tunnel usually ends.
                if (!upstream.bytesRead) record('tunnel', `${req.url} ${error.code || error.message}`);
            }

            upstream.destroy();
            client.destroy();
        };

        if (dev.journal.wanted()) {
            dev.journal.service('tunnel', `open ${req.url}`);
            client.on('close', () => dev.journal.service('tunnel', `shut ${req.url} after ${upstream.bytesRead}b`));
        }

        upstream.on('error', drop);
        client.on('error', drop);
    });
};

module.exports = { absoluteTarget, normaliseSelf, tunnel };
