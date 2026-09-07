'use strict';

const os = require('os');

const postmortem = require('./lib/postmortem.js');
postmortem.watch();

const ports = require('./lib/ports.js');
const loader = require('./lib/loader.js');
const proxy = require('./lib/proxy.js');
const devbridge = require('./lib/devbridge.js');
const forward = require('./lib/forward.js');

// Guarded, and the guard is the point. Everything the container route needs is a convenience laid
// on a proxy that has to start regardless.
function cobaltIfItLoads() {
    try {
        return require('./lib/cobalt.js');
    } catch (e) {
        postmortem.note('cobalt', `module would not load: ${postmortem.describe(e)}`);
        return null;
    }
}

const cobalt = cobaltIfItLoads();

const isTV = typeof tizen !== 'undefined';

// Which container slot this build claims. The platform launches Cobalt and never runs our own
// content, so nothing of ours has a page: this is the whole of the app, and the value is here to
// be reported rather than acted on.
const containerRoute = cobalt ? cobalt.container() : null;

const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

const app = proxy.create();

// Cobalt denies a document that arrives without a Content-Security-Policy, and which policies it
// accepts varies by version.
const POLICIES = {
    wide: [
        "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
        'img-src * data: blob:',
        'media-src * data: blob:',
        "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
        "style-src * data: blob: 'unsafe-inline'",
        'connect-src *',
        'font-src * data:'
    ].join('; '),

    plain: "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'",

    none: null
};

const UPDATE_CHECK_INTERVAL = 15 * 60 * 1000;

const state = { policy: 'wide', lastUpdateCheck: 0, updateInFlight: false };

app.use((_, res, next) => {
    const chosen = POLICIES[state.policy];

    if (chosen) res.setHeader('Content-Security-Policy', chosen);
    else res.removeHeader('Content-Security-Policy');

    next();
});

// Checking for an update must never be able to fail the route that triggers it.
const maybeCheckForUpdate = () => {
    const now = Date.now();
    if (state.updateInFlight || now - state.lastUpdateCheck < UPDATE_CHECK_INTERVAL) return;

    state.lastUpdateCheck = now;
    state.updateInFlight = true;

    const settle = () => { state.updateInFlight = false; };

    try {
        loader.checkForUpdate().then(settle, (error) => {
            postmortem.note('update', error);
            settle();
        });
    } catch (error) {
        postmortem.note('update', error);
        settle();
    }
};

const describeState = () => {
    const theScriptThisSetWouldRun = () => {
        try {
            const resolved = loader.resolve();
            return { version: resolved.version, origin: resolved.origin };
        } catch (e) {
            return { error: e.message };
        }
    };

    return {
        script: theScriptThisSetWouldRun(),
        platformVersion,
        container: containerRoute
    };
};

app.get('/__tube/state', (_, res) => {
    maybeCheckForUpdate();
    res.json(describeState());
});

// The postmortem log over the network. Inside the container there is no console and no dev bridge,
// so on those sets this is the only way to find out what the service did.
app.get('/__tube/log', (_, res) => {
    res.type('text/plain').send(postmortem.read() || '(nothing logged)');
});

app.get('/__tube/dev/csp', (req, res) => {
    const asked = String((req.query && req.query.policy) || '');
    if (Object.prototype.hasOwnProperty.call(POLICIES, asked)) state.policy = asked;

    res.json({ policy: state.policy, sends: POLICIES[state.policy] });
});

// Which experiment flags the page is served with, changeable while the set is running:
//   ?html5_onesie=false   set one (repeatable), then reload    ?clear=1   back to what YouTube sent
if (process.env.TUBE_DEV_INJECT) app.get('/__tube/dev/flags', (req, res) => {
    if (req.query.clear) proxy.flagOverrides.clear();

    Object.keys(req.query).forEach((name) => {
        if (name === 'clear' || !/^[a-z0-9_]{3,64}$/.test(name)) return;

        const value = String(req.query[name]).slice(0, 32);
        if (/^[A-Za-z0-9_.-]*$/.test(value)) proxy.flagOverrides.set(name, value);
    });

    res.json({ flags: Object.fromEntries(proxy.flagOverrides) });
});

