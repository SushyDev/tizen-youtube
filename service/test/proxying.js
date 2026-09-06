'use strict';

// The fallback route, end to end against a local upstream: what comes back, what is rewritten on
// the way out, and what happens when the upstream is not there.

process.env.TUBE_PROXY_HOST = 'tv.example';

const http = require('http');

const proxy = require('../lib/proxy.js');

const results = [];

const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

const upstream = http.createServer((req, res) => {
    if (req.url === '/json') {
        res.writeHead(200, {
            'content-type': 'application/json',
            'set-cookie': ['__Secure-A=1; Domain=.youtube.com; Secure']
        });
        return res.end('{"hello":"world"}');
    }

    if (req.url === '/bin') {
        res.writeHead(200, { 'content-type': 'video/mp4' });
        return res.end(Buffer.from([1, 2, 3, 4, 5]));
    }

    if (req.url === '/moved') {
        res.writeHead(302, { location: 'http://example.invalid/next' });
        return res.end();
    }

    if (req.url === '/echo') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ headers: req.headers }));
    }

    res.writeHead(404);
    return res.end('no');
});

const app = proxy.create('7.0');
proxy.attachFallback(app);

upstream.listen(0, '127.0.0.1', () => {
    const target = `http://127.0.0.1:${upstream.address().port}`;
    const server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;

        const get = (path) => new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, path, timeout: 8000 }, (res) => {
                const parts = [];
                res.on('data', (chunk) => parts.push(chunk));
                res.on('end', () => resolve({
                    status: res.statusCode, headers: res.headers, body: Buffer.concat(parts)
                }));
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timed out')); });
            req.end();
        });

        const bypass = (path) => get(`/cors-bypass/${target}${path}`);

        const done = (code) => {
            server.close();
            upstream.close();
            process.exit(code);
        };

        bypass('/json')
            .then((res) => {
                check('a textual body comes back through the bypass',
                    res.status === 200 && res.body.toString() === '{"hello":"world"}', res.body.toString());
                check('__Secure- cookies are renamed on the plain-HTTP path',
                    String(res.headers['set-cookie']).indexOf('__LocalSecure-A') === 0,
                    res.headers['set-cookie']);
                check('CORS is opened for the page',
                    res.headers['access-control-allow-origin'] === '*',
                    res.headers['access-control-allow-origin']);

                return bypass('/bin');
            })
            .then((res) => {
                check('a binary body is streamed through untouched',
                    res.status === 200 && res.body.equals(Buffer.from([1, 2, 3, 4, 5])),
                    res.body.toString('hex'));

                return bypass('/moved');
            })
            .then((res) => {
                check('a redirect is routed back through the proxy',
                    res.status === 302
                    && /\/cors-bypass\/http:\/\/example\.invalid\/next$/.test(res.headers.location),
                    res.headers.location);

                return bypass('/echo');
            })
            .then((res) => {
                const sent = JSON.parse(res.body.toString()).headers;

                check('the upstream Host is the target, not the proxy',
                    sent.host === `127.0.0.1:${upstream.address().port}`, sent.host);
                check('only readable encodings are asked for',
                    sent['accept-encoding'] === 'gzip, deflate', sent['accept-encoding']);

                return get('/cors-bypass/http://127.0.0.1:1/dead');
            })
            .then((res) => {
                check('an unreachable upstream is answered, not left hanging',
                    res.status === 500 && res.body.toString().indexOf('tube:') === 0,
                    `${res.status} ${res.body.toString().slice(0, 60)}`);

                const failed = results.filter((ok) => !ok).length;
                console.log(`\n${results.length - failed}/${results.length} checks passed.`);
                done(failed ? 1 : 0);
            })
            .catch((error) => {
                console.error('Harness error:', error.message);
                done(1);
            });
    });
});
