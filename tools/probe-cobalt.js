'use strict';

// Lists which browser APIs the page on a set lacks, for the Chromium shim to take away.

const ui = require('./report.js');

const { evaluate, settings, PORT } = require('./bridge.js');

const WHERE = settings();

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

const probe = (page, asked) => {
    const has = (path) => {
        try {
            return path.split('.').reduce((at, key) => (at == null ? at : at[key]), page) != null;
        } catch (e) {
            return false;
        }
    };

    return JSON.stringify(Object.assign(
        asked.reduce((out, name) => Object.assign({}, out, { [name]: has(name) }), {}),
        {
            _agent: page.navigator.userAgent,
            _ratio: page.devicePixelRatio,
            _screen: `${page.screen.width}x${page.screen.height}`
        }
    ));
};

const source = `(${probe})(window, ${JSON.stringify(ASKED)})`;

const main = async () => {
    ui.heading('probe');
    ui.info('set', `${WHERE.tv}:${PORT}`);

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
