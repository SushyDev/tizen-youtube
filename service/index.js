'use strict';

// First, before anything else is loaded: a dependency in this bundle declares a class extending
// `Event` at load time, and on the older Node some of these sets ship that is a ReferenceError
// during require — the service dies before it can even open its log.
require('./lib/globals.js');

const os = require('os');

const postmortem = require('./lib/postmortem.js');
postmortem.watch();

const ports = require('./lib/ports.js');
const loader = require('./lib/loader.js');
const proxy = require('./lib/proxy.js');
const devbridge = require('./lib/devbridge.js');
const dial = require('./lib/dial.js');
const forward = require('./lib/forward.js');

// Guarded, and the guard is the point. Everything the container route needs is a convenience laid
// on top of a proxy that has to start regardless: if this module cannot be loaded on some set, that
// must cost the container route and not the whole service.
let cobalt = null;
try {
    cobalt = require('./lib/cobalt.js');
} catch (e) {
    postmortem.note('cobalt', `module would not load: ${(e && e.message) || e}`);
}

const isTV = typeof tizen !== 'undefined';

const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

const app = proxy.create(platformVersion);

// Cobalt refuses to load a single resource from a document that arrived without a
// Content-Security-Policy header — a release build treats its absence as "deny everything", which
// on screen is a black rectangle and a network error rather than anything naming CSP. The page is
// ours and already same-origin, so the policy only has to exist.
const POLICIES = {
    // What a 25.lts container wants, and what has been serving the television all along.
    wide: [
        "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
        "img-src * data: blob:",
        "media-src * data: blob:",
        "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
        "style-src * data: blob: 'unsafe-inline'",
        "connect-src *",
        "font-src * data:"
    ].join('; '),

    // The same permission expressed without data: or blob:, in case an older parser chokes on a
    // scheme source in default-src and denies the lot.
    plain: "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'",

    // Nothing of ours: whatever YouTube sent is left in place.
    none: null
};

let policy = 'wide';

// Cobalt refuses to load a single resource from a document that arrived without a
// Content-Security-Policy header — a release build treats its absence as "deny everything", which
// on screen is a black rectangle and a network error rather than anything naming CSP. But which
// policies it will *accept* differs by version, and a policy it will not parse denies everything
// just as thoroughly. A set that fetches the page over and over without ever running it is the
// symptom. Switchable at runtime so that can be settled in a minute rather than a build per guess:
//   /__tube/dev/csp?policy=wide|plain|none
app.use((_, res, next) => {
    const chosen = POLICIES[policy];

    if (chosen) res.setHeader('Content-Security-Policy', chosen);
    else res.removeHeader('Content-Security-Policy');

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
        // When this package is configured for Cobalt, the boot screen hands over by launching the
        // container rather than by navigating itself. It is named here because the service is what
        // reads the package metadata, and because the boot screen must not launch it until the
        // service is answering — the container dials immediately and does not recover.
        container: cobalt ? cobalt.container() : null,
        proxyUrl: `http://localhost:${ports.PROXY}/tv` + (isTV
            ? `?additionalDataUrl=${encodeURIComponent(`http://localhost:${ports.DIAL}/dial/apps/YouTube`)}`
            : '')
    };
}

app.get('/__tube/state', (_, res) => {
    maybeCheckForUpdate();
    res.json(describeState());
});

// The postmortem log, over the network. Not every television has a Homebrew build with a
// filesystem channel on it, and inside the container there is no console and no dev bridge — so on
// those sets this is the only way to find out what the service did. It carries what the service
// wrote about itself and nothing else.
app.get('/__tube/log', (_, res) => {
    res.type('text/plain').send(postmortem.read() || '(nothing logged)');
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
app.get('/__tube/dev/csp', (req, res) => {
    const asked = String((req.query && req.query.policy) || '');
    if (Object.prototype.hasOwnProperty.call(POLICIES, asked)) policy = asked;

    res.json({ policy, sends: POLICIES[policy] });
});

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

// Every address this set could serve on, most general first. The fallbacks matter because binding
// every interface collides with a server already on loopback — an older build of this app is the
// usual cause — while binding the LAN address directly does not, so the two can coexist.
function candidates() {
    const found = [BIND];
    const interfaces = os.networkInterfaces();

    Object.keys(interfaces).forEach((device) => {
        interfaces[device].forEach((address) => {
            if (!address.internal && address.family === 'IPv4') found.push(address.address);
        });
    });

    return found;
}

// A failed listen used to kill the service outright: nothing handled the error, so it surfaced as
// an uncaught exception, the process exited, auto-restart brought it back and it failed again.
// From outside that is indistinguishable from the service never having been started at all — no
// port, no log, nothing to read. Say what happened, then keep trying.
function listen(addresses, index) {
    const address = addresses[index];

    const server = app.listen(ports.PROXY, address, () => {
        postmortem.note('listening', `${address}:${ports.PROXY}, ${loader.variantFor(platformVersion)} bundle`);
        console.log(`tube service on ${address}:${ports.PROXY} (${loader.variantFor(platformVersion)} bundle)`);
        if (!isTV) {
            console.log('Running off-TV: proxy and userscript are live; DIAL is disabled.');
        }

        announceReady();
    });

    // Cobalt's --proxy sends TLS through CONNECT; without an answer to that the container has no
    // network at all. The bytes are passed through untouched — this is a route, not a reader.
    forward.tunnel(server);

    server.on('error', (error) => {
        const why = error.code === 'EADDRINUSE'
            ? 'something already holds that port — an older build of this app is the usual cause'
            : error.message;

        postmortem.note('listen', `${error.code || 'Error'} on ${address}:${ports.PROXY} — ${why}`);

        const next = index + 1;
        if (next < addresses.length) return listen(addresses, next);

        // Nothing worked. Wait for whatever holds it to go away rather than exiting, which would
        // only be restarted into the same failure.
        setTimeout(() => listen(candidates(), 0), 5000);
    });
}

listen(candidates(), 0);

// Tizen's own service runner calls these on our exports — `app.onRequest()` on every wake message,
// at /usr/share/wrt/app/service/service_runner.js:152. Exporting nothing makes that a TypeError,
// which lands in the uncaught handler and kills the service on any set whose runner sends one.
// There is nothing for them to do: this file has already done its work by the time they are called.
module.exports = {
    onStart: () => {},

    // The platform wakes the service when the app is launched, which is the only notice anything of
    // ours gets that a viewer opened it — the container is started instead of our content, so no
    // page of ours runs. That makes this the place to notice a container that did not survive its
    // own launch and to reissue the one that works.
    onRequest: () => { if (cobalt) { try { cobalt.wake(); } catch (e) { /* never worth dying for */ } } },

    onStop: () => {}
};

// The container route needs a writable copy of Cobalt's content directory and a certificate
// authority inside it. Both are made here on the television rather than built into the package,
// which is what lets one widget serve any set — and, for the authority, is the only arrangement
// that is safe to publish at all. It is skipped entirely unless this package names a --content
// path, so an ordinary build does none of it.
// Same reasoning: staging a directory and issuing a certificate must not be able to stop the
// proxy answering. Anything that goes wrong in there is written down and the service carries on.
if (cobalt) {
    try {
        cobalt.prepare();
    } catch (e) {
        postmortem.note('cobalt', `prepare threw: ${(e && e.stack) || e}`);
    }
}


if (isTV) dial.start();

setTimeout(maybeCheckForUpdate, 5000);
