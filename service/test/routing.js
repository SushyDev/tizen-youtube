'use strict';

// Route order is load bearing in the development entry. The proxy's catch-all matches
// every path, so attached before the service's own routes it answers /__tube/state with
// YouTube's HTML and the app never launches.
//
// This composes the app exactly as `service/dev/index.js` does — the real service module
// plus `attachDev` — rather than standing in a mock, so the ordering it pins is the
// ordering that actually runs. Nothing here ships: `service/index.js` has no proxy at
// all, which is the stronger half of the same guarantee and is checked last.

const http = require('http');
const { readFileSync } = require('fs');
const { join } = require('path');

const service = require('../lib/service.js');
const proxy = require('../dev/proxy.js');

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

// Exactly what dev/index.js does, and in that order.
proxy.attachDev(service.app, '7.0');

// `service.start()` binds the real port; the suite must not, so it listens itself.
const server = service.app.listen(0, '127.0.0.1', () => {
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
            try { parsed = JSON.parse(res.body); } catch (e) { /* not ours */ }

            check('/__tube/state is served by the service, not the proxy',
                !!parsed && typeof parsed.canInject === 'boolean',
                `got ${res.body.slice(0, 60)}`);

            // A television has one route in. Only the development harness names another,
            // and it does it in ui/dev/tube.js — never the service itself.
            check('/__tube/state offers no hand-over target of its own',
                !!parsed && parsed.handOverUrl === null,
                `handOverUrl was ${parsed && JSON.stringify(parsed.handOverUrl)}`);

            return get('/__tube/inject');
        })
        .then((res) => {
            let parsed = null;
            try { parsed = JSON.parse(res.body); } catch (e) { /* not ours */ }

            check('/__tube/inject is served by the service, not the proxy',
                res.status === 501 && !!parsed && !!parsed.error,
                `status ${res.status}, body ${res.body.slice(0, 60)}`);

            return get('/__tube/userScript.js');
        })
        .then((res) => {
            check('/__tube/userScript.js serves the bundled script',
                res.status === 200 && res.body.length > 1000 && res.body.indexOf('<!DOCTYPE') === -1,
                `status ${res.status}, ${res.body.length} bytes`);

            // The point of the split: what ships must not be able to reach the proxy,
            // whatever a runtime flag says. ncc follows requires statically, so a module
            // graph that never requires `dev/` is a bundle that cannot contain it.
            // Requires only — prose about the proxy is not a dependency on it.
            const requiresOf = (file) => {
                const source = readFileSync(join(__dirname, '..', file), 'utf8');
                const found = [];
                const pattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
                let match = pattern.exec(source);
                while (match) {
                    found.push(match[1]);
                    match = pattern.exec(source);
                }
                return found;
            };

            const reachesDev = (file) => requiresOf(file).filter((id) => /(^|\/)dev\//.test(id) || /proxy/.test(id));

            const shipped = reachesDev('index.js');
            check('the shipped entry requires nothing from dev/',
                shipped.length === 0,
                `service/index.js requires ${shipped.join(', ')}`);

            const core = reachesDev(join('lib', 'service.js'));
            check('the service module requires nothing from dev/',
                core.length === 0,
                `service/lib/service.js requires ${core.join(', ')}`);

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
