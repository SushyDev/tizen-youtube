'use strict';

const { mkdtempSync, writeFileSync, unlinkSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
}

const scratch = mkdtempSync(join(tmpdir(), 'tube-loader-'));
process.env.TUBE_CACHE_DIR = scratch;
const loader = require('../lib/loader.js');

let bundled;
try {
    bundled = loader.resolve();
} catch (e) {
    bundled = null;
}
check('the bundled script resolves with no network and no cache',
    !!bundled && bundled.origin === 'bundled' && bundled.source.length > 1000,
    bundled ? `${bundled.origin} / ${bundled.source.length} bytes` : 'threw');

const fakeUpdate = Buffer.from('/* pretend this is a newer userscript */\nconsole.log(1);\n');
writeFileSync(join(scratch, 'userScript.js'), fakeUpdate);
writeFileSync(join(scratch, 'update.json'), JSON.stringify({
    sha256: loader.sha256(fakeUpdate), version: '9.9.9'
}));

const cached = loader.resolve();
check('a digest-matching cached update is preferred',
    cached.origin === 'cache' && cached.version === '9.9.9', `${cached.origin} / ${cached.version}`);

writeFileSync(join(scratch, 'userScript.js'), Buffer.from('/* truncated or tampered */'));
check('a cache whose digest no longer matches is refused',
    loader.resolve().origin === 'bundled', loader.resolve().origin);

unlinkSync(join(scratch, 'userScript.js'));
check('metadata pointing at a missing file falls back',
    loader.resolve().origin === 'bundled', loader.resolve().origin);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
