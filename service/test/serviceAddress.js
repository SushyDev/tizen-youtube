'use strict';

const os = require('os');

const results = [];

const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <- ${detail}`}`);
    results.push(!!ok);
};

const held = {
    now: 1000000,
    read: 0,
    interfaces: {
        lo: [{ address: '127.0.0.1', internal: true, family: 'IPv4' }],
        eth0: [
            { address: '192.168.1.29', internal: false, family: 'IPv4' },
            { address: 'fe80::1', internal: false, family: 'IPv6' }
        ]
    }
};

// The clock is ours, so the memo can be stepped over rather than waited out.
Date.now = () => held.now;

os.networkInterfaces = () => {
    held.read += 1;
    return held.interfaces;
};

const later = () => { held.now += 6000; };

const { lanAddresses, serviceAddress } = require('../lib/serviceAddress.js');

check('only this set\'s own IPv4 addresses are offered', lanAddresses().join() === '192.168.1.29',
    lanAddresses().join());

check('the page is sent to one of them', serviceAddress() === '192.168.1.29', serviceAddress());

const before = held.read;
Array.from({ length: 50 }).forEach(serviceAddress);

check('asking again within a few seconds does not read the interfaces again', held.read === before,
    `${held.read - before} extra reads`);

// node 18.0 to 18.3 give the family as a number rather than a string.
held.interfaces = { eth0: [{ address: '10.0.0.5', internal: false, family: 4 }] };
later();

check('a numbered family is read the same as a named one', serviceAddress() === '10.0.0.5', serviceAddress());

held.interfaces = { eth0: [{ address: '10.0.0.77', internal: false, family: 4 }] };
later();

check('a changed address is followed rather than remembered', serviceAddress() === '10.0.0.77',
    serviceAddress());

held.interfaces = { lo: [{ address: '127.0.0.1', internal: true, family: 'IPv4' }] };
later();

check('off a television, with no address of its own, loopback is used',
    serviceAddress() === '127.0.0.1', serviceAddress());

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
