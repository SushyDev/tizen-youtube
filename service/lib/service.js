'use strict';

// The tube service, minus how it is started. `../index.js` is what ships and adds only
// `listen`; `../dev/index.js` adds the development proxy on top of the same routes.
//
// There is one injection path: CDP over the TV's own sdb daemon. The MITM proxy that
// used to stand in when Developer Mode was off is gone from the device — it lives in
// `../dev/` and is reachable only from the development entry, so ncc never bundles it.

const express = require('express');

const ports = require('./ports.js');
const loader = require('./loader.js');
const injector = require('./injector.js');
const dial = require('./dial.js');

// Off-TV the loader still works; DIAL and injection need the platform. `npm run dev`
// runs this same module and adds the proxy.
const isTV = typeof tizen !== 'undefined';

// Off-TV the variant would always come out `legacy`, so this says which TV to be.
const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// The service outlives the app and can stay resident for days, so checking only at
// start would mean an update lands after a reboot. The shell hits /__tube/state once
// per launch; debounced so repeated launches cannot hammer the origin.
const UPDATE_CHECK_INTERVAL = 15 * 60 * 1000;

let lastUpdateCheck = 0;
let updateInFlight = false;

function maybeCheckForUpdate() {
    const now = Date.now();
    if (updateInFlight || now - lastUpdateCheck < UPDATE_CHECK_INTERVAL) return;

    lastUpdateCheck = now;
    updateInFlight = true;
    // Deliberately not awaited: a slow or dead origin must never delay a launch.
    loader.checkForUpdate(platformVersion).then(
        () => { updateInFlight = false; },
        () => { updateInFlight = false; }
    );
}

// A failed injection, remembered just long enough. With no proxy to fall back to there
// is nothing to do but reopen the app and say what went wrong, so the reason is kept
// alongside the timestamp and handed to the boot screen. Expires, because the usual
// cause is Developer Mode being off and the usual fix is turning it on.
const FAILURE_MEMORY = 60 * 1000;

let injectionFailedAt = 0;
let injectionError = null;

const injectionRecentlyFailed = () => Date.now() - injectionFailedAt < FAILURE_MEMORY;

function appId() {
    return `${tizen.application.getAppInfo().packageId}.Tube`;
}

// Injection failed and the shell has already exited, so the television is sitting on
// the home row with nothing having happened. Bring the app back: it reads the reason
// below out of /__tube/state and puts it on screen rather than retrying into a loop.
function reopenWithFailure(reason) {
    injectionFailedAt = Date.now();
    injectionError = reason;
    injector.stopConnecting();
    console.error(`Injection failed (${reason}); reopening the app to report it.`);

    if (!isTV) return;

    tizen.application.launch(
        appId(),
        () => console.log('Reopened the app.'),
        (err) => console.error(`Could not reopen the app: ${err.message}`)
    );
}

// The shell polls this before it decides anything.
app.get('/__tube/state', (_, res) => {
    maybeCheckForUpdate();

    injector.canConnectToDaemon().then((state) => {
        // Which script this TV would run, so "did my update land?" is answerable.
        let script = null;
        try {
            const resolved = loader.resolve(platformVersion);
            script = { version: resolved.version, origin: resolved.origin, variant: resolved.variant };
        } catch (e) {
            script = { error: e.message };
        }

        res.json({
            canInject: state.canConnectToDaemon,
            isConnecting: state.isConnecting,
            injectionFailed: injectionRecentlyFailed(),
            injectionError: injectionRecentlyFailed() ? injectionError : null,
            ip: state.ip,
            platformVersion,
            variant: loader.variantFor(platformVersion),
            script,

            // Null on a television: there is one route and it is the debugger. The
            // development entry replaces this with the proxy URL, which is the only
            // place a hand-over to something other than the debugger can come from.
            handOverUrl: null
        });
    });
});

// How long to wait for the shell to close before launching the debugger anyway. The
// old code waited ten seconds for the app to leave `getAppsContext` and gave up if it
// never did — but this app is `background-support="enable"` with prelaunch on, so it
// can legitimately linger there after `exit()`, and a lingering shell used to mean a
// ten-second black screen and no injection at all. `shell:0 debug` replaces the running
// instance regardless, so waiting is an optimisation and never a precondition.
const EXIT_GRACE = 3000;
const EXIT_POLL = 50;

// Starts the debugger and injects. The shell exits immediately after calling this.
app.get('/__tube/inject', (req, res) => {
    if (!isTV) {
        return res.status(501).json({ error: 'Injection needs a TV; this service is running off-device.' });
    }

    const args = req.originalUrl.split('?')[1] || '';
    const id = appId();
    const startedWaiting = Date.now();

    const inject = (note) => {
        if (note) console.log(note);
        injector.startDebugger(args).then(
            // `false` means the daemon refused: a failure even though nothing threw.
            (attached) => { if (!attached) reopenWithFailure('sdb would not accept a connection'); },
            (err) => reopenWithFailure(err.message)
        );
    };

    const waitForExit = setInterval(() => {
        const waited = Date.now() - startedWaiting;

        tizen.application.getAppsContext((contexts) => {
            const stillRunning = contexts.some((context) => context.appId === id);

            if (stillRunning && waited < EXIT_GRACE) return;

            clearInterval(waitForExit);
            inject(stillRunning
                ? `The shell is still listed after ${waited}ms; launching the debugger anyway.`
                : null);
        });
    }, EXIT_POLL);

    res.json({ ok: true });
});

/** Binds the port and starts the background work. Called by whichever entry ran. */
function start() {
    app.listen(ports.SERVICE, '127.0.0.1', () => {
        console.log(`tube service on 127.0.0.1:${ports.SERVICE} (${loader.variantFor(platformVersion)} bundle)`);
        if (!isTV) {
            console.log('Running off-TV: the loader is live; DIAL and injection are disabled.');
        }
    });

    // DIAL discovery needs the platform to launch the app on a cast request.
    if (isTV) dial.start();

    // A new script is used from the next launch onward, so a bad one cannot break the
    // session that fetched it.
    setTimeout(maybeCheckForUpdate, 5000);
}

module.exports = { app, start, platformVersion, isTV };
