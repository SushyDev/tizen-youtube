'use strict';

// An upstream fetch that survives YouTube's response headers.
//
// Node caps the response header block: 8KB on Node 12, 16KB from Node 14. YouTube's answer to a
// Cobalt client is **16.3KB**, almost all of it one `content-security-policy` header of 13KB
// carrying Cobalt's own source expressions, plus nine set-cookies. So an older television refuses
// every page with `HPE_HEADER_OVERFLOW`, the proxy turns that into a 500, and the container answers
// a 500 for its page by retrying for ever behind a network error. A newer one passes with about
// seventy bytes to spare, which is not a margin so much as a coincidence.
//
// The limit belongs to the HTTP/1 parser and cannot be raised from inside the process — it is a
// command line flag, and nothing hands one to a Tizen service. HTTP/2 carries headers in HPACK
// instead, with a limit an order of magnitude higher, so this speaks h2 to the same origin and
// presents just enough of node-fetch's shape for the proxy not to care which one answered.

const http2 = require('http2');
const { PassThrough } = require('stream');
const URL = require('url');

const SESSION_IDLE = 30000;

// One session per origin, closed when idle. Opening one per request would cost a handshake apiece.
const sessions = new Map();

function sessionFor(origin) {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;

    const session = http2.connect(origin, {
        // The whole point: room for a header block Node's HTTP/1 parser will not take.
        settings: { maxHeaderListSize: 262144 }
    });

    session.setTimeout(SESSION_IDLE, () => session.close());
    session.on('error', () => sessions.delete(origin));
    session.on('close', () => sessions.delete(origin));

    sessions.set(origin, session);
    return session;
}

// node-fetch's Response, in the two shapes the proxy actually uses: `headers.raw()` for copying
// them out, `headers.get()` for reading one, and a readable `body`.
function responseOf(status, headers, stream) {
    const raw = {};

    Object.keys(headers).forEach((name) => {
        if (name[0] === ':') return;                       // h2 pseudo-headers are not real headers
        const value = headers[name];
        raw[name] = Array.isArray(value) ? value : [String(value)];
    });

    const collect = () => new Promise((resolve, reject) => {
        const parts = [];
        stream.on('data', (chunk) => parts.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
        stream.on('error', reject);
    });

    return {
        status,
        ok: status >= 200 && status < 300,
        body: stream,
        headers: {
            raw: () => raw,
            get: (name) => {
                const found = raw[String(name).toLowerCase()];
                return found ? found.join(', ') : null;
            }
        },
        text: collect,
        buffer: () => collect().then((text) => Buffer.from(text, 'utf8'))
    };
}

// Only the request shapes the proxy makes: a method, headers, and an optional buffered body.
function fetchOverHttp2(target, options) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = URL.parse(target);
        } catch (e) {
            return reject(e);
        }

        const origin = `https://${parsed.host}`;
        let session;
        try {
            session = sessionFor(origin);
        } catch (e) {
            return reject(e);
        }

        const headers = Object.assign({}, options.headers);

        // Connection-level headers are illegal in h2 and make the peer reset the stream.
        ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'host']
            .forEach((name) => { delete headers[name]; });

        const request = session.request(Object.assign({
            ':method': options.method || 'GET',
            ':path': parsed.path || '/',
            ':authority': parsed.host,
            ':scheme': 'https'
        }, headers));

        request.setTimeout(30000, () => request.close(http2.constants.NGHTTP2_CANCEL));
        request.on('error', reject);

        request.on('response', (received) => {
            const status = Number(received[':status']) || 502;

            // Handed on as a stream, so a media response is not held in memory.
            const out = new PassThrough();
            request.pipe(out);
            request.on('error', (error) => out.destroy(error));

            resolve(responseOf(status, received, out));
        });

        if (options.body && Buffer.isBuffer(options.body)) request.end(options.body);
        else request.end();
    });
}

// Whether an error is the one this module exists for.
const isHeaderOverflow = (error) => !!error
    && (error.code === 'HPE_HEADER_OVERFLOW' || /header overflow/i.test(error.message || ''));

module.exports = { fetchOverHttp2, isHeaderOverflow };
