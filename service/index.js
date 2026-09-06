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

// With the container metadata in place the platform launches Cobalt and never runs our own
// content, so the boot screen is unreachable and nothing speaks to the routes below that only it
// used. A package built with TUBE_COBALT_CONTAINER=off carries no such metadata and still boots
// through the screen.
const containerRoute = cobalt ? cobalt.container() : null;
const servesBootScreen = !containerRoute;

const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

const app = proxy.create(platformVersion);

// Cobalt treats a document that arrived without a Content-Security-Policy as "deny everything",
// which on screen is a black rectangle and a network error naming nothing. But which policies it
// will parse differs by version, and one it refuses denies just as thoroughly — a set that
// fetches the page over and over without running it is the symptom. Switchable at runtime so that
// can be settled in a minute: /__tube/dev/csp?policy=wide|plain|none
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

    // The same permission without data: or blob:, in case an older parser chokes on a scheme
    // source in default-src and denies the lot.
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

// Checking for an update must never be able to fail the route that triggers it. A throw before
// the promise exists used to leave `updateInFlight` set for the life of the process — one bad
// call and no set ever checked again, while /__tube/state answered 500 to whatever asked.
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
        // Which container slot this build claims, if any. Reported for diagnosis: it is what
        // decides whether our own content ever runs.
        container: containerRoute,
        proxyUrl: `http://localhost:${ports.PROXY}/tv`
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

if (servesBootScreen) {
    app.get('/__tube/booted', (req, res) => {
        postmortem.note('boot', String((req.query && req.query.t) || '').replace(/[\r\n]+/g, ' ').slice(0, 300));
        res.json({ ok: true });
    });

    app.get('/__tube/quit', (_, res) => {
        postmortem.note('quit', 'asked to stop by the boot screen');
        res.json({ ok: true });

        setTimeout(() => process.exit(0), 100);
    });
}

app.get('/__tube/dev/csp', (req, res) => {
    const asked = String((req.query && req.query.policy) || '');
    if (Object.prototype.hasOwnProperty.call(POLICIES, asked)) state.policy = asked;

    res.json({ policy: state.policy, sends: POLICIES[state.policy] });
});

// Which experiment flags the page is served with, changeable while the set is running:
//   ?html5_onesie=false   set one (repeatable), then reload    ?clear=1   back to what YouTube sent
app.get('/__tube/dev/flags', (req, res) => {
    if (req.query.clear) proxy.flagOverrides.clear();

    Object.keys(req.query).forEach((name) => {
        if (name === 'clear' || !/^[a-z0-9_]{3,64}$/.test(name)) return;
        proxy.flagOverrides.set(name, String(req.query[name]).slice(0, 32));
    });

    res.json({ flags: Object.fromEntries(proxy.flagOverrides) });
});

// /__tube/dev/upstream?origin=pass|drop|<url>&abr=service&onesie=off|fail&patches=off
app.get('/__tube/dev/upstream', (req, res) => {
    if (req.query.origin) proxy.upstream.origin = String(req.query.origin).slice(0, 128);
    if (req.query.abr) proxy.upstream.abrThroughService = req.query.abr === 'service';
    if (req.query.patches) proxy.upstream.nativeProxyPatches = req.query.patches !== 'off';

    if (req.query.onesie) {
        const asked = String(req.query.onesie);
        proxy.upstream.onesie = ['off', 'fail'].indexOf(asked) === -1 ? 'auto' : asked;
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

// Must match the port names in ui/src/boot.js.
const READY_PORT = 'TUBE_BOOT';
const READY_PORT_OPEN = 'TUBE_BOOT_OPEN';

const announceReady = () => {
    if (!isTV || !servesBootScreen) return;

    try {
        const uiAppId = `${tizen.application.getAppInfo().packageId}.Tube`;
        const payload = [{ key: 'state', value: JSON.stringify(describeState()) }];

        const send = (label, open) => {
            try {
                open(uiAppId).sendMessage(payload);
                return `${label} sent`;
            } catch (e) {
                return `${label} ${postmortem.describe(e)}`;
            }
        };

        postmortem.note('announce', [
            send('trusted', (id) => tizen.messageport.requestTrustedRemoteMessagePort(id, READY_PORT)),
            send('open', (id) => tizen.messageport.requestRemoteMessagePort(id, READY_PORT_OPEN))
        ].join(', '));
    } catch (e) {
        postmortem.note('announce', e);
    }
};

// Loopback is not enough and is not worth trying again. Cobalt runs in its own package, and this
// set controls app-to-app traffic on 127.0.0.1 by SMACK label: from another package 127.0.0.1 and
// 0.0.0.0 answer EHOSTUNREACH, ::1 and localhost answer EACCES, and only the LAN address connects.
const BIND = '0.0.0.0';
const RETRY_LISTEN_AFTER = 5000;

// Most general first. The fallbacks matter because binding every interface collides with a server
// already on loopback — an older build of this app is the usual cause — while binding the LAN
// address directly does not, so the two can coexist.
const candidates = () => {
    const interfaces = os.networkInterfaces();

    return Object.keys(interfaces).reduce((found, device) => found.concat(
        interfaces[device].filter((a) => !a.internal && a.family === 'IPv4').map((a) => a.address)
    ), [BIND]);
};

// A failed listen used to kill the service outright: nothing handled the error, the process
// exited, auto-restart brought it back and it failed again. From outside that is indistinguishable
// from a service the platform never launched.
const listen = (addresses, index) => {
    const address = addresses[index];
    const serving = { yes: false };

    const server = app.listen(ports.PROXY, address, () => {
        serving.yes = true;

        postmortem.note('listening', `${address}:${ports.PROXY}`);
        console.log(`tube service on ${address}:${ports.PROXY}`);
        if (!isTV) console.log('Running off-TV: proxy and userscript are live.');

        announceReady();
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

// Tizen's own service runner calls these on our exports — service_runner.js:152 calls
// `app.onRequest()` on every wake message. Exporting nothing makes that a TypeError, which lands
// in the uncaught handler and kills the service on any set whose runner sends one.
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
