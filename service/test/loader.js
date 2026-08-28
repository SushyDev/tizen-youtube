'use strict';

// The loader's guarantees: the bundled script always works, a cached update is only
// used when its digest matches, and a corrupted cache falls back rather than executing
// unverified code.

const { mkdtempSync, writeFileSync, mkdirSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const Module = require('module');

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

// Point the loader at a scratch cache directory instead of /home/owner.
const scratch = mkdtempSync(join(tmpdir(), 'tube-loader-'));
process.env.TUBE_CACHE_DIR = scratch;
const loader = require('../lib/loader.js');

// Variant selection.
check('Tizen 3 gets the legacy bundle', loader.variantFor('3.0') === 'legacy', loader.variantFor('3.0'));
check('Tizen 4 gets the legacy bundle', loader.variantFor('4.0') === 'legacy', loader.variantFor('4.0'));
check('Tizen 5.5 gets the modern bundle', loader.variantFor('5.5') === 'modern', loader.variantFor('5.5'));
check('Tizen 7 gets the modern bundle', loader.variantFor('7.0') === 'modern', loader.variantFor('7.0'));
check('unknown version degrades to legacy', loader.variantFor(null) === 'legacy', loader.variantFor(null));

// Bundled fallback.
let bundled;
try {
    bundled = loader.resolve('7.0');
} catch (e) {
    bundled = null;
}
check('bundled script resolves with no network and no cache',
    !!bundled && bundled.origin === 'bundled' && bundled.source.length > 1000,
    bundled ? `${bundled.origin} / ${bundled.source.length} bytes` : 'threw');
check('bundled script is the modern variant on Tizen 7',
    !!bundled && bundled.variant === 'modern', bundled && bundled.variant);

// Verified cache wins.
const fakeUpdate = Buffer.from('/* pretend this is a newer userscript */\nconsole.log(1);\n');
writeFileSync(join(scratch, 'userScript.modern.js'), fakeUpdate);
writeFileSync(join(scratch, 'update.json'), JSON.stringify({
    modern: { sha256: loader.sha256(fakeUpdate), version: '9.9.9' }
}));

const cached = loader.resolve('7.0');
check('a digest-matching cached update is preferred',
    cached.origin === 'cache' && cached.version === '9.9.9', `${cached.origin} / ${cached.version}`);

// Corrupted cache is refused.
writeFileSync(join(scratch, 'userScript.modern.js'), Buffer.from('/* truncated or tampered */'));
const afterCorruption = loader.resolve('7.0');
check('a cache whose digest no longer matches is refused',
    afterCorruption.origin === 'bundled', afterCorruption.origin);

// Meta pointing at a missing file.
require('fs').unlinkSync(join(scratch, 'userScript.modern.js'));
const afterDeletion = loader.resolve('7.0');
check('metadata pointing at a missing file falls back',
    afterDeletion.origin === 'bundled', afterDeletion.origin);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
