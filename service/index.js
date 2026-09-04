'use strict';

// First, before anything that could fail. A television shows a service that died as a
// boot screen that times out and nothing else, so this is where it says what happened.
const postmortem = require('./lib/postmortem.js');
postmortem.watch();

const ports = require('./lib/ports.js');
const loader = require('./lib/loader.js');
const proxy = require('./lib/proxy.js');
const devbridge = require('./lib/devbridge.js');
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

// The endpoint and the announcement answer with the same thing, from here, so the two can
// never drift apart.
function describeState() {
    let script = null;
    try {
        const resolved = loader.resolve(platformVersion);
        script = { version: resolved.version, origin: resolved.origin, variant: resolved.variant };
    } catch (e) {
        script = { error: e.message };
    }

    return {
        platformVersion,
        variant: loader.variantFor(platformVersion),
        script,


        proxyUrl: `http://localhost:${ports.PROXY}/tv` + (isTV
            ? `?additionalDataUrl=${encodeURIComponent(`http://localhost:${ports.DIAL}/dial/apps/YouTube`)}`
            : '')
    };
}

app.get('/__tube/state', (_, res) => {
    maybeCheckForUpdate();
    res.json(describeState());
});

// The boot screen cannot keep its own timings: the page is replaced a frame after it
// works them out. They land here instead, in a log that survives the app and can be read
// back without the app being a debug build.
app.get('/__tube/booted', (req, res) => {
    // One line per launch, so a newline in it would forge another. Loopback only, but the
    // log is the record everything else is read from and it should not be writable prose.
    const line = String((req.query && req.query.t) || '').replace(/[\r\n]+/g, ' ').slice(0, 300);

    postmortem.note('boot', line);
    res.json({ ok: true });
});

// The boot screen asks for this when Back is pressed while it is on screen. The service is
// `background-support="enable"` and outlives the app on purpose, which is right for a
// viewer who is coming back and wrong for one who has deliberately left — it would go on
// holding a stream and fetching for nobody. Loopback only, like everything else here.
app.get('/__tube/quit', (_, res) => {
    postmortem.note('quit', 'asked to stop by the boot screen');
    res.json({ ok: true });

    // After the answer has gone out, or the shell is left waiting on a socket that dies.
    setTimeout(() => process.exit(0), 100);
});

devbridge.attach(app);


// Registered last so it cannot shadow the endpoints above.
proxy.attachFallback(app);

// Shared with ui/src/boot.js, and meaningless to anything else.
const READY_PORT = 'TUBE_BOOT';
const READY_PORT_OPEN = 'TUBE_BOOT_OPEN';

// The boot screen is sitting on this rather than asking repeatedly, so it is sent from
// inside the listen callback and nowhere earlier: the shell's next act is to navigate to
// this port, and "the service started" is not the same claim as "the socket is bound".
//
// Everything here is inside a try. `requestTrustedRemoteMessagePort` throws NotFoundError
// when nobody is listening — which is the ordinary case for a launch the shell did not ask
// for, and for one where it has already handed over — and an uncaught throw in this
// process is postmortem's `process.exit(1)`, which is a television showing nothing.
function announceReady() {
    if (!isTV) return;

    // The whole body is inside this, not just the sends: `getAppInfo` and the `tizen`
    // namespace itself can throw, this runs in the listen callback, and an uncaught throw
    // in this process is postmortem's `process.exit(1)` — a television showing nothing.
    // No announcement is a slower launch; a throw here is no launch at all.
    try {
        const uiAppId = `${tizen.application.getAppInfo().packageId}.Tube`;
        const payload = [{ key: 'state', value: JSON.stringify(describeState()) }];
        const said = [];

        const send = (label, open) => {
            try {
                open(uiAppId).sendMessage(payload);
                said.push(`${label} sent`);
            } catch (e) {
                said.push(`${label} ${e.name || 'Error'} ${e.message}`);
            }
        };

        send('trusted', (id) => tizen.messageport.requestTrustedRemoteMessagePort(id, READY_PORT));
        send('open', (id) => tizen.messageport.requestRemoteMessagePort(id, READY_PORT_OPEN));

        // Nothing collects this process's stdout on a television, so it goes where it can
        // be read back. Nobody waiting is the common case, not a fault.
        postmortem.note('announce', said.join(', '));
    } catch (e) {
        postmortem.note('announce', `could not announce: ${e.name || 'Error'} ${e.message}`);
    }
}

// Loopback on the set. Serving another machine's television means binding the network.
const BIND = process.env.TUBE_PROXY_HOST ? '0.0.0.0' : '127.0.0.1';

app.listen(ports.PROXY, BIND, () => {
    console.log(`tube service on 127.0.0.1:${ports.PROXY} (${loader.variantFor(platformVersion)} bundle)`);
    if (!isTV) {
        console.log('Running off-TV: proxy and userscript are live; DIAL is disabled.');
    }

    // First thing after the socket is bound: something may have been waiting seconds for it.
    announceReady();
});

if (isTV) dial.start();

// A new script is used from the next launch onward, so a bad one cannot break the session
// that fetched it.
setTimeout(maybeCheckForUpdate, 5000);
