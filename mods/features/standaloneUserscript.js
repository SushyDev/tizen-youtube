// The page is served from a private address, so anything Google will not answer to that origin has
// to come back through the service. Which hosts those are was established by measurement:
//
//   - videoplayback grants Access-Control-Allow-Origin only to https://www.youtube.com. From any
//     other origin the answer carries no CORS headers at all. (generate_204 on the same host echoes
//     whatever Origin it is given — a trap; it is not evidence that media is reachable.)
//   - jnn-pa answers our origin, but without Access-Control-Allow-Credentials, which it does send
//     to youtube.com. A credentialed fetch rejects that, the integrity token never arrives, and
//     media then goes out with no proof-of-origin token at all.
//   - BotGuard's program comes from www.google.com; without it window.trayride never appears.
//
// Dropping the scheme to http instead of carrying the URL in the path does not work either: a gold
// Cobalt build refuses plain HTTP to any host that is not loopback or a private address.

const PROXIED = [
    'googlevideo.com',
    'googleapis.com',
    'google.com',
    'gstatic.com',
    'ggpht.com',
    'googleusercontent.com'
];

const OURS = ['youtube.com', 'www.youtube.com'];

const throughTheService = (hostname) =>
    PROXIED.some((host) => hostname === host || hostname.endsWith(`.${host}`));

function redirectUrl(originalUrl) {
    if (!originalUrl) return originalUrl;

    try {
        const text = String(originalUrl);
        const url = new URL(text.indexOf('//') === 0 ? `https:${text}` : text, window.location.origin);

        // Built by hand, because Cobalt's URL setters are broken: assigning protocol keeps the colon
        // from the value ("http%3a://host"), and assigning host after it empties the URL.
        if (OURS.indexOf(url.hostname) !== -1) {
            return `${window.location.origin}${url.pathname}${url.search}${url.hash}`;
        }

        if (throughTheService(url.hostname)) {
            return `${window.location.origin}/cors-bypass/${url.toString()}`;
        }
    } catch (e) {
        // An unparseable URL is the page's business, not ours.
    }

    return originalUrl;
}

// Redirects on assignment without taking the property over: a bare `set` drops the getter, and
// reading el.src afterwards gives undefined.
const redirectOnAssignment = (kind, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(kind.prototype, name);
    if (!descriptor || typeof descriptor.set !== 'function') return;

    Object.defineProperty(kind.prototype, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) { descriptor.set.call(this, redirectUrl(value)); }
    });
};

export default function installProxyPatches() {
    if (window.__TUBE_NATIVE_PROXY_PATCHES__ === false) return;

    const originalFetch = window.fetch;

    if (originalFetch) {
        window.fetch = function patchedFetch(input, init) {
            if (typeof input === 'string') return originalFetch.call(this, redirectUrl(input), init);
            if (input instanceof URL) return originalFetch.call(this, redirectUrl(input.toString()), init);

            if (input instanceof Request) {
                const to = redirectUrl(input.url);
                return originalFetch.call(this, to === input.url ? input : new Request(to, input), init);
            }

            return originalFetch.call(this, input, init);
        };
    }

    const originalOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url, async, user, password) {
        return originalOpen.call(this, method, redirectUrl(url),
            async === undefined ? true : async, user, password);
    };

    // Scripts only. An <img> is never read by script, so it never faces CORS and needs no help.
    redirectOnAssignment(HTMLScriptElement, 'src');
}

// Self-installing on import: ES module imports are hoisted, so an `if (...) initPatches()` in the
// entry file runs after every other module's top-level code, and anything that captured
// window.fetch got the unpatched original.
if (typeof window !== 'undefined' && window.location.protocol === 'http:') {
    installProxyPatches();
}

export { redirectUrl };
