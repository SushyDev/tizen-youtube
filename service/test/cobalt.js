'use strict';

// Requires each container-route module unguarded, since index.js swallows their load errors.

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

const fs = require('fs');
const os = require('os');
const path = require('path');

check('staging links Cobalt\'s own files in and leaves ours as they are', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-stage-'));
    const stock = path.join(root, 'stock');
    const content = path.join(root, 'content');
    const put = (file, text) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    };

    put(path.join(stock, 'fonts', 'fonts.xml'), 'built-in fonts');
    put(path.join(stock, 'icu', 'icudt56l', 'root.res'), 'icu 56');
    put(path.join(stock, 'ssl', 'certs', 'a.0'), 'built-in certificate');
    put(path.join(stock, 'licenses', 'l.txt'), 'licence');

    // What an older build and Evergreen leave behind: a real copy, our CA, a merged file, a folder linked whole.
    put(path.join(content, 'fonts', 'fonts.xml'), 'built-in fonts');
    put(path.join(content, 'ssl', 'certs', 'ours.0'), 'our CA');
    put(path.join(content, 'icu', 'icudt68l.dat'), 'merged from an update');
    fs.symlinkSync(path.join(stock, 'licenses'), path.join(content, 'licenses'));

    assert.deepStrictEqual(cobaltContent.stageOrFail(content, stock), {});

    const linkOf = (name) => {
        const file = path.join(content, name);
        return fs.lstatSync(file).isSymbolicLink() ? fs.readlinkSync(file) : null;
    };

    assert.strictEqual(linkOf('fonts/fonts.xml'), path.join(stock, 'fonts', 'fonts.xml'), 'an old copy was not replaced by a link');
    assert.strictEqual(linkOf('icu/icudt56l/root.res'), path.join(stock, 'icu', 'icudt56l', 'root.res'));
    assert.strictEqual(linkOf('ssl/certs/a.0'), path.join(stock, 'ssl', 'certs', 'a.0'));
    assert.strictEqual(linkOf('licenses'), null, 'a folder linked whole was kept, so a merge into it would write into Cobalt');
    assert.strictEqual(linkOf('licenses/l.txt'), path.join(stock, 'licenses', 'l.txt'));
    assert.strictEqual(linkOf('ssl/certs/ours.0'), null, 'our CA was replaced');
    assert.strictEqual(fs.readFileSync(path.join(content, 'ssl', 'certs', 'ours.0'), 'utf8'), 'our CA');
    assert.strictEqual(fs.readFileSync(path.join(content, 'icu', 'icudt68l.dat'), 'utf8'), 'merged from an update');
    assert.strictEqual(fs.readdirSync(path.join(content, 'fonts')).join(), 'fonts.xml', 'a staged name was left behind');

    const inode = fs.lstatSync(path.join(content, 'fonts', 'fonts.xml')).ino;
    assert.deepStrictEqual(cobaltContent.stageOrFail(content, stock), {});
    assert.strictEqual(fs.lstatSync(path.join(content, 'fonts', 'fonts.xml')).ino, inode, 'a second staging made the links again');

    fs.rmSync(root, { recursive: true, force: true });
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
