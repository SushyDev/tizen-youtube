'use strict';

const postmortem = require('./lib/postmortem.js');
postmortem.watch();

const ports = require('./lib/ports.js');
const loader = require('./lib/loader.js');
const proxy = require('./lib/proxy.js');
const devbridge = require('./lib/devbridge.js');

const isTV = typeof tizen !== 'undefined';

const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

const app = proxy.create();

const UPDATE_CHECK_INTERVAL = 15 * 60 * 1000;

let lastUpdateCheck = 0;
let updateInFlight = false;

function maybeCheckForUpdate() {
    const now = Date.now();
    if (updateInFlight || now - lastUpdateCheck < UPDATE_CHECK_INTERVAL) return;

    lastUpdateCheck = now;
    updateInFlight = true;
    loader.checkForUpdate().then(
        () => { updateInFlight = false; },
        () => { updateInFlight = false; }
    );
}

function describeScript() {
    try {
        const { version, origin } = loader.resolve();
        return { version, origin };
    } catch (e) {
        return { error: e.message };
    }
}

function describeState() {
    return {
        platformVersion,
        script: describeScript(),
        proxyUrl: `http://localhost:${ports.PROXY}/tv`
    };
}

app.get('/__tube/state', (_, res) => {
    maybeCheckForUpdate();
    res.json(describeState());
});

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

const BIND = process.env.TUBE_PROXY_HOST ? '0.0.0.0' : '127.0.0.1';

app.listen(ports.PROXY, BIND, () => {
    console.log(`tube service on 127.0.0.1:${ports.PROXY}`);
    if (!isTV) {
        console.log('Running off-TV: proxy and userscript are live.');
    }

    announceReady();
});

setTimeout(maybeCheckForUpdate, 5000);
