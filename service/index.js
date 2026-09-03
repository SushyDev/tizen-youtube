'use strict';

// First, before anything that could fail. A television shows a service that died as a
// boot screen that times out and nothing else, so this is where it says what happened.
require('./lib/postmortem.js').watch();

const ports = require('./lib/ports.js');
const loader = require('./lib/loader.js');
const injector = require('./lib/injector.js');
const proxy = require('./lib/proxy.js');
const devbridge = require('./lib/devbridge.js');
const dash = require('./lib/dash.js');
const stream = require('./lib/stream.js');
const dial = require('./lib/dial.js');

const isTV = typeof tizen !== 'undefined';

const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

const app = proxy.create(platformVersion);

// The service outlives the app and can stay resident for days, so checking only at start
// would mean an update lands after a reboot. Debounced, so repeated launches cannot
// hammer the origin.
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

// Off, because the exit is paid before anything is known: the shell has to close for the
// relaunch to replace it, so a set where attaching does not work pays the whole cost and
// lands on the proxy anyway. Measured on a QE65S93DATXXN, which reports a reachable
// daemon and then never attaches.
const OFFER_DEBUGGER = false;

// Once per lifetime, not for a minute: the service outlives app launches, so on a set
// where the debugger never attaches a shorter memory had always expired by the next one,
// and every start of the app paid for an exit and a relaunch that bought nothing.
let injectionFailed = false;

function relaunchApp(reason) {
    injectionFailed = true;
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

app.get('/__tube/state', (_, res) => {
    maybeCheckForUpdate();

    injector.canConnectToDaemon().then((state) => {
        let script = null;
        try {
            const resolved = loader.resolve(platformVersion);
            script = { version: resolved.version, origin: resolved.origin, variant: resolved.variant };
        } catch (e) {
            script = { error: e.message };
        }

        res.json({
            canInject: OFFER_DEBUGGER && state.canConnectToDaemon,
            isConnecting: state.isConnecting,
            injectionFailed,
            ip: state.ip,
            platformVersion,
            variant: loader.variantFor(platformVersion),
            script,

            proxyUrl: `http://localhost:${ports.PROXY}/tv` + (isTV
                ? `?additionalDataUrl=${encodeURIComponent(`http://localhost:${ports.DIAL}/dial/apps/YouTube`)}`
                : '')
        });
    });
});

app.get('/__tube/inject', (req, res) => {
    if (!isTV) {
        return res.status(501).json({ error: 'Injection needs a TV; this service is running off-device.' });
    }

    const args = req.originalUrl.split('?')[1] || '';
    const appId = `${tizen.application.getAppInfo().packageId}.Tube`;

    // The debug launch has to replace a window that is already gone, so wait for the shell to
    // exit — and give up, rather than polling for the life of the service.
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

devbridge.attach(app);

dash.attach(app);

stream.clean();

// `unref` is a Node convenience and not every runtime this service starts on has it.
// Losing the timer would be a slow leak; failing to start is a black screen.
const sweeping = setInterval(() => stream.sweep(), stream.SWEEP_INTERVAL);
if (sweeping && typeof sweeping.unref === 'function') sweeping.unref();

// Registered last so it cannot shadow the endpoints above.
proxy.attachFallback(app);

// Loopback on the set. Serving another machine's television means binding the network.
const BIND = process.env.TUBE_PROXY_HOST ? '0.0.0.0' : '127.0.0.1';

app.listen(ports.PROXY, BIND, () => {
    console.log(`tube service on 127.0.0.1:${ports.PROXY} (${loader.variantFor(platformVersion)} bundle)`);
    if (!isTV) {
        console.log('Running off-TV: proxy and userscript are live; DIAL and injection are disabled.');
    }
});

if (isTV) dial.start();

// A new script is used from the next launch onward, so a bad one cannot break the session
// that fetched it.
setTimeout(maybeCheckForUpdate, 5000);
