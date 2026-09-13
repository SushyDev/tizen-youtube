'use strict';

// Starting our app over Samsung's container.

const postmortem = require('./postmortem.js');
const { CONTAINER, appId } = require('./cobaltConfig.js');

const LAUNCH_CHECK = 3000;

const held = { restarted: false };

const note = (what, detail) => postmortem.note('cobalt', `${what}: ${postmortem.describe(detail)}`);

// Tizen throws, rather than calling back, when a call is refused.
const guarded = (call, failed) => {
    try {
        return call();
    } catch (error) {
        return failed(error);
    }
};

const refused = (error) => note('relaunch', `refused: ${error.message}`);

const launch = (me) => guarded(() => tizen.application.launch(me, () => {}, refused), refused);

// True when it cannot tell, so a failed look never starts a second container.
const containerUp = (then) => guarded(
    () => tizen.application.getAppsContext(
        (contexts) => then(contexts.some((context) => context.appId === CONTAINER)),
        () => then(true)
    ),
    () => then(true)
);

// A launch over a running container can close it, so it is checked and launched again.
const launchOver = (me) => {
    launch(me);

    setTimeout(() => containerUp((up) => {
        if (up) return;

        note('woken', `the launch closed it; launching ${me} again`);
        launch(me);
    }), LAUNCH_CHECK);
};

// Asked for by the boot screen; once per service, so it cannot loop.
const restart = () => {
    const me = appId();
    if (held.restarted || typeof tizen === 'undefined' || !me) return false;

    held.restarted = true;
    note('restart', `the boot screen cannot reach YouTube through us; launching ${me} again`);
    launchOver(me);

    return true;
};

module.exports = { guarded, launch, launchOver, restart };
