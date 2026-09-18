'use strict';

const os = require('os');

const postmortem = require('./postmortem.js');
const { CONTAINER, appId, configuredContent, container } = require('./cobaltConfig.js');
const { STOCK, discover, locate, stageOrFail } = require('./cobaltContent.js');
const { writeBootScreen } = require('./bootScreen.js');
const evergreen = require('./evergreen.js');
const { guarded, launch, launchOver, restart } = require('./cobaltLaunch.js');

const RELAUNCH_QUIET = 20000;

// Seconds within which a wake is the platform's rather than a viewer's.
const BOOT_WAKE = 5;
const BOOT_QUIET = 120;
const SILENT_AFTER = 20000;
const CLAIM_WITHIN = 10000;
const LOOKUP_QUIET = 5000;
const KILL_SETTLE = 1200;

const note = (what, detail) => postmortem.note('cobalt', `${what}: ${postmortem.describe(detail)}`);

const state = {
    prepared: null, preparing: false, settled: false, failed: null,
    lastWake: 0, waiting: [], listeningAt: 0, onListening: []
};
const proxied = { context: null, at: 0, lookedAt: 0 };

const served = () => {
    const now = Date.now();
    proxied.at = now;

    if (typeof tizen === 'undefined' || now - proxied.lookedAt < LOOKUP_QUIET) return;
    proxied.lookedAt = now;

    try {
        tizen.application.getAppsContext((contexts) => {
            const up = contexts.find((context) => context.appId === CONTAINER);
            if (up) proxied.context = up.id;
        }, () => {});
    } catch (e) {
        note('served', e);
    }
};

// A slot another app also claims is only a fault when nothing of ours has arrived.
const contact = () => ({ at: proxied.at, context: proxied.context });

// The claim window counts from the port opening, or the wake if later.
const whenListening = (then) => {
    if (state.listeningAt) return then();

    state.onListening = state.onListening.concat([then]);
    return undefined;
};

const listened = () => {
    state.listeningAt = Date.now();

    const waiting = state.onListening;
    state.onListening = [];
    waiting.forEach((then) => then());
};

const replace = (id, me) => guarded(
    () => tizen.application.kill(id, () => setTimeout(() => launch(me), KILL_SETTLE), () => launchOver(me)),
    (error) => {
        note('woken', `could not close it: ${error.message}`);
        launchOver(me);
    }
);

// Our boot screen asks us within a second, so a launch that stays silent did not run our switches.
const expectContact = (me, since, again) => setTimeout(() => {
    if (proxied.at >= since) return;

    guarded(() => tizen.application.getAppsContext((contexts) => {
        const up = contexts.find((context) => context.appId === CONTAINER);
        if (!up) {
            note('silent', `nothing is running ${SILENT_AFTER / 1000}s after launching ${me}`);
            return again ? relaunchAfterMerge(me, since) : undefined;
        }

        note('silent', `the container is up but nothing from it has reached us ${SILENT_AFTER / 1000}s after launching ${me}: `
            + `either it is not running our switches or it cannot reach our address${again ? '; replacing it' : ''}`);
        if (!again) return undefined;

        state.lastWake = Date.now();
        replace(up.id, me);
        return expectContact(me, Date.now(), false);
    }, () => {}), () => {});
}, SILENT_AFTER);

// Cobalt dies at once on content it lacks, so a launch that raced Evergreen's merge is made again.
const relaunchAfterMerge = (me, since) => evergreen.settled().then(() => {
    if (!evergreen.mergedSince(since)) return;

    note('silent', `Evergreen content arrived after launching ${me}; launching it again`);
    state.lastWake = Date.now();
    launch(me);
    expectContact(me, Date.now(), false);
});

const replaceUnlessOurs = (up, me, since) => {
    if (up.id === proxied.context) return;

    whenListening(() => {
        const from = Math.max(since, state.listeningAt);

        setTimeout(() => {
            if (proxied.at >= from) proxied.context = up.id;
            if (up.id === proxied.context) return;

            note('woken', `the container is not ours; launching ${me}`);
            replace(up.id, me);
            expectContact(me, Date.now(), true);
        }, CLAIM_WITHIN);
    });
};

