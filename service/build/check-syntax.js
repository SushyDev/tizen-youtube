'use strict';

// ES2019 is the ceiling for Node 10, which is the floor Tizen 5.5 ships.

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
