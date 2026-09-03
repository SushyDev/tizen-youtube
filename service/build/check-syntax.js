'use strict';

// ES2019 is what Node 10 parses — optional catch binding included — and Node 10 is the
// floor Tizen 5.5 clears.

const acorn = require('acorn');
const { readFileSync } = require('fs');

const ECMA_VERSION = 2019;

const file = process.argv[2];

if (!file) {
    console.error('usage: check-syntax.js <bundle>');
    process.exit(2);
}

try {
    acorn.parse(readFileSync(file, 'utf8'), { ecmaVersion: ECMA_VERSION, sourceType: 'script' });
    console.log(`      parses as ES${ECMA_VERSION}`);
} catch (error) {
    console.error(`      ${file} does not parse as ES${ECMA_VERSION}: ${error.message}`);
    process.exit(1);
}
