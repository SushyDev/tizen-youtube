'use strict';

const postmortem = require('./lib/postmortem.js');
postmortem.watch();

const ports = require('./lib/ports.js');
const loader = require('./lib/loader.js');
const proxy = require('./lib/proxy.js');
const devbridge = require('./lib/devbridge.js');
const dash = require('./lib/dash.js');
const stream = require('./lib/stream.js');
const dial = require('./lib/dial.js');
const journal = require('./lib/journal.js');

const isTV = typeof tizen !== 'undefined';

const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

const app = proxy.create(platformVersion);

// TEMPORARY, for the Cobalt container experiment. A gold Cobalt build requires a real
// Content-Security-Policy header on the document: without one its CSP delegate refuses to load
// any resource at all, which reads on screen as a black screen and a network error.
// TEMPORARY, alongside it: what the container actually asks for, so a playback that fetches no
// media at all can be told apart from one whose fetches are refused.
app.use((req, _, next) => {
    const path = String(req.originalUrl || req.url || '');
    if (path.indexOf('/__tube/oops') === -1) {
        journal.service('asked', `${req.method} ${path.slice(0, 150)}`);
    }
    next();
});

app.use((_, res, next) => {
    res.setHeader('Content-Security-Policy', [
        "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
        "img-src * data: blob:",
        "media-src * data: blob:",
        "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
        "style-src * data: blob: 'unsafe-inline'",
        "connect-src *",
        "font-src * data:"
    ].join('; '));
    next();
});

const UPDATE_CHECK_INTERVAL = 15 * 60 * 1000;

let lastUpdateCheck = 0;
let updateInFlight = false;

function maybeCheckForUpdate() {
    const now = Date.now();
    if (updateInFlight || now - lastUpdateCheck < UPDATE_CHECK_INTERVAL) return;

    lastUpdateCheck = now;
    updateInFlight = true;
    loader.checkForUpdate(platformVersion).then(
        () => { updateInFlight = false; },
        () => { updateInFlight = false; }
    );
}

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
        media: stream.holding(),
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

app.get('/__tube/booted', (req, res) => {
    const line = String((req.query && req.query.t) || '').replace(/[\r\n]+/g, ' ').slice(0, 300);

    postmortem.note('boot', line);
    res.json({ ok: true });
});

app.get('/__tube/quit', (_, res) => {
    postmortem.note('quit', 'asked to stop by the boot screen');
    res.json({ ok: true });

    setTimeout(() => process.exit(0), 100);
});

devbridge.attach(app);

// TEMPORARY, for the Cobalt container experiment: the journal only records once the page asks for
// diagnostics, and the container never does — so the proxy's own view of a failing playback is
// invisible. Opening it here makes /log readable without a cooperating page.
devbridge.start();

// Registered last so it cannot shadow the endpoints above.
dash.attach(app);

stream.clean();

// Not every runtime this service starts on has `unref`.
const sweeping = setInterval(() => stream.sweep(), stream.SWEEP_INTERVAL);
if (sweeping && typeof sweeping.unref === 'function') sweeping.unref();

proxy.attachFallback(app);

// Must match the port names in ui/src/boot.js.
const READY_PORT = 'TUBE_BOOT';
const READY_PORT_OPEN = 'TUBE_BOOT_OPEN';

function announceReady() {
    if (!isTV) return;

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

        postmortem.note('announce', said.join(', '));
    } catch (e) {
        postmortem.note('announce', `could not announce: ${e.name || 'Error'} ${e.message}`);
    }
}

// TEMPORARY, for the Cobalt container experiment: packages on this set cannot reach each other's
// loopback, so the container has to be given the television's own address on the network instead.
const BIND = '0.0.0.0';

app.listen(ports.PROXY, BIND, () => {
    console.log(`tube service on 127.0.0.1:${ports.PROXY} (${loader.variantFor(platformVersion)} bundle)`);
    if (!isTV) {
        console.log('Running off-TV: proxy and userscript are live; DIAL is disabled.');
    }

    announceReady();
});

if (isTV) dial.start();

setTimeout(maybeCheckForUpdate, 5000);
