'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { rollup } = require('rollup');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-support-'));

process.env.TUBE_LOG = path.join(root, 'service.log');
process.env.TUBE_SHARE = root;
process.env.TUBE_SUPPORT_URL = 'https://help.example';
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

const qrModule = async () => {
    const bundle = await rollup({ input: path.join(__dirname, '..', 'boot', 'vendor', 'qr.js') });
    const { output } = await bundle.generate({ format: 'cjs', exports: 'named' });
    const loaded = { exports: {} };
    new Function('module', 'exports', output[0].code)(loaded, loaded.exports);
    return loaded.exports;
};

const qrChecks = ({ encode }) => {
    const short = encode('http://192.168.1.40:8099/diag', 'M');
    check('a diag address fits a small QR code', short.length === 29 && short.every((row) => row.length === 29),
        `${short.length} modules`);
    check('with the three finder patterns in their corners', short[0][0] && short[0][28] && short[28][0] && !short[28][28]);

    const long = encode(`https://help.example/r/K7QF-29XM?${'x'.repeat(120)}`, 'M');
    check('a longer one grows by whole versions', (long.length - 17) % 4 === 0 && long.length > 29, `${long.length} modules`);

    const threw = (() => {
        try {
            encode('x'.repeat(400), 'M');
            return false;
        } catch (e) {
            return true;
        }
    })();
    check('and one too long to scan says so rather than drawing nonsense', threw);
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

    const { onlyThisTv } = require('../lib/clients.js');
    const answered = (remoteAddress) => {
        const seen = { ran: false, status: 200 };
        const res = { status: (code) => { seen.status = code; return res; }, type: () => res, send: () => res };
        onlyThisTv(() => { seen.ran = true; })(from(remoteAddress), res);
        return seen;
    };
    const phone = answered('192.168.1.77');
    check('only this TV may restart the service or write to its log', answered('127.0.0.1').ran
        && answered('192.168.1.40').ran && !phone.ran && phone.status === 403, JSON.stringify(phone));
};

const redactChecks = () => {
    const postmortem = require('../lib/postmortem.js');

    postmortem.note('upstream', 'FetchError: request to https://www.youtube.com/api/stats?ip=203.0.113.9&docid=x failed');
    const written = fs.readFileSync(process.env.TUBE_LOG, 'utf8');
    check('an error\'s URL is logged without its query string', written.indexOf('203.0.113.9') === -1
        && written.indexOf('https://www.youtube.com/api/stats?…') !== -1, written.slice(-200));
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
    check('with the support bot allowed in its policy', fs.readFileSync(path.join(content, 'web', 'tube', 'boot.html'), 'utf8')
        .indexOf('connect-src http://10.0.0.12:8099') !== -1
        && fs.readFileSync(path.join(content, 'web', 'tube', 'boot.html'), 'utf8').indexOf(' https://help.example;') !== -1);
};

const reportChecks = () => {
    const postmortem = require('../lib/postmortem.js');
    const { bundle } = require('../lib/diagBundle.js');
    const { page, thisTvRows } = require('../lib/diagPage.js');

    postmortem.note('upstream', 'upstream failed on https://www.youtube.com/youtubei/v1/player?key=AIzaSecret&cpn=abc123: ETIMEDOUT');
    postmortem.note('req', 'GET /api/lounge/bc/bind?id=lounge42&token=t0p → 200');
    postmortem.note('screen', 'tube: patch 1.5.1');

    const made = bundle(thisTvRows('10.0.0.12:8099'));
    const flat = JSON.stringify(made);

    check('the report is shaped for the support bot', made.app === 'youtube' && typeof made.version === 'string'
        && Array.isArray(made.report.checks) && Array.isArray(made.report.log));
    check('it keeps what the lines say', flat.indexOf('ETIMEDOUT') !== -1 && flat.indexOf('/youtubei/v1/player') !== -1);
    check('and drops their query strings and tokens', ['AIzaSecret', 'abc123', 'lounge42', 't0p'].every((leak) => flat.indexOf(leak) === -1),
        flat.slice(0, 400));

    const html = page('10.0.0.12:8099');
    check('with a support bot the diag page offers to send it', html.indexOf('id="send"') !== -1
        && html.indexOf('data-support="https://help.example"') !== -1 && html.indexOf('/diag.json') !== -1);
    check('and its copy fallback carries no tokens either', html.indexOf('t0p') === -1 && html.indexOf('AIzaSecret') === -1);
};

qrModule()
    .then(qrChecks)
    .then(clientChecks)
    .then(redactChecks)
    .then(addressChecks)
    .then(reportChecks)
    .catch((error) => check('the suite runs', false, error.stack))
    .then(() => {
        fs.rmSync(root, { recursive: true, force: true });
        const failed = results.filter((ok) => !ok).length;
        console.log(`\n${results.length - failed}/${results.length} checks passed.`);
        process.exit(failed ? 1 : 0);
    });
