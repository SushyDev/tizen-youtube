'use strict';

const { mkdtempSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const results = [];
const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

const scratch = mkdtempSync(join(tmpdir(), 'tube-shipped-'));
const SCRIPT = '/* the userscript this widget ships */\n';
writeFileSync(join(scratch, 'userScript.js'), SCRIPT);
process.env.TUBE_BUNDLE_DIR = scratch;

const shipped = require('../lib/shipped.js');

const threw = (run) => {
    try {
        run();
        return null;
    } catch (e) {
        return e;
    }
};

check('the userscript is read from the widget', shipped.read(shipped.USER_SCRIPT) === SCRIPT);
check('and its size reported', shipped.sized(shipped.USER_SCRIPT).bytes === SCRIPT.length,
    JSON.stringify(shipped.sized(shipped.USER_SCRIPT)));

const absent = shipped.sized('absent.js');
check('a missing file is described rather than thrown', /no absent\.js/.test(absent.error || ''), JSON.stringify(absent));
check('and reading one says which', /no absent\.js/.test((threw(() => shipped.read('absent.js')) || {}).message || ''));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
