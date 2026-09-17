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

// The slot check reads these two, so both are stood in for and all three of its answers asked.
const claimed = { rivals: null };
const heard = { at: 0 };

require.cache[require.resolve('../lib/claimants.js')] = {
    exports: { survey: () => {}, rivals: () => claimed.rivals }
};

// The switches a set is launched with, and what startup made of the --proxy host.
const manifest = { switches: '--proxy=http://127.0.0.2:8099' };
const addressing = { value: null };

require.cache[require.resolve('../lib/cobaltConfig.js')] = {
    exports: {
        CONTAINER: 'com.samsung.tv.cobalt-yt',
        config: () => '<widget/>',
        switches: () => manifest.switches,
        configuredContent: () => process.env.TUBE_COBALT_CONTENT,
        container: () => 'com.samsung.tv.cobalt-yt',
        appId: () => 'tUb3Xq7Lm9.Tube'
    }
};

require.cache[require.resolve('../lib/cobaltIfItLoads.js')] = {
    exports: () => ({
        contact: () => ({ at: heard.at, context: null }),
        addressing: () => addressing.value
    })
};

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

check('a survey that has not answered is said so, rather than reported as no rival',
    of('container slot').ok === true && /have not been surveyed/.test(of('container slot').detail),
    of('container slot').detail);

claimed.rivals = [{
    id: 'other.TizenTube', name: 'TizenTube', version: '2.0.0',
    slot: 'com.samsung.tv.cobalt-yt', baseUrl: 'https://www.youtube.com/tv'
}];

const slotNow = () => diagnose().find((one) => one.name === 'container slot');

check('another app holding the slot while nothing reaches us fails, and says what to do about it',
    slotNow().ok === false && /TizenTube/.test(slotNow().detail)
    && /switch the TV off at the plug/.test(slotNow().detail), slotNow().detail);

heard.at = Date.now();

check('the same rival passes once ours is the one running',
    slotNow().ok === true && /ours is the one running/.test(slotNow().detail), slotNow().detail);

const asked = (name) => diagnose().find((one) => one.name === name);

check('a share that can be written to passes', asked('share').ok === true, asked('share').detail);

check('the container aimed at the port we listen on passes', asked('proxy port').ok === true,
    asked('proxy port').detail);

manifest.switches = '--proxy=http://127.0.0.2:9999';

check('a container aimed at a port we do not listen on fails, naming both',
    asked('proxy port').ok === false && /9999/.test(asked('proxy port').detail)
    && /8099/.test(asked('proxy port').detail), asked('proxy port').detail);

manifest.switches = '--proxy=http://127.0.0.2:8099';

addressing.value = { ok: false, why: '--proxy names tv.local, which resolves to 10.0.0.9 — not this set' };

check('a --proxy host that is not this set fails, in the words startup used',
    asked('proxy address').ok === false && /not this set/.test(asked('proxy address').detail),
    asked('proxy address').detail);

addressing.value = { ok: true, why: '--proxy names 127.0.0.2, which is this set' };

check('and passes once it names this set', asked('proxy address').ok === true);

const { execFileSync } = require('child_process');

// SHARE and the certificate's directory are read as the module loads, so these two are asked in a
// child process carrying the environment they are meant to fail in.
const inChild = (env, before) => {
    const lib = JSON.stringify(path.join(__dirname, '..', 'lib', 'diagnosis.js'));
    const script = `${before || ''}const { checks } = require(${lib});`
        + 'console.log(JSON.stringify(checks()));';

    return JSON.parse(execFileSync(process.execPath, ['-e', script], {
        env: Object.assign({}, process.env, env), encoding: 'utf8'
    }));
};

const fromChild = (env, name, before) => inChild(env, before).find((one) => one.name === name) || {};

const asFile = path.join(root, 'not-a-directory');
fs.writeFileSync(asFile, 'x');

const locked = fromChild({ TUBE_SHARE: asFile }, 'share');

check('a share that cannot be written to fails, and says what is kept there',
    locked.ok === false && /certificate/.test(locked.detail), locked.detail);

// A real certificate, whose window is known, against a clock moved either side of it.
const fixtures = path.join(__dirname, 'fixtures', 'mitm');
const at = (when) => `Date.now = () => Date.parse('${when}');`;

const early = fromChild({ TUBE_MITM_DIR: fixtures }, 'clock', at('2026-01-01T00:00:00Z'));

check('a clock reading before the certificate was issued fails, and blames the clock',
    early.ok === false && /clock is wrong/.test(early.detail), early.detail);

const late = fromChild({ TUBE_MITM_DIR: fixtures }, 'clock', at('2028-01-01T00:00:00Z'));

check('a clock past the certificate\'s end fails too', late.ok === false, late.detail);

const right = fromChild({ TUBE_MITM_DIR: fixtures }, 'clock');

check('and a clock inside the window passes', right.ok === true, right.detail);

// Nothing to read a certificate with is not a fault; the check is left out instead.
check('with no certificate at all the clock is not asked about', asked('clock') === undefined);

fs.rmSync(root, { recursive: true, force: true });

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
