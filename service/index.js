'use strict';

const os = require('os');

const postmortem = require('./lib/postmortem.js');
const lastRun = require('./lib/lastRun.js');
const printed = require('./lib/printed.js');

lastRun.recall();
postmortem.watch();
printed.attach();

const ports = require('./lib/ports.js');
const { USER_SCRIPT, sized } = require('./lib/shipped.js');
const proxy = require('./lib/proxy.js');
const { STAMP } = require('./lib/stamp.js');
const { capability } = require('./lib/platform.js');
const claimants = require('./lib/claimants.js');
const bootRoutes = require('./lib/bootRoutes.js');
const journalRoutes = require('./lib/journalRoutes.js');
const diagRoutes = require('./lib/diagRoutes.js');
const routeErrors = require('./lib/routeErrors.js');
const dev = require('./dev/index.js');
const forward = require('./lib/forward.js');
const upgrade = require('./lib/upgrade.js');
const knobs = require('./lib/knobs.js');

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

const containerRoute = cobalt ? cobalt.container() : null;

const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

postmortem.note('platform', `tizen ${platformVersion || 'none'}, node ${process.version}, `
    + `${capability('http://tizen.org/system/model_name') || 'unknown model'}, patch ${STAMP}`);

claimants.survey();

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

const state = { policy: 'wide' };

app.use((_, res, next) => {
    const chosen = POLICIES[state.policy];

    if (chosen) res.setHeader('Content-Security-Policy', chosen);
    else res.removeHeader('Content-Security-Policy');

    next();
});

const userScript = () => sized(USER_SCRIPT);

app.get('/__tube/state', (_, res) => res.json({ script: userScript(), platformVersion, container: containerRoute }));

// The served page's boot line, so each load's requests are traced afresh.
const retraceOnBoot = (line) => {
    if (line.indexOf('booted ') === 0) proxy.retrace();
};

journalRoutes.attach(app, { heard: retraceOnBoot });
bootRoutes.attach(app, { cobalt, script: userScript });
diagRoutes.attach(app);

// `relaunch` is passed in rather than reached for, because dev/ may not know about the container
// route — and on a set without one it is simply absent.
dev.routes(app, {
    policies: POLICIES,
    state,
    knobs,
    relaunch: cobalt ? cobalt.relaunch : null
});

dev.attach(app);
proxy.attachFallback(app);
routeErrors.attach(app);

// Every interface, because the container is another package and cannot reach our 127.0.0.1.
const BIND = '0.0.0.0';
const RETRY_LISTEN_AFTER = 5000;
const REPEAT_AFTER = 60000;

const repeated = { text: '', at: 0 };

// The same refusal every five seconds fills a 64KB log with itself and pushes out what explains it.
const noteRarely = (what, text) => {
    const now = Date.now();
    if (text === repeated.text && now - repeated.at < REPEAT_AFTER) return;

    repeated.text = text;
    repeated.at = now;
    postmortem.note(what, text);
};

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
        if (cobalt) cobalt.listened();
        console.log(`tube service on ${address}:${ports.PROXY}`);
        if (!isTV) console.log('Running off-TV: proxy and userscript are live.');
    });

    // Cobalt's --proxy sends TLS through CONNECT; without an answer to that the container has no
    // network at all.
    forward.tunnel(server);

    // And an upgrade is not a request express ever sees, so without this every WebSocket the page
    // opens is accepted and then never answered — a hang rather than a failure.
    upgrade.attach(server, { rewrite: dev.upgradeRewrite });

    // Handled rather than fatal, and never advanced once the port is ours: a later error would
    // otherwise start a second server beside the one already answering.
    server.on('error', (error) => {
        // Both widgets carry a service and install side by side, so the other one holding the port
        // is as likely as an older build of this one.
        const why = error.code === 'EADDRINUSE'
            ? 'something already holds that port — the other Tube widget, or an older build of this '
                + 'one, is the usual cause; only one of the two can serve the container'
            : postmortem.describe(error);

        noteRarely('listen', `${address}:${ports.PROXY} — ${why}`);
        if (serving.yes) return undefined;

        const next = index + 1;
        if (next < addresses.length) return listen(addresses, next);

        // Wait for whatever holds it to go away rather than exiting, which would only be restarted
        // into the same failure.
        return setTimeout(() => listen(candidates(), 0), RETRY_LISTEN_AFTER);
    });
};

const holdFor = dev.startDelay();
if (holdFor) postmortem.note('listen', `held shut for ${holdFor / 1000}s by TUBE_START_DELAY`);

setTimeout(() => listen(candidates(), 0), holdFor);

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
