'use strict';

const { statusOf } = require('../lib/protection.js');

const results = [];

const check = (label, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    results.push(!!ok);
};

const bytes = (hex) => Buffer.from(hex.replace(/ /g, ''), 'hex');

check('a grace period reads as pending', statusOf(bytes('3a 02 08 02 14 2b 08 00')) === 2);
check('a refusal reads as required', statusOf(bytes('3a 04 08 03 10 0a')) === 3);
check('an accepted answer reads as ok', statusOf(bytes('3a 02 08 01 14 2b')) === 1);
check('media that opens with its header has no status', statusOf(bytes('14 2b 08 00 12 0b')) === null);
check('an empty chunk has no status', statusOf(Buffer.alloc(0)) === null && statusOf(null) === null);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
