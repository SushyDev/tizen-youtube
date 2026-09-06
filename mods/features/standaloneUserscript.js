// The page is served by the service from a private address, so anything it asks for that Google
// will not answer to that origin has to come back through the service. Which hosts those are was
// established by measurement, and the answer is not the obvious one:
//
//   - `videoplayback` grants Access-Control-Allow-Origin only to https://www.youtube.com. From any
//     other origin the answer carries no CORS headers at all and the player cannot read a byte.
//     (`generate_204` on the same host echoes whatever Origin it is given — a trap; do not take it
//     as evidence that media is reachable.)
//   - `jnn-pa` does answer our origin with a matching Access-Control-Allow-Origin, but *without*
//     Access-Control-Allow-Credentials, which it does send to youtube.com. A credentialed fetch
//     rejects that, the integrity token never arrives, and media then goes out carrying no
//     proof-of-origin token at all — which the server refuses about twice as fast.
//   - BotGuard's program comes from www.google.com. Left to load by itself it does not, and
//     without it `window.trayride` never appears: no VM, and nothing to attest with.
//
// Dropping the scheme to http instead of carrying the URL in the path does not work either: a gold
// Cobalt build refuses plain HTTP to any host that is not loopback or a private address, so the
// request never leaves the set.

const PROXIED = [
    'googlevideo.com',
    'googleapis.com',
    'google.com',
    'gstatic.com',
    'ggpht.com',
    'googleusercontent.com'
];

function throughTheService(hostname) {
    return PROXIED.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function redirectUrl(originalUrl) {
    if (!originalUrl) return originalUrl;

    try {
        let text = String(originalUrl);
        if (text.indexOf('//') === 0) text = `https:${text}`;

        const url = new URL(text, window.location.origin);

        // The page is served by the service, so anything naming youtube.com outright has to come
        // back to it — that is where the cookies live and where the script is injected. Built by
        // hand, because Cobalt's URL setters are broken: assigning `protocol` keeps the colon from
        // the value ("http%3a://host"), and assigning `host` after it empties the URL altogether,
        // which sent these requests back to the page's own address.
        if (url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com') {
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

// Redirects on assignment without taking the property over. The version this replaces defined a
// bare `set`, which dropped the getter — reading el.src afterwards gave undefined.
function redirectOnAssignment(kind, name) {
    const descriptor = Object.getOwnPropertyDescriptor(kind.prototype, name);
    if (!descriptor || typeof descriptor.set !== 'function') return;

    Object.defineProperty(kind.prototype, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) { descriptor.set.call(this, redirectUrl(value)); }
    });
}

export default function installProxyPatches() {
    if (window.__TUBE_NATIVE_PROXY_PATCHES__ === false) return;

    const originalFetch = window.fetch;
    if (originalFetch) {
        window.fetch = function (input, init) {
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
    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
        return originalOpen.call(this, method, redirectUrl(url),
            async === undefined ? true : async, user, password);
    };

    // Scripts only. An <img> is never read by script, so it never faces CORS and needs no help;
    // the old patch on HTMLImageElement was cost without benefit, and broke reading img.src.
    redirectOnAssignment(HTMLScriptElement, 'src');
}

// Self-installing on import. ES module imports are hoisted, so the reference's
// `if (...) initPatches()` in the entry file ran after every other module's top-level
// code, and anything capturing window.fetch got the unpatched original.
if (typeof window !== 'undefined' && window.location.protocol === 'http:') {
    installProxyPatches();
}

export { redirectUrl };
