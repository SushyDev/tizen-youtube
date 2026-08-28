'use strict';

// tube service: CDP injection when Developer Mode is on, a local proxy when it is off.
// The shell asks which is available and goes straight there.

const express = require('express');

const ports = require('./lib/ports.js');
const loader = require('./lib/loader.js');
const injector = require('./lib/injector.js');
const proxy = require('./lib/proxy.js');
const dial = require('./lib/dial.js');

// Off-TV the proxy, loader and rewrite rules still work; only DIAL and injection need
// the platform. This is what `npm run dev` uses.
const isTV = typeof tizen !== 'undefined';

// Off-TV the variant would always come out `legacy`, so this says which TV to be.
const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

const app = proxy.create(platformVersion);

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

// A failed injection, remembered just long enough. The shell has already exited by the
// time one fails, so the service brings the app back and leaves this behind — the next
// launch takes the proxy instead of looping. Expires: developer mode gets turned back on.
const FAILURE_MEMORY = 60 * 1000;

let injectionFailedAt = 0;

const injectionRecentlyFailed = () => Date.now() - injectionFailedAt < FAILURE_MEMORY;

// Without this the television is left on the home row with nothing having happened.
function relaunchApp(reason) {
    injectionFailedAt = Date.now();
    injector.stopConnecting();
    console.error(`Injection failed (${reason}); reopening the app on the proxy path.`);

    if (!isTV) return;

    const appId = `${tizen.application.getAppInfo().packageId}.Tube`;
    tizen.application.launch(
        appId,
        () => console.log('Reopened the app.'),
        (err) => console.error(`Could not reopen the app: ${err.message}`)
    );
}

// The shell polls this to decide which path to take.
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
            ip: state.ip,
            platformVersion,
            variant: loader.variantFor(platformVersion),
            script,

            // DIAL only runs on a TV, so off one there is no cast endpoint to point at.
            proxyUrl: `http://localhost:${ports.PROXY}/tv` + (isTV
                ? `?additionalDataUrl=${encodeURIComponent(`http://localhost:${ports.DIAL}/dial/apps/YouTube`)}`
                : '')
        });
    });
});

// Starts the debugger and injects. The shell exits immediately after calling this.
app.get('/__tube/inject', (req, res) => {
    if (!isTV) {
        return res.status(501).json({ error: 'Injection needs a TV; this service is running off-device.' });
    }

    const args = req.originalUrl.split('?')[1] || '';
    const appId = `${tizen.application.getAppInfo().packageId}.Tube`;

    // The debug launch has to replace a window that is already gone, so wait for the
    // shell to exit — and give up, rather than polling for the life of the service.
    const startedWaiting = Date.now();

    const waitForExit = setInterval(() => {
        if (Date.now() - startedWaiting > 10000) {
            clearInterval(waitForExit);
            return relaunchApp('the app never closed');
        }

        tizen.application.getAppsContext((contexts) => {
            if (contexts.some((context) => context.appId === appId)) return;

            clearInterval(waitForExit);

            injector.startDebugger(args).then(
                // `false` means the daemon refused: a failure even though nothing threw.
                (attached) => { if (!attached) relaunchApp('sdb would not accept a connection'); },
                (err) => relaunchApp(err.message)
            );
        });
    }, 50);

    res.json({ ok: true });
});

// Registered last so it cannot shadow the endpoints above.
proxy.attachFallback(app);

app.listen(ports.PROXY, '127.0.0.1', () => {
    console.log(`tube service on 127.0.0.1:${ports.PROXY} (${loader.variantFor(platformVersion)} bundle)`);
    if (!isTV) {
        console.log('Running off-TV: proxy and userscript are live; DIAL and injection are disabled.');
    }
});

// DIAL discovery needs the platform to launch the app on a cast request.
if (isTV) dial.start();

// A new script is used from the next launch onward, so a bad one cannot break the
// session that fetched it.
setTimeout(maybeCheckForUpdate, 5000);
