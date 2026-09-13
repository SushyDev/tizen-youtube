'use strict';

// Checks a refused Tizen call is survived: kill throws a SecurityError on a container not ours.

const os = require('os');
const path = require('path');
const { readFileSync } = require('fs');

const LOG = path.join(os.tmpdir(), `tube-wake-${process.pid}.log`);
process.env.TUBE_LOG = LOG;

const ME = 'tUb3Xq7Lm9.Tube';
const CONTAINER = 'com.samsung.tv.cobalt-yt';

// A certificate left on disk, as an earlier build leaves one.
process.env.TUBE_MITM_DIR = path.join(__dirname, 'fixtures', 'mitm');

// A manifest claiming the slot, which off the set only a stand-in can give; no --content, as the
// 5.0 widget has none.
const manifest = { content: null };

require.cache[require.resolve('../lib/cobaltConfig.js')] = {
    exports: {
        CONTAINER,
        config: () => '<widget/>',
        switches: () => '--proxy=http://127.0.0.2:8099',
        configuredContent: () => manifest.content,
        container: () => CONTAINER,
        appId: () => ME
    }
};

const launched = [];

global.tizen = {
    application: {
        getAppsContext: (answer) => answer([{ appId: CONTAINER, id: 'stock' }]),
        kill: () => {
            throw Object.assign(new Error('Permission denied'), { name: 'SecurityError' });
        },
        launch: (id, ok) => {
            launched.push(id);
            if (ok) ok();
        }
    }
};

// The claim window is ten seconds; run it now.
global.setTimeout = (run) => {
    run();
    return 0;
};

const cobalt = require('../lib/cobalt.js');

// The claim window counts from the port opening, so the service says it is listening.
cobalt.listened();

const results = [];

const check = (label, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    results.push(!!ok);
};

const survives = (run) => {
    try {
        run();
        return true;
    } catch (e) {
        console.log(`      threw ${e.name}: ${e.message}`);
        return false;
    }
};

check('waking beside a container we may not kill does not throw', survives(() => cobalt.wake()));
check('and launches ours anyway', launched.indexOf(ME) !== -1);
check('and says why in the log', readFileSync(LOG, 'utf8').indexOf('could not close it: Permission denied') !== -1);

const answered = { error: undefined };
launched.length = 0;

check('relaunching past a refused kill does not throw',
    survives(() => cobalt.relaunch((error) => { answered.error = error; })));
check('and still starts ours', launched.indexOf(ME) !== -1 && answered.error === null);

launched.length = 0;
check('the boot screen can have the app started again', cobalt.restart() === true && launched.indexOf(ME) !== -1);
check('but only once, so it can never loop', cobalt.restart() === false);

check('a widget without --content never intercepts, even with a certificate on disk', cobalt.material() === null);

manifest.content = '/home/owner/share/tube/cobalt-content';
check('one with --content intercepts with that certificate', !!cobalt.material() && !!cobalt.material().cert);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
