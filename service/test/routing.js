'use strict';

// The proxy's catch-all matches every path, so route registration order is load bearing:
// attached too early, /__tube/state returns YouTube's HTML instead of JSON and the app
// never launches.

const http = require('http');

const proxy = require('../lib/proxy.js');

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

const app = proxy.create('7.0');
app.get('/__tube/state', (_, res) => res.json({ marker: 'service-endpoint' }));
app.get('/__tube/inject', (_, res) => res.status(501).json({ marker: 'inject' }));
proxy.attachFallback(app);

const server = app.listen(0, '127.0.0.1', () => {
    const port = server.address().port;

    function get(path) {
        return new Promise((resolve, reject) => {
            const req = http.get({ host: '127.0.0.1', port, path, timeout: 8000 }, (res) => {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => resolve({ status: res.statusCode, body }));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timed out')); });
        });
    }

    get('/__tube/state')
        .then((res) => {
            let parsed = null;
            try { parsed = JSON.parse(res.body); } catch (e) { }
            check('/__tube/state is served by the service, not the proxy',
                !!parsed && parsed.marker === 'service-endpoint',
                `got ${res.body.slice(0, 60)}`);
            return get('/__tube/inject');
        })
        .then((res) => {
            let parsed = null;
            try { parsed = JSON.parse(res.body); } catch (e) { }
            check('/__tube/inject is served by the service, not the proxy',
                res.status === 501 && !!parsed && parsed.marker === 'inject',
                `status ${res.status}, body ${res.body.slice(0, 60)}`);
            return get('/__tube/userScript.js');
        })
        .then((res) => {
            check('/__tube/userScript.js serves the bundled script',
                res.status === 200 && res.body.length > 1000 && res.body.indexOf('<!DOCTYPE') === -1,
                `status ${res.status}, ${res.body.length} bytes`);

            server.close();
            const failed = results.filter((r) => !r).length;
            console.log(`\n${results.length - failed}/${results.length} checks passed.`);
            process.exit(failed ? 1 : 0);
        })
        .catch((err) => {
            server.close();
            console.error('Harness error:', err.message);
            process.exit(1);
        });
});
