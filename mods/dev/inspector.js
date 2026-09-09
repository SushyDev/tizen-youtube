import { after, nativeJson } from '../../framework/index.js';

// The remote inspector, attached once the app is up.
//
// Not injected into the HTML: chii's target script hooks console, XHR and the DOM, and doing that
// while kabuki is still booting leaves a black screen — reproduced twice on the set, once with the
// script served from the laptop and once from our own origin, so it is the timing rather than
// where it comes from.
//
// Same-origin on purpose. Cobalt sends HTTP through --proxy but not WebSockets, so a socket opened
// straight to the laptop bypasses the proxy, cannot reach the LAN from inside the container, and
// closes 1006. Asked for under youtube.com, both the script and the socket it derives travel the
// one route out of that page that works, and the service forwards them on.
const MOUNT = '/__tube/chii/target.js';

// Long enough that the feed has drawn. The inspector is for looking at a running app, so nothing
// is lost by arriving late, and arriving early costs the whole page.
const ATTACH_AFTER = 6000;

// Off unless asked for, and remembered across launches. An inspector that attaches on every boot
// is one bad build away from a television that will not start, and the only way back from that is
// a reinstall — so arming it is a decision, not a default.
const SWITCH = 'tube.inspector';

// One shot. The switch is cleared the moment it is read, so an inspector that takes the page down
// takes it down once — the next launch is clean without anyone having to reach the set. Learned the
// hard way: a sticky flag plus a target script that breaks the dev bridge is a television that can
// only be recovered by reinstalling.
const wanted = () => {
    try {
        const asked = window.localStorage.getItem(SWITCH) === 'on';
        if (asked) window.localStorage.removeItem(SWITCH);
        return asked;
    } catch (e) {
        return false;
    }
};

// Handed to the page so a debugger can serialise through the unpatched pair. Ours run a handler
// per parse, which is the wrong thing to have in the path of a tool that is trying to observe the
// page rather than us.
const offerNativeJson = () => {
    try {
        window.__tubeNativeJSON = nativeJson();
    } catch (e) {
        // Nothing depends on this beyond convenience.
    }
};

// Two things this engine and this page cannot give a debugger, both measured on the set.
//
// 1. kabuki instruments Text.prototype.data, and its setter is:
//
//      set(b) { this.textContent = b; this.parentNode.appendChild(a); this.parentNode.removeChild(a); }
//
//    The assignment succeeds; the bookkeeping after it throws on a detached node, which is every
//    node a debugger builds before attaching it. That threw on DOM.enable — the first DOM command
//    — so the Elements panel was always empty. Text.prototype.data is non-configurable and cannot
//    be wrapped, but parentNode can: a detached text node is handed a throwaway parent, and those
//    two lines become harmless. Told only while the inspector is attached, because a detached node
//    claiming a parent is a lie and only one caller cannot cope with the truth.
//
// 2. There is no Range and no document.createRange at all. Enough of one to be asked for a node.
const holder = { element: null };

const shimParentNode = () => {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode');
    if (!descriptor || !descriptor.get || !descriptor.configurable) return false;

    holder.element = document.createElement('div');

    Object.defineProperty(Node.prototype, 'parentNode', {
        configurable: true,
        enumerable: !!descriptor.enumerable,
        get: function parentNode() {
            const real = descriptor.get.call(this);
            if (real) return real;

            return (window.__tubeInspecting && this.nodeType === 3) ? holder.element : real;
        }
    });

    return true;
};

const rangeFor = () => {
    const held = { start: null, end: null, collapsed: true };

    const boxOf = () => {
        const node = held.start;
        const element = node && (node.nodeType === 1 ? node : node.parentElement);

        return element && element.getBoundingClientRect
            ? element.getBoundingClientRect()
            : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    };

    return {
        get startContainer() { return held.start; },
        get endContainer() { return held.end; },
        get collapsed() { return held.collapsed; },
        selectNode: (node) => { held.start = node; held.end = node; held.collapsed = false; },
        selectNodeContents: (node) => { held.start = node; held.end = node; held.collapsed = false; },
        setStart: (node) => { held.start = node; },
        setEnd: (node) => { held.end = node; },
        collapse: () => { held.collapsed = true; },
        cloneContents: () => document.createDocumentFragment(),
        getBoundingClientRect: boxOf,
        getClientRects: () => [boxOf()],
        detach: () => undefined,
        toString: () => ''
    };
};

const shimRange = () => {
    if (typeof document.createRange !== 'undefined') return false;
    // Deliberately partial: a Range with the handful of members a debugger asks for, on an engine
    // that has none at all. The cast says that is intended rather than overlooked.
    document.createRange = /** @type {() => Range} */ (/** @type {unknown} */ (rangeFor));
    return true;
};

const shim = () => {
    window.__tubeInspecting = true;
    return { parentNode: shimParentNode(), range: shimRange() };
};

const attach = () => {
    shim();

    const nonced = document.querySelector('script[nonce]');
    const script = document.createElement('script');

    // The page is served under a nonce policy; a script without it is refused.
    if (nonced && nonced.nonce) script.nonce = nonced.nonce;

    script.src = MOUNT;
    document.head.appendChild(script);
};

// Asked for first, so a build with no inspector configured does nothing at all rather than
// appending a script tag that 404s on every launch.
const start = () => {
    // Offered whether or not the inspector attaches: a dev build should always be able to reach
    // the unpatched pair, including when the debugger is being driven by hand.
    offerNativeJson();

    if (!wanted()) return;

    after('inspector', ATTACH_AFTER, () => {
        fetch(MOUNT)
            .then((answer) => (answer.ok ? attach() : undefined))
            .catch(() => undefined);
    });
};

export { start, attach, SWITCH };
