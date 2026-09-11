'use strict';

const http2 = require('http2');
const zlib = require('zlib');

const bigheaders = require('../lib/bigheaders.js');
const x509 = require('../lib/x509.js');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let failures = 0;

function check(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  ${detail}`}`);
    if (!ok) failures += 1;
}

const finish = () => {
    console.log(failures ? `\n${failures} failed.` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
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
            .catch((error) => check('the fetch completes', false, error.message))
            .then(finish);
    });
};

x509.createCa('Tube Test CA', (caError, ca) => {
    if (caError) {
        check('the server\'s CA is issued', false, caError.message);
        return finish();
    }

    return x509.createLeaf(ca, 'localhost', ['localhost'], (leafError, leaf) => {
        if (leafError) {
            check('the server\'s certificate is issued', false, leafError.message);
            return finish();
        }

        return serve(leaf);
    });
});
