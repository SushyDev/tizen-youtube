'use strict';

const assert = require('assert');

const chii = require('../dev/chii.js');

const results = [];
const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 4).join('\n      ')}`);
    }
};

const WHERE = '10.0.0.5:8711';

check('an upgrade under the mount is turned towards the inspector', () => {
    assert.deepStrictEqual(chii.targetFor(`${chii.MOUNT}target/abc?url=x`, WHERE),
        { host: '10.0.0.5', port: 8711, path: '/target/abc?url=x', secure: false });
});

check('the mount is stripped, so the inspector sees its own paths', () => {
    assert.strictEqual(chii.targetFor(`${chii.MOUNT}client/one`, WHERE).path, '/client/one');
});

check('an absolute request line is handled the same way', () => {
    const target = chii.targetFor(`https://www.youtube.com${chii.MOUNT}target/z`, WHERE);
    assert.strictEqual(target.host, '10.0.0.5');
    assert.strictEqual(target.path, '/target/z');
});

check('a host with no port answers on 80', () => {
    assert.strictEqual(chii.targetFor(`${chii.MOUNT}x`, 'laptop').port, 80);
});

check('anything outside the mount is left to ordinary routing', () => {
    assert.strictEqual(chii.targetFor('/youtubei/v1/browse', WHERE), null);
    assert.strictEqual(chii.targetFor('wss://www.youtube.com/api/lounge', WHERE), null);
});

check('with no inspector configured it claims nothing at all', () => {
    assert.strictEqual(chii.targetFor(`${chii.MOUNT}target/abc`, ''), null);
    assert.strictEqual(chii.targetFor(`${chii.MOUNT}target/abc`, null), null);
});

check('a missing url is not an upgrade it wants', () => {
    assert.strictEqual(chii.targetFor(undefined, WHERE), null);
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
