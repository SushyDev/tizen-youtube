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

const ui = require('./report.js');

const { evaluate, settings } = require('./bridge.js');

const at = (flag, fallback) => {
    const found = process.argv.indexOf(flag);
    return found === -1 ? fallback : process.argv[found + 1];
};

const WHERE = { tv: at('--tv', settings().tv), token: settings().token };

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

const main = async () => {
    ui.heading('probe');
    ui.info('set', `${WHERE.tv}:8097`);

    const found = JSON.parse(JSON.parse(await evaluate(source, WHERE)));
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
