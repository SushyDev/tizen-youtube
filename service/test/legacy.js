'use strict';

// Checks the 5.0+ service's stand-ins for what old node lacks.

const fs = require('fs');
const os = require('os');
const { join } = require('path');

const buffer = require('../legacy/buffer.js');
const http2 = require('../legacy/http2.js');
const standIn = require('../legacy/fs.js');

const results = [];

const check = (label, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    results.push(!!ok);
};

check('Buffer.from reads a string', buffer.from('héllo', 'utf8').equals(Buffer.from('héllo', 'utf8')));
check('Buffer.from reads bytes', buffer.from([1, 2, 255]).equals(Buffer.from([1, 2, 255])));
check('Buffer.from reads base64', buffer.from('aGk=', 'base64').toString() === 'hi');
check('Buffer.from reads an ArrayBuffer', buffer.from(new Uint8Array([7, 8]).buffer).equals(Buffer.from([7, 8])));
check('Buffer.alloc zero-fills', buffer.alloc(4).equals(Buffer.from([0, 0, 0, 0])));

check('http2 is the real module where it exists', http2.connect === require('http2').connect);

// installCa's certs directory already exists once staging has copied Cobalt's.
const scratch = fs.mkdtempSync(join(os.tmpdir(), 'tube-legacy-'));
const deep = join(scratch, 'content', 'ssl', 'certs');

const settles = (make) => {
    try {
        make();
        return true;
    } catch (e) {
        return false;
    }
};

check('recursive mkdir makes the missing parents',
    settles(() => standIn.mkdirSync(deep, { recursive: true })) && fs.statSync(deep).isDirectory());
check('recursive mkdir accepts a directory that exists', settles(() => standIn.mkdirSync(deep, { recursive: true })));
check('plain mkdir still refuses a directory that exists', !settles(() => standIn.mkdirSync(deep)));

fs.rmSync(scratch, { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
