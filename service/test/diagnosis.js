'use strict';

// The deep check the boot screen asks for when it is stuck.

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-diagnosis-'));
const content = path.join(root, 'content');

process.env.TUBE_LOG = path.join(root, 'service.log');
process.env.TUBE_SHARE = root;
process.env.TUBE_MITM_DIR = path.join(root, 'mitm');
process.env.TUBE_COBALT_CONTENT = content;

const postmortem = require('../lib/postmortem.js');
const { diagnose } = require('../lib/diagnosis.js');

const results = [];

const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <- ${detail}`}`);
    results.push(!!ok);
};

fs.mkdirSync(path.join(content, 'ssl', 'certs'), { recursive: true });
fs.writeFileSync(path.join(content, 'fonts.xml'), 'fonts');

const found = diagnose();
const of = (name) => found.find((one) => one.name === name) || {};

check('it names every part of the route it checked', found.length >= 6, found.map((one) => one.name).join(', '));

check('a missing icu fails, and says why nothing ever appears', of('icu').ok === false
    && /exits before any page/.test(of('icu').detail), of('icu').detail);

check('the content directory is reported with what is in it', of('content').ok === true
    && of('content').detail.indexOf('fonts.xml') !== -1, of('content').detail);

check('a certificate that was never made fails', of('certificate').ok === false, of('certificate').detail);

check('a check that cannot apply is left out rather than failed', of('trust store').name === undefined);

const journal = postmortem.read();

check('every result reaches the journal, for whoever is asked to report it',
    journal.indexOf('FAILED: icu') !== -1 && /check: \d+ checks run, \d+ failed/.test(journal));

check('a passing check is worded so the screen shows it in green', journal.indexOf('check: ok: content') !== -1);

fs.mkdirSync(path.join(content, 'icu'), { recursive: true });
fs.writeFileSync(path.join(content, 'icu', 'icudt68l.dat'), 'data');

check('and icu passes once the data is beside the library',
    diagnose().find((one) => one.name === 'icu').ok === true);

fs.rmSync(root, { recursive: true, force: true });

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
