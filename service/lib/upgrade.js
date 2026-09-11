'use strict';

// Forwards WebSocket upgrades, which express never sees.

const http = require('http');
const https = require('https');
const URL = require('url');

const postmortem = require('./postmortem.js');

// An upgrade arrives in one of two shapes: absolute-form from a client using us as a proxy, or
// origin-form over our own MITM TLS, where the Host header is the only thing naming the target.
const targetOf = (req) => {
    const raw = String(req.url || '');

    if (/^wss?:\/\//i.test(raw) || /^https?:\/\//i.test(raw)) {
        const parsed = URL.parse(raw);
        const secure = /^(wss|https):/i.test(parsed.protocol || '');
        return {
            host: parsed.hostname,
            port: Number(parsed.port) || (secure ? 443 : 80),
            path: parsed.path || '/',
            secure
        };
    }

    const host = String(req.headers.host || '');
    if (!host) return null;

    const [name, port] = host.split(':');
    // Encrypted on the way in means encrypted on the way out: the page believes it is talking to
    // youtube.com over TLS, and so must we.
    const secure = !!(req.socket && req.socket.encrypted);

    return {
        host: name,
        port: Number(port) || (secure ? 443 : 80),
        path: raw || '/',
        secure
    };
};

const headersFor = (req, target) => Object.assign(
    { host: `${target.host}${target.port === 80 || target.port === 443 ? '' : `:${target.port}`}` },
    Object.fromEntries(Object.entries(req.headers).filter(([key]) => key !== 'proxy-connection'))
);

// Idle timeouts off: a WebSocket can be silent for minutes.
const hold = (socket) => {
    if (!socket) return;
    socket.setTimeout(0);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);
};

const attach = (server, options) => {
    const rewrite = (options && options.rewrite) || (() => null);

    server.on('upgrade', (req, socket, head) => {
        hold(socket);

        const target = rewrite(req) || targetOf(req);

        if (!target || !target.host) {
            socket.destroy();
            return;
        }

        const carrier = target.secure ? https : http;

        const outgoing = carrier.request({
            host: target.host,
            port: target.port,
            path: target.path,
            method: req.method,
            headers: headersFor(req, target),
            // Never pooled: this socket stops being an HTTP connection the moment it upgrades, and
            // handing it back to an agent afterwards is how it gets reused underneath a live
            // session.
            agent: false
        });

        outgoing.on('socket', hold);

        outgoing.on('upgrade', (answer, upstream, upstreamHead) => {
            hold(upstream);

            const lines = Object.keys(answer.headers).map((key) => {
                const value = answer.headers[key];
                return Array.isArray(value)
                    ? value.map((one) => `${key}: ${one}`).join('\r\n')
                    : `${key}: ${value}`;
            });

            socket.write(`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}\r\n${lines.join('\r\n')}\r\n\r\n`);

            if (upstreamHead && upstreamHead.length) socket.write(upstreamHead);
            if (head && head.length) upstream.write(head);

            const moved = { out: 0, back: 0, closed: false };

            upstream.on('data', (chunk) => { moved.back += chunk.length; });
            socket.on('data', (chunk) => { moved.out += chunk.length; });

            upstream.pipe(socket);
            socket.pipe(upstream);

            postmortem.note('upgrade', `open ${target.host}:${target.port}${target.path}`);

            const close = () => {
                if (moved.closed) return;
                moved.closed = true;

                postmortem.note('upgrade',
                    `closed ${target.host}:${target.port} — ${moved.out}B up, ${moved.back}B down`);
                upstream.destroy();
                socket.destroy();
            };

            upstream.on('error', close);
            socket.on('error', close);
            upstream.on('close', close);
            socket.on('close', close);
        });

        outgoing.on('response', (answer) => {
            postmortem.note('upgrade', `${target.host}:${target.port} refused the upgrade (${answer.statusCode})`);
            answer.resume();
            outgoing.destroy();
            socket.destroy();
        });

        outgoing.on('error', (error) => {
            postmortem.note('upgrade', `${target.host}:${target.port} — ${postmortem.describe(error)}`);
            socket.destroy();
        });

        socket.on('error', () => outgoing.destroy());

        outgoing.end();
    });
};

module.exports = { attach };
