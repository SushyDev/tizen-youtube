'use strict';

// Bringing the container up, and keeping it reachable.

const os = require('os');
const path = require('path');
const dns = require('dns');

const x509 = require('./x509.js');
const postmortem = require('./postmortem.js');
const { CONTAINER, appId, configuredContent, container, switches } = require('./cobaltConfig.js');
const { MITM_DIR, existingMaterial, installCa, issue, stillGood } = require('./cobaltCa.js');
const { STOCK, cobaltIsInstalledHere, stageOrFail } = require('./cobaltContent.js');

const RELAUNCH_QUIET = 20000;
const CLAIM_WITHIN = 10000;
const LOOKUP_QUIET = 5000;
const KILL_SETTLE = 1200;

const note = (what, detail) => postmortem.note('cobalt', `${what}: ${postmortem.describe(detail)}`);

const state = { prepared: null, preparing: false, lastWake: 0, waiting: [] };
const proxied = { context: null, at: 0, lookedAt: 0 };

const addresses = () => {
    const interfaces = os.networkInterfaces();

    return Object.keys(interfaces).reduce(
        (all, device) => all.concat(interfaces[device].map((entry) => entry.address)), []
    );
};

// Loopback is this set, whichever loopback it is. The switch names 127.0.0.2 precisely because
// that is a fixed way of saying "here" — only 127.0.0.1 appears in the interface list, so
// comparing against that alone reports the one configuration that is always right as misdirected.
const isLoopback = (address) => address === '::1' || String(address).indexOf('127.') === 0;

// Cobalt resolves the set's own hostname, which leans on the router registering DHCP names. When
// it does not, the alternative is a silent network error with nothing anywhere to explain it.
const checkAddress = () => {
    const named = /--proxy=http:\/\/([^:\s]+)/.exec(switches() || '');
    if (!named) return;

    const mine = addresses();
    const here = `This set is ${os.hostname()} at ${mine.join(', ')}.`;

    dns.lookup(named[1], { all: true }, (error, found) => {
        if (error) {
            return note('unreachable', `--proxy names ${named[1]}, which does not resolve here `
                + `(${error.code}). ${here}`);
        }

        const resolved = found.map((entry) => entry.address);
        const ours = (address) => isLoopback(address) || mine.indexOf(address) !== -1;

        if (resolved.some(ours)) return undefined;

        return note('misdirected', `--proxy names ${named[1]}, which resolves to `
            + `${resolved.join(', ')} — not this set. ${here}`);
    });
};

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

const launch = (me) => tizen.application.launch(me, () => {},
    (error) => note('relaunch', `refused: ${error.message}`));

const replaceUnlessOurs = (up, me, since) => {
    if (up.id === proxied.context) return;

    setTimeout(() => {
        if (proxied.at >= since) proxied.context = up.id;
        if (up.id === proxied.context) return;

        note('woken', `the container is not ours; launching ${me}`);
        tizen.application.kill(up.id, () => setTimeout(() => launch(me), KILL_SETTLE), () => launch(me));
    }, CLAIM_WITHIN);
};

// Launched from the service because the container the platform starts on a reopen dies at once.
const wake = () => {
    if (typeof tizen === 'undefined') return;

    const me = appId();
    if (!me || !container()) return;

    const now = Date.now();
    if (now - state.lastWake < RELAUNCH_QUIET) return;
    state.lastWake = now;

    tizen.application.getAppsContext((contexts) => {
        const up = contexts.find((context) => context.appId === CONTAINER);
        if (up) return replaceUnlessOurs(up, me, now);

        note('woken', `the container is not up; launching ${me}`);
        return launch(me);
    }, () => {});
};

const LAUNCH_AFTER_KILL = 1200;

// Kills the cobalt-yt context as well as ours, because that context holds the running bundle.
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
            tizen.application.launch(me, () => done(null, { killed: running.length }),
                (error) => done(new Error(`launch refused: ${error.message}`)));
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
            tizen.application.kill(context.id, finished, finished);
        });
    }, (error) => done(new Error(`could not list contexts: ${error.message}`)));
};

const prepare = (done) => {
    const finish = (error, result) => {
        state.preparing = false;

        if (error) note('failed', error);
        else state.prepared = result;

        const waiting = state.waiting;
        state.waiting = [];
        return waiting.forEach((waiter) => waiter(error, result));
    };

    if (done) state.waiting = state.waiting.concat([done]);

    if (state.prepared) return done ? done(null, state.prepared) : undefined;

    // Held rather than answered: telling a caller "finished, nothing to do" while the work is
    // still running reports an empty result as a real one.
    if (state.preparing) return undefined;

    state.preparing = true;

    // Reported either way and before anything else: on a set the service cannot be reached from,
    // this one line is the whole diagnosis. Not every Tizen device has the container.
    const present = cobaltIsInstalledHere();

    note(present ? 'present' : 'absent', present
        ? `Cobalt is at ${STOCK}`
        : `nothing at ${STOCK} — ${os.hostname()} may not be a device that has the container`);

    const content = configuredContent();
    if (!content) return finish(null, null);

    checkAddress();

    if (!present) return finish(null, null);

    const staged = stageOrFail(content);
    if (staged.error) return finish(staged.error);

    const material = existingMaterial();

    const trust = (issued) => {
        try {
            installCa(path.join(content, 'ssl', 'certs'), issued.ca);
        } catch (e) {
            return finish(e);
        }

        return finish(null, issued);
    };

    if (material && stillGood(material)) return trust(material);

    // Key generation is seconds on this hardware, so it runs off the event loop and the service
    // answers normally while it happens.
    if (!x509.available()) return finish(null, null);

    return issue((error, issued) => (error ? finish(error) : trust(issued)));
};

// What forward.js needs to stand in front of a TLS connection, or null while it is still being
// made. Read from disk so a service that started before the staging finished picks it up.
const material = () => {
    if (state.prepared) return { key: state.prepared.key, cert: state.prepared.chain };

    const existing = existingMaterial();
    if (!existing) return null;

    state.prepared = existing;
    return { key: existing.key, cert: existing.chain };
};

module.exports = { prepare, wake, served, relaunch, material, container, appId, MITM_DIR };
