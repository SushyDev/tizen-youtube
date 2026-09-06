'use strict';

// First, before anything else is loaded: a dependency in this bundle declares a class extending
// `Event` at load time, and on the older Node some of these sets ship that is a ReferenceError
// during require — the service dies before it can even open its log.
require('./lib/globals.js');

const os = require('os');

const postmortem = require('./lib/postmortem.js');
postmortem.watch();

const ports = require('./lib/ports.js');

// A server that serves nothing but the log, bound before anything that could fail is even loaded,
// and handed over to the real service the moment that one is ready to bind.
//
// If start-up dies — an older runtime rejecting something one of these modules does at load time,
// which is exactly what a Tizen 6.5 set does with code that a 9.0 set runs happily — then this is
// what is left listening, and `/__tube/log` still answers with the stack that killed it. Without
// it a failed start is completely silent from outside: no port, no log, nothing to read, and
// indistinguishable from a service the platform never launched at all.
// Only the log. Answering anything else would have the boot screen mistake this for the service
// proper and wait for a state that is never coming, instead of reporting it unreachable.
const rescue = require('http').createServer((req, res) => {
    // Never keep-alive. A held connection would stop this server releasing the port to the real
    // one, and the boot screen polls it every few hundred milliseconds.
    if (String(req.url).indexOf('/__tube/log') !== 0) {
        res.writeHead(503, { 'content-type': 'text/plain', connection: 'close' });
        return res.end('the service did not finish starting; GET /__tube/log for why');
    }

    res.writeHead(200, { 'content-type': 'text/plain', connection: 'close' });
    res.end(postmortem.read() || '(nothing logged)');
});

rescue.on('error', () => {});
rescue.listen(ports.PROXY, '0.0.0.0');
const loader = require('./lib/loader.js');
const proxy = require('./lib/proxy.js');
const devbridge = require('./lib/devbridge.js');
const dial = require('./lib/dial.js');
const forward = require('./lib/forward.js');

// Guarded, and the guard is the point. Everything the container route needs is a convenience laid
// on top of a proxy that has to start regardless: if this module cannot even be loaded on some set
// — an older runtime missing something it uses at load time, say — that must cost the container
// route, not the whole service. Without this an exception here reaches postmortem's uncaught
// handler, the process exits, and from outside it is indistinguishable from a service that was
// never started at all. Which is exactly the state one television was left in.
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

// Everything loaded without dying, so the rescue server gives the port back. Deliberately not
// waiting on close()'s callback: it fires only once every connection has drained, and the boot
// screen is polling this very port — so the callback can simply never come, and then the real
// server is never started at all. That is a deadlock, and it is silent, because nothing throws and
// nothing exits. Ask for the close, then bind; if the socket has not been released yet, listen()
// sees EADDRINUSE, says so, and retries.
rescue.close();
listen(candidates(), 0);

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
