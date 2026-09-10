// Chromium, cut down to what the container actually has.
//
// Measured on the set through the dev bridge, not assumed — tools/probe-cobalt.js is the script
// that produced this list and re-runs against a live television when the firmware moves.
//
//   Cobalt/25.lts.30.1034943-gold  ·  v8/8.8.278.17-jit  ·  Tizen 9.0
//
// Without this the browser suite is testing a browser. Every environment bug this project has had
// would pass unshimmed: startPage.js reached for history.replaceState, which Chromium has and the
// container does not, and shipped a feature that threw on its first line.
//
// What cannot be reproduced here is named at the bottom rather than left to be discovered.

// The whole History API. window.history in the container carries `length` and nothing else, which
// is why kabuki assigns location.hash and wraps it in a try/catch.
const NO_HISTORY = ['replaceState', 'pushState', 'back', 'forward', 'go'];

const ABSENT = [
    'ResizeObserver',
    'queueMicrotask',
    'structuredClone',
    'indexedDB',
    'BroadcastChannel',
    'SharedWorker',
    'ManagedMediaSource'
];

const ABSENT_ON = [
    ['Element', 'closest'],
    ['Element', 'replaceChildren'],
    ['Element', 'toggleAttribute'],
    ['Element', 'animate'],
    ['Document', 'elementFromPoint'],
    ['Array', 'findLast']
];

const ABSENT_UNDER = [
    ['navigator', 'deviceMemory'],
    ['navigator', 'sendBeacon'],
    ['navigator', 'mediaCapabilities'],
    ['crypto', 'randomUUID'],
    ['Intl', 'RelativeTimeFormat'],
    ['Intl', 'ListFormat']
];

// Reported by the container, and what YouTube is served by. A television is 1920x1080 at a device
// pixel ratio of 2.
const AGENT = 'Mozilla/5.0 (LINUX; Tizen/9.0/2025.20.1034877) Cobalt/25.lts.30.1034943-gold '
    + '(unlike Gecko) v8/8.8.278.17-jit gles Evergreen-Full';

const SCREEN = { width: 1920, height: 1080, ratio: 2 };

// Runs before anything else on the page, so the app sees the cut-down browser from its first line.
const asCobalt = (page) => page.addInitScript(([absent, absentOn, absentUnder, noHistory, screen]) => {
    // Deleting is not enough and does not complain: replaceState lives on History.prototype, so
    // `delete window.history.replaceState` removes nothing, returns true, and leaves the method
    // reachable through the chain. What has to be checked is whether it is still readable.
    const drop = (owner, name) => {
        if (!owner) return;

        try {
            delete owner[name];
        } catch (e) {
            // An own property that will not go is shadowed below instead.
        }

        if (owner[name] === undefined) return;

        try {
            Object.defineProperty(owner, name, { configurable: true, value: undefined });
        } catch (again) {
            // Nothing else to try; the suite sees the API and behaves as an unshimmed browser.
        }
    };

    noHistory.forEach((name) => drop(window.history, name));
    absent.forEach((name) => drop(window, name));
    absentOn.forEach(([owner, name]) => window[owner] && drop(window[owner].prototype, name));
    absentUnder.forEach(([owner, name]) => window[owner] && drop(window[owner], name));

    Object.defineProperty(window, 'devicePixelRatio', { get: () => screen.ratio, configurable: true });
    ['width', 'height'].forEach((side) => Object.defineProperty(window.screen, side, {
        get: () => screen[side], configurable: true
    }));
}, [ABSENT, ABSENT_ON, ABSENT_UNDER, NO_HISTORY, SCREEN]);

// What the shim does not reach, so that a green run is not read as more than it is:
//
//   customElements and ShadowRoot   absent in the container and present here. Removing them stops
//                                   kabuki rendering at all in Chromium, so the page under test
//                                   would be a blank one.
//   the key re-dispatch             kabuki rebuilds key events through a Tizen-only remapping
//                                   table, and the copy loses `repeat`. A constructed
//                                   KeyboardEvent carries it here and on the set, so the loss is
//                                   kabuki's and only happens where the remapping runs.
//   the renderer                    a real panel, a real decoder, and the cost of drawing on one.
const NOT_REPRODUCED = ['customElements', 'ShadowRoot', 'key re-dispatch', 'render cost'];

export { asCobalt, AGENT, NOT_REPRODUCED };
