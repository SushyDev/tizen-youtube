'use strict';

const http = require('http');
const os = require('os');
const path = require('path');

process.env.TUBE_LOG = path.join(os.tmpdir(), `tube-boot-${process.pid}.log`);

const results = [];

const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <- ${detail}`}`);
    results.push(!!ok);
};

const finish = () => {
    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
};

const settled = () => new Promise((done) => setTimeout(done, 300));

// reach.js reads its target when it loads, so each target is a fresh copy.
const fresh = (reachUrl) => {
    process.env.TUBE_REACH_URL = reachUrl;
    ['../lib/reach.js', '../lib/bootReport.js'].forEach((name) => delete require.cache[require.resolve(name)]);
    return require('../lib/bootReport.js');
};

const READY = { needsCertificate: true, prepared: true, failed: null };
const SCRIPT = { bytes: 88064 };

const server = http.createServer((_, res) => { res.writeHead(204); res.end(); });

server.listen(0, '127.0.0.1', async () => {
    const postmortem = require('../lib/postmortem.js');
    const { STAMP } = require('../lib/stamp.js');
    const { fromScreen } = require('../lib/pageLines.js');
    const boot = fresh(`http://127.0.0.1:${server.address().port}/generate_204`);

    check('an unbuilt service says it is unstamped', STAMP === 'unstamped');

    const first = boot.report({ since: 0, status: READY, script: SCRIPT });
    check('it waits on the connection check before handing over', !first.ready && first.waiting.tone === 'warn', JSON.stringify(first.waiting));

    await settled();

    postmortem.note('cobalt', 'trusted: Tube Local CA');
    const after = boot.report({ since: 0, status: READY, script: SCRIPT });

    check('once YouTube is reachable and the certificate made, it hands over', after.ready && after.waiting === null,
        JSON.stringify(after.waiting));
    check('it carries the service log', after.log.some((line) => line.what === 'cobalt' && line.text === 'trusted: Tube Local CA'));
    check('and notes the connection check in it', after.log.some((line) => line.what === 'network' && / is reachable/.test(line.text)));
    check('it asks from where the screen left off', boot.report({ since: after.next, status: READY, script: SCRIPT }).log.length === 0);
    check('it names node and the script', after.facts.node === process.version && after.facts.script === SCRIPT);

    const preparing = boot.report({ since: 0, status: { needsCertificate: true, prepared: false, failed: null }, script: SCRIPT });
    check('a certificate still being made holds it', !preparing.ready && /preparing the certificate/.test(preparing.waiting.what));

    const failedPrep = boot.report({ since: 0, status: { needsCertificate: true, prepared: false, failed: 'EACCES' }, script: SCRIPT });
    check('a failure to prepare Cobalt is shown as bad', failedPrep.waiting.tone === 'bad' && /EACCES/.test(failedPrep.waiting.what));

    postmortem.note('boot', 'a line\nwith a stack under it');
    check('only a line\'s first line is sent', boot.report({ since: 0, status: READY, script: SCRIPT }).log
        .some((line) => line.text === 'a line'));

    fromScreen(JSON.stringify(['[    1.000000] tube: boot screen, cobalt 25', '[    2.000000] service: waiting for it']));
    const screen = boot.report({ since: 0, status: READY, script: SCRIPT }).log.filter((line) => line.what === 'screen');
    check('the screen\'s own lines are noted for /__tube/log', screen.length === 2
        && screen[0].text === '[    1.000000] tube: boot screen, cobalt 25', JSON.stringify(screen));

    const before = boot.report({ since: 0, status: READY, script: SCRIPT }).next;
    fromScreen(JSON.stringify(Array.from({ length: 50 }).map((_, i) => `line ${i}`)));
    check('and capped, so a page cannot flood the log', boot.report({ since: before, status: READY, script: SCRIPT }).log.length === 30);

    fromScreen('not json');
    check('lines that do not parse are said to', boot.report({ since: 0, status: READY, script: SCRIPT }).log
        .some((line) => line.text === 'sent lines that did not parse'));

    server.close();

    const offline = fresh('http://127.0.0.1:1/generate_204');
    offline.report({ since: 0, status: READY, script: SCRIPT });
    await settled();

    const unreachable = offline.report({ since: 0, status: READY, script: SCRIPT });
    check('a TV that cannot reach YouTube is told so, in red', !unreachable.ready && unreachable.waiting.tone === 'bad'
        && /not reachable from the TV/.test(unreachable.waiting.what), JSON.stringify(unreachable.waiting));

    finish();
});
