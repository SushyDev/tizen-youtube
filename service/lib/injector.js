'use strict';

// CDP injection: the preferred path when Developer Mode is on. `shell:0 debug <appId>`
// over SDB relaunches this app with the DevTools Protocol enabled and prints its port.
// Attaching lets the userscript be evaluated into youtube.com with CSP bypassed.

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

// A launch that is mid-injection blocks others from starting a second one, but only
// while it is genuinely still trying. A plain boolean had no way back if an attempt
// died between setting and clearing it, leaving every later launch waiting forever.
const CONNECT_TIMEOUT = 30000;

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

    // Whatever was connecting is not connecting any more.
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

// The DIAL server carries the payload from a phone's cast button. The wrong port here
// is what silently broke casting in the reference.
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
                    // Nothing to inject is a packaging failure, not a network one.
                    console.error(`No userscript available: ${e.message}`);
                    return reject(e);
                }

                client.Runtime.enable();
                client.Page.enable();

                // Every new execution context: covers the initial load and any
                // same-page navigation YouTube performs.
                client.on('Runtime.executionContextCreated', (msg) => {
                    client.Runtime.evaluate({ expression: script.source, contextId: msg.context.id })
                        .catch((e) => console.error(`Injection failed: ${e.message}`));
                });

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

// Relaunches this app under the debugger and attaches to it.
function startDebugger(args) {
    return canConnectToDaemon().then((state) => {
        if (!state.canConnectToDaemon) return false;

        return new Promise((resolve, reject) => {
            const client = adbhost.createConnection({ host: '127.0.0.1', port: ports.SDB });
            let settled = false;

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                stopConnecting();
                reject(new Error('SDB did not report a debug port in time.'));
            }, 15000);

            client._stream.on('error', (e) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                stopConnecting();
                reject(new Error(`SDB connection failed: ${e.message}`));
            });

            client._stream.on('connect', () => {
                beginConnecting();
                const appId = `${tizen.application.getAppInfo().packageId}.Tube`;
                const shell = client.createStream(`shell:0 debug ${appId}${isTizen3 ? ' 0' : ''}`);

                shell.on('data', (data) => {
                    const text = data.toString();
                    if (text.indexOf('debug') === -1 || settled) return;
                    settled = true;
                    clearTimeout(timer);

                    const port = Number(text.substr(text.indexOf(':') + 1, 6).replace(' ', ''));
                    attach(state.ip, port, args).then(
                        () => resolve(true),
                        (err) => { stopConnecting(); reject(err); }
                    );

                    setTimeout(() => {
                        try { client._stream.end(); } catch (e) { /* already closed */ }
                    }, 1000);
                });
            });
        });
    });
}

module.exports = { startDebugger, canConnectToDaemon, watchUrl, stopConnecting };
