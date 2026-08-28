'use strict';

// End-to-end update check against a real HTTP origin. Covers the guarantee that
// matters: a bundle whose digest does not match the manifest is never written and
// never executed, and the previously working script keeps being used.

const http = require('http');
const { createHash } = require('crypto');
const { mkdtempSync, readFileSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const Module = require('module');

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

const GOOD = Buffer.from('/* a genuine userscript */\nwindow.__tube = 1;\n');
const sha = (b) => createHash('sha256').update(b).digest('hex');

// The origin under test. `mode` decides what it serves.
let mode = 'good';
const origin = http.createServer((req, res) => {
    if (req.url === '/latest.json') {
        const digest = mode === 'badDigest' ? sha(Buffer.from('something else entirely')) : sha(GOOD);
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({
            version: '1.2.3',
            bundles: { modern: { path: '1.2.3/userScript.modern.js', sha256: digest } }
        }));
    }
    if (req.url === '/1.2.3/userScript.modern.js') {
        if (mode === 'truncated') return res.end(GOOD.slice(0, 10));
        return res.end(GOOD);
    }
    res.statusCode = 404;
    res.end('no');
});

// The loader reads both of these at module load, so a fresh require with the
// environment set is all a test needs.
function loadLoader(cacheDir, originUrl) {
    process.env.TUBE_CACHE_DIR = cacheDir;
    process.env.TUBE_ORIGIN = originUrl;
    delete require.cache[require.resolve('../lib/loader.js')];
    return require('../lib/loader.js');
}

origin.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${origin.address().port}`;

    // Happy path.
    const cacheA = mkdtempSync(join(tmpdir(), 'tube-up-'));
    const loaderA = loadLoader(cacheA, url);

    loaderA.checkForUpdate('7.0')
        .then((updated) => {
            check('a digest-matching update is accepted', updated === true, String(updated));
            const resolved = loaderA.resolve('7.0');
            check('the accepted update is what gets served',
                resolved.origin === 'cache' && resolved.source.indexOf('__tube') !== -1,
                `${resolved.origin}`);
            return loaderA.checkForUpdate('7.0');
        })
        .then((again) => {
            check('re-checking does not re-download an unchanged bundle', again === false, String(again));

            // Bad digest.
            mode = 'badDigest';
            const cacheB = mkdtempSync(join(tmpdir(), 'tube-bad-'));
            const loaderB = loadLoader(cacheB, url);
            return loaderB.checkForUpdate('7.0').then((updated) => {
                check('a bundle whose digest does not match is rejected', updated === false, String(updated));
                check('nothing was written to the cache',
                    !existsSync(join(cacheB, 'userScript.modern.js')), 'a rejected bundle was written to disk');
                const resolved = loaderB.resolve('7.0');
                check('the bundled script is still what runs after a rejection',
                    resolved.origin === 'bundled', resolved.origin);
            });
        })
        .then(() => {
            // Truncated download.
            mode = 'truncated';
            const cacheC = mkdtempSync(join(tmpdir(), 'tube-trunc-'));
            const loaderC = loadLoader(cacheC, url);
            return loaderC.checkForUpdate('7.0').then((updated) => {
                check('a truncated download is rejected by its digest', updated === false, String(updated));
                check('the truncated bundle was not cached',
                    !existsSync(join(cacheC, 'userScript.modern.js')), 'truncated bundle was written');
            });
        })
        .then(() => {
            // Origin unreachable.
            const cacheD = mkdtempSync(join(tmpdir(), 'tube-down-'));
            const loaderD = loadLoader(cacheD, 'http://127.0.0.1:1');
            return loaderD.checkForUpdate('7.0').then((updated) => {
                check('an unreachable origin fails soft', updated === false, String(updated));
                check('the app still has a script to run with the origin down',
                    loaderD.resolve('7.0').origin === 'bundled', 'no script available');
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