// Launched from the service because the container the platform starts on a reopen dies at once.
const wake = () => {
    if (typeof tizen === 'undefined') return;

    const me = appId();
    if (!me || !container()) return;

    // A wake arriving with our own start on a set only just powered on is the platform's, and
    // launching there would open YouTube on every boot.
    if (process.uptime() < BOOT_WAKE && os.uptime() < BOOT_QUIET) {
        return note('woken', `this wake came with the service's own start (${process.uptime().toFixed(1)}s) `
            + `on a set booted ${Math.round(os.uptime())}s ago, so it is the platform's and the `
            + 'container is left alone');
    }

    // Launching before the port is ours aims the container at whatever else holds it.
    if (!state.listeningAt) {
        note('woken', 'the proxy port is not ours yet, so the launch waits for it');
        return whenListening(wake);
    }

    const now = Date.now();
    if (now - state.lastWake < RELAUNCH_QUIET) return;
    state.lastWake = now;

    tizen.application.getAppsContext((contexts) => {
        const up = contexts.find((context) => context.appId === CONTAINER);
        if (up) return replaceUnlessOurs(up, me, now);

        note('woken', `the container is not up; launching ${me}`);
        launch(me);
        return expectContact(me, now, true);
    }, () => {});
};

const LAUNCH_AFTER_KILL = 1200;

// The container's context holds the running bundle, so it is killed as well as ours.
const relaunch = (done) => {
    if (typeof tizen === 'undefined') return done(new Error('not on a television'));

    const me = appId();
    if (!me) return done(new Error('no appId in the manifest'));

    return tizen.application.getAppsContext((contexts) => {
        const running = contexts.filter((context) => context.appId === CONTAINER || context.appId === me);

        const start = () => {
            // Cleared so wake()'s own quiet period cannot swallow the launch that follows.
            state.lastWake = 0;
            note('relaunch', `starting ${me}`);
            const refusedStart = (error) => done(new Error(`launch refused: ${error.message}`));
            guarded(() => tizen.application.launch(me, () => done(null, { killed: running.length }), refusedStart),
                refusedStart);
        };

        if (!running.length) return start();

        // The launch waits for every kill to answer, success or failure.
        const remaining = { count: running.length };
        const finished = () => {
            remaining.count -= 1;
            if (remaining.count <= 0) setTimeout(start, LAUNCH_AFTER_KILL);
        };

        return running.forEach((context) => {
            note('relaunch', `killing ${context.appId} (${context.id})`);
            guarded(() => tizen.application.kill(context.id, finished, finished), finished);
        });
    }, (error) => done(new Error(`could not list contexts: ${error.message}`)));
};

const prepare = (done) => {
    const finish = (error, result) => {
        state.preparing = false;
        state.settled = true;

        if (error) {
            note('failed', error);
            state.failed = postmortem.describe(error).split('\n')[0];
        } else {
            state.prepared = result;
        }

        const waiting = state.waiting;
        state.waiting = [];
        return waiting.forEach((waiter) => waiter(error, result));
    };

    if (done) state.waiting = state.waiting.concat([done]);

    if (state.settled && !state.failed) return done ? done(null, state.prepared) : undefined;

    // Answering while the work is still running would report an empty result as a real one.
    if (state.preparing) return undefined;

    state.preparing = true;

    // On a set the service cannot be reached from, this one line is the whole diagnosis.
    const from = locate();

    note(from ? 'present' : 'absent', from
        ? `Cobalt's content is at ${from}${from === STOCK ? '' : `, found by searching: ${discover()}`}`
        : `nothing at ${STOCK} — ${discover()}`);

    const content = configuredContent();
    if (!content) return finish(null, null);

    if (!from) return finish(null, null);

    const staged = stageOrFail(content, from);
    if (staged.error) return finish(staged.error);

    guarded(() => writeBootScreen(content), (error) => note('boot screen', error));
    guarded(() => evergreen.bootstrap(content, from), (error) => note('evergreen', error));

    return finish(null, { content });
};

const status = () => ({
    prepared: !!state.prepared,
    failed: state.failed
});

module.exports = {
    prepare, wake, served, listened, status, restart, relaunch, container, appId,
    contact,
    heardOffer: evergreen.heardOffer
};
