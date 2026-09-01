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

// The boot screen polls /__tube/state every 200ms until it gets an answer, and every
// one of those used to be a fresh HTTP round-trip to the Smart View API. Developer Mode
// does not change during a launch, so the probe is cached for long enough to collapse a
// burst of polls into one call — and briefly enough that turning Developer Mode on and
// relaunching still works without waiting.
const PROBE_CACHE_MS = 2000;

let probeCache = null;
let probedAt = 0;

function probeDaemon() {
    if (probeCache && Date.now() - probedAt < PROBE_CACHE_MS) {
        return Promise.resolve(probeCache);
    }

    return fetch(`http://127.0.0.1:${ports.DMP}/api/v2/`)
        .then((res) => res.json())
        .then((json) => ({
            canConnectToDaemon:
                (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') &&
                json.device.developerMode === '1',
            ip: json.device.ip
        }))
        .catch(() => ({ canConnectToDaemon: false, ip: null }))
        .then((result) => {
            probeCache = result;
            probedAt = Date.now();
            return result;
        });
}

function canConnectToDaemon() {
    // `isConnecting` is read live: it is the one field that changes within a launch.
    return probeDaemon().then((probe) => ({
        canConnectToDaemon: probe.canConnectToDaemon,
        ip: probe.ip,
        platformVersion,
        isConnecting: isConnecting()
    }));
}

// The DIAL server carries the payload from a phone's cast button. The wrong port here
// is what silently broke casting in the reference.
function watchUrl(args) {
    const additional = encodeURIComponent(`http://localhost:${ports.DIAL}/dial/apps/YouTube`);
    return `https://www.youtube.com/tv?additionalDataUrl=${additional}${args ? `&${args}` : ''}`;
}

// Chrome grew `addScriptToEvaluateOnNewDocument` around M59. Tizen 3 is Chrome 47 and
// has only the older `addScriptToEvaluateOnLoad`, which does the same thing under a name
// that predates the rename. The last resort is the way this used to work, which costs the
// Runtime domain — better than not injecting at all on a webview that has neither.
function registerScript(client, source) {
    return client.Page.addScriptToEvaluateOnNewDocument({ source })
        .then(() => 'addScriptToEvaluateOnNewDocument')
        .catch(() => client.Page.addScriptToEvaluateOnLoad({ scriptSource: source })
            .then(() => 'addScriptToEvaluateOnLoad')
            .catch(() => {
                client.Runtime.enable();
                client.on('Runtime.executionContextCreated', (msg) => {
                    client.Runtime.evaluate({ expression: source, contextId: msg.context.id })
                        .catch((e) => console.error(`Injection failed: ${e.message}`));
                });
                return 'Runtime.executionContextCreated (fallback)';
            }));
}

// The debug port takes a moment to open after the relaunch. This used to be 40 tries
// at a flat 100ms; a deadline says what is actually meant, and backing off stops a slow
// television being hammered forty times while it is still starting up.
const ATTACH_DEADLINE = 12000;
const ATTACH_MIN_DELAY = 100;
const ATTACH_MAX_DELAY = 750;

function attach(host, port, args, startedAt) {
    const began = startedAt || Date.now();

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

                // The Runtime domain is deliberately NOT enabled.
                //
                // It used to be, so that `Runtime.executionContextCreated` could be
                // listened for and the userscript evaluated into each new context. The
                // cost of that is not the injection, it is the domain: with Runtime
                // enabled, Blink serialises *every* console call the page makes — object
                // previews and all — into a protocol event and pushes it over this socket
                // for as long as the app is open. YouTube's own client logs continuously
                // while a video plays, and this connection is loopback sdb on the
                // television's own CPU. Nothing reads those events; they were produced,
                // serialised, transmitted and dropped, next to a 4K60 decode.
                //
                // Registering the script against the document instead does the same job
                // with no domain enabled and no per-context evaluate, and it runs the
                // script *before* the page's own scripts rather than alongside them —
                // so YouTube's bundle cannot capture JSON.parse before this app owns it.
                client.Page.enable()
                    .then(() => registerScript(client, script.source))
                    .then((how) => {
                        console.log(`Userscript registered via ${how}.`);
                        // Without this, youtube.com's CSP blocks the injected script.
                        return client.Page.setBypassCSP({ enabled: true });
                    })
                    .then(() => client.Page.navigate({ url: watchUrl(args) }))
                    .then(() => resolve(client), reject);
            }).on('error', reject);
        }))
        .catch((err) => {
            const waited = Date.now() - began;

            if (waited >= ATTACH_DEADLINE) {
                stopConnecting();
                throw new Error(
                    `Could not attach to the debugger on ${host}:${port} after ${Math.round(waited / 1000)}s: ${err.message}`
                );
            }

            // Doubling from 100ms, capped: quick while the port is about to open, quiet
            // once it is clear it is taking a while.
            const delay = Math.min(ATTACH_MIN_DELAY * Math.pow(2, Math.floor(waited / 1000)), ATTACH_MAX_DELAY);

            return new Promise((resolve) => setTimeout(resolve, delay))
                .then(() => attach(host, port, args, began));
        });
}

// The daemon reports the set's LAN address, which is what the reference attached to.
// It is not the only address the debug port answers on, and a TV whose LAN address has
// just changed — or which is reporting it wrongly — leaves injection dead with no way
// to tell why. Loopback is tried second, on the same port.
function attachToEither(ip, port, args) {
    const first = ip || '127.0.0.1';

    return attach(first, port, args).catch((err) => {
        if (first === '127.0.0.1') throw err;

        console.warn(`${err.message}; retrying on loopback.`);
        beginConnecting();
        return attach('127.0.0.1', port, args);
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

                    if (!port) {
                        stopConnecting();
                        return reject(new Error(`SDB reported no usable debug port (said: ${text.trim().slice(0, 80)})`));
                    }

                    attachToEither(state.ip, port, args).then(
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
