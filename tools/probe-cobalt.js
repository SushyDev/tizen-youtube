'use strict';

// What the container has and has not, asked of a television.
//
//   node tools/probe-cobalt.js [--tv 192.168.1.29]
//
// test/e2e/cobalt.js cuts Chromium down to this answer, so that the browser suite is testing
// something shaped like the thing that ships. That list is only worth what this says, and what
// this says is only true of the firmware it was run against — so it lives here rather than in a
// comment, and is re-run when a set updates.
//
// Needs a debug build running on the set: the bridge is the page's own eval, on port 8097.

const http = require('http');

const ui = require('./report.js');

const at = (flag, fallback) => {
    const found = process.argv.indexOf(flag);
    return found === -1 ? fallback : process.argv[found + 1];
};

const TV = at('--tv', process.env.TUBE_TV || '192.168.1.29');
const TOKEN = process.env.TUBE_DEV_TOKEN || 'tvdebug2026';

// Everything test/e2e/cobalt.js might want to take away, plus what identifies the build.
const ASKED = [
    'history.replaceState', 'history.pushState', 'history.back', 'history.go', 'history.state',
    'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'PerformanceObserver',
    'AbortController', 'fetch', 'queueMicrotask', 'requestIdleCallback', 'structuredClone',
    'WeakRef', 'Proxy', 'Reflect', 'customElements', 'indexedDB', 'localStorage',
    'BroadcastChannel', 'SharedWorker', 'WebSocket', 'Worker',
    'navigator.deviceMemory', 'navigator.sendBeacon', 'navigator.mediaCapabilities',
    'navigator.hardwareConcurrency', 'MediaSource', 'ManagedMediaSource', 'ReadableStream',
    'Element.prototype.closest', 'Element.prototype.replaceChildren',
    'Element.prototype.toggleAttribute', 'Element.prototype.animate',
    'Document.prototype.elementFromPoint', 'ShadowRoot', 'Element.prototype.attachShadow',
    'Array.prototype.flatMap', 'Array.prototype.at', 'Array.prototype.findLast',
    'Object.fromEntries', 'Object.hasOwn', 'String.prototype.replaceAll',
    'Promise.allSettled', 'Promise.any', 'crypto.randomUUID',
    'Intl.RelativeTimeFormat', 'Intl.ListFormat', 'tizen', 'webapis'
];

const source = `(function(){
    var out = {};
    var has = function (path) {
        try {
            var parts = path.split('.'), at = window;
            for (var i = 0; i < parts.length; i++) { at = at[parts[i]]; if (at == null) return false; }
            return true;
        } catch (e) { return false; }
    };
    ${JSON.stringify(ASKED)}.forEach(function (name) { out[name] = has(name); });
    out._agent = navigator.userAgent;
    out._ratio = window.devicePixelRatio;
    out._screen = screen.width + 'x' + screen.height;
    return JSON.stringify(out);
})()`;

const ask = (options, body) => new Promise((resolve, reject) => {
    const request = http.request({ host: TV, port: 8097, timeout: 10000, ...options }, (response) => {
        const parts = [];
        response.on('data', (chunk) => parts.push(chunk));
        response.on('end', () => {
            try {
                resolve(JSON.parse(parts.join('')));
            } catch (e) {
                resolve(parts.join(''));
            }
        });
    });

    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error(`${TV}:8097 did not answer`)); });
    if (body) request.write(JSON.stringify(body));
    request.end();
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The page runs it on its next tick and carries the answer out in the reading, so it is asked for
// and then read back rather than returned.
const answer = async () => {
    await ask({
        method: 'POST',
        path: '/command',
        headers: { 'content-type': 'application/json', 'x-tube-token': TOKEN }
    }, { action: 'eval', source });

    const tries = Array.from({ length: 14 }, (unused, i) => i);

    return tries.reduce(async (found, unused) => {
        const already = await found;
        if (already) return already;

        await wait(700);
        const stats = await ask({ method: 'GET', path: '/stats' });
        const ran = stats && stats.reading && stats.reading.evaluated;

        return ran && ran.source === source ? ran : null;
    }, Promise.resolve(null));
};

const main = async () => {
    ui.heading('probe');
    ui.info('set', `${TV}:8097`);

    const ran = await answer();
    if (!ran) throw Object.assign(new Error('The page did not answer.\n'
        + '  A debug build has to be running on the set: TUBE_DEV=1 npm run package, then install.'),
    { isFriendly: true });

    if (ran.error) throw Object.assign(new Error(ran.error), { isFriendly: true });

    const found = JSON.parse(JSON.parse(ran.value));
    const missing = Object.keys(found).filter((name) => found[name] === false);

    ui.blank();
    ui.info('agent', found._agent);
    ui.info('screen', `${found._screen} at ${found._ratio}x`);
    ui.blank();
    ui.note(`${missing.length} of ${ASKED.length} are absent:`);
    missing.forEach((name) => ui.warn(name));
    ui.blank();
    ui.note('test/e2e/cobalt.js is what takes these away from Chromium; update it when this moves.');
};

main().catch((error) => ui.crash(error));
