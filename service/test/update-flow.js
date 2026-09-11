'use strict';

const http = require('http');
const { createHash } = require('crypto');
const { mkdtempSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

const GOOD = Buffer.from('/* a genuine userscript */\nwindow.__tube = 1;\n');
const sha = (b) => createHash('sha256').update(b).digest('hex');

let mode = 'good';
const origin = http.createServer((req, res) => {
    if (req.url === '/latest.json') {
        const digest = mode === 'badDigest' ? sha(Buffer.from('something else entirely')) : sha(GOOD);
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({
            version: '1.2.3',
            bundle: { path: '1.2.3/userScript.js', sha256: digest }
        }));
    }
    if (req.url === '/1.2.3/userScript.js') {
        if (mode === 'truncated') return res.end(GOOD.slice(0, 10));
        return res.end(GOOD);
    }
    res.statusCode = 404;
    res.end('no');
});

function loadLoader(cacheDir, originUrl) {
    process.env.TUBE_CACHE_DIR = cacheDir;
    process.env.TUBE_ORIGIN = originUrl;
    delete require.cache[require.resolve('../lib/loader.js')];
    return require('../lib/loader.js');
}

origin.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${origin.address().port}`;

    const cacheA = mkdtempSync(join(tmpdir(), 'tube-up-'));
    const loaderA = loadLoader(cacheA, url);

    loaderA.checkForUpdate()
        .then((updated) => {
            check('a digest-matching update is accepted', updated === true, String(updated));
            const resolved = loaderA.resolve();
            check('the accepted update is what gets served',
                resolved.origin === 'cache' && resolved.source.indexOf('__tube') !== -1,
                `${resolved.origin}`);
            return loaderA.checkForUpdate();
        })
        .then((again) => {
            check('re-checking does not re-download an unchanged bundle', again === false, String(again));

            mode = 'badDigest';
            const cacheB = mkdtempSync(join(tmpdir(), 'tube-bad-'));
            const loaderB = loadLoader(cacheB, url);
            return loaderB.checkForUpdate().then((updated) => {
                check('a bundle whose digest does not match is rejected', updated === false, String(updated));
                check('nothing was written to the cache',
                    !existsSync(join(cacheB, 'userScript.js')), 'a rejected bundle was written to disk');
                const resolved = loaderB.resolve();
                check('the bundled script is still what runs after a rejection',
                    resolved.origin === 'bundled', resolved.origin);
            });
        })
        .then(() => {
            mode = 'truncated';
            const cacheC = mkdtempSync(join(tmpdir(), 'tube-trunc-'));
            const loaderC = loadLoader(cacheC, url);
            return loaderC.checkForUpdate().then((updated) => {
                check('a truncated download is rejected by its digest', updated === false, String(updated));
                check('the truncated bundle was not cached',
                    !existsSync(join(cacheC, 'userScript.js')), 'truncated bundle was written');
            });
        })
        .then(() => {
            const cacheD = mkdtempSync(join(tmpdir(), 'tube-down-'));
            const loaderD = loadLoader(cacheD, 'http://127.0.0.1:1');
            return loaderD.checkForUpdate().then((updated) => {
                check('an unreachable origin fails soft', updated === false, String(updated));
                check('the app still has a script to run with the origin down',
                    loaderD.resolve().origin === 'bundled', 'no script available');
            });
        })
        .then(() => {
            mode = 'good';
            const installed = { version: '0.3.1' };
            global.tizen = { application: { getAppInfo: () => ({ version: installed.version }) } };

            const cacheE = mkdtempSync(join(tmpdir(), 'tube-reinstall-'));
            const loaderE = loadLoader(cacheE, url);
            return loaderE.checkForUpdate()
                .then(() => {
                    const before = loaderE.resolve();
                    check('an install serves the update it took', before.origin === 'cache', before.origin);

                    installed.version = '0.3.2';
                    const after = loaderE.resolve();
                    check('a reinstall does not serve the cache its predecessor took',
                        after.origin === 'bundled', after.origin);
                    return loaderE.checkForUpdate();
                })
                .then((updated) => {
                    check('the reinstall takes the published bundle again', updated === true, String(updated));
                    const retaken = loaderE.resolve();
                    check('the retaken bundle is what gets served', retaken.origin === 'cache', retaken.origin);
                    delete global.tizen;
                });
        })
        .then(() => {
            origin.close();
            const failed = results.filter((r) => !r).length;
            console.log(`\n${results.length - failed}/${results.length} checks passed.`);
            process.exit(failed ? 1 : 0);
        })
        .catch((err) => {
            origin.close();
            console.error('Harness error:', err);
            process.exit(1);
        });
});
