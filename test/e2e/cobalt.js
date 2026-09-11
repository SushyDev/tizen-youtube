// Chromium, cut down to what the container actually has.

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

// The user agent the set sends, which decides what YouTube serves.
const AGENT = 'Mozilla/5.0 (LINUX; Tizen/9.0/2025.20.1034877) Cobalt/25.lts.30.1034943-gold '
    + '(unlike Gecko) v8/8.8.278.17-jit gles Evergreen-Full';

const SCREEN = { width: 1920, height: 1080, ratio: 2 };

const asCobalt = (page) => page.addInitScript(([absent, absentOn, absentUnder, noHistory, screen]) => {
    // An inherited method survives delete, so anything still readable is shadowed with undefined.
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

export { asCobalt, AGENT };
