'use strict';

// The container route loads at all.
//
// index.js requires cobalt.js inside a try/catch and carries on when it throws, because not every
// Tizen device has the container and a set without it must still get a working proxy. That guard
// also swallows a genuine mistake: a bad require or a missing name in there does not fail the
// service, it silently removes the container route, and the only symptom is a black screen on the
// set. So this requires each piece unguarded — a break here is a test failure rather than a
// diagnosis session.

process.env.TUBE_MITM_DIR = '/tmp/tube-test-mitm';
process.env.TUBE_COBALT_CONTENT = '/tmp/tube-test-content';

const assert = require('assert');

const cobalt = require('../lib/cobalt.js');
const cobaltConfig = require('../lib/cobaltConfig.js');
const cobaltCa = require('../lib/cobaltCa.js');
const cobaltContent = require('../lib/cobaltContent.js');

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 5).join('\n      ')}`);
    }
};

check('the container route still offers what index.js and forward.js ask it for', () => {
    ['prepare', 'wake', 'material', 'container'].forEach((name) => {
        assert.strictEqual(typeof cobalt[name], 'function', `cobalt.${name} is not a function`);
    });
    assert.strictEqual(typeof cobalt.MITM_DIR, 'string');
});

check('the trust material lives where the environment says', () => {
    assert.strictEqual(cobaltCa.MITM_DIR, '/tmp/tube-test-mitm');
    assert.strictEqual(cobalt.MITM_DIR, cobaltCa.MITM_DIR,
        'forward.js reads cobalt.MITM_DIR, so the two must be the same directory');
});

check('the content directory can be named without a config.xml', () => {
    assert.strictEqual(cobaltConfig.configuredContent(), '/tmp/tube-test-content');
});

check('off the set there is no manifest, and nothing pretends otherwise', () => {
    assert.strictEqual(cobaltConfig.config(), null);
    assert.strictEqual(cobaltConfig.container(), null, 'a claim of the container slot came from nowhere');
    assert.strictEqual(cobaltConfig.appId(), null);
    assert.strictEqual(cobaltConfig.switches(), null);
});

check('Cobalt is not installed on a machine that is not a television', () => {
    assert.strictEqual(cobaltContent.cobaltIsInstalledHere(), false);
    assert.ok(cobaltContent.STOCK.indexOf('/usr/apps/') === 0);
});

check('no material has been made, so there is nothing to stand in front of TLS with', () => {
    assert.strictEqual(cobaltCa.existingMaterial(), null);
    assert.strictEqual(cobalt.material(), null);
});

check('waking the container off a set does nothing rather than throwing', () => {
    cobalt.wake();
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
