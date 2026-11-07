'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-support-'));

process.env.TUBE_LOG = path.join(root, 'service.log');
process.env.TUBE_SHARE = root;
process.env.TUBE_OPEN_PROXY = '0';
delete process.env.TUBE_PROXY_CLIENTS;
delete process.env.TUBE_BYPASS_HOSTS;

const lease = { address: '192.168.1.40' };
os.networkInterfaces = () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    wlan0: [{ address: lease.address, family: 'IPv4', internal: false }]
});

const results = [];

const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <- ${detail}`}`);
    results.push(!!ok);
};

const clientChecks = () => {
    const { fromThisTv, bypassAllows } = require('../lib/clients.js');
    const from = (remoteAddress) => ({ socket: { remoteAddress } });

    check('the container on loopback may use the proxy', fromThisTv(from('127.0.0.1')) && fromThisTv(from('127.0.0.2')));
    check('and on this TV\'s own address', fromThisTv(from('192.168.1.40')) && fromThisTv(from('::ffff:192.168.1.40')));
    check('a phone on the same network may not', !fromThisTv(from('192.168.1.77')));

    lease.address = '192.168.1.41';
    check('a new lease is let in before the address cache catches up', fromThisTv(from('192.168.1.41')));
    lease.address = '192.168.1.40';

    process.env.TUBE_PROXY_CLIENTS = '192.168.1.77';
    check('unless it is listed', fromThisTv(from('192.168.1.77')));
    delete process.env.TUBE_PROXY_CLIENTS;

    check('the bypass reaches Google\'s hosts', bypassAllows('rr2---sn-4g5e6nsz.googlevideo.com')
        && bypassAllows('jnn-pa.googleapis.com:443') && bypassAllows('www.youtube.com'));
    check('and nothing else on the network or the internet', !bypassAllows('192.168.1.1')
        && !bypassAllows('evilgoogle.com') && !bypassAllows('googlevideo.com.example.org'));
};

const addressChecks = () => {
    const { freshAddresses } = require('../lib/serviceAddress.js');
    const { watch } = require('../lib/addressWatch.js');
    const { writeBootScreen } = require('../lib/bootScreen.js');

    freshAddresses();
    const content = path.join(root, 'content');
    const moves = [];
    const watcher = watch((was, now) => {
        moves.push(`${was} → ${now}`);
        writeBootScreen(content, 'void 0;');
    }, 60000);

    writeBootScreen(content, 'void 0;');
    const pageAt = () => JSON.parse(/window\.TUBE_BOOT = (\{[^<]*\});/
        .exec(fs.readFileSync(path.join(content, 'web', 'tube', 'boot.html'), 'utf8'))[1]).service;

    watcher.look();
    check('an unchanged address rewrites nothing', moves.length === 0);

    lease.address = '10.0.0.12';
    freshAddresses();
    watcher.look();
    watcher.stop();

    check('a new address is noticed once', moves.length === 1 && moves[0] === '192.168.1.40 → 10.0.0.12', moves.join(', '));
    check('and the boot screen is written for it', pageAt() === 'http://10.0.0.12:8099', pageAt());
};

Promise.resolve()
    .then(clientChecks)
    .then(addressChecks)
    .catch((error) => check('the suite runs', false, error.stack))
    .then(() => {
        fs.rmSync(root, { recursive: true, force: true });
        const failed = results.filter((ok) => !ok).length;
        console.log(`\n${results.length - failed}/${results.length} checks passed.`);
        process.exit(failed ? 1 : 0);
    });
