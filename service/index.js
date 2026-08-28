'use strict';

// tube service.
//
// Two ways in: CDP injection when Developer Mode is on (clean, no rewriting),
// and a local proxy when it is off. The shell asks which is available and goes
// straight there — there is no loading screen, because the only thing the
// reference was covering up was the app relaunching itself under a debugger.

const express = require('express');

const ports = require('./lib/ports.js');
const loader = require('./lib/loader.js');
const injector = require('./lib/injector.js');
const proxy = require('./lib/proxy.js');
const dial = require('./lib/dial.js');

// Off-TV the proxy, loader and rewrite rules all still work; only DIAL and
// debugger injection need the platform. Running headless like this is what
// `npm run dev` and `npm run dev:service` use.
const isTV = typeof tizen !== 'undefined';

// Off-TV there is no platform to ask, so the variant would always come out
// `legacy` — the one a desktop browser is least like. TUBE_PLATFORM_VERSION
// says which television to pretend to be, which is how both bundles get
// exercised off hardware. Unset on a TV, where the real answer is available.
const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

const app = proxy.create(platformVersion);

// How often the origin may be asked for a newer userscript.
//
// The service is background-support="enable", so it outlives the app and can
// stay resident for days. Checking only at service start would mean a pushed
// update lands only after a TV reboot. The shell hits /__tube/state exactly
// once per launch, which makes it the natural place to check, debounced so
// repeated launches cannot hammer the origin.
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

// A debug injection that failed, remembered just long enough.
//
// The shell has to exit for the debugger to relaunch the app in its place, so
// by the time an injection fails there is nothing left on screen to notice.
// The service brings the app back and leaves this behind, so the launch that
// returns takes the proxy instead of trying the same thing again — which is
// the difference between one slow start and an endless relaunch loop.
//
// It expires because developer mode is something a person turns back on: a
// launch a minute later deserves a fresh attempt.
const FAILURE_MEMORY = 60 * 1000;

let injectionFailedAt = 0;

const injectionRecentlyFailed = () => Date.now() - injectionFailedAt < FAILURE_MEMORY;

// Puts the app back on screen after a failed injection. Without this the
// television is simply left on the home row with nothing having happened,
// which is exactly the failure this whole path exists to avoid.
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
        // Report which script this TV would actually run, so "did my update
        // land?" is answerable without guessing.
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

            // DIAL only runs on a TV, so off one the client is pointed at a
            // cast endpoint that would never answer. Better to have none.
            proxyUrl: `http://localhost:${ports.PROXY}/tv` + (isTV
                ? `?additionalDataUrl=${encodeURIComponent(`http://localhost:${ports.DIAL}/dial/apps/YouTube`)}`
                : '')
        });
    });
});

// Starts the debugger and injects. The shell exits immediately after calling
// this, because the app is about to be relaunched under the debugger.
app.get('/__tube/inject', (req, res) => {
    if (!isTV) {
        return res.status(501).json({ error: 'Injection needs a TV; this service is running off-device.' });
    }

    const args = req.originalUrl.split('?')[1] || '';
    const appId = `${tizen.application.getAppInfo().packageId}.Tube`;

    // The debug launch has to replace a window that is already gone, so this
    // waits for the shell to exit first. It also gives up: an app that never
    // exits used to leave this interval running at 50ms for the life of the
    // service, and nothing ever came of it.
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
                // `false` means the daemon refused, which is a failure even
                // though nothing threw. The reference treated it as success
                // and left the television showing its home screen.
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

// One check shortly after startup, then per-launch via /__tube/state. A newly
// downloaded script is used from the next launch onward, so a bad one can
// never break the session that fetched it.
setTimeout(maybeCheckForUpdate, 5000);
