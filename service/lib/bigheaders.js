'use strict';

// An upstream fetch that survives YouTube's response headers.
//
// Node caps the response header block at 8KB on Node 12 and 16KB from Node 14, and cannot be
// told otherwise from inside the process. YouTube's answer to a Cobalt client is 16.3KB, almost
// all of it one content-security-policy carrying Cobalt's own source expressions. HTTP/2 carries
// headers in HPACK, where the limit is an order of magnitude higher.

const http2 = require('http2');
const zlib = require('zlib');
const { PassThrough } = require('stream');
const URL = require('url');

const SESSION_IDLE = 30000;
const REQUEST_TIMEOUT = 30000;
const MAX_HEADER_LIST = 262144;

const ILLEGAL_IN_H2 = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'host'];

// One session per origin, closed when idle: a session per request would cost a handshake apiece.
const sessions = new Map();

const sessionFor = (origin) => {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;

    const session = http2.connect(origin, { settings: { maxHeaderListSize: MAX_HEADER_LIST } });

    session.setTimeout(SESSION_IDLE, () => session.close());
    session.on('error', () => sessions.delete(origin));
    session.on('close', () => sessions.delete(origin));

    sessions.set(origin, session);
    return session;
};

// node-fetch's Response in the shapes the proxy uses: headers.raw(), headers.get(), a readable
// body and text().
const responseOf = (status, received, stream) => {
    const raw = Object.keys(received).reduce((all, name) => {
        if (name[0] === ':') return all;                    // h2 pseudo-headers are not real headers

        const value = received[name];
        return Object.assign(all, { [name]: Array.isArray(value) ? value : [String(value)] });
    }, {});

    const text = () => new Promise((resolve, reject) => {
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
        text
    };
};

// node-fetch decompresses and this does not, which is a difference that does not announce
// itself: the body arrives gzipped, is treated as text because the type says html, has a script
// injected into the middle of it and is served as a loaded page behind a black screen.
const decoded = (request, encoding) => {
    const out = new PassThrough();
    const decoder = encoding === 'gzip' ? zlib.createGunzip()
        : (encoding === 'deflate' ? zlib.createInflate() : null);

    request.on('error', (error) => out.destroy(error));

    if (!decoder) {
        request.pipe(out);
        return out;
    }

    decoder.on('error', (error) => out.destroy(error));
    request.pipe(decoder).pipe(out);

    return out;
};

const fetchOverHttp2 = (target, options) => new Promise((resolve, reject) => {
    const parsed = URL.parse(target);
    if (!parsed.host) return reject(new Error(`not a URL this can fetch: ${target}`));

    const session = sessionFor(`https://${parsed.host}`);

    const headers = ILLEGAL_IN_H2.reduce((all, name) => {
        delete all[name];
        return all;
    }, Object.assign({}, options.headers));

    const request = session.request(Object.assign({
        ':method': options.method || 'GET',
        ':path': parsed.path || '/',
        ':authority': parsed.host,
        ':scheme': 'https'
    }, headers));

    request.setTimeout(REQUEST_TIMEOUT, () => request.destroy(new Error('http2 request timed out')));
    request.on('error', reject);

    request.on('response', (received) => {
        // Whatever is handed on is identity-encoded now, so the headers must not claim otherwise.
        const announced = Object.assign({}, received);
        delete announced['content-encoding'];
        delete announced['content-length'];

        resolve(responseOf(
            Number(received[':status']) || 502,
            announced,
            decoded(request, String(received['content-encoding'] || '').toLowerCase())
        ));
    });

    return Buffer.isBuffer(options.body) ? request.end(options.body) : request.end();
});

const isHeaderOverflow = (error) => !!error
    && (error.code === 'HPE_HEADER_OVERFLOW' || /header overflow/i.test(error.message || ''));

module.exports = { fetchOverHttp2, isHeaderOverflow };
