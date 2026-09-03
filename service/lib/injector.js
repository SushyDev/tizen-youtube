'use strict';

const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');

const ports = require('./ports.js');
const loader = require('./loader.js');

const platformVersion = (function () {
    try {
        return tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version');
    } catch (e) {
        return null;
    }
})();

const isTizen3 = String(platformVersion || '').indexOf('3.0') === 0;

// Only while an attempt is genuinely still running. A plain boolean had no way back if
// one died between setting and clearing it, leaving every later launch waiting forever.
const CONNECT_TIMEOUT = 30000;

// An attached client holds V8's inspector open for the whole session, so it is dropped
// once the script is in. Page.setBypassCSP reverts with the connection.
const KEEP_DEBUGGER = process.env.TUBE_KEEP_DEBUGGER === '1';

const DETACH_DELAY = 3000;

// sdbd refuses most connection attempts, so one refusal is retried rather than taken as
// an answer — otherwise the app spends the whole session on the proxy fallback.
const SDB_DEADLINE = 20000;
const SDB_RETRY_DELAY = 400;
const SDB_ATTEMPT_TIMEOUT = 8000;

let connecting = false;
let connectingSince = 0;

function beginConnecting() {
    connecting = true;
    connectingSince = Date.now();
}

function stopConnecting() {
    connecting = false;
    connectingSince = 0;
}

function isConnecting() {
    if (!connecting) return false;
    if (Date.now() - connectingSince < CONNECT_TIMEOUT) return true;

    stopConnecting();
    return false;
}

function canConnectToDaemon() {
    return fetch(`http://127.0.0.1:${ports.DMP}/api/v2/`)
        .then((res) => res.json())
        .then((json) => ({
            canConnectToDaemon:
                (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') &&
                json.device.developerMode === '1',
            ip: json.device.ip,
            platformVersion,
            isConnecting: isConnecting()
        }))
        .catch(() => ({ canConnectToDaemon: false, ip: null, platformVersion, isConnecting: isConnecting() }));
}

// The DIAL server carries the payload from a phone's cast button. The wrong port here is
// what silently broke casting in the reference.
function watchUrl(args) {
    const additional = encodeURIComponent(`http://localhost:${ports.DIAL}/dial/apps/YouTube`);
    return `https://www.youtube.com/tv?additionalDataUrl=${additional}${args ? `&${args}` : ''}`;
}

function attach(host, port, args, attempt) {
    const attempts = attempt || 1;

    return fetch(`http://${host}:${port}`)
        .then(() => new Promise((resolve, reject) => {
            CDP({ host, port, local: true }, (client) => {
                stopConnecting();

                let script;
                try {
                    script = loader.resolve(platformVersion);
                    console.log(`Injecting ${script.variant} userscript (${script.origin}, ${script.version}).`);
                } catch (e) {
                    console.error(`No userscript available: ${e.message}`);
                    return reject(e);
                }

                client.Runtime.enable();
                client.Page.enable();

                // Enabling Runtime reports the contexts that already exist, so this runs for the shell we
                // are replacing as well as for the page we navigate to.
                let injections = 0;
                let detaching = null;

                const detach = () => {
                    // Only once the script is actually in: a load event with nothing injected means the
                    // connection still has work to do.
                    if (KEEP_DEBUGGER || detaching || !injections) return;

                    detaching = setTimeout(() => {
                        try {
                            client.close();
                            console.log('Userscript injected; debugger detached.');
                        } catch (e) {
                            console.error(`Could not detach the debugger: ${e.message}`);
                        }
                    }, DETACH_DELAY);
                };

                client.on('Runtime.executionContextCreated', (msg) => {
                    client.Runtime.evaluate({ expression: script.source, contextId: msg.context.id })
                        .then(() => { injections += 1; })
                        .catch((e) => console.error(`Injection failed: ${e.message}`));
                });

                client.on('Page.loadEventFired', detach);

                // Without this, youtube.com's CSP blocks the injected script.
                client.Page.setBypassCSP({ enabled: true });
                client.Page.navigate({ url: watchUrl(args) });

                resolve(client);
            }).on('error', reject);
        }))
        .catch((err) => {
            if (attempts >= 40) {
                stopConnecting();
                throw new Error(`Could not attach to the debugger on ${host}:${port}: ${err.message}`);
            }
            return new Promise((resolve) => setTimeout(resolve, 100))
                .then(() => attach(host, port, args, attempts + 1));
        });
}

function requestDebugPort() {
    return new Promise((resolve, reject) => {
        const client = adbhost.createConnection({ host: '127.0.0.1', port: ports.SDB });
        let settled = false;

        const finish = (error, port) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error); else resolve(port);
        };

        const timer = setTimeout(
            () => finish(new Error('SDB did not report a debug port in time.')),
            SDB_ATTEMPT_TIMEOUT
        );

        client._stream.on('error', (e) => finish(new Error(`SDB connection failed: ${e.message}`)));

        // A refusal is a close with nothing said, and waiting the full timeout for it would spend
        // the retry budget on one attempt.
        client._stream.on('close', () => finish(new Error('SDB closed the connection before reporting a port.')));

        client._stream.on('connect', () => {
            const appId = `${tizen.application.getAppInfo().packageId}.Tube`;
            const shell = client.createStream(`shell:0 debug ${appId}${isTizen3 ? ' 0' : ''}`);

            shell.on('data', (data) => {
                const text = data.toString();
                if (text.indexOf('debug') === -1) return;

                finish(null, Number(text.substr(text.indexOf(':') + 1, 6).replace(' ', '')));

                setTimeout(() => {
                    try { client._stream.end(); } catch (e) { }
                }, 1000);
            });
        });
    });
}

function requestDebugPortUntil(deadline) {
    return requestDebugPort().catch((error) => {
        if (Date.now() >= deadline) throw error;
        return new Promise((resolve) => setTimeout(resolve, SDB_RETRY_DELAY))
            .then(() => requestDebugPortUntil(deadline));
    });
}

function startDebugger(args) {
    return canConnectToDaemon().then((state) => {
        if (!state.canConnectToDaemon) return false;

        beginConnecting();

        return requestDebugPortUntil(Date.now() + SDB_DEADLINE)
            .then((port) => attach(state.ip, port, args).then(() => true))
            .catch((error) => {
                stopConnecting();
                throw error;
            });
    });
}

module.exports = { startDebugger, canConnectToDaemon, watchUrl, stopConnecting };
