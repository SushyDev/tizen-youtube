'use strict';

const postmortem = require('./lib/postmortem.js');
postmortem.watch();

const ports = require('./lib/ports.js');
const loader = require('./lib/loader.js');
const proxy = require('./lib/proxy.js');
const devbridge = require('./lib/devbridge.js');
const dial = require('./lib/dial.js');
const forward = require('./lib/forward.js');

const isTV = typeof tizen !== 'undefined';

const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

const app = proxy.create(platformVersion);

// Cobalt refuses to load a single resource from a document that arrived without a
// Content-Security-Policy header — a release build treats its absence as "deny everything", which
// on screen is a black rectangle and a network error rather than anything naming CSP. The page is
// ours and already same-origin, so the policy only has to exist.
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

// Which experiment flags the page is served with, changeable while the set is running:
//   /__tube/dev/flags                       what is set now
//   /__tube/dev/flags?html5_onesie=false    set one (repeatable), then reload the page
//   /__tube/dev/flags?clear=1               back to what YouTube sent
app.get('/__tube/dev/flags', (req, res) => {
    if (req.query.clear) proxy.flagOverrides.clear();

    for (const name of Object.keys(req.query)) {
        if (name === 'clear') continue;
        if (!/^[a-z0-9_]{3,64}$/.test(name)) continue;
        proxy.flagOverrides.set(name, String(req.query[name]).slice(0, 32));
    }

    res.json({ flags: Object.fromEntries(proxy.flagOverrides) });
});

// Which Origin the service presents to Google. /__tube/dev/upstream?origin=pass|drop|<url>
app.get('/__tube/dev/upstream', (req, res) => {
    const asked = req.query.origin;
    if (asked) proxy.upstream.origin = String(asked).slice(0, 128);
    if (req.query.abr) proxy.upstream.abrThroughService = req.query.abr === 'service';
    if (req.query.onesie) {
        const asked = String(req.query.onesie);
        proxy.upstream.onesie = ['off', 'fail'].indexOf(asked) === -1 ? 'auto' : asked;
    }
    if (req.query.patches) proxy.upstream.nativeProxyPatches = req.query.patches !== 'off';
    res.json({
        origin: proxy.upstream.origin,
        abr: proxy.upstream.abrThroughService ? 'service' : 'direct',
        onesie: proxy.upstream.onesie,
        patches: proxy.upstream.nativeProxyPatches ? 'on' : 'off'
    });
});

devbridge.attach(app);

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

// Loopback is not enough. Cobalt runs in its own package, and this television controls
// app-to-app traffic on 127.0.0.1 by SMACK label, so nothing outside our package can reach a
// server bound there. Binding every interface lets the container in by the set's own address.
//
// Loopback is not worth trying again. From another package on this set, 127.0.0.1 and 0.0.0.0
// answer EHOSTUNREACH and ::1 and localhost answer EACCES, while the LAN address connects; a
// dual-stack '::' bind and a --proxy naming localhost were both packaged and launched to confirm
// it end to end. The container never connects. So the proxy switch has to name a real address.
const BIND = '0.0.0.0';

const server = app.listen(ports.PROXY, BIND, () => {
    console.log(`tube service on ${BIND}:${ports.PROXY} (${loader.variantFor(platformVersion)} bundle)`);
    if (!isTV) {
        console.log('Running off-TV: proxy and userscript are live; DIAL is disabled.');
    }

    announceReady();
});

// Cobalt's --proxy sends TLS through CONNECT; without an answer to that the container has no
// network at all. The bytes are passed through untouched — this is a route, not a reader.
forward.tunnel(server);

if (isTV) dial.start();

setTimeout(maybeCheckForUpdate, 5000);
