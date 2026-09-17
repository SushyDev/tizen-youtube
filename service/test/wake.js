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

// Evergreen stood in for: whether a merge landed after a moment.
const merged = { at: 0 };

require.cache[require.resolve('../lib/evergreen.js')] = {
    exports: {
        bootstrap: () => {},
        heardAgent: () => {},
        heardOffer: () => {},
        settled: () => Promise.resolve(),
        mergedSince: (since) => merged.at >= since
    }
};

const launched = [];
const running = { contexts: [{ appId: CONTAINER, id: 'stock' }] };

global.tizen = {
    application: {
        getAppsContext: (answer) => answer(running.contexts),
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

const results = [];

const check = (label, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    results.push(!!ok);
};

// Two installed widgets fight over the port, and the loser must not aim the container at the winner.
// A wake while the server is still opening is the ordinary cold start, so it waits for the port.
cobalt.wake();
check('a wake before the port is ours launches nothing yet', launched.length === 0
    && readFileSync(LOG, 'utf8').indexOf('the proxy port is not ours yet') !== -1);

// The claim window counts from the port opening, so the service says it is listening.
cobalt.listened();

check('and is made as soon as the port is ours', launched.indexOf(ME) !== -1);

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
check('and says so when the container never reaches us', readFileSync(LOG, 'utf8').indexOf('it is not running our switches') !== -1);
check('and replaces a silent container once, so it cannot loop', readFileSync(LOG, 'utf8').split('; replacing it').length === 2);

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

// A launch whose container died: relaunched only when Evergreen's merge landed meanwhile.
// The real timer, since setTimeout is stubbed above.
const afterPromises = () => new Promise((resolve) => require('timers').setImmediate(resolve));

const diedOnLaunch = async (mergedMeanwhile) => {
    await new Promise((resolve) => cobalt.relaunch(resolve));
    running.contexts = [];
    merged.at = mergedMeanwhile ? Infinity : 0;
    launched.length = 0;
    cobalt.wake();
    await afterPromises();
    return launched.length;
};

// The platform starts the service at power-on, which must not open YouTube by itself.
const atBoot = () => {
    const os = require('os');
    const uptime = os.uptime;

    running.contexts = [];
    launched.length = 0;
    os.uptime = () => 5;
    cobalt.wake();
    os.uptime = uptime;

    check('a wake seconds after power-on leaves the container alone', launched.length === 0
        && readFileSync(LOG, 'utf8').indexOf('booted 5s ago') !== -1);
};

const deaths = async () => {
    atBoot();
    check('a container that died with nothing merged is left alone', await diedOnLaunch(false) === 1);
    check('one that died before Evergreen\'s merge landed is launched again, once', await diedOnLaunch(true) === 2
        && readFileSync(LOG, 'utf8').indexOf('Evergreen content arrived') !== -1);
};

deaths().catch((error) => check('the relaunch checks run', false, error.stack)).then(() => {
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
});
