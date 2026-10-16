'use strict';

const os = require('os');
const path = require('path');
const { readFileSync } = require('fs');

const LOG = path.join(os.tmpdir(), `tube-wake-${process.pid}.log`);
process.env.TUBE_LOG = LOG;

const ME = 'tUb3Xq7Lm9.Tube';
const CONTAINER = 'com.samsung.tv.cobalt-yt';

// A manifest claiming the slot, which off the set only a stand-in can give.
require.cache[require.resolve('../lib/cobaltConfig.js')] = {
    exports: {
        CONTAINER,
        config: () => '<widget/>',
        switches: () => '--base_url=file:///tube/boot.html --dial_name=Tube --use_eden',
        configuredContent: () => null,
        container: () => CONTAINER,
        appId: () => ME
    }
};

const launched = [];
const killed = [];
const running = { contexts: [] };

global.tizen = {
    application: {
        getAppsContext: (answer) => answer(running.contexts),
        kill: (id, ok) => {
            killed.push(id);
            if (ok) ok();
        },
        launch: (id, ok) => {
            launched.push(id);
            if (ok) ok();
        }
    }
};

// Every timer the module sets runs now, so a delayed launch cannot hide past the checks.
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

const log = () => readFileSync(LOG, 'utf8');

// Each shape the platform's own wakes arrive in: boot, standby, reclaim, install, stock up or ours.
const shapes = [
    ['nothing running, on a set up for hours', [], 3600, 86400],
    ['nothing running, the service just restarted', [], 0.4, 86400],
    ['nothing running, the set just booted', [], 0.4, 40],
    ['a container already up', [{ appId: CONTAINER, id: 'up' }], 3600, 86400],
    ['a container up, the service just restarted', [{ appId: CONTAINER, id: 'up' }], 0.4, 86400]
];

shapes.forEach(([shape, contexts, serviceUp, setUp]) => {
    running.contexts = contexts;
    launched.length = 0;
    killed.length = 0;
    process.uptime = () => serviceUp;
    os.uptime = () => setUp;

    cobalt.wake();
    cobalt.wake();

    check(`a wake with ${shape} launches nothing and closes nothing`,
        launched.length === 0 && killed.length === 0);
});

check('and says so in the log', log().indexOf('nothing is launched') !== -1);

const answered = { error: undefined };
running.contexts = [{ appId: CONTAINER, id: 'up' }];
launched.length = 0;

cobalt.relaunch((error) => { answered.error = error; });
check('an explicit relaunch still closes the container and starts ours',
    killed.indexOf('up') !== -1 && launched.indexOf(ME) !== -1 && answered.error === null);

launched.length = 0;
check('the boot screen can have the app started again', cobalt.restart() === true && launched.indexOf(ME) !== -1);
check('but only once, so it can never loop', cobalt.restart() === false);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
