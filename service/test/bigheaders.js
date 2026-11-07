'use strict';

const http2 = require('http2');
const zlib = require('zlib');
const { readFileSync } = require('fs');
const { join } = require('path');

const bigheaders = require('../lib/bigheaders.js');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const tally = { failures: 0 };

function check(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  ${detail}`}`);
    if (!ok) tally.failures += 1;
}

const finish = () => {
    console.log(tally.failures ? `\n${tally.failures} failed.` : '\nall checks passed');
    process.exit(tally.failures ? 1 : 0);
};

check('an overflow is recognised by its code', bigheaders.isHeaderOverflow({ code: 'HPE_HEADER_OVERFLOW' }));
check('an overflow is recognised by its message', bigheaders.isHeaderOverflow(new Error('Parse Error: Header overflow')));
check('another failure is not an overflow', !bigheaders.isHeaderOverflow(new Error('socket hang up')));
check('no error is not an overflow', !bigheaders.isHeaderOverflow(null));

const PAGE = `<html><body>${'tube '.repeat(2000)}</body></html>`;
const POLICY = `script-src ${"'nonce-abc' ".repeat(2000)}`.trim();
const ENCODE = { gzip: zlib.gzipSync, deflate: zlib.deflateSync };

const fetched = (origin, encoding) => bigheaders.fetchOverHttp2(`${origin}/${encoding}`, {
    method: 'GET',
    headers: { connection: 'keep-alive', host: 'www.youtube.com', 'accept-encoding': 'gzip, deflate' }
});

const serve = (leaf) => {
    const server = http2.createSecureServer({ key: leaf.key, cert: leaf.chain });

    server.on('stream', (stream, headers) => {
        const encoding = headers[':path'].slice(1);
        const body = ENCODE[encoding](PAGE);

        stream.respond({
            ':status': 200,
            'content-type': 'text/html',
            'content-encoding': encoding,
            'content-length': String(body.length),
            'content-security-policy': POLICY
        });
        stream.end(body);
    });

    server.listen(0, '127.0.0.1', () => {
        const origin = `https://127.0.0.1:${server.address().port}`;

        fetched(origin, 'gzip')
            .then((response) => {
                check('the status comes through', response.status === 200, response.status);
                check('a header past HTTP/1\'s limit comes through',
                    response.headers.get('content-security-policy') === POLICY);
                check('no pseudo-header is handed on',
                    Object.keys(response.headers.raw()).every((name) => name[0] !== ':'));
                check('the body is no longer said to be encoded', response.headers.get('content-encoding') === null);
                check('nor to have its encoded length', response.headers.get('content-length') === null);
                return response.text();
            })
            .then((text) => check('a gzipped body is decoded', text === PAGE, text.slice(0, 60)))
            .then(() => fetched(origin, 'deflate'))
            .then((response) => response.text())
            .then((text) => check('a deflated body is decoded', text === PAGE, text.slice(0, 60)))
            .then(remembered)
            .catch((error) => check('the fetch completes', false, error.message))
            .then(finish);
    });
};

// HTTP/1 is faked to overflow, so only whether it was asked at all is being checked.
const remembered = () => {
    const asked = { http1: [], http2: [] };
    const overflow = Object.assign(new Error('Parse Error: Header overflow'), { code: 'HPE_HEADER_OVERFLOW' });

    require.cache[require.resolve('node-fetch')] = {
        exports: (url) => { asked.http1.push(url); return Promise.reject(overflow); }
    };
    bigheaders.fetchOverHttp2 = (url) => { asked.http2.push(url); return Promise.resolve({ status: 200 }); };

    const { send } = require('../lib/sending.js');
    const get = { method: 'GET' };

    return send('https://www.youtube.com/tv?launch=1', get, {})
        .then(() => send('https://www.youtube.com/tv?launch=2', get, {}))
        .then(() => send('https://www.youtube.com/tv_config', get, {}))
        .then(() => {
            check('a page that overflowed once goes straight to HTTP/2 the next time',
                asked.http1.filter((url) => url.indexOf('/tv?') !== -1).length === 1 && asked.http2.length === 3,
                JSON.stringify(asked));
            check('while another page still tries HTTP/1 first', asked.http1.indexOf('https://www.youtube.com/tv_config') !== -1);
        });
};

// Committed, because nothing in the service mints certificates any more.
serve({
    key: readFileSync(join(__dirname, 'fixtures', 'tls', 'key.pem'), 'utf8'),
    chain: readFileSync(join(__dirname, 'fixtures', 'tls', 'cert.pem'), 'utf8')
});
