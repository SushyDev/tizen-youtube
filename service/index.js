'use strict';

// First, before anything that could fail. A television shows a service that died as a
// boot screen that times out and nothing else, so this is where it says what happened.
require('./lib/postmortem.js').watch();

const ports = require('./lib/ports.js');
const loader = require('./lib/loader.js');
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

app.get('/__tube/state', (_, res) => {
    maybeCheckForUpdate();

    let script = null;
    try {
        const resolved = loader.resolve(platformVersion);
        script = { version: resolved.version, origin: resolved.origin, variant: resolved.variant };
    } catch (e) {
        script = { error: e.message };
    }

    res.json({
        platformVersion,
        variant: loader.variantFor(platformVersion),
        script,

        proxyUrl: `http://localhost:${ports.PROXY}/tv` + (isTV
            ? `?additionalDataUrl=${encodeURIComponent(`http://localhost:${ports.DIAL}/dial/apps/YouTube`)}`
            : '')
    });
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
        console.log('Running off-TV: proxy and userscript are live; DIAL is disabled.');
    }
});

if (isTV) dial.start();

// A new script is used from the next launch onward, so a bad one cannot break the session
// that fetched it.
setTimeout(maybeCheckForUpdate, 5000);
