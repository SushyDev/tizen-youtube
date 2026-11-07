'use strict';

const dns = require('dns');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-reach-'));
process.env.TUBE_LOG = path.join(scratch, 'service.log');
process.env.TUBE_REACH_URL = 'https://dns-never-answers.example/generate_204';

const results = [];

const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <- ${detail}`}`);
    results.push(!!ok);
};

// A lookup that never calls back is what a hung getaddrinfo looks like from here.
dns.lookup = () => undefined;

const reach = require('../lib/reach.js');

reach.check();

setTimeout(() => {
    const now = reach.current();
    check('a name the TV\'s DNS never answers is reported as DNS, not as the connection', now.ok === false
        && /DNS did not answer for dns-never-answers\.example/.test(now.why), JSON.stringify(now));

    fs.rmSync(scratch, { recursive: true, force: true });
    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
}, 8500);