// /__tube/dev/upstream?origin=pass|drop|<url>&abr=service&onesie=fail&patches=off
if (process.env.TUBE_DEV_INJECT) app.get('/__tube/dev/upstream', (req, res) => {
    if (req.query.origin) proxy.upstream.origin = String(req.query.origin).slice(0, 128);
    if (req.query.abr) proxy.upstream.abrThroughService = req.query.abr === 'service';
    if (req.query.patches) proxy.upstream.nativeProxyPatches = req.query.patches !== 'off';

    if (req.query.onesie) {
        const asked = String(req.query.onesie);
        proxy.upstream.onesie = asked === 'fail' ? asked : 'auto';
    }

    res.json({
        origin: proxy.upstream.origin,
        abr: proxy.upstream.abrThroughService ? 'service' : 'direct',
        onesie: proxy.upstream.onesie,
        patches: proxy.upstream.nativeProxyPatches ? 'on' : 'off'
    });
});

devbridge.attach(app);
proxy.attachFallback(app);

// Every interface, because the container is another package and cannot reach our 127.0.0.1.
const BIND = '0.0.0.0';
const RETRY_LISTEN_AFTER = 5000;

// Fallbacks, because a LAN address still binds while another server holds the port on loopback.
const candidates = () => {
    const interfaces = os.networkInterfaces();

    return Object.keys(interfaces).reduce((found, device) => found.concat(
        interfaces[device].filter((a) => !a.internal && a.family === 'IPv4').map((a) => a.address)
    ), [BIND]);
};

const listen = (addresses, index) => {
    const address = addresses[index];
    const serving = { yes: false };

    const server = app.listen(ports.PROXY, address, () => {
        serving.yes = true;

        postmortem.note('listening', `${address}:${ports.PROXY}`);
        console.log(`tube service on ${address}:${ports.PROXY}`);
        if (!isTV) console.log('Running off-TV: proxy and userscript are live.');
    });

    // Cobalt's --proxy sends TLS through CONNECT; without an answer to that the container has no
    // network at all.
    forward.tunnel(server);

    // Handled rather than fatal, and never advanced once the port is ours: a later error would
    // otherwise start a second server beside the one already answering.
    server.on('error', (error) => {
        const why = error.code === 'EADDRINUSE'
            ? 'something already holds that port — an older build of this app is the usual cause'
            : postmortem.describe(error);

        postmortem.note('listen', `${address}:${ports.PROXY} — ${why}`);
        if (serving.yes) return undefined;

        const next = index + 1;
        if (next < addresses.length) return listen(addresses, next);

        // Wait for whatever holds it to go away rather than exiting, which would only be restarted
        // into the same failure.
        return setTimeout(() => listen(candidates(), 0), RETRY_LISTEN_AFTER);
    });
};

listen(candidates(), 0);

// Tizen's service runner calls these on every wake message, and a missing one kills the service.
module.exports = {
    onStart: () => {},

    // The platform wakes the service when the app is launched, which is the only notice anything
    // of ours gets that a viewer opened it: the container is started instead of our content, so no
    // page of ours runs.
    onRequest: () => {
        if (!cobalt) return;
        try { cobalt.wake(); } catch (e) { postmortem.note('cobalt', e); }
    },

    onStop: () => {}
};

// Staging a directory and issuing a certificate must not be able to stop the proxy answering.
if (cobalt) {
    try {
        cobalt.prepare();
    } catch (e) {
        postmortem.note('cobalt', `prepare threw: ${postmortem.describe(e)}`);
    }
}

setTimeout(maybeCheckForUpdate, 5000);
